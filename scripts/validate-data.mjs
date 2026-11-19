// Controlla che data.json rispetti la struttura (versione 2). Uso: node scripts/validate-data.mjs [percorso]
import { readFileSync } from "node:fs";

const path = process.argv[2] || "data.json";
const errors = [];
let d;
try {
  d = JSON.parse(readFileSync(path, "utf8"));
} catch (e) {
  console.error(`❌ ${path} non è un JSON valido: ${e.message}`);
  process.exit(1);
}

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "");
const arr = (v, where) => { if (!Array.isArray(v)) { errors.push(`${where} deve essere un elenco`); return []; } return v; };
const uniq = (list, where) => {
  const seen = new Set();
  list.forEach((x) => { if (seen.has(x?.id)) errors.push(`${where}: id duplicato "${x.id}"`); seen.add(x?.id); });
};
const OWNERS = ["Andrea", "Agente", "Ibrido"];
const STATUSES = ["todo", "doing", "done"];
const PRIORITIES = ["alta", "media", "bassa"];
const LAUNCH = "m-launch";

if (d.version !== 2) errors.push("version deve essere 2");
if (d.updatedAt && isNaN(Date.parse(d.updatedAt))) errors.push("updatedAt non è una data ISO valida");
if (typeof d.launched !== "boolean") errors.push("launched deve essere true o false");

// aree e traguardi
const areas = arr(d.areas, "areas");
const areaIds = new Set(areas.map((a) => a.id));
const msArea = new Map();   // id traguardo -> area
areas.forEach((a, i) => {
  const w = `areas[${i}]`;
  if (!isStr(a.id)) errors.push(`${w}: id mancante`);
  if (!isStr(a.name)) errors.push(`${w}: name mancante`);
  const ms = arr(a.milestones, `${w}.milestones`);
  ms.forEach((m, k) => {
    if (!isStr(m.id) || !isStr(m.name)) errors.push(`${w}.milestones[${k}]: servono id e name`);
    if (msArea.has(m.id) || m.id === LAUNCH) errors.push(`${w}.milestones[${k}]: id "${m.id}" già usato`);
    msArea.set(m.id, a.id);
  });
  if (!Number.isInteger(a.progress) || a.progress < 0 || a.progress > ms.length) errors.push(`${w}: progress deve essere un intero tra 0 e ${ms.length}`);
  arr(a.order, `${w}.order`).forEach((k) => { if (!/^[ga]:.+/.test(k)) errors.push(`${w}.order: "${k}" deve iniziare con "g:" o "a:"`); });
});
uniq(areas, "areas");
const msOk = (id, area) => !id || id === LAUNCH || msArea.get(id) === area;

// gruppi
const groups = arr(d.groups, "groups");
groups.forEach((g, i) => {
  if (!isStr(g.id) || !isStr(g.name)) errors.push(`groups[${i}]: servono id e name`);
  if (!areaIds.has(g.area)) errors.push(`groups[${i}]: area "${g.area}" inesistente`);
});
uniq(groups, "groups");

// diario: { id, date, text, detail?, files: [id di file dello stesso contenitore], source? }
function checkLog(list, where, files) {
  arr(list, where).forEach((e, k) => {
    const w = `${where}[${k}]`;
    if (!isStr(e.id) || !isStr(e.text)) errors.push(`${w}: servono id e text`);
    if (!isDate(e.date)) errors.push(`${w}: date deve essere AAAA-MM-GG`);
    if (e.detail !== undefined && typeof e.detail !== "string") errors.push(`${w}: detail deve essere un testo`);
    if (e.source !== undefined && !["dashboard", "chat"].includes(e.source)) errors.push(`${w}: source deve essere "dashboard" o "chat"`);
    (e.files ?? []).forEach((id) => { if (!files.some((f) => f.id === id)) errors.push(`${w}: allegato "${id}" non è tra i file`); });
  });
}

