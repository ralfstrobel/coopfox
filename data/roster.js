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

"use strict";

const NS_COOPFOX = self.options.NS_COOPFOX;
const NODE_COOPFOX = self.options.NODE_COOPFOX;

/**
 * Target vor generic global events, to be used with .on() and .trigger().
 *
 * @type {jQuery}
 */
const globalEvents = $({});

/**
 * Allows to assign listeners for global events to any jQuery element collection.
 * The listeners will be called upon the event with "this" referring to elements.
 *
 * @param {string} event
 * @param {function} handler
 */
$.fn.onGlobal = function onGlobal(event, handler) {
    globalEvents.on(event, this, function(e) { handler.call(e.data); });
};

$(document)
    .on('submit', 'form', function(event) {
        event.preventDefault();
    })
    .on('click', 'a', function(event) {
        event.preventDefault();
        var href = event.currentTarget.href;
        if (href && href.match(/^(https?|ftp):/i)) {
            self.port.emit('linkClick', href);
        }
    })
    .on('mousedown', 'a', function(event) {
        if (event.which === 2) { //middle click
            event.preventDefault();
            var href = event.currentTarget.href;
            if (href && href.match(/^(https?|ftp):/i)) {
                self.port.emit('linkClick', href, true);
            }
        }
    })
    .on('mouseenter', '.hoverable', function() {
        $(this).children('.hovershow').stop(true, true).delay(250).slideDown(250);
    })
    .on('mouseleave', '.hoverable', function() {
        $(this).children('.hovershow').stop(true, true).delay(250).slideUp(250);
    });

/**
 * @param {string|string[]} rules
 */
function addDocumentStyleRules(rules) {
    if (!Array.isArray(rules)) {
        rules = [rules];
    }
    var style = document.styleSheets[0];
    for each (let rule in rules) {
        style.insertRule(rule, style.cssRules.length);
    }
}

function jidToId(jid) {
    if ((typeof(jid) === 'object') && (jid.bare)) {
        jid = jid.bare;
    }
    if (typeof(jid) !== 'string') {
        jid = 'unknown';
    }
    return 'jid-' + jid.replace(/\W/g, '-');
}

/**
 * Generates a human readable description of the
 * time that has passed since a given date.
 *
 * @param {number} date
 */
function timeSince(date) {
    var now = Date.now();
    var seconds = Math.floor((now - date) / 1000);

    var hours = Math.floor(seconds / 3600);
    if (hours > 1) {
        return hours + ' hours ago';
    }
    var minutes = Math.floor(seconds / 60);
    if (minutes > 1) {
        return minutes + ' minutes ago';
    } else if (minutes == 1) {
        return 'one minute ago';
    }
    if (seconds > 5) {
        return seconds + ' seconds ago';
    } else {
        return 'now!';
    }
}


const rosterItems = {};

/**
 * Implement the basic roster behaviour.
 * Modules should to listen to the global "rosterItemRender" event
 * in order to modify roster items whenever they are changed.
 */
jQuery(function($) {

    const $roster = $('#roster');

    /**
     * Re-sorts all existing roster items.
     * Active participants always appear on top.
     * Any other items are ordered alphabetically.
     */
    function sortRosterItems() {
        var items = $('.roster-item', $roster).get();
        items.sort(function compare(a, b) {
            var args = { a: a, b: b, result: 0 };
            globalEvents.trigger('rosterItemsCompare', [args]);
            if (args.result !== 0) {
                return args.result;
            }

            var aOffline = a.classList.contains('unavailable');
            var bOffline = b.classList.contains('unavailable');
            if (aOffline && !bOffline) { return 1; }
            if (bOffline && !aOffline) { return -1; }

            var aName = a.querySelector('.name').textContent;
            var bName = b.querySelector('.name').textContent;
            return aName.localeCompare(bName);
        });
        $.each(items, function(i, item) { $roster.append(item); });
    }

    self.port.on('rosterUpdate', function(args) {
        var item = args.contact;
        var jid = item.jid.bare;
        var presence = item.presence.$primary;

        var $item = args.$item = $('<li id="'+ jidToId(jid) +'" class="roster-item"></li>');
        $item[0].dataset.jid = jid;

        if (presence.type) {
            $item.addClass(presence.type); // -> unavailable
        }
        else if (presence.show) {
            $item.addClass(presence.show); // -> away, dnd, chat...
        }

        if (item.ask === 'subscribe') {
            $item.addClass('subscription-pending');
        }
        else if (item.subscription && (item.subscription !== 'both')) {
            $item.addClass('subscription-' + item.subscription);
        }

        $('<a class="name" href="xmpp:' + jid + '">' + item.name + '<a>').appendTo($item);

        if (presence.status && (presence.type != 'unavailable')) {
            $('<div class="status"></div>').text(presence.status).appendTo($item);
        }

        globalEvents.trigger('rosterItemRender', [args]);

        if (rosterItems[jid]) {
            rosterItems[jid].remove();
            delete rosterItems[jid];
        }
        if (item.subscription !== 'remove') {
            $item.appendTo($roster);
            rosterItems[jid] = $item;
        }

        sortRosterItems();
    });

});