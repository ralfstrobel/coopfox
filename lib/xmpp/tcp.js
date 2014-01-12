/**
 * This file is part of the Firefox extension "CoopFox", developed as part of my master's thesis
 * at the Cooperative Media Lab, University of Bamberg, Germany.
 * @copyright (c) 2014 Ralf Strobel
 *
 * Special thanks to Massimiliano Mirra, who wrote the original "xmpp4moz" extension for Firefox,
 * which served as an inspiration for parts of the code in this file.
 *
 * All content is no longer maintained and is made available purely for archival and educational purposes.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

'use strict';

const TCP_DEBUG = false;

const { Cc, Ci, Cr } = require('chrome');
const threadManager = Cc['@mozilla.org/thread-manager;1'].getService(Ci.nsIThreadManager);
const transportService = Cc['@mozilla.org/network/socket-transport-service;1'].getService(Ci.nsISocketTransportService);
const certOverrideService = Cc["@mozilla.org/security/certoverride;1"].getService(Ci.nsICertOverrideService);

const { Class } = require('sdk/core/heritage');
const { EventHub } = require('../utils/events');

const SECURITY_NONE = exports.SECURITY_NONE = 'none';
const SECURITY_SSL = exports.SECURITY_SSL = 'ssl';
const SECURITY_STARTTLS = exports.SECURITY_STARTTLS = 'starttls';
const SECURITY_STARTTLS_REQUIRED = exports.SECURITY_STARTTLS_REQUIRED = 'starttls_required';

/**
 * Abstract base class for any instance using a persistent TCP connection to a server.
 * Any derived classes may use the _writeString() method to send data to the server.
 * Any derived classes must implement _onDataAvailable() (@see nsIStreamListener).
 */
