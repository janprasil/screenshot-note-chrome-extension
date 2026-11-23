# Soukromí a šifrování

## Co se sbírá a kde to leží

- Konzole, chyby a fetch/XHR se drží v paměti content scriptu dané záložky. Při
  navigaci se buffer zahodí.
- webRequest záznamy (URL, hlavičky včetně cookies, statusy, časy) jsou v paměti
  service workeru a v `chrome.storage.session`. To je paměťové úložiště, které
  přežije restart workeru, ale ne restart prohlížeče. Na disk se nic nepíše.
- Buffer je omezený časem (výchozí 5 min), počtem (2000 záznamů stránky, 500
  requestů na záložku) a velikostí (záznamy stránky nejvýš 8 Mi znaků JSONu,
  webRequest záznamy nejvýš 4 Mi znaků na záložku).
  Zavřením záložky se smaže.
- Záznamy ze stránky se ověřují: neznámé typy a špatné typy polí se zahodí, čas
  se omezí na „teď“, texty se zkrátí (argument konzole 4000 znaků, nejvýš 50
  argumentů, zpráva a stack 16 000 znaků, URL 8000 znaků, tělo 256 KiB). Událost
  delší než 4 Mi znaků se zahodí celá.
- Těla requestů i odpovědí se nahrávají jen při zapnutém přepínači v popupu.
  Bez něj si rozšíření těla od webRequest ani nevyžádá a content script je
  zahodí. Odpovědi jen textových typů, nejvýš 256 KiB na odpověď; čtení se po
  limitu nebo po 30 s zruší. Streamy (`text/event-stream`, ndjson) se nečtou.
  Tělo requestu z webRequest (i formulář) nad 64 KiB se nahradí značkou.
- webRequest zachytí requesty všech rámců záložky, tedy i iframů jiných domén
  (např. platebních widgetů).
- Vypnutím přepínače těl se okamžitě smažou všechna uložená těla.
- Vypnutím nahrávání se okamžitě smažou všechny buffery.

## Redakce

Redakce probíhá v rozšíření při exportu (`src/lib/redact.ts`). Mac appka přes
`CapturePolicy` (nastavení složky nebo konfigurace) může redakci jen přidat.
Výchozí redakci vypnout nemůže: cookies a autorizační hlavičky se skryjí vždy
a výchozí seznamy hlaviček, query parametrů a klíčů těl platí vždy. Těla jdou
ven jen při zapnutém přepínači v popupu. Přímé `tabId` platí jen pro aktivní
záložku, jinou záložku si host vyžádat nemůže.

- [x] Skrýt hodnoty cookies (`Cookie`, `Set-Cookie`), jména zůstanou. Vždy.
- [x] Skrýt autorizační hlavičky (`Authorization`, `X-Api-Key`, CSRF…). Vždy.
  Kromě přesného seznamu se skryje každá hlavička i query parametr, jehož jméno
  obsahuje `token`, `secret`, `key`, `auth`, `session`, `csrf`, `signature`,
  `credential`, `password`, `pass`, `pwd`, `otp`, `jwt`, `assertion`, `oidc`,
  `principal`, `appcheck` nebo `dpop` (např. `PRIVATE-TOKEN`, `X-Amz-Signature`).
  Zachytí to i nevinná jména (`keyword`, `author`), to je záměr. Výjimky jsou
  `Keep-Alive`, `Access-Control-Allow-Credentials`, `WWW-Authenticate`
  a `Proxy-Authenticate`. URL vnořené v hodnotě parametru (`redirect_uri=…`)
  se zatím znovu neredigují.
- [ ] Vlastní hlavičky ke skrytí (seznam).
- [x] Skrýt citlivé query parametry (token, code, key…). Výchozí seznam vždy.
  Stejně se redigují parametry ve fragmentu URL (`#access_token=…`, `#/cesta?token=…`)
  a URL v hlavičkách `Location`, `Referer`, `Origin`, `Content-Location`, `Refresh`
  i v `redirectURL`. URL ve stack trace, ve zprávách chyb a v chybách síťových
  requestů se redigují také.
- [ ] Přiložit těla requestů a odpovědí. Klíče obsahující `pass`, `secret`,
  `token`, `otp`, `card`, `auth`, `key`, `session`… se skryjí v JSON, formulářích
  i multipart. Oříznutá nebo nerozparsovatelná těla se nahradí značkou
  `[body omitted: …]`, surový text se nikdy neposílá. JSON vnořený hlouběji než
  3 úrovně nebo rozbitý vnořený JSON se nahradí značkou `[nested value omitted]`.
  Shoda podle části klíče skryje i nevinné klíče (`author`, `monkey`), to je záměr.
  Hodnoty uvnitř GraphQL dotazu jako textu (`login(password: "…")`) se neredigují.
- [x] Přiložit mapu elementů. [x] Včetně textů prvků.

Hodnoty polí `password` se do mapy elementů nikdy nedostanou. Objekty v argumentech
konzole skryjí hodnoty citlivých klíčů už ve stránce (i objekty a pole, i JSON
uložený v řetězci). V argumentech konzole, ve zprávách chyb a ve stacku se dál
redigují URL, hodnoty `Bearer`/`Basic`/`Token` a dvojice `"klíč": hodnota`
s citlivým klíčem. Volný text bez struktury (`heslo je hunter2`), JSON
s jednoduchými uvozovkami nebo JSON uprostřed věty rozpoznat nejde, rozhodnutí
o konzoli je proto hlavně zapnout, nebo vypnout. Vnořený rozbitý JSON s klíči
se raději zahodí celý, i když tajemství neobsahuje.

## Cloud

Výchozí stav:
- Lokální složky: kontext zapnutý.
- Cloudové složky: kontext vypnutý. Zapnutí platí jen na daném Macu, vyžaduje zaškrtnutí
  a zobrazí varování o citlivosti a o tom, že přílohy uvidí všichni členové složky.

Šifrování kontextových příloh (`.har`, `.context.json`), návrh k rozhodnutí:

| varianta | jak | web viewer | tým |
|---|---|---|---|
| A. bez šifrování | jako PNG | čte přímo | funguje |
| B. klíč složky v Keychain | AES-256-GCM per soubor, klíč složky na Macu | potřebuje klíč (export/passphrase) | klíč se musí předat |
| C. B + wrap klíče pro členy | klíč složky obalený X25519 klíčem každého člena | odemknutí v prohlížeči (WebCrypto) | automaticky |

Rozhodnutí Jana 21. 11. 2026: zatím bez šifrování (varianta A), šifrování promyslet později.

Původní doporučení: začít s B pro osobní cloudové složky. Variantu C řešit spolu
s týmovými složkami, protože vyžaduje správu veřejných klíčů členů. Server nikdy
nevidí klíč, MCP pak kontext nečte, dokud ho klient nedešifruje. To je třeba
zohlednit v MCP nástrojích.

## Oprávnění rozšíření

`<all_urls>`, `webRequest`, `scripting`, `storage`, `nativeMessaging`. Široká oprávnění
jsou nutná pro sběr na libovolném webu. `tabs` není potřeba, URL a titulek záložek
dává `<all_urls>`. `scripting` slouží k registraci MAIN world skriptu jen při
zapnutém nahrávání a k jeho doplnění do otevřených záložek po zapnutí. Chrome Web Store kvůli nim bude vyžadovat
odůvodnění a privacy policy.
