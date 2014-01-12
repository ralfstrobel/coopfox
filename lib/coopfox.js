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

const NODE_COOPFOX = exports.NODE_COOPFOX = 'http://coopfox.net';
const NS_COOPFOX = exports.NS_COOPFOX = 'http://coopfox.net/xmpp/namespace';

const { Ci } = require('chrome');
const { Class } = require('sdk/core/heritage');
const { EventHub } = require('./utils/events');
const { XMPPMultiUserThread } = require('./xmpp/multiuser');
const { Sidebar } = require('./browser/sidebar');
const { WindowTabsMonitor } = require('./browser/tabs');
const { setWindowValue, getWindowValue, deleteWindowValue } = require('./browser/windows');

/**
 * Central management class for the extension.
 * Instantiates XMPP, UI frames and browser content integration.
 * Notifies modules of creation
 *
 * @constructor
 * @param {object} options
 *  - window : The browser window (nsIDOMWindow) target for UI / content.
 *  - jid      : A valid bare JID (username@hostname) for XMPP.
 *  - password : The XMPP login password for jid.
 *  - security : XMPP connection security (defaults to none)
 *
 *  - onNotify : function(title, text) to receive user notifications.
 *  - onDestroy : function() to call if the connection is terminated by user / error.
 */
const CoopFox = Class({
    extends: EventHub,
    className: 'CoopFox',

    //TODO: provide constructors to common classes and common utility functions (dependency injection container)

    //provide constants for modules
    NS_COOPFOX: NS_COOPFOX,
    NODE_COOPFOX: NODE_COOPFOX,

    initialize: function initialize(options) {
        if (!(options.window instanceof Ci.nsIDOMWindow)) {
            throw new TypeError('Undefined window for new CoopFox session.');
        }
        if (!(options.xmpp instanceof XMPPMultiUserThread)) {
            throw new TypeError('Undefined XMPP thread for new CoopFox session.');
        }
        this.window = options.window;
        this.xmpp = options.xmpp;

        this.sidebar = new Sidebar(options.window);
        this.browser = new WindowTabsMonitor({ window: options.window, enabled: false });

        EventHub.prototype.initialize.apply(this, arguments); //calls _init*

        //signal modules to inject their functionality
        this.sysEmit('coopfox-init');

        this.sidebar.activate();
    },

    _initListeners: function _initListeners() {
        this.subscribeTo(this.xmpp, 'syncIdle', this._onComponentReady, true);
        this.subscribeTo(this.sidebar, 'rosterReady', this._onComponentReady, true);
        this.subscribeTo(this.sidebar, 'panelReady', this._onComponentReady, true);
        this.sidebar.subscribeTo(this, 'afterComponentsReady');
    },

    _onComponentReady: function _onComponentReady() {
        if (this._initDone) { return; }
        if (
            this.xmpp.isSyncIdle &&
            this.sidebar.roster.isReady() &&
            this.sidebar.panel.isReady()
        ) {
            this._onceComponentsReady();
            this.emit('beforeComponentsReady');
            this.emit('componentsReady');
            this.emit('afterComponentsReady');
            this.rosterRefresh('init');
            this.browser.enable();
            this.sysEmit('coopfox-init-done');
            this._initDone = true;
            this._onBeginImportMessages();
            this.xmpp.replayMessages(); //incomingMessage might not have had subscribers
            this._onFinishedImportMessages();
            for each (let jid in this.xmpp.getParticipants()) {
                this._onRosterItemUpdate(this.xmpp.roster[jid], 'participantActive');
            }
            this.emit('ready');
            this.window.getAttention();
        }
    },

    _onceComponentsReady: function _onceComponentsReady() {
        var xmpp = this.xmpp;
        var sidebar = this.sidebar;
        var browser = this.browser;

        this.subscribeTo(xmpp, 'rosterItemUpdate');
        this.subscribeTo(xmpp, 'beginImportMessages');
        this.subscribeTo(xmpp, 'finishedImportMessages');

        this.subscribeTo(sidebar.roster.port, 'linkClick', this._onRosterLinkClick);
        this.subscribeTo(sidebar.panel.port, 'linkClick', this._onPanelLinkClick);
        this.subscribeTo(sidebar.panel.port, 'tabHighlight', this._panelTabHighlight);
        this.subscribeTo(sidebar, 'close', this.destroy, true);
    },

    _onRosterLinkClick: function _onRosterLinkClick(url, newTab) {
        this.browser.openUrl(url, newTab, 'roster-link-click');
    },
    _onPanelLinkClick: function _onPanelLinkClick(url, newTab) {
        this.browser.openUrl(url, newTab, 'panel-link-click');
    },

    /**
     * Forces a refresh / repaint of all roster items.
     *
     * All arguments passed to this function will be
     * passed along as arguments to each item update.
     */
    rosterRefresh: function rosterRefresh() {
        var list = [];
        for each (let contact in this.xmpp.roster) {
            list.push(contact);
        }
        var args = Array.slice(arguments);
        for each (let item in list) {
            args.unshift(item);
            this._onRosterItemUpdate.apply(this, args);
            args.shift();
        }
    },

    _onRosterItemUpdate : function _onRosterItemUpdate(item, reason) {
        console.info('Roster update for "' + item.jid.bare + '" (' + reason + ')');
        var args = {
            contact: item,
            reason: reason || 'item'
        };

        try {
            this.emit('beforeRosterUpdate', args);
            this.sidebar.roster.port.emit('rosterUpdate', args);
            this.sidebar.panel.port.emit('rosterUpdate', args);
            this.emit('afterRosterUpdate', args);
        } catch (e) {
            console.exception(e);
        }

        //send "ready" message to each new contact we see online
        //other clients should respond to this by sending us
        //any transient status upates about themselves
        if (reason === 'participantActive') {
            this.xmpp.sendMessage({
                to: item.jid.full,
                type: 'headline',
                coopfox: {
                    ready: {}
                },
                $noEcho: true
            });
        }
    },

    _onBeginImportMessages: function _onBeginImportMessages() {
        try {
            this.sidebar.panel.port.emit('beginBulkUpdate');
        } catch (e) {
            console.exception(e);
        }
    },
    _onFinishedImportMessages: function _onFinishedImportMessages() {
        try {
            this.sidebar.panel.port.emit('endBulkUpdate');
        } catch (e) {
            console.exception(e);
        }
    },

    _panelTabHighlight: function _panelTabHighlight() {
        this.window.getAttention();
    },

    setSessionValue: function setSessionValue(key, value) {
        //console.info('Set session value: ' + key + '[' + value + ']');
        setWindowValue(this.window, 'coopfox-' + key, value)
    },

    getSessionValue: function getSessionValue(key, defaultValue) {
        //console.info('Get session value: ' + key);
        return getWindowValue(this.window, 'coopfox-' + key, defaultValue);
    },

    deleteSessionValue: function deleteSessionValue(key) {
        //console.info('Delete session value: ' + key);
        deleteWindowValue(this.window, 'coopfox-' + key);
    },

    _destroyComponents: function _destroyComponents() {
        this.browser.destroy();
        this.browser = null;
        this.xmpp.destroy(this._destroyReason);
        this.xmpp = null;
        this.sidebar.destroy();
        this.sidebar = null;
        this.window = null;
    },

    destroy: function destroy(reason) {
        this.sysEmit('coopfox-shutdown');
        this._destroyReason = reason;
        EventHub.prototype.destroy.call(this);
    }

});
exports.CoopFox = CoopFox;
