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

const { nsIDOMWindow } = require('chrome').Ci;
const { storage } = require('sdk/simple-storage');

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../utils/events');
const { platform } = require('sdk/system');

const checkmarkPatchedWindows = new WeakMap();

/**
 * Adds a toolbar button to a browser window.
 * The button can be moved persistently by the user.
 */
const ToolbarButton = Class({
    extends: EventHub,
    className: 'ToolbarButton',

    initialize: function initialize(options) {
        if (!(options.window instanceof nsIDOMWindow)) {
            throw new TypeError('Undefined window for ToolbarButton.');
        }
        if (!options.id) {
            throw new TypeError('Undefined ID for ToolbarButton.');
        }
        if (!options.image) {
            throw new TypeError('Undefined image URL for ToolbarButton.');
        }
        if (!options.label) {
            throw new TypeError('Undefined label for ToolbarButton.');
        }
        var window = this.window = options.window;
        this._image = options.image;
        this._label = options.label;
        this._tooltiptext = options.tooltiptext || '';

        EventHub.prototype.initialize.apply(this, arguments);

        this._createItem(options);
        this._insertItem(options);

        this.button.addEventListener('command', this._onCommand, false);
        if (this.menu) {
            this.menu.addEventListener('popupshowing', this._onPopupShowing, false);
        }

        if (platform === 'darwin') {
            //Hotfix for vanishing checkmarks on Mac (FF Bug 643184)
            if (!checkmarkPatchedWindows.get(window, false)) {
                let styleSheets = window.document.styleSheets;
                for (let i = 0; i < styleSheets.length; i++) {
                    let styles = styleSheets[i];
                    if (styles.href === 'chrome://browser/skin/browser.css') {
                        let rule = 'toolbarbutton .menu-iconic-left { margin-left: -16px; margin-right: -16px; padding-left: 16px; }';
                        styles.insertRule(rule, styles.cssRules.length);
                        rule = 'toolbarbutton .menu-iconic-icon { width:16px; margin-left: 0px; margin-right: 0px; }';
                        styles.insertRule(rule, styles.cssRules.length);
                        console.info('Applied hotfix patch for FF Bug 643184');
                        break;
                    }
                }
                checkmarkPatchedWindows.set(window, true)
            }
        }

    },

    _createItem: function _createItem(options) {
        var doc = this.window.document;
        var button = this.button = doc.createElement('toolbarbutton');
        button.classList.add('toolbarbutton-1');

        button.setAttribute('id', options.id);
        button.setAttribute('label', this._label);
        button.setAttribute('image', this._image);
        if (options.type) {
            button.setAttribute('type', options.type);
            if (options.type === 'checkbox') {
                button.setAttribute('autocheck', false);
            }
        }
        if (this._tooltiptext) {
            button.setAttribute('tooltiptext', this._tooltiptext);
        }
        if (options.accesskey) {
            button.setAttribute('accesskey', options.accesskey);
        }
        if (options.menuId) {
            this.menuid = options.menuId;
            let menu = this.menu = doc.createElement('menupopup');
            menu.setAttribute('id', options.menuId);
            button.appendChild(menu);
        }
        this.emit('create', this);
        return button;
    },

    /**
     * @see sdk/widget.js > _insertNodeInToolbar()
     */
    _insertItem: function _insertItem(options) {
        var doc = this.window.document;

        var toolbox = doc.getElementById('navigator-toolbox');
        toolbox.palette.appendChild(this.button);

        // Search for button toolbar by reading toolbar's currentset attribute
        var container = null;
        var toolbars = doc.getElementsByTagName('toolbar');
        var id = options.id;
        for (let i = 0, l = toolbars.length; i < l; i++) {
            let toolbar = toolbars[i];
            if (toolbar.getAttribute('currentset').indexOf(id) == -1) {
                continue;
            }
            container = toolbar;
        }

        // if button isn't in any toolbar, add it to the nav-bar
        // (only on first execution, so the user can remove it)
        if (!container) {
            let storageId = 'toolbar-button-' + id + '-initialized';
            if (!storage[storageId]) {
                container = doc.getElementById('nav-bar');
                storage[storageId] = true;
            } else {
                return;
            }
        }

        // Now retrieve a reference to the next toolbar item
        // by reading currentset attribute on the toolbar
        var nextNode = null;
        var currentSet = container.getAttribute('currentset');
        var ids = (currentSet == '__empty') ? [] : currentSet.split(',');
        var idx = ids.indexOf(id);
        if (idx !== -1) {
            for (let i = idx; i < ids.length; i++) {
                nextNode = doc.getElementById(ids[i]);
                if (nextNode) {
                    break;
                }
            }
        }

        if (!nextNode) {
            if (options.before) {
                nextNode = doc.getElementById(options.before);
            }
            else if (options.after) {
                let prevNode = doc.getElementById(options.after);
                if (prevNode) {
                    nextNode = prevNode.nextElementSibling;
                }
            }
        }

        // Finally insert our button in the right toolbar and in the right position
        container.insertItem(id, nextNode, null, false);

        // Update DOM in order to save new position.
        if (idx === -1) {
            container.setAttribute('currentset', container.currentSet);
            // Save DOM attribute in order to save position on new window opened
            this.window.document.persist(container.id, 'currentset');
        }
    },

    /**
     * @see sidebar.js > _onMenuShowing()
     */
    _onPopupShowing: function _onPopupShowing(event) {
        var hasItems = false;
        var lastSeparator = null;
        for (let item = event.target.firstElementChild; item !== null; item = item.nextElementSibling ) {
            if ((item.localName === 'menuitem') && (item.hidden !== true)) {
                hasItems = true;
                lastSeparator = null;
            }
            if (item.localName === 'menuseparator') {
                //hide separator at beginning
                item.hidden = !hasItems;
                if (lastSeparator) {
                    //hide double-separators
                    lastSeparator.hidden = true;
                }
                lastSeparator = item;
            }
        }
        if (lastSeparator) {
            //hide separator at end
            lastSeparator.hidden = true;
        }
        if (!hasItems) {
            event.preventDefault();
        }
    },

    get image() {
        return this._image;
    },

    set image(value) {
        if (this.button) {
            this.button.setAttribute('image', value);
        }
        this._image = value;
    },

    get label() {
        return this._label;
    },

    set label(value) {
        if (this.button) {
            this.button.setAttribute('label', value);
        }
        this._label = value;
    },

    get tooltiptext() {
        return this._tooltiptext;
    },

    set tooltiptext(value) {
        if (this.button) {
            this.button.setAttribute('tooltiptext', value);
        }
        this._tooltiptext = value;
    },

    _onCommand: function _onCommand(event) {
        if (event.target !== this.button){ return; }
        this.emit('click', this.button, this.menu);
    },

    _destroyButton: function _destroyButton() {
        this.button.removeEventListener('command', this._onCommand, false);
        this.button.parentNode.removeChild(this.button);
        this.button = null;
    },

    _destroyMenuListener: function _destroyMenuListener() {
        if (this.menu) {
            this.menu.removeEventListener('popupshowing', this._onPopupShowing, false);
            this.menu = null;
        }
    },

    _destroyWindowRef: function _destroyWindowRef() {
        this.window = null;
    }

});
exports.ToolbarButton = ToolbarButton;
