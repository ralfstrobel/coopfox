/**
 * This file is part of the Firefox extension "CoopFox", developed as part of my master's thesis
 * at the Cooperative Media Lab, University of Bamberg, Germany.
 * @copyright (c) 2014 Ralf Strobel
 *
 * Special thanks to Massimiliano Mirra, who wrote the original "xmpp4moz" extension for Firefox,
 * which served as an inspiration for parts of the code in this file.
 *
 * All content is no longer maintained and is made available purely for archival and educational purposes.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

'use strict';

const XMPP_STREAMS_DEBUG = false;

const STANZA_CALLBACK_TTL = 10000; //how long stanzas with callbacks are stored (msec)

const STANZA_ERROR_CONDITION_TYPES = {
    'bad-request' : 'modify',
    'conflict' : 'cancel',
    'feature-not-implemented' : 'cancel',
    'forbidden' : 'auth',
    'gone' : 'modify',
    'internal-server-error' : 'wait',
    'item-not-found' : 'cancel',
    'jid-malformed' : 'modify',
    'not-acceptable' : 'modify',
    'not-allowed' : 'cancel',
    'not-authorized' : 'auth',
    'payment-required' : 'auth',
    'recipient-unavailable' : 'wait',
    'redirect' : 'modify',
    'registration-required' : 'auth',
    'remote-server-not-found' : 'cancel',
    'remote-server-timeout' : 'wait',
    'resource-constraint' : 'wait',
    'service-unavailable' : 'cancel',
    'subscription-required' : 'auth',
    'undefined-condition' : 'cancel',
    'unexpected-request' : 'wait'
};

const NS_XEP0033 = exports.NS_XEP0033 = 'http://jabber.org/protocol/address';

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../utils/events');
const { XMPPConnection } = require('./connection');
const { SECURITY_NONE, SECURITY_SSL, SECURITY_STARTTLS, SECURITY_STARTTLS_REQUIRED } = require('./tcp');
const { uuidhash, md5 } = require('../utils/strings');
const base64 = require('sdk/base64');

/**
 * Resolve a JID to its components.
 *
 * (bare = username@hostname)
 * (full = username@hostname/resource)
 *
 * @param {string} jid
 * @param {string} defaultResource  Resource to append to bare JIDs (optional)
 * @return {object} (username, hostname, resource, bare, full)
 *
 * @throws {Error} If JID is malformed.
 */
const parseJid = exports.parseJid = function parseJid(jid, defaultResource) {
    var parts = jid.match(/^(?:(.+?)@)?(.+?)(?:\/|$)(.*$)/);
    if (!parts) {
        throw new Error('Malformed JID: ' + jid);
    }
    return {
        username: parts[1] || null,
        hostname: parts[2],
        resource: parts[3] || defaultResource || null,
        get bare() { return this.username ? this.username + '@' + this.hostname : this.hostname; },
        get full() { return this.resource ? this.bare + '/' + this.resource : this.bare; }
    };
};

/**
 * Resolve the contents of an XEP0033 <addresses> element.
 * The output is either a single JID descriptor, as given by parseJid,
 * or an array of such descriptors if there were multiple recipients.
 *
 * @param {object} element
 * @returns {object[]|object}
 */
exports.parseAddresses = function parseAddresses(element) {
    var result = null;
    if (element && (typeof(element) === 'object') && element.address && (typeof(element.address) === 'object')) {
        let recipients = element.address;
        if (!Array.isArray(recipients)) {
            recipients = [recipients];
        }
        result = [];
        for each (let recipient in recipients) {
            result.push(parseJid(recipient.jid));
        }
        if (result.length === 1) {
            result = result[0];
        }
    }
    return result;
};

/**
 * An abstract XMPP session which will handle all connection steps
 * until a session has been established and stanzas may be sent.
 *
 * Any derived classes must implement the _handleIncomingStanza() method.
 */
