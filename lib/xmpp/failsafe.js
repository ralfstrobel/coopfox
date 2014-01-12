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

const { Class } = require('sdk/core/heritage');
const { XMPPClient } = require('./client');
const { parseJid } = require('./session');
const { EventHub } = require('../utils/events');
const { setTimeout, clearTimeout } = require('sdk/timers');

/**
 * A wrapper class for the basic XMPPClient, which handles
 * disconnects and other errors gracefully, by queuing
 * undelivered messages and automatically trying to create
 * a new connection whenever the existing one is destroyed.
 */
const XMPPFailsafeClient = Class({
    extends: EventHub,
    className: 'XMPPFailsafeClient',

    /**
     * @param {object} options
     *      Any constructor options for XMPPClient.
     *      Note that you cannot subscribe to any events
     *      before and after the client is connected.
     */
    initialize: function initialize(options) {
        this._options = options;
        this._eventForwards = { init: false, destroy: false, beforeDestroy: false };
        this._missedCalls = [];
        this._xmpp = null;
        this._loginValid = false;
        this.xmppConnected = false;
        this._offlineMode = false;
        this._connectOnceOnline = false;

        this.serverInfo = {};
        this.roster = {};
        this.rosterSelf = {};
        if (options.jid) {
            this.rosterSelf.jid = parseJid(options.jid);
        }

        //subscribes and removes any listeners from options
        EventHub.prototype.initialize.apply(this, arguments);
        console.info('XMPPFailsafeClient available.');

        if ('autoConnect' in options) {
            let autoConnect = options.autoConnect;
            delete options.autoConnect;
            if (autoConnect) {
                this.connect();
            }
        }
    },

    /**
     * Sets or replaces options for the connection and reconnects if necessary.
     * This can be used to set new login details, for instance.
     *
     * @param {object} options
     * @param {bool} noReconnect
     */
    setOptions: function setOptions(options, noReconnect) {
        for (let key in options) {
            this._options[key] = options[key];
        }
        if (options.jid && !this.rosterSelf.jid) {
            this.rosterSelf.jid = options.jid ? parseJid(options.jid) : {};
        }
        if (this.xmppConnected && !noReconnect) {
            this.reconnect();
        }
    },

    /**
     * @returns {boolean}
     */
    hasLogin: function hasLogin() {
        return (this._options.jid && this._options.password);
    },

    /**
     * Defines a new client feature according to XEP-0115 and reconnects if connected.
     *
     * @param {string} feature
     */
    addClientFeature: function addClientFeature(feature) {
        if (!Array.isArray(this._options.features)) {
            this._options.features = [];
        }
        this._options.features.push(feature);
        if (this.xmppConnected) {
            this.reconnect();
        }
    },

    /**
     * Establishes the actual XMPP connection if it doesn't exist already.
     *
     * @param {number}  delay  Optional wait period before connect.
     * @param {boolean} quiet  Do not prompt for login, unless necessary.
     */
    connect: function connect(delay, quiet) {
        if (this._connectTimeout) {
            clearTimeout(this._connectTimeout);
            delete this._connectTimeout;
        }
        if (this._offlineMode) {
            this._connectOnceOnline = true;
            return;
        }
        if (this._xmpp === null) {
            if (delay) {
                this._connectTimeout = setTimeout(this.connect, delay);
            } else {
                if (this.countListeners('loginRequired') > 0) {
                    //Always give subscribers a chance to update login dynamically
                    if (!quiet || !this.hasLogin()) {
                        this.emit('loginRequired');
                    }
                    if (!this.hasLogin()) {
                        console.warn('Failed to acquire login using "loginRequired" event.');
                        return;
                    }
                } else {
                    if (!this.hasLogin()) {
                        throw new Error('Cannot connect before login details have been defined.');
                    }
                }
                this._options.onceClientOnline = this._onXMPPConnected;
                this._options.onSessionError = this._onXMPPError;
                //this._options.onDestroy = this._onXMPPError;
                this.emit('xmppConnect', this._options);
                this._xmpp = new XMPPClient(this._options);
            }
        }
    },

    /**
     * Manually closes the connection (will not reconnect automatically!).
     */
    disconnect: function disconnect() {
        if (this._connectTimeout) {
            clearTimeout(this._connectTimeout);
            delete this._connectTimeout;
        }
        if (this._offlineMode) {
            this._connectOnceOnline = false;
        }
        if (this._xmpp instanceof XMPPClient) {
            this._xmpp.destroy();
            this._xmpp = null;
        }
        this._setDisconnected();
    },

    /**
     * Forces a manual reconnect.
     */
    reconnect: function reconnect() {
        this.disconnect();
        this.connect(500);
    },

    /**
     * Dummy replacement for XMPPClient
     */
    isConnected : function isConnected() {
        return this.xmppConnected;
    },

    /**
     * Dummy replacement for XMPPClient
     */
    isReady : function isReady() {
        return true;
    },

    /**
     * Remembers the current connection state and disconnects.
     * The previous state can be restored through _leaveOfflineMode().
     *
     * Intermediate calls to connect() or disconnect() have no direct effect,
     * but they determine whether the connection will be restored.
     */
    _enterOfflineMode: function _enterOfflineMode() {
        if (!this._offlineMode) {
            this._connectOnceOnline = this.xmppConnected;
            this.disconnect();
            this._offlineMode = true;
        }
    },

    /**
     * @see _enterOfflineMode()
     */
    _leaveOfflineMode: function _leaveOfflineMode(delay) {
        if (this._offlineMode) {
            this._offlineMode = false;
            if (this._connectOnceOnline) {
                this.connect(delay);
            }
        }
    },

    /**
     * @see XMPPSession
     */
    serviceAvailable : function serviceAvailable(category, type) {
        if (!this.serverInfo || !this.serverInfo.identities[category]) {
            return false;
        }
        return this.serverInfo.identities[category][type] || false;
    },

    /**
     * @see XMPPSession
     */
    featureAvailable : function featureAvailable(feature) {
        if (!this.serverInfo) {
            return false;
        }
        return (this.serverInfo.features.indexOf(feature) != -1);
    },

    _setConnected: function _setConnected() {
        if (!this.xmppConnected) {
            this.xmppConnected = true;
            this.emit('xmppConnected');
            for each (let item in this.roster) {
                this.emit('rosterItemUpdate', item, 'item');
            }
            this.emit('rosterUpdate');
        }
    },

    _setDisconnected: function _setDisconnected() {
        if (this.xmppConnected) {
            this.xmppConnected = false;
            var args = Array.slice(arguments);
            args.unshift('xmppDisconnected');
            this.emit.apply(this, args);
            for each (let item in this.roster) {
                item.presence = { $primary : { type : 'unavailable', c: { node: 'unknown', ver: null } } };
                this.emit('rosterItemUpdate', item, 'presence');
            }
            this.emit('rosterUpdate');
        }
    },

    _addEventForward: function _addEventForward(type) {
        if (typeof(this._eventForwards[type]) === 'undefined') {
            var fw = this._eventForwards[type] = this.emit.bind(this, type);
            if (this.xmppConnected) {
                this._xmpp.on(type, fw);
            }
        }
    },

    _restoreEventForwards: function _restoreEventForwards() {
        for (let type in this._eventForwards) {
            let listener = this._eventForwards[type];
            if (typeof(listener) === 'function') {
                this._xmpp.on(type, this._eventForwards[type]);
            }
        }
    },

    on: function on(type, listener) {
        this._addEventForward(type);
        EventHub.prototype.on.apply(this, arguments);
    },
    once: function once(type, listener) {
        this._addEventForward(type);
        EventHub.prototype.once.apply(this, arguments);
    },

    __noSuchMethod__: function __noSuchMethod__(id, args) {
        if (this.xmppConnected) {
            if (typeof(this._xmpp[id]) !== 'function') {
                throw new Error('XMPPClient.' + id + ' is not a function.');
            }
            return this._xmpp[id].apply(this._xmpp, args);
        } else {
            this._missedCalls.push({ id: id, args: args });
            return null;
        }
    },

    _deliverMissedCalls: function _deliverMissedCalls() {
        while (this._missedCalls.length > 0) {
            let call = this._missedCalls.shift();
            this._xmpp[call.id].apply(this._xmpp, call.args);
        }
    },

    _onXMPPConnected: function _onXMPPConnected() {
        this.serverInfo = this._xmpp.serverInfo;
        this.roster = this._xmpp.roster;
        this.rosterSelf = this._xmpp.rosterSelf;
        this._loginValid = true;

        this._restoreEventForwards();
        this._deliverMissedCalls();

        this._setConnected();
    },

    /**
     * Handler for connection losses and failures.
     */
    _onXMPPError: function _onXMPPError() {
        if (this._xmpp === null) {
            return;
        }
        this._xmpp = null; //client will self-destroy on error
        var wasConnected = this.xmppConnected;
        this._setDisconnected.apply(this, arguments);

        var args = Array.slice(arguments);
        if (wasConnected) {
            console.warn('XMPP connection lost.');
            args.unshift('xmppConnectionLost');
        } else {
            console.warn('XMPP connection failed.');
            args.unshift('xmppConnectionFailed');
        }
        this.emit.apply(this, args);
    },

    _destroyXMPP: function _destroyXMPP() {
        this.disconnect();
        this.roster = {};
        this.rosterSelf = {};
    },

    _initSystemEvents: function _initSystemEvents() {
        this.sysOn('network:offline-about-to-go-offline', this._onSystemEvent, true);
        this.sysOn('network:offline-status-changed', this._onSystemEvent, true);
        this.sysOn('sleep_notification', this._onSystemEvent, true);
        this.sysOn('wake_notification', this._onSystemEvent, true);
    },

    _onSystemEvent: function _onSystemEvent(event) {
        switch(event.type) {
            case 'network:offline-about-to-go-offline':
                console.log('Network about to go offline...');
                this._enterOfflineMode();
            break;
            case 'network:offline-status-changed':
                console.log('Network status: ' + event.data);
                switch (event.data) {
                    case 'online':
                        this._leaveOfflineMode();
                    break;
                    case 'offline':
                        this._enterOfflineMode();
                    break;
                }
            break;
            case 'sleep_notification':
                console.log('System standby...');
                this._enterOfflineMode();
            break;
            case 'wake_notification':
                console.log('System wakeup...');
                this._leaveOfflineMode(3000);
            break;
        }
    },

    _destroySystemEvents: function _destroySystemEvents() {
        this.sysOff('network:offline-about-to-go-offline', this._onSystemEvent);
        this.sysOff('network:offline-status-changed', this._onSystemEvent);
        this.sysOff('sleep_notification', this._onSystemEvent);
        this.sysOff('wake_notification', this._onSystemEvent);
    }

});
exports.XMPPFailsafeClient = XMPPFailsafeClient;