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

const { md5 } = require('../utils/strings');

/**
 * Finds occurrences of a string within a DOM node/document,
 * as if its content was rendered as a plaintext string.
 *
 * @param {object} node     Instance of nsIDOMNode to search.
 * @param {string} str      String to find.
 * @param {number} maxCount Maximum number of occurrences to return (optional).
 * @return {nsIDOMRange[]}  Up to maxCount found ranges.
 */
exports.findRanges = function findRanges(node, str, maxCount) {

    var document;
    if ((node instanceof nsIDOMDocument) && node.body) {
        document = node;
        node = document.body;
    }
    else if (node instanceof nsIDOMNode) {
        document = node.ownerDocument;
    } else {
        throw new TypeError('Invalid search target for findRanges().');
    }

    if (typeof(str) != 'string') {
        return [];
    }

    var searchRange = document.createRange();
    searchRange.selectNodeContents(node);
    var start = searchRange.cloneRange();
    start.collapse(true);
    var end = searchRange.cloneRange();
    end.collapse(false);

    var finder = Cc['@mozilla.org/embedcomp/rangefind;1'].createInstance(Ci.nsIFind);
    finder.caseSensitive = true;

    var result = [];
    if (typeof(maxCount) != 'number') {
        maxCount = Number.MAX_VALUE;
    }

    //this is not just a test but also a workaround for FF Bug #488427
    if (node.offsetWidth <= 0) {
        console.error('Unsearchable node passed to findRanges()');
        return [];
    }

    while (result.length <= maxCount) {
        let range = finder.Find(str, searchRange, start, end);
        if (!range) { break; }
        result.push(range);
        start = range.cloneRange();
        normalizeRangeStart(start);
        if (start.startContainer.nodeType === TEXT_NODE) {
            //enable overlapping results by only advancing one character
            start.setStart(start.startContainer, start.startOffset + 1);
            start.collapse(true);
        } else {
            start.collapse(false);
        }
    }

    return result;
};

/**
 * Contract a range by cutting off matching characters from each end.
 *
 * Note that this function always normalizes both range ends.
 * @see normalizeRangeStart()
 * @see normalizeRangeEnd()
 *
 * @param {nsIDOMRange} range
 * @param {RegExp} chars (defaults to \s)
 */
exports.rangeTrim = function rangeTrim(range, chars) {
    if (!chars) {
        chars = /\s/;
    }
    normalizeRangeStart(range);
    if (range.startContainer.nodeType === TEXT_NODE){
        while (true) {
            let mod = false;
            let str = range.startContainer.nodeValue;
            let offset = range.startOffset;
            while((offset < str.length) && (chars.test(str[offset]))){
                offset++;
                mod = true;
            }
            if (mod) {
                range.setStart(range.startContainer, offset);
                normalizeRangeStart(range);
            } else {
                break;
            }
        }
    }
    normalizeRangeEnd(range);
    if (range.endContainer.nodeType === TEXT_NODE){
        while (true) {
            let mod = false;
            let str = range.endContainer.nodeValue;
            let offset = range.endOffset;
            while((offset > 0) && (chars.test(str[offset - 1]))){
                offset--;
                mod = true;
            }
            if (mod) {
                range.setEnd(range.endContainer, offset);
                normalizeRangeEnd(range);
            } else {
                break;
            }
        }
    }
};

/**
 * Expands a range to fully include incomplete words at beginning and end.
 *
 * @param {nsIDOMRange} range
 */
exports.rangeCompleteWords = function rangeCompleteWords(range) {
    if (range.startContainer.nodeType === TEXT_NODE){
        let prevSpace = range.startContainer.nodeValue.lastIndexOf(' ', range.startOffset);
        if (prevSpace !== -1) {
            range.setStart(range.startContainer, prevSpace + 1);
        }
    }
    if (range.endContainer.nodeType === TEXT_NODE){
        let nextSpace = range.endContainer.nodeValue.indexOf(' ', range.endOffset - 1);
        if (nextSpace !== -1) {
            range.setEnd(range.endContainer, nextSpace);
        }
    }
};

