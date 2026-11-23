# Protokol rozšíření ↔ Screenshot Note (v1)

Kontrakt mezi tímto rozšířením a macOS aplikací `screenshot-note`. Rozšíření je
hotové podle tohoto dokumentu, Mac strana (bridge, poskytovatel kontextu, anotace
elementu) zatím chybí.

## Architektura

```text
Chrome tab ──(MAIN world: inject.js)── console, errors, fetch/XHR
     │                                     │ MessageChannel (JSON text)
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
| `capture.error` | `id`, `code`, `message` | `disabled`, `no-tab`, `too-large`, `internal` |

Host → rozšíření:

| type | pole | význam |
|---|---|---|
| `hello` | `protocol`, `app?: {version, running}` | potvrzení spojení |
| `ping` | `id` | kontrola dostupnosti |
| `capture.request` | `id`, `policy?`, `target?` | žádost o kontext |

`target` (vše volitelné):
- `windowBounds: {x, y, width, height}`: okno prohlížeče z `CGWindowListCopyWindowInfo` v bodech, počátek vlevo nahoře. Rozšíření ho porovná s `chrome.windows` s tolerancí 8 bodů.
- `windowTitle`: záložní shoda podle titulku aktivní záložky.
- `tabId`: přímé určení (rezerva). Platí jen pro aktivní záložku některého okna. Jinak se celý `target` ignoruje.
- Bez shody se použije naposledy fokusované okno.

`policy` (`CapturePolicy`) nastavuje Mac appka podle složky nebo konfigurace. Chybějící pole doplní výchozí hodnoty (`src/lib/defaults.ts`).
Mac appka posílá `includeConsole`, `includeNetwork`, `includeBodies`, `includeElements`, `includeElementText`, `redactCookies`/`redactAuthHeaders` (vždy `true`), `redactHeaders` a `redactQueryParams` z nastavení lokální složky. Složka s vypnutým kontextem a cloudová složka `capture.request` vůbec nepošlou.
Policy může redakci jen přidat, nikdy ubrat:
- `redactCookies` a `redactAuthHeaders` jsou vždy `true`, bez ohledu na hodnotu od hostu.
- Seznamy `redactHeaders`, `redactQueryParams` a `redactBodyKeys` od hostu se přidají k výchozím.
- `includeBodies` platí, jen když má uživatel v popupu zapnuté nahrávání těl.
- Pole se špatným typem se ignorují a použije se výchozí hodnota.
- V bundle je v `policy` to, co se skutečně použilo.

| pole | výchozí | |
|---|---|---|
| `includeConsole` / `includeNetwork` / `includeElements` | `true` | |
| `includeBodies` | `false` | jen při zapnutém přepínači těl v popupu |
| `includeElementText` | `true` | texty prvků v mapě elementů |
| `redactCookies` | `true` | vždy zapnuto; jména cookies zůstanou, hodnoty se skryjí |
| `redactAuthHeaders` | `true` | vždy zapnuto; `Authorization`, `X-Api-Key`, CSRF… a každá hlavička, jejíž jméno odpovídá vzoru `SENSITIVE_NAME_PATTERN` v `src/lib/defaults.ts` (`token`, `secret`, `key`, `auth`, `session`…), kromě `Keep-Alive`, `Access-Control-Allow-Credentials`, `WWW-Authenticate`, `Proxy-Authenticate`; schéma (`Bearer`) zůstane |
| `redactHeaders` | `[]` | vlastní hlavičky ke skrytí, přidají se |
| `redactQueryParams` | token, code, key, jwt, sid… | přidají se k výchozím; navíc každý parametr se jménem podle stejného vzoru jako u hlaviček; platí i pro fragment URL a hlavičky `Location`, `Referer`, `Origin`, `Content-Location` |
| `redactBodyKeys` | password, token… | přidají se k výchozím; navíc vždy klíče obsahující `pass`, `pwd`, `secret`, `token`, `otp`, `cvv`, `card`, `auth`, `key`, `session` (bez ohledu na velikost písmen) |
| `maxBodyBytes` | 64 KiB | |
| `windowMs` | 2 min | jak daleko do minulosti |

Těla se redigují po klíčích v JSON, form-urlencoded a multipart (po polích, soubory
jako `[file]`), i ve vnořeném JSON. Tělo, které bylo oříznuté nebo nejde rozparsovat
(text, HTML, XML, rozbitý JSON, holý token), se nahradí značkou
`[body omitted: truncated]` nebo `[body omitted: unparsed]`. `maxBodyBytes` ořízne
až redigovaný výsledek.

Odpověď by měla dorazit do 300 ms. Appka čeká nejvýš 1 s a pak uloží snímek bez kontextu.

Mac appka posílá request všem připojeným prohlížečům s `protocol` 1 (deadline 30 s od startu
snímání, aby pokryl interaktivní výběr výřezu). Přijme jen bundle, jehož `page.geometry`
(`screenX`, `screenY`, `outerHeight` přepočtené poměrem `windowBounds.width / outerWidth`) sedí
na `windowBounds` s tolerancí 8 bodů; ostatní odpovědi bere jako odmítnutí. Bundle bez
`geometry` se při zadaném `windowBounds` nepřijme.

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
  "elements": [ { "selector", "tag", "role?", "name?", "text?", "rect": {x,y,width,height}, "depth" } ],
  "trimmed": { "bodies", "network", "console", "elements", "largeBodies?" }  // jen u zmenšeného bundle
}
```

