# Protokol rozšíření ↔ Screenshot Note (v1)

Kontrakt mezi tímto rozšířením a macOS aplikací `screenshot-note`. Rozšíření je
hotové podle tohoto dokumentu, Mac strana (bridge, poskytovatel kontextu, anotace
elementu) zatím chybí.

## Architektura

```text
Chrome tab ──(MAIN world: inject.js)── console, errors, fetch/XHR
     │                                     │ CustomEvent (JSON)
     └─(isolated: content.js) ring buffer ◄┘, element map, geometry
                │ chrome.tabs.sendMessage
background.js ── webRequest ring buffer per tab, redakce, HAR, bundle
                │ Native Messaging (stdio, 4B LE délka + JSON)
screenshot-note-bridge (helper v bundlu appky)
                │ Unix socket ~/Library/Application Support/Screenshot Note/bridge.sock
Screenshot Note.app ── ContextProvider → přílohy ke snímku
```

- Native Messaging umí spojení navázat jen rozšíření. Proto se rozšíření připojí
  hned při startu a spojení drží. Otevřený port zároveň drží service worker naživu.
- Bridge musí běžet, i když appka neběží. Na socket appky se připojuje znovu
  každé 2 s. Pokud skončí, rozšíření se připojí znovu s backoffem 5 s → 5 min.

## Registrace hostu

- Název: `cz.janprasil.screenshotnote.bridge`.
- Manifest `<název>.json` instaluje appka (při zapnutí funkce) do:
  - Chrome: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`
  - Chrome Beta/Canary: `…/Google/Chrome Beta|Chrome Canary/NativeMessagingHosts/`
  - Edge: `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/`
  - Brave: `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/`
  - Arc: `~/Library/Application Support/Arc/User Data/NativeMessagingHosts/`
  - Chromium: `~/Library/Application Support/Chromium/NativeMessagingHosts/`
  - Zapisuje se jen tam, kde adresář prohlížeče v Application Support existuje.
- `allowed_origins` obsahuje jen ID rozšíření z Chrome Web Store a ID vývojového buildu.
- ID vývojového buildu: `hffkngdjiopodemokmgiedickoiehidb` (pevné díky `key` v `src/manifest.json`).
  Privátní klíč je mimo repo v `~/.config/screenshot-note/chrome-extension-dev.pem`. ID z Chrome Web Store zatím není.
- `path` míří na `Screenshot Note.app/Contents/MacOS/screenshot-note-bridge`. Po přesunutí appky se manifest přepíše.
- Pro vývoj existuje `dev-host/` (viz README).

## Zprávy

Rozšíření → host:

| type | pole | význam |
|---|---|---|
| `hello` | `protocol`, `extensionVersion`, `browser` | posílá se po připojení |
| `pong` | `id`, `protocol`, `enabled` | odpověď na `ping` |
| `capture.result` | `id`, `bundle` | výsledek, formát viz níže |
| `capture.error` | `id`, `code`, `message` | `disabled`, `no-tab`, `internal` |

Host → rozšíření:

| type | pole | význam |
|---|---|---|
| `hello` | `protocol`, `app?: {version, running}` | potvrzení spojení |
| `ping` | `id` | kontrola dostupnosti |
| `capture.request` | `id`, `policy?`, `target?` | žádost o kontext |

`target` (vše volitelné):
- `windowBounds: {x, y, width, height}`: okno prohlížeče z `CGWindowListCopyWindowInfo` v bodech, počátek vlevo nahoře. Rozšíření ho porovná s `chrome.windows` s tolerancí 8 bodů.
- `windowTitle`: záložní shoda podle titulku aktivní záložky.
- `tabId`: přímé určení (rezerva).
- Bez shody se použije naposledy fokusované okno.

`policy` (`CapturePolicy`) nastavuje Mac appka podle složky nebo konfigurace. Chybějící pole doplní výchozí hodnoty (`src/lib/defaults.ts`):

| pole | výchozí | |
|---|---|---|
| `includeConsole` / `includeNetwork` / `includeElements` | `true` | |
| `includeBodies` | `false` | těla jen pokud je rozšíření nahrává |
| `includeElementText` | `true` | texty prvků v mapě elementů |
| `redactCookies` | `true` | jména cookies zůstanou, hodnoty se skryjí |
| `redactAuthHeaders` | `true` | `Authorization`, `X-Api-Key`, CSRF…; schéma (`Bearer`) zůstane |
| `redactHeaders` | `[]` | vlastní hlavičky ke skrytí |
| `redactQueryParams` | token, code, key… | |
| `redactBodyKeys` | password, token… | JSON a form-urlencoded |
| `maxBodyBytes` | 64 KiB | |
| `windowMs` | 2 min | jak daleko do minulosti |

Odpověď by měla dorazit do 300 ms. Appka čeká nejvýš 1 s a pak uloží snímek bez kontextu.

## Bundle

```jsonc
{
  "format": "screenshot-note-context", "version": 1,
  "capturedAt": "ISO", "extensionVersion": "0.1.0",
  "page": { "url", "title", "userAgent", "language", "geometry": { … } },
  "policy": { … },                 // co se skutečně použilo
  "summary": { "consoleErrors", "consoleWarnings", "uncaughtErrors", "failedRequests": [ … ], "requestCount" },
  "console": [ ConsoleEntry | ErrorEntry ],
  "har": { "log": { … } },          // HAR 1.2, otevře se v DevTools
  "elements": [ { "selector", "tag", "role?", "name?", "text?", "rect": {x,y,width,height}, "depth" } ]
}
```

Redakce probíhá v rozšíření ještě před odesláním. Neredigovaná data rozšíření nikdy neopustí.

## Uložení v Mac appce (návrh)

```text
assets/
  Bug_1.png
  Bug_1.context.json   ← bundle bez HAR
  Bug_1.har
```

- Do Markdownu jde nový placeholder `{context}` (souhrn). Obrázek v `{screenshots}`
  dostane pod poznámkou sbalitelný callout:

```markdown
> [!bug]- Kontext: https://app.example.com/orders (2 chyby, 1 selhaný request)
> - `POST /api/orders` → 500
> - `TypeError: Cannot read properties of undefined (reading 'id')`
> - [HAR](assets/Bug_1.har) · [konzole](assets/Bug_1.context.json)
```

## Mapování elementů na snímek

Rozšíření pošle `rect` v CSS pixelech viewportu a `geometry`. Mac zná výřez
snímku `R` (globální body) a `backingScale` obrazovky.

```text
zoom        = geometry.devicePixelRatio / backingScale      // zoom stránky
contentLeft = geometry.screenX                              // macOS nemá boční rámečky
contentTop  = geometry.screenY + geometry.outerHeight - geometry.innerHeight * zoom
screenRect  = (contentLeft + x*zoom, contentTop + y*zoom, width*zoom, height*zoom)
imageRect   = (screenRect - R.origin) * scaleSnímku
```

- DevTools ukotvené vlevo nebo dole tento výpočet rozbijí. Přesnější zdroj je
  Accessibility API: `AXWebArea` okna prohlížeče má přesnou pozici obsahu. Pokud
  appka má oprávnění Accessibility, použije ji, jinak výpočet výše.
- Hit-test v editoru: klik vybere nejmenší element obsahující bod. Opakovaný klik
  nebo `⌥` posune výběr na rodiče. Hover zvýrazní obrys.
- Anotace typu `element`: `{selector, tag, name, rect, note}`. Exportuje se pod
  obrázek jako `` - **Element** `button[data-testid="save"]` „Uložit“: popis ``.
