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

const { Cc, Ci } = require('chrome');
const sessionStore = Cc["@mozilla.org/browser/sessionstore;1"].getService(Ci.nsISessionStore);

const { BrowserWindow } = require('sdk/windows');

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../utils/events');

const { Namespace } = require('sdk/core/namespace');
const instanceStore = new Namespace();

const { cleanUrl, urlHash } = require('../utils/urls');
const { scrollToElement } = require('../utils/dhtml');


/**
 * This service can be used to dynamically attach functionality
 * into every web document loaded in the tabs of a browser window.
 *
 * The 'documentReady' event is sent whenever a web document has been loaded.
 * The 'documentActivate' event is sent when the tab of a document is activated.
 * The 'documentUnload' event is sent before a tab closes or its URL changes.
 * All events provide an nsIDOMDocument and the associated SDK Tab object.
 *
 * After the monitor is created, or once enable() is invoked,
 * the service will fire 'documentReady' events for all existing tabs.
 * When the monitor is destroyed, or once disable() is invoked,
 * the service will fire 'documentUnload' events for all existing tabs.
 *
 * The service further provides utitily function to translate between
 * documents and tabs, and to store key-value-pairs for them.
 *
 * @constructor
 * @param {object} options
 *  - {nsIDOMWindow} window
 */
