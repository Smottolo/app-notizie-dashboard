# App notizie · Dashboard di progetto

Web app: **https://smottolo.github.io/app-notizie-dashboard/**

- Dati: un solo file, [`data.json`](data.json) (struttura versione 2: aree, traguardi, gruppi, attività).
  I file caricati dalla dashboard vanno in `uploads/` (il repo è pubblico, quindi anche loro). Lo modificano sia l'app (tramite l'API di GitHub e un token
  salvato nel browser) sia le chat di Claude del progetto (commit + push).
- Ogni modifica è un commit: la cronologia del repo è anche la cronologia del progetto, e ogni versione si può recuperare.
- Le chat di claude.ai seguono [docs/ISTRUZIONI-CHAT-CLAUDE.md](docs/ISTRUZIONI-CHAT-CLAUDE.md).
- Chi sviluppa l'interfaccia segue [CLAUDE.md](CLAUDE.md).
