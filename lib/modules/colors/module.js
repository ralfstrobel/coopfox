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
const simplePrefs = require('sdk/simple-prefs');
const baseUrl = require('sdk/self').data.url('modules/colors/');

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../../utils/events');

const { confirmEx } = require('../../browser/dialogs');

/**
 * This module assigns colorsets to session participants, for use by other modules.
 *
 * Users can choose their own colors via the UI,
 * which are then synchronized with other contacts.
 */
const Colors = Class({
    extends: EventHub,
    className: 'Colors',

    /**
     * @param {CoopFox} coopfox
     */
    initialize: function initialize(coopfox) {
        this.coopfox = coopfox;
        this._colors = {};
        this._stylesAssigned = {};

        coopfox.sidebar.roster.addScript(baseUrl + 'roster.js');
        coopfox.sidebar.panel.addScript(baseUrl + 'panel.js');

        EventHub.prototype.initialize.apply(this, arguments);

        coopfox.getParticipantColors = this.getParticipantColors; //expose to other modules

        this.subscribeTo(coopfox, 'componentsReady');
        this.subscribeTo(coopfox, 'destroy');
        console.info('Colors module activated.');
    },

    _onceComponentsReady: function _onceComponentsReady() {
        var xmpp = this.coopfox.xmpp;

        if (!simplePrefs.prefs.syncColors) {
            //always assign red to current user
            this._onParticipantJoin(xmpp.rosterSelf.jid.bare);
        } else {
            this.subscribeTo(xmpp, 'participantJoinOrderChange');
        }
        for each (let jid in xmpp.participantJoinOrder) {
            this._onParticipantJoin(jid);
        }
        this.subscribeTo(xmpp, 'participantJoin');
        simplePrefs.on('syncColors', this._onParticipantJoinOrderChange);
    },

    _onceDestroy: function _onceDestroy() {
        if (simplePrefs.off) {
            simplePrefs.off('syncColors', this._onParticipantJoinOrderChange);
        } else {
            simplePrefs.removeListener('syncColors', this._onParticipantJoinOrderChange);
        }
        this.coopfox = null;
    },

    /**
     * Assign a color to new participants.
     *
     * @param {string} jid
     */
    _onParticipantJoin: function _onParticipantJoin(jid) {
        if (jid in this._stylesAssigned) { return; }
        var contact = this.coopfox.xmpp.getContact(jid);
        var colors = this.getParticipantColors(jid);
        this.coopfox.sidebar.panel.port.emit('setContactColors', contact, colors);
        this.coopfox.sidebar.roster.port.emit('setContactColors', contact, colors);
        this._stylesAssigned[jid] = true;
    },

    _onParticipantJoinOrderChange: function _onParticipantJoinOrderChange() {
        this.coopfox.reload();
    },

    /**
     * Delivers a color set which is unique to each participant during a session.
     *
     * @param {string} jid
     * @return {object}
     */
    getParticipantColors : function getParticipantColors(jid) {

        //TODO: Allow users to pick colors via UI
        //TODO: Actively synchronize colors with others

        var colors = this._colors[jid];
        if (colors) { return colors; }

        switch (Object.keys(this._colors).length) {
            case 0:
                colors = {
                    foreground : '#DA1C1C', //red
                    background : '#F2A4A4'
                };
            break;
            case 1:
                colors = {
                    foreground : '#1C26D3', //blue
                    background : '#9598D3'
                };
            break;
            case 2:
                colors = {
                    foreground : '#169b0a', //green
                    background : '#84CD88'
                };
            break;
            case 3:
                colors = {
                    foreground : '#C02993', //purple
                    background : '#EAAFDC'
                };
            break;
            case 4:
                colors = {
                    foreground : '#E0AB00', //orange
                    background : '#E8DB9F'
                };
            break;
            default:
                colors = {
                    foreground : '#222222', //grey
                    background : '#BBBBBB'
                };
            break;
        }
        this._colors[jid] = colors;
        console.log('Color assigned to ' + jid + ': ' + colors.foreground);
        return colors;
    }

});

function onCoopfoxInit(event) {
    Colors(event.subject);
}

//we have to use a strong reference to prevent the garbage collector from unloading this file
sysEvents.on('coopfox-init', onCoopfoxInit, true);
unloader.when(function() {
    sysEvents.off('coopfox-init', onCoopfoxInit);
});