// attività
const acts = arr(d.activities, "activities");
acts.forEach((a, i) => {
  const w = `activities[${i}] (${a.name || a.id})`;
  if (!isStr(a.id) || !isStr(a.name)) errors.push(`${w}: servono id e name`);
  if (!areaIds.has(a.area)) errors.push(`${w}: area "${a.area}" inesistente`);
  if (a.group && !groups.some((g) => g.id === a.group && g.area === a.area)) errors.push(`${w}: gruppo "${a.group}" inesistente in questa area`);
  if (!OWNERS.includes(a.owner)) errors.push(`${w}: owner deve essere ${OWNERS.join(", ")}`);
  if (!STATUSES.includes(a.status)) errors.push(`${w}: status deve essere todo, doing o done`);
  if (a.doneKind !== undefined && !["paused", "ended"].includes(a.doneKind)) errors.push(`${w}: doneKind deve essere "paused" (sospesa) o "ended" (terminata)`);
  if (!msOk(a.until, a.area)) errors.push(`${w}: until "${a.until}" non è un traguardo della sua area`);
  if (typeof a.note !== "string") errors.push(`${w}: note deve essere un testo`);
  checkLog(a.log ?? [], `${w}.log`, a.files ?? []);
  arr(a.tasks, `${w}.tasks`).forEach((t, k) => {
    const tw = `${w}.tasks[${k}]`;
    if (!isStr(t.id) || !isStr(t.text)) errors.push(`${tw}: servono id e text`);
    if (typeof t.done !== "boolean") errors.push(`${tw}: done deve essere true o false`);
    if (!PRIORITIES.includes(t.priority)) errors.push(`${tw}: priority deve essere alta, media o bassa`);
    if (t.due && !isDate(t.due)) errors.push(`${tw}: due deve essere AAAA-MM-GG o vuoto`);
    if (t.doneAt && !isDate(t.doneAt)) errors.push(`${tw}: doneAt deve essere AAAA-MM-GG`);
    if (!msOk(t.milestone, a.area)) errors.push(`${tw}: milestone "${t.milestone}" non è un traguardo dell'area`);
  });
  arr(a.open, `${w}.open`).forEach((o, k) => {
    if (!isStr(o.id) || !isStr(o.text) || typeof o.done !== "boolean") errors.push(`${w}.open[${k}]: servono id, text e done`);
  });
  arr(a.decisions, `${w}.decisions`).forEach((x, k) => {
    if (!isStr(x.id) || !isStr(x.text) || !isDate(x.date)) errors.push(`${w}.decisions[${k}]: servono id, text e date AAAA-MM-GG`);
  });
  arr(a.files, `${w}.files`).forEach((f, k) => {
    if (!isStr(f.id) || !isStr(f.name) || !isStr(f.path)) errors.push(`${w}.files[${k}]: servono id, name e path`);
  });
  ["log", "tasks", "open", "decisions", "files"].forEach((s) => Array.isArray(a[s]) && uniq(a[s], `${w}.${s}`));
});
uniq(acts, "activities");

// in comune
checkLog(d.log ?? [], "log", d.files ?? []);
if (Array.isArray(d.log)) uniq(d.log, "log");
arr(d.files ?? [], "files").forEach((f, k) => { if (!isStr(f.id) || !isStr(f.name) || !isStr(f.path)) errors.push(`files[${k}]: servono id, name e path`); });
for (const list of ["tasks", "open", "ideas"]) {
  arr(d[list], list).forEach((x, i) => {
    if (!isStr(x.id)) errors.push(`${list}[${i}]: id mancante`);
    if (!isStr(x.text)) errors.push(`${list}[${i}]: text mancante`);
    if (typeof x.done !== "boolean") errors.push(`${list}[${i}]: done deve essere true o false`);
  });
  if (Array.isArray(d[list])) uniq(d[list], list);
}
arr(d.decisions, "decisions").forEach((x, i) => {
  if (!isStr(x.id)) errors.push(`decisions[${i}]: id mancante`);
  if (!isDate(x.date)) errors.push(`decisions[${i}]: date deve essere AAAA-MM-GG`);
  if (!isStr(x.text)) errors.push(`decisions[${i}]: text mancante`);
});
if (Array.isArray(d.decisions)) uniq(d.decisions, "decisions");

// archivio: niente si cancella, si sposta qui { id, kind, from, item, archivedAt, reason }
const KINDS = ["tasks", "open", "ideas", "decisions", "log", "files", "activity"];
const REASONS = ["deleted", "done", "superseded"];
const archive = arr(d.archive ?? [], "archive");
archive.forEach((z, i) => {
  const w = `archive[${i}]`;
  if (!isStr(z.id)) errors.push(`${w}: id mancante`);
  if (!KINDS.includes(z.kind)) errors.push(`${w}: kind deve essere ${KINDS.join(", ")}`);
  if (typeof z.from !== "string") errors.push(`${w}: from deve essere l'id di un'attività o ""`);
  if (!z.item || typeof z.item !== "object" || !isStr(z.item.id)) errors.push(`${w}: item deve essere l'elemento archiviato, con il suo id`);
  if (!z.archivedAt || isNaN(Date.parse(z.archivedAt))) errors.push(`${w}: archivedAt deve essere una data ISO`);
  if (!REASONS.includes(z.reason)) errors.push(`${w}: reason deve essere ${REASONS.join(", ")}`);
  if (z.reason === "superseded" && z.kind !== "decisions") errors.push(`${w}: solo le decisioni possono essere "superseded"`);
});
uniq(archive, "archive");

if (errors.length) {
  console.error(`❌ ${path}: ${errors.length} errori\n - ` + errors.join("\n - "));
  process.exit(1);
}
const nLog = (d.log?.length || 0) + acts.reduce((n, a) => n + (a.log?.length || 0), 0);
console.log(`✅ ${path} valido (${areas.length} aree, ${groups.length} gruppi, ${acts.length} attività, ${nLog} voci di diario, ${d.decisions.length} decisioni in comune, ${archive.length} in archivio)`);
