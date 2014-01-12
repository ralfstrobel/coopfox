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

const DEBUG_EVENTS = true;

const { Class } = require('sdk/core/heritage');
const eventDispatcher = require('sdk/event/core');
const sysEventDispatcher = require('sdk/system/events');
const unloader = require('sdk/system/unload');

/**
 * This base class defines a destroy() method,
 * which can only be called once and is triggered
 * automatically when the extension unloads.
 */
const SelfUnloader = Class({

    initialize: function initialize() {
        unloader.ensure(this, 'destroy');
    },

    destroy: function destroy() {}

});
exports.SelfUnloader = SelfUnloader;

/**
 * Prints a human readable description of the
 * extra argumnts of an event call.
 *
 * @param {Array} args
 * @returns {string}
 */
function dumpExtraArguments(args) {
    if ((args.length <= 1) || (typeof(args[1]) === 'undefined')) { return ''; }
    var result = ' [';
    var arg = args[1];
    switch (typeof(arg)) {
        case 'string':
            result += (arg.length > 20) ? arg.substr(0, 20) + '...' : arg;
        break;
        case 'object':
            if (arg === null) {
                result += 'null';
            }
            else if (Array.isArray(arg)) {
                result += 'Array(' + arg.length + ')';
            }
            else {
                let cnst = arg.constructor ? arg.constructor.name : null;
                if (cnst && (cnst !== 'Object') && (cnst !== 'constructor')) {
                    result += cnst;
                }
                else {
                    result += '{';
                    let keys = Object.keys(arg);
                    if (keys.length > 5) {
                        result += keys.slice(0,5).join(',') + ',...';
                    } else {
                        result += keys.join(',');
                    }
                    result += '}';
                }
            }
        break;
        case 'boolean':
            result += arg ? 'true' : 'false';
        break;
        default:
            result += '...';
    }
    if (args.length > 2) {
        result += ', ';
        let arg2 = args[2];
        switch (typeof(arg2)) {
            case 'string':
                result += (arg2.length > 20) ? arg2.substr(0, 20) + '...' : arg2;
            break;
            default:
                result += '...';
        }
        if (args.length > 3) {
            result += ', ...';
        }
    }
    result += ']';
    return result;
}

/**
 * A class which can accept event listeners and dispatch events to them,
 * for local as well as global system events.
 *
 * Each instance automatically binds all of its methods,
 * so they can easily be registered as event listeners themselves.
 *
 * The constructor argument must always be an object.
 * Any properties in this object which begin with "on" / "once"
 * are automatically added as listeners, if they are a function
 * (e.g. "onMyEvent" becomes a listener of emit('myEvent'))
 * or subscribed if they point to an instance of EventEmitter.
 *
 * Any private method beginning with "_init" will automatically be called by the constructor.
 * It is recommended that descendant classes do not overwrite the constructor,
 * but add further _init*() methods instead, to preserve the correct order of execution.
 *
 * Any private method beginning with "_destroy" will be called on destroy().
 * The event "_beforeDestroy" is triggered before any calls to "_destroy*" methods.
 */
