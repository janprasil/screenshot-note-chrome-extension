# Soukromí a šifrování

## Co se sbírá a kde to leží

- Konzole, chyby a fetch/XHR se drží v paměti content scriptu dané záložky. Při
  navigaci se buffer zahodí.
- webRequest záznamy (URL, hlavičky včetně cookies, statusy, časy) jsou v paměti
  service workeru a v `chrome.storage.session`. To je paměťové úložiště, které
  přežije restart workeru, ale ne restart prohlížeče. Na disk se nic nepíše.
- Buffer je omezený časem (výchozí 5 min) a počtem: 2000 záznamů stránky, 500
  requestů na záložku. Zavřením záložky se smaže.
- Těla odpovědí se nahrávají jen při zapnutém přepínači v popupu, pouze textové
  typy, nejvýš 256 KiB na odpověď.
- Vypnutím nahrávání se okamžitě smažou všechny buffery.

## Redakce

Redakce probíhá v rozšíření při exportu (`src/lib/redact.ts`). O tom, co se
skryje, rozhoduje Mac appka přes `CapturePolicy`, tedy uživatel v nastavení
složky nebo konfigurace:

- [x] Skrýt hodnoty cookies (`Cookie`, `Set-Cookie`), jména zůstanou.
- [x] Skrýt autorizační hlavičky (`Authorization`, `X-Api-Key`, CSRF…).
- [ ] Vlastní hlavičky ke skrytí (seznam).
- [x] Skrýt citlivé query parametry (token, code, key…).
- [ ] Přiložit těla requestů a odpovědí (klíče `password`, `token`… se skryjí).
- [x] Přiložit mapu elementů. [x] Včetně textů prvků.

Hodnoty polí `password` se do mapy elementů nikdy nedostanou. Argumenty konzole
se neredigují, protože jejich obsah nelze spolehlivě rozpoznat. Rozhodnutí
o konzoli je proto jen zapnout, nebo vypnout.

## Cloud

Výchozí stav:
- Lokální složky: kontext zapnutý.
- Cloudové složky: kontext vypnutý. Zapnutí vyžaduje zaškrtnutí a zobrazí varování
  o citlivosti.

Šifrování kontextových příloh (`.har`, `.context.json`), návrh k rozhodnutí:

| varianta | jak | web viewer | tým |
|---|---|---|---|
| A. bez šifrování | jako PNG | čte přímo | funguje |
| B. klíč složky v Keychain | AES-256-GCM per soubor, klíč složky na Macu | potřebuje klíč (export/passphrase) | klíč se musí předat |
| C. B + wrap klíče pro členy | klíč složky obalený X25519 klíčem každého člena | odemknutí v prohlížeči (WebCrypto) | automaticky |

Doporučení: začít s B pro osobní cloudové složky. Variantu C řešit spolu
s týmovými složkami, protože vyžaduje správu veřejných klíčů členů. Server nikdy
nevidí klíč, MCP pak kontext nečte, dokud ho klient nedešifruje. To je třeba
zohlednit v MCP nástrojích.

## Oprávnění rozšíření

`<all_urls>`, `webRequest`, `tabs`, `storage`, `nativeMessaging`. Široká oprávnění
jsou nutná pro sběr na libovolném webu. Chrome Web Store kvůli nim bude vyžadovat
odůvodnění a privacy policy.
