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
const simplePrefs = require('sdk/simple-prefs');
const { prefs } = simplePrefs;
const { storage } = require('sdk/simple-storage');
const { setTimeout } = require('sdk/timers');
//const _ = require('sdk/l10n').get;

const { CoopFox, NODE_COOPFOX, NS_COOPFOX } = require('./coopfox');
const { BrowserWindowsMonitor, setWindowValue, getWindowValue, clearWindowValues } = require('./browser/windows');
const { addCertificateException } = require('./xmpp/tcp');
const { XMPPThreadHubClient } = require('./xmpp/threads');
const { XMPPMultiUserThread } = require('./xmpp/multiuser');
const { ToolbarButton } = require('./browser/toolbar');
const { MenuItem } = require('./browser/menus');
const loginManager = require('./login');
const dialogs = require('./browser/dialogs');


//Load basic modules (initialization order is reverse registration order, due to sys event processing)
var modules = [
    //require('./modules/logger/module'),
    require('./modules/results/module'),
    require('./modules/notes/module'),
    require('./modules/highlights/module'),
    require('./modules/location/module'),
    require('./modules/privatechat/module'),
    require('./modules/chat/module'),
    require('./modules/roster/module'),
    require('./modules/colors/module')
];

var xmpp = new XMPPThreadHubClient({

    clientNode : NODE_COOPFOX,
    preferredContactClientNode: NODE_COOPFOX,
    identities : [
        { category : 'client', type : 'web', name : 'CoopFox' }
    ],
    features : [
        'http://jabber.org/protocol/chatstates',
        NS_COOPFOX
        //NS_COOPFOX + '+notify'
    ],

    autoDisconnect: !prefs.alwaysConnected && !staticArgs.alwaysConnected,

    onLoginRequired: function onLoginRequired() {
        var login = loginManager.get();
        if (login.jid && login.password && login.hostname) {
            xmpp.setOptions(login);
            xmpp.setOptions({ resource: 'coopfox' });
        } else {
            browserWindows.triggerCloseAllAsync();
        }
    },

    onXmppConnectionFailed: function onXmppConnectionFailed(info, info2, info3) {
        if (info === 'bad-certificate') {
            let choice = prefs.ignoreBadCerts ? 1 : dialogs.confirmEx(
                'Encryption Error',
                'The contacted server is using an invalid encryption certificate (' + info2 + ')',
                'Ignore Permanently',
                'Ignore This Time',
                'Close CoopFox'
            );
            if (choice < 2) {
                let login = loginManager.getCurrent();
                addCertificateException(login.hostname, login.port, info3, choice === 0);
                xmpp.connect(null, true);
            } else {
                browserWindows.triggerCloseAllAsync();
            }
            return;
        }
        if (info === 'not-authorized') {
            info = 'invalid username or password';
        }
        let choice = dialogs.confirmEx(
            'Connection Failed',
            'CoopFox was unable to connect via XMPP' + ((typeof(info) === 'string') ? ' (' + info + ')' : '') + '.',
            'Change Username/Password',
            'Close CoopFox',
            'Retry'
        );
        switch (choice) {
            case 0:
                loginManager.invalidate();
                xmpp.connect();
            break;
            case 1:
                browserWindows.triggerCloseAllAsync();
            break;
            case 2:
                xmpp.connect(null, true);
            break;
        }
    },

    onXmppConnectionLost: function xmppConnectionLost(info) {
        if (info === 'conflict') {
            info = 'login conflict with another CoopFox instance';
        }
        var choice = dialogs.confirmEx(
            'Connection Lost',
            'CoopFox has lost its XMPP connection' + ((typeof(info) === 'string') ? ' (' + info + ')' : '') + '.',
            'Reconnect',
            'Close CoopFox',
            'Change Username/Password'
        );
        switch (choice) {
            case 0:
                xmpp.connect(null, true);
            break;
            case 1:
                browserWindows.triggerCloseAllAsync();
            break;
            case 2:
                loginManager.invalidate();
                xmpp.connect();
            break;
        }
    },

    onXmppConnected: function onXmppConnected() {
        loginManager.confirm();
        dialogs.popupNotify('XMPP Connected', xmpp.rosterSelf.jid.bare);
    },

    onXmppDisconnected: function onXmppConnected(info) {
        dialogs.popupNotify('XMPP Disconnected', info || xmpp.rosterSelf.jid.bare);
    },

    onUnknownStrictThread: function onUnknownStrictThread(message) {
        if (!message.coopfox) { return; }
        if (message.delay) { return; }

        var participant = message.coopfox.participant;
        if (!participant || (participant.action !== 'join') || (participant.jid !== xmpp.rosterSelf.jid.bare )) {
            // ignore messages from other CoopFox instances unless they explicitly add us
            // this prevents clients who might have missed our departure from re-opening the chat
            message.$received = Date.now();
            return;
        }

        var thread = new XMPPMultiUserThread({
            client: xmpp,
            messages: [message]
        });

        var allWindows = browserWindows.getAllWindows();
        var window = browserWindows.getActiveWindow();
        var session = sessions.get(window, null);

        var thirdOptionText = 'Open in Existing Window...';
        var thirdOptionPrompt = true;
        if (allWindows.length === 1) {
            thirdOptionPrompt = false;
            if (session === null) {
                thirdOptionText = 'Open in Current Window';
            }
            else if ((session instanceof CoopFox) && (!session.xmpp.getParticipants(true).length)) {
                thirdOptionText = 'Merge With My CoopChat';
            }
            else {
                thirdOptionText = null;
            }
        }

        var remoteParticipants = parseInt(participant.thread.participants);
        var choiceText = xmpp.getContact(message.$from).name +
            ' invites you to ' + ((message.type === 'headline') ? 're-join' : 'join') + ' a CoopChat session ';
        switch (remoteParticipants) {
            case 0:
                choiceText += '(no other participants).';
                break;
            case 1:
                choiceText += '(1 other participant).';
                break;
            default:
                choiceText += '(' + remoteParticipants + ' other participants).';
        }

        var choice = dialogs.confirmEx(
            'Incoming CoopChat',
            choiceText,
            'Open in New Window',
            'Reject',
            thirdOptionText
        );

        //prompt for window selection if necessary (can still result in choice 0/1)
        if ((choice === 2) && thirdOptionPrompt) {
            let options = [];
            let titles = [];
            for (let i = 0; i < allWindows.length; i++) {
                let win = allWindows[i];
                let ses = sessions.get(win, null);
                if (!ses) {
                    titles[i] = '[Open] ' + win.document.title;
                }
                else if ((ses instanceof CoopFox) && (!ses.xmpp.getParticipants(true).length)) {
                    titles[i] = '[Merge] ' + win.document.title;
                }
                else {
                    continue;
                }
                options[i] = win;
            }
            options.push(null);
            titles.push('[New Window]');

            let choice2 = dialogs.selectPrompt(
                'Incoming CoopChat',
                'Select a window for the CoopChat session with ' + xmpp.getContact(message.$from).name,
                titles
            );
            if (choice2 === null) {
                choice = 1;
            }
            else if (!options[choice2]) {
                choice = 0;
            }
            else {
                window = options[choice2];
            }
        }

        if (choice === 1) {
            thread.destroy((message.type === 'headline') ? 'leave' : 'reject');
            return;
        }

        if (choice === 0) {
            window = browserWindows.openWindow();
        }

        //at this point, we always have a window/session which is either inactive or mergeable
        loadSession(thread, window);
    },

    onUnknownThread: function onUnknownThread(message) {
        if (activeSessions > 0) { return; } //Will be handled by privatechat module
        if (!message.body || !message.body.$text) { return; }

        //Activate CoopFox for active window to receive messages
        var window = browserWindows.getActiveWindow();
        var session = sessions.get(window, null);
        if (!session) {
            session = [];
            sessions.set(window, session);
        }
        //Temporarily store incoming messages in session namespace, deliver when created
        session.push(message);
        browserWindows.emit('windowOpen', window);
    }

});

