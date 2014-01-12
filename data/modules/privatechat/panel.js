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

jQuery(function($) {

    function ChatTab(contact) {

        const $this = $(this);
        const jid = contact.jid.bare;
        const id = jidToClass(jid);
        const tabId = 'chat-' + id;

        const { $tabContent, $tabSelector } = createTab(tabId, contact.name, 'chat');
        const $tabClose = addTabCloseButton(tabId);

        const chat = this.chat = new ChatBox($tabContent);
        chat.addChatState(jid, contact.name);

        function onTabsActivate(event, ui) {
            if (ui.newPanel.is($tabContent)) {
                chat.input.$input.focus();
            }
        }

        $tabs.on('tabsactivate', onTabsActivate);

        this.postMessage = function postMessage(message, contact) {
            chat.setChatStateFromMessage(message);
            if (!message.body || !message.body.$text) { return; }
            highlightTab(tabId);
            return chat.postMessage(message, contact);
        };

        this.rosterUpdate = function rosterUpdate(cnt, reason) {
            if (cnt.presence.$primary.type !== contact.presence.$primary.type) {
                if (cnt.presence.$primary.type === 'unavailable') {
                    chat.postStatus('is now offline.', cnt);
                } else {
                    chat.postStatus('is now online.', cnt);
                }
            }
            contact = cnt;
        };

        if (contact.presence.$primary.type === 'unavailable') {
            chat.postStatus('is offline.', contact);
        }

        $(chat.input).on('submit', function(event, message) {
            globalEvents.trigger('privateChatMessageSend', [message, jid]);
            if (message.body && message.body.$text) {
                self.port.emit('privateChatMessage', message, jid);
            }
        });

        $(chat.input).on('state', function(event, state) {
            var args = {
                message: { $noEcho: true },
                state: state,
                input: this
            };
            globalEvents.trigger('privateChatStateSend', [args, jid]);
            self.port.emit('privateChatMessage', args.message, jid, args.state);
        });

        this.activate = function activate() {
            $tabSelector.click();
        };

        this.destroy = function destroy() {
            $this.trigger('beforeDestroy');
            globalEvents.trigger('privateChatDestroy', [jid]);
            self.port.emit('privateChatDestroy', jid);
            $tabs.off('tabsactivate', onTabsActivate);
            chat.destroy();
            removeTab(tabId);
        };

        $tabClose.on('click', this.destroy);

        globalEvents.trigger('privateChatCreate', [jid]);
        self.port.emit('privateChatCreate', jid);
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////

    const chats = {};

    self.port.on('privateChatMessage', function(args) {
        globalEvents.trigger('privateChatMessageReceived', [args]);
        if (args.handled) { return; }

        var message = args.message;
        var contact = args.sender;

        var jid = contact.isSelf ? message.$to.bare : message.$from.bare;
        if (!chats[jid]) { return; }

        args.$message = chats[jid].postMessage(message, contact);
        if (!args.$message) { return; }
        globalEvents.trigger('privateChatMessagePost', [args]);
    });

    self.port.on('privateChatCreate', function(contact, activate) {
        var jid = contact.jid.bare;
        if (!chats[jid]) {
            let chatTab = chats[jid] = new ChatTab(contact);
            $(chatTab).on('beforeDestroy', function() {
                delete chats[jid];
            });
            if (activate) {
                chatTab.activate();
            }
        }
    });

    self.port.on('rosterUpdate', function(args) {
        var contact = args.contact;
        var jid = contact.jid.bare;
        if (chats[jid]) {
            chats[jid].rosterUpdate(contact, args.reason);
        }
    });

});
