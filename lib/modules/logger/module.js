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
var files = require('sdk/io/file');

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { MenuItem } = require('../../browser/menus');

const { setInterval, clearInterval, setTimeout, clearTimeout } = require('sdk/timers');
const clipboard = require('sdk/clipboard');
const { fileSavePrompt, confirmEx, alert } = require('../../browser/dialogs');

const linkPattern = /^\w+:\/\/\S+$/;

//Save the logs in a location which stays persistent while FF is running.
//This way they can never be deleted accidentally.
const logs = [];

/**
 * This module provides a sortable and exportable result collection tab.
 */
const Logger = Class({
    extends: EventHub,
    className: 'Logger',

    /**
     * @param {CoopFox} coopfox
     */
    initialize: function initialize(coopfox) {
        this.coopfox = coopfox;
        this._menuItems = [];

        EventHub.prototype.initialize.apply(this, arguments);

        this.subscribeTo(coopfox, 'componentsReady');
        this.subscribeTo(coopfox, 'destroy');
        console.info('Logger module activated.');
    },

    _onceComponentsReady: function _onceComponentsReady() {
        this._createMenuItems();
        this.newLog(true);

        var window = this.coopfox.window;
        var browser = this.coopfox.browser;
        var sidebar = this.coopfox.sidebar;
        var panelPort = sidebar.panel.port;
        var rosterPort = sidebar.roster.port;

        this.subscribeTo(browser, 'documentReady');
        this.subscribeTo(browser, 'documentActivate');
        this.subscribeTo(browser, 'openUrl');

        window.addEventListener('activate', this._onWindowActivate, false);
        window.addEventListener('deactivate', this._onWindowDeactivate, false);
        sidebar.panelFrame.contentDocument.addEventListener('focus', this._onPanelFocus, false);
        sidebar.panelFrame.contentDocument.addEventListener('blur', this._onPanelBlur, false);
        sidebar.rosterFrame.contentDocument.addEventListener('focus', this._onRosterFocus, false);
        sidebar.rosterFrame.contentDocument.addEventListener('blur', this._onRosterBlur, false);
        this._windowActive = false;
        this._panelFocus = false;
        this._rosterFocus = false;

        this.subscribeTo(this.coopfox.xmpp, 'afterSendMessage');

        this._interval = setInterval(this._onInterval, 1000);
        this._shortInterval = setInterval(this._onShortInterval, 250);
        this._clipboardSnapshot = clipboard.get('text');
    },

    _onceDestroy: function _onceDestroy() {
        var sidebar = this.coopfox.sidebar;
        var window = this.coopfox.window;
        sidebar.panelFrame.contentDocument.removeEventListener('focus', this._onPanelFocus, false);
        sidebar.panelFrame.contentDocument.removeEventListener('blur', this._onPanelBlur, false);
        sidebar.rosterFrame.contentDocument.removeEventListener('focus', this._onRosterFocus, false);
        sidebar.rosterFrame.contentDocument.removeEventListener('blur', this._onRosterBlur, false);
        window.removeEventListener('activate', this._onWindowActivate, false);
        window.removeEventListener('deactivate', this._onWindowDeactivate, false);
        clearInterval(this._interval);
        clearInterval(this._shortInterval);
        this.newLog(true);
        this.destroy();
        this.coopfox = null;
    },

    /////////////////////////////////////////////////////////////////

    _createMenuItems: function _createMenuItems() {
        var self = this;
        var window = this.coopfox.window;
        this._menuItems = [

            new MenuItem({
                window: window,
                menu: 'coopfoxPanelMenu',
                id: 'menu-coopfox-panel-save-logs',
                after: 'menu-coopfox-panel-export-results',
                separatorBefore: true,
                label: 'Save Logs',
                onClick: function onClick() {
                    self.saveLogs();
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxPanelMenu',
                id: 'menu-coopfox-panel-new-log',
                after: 'menu-coopfox-panel-save-logs',
                label: 'Start New Log',
                onClick: function onClick() {
                    self.newLog();
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

    _onInterval: function _onInterval() {
        this._log.time++;
    },

    _onShortInterval: function _onShortInterval() {
        var clipboardSnapshot = clipboard.get('text');
        if (clipboardSnapshot !== this._clipboardSnapshot) {
            this._log.clipboardChange++;
            //console.log('clipboardChange');
            this._clipboardSnapshot = clipboardSnapshot;
        }
    },

    _onDocumentReady: function _onDocumentReady(doc) {
        this._log.docLoad++;
        //console.log('docLoad');
    },

    _onDocumentActivate: function _onDocumentActivate(doc) {
        if (doc) {
            this._log.docActivate++;
            //console.log('docActivate');
        }
    },

    _onOpenUrl: function _onOpenUrl(url, newTab, origin) {
        if (typeof(origin) !== 'string') { return; }
        if (origin.substr(0, 5) === 'panel') {
            this._log.panelLinkClick++;
            //console.log('panelLinkClick');
            if (newTab) {
                this._log.panelLinkClickNewTab++;
                //console.log('panelLinkClickNewTab');
            }
        }
        else if (origin.substr(0, 6) === 'roster') {
            this._log.rosterLinkClick++;
            //console.log('rosterLinkClick');
            if (newTab) {
                this._log.rosterLinkClickNewTab++;
                //console.log('rosterLinkClickNewTab');
            }
        }
    },

    _onWindowActivate: function _onWindowActivate(event) {
        this._windowActive = true;
        this._log.windowActivate++;
        //console.log('windowActivate');
    },
    _onWindowDeactivate: function _onWindowDeactivate(event) {
        this._windowActive = false;
        //console.log('windowDeactivate');
    },
    _onPanelFocus: function _onPanelFocus() {
        if (this._panelFocus) { return; }
        this._panelFocus = true;
        this._log.panelFocus++;
        //console.log('panelFocus');
        if (!this._rosterFocus) {
            this._log.sidebarFocus++;
            //console.log('sidebarFocus');
        }
    },
    _onPanelBlur: function _onPanelBlur() {
        if (!this._windowActive) { return; }
        var self = this;
        setTimeout(function() {
            self._panelFocus = false;
            //console.log('panelBlur');
        });
    },
    _onRosterFocus: function _onRosterFocus() {
        if (this._rosterFocus) { return; }
        this._rosterFocus = true;
        this._log.rosterFocus++;
        //console.log('rosterFocus');
        if (!this._panelFocus) {
            this._log.sidebarFocus++;
            //console.log('sidebarFocus');
        }
    },
    _onRosterBlur: function _onRosterBlur() {
        if (!this._windowActive) { return; }
        var self = this;
        setTimeout(function() {
            self._rosterFocus = false;
            //console.log('rosterBlur');
        });
    },

    _onAfterSendMessage: function _onAfterSendMessage(message) {
        var hl = message.coopfox.highlight;
        var result = message.coopfox.result;
        var chat = message.coopfox.chat;

        if (message.$persistent) {
            if (hl && hl.text) {
                this._log.highlight++;
                //console.log('highlight');
                return;
            }

            if (result) {
                switch (result.action) {
                    case 'up':
                        this._log.resultUp++;
                        //console.log('resultUp');
                        break;
                    case 'down':
                        this._log.resultDown++;
                        //console.log('resultDown');
                        break;
                    case 'remove':
                        this._log.resultDelete++;
                        //console.log('resultDelete');
                }
                return;
            }

            if (chat && (chat.action === 'delete')) {
                var orig = this.coopfox.xmpp.messages[chat.id];
                if (orig) {
                    if (orig.coopfox.highlight) {
                        this._log.highlightDelete++;
                        //console.log('highlightDelete');
                    } else {
                        this._log.messageDelete++;
                        //console.log('messageDelete');
                        let parent = this.coopfox.xmpp.messages[orig.thread.$text] || null;
                        if (parent) {
                            this._log.messageReplyDelete++;
                            //console.log('messageReplyDelete');
                            if (parent.coopfox.highlight) {
                                this._log.highlightReplyDelete++;
                                //console.log('highlightReplyDelete');
                            }
                        }
                    }
                }
                return;
            }

            if (message.body && message.body.$text) {
                this._log.message++;
                //console.log('message');
                let parent = this.coopfox.xmpp.messages[message.thread.$text] || null;
                if (parent) {
                    this._log.messageReply++;
                    //console.log('messageReply');
                    if (parent.coopfox.highlight) {
                        this._log.highlightReply++;
                        //console.log('highlightReply');
                    }
                }
                if (linkPattern.test(message.body.$text)) {
                    this._log.linkMessage++;
                    //console.log('linkMessage');
                }
            }

        }
        else {
            if (hl && hl.text) {
                //not reliable, because selection may also appear in other context
                this._log.transientHighlight++;
                //console.log('transientHighlight');
            }
        }

    },

    newLog: function newLog(quiet) {
        if (!quiet) {
            var choice = confirmEx(
                'Start New Log',
                'Save the current log and start a new one?\nPlease do not do this, unless you have been instructed to!'
            );
            if (choice !== 0) { return; }
        }

        if (this._log) {
            logs.push(this._log);
        }

        this._log = {
            time: 0,
            windowActivate: 0,
            docLoad: 0,
            docActivate: 0,
            panelLinkClick: 0,
            panelLinkClickNewTab: 0,
            rosterLinkClick: 0,
            rosterLinkClickNewTab: 0,
            sidebarFocus: 0,
            panelFocus: 0,
            rosterFocus: 0,
            clipboardChange: 0,
            message: 0,
            linkMessage: 0,
            messageReply: 0,
            messageDelete: 0,
            messageReplyDelete: 0,
            highlight: 0,
            highlightReply: 0,
            highlightDelete: 0,
            highlightReplyDelete: 0,
            transientHighlight: 0,
            resultUp: 0,
            resultDown: 0,
            resultDelete: 0
        };

        if (!quiet) {
            alert('New Log Started', 'Now Recording Log #' + (logs.length + 1));
        }
    },

    saveLogs: function saveLogs() {
        var path = fileSavePrompt(this.coopfox.window, { '*.csv': 'Comma Separated Value Table' }, 'logs.csv');
        if (!path) { return; }
        this.newLog(true);

        var output = [];

        var head = [];
        for (let key in this._log) {
            head.push(key.charAt(0).toUpperCase() + key.substr(1));
        }
        output.push(head.join(';'));
        output.push('');

        for each (let log in logs) {
            let data = [];
            for each (let val in log) {
                data.push(val);
            }
            output.push(data.join(';'));
        }

        output = output.join('\n');
        files.open(path, 'w').writeAsync(output);
    }

});

function onCoopfoxInit(event) {
    Logger(event.subject);
}

//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-init', onCoopfoxInit, true);
unloader.when(function() {
    sysEvents.off('coopfox-init', onCoopfoxInit);
});