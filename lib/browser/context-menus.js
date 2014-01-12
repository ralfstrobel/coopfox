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

const { nsIDOMNode, nsIDOMElement } = require('chrome').Ci;

const { Class } = require('sdk/core/heritage');
const { MenuItem } = require('./menus');

/**
 * Adds an item to an existing context menu.
 *
 * The item is only displayed when the user
 * clicks on specific html elements matching one
 * of the selectors given in options.selectors.
 */
const ContextMenuItem = Class({
    extends: MenuItem,
    className: 'ContextMenuItem',

    initialize: function initialize(options) {
        if (!options.menu) {
            options.menu = 'contentAreaContextMenu';
        }
        this._selectors = options.selectors || [];

        MenuItem.prototype.initialize.apply(this, arguments);
    },

    _getSelectorTriggerNode: function _getSelectorTriggerNode() {
        var triggerNode = this.menu.triggerNode;
        var selectorNode = null;
        var selectorDistance = Number.MAX_VALUE;

        for each (let selector in this._selectors) {
            let match = getMatchingParent(triggerNode, selector);
            if (match) {
                if (match.distance > selectorDistance) {
                    continue;
                }
                selectorNode = match.node;
                selectorDistance = match.distance;
            }
        }
        return selectorNode;
    },

    _onPopupShowing: function _onPopupShowing(event) {
        if (event.type != 'popupshowing') { return; }
        if (event.target != this.menu) { return; }

        var selectorNode = this._getSelectorTriggerNode();
        if (this._selectors.length && !selectorNode) {
            this.hidden = true;
            return;
        }

        this._reset();
        this.emit('show', this.menu.triggerNode, selectorNode, this);
    },

    _onCommand: function _onCommand(event) {
        if (event.target !== this.item){ return; }
        this.emit('click', this.menu.triggerNode, this._getSelectorTriggerNode(), this);
    }

});
exports.ContextMenuItem = ContextMenuItem;

/**
 * Find a parent node matching a given selector, if one exists.
 *
 * @param {nsIDOMNode} node
 * @param {string} selector
 * @returns {object}
 */
function getMatchingParent(node, selector) {
    if (!(node instanceof nsIDOMNode)) {
        return null;
    }
    var distance = 0;
    if (!(node instanceof nsIDOMElement)) {
        node = node.parentElement;
        distance++;
    }
    while (node) {
        if (node.mozMatchesSelector(selector)) {
            return { node: node, distance: distance };
        }
        node = node.parentElement;
        distance++;
    }
    return null;
}
