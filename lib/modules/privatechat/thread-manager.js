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

const sysEvents = require('sdk/system/events');
const unloader = require('sdk/system/unload');
const { storage } = require('sdk/simple-storage');

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { XMPPThreadHubClient, XMPPContactThread } = require('../../xmpp/threads');

const PrivateChatThreadManager = Class({
    extends: EventHub,
    className: 'PrivateChatThreadManager',

    initialize: function initialize() {
        this._client = null;
        this._threads = {};

        EventHub.prototype.initialize.apply(this, arguments);
    },

    set client(xmpp) {
        if (this._client) {
            this.unsubscribeFrom(this._client);
        }
        if (xmpp) {
            if (!(xmpp instanceof XMPPThreadHubClient)) {
                throw new TypeError('Invalid XMPP thread client for PrivateChatThreadManager.');
            }
            this._client = xmpp;
            this.subscribeTo(xmpp, 'unknownThread');
        }
    },

    _destroyClientRef: function _destroyClientRef() {
        this._client = null;
    },

    getThread: function getThread(jid) {
        if (this._threads[jid]) {
            return this._threads[jid];
        }

        if (!(this._client instanceof XMPPThreadHubClient)) {
            throw new TypeError('XMPP thread client has not been set.');
        }

        var thread = this._threads[jid] = new XMPPContactThread({
            client: this._client,
            contact: jid,
            onIncomingMessage: this,
            onceDestroy: this._onceDestroyThread
        });

        var storageId = 'private-chat-messages-' + jid;

        thread.once('beforeDestroy', function() {
            storage[storageId] = thread.getMessages();
        });

        if (storage[storageId]) {
            thread.importMessages(storage[storageId].slice(-100), false, true);
        }

        return thread;
    },

    off: function off(type, listener) {
        EventHub.prototype.off.apply(this, arguments);
        if (type && !this.countListeners(type)) {
            let match = type.match(/^incomingMessage-(.+)$/);
            if (match) {
                let jid = match[1];
                console.info('No more listeners for private chat with ' + jid + '. Closing...');
                this._threads[jid].destroy();
            }
        }
    },

    _onUnknownThread: function _onUnknownThread(message) {
        if (message.coopfox) { return; } //handled by main.js
        if (!message.body || !message.body.$text) { return; }
        var jid = message.$from.bare;

        var isNew = !this._threads[jid];
        if (isNew && !this.countListeners('newThread')) {
            //TODO: open in native window
            return;
        }

        var thread = this.getThread(jid);
        thread.receiveMessage(message);
        this.emit('newThread', thread, jid);

        //TODO: Allow users to select which windows to open in, or open as native window
    },

    _onIncomingMessage: function _onIncomingMessage(message) {
        var contact = this._client.getContact(message.$from);
        var jid = contact.isSelf ? message.$to.bare : message.$from.bare;
        console.info('Private message from "' + message.$from.bare + '"');
        this.emit('incomingMessage-' + jid, message, contact, jid);
    },

    _onceDestroyThread: function _onceDestroyThread(thread) {
        this.unsubscribeFrom(thread);
        delete this._threads[thread.jid];
    }

});
exports.threadManager = new PrivateChatThreadManager(); //shared global service


function onXmppAvailable(event) {
    exports.threadManager.client = event.subject;
}

function onXmppShutdown(event) {
    exports.threadManager.client = null;
}


//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-xmpp-available', onXmppAvailable, true);
unloader.when(function() {
    sysEvents.off('coopfox-xmpp-available', onXmppAvailable);
});

//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-xmpp-shutdown', onXmppShutdown, true);
unloader.when(function() {
    sysEvents.off('coopfox-xmpp-shutdown', onXmppShutdown);
});