var activeSessions = 0;
var sessions = new WeakMap();

/**
 * Initializes a new a session from an incoming thread or a saved list of messages.
 * Optionally merges a second set of messages with the first one.
 *
 * If the given window does not have an active session, a new one will be created.
 * Otherwise the session will be replaced (if it is empty) or reverse-merged,
 * so that the loaded messages are treated like the initial session.
 * In either case the sidebar is completely destroyed and re-initialized.
 *
 * If the third argument is defined (including null), this overrides the reverse-merge,
 * so that even an existing session will be deleted replaced with the new messages.
 *
 * @param {object[]|XMPPMultiUserThread} messages
 * @param {nsIDOMWindow} window
 * @param {object[]|null} importMessages
 * @param {number|null} importMessagesTimeOffset
 */
function loadSession(messages, window, importMessages, importMessagesTimeOffset) {

    var session = sessions.get(window, null);
    if (session instanceof CoopFox) {
        //destroy the current session and wait for the process to complete, then recurse
        //disable auto-disconnect between destruction and re-creation
        let autoDisconnectOld = xmpp.autoDisconnect;
        xmpp.autoDisconnect = false;
        session.xmpp.once('afterDestroy', function() {
            if (this.hasMessages && (typeof(importMessages) === 'undefined')) {
                //reverse-merge phase 1 (save old messages)
                importMessages = this.getMessages();
                importMessagesTimeOffset = this.threadTimeOffset;
            }
            loadSession(messages, window, importMessages, importMessagesTimeOffset);
            xmpp.autoDisconnect = autoDisconnectOld;
        });
        session.destroy();
        return;
    }

    var thread = null;
    if (messages instanceof XMPPMultiUserThread) {
        thread = messages;
    }
    else if (Array.isArray(messages)) {
        thread = new XMPPMultiUserThread({
            client: xmpp,
            messages: messages
        });
    }
    else {
        throw new TypeError('Invalid input data for loadSession()');
    }

    if (importMessages) {
        //reverse-merge phase 2 (re-import old messages)
        importMessagesTimeOffset = thread.threadTimeOffset - importMessagesTimeOffset;
        if (thread.isSyncIdle) {
            thread.importMessages(importMessages, false, false, importMessagesTimeOffset);
        }
        else {
            thread.once('beforeSyncIdle', function() {
                thread.importMessages(importMessages, false, false, importMessagesTimeOffset);
            });
        }
    }

    sessions.set(window, thread); //CoopFox instance is created in onWindowOpen
    clearWindowValues(window);
    setWindowValue(window, 'coopfox-active', true);
    setWindowValue(window, 'coopfox-thread-messages', thread.getMessages());

    if (window.document.readyState === 'complete') {
        //re-emit open command if the given window is not new
        browserWindows.emit('windowOpen', window);
    }
}

