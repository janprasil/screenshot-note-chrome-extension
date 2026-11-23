# Screenshot Note Context (Chrome extension)

Adds what a screenshot cannot show to Screenshot Note captures from the browser:

- console output, uncaught errors and unhandled rejections,
- network traffic as HAR 1.2 (opens in Chrome DevTools),
- a map of visible page elements with CSS selectors, so an element can be picked and described in the annotation editor.

The extension keeps a short in-memory buffer per tab. When the Mac app takes a screenshot of a browser window, it asks the extension over Native Messaging for the last couple of minutes. Cookies, auth headers and tokens in URLs, headers and bodies are redacted before data leaves the browser. Console arguments are redacted on a best-effort basis (URLs, auth values, sensitive JSON keys). What is redacted is chosen per folder in the Mac app.

- [Protocol and Mac integration](docs/PROTOCOL.md)
- [Privacy, redaction and encryption](docs/PRIVACY.md)
- [Plan](docs/PLAN.md)

## Development

Requires Node 23.6 or later.

```sh
npm install
npm run check      # typecheck, unit tests, build
npm run watch      # rebuild on change
```

Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked. The popup can download the context of the current tab without the Mac app.

### End-to-end without the Mac app

```sh
./dev-host/install.sh <extension-id>     # ID from chrome://extensions
# Reload the extension, the popup should show "Connected".
kill -USR1 "$(cat ~/Downloads/screenshot-note-dev/host.pid)"
ls ~/Downloads/screenshot-note-dev       # capture-*.json and capture-*.har
```

`SN_BODIES=1` in the host environment asks for bodies (the popup switch "Record response bodies" must be on). The real app installs its own host manifest under the same name and replaces the dev one.
