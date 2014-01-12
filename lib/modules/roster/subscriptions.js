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

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');
const { XMPPFailsafeClient } = require('../../xmpp/failsafe');

const dialogs = require('../../browser/dialogs');

/**
 * This module provides the basic chat tab in the panel.
 * It manages processing of outgoing messages and activity states.
 */
const SubscriptionManager = Class({
    extends: EventHub,
    className: 'SubscriptionManager',

    _initStates: function _initStates() {
        this._subscribedAcknowledged = new WeakMap();
        this._unsubscribedAcknowledged = new WeakMap();
    },

    set client(xmpp) {
        if (this.xmpp) {
            this.unsubscribeFrom(this.xmpp);
        }
        if (xmpp) {
            if (!(xmpp instanceof XMPPFailsafeClient)) {
                throw new TypeError('Invalid XMPP client for SubscriptionManager');
            }
            this.xmpp = xmpp;
            this.subscribeTo(xmpp, 'incomingSubscriptionPresence', this._onPresence);
        }
    },

    _destroyClientRef: function _destroyClientRef() {
        this.xmpp = null;
    },

    _onPresence: function _onPresence(presence) {
        var jid = presence.$from.bare;
        var item = this.xmpp.roster[jid] || null;
        switch (presence.type) {
            case 'subscribe' :

                if (item && item.subscription && (item.subscription !== 'none')) {
                    //we already know this contact or have requested a subscripiton
                    this.xmpp.sendPresence({ to: jid, type: 'subscribed' });
                    return;
                }

                var choice = dialogs.confirmEx(
                    'CoopFox: New Contact',
                    jid + ' wants to exchange contact information with you.',
                    'Accept',
                    'Decline'
                );
                if (choice === 0) {
                    //accept and send own subscription request
                    this.xmpp.sendPresence({ to: jid, type: 'subscribed' });
                    this.xmpp.sendPresence({ to: jid, type: 'subscribe' });
                } else {
                    this.xmpp.sendPresence({ to: jid, type: 'unsubscribed' });
                    this.cancel(jid);
                }

            break;
            case 'subscribed' :
                //send confirmation (only once per unchanged roster item, to prevent endless loop)
                if (!this._subscribedAcknowledged.has(item)) {
                    this.xmpp.sendPresence({ to: jid, type: 'subscribe' });
                    this._subscribedAcknowledged.set(item, true);
                }
            break;
            case 'unsubscribe' :
                //always accept automatically (might be ignored anyway)
                this.xmpp.sendPresence({ to: jid, type: 'unsubscribed' });
            break;
            case 'unsubscribed' :
                //send confirmation (only once per unchanged roster item, to prevent endless loop)
                if (item && !this._unsubscribedAcknowledged.has(item)) {
                    this.xmpp.sendPresence({ to: jid, type: 'unsubscribe' });
                    this._unsubscribedAcknowledged.set(item, true);
                }
            break;
        }
    },

    add: function add(jid) {
        this.xmpp.sendPresence({ to: jid, type: 'subscribe' });
    },

    cancel: function cancel(jid) {
        this.xmpp.sendIq({
            type: 'set',
            query: {
                xmlns: 'jabber:iq:roster',
                item: {
                    jid: jid,
                    subscription: 'remove'
                }
            }
        });
    },

    changeName: function changeName(jid, name) {
        var item = this.xmpp.roster[jid];
        if (!item) {
            throw new Error('Name change on non-existing roster item.');
        }
        this.xmpp.sendIq({
            type: 'set',
            query: {
                xmlns: 'jabber:iq:roster',
                item: {
                    jid: jid,
                    subscription: item.subscription,
                    name: name,
                    group: item.group
                }
            }
        });
    }

    //TODO: Manage block list (jabber:iq:privacy)
    //TODO: Manage groups

});
exports.subscriptionManager = new SubscriptionManager();


function onXmppAvailable(event) {
    exports.subscriptionManager.client = event.subject;
}

function onXmppShutdown(event) {
    exports.subscriptionManager.client = null;
}


//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-xmpp-available', onXmppAvailable, true);
unloader.when(function() {
    sysEvents.off('coopfox-xmpp-available', onXmppAvailable);
});

//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-xmpp-shutdown', onXmppShutdown, true);
unloader.when(function() {
    sysEvents.off('coopfox-xmpp-shutdown', onXmppShutdown);
});