/**
 * Expands a range to fully include split elements at beginning and end.
 * This guarantees the correct execution of Range.surroundContents().
 *
 * Note that the modified range is by definition not normalized,
 * because it can be starting or ending on a non-text node.
 *
 * @param {nsIDOMRange} range
 */
exports.rangeCompleteElements = function rangeCompleteElements(range) {
    if (range.commonAncestorContainer.nodeType !== TEXT_NODE) {

        let startNode = range.startContainer;
        while (startNode.parentNode !== range.commonAncestorContainer) {
            startNode = startNode.parentNode;
            range.setStartBefore(startNode);
        }

        let endNode = range.endContainer;
        while (endNode.parentNode !== range.commonAncestorContainer) {
            endNode = endNode.parentNode;
            range.setEndAfter(endNode);
        }
    }
};

/**
 * Splits a range which encompasses multiple block-level elements into
 * separate ranges, each spanning the contents of one block. The offset
 * positions withint the start and end node remain unchanged.
 *
 * The input range is truncated to the end of the first block.
 * All new subsequent ranges are returned in an array.
 *
 * This function causes unexpected behaviour on denormalized ranges!
 *
 * @param {nsIDOMRange} range
 * @returns {nsIDOMRange[]}
 */
exports.rangeSplitBlocks = function rangeSplitBlocks(range) {
    var splitRanges = [];
    if (range.startContainer !== range.endContainer) {

        let node = range.startContainer;
        while (node.parentNode !== range.commonAncestorContainer) {
            let parent = node.parentNode;
            if (elementIsBlock(parent)) {
                let nextText = firstTextNode(parent, true);
                if (nextText && range.isPointInRange(nextText, 0)) {
                    let nextRange = range.cloneRange();
                    nextRange.setStart(nextText, 0);
                    splitRanges = splitRanges.concat(nextRange, rangeSplitBlocks(nextRange));
                }
                range.setEndAfter(parent.lastChild);
                normalizeRangeEnd(range);
                if (range.startContainer === range.endContainer) {
                    break;
                }
                node = range.startContainer; //restart recursion
            } else {
                node = parent;
            }
        }

    }
    return splitRanges;
};

/**
 * If a range starts before an element, or behind the end of a text node,
 * this will move the start pointer to the beginning of the next text node.
 *
 * @param {nsIDOMRange} range
 */
function normalizeRangeStart(range) {
    if (range.startContainer.nodeType !== TEXT_NODE) {
        let startNode = range.startContainer.childNodes[range.startOffset];
        if (!startNode) {
            startNode = range.startContainer;
        }
        startNode = firstTextNode(startNode);
        if (startNode) {
            range.setStart(startNode, 0);
        }
    }
    else if (range.startOffset >= range.startContainer.nodeValue.length) {
        let startNode = firstTextNode(range.startContainer, true);
        if (startNode) {
            range.setStart(startNode, 0);
        }
    }
}
exports.normalizeRangeStart = normalizeRangeStart;

/**
 * If a range ends after an element, or at the beginning of a text node,
 * this will move the end pointer to the end of the previous text node.
 *
 * @param {nsIDOMRange} range
 */
function normalizeRangeEnd(range) {
    if (range.endContainer.nodeType !== TEXT_NODE) {
        let endNode = range.endContainer.childNodes[range.endOffset - 1];
        if (!endNode) {
            endNode = range.endContainer;
        }
        endNode = lastTextNode(endNode);
        if (endNode) {
            range.setEnd(endNode, endNode.nodeValue.length);
        }
    }
    else if (range.endOffset <= 0) {
        let endNode = lastTextNode(range.endContainer, true);
        if (endNode) {
            range.setEnd(endNode, endNode.nodeValue.length);
        }
    }
}
exports.normalizeRangeEnd = normalizeRangeEnd;


function shortHash(str) {
    return md5(str).substr(0,8);
}

function nodeShortHash(node) {
    return (node instanceof nsIDOMNode) ? shortHash(node.textContent) : null;
}

