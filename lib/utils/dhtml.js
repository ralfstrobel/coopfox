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

const { Cc, Ci } = require('chrome');

const { nsIDOMNode, nsIDOMElement, nsIDOMDocument } = Ci;
const { TEXT_NODE, ELEMENT_NODE, DOCUMENT_NODE, CDATA_SECTION_NODE, DOCUMENT_FRAGMENT_NODE } = nsIDOMNode;

/**
 * Returns the closest ancestor element which is scrolling.
 * (Only actually scrolling elements are found, independend of style definition.)
 *
 * @param {nsIDOMElement} el
 * @param {bool} excludeX	Exclude horizontal scrollers.
 * @param {bool} excludeY	Exclude vertical scrollers.
 * @returns {nsIDOMElement|null}
 */
function getScrollParent(el, excludeX, excludeY) {
    while (el.parentElement) {
        el = el.parentElement;
        if (!excludeY && (el.scrollTopMax > 0)) {
            return el;
        }
        if (!excludeX && (el.scrollLeftMax > 0)) {
            return el;
        }
    }
    return null;
}
exports.getScrollParent = getScrollParent;

/**
 * Returns the outmost scrolling ancestor for an element,
 * which should be the document's main scroll pane (not always <body>!).
 *
 * @param {nsIDOMElement} el
 * @returns {nsIDOMElement}
 */
function getOutmostScrollAncestor(el) {
    var doc = el.ownerDocument;
    var viewportHeight = doc.body.clientHeight;
    var viewportWidth = doc.body.clientWidth;
    var scrollParent = doc.documentElement;
    el = el.parentElement;
    while (el) {
        if (
            ((el.scrollTopMax > 0) && (el.scrollHeight > viewportHeight)) ||
            ((el.scrollLeftMax > 0) && (el.scrollWidth > viewportWidth))
        ) {
            scrollParent = el;
        }
        el = el.parentElement;
    }
    return scrollParent;
}
exports.getOutmostScrollAncestor = getOutmostScrollAncestor;

/**
 * Computes the relative Rect of an element, corrected for the position of an ancestor.
 *
 * @param {nsIDOMElement} el
 * @param {nsIDOMElement|null} relAncestor	(optional, defaults to document root)
 * @return {nsIDOMClientRect} Offset in pixels.
 */
function getOffsetRect(el, relAncestor) {
    var rawRect = el.getBoundingClientRect();
    if (el.offsetParent === null) {
        return rawRect;
    }
    if (!relAncestor) {
        relAncestor = el.ownerDocument.documentElement;
    }
    var relRect = relAncestor.getBoundingClientRect();

    //when relAncestor lies above the viewport element (e.g. <html>), the reported top will be -scrollTop
    var relLeft = Math.round(relAncestor.scrollLeft);
    if (Math.round(Math.abs(relRect.left)) !== relLeft) {
        relLeft -= relRect.left;
    }
    var relTop  = Math.round(relAncestor.scrollTop);
    if (Math.round(Math.abs(relRect.top)) !== relTop) {
        relTop -= relRect.top;
    }

    return {
        left: rawRect.left + relLeft,
        top: rawRect.top + relTop,
        right: rawRect.right + relLeft,
        bottom: rawRect.bottom + relTop
    };
}
exports.getOffsetRect = getOffsetRect;

/**
 * Computes the ratio of the element position to the document dimensions.
 *
 * @param {nsIDOMElement} el
 * @return {{left: {number}, top: {number}}}
 */
function getDocumentOffsetRatio(el) {
    var docScroll = getOutmostScrollAncestor(el);
    var rect = getOffsetRect(el, docScroll);
    return {
        left: rect.left / docScroll.scrollWidth,
        top: rect.top / docScroll.scrollHeight
    }
}
exports.getDocumentOffsetRatio = getDocumentOffsetRatio;

/**
 * Scrolls all scrolling ancestor elements recursively,
 * so that the given element is centered in all of them.
 *
 * @param {nsIDOMElement} el
 */
