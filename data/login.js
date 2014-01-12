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

jQuery(function($){

    const jidPattern = /^[a-z0-9._-]+@([a-z0-9.-]+\.[a-z]{2,4})$/i;
    const ipPattern = /^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;
    const hostPattern = /^(([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])\.)*([a-z0-9]|[a-z0-9][a-z0-9\-]*[a-z0-9])$/i;

    var params = window.dialogArguments ? (window.dialogArguments[0] || {}) : ((window.arguments || {})[0] || {});
    var login = window.dialogArguments ? (window.dialogArguments[1] || {}) : ((window.arguments || {})[1] || {});
    if ( params.wrappedJSObject) { params = params.wrappedJSObject; }
    if (login.wrappedJSObject) { login = login.wrappedJSObject; }

    $('#accordion').accordion({
        heightStyle: 'auto'
    })
    .on('accordionactivate', function(event, ui){
        ui.newPanel.find('input').first().focus();
    });


    const $xmppForm = $('#xmpp form');
    const $store = $('input[name="store"]');

    $('#xmpp *[name]').each(function() {
        let val = params.default[this.name];
        if (val) {
            $(this).val(val);
        }
    });
    $store.prop('checked', params.store || false);

    if (params.google) {
        $('#google-email').val(params.google.username || '');
        $('#google-password').val(params.google.password || '');
    }
    if (params.facebook) {
        $('#facebook-username').val(params.facebook.username || '');
        $('#facebook-password').val(params.facebook.password || '');
    }

    $xmppForm.submit(function(event) {
        event.preventDefault();

        if (!jidPattern.test(this.jid.value)) {
            alert('The JID you entered is not correctly formatted.');
            return;
        }
        if (!hostPattern.test(this.hostname.value) && !ipPattern.test(this.hostname.value)) {
            alert('The host name or IP address you entered is not correctly formatted.');
            return;
        }
        var port = parseInt(this.port.value);
        if (port < 64 || port > 49151) {
            alert('The port number you entered is invalid.');
            return;
        }

        login.jid = this.jid.value;
        login.password = this.password.value;
        login.hostname = this.hostname.value;
        login.port = this.port.value;
        login.security = this.security.options[this.security.selectedIndex].value;
        params.store = !!this.store.checked;
        params.submit = true;

        window.close();
    });

    $('#google form').submit(function(event) {
        event.preventDefault();
        $('#xmpp-jid').val(this.email.value);
        $('#xmpp-password').val(this.password.value);
        $('#xmpp-hostname').val('talk.google.com');
        $('#xmpp-port').val('5222');
        $('#xmpp-security').val('starttls_required');
        $xmppForm.submit();
    });

    $('#facebook form').submit(function(event) {
        event.preventDefault();
        $('#xmpp-jid').val(this.username.value.replace(/@.*$/, '') + '@chat.facebook.com');
        $('#xmpp-password').val(this.password.value);
        $('#xmpp-hostname').val('chat.facebook.com');
        $('#xmpp-port').val('5222');
        $('#xmpp-security').val('starttls_required');
        $xmppForm.submit();
    });

    $('#xmpp-jid').focus().change(function() {
        var match = this.value.match(jidPattern);
        if (match && match[1]) {
            let $hostname = $('#xmpp-hostname');
            if (!$hostname.val()) {
                $hostname.val(match[1]);
            }
        }
    });

    $store.click(function() {
        $store.prop('checked', this.checked);
    });

    //TODO: use known logins in params.logins for autocomplete / dropdown select

});