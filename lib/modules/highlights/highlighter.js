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

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { WindowTabsMonitor } = require('../../browser/tabs');
const { Namespace } = require('sdk/core/namespace');

const { scrollToElement, getOffsetRect, getDocumentOffsetRatio } = require('../../utils/dhtml');
const { findRanges, rangesFilterByLocalDescriptor, rangeCompleteElements } = require('../../utils/search');

const { uuidhash } = require('../../utils/strings');
const { urlHash } = require('../../utils/urls');

const contentStyles = require('sdk/self').data.url('modules/highlights/content.css');

/**
 * Attaches to a browser window and allows to highlight unique passages
 * of text in each document. If a document is unloaded, the highlights
 * remain stored per url and are automatically restored if the same page
 * is loaded again later.
 *
 * @param {object} options
 *
 * - {WindowTabsMonitor} tabs  The underlying tabs monitor (required).
 *
 * - {function} onHighlight
 *   Called whenever a highlight is created by a call to highlight().
 *
 * - {function} onHighlightNew
 *   Called whenever a new highlight id is generated, as opposed to a call to highlight() with a pre-determined id.
 *
 * - {function} onHighlightFailed
 *   Called when a highlight could not be inserted, either at creation time or delayed at page load.
 *
 * - {function} onHighlightRemove
 *   Called whenever a highlight is removed, by a call to unhighlight() or by the user via close click.
 *
 * - {function} onHighlightCloseClick
 *   Called whenever a user explicitly removes, a highlight by clicking its close button.
 *
 */
