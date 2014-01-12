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

const { nsIDOMWindow, nsIDOMElement } = require('chrome').Ci;

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../utils/events');
const { setTimeout } = require('sdk/timers');

/**
 * Adds an item to an existing popup menu.
 *
 * The options can specify the following properties:
 * - {string} id
 * - {string} type
 * - {string} label
 * - {string} image     url to an image file to use as icon
 * - {string} tooltiptext
 * - {string} acceltext
 * - {string} accesskey
 * - {string} value
 * - {string} before    ID of another menu element
 * - {string} after     ID of another menu element
 * - {boolean} separatorBefore
 * - {boolean} separatorAfter
 *
 * Options can further contain the following event callbacks:
 *
 * - {function} onCreate: Called after creation of the XUL element.
 *                        Can be used to manually add styles or attributes.
 *
 * - {function} onShow: Called whenever the menu is about to be displayed.
 *                      Can be used to selectively hide or disable the item.
 *                      Visibility and label are reset before each call.
 *
 * - {function} onClick: Called when the menu item is clicked.
 */
const MenuItem = Class({
    extends: EventHub,
    className: 'MenuItem',

    initialize: function initialize(options) {
        if (!(options.window instanceof nsIDOMWindow)) {
            throw new TypeError('Undefined window for MenuItem.');
        }
        if (!options.menu) {
            throw new TypeError('Undefined menu ID for MenuItem.');
        }
        if (!options.label) {
            throw new TypeError('Undefined label for MenuItem.');
        }
        this.window = options.window;
        this.defaultLabel = options.label;
        if (options.menu instanceof nsIDOMElement) {
            this.menu = options.menu;
        } else {
            this.menu = this.window.document.getElementById(options.menu);
            if (!this.menu) {
                throw new Error('No matching menupopup element: ' + options.menu);
            }
        }
        if (this.menu.localName !== 'menupopup') {
            throw new Error('Invalid menu parent (' + this.menu.localName + ').');
        }

        EventHub.prototype.initialize.apply(this, arguments);

        this.menu.addEventListener('popupshowing', this._onPopupShowing, false);

        this._createItem(options);
        this._insertItem(options);
        this.item.addEventListener('command', this._onCommand, false);
    },

    _createItem: function _createItem(options) {
        var doc = this.window.document;
        var item = this.item = doc.createElement('menuitem');
        item.setAttribute('label', options.label);
        if (options.image) {
            item.setAttribute('image', options.image);
            item.classList.add('menuitem-iconic');
        }
        if (options.id) {
            item.setAttribute('id', options.id);
        }
        if (options.type) {
            item.setAttribute('type', options.type);
            item.setAttribute('autocheck', false);
            item.setAttribute('checked', false);
        }
        if (options.tooltiptext) {
            item.setAttribute('tooltiptext', options.tooltiptext);
        }
        if (options.acceltext) {
            item.setAttribute('acceltext', options.acceltext);
        }
        if (options.accesskey) {
            item.setAttribute('accesskey', options.accesskey);
        }
        if (options.value) {
            item.setAttribute('value', options.value);
        }
        this.emit('create', item);
    },

    _insertItem: function _insertItem(options) {
        var doc = this.window.document;

        var before = null;
        if (typeof(options.before) !== 'undefined') {
            if (options.before) {
                before = doc.getElementById(options.before);
            }
        }
        else if (typeof(options.after) !== 'undefined') {
            if (options.after) {
                before = doc.getElementById(options.after);
                if (before) {
                    before = before.nextElementSibling;
                }
            }
            else {
                before = this.menu.firstElementChild;
            }
        }

        this.menu.insertBefore(this.item, before);
        if (options.separatorBefore || options.separatorAfter) {
            this.separator = this.window.document.createElement('menuseparator');
        }
        if (options.separatorBefore) {
            this.menu.insertBefore(this.separator, this.item);
        }
        if (options.separatorAfter) {
            this.menu.insertBefore(this.separator, this.item.nextElementSibling);
        }
    },

    get hidden() {
        return this.item.hidden || false;
    },
    set hidden(value) {
        //Note: According to common usability standards,
        //non-contextual menu entries should never be hidden but only disabled
        this.item.hidden = !!value;
    },
    get disabled() {
        return this.item.disabled || false;
    },
    set disabled(value) {
        this.item.disabled = !!value;
    },
    get forbidden() {
        return this.item.style.color === '#C07C7C';
    },
    set forbidden(value) {
        if (value) {
            this.disabled = value;
        }
        this.item.style.color = value ? '#C07C7C' : '';
    },
    get checked(){
        return this.item.getAttribute('checked') === 'true';
    },
    set checked(value){
        if (this.item.hasAttribute('checked')) {
            this.item.setAttribute('checked', !!value);
        }
    },
    get label() {
        this.item.getAttribute('label') || '';
    },
    set label(value) {
        this.item.setAttribute('label', value);
    },
    get tooltiptext() {
        this.item.getAttribute('tooltiptext') || '';
    },
    set tooltiptext(value) {
        if (value) {
            this.item.setAttribute('tooltiptext', value);
        } else {
            this.item.removeAttribute('tooltiptext');
        }
    },

    _reset: function _reset() {
        this.hidden = false;
        this.disabled = false;
        this.forbidden = false;
        this.checked = false;
        this.item.setAttribute('label', this.defaultLabel);
    },

    _onPopupShowing: function _onPopupShowing(event) {
        if (event.type !== 'popupshowing') { return; }
        if (event.target !== this.menu) { return; }

        this._reset(); //return to default state (subscribers should change item per-click)
        this.emit('show', this.menu.triggerNode, this);
    },

    _onCommand: function _onCommand(event) {
        if (event.target !== this.item){ return; }
        this.emit('click', this.menu.triggerNode, this);
    },

    _destroyItem: function _destroyItem() {
        this.item.removeEventListener('command', this._onCommand, false);
        this.item.parentNode.removeChild(this.item);
        this.item = null;
        if (this.separator) {
            this.separator.parentNode.removeChild(this.separator);
            this.separator = null;
        }
    },

    _destroyMenuListener: function _destroyMenuListener() {
        this.menu.removeEventListener('popupshowing', this._onPopupShowing, false);
        this.menu = null;
        this.window = null;
    }

});
exports.MenuItem = MenuItem;
