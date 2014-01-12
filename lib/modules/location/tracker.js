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

const { cleanUrl, urlHash } = require('../../utils/urls');
const { setTimeout, clearTimeout } = require('sdk/timers');

const mutationObservers = new WeakMap();

/**
 * Attaches to the tabs of a browser window and automatically generates a
 * descriptor object for the active documents location whenever it changes.
 *
 * The descriptor contains information about the url, title and content (*not implemented*).
 * Alternatively, an obfuscated descriptor can be obtained, containing only comparable hashes.
 *
 * @param {object} options
 *
 * - {WindowTabsMonitor} tabs  The underlying tabs monitor (required).
 *
 * - {function} onActiveDocumentChange     Called whenever the active tab or its content changes
 * - {function} onActiveDocumentModified   Called whenever the DOM of the active document is dynamically altered
 */
const WebLocationTracker = Class({
    extends: EventHub,
    className: 'WebLocationTracker',

    get activeDocInfoObfuscated() {
        if (!this.activeDocInfo) {
            return null;
        }
        return {
            urlhash: this.activeDocInfo.urlhash/*,
            contenthash: this.activeDocInfo.contenthash*/
        };
    },

    initialize: function initialize(options) {
        if (!(options.tabs instanceof WindowTabsMonitor)) {
            throw new TypeError('WebLocationTracker requires an instance of WindowTabsMonitor to operate');
        }
        this.activeDocInfo = null;
        this.tabs = options.tabs;

        EventHub.prototype.initialize.apply(this, arguments);

        this._mutationTimeout = null;

        this.subscribeTo(this.tabs, 'documentReady');
        this.subscribeTo(this.tabs, 'documentUnload');
        this.subscribeTo(this.tabs, 'documentActivate');
    },

    _destroySubscriptions: function _destroySubscriptions() {
        for each (let doc in this.tabs.getAllDocs()) {
            this._onDocumentUnload(doc);
        }
        this.tabs = null;
    },

    _onDocumentReady: function _onDocumentReady(doc) {
        if (this._mutationTimeout) {
            clearTimeout(this._mutationTimeout);
        }
        var observer = new doc.defaultView.MutationObserver(this._onDocumentMutation);
        observer.observe(doc.body, {
            attributes : true,
            childList : true,
            subtree : true,
            characterData : false
        });
        mutationObservers.set(doc, observer);
        doc.defaultView.addEventListener('hashchange', this._onFragmentChange, false);
    },

    _onDocumentUnload: function _onDocumentUnload(doc) {
        if (this._mutationTimeout) {
            clearTimeout(this._mutationTimeout);
        }
        try {
            var observer = mutationObservers.get(doc, null);
            if (observer) {
                observer.disconnect();
                mutationObservers.delete(doc);
            }
            doc.defaultView.removeEventListener('hashchange', this._onFragmentChange, false);
        }
        catch (e) {
            console.warn(e.message);
        }
    },

    buildDocInfo: function buildDocInfo(url, title, icon) {
        if (!icon) {
            icon = url.replace(/^.*?:\/\/([^\/]*).*$/, 'http://$1/favicon.ico');
        }
        var info = {
            url : cleanUrl(url),
            urlhash: urlHash(url),
            icon: icon
        };
        if (title) {
            info.title = title;
        }
        return info;
    },

    _onDocumentActivate: function _onDocumentActivate(doc) {
        if (this._mutationTimeout) {
            clearTimeout(this._mutationTimeout);
        }
        var newInfo = null;
        var oldInfo = this.activeDocInfo;

        if (doc) {
            let ico = doc.querySelector('link[rel="shortcut icon"][href]');
            newInfo = this.buildDocInfo(doc.defaultView.location.href, doc.title, ico ? ico.href : null);
            newInfo.source = 'page';
            //newInfo.contenthash = this.getDocumentHash(doc);

            if (this.activeDocInfo !== null) {
                let change = false;
                for (let key in newInfo) {
                    if (newInfo[key] !== oldInfo[key]){
                        change = true;
                    }
                }
                if (!change) { return; }
            }
        } else {
            if (this.activeDocInfo === null) { return; }
        }

        this.activeDocInfo = newInfo;
        this.emit('activeDocumentChange', newInfo, oldInfo);
    },

    _onDocumentMutation : function _onDocumentMutation(mutations) {
        if (!mutations.length) { return; }

        var doc = mutations[0].target.ownerDocument;
        if (!this.tabs.isActiveDoc(doc)) { return; }

        var validChanges = false;
        for (let i = 0; i < mutations.length; i++) {
            let mutation = mutations[i];
            if (mutation.target.className && (mutation.target.className.indexOf('coopfox') !== -1)) {
                return;
            }
            if (mutation.type === 'attributes') {
                validChanges = true;
                break;
            }

            if (mutation.addedNodes) {
                for (let j = 0; j < mutation.addedNodes.length; j++) {
                    let node = mutation.addedNodes[j];
                    if (node.className && (node.className.indexOf('coopfox') !== -1)) {
                        return;
                    }
                    if (node.textContent.trim().length) {
                        validChanges = true;
                        break;
                    }
                }
            }

            if (mutation.removedNodes) {
                for (let j = 0; j < mutation.removedNodes.length; j++) {
                    let node = mutation.removedNodes[j];
                    if (node.className && (node.className.indexOf('coopfox') !== -1)) {
                        return;
                    }
                    if (node.textContent.trim().length) {
                        validChanges = true;
                        break;
                    }
                }
            }
        }
        if (!validChanges) { return; }

        var self = this;
        if (this._mutationTimeout) {
            clearTimeout(this._mutationTimeout);
        }
        this._mutationTimeout = setTimeout(function() {
            self._mutationTimeout = null;
            self.emit('activeDocumentModified', doc);
            self._onDocumentActivate(doc);
        }, 150);
    },

    _onFragmentChange: function _onFragmentChange(event) {
        this._onDocumentActivate(event.currentTarget.document);
    }

    /*getDocumentHash : function getDocumentHash(doc) {
        var hash = this.tabs.getDocumentValue(doc, 'hash');
        if (!hash) {
            hash = smartHash(doc);
            this.tabs.setDocumentValue(doc, 'hash', hash);
        }
        return hash;
    }*/

});
exports.WebLocationTracker = WebLocationTracker;

