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

/**
 * @param {jQuery} $container
 * @param {boolean} showCancel
 * @constructor
 */
function ChatInput($container, showCancel) {
    const $this = $(this);

    const $inputWrapper = $('<div class="chat-input"></div>').appendTo($container);
    const $inputForm = $('<form>').appendTo($inputWrapper);
    const $input = this.$input = $('<input class="chat-input-text" type="text" />').appendTo($inputForm);
    const $sendButton = $('<input class="chat-input-submit" type="button" value="Send" />').appendTo($inputForm);
    if (showCancel) {
        const $cancel = $('<input class="chat-input-cancel" type="button" value="Cancel" />').appendTo($inputForm);
    }

    $inputWrapper.click(function(event) {
        event.stopPropagation();
    });

    var chatState = 'active';
    var compose_timeout = null;

    function setChatState(state) {
        if (chatState != state) {
            $this.trigger('state', [state]);
            chatState = state;
        }
    }

    /**
     * Capture key press event on chat input field.
     *
     * Enter key (13) triggers submission.
     *
     * All other keys change the chat state to 'composing'
     * for three seconds, after which it is either set to
     * 'paused' if the user still has text entered or back
     * to 'active' (default) if the text field is empty.
     */
    $input.keypress(function(event) {
        event.stopPropagation();
        if (compose_timeout) {
            clearTimeout(compose_timeout);
            compose_timeout = null;
        }
        if (event.keyCode === 27) {
            if (showCancel) {
                $cancel.click();
            }
        }
        else if (event.keyCode === 13) {
            event.preventDefault();
            $sendButton.click();
        }
        else {
            setChatState('composing');
            compose_timeout = setTimeout(function() {
                compose_timeout = null;
                if ($input.val().length) {
                    setChatState('paused');
                } else {
                    setChatState('active');
                }
            }, 3000);
        }
    });

    $sendButton.click(function() {
        var msg = {
            body : {
                $text : $input.val().trim()
            }
        };

        $this.trigger('submit', [msg]);
        $input.val('');

        //don't sent separate chatState event
        //chatState 'active' is sent with every message
        chatState = 'active';
    });

    if (showCancel) {
        $cancel.click(function() {
            $this.trigger('cancel');
        });
    }

    this.destroy = function destroy() {
        $this.trigger('beforeDestroy');
        $inputWrapper.remove();
        $this.off();
    };

}

/**
 * @param {jQuery} $container
 * @constructor
 */