Redakce probíhá v rozšíření ještě před odesláním. Neredigovaná data rozšíření nikdy neopustí.

### Limity velikosti

- Bundle má pevný strop 16 MiB měřený v UTF-8 bajtech (`MAX_BUNDLE_BYTES` v `src/lib/capture.ts`).
- Když je větší, rozšíření ho zmenšuje: nejdřív zahazuje těla od největšího
  (nahradí je `[body omitted: size limit]`, počet je v `trimmed.largeBodies`),
  a když to nestačí, zahodí všechna těla. Pak nejstarší záznamy sítě a konzole
  podle společné časové hranice, a teprve když se nevejde ani bez nich, ubírá
  elementy. Zmenšený bundle má `trimmed: {bodies, network, console, elements, largeBodies?}`
  (zda se zahodila všechna těla a počty zahozených záznamů) a v `policy` skutečně
  použité `includeBodies`. `summary` vždy popisuje celá, nezmenšená data.
- Když se nevejde ani bez záznamů (např. obří titulek stránky), přijde `capture.error` s kódem `too-large`.
- Native Messaging (`BridgeWire.swift` v repu `screenshot-note`): bridge skončí na
  zprávě rozšíření → host nad 64 MiB (`inputLimit`), stejný limit má čtení socketu
  v appce. Zprávy host → rozšíření nad 1 MiB bridge zahodí (`browserOutputLimit`,
  odpovídá limitu Chromu). Strop 16 MiB je pod oběma.
- Content script drží nejvýš 8 Mi znaků záznamů stránky, jednu událost nejvýš 4 Mi znaků.

## Uložení v Mac appce

```text
assets/
  Bug_1.png
  Bug_1.context.json   ← bundle bez HAR
  Bug_1.har
```

- V pracovní složce draftu leží kontext vedle obrázku jako `<obrázek>.png.context.json`
  a `<obrázek>.png.har` (0600). `Draft.contexts` mapuje obrázek → soubor kontextu (volitelné pole).
- Název v `assets/` musí být volný pro `.png`, `.context.json` i `.har` (kolize jako u PNG: `Název-1 2`).
  Index relace nese hashe všech tří souborů. Znovuotevření najde kontext podle názvu obrázku.