/**
 * Realtime detection of block elements through style proofed unreliable
 * because too many sites set semantic inline elements to "block".
 *
 * Tests also showed that H[1-6] and P elements should be treated as inline,
 * to detect text fragments as whole blocks even if they are short
 *
 * TODO: User should be allowed to change HASH_BLOCK_MIN_CHARS / HASH_LI_MIN_CHARS in settings.
 */
const HASH_BLOCK_ELEMENTS = ['div','ul','ol','dl','dd','dt','table',
    'blockquote','pre','article','section','figure'];

const HASH_TAG_EXCLUDE = ['br','hr','img','form','input','button','textarea','footer','nav','aside',
    'iframe','object','embed','applet','video','audio','canvas','map',
    'script','noscript','style','frameset','noframes'];

const HASH_BLOCK_MIN_CHARS = 60;
const HASH_LI_MIN_CHARS = 120;
const HASH_BLOCK_CLASS_ID_EXCLUDE = /user|admin|menu|navigation|nav$|^nav|foot|button|edit|select|alert|error|warn|chat/i;

const { nsIDOMNode } = require('chrome').Ci;
const { TEXT_NODE, ELEMENT_NODE } = nsIDOMNode;

/**
 * Calculates a 32-character hex string representing the main
 * content of a DOM document. Tries to exclude navigational
 * and personalized elements, making two documents comparable
 * even if they were requested by different users.
 *
 * @param  {object} document An instance of nsIDOMDocument.
 * @return {string} The hash string.
 */
function smartHash(document) {

    var window = document.defaultView;

    /**
     * Recursively traverses a DOM tree (post-order)
     * and returns the contatenated visible text of all elements.
     *
     * Skips elements according to the filter criteria...
     * - All non-visible elements
     * - All element types in HASH_TAG_EXCLUDE
     * - All elements where class or id maches HASH_CLASS_ID_EXCLUDE
     * - Block elements which contain less than HASH_BLOCK_MIN_CHARS characters,
     *   unless they appear in HASH_BLOCK_MIN_CHARS_IGNORE.
     *
     * @param  {object} node An instance of nsIDOMNode
     * @return {string} The text content within the subtree of "node".
     */
    function getConcat(node) {

        switch (node.nodeType) {

            case TEXT_NODE:
                return node.nodeValue;

            case ELEMENT_NODE:

                var tagName = node.tagName.toLowerCase();

                if (HASH_TAG_EXCLUDE.indexOf(tagName) != -1) {
                    return '';
                }

                var style = window.getComputedStyle(node, null);

                if (style.getPropertyValue('display') == 'none') {
                    return '';
                }
                if (style.getPropertyValue('visibility') == 'hidden') {
                    return '';
                }
                if (style.getPropertyValue('position') == 'fixed') {
                    return '';
                }

                if (node.className.indexOf(CLASS_IGNORE_INTERNAL) != '-1') {
                    return '';
                }

                var content = '';

                for (let child = node.firstChild; child instanceof nsIDOMNode; child = child.nextSibling) {
                    content += getConcat(child);
                }

                if (HASH_BLOCK_ELEMENTS.indexOf(tagName) != -1) {
                    if (HASH_BLOCK_CLASS_ID_EXCLUDE.test(node.id)) {
                        //console.log('Excluding block element by id: ' + node.id);
                        return '';
                    }
                    if (HASH_BLOCK_CLASS_ID_EXCLUDE.test(node.className)) {
                        //console.log('Excluding block element by class: ' + node.className);
                        return '';
                    }
                    if (content.length > 0 && content.length < HASH_BLOCK_MIN_CHARS) {
                        //console.log('Excluding short block element <' + node.tagName + '>: ' + content);
                        return '';
                    }
                }
                else if (tagName == 'li') {
                    /* LI-Tags get a special treatment, because they are often menu elements */
                    if (!(/comment/i).test(node.className)) {
                        /* don't exclude comments (maybe this should become a user setting ) */
                        if (content.length > 0 && content.length < HASH_LI_MIN_CHARS) {
                            //console.log('Excluding short list item: ' + content);
                            return '';
                        }
                    }
                }

                return content;

            default: return '';
        }

    }

    return md5(document.title + getConcat(document.body));
}