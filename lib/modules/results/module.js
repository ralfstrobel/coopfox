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

const { storage } = require('sdk/simple-storage');
const { url } = require('sdk/self').data;
const baseUrl = url('modules/results/');
const sysEvents = require('sdk/system/events');
const unloader = require('sdk/system/unload');
var files = require('sdk/io/file');

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { MenuItem } = require('../../browser/menus');
const { ContextMenuItem } = require('../../browser/context-menus');

const { fileSavePrompt, confirmEx } = require('../../browser/dialogs');

/**
 * This module provides a sortable and exportable result collection tab.
 */
const Results = Class({
    extends: EventHub,
    className: 'Results',

    /**
     * @param {CoopFox} coopfox
     */
    initialize: function initialize(coopfox) {
        this.coopfox = coopfox;
        this._menuItems = [];

        coopfox.sidebar.panel.addScript(baseUrl + 'panel.js');
        coopfox.sidebar.panel.addStyle(baseUrl + 'panel.css');
        coopfox.sidebar.panel.addOptions({ resultsTabHidden: true });

        EventHub.prototype.initialize.apply(this, arguments);

        this.subscribeTo(coopfox, 'componentsReady');
        this.subscribeTo(coopfox, 'destroy');
        console.info('Results module activated.');
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
        var window = this.coopfox.window;
        var xmpp = this.coopfox.xmpp;
        var port = this.coopfox.sidebar.panel.port;
        this._menuItems = [

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-add-result',
                before: 'context-coopfox-reply-message',
                separatorBefore: true,
                label: 'Add To Results',
                acceltext: 'Double-Click Middle',
                selectors: ['#chat-tab .chat-history > .message:not(.result)'],
                /*onShow: function onShow(target) {
                    if (target.localName === 'a') {
                        this.hidden = true;
                    }
                },*/
                onClick: function onClick(target, message) {
                    var id = message.id;
                    var msg = {
                        coopfox: {
                            result: { action: 'up', id: id }
                        }
                    };
                    xmpp.sendMessage(msg);
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-remove-result',
                before: 'context-coopfox-reply-message',
                separatorBefore: true,
                label: 'Remove From Results',
                selectors: ['#results-tab .message'],
                onClick: function onClick(target, message) {
                    console.log(message);
                    if (!message) { return; }
                    var choice = confirmEx('Remove Result', 'Permanently remove this result? (Cannot be undone!)');
                    if (choice === 1) { return; }
                    var id = message.dataset.messageId;
                    var msg = {
                        coopfox: {
                            result: { action: 'remove', id: id }
                        }
                    };
                    xmpp.sendMessage(msg);
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-up-result',
                after: 'context-coopfox-add-result',
                separatorBefore: true,
                label: 'Increase Result Priority',
                acceltext: 'Double-Click Middle',
                selectors: ['.chat-history > .message.result'],

                /*onShow: function onShow(target) {
                    if (target.localName === 'a') {
                        this.hidden = true;
                    }
                },*/
                onClick: function onClick(target, message) {
                    var id = message.id || message.dataset.messageId;
                    var msg = {
                        coopfox: {
                            result: { action: 'up', id: id }
                        }
                    };
                    xmpp.sendMessage(msg);
                }
            }),

            new ContextMenuItem({
                window: window,
                menu: 'coopfoxPanelContextMenu',
                id: 'context-coopfox-down-result',
                after: 'context-coopfox-up-result',
                label: 'Decrease Result Priority',
                acceltext: 'Alt + Double-Click Middle',
                separatorAfter: true,
                selectors: ['.chat-history > .message.result'],
                /*onShow: function onShow(target) {
                    if (target.localName === 'a') {
                        this.hidden = true;
                    }
                },*/
                onClick: function onClick(target, message) {
                    var id = message.id || message.dataset.messageId;
                    var msg = {
                        coopfox: {
                            result: { action: 'down', id: id }
                        }
                    };
                    xmpp.sendMessage(msg);
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxPanelMenu',
                id: 'menu-coopfox-panel-show-results',
                after: 'menu-coopfox-panel-show-chat',
                type: 'checkbox',
                label: 'Show Results',
                onShow: function onShow(menuButton) {
                    var doc = menuButton.ownerDocument;
                    var tab = doc.querySelector('#results-tab-selector');
                    if (!tab.classList.contains('ui-state-disabled')) {
                        this.checked = true;
                    }
                    else if (!doc.querySelector('#results-tab .message')) {
                        this.disabled = true;
                    }
                },
                onClick: function onClick() {
                    if (this.checked) {
                        port.emit('tabHide', 'results');
                    } else {
                        port.emit('tabShow', 'results');
                    }
                }
            }),

            new MenuItem({
                window: window,
                menu: 'coopfoxPanelMenu',
                id: 'menu-coopfox-panel-export-results',
                label: 'Export Results',
                separatorBefore: true,
                onShow: function onShow(menuButton) {
                    var doc = menuButton.ownerDocument;
                    if (!doc.querySelector('#results-tab .message')) {
                        this.disabled = true;
                    }
                },
                onClick: function onClick() {
                    self.exportResults();
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

    exportResults: function exportResults() {
        var path = fileSavePrompt(this.coopfox.window, { '*.csv': 'Comma Separated Value Table' }, 'results.csv');
        if (!path) { return; }

        var results = ['#,Sender,Text,URL,Time,Priority'];

        var doc = this.coopfox.window.document.getElementById('coopfox-panel').contentDocument;
        var list = doc.querySelector('#results-tab .chat-history');
        var count = 0;
        for (let msg = list.firstElementChild; msg !== null; msg = msg.nextElementSibling) {
            let res = [];
            res.push((++count).toString());
            res.push(msg.querySelector('.sender').textContent);
            res.push(msg.querySelector('.message-body').textContent);
            let location = msg.querySelector('.location a');
            res.push(location ? location.href : '');
            res.push(msg.querySelector('.meta .time').title);
            res.push(msg.querySelector('.result-priority').textContent);

            for (let i in res) {
                res[i] = res[i].replace('"', '""');
            }
            results.push('"' + res.join('","') + '"');
        }

        results = results.join('\r\n');
        files.open(path, 'w').writeAsync(results);
    }

});

function onCoopfoxInit(event) {
    Results(event.subject);
}

//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-init', onCoopfoxInit, true);
unloader.when(function() {
    sysEvents.off('coopfox-init', onCoopfoxInit);
});