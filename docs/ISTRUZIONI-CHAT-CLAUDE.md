# Come aggiornare la dashboard da una chat di claude.ai

La dashboard (https://smottolo.github.io/app-notizie-dashboard/) legge **un solo file**: `data.json`
nella radice del repo `Smottolo/app-notizie-dashboard`, branch `main`.
Per aggiornarla basta modificare quel file e fare commit + push. Nessun altro servizio.

## Procedura (sempre in quest'ordine)

1. **Leggi la versione più recente** di `data.json` dal branch `main` subito prima di modificarlo
   (l'utente può averlo cambiato dall'app pochi secondi fa). Non lavorare mai su una copia vecchia.
2. **Modifica solo i campi necessari.** Non riordinare, non riformattare, non rigenerare il file intero
   da zero, non toccare elementi che non c'entrano.
3. **Aggiorna `updatedAt`** con data e ora attuali in formato ISO (es. `2026-11-18T14:30:00.000Z`).
4. **Commit su `main`** con un messaggio chiaro che inizi con `Chat:`, es.
   `Chat: Fonti → in corso, nuovo task "Elenco fonti RSS"`.
5. Se il push viene rifiutato perché il file è cambiato nel frattempo: rileggi `data.json`,
   riapplica le stesse modifiche sulla versione nuova e riprova. Non forzare mai il push.
6. Dopo il push, GitHub esegue il controllo "Controllo data.json"
   (`node scripts/validate-data.mjs`): se fallisce, il file non rispetta la struttura qui sotto
   e va corretto subito.

## Come è organizzato il progetto

- **3 aree**: `app` (App), `content` (Contenuti), `commercial` (Commerciale). Le aree sono fisse.
- Ogni area ha i suoi **traguardi** in ordine di tempo; `progress` dice quanti sono stati raggiunti
  (sempre dall'inizio: `progress: 2` = raggiunti i primi due). Il **Lancio** (`m-launch`) è comune
  a tutte le aree e si segna con `launched: true`.
- Dentro un'area ci sono **gruppi** (es. "Stile e design") e **attività**. Un'attività può stare in un
  gruppo oppure no (in quel caso ha una card a sé, allo stesso livello dei gruppi).
- Ogni attività ha i suoi **task**, **punti da decidere**, **decisioni**, **file** e **note**.
- **In comune**: task generali, punti da definire, idee e registro decisioni che non appartengono
  a un'attività.

## Struttura (versione 2)

```jsonc
{
  "version": 2,
  "updatedAt": "2026-11-18T10:00:00.000Z",
  "boardUrl": "https://claude.ai/artifact/…",
  "launched": false,
  "areas": [
    {
      "id": "app", "name": "App",
      "progress": 0,                                         // traguardi raggiunti, dall'inizio
      "milestones": [ { "id": "m-app-1", "name": "Design approvato" } ],
      "order": ["g:g-ssd", "a:f10"]                          // ordine dei blocchi: g:<gruppo> o a:<attività senza gruppo>
    }
  ],
  "groups": [ { "id": "g-ssd", "area": "app", "name": "Stile e design" } ],
  "activities": [
    {
      "id": "f7", "area": "app", "group": "g-ssd",           // group "" = senza gruppo
      "name": "Identità visiva",
      "owner": "Ibrido",                                     // "Andrea" | "Agente" | "Ibrido"
      "hint": "",                                            // nota breve, facoltativa
      "until": "m-app-1",                                    // traguardo con cui si chiude ("" = continua dopo il lancio)
      "status": "todo",                                      // "todo" | "doing" | "done"
      "note": "",
      "tasks": [ { "id": "t…", "text": "…", "priority": "media", "due": "", "milestone": "", "done": false, "created": 1763459000000 } ],
      "open": [ { "id": "o…", "text": "…", "done": false } ],
      "decisions": [ { "id": "d…", "date": "AAAA-MM-GG", "text": "…" } ],
      "files": [ { "id": "u…", "name": "logo.png", "size": 1234, "type": "image/png", "path": "uploads/f7/…", "added": "…" } ]
    }
  ],
  "tasks": [ { "id": "t…", "text": "…", "done": false } ],    // in comune
  "open":  [ { "id": "o…", "text": "…", "done": false } ],    // in comune: punti da definire
  "ideas": [ { "id": "i…", "text": "…", "done": false } ],
  "decisions": [ { "id": "d…", "date": "AAAA-MM-GG", "text": "…" } ]
}
```

Regole:
- Ogni elemento nuovo ha un `id` **unico**: prefisso (`t` task, `o` punti, `i` idee, `d` decisioni,
  `g` gruppi, `x` attività, `m` traguardi) + data e ora, es. `t20261118a`. Non riutilizzare id esistenti
  e non cambiare quelli che ci sono (le attività `f1`…`f16` hanno gli id storici).
- Task: `priority` è `"alta"`, `"media"` o `"bassa"`; `due` è `"AAAA-MM-GG"` o `""`;
  `milestone` è l'id di un traguardo **della stessa area** dell'attività, `"m-launch"` oppure `""`.
- Per completare un task o un punto: `"done": true` (non cancellarlo, a meno che l'utente lo chieda).
- Le decisioni vanno in fondo all'elenco, con la data di oggi.
- **Nuova attività senza gruppo**: aggiungila in `activities` **e** aggiungi `"a:<id>"` in fondo
  all'`order` della sua area. Nuovo gruppo: aggiungilo in `groups` **e** aggiungi `"g:<id>"` all'`order`.
  (Se te ne dimentichi, la dashboard lo sistema da sola, ma meglio farlo.)
- Se elimini un traguardo, togli il suo id anche da `until` e dai `milestone` dei task che lo usano.
- I **file** si caricano dalla dashboard (finiscono in `uploads/`). Da una chat non aggiungere elementi
  in `files` senza aver caricato davvero il file a quel percorso.
- Il file deve restare JSON valido, in UTF-8, con rientro di 2 spazi.

## Esempi di richieste tipiche

| L'utente dice | Cosa cambiare |
|---|---|
| "Sto lavorando al Motore AI" | attività con `name` "Motore AI" → `"status": "doing"` |
| "Il file Fonti è finito" | attività "Fonti" → `"status": "done"` |
| "Aggiungi un task al Motore AI: scegliere il modello, urgente, entro il primo articolo" | in quell'attività, `tasks` += `{ "id": "t…", "text": "Scegliere il modello", "priority": "alta", "due": "", "milestone": "m-con-2", "done": false, "created": <ms> }` |
| "Segna questa decisione sulle fonti: …" | attività "Fonti" → `decisions` += `{ "id": "d…", "date": "<oggi>", "text": "…" }` (se è generale: `decisions` in fondo al file) |
| "Abbiamo raggiunto la linea editoriale" | area `content` → `"progress"` = posizione del traguardo + 1 (qui `1`) |
| "Aggiungi un traguardo dopo Su TestFlight: Beta pubblica" | area `app` → `milestones` += `{ "id": "m…", "name": "Beta pubblica" }` dopo quello giusto |
| "Nuova attività commerciale: Partnership, se ne occupa Andrea" | `activities` += attività con `"area": "commercial"`, `"group": ""`, `"owner": "Andrea"` e tutti gli elenchi vuoti; `order` dell'area += `"a:<id>"` |