function rangeParentBlock(range) {
    return nodeParentBlock(range.commonAncestorContainer);
}

function rangeContext(range) {
    var parent = rangeParentBlock(range);
    return nodeShortHash(parent);
}

function rangePreContext(range) {
    var parent = rangeParentBlock(range);
    var preParent = nodeParentBlock(lastTextNode(parent, true, null, 10));
    return nodeShortHash(preParent);
}

function rangePostContext(range) {
    var parent = rangeParentBlock(range);
    var postParent = nodeParentBlock(firstTextNode(parent, true, null, 10));
    return nodeShortHash(postParent);
}

function rangePreText(range) {
    var preText = '';
    var preNode = null;
    if (range.startContainer.nodeType === TEXT_NODE) {
        if (range.startOffset > 0) {
            preNode = range.startContainer;
            preText = preNode.nodeValue.substr(0, range.startOffset);
        }
    } else {
        preNode = range.startContainer.childNodes[range.startOffset];
    }
    while ((preText.length < 50) && preNode) {
        //iteratively search backwards through all siblings of the start node
        preNode = lastTextNode(preNode, true, range.startContainer.parentNode);
        if (preNode) {
            preText = preNode.nodeValue + preText;
        }
    }
    return preText.length ? shortHash(preText.substr(-50,50)) : null;
}

function rangePostText(range) {
    var postText = '';
    var postNode = null;
    if (range.endContainer.nodeType === TEXT_NODE) {
        postNode = range.endContainer;
        let text = postNode.nodeValue;
        if (range.endOffset < text.length) {
            postText = text.substr(range.endOffset, 50);
        }
    } else {
        postNode = range.endContainer.childNodes[range.endOffset - 1];
    }
    while ((postText.length < 50) && postNode) {
        //iteratively search forwards through all siblings of the start node
        postNode = firstTextNode(postNode, true, range.endContainer.parentNode);
        if (postNode) {
            postText += postNode.nodeValue;
        }
    }
    return postText.length ? shortHash(postText.substr(0,50)) : null;
}

function rangeXPath(range) {
    var node = range.commonAncestorContainer;
    return shortHash(nodeXPath(node, true));
}

/**
 * Returns an object containing hints about the surrounding text environment of a range.
 * This can be used to retroactively disambiguate search results,
 * if the searched text appared multiple times in the searched document.
 *
 * @param {object} range
 * @returns {object}
 * - {string} pretext       A hash code of the preceding 50 characters of text.
 * - {string} posttext      A hash code of the succeeding 50 characters of text.
 * - {string} context       A hash code of the surrounding element's text content.
 * - {string} preContext    A hash code of the surrounding element's previous sibling's text content.
 * - {string} postContext   A hash code of the surrounding element's next sibling's text content.
 */
exports.rangeGetLocalDescriptor = function rangeGetLocalDescriptor(range) {
    var result = {
        context: rangeContext(range),
        xpath: rangeXPath(range)
    };
    var preContext = rangePreContext(range);
    if (preContext) {
        result.precontext = preContext;
    }
    var postContext = rangePostContext(range);
    if (postContext) {
        result.postcontext = postContext;
    }
    var preText = rangePreText(range);
    if (preText) {
        result.pretext = preText;
    }
    var postText = rangePostText(range);
    if (postText) {
        result.posttext = postText;
    }
    return result;
};

/**
 * Reduce an ambiguous set of ranges, by comparing them to a known local descriptor.
 * @see rangeGetLocalDescriptor()
 *
 * Unless strict is true, the evaluation is incremental and will stop as soon as
 * there is only one match left. This can prevent hints taken from surrounding content
 * from eliminating correct results, should the range appear in a changed context.
 *
 * @param {nsIDOMRange[]} ranges
 * @param {object} descriptor
 * @param {boolean} strict
 * @returns {nsIDOMRange[]}
 */
