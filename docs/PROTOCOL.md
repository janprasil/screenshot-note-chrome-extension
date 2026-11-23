# Extension ↔ Screenshot Note protocol (v1)

Contract between this extension and the Screenshot Note macOS app.

## Architecture

```text
Chrome tab ──(MAIN world: inject.js)── console, errors, fetch/XHR
     │                                     │ MessageChannel (JSON text)
     └─(isolated: content.js) ring buffer ◄┘, element map, geometry
                │ chrome.tabs.sendMessage
background.js ── webRequest ring buffer per tab, redaction, HAR, bundle
                │ Native Messaging (stdio, 4-byte LE length + JSON)
screenshot-note-bridge (helper inside the app bundle)
                │ Unix socket ~/Library/Application Support/Screenshot Note/bridge.sock
Screenshot Note.app ── attaches the context to the screenshot
```

- Only the extension can open a Native Messaging connection. It therefore connects on startup and keeps the port open. The open port also keeps the service worker alive.
- The bridge must run even when the app is not running. It reconnects to the app socket every 2 s. If the bridge exits, the extension reconnects with a backoff from 5 s to 5 min.

## Host registration

- Name: `cz.janprasil.screenshotnote.bridge`.
- The app installs the manifest `<name>.json` (when the feature is switched on) into:
  - Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
  - Chrome Beta/Canary: `…/Google/Chrome Beta|Chrome Canary/NativeMessagingHosts/`
  - Edge: `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/`
  - Brave: `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/`
  - Arc: `~/Library/Application Support/Arc/User Data/NativeMessagingHosts/`
  - Chromium: `~/Library/Application Support/Chromium/NativeMessagingHosts/`
  - It writes only where the browser's Application Support directory exists.
- `allowed_origins` contains only the Chrome Web Store extension ID and the development build ID.
- Development build ID: `hffkngdjiopodemokmgiedickoiehidb` (fixed by `key` in `src/manifest.json`; the private key is not in the repository).
- `path` points to `Screenshot Note.app/Contents/MacOS/screenshot-note-bridge`. The manifest is rewritten when the app moves.
- `dev-host/` provides a host for development (see README).

## Messages

Extension → host:

| type | fields | meaning |
|---|---|---|
| `hello` | `protocol`, `extensionVersion`, `browser` | sent after connecting |
| `pong` | `id`, `protocol`, `enabled` | reply to `ping` |
| `capture.result` | `id`, `bundle` | result, format below |
| `capture.error` | `id`, `code`, `message` | `disabled`, `no-tab`, `too-large`, `internal` |

Host → extension:

| type | fields | meaning |
|---|---|---|
| `hello` | `protocol`, `app?: {version, running}` | confirms the connection |
| `ping` | `id` | availability check |
| `capture.request` | `id`, `policy?`, `target?` | asks for context |

`target` (all optional):
- `windowBounds: {x, y, width, height}`: the browser window from `CGWindowListCopyWindowInfo` in points, origin top left. The extension matches it against `chrome.windows` with a tolerance of 8 points.
- `windowTitle`: fallback match on the title of the active tab.
- `tabId`: direct choice (reserve). Accepted only for the active tab of a window. Otherwise the whole `target` is ignored.
- Without a match, the last focused window is used.

`policy` (`CapturePolicy`) is set by the app. Missing fields get the defaults from `src/lib/defaults.ts`. The policy can only add redaction, never remove it:
- `redactCookies` and `redactAuthHeaders` are always `true`, whatever the host sends.
- `redactHeaders`, `redactQueryParams` and `redactBodyKeys` from the host are added to the defaults.
- `includeBodies` applies only while the user has body recording switched on in the popup.
- Fields with a wrong type are ignored and the default is used.
- The bundle's `policy` holds what was actually applied.

| field | default | |
|---|---|---|
| `includeConsole` / `includeNetwork` / `includeElements` | `true` | |
| `includeBodies` | `false` | only with the popup body switch on |
| `includeElementText` | `true` | element texts in the element map |
| `redactCookies` | `true` | always on; cookie names stay, values are hidden |
| `redactAuthHeaders` | `true` | always on; `Authorization`, `X-Api-Key`, CSRF and every header whose name matches `SENSITIVE_NAME_PATTERN` in `src/lib/defaults.ts` (`token`, `secret`, `key`, `auth`, `session`…), except `Keep-Alive`, `Access-Control-Allow-Credentials`, `WWW-Authenticate`, `Proxy-Authenticate`; the scheme (`Bearer`) stays |
| `redactHeaders` | `[]` | extra headers to hide, added |
| `redactQueryParams` | token, code, key, jwt, sid… | added to the defaults; plus every parameter whose name matches the header pattern; also applies to URL fragments and the `Location`, `Referer`, `Origin`, `Content-Location` headers |
| `redactBodyKeys` | password, token… | added to the defaults; plus always keys containing `pass`, `pwd`, `secret`, `token`, `otp`, `cvv`, `card`, `auth`, `key`, `session` (case insensitive) |
| `maxBodyBytes` | 64 KiB | |
| `windowMs` | 2 min | how far back to look |

