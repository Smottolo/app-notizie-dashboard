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
   `Chat: file 2 Fonti → done, aggiunta decisione sulle fonti RSS`.
5. Se il push viene rifiutato perché il file è cambiato nel frattempo: rileggi `data.json`,
   riapplica le stesse modifiche sulla versione nuova e riprova. Non forzare mai il push.
6. Dopo il push, GitHub esegue il controllo "Controllo data.json": se fallisce, il file non rispetta
   la struttura qui sotto e va corretto subito.

## Struttura

```jsonc
{
  "phase": "Pianificazione",                 // deve essere uno dei valori di "phases"
  "phases": ["Pianificazione","Progettazione","Sviluppo","Test","Lancio"],
  "updatedAt": "2026-11-17T10:00:00.000Z",
  "boardUrl": "https://claude.ai/artifact/…",
  "files": [ { "id": "f1", "n": 1, "name": "Argomenti", "branch": "Notizie", "status": "todo" } ],
  "tasks": [ { "id": "t…", "text": "…", "done": false } ],
  "open":  [ { "id": "o…", "text": "…", "done": false } ],   // punti da definire
  "ideas": [ { "id": "i…", "text": "…", "done": false } ],
  "decisions": [ { "id": "d…", "date": "AAAA-MM-GG", "text": "…" } ]
}
```

Regole:
- `files[].status` è solo `"todo"`, `"doing"` o `"done"`. Gli `id` dei file (`f1`…`f16`) non si cambiano.
- Ogni elemento nuovo ha un `id` **unico** nella sua lista: prefisso (`t` task, `o` punti, `i` idee,
  `d` decisioni) + data e ora, es. `t20261118a`, `d20261118b`. Non riutilizzare id esistenti.
- Per completare un task o un punto: `"done": true` (non cancellarlo, a meno che l'utente lo chieda).
- Le decisioni vanno in fondo all'elenco, con la data di oggi.
- Il file deve restare JSON valido, in UTF-8, con rientro di 2 spazi.

## Esempi di richieste tipiche

| L'utente dice | Cosa cambiare |
|---|---|
| "Il file Fonti è finito" | `files` → elemento `f2` → `"status": "done"` |
| "Sto lavorando al Motore AI" | `f3` → `"status": "doing"` |
| "Segna questa decisione: …" | aggiungi a `decisions` `{ "id": "d…", "date": "<oggi>", "text": "…" }` |
| "Aggiungi un task: …" | aggiungi a `tasks` `{ "id": "t…", "text": "…", "done": false }` |
| "Passiamo alla progettazione" | `"phase": "Progettazione"` |
