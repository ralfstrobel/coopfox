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

/*
 * Computes the hash value of a string, using different algorithms.
 *
 * @param  {string}  str       The input string.
 * @param  {string}  alg       Name of the algorithm to use.
 * @param  {string}  mode      Output type: 'binary', 'base64' or 'hex' (default).
 * @param  {boolean} isBinary  Treat the input string as binary data without charset.
 * @return {string}
 */
function hash(str, alg, mode, isBinary) {
    var data;
    if (isBinary) {
        data = str.split('').map(function(c) { return c.charCodeAt(0); });
    } else {
        let conv = Cc['@mozilla.org/intl/scriptableunicodeconverter'].createInstance(Ci.nsIScriptableUnicodeConverter);
        conv.charset = 'UTF-8';
        data = conv.convertToByteArray(str, {});
    }
    var ch = Cc['@mozilla.org/security/hash;1'].createInstance(Ci.nsICryptoHash);
    ch.initWithString(alg);
    ch.update(data, data.length);
    if (mode === 'base64') {
        return ch.finish(true);
    }
    if (mode === 'binary') {
        return ch.finish(false);
    }
    var hash = ch.finish(false);
    var hex = '';
    for (let i in hash) {
        hex += ('0' + hash.charCodeAt(i).toString(16)).slice(-2);
    }
    return hex;
}

/**
 * @see hash()
 */
exports.md5 = function md5(str, mode, isBinary) {
    return hash(str, 'MD5', mode, isBinary);
};

/**
 * @see hash()
 */
exports.sha1 = function sha1(str, mode, isBinary) {
    return hash(str, 'SHA1', mode, isBinary);
};

/**
 * @see hash()
 */
exports.sha256 = function sha256(str, mode, isBinary) {
    return hash(str, 'SHA256', mode, isBinary);
};

/**
 * @see hash()
 */
exports.sha512 = function sha512(str, mode, isBinary) {
    return hash(str, 'SHA512', mode, isBinary);
};

/**
 * Returns the base64 encoded version of a string
 *
 * @param {string}  str     Input string.
 * @param {boolean} utf8    Whether input is utf-8 encoded.
 *
 * @return {string}
 */
exports.base64 = function base64(str, utf8) {
    var base64 = require('sdk/base64');
    if (utf8) {
        return base64.encode(str, 'utf-8');
    }
    return base64.encode(str);
};

/**
 * Returns a randomly generated uuid (without surrounding {}).
 * @return {string}
 */
exports.uuid = function uuid() {
    var uuid = Cc['@mozilla.org/uuid-generator;1']
               .getService(Ci.nsIUUIDGenerator)
               .generateUUID().toString();
    return uuid.substring(1,uuid.length-1);
};

/**
 * Returns a random string of variable length.
 * The string may contain letters and numbers but always
 * begins with a letter (for html id compatibility).
 *
 * @param {number} length   Number of chars to return (max 32)
 * @return {string}
 */
exports.uuidhash = function uuidhash(length) {
    if (typeof(length) != 'number') {
        length = 32;
    }
    return ('i' + exports.md5(exports.uuid())).substr(0,length);
};
