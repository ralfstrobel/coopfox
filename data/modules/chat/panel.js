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

function chatPrintContactName(contact) {
    var id = contact.id || jidToClass(contact.jid);
    var name = contact.name;
    if (!name) {
        if (contact.jid) {
            if (typeof(contact.jid) === 'string') {
                name = contact.jid;
            } else {
                name = contact.jid.username;
            }
        } else {
            name = 'Anonymous';
        }
    }
    return '<span class="contact-color ' + id + '">' + name.replace(' ', '&nbsp;') + '</span>';
}

var coopChatMain = null;

jQuery(function($) {

    const { $tabContent, $tabSelector } = createTab('chat', 'CoopChat');
    $tabContent.addClass('coopchat');

    const chat = coopChatMain = new ChatBox($tabContent);
    const contacts = {};

    var $noMessages = $('<li class="no-messages">Please Wait...</li>').appendTo(chat.$history);

    ////////////////////////////////////////////////////

    $tabs.on('tabsactivate', function(event, ui) {
        if (ui.newPanel.is($tabContent)) {
            chat.input.$input.focus();
        }
    });

    ///////////////////////////////////////////////////////////////////////////////////////////////

    self.port.on('message', function(args) {

        args.postType = 'message';
        args.extraClasses = [];

        globalEvents.trigger('chatMessageReceived', [args]);
        if (args.handled) { return; }

        var contact = args.sender;
        var msg = args.message;

        chat.setChatStateFromMessage(msg);

        if (msg.coopfox) {
            let cf = msg.coopfox;

            if (cf.participant) {
                let participant = cf.participant;
                let jidClass = jidToClass(participant.jid || msg.$from.bare);
                switch (participant.action) {
                    case 'join':
                        if (msg.type === 'headline') { return; } //directed join request
                        args.postType = 'status';
                        args.extraClasses.push('join');
                        args.extraClasses.push('join-' + jidClass);
                        if (participant.jid !== msg.$from.bare) {
                            let newContact = contacts[participant.jid] || { jid: participant.jid };
                            msg.body = { $text: 'added ' + chatPrintContactName(newContact) };
                            if (participant.thread.$text === msg.thread.$text) {
                                msg.body.$text += ' to the session.'
                            } else {
                                msg.body.$text += ' to a session (imported).'
                            }
                        }
                        else if (participant.thread.creator === 'true') {
                            if (participant.thread.$text === msg.thread.$text) {
                                msg.body = { $text: 'created the session.' };
                            } else {
                                msg.body = { $text: 'created a session (imported).' };
                            }
                        }
                        else {
                            msg.body = { $text: 'joined the session.' };
                        }
                    break;
                    case 'reject':
                        let $msg = $('.join-' + jidClass, chat.$history).last();
                        $msg.addClass('rejected');
                        $msg.nextAll('.status.' + jidClass).remove();
                    return;
                    default:
                        //leave case is covered by 'rosterUpdate'
                    return;
                }
            }

            if (cf.chat) {
                let $msg = cf.chat.id ? $('#' + cf.chat.id, chat.$history) : $();
                switch (cf.chat.action) {
                    case 'delete':
                        if ($msg.hasClass('message') && (args.threadTime - msg.$timestamp < 2000)) {
                            let $del = $msg.clone().removeAttr('id');
                            $del.find('.message-body')
                                .html('Deleted by ' + chatPrintContactName(args.sender))
                                .css('font-style', 'italic');
                            $del.insertAfter($msg).fadeOut(2000, function(){ $(this).remove() });
                        }
                        $msg.hide();
                    break;
                    case 'undelete':
                        if ($msg.hasClass('message') && (args.threadTime - msg.$timestamp < 500)) {
                            $msg.fadeIn(500);
                        } else {
                            $msg.show();
                        }
                    break;
                    case 'select':
                        let classes = 'user-selection contact-color ' + jidToClass(contact.jid);
                        chat.removeRadarAll(classes);
                        $('.' + classes.replace(/\s/g, '.'), chat.$history).remove();
                        if ($msg.length) {
                            let $meta = $msg.children('.meta');
                            $meta.prepend('<span class="' + classes + '"></span>');
                            if (!contact.isSelf) {
                                chat.insertRadar(cf.chat.id, classes);
                            }
                        }
                    break;
                }
                delete msg.body;
            }
        }

        if ($noMessages) {
            $noMessages.remove();
            $noMessages = null;
        }

        args.$message = chat.postMessage(msg, args.sender, args.postType, args.extraClasses);
        if (!args.$message) { return; }
        globalEvents.trigger('chatMessagePost', [args]);

        if (args.postType === 'message') {
            highlightTab('chat');
        }
    });

    self.port.on('addTimeOffset', chat.addTimeOffset);

    self.port.on('rosterUpdate', function(args) {
        var contact = args.contact;
        if (!contact || !contacts[contact.jid.bare]) { return; }
        contacts[contact.jid.bare] = contact;

        switch (args.reason) {
            /*case 'presence':
                let presence = contact.presence.$primary;
                let presenceName = presence.type ?
                    presence.type.charAt(0).toUpperCase() + presence.type.slice(1).toLowerCase() : 'Online';
                if (presenceName === 'Unavailable') {
                    presenceName = 'Offline';
                }

             args.statusMessage = 'Is now <em>' + presenceName + '</em>.';

            break;*/
            case 'participantActive':
                args.statusMessage = 'is now active.';
            break;
            case 'participantInactive':
                args.statusMessage = 'is now inactive.';
            break;
            default:
                globalEvents.trigger('chatContactStatus', [args]);
            break;
        }

        if (!args.statusMessage) { return; }

        args.$status = chat.postStatus(args.statusMessage, contact);
        globalEvents.trigger('chatContactStatusPost', [args]);
    });


    self.port.on('addContact', function(contact) {
        var jid = contact.jid.bare;
        contacts[jid] = contact;

        if (!contact.isSelf) {
            chat.addChatState(jid, contact.name);
        }

    });

    function chatMessageSend(event, message) {
        globalEvents.trigger('chatMessageSend', [message, this]);
        if (message.body && message.body.$text) {
            self.port.emit('message', message);
        }
    }

    function chatStateSend(event, state) {
        var args = {
            message: { $noEcho: true },
            state: state,
            input: this
        };
        globalEvents.trigger('chatStateSend', [args]);
        self.port.emit('message', args.message, args.state);
    }

    var replyInput = null;
    function chatMessageReply(id) {
        var $message = $('#' + id + '.message', chat.$history);
        if (!$message.length) { return; }

        while ($message.is('.chat-history-subthread li')) {
            $message = $message.parents('.chat-history li').first();
        }

        if (replyInput) {
            replyInput.destroy();
        }
        replyInput = new ChatInput($message, true);
        replyInput.$input.focus();

        $(replyInput)
        .on('submit', function(event, message) {
            message.thread = { $text: $message.attr('id') };
            chatMessageSend.apply(this, arguments);
            replyInput.destroy();
        })
        .on('cancel', function() {
            replyInput.destroy();
        });

        chat.input.$input.on('focus', function() {
            if (!replyInput.$input.val().trim().length) {
                replyInput.destroy();
            }
        });

        chat.disableAutoScroll();
        $(replyInput).on('beforeDestroy', function() {
            chat.enableAutoScroll();
        });
    }

    var _currentMessageSelect = null;
    function chatMessageSelect(id) {
        if (id !== _currentMessageSelect) {
            _currentMessageSelect = id;
            let msg = {
                type: 'headline',
                coopfox: { chat: { action: 'select' } }
            };
            if (id) {
                msg.coopfox.chat.id = id;
            }
            self.port.emit('message', msg);
        }
    }

    function chatMessageScrollTo(id, select) {
        var $msg = $('#' + id, chat.$history);
        if ($msg.length) {
            $tabSelector.click();
            chat.scrollToMessage(id);
            if (select) {
                $msg.click();
            }
        }
    }

    $(chat.input).on('submit', chatMessageSend);
    $(chat.input).on('state', chatStateSend);
    self.port.on('messageReplyTo', chatMessageReply);
    self.port.on('messageScrollTo', chatMessageScrollTo);
    globalEvents.on('messageScrollTo', function(event, id, select) {
        chatMessageScrollTo(id, select);
    });

    chat.$history
        .on('click', '.message', function(event) {
            if (!event.which || (event.which === 1)) {
                if (!event.originalEvent || (event.originalEvent.originalTarget.localName !== 'a')) {
                    event.stopPropagation();
                    chatMessageSelect(this.id);
                }
            }
        })
        .on('dblclick', '.message', function(event) {
            event.stopPropagation();
            chatMessageReply(this.id);
        });

    $(document)
        .click(function(event) {
            if (event.which === 1) {
                chatMessageSelect(null);
            }
        })
        .blur(function() {
            chatMessageSelect(null);
        });

});