const DomHighlighter = Class({
    extends: EventHub,
    className: 'DomHighlighter',

    initialize: function initialize(options) {
        if (!(options.tabs instanceof WindowTabsMonitor)) {
            throw new TypeError('DomHighlighter requires an instance of WindowTabsMonitor to operate');
        }
        this.tabs = options.tabs;
        this._hlID = {}; //id > desc
        this._hlURL = {}; // urlhash, id > desc
        this._hlDOM = new Namespace(); // doc + id > wraps, accessories...

        EventHub.prototype.initialize.apply(this, arguments);

        this.subscribeTo(this.tabs, 'documentReady');
        this.subscribeTo(this.tabs, 'documentUnload');
    },

    _destroySubscriptions: function _destroySubscriptions() {
        for each (let doc in this.tabs.getAllDocs()) {
            this._onDocumentUnload(doc);
        }
        this.tabs = null;
    },

    _onDocumentReady: function _onDocumentReady(doc) {
        var urlhash = urlHash(doc.URL);
        for each (let hl in (this._hlURL[urlhash] || {})) {
            try {
                this._doInsert(doc, hl);
            }
            catch (e) {
                this.emit('restoreError', e, hl);
            }
        }
    },

    _onDocumentUnload: function _onDocumentUnload(doc) {
        try {
            var urlhash = urlHash(doc.URL);
            for (let id in (this._hlURL[urlhash] || {})) {
                this._doRemove(doc, id);
            }
            var styles = this._hlDOM(doc)['styles'];
            if (styles) {
                styles.parentNode.removeChild(styles);
            }
        }
        catch (e) {
            console.warn(e.message);
        }
    },


    _store: function _store(hl) {
        this._hlID[hl.id] = hl;
        var urlhash = urlHash(hl.url);
        if (!this._hlURL[urlhash]) {
            this._hlURL[urlhash] = {};
        }
        this._hlURL[urlhash][hl.id] = hl;
        return hl;
    },
    _deleteByID: function _deleteByID(id) {
        var hl = this._hlID[id];
        if (hl) {
            delete this._hlID[id];
            let urlhash = urlHash(hl.url);
            let urlStore = this._hlURL[urlhash];
            delete urlStore[id];
            if (!Object.keys(urlStore).length) {
                delete this._hlURL[urlhash];
            }
        }
    },
    _deleteByURL: function _deleteByURL(url) {
        var urlhash = urlHash(url);
        for (let id in (this._hlURL[urlhash] || {})) {
            delete this._hlID[id];
        }
        delete this._hlURL[urlhash];
    },


    _doInsert: function _doInsert(doc, hl) {
        if (!doc) { return; } //may be called while doc not loaded
        if (Array.isArray(doc)) {
            for each (let d in doc) {
                this._doInsert(d, hl);
            }
            return;
        }

        var ns = this._hlDOM(doc);

        var ranges = [];
        for each (let text in hl.text) {
            let occurrences = findRanges(doc, text.$text);
            for each (let range in occurrences) {
                //we have to do this before filtering to ensure local descriptors match
                rangeCompleteElements(range);
            }
            occurrences = rangesFilterByLocalDescriptor(occurrences, text);
            if (!occurrences.length) {
                let error = new Error('not found');
                error.longDescription = 'Includes non-searchable or non-existing text.';
                throw error;
            }
            if (occurrences.length > 1) {
                let error = new Error('not unique');
                error.longDescription = 'Selection must be unique in surrounding text block.';
                error.rangeText = text.$text;
                throw error;
            }
            let range = occurrences[0];

            if (!hl.$transient) {
                for each (let highlight in ns) {
                    if (!highlight.$transient) {
                        for each (let wrap in highlight.wraps) {
                            let r = doc.createRange();
                            r.selectNodeContents(wrap);
                            let c1 = r.compareBoundaryPoints(r.END_TO_START, range); //-1 if new end after old start
                            let c2 = r.compareBoundaryPoints(r.START_TO_END, range); //-1 if new start after old end
                            if (c1 !== c2) { //1,1: start+end before old | -1,-1 start+end after old
                                let error = new Error('intersects other highlight');
                                error.longDescription = 'Highlights must not overlap.';
                                error.rangeText = text.$text;
                                throw error;
                            }
                        }
                    }
                }
            }

            ranges.push(range);
        }

        console.info('Highlight insert: ' + hl.id);

        var elements = ns[hl.id] = {};
        var wraps = elements.wraps = [];
        var accessories = elements.accessories = [];
        var hoverShow = elements.hoverShow = [];
        var alignShow = elements.alignShow = [];

        for each(let range in ranges) {
            let wrap = doc.createElement('span');
            wrap.classList.add('coopfox-highlight');
            if (hl.$transient) {
                wrap.classList.add('coopfox-highlight-transient');
            }
            wrap.style.setProperty('background-color', hl.$color, 'important');
            range.surroundContents(wrap);

            wrap.addEventListener('mouseover', this._onMouseOver.bind(this, hl.id));
            wrap.addEventListener('mouseout', this._onMouseOut.bind(this, hl.id));
            wrap.addEventListener('click', this._onClick.bind(this, hl.id));
            wrap.addEventListener('dblclick', this._onDblClick.bind(this, hl.id));
            wraps.push(wrap);
        }

        if (!hl.$transient) {
            //add accessories
            wraps[0].id = hl.id; //required for jump-to

            let close = doc.createElement('a');
            close.classList.add('coopfox-highlight-close');
            accessories.push(close);
            hoverShow.push(close);
            close.addEventListener('click', this._onCloseClick.bind(this, hl.id));
            wraps[0].appendChild(close);

            let notes = elements.annotationContainer = doc.createElement('ul');
            elements.annotations = {};
            notes.classList.add('coopfox-highlight-annotations');
            accessories.push(notes);
            hoverShow.push(notes);
            alignShow.push(notes);
            doc.querySelector('body').appendChild(notes);

            for (let messageId in hl.$annotations) {
                this._doAddAnnotation(doc, hl.id, messageId, hl.$annotations[messageId]);
            }

        } else {
            elements.$transient = true;
        }

        var radar = doc.createElement('a');
        radar.classList.add('coopfox-highlight-radar');
        if (hl.$transient) {
            radar.classList.add('coopfox-highlight-radar-transient');
        }
        radar.style.setProperty('top', (getDocumentOffsetRatio(wraps[0]).top * 100).toFixed(2) + '%', 'important');
        radar.style.setProperty('color', hl.$color, 'important');
        accessories.push(radar);
        radar.addEventListener('click', this._onRadarClick.bind(this, hl.id));
        radar.addEventListener('mouseover', this._onMouseOver.bind(this, hl.id));
        radar.addEventListener('mouseout', this._onMouseOut.bind(this, hl.id));
        doc.querySelector('body').appendChild(radar);

        if (!ns.styles) {
            let styles = ns.styles = doc.createElement('link');
            styles.rel = 'stylesheet';
            styles.type = 'text/css';
            styles.href = contentStyles;
            doc.querySelector('head').appendChild(styles);
        }
    },

    _doRemove: function _doRemove(doc, id) {
        if (!doc) { return; } //may be called while doc not loaded
        if (Array.isArray(doc)) {
            for each (let d in doc) {
                this._doRemove(d, id);
            }
            return;
        }

        var elements = this._hlDOM(doc)[id];
        if (!elements) { return; }

        console.info('Highlight remove: ' + id);

        for each (let accessory in elements.accessories) {
            accessory.parentNode.removeChild(accessory);
        }
        for each (let wrap in elements.wraps) {
            var range = doc.createRange();
            range.selectNodeContents(wrap);
            var content = range.extractContents();
            var parent = wrap.parentNode;
            parent.replaceChild(content, wrap);
            parent.normalize();
        }

        delete this._hlDOM(doc)[id];
    },

    _doAddAnnotation: function _doAddAnnotation(doc, highlightId, messageId,  note) {
        if (!doc) { return; }
        if (Array.isArray(doc)) {
            for each (let d in doc) {
                this._doAddAnnotation(d, highlightId, messageId,  note);
            }
            return;
        }

        var elements = this._hlDOM(doc)[highlightId];
        if (!elements) { return; }
        var notes = elements.annotationContainer;

        var entry = doc.createElement('li');
        var author = doc.createElement('span');
        author.textContent = note.authorName;
        author.style.setProperty('color', note.authorColor, 'important');
        entry.appendChild(author);
        var text = doc.createTextNode(note.text);
        entry.appendChild(text);
        notes.appendChild(entry);

        if (!Object.keys(elements.annotations).length) {
            let indicator = doc.createElement('span');
            indicator.classList.add('coopfox-highlight-annotations-indicator');
            elements.accessories.push(indicator);
            elements.wraps[elements.wraps.length-1].appendChild(indicator);
            elements.annotations['indicator'] = indicator;
        }

        elements.annotations['indicator'].style.setProperty('color', note.authorColor, 'important');
        elements.annotations[messageId] = entry;
    },

    _doRemoveAnnotation: function _doRemoveAnnotation(doc, highlightId, messageId) {
        if (!doc) { return; }
        if (Array.isArray(doc)) {
            for each (let d in doc) {
                this._doRemoveAnnotation(d, highlightId, messageId);
            }
            return;
        }

        var elements = this._hlDOM(doc)[highlightId];
        if (!elements) { return; }
        var annotations = elements.annotations;
        var entry = annotations[messageId];
        if (!entry) { return; }

        entry.parentNode.removeChild(entry);
        delete annotations[messageId];
        if ((Object.keys(annotations).length === 1) && (annotations['indicator'])) {
            let indicator = annotations['indicator'];
            indicator.parentNode.removeChild(indicator);
            elements.accessories.splice(elements.accessories.indexOf(indicator), 1);
            delete annotations['indicator'];
        }
    },

    _onMouseOver: function _onMouseOver(id, event) {
        var doc = event.currentTarget.ownerDocument;
        var elements = this._hlDOM(doc)[id];

        if (elements.wraps.length > 1) {
            for each (let el in elements.wraps) {
                el.style.setProperty('top', '1px', 'important');
            }
        }
        for each (let el in elements.hoverShow) {
            el.style.setProperty('display', 'block', 'important');
        }

        if (elements.alignShow.length) {
            let bottom = 0;
            let left = Number.MAX_VALUE;
            for each (let el in elements.wraps) {
                let offset = getOffsetRect(el);
                bottom = Math.max(bottom, offset.bottom);
                left = Math.min(left, offset.left);
            }
            for each (let el in elements.alignShow) {
                el.style.top = bottom + 'px';
                el.style.left = left + 'px';
                bottom += el.offsetHeight;
            }
        }
    },
    _onMouseOut: function _onMouseOut(id, event) {
        var doc = event.currentTarget.ownerDocument;
        var elements = this._hlDOM(doc)[id];
        for each (let el in elements.wraps) {
            el.style.setProperty('top', '0', 'important');
        }
        for each (let el in elements.hoverShow) {
            el.style.setProperty('display', 'none', 'important');
        }
    },

    _onClick: function _onClick(id, event) {
        this.emit('click', this._hlID[id]);
    },

    _onDblClick: function _onDblClick(id, event) {
        event.preventDefault();
        event.stopPropagation();
        this.emit('dblClick', this._hlID[id]);
    },

    _onCloseClick: function _onCloseClick(id, event) {
        event.preventDefault();
        event.stopPropagation();
        var hl = this._hlID[id];
        this.emit('closeClick', hl);
    },

    _onRadarClick: function _onRadarClick(id, event) {
        var doc = event.currentTarget.ownerDocument;
        var elements = this._hlDOM(doc)[id];
        scrollToElement(elements.wraps[0]);
        return false;
    },

    /**
     * Creates a new highlight for a url. The corresponding page
     * does not have to be opened in any tab for this to work.
     * The highlight will be stored and created on page load.
     *
     * @param {object} hl   A highlight descriptor (stanza)
     * - {string}   url         Url to attach highlights to.
     * - {object[]} texts       Unique texts to highlight, including context info.
     * - {string}   $color      CSS background color for highlight.
     * - {string}   id          (Optional) A global id for this highlight.
     * - {boolean}  $transient  The highlight will not receive any user controls.
     *
     * @throws {TypeError}      If url/texts are invalid
     * @throws {Error}          If the highlight cannot be inserted (@see _doInsert).
     *
     * You may also wich to listen for "highlightFailed" events, which
     * will tell you more about the reason of failure. Also not that such
     * an event is also fired on delayed creation of highlights at page
     * load, while the return value only indicates immediate failures.
     */
    insert: function insert(hl) {
        if (typeof(hl.url) !== 'string') {
            throw new TypeError('Highlight URL invalid.');
        }
        if (hl.id) {
            if (this._hlID[hl.id]) {
                throw new Error('Duplicate highlight ID.');
            }
        } else {
            hl.id = uuidhash(16);
        }
        if (!Array.isArray(hl.text)) {
            hl.text = [hl.text];
        }
        if (!hl.$color) {
            hl.$color = '#aaa';
        }
        hl.$transient = !!hl.$transient;
        if (!hl.$annotations) {
            hl.$annotations = {};
        }

        var docs = this.tabs.getDocsForUrl(hl.url); //May be empty, if the url is not currently open.
        this._doInsert(docs, hl); //may throw errors!

        this._store(hl);
        this.emit('insert', hl);
        return hl;
    },

    /**
     * Remove a highlight previously set with insert() by its ID.
     *
     * @param {string} id       Unique highlight ID to be removed.
     */
    remove: function remove(id) {
        var hl = this._hlID[id];
        if (hl) {
            var docs = this.tabs.getDocsForUrl(hl.url);
            this._doRemove(docs, id);
            this._deleteByID(id);
            this.emit('remove', hl);
        }
    },

    has: function has(id) {
        return !!this._hlID[id];
    },

    /**
     * Returns the screen position of a highlight by its ID.
     *
     * @param {string} id
     * @param {nsIDOMDocument} doc  (Optional, defaults to current)
     * @returns {object|null}
     */
    getScreenOffset: function getScreenOffset(id, doc) {
        if (!doc) {
            doc = this.tabs.activeDoc;
            if (!doc) {
                return null;
            }
        }
        var elements = this._hlDOM(doc)[id];
        if (!elements) {
            return null;
        }

        var result = { top: Number.MAX_VALUE, left: Number.MAX_VALUE };
        for each (let wrap in elements.wraps) {
            let offset = wrap.getBoundingClientRect();
            result.top = Math.min(result.top, offset.top);
            result.left = Math.min(result.left, offset.left);
        }
        return result;
    },

    addAnnotation: function addAnnotation(highlightId, messageId, text, authorName, authorColor) {
        var hl = this._hlID[highlightId];
        if (hl) {
            let note = {
                text: text,
                authorName: authorName || 'Anonymous',
                authorColor: authorColor || '#aaa'
            };
            var docs = this.tabs.getDocsForUrl(hl.url);
            this._doRemoveAnnotation(docs, highlightId, messageId); //avoid duplicates
            hl.$annotations[messageId] = note;
            this._doAddAnnotation(docs, highlightId, messageId,  note);
        }
    },

    removeAnnotation: function removeAnnotation(highlightId, messageId) {
        var hl = this._hlID[highlightId];
        if (hl) {
            delete hl.$annotations[messageId];
            var docs = this.tabs.getDocsForUrl(hl.url);
            this._doRemoveAnnotation(docs, highlightId, messageId);
        }
    }

});
exports.DomHighlighter = DomHighlighter;

