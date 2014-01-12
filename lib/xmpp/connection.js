/**
 * This file is part of the Firefox extension "CoopFox", developed as part of my master's thesis
 * at the Cooperative Media Lab, University of Bamberg, Germany.
 * @copyright (c) 2014 Ralf Strobel
 *
 * Special thanks to Massimiliano Mirra, who wrote the original "xmpp4moz" extension for Firefox,
 * which served as an inspiration for parts of the code in this file.
 *
 * All content is no longer maintained and is made available purely for archival and educational purposes.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

'use strict';

const XMPP_XML_DEBUG = false;
const REPLY_TIMEOUT = 3000;

const { Cc, Ci, Cr } = require('chrome');
const { nsIDOMNode, nsIDOMElement } = Ci;
const { TEXT_NODE, ELEMENT_NODE, DOCUMENT_NODE, CDATA_SECTION_NODE, DOCUMENT_FRAGMENT_NODE } = nsIDOMNode;
const serializer = Cc['@mozilla.org/xmlextras/xmlserializer;1'].getService(Ci.nsIDOMSerializer);

const { Class } = require('sdk/core/heritage');
const { TCPConnection, SECURITY_SSL } = require('./tcp');

const TCP_DUMMY_REQUEST = {
    cancel: function cancel() {},
    isPending: function isPending() {},
    resume: function resume() {},
    suspend: function suspend() {},
    QueryInterface: function QueryInterface(iid) {
        if (!iid.equals(Ci.nsISupports) && !iid.equals(Ci.nsIRequest)) {
            throw Cr.NS_ERROR_NO_INTERFACE;
        }
        return this;
    }
};

/**
 * A TCP connection capable of reading and writing XMPP XML stanzas.
 * Stanzas are translated between XML on the stream side and native JS objects.
 *
 * as object strucutes, as well as writing out stanzas from such objects.
 */
