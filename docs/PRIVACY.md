# Privacy and redaction

This document describes what the extension records, where it keeps it and how it is redacted. The user-facing privacy policy is in [STORE.md](STORE.md).

## What is recorded and where it lives

- Console messages, errors and fetch/XHR records live in the memory of the tab's content script. They are discarded on navigation.
- webRequest records (URLs, headers including cookies, status codes, timing) live in the service worker and in `chrome.storage.session`. Session storage is in memory: it survives a worker restart but not a browser restart. Nothing is written to disk.
- The buffer is limited by time (5 minutes by default), by count (2000 page entries, 500 requests per tab) and by size (page entries at most 8 Mi characters of JSON, webRequest records at most 4 Mi characters per tab). Closing the tab deletes it.
- Page entries are validated. Unknown kinds and fields with a wrong type are dropped, timestamps are capped at "now" and texts are shortened (console argument 4000 characters, at most 50 arguments, message and stack 16 000 characters, URL 8000 characters, body 256 KiB). An event longer than 4 Mi characters is dropped as a whole.
- Request and response bodies are recorded only while the body switch in the popup is on. Without it the extension does not ask webRequest for bodies and the content script drops them. Only text responses are read, at most 256 KiB each, and reading is cancelled after the limit or after 30 s. Streams (`text/event-stream`, ndjson) are never read. A webRequest request body (including form data) over 64 KiB is replaced with a marker.
- webRequest sees requests from all frames of the tab, including cross-origin iframes (for example payment widgets).
- Switching bodies off deletes all stored bodies immediately.
- Switching recording off deletes all buffers immediately.
- Entries older than the configured window are pruned on the next entry in the tab and, from session storage, when the service worker wakes up. An idle tab keeps them in memory until the worker is suspended.
- The extension cannot run in incognito windows (`"incognito": "not_allowed"`), and incognito tabs are never exported.

## Redaction

Redaction runs inside the extension on export (`src/lib/redact.ts`). The Mac app can only add redaction through `CapturePolicy`. It cannot switch the defaults off: cookie values and authorization headers are always hidden, and the default lists of headers, query parameters and body keys always apply. Bodies leave the browser only while the popup switch is on. A direct `tabId` from the host is accepted only for an active tab, so the host cannot ask for an arbitrary background tab.

- Cookie values (`Cookie`, `Set-Cookie`) are always hidden. Names stay.
- Authorization headers (`Authorization`, `X-Api-Key`, CSRF and similar) are always hidden. On top of the exact list, every header and query parameter is hidden when its name contains `token`, `secret`, `key`, `auth`, `session`, `csrf`, `signature`, `credential`, `password`, `pass`, `pwd`, `otp`, `jwt`, `assertion`, `oidc`, `principal`, `appcheck` or `dpop` (for example `PRIVATE-TOKEN`, `X-Amz-Signature`). This also catches harmless names such as `keyword` or `author`, on purpose. Exceptions are `Keep-Alive`, `Access-Control-Allow-Credentials`, `WWW-Authenticate` and `Proxy-Authenticate`.
- Sensitive query parameters (token, code, key and others) are always hidden. The same applies to parameters in the URL fragment (`#access_token=…`, `#/path?token=…`) and to URLs in the `Location`, `Referer`, `Origin`, `Content-Location` and `Refresh` headers and in `redirectURL`. URLs in stack traces, error messages and network errors are redacted too. A URL nested inside a parameter value (`redirect_uri=…`) is not redacted again yet.
- Bodies (optional): keys containing `pass`, `secret`, `token`, `otp`, `card`, `auth`, `key`, `session` and similar are hidden in JSON, form data and multipart. Truncated or unparsable bodies are replaced with `[body omitted: …]`; raw text is never sent. JSON nested deeper than 3 levels and broken nested JSON are replaced with `[nested value omitted]`. Matching on part of a key also hides harmless keys (`author`, `monkey`), on purpose. Values inside a GraphQL query string (`login(password: "…")`) are not redacted.
- Element map (optional texts): without element texts the accessible name (`aria-label`, `title`, `alt`, `placeholder`) is omitted as well. Values of `password` fields never reach the element map.

Objects in console arguments have sensitive keys hidden already in the page, including nested objects, arrays and JSON stored in a string. Console arguments, error messages and stacks are then scanned for URLs, `Bearer`/`Basic`/`Token` values and `"key": value` pairs with a sensitive key. Free text without structure (`the password is hunter2`), JSON with single quotes or JSON in the middle of a sentence cannot be recognized. The main decision about the console is therefore whether to include it at all. Broken nested JSON with keys is dropped as a whole, even when it holds no secret.

## After export

The extension sends the bundle only to the local native host. What happens next is decided by the Mac app: by default context is saved for local folders and switched off for cloud folders. Attachments uploaded to the cloud are not end-to-end encrypted yet.

## Permissions

`<all_urls>`, `webRequest`, `scripting`, `storage`, `nativeMessaging`. Broad host access is needed to record on any site the user is debugging. `tabs` is not needed, because `<all_urls>` already gives the URL and title of tabs. `scripting` registers the MAIN world recorder only while recording is on and adds it to tabs that were already open when recording was switched on. Justifications for the Chrome Web Store are in [STORE.md](STORE.md).