exports.rangesFilterByLocalDescriptor = function rangesFilterByLocalDescriptor(ranges, descriptor, strict) {
    if ((ranges.length > 1) || strict) {
        if (descriptor.pretext) {
            ranges = ranges.filter(function(range) {
                return rangePreText(range) === descriptor.pretext;
            });
        }
        if ((ranges.length > 1) || strict) {
            if (descriptor.posttext) {
                ranges = ranges.filter(function(range) {
                    return rangePostText(range) === descriptor.posttext;
                });
            }
            if ((ranges.length > 1) || strict) {
                if (descriptor.context){
                    ranges = ranges.filter(function(range) {
                        return rangeContext(range) === descriptor.context;
                    });
                }
                if ((ranges.length > 1) || strict) {
                    if (descriptor.precontext) {
                        ranges = ranges.filter(function(range) {
                            return rangePreContext(range) === descriptor.precontext;
                        });
                    }
                    if ((ranges.length > 1) || strict) {
                        if (descriptor.postcontext) {
                            ranges = ranges.filter(function(range) {
                                return rangePostContext(range) === descriptor.postcontext;
                            });
                        }
                        if ((ranges.length > 1) || strict) {
                            ranges = ranges.filter(function(range) {
                                return rangeXPath(range) === descriptor.xpath;
                            });
                        }
                    }
                }
            }
        }
    }
    return ranges;
};


/**
 * Finds the first available text node appearing within or after a given node.
 * (Depth first search: children > siblings > parent siblings)
 *
 * The function ignores texts which are not part of regular text flow
 * (e.g. display:none, position:fixed, float:left...)
 *
 * @param {nsIDOMNode} node
 * @param {boolean} excludeSelf     Do not recurse into the start node, only into siblings and parents.
 * @param {nsIDOMNode} maxParent    Stop expanding parents upon reaching the given node (defaults to document root).
 * @param {number}  minLength       Minimum content length of the returned text node (defaults to 1)
 * @returns {nsIDOMNode|null}
 */
function firstTextNode(node, excludeSelf, maxParent, minLength) {
    if (!node){
        return node;
    }
    if (excludeSelf) {
        excludeSelf = node;
    }
    if (typeof(minLength) !== 'number') {
        minLength = 1;
    }
    if (!(maxParent instanceof nsIDOMNode)) {
        maxParent = node.ownerDocument.documentElement;
    }
    while (node) {
        if (node !== excludeSelf) {
            if (node.nodeType === TEXT_NODE) {
                if (node.nodeValue.trim().length >= minLength) {
                    return node;
                }
            }
            else {
                if (elementIsStatic(node)) {
                    //only expand visible elements (same behaviour as nsIFind)
                    if (node.firstChild) {
                        let subSearch = firstTextNode(node.firstChild, false, node, minLength);
                        if (subSearch){
                            return subSearch;
                        }
                    }
                }
            }
        }
        while (!node.nextSibling && (node.parentNode !== null) && (node.parentNode !== maxParent)) {
            node = node.parentNode;
        }
        node = node.nextSibling;
    }
    return node;
}
exports.firstTextNode = firstTextNode;

/**
 * Finds the last available text node appearing within or before a given node.
 * (Depth first search: children > siblings > parent siblings)
 *
 * The function ignores texts which are not part of regular text flow
 * (e.g. display:none, position:fixed, float:left...)
 *
 * @param {nsIDOMNode} node
 * @param {boolean} excludeSelf     Do not recurse into the start node, only into siblings and parents.
 * @param {nsIDOMNode} maxParent    Stop expanding parents upon reaching the given node (defaults to document root).
 * @param {number}  minLength       Minimum content length of the returned text node (defaults to 1)
 * @returns {nsIDOMNode|null}
 */