var browserWindows = new BrowserWindowsMonitor({
    enabled: false,

    onWindowOpen: function onWindowOpen(window) {
        attachToolbarButton(window);

        var session = sessions.get(window, null);
        if (session instanceof CoopFox) { return; }

        function createSession(thread) {
            if (!(thread instanceof XMPPMultiUserThread)) {
                thread = new XMPPMultiUserThread({
                    client: xmpp,
                    messages: getWindowValue(window, 'coopfox-thread-messages')
                });
            }
            thread.once('beforeDestroy', function onBeforeDestroy() {
                setWindowValue(window, 'coopfox-thread-messages', this.getMessages());
            });

            session = new CoopFox({ window: window, xmpp: thread });
            sessions.set(window, session);
            activeSessions++;

            session.once('destroy', function() {
                sessions.delete(window);
                activeSessions--;
                updateToolbarButton(window);
            });

            updateToolbarButton(window);

            /**
             * Injected reload function which destroys and re-creates the session.
             */
            session.reload = function reload() {
                //process async to avoid destroying the session from within its own method
                setTimeout(function() {
                    console.log('Reloading session...');
                    var autoDisconnectOld = xmpp.autoDisconnect;
                    xmpp.autoDisconnect = false;
                    session.xmpp.once('afterDestroy', function() {
                        browserWindows.emit('windowOpen', window);
                        xmpp.autoDisconnect = autoDisconnectOld;
                    });
                    session.destroy('reload');
                });
            };

            /**
             * Injected load function, which destroys and re-creates the session from a set of messages.
             *
             * @param {object[]} messages
             * @param {bool} merge  Reverse-merge the current session back into the new one.
             */
            session.reloadFromImport = function reloadFromImport(messages, merge) {
                //process async to avoid destroying the session from within its own method
                setTimeout(function() {
                    console.log('Reloading session from import...');
                    if (merge) {
                        loadSession(messages, window);
                    } else {
                        loadSession(messages, window, null);
                    }
                });
            };

            /**
             * Injected load function, which destroys the session and re-creates an empty one.
             */
            session.reset = function reset() {
                //process async to avoid destroying the session from within its own method
                setTimeout(function() {
                    console.log('Resetting session...');
                    loadSession([], window, null);
                });
            };

            if (firstRun) {
                let nb = window.gBrowser.getNotificationBox();
                nb.appendNotification(
                    'You are using a version of CoopFox intended exclusively for academic evaluation. ' +
                        'Use at your own risk. ' +
                        'Do not distribute this copy.',
                    'coopfox-disclaimer',
                    self.data.url('images/icon.png'),
                    nb.PRIORITY_WARNING_LOW
                );
            }
            firstRun = false;
        }

        window.addEventListener('close', function(event) {
            if (activeSessions <= 1) {
                //will be handled by quitApplicationRequested
                return;
            }
            var session = sessions.get(window, null);
            if (session instanceof CoopFox) {
                var choice = dialogs.confirmEx(
                    'Close CoopFox Window',
                    'A CoopChat session is still active in this browser window.',
                    'Close Window Anyway',
                    'Cancel'
                );
                if (choice === 1) {
                    event.preventDefault();
                }
            }
        }, true);

        if (session instanceof XMPPMultiUserThread) {
            //incoming session with pre-created thread
            createSession(session);
        }
        if (Array.isArray(session)) {
            //incoming basic chat
            let messages = session;
            createSession();
            session.once('ready', function() {
                for each (let message in messages) {
                    //re-emit messages for privatechat module to pick up
                    this.xmpp.client.emit('unknownThread', message);
                }
            });
        }
        if (!session) {
            let active = getWindowValue(window, 'coopfox-active', null);
            if (active !== null) {
                firstRun = false;
            }
            if (active || prefs.allWindows || staticArgs.allWindows) {
                createSession();
            }
        }
    },

    onWindowClose: function onWindowClose(window) {
        var session = sessions.get(window, null);
        if (session instanceof CoopFox) {
            session.destroy();
        }
    },

    onQuitApplicationRequested: function onQuitApplicationRequested(cancel) {
        if (activeSessions > 0) {
            var choice = dialogs.confirmEx(
                'Close CoopFox',
                'A CoopChat session is still active. Really close FireFox?'
            );
            if (choice === 1) {
                cancel.data = true;
            }
        }
    },

    onQuitApplication: function onQuitApplication() {
        browserWindows.disable();
    }

});

