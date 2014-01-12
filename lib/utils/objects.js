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

/**
 * Creates a combined deep clone of one or more json descriptor object.
 * Properties of later sources overwrite those of earlier ones.
 *
 * @param {object} source
 * @returns {object}
 */
exports.objectMergeRecursive = function objectMergeRecursive(source /*, source2 ... */) {
    var dest = Array.isArray(source) ? [] : {};
    var sub = {};
    for each (let src in arguments) {
        for (let key in src) {
            switch (typeof(src[key])) {
                case 'undefined': break;
                case 'object':
                    if (src[key] !== null) {
                        if (sub[key]) {
                            sub[key].push(src[key]);
                        } else {
                            sub[key] = [src[key]];
                        }
                    }
                //nobreak
                default:
                    dest[key] = src[key];
            }
        }
    }
    for (let key in sub) {
        dest[key] = objectMergeRecursive.apply(null, sub[key]);
    }
    return dest;
};


/**
 * ForEach-Iteration wrapper for values which can be both scalar or arrays.
 *
 * If items is a string, it is passed to the callback.
 * If items is an array, each item is passed to the callback.
 * If items is empty, nothing is done.
 *
 * @param {mixed} items
 * @param {function} callback
 * @param {mixed} arg1  auxiliary argument
 * @param {mixed} arg2  auxiliary argument
 *
 * @return {number} Number of times the callback was run.
 */
exports.forEachIfAny = function forEachIfAny(items, callback, arg1, arg2) {
    switch (typeof(items)) {
        case 'object' :
            if (Array.isArray(items)) {
                for each (let item in items) {
                    callback(item, arg1, arg2);
                }
                return items.length;
            }
            if (items === null) {
                return 0;
            }
        //nobreak
        case 'string' :
            if (items) {
                callback(items, arg1, arg2);
            }
            return 1;
    }
    return 0;
};