const EventHub = Class({
    extends: SelfUnloader,
    className: 'EventHub',

    initialize : function initialize(options) {

        this.__quiet = 0;
        this.__subscriptions = [];

        for (let i in this) {
            if (Object.__lookupGetter__.call(this, i)) { continue; } //ignore virtual properties
            if (typeof(this[i]) === 'function') {
                this[i] = this[i].bind(this);
                if (i.substr(0,5) === '_init') {
                    //using explicit function reference, in case derived classes override once
                    EventHub.prototype.once.call(this, '_init', this[i]);
                }
                if (i.substr(0,8) === '_destroy') {
                    //using explicit function reference, in case derived classes override once
                    EventHub.prototype.once.call(this, '_destroy', this[i]);
                }
            }
        }

        if (typeof(options) !== 'object' || options === null) {
            options = {};
        }

        for (let i in options) {
            if (i.substr(0,4) === 'once') {
                let type = i.charAt(4).toLowerCase() + i.substr(5);
                let listener = options[i];
                if (typeof(listener) === 'function') {
                    this.once(type, listener);
                }
                else if (listener instanceof EventHub) {
                    listener.subscribeTo(this, type);
                } else {
                    throw new TypeError('Invalid listener "' + i + '".');
                }
                delete options[i]; //makes options safe to forward without unwanted subscriptions
            } else if (i.substr(0,2) === 'on') {
                let listener = options[i];
                let type = i.charAt(2).toLowerCase() + i.substr(3);
                if (typeof(listener) === 'function') {
                    this.on(type, listener);
                }
                else if (listener instanceof EventHub) {
                    listener.subscribeTo(this, type);
                } else {
                    throw new TypeError('Invalid listener "' + i + '".');
                }
                delete options[i];
            }
        }

        //this.on('error', this.__onError);

        SelfUnloader.prototype.initialize.call(this); //replaces destroy()!

        this.emit('_init', options); //internal
        this.emit('init', options); //external
        this.emit('afterInit', options); //external
        this.emit('_afterInit', options); //internal

    },

    on: function on(type, listener) {
        eventDispatcher.on(this, type, listener);
    },
    once: function once(type, listener) {
        eventDispatcher.once(this, type, listener);
    },
    off: function off(type, listener) {
        eventDispatcher.off(this, type, listener);
    },
    emit: function emit(type /*, ...*/) {
        if (this.__quiet > 0) { return; }
        var args = Array.slice(arguments);
        args.unshift(this);

        if (DEBUG_EVENTS && eventDispatcher.count(this, type)) {
            console.info('Event: ' + this.className + '.' + type + dumpExtraArguments(arguments));
        }

        eventDispatcher.emit.apply(null, args);
    },
    countListeners: function countListeners(type) {
        return eventDispatcher.count(this, type);
    },

    sysOn: function sysOn(type, listener, strong) {
        sysEventDispatcher.on(type, listener, strong);
    },
    sysOnce: function sysOnce(type, listener, strong) {
        sysEventDispatcher.once(type, listener, strong);
    },
    sysOff: function sysOff(type, listener) {
        sysEventDispatcher.off(type, listener);
    },
    sysEmit: function sysEmit(type, data, subject) {
        if (DEBUG_EVENTS) {
            console.info('SysEvent: ' + this.className + '.' + type);
        }
        sysEventDispatcher.emit(type, { data: data || null, subject: subject || this });
    },

    /**
     * Subscribe to a specific event of another instance of EventHub
     * or a similar interface (EventEmitter, port), using either
     * an explicitly defined or an implicit (magic) listener method.
     *
     * All subscriptions are automatically cancelled on destroy().
     *
     * @param {EventHub} target
     * @param {string} type
     * @param {function} listener  (optional, defaults to this._on[Type])
     * @param {boolean} once  Whether to subscribe only for one call (optional).
     */
    subscribeTo: function subscribeTo(target, type, listener, once) {
        if (!listener) {
            let listenerName = type.charAt(0).toUpperCase() + type.substr(1);
            if (typeof(this['_on' + listenerName]) === 'function') {
                listener = this['_on' + listenerName];
                once = false;
            }
            else if (typeof(this['_once' + listenerName]) === 'function') {
                listener = this['_once' + listenerName];
                once = true;
            }
            else if (type === 'destroy') {
                listener = this.destroy;
                once = true;
            }
            else {
                throw new Error('No matching listener for subsciption to "' + type + '" event.');
            }
        }

        if (once) {
            target.once(type, listener);
        } else {
            target.on(type, listener);
        }

        this.__subscriptions.push({ target: target, type: type, listener: listener });
    },

    /**
     * Unsubscribe (from a specific event) (on another EventHub).
     * Each ommitted attribute defaults to "all".
     *
     * @param {EventHub} target
     * @param {string} type
     * @param {function} listener
     */
    unsubscribeFrom: function unsubscribeFrom(target, type, listener) {
        for (let i in this.__subscriptions) {
            let sub = this.__subscriptions[i];
            if (
                (!target || (sub.target === target)) &&
                (!type || (sub.type === type)) &&
                (!listener || (sub.listener === listener))
            ) {
                if (sub.target.removeListener) {
                    sub.target.removeListener(sub.type, sub.listener);
                } else {
                    sub.target.off(sub.type, sub.listener);
                }
                delete this.__subscriptions[i];
            }
        }
    },

    /*__onError: function __onError(error) {
        //sdk/event.core will automatically captures events and emits them as 'error'
        //The Error passed in "error" seems to have a broken prototype chain, so instanceof doesn't work
        if (error && (typeof(error) === 'object') && (error.constructor.name.substr(-5) === 'Error')) {
            console.exception(error);
        }
    },*/

    pushQuiet: function pushQuiet() {
        this.__quiet++;
    },

    popQuiet: function popQuiet() {
        this.__quiet--;
        if (this.__quiet < 0) {
            this.__quiet = 0;
        }
    },

    destroy : function destroy() {
        this.unsubscribeFrom();
        this.emit('_beforeDestroy', this); //internal
        this.emit('beforeDestroy', this); //external
        this.emit('destroy', this); //external
        this.emit('_destroy', this); //internal
        this.emit('afterDestroy', this); //external
        this.emit('_afterDestroy', this); //internal
        this.off(); //unsubscribe all listeners
    }

});
exports.EventHub = EventHub;
