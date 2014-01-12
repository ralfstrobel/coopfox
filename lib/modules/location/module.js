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
const clipboard = require('sdk/clipboard');
const { prefs } = require('sdk/simple-prefs');
const { url } = require('sdk/self').data;
const baseUrl = url('modules/location/');

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { MenuItem } = require('../../browser/menus');
const { ContextMenuItem } = require('../../browser/context-menus');

const { WebLocationTracker } = require('./tracker');
const { LinkTagger } = require('./linktagger');
const { TabTagger } = require('./tabtagger');

const linkPattern = /^\w+:\/\/\S+$/;

const Location = Class({
    extends: EventHub,
    className: 'Location',

    /**
     * @param {CoopFox} coopfox
     */
    initialize: function initialize(coopfox) {
        this.coopfox = coopfox;
        this.xmpp = coopfox.xmpp;
        this._publishURL = prefs.publishUrl; //take default from prefs

        this._menuItems = [];

        coopfox.sidebar.roster.addScript(baseUrl + 'roster.js');
        coopfox.sidebar.roster.addStyle(baseUrl + 'roster.css');
        coopfox.sidebar.panel.addScript(baseUrl + 'panel.js');
        coopfox.sidebar.panel.addStyle(baseUrl + 'panel.css');

        EventHub.prototype.initialize.apply(this, arguments);

        this.subscribeTo(coopfox, 'componentsReady');
        this.subscribeTo(coopfox, 'destroy');
        console.info('Location module activated.');
    },

    _onceComponentsReady: function _onceComponentsReady() {
        this.tracker = new WebLocationTracker({
            tabs : this.coopfox.browser,
            onActiveDocumentChange : this,
            onActiveDocumentModified: this
        });
        this.linkTagger = new LinkTagger({
            tabs : this.coopfox.browser
        });
        this.tabTagger = new TabTagger({
            tabs : this.coopfox.browser
        });

        this._onParticipantAdded(this.xmpp.rosterSelf.jid.bare);
        for each (let jid in this.xmpp.getParticipants(true)) {
            this._onParticipantAdded(jid);
        }
        this.subscribeTo(this.xmpp, 'participantAdded');
        this.subscribeTo(this.xmpp, 'beforeIncomingMessage');
        this.subscribeTo(this.xmpp, 'beforeSendMessage');

        this.panelPort = this.coopfox.sidebar.panel.port;
        this.rosterPort = this.coopfox.sidebar.roster.port;

        this._createMenuItems();
    },

    _onceDestroy: function _onceDestroy() {
        this.destroy();
        if (this.tracker) {
            this.tracker.destroy();
            this.tracker = null;
        }
        if (this.linkTagger) {
            this.linkTagger.destroy();
            this.linkTagger = null;
        }
        if (this.tabTagger) {
            this.tabTagger.destroy();
            this.tabTagger = null;
        }
        this.coopfox = null;
        this.xmpp = null;
        this.panelPort = null;
        this.rosterPort = null;
    },

    /////////////////////////////////////////////////////////////////

    _createMenuItems: function _createMenuItems() {
        var self = this;
        var window = self.coopfox.window;
        this._menuItems = [

            new MenuItem({
                window: window,
                menu: 'coopfoxRosterMenu',
                id: 'menu-coopfox-roster-publish-location',
                label: 'Show URL to Coop Partners',
                tooltiptext: 'CoopChat parters can see the web page in your active tab',
                type: 'checkbox',
                separatorBefore: true,
                onShow: function onShow() {
                    this.checked = self._publishURL;
                },
                onClick: function onClick() {
                    self._publishURL = !this.checked;
                    self._publishLocation();
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-open-location-url',
                after: 'context-coopfox-open-url-newtab',
                label: 'Open Location in Current Tab',
                selectors: ['.coopchat .message'],
                onShow: function onShow(target, message) {
                    if (target.localName === 'a') {
                        this.hidden = true;
                        return;
                    }
                    var location = message.querySelector('.location a[href]');
                    if (!location) {
                        this.hidden = true;
                        return;
                    }
                    var url = location.href;
                    if (self.coopfox.browser.isActiveUrl(url)) {
                        this.hidden = true;
                    }
                    else if (self.coopfox.browser.getTabsForUrl(url).length) {
                        this.label = 'Switch to Location Tab';
                    }
                },
                onClick: function onClick(target, message) {
                    var location = message.querySelector('.location a[href]');
                    self.coopfox.browser.openUrl(location.href);
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-open-location-url-newtab',
                after: 'context-coopfox-open-location-url',
                label: 'Open Location in New Tab',
                selectors: ['.coopchat .message'],
                onShow: function onShow(target, message) {
                    if (target.localName === 'a') {
                        this.hidden = true;
                        return;
                    }
                    var location = message.querySelector('.location a[href]');
                    if (!location) {
                        this.hidden = true;
                    }
                },
                onClick: function onClick(target, message) {
                    var location = message.querySelector('.location a[href]');
                    self.coopfox.browser.openUrl(location.href, true);
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-copy-location-url',
                after: 'context-coopfox-copy-message',
                label: 'Copy Location Link',
                selectors: ['.coopchat .message'],
                onShow: function onShow(target, message) {
                    var location = message.querySelector('.location a[href]');
                    if (!location) {
                        this.hidden = true;
                    }
                },
                onClick: function onClick(target, message) {
                    var location = message.querySelector('.location a[href]');
                    clipboard.set(location.href, 'text');
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-copy-location-title',
                after: 'context-coopfox-copy-location-url',
                label: 'Copy Location Title',
                selectors: ['.coopchat .message'],
                onShow: function onShow(target, message) {
                    var location = message.querySelector('.location a[href]');
                    if (!location) {
                        this.hidden = true;
                    }
                },
                onClick: function onClick(target, message) {
                    var location = message.querySelector('.location a[href]');
                    clipboard.set(location.textContent, 'text');
                }
            }),

            new ContextMenuItem({
                window: window,
                label: 'Post Link in CoopChat',
                image: url('images/icon.png'),
                after: 'context-copylink',
                selectors: ['a[href]'],
                onClick: function onClick(target, link) {
                    var href = link.href;
                    var title = link.title;
                    var location = self.tracker.buildDocInfo(href, title);
                    location.source = 'link';
                    var message = {
                        body: {
                            $text: href
                        },
                        coopfox: {
                            location: location
                        }
                    };
                    self.xmpp.sendMessage(message);
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

    _onParticipantAdded: function _onParticipantAdded(jid) {
        var color = this.coopfox.getParticipantColors ? this.coopfox.getParticipantColors(jid).foreground : '#000';
        this.linkTagger.defineColor(jid, color);
        this.tabTagger.defineColor(jid, color);
    },

    _onActiveDocumentChange: function _onActiveDocumentChange(location) {
        this.panelPort.emit('contactLocation', location, this.xmpp.rosterSelf);
        this.rosterPort.emit('contactLocation', location, this.xmpp.rosterSelf);
        this._publishLocation();
    },

    _onActiveDocumentModified: function _onActiveDocumentModified() {
        this.linkTagger.invalidate(100);
    },

    _publishLocation: function _publishLocation(to) {
        var location = (this._publishURL ? this.tracker.activeDocInfo : this.tracker.activeDocInfoObfuscated) || {};
        let message = {
            type: 'headline',
            coopfox: {
                location: location
            },
            $noEcho: true
        };
        if (to) {
            message.to = to;
        }
        this.xmpp.sendMessage(message);
    },

    _onBeforeIncomingMessage: function _onBeforeIncomingMessage(message) {
        if (!message.coopfox) { return; }

        if (message.coopfox.ready) {
            this._publishLocation(message.$from.full);
        }

        var contact = this.xmpp.getContact(message.$from);
        var location = message.coopfox.location;

        if (message.type === 'headline') {
            if (location) {
                location.$timestamp = message.$timestamp;

                this.panelPort.emit('contactLocation', location, contact);
                this.rosterPort.emit('contactLocation', location, contact);

                //notify linkTagger of page-visit
                if (!contact.isSelf) {
                    this.linkTagger.registerVisit(location.urlhash, message.$from.bare);
                }
            }
            return;
        }

        //treat replies as messages on the original page for the taggers
        var replyParent = this.xmpp.messages[message.thread.$text];
        if (replyParent) {
            location = replyParent.coopfox.location;
        }

        if (location && message.body && message.body.$text && !linkPattern.test(message.body.$text)) {
            let urlhash = location.urlhash;

            this.tabTagger.registerMessage(urlhash, message.$from.bare);
            if (!contact.isSelf) {
                this.linkTagger.registerMessage(urlhash, message.$from.bare);
            }
        }

    },

    _onBeforeSendMessage: function _onBeforeSendMessage(message) {
        if ((message.type === 'chat') && message.body) {
            var text = message.body.$text;
            if (!text) { return; }

            var supressLocation = !!message.thread.parent; //don't send for replies

            var activeDocInfo = this.tracker.activeDocInfo;
            var location = message.coopfox.location || activeDocInfo;

            if (linkPattern.test(text)) {
                //if a link is sent explicitly, always make the location match the link
                if (text === activeDocInfo.url) {
                    location = activeDocInfo;
                }
                else if (!location || (location.url !== text)) {
                    location = this.tracker.buildDocInfo(text);
                }
                supressLocation = false;
            }

            var hl = message.coopfox.highlight;
            if (hl && hl.type === 'insert') {
                supressLocation = false;
            }

            if (location && !supressLocation) {
                 message.coopfox.location = location;
            }
        }
    }

});


function onCoopfoxInit(event) {
    Location(event.subject);
}

//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-init', onCoopfoxInit, true);
unloader.when(function() {
    sysEvents.off('coopfox-init', onCoopfoxInit);
});