var toolbarButtons = new WeakMap();

function attachToolbarButton(window) {
    var button = toolbarButtons.get(window, null);
    if (button instanceof ToolbarButton){ return; }

    var menuItems = [];
    button = new ToolbarButton({
        window: window,
        id: 'coopfox-button',
        label: 'CoopFox',
        image: self.data.url('images/icon-disabled.png'),
        type: 'menu-button',
        menuId: 'coopfoxToolbarButtonMenu',
        onCreate: function onCreate() {
            menuItems = [

                new MenuItem({
                    window: window,
                    menu: this.menu,
                    id: 'menu-coopfox-toolbar-always-connected',
                    type: 'checkbox',
                    label: 'Always Stay Connected',
                    onShow: function onShow() {
                        if (prefs.alwaysConnected) {
                            this.checked = true;
                        }
                    },
                    onClick: function onClick() {
                        prefs.alwaysConnected = !this.checked;
                    }
                }),

                new MenuItem({
                    window: window,
                    menu: this.menu,
                    id: 'menu-coopfox-toolbar-all-windows',
                    type: 'checkbox',
                    label: 'Enable for New Windows',
                    onShow: function onShow() {
                        if (prefs.allWindows) {
                            this.checked = true;
                        }
                    },
                    onClick: function onClick() {
                        prefs.allWindows = !this.checked;
                    }
                }),

                new MenuItem({
                    window: window,
                    menu: this.menu,
                    id: 'menu-coopfox-toolbar-change-login',
                    label: 'Reset Username/Password',
                    separatorBefore: true,
                    onShow: function onShow() {
                        if (!loginManager.has()) {
                            this.disabled = true;
                            return;
                        }
                        if (xmpp.isConnected()) {
                            this.forbidden = true;
                            this.tooltiptext = 'Not Possible While Connected';
                        } else {
                            this.tooltiptext = null;
                        }
                    },
                    onClick: function onClick() {
                        loginManager.reset();
                    }
                })

            ];
        },

        onClick: function onClick() {
            var session = sessions.get(window, null);
            if (session) {
                setWindowValue(window, 'coopfox-active', false);
                session.destroy();
            } else {
                let messages = getWindowValue(window, 'coopfox-thread-messages', null);
                if (messages) {
                    let lastMessage = null;
                    while (messages.length) {
                        lastMessage = messages.pop();
                        if (lastMessage.body && lastMessage.body.$text) {
                            break;
                        } else {
                            lastMessage = null;
                        }
                    }
                    let confirmMessage = 'You have started a CoopChat session in this window before.';
                    if (lastMessage) {
                        let lastMessageDate = new Date(lastMessage.$timestamp);
                        confirmMessage += '\nLast Message: ' +
                            '"' + lastMessage.body.$text.substr(0, 30) + '..." ' +
                            '[' + lastMessage.$from.bare + ', ' + lastMessageDate.toLocaleFormat('%b %d, %H:%M') + ']';
                    }

                    let choice = dialogs.confirmEx(
                        'Saved Session',
                        confirmMessage,
                        'Continue CoopChat',
                        'Cancel',
                        'Start New CoopChat (Delete Existing)'
                    );
                    switch (choice) {
                        case 1:
                            return;
                        case 2:
                            clearWindowValues(window);
                            break;
                    }
                }
                setWindowValue(window, 'coopfox-active', true);
                browserWindows.emit('windowOpen', window);
            }
        },

        onDestroy: function onDestroy() {
            for each (let item in menuItems) {
                item.destroy();
            }
            toolbarButtons.delete(window);
        }
    });
    toolbarButtons.set(window, button);
}

