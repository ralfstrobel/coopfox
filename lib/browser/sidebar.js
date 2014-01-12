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

const { Cc, Ci } = require('chrome');

const { Class } = require('sdk/core/heritage');
const { Symbiont } = require('sdk/content/symbiont');
const { readURISync } = require('sdk/net/url');
const { data } = require('sdk/self');
const { storage } = require('sdk/simple-storage');

const { EventHub } = require('../utils/events');
const { NS_COOPFOX, NODE_COOPFOX } = require('../coopfox');

/**
 * Customized symbiont, which does not initialize on creation,
 * but allows content scripts, options and styles to be added
 * gradually. Subsequently, "initialize(frame)" must
 * be called explicitly to load the frame content.
 *
 * Somme general content tools are automatically added to
 * each frame, such as the jQuery libraries and
 * the CoopFox namespace constant.
 *
 * TODO: Since all frontend resources are also accessible through chrome:// urls,
 * it might be beneficial to implement a more lightweight solution.
 * Symbiont creates unnessesary overhead, by un-/serializing all event arguments.
 * If the script is loaded from a chrome:// url, you have full access to the
 * functions and properties defined in its scope and can pass native arguments.
 *
 * @see Symbiont
 */
const HTMLFrame = Symbiont.resolve({ constructor: '_createSymbiont' }).compose({

    /**
     * @param {string} url
     */
    constructor: function HTMLFrame(url) {
        this.contentURL = url;
        this.contentScript = [];
        this.contentScriptFile = [];
        this.contentScriptOptions = { NS_COOPFOX: NS_COOPFOX, NODE_COOPFOX: NODE_COOPFOX };
        this.contentScriptWhen = 'start';

        this.addScript(data.url('jquery.js'));
        this.addScript(data.url('jquery-ui.js'));
        this.addStyle(data.url('jquery-ui.css'));
    },

    /**
     * Load the defined content into a provided frame element.
     *
     * @param {nsIDOMXULElement} frame
     */
    initialize: function initialize(frame) {
        //add submission of "ready" event to the the end of content scripts
        this.contentScript.push('jQuery(function(){setTimeout(function(){self.port.emit("ready");}) });');

        this._createSymbiont({ frame: frame });
        var self = this;
        this.port.once('ready', function onReady() {
            self._contentScriptsReady = true;
        });
    },

    /**
     * @param {string} url
     */
    addScript: function addScript(url) {
        if (this._contentWorker) {
            throw new Error('Unable to add script after frame content is loaded.');
        }
        this.contentScriptFile.push(url);
        //console.info('Adding sidebar script: ' + url);
    },

    /**
     * @param {object} options
     */
    addOptions: function addOptions(options) {
        if (this._contentWorker) {
            throw new Error('Unable to add options after frame content is loaded.');
        }
        for (let key in options) {
            this.contentScriptOptions[key] = options[key];
        }
    },

    /**
     * @param {string} url
     */
    addStyle: function addStyle(url) {
        if (this._contentWorker) {
            throw new Error('Unable to add style after frame content is loaded.');
        }
        var link = '<link rel="stylesheet" type="text/css" href="' + url + '" />';
        var wrapperScript = "jQuery('" + link + "').appendTo('head');";
        this.contentScript.push(wrapperScript);
        //console.info('Adding sidebar style: ' + url);
    },

    isReady: function isReady() {
        return (this._contentWorker && this._contentScriptsReady);
    }

});

/**
 * Creates the right-hand sidebar, defined in "data/sidebar.xul",
 * featuring two HTML frame elements "roster" and "panel".
 *
 * The browser UI extensions are not modified directly after creation,
 * but only when the activate() method is called explicitly.
 * Before this, the roster and panel frames can be extended with
 * additional content scripts and styles.
 *
 * @see HTMLFrame
 */
