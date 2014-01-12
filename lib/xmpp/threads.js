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
const { XMPPFailsafeClient } = require('./failsafe');
const { EventHub } = require('../utils/events');
const { uuidhash, md5 } = require('../utils/strings');
const { objectMergeRecursive } = require('../utils/objects');

const { parseJid, parseAddresses } = require('./session');

function generateThreadId() {
    return 't' + uuidhash(32);
}

/**
 * A wrapper class for the basic XMPPClient, which serves as
 * a <message> multiplexer, allowing for several parallel
 * conversation threads over a shared connection.
 *
 * The wrapper provides transparent virtual clients, which
 * emulate XMPPClient, but will only receive messages from
 * their associated <thread> or its descendants and equally
 * automatically send all their messages to their thread.
 * @see XMPPThread
 */
const XMPPThreadHubClient = Class({
    extends: XMPPFailsafeClient,
    className: 'XMPPThreadHubClient',

    /**
     * @see XMPPFailsafeClient
     */
    initialize: function initialize(options) {
        this._threadMap = {};
        this._contactMap = {};
        this.autoDisconnect = options.autoDisconnect;
        XMPPFailsafeClient.prototype.initialize.apply(this, arguments);
        this.subscribeTo(this, 'incomingMessage');
    },

    /**
     * Validates that a threadID is valid for insertion, or already exists.
     *
     * @param {string} id
     * @param {boolean} asExisting
     */
    validateThreadId: function validateThreadId(id, asExisting) {
        if (asExisting) {
            if (!this._threadMap[id]) {
                throw new Error('Unknown parent thread ID: ' + id);
            }
        } else {
            if ((typeof(id) !== 'string') || (id.length < 4)) {
                throw new TypeError('Invalid message thread ID: ' + id);
            }
            if (this._threadMap[id]) {
                throw new Error('Thread ID already exists: ' + id);
            }
        }
    },

    /**
     * Registers a new XMPPThread.
     *
     * Note that the new client may not be usable immediately after,
     * if the XMPP connection did not exist before calling this method.
     * Wait for the "threadReady" event emitted by the instance.
     *
     * @param {XMPPThread} thread
     * @throws {Error} If a strict thread's ID is invalid or taken.
     */
    addThread: function addThread(thread) {
        if (thread instanceof XMPPStrictThread) {
            var id = thread.id;
            this.validateThreadId(id);
            this._threadMap[id] = thread;
            console.info('XMPP strict thread registered: ' + id);
        }
        else if (thread instanceof XMPPContactThread) {
            this._contactMap[thread.jid] = thread;
            console.info('XMPP contact thread registered: ' + thread.jid);
        }
        else {
            throw new TypeError('Invalid thread instance.');
        }
        this.emit('addThread', thread);
    },

    /**
     * Unregisters a thread. Closes XMPP connection after last thread.
     *
     * @param {XMPPThread} thread
     */
    removeThread: function removeThread(thread) {
        if (!(thread instanceof XMPPThread)) {
            throw new TypeError('Invalid thread instance.');
        }
        this.emit('removeThread', thread);

        if (thread instanceof XMPPStrictThread) {
            for each (let id in this.getSubThreads(thread.id)) {
                delete this._threadMap[id];
                console.info('XMPP sub-thread unregistered: ' + id);
            }
            delete this._threadMap[thread.id];
            console.info('XMPP strict thread unregistered: ' + thread.id);
        }
        else if (thread instanceof XMPPContactThread) {
            delete this._contactMap[thread.jid];
            console.info('XMPP contact thread unregistered: ' + thread.jid);
        }

        if (this.autoDisconnect && !this.threadCount) {
            console.info('No more active XMPP threads. Closing connection.');
            this.disconnect();
        }
    },

    get threadCount() {
        return Object.keys(this._threadMap).length + Object.keys(this._contactMap).length;
    },

    /**
     * Recursively searches the known thread forest
     * and attempts to find an existing thread instance
     * which is responsible for the given (sub)thread.
     *
     * @param {string} id
     * @returns {XMPPThread|null}
     */
    getThread: function getThread(id) {
        if (this._contactMap[id]){
            return this._contactMap[id];
        }
        while (typeof(id) === 'string') {
            id = this._threadMap[id];
        }
        return (id instanceof XMPPThread) ? id : null;
    },

    /**
     * Test whether a given thread ID has been registered.
     *
     * @param {string} id
     * @returns {boolean}
     */
    hasThread: function hasThread(id) {
        return ((typeof(this._threadMap[id]) !== 'undefined') && (typeof(this._contactMap[id]) !== 'undefined'));
    },

    /**
     * Inserts a new subthread into the known thread forest.
     *
     * @param {string} id  The new ID to insert.
     * @param {string} parentId  The parent thread id.
     *
     * @throws {TypeError} If ID is malformed.
     * @throws {Error} If id already exists or parentId does not.
     */
    addSubThread: function addSubThread(id, parentId) {
        this.validateThreadId(id);
        this.validateThreadId(parentId, true);
        console.info('XMPP sub-thread registered: ' + id);
        this._threadMap[id] = parentId;
    },

    /**
     * Performs a reverse search on the thread map and finds
     * the IDs of all sub-threads of the given thread ID.
     *
     * @param {string} id
     * @param {boolean} recursive
     * @returns {string[]}
     */
    getSubThreads: function getSubThreads(id, recursive) {
        var result = [];
        for (let thread in this._threadMap) {
            if (this._threadMap[thread] === id) {
                result.push(thread);
                if (recursive) {
                    result = result.concat(this.getSubThreads(thread, true));
                }
            }
        }
        return result;
    },

    /**
     * Returns the parent thread id for a subthread,
     * undefined if the given thread does not exist,
     * and null if it is a root thread (XMPPThread).
     *
     * @param {string} id
     * @returns {string|undefined|null}
     */
    getParentThreadId: function getParentThreadId(id) {
        var parent = this._threadMap[id];
        return (parent instanceof XMPPThread) ? null : parent;
    },

    _onIncomingMessage: function _onIncomingMessage(message) {
        var thread = null;
        try {

            //look for matching StrictThread
            if (message.thread && message.thread.$text) {
                thread = this.getThread(message.thread.$text);
                if (!thread) {
                    if (message.thread.parent) {
                        thread = this.getThread(message.thread.parent);
                        if (thread) {
                            this.addSubThread(message.thread.$text, message.thread.parent);
                        } else {
                            //unknown reference > ignore and handle as new
                            delete message.thread.parent;
                        }
                    }
                    //else new unknown incoming thread
                }
                //else thread found
            }

            if (!thread) {
                //allow listeners to detect new strict thread before going to contact catch-all
                this.emit('unknownStrictThread', message);
                if (message.$received) {
                    return;
                }

                //look for matching ContactThread
                if (!Array.isArray(message.$to)) {
                    let sender = this._xmpp.getContact(message.$from);
                    let jid = sender.isSelf ? message.$to.bare : message.$from.bare;
                    if (jid) {
                        thread = this.getThread(jid);
                    }
                }

                if (!thread) {
                    //allow listeners to create new contact thread
                    this.emit('unknownThread', message);
                    if (message.$received) {
                        return;
                    }

                    if (!thread) {
                        console.warn('Unreceived message: ' + message.id);
                        return;
                    }
                }
            }

            thread.receiveMessage(message);
        }
        catch (e) {
            console.exception(e);
        }
    }

});
exports.XMPPThreadHubClient = XMPPThreadHubClient;


