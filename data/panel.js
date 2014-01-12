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

"use strict";

const NS_COOPFOX = self.options.NS_COOPFOX;

/**
 * Target vor generic global events, to be used with .on() and .trigger().
 *
 * @type {jQuery}
 */
const globalEvents = $({});

/**
 * Allows to assign listeners for global events to any jQuery element collection.
 * The listeners will be called upon the event with "this" referring to elements.
 *
 * @param {string} event
 * @param {function} handler
 */
$.fn.onGlobal = function onGlobal(event, handler) {
    globalEvents.on(event, this, function(e) { handler.call(e.data); });
};

$(document)
    .on('submit', 'form', function(event) {
        event.preventDefault();
    })
    .on('click', 'a', function(event) {
        event.preventDefault();
        event.stopPropagation();
        var link = event.currentTarget;
        var href = link.href;
        if (href) {
            if (href.match(/^(https?|ftp):/i)) {
                self.port.emit('linkClick', href);
                return;
            }
        }
        if (link.classList.contains('ui-tabs-anchor')) {
            showTab(href.substr(href.lastIndexOf('#') + 1));
        }
    })
    .on('mousedown', 'a', function(event) {
        if (event.which === 2) { //middle click
            event.preventDefault();
            event.stopPropagation();
            var href = event.currentTarget.href;
            if (href && href.match(/^(https?|ftp):/i)) {
                self.port.emit('linkClick', href, true);
            }
        }
    })
    .on('mouseenter', '.hoverable', function() {
        $(this).children('.hovershow').stop(true, true).delay(250).slideDown(250);
    })
    .on('mouseleave', '.hoverable', function() {
        $(this).children('.hovershow').stop(true, true).delay(250).slideUp(250);
    });

/**
 * @param {string|string[]} rules
 */
function addDocumentStyleRules(rules) {
    if (!Array.isArray(rules)) {
        rules = [rules];
    }
    var style = document.styleSheets[0];
    for each (let rule in rules) {
        style.insertRule(rule, style.cssRules.length);
    }
}

function jidToClass(jid) {
    if ((typeof(jid) === 'object') && (jid.bare)) {
        jid = jid.bare;
    }
    if (typeof(jid) !== 'string') {
        jid = 'unknown';
    }
    return 'jid-' + jid.replace(/\W/g, '-');
}
function getJidClass(el) {
    let classes = el.classList;
    for (let i = 0; i < classes.length; i++) {
        let cl = classes[i];
        if (cl.substr(0,4) === 'jid-') {
            return cl;
        }
    }
    return null;
}
function setJidClass(el, jidClass) {
    var oldClass = getJidClass(el);
    if (oldClass) {
        el.classList.remove(oldClass);
    }
    if (jidClass) {
        el.classList.add(jidClass);
    }
}
function copyJidClass(source, target) {
    setJidClass(target, getJidClass(source));
}

function randomID() {
   var text = "i";
   var possible = "abcdef0123456789";
   for (let i = 15; i > 0; i--) {
       text += possible.charAt(Math.floor(Math.random() * possible.length));
   }
   return text;
}

function linkify(text) {
    return text.replace(
        /(^|\s)(https?:\/\/[a-z0-9.-]+(:[0-9]+)?(\/\S*)?)(\s|$)/gi,
        function(match, pre, url, post) {
            return pre + '<a href="' + url + '">' + url + '</a>' + post;
        }
    );
}

var $tabs = $();
var $tabsNav = $();
var _tabsInitDone = false;

$(function($) {
    $tabs = $('#tabs');
    $tabsNav = $('#tabs-nav');
    setTimeout(function(){ //give module ready functions time to complete
        $tabs.tabs({});
        $tabsNav.sortable({
            axis: 'x',
            stop: function stop() {
                $tabs.tabs('refresh');
            }
        });
        $tabsNav.children().each(function() {
            var id = (this.getAttribute('aria-controls') || '').replace('-tab','');
            if (id && self.options[id + 'TabHidden']) {
                hideTab(id);
            }
        });
    });

    $tabs.on('tabsactivate', function(event, ui) {
        var id = ui.newTab[0].id.replace('-tab-selector','');
        self.port.emit('tabActivate', id);
        unhighlightTab(id);
    });
});

