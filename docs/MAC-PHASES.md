# Propojení s Mac appkou: fáze a prompty

Každá fáze běží v **nové čisté session** Claude Code. Na konci fáze session
vygeneruje prompt pro další fázi podle šablony níže a doplní do něj skutečný stav.

- Mac worktree: `/Users/janprasil/git/personal/screenshot-note-project/screenshot-note-browser`
- Rozšíření: `/Users/janprasil/git/personal/screenshot-note-project/screenshot-note-chrome-extension`
- Větve: `feat/browser-context-p1` … `p5`. Každá fáze stojí na předchozí, nebo na `main`, pokud už je předchozí mergnutá.

## Společná pravidla (platí pro každou fázi)

- **Bez subagentů.** Všechno dělej sám v hlavní session. Jediná výjimka je review na konci fáze.
- **Šetři kontext.** Čti soubory po rozsazích (`sed -n`, `grep -n`), ne celé, pokud nemusíš. Mac zdroje jsou od restrukturalizace v `Sources/` podle oblastí (viz `docs/RESTRUCTURE-PLAN.md` v Mac repu). `Cloud/CloudFolders.swift`, testy v `Sources/ScreenshotNoteTestHost/` a `Cloud/CloudLibrary.swift` čti jen tehdy, když na ně změna přímo sahá. Výstup buildu filtruj (`2>&1 | tail -30`, `grep -E "error|warning|PASS|FAIL"`).
- **Styl kódu** drž podle okolí: hustý Swift jako v repu, žádné závislosti třetích stran, lokalizace cs/en přes `L(...)` a `Localizations/`. Komentáře jako krátké věty.
- **Ověření:** `./build.sh` (build + self-testy) musí projít. Nová logika dostane test v `Sources/ScreenshotNoteTestHost/` spouštěný z `build.sh` přes testovací host (vzor `--folder-transfer-self-test`); do appky test kód nepatří (`tests/test-inventory.py`).
- **Review na konci fáze**, až když je build zelený a změny commitnuté:
  1. Jeden subagent (`Agent`, typ `general-purpose`). Dej mu jen rozsah (`git diff <base>...HEAD`), cíl fáze a odkaz na `docs/PROTOCOL.md`. Svůj závěr mu nedávej. Ať hledá chyby správnosti, bezpečnosti (socket, oprávnění souborů, redakce) a regrese v ukládání a znovuotevírání session.
  2. Souběžně Codex přes Bash na pozadí: `codex review --base <base>`. S `--base` Codex nepřijme vlastní prompt, cíl fáze mu proto nedávej.
  3. Nálezy P1 a P2 oprav. U ostatních oprav nebo stručně zdůvodni. Po opravách znovu `./build.sh`.
- **Git:** commit s Conventional Commits titulkem (`feat: …`) a patičkou session. Push a PR **až po Janově potvrzení**. Do PR vláken nic nepiš.
- **Na konci fáze:**
  1. Aktualizuj stav v `docs/PLAN.md` rozšíření.
  2. Pokud se měnil kontrakt, aktualizuj i `docs/PROTOCOL.md`.
  3. Vypiš Janovi prompt pro další fázi. Vezmi šablonu z tohoto souboru a doplň ji o sekci **Předávka**: větev a commit, co se odchýlilo od plánu, učiněná rozhodnutí, známé problémy, co ručně ověřit.

---

## F1: Bridge a spojení

**Výsledek:** popup rozšíření v Chrome ukazuje „Připojeno“ ke skutečné appce, appka loguje `hello`.

### Prompt F1

