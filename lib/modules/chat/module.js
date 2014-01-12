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

const { storage } = require('sdk/simple-storage');
const { url } = require('sdk/self').data;
const baseUrl = url('modules/chat/');
const sysEvents = require('sdk/system/events');
const unloader = require('sdk/system/unload');
const clipboard = require('sdk/clipboard');

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { MenuItem } = require('../../browser/menus');
const { ContextMenuItem } = require('../../browser/context-menus');

const { fileSavePrompt, fileOpenPrompt, alert, confirmEx } = require('../../browser/dialogs');
var files = require('sdk/io/file');

/**
 * This module provides the basic chat tab in the panel.
 * It manages processing of outgoing messages and activity states.
 */
const Chat = Class({
    extends: EventHub,
    className: 'Chat',

    /**
     * @param {CoopFox} coopfox
     */
    initialize: function initialize(coopfox) {
        this.coopfox = coopfox;
        this.xmpp = coopfox.xmpp;
        this._menuItems = [];
        this._deleteHistory = [];

        coopfox.sidebar.roster.addScript(baseUrl + 'roster.js');
        coopfox.sidebar.roster.addStyle(baseUrl + 'roster.css');
        coopfox.sidebar.panel.addScript(baseUrl + 'panel-chatbox.js');
        coopfox.sidebar.panel.addScript(baseUrl + 'panel.js');
        coopfox.sidebar.panel.addStyle(baseUrl + 'panel.css');
        coopfox.sidebar.panel.addOptions({ chatTabHidden: storage['chat-tab-hidden'] || false });

        EventHub.prototype.initialize.apply(this, arguments);

        this.subscribeTo(coopfox, 'componentsReady');
        this.subscribeTo(coopfox, 'destroy');
        console.info('Chat module activated.');
    },

    _onceComponentsReady: function _onceComponentsReady() {
        var port = this.port = this.coopfox.sidebar.panel.port;
        var xmpp = this.xmpp;
        this.subscribeTo(port, 'message', this._onOutgoingMessage);

        for each (let jid in this.xmpp.getParticipants(true)) {
            this._onParticipantAdded(jid);
        }
        this._onParticipantAdded(this.xmpp.rosterSelf.jid.bare);
        xmpp.subscribeTo(this.coopfox.sidebar.roster.port, 'addParticipant', xmpp.addParticipant);
        this.subscribeTo(xmpp, 'participantAdded');

        if (xmpp.threadTimeOffset) {
            this._onThreadTimeCorrected(xmpp.threadTimeOffset);
        }
        this.subscribeTo(xmpp, 'threadTimeCorrected');

        this.subscribeTo(xmpp, 'incomingMessage');

        this.subscribeTo(this.coopfox, 'chatScrollTo', function(id){
            port.emit('messageScrollTo', id);
        });
        this.subscribeTo(this.coopfox, 'chatReplyTo', function(id){
            port.emit('messageReplyTo', id);
        });

        this._createMenuItems();
    },

    _onceDestroy: function _onceDestroy() {
        this.destroy();
        this.coopfox = null;
        this.xmpp = null;
        this.port = null;
    },

    /////////////////////////////////////////////////////////////////

    _createMenuItems: function _createMenuItems() {
        var self = this;
        var window = self.coopfox.window;
        this._menuItems = [

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxRosterContextMenu',
                id: 'context-coopfox-roster-chat-add',
                before: 'context-coopfox-roster-rename-contact',
                separatorAfter: true,
                selectors: ['.roster-item'],
                label: 'Invite to Join My CoopChat',
                image: url('images/icon.png'),
                onShow: function onShow(target, contact) {
                    this.item.style.fontWeight = 'normal';
                    if (contact.classList.contains('participant-active')) {
                        this.hidden = true;
                    }
                    else if (!contact.classList.contains('coopfox')) {
                        this.disabled = true;
                    } else {
                        this.item.style.fontWeight = 'bold';
                        if (contact.classList.contains('participant-inactive')) {
                            this.label = 'Invite Back to CoopChat';
                        }
                    }
                },
                onClick: function onClick(target, contact) {
                    self.xmpp.addParticipant(contact.dataset.jid)
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-open-url',
                label: 'Open Link in Current Tab',
                acceltext: 'Mouse Left',
                selectors: ['.chat-history a[href]'],
                onShow: function onShow(target, link) {
                    var url = link.href;
                    if (!url.match(/^(https?|ftp):/i)) {
                        this.hidden = true;
                        return;
                    }
                    if (self.coopfox.browser.getTabsForUrl(url).length) {
                        this.label = 'Switch to Tab';
                        if (self.coopfox.browser.isActiveUrl(url)) {
                            this.disabled = true;
                        }
                    }
                },
                onClick: function onClick(target, link) {
                    self.coopfox.browser.openUrl(link.href, false, 'panel-context-menu');
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-open-url-newtab',
                label: 'Open Link in New Tab',
                acceltext: 'Mouse Middle',
                selectors: ['.chat-history a[href]'],
                onShow: function onShow(target, link) {
                    var url = link.href;
                    if (!url.match(/^(https?|ftp):/i)) {
                        this.hidden = true;
                    }
                },
                onClick: function onClick(target, link) {
                    self.coopfox.browser.openUrl(link.href, true, 'panel-context-menu');
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-copy-link-url',
                label: 'Copy Link URL',
                selectors: ['.chat-history a[href]'],
                onClick: function onClick(target, link) {
                    var match = link.href.match(/^(.+?)(#.*)?$/);
                    if (match) {
                        clipboard.set(match[1], 'text');
                    }
                }
            }),
            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-copy-link-text',
                label: 'Copy Link Text',
                selectors: ['.chat-history a[href]'],
                onShow: function onShow(target, link) {
                    var text = link.textContent;
                    if (text === link.href) {
                        this.hidden = true;
                    }
                },
                onClick: function onClick(target, link) {
                    clipboard.set(link.textContent, 'text');
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-copy',
                label: 'Copy',
                separatorBefore: true,
                onShow: function onShow(target) {
                    var selection = target.ownerDocument.defaultView.getSelection();
                    if (selection.isCollapsed || !selection.toString().trim().length){
                        this.hidden = true;
                    }
                    else if (!selection.containsNode(target, true)) {
                        this.hidden = true;
                    }
                },
                onClick: function onClick(target) {
                    var selection = target.ownerDocument.defaultView.getSelection();
                    clipboard.set(selection.toString().trim(), 'text');
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-copy-message',
                label: 'Copy Message Text',
                separatorBefore: true,
                selectors: ['.chat-history .message'],
                onClick: function onClick(target, message) {
                    var body = message.querySelector('.message-body');
                    if (body) {
                        clipboard.set(body.innerHTML.trim(), 'html');
                    }
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-reply-message',
                label: 'Add Comment',
                acceltext: 'Double-Click',
                separatorBefore: true,
                selectors: ['#chat-tab .message'],
                onCreate: function onCreate() {
                    this.item.style.fontWeight = 'bold';
                },
                /*onShow: function onShow(target) {
                    if (target.localName === 'a') {
                        this.hidden = true;
                    }
                },*/
                onClick: function onClick(target, message) {
                    var id = message.id;
                    self.port.emit('messageReplyTo', id);
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-delete-message',
                label: 'Delete Message',
                selectors: ['#chat-tab .chat-history li'],
                onShow: function onClick(target, message) {
                    if (message.classList.contains('status')) {
                        this.label = 'Delete Status Message';
                    }
                },
                onClick: function onClick(target, message) {
                    var id = message.id;
                    var msg = {
                        coopfox: {
                            chat: { action: 'delete', id: id }
                        }
                    };
                    if (message.classList.contains('status')) {
                        //status posts are not shared > immediate local delete
                        msg.$from = self.xmpp.rosterSelf.jid;
                        self._onIncomingMessage(msg);
                    } else {
                        self._onOutgoingMessage(msg);
                    }
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxPanelMenu',
                id: 'menu-coopfox-panel-undelete-message',
                label: 'Undelete Message',
                tooltiptext: 'Restore the last message deleted by any participant',
                separatorAfter: true,
                onShow: function onShow() {
                    if (!self._deleteHistory.length) {
                        this.disabled = true;
                    }
                },
                onClick: function onClick(menuButton) {
                    if (!self._deleteHistory.length) { return; }
                    var id = self._deleteHistory[self._deleteHistory.length -1];
                    var message = menuButton.ownerDocument.getElementById(id);
                    if (!message) { return; }
                    var msg = {
                        coopfox: {
                            chat: { action: 'undelete', id: id }
                        }
                    };
                    if (message.classList.contains('status')) {
                        //status posts are not shared > immediate local delete
                        msg.$from = self.xmpp.rosterSelf.jid;
                        self._onIncomingMessage(msg);
                    } else {
                        self._onOutgoingMessage(msg);
                    }
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxPanelMenu',
                id: 'menu-coopfox-panel-show-chat',
                type: 'checkbox',
                label: 'Show CoopChat',
                onShow: function onShow(menuButton) {
                    var tab = menuButton.ownerDocument.querySelector('#chat-tab-selector');
                    if (!tab.classList.contains('ui-state-disabled')) {
                        this.checked = true;
                    }
                },
                onClick: function onClick(menuButton) {
                    var hide = storage['chat-tab-hidden'] = this.checked;
                    if (hide) {
                        self.port.emit('tabHide', 'chat');
                    } else {
                        self.port.emit('tabShow', 'chat');
                    }
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxPanelMenu',
                id: 'menu-coopfox-panel-reset-session',
                separatorBefore: true,
                label: 'New CoopChat',
                tooltiptext: 'Delete the current CoopChat session and start a new one',
                onShow: function onShow(target, input) {
                    if (!self.xmpp.hasMessages) {
                        this.disabled = true;
                    }
                },
                onClick: function onClick(menuButton) {
                    var choice = confirmEx(
                        'New CoopChat',
                        'Delete the current CoopChat session and start a new one?'
                    );
                    if (choice === 0) {
                        self.coopfox.reset();
                    }
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxPanelMenu',
                id: 'menu-coopfox-panel-save-session',
                label: 'Save CoopChat',
                tooltiptext: 'Save the current CoopChat session to a file',
                onShow: function onShow(target, input) {
                    if (!self.xmpp.hasMessages) {
                        this.disabled = true;
                    }
                },
                onClick: function onClick(menuButton) {
                    var path = fileSavePrompt(self.coopfox.window, { '*.cfox': 'CoopFox Session' }, 'session.cfox');
                    if (!path) { return; }
                    files.open(path, 'w').writeAsync(JSON.stringify(self.xmpp.getMessages()));
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxPanelMenu',
                id: 'menu-coopfox-panel-load-session',
                label: 'Load CoopChat',
                tooltiptext: 'Replace the current CoopChat session with one loaded from a file',
                onClick: function onClick(menuButton) {
                    if (self.xmpp.hasMessages) {
                        var choice = confirmEx(
                            'Load CoopChat',
                            'Delete the current CoopChat session and load a new one?'
                        );
                        if (choice !== 0) {
                            return;
                        }
                    }
                    var path = fileOpenPrompt(self.coopfox.window, { '*.cfox': 'CoopFox Session' });
                    if (!path) { return; }
                    try {
                        var messages = JSON.parse(files.read(path));
                        self.coopfox.reloadFromImport(messages);
                    }
                    catch (e) {
                        console.exception(e);
                        alert('Load Error', e.message);
                    }
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxPanelMenu',
                id: 'menu-coopfox-panel-import-session',
                label: 'Import CoopChat',
                tooltiptext: 'Merge a saved CoopChat session into the current one',
                onClick: function onClick(menuButton) {
                    var path = fileOpenPrompt(self.coopfox.window, { '*.cfox': 'CoopFox Session' });
                    if (!path) { return; }
                    try {
                        var messages = JSON.parse(files.read(path));
                        self.xmpp.importMessages(messages);
                    }
                    catch (e) {
                        console.exception(e);
                        alert('Import Error', e.message);
                    }
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-copy-input',
                label: 'Copy',
                separatorBefore: true,
                selectors: ['input', 'textarea'],
                onShow: function onShow(target, input) {
                    if (input.selectionStart === input.selectionEnd) {
                        this.disabled = true;
                    }
                },
                onClick: function onClick(target, input) {
                    var start = input.selectionStart;
                    var length = input.selectionEnd - input.selectionStart;
                    clipboard.set(input.value.substr(start, length), 'text');
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-cut-input',
                label: 'Cut',
                selectors: ['input', 'textarea'],
                onShow: function onShow(target, input) {
                    if (input.selectionStart === input.selectionEnd) {
                        this.disabled = true;
                    }
                },
                onClick: function onClick(target, input) {
                    var start = input.selectionStart;
                    var end = input.selectionEnd;
                    clipboard.set(input.value.substr(start, end - start), 'text');
                    input.value = input.value.substr(0, start) + input.value.substr(end);
                    input.selectionStart = input.selectionEnd = start;
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-paste-input',
                label: 'Paste',
                selectors: ['input', 'textarea'],
                onShow: function onShow() {
                    var clip = clipboard.get('text');
                    if (!clip) {
                        this.disabled = true;
                    }
                },
                onClick: function onClick(target, input) {
                    var clip = clipboard.get('text');
                    var start = input.selectionStart;
                    var end = input.selectionEnd;
                    input.value = input.value.substr(0, start) + clip + input.value.substr(end);
                    input.selectionStart = input.selectionEnd = start + clip.length;
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-paste-send-input',
                label: 'Paste and Send',
                selectors: ['.chat-input-text'],
                onShow: function onShow(target, input) {
                    if (input.value.length) {
                        this.hidden = true;
                        return;
                    }
                    var clip = clipboard.get('text');
                    if (!clip) {
                        this.disabled = true;
                    }
                },
                onClick: function onClick(target, input) {
                    input.value = clipboard.get('text').trim();
                    input.parentElement.querySelector('.chat-input-submit').click();
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

    /**
     * Initiate per-user elements such as the chat state overlay in the frontend.
     *
     * @param {string} jid
     */
    _onParticipantAdded : function _onParticipantAdded(jid) {
        this.port.emit('addContact', this.xmpp.getContact(jid));
    },

    _onIncomingMessage: function _onIncomingMessage(message) {

        if (message.coopfox && message.coopfox.chat) {
            let chat = message.coopfox.chat;
            switch (chat.action) {
                case 'delete':
                    this._deleteHistory.push(chat.id);
                break;
                case 'undelete':
                    this._deleteHistory.splice(this._deleteHistory.indexOf(chat.id), 1);
                break;
            }
        }

        var args = {
            message: message,
            sender:  this.xmpp.getContact(message.$from),
            threadTime: this.xmpp.getThreadTime()
        };
        try {
            this.coopfox.emit('beforeDisplayMessage', args);
            console.info('Message from "' + message.$from.bare + '"');
            this.port.emit('message', args);
            this.coopfox.emit('afterDisplayMessage', args);
        }
        catch (e) {
            console.exception(e);
        }
    },

    /**
     * Send an XMPP message stanza to all participating contacts.
     *
     * Default arguments: type -> "chat"; id -> random string
     * CoopFox location is included in each message stanza.
     *
     * @param {object} message      A stanza object.
     * @param {string} chatState    A defined chat state (defaults to "active")
     */
    _onOutgoingMessage : function _onOutgoingMessage(message, chatState) {
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
        this.xmpp.sendMessage(message);
    },

    _onThreadTimeCorrected: function _onThreadTimeCorrected(diff) {
        this.port.emit('addTimeOffset', diff);
    }

});

function onCoopfoxInit(event) {
    Chat(event.subject);
}

//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-init', onCoopfoxInit, true);
unloader.when(function() {
    sysEvents.off('coopfox-init', onCoopfoxInit);
});