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

const sysEvents = require('sdk/system/events');
const unloader = require('sdk/system/unload');
const baseUrl = require('sdk/self').data.url('modules/highlights/');

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { SelectionListener } = require('./listener');
const { DomHighlighter } = require('./highlighter');

const { cleanUrl } = require('../../utils/urls');
const { softAlert } = require('../../utils/dhtml');
const { confirmEx } = require('../../browser/dialogs');

const Highlights = Class({
    extends: EventHub,
    className: 'Highlights',

    /**
     * @param {CoopFox} coopfox
     */
    initialize: function initialize(coopfox) {
        this.coopfox = coopfox;
        this.xmpp = coopfox.xmpp;
        this.transients = {};

        coopfox.sidebar.panel.addScript(baseUrl + 'panel.js');
        coopfox.sidebar.panel.addStyle(baseUrl + 'panel.css');

        EventHub.prototype.initialize.apply(this, arguments);

        this.subscribeTo(coopfox, 'componentsReady');
        this.subscribeTo(coopfox, 'destroy');
        console.info('Highlights module activated.');
    },

    _onceComponentsReady: function _onceComponentsReady() {

        this.listener = new SelectionListener({
            tabs : this.coopfox.browser,
            onSelection: this,
            onTransientSelection: this
        });
        this.highlights = new DomHighlighter({
            tabs : this.coopfox.browser,
            onClick: this,
            onDblClick: this,
            onCloseClick : this,
            onRestoreError : this
        });

        this.subscribeTo(this.xmpp, 'incomingMessage');
        this.subscribeTo(this.xmpp, 'rosterItemUpdate');
    },

    _onceDestroy: function _onceDestroy() {
        this.destroy();
        this.coopfox = null;
        this.xmpp = null;
        if (this.listener) {
            this.listener.destroy();
            this.listener = null;
        }
        if (this.highlights) {
            this.highlights.destroy();
            this.highlights = null;
        }
    },

    /////////////////////////////////////////////////////////////////

    /**
     * Process an incoming XMPP message stanza (chat, annotation, ...).
     *
     * @param {object} message  A stanza object as delivered by XMPPClient.
     */
    _onIncomingMessage: function _onIncomingMessage(message) {
        this._processAnnotations(message);
        this._processDeletion(message);
        if (message.$isEcho) { return; }
        if (!message.coopfox) { return; }

        if (message.coopfox.ready) {
            console.log('Received ready from: ' + message.$from.full);
            this._publishTransientHighlights(message.$from.full);
        }

        var hl = message.coopfox.highlight;
        if (!hl) { return; }
        var contact = this.xmpp.getContact(message.$from);
        let jid = contact.jid.bare;

        if (message.type === 'headline') {
            hl.$transient = true;
            if (hl.type !== 'error') {
                this._removeTransient(jid);
            }
            if (hl.text) {
                hl.type = 'insert';
                this.transients[jid] = hl;
            }
        }

        try {
            switch (hl.type) {
                case 'insert':
                    try {
                        hl.$color = this._getColors(contact).background;
                        this.highlights.insert(hl);
                    } catch(e) {
                        this._onRestoreError(e, hl);
                    }
                break;
                case 'error':
                    if (this.highlights.has(hl.id)) {
                        if (!contact.isSelf && (message.$timestamp > (this.xmpp.getThreadTime() - 10000))) {
                            this._softAlert(hl.id, 'Failed for ' + contact.name + ': ' + hl.reason);
                        }
                        this.highlights.remove(hl.id);
                    }
                    else if (hl.$transient) {
                        this._softAlert(null, 'Failed for ' + contact.name + ': ' + hl.reason);
                    }
                break;
            }
        }
        catch (e) {
            console.exception(e);
        }
    },

    _getColors: function _getColors(contact) {
        let jid = contact.jid.bare;
        return this.coopfox.getParticipantColors ?
            this.coopfox.getParticipantColors(jid) :
            { foreground: '#000', background: '#aaa' };
    },

    _processDeletion: function _processDeletion(message) {
        if (!message.coopfox || !message.coopfox.chat) { return; }
        try {
            var contact = this.xmpp.getContact(message.$from);
            var id = message.coopfox.chat.id;
            switch (message.coopfox.chat.action) {
                case 'delete':
                    if (this.highlights.has(id)) {
                        if (!contact.isSelf && (message.$timestamp > (this.xmpp.getThreadTime() - 10000))) {
                            this._softAlert(id, 'Removed by ' + contact.name);
                        }
                        this.highlights.remove(id);
                    }
                    break;
                case 'undelete':
                    let undelete = this.xmpp.messages[id];
                    if (undelete) {
                        this._onIncomingMessage(undelete);
                    }
                    break;
            }
        }
        catch (e) {
            console.exception(e);
        }
    },

    _processAnnotations: function _processAnnotations(message) {
        try {
            if (message.coopfox.chat) {
                let origMessage = this.xmpp.messages[message.coopfox.chat.id];
                if (origMessage) {
                    let parent = this.xmpp.messages[origMessage.thread.$text];
                    if (parent) {
                        let hl =  parent.coopfox.highlight;
                        if (hl) {
                            let action = message.coopfox.chat.action;
                            if (action === 'delete') {
                                this.highlights.removeAnnotation(hl.id, origMessage.id);
                            }
                            else if (action === 'undelete') {
                                this._processAnnotations(origMessage);
                            }
                        }
                    }
                }
            }
            else {
                if (!message.body || !message.body.$text) { return; }
                let id = message.thread.$text;
                if (id === this.xmpp.id) { return; }

                let contact = this.xmpp.getContact(message.$from);
                let colors = this._getColors(contact);
                this.highlights.addAnnotation(id, message.id, message.body.$text, contact.name, colors.foreground);
            }
        }
        catch (e) {
            console.exception(e);
        }
    },

    _removeTransient: function _removeTransient(jid) {
        if (this.transients[jid]) {
            this.highlights.remove(this.transients[jid].id);
            delete this.transients[jid];
        }
    },

    _onRosterItemUpdate: function _onRosterItemUpdate(contact, reason) {
        switch (reason) {
            case 'participantInactive':
                this._removeTransient(contact.jid.bare);
            break;
        }
    },

    /**
     * Creates a new text highlight annotation in own client
     * and communicates it to all parcitipating remote contacts.
     *
     * @param {nsIDOMDocument} doc     The target document for the highlight.
     * @param {string[]} texts         The texts to highlight.
     * @param {nsIDOMRange[]} ranges   The ranges corresponding to texts.
     */
    _onSelection: function _onSelection(doc, texts, ranges) {
        var jid = this.xmpp.rosterSelf.jid.bare;
        var color = this.coopfox.getParticipantColors ? this.coopfox.getParticipantColors(jid).background : null;

        try {
            var hl = this.highlights.insert({
                type: 'insert',
                url: cleanUrl(doc.URL),
                text: texts,
                $color: color
            });
        }
        catch (e) {
            let rect = ranges[0].getBoundingClientRect();
            softAlert(doc, rect.left, rect.top, e.longDescription || 'Error: ' + e.message);
            return;
        }
        this._sendHighlight(hl);
    },

    _onTransientSelection: function _onTransientSelection(doc, texts) {
        var hl = { url : cleanUrl(doc.URL) };
        if (texts.length) {
            hl.text = texts;
        }
        this._sendHighlight(hl, true);
    },

    _onClick: function _onClick(highlight) {
        this.coopfox.emit('highlightClick', highlight);
        this.coopfox.emit('chatScrollTo', highlight.id);
    },

    _onDblClick: function _onDblClick(highlight) {
        this.coopfox.emit('highlightDblClick', highlight);
        this.coopfox.emit('chatReplyTo', highlight.id);
    },

    _onCloseClick: function _onCloseClick(highlight) {
        var message = {
            coopfox: {
                chat: {
                    action: 'delete',
                    id: highlight.id
                }
            }
        };
        this.xmpp.sendMessage(message);
    },

    /**
     * Triggered if a registered highlight cannot be restored in a new document.
     */
    _onRestoreError: function _onRestoreError(error, highlight) {
        //this.highlights.remove(highlight.id);
        if (highlight.$failed) { return; } //only send once
        highlight.$failed = true;
        var hl = {
            type : 'error',
            id : highlight.id,
            url : highlight.url,
            reason : error.message
        };
        this._sendHighlight(hl, highlight.$transient);
    },

    _sendHighlight: function _sendHighlight(hl, transient, to) {
        var message = { coopfox: { highlight: hl } };
        if (transient) {
            message.type = 'headline';
            message.$noEcho = true;
        } else {
            if (hl.type === 'insert') {
                let texts = [];
                for each (let text in hl.text) {
                    texts.push(text.$text);
                }
                message.body = {
                    $text: '"' + texts.join('... ') + '" ' + hl.url
                };

                var panel = this.coopfox.sidebar.panelFrame.contentDocument;
                var replyInput = panel.querySelector('#chat-tab .chat-history .chat-input');
                if (replyInput) {
                    let choice = confirmEx(
                        'Direct-Quote Comment',
                        'You have opened a comment box in the CoopChat.',
                        'Direct-Quote in Comment',
                        'Direct-Quote in New Message'
                    );
                    if (choice === 0) {
                        message.thread = { $text: replyInput.parentElement.id };
                    }
                    let cancel = replyInput.querySelector('.chat-input-cancel');
                    if (cancel) {
                        cancel.click();
                    }
                }
            }
        }
        if (to) {
            message.to = to;
        }
        if (hl.type === 'insert') {
            message.id = hl.id;
        }
        this.xmpp.sendMessage(message);
    },

    _publishTransientHighlights: function _publishTransientHighlights(to) {
        for each (let doc in this.coopfox.browser.getAllDocs()) {
            let { texts } = this.listener.getSelection(doc);
            if (texts.length) {
                let hl = {
                    url : cleanUrl(doc.URL),
                    text: texts
                };
                this._sendHighlight(hl, true, to);
            }
        }
    },

    _softAlert: function _softAlert(id, message) {
        let doc = this.coopfox.browser.activeDoc;
        if (doc) {
            let screenPos = (id && this.highlights.has(id)) ?
                this.highlights.getScreenOffset(id, doc) :
                this.listener.lastMousePos;
            if (screenPos) {
                softAlert(doc, screenPos.left, screenPos.top, message);
            }
        }
    }

});

function onCoopfoxInit(event) {
    Highlights(event.subject);
}

//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-init', onCoopfoxInit, true);
unloader.when(function() {
    sysEvents.off('coopfox-init', onCoopfoxInit);
});