function scrollToElement(el) {
    var scrollParent = getScrollParent(el);
    if (scrollParent) {
        var rect = getOffsetRect(el, scrollParent);
        var left = rect.left - (scrollParent.clientWidth / 2) + ((rect.right - rect.left) / 2);
        var top  = rect.top - (scrollParent.clientHeight / 2) + ((rect.bottom - rect.top) / 2);
        scrollParent.scrollLeft = Math.min(Math.max(left, 0), scrollParent.scrollLeftMax);
        scrollParent.scrollTop = Math.min(Math.max(top, 0), scrollParent.scrollTopMax);
        scrollToElement(scrollParent);
    }
}
exports.scrollToElement = scrollToElement;

/**
 * Returns a CSS selector that matches the first unique ancestor
 * of a node. I.e. the selector will match exactly one element.
 *
 * @param {object}  node    Instance of nsIDOMNode.
 * @return {String} A unique css selector, or null on error.
 */
exports.uniqueAncestorSelector = function uniqueAncestorSelector(node) {
    function unique(sel) {
        return (node.ownerDocument.querySelectorAll(sel).length == 1);
    }
    while (node instanceof nsIDOMNode) {
        if (node instanceof nsIDOMElement) {
            if (node.id) {
                return '#' + node.id;
            }
            let sel = node.localName;
            if (unique(sel)) {
                return sel;
            }
            for (let i = 0; i < node.classList.length; i++) {
                sel += '.' + node.classList[i];
                if (unique(sel)) {
                    return sel;
                }
            }
        }
        node = node.parentNode;
    }
    return null;
};


/**
 * Displays a temporary, non-modal overlay popup at a
 * specified screen location of a web document.
 *
 * The life time of the popup depends on the length of
 * the message string to display.
 *
 * @param {nsIDOMDocument} doc
 * @param {number} x    Horizontal coordinate (relative to browser viewport)
 * @param {number} y    Vertical coordinate (relative to browser viewport)
 * @param {string} message  Plain-text message to display.
 */
exports.softAlert = function softAlert(doc, x, y, message) {

    var ttl = Math.ceil(message.length / 35);

    var div = doc.createElement('div');
    div.textContent = message;
    //div.classList.add('-x-coopfox-soft-alert');
    div.style.setProperty('position', 'fixed', 'important');
    div.style.setProperty('z-index', '9999', 'important');
    div.style.setProperty('left', (x+5) + 'px', 'important');
    div.style.setProperty('top', (y-25) + 'px', 'important');
    div.style.setProperty('display', 'block', 'important');
    div.style.setProperty('font', 'normal normal normal 10pt/1em arial,sans-serif', 'important');
    div.style.setProperty('cursor', 'pointer', 'important');
    div.style.setProperty('color', '#f11', 'important');
    div.style.setProperty('background-color', '#fff', 'important');
    div.style.setProperty('margin', '0', 'important');
    div.style.setProperty('padding', '5px', 'important');
    div.style.setProperty('border', '1px solid #aaa', 'important');
    div.style.setProperty('border-radius', '5px', 'important');
    div.style.setProperty('opacity', 0, 'important');
    div.style.setProperty('-moz-transition', 'opacity .3s ease-in-out', 'important');

    function click() {
        doc.defaultView.clearTimeout(timeout);
        div.removeEventListener('click', click);
        div.removeEventListener('transitionend', transitionEnd);
        doc.body.removeChild(div);
    }

    function transitionEnd() {
        if (div.style.opacity == 1) {
            div.style.setProperty('-moz-transition-delay', ttl + 's', 'important');
            div.style.setProperty('-moz-transition-duration', '1s', 'important');
            div.style.setProperty('opacity', 0, 'important');
        } else {
            click();
        }
    }

    div.addEventListener('transitionend', transitionEnd);
    div.addEventListener('click', click);

    doc.body.appendChild(div);

    //initiate transition as soon as possible (setting it here wouldn't work)
    doc.defaultView.setTimeout(function() {
        div.style.setProperty('opacity', 1, 'important');
    }, 0);

    //set second timeout to guarantee removal (tab switches make transition events unreliable)
    var timeout = doc.defaultView.setTimeout(click, (ttl + 2) * 1000 );

    console.info('softAlert: ' + message + ' (' + doc.URL + ')');
};