const Sidebar = Class({
    extends: EventHub,
    className: 'Sidebar',

    /**
     * @param {nsIDomWindow} window
     */
    initialize: function initialize(window) {
        EventHub.prototype.initialize.apply(this);

        this.window = window;

        this.roster = new HTMLFrame(data.url('roster.html'));
        this.roster.addStyle(data.url('roster.css'));
        this.roster.addScript(data.url('roster.js'));
        this.panel = new HTMLFrame(data.url('panel.html'));
        this.panel.addStyle(data.url('panel.css'));
        this.panel.addScript(data.url('panel.js'));

        this._overlay = [];
    },

    activate: function activate() {
        var document = this.window.document; //the browser UI (XUL)
        var parent = document.getElementById('browser'); //hbox wrapper for everything under toolbars
        var insertBefore = document.getElementById('appcontent').nextSibling;

        var parser = Cc["@mozilla.org/xmlextras/domparser;1"].createInstance(Ci.nsIDOMParser);
        parser.init(document.nodePrincipal, document.documentURIObject, document.baseURIObject);
        var sidebar = parser.parseFromString(data.load('sidebar.xul'), 'text/xml');

        var newNode;
        while (newNode = sidebar.documentElement.firstElementChild) {
            parent.insertBefore(document.adoptNode(newNode), insertBefore);
            this._overlay.push(newNode);
        }

        this.container = document.getElementById('coopfox');
        if (storage.sidebarWidth) {
            this.container.width = storage.sidebarWidth;
        }

        this.rosterFrame = document.getElementById('coopfox-roster');
        if (storage.rosterHeight) {
            this.rosterFrame.height = storage.rosterHeight;
        }
        this.roster.initialize(this.rosterFrame);
        this.roster.port.once('ready', this.emit.bind(this, 'rosterReady'));

        this.panelFrame = document.getElementById('coopfox-panel');
        this.panel.initialize(this.panelFrame);
        this.panel.port.once('ready', this.emit.bind(this, 'panelReady'));

        this._rosterMenu = document.getElementById('coopfoxRosterMenu');
        this._rosterContexMenu = document.getElementById('coopfoxRosterContextMenu');
        this._panelMenu = document.getElementById('coopfoxPanelMenu');
        this._panelContexMenu = document.getElementById('coopfoxPanelContextMenu');

        document.getElementById('button-coopfox-close').addEventListener('command', this.emit.bind(this, 'close'));

        //block the link hover target indicator from showing our internal urls
        var styles = this.window.document.styleSheets[0];
        var rule = '#statusbar-display[type="overLink"][label^="' + data.url() + '"] { display:none; }';
        styles.insertRule(rule, styles.cssRules.length);
    },

    _onceAfterComponentsReady: function _onceAfterComponentsReady() {
        //we have to add these listeners last, so that the items have set their visibility
        this._rosterMenu.addEventListener('popupshowing', this._onMenuShowing);
        this._rosterContexMenu.addEventListener('popupshowing', this._onMenuShowing);
        this._panelMenu.addEventListener('popupshowing', this._onMenuShowing);
        this._panelContexMenu.addEventListener('popupshowing', this._onMenuShowing);

        this.rosterFrame.contentDocument.getElementById('menu').addEventListener('mousedown', function(event) {
            if (this._rosterMenu.state === 'open') {
                this._rosterMenu.hidePopup();
            } else {
                this._rosterMenu.openPopup(event.target, 'after_end', 0, 0, false, false, event);
            }
        }.bind(this));

        this.panelFrame.contentDocument.getElementById('menu').addEventListener('mousedown', function(event) {
            if (this._panelMenu.state === 'open') {
                this._panelMenu.hidePopup();
            } else {
                this._panelMenu.openPopup(event.target, 'after_end', 0, 0, false, false, event);
            }
        }.bind(this));
    },

    _onMenuShowing: function _onMenuShowing(event) {
        var hasItems = false;
        var lastSeparator = null;
        for (let item = event.target.firstElementChild; item !== null; item = item.nextElementSibling ) {
            if ((item.localName === 'menuitem') && (item.hidden !== true)) {
                hasItems = true;
                lastSeparator = null;
            }
            if (item.localName === 'menuseparator') {
                //hide separator at beginning
                item.hidden = !hasItems;
                if (lastSeparator) {
                    //hide double-separators
                    lastSeparator.hidden = true;
                }
                lastSeparator = item;
            }
        }
        if (lastSeparator) {
            //hide separator at end
            lastSeparator.hidden = true;
        }
        if (!hasItems) {
            event.preventDefault();
        }
    },

    _destroyOverlays: function _destroyOverlays() {
        storage.sidebarWidth = this.container.width;
        storage.rosterHeight = this.rosterFrame.height;

        if (this.roster !== null) {
            this.roster.destroy();
        }
        if (this.panel !== null) {
            this.panel.destroy();
        }
        this.rosterFrame = null;
        this._rosterMenu = null;
        this._rosterContexMenu = null;
        this.panelFrame = null;
        this._panelMenu = null;
        this._panelContexMenu = null;
        for each (let node in this._overlay) {
            node.parentNode.removeChild(node);
        }
        this._overlay = [];
    }

});
exports.Sidebar = Sidebar;