```text
Pracujeme na propojení Screenshot Note (macOS) s Chrome rozšířením, fáze F1 z 5: bridge a spojení.

Repa:
- Mac worktree: /Users/janprasil/git/personal/screenshot-note-project/screenshot-note-browser (větev feat/browser-context-p1, base origin/main)
- Rozšíření: /Users/janprasil/git/personal/screenshot-note-project/screenshot-note-chrome-extension

Nejdřív přečti v rozšíření: docs/MAC-PHASES.md (společná pravidla + F1), docs/PROTOCOL.md, src/lib/defaults.ts a src/background.ts (sekce native bridge). V Mac repu: build.sh, Info.plist, a v main.swift jen start appky a nastavení (grep -n).

Pravidla: bez subagentů, jen review na konci (viz společná pravidla). Šetři kontext.

Úkol:
1. Rozšíření: pokud repo nemá první commit, zeptej se Jana, jestli ho udělat. Přidej do src/manifest.json "key" (vygeneruj RSA 2048 pár, do manifestu jen veřejný klíč v base64 DER, privátní klíč necommituj a ulož mimo repo), ať má vývojový build pevné ID. ID zapiš do docs/PROTOCOL.md.
2. Mac: nový samostatný program `screenshot-note-bridge` (vlastní .swift soubor, jen Foundation), kompilovaný v build.sh do Contents/MacOS a podepsaný před podpisem appky.
   - stdio Native Messaging framing (4 B LE délka + JSON), limit 64 MiB na vstupu, 1 MiB na výstupu do Chrome.
   - Připojení na Unix socket ~/Library/Application Support/Screenshot Note/bridge.sock, relay oběma směry.
   - Když appka neběží, bridge běží dál, zkouší to znovu každé 2 s a na `hello` odpoví sám `{type:"hello",protocol:1,app:{running:false}}`.
   - Skončí, když Chrome zavře stdin.
3. Mac appka: nový soubor BrowserBridge.swift.
   - Socket server (práva 0600, adresář 0700, smazání starého socketu), víc současných klientů (víc prohlížečů).
   - Evidence `hello` (verze rozšíření, UA), `ping`, API `request(policy:target:timeout:) async -> bundle?` pro další fázi.
   - Neplatné nebo příliš velké zprávy zahoď bez pádu.
4. Registrace hostu: přepínač „Propojení s prohlížečem“ v nastavení appky.
   - Zapnutí zapíše manifest `cz.janprasil.screenshotnote.bridge.json` do NativeMessagingHosts nainstalovaných prohlížečů (Chrome, Chrome Beta/Canary, Edge, Brave, Arc, Chromium; jen pokud existuje jejich adresář v Application Support).
   - Vypnutí manifesty smaže. Při startu appky se přepíše `path`, pokud se appka přesunula.
   - allowed_origins = ID z bodu 1.
5. Self-test `--bridge-self-test` v build.sh: framing roundtrip, relay přes dočasný socket s falešným klientem, odmítnutí nadměrné zprávy.

Ruční ověření pro Jana na konec: build --install, zapnout přepínač, v chrome://extensions načíst dist/ rozšíření (npm run build), popup = Připojeno.

Na konci postupuj podle „Na konci fáze“ v docs/MAC-PHASES.md a vypiš prompt pro F2.
```

---

## F2: Kontext při snímku, uložení a export

**Výsledek:** snímek z Chrome má vedle sebe `.har` a `.context.json` a v Markdownu callout se souhrnem. Funguje znovuotevření session, mazání obrázku i kolize názvů.

### Šablona promptu F2

```text
Pracujeme na propojení Screenshot Note (macOS) s Chrome rozšířením, fáze F2 z 5: kontext při snímku, uložení a export.

Repa: Mac worktree /Users/janprasil/git/personal/screenshot-note-project/screenshot-note-browser (nová větev feat/browser-context-p2 z p1 nebo z main, pokud je p1 mergnutá), rozšíření /Users/janprasil/git/personal/screenshot-note-project/screenshot-note-chrome-extension.

Nejdřív přečti v rozšíření: docs/MAC-PHASES.md (společná pravidla + F2), docs/PROTOCOL.md (sekce Bundle a Uložení), docs/PLAN.md. V Mac repu: `Sources/ScreenshotNoteKit/BrowserBridge/BrowserBridge.swift` z F1, `Notes/CaptureNote.swift` (Draft), v `App/AppDelegate.swift` funkci snímání (grep -n screencapture) a export, Templates.swift, SessionIndex.swift a PreviousSessions.swift (jen části o assets, obrázcích a hashích).

Pravidla: bez subagentů, jen review na konci. Šetři kontext.

Úkol:
1. Při startu snímání: když je v popředí Chromium prohlížeč (bundle ID ze seznamu z F1), zjisti přes CGWindowListCopyWindowInfo bounds jeho nejvyššího okna (vrstva 0, PID aplikace) a pošli capture.request souběžně se screencapture. Výchozí policy, F3 ji napojí na nastavení. Na odpověď po dokončení snímku čekej nejvýš 1 s, pak pokračuj bez kontextu. Snímání nesmí být nikdy pomalejší kvůli chybějícímu rozšíření.
2. Draft: nové volitelné pole pro mapování obrázek → soubor kontextu (Codable, zpětně kompatibilní). Bundle ulož do pracovní složky draftu vedle PNG.
3. Export: assets/<název>.har a assets/<název>.context.json (bez HAR), stejné řešení kolizí jako u PNG. Pod obrázek ve {screenshots} přidej sbalitelný callout podle PROTOCOL.md. Přidej placeholder {context} (souhrn za session). Výchozí šablonu neměň, uživatel si ho přidá sám.
4. Smazání obrázku smaže i kontext. Znovuotevření session a přidání do existující session zachová kontext. Index session nese hashe nových souborů.
5. Cloudové složky: kontext zatím nenahrávej, jen ho lokálně zahoď (F3 přidá UI, upload je až F6).
6. Self-test: export s kontextem, kolize názvů, smazání obrázku, reopen se zachováním příloh, draft ze staré verze bez nového pole.

Předávka z F1:
<doplní F1: větev, commit, odchylky, rozhodnutí, ID rozšíření, známé problémy>

Na konci postupuj podle „Na konci fáze“ v docs/MAC-PHASES.md a vypiš prompt pro F3.
```

