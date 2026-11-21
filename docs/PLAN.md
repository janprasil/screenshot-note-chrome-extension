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
- [x] Mac F2 (`feat/browser-context-p2`, PR #22, squash `da3b5ee` na main, merge bypassem): při snímku frontmost Chromium → `capture.request` s `windowBounds`, po snímku čeká nejvýš 1 s; přijme jen bundle, jehož `page.geometry` odpovídá cílovému oknu. Kontext v draftu vedle PNG, export `.context.json` + `.har`, callout, `{context}`, reopen, mazání, index s hashi. Cloud kontext zahodí. Test `--context-self-test`. Čeká na ruční ověření v Chrome.
- [x] Mac F3 (`feat/browser-context-p3`, commity `96715f1`, `f3a8e5b`, `a94a721`, nepushnuto): `ContextPolicy` v lokální složce (konzole, network, těla, mapa prvků, texty, vlastní hlavičky a query parametry; cookies a autorizace zamčené). Cloudové složky kontext vypnutý („připravujeme“). `capture.request` nese politiku aktuální složky, vypnutý kontext request neposílá a ani neexportuje. Komposer: odznak s počtem chyb a selhaných requestů, „Odebrat kontext“ (u znovuotevřené relace smaže `assets/` soubory až po zápisu Markdownu). Čeká na ruční ověření.
- [x] Mac F4 (`feat/browser-context-p4` nad p3, commity `b13d584`, `924d890`, nepushnuto): jen celoobrazovkové snímky (`-m`, `-D`), výběr oblasti mapu nemá (vlastní výběr je varianta B na později). `capture` v `.context.json` (výřez, měřítka, okno, kandidáti AXWebArea), přepočet elementů na pixely obrázku, ladicí kopie s obdélníky (`BrowserContextDebugElements`), testovací stránka `docs/test-pages/element-map.html`. Čeká na ruční ověření.
- [x] Mac: uložení `.context.json` + `.har`, placeholder `{context}`, callout pod obrázkem (F2).
- [x] Mac F5 (`feat/browser-context-p5` nad p4, commity `6aada50`, `ada130f`, nepushnuto): nástroj Element v editoru anotací (jen s mapou odpovídající velikosti obrázku), hover, klik = nejmenší prvek, opakovaný klik nebo ⌥ = rodič, Esc zruší, Enter potvrdí popis. Mark s číslem a daty prvku (zpětně kompatibilní Codable), přerušovaný obdélník s odznakem. Export `- **[n] Element** `selector` „name“: popis` pod popisek; bez kontextu a v cloudu jen čísla a popisy. Ořez posune `capture` v exportovaném kontextu. Čeká na ruční ověření.
- [x] Mac F6 (`feat/browser-context-p6` nad p5) + web (`feat/browser-context-attachments`, migrace `20261121300000` aplikovaná na dev DB): politika kontextu cloudové složky (na Macu, výchozí vypnuto), upload `.context.json` a `.har` po commitu, stažení do `assets/`, řádky Element s daty stránky, mazání příloh, callout a stažení na webu jen pro členy, MCP `get_browser_context`. Bez šifrování. Čeká na ruční ověření.
- [ ] Šifrování příloh v cloudu (PRIVACY.md), zatím odloženo.
- [ ] Později: těla přes `chrome.debugger` (volitelný režim), Safari Web Extension, Firefox, shadow DOM a iframy v mapě elementů, picker elementu přímo v prohlížeči.

## Otevřená rozhodnutí

- Šifrování cloudu: odloženo, zatím bez šifrování (PRIVACY.md).
- Distribuce: Chrome Web Store (veřejně/unlisted) vs. jen vývojová instalace.
- Zda je kontext součástí placeného tarifu.

## Známá omezení

- Content script běží jen v hlavním rámci, iframy se nesbírají.
- Requesty obsloužené service workerem stránky nemají webRequest hlavičky. Jsou v HARu jen ze záznamu stránky (`_source: "page"`).
- Událost `screenshot-note:entry` může vyvolat i stránka sama. Podvrhnout tak může jen vlastní záznamy, k jiným datům se nedostane. Záznamy se ověřují a omezují velikostí, takže capture nezablokuje ani nenafoukne.
- Konzole zaznamenaná před načtením content scriptu (velmi raný inline skript) se může ztratit.
