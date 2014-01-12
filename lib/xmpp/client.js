/**
 * This file is part of the Firefox extension "CoopFox", developed as part of my master's thesis
 * at the Cooperative Media Lab, University of Bamberg, Germany.
 * @copyright (c) 2014 Ralf Strobel
 *
 * All content is no longer maintained and is made available purely for archival and educational purposes.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

'use strict';

const NS_XEP0115 = 'http://jabber.org/protocol/caps';

const { Class } = require('sdk/core/heritage');
const { XMPPSession, parseJid, parseAddresses } = require('./session');

const { setInterval, clearInterval } = require('sdk/timers');
const { forEachIfAny } = require('../utils/objects');
const { sha1 } = require('../utils/strings');

const offlinePresence = exports.offlinePresence = {
    $primary: { type: 'unavailable', c: { node: 'unknown', ver: null } }
};

/**
 * A basic XMPP client, capable of sending/receiving messages, receiving roster and presence information
 * and handling incoming as well as outgoing publish-subscibe notifications.
 */
const XMPPClient = Class({
    extends: XMPPSession,
    className: 'XMPPClient',

    /**
     * @param {object} options
     *  - {string}   clientNode : URI uniquely identifying the client (recommended, defaults to http://www.mozilla.org)
     *  - {object[]} identities : Array of { category, type, name }, services supported by the client.
     *  - {string[]} features   : Array of strings, protocols supported by the client.
     *
     *  - {function} onClientOnline : Called as soon as the client is fully initialized and visible as online.
     *  - {function} onRosterUpdate : Called whenever a fully updated roster has been received from the server.
     *  - {function} onRosterItemUpdate : Called whenever a roster item (status) has been updated.
     *  - {function} onIncomingMessage : Called whenever a new message has been received.
     */
    initialize : function initialize(options) {
        XMPPSession.prototype.initialize.apply(this, arguments);

        //phase 1: request complete roster (and future updates)
        this.once('sessionReady', this._requestRoster);

        //phase 2: send initial presence (server should respond by sending presence at least for online contacts)
        var presenceTimoutCheck = null;
        this.once('rosterUpdate', function() {
            this.sendPresence();
            //In case the server does not send presence for all contacts,
            //we continue after 500ms of not receiving any further presence.
            presenceTimoutCheck = setInterval(function() {
                if (this._sessionState !== 'session-active') {
                    //an error has occurred
                    clearInterval(presenceTimoutCheck);
                    return;
                }
                if (Date.now() - this._rosterLastUpdate > 500) {
                    this._rosterPresencePending = null;
                    console.info(this.className + ' did not receive presence for all contacts.');
                    this.emit('rosterPresenceComplete');
                }
            }.bind(this), 500);
        }.bind(this));

        //phase 3: notify external listeners that we are fully initialized
        this.once('rosterPresenceComplete', function() {
            clearInterval(presenceTimoutCheck);
            this.emit('clientOnline')
        });

        this.once('_beforeDestroy', this._sendLogoutPresence);
    },

    //////////// Identities / Features /////////////

    _initEntityCaps : function _initEntityCaps(options) {
        var info = this._clientInfo = {};

        info.node = options.clientNode || 'http://www.mozilla.org';
        info.identities = options.identities || [];
        info.features = options.features || [];

        if (!info.identities.some(function(i) {
            return (i.category == 'client');
        })) {
            info.identities.push({ category : 'client', type : 'web', name : 'mozilla' });
        }
        info.identities.sort(function(a,b) {
            return a.category.localeCompare(b.category)
                || a.type.localeCompare(b.type)
                /*|| a['xml:lang'].localCompare(b['xml:lang'])*/;
        });

        if (info.features.indexOf(NS_XEP0115) == -1) {
            info.features.push(NS_XEP0115);
        }
        if (info.features.indexOf('http://jabber.org/protocol/disco#info') == -1) {
            info.features.push('http://jabber.org/protocol/disco#info');
        }
        info.features.sort();
    },

    _getEntityCaps : function _getEntityCaps() {
        var c = {
            xmlns : NS_XEP0115,
            node : this._clientInfo.node,
            hash : 'sha-1'
        };
        var s = '';
        this._clientInfo.identities.forEach(function(i) {
           s += i.category + '/' + i.type + '/' /*lang*/ + '/' + (i.name || '') + '<';
        });
        this._clientInfo.features.forEach(function(f) {
           s += f + '<';
        });
        c.ver = sha1(s, 'base64');
        return c;
    },

    _getEntitiyCapsResponse : function _getEntitiyCapsResponse() {
        var c;
        c = {
            identity : this._clientInfo.identities,
            feature : []
        };
        this._clientInfo.features.forEach(function(ft) {
           c.feature.push({ 'var' : ft });
        });
        return c;
    },

    //////////// Stanza send / receive /////////////

    /**
     * Validates / sends an XMPP message stanza.
     *
     * Requires a valid JID in "to" property.
     * Requires a valid defined "type" property.
     * Adds a random "id" property if not specified.
     * Adds own full JID as "from" property.
     *
     * Recommended child elements: "subject", "body", "thread".
     * @link http://xmpp.org/extensions/xep-0201.html
     *
     * @see jsonToDom()
     * @param {object} message  Stanza descriptor.
     * @param {boolean} echo When true, the outgoing message will also be delivered to self.
     *
     * @throws {TypeError} If message contains invalid entities.
     * @throws {Error} If connection not ready; recipient or type invalid.
     */
    sendMessage : function sendMessage(message, echo) {
        if (typeof(message) != 'object') {
            throw new TypeError('Invalid descriptor for XMPP message stanza.');
        }

        if (typeof(message.to) != 'string' || !message.to.match(/^(.+?@)?(.+?)(?:\/|$)(.*$)/)) {
            throw new Error('Invalid "to" attribute for XMPP message stanza.');
        }
        if (['chat', 'groupchat', 'headline', 'normal'].indexOf(message.type) == -1) {
            throw new Error('Invalid "type" attribute for message stanza.');
        }
        this.sendStanza('message', message);

        if (echo && !message.$noEcho) {
            message.$isEcho = true;
            try {
                this._handleIncomingStanza(message, null);
            } finally {
                delete message.$isEcho;
            }
        }
    },

    /**
     * Validates / sends an XMPP presence stanza.
     *
     * Requires a valid defined "type" property (or none).
     * Adds a random "id" property if not specified.
     * Adds own full JID as "from" property.
     *
     * @see jsonToDom()
     * @param {object} presence  Stanza descriptor.
     *
     * @throws {TypeError} If presence contains invalid entities.
     * @throws {Error} If connection not ready; type invalid.
     */
    sendPresence : function sendPresence(presence) {
        if (typeof(presence) !== 'object') {
            presence = {};
        }

        if (presence.type) {
            //validate special-type presence
            if (['unavailable','subscribe','subscribed','unsubscribe','unsubscribed'].indexOf(presence.type) === -1) {
                throw new Error('Invalid "type" attribute for presence stanza.');
            }
        }
        else {
            //extend standard-type presence with stored show/status info
            let show = this.rosterSelf.presence.$primary.show;
            if (show) {
                if (['chat','away','dnd','xa'].indexOf(show) === -1) {
                    throw new Error('Invalid "show" element for XMPP presence stanza.');
                }
                presence.show = { $text: show };
            }
            let status = this.rosterSelf.presence.$primary.status;
            if (status) {
                if (typeof(status) !== 'string') {
                    throw new Error('Invalid "status" element for XMPP presence stanza.');
                }
                presence.status = { $text: status };
            }
        }

        if (!presence.type) {
            presence.c = this._getEntityCaps();
        }
        this.sendStanza('presence', presence);
    },

    _sendLogoutPresence : function _sendLogoutPresence() {
        if (this.isReady()) {
            this.sendPresence({
                type : 'unavailable',
                status : {
                    $text : 'offline'
                }
            });
        }
    },

    /**
     * Validates / sends an XMPP iq stanza.
     *
     * Requires a "type" property of either "set" or "get".
     * Adds server hostname as "to" property if not specified.
     * Adds a random "id" property if not specified.
     * Adds own full JID as "from" property.
     *
     * @see jsonToDom()
     * @param {object} iq  Stanza descriptor.
     *
     * @throws {TypeError} If iq contains invalid entities.
     * @throws {Error} If connection not ready; type invalid.
     */
    sendIq : function sendIq(iq) {
        if (typeof(iq) != 'object') {
            throw new TypeError('Invalid descriptor for XMPP iq stanza.');
        }
        if (['set', 'get'].indexOf(iq.type) == -1) {
            throw new Error('Invalid "type" attribute for iq stanza.');
        }
        this.sendStanza('iq', iq);
    },

    /**
     * Sends an iq result stanza for a received iq stanza.
     *
     * Adds a "type" property of "result".
     * Adds a "to" property equal to request "from" property.
     * Adds an "id" property equal to request "id" property.
     * Adds own full JID as "from" property.
     *
     * If the request contained a "query" element, then the
     * response will also contain a "query" element. If no
     * such subelement exists, it is created. The namespace
     * property of "query" is filled in to match the request.
     *
     * The response argument can be omitted, in which case
     * an empty response (simple confirmation) is sent.
     *
     * @see jsonToDom()
     * @param {object} request   Stanza descriptor.
     * @param {object} response  Stanza descriptor.
     *
     * @throws {TypeError} If response contains invalid entities.
     * @throws {Error} If connection not ready.
     */
    sendIqResponse : function sendIqResponse(request, response) {
        if (typeof(request) != 'object' || !request.id) {
            throw new TypeError('Invalid request passed to sendIqResponse()');
        }
        if (typeof(response) === 'undefined') {
            response = {};
        }
        if (request.query) {
            if (typeof(response.query) === 'undefined') {
                response.query = {};
            }
            response.query.xmlns = request.query.xmlns;
            if (request.query.node) {
                response.query.node = request.query.node;
            }
        }
        response.id = request.id;
        if (request.from) {
            response.to = request.from;
        }
        response.type = 'result';
        this.sendStanza('iq', response);

        if (typeof(request.$result) === 'undefined') {
            request.$result = true;
        }
    },

    //////////// Online Status & Roster Management /////////////

    _initRoster : function _initRoster(options) {

        this.roster = {};
        this.rosterSelf = {};
        this._rosterPresencePending = null;
        this._rosterLastUpdate = Date.now();

        var selfJid = this._jid;
        var selfName = options.selfName || this._jid.username.charAt(0).toUpperCase() + this._jid.username.substr(1);

        Object.defineProperties(this.rosterSelf, {
            isSelf : {
                value : true,
                enumerable : true
            },
            jid : {
                value : selfJid,
                enumerable : true
            },
            name : {
              value : selfName,
              enumerable : true,
              writable: true
            },
            presence : {
              value: Object.freeze({ $primary : {} }),
              enumerable : true
            }
        });

        Object.defineProperties(this.rosterSelf.presence.$primary, {
            type : {
                value : null,
                enumerable : true
            },
            subscription : {
                value : 'both',
                enumerable : true
            },
            priority : {
                value : 0,
                enumerable : true
            },
            show : {
                value: options.selfShow || '',
                enumerable : true,
                writable: true
            },
            status : {
                value: options.selfStatus || '',
                enumerable : true,
                writable: true
            }
        });

        this._preferredContactClientNode = options.preferredContactClientNode || null;
    },

    _requestRoster : function _requestRoster() {
        this.sendIq({
            type : 'get',
            query : { xmlns : 'jabber:iq:roster' },
            onSuccess : function(response) {
                forEachIfAny(response.query.item, this._updateRosterItem, true);
                this.emit('rosterUpdate');
            }.bind(this),
            onError : this._onConnectionError
        });
    },

    _updateRosterItem : function _updateRosterItem(item, quiet) {
        this._rosterLastUpdate = Date.now();

        item.jid = parseJid(item.jid);
        var bare = item.jid.bare;

        var oldItem = this.roster[bare];
        if (oldItem) {
            //preseve existing status info
            item.presence = oldItem.presence;
            item.$presenceReceived = oldItem.$presenceReceived || false;
            item.jid = oldItem.jid; //primary resource may have been set
        } else {
            item.presence = { $primary : { type : 'unavailable', c: { node: 'unknown', ver: null } } };
            item.$presenceReceived = false;
            if (!this._rosterPresencePending) {
                this._rosterPresencePending = {};
            }
            this._rosterPresencePending[bare] = true;
        }
        if (!item.name) {
            item.name = item.jid.username.charAt(0).toUpperCase() + item.jid.username.substr(1);
        }

        if (!item.subscription) {
            //directed presence
            item.subscription = null;
        }
        if (item.subscription === 'remove') {
            if (item.presence.$primary.type !== 'unavailable') {
                item.presence = offlinePresence;
                if (!quiet) {
                    this.emit('rosterItemUpdate', item, 'presence');
                }
            }
            delete this.roster[bare];
        } else {
            this.roster[bare] = item;
        }

        if (!quiet) {
            this.emit('rosterItemUpdate', item, 'item');
        }
    },

    _updateRosterItemPresence : function _updateRosterItemPresence(presence) {
        this._rosterLastUpdate = Date.now();

        var jid = parseJid(presence.from, '$primary');
        presence.$resource = (jid.resource === '$primary') ? null : jid.resource;
        delete presence.from;

        if (!this.roster[jid.bare] && (presence.type === 'unavailable')) {
            //can happen directly after unsubscription, must not re-create contact
            return;
        }

        //in case of directed presence
        this.ensureContact(jid.bare, true);

        if (!presence.priority) {
            presence.priority = 0;
        }
        if (!presence.type) {
            presence.type = null;
        }
        if ((presence.type === 'unavailable') || !presence.c || (presence.c.xmlns !== NS_XEP0115) || !presence.c.node) {
            presence.c = { node: 'unknown', ver: null };
        }

        if (presence.show) {
            if (presence.show.$text) {
                presence.show = presence.show.$text;
            } else {
                delete presence.show;
            }
        }
        if (presence.status) {
            if (presence.status.$text) {
                presence.status = presence.status.$text;
            } else {
                delete presence.status;
            }
        }

        var rosterItem = this.roster[jid.bare];
        rosterItem.presence[jid.resource] = presence;
        rosterItem.$presenceReceived = true;
        if (this._rosterPresencePending && this._rosterPresencePending[jid.bare]) {
            delete this._rosterPresencePending[jid.bare];
            if (!Object.keys(this._rosterPresencePending).length) {
                this.emit('rosterPresenceComplete');
            }
        }

        rosterItem.jid.resource = null; //re-assigned below, if available

        if (jid.resource !== '$primary') {
            //determine new primary presence...
            delete rosterItem.presence.$primary;

            let presences = [];
            for each (let pres in rosterItem.presence) {
                presences.push(pres);
            }

            var prefNode = this._preferredContactClientNode;
            presences.sort(function(a,b) {
                if (!a.type && b.type){ return 1; }
                if (!b.type && a.type){ return -1; }

                if ((a.c.node === prefNode) && (b.c.node !== prefNode)) { return 1; }
                if ((b.c.node === prefNode) && (a.c.node !== prefNode)) { return -1; }

                if (a.priority > b.priority) { return 1; }
                if (b.priority > a.priority) { return -1; }

                return 0;
            });

            let $primary = rosterItem.presence.$primary = presences.pop();
            rosterItem.jid.resource = $primary.$resource; //enables the use of jid.full
        }

        this.emit('rosterItemUpdate', this.roster[jid.bare], 'presence');
    },

    /**
     * Retrieves a valid roster-item descriptor for any valid JID.
     * If the given JID matches the current session, rosterSelf is returned.
     * If an unknown JID is specified, a temporary roster item is created for it.
     *
     * @param {string|object} jid  Any form of JID
     * @param {boolean} noAutoCreate      Return null if not found, instead of temporary contact.
     * @param {boolean} quietAutoCreate   Suppress 'rosterItemUpdate' event on creation.
     * @returns {object|null}
     */
    getContact: function getContact(jid, noAutoCreate, quietAutoCreate) {
        if (typeof(jid) === 'object') {
            jid = jid.bare;
        } else {
            jid = parseJid(jid).bare;
        }
        if (jid === this._jid.bare) {
            return this.rosterSelf;
        }
        if (!this.roster[jid]) {
            if (noAutoCreate) {
                return null;
            }
            this._updateRosterItem({ jid : jid, temporary: true }, quietAutoCreate);
        }
        return this.roster[jid];
    },

    /**
     * Ensures that a given JID is a valid roster item.
     * Will create a temporary item if necessary.
     *
     * @see getContact
     */
    ensureContact: function ensureContact(jid, quiet) {
        this.getContact(jid, false, quiet);
    },

    /**
     * Convenience function which returns true if a contact is known and online.
     *
     * @param {string|object} jid  A JID (bare, full or descriptor)
     * @return {boolean}
     */
    contactAvailable: function contactAvailable(jid) {
        var contact = this.getContact(jid, true);
        if (!contact || !contact.presence || contact.isSelf) {
            return false;
        }
        return contact.presence.$primary.type !== 'unavailable';
    },

    //////////// Publish-Subscribe /////////////

    _initPubSub : function _initPubSub() {
        this._subscribeHandlers = {};
    },

    /**
     * Publish a pubsub item via Personal Eventing Protocol.
     * @link http://xmpp.org/extensions/xep-0163.html
     *
     * The last published item will be stored at rosterSelf[node].
     * On the receiving client side, it is available at roster[jid][node].
     *
     * To subscribe to items, either register a listener to the
     * corresponding event [ XMPPClient.on(node, function(item, from) {}) ],
     * or listen for "rosterUpdate" events with node passed as reason.
     *
     * @see jsonToDom()
     * @param {string} node     Node to publish to (must be a valid URI).
     * @param {object} item     Item element descriptor.
     *
     * @throws {TypeError} If item contains invalid entities.
     * @throws {Error} If connection not ready; node invalid.
     */
    publish : function publish(node, item) {
        if (!this.serviceAvailable('pubsub', 'pep')) {
            //see XEP-0163: Personal Eventing Protocol
            this._setSessionState('error', 'XMPP server does not support Personal Eventing Protocol');
            return;
        }
        if ((typeof(node) != 'string') || (node.indexOf(':') == -1)) {
            throw new Error('Invalid node name for XMPP pubsub.');
        }
        if (typeof(item) != 'object') {
            throw new TypeError('Invalid item for XMPP pubsub.');
        }
        this.sendStanza('iq', {
            type : 'set',
            pubsub : {
                xmlns : 'http://jabber.org/protocol/pubsub',
                publish : {
                    node : node,
                    item : item
                }
            }
        });
        //store content of first subnode in own profile
        for each (let i in item) {
            if (typeof(i) === 'object') {
                this.rosterSelf[node] = i;
                break;
            }
        }
    },

    _updateRosterItemPubSub : function _updateRosterItemPubSub(item, node, from) {
        //'from' should always be a bare JID in PEP
        if (!this.roster[from]) { return; }

        //all PEP protocols submit data as single sub-element to <item>
        var innerItem = null;
        for each (let i in item) {
            if (typeof(i) === 'object') {
                innerItem = i;
                break;
            }
        }
        if (!innerItem) {
            console.warn('Received pubsub item seems empty: ' + JSON.stringify(item));
            return;
        }
        delete innerItem.xmlns;

        this.roster[from][node] = innerItem;
        this.emit('rosterItemUpdate', this.roster[from], node);
        this.emit(node, innerItem, from); //generic subscription event
    },

    //////////// Stanza handling /////////////

    _handleIncomingStanza : function _handleIncomingStanza(stanza, element) {
        if (stanza.from) {
            stanza.$from = parseJid(stanza.from);
        }
        switch (stanza.$kind) {
            case 'message' :

                stanza.$to = parseAddresses(stanza.addresses) || parseJid(stanza.to);

                if (stanza.event && (stanza.event.xmlns == 'http://jabber.org/protocol/pubsub#event')) {
                    let node = stanza.event.items.node;
                    if (node.indexOf(':') == -1) {
                        //protect agains name collision with internal events / properties
                        console.warn('Received pubsub node is not a valid uri: ' + node);
                        return 'bad-request';
                    }
                    if(!forEachIfAny(stanza.event.items.item, this._updateRosterItemPubSub, node, stanza.from)) {
                        //Transient notifications do not contain any items
                        this.emit(node, null, stanza.from);
                    }
                    return true;
                }

                this.ensureContact(stanza.from);

                this.emit('incomingMessage', stanza);
                if (typeof(stanza.$result) !== 'undefined') {
                    return stanza.$result;
                }
                return true;

            break;
            case 'presence' :
                if (!stanza.type || (stanza.type === 'unavailable')) {
                    return this._updateRosterItemPresence(stanza);
                }
                else {
                    this.emit('incomingSubscriptionPresence', stanza);
                    return;
                }
            break;
            case 'iq' :
                switch (stanza.type) {
                    case 'set' :
                        if (stanza.query) {
                            switch (stanza.query.xmlns) {
                                case 'jabber:iq:roster' :
                                    this.emit('iq:set:jabber:iq:roster', stanza);
                                    forEachIfAny(stanza.query.item, this._updateRosterItem);
                                    this.sendIqResponse(stanza);
                                    return true;
                            }
                        }
                    break;
                    case 'get' :
                        if (stanza.ping && stanza.ping.xmlns === 'urn:xmpp:ping') {
                            this.sendIqResponse(stanza);
                            return true;
                        }
                        if (stanza.query) {
                            switch (stanza.query.xmlns) {
                                case 'http://jabber.org/protocol/disco#info' :
                                    this.sendIqResponse(stanza, { query : this._getEntitiyCapsResponse() });
                                    return true;
                            }
                        }
                    break;
                }
                if (stanza.query) {
                    //try external listener
                    this.emit('iq:' + stanza.type + ':' + stanza.query.xmlns, stanza);
                    if (typeof(stanza.$result) !== 'undefined') {
                        return stanza.$result;
                    }
                    return false;

                }
                return false; //return error on everything we didn't know how to handle
            break;
        }
    }

});
exports.XMPPClient = XMPPClient;
