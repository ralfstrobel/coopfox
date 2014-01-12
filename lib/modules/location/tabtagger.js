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
const { EventHub } = require('../../utils/events');
const { WindowTabsMonitor } = require('../../browser/tabs');

const imageUrl = require('sdk/self').data.url('images/');

/**
 * Attaches to the tabs of a browser window and marks them
 * with the coopfox icon if they have related messages.
 *
 * @param {object} options
 * - {WindowTabsMonitor} tabs  The underlying tabs monitor (required).
 */
const TabTagger = Class({
    extends: EventHub,
    className: 'TabTagger',

    initialize: function initialize(options) {
        if (!(options.tabs instanceof WindowTabsMonitor)) {
            throw new TypeError('TabTagger requires an instance of WindowTabsMonitor to operate');
        }
        this.tabs = options.tabs;
        this._hasUnreadMessages = {}; //urlhash > bool
        this._lastMessageSender = {}; //urlhash > jid
        this._colors = {}; // jid > color

        EventHub.prototype.initialize.apply(this, arguments);

        this.subscribeTo(this.tabs, 'documentReady');
        this.subscribeTo(this.tabs, 'documentActivate');
        this.subscribeTo(this.tabs, 'documentUnload');
    },

    _destroySubscriptions: function _destroySubscriptions() {
        for each (let doc in this.tabs.getAllDocs()) {
            this._onDocumentUnload(doc);
        }
        this.tabs = null;
    },

    defineColor: function defineColor(jid, color) {
        this._colors[jid] = color;
    },

    registerMessage: function registerMessage(urlhash, jid) {
        this._lastMessageSender[urlhash] = jid;
        if (this.tabs.activeUrlHash !== urlhash) {
            this._hasUnreadMessages[urlhash] = true;
        }
        for each (let doc in this.tabs.getDocsForUrl(urlhash, true)) {
            this._refreshTabForDoc(doc, urlhash);
        }
    },

    _onDocumentReady: function _onDocumentReady(doc) {
        this._refreshTabForDoc(doc, this.tabs.getUrlHashForDoc(doc));
    },

    _onDocumentActivate: function _onDocumentActivate(doc) {
        if (!doc) { return; }
        var urlhash = this.tabs.getUrlHashForDoc(doc);
        delete this._hasUnreadMessages[urlhash];
        this._refreshTabForDoc(doc, urlhash);
    },

    _refreshTabForDoc: function _refreshTabForDoc(doc, urlhash) {
        var tab = this.tabs.getXULTabForDoc(doc);

        var color = this._colors[this._lastMessageSender[urlhash]];
        if (color) {
            tab.style.setProperty('color', color, 'important');
        }
        if (urlhash in this._hasUnreadMessages) {
            tab.style.setProperty('font-weight', 'bold', 'important');
            tab.style.setProperty('font-style', 'italic', 'important');
        } else {
            tab.style.setProperty('font-weight', 'normal', 'important');
            tab.style.setProperty('font-style', 'normal', 'important');
        }
    },

    _onDocumentUnload: function _onDocumentUnload(doc) {
        try {
            var tab = this.tabs.getXULTabForDoc(doc);
            if (tab) {
                tab.style.removeProperty('color');
                tab.style.removeProperty('font-weight');
            }
        }
        catch (e) {
            console.warn(e.message);
        }
    }

});
exports.TabTagger = TabTagger;