function ChatBox($container) {
    const chat = this;
    const $this = $(this);

    const $historyWrapper = this.$wrapper = $('<div class="chat-history-wrapper"></div>').appendTo($container);
    const $historyScroller = this.$scroller = $('<div class="chat-history-scroller"></div>').appendTo($historyWrapper);
    const $history = this.$history = $('<ul class="chat-history"></ul>').appendTo($historyScroller);
    const $chatstates = $('<div class="chat-states"></div>').appendTo($historyScroller);
    const input = this.input = new ChatInput($container);

    const $unseenAbove = $('<div class="chat-unseen-above contact-color blinking"></div>')
        .hide().appendTo($historyWrapper);
    const $unseenBelow = $('<div class="chat-unseen-below contact-color blinking"></div>')
        .hide().appendTo($historyWrapper);

    const chatStates = {};
    const viewport = $historyScroller[0];

    var noAutoScroll = 0;
    //var senderMaxWidth = 0;

    function viewportOffsetTop(element) {
        var top = 0;
        for (let el = element; el.offsetParent && (el !== viewport); el = el.offsetParent) {
            top += el.offsetTop;
        }
        return top;
    }

    this.messageOffsetTop = function messageOffsetTop(id) {
        return viewportOffsetTop(document.getElementById(id));
    };
    this.messageOffsetTopPercent = function messageOffsetTopPercent(id, margin) {
        var element = document.getElementById(id);
        var top = viewportOffsetTop(element);
        var ratio = top / (viewport.scrollHeight - element.offsetHeight);
        var relMargin = (margin || 0) / viewport.offsetHeight;
        var scale = 1 - (2 * relMargin);
        return (((ratio * scale) + relMargin) * 100).toFixed(2) + '%';
    };

    function scrollTo(element) {
        if (!element || !element.offsetParent || !element.offsetHeight) { return; }
        var top = viewportOffsetTop(element) - (viewport.offsetHeight / 2) + (element.offsetHeight / 2);
        viewport.scrollTop = Math.min(top , viewport.scrollTopMax);
    }

    this.scrollToMessage = function scrollToMessage(id) {
        scrollTo(document.getElementById(id));
    };
    this.isScrolling = function isScrolling() {
        return viewport.scrollHeight > viewport.offsetHeight;
    };
    this.disableAutoScroll = function disableAutoScroll() {
        noAutoScroll++;
    };
    this.enableAutoScroll = function enableAutoScroll() {
        noAutoScroll = Math.max(noAutoScroll - 1, 0);
    };

    var _markSeenItemsTimeout = null;
    function doMarkSeenItems() {
        _markSeenItemsTimeout = null;
        var viewport_top = viewport.scrollTop;
        var viewport_bottom = viewport_top + viewport.offsetHeight;
        var lastAbove = null;
        var firstBelow = null;

        $('li.unseen', $history).each(function() {
            var top = viewportOffsetTop(this);
            var bottom = top + this.offsetHeight;

            var $this = $(this);
            if ((top >= viewport_top) && (bottom <= viewport_bottom)) {
                if (!$this.hasClass('unseen-unknown')) {
                    //animate selected children (must happen explicitly)
                    let $children = $this.find('.sender, .message-body, .contact-color, .time, a[href]');
                    $children.addClass('unseen').switchClass('unseen', '', 5000);
                }
                $this.removeClass('unseen');
                $this.trigger('seen');
            }
            else {
                if (top < viewport_top) {
                    lastAbove = this;
                }
                if (bottom > viewport_bottom) {
                    if (!firstBelow) {
                        firstBelow = this;
                    }
                }
            }
            $this.removeClass('unseen-unknown');
        });

        if (lastAbove) {
            copyJidClass(lastAbove, $unseenAbove[0]);
            $unseenAbove.data('message', lastAbove).show();
        } else {
            $unseenAbove.hide();
        }
        if (firstBelow) {
            copyJidClass(firstBelow, $unseenBelow[0]);
            $unseenBelow.data('message', firstBelow).show();
        } else {
            $unseenBelow.hide();
        }

    }
    function markSeenItems() {
        if (!_markSeenItemsTimeout) {
            _markSeenItemsTimeout = setTimeout(doMarkSeenItems);
        }
    }
    $historyScroller.scroll(markSeenItems).resize(markSeenItems);

    $unseenAbove.click(function() {
        scrollTo($unseenAbove.data('message'));
    });
    $unseenBelow.click(function() {
        scrollTo($unseenBelow.data('message'));
    });

    /**
     * Inserts a new element into the history at the correct position.
     * Scrolls the view to the new element if we are in the same sub-thread.
     *
     * @param {jQuery}  $newEl       New <li> element to insert.
     * @param {object}  message      The original message the element is based on.
     * @param {boolean} fromSelf
     */
    function historyInsert($newEl, message, fromSelf) {
        var timestamp = message.$timestamp;
        $newEl[0].dataset.timestamp = timestamp;
        var $parent = $history;

        if (message.thread && message.thread.$text) {
            let $msg = $('#' + message.thread.$text);
            if ($msg.length) {
                $parent = $msg.children('ul');
                if (!$parent.length) {
                    $parent = $('<ul class="chat-history-subthread"></ul>').appendTo($msg);
                }
            }
        }

        //find correct spot for insertion, based on message time
        //bypass jQuery for improved performance
        var after = $parent[0].lastElementChild;
        while (after && (after.dataset.timestamp > timestamp)) {
            after = after.previousElementSibling;
        }

        var atBottom = (after === $history[0].lastElementChild);
        var scrollBottom = (viewport.scrollTopMax - viewport.scrollTop < 20) || (fromSelf && atBottom);

        if (!after) {
            $newEl.prependTo($parent);
        } else {
            $newEl.insertAfter(after);
        }

        //ensure that all sender elements have equal width for justified align
        /*var $sender = $('.sender', $newEl);
         var senderWidth = $sender.width();

         if (!senderMaxWidth) {
         senderMaxWidth = senderWidth;
         } else if (senderWidth > senderMaxWidth) {
         senderMaxWidth = senderWidth;
         $('.sender', $history).width(senderMaxWidth);
         } else if (senderWidth < senderMaxWidth) {
         $sender.width(senderMaxWidth);
         }*/

        if (scrollBottom && !noAutoScroll) {
            viewport.scrollTop = viewport.scrollTopMax;
        }

        var isNew = (message.$received || 0) > (Date.now() - 5000);

        if (isNew && !fromSelf) {
            $newEl.addClass('unseen');
            if (atBottom && !activeBulkUpdate) {
                $newEl.addClass('unseen-unknown');
            }
            markSeenItems();
        }
    }

    this.addChatState = function addChatState(jid, name) {
        if (chatStates[jid]) {
            chatStates[jid].remove();
        }
        chatStates[jid] = $(
            '<div class="inactive">' +
                '<span class="sender ' + jidToClass(jid) + '">' + name + '</span>' +
                '</div>'
        ).appendTo($chatstates);
    };

    this.setChatState = function setChatState(state, jid) {
        if (!jid) {
            //allow call without second argument for one-on-one chat
            jid = Object.keys(chatStates).pop();
        }
        if (chatStates[jid]) {
            let wasScrollBottom = viewport.scrollTopMax - viewport.scrollTop < 20;
            chatStates[jid].attr('class', state);
            if (wasScrollBottom && !noAutoScroll) {
                viewport.scrollTop = viewport.scrollTopMax;
            }
        }
    };

    this.setChatStateFromMessage = function setChatStateFromMessage(msg) {
        for (let i in msg) {
            if (typeof(msg[i]) === 'object') {
                if (msg[i].xmlns == 'http://jabber.org/protocol/chatstates') {
                    this.setChatState(i, msg.$from.bare);
                }
            }
        }
    };

    var timeOffset = 0;
    this.addTimeOffset = function addTimeOffset(diff) {
        timeOffset += diff;
    };

    this.postMessage = function postMessage(msg, contact, type, extraClasses) {
        if (!msg.body || !msg.body.$text) { return null; }
        if (!msg.id || document.getElementById(msg.id)) {
            console.warn('Ignored message with invalid or duplicate id: ' + msg.id);
            return;
        }

        var classes = type || 'message';
        if (extraClasses && extraClasses.length) {
            classes += ' ' + extraClasses.join(' ');
        }

        var $message = $(
            '<li class="' + classes + '" id="' + msg.id + '">' +
                '<span class="sender">' + contact.name + '</span>' +
                '<span class="message-body">' + linkify(msg.body.$text) + '</span>' +
                '</li>'
        );
        $message.addClass(jidToClass(contact.jid));

        if (msg.$timestamp) {
            //reverse-correct timestamp, so that messages show up in local system time
            msg.$timestamp -= timeOffset;
        } else {
            msg.$timestamp = Date.now();
        }
        var date = new Date(msg.$timestamp);
        var shortDate = date.toLocaleFormat('%H:%M');
        var longDate = date.toLocaleString(null, {
            weekday: 'long',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        $message.prepend(
            '<div class="meta">' +
                '<span class="time" title="' + longDate + '">' + shortDate + '</span>' +
            '</div>'
        );

        historyInsert($message, msg, contact.isSelf);
        return $message;
    };

    this.postStatus = function postStatus(text, contact) {
        return this.postMessage({ id: randomID(), body: { $text: text } }, contact, 'status');
    };

    var radarCreateQueue = [];
    var radarInsertQueue = [];
    var radarRemoveQueue = [];
    var radarUpdateTimeout = null;

    /**
     * @param {string} messageId
     * @param {string} classes
     */
    this.insertRadar = function insertRadar(messageId, classes) {
        if (viewport.offsetParent === null) {
            //can't render now because scroller is hidden
            radarCreateQueue.push({ messageId: messageId, classes: classes });
            return;
        }
        if (!this.isScrolling()) { return; }

        let $radar =  $('<div class="radar ' + classes + '"></div>');
        let topPercent = this.messageOffsetTopPercent(messageId, 20);
        $radar.css('top', 'calc(' + topPercent + ' - 10px + 1em)');
        $radar.click(function() {
            chat.scrollToMessage(messageId);
        });
        radarInsertQueue.push($radar);

        if (!radarUpdateTimeout) {
            //don't insert immediately, because this would force a reflow on next messageOffsetTopPercent()
            radarUpdateTimeout = setTimeout(radarUpdateFlush);
        }
    };

    this.removeRadarAll = function removeRadarAll(classes) {
        radarRemoveQueue.push('.radar.' + classes.trim().replace(/\s/g, '.'));
        if (!radarUpdateTimeout) {
            radarUpdateTimeout = setTimeout(radarUpdateFlush);
        }
        radarCreateQueue = radarCreateQueue.filter(function(item) {
            return item.classes !== classes;
        });
    };

    function radarUpdateFlush() {
        radarUpdateTimeout = null;
        while (radarRemoveQueue.length) {
            let selector = radarRemoveQueue.pop();
            $(selector, $historyWrapper).remove();
        }
        while (radarInsertQueue.length) {
            let radar = radarInsertQueue.pop();
            $historyWrapper.append(radar);
        }
    }

    $tabs.on('tabsactivate', function() {
        if (viewport.offsetParent !== null) {
            while (radarCreateQueue.length) {
                let args = radarCreateQueue.pop();
                chat.insertRadar(args.messageId, args.classes);
            }
        }
    });

    this.destroy = function destroy() {
        if (radarUpdateTimeout) {
            clearTimeout(radarUpdateTimeout);
        }
        $this.trigger('beforeDestroy');
        $historyWrapper.remove();
        input.destroy();
        $this.off();
    };

}