---

## F3: Nastavení redakce a UI

**Výsledek:** uživatel v konfiguraci nebo složce zaškrtá, co se přikládá a co skrývá. Komposer ukazuje, že má obrázek kontext, a umí ho odebrat.

### Šablona promptu F3

```text
Pracujeme na propojení Screenshot Note (macOS) s Chrome rozšířením, fáze F3 z 5: nastavení redakce a UI.

Repa: Mac worktree /Users/janprasil/git/personal/screenshot-note-project/screenshot-note-browser (větev feat/browser-context-p3), rozšíření /Users/janprasil/git/personal/screenshot-note-project/screenshot-note-chrome-extension.

Nejdřív přečti v rozšíření: docs/MAC-PHASES.md (společná pravidla + F3), docs/PRIVACY.md (Redakce, Cloud), CapturePolicy v src/lib/types.ts a src/lib/defaults.ts. V Mac repu: kde se ukládá konfigurace a složky a jejich UI (grep -n v Interface.swift a main.swift), BrowserBridge.swift a změny z F2 (git diff main --stat).

Pravidla: bez subagentů, jen review na konci. Šetři kontext.

Úkol:
1. Do konfigurace lokální složky přidej politiku kontextu podle PRIVACY.md: přikládat konzoli, network, mapu elementů, texty prvků, těla; skrývat cookies, autorizační hlavičky, vlastní hlavičky (seznam), citlivé query parametry. Výchozí hodnoty jako DEFAULT_POLICY. Codable, zpětně kompatibilní.
2. Cloudové složky: kontext vypnutý a přepínač zatím neaktivní s vysvětlením „připravujeme“. Upload je F6.
3. capture.request posílá politiku vybrané konfigurace.
4. Komposer: na náhledu obrázku malý odznak, že má kontext (počet chyb a selhaných requestů ze summary). Akce „Odebrat kontext“ u obrázku.
5. Lokalizace cs/en, design podle DESIGN.md.
6. Self-test: serializace politiky, starý config bez politiky, mapování na JSON pro protokol.

Předávka z F2:
<doplní F2>

Na konci postupuj podle „Na konci fáze“ v docs/MAC-PHASES.md a vypiš prompt pro F4.
```

---

## F4: Přesný výřez snímku a mapování elementů

**Výsledek:** ke každému snímku s kontextem je známý přesný výřez na obrazovce a prvky z mapy se přepočítají na pixely obrázku.

### Šablona promptu F4

