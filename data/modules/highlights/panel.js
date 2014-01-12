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

    //TODO: ellipsis for long quotes (expand on hover)

    globalEvents.on('chatMessageReceived', function(event, args) {

        var msg = args.message;
        var hl = (msg.coopfox) ? msg.coopfox.highlight : null;

        if (hl && msg.type === 'chat') {
            switch (hl.type) {
                case 'insert':
                    let texts = [];
                    if (!Array.isArray(hl.text)) {
                        hl.text = [hl.text];
                    }
                    for each (let text in hl.text) {
                        texts.push(text.$text);
                    }
                    texts = texts.join('... ');
                    msg.body = { $text: '<a class="highlight" href="' + hl.url + '#' + hl.id + '">'  + texts + '</a>' };
                break;

                case 'error':
                    delete msg.body;
                    let $failed = $('#' + hl.id + ' .highlight');
                    if (!$failed.hasClass('failed')) {
                        $failed.addClass('failed').removeAttr('href');
                    }
                    if (args.sender) {
                        let info = 'failed for ' + chatPrintContactName(args.sender) + ': ' + hl.reason;
                        $failed.parent().append(' <em>(' + info.replace(' ', '&nbsp;') + ')</em>');
                    }
                break;
            }
            delete msg.html;
        }

    });

});