// Configurazione dell'infrastruttura. Non serve modificarla per lavorare sull'interfaccia.
window.APP_CONFIG = {
  owner: "Smottolo",
  repo: "app-notizie-dashboard",
  branch: "main",
  dataPath: "data.json",

  // Su localhost l'app lavora in "modalità locale": legge ./data.json e NON salva su GitHub
  // (le modifiche restano in memoria). Per provare il salvataggio vero in locale: ?live=1
  localMode:
    /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) &&
    !new URLSearchParams(location.search).has("live"),

  saveDelayMs: 1200,        // raggruppa i tocchi ravvicinati in un solo commit
  refreshEveryMs: 120000,   // ricarica periodica dei dati (anche quando torni sulla scheda)
};
