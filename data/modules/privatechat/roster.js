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

    globalEvents.on('rosterItemRender', function(event, args) {
        var item = args.contact;
        var $item = args.$item;

        $item.off('dblclick').dblclick(function(event) { //replace chat module listener (become default)
            event.preventDefault();
            if (!this.classList.contains('coopfox') || this.classList.contains('participant-active')) {
                self.port.emit('openPrivateChat', item.jid.bare);
            } else {
                self.port.emit('openPrivateChatEx', item.jid.bare);
            }
        });

    });

});