Bodies are redacted by key in JSON, form-urlencoded and multipart (per field, files as `[file]`), including nested JSON. A body that was truncated or cannot be parsed (text, HTML, XML, broken JSON, a bare token) is replaced with `[body omitted: truncated]` or `[body omitted: unparsed]`. `maxBodyBytes` truncates the redacted result.

The reply should arrive within 300 ms. The app waits at most 1 s and then saves the screenshot without context.

The app sends the request to every connected browser with `protocol` 1. It accepts only a bundle whose `page.geometry` (`screenX`, `screenY`, `outerHeight` scaled by `windowBounds.width / outerWidth`) matches `windowBounds` within 8 points, and treats other replies as declines. A bundle without `geometry` is rejected when `windowBounds` was given.

## Bundle

```jsonc
{
  "format": "screenshot-note-context", "version": 1,
  "capturedAt": "ISO", "extensionVersion": "0.1.0",
  "page": { "url", "title", "userAgent", "language", "geometry": { … } },
  "policy": { … },                 // what was actually applied
  "summary": { "consoleErrors", "consoleWarnings", "uncaughtErrors", "failedRequests": [ … ], "requestCount" },
  "console": [ ConsoleEntry | ErrorEntry ],
  "har": { "log": { … } },          // HAR 1.2, opens in DevTools
  "elements": [ { "selector", "tag", "role?", "name?", "text?", "rect": {x,y,width,height}, "depth" } ],
  "trimmed": { "bodies", "network", "console", "elements", "largeBodies?" }  // only for a reduced bundle
}
```

Redaction happens in the extension before sending. Unredacted data never leaves the extension.

### Size limits

- The bundle has a hard cap of 16 MiB in UTF-8 bytes (`MAX_BUNDLE_BYTES` in `src/lib/capture.ts`).
- When it is larger, the extension reduces it: first it drops bodies from the largest (replaced with `[body omitted: size limit]`, counted in `trimmed.largeBodies`), and if that is not enough, all bodies. Then the oldest network and console entries by a shared time cutoff, and only if it still does not fit, elements. A reduced bundle has `trimmed: {bodies, network, console, elements, largeBodies?}` (whether all bodies were dropped and how many entries were dropped) and the actual `includeBodies` in `policy`. `summary` always describes the full, unreduced data.
- When it does not fit even without entries (for example a huge page title), the reply is `capture.error` with code `too-large`.
- Native Messaging: the bridge rejects extension → host messages over 64 MiB, and the app socket has the same limit. Host → extension messages over 1 MiB are dropped (Chrome's limit). The 16 MiB cap is below both.
- The content script keeps at most 8 Mi characters of page entries, a single event at most 4 Mi characters.

## Mapping elements onto the screenshot

The extension sends `rect` in CSS pixels of the viewport and `geometry`. The app knows the screenshot rectangle `R` (global points) and the screen's `backingScale`.

```text
zoom        = geometry.devicePixelRatio / backingScale      // page zoom
contentLeft = geometry.screenX * zoom                       // macOS has no side borders
contentTop  = (geometry.screenY + geometry.outerHeight) * zoom - geometry.innerHeight * zoom
screenRect  = (contentLeft + x*zoom, contentTop + y*zoom, width*zoom, height*zoom)
imageRect   = (screenRect - R.origin) * imageScale
```

- `backingScale` is the scale of the display holding most of the browser window (Chrome reports `devicePixelRatio` for it), not necessarily the display of the screenshot.
- When the app knows the browser window from WindowServer, it uses it instead of `screenX` and `outerHeight`: `contentLeft = window.x`, `contentTop = window.maxY - innerHeight * zoom`.
- DevTools docked at the bottom or a side panel break the calculation. The app can use the `AXWebArea` of the browser window from the Accessibility API, which has the exact content position.
- Pinch zoom: `x' = (x - visualViewport.offsetLeft) * visualViewport.scale`, the same for y.
- Elements are clipped to the viewport; empty ones and those fully outside are skipped. `devicePixelRatio` 0 (fallback geometry without a content script) means no element map.
- Test page: `docs/test-pages/element-map.html`.