const XMPPConnection = Class({
    extends: TCPConnection,
    className: 'XMPPConnection',

    /**
     * @param {object} options
     *  - {number} port : Defaults to 5233 for SSL, 5222 for normal connections.
     *  - {string} streamHostname : Name by which to address the host in the stream header (defaults to hostname).
     *
     *  - {function} onStreamStart(e, raw) : Called when a new <stream> root element has been opened.
     *  - {function} onStreamEnd()         : Called when the <stream> root element is terminated.
     *  - {function} onElement(e, raw)     : Called when a new child element of <stream> has been received.
     */
    initialize : function initialize(options) {
        if (!options.port) {
            if (options.security == SECURITY_SSL) {
                options.port = 5223;
            } else {
                options.port = 5222;
            }
        }

        this._streamHost = options.streamHostname || options.hostname;

        TCPConnection.prototype.initialize.apply(this, arguments);

        this.subscribeTo(this, 'connected', this._sendStreamHeader);
        this.subscribeTo(this, '_beforeDestroy', this._sendStreamFooter);
    },

    _initXMLParser : function _initXMLParser() {
        this._parser = Cc['@mozilla.org/saxparser/xmlreader;1'].createInstance(Ci.nsISAXXMLReader);
        this._inDoc = Cc['@mozilla.org/xml/xml-document;1'].createInstance(Ci.nsIDOMXMLDocument);
        this._outDoc = Cc['@mozilla.org/xml/xml-document;1'].createInstance(Ci.nsIDOMXMLDocument);
        this._inElement = null;

        //TODO: Use platform/xpcom instead
        this._parser.errorHandler = {
            connection : this,
            error: function error(locator, error) {
                console.warn(error);
            },
            fatalError: function fatalError(locator, error) {
                this.connection._socketClose();
                this.connection._setTcpState('error', error);
            },
            ignorableWarning: function ignorableWarning(locator, error) {
                console.info(error);
            },
            QueryInterface: function QueryInterface(iid) {
                if(!iid.equals(Ci.nsISupports) && !iid.equals(Ci.nsISAXErrorHandler)) {
                    throw Cr.NS_ERROR_NO_INTERFACE;
                }
                return this;
            }
        };

        this._parser.contentHandler = {
            startDocument: function startDocument() {},
            endDocument: function endDocument() {},
            startElement: this._inElementStart,
            endElement: this._inElementEnd,
            characters: this._inElementText,
            processingInstruction: function processingInstruction() {},
            ignorableWhitespace: function ignorableWhitespace() {},
            startPrefixMapping: function startPrefixMapping() {},
            endPrefixMapping: function endPrefixMapping() {},
            QueryInterface: function QueryInterface(iid) {
                if (!iid.equals(Ci.nsISupports) && !iid.equals(Ci.nsISAXContentHandler)) {
                    throw Cr.NS_ERROR_NO_INTERFACE;
                }
                return this;
            }
        };

        this._parser.parseAsync(null);
        this._parser.onStartRequest(TCP_DUMMY_REQUEST, null);
    },

    _inElementStart : function _inElementStart(uri, localName, qName, attr) {

        var element = null;
        if (uri == 'jabber:client') {
            element = this._inDoc.createElement(qName);
        } else {
            element = this._inDoc.createElementNS(uri, qName);
        }

        for (let i=0; i < attr.length; i++) {
            element.setAttributeNS(attr.getURI(i), attr.getQName(i), attr.getValue(i));
        }

        if (this._inElement) {
            this._inElement.appendChild(element);
            this._inElement = element;
        }
        else if ((localName == 'stream') && (uri == 'http://etherx.jabber.org/streams')) {
            if (XMPP_XML_DEBUG) {
                console.log('XMPP RECV: ' + asString(element));
            }
            this.emit('streamStart', domToJson(element), element);
        }
        else {
            this._inElement = element;
        }
    },

    _inElementText : function _inElementCharacters(text) {
        if(this._inElement) {
            this._inElement.appendChild(this._inDoc.createTextNode(text));
        }
    },

    _inElementEnd :  function _inElementEnd(uri, localName, qName) {

        if ((localName == 'stream') && (uri == 'http://etherx.jabber.org/streams')) {
            if (XMPP_XML_DEBUG) {
                console.log('XMPP RECV: </' + qName + '>');
            }
            this.emit('streamEnd');
            return;
        }

        if (!this._inElement) { return; }

        if (this._inElement.parentNode) {
            this._inElement = this._inElement.parentNode;
            return; //only return complete stream-level elements
        }

        this._inElement.normalize(); //join adjacent text nodes etc...

        if (XMPP_XML_DEBUG) {
            console.log('XMPP RECV: ' + asString(this._inElement));
        }

        this.emit('element', domToJson(this._inElement), this._inElement);
        this._inElement = null;
    },

    _onDataAvailable : function _onDataAvailable(request, context, inputStream, offset, count) {
        //we do not pass the real TCP request,
        //because the XML structure can restart within the same connection
        this._parser.onDataAvailable(TCP_DUMMY_REQUEST, null, inputStream, offset, count);
    },

    _sendStreamHeader : function _sendStreamHeader() {
        this.writeString(
            '<?xml version="1.0"?>' +
            '<stream:stream xmlns="jabber:client" xmlns:stream="http://etherx.jabber.org/streams" version="1.0" ' +
                'to="' + this._streamHost + '"' +
            '>'
        );
        this.setReplyTimeout(REPLY_TIMEOUT);
    },

    _sendStreamFooter : function _sendStreamFooter() {
        if (this._tcpState == 'connected') {
            this.writeString('</stream:stream>');
        }
    },

    /**
     * Resets the input XML parser to expect the beginning of a new server <stream> element.
     * Sends a new client <stream> element to the server.
     */
    resetStream : function resetStream() {
        this._initXMLParser();
        this._sendStreamHeader();
    },

    /**
     * Sends an arbitrary string to the server.
     *
     * @param {string} str  The string to send.
     *
     * @throws {Error} If connection is not ready.
     * @throws {TypeError} If str is not a string.
     */
    writeString : function writeString(str) {
        if (XMPP_XML_DEBUG && str.length > 2) {
            console.log('XMPP SEND: ' + str);
        }
        this._writeString(str);
    },

    /**
     * Sends an xml element to the server.
     *
     * @see jsonToDom()
     * @param {string} name         Local name of the XML element.
     * @param {object} childNodes   Attributes and children of the element.
     *
     * @throws {Error} If connection is not ready.
     * @throws {TypeError}
     */
    writeElement : function writeElement(name, childNodes) {
        var element = jsonToDom(this._outDoc, name, childNodes);
        this.writeString(asString(element));
    }

});
exports.XMPPConnection = XMPPConnection;

/**
 * Tries to return a printable string for any entity.
 * DOM elements are serialized to XML, including children.
 *
 * @param {mixed} obj   Any entity to convert to a string.
 * @return {string}
 *
 * @throws {TypeError}  On unserializable entities (e.g. functions)
 */
function asString(obj) {
    switch (typeof(obj)) {
        case 'string' : return obj;
        case 'xml' : return obj.toXMLString();
        case 'object' :
            if (obj === null) {
                return 'NULL';
            }
            if(obj instanceof nsIDOMElement) {
                return serializer.serializeToString(obj).replace(/ xmlns=""/g, '');
            } else {
                return obj.toString();
            }
            break;
        case 'boolean' : return obj ? 'true' : 'false';
        case 'number' : return obj.toString;
        default :
            throw new TypeError('Unable to serialize entity to string.');
    }
}

