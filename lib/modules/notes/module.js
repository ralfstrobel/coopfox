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
const sysEvents = require('sdk/system/events');
const unloader = require('sdk/system/unload');
const baseUrl = require('sdk/self').data.url('modules/notes/');

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { MenuItem } = require('../../browser/menus');

/**
 * This module prives the private notes tab in the panel.
 */
const Notes = Class({
    extends: EventHub,
    className: 'Notes',

    /**
     * @param {CoopFox} coopfox
     */
    initialize: function initialize(coopfox) {
        this.coopfox = coopfox;

        coopfox.sidebar.panel.addScript(baseUrl + 'panel.js');
        coopfox.sidebar.panel.addStyle(baseUrl + 'panel.css');
        coopfox.sidebar.panel.addOptions({ notesTabHidden: storage['notes-tab-hidden'] || false });

        EventHub.prototype.initialize.apply(this, arguments);

        this.subscribeTo(coopfox, 'componentsReady');
        this.subscribeTo(coopfox, 'destroy');
        console.info('Notes module activated.');
    },

    _onceComponentsReady: function _onceComponentsReady() {
        var port = this.coopfox.sidebar.panel.port;

        this.subscribeTo(port, 'notesContent');
        var value = this.coopfox.getSessionValue('notes');
        if (value) {
            console.info('notesSetContent');
            port.emit('notesSetContent', value);
        }

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
        var port = this.coopfox.sidebar.panel.port;
        this._menuItems = [

            new MenuItem({
                window: window,
                menu: 'coopfoxPanelMenu',
                id: 'menu-coopfox-panel-show-notes',
                after: 'menu-coopfox-panel-show-chat',
                type: 'checkbox',
                label: 'Show Private Notes',
                onShow: function onShow(menuButton) {
                    var tab = menuButton.ownerDocument.querySelector('#notes-tab-selector');
                    if (!tab.classList.contains('ui-state-disabled')) {
                        this.checked = true;
                    }
                },
                onClick: function onClick(menuButton) {
                    var hide = storage['notes-tab-hidden'] = this.checked;
                    if (hide) {
                        port.emit('tabHide', 'notes');
                    } else {
                        port.emit('tabShow', 'notes');
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
    },

    /////////////////////////////////////////////////////////////////

    _onNotesContent: function _onNotesContent(value) {
        console.info('notesContent');
        if (value){
            this.coopfox.setSessionValue('notes', value);
        } else {
            this.coopfox.deleteSessionValue('notes');
        }
    }

});

function onCoopfoxInit(event) {
    Notes(event.subject);
}

//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-init', onCoopfoxInit, true);
unloader.when(function() {
    sysEvents.off('coopfox-init', onCoopfoxInit);
});