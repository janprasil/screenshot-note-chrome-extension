# Contributor and agent guide

Screenshot Note Context is a Manifest V3 Chrome extension. It records console, network and page element context for the current tab and hands a redacted bundle to the Screenshot Note Mac app over Native Messaging.

## Before you change code

- Read `README.md`, `docs/PROTOCOL.md` and `docs/PRIVACY.md`.
- `docs/PROTOCOL.md` is the contract with the Mac app. Keep message and bundle changes backward compatible, or bump `PROTOCOL_VERSION` in `src/lib/defaults.ts`.
- Update `docs/PRIVACY.md` whenever you change what is recorded, how long it is kept or how it is redacted.

## Privacy rules

- Redact inside the extension before data leaves the browser. Never send unredacted data to the native host and never write it to disk.
- The capture policy from the host may only add redaction. It must never switch off the defaults in `src/lib/defaults.ts`.
- Request and response bodies are recorded only while the user has the popup switch on.
- Treat everything coming from a web page (MAIN world messages, DOM, console arguments) as untrusted. Validate types and cap sizes.
- Keep the permission set minimal. A new permission needs a justification in `docs/STORE.md`.

## Code layout

- `src/background.ts`: service worker, webRequest buffer, native messaging, capture.
- `src/content.ts`: isolated world, page entry buffer, element map.
- `src/inject.ts`: MAIN world recorder (console, errors, fetch, XHR). Registered only while recording is on.
- `src/lib/`: redaction, HAR, bundle assembly, ring buffer, selectors.
- `tests/`: Node test runner with a fake `chrome` API (`tests/fake-chrome.ts`).
- `dev-host/`: a native host for end-to-end testing without the Mac app.

## Workflow

- Run `npm run check` (typecheck, tests, build) before every commit.
- Add a test for every redaction or size limit change.
- Write code comments as short sentences in English.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`).