const WindowTabsMonitor = Class({
    extends: EventHub,
    className: 'WindowTabsMonitor',

    initialize: function initialize(options) {
        if (!(options.window instanceof Ci.nsIDOMWindow)) {
            throw new TypeError('Undefined window for WindowTabsMonitor.');
        }

        this.window = options.window;
        this.enabled = (typeof(options.enabled) === 'boolean') ? options.enabled : true;
        this.includeProtocols = options.includeProtocols || ['http', 'https'];

        var browserWindow = new BrowserWindow({ window: options.window });
        this.tabs = browserWindow.tabs;
        this._tabBrowser = options.window.gBrowser; //XUL <tabbrowser>

        EventHub.prototype.initialize.apply(this, arguments);
    },

    _initListeners: function _initListeners() {
        this.subscribeTo(this.tabs, 'ready', this._onTabReady);
        this.subscribeTo(this.tabs, 'activate', this._onTabActivate);
        for each (let tab in this.tabs) {
            this._onTabReady(tab);
        }
    },

    get activeTabIndex() {
        return this._tabBrowser.tabContainer.selectedIndex;
    },
    get activeTab() {
        return this.tabs.activeTab;
    },
    get activeDoc() {
        var doc = this._tabBrowser.contentDocument;
        return this.isValidDoc(doc) ? doc : null;
    },
    get activeUrl() {
        var doc = this.activeDoc;
        return doc ? cleanUrl(doc.URL) : null;
    },
    get activeUrlHash() {
        var doc = this.activeDoc;
        return doc ? urlHash(doc.URL) : null;
    },

    /**
     * @param {object} tab
     * @returns {boolean}
     */
    isActiveTab: function isActiveTab(tab) {
        if ((typeof(tab) !== 'object') || (tab === null)) { return false; }
        return tab.index === this.activeTabIndex;
    },

    /**
     * @param {nsIDOMDocument} doc
     * @returns {boolean}
     */
    isActiveDoc: function isActiveDoc(doc) {
        return this.getTabIndexForDoc(doc) === this.activeTabIndex;
    },

    /**
     * @param {string} url
     * @returns {boolean}
     */
    isActiveUrl: function isActiveUrl(url) {
        if (typeof(url) !== 'string') { return false; }
        return urlHash(url) === this.activeUrlHash;
    },

    isValidDoc: function isValidDoc(doc) {
        if (!(doc instanceof Ci.nsIDOMDocument) || !doc.URL || !doc.body || !doc.defaultView) {
            return false;
        }
        if (this.includeProtocols.indexOf((doc.URL.match(/^(\w+):/) || [])[1]) === -1) {
            return false;
        }
        var tab = this.getXULTabForDoc(doc);
        if (!tab || tab.pinned) {
            return false;
        }
        return true;
    },

    /**
     * @param {number} index
     * @returns {nsIDOMDocument|null}
     */
    getDocForTabIndex: function getDocForTabIndex(index) {
        try {
            var doc = this._tabBrowser.getBrowserAtIndex(index).contentDocument;
        } catch (e) {
            return null;
        }
        if (!this.isValidDoc(doc)) {
            return null;
        }
        return doc;
    },

    /**
     * @param {object} tab
     * @returns {nsIDOMDocument|null} Null is returned for non-existent or excluded tabs.
     */
    getDocForTab: function getDocForTab(tab) {
        if ((typeof(tab) !== 'object') || (tab === null)) { return null; }
        return this.getDocForTabIndex(tab.index);
    },

    /**
     * @param {nsIDOMDocument} doc
     * @returns {number} -1 if not found
     */
    getTabIndexForDoc: function getTabIndexForDoc(doc) {
        if (!(doc instanceof Ci.nsIDOMDocument)) { return -1; }
        try {
            var index = this._tabBrowser.getBrowserIndexForDocument(doc);
        } catch (e) {
            return -1;
        }
        return index;
    },

    /**
     * @param {nsIDOMDocument} doc
     * @returns {object|null}
     *
     * @deprecated This method may falsely return null just after another tab was closed!
     */
    getTabForDoc: function getTabForDoc(doc) {
        var index = this.getTabIndexForDoc(doc);
        if (index < 0) {
            return null;
        }
        return this.tabs[index] || null;
    },

    /**
     * @param {nsIDOMDocument} doc
     * @returns {nsIDOMElement|null}
     */
    getXULTabForDoc: function getXULTabForDoc(doc) {
        var index = this.getTabIndexForDoc(doc);
        if (index < 0) {
            return null;
        }
        return this._tabBrowser.tabs[index] || null;
    },

    /**
     * @param {nsIDOMDocument} doc
     * @returns {string|null}
     */
    getUrlHashForDoc: function getUrlHashForDoc(doc) {
        if (!this.isValidDoc(doc)) { return null; }
        return urlHash(doc.URL);
    },

    /**
     * @param {string} url
     * @param {bool} isHash
     * @returns {object[]}
     */
    getTabsForUrl: function getTabsForUrl(url, isHash) {
        var urlhash = isHash ? url : urlHash(url);
        var result = [];
        for each (let tab in this.tabs) {
            if (urlHash(tab.url) === urlhash) {
                result.push(tab);
            }
        }
        return result;
    },

    /**
     * @param {string} url
     * @param {bool} isHash
     * @returns {nsIDOMDocument[]}
     */
    getDocsForUrl: function getDocsForUrl(url, isHash) {
        var result = [];
        var tabs = this.getTabsForUrl(url, isHash);
        for each (let tab in tabs) {
            var doc = this.getDocForTab(tab);
            if (doc) {
                result.push(doc);
            }
        }
        return result;
    },

    getAllDocs: function getAllDocs() {
        var result = [];
        if (!this.enabled) {
            return result;
        }
        for each (let tab in this.tabs) {
            let doc = this.getDocForTab(tab);
            if (doc && this.getDocumentValue(doc, '_monitorAttached', false)) {
                result.push(doc);
            }
        }
        return result;
    },

    /**
     * @param {object} tab
     * @returns {nsIDOMElement|null}
     */
    _getXULElementForTab: function _getXULElementForTab(tab) {
        if ((typeof(tab) !== 'object') || (tab === null)) { return null; }
        return this._tabBrowser.tabContainer.getItemAtIndex(tab.index);
    },

    setTabValue: function setTabValue(tab, key, value) {
        exports.setTabValue(this._getXULElementForTab(tab), key, value);
    },
    getTabValue: function getTabValue(tab, key, defaultValue) {
        return exports.getTabValue(this._getXULElementForTab(tab), key, defaultValue);
    },
    deleteTabValue: function deleteTabValue(tab, key) {
        exports.deleteTabValue(this._getXULElementForTab(tab), key);
    },
    setDocumentValue: function setDocumentValue(doc, key, value) {
        exports.setDocumentValue(doc, key, value);
    },
    getDocumentValue: function getDocumentValue(doc, key, defaultValue) {
        return exports.getDocumentValue(doc, key, defaultValue);
    },
    deleteDocumentValue: function deleteDocumentValue(doc, key) {
        exports.deleteDocumentValue(doc, key);
    },

    /**
     * @param {string} url
     * @param {boolean} newTab
     */
    openUrl: function openUrl(url, newTab) {
        var args = Array.slice(arguments);
        args.unshift('openUrl');
        this.emit.apply(this, args);
        exports.openUrl(this.window, url, newTab);
    },

    _onTabReady: function _onTabReady(tab) {
        var doc = this.getDocForTab(tab);
        if (doc) {
            if (this.enabled) {
                this.emit('documentReady', doc);
            }
            doc.defaultView.addEventListener('unload', this._onDocUnload);
            this.setDocumentValue(doc, '_monitorAttached', true);
        }
        if (this.isActiveTab(tab) && this.enabled) {
            //may pass null in case of excluded URI!
            this.emit('documentActivate', doc);
        }
    },

    _onDocUnload: function _onDocUnload(event) {
        var doc = event.target;
        if (this.enabled) {
            this.emit('documentUnload', doc);
        }
        //no need to remove event on unloading doc
    },

    _onTabActivate: function _onTabActivate(tab) {
        var doc = this.getDocForTab(tab);
        //may pass null in case of excluded URI!
        //but we should still send notifiacion of active doc change.
        if (this.enabled) {
            this.emit('documentActivate', doc, tab);
        }
    },

    /**
     * Detaches functionality from all documents.
     */
    disable: function disable() {
        if (!this.enabled) { return; }
        for each (let doc in this.getAllDocs()) {
            this.emit('documentUnload', doc);
        }
        this.enabled = false;
    },

    /**
     * (Re-)Attaches functionality to all documents.
     */
    enable: function enable() {
        if (this.enabled) { return; }
        this.enabled = true;
        for each (let doc in this.getAllDocs()) {
            this.emit('documentReady', doc);
        }
        this._onTabActivate(this.activeTab);
    },

    _destroyListeners: function _destroyListeners() {
        this.disable();
        for each (let doc in this.getAllDocs()) {
            doc.defaultView.removeEventListener('unload', this._onDocUnload);
            this.deleteDocumentValue(doc, '_monitorAttached');
        }
        this.window = null;
    }

});
exports.WindowTabsMonitor = WindowTabsMonitor;


