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
const windowWatcher = Cc['@mozilla.org/embedcomp/window-watcher;1'].getService(Ci.nsIWindowWatcher);
const sessionStore = Cc["@mozilla.org/browser/sessionstore;1"].getService(Ci.nsISessionStore);

const windowUtils = require('sdk/window/utils');
const privateBrowsing = require('sdk/private-browsing/utils');
const { setTimeout } = require('sdk/timers');

const { Class } = require('sdk/core/heritage');
var { Unknown } = require('sdk/platform/xpcom');
const { EventHub } = require('../utils/events');

const { Namespace } = require('sdk/core/namespace');
const tempStore = new Namespace(); //holds values for windows which are still loading

const sessionKeysRegKey = require('sdk/self').id + '_keys';

/**
 * Utility function which delays execution of a callback
 * until a window has been fully initialized.
 *
 * The callback will receive the window as first argument, followed by "extraArgs".
 *
 * @param {nsIDOMWindow} window
 * @param {function} callback
 * @param {object} thisArg   (optional)
 * @param {Array} extraArgs  (optional)
 */
function waitForLoad(window, callback, thisArg, extraArgs) {
    function onTimeout() {
        var args = extraArgs || [];
        args.unshift(window);
        callback.apply(thisArg || null, args);
    }
    function onLoad() {
        window.removeEventListener('load', onLoad, false);
        //because a lot of other initialization routines (e.g. session store)
        //of a window also wait for the "load" event, we avoid race conditions
        //by waiting until next time the application is idle
        setTimeout(onTimeout);
    }
    window.addEventListener('load', onLoad, false);
}
exports.waitForLoad = waitForLoad;


const BrowserWindowsObserver = Class({
    extends: Unknown,
    interfaces: [ 'nsIObserver' ],

    initialize: function initialize(onOpen, onClose) {
        this._onOpen = onOpen || function(){};
        this._onClose = onClose || function(){};
    },

    register: function register() {
        windowWatcher.registerNotification(this);
    },

    unregister: function unregister() {
        windowWatcher.unregisterNotification(this);
    },

    observe: function observe(subject, topic) {
        var window = subject.QueryInterface(Ci.nsIDOMWindow);

        switch (topic) {
            case 'domwindowopened':
                if (windowUtils.isDocumentLoaded(window)) {
                    this._onOpen(window);
                } else {
                    waitForLoad(window, this._onOpen);
                }
            break;
            case 'domwindowclosed':
                this._onClose(window);
            break;
        }
    }

});

/**
 * This service can be used to dynamically attach
 * functionality to every non-private browser window.
 *
 * The 'windowOpen' event is sent for every new window,
 * as soon its XUL document is fully loaded.
 *
 * The 'windowClose' event is sent before a window is destroyed.
 *
 * After the monitor is created, or once enable() is invoked,
 * the service will fire 'windowOpen' events for all existing windows.
 * When the monitor is destroyed, or once disable() is invoked,
 * the service will fire 'windowClose' events for all existing windows.
 */
const BrowserWindowsMonitor = Class({
    extends: EventHub,
    className: 'BrowserWindowsMonitor',

    initialize: function initialize(options) {
        this.enabled = (typeof(options.enabled) === 'boolean') ? options.enabled : true;
        EventHub.prototype.initialize.apply(this, arguments);
        this._observer = new BrowserWindowsObserver(this._onWindowOpen, this._onWindowClose);
        if (this.enabled) {
            this.enable();
        }
    },

    enable: function enable() {
        if (!this.enabled) {
            this.enabled = true;
            for each (let window in this.getAllWindows()) {
                this.emit('windowOpen', window);
            }
            this._observer.register();
            this.sysOn('quit-application-requested', this._onQuitApplicationRequested, true);
            this.sysOn('quit-application', this._onQuitApplication, true);
        }
    },

    disable: function disable() {
        if (this.enabled) {
            this.enabled = false;
            this._observer.unregister();
            for each (let window in this.getAllWindows()) {
                this.emit('windowClose', window);
            }
            this.sysOff('quit-application-requested', this._onQuitApplicationRequested);
            this.sysOff('quit-application', this._onQuitApplication);
        }
    },

    toggle: function toggle() {
        if (this.enabled) {
            this.disable();
        } else {
            this.enable();
        }
    },

    triggerOpenAll: function triggerOpenAll() {
        for each (let window in this.getAllWindows()) {
            this.emit('windowOpen', window);
        }
    },

    triggerCloseAll: function triggerCloseAll() {
        for each (let window in this.getAllWindows()) {
            this.emit('windowClose', window);
        }
    },

    triggerCloseAllAsync: function triggerCloseAllAsync() {
        setTimeout(this.triggerCloseAll);
    },

    /**
     * @returns {nsIDOMWindow}
     */
    getActiveWindow: function getActiveWindow() {
        return windowUtils.getMostRecentBrowserWindow();
    },

    /**
     * @returns {nsIDOMWindow[]}
     */
    getAllWindows: function getWindows() {
        return windowUtils.windows().filter(windowUtils.isDocumentLoaded).filter(windowUtils.isBrowser);
    },

    _onWindowOpen: function _onWindowOpen(window) {
        if (!this.enabled) { return; } //windows which might have been loading
        if (!windowUtils.isBrowser(window)) { return; }
        if (privateBrowsing.ignoreWindow(window)) { return; }
        this.emit('windowOpen', window);
    },

    _onWindowClose: function _onWindowClose(window) {
        if (!this.enabled) { return; }
        if (!windowUtils.isBrowser(window)) { return; }
        if (privateBrowsing.ignoreWindow(window)) { return; }
        this.emit('windowClose', window);
    },

    _destroyObserver: function _destroyObserver() {
        this.disable();
    },

    _onQuitApplicationRequested: function _onQuitApplicationRequested(event) {
        if (event.subject instanceof Ci.nsISupportsPRBool) {
            if (!event.subject.data) {
                //uncancelled cancellable quit event
                this.emit('quitApplicationRequested', event.subject);
            }
        }
    },

    _onQuitApplication: function _onQuitApplication(event) {
        this.emit('quitApplication');
    },

    /**
     * Creates a new standard browser window.
     * @returns {nsIDOMWindow}
     */
    openWindow: function openWindow() {
        //windowUtils.open has a bug which prevents it from simply opening a new standard window
        //This is because the features parameter will default to '' instead of null
        //https://bugzilla.mozilla.org/show_bug.cgi?id=894036
        return windowWatcher.openWindow(null, 'chrome://browser/content/browser.xul', null, null, null);
    }

});
exports.BrowserWindowsMonitor = BrowserWindowsMonitor;

