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

    var currentPage = {};
    var pageVisits = { self: {} }; //jid -> urlhash -> {Date} time last seen
    var pageTitles = {}; //url -> title

    /**
     * Update which messages indicate relation to current browser page
     */
    function updateContext($location, urlhash) {
        var time = pageVisits.self[urlhash];
        $location.removeClass('unknownpage');
        if (time) {
            $location.removeClass('knownpage').addClass('knownpage')
                .attr('title', 'Last visit: ' + time.toLocaleFormat('%H:%M'));
            if (urlhash === currentPage.urlhash) {
                $location.removeClass('samepage').addClass('samepage');
            }
        } else {
            $location.addClass('unknownpage');
        }
    }

    function refreshContext() {
        $('.chat-history .location.samepage').removeClass('samepage');
        if (currentPage.urlhash) {
            updateContext($('.chat-history .location.url' + currentPage.urlhash), currentPage.urlhash);
        }
    }
    self.port.on('endBulkUpdate', refreshContext);

    function refreshRadar() {
        coopChatMain.removeRadarAll('samepage-radar');
        $('#chat-tab .chat-history .location.samepage').each(function(i, location) {
            coopChatMain.insertRadar(location.parentElement.id, 'samepage-radar');
        });
    }
    self.port.on('endBulkUpdate', refreshRadar);

    /**
     * Add seen markers of all contacts to a location.
     */
    function addContactSeenMakers($location, urlhash) {
        for (let jid in pageVisits) {
            if (jid === 'self') { continue; }
            let time = pageVisits[jid][urlhash];
            if (time) {
                let jidclass = jidToClass(jid);
                let seenclass = 'seen-' + jidclass;
                addSeenMarker($location, seenclass, jidclass, time);
            }
        }
    }

    /**
     * Add seen markers of a contact to all pages of a url.
     */
    function updateContactSeenMakers(jid, urlhash, time) {
        if (jid === 'self') { return; }
        var jidclass = jidToClass(jid);
        var seenclass = 'seen-' + jidclass;
        var $location = $('.chat-history .location.url' + urlhash + ':not(.' + seenclass + ')');
        addSeenMarker($location, seenclass, jidclass, time);
    }

    function addSeenMarker($location, seenclass, jidclass, time) {
        $location.children('.hovershow').append(
            '<span class="contact-seen contact-color ' + jidclass + '"' +
                ' title="Visited: ' + time.toLocaleFormat('%H:%M') + '">&#x2713;</span>'
        );
        $location.addClass(seenclass);
    }

    function storePageVisit(contact, location) {
        if (location.url && location.title) {
            pageTitles[location.url] = location.title; //learn page titles
        }
        let jid = contact.isSelf ? 'self' : contact.jid.bare;
        if (!pageVisits[jid]) {
            pageVisits[jid] = {};
        }
        if (location.urlhash) {
            let time = pageVisits[jid][location.urlhash] = new Date(location.$timestamp || Date.now());
            updateContactSeenMakers(jid, location.urlhash, time);
        }
    }

    self.port.on('contactLocation', function(location, contact) {
        if (location) {
            storePageVisit(contact, location);
        }

        if (contact.isSelf) {
            currentPage = location || {};

            refreshContext();
            refreshRadar();
            inputAutoLink();
        }
    });

    globalEvents.on('chatMessageReceived', function(event, args) {
        var msg = args.message;
        var loc = (msg.coopfox) ? msg.coopfox.location : null;

        if (loc && (loc.source === 'page')) {
            storePageVisit(args.sender, loc);
        }

        if (msg.body && msg.body.$text) {
            //try to replace urls we receive with linked titles
            let url = msg.body.$text;
            let title = pageTitles[url];
            if (loc && (url === loc.url)) {
                if (title) {
                    if (!loc.title) {
                        loc.title = title;
                    }
                } else {
                    if (loc.title) {
                        title = loc.title;
                    }
                }
            }
            if (title) {
                msg.body.$text = '<a href="' + url + '" title="' + url + '">' + title + '</a>';
            }
        }
    });

    globalEvents.on('chatMessagePost', function(event, args) {
        var loc = (args.message.coopfox) ? args.message.coopfox.location : null;

        if (loc && loc.urlhash) {

            let $location = $('<div class="location url' + loc.urlhash + ' hoverable"></div>').prependTo(args.$message);

            if (loc.url) {
                let title = loc.title || loc.url;
                $location.append(
                    '<span class="hovershow" style="display:none">' +
                        '<a href="' + loc.url + '" title="' + loc.url + '">' + title + '</a>' +
                    '</span>'
                );
                if (loc.icon) {
                    $location.prepend(
                        '<a class="favicon-link" href="' + loc.url + '" title="' + loc.url + '">' +
                            '<img src="' + loc.icon + '" alt="?" ' +
                                'onclick="this.parentElement.click(); return false;" ' +
                            '/>' +
                        '</a>'
                    );
                }
            }

            addContactSeenMakers($location, loc.urlhash);
            updateContext($location, loc.urlhash);
            refreshRadar();
        }
    });

    function doInputAutoLink() {
        _autoLinkTimeout = null;
        $('.chat-input-text').each(function() {
            if (this.classList.contains('location-autolink')) {
                this.classList.remove('location-autolink');
                this.classList.remove('link-color');
                this.value = '';
            }
            if (!this.value.length && currentPage.url && (!document.hasFocus() || (document.activeElement !== this))) {
                if ($(this).parents('.coopchat').length) {
                    this.value = currentPage.title || currentPage.url;
                } else {
                    this.value = currentPage.url;
                }
                this.classList.add('location-autolink');
                this.classList.add('link-color');
            }
        });
    }
    var _autoLinkTimeout = null;
    function inputAutoLink() {
        if (!_autoLinkTimeout) {
            _autoLinkTimeout = setTimeout(doInputAutoLink);
        }
    }

    $(document).on('blur', '.chat-input-text', inputAutoLink).on('focus', '.chat-input-text', inputAutoLink);
    $(document).blur(inputAutoLink); //sidebar panel looses focus (but document.activeElement stays unchanged!)

    function onMessageSend(event, msg) {
        if (msg.body) {
            let text = msg.body.$text;
            if (typeof(text) === 'string') {
                if (!text.trim().length || (text === currentPage.title)) {
                    msg.body.$text = currentPage.url || '';
                }
            }
        }
        inputAutoLink();
    }
    globalEvents.on('chatMessageSend', onMessageSend);
    globalEvents.on('privateChatMessageSend', onMessageSend);

    function onChatStateSend(event, args) {
        if (args.state === 'paused') {
            let value = args.input.$input.val();
            if ((value === currentPage.url) || (value === currentPage.title)) {
                args.state = 'active';
            }
        }
    }
    globalEvents.on('chatStateSend', onChatStateSend);
    globalEvents.on('privateChatStateSend', onChatStateSend);

    inputAutoLink();
});