- Cloudové složky viz „Cloud“ níže.
- Kontext se exportuje jen do složky, která ho má podle aktuálního nastavení zapnutý.
- „Odebrat kontext“ v komposeru smaže soubory v draftu; u znovuotevřené relace si draft pamatuje původní název (`Draft.removedContexts`) a `assets/<název>.context.json` a `.har` se smažou až po zápisu Markdownu.
- Do Markdownu jde nový placeholder `{context}` (souhrn: řádek `- Screenshot N: …` za snímek
  s kontextem). Výchozí šablona ho nemá. Obrázek v `{screenshots}` dostane pod poznámkou
  sbalitelný callout (texty ze stránky jen v inline kódu, bez backticků a zalomení):

```markdown
> [!bug]- Kontext: `https://app.example.com/orders` (2 chyby, 1 selhaný request)
> - `POST /api/orders` → 500
> - `TypeError: Cannot read properties of undefined (reading 'id')`
> - [HAR](<assets/Bug_1.har>) · [konzole](<assets/Bug_1.context.json>)
```

  U zmenšeného bundle přibude řádek `Zmenšeno kvůli velikosti: bez těl, N requestů…`.
  Počty v titulku jsou ze `summary` (celá data). Při čtení uložené relace se callout
  z popisku obrázku odstraní a znovu vygeneruje ze souborů v `assets/`.

## Cloud (F6)

- Politika kontextu cloudové složky platí jen na daném Macu (`CloudContextPolicies` v UserDefaults), výchozí stav vypnuto, zapnutí potvrzuje varování.
- Job ve frontě nese `attachments: [{index, kind: "context"|"har", bytes, sha256}]` jen pro nové snímky, soubory `<index>.context.json` a `<index>.har` leží vedle PNG v jobu. Strop přílohy je 16 MiB.
- Kontext pořízený pro jinou složku se ořízne podle politiky cílové složky. Pokud `policy` v bundlu neobsahuje její vlastní `redactHeaders` a `redactQueryParams`, kontext ani HAR se nenahrají.
- Upload: po commitu relace `PUT /api/v1/sessions/{id}/attachments/{index}/{kind}` (`x-bytes`, `x-sha256`). Opakovaný job pošle přílohy znovu, stejný hash server jen potvrdí.
- Detail relace má u obrázku `attachments: [{kind, bytes, sha256, path}]`. Prázdný seznam Mac ukládá jako nil, otisk starších relací se nemění.
- Synchronizace složky zapíše přílohy do `assets/<název>.context.json` a `.har` (0600) a jejich hashe do indexu relace. Odebraná příloha se smaže jen tehdy, když přišla z cloudu.
- „Odebrat kontext“ u znovuotevřené cloudové relace zařadí `DELETE` příloh (fronta `.attachment-removals`), pošle se po doplnění relace.
- Řádky Element v cloudu mají selektor a text prvku jen u snímku s kontextem.
- Web: callout pod snímkem a stažení HAR a konzole jen pro členy library relace. Sdílené odkazy přílohy nevidí. MCP: `browser_context.summary` v `get_session` a nástroj `get_browser_context`.
- Šifrování zatím není (rozhodnutí 21. 11. 2026).

## Mapování elementů na snímek

Rozšíření pošle `rect` v CSS pixelech viewportu a `geometry`. Mac zná výřez
snímku `R` (globální body) a `backingScale` obrazovky.

```text
zoom        = geometry.devicePixelRatio / backingScale      // zoom stránky
contentLeft = geometry.screenX * zoom                       // macOS nemá boční rámečky
contentTop  = (geometry.screenY + geometry.outerHeight) * zoom - geometry.innerHeight * zoom
screenRect  = (contentLeft + x*zoom, contentTop + y*zoom, width*zoom, height*zoom)
imageRect   = (screenRect - R.origin) * scaleSnímku
```

- `backingScale` ve vzorci je měřítko displeje, na kterém leží většina okna prohlížeče
  (podle něj Chrome hlásí `devicePixelRatio`), ne nutně displeje snímku.
- Mac ukládá výřez do `<obrázek>.context.json` pod klíč `capture` (klíč z rozšíření zahodí):
  `{rect, backingScale, imageScale, browserScale?, window?, webAreas?}`. `rect`, `window`
  a `webAreas` jsou globální body s počátkem vlevo nahoře, `imageScale` = pixely obrázku na bod.
  Prozradí rozložení displejů a polohu okna (jde do exportu s kontextem).
  Zatím jen u celoobrazovkového snímku (`-m`, `-D n`) se zapnutou mapou elementů. Výběr
  oblasti (`-i`) výřez nezná, kontext má bez `capture` a mapa se nepoužije. U `-D` se
  `capture` neuloží, když má jiný displej stejnou velikost (pořadí `-D` není zdokumentované).
- `webAreas`: kandidáti `AXWebArea` s adresou `http(s)`, `file` nebo `about` (ne DevTools,
  postranní panely ani interní stránky), hledaní na pozadí nejvýš 0,3 s. Platí ten, jehož
  velikost odpovídá `innerWidth/innerHeight * zoom`. Dotaz může v Chromu zapnout podporu
  Accessibility do konce jeho běhu.
- Když Mac zná okno prohlížeče z WindowServeru (`capture.window`), počítá místo `screenX`
  a `outerHeight` z něj: `contentLeft = window.x`, `contentTop = window.maxY - innerHeight * zoom`.
  Když se `innerWidth * zoom` liší od šířky okna (DevTools nebo panel po straně), mapa bez
  přesné `webAreas` není.
- Pinch zoom: `x' = (x - visualViewport.offsetLeft) * visualViewport.scale`, totéž pro y.
- Prvky se oříznou na viewport i výřez; nulové nebo zcela mimo se vynechají.
  `devicePixelRatio` 0 (záložní geometrie bez content scriptu) znamená žádnou mapu.
