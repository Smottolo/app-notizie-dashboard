// Controlla che data.json rispetti la struttura. Uso: node scripts/validate-data.mjs [percorso]
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
const uniq = (arr, where) => {
  const seen = new Set();
  arr.forEach((x) => { if (seen.has(x.id)) errors.push(`${where}: id duplicato "${x.id}"`); seen.add(x.id); });
};

if (!Array.isArray(d.phases) || !d.phases.every(isStr)) errors.push("phases deve essere un elenco di testi");
if (!isStr(d.phase) || !d.phases?.includes(d.phase)) errors.push(`phase "${d.phase}" non è tra le phases`);
if (d.updatedAt && isNaN(Date.parse(d.updatedAt))) errors.push("updatedAt non è una data ISO valida");

if (!Array.isArray(d.files)) errors.push("files deve essere un elenco");
else {
  d.files.forEach((f, i) => {
    const w = `files[${i}]`;
    if (!/^f\d+$/.test(f.id ?? "")) errors.push(`${w}: id deve essere "f1", "f2"…`);
    if (!Number.isInteger(f.n)) errors.push(`${w}: n deve essere un numero intero`);
    if (!isStr(f.name)) errors.push(`${w}: name mancante`);
    if (!isStr(f.branch)) errors.push(`${w}: branch mancante`);
    if (!["todo", "doing", "done"].includes(f.status)) errors.push(`${w}: status deve essere todo, doing o done`);
  });
  uniq(d.files, "files");
}

for (const list of ["tasks", "open", "ideas"]) {
  if (!Array.isArray(d[list])) { errors.push(`${list} deve essere un elenco`); continue; }
  d[list].forEach((x, i) => {
    if (!isStr(x.id)) errors.push(`${list}[${i}]: id mancante`);
    if (!isStr(x.text)) errors.push(`${list}[${i}]: text mancante`);
    if (typeof x.done !== "boolean") errors.push(`${list}[${i}]: done deve essere true o false`);
  });
  uniq(d[list], list);
}

if (!Array.isArray(d.decisions)) errors.push("decisions deve essere un elenco");
else {
  d.decisions.forEach((x, i) => {
    if (!isStr(x.id)) errors.push(`decisions[${i}]: id mancante`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date ?? "")) errors.push(`decisions[${i}]: date deve essere AAAA-MM-GG`);
    if (!isStr(x.text)) errors.push(`decisions[${i}]: text mancante`);
  });
  uniq(d.decisions, "decisions");
}

if (errors.length) {
  console.error(`❌ ${path}: ${errors.length} errori\n - ` + errors.join("\n - "));
  process.exit(1);
}
console.log(`✅ ${path} valido (${d.files.length} file, ${d.tasks.length} task, ${d.open.length} punti, ${d.ideas.length} idee, ${d.decisions.length} decisioni)`);
