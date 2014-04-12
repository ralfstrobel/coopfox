# CoopFox - Collaborative Web Browsing
Copyright &copy; 2014 Ralf Strobel

The Firefox extension in this repository was developed as part of my master's thesis at the [Cooperative Media Lab, University of Bamberg, Germany](https://cml.hci.uni-bamberg.de/Cooperative+Media+Lab).

All content is no longer maintained and is made available purely for archival and educational purposes, subject to the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/).

The included [thesis copy](doc/CoopFox_Thesis_2014_CC.pdf) is NOT subject to the MPL license, but instead made available under a [Creative Commons BY-NC-ND 4.0 International License](http://creativecommons.org/licenses/by-nc-nd/4.0/).

## Directory Overview ##

* lib (backend code, privileged CommonJS with access to low level browser functionality)
  * modules (modular backend business logic of concrete CoopFox features)
  * xmpp (XMPP client implementation)
  * browser (utility code for modification of the browser GUI)
  * utils (general utility code, e.g. for string and DOM manipulation)
* data (frontend code, standard HTML/JS which displays the CoopFox sidebar GUI)
  * modules (modular frontend business logic, connected to the backend via event APIs) 

## Installation ##

* Use the Mozilla Add-on SDK to build the extension as a cross-platform installer module (xpi) file.
* Use the "Install from File" option in the addon-manager and select the local XPI file.
* Confirm the security warning dialog.
* All done! A browser restart is not required.

## First Steps ##

The CoopFox *toolbar button* should have appeared on the far right next to your address bar. By clicking it you can toggle the CoopFox sidebar on and off for each browser window individually. Each sidebar contains its own CoopFox session, so that you can cobrowse with multiple groups simultaneously, or use additional windows for private browsing.

The first time you activate CoopFox, you will be prompted to enter *login credentials* for an XMPP instant messaging server to use for communication. This service is not provided by CoopFox. You can use any standard XMPP server for this purpose, though CoopFox has only been tested with [OpenFire](http://www.igniterealtime.org/projects/openfire/).

By default, CoopFox disconnects from XMPP while the sidebar is inactive. You can tell CoopFox to stay logged in at all times in the dropdown menu attached to the toolbar button. This way you remain available for incoming sessions from your contacts even while CoopFox is not active.

You can add contacts and change your status via the respective entries in the menu in the top right corner of the contact list. You can rename or remove participants by right-clicking them and choosing the respective option from the context menu.

## Beginning Collaboration ##

As soon as you activate CoopFox for a browser window, you automatically begin a collaborative session (CoopChat), though you are the only participant at first. You can begin your web research and invite more participants later. They will still see everything you have done so far.

To invite another participant, double-click on any person in your contact list who is online and also using CoopFox (indicated by the CoopFox icon in the contact list). CoopFox will ask you whether to begin a private chat or send an invitation for a joint CoopChat. The private chat works just like a regular instant messenger, so you can use it to ask people about their readiness before inviting them.

The invited person receives a notification, asking whether to open your CoopChat in a new browser window or, if the other person has also already started a CoopChat, merge both sessions into one. This way two people can begin research independently and then combine their results.

## Navigating the Web Together ##

You can always see web page each session participant is looking at in the form of a link and page logo underneath the entry in your contact list. A blinking green arrow left of the entry indicates that this person is looking at the same page as you. If the arrow is unfilled and not blinking, this person has already seen your page before but is not currently here.

You can see the web page each chat message was written on via the small symbols on the left side of the chat. Hovering the mouse on top of the icon reveals the full page title. You can also jump to the page by clicking the icon.

Links in web pages show a little green checkmark in the colour of another participant, if this person has already seen the target page of the link.

## Discussing Web Page Content ##

If you and another session participant are looking at the same page, you can point to any text content simply by selecting it with the mouse. The other person sees your selection in your colour.

You can quote text from any web page permanently in the CoopChat, by selecting it, right-clicking on the selection and choosing "Direct-Quote in CoopChat" from the context menu (alternative: hold the Alt-key while selecting). The text is highlighted in your colour and posted to the chat as a link which leads directly to the quoted passage. 

## Collecting Results ##

You can collect any chat history entries in a separate result-list, by right clicking them and choosing "Add to Results". They appear in a separate tab next to the CoopChat, where you can also sort them by increasing or decreasing their priority via the +/- buttons.

## Saving Your Progress ##

CoopChat sessions are automatically saved in context of their browser windows. If you close a window and restore it later, the session is restored as well. If two former participants restore a session at the same time, they are also instantly in contact again.

Alternatively you can save the session to a file (.cfox) via the session menu in the top right corner of the lower half of the CoopFox sidebar.