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

const { TEXT_NODE, ELEMENT_NODE } = require('chrome').Ci.nsIDOMNode;

const { Namespace } = require('sdk/core/namespace');
const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { WindowTabsMonitor } = require('../../browser/tabs');

const { setTimeout, clearTimeout } = require('sdk/timers');
const { urlHash } = require('../../utils/urls');
const { getOffsetRect } = require('../../utils/dhtml');
const contentStyles = require('sdk/self').data.url('modules/location/content.css');

const validLinkPattern = /[A-Za-z]/; //contain at least one character

/**
 * Attaches to the tabs of a browser window and marks links
 * which have already been visited by a participant.
 *
 * @param {object} options
 * - {WindowTabsMonitor} tabs  The underlying tabs monitor (required).
 */
const LinkTagger = Class({
    extends: EventHub,
    className: 'LinkTagger',

    initialize: function initialize(options) {
        if (!(options.tabs instanceof WindowTabsMonitor)) {
            throw new TypeError('LinkTagger requires an instance of WindowTabsMonitor to operate');
        }
        this.tabs = options.tabs;
        this._styles = new WeakMap(); // document > nsIDOMElement[] (<style>)
        this._tags = new WeakMap(); // document > nsIDOMElement[] (<span>)
        this._visits = {}; // urlhash > jid[]
        this._messages = {}; // urlhash > jid[]
        this._colors = {}; // jid > color

        this._refreshTimeout = null;

        this._linkCandidateCache = new WeakMap(); // nsiDOMElement > bool

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

    _destroyTimeout: function _destroyTimeout() {
        this._refreshDisabled = true;
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
            this._refreshTimeout = null;
        }
    },

    defineColor: function defineColor(jid, color) {
        this._colors[jid] = color;
    },

    registerVisit: function registerVisit(urlhash, jid) {
        var visits = this._visits[urlhash];
        if (!visits) {
            visits = this._visits[urlhash] = {};
        }
        if (visits[jid]) { return; }
        visits[jid] = true;
        this.invalidate(100);
    },

    registerMessage: function registerMessage(urlhash, jid) {
        var messages = this._messages[urlhash];
        if (!messages) {
            messages = this._messages[urlhash] = {};
        }
        if (messages[jid]) { return; }
        messages[jid] = true;
        this.invalidate(100);
    },

    invalidate: function invalidate(refreshDelay) {
        if (this._refreshDisabled) { return; }
        if (this._refreshTimeout) {
            clearTimeout(this._refreshTimeout);
        }
        this._refreshTimeout = setTimeout(this._documentRefresh, refreshDelay || 500);
    },

    _onDocumentReady: function _onDocumentReady(doc) {
        var styles = doc.createElement('link');
        styles.rel = 'stylesheet';
        styles.type = 'text/css';
        styles.href = contentStyles;
        doc.querySelector('head').appendChild(styles);
        this._styles.set(doc, styles);
        if (this.tabs.isActiveDoc(doc)) {
            this.invalidate();
        }
    },

    _onDocumentActivate: function _onDocumentActivate(doc) {
        if (doc) {
            this.invalidate();
        }
    },

    _documentReset: function _documentReset(doc) {
        var tags = this._tags.get(doc, []);
        for each (let tag in tags) {
            tag.parentNode.removeChild(tag);
        }
        this._tags.set(doc, []);
    },

    _checkIsLinkCandidate: function _checkIsLinkCandidate(link) {
        if (!validLinkPattern.test(link.textContent)) {
            return false;
        }
        return true;
    },

    _isLinkCandidate: function _isLinkCandidate(link) {
        var result = this._linkCandidateCache.get(link, null);
        if (result === null) {
            result = this._checkIsLinkCandidate(link);
            this._linkCandidateCache.set(link, result);
        }
        return result;
    },

    _documentRefresh: function _documentRefresh() {
        this._refreshTimeout = null;
        var doc = this.tabs.activeDoc;
        if (!doc) { return; }
        this._documentReset(doc);
        var tags = this._tags.get(doc);

        var docUrl = doc.URL;
        var docUrlFragPos = docUrl.indexOf('#');
        if (docUrlFragPos !== -1) {
            docUrl = docUrl.substr(0, docUrlFragPos);
        }
        var fragmentBaseUrl = docUrl + '#';

        var body = doc.querySelector('body');
        var links = doc.getElementsByTagName('a');

        for (let i = 0; i < links.length; i++) {
            let link = links[i];
            if (!this._isLinkCandidate(link)) { continue; }
            if (!link.href || (link.href === docUrl) || (link.href.indexOf(fragmentBaseUrl) === 0)) {
                //self-referencing link
                this._linkCandidateCache.set(link, false);
                continue;
            }

            let urlhash = urlHash(link.href);
            let visits = this._visits[urlhash];
            let messages = this._messages[urlhash];
            if (!visits && !messages) { continue; }

            let tag = doc.createElement('span');
            tag.classList.add('coopfox-link-history');
            let offset = getOffsetRect(link);
            if ((offset.top === 0) && (offset.left === 0)) {
                this._linkCandidateCache.set(link, false);
                continue;
            }
            tag.style.top = (offset.top - 5) + 'px';
            tag.style.left = (offset.left + link.offsetWidth + 1) + 'px';
            for (let jid in visits) {
                let visit = doc.createElement('span');
                visit.classList.add('coopfox-link-visited');
                visit.style.setProperty('color', this._colors[jid] || '#000', 'important');
                tag.appendChild(visit);
            }
            for (let jid in messages) {
                let message = doc.createElement('span');
                message.classList.add('coopfox-link-messages');
                message.style.setProperty('color', this._colors[jid] || '#000', 'important');
                tag.appendChild(message);
            }
            body.appendChild(tag);
            tags.push(tag);
        }
    },

    _onDocumentUnload: function _onDocumentUnload(doc) {
        try {
            this._documentReset(doc);
            var styles = this._styles.get(doc, null);
            if (styles) {
                styles.parentNode.removeChild(styles);
            }
        }
        catch (e) {
            console.warn(e.message);
        }
    }

});
exports.LinkTagger = LinkTagger;