function lastTextNode(node, excludeSelf, maxParent, minLength) {
    if (!node){
        return node;
    }
    if (excludeSelf) {
        excludeSelf = node;
    }
    if (typeof(minLength) !== 'number') {
        minLength = 1;
    }
    if (!(maxParent instanceof nsIDOMNode)) {
        maxParent = node.ownerDocument.documentElement;
    }
    while (node) {
        if (node !== excludeSelf) {
            if (node.nodeType === TEXT_NODE) {
                if (node.nodeValue.trim().length >= minLength) {
                    return node;
                }
            }
            else {
                if (elementIsStatic(node)) {
                    //only expand visible elements (same behaviour as nsIFind)
                    if (node.lastChild) {
                        let subSearch = lastTextNode(node.lastChild, false, node, minLength);
                        if (subSearch){
                            return subSearch;
                        }
                    }
                }
            }
        }
        while (!node.previousSibling && (node.parentNode !== null) && (node.parentNode !== maxParent)) {
            node = node.parentNode;
        }
        node = node.previousSibling;
    }
    return node;
}
exports.lastTextNode = lastTextNode;


/**
 * Generates a unique XPath expression for a given node.
 * Example: "/body[1]/div[2]/p[5]/text()[2]".
 * With ID root: "//div[@id='uniqueid']/text()[1]"
 *
 * @param {nsIDOMnode} node
 * @param {boolean} allowIdRoot  Begin path at nearest parent node with unique "id" attribute.
 * @returns {string}
 */
function nodeXPath(node, allowIdRoot) {
    var doc = node.ownerDocument;
    var top = doc.documentElement;
    var path = [];

    while (node !== top) {
        let siblings = node.parentNode.childNodes;
        let peerIdx = 0;

        for (let i = 0; i < siblings.length; i++) {
            if (siblings[i].nodeName === node.nodeName) {
                peerIdx++;
            }
            if (siblings[i] === node) {
                break;
            }
        }

        if (allowIdRoot && node.id && node.id.length) {
            let candidates;
            try {
                //some sites specify invalid id attributes
                candidates = doc.querySelectorAll('#' + node.id).length;
            } catch (e) {
                candidates = 0;
            }
            if (candidates === 1) {
                path.push('/' + node.localName + '[@id=\'' + node.id +'\']');
                break;
            }
        }

        path.push(((node.nodeType === TEXT_NODE) ? 'text()' : node.localName) + '[' + peerIdx + ']');
        node = node.parentElement;
    }

    path.reverse();
    return '/' + path.join('/');
}
exports.nodeXPath = nodeXPath;

/**
 * Retrieves a single document node from a unique XPath expression.
 *
 * @param {string} path
 * @param {nsIDOMDocument|nsIDOMNode} context  The root element of the path.
 * @returns {nsIDOMNode|null}
 */
function nodeFromXPath(path, context) {
    var doc = (context instanceof nsIDOMDocument) ? context : context.ownerDocument;
    try {
        var result = doc.evaluate(path, context, null, Ci.nsIDOMXPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
        return result.iterateNext();
    }
    catch (e) {
        return null;
    }
}
exports.nodeFromXPath = nodeFromXPath;


function nodeParentBlock(node) {
    if (!(node instanceof nsIDOMNode)) {
        return null;
    }
    var window = node.ownerDocument.defaultView;
    while (node && !elementIsBlock(node)) {
        node = node.parentElement;
    }
    return node;
}

/**
 * Determines whether a dom element is displayed as a block.
 *
 * @param {nsIDOMElement} el
 * @returns {boolean}
 */
function elementIsBlock(el) {
    if (!(el instanceof nsIDOMElement)) {
        return false;
    }
    var display = el.ownerDocument.defaultView.getComputedStyle(el).display;
    return display && (display.substr(0,6) !== 'inline');
}

/**
 * Determines whether a dom element is part of regular text flow
 * and not invisible, explicitly positioned or floating.
 *
 * @param {nsIDOMElement} el
 * @returns {boolean}
 */
function elementIsStatic(el) {
    if (!(el instanceof nsIDOMElement)) {
        return false;
    }
    if (el.offsetParent === null) {
        //element is detatched from visible tree (e.g. display:none)
        return false;
    }
    var style = el.ownerDocument.defaultView.getComputedStyle(el);
    if ((style.position === 'fixed') || (style.position === 'absolute')) {
        return false;
    }
    if ((style.float === 'left') || (style.float === 'right')) {
        return false;
    }
    return true;
}