/**
 * Stores a named value in the persistent session storage of a window,
 * so that it will still exist after the window is closed and restored.
 *
 * Any kind of value can be stored, as long as it can be serialized.
 *
 * @param {nsIDOMWindow} window
 * @param {string} key
 * @param {*} value
 * @throws TypeError  If window is not nsIDOMWindow
 */
exports.setWindowValue = function setWindowValue(window, key, value) {
    if (!(window instanceof Ci.nsIDOMWindow)) {
        throw new TypeError('Invalid window target for session store.');
    }
    if (windowUtils.isDocumentLoaded(window)) {
        sessionStore.setWindowValue(window, key, JSON.stringify(value));
        let keys = sessionStore.getWindowValue(window, sessionKeysRegKey);
        keys = keys ? JSON.parse(keys) : {};
        keys[key] = true;
        sessionStore.setWindowValue(window, sessionKeysRegKey, JSON.stringify(keys));
    }
    else {
        waitForLoad(window, setWindowValue, null, [key, value]);
    }
};

/**
 * Retrieves a named value from the persistent session storage of a window.
 *
 * @param {nsIDOMWindow} window
 * @param {string} key
 * @param {*} defaultValue (optional, defaults to null)
 * @returns {*}
 * @throws TypeError  If window is not nsIDOMWindow
 * @throws Error if the window is uninitialized (consider using waitForLoad)
 */
exports.getWindowValue = function getWindowValue(window, key, defaultValue) {
    if (!(window instanceof Ci.nsIDOMWindow)) {
        throw new TypeError('Invalid window target for session store.');
    }
    if (!windowUtils.isDocumentLoaded(window)) {
        throw new Error('Session storage values are not accessable until a window is fully initialized.');
    }
    return JSON.parse(sessionStore.getWindowValue(window, key) || null) || defaultValue || null;
};

/**
 * Deletes a named value from the persistent session storage of a window.
 *
 * @param {nsIDOMWindow} window
 * @param {string} key
 * @throws TypeError  If window is not nsIDOMWindow
 */
exports.deleteWindowValue = function deleteWindowValue(window, key) {
    if (!(window instanceof Ci.nsIDOMWindow)) {
        throw new TypeError('Invalid window target for session store.');
    }
    if (windowUtils.isDocumentLoaded(window)) {
        try {
            sessionStore.deleteWindowValue(window, key);
        }
        finally {
            let keys = sessionStore.getWindowValue(window, sessionKeysRegKey);
            if (keys) {
                keys = JSON.parse(keys);
                delete keys[key];
                sessionStore.setWindowValue(window, sessionKeysRegKey, JSON.stringify(keys));
            }
        }
    }
    else {
        waitForLoad(window, deleteWindowValue, null, [key]);
    }
};

/**
 * Deletes all values which have been set by setWindowValue().
 *
 * @param window
 */
exports.clearWindowValues = function clearWindowValues(window) {
    if (windowUtils.isDocumentLoaded(window)) {
        let keys = exports.getWindowValue(window, sessionKeysRegKey, {});
        keys = Object.keys(keys);
        keys.push(sessionKeysRegKey);
        for each (let key in keys) {
            try {
                sessionStore.deleteWindowValue(window, key);
            }
            catch (e) {
                console.warn(e.message);
            }
        }
    }
    else {
        waitForLoad(window, clearWindowValues, null, []);
    }
};