function updateToolbarButton(window) {
    var button = toolbarButtons.get(window, null);
    if (!button) { return; }

    var name = 'icon';
    var session = sessions.get(window, null);
    if (session === null) {
        name += '-disabled';
        if (xmpp.isConnected()) {
            name += '-connected';
        }
    }
    if (xmpp.isConnected()) {
        button.tooltiptext = 'CoopFox (' + xmpp.rosterSelf.jid.full + ')';
    } else {
        button.tooltiptext = 'CoopFox (Disconnected)';
    }
    button.image = self.data.url('images/' + name + '.png');
}
function updateToolbarButtons() {
    for each (let window in browserWindows.getAllWindows()) {
        updateToolbarButton(window);
    }
}
xmpp.on('xmppConnected', updateToolbarButtons);
xmpp.on('xmppDisconnected', updateToolbarButtons);


var firstRun = false;

exports.main = function main(options, callbacks) {

    console.info('CoopFox Extension Startup (' + options.loadReason + ')');

    if (options.loadReason === 'install') {
        firstRun = true;
    }

    xmpp.sysEmit('coopfox-xmpp-available');
    xmpp.once('BeforeDestroy', function() {
        xmpp.sysEmit('coopfox-xmpp-shutdown');
    });

    browserWindows.enable();

    if (prefs.alwaysConnected || staticArgs.alwaysConnected) {
        xmpp.connect();
    }

    simplePrefs.on('alwaysConnected', function() {
        xmpp.autoDisconnect = !prefs.alwaysConnected && !staticArgs.alwaysConnected;
        if (xmpp.autoDisconnect && !xmpp.threadCount) {
            xmpp.disconnect();
        } else {
            xmpp.connect();
        }
    });

};

exports.onUnload = function onUnload(reason) {
    console.info('CoopFox Extension Shutdown (' + reason + ')');
    browserWindows.disable();
    if ((reason === 'uninstall') || (reason === 'disable')) {
        console.info('Clearing CoopFox Installation Data...');
        loginManager.reset();
        for each (let key in Object.keys(storage)) {
            delete storage[key];
        }
    }
};