# Screenshot Note Chrome extension — pokyny pro agenty

- Komunikuj s Janem česky. Komentáře v kódu piš jako krátké věty.
- Před prací přečti `README.md`, `docs/PLAN.md` a `docs/PROTOCOL.md`. Po dokončení celku aktualizuj stav v `docs/PLAN.md`.
- `docs/PROTOCOL.md` je kontrakt s Mac appkou `screenshot-note`. Změnu formátu zpráv nebo bundle udělej zpětně kompatibilně, nebo zvyš `PROTOCOL_VERSION`.
- Redakce probíhá v rozšíření ještě před odesláním dat. Neposílej neredigovaná data mimo prohlížeč a nepiš je na disk.
- Před commitem spusť `npm run check`. Odpovědi do PR vláken nepiš ani nepostuj.
- Sousední repozitáře (`screenshot-note`, `screenshot-note-web`) čti jako podklady. Změny v nich vyžadují samostatné zadání.
