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

jQuery(function($) {

    const participantStatus = {};

    globalEvents.on('rosterItemRender', function(event, args) {
        var item = args.contact;
        var $item = args.$item;
        var jid = item.jid.bare;
        var presence = item.presence.$primary;

        if (presence.c.node === NODE_COOPFOX) {
            $item.addClass('coopfox');

            switch (args.reason) {
                case 'participantActive':
                    participantStatus[jid] = 'active';
                break;
                case 'participantInactive':
                    participantStatus[jid] = 'inactive';
                break;
                case 'participantRejected':
                    participantStatus[jid] = 'rejected';
            }

            if (participantStatus[jid]) {
                $item.addClass('participant-' + participantStatus[jid]);
            }

            $item.dblclick(function(event) {
                event.preventDefault();
                if (this.classList.contains('coopfox') && !this.classList.contains('participant-active')) {
                    self.port.emit('addParticipant', jid);
                }
            });

        }

    });

    globalEvents.on('rosterItemsCompare', function(event, args) {
        var aActive = args.a.classList.contains('participant-active');
        var bActive = args.b.classList.contains('participant-active');
        if (aActive && !bActive) { args.result = -1; }
        if (bActive && !aActive) { args.result =  1; }
    });

});