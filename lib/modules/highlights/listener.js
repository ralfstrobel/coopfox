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

const { nsISelectionPrivate, nsISelectionListener } = require('chrome').Ci;
const { MOUSEDOWN_REASON, MOUSEUP_REASON, KEYPRESS_REASON } = nsISelectionListener;

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { WindowTabsMonitor } = require('../../browser/tabs');
const { ContextMenuItem } = require('../../browser/context-menus');

const { url } = require('sdk/self').data;
const clipboard = require('sdk/clipboard');

const {
    rangeTrim,
    rangeCompleteWords,
    rangeCompleteElements,
    rangeSplitBlocks,
    rangeGetLocalDescriptor
} = require('../../utils/search');


/**
 * Attaches to a browser window and captures selections the user makes in the html documents.
 *
 * @param {object} options
 *
 * - {WindowTabsMonitor} tabs  The underlying tabs monitor (required).
 *
 * - {function} onSelection
 *   Called when a new proper selection on any document is detected.
 */
const SelectionListener = Class({
    extends: EventHub,
    className: 'SelectionListener',

    initialize: function initialize(options) {
        if (!(options.tabs instanceof WindowTabsMonitor)) {
            throw new TypeError('SelectionListener requires an instance of WindowTabsMonitor to operate');
        }
        this.tabs = options.tabs;
        this._currentTransient = new WeakMap();
        this.lastMousePos = { left: 0, top: 0 };

        EventHub.prototype.initialize.apply(this, arguments);
        this.subscribeTo(options.tabs, 'documentReady');
        this.subscribeTo(options.tabs, 'documentUnload');
    },

    _destroySubscriptions: function _destroySubscriptions() {
        for each (let doc in this.tabs.getAllDocs()) {
            this._onDocumentUnload(doc);
        }
        this.tabs = null;
    },

    _initContextMenu: function _initContextMenu() {
        var self = this;
        var window = this.tabs.window;
        this._menuItems = [

            new ContextMenuItem({
                window: window,
                label: 'Direct-Quote Selection',
                image: url('images/icon.png'),
                acceltext: 'Alt + Select',
                before: 'context-copy',
                onShow: function onShow(target) {
                    var doc = target.ownerDocument;
                    var selection = doc.defaultView.getSelection();
                    if (!self.tabs.isValidDoc(doc) || selection.isCollapsed || !selection.toString().trim().length){
                        this.hidden = true;
                    }
                    else if (!selection.containsNode(target, true)) {
                        this.hidden = true;
                    }
                },
                onClick: function onClick(target) {
                    self._onSelection(target.ownerDocument);
                }
            }),

            new ContextMenuItem({
                window: window,
                label: 'Direct-Quote Link Text',
                image: url('images/icon.png'),
                before: 'context-copy',
                selectors: ['a[href]'],
                onClick: function onClick(target, link) {
                    var doc = target.ownerDocument;
                    var selection = doc.defaultView.getSelection().selectAllChildren(link);
                    self._onSelection(doc, false);
                }
            }),

            new ContextMenuItem({
                window: window,
                label: 'Select Whole Link',
                before: 'context-copy',
                selectors: ['a[href]'],
                onClick: function onClick(target, link) {
                    var doc = target.ownerDocument;
                    var selection = doc.defaultView.getSelection().selectAllChildren(link);
                    self._onSelection(doc, true);
                }
            }),

            new ContextMenuItem({
                window: window,
                label: 'Copy Quoted Text',
                image: url('images/icon.png'),
                before: 'context-copy',
                selectors: ['.coopfox-highlight'],
                onClick: function onClick(target, highlight) {
                    clipboard.set(highlight.textContent, 'text');
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

    _onDocumentReady: function _onDocumentReady(doc) {
        //console.info('SelectionListener attached to : ' + doc.URL);
        var selection = doc.defaultView.getSelection();
        if (selection instanceof nsISelectionPrivate) {
            selection.addSelectionListener(this);
        }
        doc.addEventListener('mouseup', this._onMouseUp);
    },

    _onDocumentUnload: function _onDocumentUnload(doc) {
        //console.info('SelectionListener detached from : ' + doc.URL);
        try {
            var selection = doc.defaultView.getSelection();
            if (selection instanceof nsISelectionPrivate) {
                selection.removeSelectionListener(this);
            }
            doc.removeEventListener('mouseup', this._onMouseUp);
            if (this._currentTransient.get(doc, '')) {
                this.emit('transientSelection', doc, [], []);
            }
            this._currentTransient.delete(doc);
        }
        catch (e) {
            console.warn(e.message);
        }
    },

    _onMouseUp : function _onMouseUp(event) {
        //TODO: Allow users to customize key in preferences
        this.lastMousePos = { left: event.clientX, top: event.clientY };
        this._onSelection(event.currentTarget, !event.altKey);
    },

    // nsISelectionListener
    notifySelectionChanged: function notifySelectionChanged(doc, selection, reason) {
        switch (reason) {
            //case NO_REASON:
            //case DRAG_REASON:
            case MOUSEUP_REASON:
                //handled by mouse-up listener
            break;
            case MOUSEDOWN_REASON:
            case KEYPRESS_REASON:
            //case SELECTALL_REASON:
                this._onSelection(doc, true);
            break;
            default:
                if (!selection.toString().trim().length) {
                    this._onSelection(doc, true); //always deliver unselect
                }
            break;
        }
    },

    _onSelection: function _onSelection(doc, transient) {
        if (!this.tabs.isValidDoc(doc)) { return; }
        var { selection, ranges, texts } = this.getSelection(doc, !transient);

        if (transient) {
            let strVal = selection.toString();
            if (this._currentTransient.get(doc, '') !== strVal) {
                this.emit('transientSelection', doc, texts, ranges);
                this._currentTransient.set(doc, strVal);
            }
            return;
        }

        if (texts.length) {
            this.emit('selection', doc, texts, ranges);
            selection.collapseToEnd(); //unselect
        }
    },

    /**
     * Returns the current, postprocessed selection for the given document.
     *
     * @param {nsIDOMDocument} doc
     * @param {boolean} completeWords
     * @returns {{selection: nsISelection, ranges: nsIDomRange[], texts: string[]}}
     */
    getSelection: function getSelection(doc, completeWords) {
        var selection = doc.defaultView.getSelection();
        var result = {
            selection: selection,
            ranges: [],
            texts: []
        };

        try {
            for (let i = 0; i < selection.rangeCount; i++) {
                let range = selection.getRangeAt(i);
                //exit from empty ranges early, to avaoid phantom selections by ensureWrappable
                if (range.collapsed || !range.toString().trim().length) { continue; }

                if (completeWords) {
                    rangeCompleteWords(range);
                    rangeTrim(range);
                } else {
                    rangeTrim(range, /[\r\n]/);
                }
                for each (let splitRange in rangeSplitBlocks(range)) {
                    selection.addRange(splitRange);
                }
                rangeCompleteElements(range);

                let text = rangeGetLocalDescriptor(range);
                text.$text = range.toString(); //no trim, or descriptor will mismatch

                result.ranges.push(range);
                result.texts.push(text);
            }
        }
        catch (e) {
            console.exception(e);
        }

        return result;
    }

});
exports.SelectionListener = SelectionListener;

