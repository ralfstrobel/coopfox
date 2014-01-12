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

//Automatic away option postponed until FF Bug #916474 is fixed.
//const { Cc, Ci } = require('chrome');
//const idleService = Cc["@mozilla.org/widget/idleservice;1"].getService(Ci.nsIIdleService);

const sysEvents = require('sdk/system/events');
const unloader = require('sdk/system/unload');

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { MenuItem } = require('../../browser/menus');
const { ContextMenuItem } = require('../../browser/context-menus');

const { storage } = require('sdk/simple-storage');
//const { prefs } = require('sdk/simple-prefs');
const { subscriptionManager } = require('./subscriptions');
const { parseJid } = require('../../xmpp/session');
const dialogs = require('../../browser/dialogs');

/**
 * This module provides roster management functions,
 * such as adding, accepting and removing contacts.
 */
const Roster = Class({
    extends: EventHub,
    className: 'Roster',

    /**
     * @param {CoopFox} coopfox
     */
    initialize: function initialize(coopfox) {
        this.coopfox = coopfox;
        this._menuItems = [];

        EventHub.prototype.initialize.apply(this, arguments);

        this.subscribeTo(coopfox, 'beforeComponentsReady');
        this.subscribeTo(coopfox, 'componentsReady');
        this.subscribeTo(coopfox, 'destroy');
        console.info('Roster management module activated.');
    },

    _onceBeforeComponentsReady: function _onceBeforeComponentsReady() {
        var xmpp = this.coopfox.xmpp;
        var name = storage['selfName-' + xmpp.rosterSelf.jid.bare];
        if (name) {
            xmpp.rosterSelf.name = name; //for now
            xmpp.setOptions({ selfName: name }, true); //for future
        }
    },

    _onceComponentsReady: function _onceComponentsReady() {
        this._createMenuItems();
    },

    _onceDestroy: function _onceDestroy() {
        this.destroy();
        this.coopfox = null;
    },

    /////////////////////////////////////////////////////////////////

    _createMenuItems: function _createMenuItems() {
        var self = this;
        var xmpp = self.coopfox.xmpp;
        var window = self.coopfox.window;
        this._menuItems = [

            new MenuItem({
                window: window,
                menu: 'coopfoxRosterMenu',
                id: 'menu-coopfox-roster-add-contact',
                label: 'Add New Contact',
                onClick: function onClick() {
                    var jid = dialogs.prompt(
                        'New Contact',
                        'Enter a fully qualified XMPP address (e.g. username@hostname.com).'
                    );
                    if (!jid) { return; }
                    try {
                        jid = parseJid(jid);
                        if (!jid.username) {
                            throw new Error('Missing username part.');
                        }
                        jid = jid.bare;
                    }
                    catch (e) {
                        dialogs.alert('Invalid Address', e.message);
                        return;
                    }
                    subscriptionManager.add(jid);
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxRosterMenu',
                id: 'menu-coopfox-roster-show-online',
                label: 'Status Online',
                type: 'checkbox',
                separatorBefore: true,
                onShow: function onShow() {
                    if (!xmpp.rosterSelf.presence.$primary.show) {
                        this.checked = true;
                    }
                },
                onClick: function onClick() {
                    xmpp.rosterSelf.presence.$primary.show = '';
                    xmpp.sendPresence();
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxRosterMenu',
                id: 'menu-coopfox-roster-show-away',
                type: 'checkbox',
                label: 'Status Away',
                onShow: function onShow() {
                    if (xmpp.rosterSelf.presence.$primary.show === 'away') {
                        this.checked = true;
                    }
                },
                onClick: function onClick() {
                    xmpp.rosterSelf.presence.$primary.show = 'away';
                    xmpp.sendPresence();
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxRosterMenu',
                id: 'menu-coopfox-roster-show-dnd',
                type: 'checkbox',
                label: 'Status DND',
                onShow: function onShow() {
                    if (xmpp.rosterSelf.presence.$primary.show === 'dnd') {
                        this.checked = true;
                    }
                },
                onClick: function onClick() {
                    xmpp.rosterSelf.presence.$primary.show = 'dnd';
                    xmpp.sendPresence();
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxRosterMenu',
                id: 'menu-coopfox-roster-change-status',
                type: 'checkbox',
                label: 'Custom Status Message',
                onShow: function onShow() {
                    if (xmpp.rosterSelf.presence.$primary.status) {
                        this.checked = true;
                    }
                },
                onClick: function onClick() {
                    var jid = xmpp.rosterSelf.jid.bare;
                    var status = dialogs.prompt(
                        'Custom Status Message',
                        'Enter a message shown to your contacts in their buddy list.',
                        xmpp.rosterSelf.presence.$primary.status
                    );
                    if (typeof(status) === 'string') {
                        xmpp.rosterSelf.presence.$primary.status = status;
                        xmpp.sendPresence();
                    }
                }
            }),

            /*new MenuItem({
                window: window,
                menu: 'coopfoxRosterMenu',
                id: 'menu-coopfox-roster-auto-away',
                type: 'checkbox',
                label: 'Automatic Away',
                tooltiptext: 'Change your status to away, when you don\'t touch mouse or keyboard for 3 minutes',
                onShow: function onShow() {
                    if (prefs.autoAway) {
                        this.checked = true;
                    }
                },
                onClick: function onClick() {
                    prefs.autoAway = !this.checked;
                }
            }),*/

            new MenuItem({
                window: window,
                menu: 'coopfoxRosterMenu',
                id: 'menu-coopfox-roster-change-selfname',
                label: 'Change My Local Display Name',
                separatorBefore: true,
                onClick: function onClick() {
                    var jid = xmpp.rosterSelf.jid.bare;
                    var name = dialogs.prompt(
                        'Change My Local Display Name',
                        'Enter a new local name for yourself (' + jid + ').' +
                            '\nThis does not affect how you are displayed to your contacts.',
                        xmpp.rosterSelf.name
                    );
                    if (name) {
                        storage['selfName-' + jid] = name;
                        self.coopfox.reload();
                    }
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxRosterContextMenu',
                id: 'context-coopfox-roster-open-url',
                label: 'Open Link in Current Tab',
                selectors: ['#roster a[href]'],
                onShow: function onShow(target, link) {
                    var url = link.href;
                    if (!url.match(/^(https?|ftp):/i)) {
                        this.hidden = true;
                    }
                    else if (self.coopfox.browser.isActiveUrl(url)) {
                        this.hidden = true;
                    }
                    else if (self.coopfox.browser.getTabsForUrl(url).length) {
                        this.label = 'Switch to Tab';
                    }
                },
                onClick: function onClick(target, link) {
                    self.coopfox.browser.openUrl(link.href, false, 'roster-context-menu');
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxRosterContextMenu',
                id: 'context-coopfox-roster-open-url-newtab',
                label: 'Open Link in New Tab',
                separatorAfter: true,
                selectors: ['#roster a[href]'],
                onShow: function onShow(target, link) {
                    var url = link.href;
                    if (!url.match(/^(https?|ftp):/i)) {
                        this.hidden = true;
                    }
                },
                onClick: function onClick(target, link) {
                    self.coopfox.browser.openUrl(link.href, true, 'roster-context-menu');
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxRosterContextMenu',
                id: 'context-coopfox-roster-rename-contact',
                selectors: ['.roster-item'],
                label: 'Rename Contact',
                onClick: function onClick(target, contact) {
                    var jid = contact.dataset.jid;
                    var rosterItem = self.coopfox.xmpp.roster[jid] || null;
                    if (!rosterItem) { return; }

                    var name = dialogs.prompt(
                        'Rename Contact',
                        'Enter a new name for ' + jid + '.',
                        rosterItem.name || ''
                    );
                    if (name) {
                        subscriptionManager.changeName(jid, name);
                        if (xmpp.getParticipants().indexOf(jid) !== -1) {
                            self.subscribeTo(xmpp, 'rosterItemUpdate', function(item, reason) {
                                if ((item.jid.bare === jid) && (item.name === name)) {
                                    self.coopfox.reload();
                                }
                            });
                        }
                    }
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxRosterContextMenu',
                id: 'context-coopfox-roster-remove-contact',
                selectors: ['.roster-item'],
                label: 'Remove Contact',
                onClick: function onClick(target, contact) {
                    var jid = contact.dataset.jid;
                    var rosterItem = self.coopfox.xmpp.roster[jid] || null;
                    if (!rosterItem) { return; }

                    var choice = dialogs.confirmEx(
                        'Remove Contact',
                        'Permanently remove ' + (rosterItem.name || jid) + ' from contacts?'
                    );
                    if (choice === 0) {
                        subscriptionManager.cancel(jid);
                    }
                }
            })

        ];
    },

    _destroyMenuItems: function _destroyMenuItems() {
        for each (let item in this._menuItems) {
            item.destroy();
        }
        this._menuItems = [];
    }

    /*_initIdleObserver: function _initIdleObserver() {
        this._idleObserver = { observe: this._onIdle };
        idleService.addIdleObserver(this._idleObserver, 5);
        this._autoAway = false;
    },

    _onIdle: function _onIdle(subject, topic, data) {
        if (!prefs.autoAway) { return; }
        var xmpp = this.coopfox.xmpp;
        var presence = xmpp.rosterSelf.presence.$primary;
        console.log('IdleObserver: ' + topic);
        switch (topic) {
            case 'idle':
                if (presence.show === '') {
                    presence.show = 'away';
                    xmpp.sendPresence();
                }
                this._autoAway = true;
                break;
            case 'active':
                if ((presence.show === 'away') && this._autoAway) {
                    presence.show = '';
                    xmpp.sendPresence();
                }
                this._autoAway = false;
                break;
        }
    },

    _destroyIdleObserver: function _destroyIdleObserver() {
        idleService.removeIdleObserver(this._idleObserver, 5);
    }*/

});

function onCoopfoxInit(event) {
    Roster(event.subject);
}

//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-init', onCoopfoxInit, true);
unloader.when(function() {
    sysEvents.off('coopfox-init', onCoopfoxInit);
});