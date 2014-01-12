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

const self = require('sdk/self');
const { staticArgs } = require('sdk/system');
const { prefs } = require('sdk/simple-prefs');
const { storage } = require('sdk/simple-storage');

const { store, remove } = require('sdk/passwords');
const { search } = require('sdk/passwords/utils'); //provides synchronous search
const { parseJid } = require('./xmpp/session');
const { SECURITY_STARTTLS } = require('./xmpp/tcp');

const dialogs = require('./browser/dialogs');

function cloneObject(source) {
    var target = {};
    for (let key in source) {
        target[key] = source[key];
    }
    return target;
}

const noLogin = { jid: null, password: null, hostname: null, port: 5222, security: SECURITY_STARTTLS };
Object.freeze(noLogin);

var login = {
    jid : staticArgs.jid || null,
    password: staticArgs.password || null,
    hostname: staticArgs.hostname || (staticArgs.jid ? parseJid(staticArgs.jid).hostname : null),
    port: staticArgs.port || 5222,
    security : staticArgs.security || SECURITY_STARTTLS
};

var stored = false;
var confirmed = (login.jid && login.password && login.hostname);
var storeOnConfirm = storage['login-store-on-confirm'] && !confirmed;
var currentHost = storage['login-current-host'] || null;

/**
 * Deletes the current login.
 */
function reset() {
    login = cloneObject(noLogin);
    stored = false;
    confirmed = false;
    currentHost = storage['login-current-host'] = null;
    search({ url: self.uri }).forEach(remove);
}
exports.reset = reset;

/**
 * Invalidates the current login.
 * The next call to get() will open another promt with data still present.
 */
exports.invalidate = function invalidate() {
    confirmed = false;
    storage['login-current-host'] = null;
};

/**
 * Retrieves the currently set login, even if it is invalid.
 * No dialog is displayed to the user
 *
 * @returns {object}
 */
exports.getCurrent = function getCurrent() {
    return login;
};

/**
 * Returns an empty login (no data set).
 *
 * @returns {object}
 */
exports.getNoLogin = function getNoLogin() {
    return noLogin;
};

/**
 * Answers whether there currently is a valid login available.
 *
 * @returns {boolean}
 */
exports.has = function has() {
    return confirmed;
};

/**
 * Either retrieves a stored login (jid, password, hostname, port, security),
 * a login specified via the command line in dev environments,
 * or attempts to displays a login dialog to the user.
 *
 * @returns {object|null}    Login descriptor or null on user abort.
 */
exports.get = function get() {

    if (confirmed) {
        return login;
    }

    var storedLogins = search({ url: self.uri });
    if (storedLogins.length) {
        if (currentHost) {
            for each (let sl in storedLogins) {
                if (sl.realm === currentHost) {
                    login.jid = sl.username;
                    login.password = sl.password;
                    let hostparts = sl.realm.split(':');
                    login.hostname = hostparts[0];
                    login.port = (hostparts.length > 1) ? hostparts[1] : 5222;
                    login.security = storage['login-security-' + login.hostname] || SECURITY_STARTTLS;
                    confirmed = true;
                    stored = true;
                }
            }
        }
    }

    if (!confirmed) {

        let params = {
            logins: storedLogins,
            default: login,
            store: storeOnConfirm,
            submit: false
        };

        for each (let login in search()) {
            if (login.url.indexOf('accounts.google.com') !== -1) {
                params.google = login;
            }
            if (login.url.indexOf('facebook.com') !== -1) {
                params.facebook = login;
            }
        }

        dialogs.modalDialog('CoopFox XMPP Login', 'chrome://coopfox/content/login.html', 520, 380, params, login);

        if (!params.submit) { return noLogin; }
        storeOnConfirm = storage['login-store-on-confirm'] = params.store;
    }

    return login;
};

/**
 * This should be called after a successful login,
 * so that correct login details can be stored.
 */
exports.confirm = function confirm() {
    if (storeOnConfirm && !stored) {
        try { //ignore duplicate errors
            store({
                realm: login.hostname + ':' + login.port,
                username : login.jid,
                password : login.password
            });
            storage['login-security-' + login.hostname] = login.security;
        }
        finally {
            stored = true;
            storage['login-current-host'] = login.hostname + ':' + login.port;
        }
    }
    confirmed = true;
};