const TCPConnection = Class({
    extends: EventHub,
    className: 'TCPConnection',

   /**
    * @param {object} options
    *  - {string} hostname : A resolvable host name or ip address (defaults to localhost).
    *  - {number} port : A port number (defaults to 80).
    *  - {number} security : One of the SECURITY_* constants (defaults to SECURITY_NONE)
    *
    *  - {number} connectTimeout : Timeout for connection handshake in seconds (default 10).
    *  - {number} idleTimeout : Timeout for idle data connection in seconds (default 600).
    *                           This setting has no effect if keepaliveTimeout is set.
    *  - {number} keepaliveInterval : After how many seconds of idle state should an empty
    *                                 data packet be sent to the server (default 30).
    *
    *  - {function} onConnected()    : Called as soon as connection is established.
    *  - {function} onDisconnected() : Called when connection is closed after destroy() was called.
    *  - {function} onTcpError(msg)  : Called if connection is closed unexpectedly or cannot be established.
    */
    initialize : function initialize(options) {

        this._transport = null;
        this._outstream = null;

        this._replyTimer = null;
        this._keepaliveTimer = null;
        this._tcpState = 'disconnected';

        EventHub.prototype.initialize.apply(this, arguments);

        this._host = options.hostname || '127.0.0.1';
        this._port = options.port || 80;

        var connectTimeout = options.connectTimeout || 10; //10sec
        var idleTimeout = options.idleTimeout || 600; //5min

        if (options.security == SECURITY_SSL) { //weak comparison, so that "true" also matches
            this._transport = transportService.createTransport(['ssl'], 1, this._host, this._port, null);
        } else {
            this._transport = transportService.createTransport(['starttls'], 1, this._host, this._port, null);
        }

        var eventListener = this._createTcpEventListener();

        this._transport.setEventSink(eventListener, threadManager.currentThread);
        this._transport.securityCallbacks = eventListener;

        this._transport.setTimeout(Ci.nsISocketTransport.TIMEOUT_CONNECT, connectTimeout);
        this._transport.setTimeout(Ci.nsISocketTransport.TIMEOUT_READ_WRITE, idleTimeout);

        var outstream = this._transport.openOutputStream(0,0,0);
        this._outstream = Cc['@mozilla.org/intl/converter-output-stream;1'].createInstance(Ci.nsIConverterOutputStream);
        this._outstream.init(outstream, 'UTF-8', 0, '?'.charCodeAt(0));

        var instream  = this._transport.openInputStream(0,0,0);
        var inputPump = Cc['@mozilla.org/network/input-stream-pump;1'].createInstance(Ci.nsIInputStreamPump);
        inputPump.init(instream, -1, -1, 0, 0, false);
        inputPump.asyncRead(eventListener, null);
    },

    _initKeepalive : function _initKeepalive(options) {
        this._keepaliveInterval = options.keepaliveInterval || 30;
        this._keepaliveTimer = Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer);
        this._keepaliveCallback = { notify : this._onKeepaliveTimeout }; //nsITimerCallback
    },

    /**
     * Creates an XPCOM-compatible wrapper object for the current instance,
     * which can be passed as a tcp event listener to the low-level API.
     *
     * @returns {nsISupports}
     */
    _createTcpEventListener : function _createTcpEventListener() {
        return {

            //nsISupports
            QueryInterface : function QueryInterface(iid) {
                if (
                   iid.equals(Ci.nsISupports) ||
                   iid.equals(Ci.nsIInterfaceRequestor) ||
                   iid.equals(Ci.nsITransportEventSink) ||
                   iid.equals(Ci.nsIBadCertListener2) ||
                   iid.equals(Ci.nsISSLErrorListener) ||
                   iid.equals(Ci.nsIStreamListener) ||
                   iid.equals(Ci.nsIRequestObserver)
                ) {
                    return this;
                }
                throw Cr.NS_ERROR_NO_INTERFACE;
            },

            //nsIInterfaceRequestor
            getInterface : function getInterface(iid) {
                return this.QueryInterface(iid);
            },

            //nsITransportEventSink
            onTransportStatus : this._onTransportStatus,

            //nsIBadCertListener2
            notifyCertProblem : this._notifyCertProblem,

            //nsISSLErrorListener
            notifySSLError : this._notifySSLError,

            //nsIRequestObserver (nsIStreamListener)
            onStartRequest : this._onStartRequest,
            onStopRequest : this._onStopRequest,

            //nsIStreamListener
            onDataAvailable : this._onDataAvailable
        }
    },

    _LOG : function _LOG(msg) {
        if (TCP_DEBUG) {
            console.log('TCPConnection: ' + msg);
        }
    },

    _setTcpState : function _setTcpState(state, stateInfo) {
        if (state == this._tcpState && !stateInfo) { return; }
        var previousState = this._tcpState;
        this._LOG('STATE ' + state + (stateInfo ? ' [' + stateInfo + ']' : ''));
        this._tcpState = state;
        switch(state) {
            case 'connected':
                this._resetKeepalive(); //start first time
                this.emit('connected');
            break;
            case 'disconnected':
                this._keepaliveTimer.cancel();
                switch (previousState) {
                    case 'disconnecting' :
                        //triggered by user
                        this.emit('disconnected');
                    break;
                    case 'connected' :
                        this.emit('tcpError', 'TCP connection lost.');
                    break;
                    default:
                        this.emit('tcpError', 'TCP connection failed.');
                }
                this.destroy();
            break;
            case 'error':
                this._keepaliveTimer.cancel();
                let args = Array.prototype.slice.call(arguments, 1);
                args.unshift('tcpError');
                this.emit.apply(this, args);
                this.destroy();
            break;
        }
    },

    _onTransportStatus : function _onTransportStatus(transport, status, progress, progressMax) {
        switch(status) {
            case Ci.nsISocketTransport.STATUS_RESOLVING :
                this._setTcpState('resolving');
            break;
            case Ci.nsISocketTransport.STATUS_CONNECTING_TO :
                this._setTcpState('connecting');
            break;
            case Ci.nsISocketTransport.STATUS_CONNECTED_TO :
                this._setTcpState('connected');
            break;
            case Ci.nsISocketTransport.STATUS_SENDING_TO :
                this._resetKeepalive();
            break;
            //case Ci.nsISocketTransport.STATUS_WAITING_FOR : break;
            case Ci.nsISocketTransport.STATUS_RECEIVING_FROM :
                this.clearReplyTimeout(); //received data before timeout
                this._resetKeepalive();
            break;
            default:
        }
    },

    _notifyCertProblem: function _notifyCertProblem(socketInfo, status, targetSite) {
        var message = 'bad-certificate';
        var message2 = 'unknown problem';
        if (status.isDomainMismatch) {
            message2 = 'domain mismatch';
        }
        if (status.isNotValidAtThisTime) {
            message2 = 'expired';
        }
        if (status.isUntrusted) {
            message2 = 'not trusted';
        }
        this._setTcpState('error', message, message2, status.serverCert);
        return true; //suppress error, close socket
    },

    _notifySSLError: function _notifySSLError(socketInfo, error, targetSite) {
        this._setTcpState('error', 'SSL error (' + error + ')');
        return true; //suppress error, close socket
    },

    _onStartRequest : function _onStartRequest(request, context) {
        this._LOG('receiving data...');
    },

    _onStopRequest : function _onStopRequest(request, context, statusCode) {
        this._LOG('connection closed (' + statusCode + ')');
        this._socketClose();
        this._setTcpState('disconnected');
    },

    _onReplyTimeout : function _onReplyTimeout() {
        this._replyTimer = null;
        this._socketClose();
        this._setTcpState('error', 'Reply timeout expired!');
    },

    _onDataAvailable : function _onDataAvailable(request, context, inputStream, offset, count) {
        this._setTcpState('error', 'Abstract class ' + this.className + ' cannot serve as a stream listener.');
    },

    _resetKeepalive : function _resetKeepalive() {
        this._keepaliveTimer.cancel();
        if (this._keepaliveInterval) {
            this._keepaliveTimer.initWithCallback(
                this._keepaliveCallback,
                this._keepaliveInterval * 1000,
                Ci.nsITimer.TYPE_ONESHOT
            );
        }
    },

    _onKeepaliveTimeout : function _onKeepaliveTimeout() {
        this._writeString(' ');
        this._resetKeepalive();
    },

    _writeString : function _writeString(data) {
        if (this._tcpState != 'connected') {
            throw new Error('Trying to send data over inactive socket.');
        }
        if (typeof(data) != 'string') {
            throw new TypeError('Trying to send unserialized object via TCP socket');
        }
        try {
            return this._outstream.writeString(data);
        } catch(e) {
            if (e.name == 'NS_BASE_STREAM_CLOSED') {
                this._socketClose();
                this._setTcpState('disconnected');
            } else {
                throw e;
            }
        }
    },

    _socketClose : function _socketClose() {
        this.clearReplyTimeout();
        this._keepaliveTimer.cancel();
        if (this._transport) {
            if (this._transport.isAlive()) {
                this._transport.close(0);
            }
            this._transport = null;
            this._outstream = null;
        }
    },

    /**
     * Tests whether the connection is live.
     * @return {boolean}
     */
    isConnected : function isConnected() {
        if (!this._transport) { return false; }
        return this._transport.isAlive();
    },

    /**
     * Manually triggers TLS negotiaton after successful connection
     * @throws {Error} If socket is not ready
     */
    startTLS : function startTLS() {
        if (this._tcpState != 'connected') {
            throw new Error('Trying to initialize TLS on inactive socket.');
        }
        this._transport.securityInfo.QueryInterface(Ci.nsISSLSocketControl);
        this._transport.securityInfo.StartTLS();
    },

   /**
    * Sets a one-time timeout before which data must be received
    * from the other side. Otherwise the socket closes itself and
    * triggers an onError() event.
    *
    * @param {number} msecs     Milliseconds before timeout.
    */
    setReplyTimeout : function setReplyTimeout(msecs) {
        this._LOG('setting reply timeout to ' + msecs + 'ms');
        this._replyTimer = Cc['@mozilla.org/timer;1'].createInstance(Ci.nsITimer);
        this._replyTimer.initWithCallback({ notify: this._onReplyTimeout }, msecs, Ci.nsITimer.TYPE_ONESHOT);
    },

    /**
     * Clears the set timeout
     */
    clearReplyTimeout : function clearReplyTimeout() {
        if (!this._replyTimer) { return; }
        this._replyTimer.cancel();
        this._replyTimer = null;
    },

    _destroyTCPSocket : function _destroyTCPSocket() {
        if (['disconnected','error'].indexOf(this._tcpState) == -1) {
            this._setTcpState('disconnecting');
            this._socketClose();
        }
    }

});
exports.TCPConnection = TCPConnection;


/**
 * Registers an SSL certificate as trusted for a given host.
 *
 * @param {string} hostname
 * @param {number} port
 * @param {nsIX509Cert} cert
 * @param {boolean} permanent
 */
exports.addCertificateException = function addCertificateException(hostname, port, cert, permanent) {
    if (!(cert instanceof Ci.nsIX509Cert)) {
        throw new TypeError('Invalid certificate for nsICertOverrideService');
    }
    if (typeof(port) === 'string') {
        port = parseInt(port);
    }

    //noinspection NonShortCircuitBooleanExpressionJS
    var flags = certOverrideService.ERROR_UNTRUSTED
        | certOverrideService.ERROR_MISMATCH
        | certOverrideService.ERROR_TIME;

    certOverrideService.rememberValidityOverride(hostname, port, cert, flags, !permanent)
};
