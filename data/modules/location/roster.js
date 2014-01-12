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

    var selfLocation = {};
    var histories = {};

    function updateItem(jid, $item) {
        var $location = $item.children('.location');
        if (!$location.length) { return; }

        $location.removeClass('knowspage').removeClass('samepage').removeClass('blinking');

        var history = histories[jid] || { current: {} };
        var location = history.current;

        if (selfLocation.urlhash) {
            let hEntry = history[selfLocation.urlhash];

            if (hEntry) {
                $location.addClass('knowspage');
                if(history.current.urlhash === selfLocation.urlhash) {
                    $location.addClass('samepage').addClass('blinking');
                }

                let time = new Date(hEntry.$timestamp);
                $location.attr('title', 'Visited: ' + time.toLocaleFormat('%H:%M'))
            }
        }

        var $link = $item.find('.location-link');
        if ($link.length) {
            if (location.urlhash) {
                //either we have a new url or the user has switched to obfuscated mode
                $link.remove();
            }
            else {
                //contact currently has no valid location but might have one again
                $link.replaceWith('<div class="location-link">&nbsp;</div>');
            }
        }
        if (location.url && location.title) {
            $link = $('<a class="location-link" href="' + location.url + '">' + location.title + '</a>');
            if (location.icon) {
                $link.prepend('<img src="' + location.icon + '" />');
            }
            $link.appendTo($item);
        }

    }

    self.port.on('contactLocation', function(location, contact) {
        if (contact.isSelf) {
            selfLocation = location || {};
            $.each(rosterItems, updateItem);
        }
        else {
            let jid = contact.jid.bare;
            let history = histories[jid];
            if (!history) {
                history = histories[jid] = {};
            }
            history.current = location || {};
            if (history.current.urlhash) {
                history[location.urlhash] = location;
            }
            updateItem(jid, rosterItems[jid]);
        }

    });

    globalEvents.on('rosterItemRender', function(event, args) {
        var $item = args.$item;
        if ($item.hasClass('participant-active')) {
            $item.prepend('<div class="location"></div>');
            updateItem(args.contact.jid.bare, $item);
        }
    });

});