function getTabIndex(id) {
    var $selector = (id instanceof $) ? id : $('#' + id + '-tab-selector');
    return $tabsNav.children().index($selector);
}

function normalizeTabs() {
     var $selectors = $tabsNav.children(':not(.ui-state-disabled)');
     $tabs.removeClass('notabs');
     if (!$selectors.length) {
        $tabs.addClass('notabs');
     }
     else if ($selectors.length === 1) {
        $tabs.tabs('option', 'active', getTabIndex($selectors));
     }
 }

function createTab(id, title, afterId) {
    var $tab = $('<div id="' + id + '-tab"></div>').appendTo($tabs);
    var $li = $('<li id="' + id + '-tab-selector"></li>');
    if (afterId) {
        let $afterSelector = $('#' + afterId + '-tab-selector');
        $li.insertAfter($afterSelector);
    } else {
       $li.appendTo($tabsNav);
    }
    var $selector = $('<a href="#' + id + '-tab">' + title +'</a>').appendTo($li);
    if ($('.ui-tabs-panel', $tabs).length) {
        $tabs.tabs('refresh');
        if (self.options[id + 'TabHidden']) {
            hideTab(id);
        }
        normalizeTabs();
    }
    console.info('Panel tab created: ' + id);
    self.port.emit('tabCreate', id);
    return { $tabContent: $tab, $tabSelector: $selector };
}

function addTabCloseButton(id) {
    var $selector = $('#' + id + '-tab-selector');
    return $('<span class="tab-close"></span>').appendTo($selector);
}

function removeTab(id) {
    $('#' + id + '-tab').remove();
    $('#' + id + '-tab-selector').remove();
    if ($('.ui-tabs-panel', $tabs).length) {
        $tabs.tabs('refresh');
        normalizeTabs();
    }
    console.info('Panel tab removed: ' + id);
    self.port.emit('tabRemove', id);
}

function hideTab(id) {
    unhighlightTab(id);
    var $selector = $('#' + id + '-tab-selector');
    if ($selector.attr('role') === 'tab') {
        $tabs.tabs('disable', getTabIndex($selector));
        if ($selector.hasClass('ui-tabs-active')) {
            var $newActive = $selector.prev();
            if (!$newActive.length) {
                $newActive = $selector.next();
            }
            $newActive.children('a').click();
        }
    }
    $('#' + id + '-tab').removeClass('ui-state-disabled').addClass('ui-state-disabled');
    normalizeTabs();
    self.port.emit('tabHide', id);
}
self.port.on('tabHide', hideTab);

function showTab(id) {
    var $selector = $('#' + id + '-tab-selector');
    if ($selector.attr('role') === 'tab') {
        $tabs.tabs('enable', getTabIndex($selector));
    }
    $('#' + id + '-tab').removeClass('ui-state-disabled');
    normalizeTabs();
    self.port.emit('tabShow', id);
}
self.port.on('tabShow', showTab);

function highlightTab(id) {
    showTab(id);
    if (activeBulkUpdate) {
        return;
    }
    self.port.emit('tabHighlight', id);
    var $selector = $('#' + id + '-tab-selector');
    if ($selector.hasClass('ui-tabs-active')) {
        return;
    }
    if (!$selector.hasClass('tab-highlighted')) {
        $selector.addClass('tab-highlighted');
    }
    var $counter = $selector.find('.tab-highlight-count');
    if ($counter.length) {
        $counter.text(parseInt($counter.text()) + 1);
    } else {
        $counter = $('<span class="tab-highlight-count blinking">1</span>').appendTo($selector);
    }
}

function unhighlightTab(id) {
    var $selector = $('#' + id + '-tab-selector');
    $selector.removeClass('tab-highlighted');
    $selector.find('.tab-highlight-count').remove();
}

var activeBulkUpdate = false;
self.port.on('beginBulkUpdate', function() {
    activeBulkUpdate = true;
});
self.port.on('endBulkUpdate', function() {
    activeBulkUpdate = false;
});