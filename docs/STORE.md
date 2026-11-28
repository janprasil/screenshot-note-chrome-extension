# Chrome Web Store listing

## Release steps

Steps 1–3 are done: the item ID is `ncpmdpnmhemklklkakeonmkhoclfngjk`.

1. Create the item in the Developer Dashboard and upload the output of `npm run package:store` (a zip without `key`).
2. The Store assigns the extension ID. Put its public key (Package → Public key) into `src/manifest.json` as `key`, so the development build has the same ID as the Store build.
3. The Mac app and `dev-host/install.sh` list only that ID in `allowed_origins`. Remove the old development ID.
4. Publish the privacy policy at a public URL and link it in the Dashboard.
5. Fill in Privacy practices as described below.

## Single purpose

Attach the browser context (console messages, network requests and a map of visible page elements) of the current tab to screenshots taken with the Screenshot Note Mac app, so bugs can be reported with the technical details developers need.

## Permission justifications

- **Host permissions `<all_urls>`**: The user can take a screenshot of any website. The extension must record console and network activity on whichever site the user is debugging, before the screenshot is taken.
- **webRequest**: Records request metadata (URL, method, status, timing, headers) of the current tab into a short in-memory buffer. Header values of cookies and authorization headers are redacted before export. Requests are only observed, never blocked or modified.
- **scripting**: Registers the page recorder (console and fetch/XHR) only while recording is switched on, and adds it to already open tabs when the user switches recording on.
- **nativeMessaging**: Sends the redacted context to the locally installed Screenshot Note Mac app when the user takes a screenshot. The extension talks only to its own native host.
- **storage**: Stores the user's settings (recording on/off, body recording, buffer length) and keeps the network buffer in session storage (memory only) across service worker restarts.

Remote code: none. All code is bundled in the package.

## Privacy practices (Dashboard)

Data collected: Web history (URLs of requests on the current tab), Website content (console messages, optional request/response bodies, texts of visible page elements), Authentication information (cookie names and header names; values are redacted).

Certify: data is not sold, not used for purposes unrelated to the single purpose, not used for creditworthiness or lending.

## Privacy policy (draft)

**Screenshot Note Context: Privacy Policy**

Screenshot Note Context ("the extension") helps you attach technical context to screenshots taken with the Screenshot Note app.

*What the extension records.* While recording is switched on, the extension keeps a short rolling buffer (1 to 10 minutes, set by you) of the current tab's console messages, uncaught errors, network request metadata and, only if you switch it on, request and response bodies of text and JSON requests. When a screenshot is taken it also records a map of visible page elements (selectors, positions, accessible names and texts).

*Where the data stays.* The buffer lives in your browser's memory. It is never written to disk by the extension and is discarded when you close the tab, navigate away, switch recording off, or after the buffer period expires.

*Redaction.* Before any data leaves the browser, the extension redacts cookie values, authorization headers, tokens and other sensitive URL parameters, sensitive fields in request and response bodies (for example passwords, tokens, card numbers) and recognizable secrets in console messages. Redaction is best effort; free text that does not look like a secret cannot be detected.

*Where the data goes.* The extension sends the redacted context only to the Screenshot Note app installed on your Mac, and only when a screenshot is taken or when you download the context yourself from the extension popup. The extension itself does not send data to any server. If you save the screenshot to a Screenshot Note cloud folder, the Screenshot Note app uploads the context together with the screenshot according to that folder's settings; that upload is covered by the privacy policy of the Screenshot Note cloud, operated by Performance4 s.r.o.

*What we do not do.* We do not sell data, use it for advertising, or share it with third parties.

*Contact.* [TODO: contact address]
