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
const baseUrl = require('sdk/self').data.url('modules/privatechat/');

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { XMPPOneOnOneThread } = require('../../xmpp/threads');
const { ContextMenuItem } = require('../../browser/context-menus');

const { confirmEx } = require('../../browser/dialogs');

const { threadManager } = require('./thread-manager');

const promotionSent = {};

/**
 * This module provides additional private chat tabs,
 * also used for communication with foreign clients.
 */
const PrivateChat = Class({
    extends: EventHub,
    className: 'PrivateChat',

    /**
     * @param {CoopFox} coopfox
     */
    initialize: function initialize(coopfox) {
        this.coopfox = coopfox;

        this._menuItems = [];
        this._activeChats = {};

        coopfox.sidebar.panel.addScript(baseUrl + 'panel.js');
        coopfox.sidebar.roster.addScript(baseUrl + 'roster.js');

        EventHub.prototype.initialize.apply(this, arguments);

        this.subscribeTo(coopfox, 'componentsReady');
        this.subscribeTo(coopfox, 'destroy');
        console.info('PrivateChat module activated.');
    },

    _onceComponentsReady: function _onceComponentsReady() {
        var panelPort = this.panelPort = this.coopfox.sidebar.panel.port;
        var rosterPort = this.coopfox.sidebar.roster.port;

        this.subscribeTo(threadManager, 'newThread');
        this.subscribeTo(panelPort, 'privateChatCreate');
        this.subscribeTo(panelPort, 'privateChatDestroy');
        this.subscribeTo(panelPort, 'privateChatMessage');
        this.subscribeTo(rosterPort, 'openPrivateChat');
        this.subscribeTo(rosterPort, 'openPrivateChatEx');

        this._createMenuItems();
    },

    _onceDestroy: function _onceDestroy() {
        this.destroy();
        this.panelPort = null;
        this.coopfox = null;
    },

    /////////////////////////////////////////////////////////////////

    _createMenuItems: function _createMenuItems() {
        var self = this;
        var window = this.coopfox.window;
        this._menuItems = [

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxRosterContextMenu',
                id: 'context-coopfox-roster-open-privatechat',
                before: 'context-coopfox-roster-chat-add',
                selectors: ['.roster-item'],
                label: 'Open Private Chat',
                onShow: function onShow(target, contact) {
                    var jid = contact.dataset.jid;
                    if (self._activeChats[jid]) {
                        this.hidden = true;
                        return;
                    }
                    if (!contact.classList.contains('coopfox') || contact.classList.contains('participant-active')) {
                        this.item.style.fontWeight = 'bold';
                    } else {
                        this.item.style.fontWeight = 'normal';
                    }
                },
                onClick: function onClick(target, contact) {
                    self._onOpenPrivateChat(contact.dataset.jid);
                }
            })

        ];
    },

    _destroyMenuItems: function _destroyMenuItems() {
        for each (let item in this._menuItems) {
            item.destroy();
        }
        this._menuItems = [];
    },

    /////////////////////////////////////////////////////////////////

    _onOpenPrivateChat: function _onOpenPrivateChat(jid) {
        this._onNewThread(threadManager.getThread(jid), jid, true);
    },

    _onOpenPrivateChatEx: function _onOpenPrivateChatEx(jid) {
        var xmpp = this.coopfox.xmpp;
        var status = xmpp.getParticipantStatus(jid);
        var contact = xmpp.getContact(jid);

        //TODO: this dialog doesn't belong here. Needs a modular solution.
        var choice = confirmEx(
            'New Conversation',
            'How do you wish to interact with ' + contact.name + '?',
            (status === 'inactive') ? 'Invite Back to CoopChat' : 'Invite to Join My CoopChat',
            'Cancel',
            this._activeChats[jid] ? null : 'Open Private Chat'
        );
        switch (choice) {
            case 0:
                xmpp.addParticipant(jid);
                break;
            case 2:
                this._onOpenPrivateChat(jid);
                break;
        }
    },

    _onNewThread: function _onNewThread(thread, jid, foreground) {
        this.panelPort.emit('privateChatCreate', this.coopfox.xmpp.getContact(jid), foreground);
    },

    _onPrivateChatCreate: function _onPrivateChatCreate(jid) {
        this._activeChats[jid] = true;
        this.subscribeTo(threadManager, 'incomingMessage-' + jid, this._onIncomingMessage);
        var thread = threadManager.getThread(jid);
        var newMessages = [];
        this.panelPort.emit('beginBulkUpdate');
        for each (let message in thread.getMessages()) {
            if (message.$timestamp > this.coopfox.xmpp.getThreadTime() - 1000) {
                newMessages.push(message);
            } else {
                this._onIncomingMessage(message, thread.getContact(message.$from));
            }
        }
        this.panelPort.emit('endBulkUpdate');
        for each (let message in newMessages) {
            this._onIncomingMessage(message, thread.getContact(message.$from));
        }
    },

    _onPrivateChatDestroy: function _onPrivateChatDestroy(jid) {
        this.unsubscribeFrom(threadManager, 'incomingMessage-' + jid);
        delete this._activeChats[jid];
    },

    _onIncomingMessage: function _onIncomingMessage(message, contact) {
        var args = { message: message, sender: contact };
        try {
            this.coopfox.emit('beforeDisplayPrivateMessage', args);
            this.panelPort.emit('privateChatMessage', args);
            this.coopfox.emit('afterDisplayPrivateMessage', args);
        }
        catch (e) {
            console.exception(e);
        }
    },

    _onPrivateChatMessage : function _onPrivateChatMessage(message, jid, chatState) {
        if (message.type !== 'headline') {
            if (typeof(chatState) === 'undefined') {
                chatState = 'active';
            }
            if (typeof(chatState) === 'string') {
                message[chatState] = {
                    xmlns : 'http://jabber.org/protocol/chatstates'
                };
            }
        }
        var thread = threadManager.getThread(jid);
        /*if (!promotionSent[jid] && message.body && message.body.$text) {
            promotionSent[jid] = true;
            if (thread.getContact(jid).presence.$primary.c.node !== this.coopfox.NODE_COOPFOX) {
                let oldBody = message.body.$text;
                message.body.$text += '   [sent using CoopFox.net]';
                message.$noEcho = true;
                thread.sendMessage(message);
                delete message.$noEcho;
                message.body.$text = oldBody;
                thread.receiveMessage(message);
                return;
            }
        }*/
        thread.sendMessage(message);
    }

});


function onCoopfoxInit(event) {
    PrivateChat(event.subject);
}

//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-init', onCoopfoxInit, true);
unloader.when(function() {
    sysEvents.off('coopfox-init', onCoopfoxInit);
});