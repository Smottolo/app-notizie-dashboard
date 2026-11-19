# Dashboard "App notizie": regole per Claude (VS Code)

Web app statica (HTML/CSS/JS puro, **nessun build, nessuna dipendenza npm**) pubblicata con GitHub Pages
dal branch `main`, cartella radice: https://smottolo.github.io/app-notizie-dashboard/
Ogni push su `main` va online in circa un minuto.

## Chi fa cosa

| File | Proprietario | Note |
|---|---|---|
| `js/ui.js` | **interfaccia: tuo** | riscrivibile, rispettando il contratto qui sotto |
| `js/ui/model.js` | **interfaccia: tuo** | letture comode su `Store.data` + azioni; nessun dato proprio |
| `css/style.css` | **interfaccia: tuo** | |
| `index.html` | **interfaccia: tuo** | mantieni l'ordine degli script e `<div id="app">` |
| `js/store.js`, `js/config.js`, `js/main.js` | infrastruttura | non modificare senza chiedere |
| `data.json` | dati veri | non modificarlo per fare prove (vedi "Sviluppo in locale") |
| `uploads/` | dati veri | file caricati dalla dashboard (repo **pubblico**: sono pubblici) |
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
- `status` = `{ mode: "github"|"local", saving, uploading, pending, error, lastSync, lastSaved, canWrite }`.
- Quando cambi CSS/JS, incrementa `?v=` negli URL in `index.html` (Pages tiene i file in cache 10 minuti).
- Per modificare i dati usa **solo** le azioni di `window.Store` (salvano da sole, con merge sicuro;
  le `remove…` ritornano `undo()`). L'elenco completo è in testa a `js/store.js`:
  - in comune: `addItem/toggleItem/editItem/removeItem(list, …)` (`list` = `"tasks"` | `"open"` | `"ideas"`),
    `addDecision/editDecision/removeDecision`;
  - traguardi: `setProgress(areaId, n)`, `setLaunched(bool)`, `setMilestones(areaId, [{id?, name}])`;
  - gruppi: `addGroup`, `renameGroup`, `removeGroup`, `moveBlock(areaId, key, dir)`;
  - attività: `addActivity`, `editActivity(id, patch)`, `removeActivity`, `setActivityStatus(id, status, doneKind?)`, `setNote`
    (stato nei dati: `todo` Da fare / `doing` Attiva / `done` + `doneKind` `paused` Sospesa o `ended` Terminata);
  - archivio: le `remove…` non cancellano, spostano in `data.archive`; `supersedeDecision(actId, id)`,
    `restore(archiveId)`, `purge(archiveId)` (elimina per sempre);
  - dentro un'attività: `addSub/editSub/removeSub(id, sub, …)` (`sub` = `"log"` | `"tasks"` | `"open"` | `"decisions"` | `"files"`;
    con `id` = `""` si agisce sul diario e sui file in comune),
    `uploadFiles(id, FileList) → Promise<{ok, errors}>`, `fileUrl(file)`;
  - token e sync: `hasToken()`, `setToken(t)`, `clearToken()`, `checkToken()`, `refresh()`, `flush()`.
- L'interfaccia di solito passa da `window.Model` (`js/ui/model.js`), che espone le stesse azioni con nomi comodi.
- `render` viene chiamata spesso (anche mentre si salva): non ridisegnare i campi di testo che l'utente
  sta usando, o perde il cursore. La versione attuale tiene i form fuori dalle parti ridisegnate.
- Mai chiamare l'API di GitHub dalla UI, mai salvare dati in `localStorage` (il token lo gestisce lo store).

## Requisiti di design

Stile Apple: font di sistema (`-apple-system`), card bianche arrotondate, sfondo `#f5f5f7`,
tema chiaro/scuro automatico (`prefers-color-scheme`), responsive (iPhone prima di tutto, poi Mac),
rispetto delle safe area dell'iPhone, bersagli di tocco ≥ 44px.

La dashboard è una "scrivania" che ricalca la lavagna del progetto (stile approvato dall'utente: va mantenuto):
- **Timeline**: i traguardi di ogni area in sequenza + il Lancio comune; tocco = raggiunto (con i precedenti),
  tocco sull'ultimo raggiunto = annulla; foglio "Traguardi" per aggiungere, rinominare, eliminare e
  riordinare trascinando (maniglia ≡).
- **Diario del progetto** (il cuore, subito sotto la timeline): cose fatte e decisioni nello stesso flusso,
  raggruppate per giorno, con l'etichetta dell'attività; ultime 3 giornate + "Mostra tutto"; annotazione
  veloce (Fatto / Decisione). È quello che le chat di Claude aggiornano a fine sessione.
- Accanto: **Da decidere** in evidenza (punti aperti generali e delle attività), **Da fare** piccolo
  (task generali e delle attività in un'unica lista), **Parcheggio idee** richiudibile.
  Diario e Da decidere: su Mac altezza massima e scorrimento interno con sfumatura; su iPhone pagine ‹ 1 di 3 ›.
- Diario: il colore è dell'area (sull'etichetta dell'attività), il tipo di voce è un'icona (spunta = fatto, martelletto = decisione).
- **Stato delle attività**: controllo a segmenti Da fare (cerchio) · Attiva (pallino che pulsa) · Sospesa (spunta con freccia) |
  Terminata (spunta piena), con Sospesa e Terminata nello stesso posto; nelle card e nella pagina dell'attività.
- **Archivio** in fondo, discreto e richiudibile: completati, superate, eliminati, con "Ripristina".
- **Tre aree affiancate** sotto (App, Contenuti, Commerciale) con gruppi (intestazione a cartella, modificabili)
  e attività; pulsanti "+ Attività" e "+ Gruppo".
- **Pagina dell'attività** (`#/a/<id>`): chi se ne occupa, stato, orizzonte; diario a sinistra (con dettagli
  e allegati), file al centro, decisioni / da decidere / da fare / note a destra.
- In alto: pulsante **Lavagna** (link a `boardUrl`), impostazioni per il token, stato del salvataggio ed errori.

## Sviluppo in locale

```bash
python3 -m http.server 8000
```
Poi apri http://localhost:8000: su localhost l'app è in **modalità locale**, legge `./data.json` e
**non salva su GitHub** (modifiche solo in memoria). Per provare il salvataggio vero: `http://localhost:8000/?live=1`.

Controllo dei dati: `node scripts/validate-data.mjs`