/**
 *  Opens a url in the current or a new tab.
 *  If the url is already open in a tab, then this tab is simply activated.
 *
 *  If the url contains a fragment, the document will be scrolled to the
 *  corresponding element / anchor once it is fully loaded, but the
 *  fragment will not show up in the address bar.
 *
 *  @param {nsIDOMWindow}   window
 *  @param {string} url     The URL to open
 *  @param {bool}   newTab  Whether to open a new URL in a new tab
 */
exports.openUrl = function openUrl(window, url, newTab) {
    if (!(window instanceof Ci.nsIDOMWindow)) {
        throw new TypeError('Invalid window instance for openUrl');
    }
    var tabBrowser = window.gBrowser;

    var fragment = url.substr(cleanUrl(url).length + 1);

    if (!newTab) {
        //Test if the requested url is already loaded in a tab.
        //If so, just activate the tab.
        let urlhash = urlHash(url);
        for (let i = 0; i < tabBrowser.tabs.length; i++) {
            let tab = tabBrowser.tabs[i];
            let doc = tab.linkedBrowser.contentDocument;
            if (!doc || !doc.URL) { continue; }
            if (urlHash(doc.URL) == urlhash) {
                tabBrowser.selectedTab = tab;
                if (fragment) {
                    let el = doc.getElementById(fragment);
                    if (el) {
                        scrollToElement(el);
                    } else {
                        doc.defaultView.location.hash = fragment;
                    }
                }
                return;
            }
        }
    }

    function jumpToFragment(event) {
        if (event.originalTarget instanceof Ci.nsIDOMDocument) {
            //remove the listener here to make sure it is always cleaned up
            //(chance the next loaded doc is not ours is negligible)
            tabBrowser.removeEventListener('load', jumpToFragment, true);
            var doc = event.originalTarget;
            if (doc.URL == url) {
                //wait a short period for overlays to be initialized etc...
                doc.defaultView.setTimeout(function() {
                    var el = doc.getElementById(fragment);
                    if (el) {
                        scrollToElement(el);
                    } else {
                        doc.defaultView.location.hash = fragment;
                    }
                }, 500);
            }
        }
    }

    if (fragment) {
        tabBrowser.addEventListener('load', jumpToFragment, true);
    }

    if (newTab) {
        tabBrowser.loadOneTab(url);
    } else {
        tabBrowser.loadURI(url);
    }
};


