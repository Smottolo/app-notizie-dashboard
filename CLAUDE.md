# Dashboard "App notizie": regole per Claude (VS Code)

Web app statica (HTML/CSS/JS puro, **nessun build, nessuna dipendenza npm**) pubblicata con GitHub Pages
dal branch `main`, cartella radice: https://smottolo.github.io/app-notizie-dashboard/
Ogni push su `main` va online in circa un minuto.

## Chi fa cosa

| File | Proprietario | Note |
|---|---|---|
| `js/ui.js` | **interfaccia: tuo** | riscrivibile, rispettando il contratto qui sotto |
| `css/style.css` | **interfaccia: tuo** | |
| `index.html` | **interfaccia: tuo** | mantieni l'ordine degli script e `<div id="app">` |
| `js/store.js`, `js/config.js`, `js/main.js` | infrastruttura | non modificare senza chiedere |
| `data.json` | dati veri | non modificarlo per fare prove (vedi "Sviluppo in locale") |
| `scripts/`, `.github/`, `docs/` | infrastruttura | |

Se puoi dividere la UI in più file (es. `js/ui/*.js`), aggiungili in `index.html` **prima** di `js/main.js`.

## Contratto della UI

`js/ui.js` deve definire:

```js
window.UI = {
  mount(rootEl, store) {},   // una volta all'avvio: disegna la struttura, aggancia gli eventi
  render(data, status) {},   // a ogni cambiamento di dati o di stato di salvataggio
};
```

- `data` è lo stato corrente (vedi struttura in `docs/ISTRUZIONI-CHAT-CLAUDE.md`). **Sola lettura.**
- `status` = `{ mode: "github"|"local", saving, pending, error, lastSync, canWrite }`.
- Per modificare i dati usa **solo** le azioni di `window.Store` (salvano da sole, con merge sicuro):
  `setPhase(name)`, `cycleFileStatus(id)`, `setFileStatus(id, s)`,
  `addItem(list, text)`, `toggleItem(list, id)`, `editItem(list, id, text)`, `removeItem(list, id) → undo()`,
  `addDecision(text, date?)`, `editDecision(id, {text, date})`, `removeDecision(id) → undo()`,
  `hasToken()`, `setToken(t)`, `clearToken()`, `checkToken() → Promise<{ok, error}>`, `refresh()`, `flush()`.
  (`list` = `"tasks"` | `"open"` | `"ideas"`).
- `render` viene chiamata spesso (anche mentre si salva): non ridisegnare i campi di testo che l'utente
  sta usando, o perde il cursore. La versione attuale tiene i form fuori dalle parti ridisegnate.
- Mai chiamare l'API di GitHub dalla UI, mai salvare dati in `localStorage` (il token lo gestisce lo store).

## Requisiti di design

Stile Apple: font di sistema (`-apple-system`), card bianche arrotondate, sfondo `#f5f5f7`,
tema chiaro/scuro automatico (`prefers-color-scheme`), responsive (iPhone prima di tutto, poi Mac),
rispetto delle safe area dell'iPhone, bersagli di tocco ≥ 44px.

Contenuti: riepilogo (file completati x/16 con anello, task aperti, punti da definire, fase attuale);
barra delle fasi cliccabile; griglia dei 16 file (un tocco: da fare → in corso → fatto) con filtro
Tutti / Notizie / App (in base all'inizio di `branch`); liste Task, Punti da definire, Idee (aggiungi,
spunta, modifica, elimina con annulla); registro decisioni (data + testo); link alla lavagna (`boardUrl`);
impostazioni per inserire il token; indicatore dello stato di salvataggio ed errori.

## Sviluppo in locale

```bash
python3 -m http.server 8000
```
Poi apri http://localhost:8000: su localhost l'app è in **modalità locale**, legge `./data.json` e
**non salva su GitHub** (modifiche solo in memoria). Per provare il salvataggio vero: `http://localhost:8000/?live=1`.

Controllo dei dati: `node scripts/validate-data.mjs`