/*
 * Recursively parses a DOM element (tree) into a JSON declaration.
 *
 * Each element attribute converts to a string attribute in the result.
 * Each child element converts to a named sub-object in the result.
 *
 * Elements containing text will have a string attribute "$text" in the result.
 * Elements containing CDATA will have a string attribute "$cdata" in the result.
 *
 * If an element explicitly declares that uses the the XHTML namespace, it will contain
 * its raw outer HTML code in an attribute "$html", in addition to the normal attributes.
 * The value of preserveOrder will default to true for such XHTML subtrees (see below).
 *
 * The argument 'preserveOrder' determines how child nodes of the same type are handled.
 * - false: Same elements are returned as an array, text nodes are concatenated. (default)
 * - true:  Same elements are returned as "XX", "XX#2", "XX#3" / "$text", "$text#2"...
 *
 * The second mode ensures that the original order of elements can be restored by jsonToDom,
 * if text nodes and different sub-elements occur intermixed, as typical for HTML markup.
 *
 * @param  {object} node  An instance of nsIDOMElement.
 * @param  {boolean} preserveOrder  See above.
 * @return {object} Constructed descriptor object.
 *
 * @throws {TypeError} If node is not a DOM element or contains invalid children.
 */
function domToJson(node, preserveOrder) {
    if (!(node instanceof nsIDOMElement)) {
        throw new TypeError('Object passed to domToJson() is not a DOM element.');
    }

    var result = {};

    for (let i = 0; i < node.attributes.length; i++) {
        result[node.attributes[i].name] = node.attributes[i].value;
    }
    if (node.namespaceURI) {
        result.xmlns = node.namespaceURI;
        if (node.namespaceURI === 'http://www.w3.org/1999/xhtml') {
            if (typeof(preserveOrder) === 'undefined') {
                preserveOrder = true;
            }
            result.$html = asString(node);
        }
    }

    function safeAddProperty(key, value, concat) {
        if (result[key]) {
            if (preserveOrder) {
                let i = 2;
                while (result[key + '#' + i]) {
                    i++;
                }
                result[key + '#' + i] = value;
            } else {
                if (concat) {
                    result[key] += value;
                } else {
                    if (!Array.isArray(result[key])) {
                        result[key] = [result[key]];
                    }
                    result[key].push(value);
                }
            }
        } else {
            result[key] = value;
        }
    }

    for (let child = node.firstChild; child instanceof nsIDOMNode; child = child.nextSibling) {
        switch (child.nodeType) {
            case TEXT_NODE:
                safeAddProperty('$text', child.nodeValue, true);
                break;
            case CDATA_SECTION_NODE:
                safeAddProperty('$cdata', child.nodeValue, true);
                break;
            case ELEMENT_NODE:
                safeAddProperty(child.nodeName, domToJson(child, preserveOrder));
                break;
            default :
                throw new TypeError('Unsupported subnode type for domToJson() in <' + node.nodeName + '>');
        }
    }

    return result;
}

/**
 * Recursively builds a DOM element (tree) from a JSON declaration.
 *
 * Each primitive attribute (string, number, boolean)
 * becomes an attribute (name="value") of the new element.
 *
 * A primitve attribute named "$text" becomes inner text.
 * A primitive attribute named "$cdata" becomes CDATA.
 *
 * Each object-type attribute becomes a new child element (<name>),
 * which can have attributes / children of its own, recursively.
 * The special attribute "xmlns" defines the namespace of an element.
 *
 * An attribute named "$node" must be an instance of nsIDOMNode
 * and is imported directly as is, including its children.
 *
 * An array of objects/texts creates multiple children of the same name.
 * Altenatively, children of the same name can also be declared using
 * the suffix "#*" (e.g. "item", "$text", "item#2", "$text#2" ...).
 *
 * Other attribute types (e.g. functions) are silently ignored,
 * as are all other attributes beginning with the "$" character.
 *
 * @param {object}  document The owner instance of nsIDOMDocument.
 * @param {string}  tagName Tag name of the new element to create.
 * @param {object}  childNodes Attributes and children of the element.
 *
 * @return {object} Constructed instance of nsIDOMElement.
 *
 * @throws {DOMException} If any attributes are of invalid types.
 */
function jsonToDom(document, tagName, childNodes) {
    if (typeof(childNodes) == 'undefined') {
        childNodes = {};
    }

    var node;
    if (childNodes.xmlns) {
        node = document.createElementNS(childNodes.xmlns, tagName);
    } else {
        node = document.createElement(tagName);
    }

    function handleProperty(key, value) {

        if (Array.isArray(value)) {
            for each (let item in value) {
                handleProperty(key, item);
            }
            return;
        }

        if (key.charAt(0) === '$') {
            if (key.substr(1,4) === 'text') {
                node.appendChild(document.createTextNode(value));
            }
            if (key.substr(1,5) === 'cdata') {
                node.appendChild(document.createCDATASection(value));
            }
            if (key.substr(1,4) === 'node') {
                node.appendChild(document.importNode(value, true));
            }
            return;
        }

        switch (typeof(value)) {
            case 'object' :
                node.appendChild(jsonToDom(document, key, value));
                break;
            case 'string' :
            case 'number'  :
            case 'boolean' :
                node.setAttribute(key, value);
                break;
            //no default, ignore other types
        }

    }

    for (let key in childNodes) {
        if (key == 'xmlns') {
            continue; //handled above
        }

        let value = childNodes[key];
        key = key.split('#', 1)[0]; //ignore number suffixes

        handleProperty(key, value);
    }

    return node;
}
