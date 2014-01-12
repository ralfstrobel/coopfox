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

    const { $tabContent, $tabSelector } = createTab('results', 'Results', 'chat');
    $tabContent.addClass('coopchat');

    const $wrapper = $('<div class="chat-history-wrapper"></div>').appendTo($tabContent);
    const $scroller = $('<div class="chat-history-scroller"></div>').appendTo($wrapper);
    const $list = $('<ul class="chat-history"></ul>').appendTo($scroller);
    $('<div>&nbsp;</div>').appendTo($wrapper); //Box elements without any non-absolute positioned content break layout

    const viewport = $scroller[0];

    function scrollTo(id, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        var msg = viewport.querySelector('.message.' + id);
        if (!msg) { return; }

        $tabSelector.click();
        if (viewport.offsetHeight < viewport.scrollHeight) {
            let top = msg.offsetTop - (viewport.offsetHeight / 2) + (msg.offsetHeight / 2);
            viewport.scrollTop = Math.min(top, viewport.scrollTopMax);
        }
        msg.click();
    }

    function chatScrollTo(id, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        globalEvents.trigger('messageScrollTo', [id, true]);
    }

    function sendPrioChange(id, action) {
        self.port.emit('message', {
            coopfox: {
                result: { action: action, id: id }
            }
        });
    }

    function createResult($msg) {
        $msg.addClass('result');
        $msg.children('.meta').prepend('<span class="result-priority">0</span>');
        var $result = refreshResult($msg, true);

        let refreshTimeout = null;
        let observer = new MutationObserver(function(mutations) {
            if (!refreshTimeout) {
                refreshTimeout = setTimeout(function() {
                    refreshTimeout = null;
                    refreshResult($msg);
                });
            }
        });
        $msg.data('results-observer', observer);

        observer.observe($msg[0], {
            attributes : true,
            childList : true,
            subtree : true,
            characterData : false
        });

        highlightTab('results');
        return $result;
    }

    function refreshResult($msg, autoCreate) {
        var id = $msg.attr('id');
        var $oldResult = $list.find('.' + id);
        var $result = $msg.clone().addClass(id).removeAttr('id');
        if ($oldResult.length) {
            $oldResult.replaceWith($result);
        } else {
            if (!autoCreate) {
                return;
            }
            $result.appendTo($list);
        }

        var $meta = $result.children('.meta');
        var $up = $('<button class="result-prio-change result-prio-up">+</button>').appendTo($meta);
        var $down = $('<button class="result-prio-change result-prio-down">−</button>').appendTo($meta);

        $up.click(sendPrioChange.bind(null, id, 'up'));
        $down.click(sendPrioChange.bind(null, id, 'down'));

        $result.click(function(event){
            if (event.which === 1) {
                if (event.originalEvent && (event.originalEvent.originalTarget.localName === 'a')) {
                    return;
                }
                event.stopPropagation();
                $msg.click();
            }
        });
        $result.dblclick(function(event) {
            if (event.originalEvent && (event.originalEvent.originalTarget.localName === 'button')) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            $('#chat-tab-selector a').click();
            $msg.dblclick();
        });

        var $prio = $result.find('.result-priority');
        var $msgPrio = $msg.find('.result-priority');

        $msgPrio.click(scrollTo.bind(null, id));
        $prio.click(chatScrollTo.bind(null, id));

        $result[0].dataset.messageId = id;
        $result[0].dataset.priority = $msgPrio.text() || 0;

        return $result;
    }

    function destroyResult($msg) {
        var $result = $('.' + $msg.attr('id'), $list).first();
        $msg.data('results-observer').disconnect();
        $result.remove();
        $msg.find('.result-priority').remove();
        $msg.removeClass('result');
        if (!$list.children().length) {
            hideTab('results');
        }
    }

    function upResult($msg) {
        var $result = $('.' + $msg.attr('id'), $list).first();
        if (!$result.length) {
            $result = createResult($msg);
        }
        var prio = ++$result[0].dataset.priority;
        var $prio = $('.result-priority', $msg);
        $prio.text(prio);
        if (prio === 0) {
            $prio.removeClass('negative');
        }
    }

    function downResult($msg) {
        var $result = $('.' + $msg.attr('id'), $list).first();
        if (!$result.length) { return; }
        var prio = --$result[0].dataset.priority;
        var $prio = $('.result-priority', $msg);
        $prio.text(prio);
        if (prio === -1) {
            $prio.addClass('negative');
        }
    }

    function sortResults() {
        var items = $list.children().get();
        items.sort(function compare(a, b) {
            var prioA = a.dataset.priority;
            var prioB = b.dataset.priority;
            if (prioA > prioB){ return -1; }
            if (prioA < prioB){ return 1; }

            var timeA = a.dataset.timestamp;
            var timeB = b.dataset.timestamp;
            if (timeA > timeB){ return 1; }
            if (timeA < timeB){ return -1; }

            return 0;
        });
        $.each(items, function(i, item) { $list.append(item); });
    }

    globalEvents.on('chatMessageReceived', function(event, args) {
        if (!args.message.coopfox) { return; }
        var res = args.message.coopfox.result;
        if (!res || !res.id) { return; }
        var id = res.id;

        var $msg = $('#chat-tab #' + id);
        if (!$msg.length) {
            console.error('Unknown message id for result action: ' + id);
            return;
        }

        switch (res.action) {
            case 'up':
                upResult($msg);
            break;
            case 'down':
                downResult($msg);
            break;
            case 'remove':
                destroyResult($msg);
            break;
        }

        sortResults();
        args.handled = true;
    });

    //middle mouse button double click detection
    const mClickMessageTimes = new WeakMap();

    $('.coopchat .chat-history').on('mousedown', '.message', function(event) {
        if (event.which === 2) {
            var now = Date.now();
            var message = event.currentTarget;
            if (now - mClickMessageTimes.get(message, 0) < 500) {
                event.preventDefault();
                event.stopPropagation();
                mClickMessageTimes.delete(message);

                let id = message.id || message.dataset.messageId;
                if (!id) { return; }

                if (event.altKey || event.shiftKey) {
                    sendPrioChange(id, 'down');
                } else {
                    sendPrioChange(id, 'up');
                }
            } else {
                mClickMessageTimes.set(message, now);
            }
        }
    });

});