const XMPPSession = Class({
    extends: EventHub,
    className: 'XMPPSession',

    /**
     * @param {object} options
     *  - {string} jid       A valid JID (username@hostname[/resource])
     *  - {string} password  The login password for username@hostname
     *
     *  - {function} onSessionReady : Will be called as soon as a session is active and stanzas may be sent.
     *  - {function} onDiscoInfo    : Will be called as soon as server service discovery data is available.
     *  - {function} onSessionError : Will be called whenever a fatal error leads to connection loss.
     */
    initialize : function initialize(options) {
        if (typeof(options.jid) != 'string') {
            throw new TypeError('Invalid JID');
        }
        if (typeof(options.password) != 'string') {
            throw new TypeError('Invalid Password');
        }

        this._connection = null;
        this._sessionState = 'disconnected';

        this._defaultResource = options.resource || 'mozilla';
        this._setJid(options.jid); //may be required for some _init* calls

        EventHub.prototype.initialize.apply(this, arguments);

        this._password = options.password;
        if (!options.hostname) {
            options.hostname = this._jid.hostname;
        }
        this._hostname = options.hostname;
        if (!options.security) {
            options.security = SECURITY_NONE;
        }
        this._security = options.security;
        this._tlsStarted = false;

        options.streamHostname = this._jid.hostname;
        options.onElement = this._readHeaderElement;
        options.onTcpError = this._onConnectionError;

        this._setSessionState('connecting');
        this._connection = new XMPPConnection(options);
    },

    _setJid : function _setJid(jid) {
        this._jid = parseJid(jid, this._defaultResource);
        if (!this._jid.username) {
            throw new Error('Incomplete JID for XMPP session.');
        }
        Object.freeze(this._jid);
    },

    ///////////////////

    _LOG : function _LOG() {
        if (XMPP_STREAMS_DEBUG) {
            var logLine = ('XMPP (' + this._jid.full + ') : ');
            for each (let argument in arguments) {
                logLine += argument + ' ';
            }
            console.log(logLine);
        }
    },

    _setSessionState : function _setSessionState(name, stateData) {
        if (this._sessionState == name) { return; }
        if (this._sessionState == 'error') { return; }
        if (stateData) {
            this._LOG('STATE ', name, ' [', stateData, ']');
        } else {
            this._LOG('STATE ', name);
        }
        this._sessionState = name;
        switch (name) {
            case 'session-active' :
                this.emit('sessionReady');
            break;
            case 'error' :
                let args = Array.prototype.slice.call(arguments, 1);
                args.unshift('sessionError');
                this.emit.apply(this, args);
                this.destroy();
            //noinspection FallthroughInSwitchStatementJS
            case 'disconnected' :
                // Both error and manual disconnect make sure the object is destroyed.
                // Register listener for onDestroy / onBeforeDestroy to capture general disconnect.
                this.destroy();
            break;
        }
    },

    _assertState : function _assertState() {
        for (let i in arguments) {
            if(this._sessionState == arguments[i]) { return; }
        }
        var message = 'Expected state "' + Array.slice(arguments).join('/') + '"' +
            ' while in state "' + this._sessionState + '"';
        this._setSessionState('error', message);
        throw new Error(message);
    },

    /**
     * Whether the session has an open TCP connection.
     * @return {boolean}
     */
    isConnected : function isConnected() {
        if (!this._connection) { return false; }
        return this._connection.isConnected();
    },

    /**
     * Whether the session is initialized and ready to send stanzas.
     * @return {boolean}
     */
    isReady : function isReady() {
        return (this._sessionState == 'session-active');
    },

    ///////////////////

    _onConnectionError : function _onConnectionError(info) {
        switch (typeof(info)) {
            case 'object' :
                if (info instanceof Error) {
                    console.exception(info);
                    this._setSessionState('error', info.toString());
                    break;
                }
                for (let i in info) {
                    let element = info[i];
                    if ((typeof(element) === 'object') && element.xmlns) {
                        if (element.xmlns === 'urn:ietf:params:xml:ns:xmpp-streams'
                        ||  element.xmlns === 'urn:ietf:params:xml:ns:xmpp-stanzas')
                        {
                            //Found defined error condition element
                            if (info.text && info.text.$text) {
                                this._setSessionState('error', i + '(' + info.text.$text + ')');
                            } else {
                                this._setSessionState('error', i);
                            }
                            break;
                        }
                    }
                }
                info = String(info);
            //noinspection FallthroughInSwitchStatementJS
            case 'string' :
                let args = Array.slice(arguments);
                args.unshift('error');
                this._setSessionState.apply(this, args);
            break;
            default :
                this._setSessionState('error', 'unknown');
        }
    },

    _destroyXMPPSession : function _destroyXMPPSession() {
        this._setSessionState('disconnected');
        if(this._connection) {
            this._connection.destroy();
            this._connection = null;
        }
    },

    ////// Stream event handlers ///////

    _initServerInfo : function _initServerInfo() {
        this.serverInfo = {
            sasl_support : {},
            requireTLS : false,
            requireBind : false,
            requireSession : false,
            identities : {},
            features : []
        }
    },

    _readHeaderElement : function _readHeaderElement(header, element) {
        if (element.localName == 'error') {
            this._onConnectionError(header);
            return;
        }

        switch (element.namespaceURI) {

            case 'http://etherx.jabber.org/streams' :
                switch (element.localName) {
                    case 'features' :
                        this._readStreamFeaturesElement(header, element);
                    break;
                }
            break;

            case 'urn:ietf:params:xml:ns:xmpp-tls' :
                if (element.localName == 'proceed') {
                    this._assertState('tls-requested');
                    this._setSessionState('tls-negotiating');
                    this._connection.startTLS();
                    this._tlsStarted = true;
                    this._connection.resetStream();
                } else {
                    this._setSessionState('error', 'Unable to interpret xmpp-tls response: ' + element.localName);
                }
            break;

            case 'urn:ietf:params:xml:ns:xmpp-sasl' :
                switch (element.localName) {
                    case 'success' :
                        this._assertState(
                            'sasl-plain-waiting-result',
                            'sasl-digest-md5-waiting-result',
                            'sasl-digest-md5-waiting-confirm' //some servers skip steps 3 and 4
                        );
                        this._connection.resetStream();
                    break;
                    case 'failure' :
                        this._assertState('sasl-plain-waiting-result', 'sasl-digest-md5-waiting-confirm');
                        this._setSessionState('error', element.firstElementChild.nodeName);
                    break;
                    case 'challenge' :
                        this._assertState('sasl-digest-md5-waiting-challenge', 'sasl-digest-md5-waiting-confirm');
                        try {
                            if (this._sessionState === 'sasl-digest-md5-waiting-challenge') {
                                this._saslDigestMd5RespondChallenge(element.textContent);
                            } else {
                                this._saslDigestMd5RespondConfirm(element.textContent);
                            }
                        }
                        catch (e) {
                            this._setSessionState('error', e.message);
                        }
                    break;
                    case 'response' :
                        this._assertState('sasl-digest-md5-waiting-confirm');
                        this._setSessionState('error', 'not-authorized');
                    break;
                    default :
                        this._setSessionState('error', 'Unable to interpret xmpp-sasl response: ' + element.localName);
                }
            break;

            console.warn('Unknown XMPP server response: ' + element.namespaceURI + ':' + element.localName);
        }
    },

    _readStreamFeaturesElement : function _readStreamFeaturesElement(features, element) {

        if (!this._tlsStarted) {
            // 1) Initiate secure connection if available
            var starttls = element.getElementsByTagNameNS('urn:ietf:params:xml:ns:xmpp-tls', 'starttls');
            if (starttls.length > 0) {
                if (starttls[0].getElementsByTagName('required').length > 0) {
                    this.serverInfo.requireTLS = true;
                }
                if (
                    (this._security === SECURITY_STARTTLS) ||
                    (this._security === SECURITY_STARTTLS_REQUIRED) ||
                    (this.serverInfo.requireTLS)
                ) {
                    this._connection.writeElement('starttls', { xmlns : 'urn:ietf:params:xml:ns:xmpp-tls' });
                    this._setSessionState('tls-requested');
                    //awaiting <proceed> element to begin negotiation
                    return;
                }
            } else {
                if (this._security === SECURITY_STARTTLS_REQUIRED) {
                    this._setSessionState('error', 'TLS Encryption not supported by server.');
                }
            }
        }

        // 2) Authentication
        var mechanisms = element.getElementsByTagNameNS('urn:ietf:params:xml:ns:xmpp-sasl', 'mechanisms');
        if (mechanisms.length > 0) {
            mechanisms = mechanisms[0].getElementsByTagName('mechanism');
            this.serverInfo.sasl_support = {};
            for (let i=0; i < mechanisms.length; i++) {
                this.serverInfo.sasl_support[mechanisms[i].textContent] = true;
            }
            this._sendAuth();
            return;
        }

        //TODO: XEP-0138: Stream Compression

        //All done with the non-stanzas, switch over to stream body handling
        this._connection.off('element', this._readHeaderElement);
        this._connection.on('element', this._readStanzaElement);
        this._setSessionState('stream-initialized');

        // 4) Determine if explicit session is required after step 3
        var session = element.getElementsByTagNameNS('urn:ietf:params:xml:ns:xmpp-session', 'session');
        if (session.length > 0) {
            this.serverInfo.requireSession = true;
        }

        // 3) Resource binding
        var bind = element.getElementsByTagNameNS('urn:ietf:params:xml:ns:xmpp-bind', 'bind');
        if (bind.length > 0) {
            this.serverInfo.requireBind = true;
            this._bindResource();
            return;
        }

        this._setSessionState('error', 'Unable to determine next action for XMPP login');
    },

    _sendAuth : function _sendAuth() {
        if (this.serverInfo.sasl_support['PLAIN'] && (this._tlsStarted || (this._security === SECURITY_SSL))) {
            //this is a secure connection, so fast plaintext password submission is fine
            var auth = base64.encode(this._jid.bare + '\0' + this._jid.username + '\0' + this._password, 'utf-8');
            this._connection.writeElement('auth', {
                xmlns : 'urn:ietf:params:xml:ns:xmpp-sasl',
                mechanism : 'PLAIN',
                $text : auth
            });
            this._setSessionState('sasl-plain-waiting-result');
        }
        else if (this.serverInfo.sasl_support['DIGEST-MD5']) {
            this._connection.writeElement('auth', {
                xmlns : 'urn:ietf:params:xml:ns:xmpp-sasl',
                mechanism : 'DIGEST-MD5'
            });
            this._setSessionState('sasl-digest-md5-waiting-challenge');
        }
        else {
            this._setSessionState('error', 'Server does provide any supported authentication mechanism.');
        }
    },

    _saslDigestMd5RespondChallenge: function _saslDigestMd5RespondChallenge(challenge) {
        challenge = base64.decode(challenge, 'utf-8');
        this._LOG('challenge -> ' + challenge);

        var tokens = challenge.split(/,(?=(?:[^"]|"[^"]*")*$)/);
        challenge = {};
        for each (let token in tokens) {
            token = /(\w+)=["]?([^"]+)["]?$/.exec(token);
            if (token) {
                challenge[token[1]] = token[2];
            }
        }

        if (!challenge.realm || (challenge.realm.split(',').indexOf(this._jid.hostname) === -1)) {
            throw new Error('Invalid realm in DIGEST-MD5 challenge');
        }
        if (!challenge.nonce) {
            throw new Error('Invalid nonce in DIGEST-MD5 challenge');
        }
        if (!challenge.qop || (challenge.qop.split(',').indexOf('auth') === -1)) {
            throw new Error('Invalid qop in DIGEST-MD5 challenge');
        }
        if (!challenge.charset || (challenge.charset.split(',').indexOf('utf-8') === -1)) {
            throw new Error('Invalid charset in DIGEST-MD5 challenge');
        }
        if (!challenge.algorithm || (challenge.algorithm.split(',').indexOf('md5-sess') === -1)) {
            throw new Error('Invalid algorithm in DIGEST-MD5 challenge');
        }

        var res = {
            username: this._jid.username,
            realm: this._jid.hostname,
            qop: 'auth',
            nonce: challenge.nonce,
            cnonce: uuidhash(),
            nc: '00000001',
            //'serv-type': 'xmpp',
            //host: this._hostname,
            'digest-uri': 'xmpp/' + this._hostname,
            charset: 'utf-8',
            maxbuf: challenge.maxbuf || 65536/*,
            authzid: this._jid.full*/
        };

        var y = md5(res.username + ':' + res.realm + ':' + this._password, 'binary');
        var ha1 = md5(y + ':' + res.nonce + ':' + res.cnonce/* + ':' + res.authzid*/, 'hex', true);
        var ha2 = md5('AUTHENTICATE:' + res['digest-uri']);
        res.response = md5(ha1 + ':' + res.nonce + ':' + res.nc + ':' + res.cnonce + ':' + res.qop + ':' + ha2);

        var response = [];
        for (let key in res) {
            response.push(key + '="' + res[key] + '"');
        }
        response = response.join(',');
        this._LOG('response -> ' + response);

        this._connection.writeElement('response', {
            xmlns : 'urn:ietf:params:xml:ns:xmpp-sasl',
            $text: base64.encode(response, 'utf-8')
        });
        this._setSessionState('sasl-digest-md5-waiting-confirm');
    },

    _saslDigestMd5RespondConfirm: function _saslDigestMd5RespondConfirm(challenge) {
        challenge = base64.decode(challenge, 'utf-8');
        if (challenge.indexOf('rspauth=') === -1) {
            throw new Error('Missing rspauth in DIGEST-MD5 response confirmation.');
        }
        this._connection.writeElement('response', {
            xmlns : 'urn:ietf:params:xml:ns:xmpp-sasl',
            $text: '='
        });
        this._setSessionState('sasl-digest-md5-waiting-result');
    },

    _bindResource: function _bindResource() {
        this._assertState('stream-initialized');
        this._setSessionState('resource-binding');
        this.sendStanza('iq', {
            type : 'set',
            bind : {
                xmlns : 'urn:ietf:params:xml:ns:xmpp-bind',
                resource : {
                    $text : this._jid.resource
                }
            },
            onSuccess : this._handleSessionInitResponse,
            onError : this._onConnectionError
        });
    },

    _requestSession : function _requestSession() {
        this._assertState('resource-binding');
        this._setSessionState('session-request');
        this.sendStanza('iq', {
            type : 'set',
            session : {
                xmlns : 'urn:ietf:params:xml:ns:xmpp-session'
            },
            onSuccess : this._handleSessionInitResponse,
            onError : this._onConnectionError
        });
    },

    _requestDiscoInfo : function _requestDiscoInfo() {
        this._assertState('session-request', 'resource-binding');
        this._setSessionState('service-discovery');
        this.sendStanza('iq', {
            type : 'get',
            to: this._jid.hostname,
            query : {
                xmlns : 'http://jabber.org/protocol/disco#info'
            },
            onSuccess : this._handleSessionInitResponse,
            onError : this._onConnectionError
        });
    },

    _handleSessionInitResponse : function _handleSessionInitResponse(response) {
        switch (this._sessionState) {
            case 'resource-binding' :
                let requestResource = this._jid.resource;
                this._setJid(response.bind.jid.$text);
                this._resourceBound = true;

                if (this.serverInfo.requireSession) {
                    this._requestSession();
                } else {
                    this._requestDiscoInfo();
                }
            break;
            case 'session-request' :
                this._requestDiscoInfo();
            break;
            case 'service-discovery' :
                this._handleDiscoInfoResponse(response.query || {});
                this._setSessionState('session-active');
            break;
            default :
                this._setSessionState('error', 'Unexpected response stanza during session initialization.');
        }
    },

    _handleDiscoInfoResponse : function _handleDiscoInfoResponse(query) {
        var identities = this.serverInfo.identities = {};
        var features = this.serverInfo.features = [];

        if (query.identity) {
            if (!Array.isArray(query.identity)) {
                query.identity = [query.identity];
            }
            query.identity.forEach(function(id) {
                //TODO: Support xml:lang attribute for identities
                if (!identities[id.category]) {
                    identities[id.category] = {};
                }
                identities[id.category][id.type] = id.name || true;
            });
        }

        if (query.feature) {
            if (!Array.isArray(query.feature)) {
                query.feature = [query.feature];
            }
            query.feature.forEach(function(ft) {
                features.push(ft['var']);
            });
        }

        Object.freeze(identities);
        for each (let i in identities) {
            Object.freeze(i);
        }
        Object.freeze(features);

        this.emit('discoInfo', identities, features);
    },

    /**
     * Tests whether the server can handle a specific XEP.
     * @link http://xmpp.org/extensions/xep-0030.html
     *
     * @param {string} category
     * @param {string} type
     * @return {boolean}
     */
    serviceAvailable : function serviceAvailable(category, type) {
        if (!this.serverInfo.identities[category]) {
            return false;
        }
        return this.serverInfo.identities[category][type] || false;
    },

    /**
     * Tests whether the server can handle a specific XEP protocol.
     * @link http://xmpp.org/extensions/xep-0030.html
     *
     * @param {string} feature  Usually a protocol URI
     * @return {boolean}
     */
    featureAvailable : function featureAvailable(feature) {
        return (this.serverInfo.features.indexOf(feature) != -1);
    },

    //////// Stanza generation and response ////////

    _initCallbackStanzas : function _initCallbackStanzas() {
        this._callbackStanzas = [];
        this._callbackStanzaTimestamps = new WeakMap();
    },

    _getCallbackStanza : function _getCallbackStanza(id) {
        var expired = Date.now() - STANZA_CALLBACK_TTL;
        for (let i = this._callbackStanzas.length-1; i >= 0; i--) {
            let stanza = this._callbackStanzas[i];
            if (stanza.id == id) {
                this._callbackStanzas.splice(i,1);
                this._callbackStanzaTimestamps['delete'](stanza);
                return stanza;
            }
            if (this._callbackStanzaTimestamps.get(stanza, 0) < expired) {
                this._callbackStanzas.splice(i,1);
                this._callbackStanzaTimestamps['delete'](stanza);
            }
        }
        return null;
    },

    _storeCallbackStanza : function _storeCallbackStanza(stanza) {
        this._callbackStanzas.push(stanza);
        this._callbackStanzaTimestamps.set(stanza, Date.now());
    },

    /**
     * Central handling for all incoming stanzas from XMPPConnection.
     *
     * Stanzas of type "result" and "error" are processed by
     * _handleResponseStanza, while all others are sent to the
     * _handleIncomingStanza method of the implementing sub-trait.
     *
     * If _handleIncomingStanza returns false, a generic error stanza
     * of type "service-unavailable" is returned to the stanza sender.
     *
     * To return a specific error condition, _handleIncomingStanza may
     * also return a string, which must be one of the defined XMPP stanza
     * error conditions, optionally followed by a "|" character and a
     * human readable plaintext explanation of the error condition.
     * @see STANZA_ERROR_CONDITION_TYPES
     */
    _readStanzaElement : function _readStanzaElement(stanza, element) {
        if (element.localName == 'error') {
            this._onConnectionError(stanza, element);
            return;
        }
        stanza.$kind = element.localName;

        if (stanza.type == 'error') {
            this._handleResponseStanza(stanza, element);
            return;
        }
        switch (stanza.$kind) {
            case 'presence' :
            case 'iq' :
                if (stanza.type == 'result') {
                   this._handleResponseStanza(stanza, element);
                   break;
                }
            //no break
            case 'message' :
                if (this._sessionState !== 'session-active') {
                    console.warn('Received ' + stanza.$kind + ' stanza before session initialization is complete.');
                }
                var result = this._handleIncomingStanza(stanza, element);
                //In case Handler returns an error, notify the server
                switch (typeof(result)) {
                    case 'boolean' :
                        if (result) {
                            break;
                        } else {
                            result = 'service-unavailable';
                        }
                    //nobreak;
                    case 'string' :
                        result = result.split('|');
                        if (!STANZA_ERROR_CONDITION_TYPES[result[0]]) {
                            result[0] = 'service-unavailable';
                        }
                        var response = {
                            type : 'error',
                            id : stanza.id,
                            to : stanza.from,
                            $node : element,
                            error : {
                                type : STANZA_ERROR_CONDITION_TYPES[result[0]]
                            }
                        };
                        response.error[result] = {
                            xmlns : 'urn:ietf:params:xml:ns:xmpp-stanzas'
                        };
                        if (result.length > 1) {
                            response.error.text = {
                                xmlns : 'urn:ietf:params:xml:ns:xmpp-stanzas',
                                $text : result[1]
                            }
                        }
                        this.sendStanza(stanza.$kind, response);
                    break;
                }
            break;
            default :
                console.warn('Unknown non-stanza element in XMPP stream: ' + stanza.$kind);
        }
    },

    _handleIncomingStanza: function _handleIncomingStanza() {
        this._setSessionState('error', 'Abstract class ' + this.className + ' cannot handle stanzas.');
    },

    /**
     * All stanza descriptors may contain an onError and onSuccess callback...
     *
     * onError(error, request) will be called if an "error" stanza is
     * received in response to the outgoing stanza.
     *
     * onSuccess(response, request) will be called if a "result" stanza
     * is received in response to the outgoing stanza (typically of type "iq").
     *
     * In both cases, the original outgoing stanza can also be accessed
     * through "this" within the callback, if it hasn't been bound.
     */
    _handleResponseStanza : function _handleResponseStanza(stanza, element) {
        switch (stanza.type) {
            case 'result' :
                if (stanza.id) {
                    let request = this._getCallbackStanza(stanza.id);
                    if (request && request.onSuccess) {
                        request.onSuccess(stanza, request);
                    }
                } else {
                    console.error('Received XMPP result stanza without id.');
                }
            break;
            case 'error' :
                if (!stanza.error) {
                    console.warn('Received XMPP error stanza without error-element.');
                    stanza.error = {};
                }
                let request = null;
                if (stanza.id) {
                    request = this._getCallbackStanza(stanza.id);
                }
                else {
                    //servers should pass the original stanza as subelement of same tag name
                    request = stanza[stanza.$kind];
                    if (request) {
                        stanza.id = request.id;
                    }
                    if (!stanza.id) {
                        console.warn('Received XMPP error stanza without request reference.');
                        break;
                    }
                }
                if (request) {
                    if (request.onError) {
                        request.onError(stanza.error, request);
                    } else {
                        console.warn('Received XMPP error stanza has no handler.');
                    }
                } else {
                    console.warn('Received XMPP error stanza did not match any sent request.');
                }
            break;
            default:
                console.warn('Received XMPP response stanza of unknown type "'+ stanza.type +'"');
        }
    },

    /**
     * Sends a stanza element to the server.
     *
     * Adds a random "id" property if not specified.
     * Adds own full JID as "from" property (if resource already bound).
     *
     * @param {string} stanza_kind  One of "message", "presence", or "iq".
     * @param {object} childNodes   Attributes and children of the stanza.
     * @see jsonToDom()
     *
     * @throws {TypeError} If childNodes contains invalid properties.
     * @throws {Error} If connection not ready; stanza_kind invalid.
     */
    sendStanza : function sendStanza(stanza_kind, childNodes) {
        if (['message','presence','iq'].indexOf(stanza_kind) == -1) {
            throw new Error('Invalid XMPP stanza type: ' + stanza_kind);
        }
        if (!this._connection) {
            throw new Error('Unable to send XMPP stanza. Connection not ready.');
        }
        if (typeof(childNodes) != 'object') {
            throw new TypeError('Invalid childNodes descriptor for XMPP stanza.');
        }

        if (!childNodes.from && this._resourceBound) {
            childNodes.from = this._jid.full;
        }
        if (!childNodes.id) {
            childNodes.id = uuidhash(16);
        }

        if ((childNodes.addresses) && (childNodes.addresses.xmlns === NS_XEP0033)) {
            this._sendMulticastStanza(stanza_kind, childNodes);
        } else {
            this._connection.writeElement(stanza_kind, childNodes);
        }

        childNodes.$kind = stanza_kind; //for echo (make outgoing exactly like incoming)

        if (childNodes.onSuccess || childNodes.onError) {
            this._storeCallbackStanza(childNodes);
        }

    },

    /**
     * Sends a stanza with XEP-0033 multicast recipients.
     * (Emulated if not natively supported by the server.)
     *
     * @param {string} stanza_kind  Either "message" or "presence".
     * @param {object} childNodes   Attributes and children of the stanza.
     */
    _sendMulticastStanza: function _sendMulticastStanza(stanza_kind, childNodes) {
        var addresses = childNodes.addresses.address;
        if (!addresses) { return; } //simply skip if no recipients
        if (Array.isArray(addresses)) {
            if (!addresses.length){ return; }
        } else {
            addresses = [addresses];
        }

        if (this.featureAvailable(NS_XEP0033)) {
            childNodes.to = this._jid.hostname;
            this._connection.writeElement(stanza_kind, childNodes);
            return;
        }

        var origTo = childNodes.to;
        for each (let address in addresses) {
            address.delivered = 'true';
        }
        for each (let address in addresses) {
            childNodes.to = address.jid;
            this._connection.writeElement(stanza_kind, childNodes);
        }
        childNodes.to = origTo;
    }

});
exports.XMPPSession = XMPPSession;