- Ladění: `defaults write cz.janprasil.screenshotnote BrowserContextDebugElements -bool true`
  uloží kopii snímku s obdélníky do `$TMPDIR/ScreenshotNote-elements/` (0700, po dni se maže) a cestu zaloguje
  (`Browser bridge element map`). Testovací stránka: `docs/test-pages/element-map.html`.
- DevTools ukotvené dole tento výpočet rozbijí. Přesnější zdroj je
  Accessibility API: `AXWebArea` okna prohlížeče má přesnou pozici obsahu. Pokud
  appka má oprávnění Accessibility, použije ji, jinak výpočet výše.
- Hit-test v editoru: klik vybere nejmenší element obsahující bod (při shodném obdélníku
  hlubší). Opakovaný klik do vybraného nebo `⌥` posune výběr na rodiče (obsahuje ho
  a má menší hloubku nebo větší plochu). Hover zvýrazní obrys, Esc rozpracovaný výběr zruší.
  Nástroj je jen u obrázku, jehož velikost odpovídá `capture` (`rect * imageScale`).
- Anotace typu `element` v `<obrázek>.annotations.json` (Mac): `Mark` s `tool: 7`, obdélníkem
  v `points` a `element: {number, selector, tag, name, text}`; popis je v `text`. Starší
  dokumenty bez `element` se načtou beze změny.
- Export pod obrázek (za popisek, před callout), seřazeno podle čísla:
  `` - **[1] Element** `button[data-testid="save"]` „Uložit“: popis ``. Místo `name` se
  použije `text`, oba se zkrátí na 80 znaků a escapují. Selektor, který by vypadal jako odkaz
  na obrázek, se nahradí tagem. Řádky se ukládají do popisku relace, po znovuotevření jsou
  součástí popisku obrázku. Prvky zcela mimo ořez se vynechají.
  Nová čísla po znovuotevření navazují na nejvyšší `[n] Element` v popisku. Bez kontextu
  (odebraný, vypnutý politikou) a v cloudu se exportuje jen číslo a popis, bez dat stránky.
- Ořez v editoru: mapa se ořízne na zachovanou oblast a při exportu se `capture.rect`
  v `assets/<obrázek>.context.json` posune na oříznutou část, aby mapa seděla i po znovuotevření.
