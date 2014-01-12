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

const { NS_COOPFOX, NODE_COOPFOX } = require('../coopfox');
const { NS_XEP0033, parseJid } = require('./session');
const NS_SYNC = NS_COOPFOX + '/sync';

const { Class } = require('sdk/core/heritage');
const { XMPPStrictThread } = require('./threads');

const { setTimeout, clearTimeout } = require('sdk/timers');

/**
 * A CoopFox-Specific thread, which emulates a persistent
 * multi-user chat using only peer to peer communication.
 *
 * Each thread keeps track of its participants and
 * multicasts all outgoing messages to them.
 *
 * When a new participant is added, the thread also
 * informs the other participants.
 *
 * Latecomers automatically synchronize their message
 * history with the other participants. When two clients
 * both have new messages the other one has not yet seen,
 * their messages histories are merged together.
 */
const XMPPMultiUserThread = Class({
    extends: XMPPStrictThread,
    className: 'XMPPMultiUserThread',

    _reset: function _reset() {
        if (this._participants) {
            for (let jid in this._participants) {
                this._onParticipantObsolete(jid);
            }
        }
        this._syncPullAbort();
        this.initialSyncDone = false;
        this._participants = {};
        this.participantJoinOrder = [];
        this.threadTimeOffset = 0;
        XMPPStrictThread.prototype._reset.apply(this, arguments);
    },

    _initSubscriptions : function _initSubscriptions(options) {
        this.subscribeTo(this, 'rosterItemUpdate');
        this.subscribeTo(options.client, 'iq:get:' + NS_SYNC, this._onSyncPullRequest);
        this.subscribeTo(options.client, 'iq:set:' + NS_SYNC, this._onSyncPushRequest);
        this.subscribeTo(this, '_incomingMessage', this._onIncomingMessage);
        this.subscribeTo(this, 'historyRewritten');
    },

    _initParticipants: function _initParticipants(options) {
        if (options.participants) {
            for each (let participant in options.participants) {
                //this will try to probe such clients for data,
                //but not see them as participants until confirmed
                this._participants[participant] = 'inactive';
            }
        }
    },

    _onceXmppConnected: function _onceXmppConnected(options) {
        XMPPStrictThread.prototype._onceXmppConnected.apply(this, arguments);

        this.sendDirectedPresence(); //notify off-roster participants that we are back
        this.once('syncIdle', this._sendJoinMessage);
        this.syncPull(); //synchronize message history with online contacts
        if (this.isSyncIdle) {
            this.emit('beforeSyncIdle');
        }
        if (this.isSyncIdle) {
            this.emit('syncIdle');
        }
    },

    toString: function toString() {
        var participants = [];
        for (let jid in this._participants) {
            participants.push(this.roster[jid] ? this.roster[jid].name : jid);
        }
        if (!participants.length) {
            participants.push('no participants');
        }
        return 'CoopFox Conversation (' + participants.join(', ') + ')';
    },

    /**
     * Override so that only other CoopFox clients are valid.
     *
     * @param {string} jid
     * @returns {bool}
     */
    contactAvailable: function contactAvailable(jid) {
        return this.getCoopFoxFullJid(jid) !== null;
    },

    /**
     * Returns the full JID for the CoopFox client of a contact.
     *
     * @param {string} jid
     * @returns {string|null}
     */
    getCoopFoxFullJid: function getCoopFoxFullJid(jid) {
        var contact = this.client.getContact(jid, true);
        if (!contact || !contact.presence || contact.isSelf) {
            return null;
        }
        for each (let presence in contact.presence) {
            //TODO: this should be based on the NS_COOPFOX protocol feature, not the node name
            if ((presence.type !== 'unavailable') && (presence.$resource) && (presence.c.node === NODE_COOPFOX)) {
                return contact.jid.bare + '/' + presence.$resource;
            }
        }
        return null;
    },

    /**
     * @param {string} jid  A bare JID.
     * @returns {string} A status constant.
     */
    getParticipantStatus: function getParticipantStatus(jid) {
        if (this._participants[jid]) {
            return this._participants[jid];
        }
        if (this.roster[jid] && this.roster[jid].subscription) {
            if (this.contactAvailable(jid)) {
                return 'online';
            }
            return 'offline';
        }
        if (jid === this.rosterSelf.jid.bare) {
            return 'self';
        }
        return 'unknown';
    },

    /**
     * @param {string} jid
     * @param {string} status
     * @returns {boolean}  Whether there has been a successful status change.
     */
    _setParticipantStatus: function _setParticipantStatus(jid, status) {
        if (!jid || (typeof(status) !== 'string') || !status.length) {
            throw new TypeError('Invalid participant status change: ' + jid + ' (' + status + ')');
        }
        var old = this.getParticipantStatus(jid);
        if (old === 'self') {
            return false;
        }
        var rawOld = this._participants[jid] || '';
        if (rawOld === status) {
            return false;
        }
        this._participants[jid] = status;
        console.info('Participant ' + jid + ' status changed: ' + old + ' > ' + status);
        if (!rawOld) {
            this.ensureContact(jid);
            this.emit('participantAdded', jid, true);
        }
        this.emit('participantStatus', status, old);
        if (status === 'active') {
            this.emit('rosterItemUpdate', this.roster[jid], 'participantActive');
        }
        else if (old === 'active') {
            this.emit('rosterItemUpdate', this.roster[jid], 'participantInactive');
        }
        if (status === 'rejected') {
            this.emit('rosterItemUpdate', this.roster[jid], 'participantRejected');
        }
        return true;
    },

    /**
     * Returns current participants as an array of JIDs.
     *
     * @param {boolean} includeInactive   Includes participants who are not online or have left.
     * @returns {string[]}
     */
    getParticipants: function getParticipants(includeInactive) {
        var result = [];
        for (let jid in this._participants) {
            let status = this._participants[jid];
            if (includeInactive || (status === 'active') || (status === 'added')) {
                result.push(jid);
            }
        }
        return result;
    },

    get hasParticipants() {
        return Object.keys(this._participants).length > 0;
    },

    /**
     * Adds a new participant to the thread and broadcasts
     * this information to all other participants.
     *
     * @param {string} jid  A bare JID.
     * @throws {Error} If the participant is not on the roster or not online.
     */
    addParticipant: function addParticipant(jid) {
        var status = this.getParticipantStatus(jid);

        switch (status) {
            case 'inactive':
                if (this.contactAvailable(jid)) {
                    break; //re-adding someone who is online but has left should be allowed
                }
            //nobreak
            case 'offline':
                console.error('Unable to add offline contact as participant:' + jid);
                return;
            case 'unknown':
                console.error('Unable to add unknown contact as participant:' + jid);
                return;
            case 'online':
            case 'rejected':
                break; //the usual cases
            default:
                console.error('addParticipant() called for contact of status ' + status);
                return;
        }

        console.info('Participant ' + jid + ' added to thread ' + this.id + '.');
        this._setParticipantStatus(jid, 'added'); //special temporary status which qualifies as recipient

        var message = {
            coopfox: {
                participant: {
                    jid: jid,
                    action: 'join',
                    thread: {
                        $text: this.id,
                        participants: this.getParticipants(true).length - 1 //not counting self and contact
                    }
                }
            }
        };

        if (status === 'inactive') {
            //send directed rejoin request
            message.to = this.getCoopFoxFullJid(jid);
            message.type = 'headline';
            message.$noEcho = true;
        }

        this.sendMessage(message);
    },

    _sendJoinMessage: function _sendJoinMessage() {
        console.log('Sending join message...');
        var jid = this.rosterSelf.jid.bare;
        if (this.participantJoinOrder.indexOf(jid) !== -1) { return; }

        var hadMessages = this.hasMessages;
        this.sendMessage({
            coopfox: {
                participant: {
                    jid: jid,
                    action: 'join',
                    thread: {
                        $text: this.id,
                        creator: hadMessages ? 'false' : 'true'
                    }
                }
            }
        });
        this.hasMessages = hadMessages; //don't count the initial join message
    },

    _onRosterItemUpdate: function _onRosterItemUpdate(item) {
        var jid = item.jid.bare;
        var status = this.getParticipantStatus(jid);
        var rawStatus = this._participants[jid] || null;
        var available = this.contactAvailable(jid);

        if (status === 'active') {
            if (!available) {
                this._onParticipantObsolete(jid);
            }
        }
        else {
            if (available) {
                if (!item.subscription) {
                    //respond to directed presence with own presence
                    //endless loop protection by timeout
                    this.sendDirectedPresence(jid);
                }
                if ((status === 'inactive') || (status === 'offline') || (status === 'contacted')) {
                    //'offline' can only happen for an online contact if _onParticipantDiscovered had been called
                    this._onParticipantDiscovered(jid);
                }
            }
        }
    },

    /**
     * Temporarily reveals own presence to off-roster contacts.
     *
     * @param {string} jid   Defaults to all unknown contacts.
     */
    sendDirectedPresence: function sendDirectedPresence(jid) {
        if (!jid) {
            for (jid in this._participants) {
                let contact = this.client.roster[jid];
                if (!contact || (!contact.subscription && contact.presence.$primary.type === 'unavailable')) {
                    this.sendDirectedPresence(jid);
                }
            }
            return;
        }

        if (!this._directedPresenceSent) {
            this._directedPresenceSent = {};
        }
        if (Date.now() - (this._directedPresenceSent[jid] || 0) < 5000) {
            //prevent endless loop (@see _onRosterItemUpdate())
            return;
        }
        this._directedPresenceSent[jid] = Date.now();

        console.log('Sending directed presence to ' + jid);
        this.sendPresence({
            to: jid,
            //XEP-0276 (experimental)
            decloak: {
                xmlns: 'urn:xmpp:decloak:0',
                reason: 'text'
            }
        });
    },

    /**
     * Adapts the internal thread time offset using a received reference timestamp.
     * All clients will always correct their time forwards (but never backwards),
     * so that in the negotiated thread time, all messages are sent in the past.
     *
     * @param {number} timestamp
     * @returns {number} Number of milliseconds the internal timer was corrected.
     */
    _syncThreadTime: function _syncThreadTime(timestamp) {
        var now = this.getThreadTime();
        var diff = timestamp - now;
        if (diff > 0) {
            diff += 50; //add a little extra margin to avoid multiple small corrections
            this.threadTimeOffset += diff;
            console.warn('Correcting for time deviation between clients: ' + (diff / 1000).toFixed(2) + ' sec');

            this._timeCorrectMessages(this.messages, diff);

            this.emit('threadTimeCorrected', diff, this.getThreadTime());
            return diff;
        }
        return 0;
    },

    _timeCorrectMessages: function _timeCorrectMessages(messages, diff) {
        if (!diff) { return; }
        for each (let message in messages) {
            message.coopfox.timestamp += diff;
            message.$timestamp += diff;
            XMPPStrictThread.prototype._setMessageTimestamp.call(this, message);
        }
    },

    /**
     * Returns the corrected current time, negociated between the participants.
     * @returns {number}
     */
    getThreadTime: function getThreadTime() {
        return Date.now() + this.threadTimeOffset;
    },

    /**
     * Wrapper for XMPPClient.sendMessage(), adding
     * thread and multicast details to each message.
     *
     * @param {object} message
     */
    sendMessage: function sendMessage(message) {
        //explicit destination bypasses multicast
        if (!message.to) {
            message.to = this.client.rosterSelf.jid.hostname;

            if (!message.addresses) {
                message.addresses = {
                    xmlns: NS_XEP0033,
                    address: []
                };
                for each (let jid in this.getParticipants()) {
                    message.addresses.address.push({
                        type: 'to',
                        jid: this.getCoopFoxFullJid(jid)
                        //TODO: should multiple parallel CoopFox resources be allowed?
                        //Would also require to know and include other own instances.
                    });
                }
                if (!message.addresses.address.length) {
                    delete message.addresses.address;
                }
            }
        }

        //always include coopfox element to signal that this is a coopfox thread
        if (!message.coopfox) {
            message.coopfox = {};
        }
        message.coopfox.xmlns = NS_COOPFOX;
        message.coopfox.timestamp = this.getThreadTime();

        XMPPStrictThread.prototype.sendMessage.apply(this, arguments);
    },

    _onIncomingMessage: function _onIncomingMessage(message) {
        if (!message && (message.coopfox.xmlns !== NS_COOPFOX).coopfox) {
            console.warn('Received message valid without "coopfox" element in multi-user thread.');
            message.coopfox = {};
        }

        //auto-discover new participants from senders and recipients
        this._onParticipantConfirmed(message.$from.bare);
        if (Array.isArray(message.$to)) {
            for each (let recipient in message.$to) {
                this._onParticipantDiscovered(recipient.bare);
            }
        } else if (message.$to.username) {
            this._onParticipantDiscovered(message.$to.bare);
        }

        //process add/leave participant messages
        if (message.coopfox.participant) {
            let participant = message.coopfox.participant;
            let jid = participant.jid || message.$from.bare;
            switch (participant.action) {
                case 'join':
                    if (message.type !== 'headline') {
                        if (this.participantJoinOrder.indexOf(jid) === -1) {
                            this.participantJoinOrder.push(jid);
                            this.emit('participantJoin', jid);
                        }
                    }
                    this._onParticipantDiscovered(jid);
                break;
                case 'reject':
                    this._setParticipantStatus(jid, 'rejected');
                    break;
                case 'leave':
                    this._onParticipantObsolete(jid);
            }
        }
    },

    /**
     * Use the less ambiguous send timestamp for message ordering.
     */
    _setMessageTimestamp: function _setMessageTimestamp(message) {
        switch (typeof(message.coopfox.timestamp)) {
            case 'string':
                message.coopfox.timestamp = parseInt(message.coopfox.timestamp);
                //nobreak;
            case 'number':
                let timestamp = message.coopfox.timestamp;
                this._syncThreadTime(timestamp);
                if (!message.delay) {
                    let now = this.getThreadTime();
                    let diff = now - timestamp;
                    if (diff > 1000) {
                        console.warn('Synchronous message time deviation: -' + (diff / 1000).toFixed(2) + ' sec');
                        //this can happen e.g. for the join message, before the partner is synced
                        //correct it to current time, will be downcorrected to the exact value during sync
                        timestamp = message.coopfox.timestamp = now;
                    }
                }
                message.$timestamp = timestamp;
                break;
            default:
                message.$timestamp = message.coopfox.timestamp = this.getThreadTime();
        }
        XMPPStrictThread.prototype._setMessageTimestamp.apply(this, arguments);
    },

    _onHistoryRewritten: function _onHistoryRewritten() {
        //refresh join order
        var joinOrder = [];
        for (let i = 0; i < this._history.length; i++) {
            let message = this._history[i].message;
            let participant = message.coopfox.participant;
            if (participant && (participant.action === 'join')) {
                let jid = participant.jid || message.$from.bare;
                if (joinOrder.indexOf(jid) === -1) {
                    joinOrder.push(jid);
                }
            }
        }
        var hasChange = false;
        for (let i = 0; i < joinOrder.length; i++) {
            if (joinOrder[i] !== this.participantJoinOrder[i]) {
                hasChange = true;
                break;
            }
        }
        if (hasChange) {
            this.participantJoinOrder = joinOrder;
            this.emit('participantJoinOrderChange', joinOrder);
        }
    },

    /**
     * This handler is called whenever a participant is observed passively.
     * (E.g. as a recipient or added by another contact.)
     *
     * It attempts to confirm activity of new participants,
     * by probing their status via a sync request.
     *
     * @param {string} jid  The bare JID of the contact.
     */
    _onParticipantDiscovered: function _onParticipantDiscovered(jid) {
        switch (this.getParticipantStatus(jid)) {
            case 'active':
            case 'self':
                break;
            case 'unknown':
                console.info('Unknown participant "' + jid + '" discovered in thread ' + this.id + '.');
                this.sendDirectedPresence(jid);
                this._setParticipantStatus(jid, 'contacted');
                //contact should respond with own directed presence
                //once we receive it, this method will be called again to iniate sync
                break;
            default:
                //make implicit state changes explicit (typically from unknown/online)
                this._setParticipantStatus(jid, this.getParticipantStatus(jid));
                if (this.contactAvailable(jid)) {
                    this.syncPull(jid);
                }
        }
    },

    /**
     * This handler is called whenever a participant is observed as active.
     * (E.g. as a sender or by responding to a sync request for this thread.)
     *
     * It checks whether the contact is already known and adds new contacts
     * to the session. Participants outside of the roster automatically
     * receive a directed presence stanza.
     * @param {string} jid  The bare JID of the contactD of the contact.
     */
    _onParticipantConfirmed: function _onParticipantConfirmed(jid) {
        switch (this.getParticipantStatus(jid)) {
            case 'offline':
                //this can be the case when importing an old thread
                this._setParticipantStatus(jid, 'inactive');
            break;
            case 'inactive':
                //this is the case for someone who left and decided to rejoin
            case 'added':
            case 'contacted':
                //do not add unknown contacts which have not yet sent directed presence
                //do not add offline contacts during message importing
                if (this.contactAvailable(jid)) {
                    console.info('Known participant "' + jid + '" discovered in thread ' + this.id + '.');
                    this._setParticipantStatus(jid, 'active');
                    this.syncPull(jid);
                }
            break;
            case 'online':
                //this is the case for the sender, when the recipient has just been added
                console.info('Roster contact "' + jid + '" discovered in thread ' + this.id + '.');
                this._setParticipantStatus(jid, 'active');
                this.syncPull(jid);
            break;
            case 'unknown':
                this._onParticipantDiscovered(jid);
            break;
        }
    },

    /**
     * This handler is called whenever a participant has either explicitly left or gone offline.
     * @param {string} jid  The bare JID of the contact.
     */
    _onParticipantObsolete: function _onParticipantObsolete(jid) {
        var status = this.getParticipantStatus(jid);
        if ((status !== 'inactive') && (status !== 'rejected')) {
            console.info('Participant ' + jid + ' now inactive in thread ' + this.id + '.');
            this._setParticipantStatus(jid, 'inactive');
        }
    },


    /**
     * Initiates a sync pull request to another participant.
     * Attempting to receive all messages we do not already have.
     *
     * The request will be processed asynchronously in the background.
     * Concurrent requests are queued and processed in sequence.
     *
     * @param {string} jid  Sync target (optional, defaults to all).
     */
    syncPull: function syncPull(jid) {
        this.initialSyncDone = true;
        if (!jid) {
            for each (jid in this.getParticipants()) {
                this.syncPull(jid);
            }
            return;
        }
        var fullJid = this.getCoopFoxFullJid(jid);
        if (!fullJid) {
            console.warn('Sync pull triggered for unavailable contact: ' + jid);
            return;
        }
        if (this._syncQueue.indexOf(fullJid) === -1) {
            console.info('Queuing sync pull from ' + fullJid + ' (' + this._syncQueue.length + ')');
            this._syncQueue.push(fullJid);
        }
        if (!this._syncPullInProgress) {
            if (this._syncTimeout) {
                clearTimeout(this._syncTimeout);
            }
            this._syncTimeout = setTimeout(this._runSyncPull);
        }
    },

    get isSyncIdle() {
        return this.initialSyncDone && !this._syncQueue.length && !this._syncPullInProgress;
    },

    /**
     * Disables the execution of syncPull() until _enableSyncPull() is called.
     * Postponing sync is advised during mass-import of messages.
     */
    _disableSyncPull: function _disableSync() {
        if (this._syncPullDisabled > 0) {
            this._syncPullDisabled++;
        } else {
            this._syncPullDisabled = 1;
        }
        console.info('Sync pull disabled for ' + this);
    },

    /**
     * Re-enables and, if necessary, executes sync*();
     */
    _enableSyncPull: function _enableSyncPull() {
        this._syncPullDisabled -= 1;
        if (this._syncPullDisabled <= 0) {
            delete this._syncPullDisabled;
            setTimeout(this._runSyncPull);
        }
        console.info('Sync pull re-enabled for ' + this);
    },

    _runSyncPull: function _runSyncPull() {
        if (this._syncPullInProgress || this._syncPullDisabled) { return; }
        if (this._syncTimeout) {
            clearTimeout(this._syncTimeout);
            delete this._syncTimeout;
        }

        var jid = this._syncQueue.shift();
        if (!jid) {
            this._syncTimeout = setTimeout(this.syncPull, 60000); //enter low frequency refresh cycle
            this.emit('beforeSyncIdle');
            if (this.isSyncIdle) {
                this.emit('syncIdle');
            }
            return;
        }

        this._syncPullInProgress = jid;
        this._syncTimeout = setTimeout(this._syncPullEnd, 10000); //abort in 10 seconds if process gets stuck

        console.info('Sending FF sync pull request to ' + jid);
        this.sendIq({
            to: jid,
            type: 'get',
            query : {
                xmlns: NS_SYNC,
                thread: this.id,
                mode: 'fast-forward',
                version: {
                    $text: this.latestVersion
                },
                timestamp: this.getThreadTime()
            },
            onSuccess: this._onSyncPullResponse,
            onError: this._onSyncPullError
        });

        setTimeout(this._runSyncPull);
    },

    _onSyncPullRequest: function _onSyncPullRequest(request) {
        var query = request.query;
        if (query.thread !== this.id) { return; }
        var jid = parseJid(request.from).bare;

        this._syncThreadTime(query.timestamp);
        this._onParticipantConfirmed(jid);

        var response = {
            thread: query.thread,
            mode: query.mode,
            version: {
                $text: this.latestVersion
            },
            timestamp: this.getThreadTime()
        };
        switch (query.mode) {
            case 'fast-forward':
                if (typeof(this._versions[query.version.$text]) !== 'undefined') {
                    //we know the requested version and potentially have newer content
                    let diff = this.getMessages(query.version.$text);
                    if (diff.length) {
                        response.diff = { message: diff };
                    }
                    console.info('FF sync pull request by ' + request.from + '. Sending diff (' + diff.length + ').');
                } else {
                    //we have an earlier version or a merged thread (either way, there is nothing we can send)
                    //the symmetric request (from this client to the contact) will retrieve newer messages from there
                    console.info('FF sync pull request by ' + request.from + ' unsuccessful. Nothing to send.');
                }
                break;
            case 'complete':
                let history = this.getMessages();
                console.info('Complete sync pull request by ' + request.from + '. Sending history (' + history.length + ').');
                response.diff = { message: history };
                break;
        }
        this.sendIqResponse(request, { query: response });
    },

    _onSyncPullResponse: function _onSyncPullResponse(response) {
        if (!this._syncPullInProgress) { return; } //e.g. incoming stanza callback after destroy()
        var query = response.query;
        var jid = parseJid(response.from).bare;

        this._syncThreadTime(query.timestamp);
        this._onParticipantConfirmed(jid);

        switch (query.mode) {
            case 'fast-forward':
                if (typeof(this._versions[query.version.$text]) !== 'undefined') {
                    //we have at least the latest version the contact has
                    //the symmetric request (from the contact to this client) will request any new messages from us
                    console.info(
                        'FF sync pull from '+ response.from + ' complete. ' +
                            'Local version is up to date [' + this.latestVersion + '].'
                    );
                    this._syncPullEnd();
                }
                else {
                    if (query.diff && query.diff.message) {
                        let diff = Array.isArray(query.diff.message) ? query.diff.message : [query.diff.message];
                        console.info(
                            'FF sync pull from ' + response.from + ' complete. ' +
                            'Diff received (' + diff.length + ').'
                        );
                        this._importMessages(diff);

                        if (typeof(this._versions[query.version.$text]) !== 'undefined') {
                            console.info(
                                'FF diff import success. ' +
                                'Local version is now up to date [' + this.latestVersion + '].'
                            );
                        } else {
                            console.error('FF diff import did not result in up to date version.');
                        }
                        this._syncPullEnd();
                    }
                    else {
                        //the contact doesn't know our version and we don't know the remote version
                        console.info('FF sync pull failed: no version match. Requesting complete history...');
                        this.sendIq({
                            to: response.from,
                            type: 'get',
                            query : {
                                xmlns: NS_SYNC,
                                thread: this.id,
                                mode: 'complete',
                                timestamp: this.getThreadTime()
                            },
                            onSuccess: this._onSyncPullResponse,
                            onError: this._syncPullEnd
                        });
                    }
                }
                break;
            case 'complete':
                if (query.diff && query.diff.message) {
                    let diff = Array.isArray(query.diff.message) ? query.diff.message : [query.diff.message];
                    console.info(
                        'Complete sync pull from ' + response.from + ' complete. ' +
                        'History received (' + diff.length + ').'
                    );
                    this._importMessages(diff);

                    if (typeof(this._versions[query.version.$text]) !== 'undefined') {
                        console.info('Complete import success. Local version is now up to date.');
                    } else {
                        console.error('Complete import did not result in up to date version.');
                        this.syncPull(jid); //risky, but should never cause an endless loop
                    }
                    this._syncPullEnd();
                }
                break;
        }
    },

    _onSyncPullError: function _onSyncPullError(error, request) {
        if (!this._syncPullInProgress) { return; } //e.g. incoming stanza callback after destroy()
        var jid = parseJid(request.to).bare;
        var text = (error.text && error.text.$text) ? error.text.$text : error.type;
        console.warn('Sync pull request to ' + request.to + ' failed: ' + text);
        this._onParticipantObsolete(jid);
        this._syncPullEnd();
    },

    _syncPullEnd: function _syncPullEnd() {
        delete this._syncPullInProgress;
        if (this._syncTimeout) {
            clearTimeout(this._syncTimeout);
        }
        this._syncTimeout = setTimeout(this._runSyncPull);
    },

    _syncPullAbort: function _syncPullAbort() {
        delete this._syncPullInProgress;
        if (this._syncTimeout) {
            console.info('Sync pulls aborted.');
            clearTimeout(this._syncTimeout);
            delete this._syncTimeout;
        }
        this._syncQueue = [];
    },

    /**
     * Sends a sync push request to another participant.
     *
     * This will trigger an immediate reverse pull request in the other
     * client, if it doesn't recognize the version code we are sending.
     *
     * @param {string}  jid   Sync target (optional, defaults to all active).
     * @param {Array|boolean} messages  Messages to push (or true for current history),
     *                                  ommit to send reverse pull request (tell target to pull).
     */
    syncPush: function syncPush(jid, messages) {
        if (!jid) {
            for each (jid in this.getParticipants()) {
                this.syncPush(jid, messages);
            }
            return;
        }
        var fullJid = this.getCoopFoxFullJid(jid);
        if (!fullJid) {
            console.warn('Sync push triggered for unavailable contact: ' + jid);
            return;
        }
        console.info('Sending FF sync push request to ' + fullJid);
        var request = {
            to: fullJid,
            type: 'set',
            query : {
                xmlns: NS_SYNC,
                thread: this.id,
                timestamp: this.getThreadTime()
            },
            onSuccess: this._onSyncPushResponse
        };
        if (messages === true) {
            messages = this.getMessages();
        }
        if (Array.isArray(messages)) {
            if (!messages.length){ return; }
            request.query.diff = { message: messages };
        } else {
            request.query.mode = 'fast-forward';
            request.query.version = { $text: this.latestVersion };
        }
        this.sendIq(request);
    },

    _onSyncPushRequest: function _onSyncPushRequest(request) {
        var query = request.query;
        if (query.thread !== this.id) { return; }

        var jid = parseJid(request.from).bare;
        this._syncThreadTime(query.timestamp);
        this._onParticipantConfirmed(jid);

        if (query.diff) {
            let diff = Array.isArray(query.diff.message) ? query.diff.message : [query.diff.message];
            console.info('Sync push from from ' + request.from + ' (' + diff.length + ').');
            this._importMessages(diff);
        }

        switch (query.mode) {
            case 'fast-forward':
                if (typeof(this._versions[query.version.$text]) !== 'undefined') {
                    console.info('Reverse FF sync pull from ' + request.from + ' indicated no new content.');
                } else {
                    console.info('Reverse FF sync pull from ' + request.from + ' indicated new content. Queuing pull.');
                    this.syncPull(jid);
                }
                break;
        }

        var response = {
            thread: query.thread,
            mode: query.mode,
            version: {
                $text: this.latestVersion
            },
            timestamp: this.getThreadTime()
        };
        this.sendIqResponse(request, { query: response });
    },

    _onSyncPushResponse: function _onSyncPushResponse(response) {
        var query = response.query;
        var jid = parseJid(response.from).bare;
        this._syncThreadTime(query.timestamp);
        this._onParticipantConfirmed(jid);

        switch (query.mode) {
            case 'fast-forward': break;
            default:
                if (typeof(this._versions[query.version.$text]) === 'undefined') {
                    console.error('Remote import by '+ response.from + ' did not result in up to date version.');
                    this.syncPush(jid); //trigger another reverse pull request
                }
            break;
        }
    },

    _importMessages: function importMessages(messages, replace, quiet) {
        this._disableSyncPull();
        try {
            XMPPStrictThread.prototype.importMessages.apply(this, arguments);
        }
        catch(e) {
            console.exception(e);
        }
        finally {
            this._enableSyncPull();
        }
    },

    /**
     * Synced import, which pushes messages to all other participants first.
     * Also supports the new argument "timeDiff", which shifts messages in time before import.
     */
    importMessages: function importMessages(messages, replace, quiet, timeDiff) {
        this._timeCorrectMessages(messages, timeDiff);
        if (this.hasParticipants) {
            if (replace || quiet) {
                throw new Error('Invalid arguments for synchronized message import.');
            }
            this.syncPush(null, messages);
        }
        this._importMessages(messages, replace, quiet);
    },

    _synchronizedDestroy: function _synchronizedDestroy(reason) {
        this._syncPullAbort();
        this._disableSyncPull();
        if (reason !== 'reload') {
            if (!reason) {
                reason = 'leave';
            }
            try {
                console.info('Sending ' + reason + ' message for thread: ' + this.id);
                if (this.client.isConnected()) {
                    let message = {
                        coopfox: {
                            participant: {
                                action: reason,
                                jid: this.client.rosterSelf.jid.bare
                            }
                        }
                    };
                    if (reason === 'leave') {
                        message.type = 'headline';
                        message.$noEcho = true;
                    }
                    this.sendMessage(message);
                }
            }
            catch (e) {
                console.warn('Unable to send leave message [' + e.message + '].');
            }
        }
        XMPPStrictThread.prototype.destroy.call(this);
    },

    destroy: function destroy(reason) {
        if (this.isSyncIdle) {
            this._synchronizedDestroy(reason);
        } else {
            //wait until we are in sync to notify everyone of our departure
            this.subscribeTo(this, 'syncIdle', this._synchronizedDestroy.bind(this, reason), true);
        }
    }

});
exports.XMPPMultiUserThread = XMPPMultiUserThread;