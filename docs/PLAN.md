# Plán (20. 11. 2026)

Cíl: ke snímku z prohlížeče přiložit „metadata, která nejsou vidět“, tedy konzoli,
network (HAR) a mapu elementů. Element se pak dá vybrat a popsat v anotaci.

## Stav

- [x] F1 Rozšíření MV3: recorder konzole, chyb a fetch/XHR (MAIN world), webRequest buffer, redakce, HAR 1.2, bundle, popup, vývojový native host. Unit testy, typecheck a build prošly.
- [x] F2 (rozšíření) Mapa viditelných elementů s CSS selektory a geometrie viewportu.
- [ ] Ruční ověření v Chrome: načíst `dist/`, nainstalovat `dev-host`, vyvolat capture.
- [x] Opravy z bezpečnostního auditu rozšíření (nálezy 1–8): politika jen přidává redakci, těla jen při zapnutém přepínači, redakce URL v hlavičkách a fragmentech, těla bez surového textu, vzory citlivých jmen, ověření záznamů stránky, strop bundle 16 MiB. Ručně ověřit v Chrome: po zastavení service workeru se při zapnutých tělech dál nahrávají requesty.
- [x] Pevné ID vývojového buildu přes `key` v manifestu (`hffkngdjiopodemokmgiedickoiehidb`).
- [x] Mac F1 (`feat/browser-context-p1`): helper `screenshot-note-bridge` (stdio ↔ Unix socket), socket server `BrowserBridge`, přepínač „Propojení s prohlížečem“ s instalací manifestů hostu, `--bridge-self-test`. Čeká na ruční ověření v Chrome.
- [ ] Mac: `ContextProvider` při snímku (frontmost Chromium → `capture.request`, timeout 1 s).
- [ ] Mac: nastavení politiky ve složce/konfiguraci (přepínače z PRIVACY.md).
- [ ] Mac: uložení `.context.json` + `.har`, placeholder `{context}`, callout pod obrázkem.
- [ ] Mac: anotace „Element“: hit-test nad mapou, výběr rodiče, popis, export.
- [ ] Web/cloud: upload příloh (vypnuto pro cloud), šifrování podle rozhodnutí v PRIVACY.md, zobrazení na webu a v MCP.
- [ ] Později: těla přes `chrome.debugger` (volitelný režim), Safari Web Extension, Firefox, shadow DOM a iframy v mapě elementů, picker elementu přímo v prohlížeči.

## Otevřená rozhodnutí

- Šifrování cloudu: varianta B nebo C (PRIVACY.md).
- Distribuce: Chrome Web Store (veřejně/unlisted) vs. jen vývojová instalace.
- Zda je kontext součástí placeného tarifu.

## Známá omezení

- Content script běží jen v hlavním rámci, iframy se nesbírají.
- Requesty obsloužené service workerem stránky nemají webRequest hlavičky. Jsou v HARu jen ze záznamu stránky (`_source: "page"`).
- Událost `screenshot-note:entry` může vyvolat i stránka sama. Podvrhnout tak může jen vlastní záznamy, k jiným datům se nedostane. Záznamy se ověřují a omezují velikostí, takže capture nezablokuje ani nenafoukne.
- Konzole zaznamenaná před načtením content scriptu (velmi raný inline skript) se může ztratit.