/**
 * Stores a named value in the persistent session storage of a tab,
 * so that it will still exist after the tab is closed and restored.
 *
 * Any kind of value can be stored, as long as it can be serialized.
 *
 * @param {nsIDOMElement} tab
 * @param {string} key
 * @param {*} value
 */
exports.setTabValue = function setTabValue(tab, key, value) {
    sessionStore.setTabValue(tab, key, JSON.stringify(value));
};

/**
 * Retrieves a named value from the persistent session storage of a tab.
 * Null is returned if the specified key does not exist.
 *
 * @param {nsIDOMElement} tab
 * @param {string} key
 * @param {*} defaultValue (optional, defaults to null)
 * @returns {*}
 */
exports.getTabValue = function getTabValue(tab, key, defaultValue) {
    return JSON.parse(sessionStore.getTabValue(tab, key) || null) || defaultValue || null;
};

/**
 * Deletes a named value from the persistent session storage of a tab.
 *
 * @param {nsIDOMElement} tab
 * @param {string} key
 */
exports.deleteTabValue = function deleteTabValue(tab, key) {
    return sessionStore.deleteTabValue(tab, key);
};

/**
 * Stores a named value in the non-persistent storage of a document.
 * The value will exist until the document is unloaded.
 *
 * @param {nsIDOMDocument} doc
 * @param {string} key
 * @param {*} value
 */
exports.setDocumentValue = function setDocumentValue(doc, key, value) {
    if (!(doc instanceof Ci.nsIDOMDocument)) {
        throw new TypeError('Invalid document target for value storage.');
    }
    instanceStore(doc)[key] = value;
};

/**
 * Retrieves a named value from the non-persistent storage of a document.
 * Null is returned if the specified key does not exist.
 *
 * @param {nsIDOMDocument} doc
 * @param {string} key
 * @param {*} defaultValue (optional, defaults to null)
 * @returns {*}
 */
exports.getDocumentValue = function getDocumentValue(doc, key, defaultValue) {
    if (!(doc instanceof Ci.nsIDOMDocument)) {
        throw new TypeError('Invalid document target for value storage.');
    }
    return instanceStore(doc)[key] || defaultValue || null;
};

/**
 * Deletes a named value from the non-persistent storage of a document.
 *
 * @param {nsIDOMDocument} doc
 * @param {string} key
 */
exports.deleteDocumentValue = function deleteDocumentValue(doc, key) {
    if (!(doc instanceof Ci.nsIDOMDocument)) {
        throw new TypeError('Invalid document target for value storage.');
    }
    delete instanceStore(doc)[key];
};
