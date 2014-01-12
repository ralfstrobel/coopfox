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

const { notify } = require('sdk/notifications');
const { data } = require('sdk/self');

const { Cc, Ci, Cr } = require('chrome');
const promptService = Cc["@mozilla.org/embedcomp/prompt-service;1"].getService(Ci.nsIPromptService);
const windowWatcher = Cc['@mozilla.org/embedcomp/window-watcher;1'].getService(Ci.nsIWindowWatcher);

/**
 * Displays a tab-independent modal alert box.
 * @param {string} title
 * @param {string} text
 */
exports.alert = function alert(title, text) {
    promptService.alert(null, title, text);
};

/**
 * Displays a single-line modal text input.
 *
 * @param {string} title
 * @param {string} text
 * @param {string} defaultValue
 * @returns {string|null}
 */
exports.prompt = function prompt(title, text, defaultValue) {
    var value = { value: defaultValue || '' };
    var result = promptService.prompt(null, title, text, value, null, {});
    return result ? value.value : null;
};

/**
 * Displays a login dialog (username, password).
 *
 * @param {string} title
 * @param {string} message
 * @param {string} checkMessage     Label for the checkbox (e.g. "Remember password")
 * @param {boolean} checkDefault    Default state for the checkbox (default: false)
 * @param {string} userDefault      Default username to display
 *
 * @return {object} (username, password, checkbox) [each may be null on user abort]
 */
exports.loginPromt = function loginPromt(title, message, checkMessage, checkDefault, userDefault) {
    var username = { value : userDefault || '' };
    var password = { value : '' };
    var checkbox = { value : checkDefault || false };
    var result = promptService.promptUsernameAndPassword(
        null,
        title || 'Login',
        message || null,
        username,
        password,
        checkMessage || null,
        checkbox
    );
    if (result) {
        return {
            username : username.value,
            password : password.value,
            checkbox : checkbox.value
        }
    } else {
        return null
    }
};

exports.selectPrompt = function selectPrompt(title, text, options) {
    var selection = {};
    var result = promptService.select(null, title, text, options.length, options, selection);
    return result ? selection.value : null;
};

function confirmEx(title, text, opt0, opt1, opt2) {
    var flags = 0;

    if (typeof(opt0) === 'string') {
        flags += promptService.BUTTON_POS_0 * promptService.BUTTON_TITLE_IS_STRING;
    }
    else {
        if (typeof(opt0) === 'number') {
            flags += promptService.BUTTON_POS_0 * opt0;
        }
        else {
            flags += promptService.BUTTON_POS_0 * promptService.BUTTON_TITLE_OK;
        }
        opt0 = '';
    }

    if (typeof(opt1) === 'string') {
        flags += promptService.BUTTON_POS_1 * promptService.BUTTON_TITLE_IS_STRING;
    }
    else{
        if (typeof(opt1) === 'number') {
            flags += promptService.BUTTON_POS_1 * opt1;
        }
        else {
            flags += promptService.BUTTON_POS_1 * promptService.BUTTON_TITLE_CANCEL;
        }
        opt1 = '';
    }

    if (typeof(opt2) === 'string') {
        flags += promptService.BUTTON_POS_2 * promptService.BUTTON_TITLE_IS_STRING;
    }
    else {
        if (typeof(opt2) === 'number') {
            flags += promptService.BUTTON_POS_2 * opt2;
        }
        opt2 = '';
    }

    return promptService.confirmEx(null, title, text, flags, opt0, opt1, opt2, null, {});
}
exports.confirmEx = confirmEx;

    /**
 * @param {nsIDOMWindow} window
 * @param {number} mode
 * @param {object|Array} filters    Either an array of integer constants, or an object: { filters > titles }
 * @param {string} defaultName
 * @param {string} title
 * @returns {string}
 */
function filePrompt(window, mode, filters, defaultName, title) {
    var fp = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
    fp.init(window, title || 'Select a File', mode);
    if (filters) {
        if (typeof(filters) !== 'object') {
            filters = [filters];
        }
        if (Array.isArray(filters)) {
            for each (let filter in filters) {
                fp.appendFilters(filters[filter]);
            }
        }
        else {
            for (let filter in filters) {
                fp.appendFilter(filters[filter], filter);
            }
        }
    }
    if (defaultName) {
        fp.defaultString = defaultName;
    }
    if (fp.show() !== Ci.nsIFilePicker.returnCancel){
        return fp.file.path;
    }
    return null;
}

exports.fileOpenPrompt = function fileOpenPrompt(window, filters, title) {
    return filePrompt(window, Ci.nsIFilePicker.modeOpen, filters, null, title);
};

exports.fileSavePrompt = function fileSavePrompt(window, filters, defaultName, title) {
    return filePrompt(window, Ci.nsIFilePicker.modeSave, filters, defaultName, title);
};

/**
 * Opens an arbitrary XUL or HTML file as a modal dialog window.
 *
 * There is no return value, but any additional arguments (including objects)
 * are made accessible through window.arguments and can be written to.
 *
 * Note that only files in the chrome:// namespace are allowed to share objects.
 * Passed objects must first be unwrapped: window.arguments[i].wrappedJSObject;
 *
 * @param {string} title
 * @param {string} url
 * @param {number} width
 * @param {number} height
 */
exports.modalDialog = function modalDialog(title, url, width, height) {
    var args = Cc["@mozilla.org/array;1"].createInstance(Ci.nsIMutableArray);
    for (let i = 4; i < arguments.length; i++) {
        let arg = arguments[i];
        if ((typeof(arg) === 'object') && (arg !== null) && !Array.isArray(arg)) {
            args.appendElement({ wrappedJSObject: arg }, false);
        } else {
            let variant = Cc["@mozilla.org/variant;1"].createInstance(Ci.nsIWritableVariant);
            variant.setFromVariant(arg);
            args.appendElement(variant, false);
        }
    }
    windowWatcher.openWindow(
        null,
        url,
        title,
        'chrome=yes,modal=yes,dialog=yes,alwaysRaised=yes,centerscreen=yes,width=' + width + ',height=' + height,
        args
    );
};

/**
 * Displays a non-modal popup in the screen corner.
 *
 * @param {string} title    Title for the popup box.
 * @param {string} text     Message to display (can be an instance of Error).
 */
exports.popupNotify = function popupNotify(title, text) {
    if (text instanceof Error) {
        console.exception(text);
    }
    console.info('NOTIFY: ' + title + ' (' + text + ')');
    notify({
        title : title,
        text : text.toString(),
        iconURL : data.url('images/icon64.png')
    });
};
