# Screenshot Note Context (Chrome extension)

Adds what a screenshot cannot show to Screenshot Note captures from the browser:

- console output, uncaught errors and unhandled rejections,
- network traffic as HAR 1.2 (opens in Chrome DevTools),
- a map of visible page elements with CSS selectors, so an element can be picked and described in the annotation editor.

The extension keeps a short in-memory buffer per tab. When the Mac app takes a screenshot of a browser window, it asks the extension over Native Messaging for the last couple of minutes. Cookies, auth headers and tokens in URLs, headers and bodies are redacted before data leaves the browser. Console arguments are redacted on a best-effort basis (URLs, auth values, sensitive JSON keys). What is redacted is chosen per folder in the Mac app.

- [Protocol and Mac integration](docs/PROTOCOL.md)
- [Privacy and redaction](docs/PRIVACY.md)
- [Chrome Web Store](docs/STORE.md)

## Development

Requires Node 23.6 or later.

```sh
npm install
npm run check      # typecheck, unit tests, build
npm run watch      # rebuild on change
npm run package:store  # zip for the Chrome Web Store, without the dev `key`
```

Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked. The popup can download the context of the current tab without the Mac app.

### End-to-end without the Mac app

```sh
./dev-host/install.sh <extension-id>     # ID from chrome://extensions
# Reload the extension, the popup should show "Connected".
# host.pid exists only while the host runs, so the signal never hits another process.
kill -USR1 "$(cat ~/Downloads/screenshot-note-dev/host.pid)"
ls ~/Downloads/screenshot-note-dev       # capture-*.json and capture-*.har
```

`SN_BODIES=1` in the host environment asks for bodies (the popup switch "Record response bodies" must be on). The real app installs its own host manifest under the same name and replaces the dev one.

## Known limitations

- The content script runs only in the top frame. Console and fetch/XHR of iframes are not recorded.
- Requests answered by the page's service worker have no webRequest headers. They appear in the HAR only from the page recorder (`_source: "page"`).
- The MAIN world recorder and the content script exchange a `MessageChannel` at `document_start`, before page scripts run, so a page cannot forge entries or read settings. Tabs that were open before recording was switched on get the recorder later, and there the page can see the handshake. It can then forge only its own entries; entries are validated and size-limited.
- The page recorder (patched `fetch`, XHR and `console`) is present only while recording is on. After switching off, it stays in already loaded pages until reload, but sends nothing.
- Console output logged before the content script loads (very early inline scripts) can be lost.

## License

[MIT](LICENSE)
