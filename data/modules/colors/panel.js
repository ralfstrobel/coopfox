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

    self.port.on('setContactColors', function(contact, colors) {
        var className = jidToClass(contact.jid);

        addDocumentStyleRules([
            '.chat-history .message.' + className + ' > .sender, ' +
            '.contact-color.' + className + ' { color: ' + colors.foreground + '; }',
            '.chat-history .status.' + className + ' > .sender, ' +
            '.chat-states .sender.' + className + ', ' +
            '.chat-history .status .contact-color.' + className + ' { color: ' + colors.background + '; }'
        ]);

    });

});
