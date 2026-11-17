// Migrazione una tantum di data.json dalla struttura 1 (fasi + 16 file) alla 2 (aree, traguardi, gruppi, attività).
// Uso: node scripts/migrate-v2.mjs [percorso]   (riscrive il file; se è già alla versione 2 non fa nulla)
// Le attività vengono dalla lavagna del progetto; lo stato dei file f1…f16 viene conservato.
import { readFileSync, writeFileSync } from "node:fs";

const path = process.argv[2] || "data.json";
const old = JSON.parse(readFileSync(path, "utf8"));
if (old.version === 2) { console.log("Già alla versione 2: niente da fare."); process.exit(0); }

const statusOf = (id) => old.files?.find((f) => f.id === id)?.status || "todo";
const A = (id, area, group, name, owner, hint = "", until = "") => ({
  id, area, group, name, owner, hint, until, status: statusOf(id), note: "",
  tasks: [], open: [], decisions: [], files: [],
});

const data = {
  version: 2,
  updatedAt: new Date().toISOString(),
  boardUrl: old.boardUrl || "",
  launched: false,
  areas: [
    { id: "app", name: "App", progress: 0,
      milestones: [
        { id: "m-app-1", name: "Design approvato" },
        { id: "m-app-2", name: "Prima versione sul telefono" },
        { id: "m-app-3", name: "Su TestFlight" },
      ],
      order: ["g:g-ssd", "a:f10", "g:g-acc", "a:f13", "g:g-tec", "a:f16"] },
    { id: "content", name: "Contenuti", progress: 0,
      milestones: [
        { id: "m-con-1", name: "Linea editoriale" },
        { id: "m-con-2", name: "Primo articolo" },
        { id: "m-con-3", name: "Articoli convincenti" },
        { id: "m-con-4", name: "Motore automatico ogni giorno" },
        { id: "m-con-5", name: "Pronto per il pubblico" },
      ],
      order: ["a:f1", "g:g-pro", "a:f6"] },
    { id: "commercial", name: "Commerciale", progress: 0,
      milestones: [
        { id: "m-com-1", name: "Interviste fatte" },
        { id: "m-com-2", name: "Costo per articolo stimato" },
        { id: "m-com-3", name: "Modello di business deciso" },
        { id: "m-com-4", name: "Pronti a fatturare" },
      ],
      order: ["a:k1", "a:k2", "a:k3", "a:k4", "a:k5"] },
  ],
  groups: [
    { id: "g-ssd", area: "app", name: "Stile e design" },
    { id: "g-acc", area: "app", name: "Account e dati utente" },
    { id: "g-tec", area: "app", name: "Tecnologia" },
    { id: "g-pro", area: "content", name: "Produzione" },
  ],
  activities: [
    A("f7", "app", "g-ssd", "Identità visiva", "Ibrido", "", "m-app-1"),
    A("f8", "app", "g-ssd", "Design system", "Agente"),
    A("f9", "app", "g-ssd", "Mockup schermate chiave", "Ibrido", "", "m-app-1"),
    A("f10", "app", "", "Sezioni e navigazione", "Ibrido"),
    A("f11", "app", "g-acc", "Registrazione e login", "Agente", "", "m-app-3"),
    A("f12", "app", "g-acc", "Preferenze e notifiche", "Agente"),
    A("a1", "app", "g-acc", "Metriche e analisi", "Agente"),
    A("f13", "app", "", "Aspetti legali e privacy", "Ibrido", "Chiudere prima del lancio", "m-launch"),
    A("f14", "app", "g-tec", "Piattaforma (iOS, SwiftUI)", "Agente"),
    A("f15", "app", "g-tec", "Server e database", "Agente"),
    A("f16", "app", "", "Test e pubblicazione", "Ibrido"),
    A("f1", "content", "", "Argomenti", "Andrea", "Solo nazionale, per ora"),
    A("f2", "content", "g-pro", "Fonti", "Ibrido"),
    A("f3", "content", "g-pro", "Motore AI", "Agente"),
    A("f4", "content", "g-pro", "Regole editoriali", "Ibrido"),
    A("f5", "content", "g-pro", "Affidabilità ed etichette", "Agente"),
    A("c1", "content", "g-pro", "Controllo qualità e correzioni", "Ibrido"),
    A("f6", "content", "", "Aspetti legali (fonti e contenuti)", "Andrea", "Chiudere prima del lancio", "m-launch"),
    A("k1", "commercial", "", "Utenti e mercato", "Ibrido"),
    A("k2", "commercial", "", "Modello di business", "Andrea", "Abbozzo presto, decisione prima del lancio", "m-com-3"),
    A("k3", "commercial", "", "Costi e budget", "Ibrido", "Prima stima dal prototipo del motore"),
    A("k4", "commercial", "", "Lancio e crescita", "Ibrido"),
    A("k5", "commercial", "", "Forma giuridica", "Andrea", "", "m-com-4"),
  ],
  // "In comune": restano com'erano
  tasks: old.tasks || [],
  open: old.open || [],
  ideas: old.ideas || [],
  decisions: old.decisions || [],
};

writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
console.log(`✅ ${path} migrato alla versione 2 (${data.activities.length} attività, stati conservati da ${old.files?.length || 0} file)`);