/**
 * A virtual client, which attaches itself to an instance of
 * XMPPThreadHubClient to provide a transparent client interface
 * for multiple parallel conversations over a shared connection.
 *
 * Each thread stores all its messages in a history, which can be
 * replayed and merged. The entire conversation can be obtained
 * by using "getMessages()" and restored by using "importMessages()".
 */
const XMPPThread = Class({
    extends: EventHub,
    className: 'XMPPThread',

    initialize: function initialize(options) {
        if (!(options.client instanceof XMPPThreadHubClient)) {
            throw new TypeError('Invalid client for XMPP thread.');
        }
        var client = this.client = options.client;
        this._eventForwards = { init: false, incomingMessage: false, destroy: false, beforeDestroy: false };
        this._reset();

        EventHub.prototype.initialize.apply(this, arguments);

        if (client.xmppConnected) {
            for each (let contact in this.roster) {
                this.emit('rosterItemUpdate', contact, 'item');
            }
            this._onceXmppConnected(options);
        }
        else {
            this.subscribeTo(client, 'xmppConnected', this._onceXmppConnected.bind(this, options), true);
            try {
                client.connect(); //lazy-connect
            } catch (e) {
                console.warn(e.message);
            }
        }
    },

    _onceXmppConnected: function _onceXmppConnected(options) {
        if (options.messages) {
            this.importMessages(options.messages);
        }
        this.emit('_threadReady');
        this.emit('threadReady');
    },

    _destroyClientAssociation: function _destroyThread() {
        this.client.removeThread(this);
        this.client = null;
    },

    _reset: function _reset() {
        if (this._history && this._history.length) {
            this.emit('clearHistory');
            console.info('History cleared for ' + this);
        }
        this.messages = {}; //message ID -> {message}
        this.hasMessages = false;
        this._versions = {}; //version ID -> history #
        this._history = []; // # -> { {message}, version, timestamp }
        this._normalizeHistory();
    },

    get latestVersion() {
        return this._history.length ? this._history[this._history.length-1].version : '';
    },
    get latestMessage() {
        return this._history.length ? this._history[this._history.length-1].message : null;
    },
    get latestMessageTimestamp() {
        return this._history.length ? this.latestMessage.$timestamp : -1;
    },

    /**
     * Stores a new message in the internal database.
     * If the message time sequence is disrupted, this will automatically
     * trigger a rebuild, unless _disableNormalizeHistory() has been called.
     *
     * @param {object} message
     */
    _storeMessage : function _storeMessage(message) {
        this.messages[message.id] = message;
        if (this._historyDenormalized || (message.$timestamp < this.latestMessageTimestamp)) {
            this._historyDenormalized = true;
            this._history.push({ message: message, version: null });
            this._normalizeHistory();
        } else {
            var newVersion = md5(this.latestVersion + message.id);
            this._history.push({ message: message, version: newVersion });
            this._versions[newVersion] = this._history.length-1;
        }
        this.hasMessages = true;
    },

    /**
     * Determine if a message is valid for persistent storage
     *
     * @param {object} message
     * @returns bool
     */
    _isPersistentMessage: function _isPersistentMessage(message) {
        if (message.type !== 'chat') {
            return false;
        }

        //persistent messages must contain at least one non-empty subelement
        //(a typical non-persistent messages is a chat state without a body, for instance)
        for (let key in message) {
            if (key.charAt(0) === '$') { continue; }
            let element = message[key];
            if (typeof(element) !== 'object') { continue; }
            if (key === 'addresses') { continue; }
            if (key === 'thread') { continue; }
            if (key === 'delay') { continue; }
            if (element.$text) {
                return true;
            }
            for each (let subElement in element) {
                if (typeof(subElement) === 'object') {
                    return true;
                }
            }
        }
        return false;
    },

    /**
     * Disables the execution of _normalizeHistory() until _enableNormalizeHistory() is called.
     * Postponing normalization can safe computation time during mass updates.
     */
    _disableNormalizeHistory: function _disableNormalizeHistory() {
        if (this._historyNormalizeDisabled > 0) {
            this._historyNormalizeDisabled++;
        } else {
            this._historyNormalizeDisabled = 1;
        }
        console.info('Automatic history normalization disabled for ' + this);
    },

    /**
     * Re-enables and, if necessary, executes _normalizeHistory();
     */
    _enableNormalizeHistory: function _enableNormalizeHistory() {
        this._historyNormalizeDisabled -= 1;
        if (this._historyNormalizeDisabled <= 0) {
            delete this._historyNormalizeDisabled;
            console.info('Automatic history normalization re-enabled for ' + this);
            if (this._historyDenormalized) {
                this._normalizeHistory();
            }
        }
    },

    /**
     * Corrects invalid states in the internal history order and version caches.
     * Such a state can occur if messages are received out of correct time-order.
     */
    _normalizeHistory: function _normalizeHistory() {
        if (!this._historyDenormalized || this._historyNormalizeDisabled) { return; }
        console.info('Normalizing history of ' + this);

        var history = this._history;
        history.sort(function(a,b) {
            if (a.message.$timestamp < b.message.$timestamp) { return -1; }
            if (a.message.$timestamp > b.message.$timestamp) { return 1; }
            return a.message.id.localeCompare(b.message.id);
        });

        var version = '';
        this._versions = {};
        for (let i = 0; i < history.length; i++) {
            version = history[i].version = md5(version + history[i].message.id);
            this._versions[version] = i;
        }

        this.emit('historyRewritten');
        delete this._historyDenormalized;
    },


    _addEventForward: function _addEventForward(type) {
        if (typeof(this._eventForwards[type]) === 'undefined') {
            var fw = this._eventForwards[type] = this.emit.bind(this, type);
            this.subscribeTo(this.client, type, fw);
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
        if (typeof(this.client[id]) === 'function') {
            return this.client[id].apply(this.client, args);
        } else {
            return this.client.__noSuchMethod__(id, args);
        }
    },
    get serverInfo() { return this.client.serverInfo; },
    get roster() { return this.client.roster; },
    get rosterSelf() { return this.client.rosterSelf; },


    /**
     * Wrapper for XMPPClient.sendMessage()
     *
     * @param {object} message
     */
    sendMessage: function sendMessage(message) {
        if (!message.type) {
            message.type = 'chat';
        }
        this.emit('_sendMessage', message);
        this.emit('beforeSendMessage', message);
        this.client.sendMessage(message, true);
        this.emit('afterSendMessage', message);
        //Successfully sent messages are automatically echoed by the client -> receiveMessage()
    },

    /**
     * Called by XMPPThreadHubClient to pass messages for this thread.
     *
     * @param {object} message
     */
    receiveMessage: function receiveMessage(message) {
        if (typeof(message.id) !== 'string' || !message.id.length) {
            console.error('Received message without "id" attribute.');
            return;
        }
        if (!message.$from) {
            message.$from = parseJid(message.from);
        }
        if (!message.$to) {
            message.$to = parseAddresses(message.addresses) || parseJid(message.to);
        }
        this._setMessageTimestamp(message);

        if (this.messages[message.id]) {
            console.warn('Ignored duplicate message id: ' + message.id);
            let old = this.messages[message.id];
            if (old.$timestamp > message.$timestamp) {
                //always keep lowest timestamp, to avoid sort order divergence
                console.warn('Adopting lower message timestamp of duplicate.');
                old.$timestamp = message.$timestamp;
                old.delay = message.delay;
                this._historyDenormalized = true;
                this._normalizeHistory();
            }
            return;
        }

        if (this._isPersistentMessage(message)) {
            this._storeMessage(message);
            message.$persistent = true;
        }

        this.emit('_incomingMessage', message); //gives derived classes a change to alter/react
        this.emit('beforeIncomingMessage', message); //gives subscribers a chance to alter
        this.emit('incomingMessage', message);
        if (!message.$received) {
            message.$received = Date.now();
        }
        this.emit('afterIncomingMessage', message);
    },

    _setMessageTimestamp: function _setMessageTimestamp(message) {
        var delayStamp = null;
        if (message.delay && (message.delay.xmlns == 'urn:xmpp:delay')) {
            delayStamp = Date.parse(message.delay.stamp);
        }
        if (typeof(message.$timestamp) !== 'number') {
            if (delayStamp) {
                message.$timestamp = delayStamp;
                return;
            } else {
                message.$timestamp = Date.now();
            }
        }

        //Also ensure that timestamp is stored in XEP-0203 format, so the message can be forwarded
        if (message.$timestamp !== delayStamp) {
            if (!message.delay) {
                message.delay = {
                    xmlns: 'urn:xmpp:delay',
                    from: this.rosterSelf.jid.bare,
                    $text: 'Received'
                };
            }
            let stamp = new Date(message.$timestamp);
            message.delay.stamp = stamp.toISOString();
        }
    },

    /**
     * Returns all messages (since a specified version state).
     *
     * @param {string} version (optional)
     * @returns {Array}
     */
    getMessages: function getMessages(version) {
        var result = [];
        for (let i = (this._versions[version] || -1) + 1; i < this._history.length; i++) {
            result.push(this._history[i].message);
        }
        return result;
    },

    /**
     * Resends all past messages through the 'incomingMessage' event.
     *
     * @param {string} diffVersion  Only returns messages after this version state (optional).
     * @return {string}
     */
    replayMessages: function replayMessages(diffVersion) {
        for each (let message in this.getMessages(diffVersion)) {
            message.$isReplay = true;
            try {
                this.emit('beforeIncomingMessage', message);
                this.emit('incomingMessage', message);
                this.emit('afterIncomingMessage', message);
            } finally {
                delete message.$isReplay;
            }
        }
    },

    /**
     * Imports existing messages into the history.
     *
     * @param {Array} messages
     * @param {boolean} replace  Do not merge, but clear the existing conversation.
     * @param {boolean} quiet  Suppress events (e.g. "incomingMessage") during import.
     */
    importMessages: function importMessages(messages, replace, quiet) {
        if (!Array.isArray(messages)) {
            throw new TypeError('Import data must be an array of messages.');
        }
        this.emit('beginImportMessages', messages);
        try {

            if (replace) {
                if (quiet) { this.pushQuiet(); }
                try {
                    this._reset();
                }
                finally {
                    if (quiet) { this.popQuiet(); }
                }
            }

            if (quiet) { this.pushQuiet(); }
            this._disableNormalizeHistory();
            try {
                for each (let message in messages) {
                    this.receiveMessage(message);
                }
            }
            finally {
                this._enableNormalizeHistory();
                if (quiet) { this.popQuiet(); }
            }

        }
        finally {
            this.emit('finishedImportMessages', messages);
        }
    },

    /**
     * Imports all messages from another thread.
     *
     * @param {XMPPThread} source
     */
    merge: function merge(source) {
        if (!(source instanceof XMPPThread)) {
            throw new TypeError('Invalid XMPPThread merge source.');
        }
        this.importMessages(source.getMessages());
    }

});


/**
 * A thread which is strictly bound to the native XMPP <thread> element.
 * It will receive all messages addressed to this thread,
 * regardless of their sender or recipient.
 */
const XMPPStrictThread = Class({
    extends: XMPPThread,
    className: 'XMPPStrictThread',

    _initId: function _initId() {
        this.id = null;
        this.once('_threadReady', function(){
            if (!this.id) {
                this._setThreadId(generateThreadId());
            }
        });
    },

    _onceXmppConnected: function _onceXmppConnected(options) {
        if (options.id) {
            this._setThreadId(options.id);
        }
        XMPPThread.prototype._onceXmppConnected.apply(this, arguments);
    },

    _setThreadId: function _setThreadId(id) {
        if (id === this.id) { return; }
        if (this.id) {
            if (this.hasMessages) {
                throw new Error('XMPP thread ID cannot be changed once it contains messages.');
            }
            if (this._history.length) {
                this._reset();
            }
            this.client.removeThread(this);
        }
        this.id = id;
        this.client.addThread(this);
        this.emit('setThreadId', this.id);
    },

    isSubThread: function isSubThread(id) {
        return (this.client.getThread(id) === this);
    },

    sendMessage: function sendMessage(message) {
        if (message.thread) {
            if (this.isSubThread(message.thread.$text)) {
                //ensure that a known thread references its correct parent, or none in case of root
                message.thread.parent = this.getParentThreadId(message.thread.$text);
                if (!message.thread.parent) {
                    delete message.thread.parent;
                }
            } else {
                //ensure that a newly created thread references an existing one as parent
                if (typeof(message.thread.parent) !== 'string') {
                    message.thread.parent = this.id;
                }
                else if (!this.isSubThread(message.thread.parent)) {
                    throw new Error('Invalid parent reference for new thread ID.');
                }
                this.client.addSubThread(message.thread.$text, message.thread.parent);
            }
        } else {
            message.thread = { $text: this.id };
        }

        XMPPThread.prototype.sendMessage.apply(this, arguments);
    },

    receiveMessage: function receiveMessage(message) {
        if (!message.thread || !message.thread.$text) {
            console.error('Received message without "thread" element.');
            return;
        }

        if (!this.id) {
            //can occur during creation from import
            this._setThreadId(message.thread.$text);
        } else {
            let thread = message.thread;
            if ((thread.$text !== this.id) && !this.isSubThread(thread.$text)) {
                if (thread.parent) {
                    if ((thread.parent === this.id) || this.isSubThread(thread.parent)) {
                        this.client.addSubThread(thread.$text, thread.parent);
                    } else {
                        throw new Error('Unknown thread parent [' + thread.parent + ' != ' + this.id + ']');
                    }
                } else {
                    throw new Error('Unknown thread ID [' + thread.$text + ' != ' + this.id + ']');
                }
            }
        }

        XMPPThread.prototype.receiveMessage.apply(this, arguments);
    },

    /**
     * Imports messages, which can be from a foreign thread.
     * The thread IDs from such messages will be rewritten to the id of this instance.
     *
     * @see XMPPThread.importMessages()
     */
    importMessages: function importMessages(messages, replace, quiet) {
        if (!messages.length){ return; }

        if (!this.id || (messages[0].thread.$text === this.id)) {
            XMPPThread.prototype.importMessages.apply(this, arguments);
            return;
        }

        if (replace) {
            this._setThreadId(messages[0].thread.$text); //exception if history is not empty, calls reset
            XMPPThread.prototype.importMessages.apply(this, arguments);
            return;
        }

        var threadMap = {};
        threadMap[messages[0].thread.$text] = this.id;

        var imported = [];
        var client = this.client;

        function replaceThread(thread) {
            if (!thread) {
                return undefined;
            }
            if (threadMap[thread]) {
                return threadMap[thread];
            }
            if (!client.hasThread(thread)) {
                return thread;
            }
            threadMap[thread] = generateThreadId();
            return threadMap[thread];
        }

        for each (let message in messages) {
            imported.push(objectMergeRecursive(message, {
                thread: {
                    $text: replaceThread(message.thread.$text),
                    parent: replaceThread(message.thread.parent),
                    original: message.thread.original || message.thread.$text
                }
            }));
        }

        XMPPThread.prototype.importMessages.call(this, imported, replace, quiet);
    },

    toString: function toString() {
        return 'XMPP Strict Thread ' + this.id;
    }

});
exports.XMPPStrictThread = XMPPStrictThread;


/**
 * A thread which receives all messages sent to or from
 * a specific contact, regardless of their <thread> value.
 * However, a received thread value is preserved in replies.
 *
 * Note that XMPPThreadHubClient will give priority to any matching
 * XMPPStrictThread before defaulting to XMPPContactThread.
 */
const XMPPContactThread = Class({
    extends: XMPPThread,
    className: 'XMPPContactThread',

    _initContact: function _initContact(options) {
        var contact = options.contact;
        if (typeof(contact) === 'object') {
            contact = contact.bare;
        } else {
            contact = parseJid(contact).bare;
        }
        this.jid = contact;
        this.threadId = generateThreadId();
        this.client.addThread(this);
    },

    sendMessage: function sendMessage(message) {
        if (!message.to) {
            let contact = this.roster[this.jid];
            if (!contact) {
                console.warn('Sending message to unknown recipient: ' + this.jid);
            }
            message.to = contact ? contact.jid.full : this.jid;
        }
        if (!message.thread || !message.thread.$text) {
            message.thread = { $text: this.threadId };
        }
        XMPPThread.prototype.sendMessage.apply(this, arguments);
    },

    receiveMessage: function receiveMessage(message) {
        if (message.thread && message.thread.$text) {
            this.threadId = message.thread.$text;
        }
        XMPPThread.prototype.receiveMessage.apply(this, arguments);
    },

    toString: function toString() {
        return 'XMPP Contact Thread ' + this.jid;
    }

});
exports.XMPPContactThread = XMPPContactThread;