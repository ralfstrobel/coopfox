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

    const { $tabContent, $tabSelector } = createTab('notes', 'Private Notes');

    const $notes = $('<textarea id="notes"></textarea>').appendTo($tabContent);

    $tabs.on('tabsactivate', function(event, ui) {
        if (ui.newPanel.is($tabContent)) {
            $notes.focus();
        }
    });

    var changeTimeout = null;

    $notes.keypress(function(){
        if (changeTimeout) {
            clearTimeout(changeTimeout);
        }
        changeTimeout = setTimeout(function() {
            changeTimeout = null;
            self.port.emit('notesContent', $notes.val());
        }, 1000);
    });

    self.port.on('notesSetContent', function(value) {
        $notes.val(value);
    });

});