```text
Pracujeme na propojení Screenshot Note (macOS) s Chrome rozšířením, fáze F4 z 5: přesný výřez snímku a mapování elementů.

Repa: Mac worktree /Users/janprasil/git/personal/screenshot-note-project/screenshot-note-browser (větev feat/browser-context-p4), rozšíření /Users/janprasil/git/personal/screenshot-note-project/screenshot-note-chrome-extension.

Nejdřív přečti v rozšíření: docs/MAC-PHASES.md (společná pravidla + F4), docs/PROTOCOL.md (Mapování elementů). V Mac repu: funkci snímání v `Sources/ScreenshotNoteKit/App/AppDelegate.swift` (grep -n screencapture) a uložení kontextu z F2.

Problém: `screencapture -i` neřekne, jaký výřez uživatel vybral.

Na začátku se zeptej Jana (AskUserQuestion), kterou variantu chce:
A) Rychlá: ve stejný okamžik potichu sejmout celý displej (ScreenCaptureKit, macOS 13 → SCScreenshotManager až od 14, jinak CGDisplayCreateImage) a výřez v něm najít přesnou shodou pixelů. Nejdřív řádek, pak ověření bloku.
B) Správná: vlastní výběr oblasti (overlay přes všechny displeje, křížek, lupa, Esc, výběr okna mezerníkem) a snímek přes ScreenCaptureKit. Nahradí `screencapture -i`.

Úkol po rozhodnutí:
1. Implementuj zvolenou variantu. Ke kontextu obrázku ulož captureRect (globální body, počátek vlevo nahoře), backingScale a měřítko obrázku.
2. Přepočet elementů podle PROTOCOL.md: zoom = devicePixelRatio / backingScale, posun obsahu okna. Pokud je povolené Accessibility, použij přesnou pozici AXWebArea, jinak výpočet. Výsledek je obdélník v pixelech obrázku, prvky mimo výřez vynech.
3. Self-test výpočtu s pevnými čísly (zoom 1 a 1,25, Retina i ne-Retina, výřez posunutý). U varianty A test hledání výřezu na syntetickém obrázku.
4. Ruční ověření pro Jana: testovací stránka a ladicí vykreslení obdélníků elementů do kopie snímku (jen v debug režimu).

Předávka z F3:
<doplní F3>

Na konci postupuj podle „Na konci fáze“ v docs/MAC-PHASES.md a vypiš prompt pro F5.
```

---

## F5: Anotace „Element“

**Výsledek:** v editoru anotací vyberu prvek stránky kliknutím, popíšu ho a do Markdownu se vyexportuje se selektorem.

### Šablona promptu F5

```text
Pracujeme na propojení Screenshot Note (macOS) s Chrome rozšířením, fáze F5 z 5: anotace Element.

Repa: Mac worktree /Users/janprasil/git/personal/screenshot-note-project/screenshot-note-browser (větev feat/browser-context-p5), rozšíření /Users/janprasil/git/personal/screenshot-note-project/screenshot-note-chrome-extension.

Nejdřív přečti v rozšíření: docs/MAC-PHASES.md (společná pravidla + F5), docs/PROTOCOL.md (Mapování, anotace). V Mac repu: `Sources/ScreenshotNoteKit/Annotations/Annotations.swift` a `AnnotationGeometry.swift` celé (jsou malé), přepočet elementů z F4, export poznámek pod obrázkem.

Pravidla: bez subagentů, jen review na konci. Šetři kontext.

Úkol:
1. Nový nástroj Tool.element, aktivní jen u obrázku s mapou elementů (jinak skrytý).
2. Hover zvýrazní nejmenší prvek pod kurzorem. Klik ho vybere, opakovaný klik nebo ⌥ vybere rodiče (podle obsahování obdélníků a depth). Esc zruší.
3. Po výběru vznikne Mark s obdélníkem, číslem a uloženými daty (selector, tag, name, text). Popis se edituje jako u textu nebo v popoveru. Codable musí zůstat zpětně kompatibilní (AnnotationDocument ze starší verze se načte).
4. Vykreslení: přerušovaný obdélník + číselný odznak. Ořez (crop) mapu posune nebo ořízne.
5. Export pod obrázek: `- **[1] Element** \`selector\` „name/text“: popis`, pořadí podle čísla.
6. Self-test: hit-test (nejmenší, rodič), crop, Codable starý dokument, export řádků.

Předávka z F4:
<doplní F4>

Na konci: aktualizuj docs/PLAN.md, shrň Janovi celé propojení (co ručně otestovat end-to-end) a vypiš prompt pro F6 (cloud a šifrování) jen jako návrh, nespouštěj.
```

---

## F6 (později): Cloud a šifrování

Mimo tento běh. Vyžaduje web repo (upload nového typu souboru, evidence
kapacity, zobrazení na webu a v MCP) a rozhodnutí o šifrování z PRIVACY.md.
Prompt vygeneruje F5.
