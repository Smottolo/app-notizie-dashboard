/*
 * store.js — livello dati della dashboard (INFRASTRUTTURA).
 *
 * - Legge data.json dall'API di GitHub (sempre la versione più recente, non la copia in cache di Pages).
 * - Salva con l'API Contents di GitHub usando il token salvato nel browser.
 * - Ogni modifica è un'operazione (funzione) messa in coda: al salvataggio la coda viene
 *   riapplicata sull'ultima versione remota, così le modifiche fatte nel frattempo dalle chat
 *   di claude.ai non vengono mai sovrascritte. In caso di conflitto (409) riprova da solo.
 * - I file caricati vanno nel repo, in uploads/<attività>/; data.json tiene solo il riferimento.
 *   ATTENZIONE: se il repo è pubblico, anche i file caricati lo sono.
 *
 * Struttura dei dati (versione 2): vedi docs/ISTRUZIONI-CHAT-CLAUDE.md.
 *
 * API pubblica (window.Store):
 *   Store.data / Store.status / Store.subscribe(fn) / Store.init() / Store.refresh() / Store.flush()
 *   Store.setToken(t) / clearToken() / hasToken() / checkToken() -> Promise<{ok, error?}>
 *   Store.fileUrl(file)                      -> URL per aprire un file caricato
 *
 *   Azioni (tutte salvano da sole; quelle "remove" ritornano una funzione undo()):
 *   In comune:   addItem(list, text) · toggleItem(list, id) · editItem(list, id, text) · removeItem(list, id)
 *                (list = "tasks" | "open" | "ideas")
 *                addDecision(text, date?) · editDecision(id, {text, date}) · removeDecision(id)
 *   Traguardi:   setProgress(areaId, n) · setLaunched(bool) · setMilestones(areaId, [{id?, name}])
 *   Gruppi:      addGroup(areaId, name) · renameGroup(id, name) · removeGroup(id) · moveBlock(areaId, key, dir)
 *   Attività:    addActivity({area, group, name, owner, hint, until}) · editActivity(id, patch) · removeActivity(id)
 *                setActivityStatus(id, status, doneKind?) · setNote(id, text)
 *                (status "done" + doneKind "paused" = sospesa, "ended" = terminata; senza doneKind vale "paused")
 *   Dentro un'attività (sub = "log" | "tasks" | "open" | "decisions" | "files"):
 *                addSub(id, sub, fields) · editSub(id, sub, itemId, patch) · removeSub(id, sub, itemId)
 *                Con id = "" si agisce sul diario e sui file "In comune" (solo sub "log" e "files").
 *                "log" è il diario delle cose fatte: { id, date, text, detail, files: [id file], source, created }
 *   File:        uploadFiles(id, FileList) -> Promise<{ok, errors, ids}>  (carica nel repo e aggiunge i riferimenti)
 *   Archivio:    niente si cancella davvero: le remove… spostano l'elemento in data.archive
 *                { id, kind, from, item, archivedAt, reason: "deleted"|"done"|"superseded", links? }
 *                (kind = "tasks"|"open"|"ideas"|"decisions"|"log"|"files"|"activity"; from = id attività o "").
 *                supersedeDecision(actId, id) · restore(archiveId) -> true|false · purge(archiveId) (elimina per sempre)
 *                Le stesse undo() ritornate dalle remove… sono un restore.
 */
(function () {
  const C = window.APP_CONFIG;
  const TOKEN_KEY = "appNotizie.githubToken";
  const LISTS = ["tasks", "open", "ideas"];
  const SUBS = ["log", "tasks", "open", "decisions", "files"];
  const TOP_SUBS = ["log", "files"];   // diario e file "In comune"
  const STATUSES = ["todo", "doing", "done"];
  const DONE_KINDS = ["paused", "ended"];   // per lo stato "done": sospesa o terminata
  const KINDS = ["tasks", "open", "ideas", "decisions", "log", "files", "activity"];
  const LAUNCH = "m-launch";
  const REPO_API = `https://api.github.com/repos/${C.owner}/${C.repo}`;
  const API = `${REPO_API}/contents/${C.dataPath}`;
  const MAX_FILE = 25 * 1024 * 1024;

  let data = null;
  let remote = null;      // ultima versione remota nota
  let sha = null;
  let queue = [];         // [{label, fn}] operazioni non ancora salvate
  let timer = null;
  let saving = false;
  let uploading = 0;
  let error = null;
  let lastSync = null;
  let lastSaved = null;
  const localUrls = new Map();      // modalità locale: id file -> object URL
  const pendingDeletes = new Map(); // percorso file -> momento in cui è stato tolto
  const subs = new Set();

  // ---------- utilità ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const newId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const b64decode = (b64) => {
    const bin = atob(b64.replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  };
  const b64encode = (str) => b64bytes(new TextEncoder().encode(str));
  function b64bytes(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const safeStorage = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const token = () => safeStorage.get(TOKEN_KEY);

  function status() {
    return {
      mode: C.localMode ? "local" : "github",
      saving: saving || uploading > 0,
      uploading,
      pending: queue.length,
      error,
      lastSync,
      lastSaved,
      canWrite: C.localMode || !!token(),
    };
  }
  function emit() {
    const s = status();
    subs.forEach((fn) => { try { fn(data, s); } catch (e) { console.error(e); } });
  }

  function normalize(d) {
    d.version ??= 2;
    d.launched ??= false;
    d.areas ??= [];
    d.areas.forEach((a) => { a.milestones ??= []; a.order ??= []; a.progress ??= 0; });
    d.groups ??= [];
    d.activities ??= [];
    d.activities.forEach((x) => {
      SUBS.forEach((s) => (x[s] ??= []));
      x.note ??= ""; x.status ??= "todo"; x.group ??= ""; x.hint ??= ""; x.until ??= ""; x.owner ??= "Ibrido";
      if (x.group && !d.groups.some((g) => g.id === x.group && g.area === x.area)) x.group = "";
    });
    LISTS.forEach((l) => (d[l] ??= []));
    d.decisions ??= [];
    TOP_SUBS.forEach((s) => (d[s] ??= []));
    d.archive ??= [];
    [d, ...d.activities].forEach((c) => c.log.forEach((e) => { e.files ??= []; e.detail ??= ""; }));
    fixOrder(d);
    return d;
  }
  /** l'ordine dei blocchi di ogni area contiene esattamente i suoi gruppi e le sue attività senza gruppo */
  function fixOrder(d) {
    for (const a of d.areas) {
      const valid = (k) => k.startsWith("g:")
        ? d.groups.some((g) => g.id === k.slice(2) && g.area === a.id)
        : d.activities.some((x) => x.id === k.slice(2) && x.area === a.id && !x.group);
      a.order = [...new Set(a.order)].filter(valid);
      d.groups.filter((g) => g.area === a.id && !a.order.includes("g:" + g.id)).forEach((g) => a.order.push("g:" + g.id));
      d.activities.filter((x) => x.area === a.id && !x.group && !a.order.includes("a:" + x.id)).forEach((x) => a.order.push("a:" + x.id));
    }
  }

  // ---------- rete ----------
  function headers(withAuth) {
    const h = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (withAuth && token()) h.Authorization = `Bearer ${token()}`;
    return h;
  }

  async function fetchRemote() {
    if (C.localMode) {
      const r = await fetch(`./${C.dataPath}?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`Impossibile leggere ${C.dataPath} (${r.status})`);
      return { json: normalize(await r.json()), sha: null };
    }
    let r = await fetch(`${API}?ref=${C.branch}&t=${Date.now()}`, { headers: headers(true), cache: "no-store" });
    if (r.status === 401 && token()) {
      error = "Token non valido o scaduto: inseriscilo di nuovo nelle impostazioni.";
      r = await fetch(`${API}?ref=${C.branch}&t=${Date.now()}`, { headers: headers(false), cache: "no-store" });
    }
    if (r.ok) {
      const j = await r.json();
      return { json: normalize(JSON.parse(b64decode(j.content))), sha: j.sha };
    }
    // Ripiego (es. limite di richieste senza token): copia pubblicata su Pages, solo lettura
    const p = await fetch(`./${C.dataPath}?t=${Date.now()}`, { cache: "no-store" });
    if (!p.ok) throw new Error(`GitHub ha risposto ${r.status}`);
    return { json: normalize(await p.json()), sha: null, fallback: true };
  }

  function rebuildLocal() {
    const d = clone(remote);
    for (const op of queue) op.fn(d);
    data = d;
  }

  async function refresh() {
    if (saving) return;
    try {
      const res = await fetchRemote();
      remote = res.json;
      if (res.sha) sha = res.sha;
      rebuildLocal();
      lastSync = new Date();
      if (!res.fallback && error && !error.startsWith("Token")) error = null;
    } catch (e) {
      error = e.message;
    }
    emit();
  }

  async function flush() {
    clearTimeout(timer);
    timer = null;
    if (!queue.length || saving) return;
    if (C.localMode) { remote = clone(data); queue = []; emit(); return; }
    if (!token()) { error = "Inserisci il token GitHub nelle impostazioni per salvare."; emit(); return; }

    saving = true; emit();
    const batch = queue.slice();
    let ok = false;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const res = await fetchRemote();       // sempre l'ultima versione remota
        if (!res.sha) throw new Error("Impossibile leggere la versione corrente da GitHub.");
        const next = clone(res.json);
        batch.forEach((op) => op.fn(next));
        next.updatedAt = new Date().toISOString();
        const labels = [...new Set(batch.map((o) => o.label))];
        const message = `Dashboard: ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ` (+${labels.length - 3})` : ""}`;
        const r = await fetch(API, {
          method: "PUT",
          headers: { ...headers(true), "Content-Type": "application/json" },
          body: JSON.stringify({ message, content: b64encode(JSON.stringify(next, null, 2) + "\n"), sha: res.sha, branch: C.branch }),
        });
        if (r.ok) {
          const j = await r.json();
          sha = j.content.sha;
          remote = next;
          queue = queue.slice(batch.length);   // operazioni arrivate durante il salvataggio restano in coda
          rebuildLocal();
          error = null;
          lastSync = lastSaved = new Date();
          ok = true;
          break;
        }
        if (r.status === 409 || r.status === 422) continue; // qualcuno ha salvato nel frattempo: riprova
        if (r.status === 401) throw new Error("Token non valido o scaduto: inseriscilo di nuovo nelle impostazioni.");
        if (r.status === 403 || r.status === 404) throw new Error("Il token non ha il permesso di scrivere su questo repo.");
        throw new Error(`Salvataggio non riuscito (GitHub ${r.status}).`);
      }
      if (!ok) throw new Error("Troppi conflitti, riprovo tra poco.");
    } catch (e) {
      error = e.message;
    } finally {
      saving = false;
      emit();
      if (queue.length && !error?.startsWith("Token") && !error?.includes("permesso")) schedule();
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(flush, C.saveDelayMs);
  }

  function apply(label, fn) {
    if (!data) return;
    queue.push({ label, fn });
    fn(data);
    emit();
    schedule();
  }

  // ---------- file caricati ----------
  const safeName = (n) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-").slice(-80) || "file";
  const readBytes = (file) => new Promise((ok, ko) => {
    const fr = new FileReader();
    fr.onload = () => ok(new Uint8Array(fr.result));
    fr.onerror = () => ko(new Error(`Impossibile leggere ${file.name}`));
    fr.readAsArrayBuffer(file);
  });
  const isReferenced = (d, path) => !!d && (d.activities.some((a) => a.files.some((f) => f.path === path)) || (d.files || []).some((f) => f.path === path)
    || (d.archive || []).some((z) => z.kind === "files" ? z.item?.path === path : z.kind === "activity" && (z.item?.files || []).some((f) => f.path === path)));

  async function uploadOne(actId, file) {
    if (file.size > MAX_FILE) throw new Error(`«${file.name}» supera i 25 MB.`);
    const id = newId("u");
    const rec = { id, name: file.name, size: file.size, type: file.type || "", added: new Date().toISOString() };
    if (C.localMode) {
      localUrls.set(id, URL.createObjectURL(file));
      rec.path = "";
    } else {
      if (!token()) throw new Error("Inserisci il token GitHub nelle impostazioni per caricare file.");
      const path = `uploads/${actId || "comune"}/${id}-${safeName(file.name)}`;
      const bytes = await readBytes(file);
      const r = await fetch(`${REPO_API}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
        method: "PUT",
        headers: { ...headers(true), "Content-Type": "application/json" },
        body: JSON.stringify({ message: `Dashboard: file caricato ${file.name}`, content: b64bytes(bytes), branch: C.branch }),
      });
      if (r.status === 401) throw new Error("Token non valido o scaduto: inseriscilo di nuovo nelle impostazioni.");
      if (r.status === 403 || r.status === 404) throw new Error("Il token non ha il permesso di scrivere su questo repo.");
      if (!r.ok) throw new Error(`Caricamento di «${file.name}» non riuscito (GitHub ${r.status}).`);
      rec.path = path;
    }
    apply("file caricato", (d) => { const a = box(d, actId); if (a && !findIn(a.files, id)) a.files.push({ ...rec }); });
    return id;
  }

  // un file tolto viene cancellato dal repo solo dopo un po' (per lasciare il tempo di annullare)
  function scheduleDelete(path) {
    if (!path || C.localMode) return;
    pendingDeletes.set(path, Date.now());
    setTimeout(runDeletes, 15000);
  }
  async function runDeletes() {
    if (C.localMode || !token() || !pendingDeletes.size) return;
    if (queue.length || saving) { setTimeout(runDeletes, 5000); return; }
    for (const [path, t] of [...pendingDeletes]) {
      if (Date.now() - t < 12000) continue;
      pendingDeletes.delete(path);
      if (isReferenced(data, path) || isReferenced(remote, path)) continue; // ripristinato con "Annulla"
      try {
        const url = `${REPO_API}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
        const g = await fetch(`${url}?ref=${C.branch}`, { headers: headers(true), cache: "no-store" });
        if (!g.ok) continue;
        const { sha: fileSha } = await g.json();
        await fetch(url, {
          method: "DELETE",
          headers: { ...headers(true), "Content-Type": "application/json" },
          body: JSON.stringify({ message: `Dashboard: file eliminato ${path.split("/").pop()}`, sha: fileSha, branch: C.branch }),
        });
      } catch (e) { console.warn("Eliminazione file non riuscita", path, e); }
    }
  }

  // ---------- azioni ----------
  const findIn = (arr, id) => (arr || []).find((x) => x.id === id);
  /** contenitore di diario/task/file: un'attività, oppure (id "") la parte "In comune" */
  const box = (d, actId) => (actId ? findIn(d.activities, actId) : d);
  const subOk = (actId, sub) => SUBS.includes(sub) && (actId || TOP_SUBS.includes(sub));
  const areaOf = (d, id) => findIn(d.areas, id);
  const areaOfMs = (d, msId) => d.areas.find((a) => a.milestones.some((m) => m.id === msId));
  const msValid = (d, msId, areaId) => !msId || msId === LAUNCH || areaOfMs(d, msId)?.id === areaId;
  function cleanRefs(d) {
    for (const act of d.activities) {
      if (!msValid(d, act.until, act.area)) act.until = "";
      for (const t of act.tasks) if (!msValid(d, t.milestone, act.area)) t.milestone = "";
    }
  }
  /** mette un'attività al posto giusto: in fondo al suo gruppo, oppure come blocco in fondo all'area */
  function place(d, act) {
    if (act.group) {
      let idx = -1;
      d.activities.forEach((x, i) => { if (x.group === act.group) idx = i; });
      d.activities.splice(idx >= 0 ? idx + 1 : d.activities.length, 0, act);
    } else {
      d.activities.push(act);
      const a = areaOf(d, act.area);
      if (a && !a.order.includes("a:" + act.id)) a.order.push("a:" + act.id);
    }
  }
  function unplace(d, act) {
    d.activities = d.activities.filter((x) => x.id !== act.id);
    d.areas.forEach((a) => (a.order = a.order.filter((k) => k !== "a:" + act.id)));
  }

  /** sposta un elemento nell'archivio (dentro un'operazione: lavora su d) */
  function archiveIn(d, entry) {
    d.archive ??= [];
    if (!findIn(d.archive, entry.id)) d.archive.push(clone(entry));
  }
  /** rimette al suo posto un elemento archiviato; false se il contenitore non c'è (es. attività archiviata) */
  function restoreIn(d, z) {
    if (z.kind === "activity") {
      if (findIn(d.activities, z.item.id)) return true;
      const x = clone(z.item);
      if (x.group && !d.groups.some((g) => g.id === x.group && g.area === x.area)) x.group = "";
      if (!areaOf(d, x.area)) return false;
      place(d, x);
      fixOrder(d);
      cleanRefs(d);
      return true;
    }
    const list = z.kind === "ideas" ? d.ideas : box(d, z.from)?.[z.kind];
    if (!list) return false;
    if (!findIn(list, z.item.id)) {
      const x = clone(z.item);
      if (z.reason === "done" && "done" in x) x.done = false;
      list.push(x);
      if (z.kind === "files") (z.links || []).forEach((eid) => { const e = findIn(box(d, z.from).log, eid); if (e && !e.files.includes(x.id)) e.files.push(x.id); });
      if (z.kind === "log") { const c = box(d, z.from); x.files = (x.files || []).filter((fid) => findIn(c.files, fid)); }
    }
    return true;
  }
  function archiveSub(actId, sub, itemId, reason) {
    const a = data && box(data, actId);
    const item = a && findIn(a[sub], itemId);
    if (!item) return () => {};
    const z = { id: newId("z"), kind: sub, from: actId || "", item: clone(item), archivedAt: new Date().toISOString(), reason };
    if (sub === "files") z.links = a.log.filter((e) => e.files?.includes(itemId)).map((e) => e.id);
    apply(reason === "superseded" ? "decisione superata" : `archiviato da ${sub}`, (d) => {
      const x = box(d, actId);
      const cur = x && findIn(x[sub], itemId);
      if (!cur) return;
      z.item = clone(cur);
      x[sub] = x[sub].filter((y) => y.id !== itemId);
      // un file tolto sparisce anche dalle voci del diario che lo allegavano (torna con il ripristino)
      if (sub === "files") x.log.forEach((e) => { if (e.files?.includes(itemId)) e.files = e.files.filter((f) => f !== itemId); });
      archiveIn(d, z);
    });
    return () => Store.restore(z.id);
  }
  const canRestore = (d, z) => z.kind === "activity" ? !!areaOf(d, z.item.area) : z.kind === "ideas" || !!box(d, z.from);

  const Store = {
    get data() { return data; },
    get status() { return status(); },
    subscribe(fn) { subs.add(fn); if (data) fn(data, status()); return () => subs.delete(fn); },

    async init() {
      await refresh();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && !queue.length) refresh();
        if (document.visibilityState === "hidden" && queue.length) flush();
      });
      setInterval(() => { if (document.visibilityState === "visible" && !queue.length) refresh(); }, C.refreshEveryMs);
      window.addEventListener("beforeunload", (e) => { if (queue.length || saving || uploading) { e.preventDefault(); e.returnValue = ""; } });
    },
    refresh,
    flush,

    hasToken: () => !!token(),
    setToken(t) { safeStorage.set(TOKEN_KEY, t.trim()); error = null; emit(); if (queue.length) schedule(); },
    clearToken() { safeStorage.del(TOKEN_KEY); emit(); },
    async checkToken() {
      if (!token()) return { ok: false, error: "Nessun token inserito." };
      try {
        const r = await fetch(REPO_API, { headers: headers(true), cache: "no-store" });
        if (r.status === 401) return { ok: false, error: "Token non valido o scaduto." };
        if (!r.ok) return { ok: false, error: `Il token non vede il repo (GitHub ${r.status}).` };
        const j = await r.json();
        if (!j.permissions?.push) return { ok: false, error: "Il token può leggere ma non scrivere (serve Contents: Read and write)." };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    fileUrl(f) {
      if (!f) return "";
      if (localUrls.has(f.id)) return localUrls.get(f.id);
      if (!f.path) return "";
      return `https://raw.githubusercontent.com/${C.owner}/${C.repo}/${C.branch}/${f.path.split("/").map(encodeURIComponent).join("/")}`;
    },

    // ---------- in comune ----------
    addItem(list, text) {
      if (!LISTS.includes(list) || !text.trim()) return null;
      const id = newId(list[0]);
      const item = { id, text: text.trim(), done: false };
      apply(`aggiunto in ${list}`, (d) => { if (!findIn(d[list], id)) d[list].push({ ...item }); });
      return id;
    },
    toggleItem(list, id) {
      const cur = data && findIn(data[list] || [], id);
      if (!cur) return;
      const done = !cur.done;                       // valore esplicito: ripetibile sulla versione remota
      const doneAt = done ? today() : "";
      apply(`${done ? "spuntato" : "riaperto"} in ${list}`, (d) => {
        const x = findIn(d[list], id);
        if (!x) return;
        x.done = done;
        if (doneAt) x.doneAt = doneAt; else delete x.doneAt;
      });
    },
    editItem(list, id, text) {
      if (!text.trim()) return;
      apply(`modificato in ${list}`, (d) => { const x = findIn(d[list], id); if (x) x.text = text.trim(); });
    },
    removeItem(list, id) {
      const arr = data?.[list] || [];
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) return () => {};
      const z = { id: newId("z"), kind: list, from: "", item: clone(arr[idx]), archivedAt: new Date().toISOString(), reason: "deleted" };
      apply(`archiviato da ${list}`, (d) => { d[list] = d[list].filter((x) => x.id !== id); archiveIn(d, z); });
      return () => Store.restore(z.id);
    },
    addDecision(text, date) {
      if (!text.trim()) return null;
      const id = newId("d");
      const dec = { id, date: date || today(), text: text.trim() };
      apply("nuova decisione", (d) => { if (!findIn(d.decisions, id)) d.decisions.push({ ...dec }); });
      return id;
    },
    editDecision(id, { text, date } = {}) {
      apply("decisione modificata", (d) => {
        const x = findIn(d.decisions, id);
        if (!x) return;
        if (text && text.trim()) x.text = text.trim();
        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) x.date = date;
      });
    },
    removeDecision(id) {
      const idx = data?.decisions.findIndex((x) => x.id === id) ?? -1;
      if (idx < 0) return () => {};
      return archiveSub("", "decisions", id, "deleted");
    },

    // ---------- traguardi ----------
    setProgress(areaId, n) {
      apply(`traguardi ${areaId} → ${n}`, (d) => { const a = areaOf(d, areaId); if (a) a.progress = Math.max(0, Math.min(n, a.milestones.length)); });
    },
    setLaunched(v) { apply(v ? "lanciato" : "lancio annullato", (d) => { d.launched = !!v; }); },
    setMilestones(areaId, list) {
      const a = data && areaOf(data, areaId);
      if (!a) return;
      const next = list.filter((m) => m.name?.trim()).map((m) => ({ id: m.id || newId("m"), name: m.name.trim() }));
      // resta raggiunto solo il prefisso iniziale di traguardi che erano già raggiunti
      const wasReached = new Set(a.milestones.slice(0, a.progress).map((m) => m.id));
      let progress = 0;
      while (progress < next.length && wasReached.has(next[progress].id)) progress++;
      apply(`traguardi ${a.name} modificati`, (d) => {
        const x = areaOf(d, areaId);
        if (!x) return;
        x.milestones = clone(next);
        x.progress = progress;
        cleanRefs(d);
      });
    },

    // ---------- gruppi ----------
    addGroup(areaId, name) {
      if (!name?.trim()) return null;
      const g = { id: newId("g"), area: areaId, name: name.trim() };
      apply(`nuovo gruppo ${g.name}`, (d) => {
        const a = areaOf(d, areaId);
        if (!a || findIn(d.groups, g.id)) return;
        d.groups.push({ ...g });
        a.order.push("g:" + g.id);
      });
      return g.id;
    },
    renameGroup(id, name) {
      if (!name?.trim()) return;
      apply("gruppo rinominato", (d) => { const g = findIn(d.groups, id); if (g) g.name = name.trim(); });
    },
    removeGroup(id) {
      const g = data && findIn(data.groups, id);
      if (!g) return () => {};
      const members = data.activities.filter((a) => a.group === id).map((a) => a.id);
      const savedGroup = clone(g);
      const savedOrder = areaOf(data, g.area)?.order.slice() || [];
      apply(`gruppo ${g.name} eliminato`, (d) => {
        const a = areaOf(d, g.area);
        d.groups = d.groups.filter((x) => x.id !== id);
        const inGroup = d.activities.filter((x) => x.group === id);
        inGroup.forEach((x) => (x.group = ""));
        if (a) {
          const pos = a.order.indexOf("g:" + id);
          const keys = inGroup.map((x) => "a:" + x.id);
          if (pos >= 0) a.order.splice(pos, 1, ...keys); else a.order.push(...keys);
        }
      });
      return () => apply(`gruppo ${g.name} ripristinato`, (d) => {
        if (findIn(d.groups, id)) return;
        d.groups.push(clone(savedGroup));
        members.forEach((m) => { const x = findIn(d.activities, m); if (x && !x.group && x.area === g.area) x.group = id; });
        const a = areaOf(d, g.area);
        if (a) a.order = savedOrder.slice();
        fixOrder(d);
      });
    },
    moveBlock(areaId, key, dir) {
      apply("ordine cambiato", (d) => {
        const a = areaOf(d, areaId);
        if (!a) return;
        const i = a.order.indexOf(key), j = i + dir;
        if (i < 0 || j < 0 || j >= a.order.length) return;
        [a.order[i], a.order[j]] = [a.order[j], a.order[i]];
      });
    },

    // ---------- attività ----------
    addActivity({ area, group = "", name, owner = "Ibrido", hint = "", until = "" }) {
      if (!name?.trim() || !data || !areaOf(data, area)) return null;
      const act = {
        id: newId("x"), area, group: group && findIn(data.groups, group)?.area === area ? group : "",
        name: name.trim(), owner, hint: hint.trim(), until: msValid(data, until, area) ? until : "",
        status: "todo", note: "", tasks: [], open: [], decisions: [], files: [],
      };
      apply(`nuova attività ${act.name}`, (d) => {
        if (findIn(d.activities, act.id)) return;
        const x = clone(act);
        if (x.group && !findIn(d.groups, x.group)) x.group = "";
        place(d, x);
      });
      return act.id;
    },
    editActivity(id, patch) {
      apply("attività modificata", (d) => {
        const act = findIn(d.activities, id);
        if (!act) return;
        const newArea = patch.area && areaOf(d, patch.area) ? patch.area : act.area;
        let newGroup = patch.group !== undefined ? patch.group : act.group;
        if (newGroup && findIn(d.groups, newGroup)?.area !== newArea) newGroup = "";
        if (newArea !== act.area || newGroup !== act.group) {
          unplace(d, act);
          act.area = newArea;
          act.group = newGroup;
          place(d, act);
        }
        if (patch.name?.trim()) act.name = patch.name.trim();
        if (patch.owner) act.owner = patch.owner;
        if (patch.hint !== undefined) act.hint = patch.hint.trim();
        if (patch.until !== undefined) act.until = patch.until;
        cleanRefs(d);
      });
    },
    removeActivity(id) {
      const idx = data?.activities.findIndex((a) => a.id === id) ?? -1;
      if (idx < 0) return () => {};
      const saved = clone(data.activities[idx]);
      const z = { id: newId("z"), kind: "activity", from: "", item: saved, archivedAt: new Date().toISOString(), reason: "deleted" };
      apply(`attività ${saved.name} archiviata`, (d) => {
        const x = findIn(d.activities, id);
        if (!x) return;
        z.item = clone(x);            // la versione più recente (anche con le modifiche arrivate dalle chat)
        unplace(d, x);
        archiveIn(d, z);
      });
      return () => Store.restore(z.id);
    },
    /** stato: todo | doing | done; per "done" si può dire se è sospesa ("paused") o terminata ("ended") */
    setActivityStatus(id, s, doneKind) {
      if (!STATUSES.includes(s)) return;
      const k = s === "done" && DONE_KINDS.includes(doneKind) ? doneKind : null;
      apply(`attività ${id} → ${k || s}`, (d) => {
        const x = findIn(d.activities, id);
        if (!x) return;
        x.status = s;
        if (k) x.doneKind = k;
      });
    },
    setNote(id, text) {
      // le note scritte di seguito diventano un'unica operazione in coda
      const last = queue[queue.length - 1];
      if (last?.noteFor === id && !saving) queue.pop();
      apply("note modificate", (d) => { const x = findIn(d.activities, id); if (x) x.note = text; });
      queue[queue.length - 1].noteFor = id;
    },

    // ---------- dentro un'attività ----------
    addSub(actId, sub, fields) {
      if (!subOk(actId, sub) || sub === "files") return null;
      const item = { ...fields, id: newId({ log: "l", tasks: "t", open: "o", decisions: "d" }[sub]) };
      if (typeof item.text === "string") item.text = item.text.trim();
      if (!item.text) return null;
      if (sub === "log") Object.assign(item, { date: item.date || today(), detail: (item.detail || "").trim(), files: item.files || [], source: item.source || "dashboard", created: Date.now() });
      if (sub === "tasks") Object.assign(item, { priority: item.priority || "media", due: item.due || "", milestone: item.milestone || "", done: false, created: Date.now() });
      if (sub === "open") item.done = false;
      if (sub === "decisions") item.date = item.date || today();
      apply({ log: "diario aggiornato", tasks: "nuovo task", open: "nuovo punto da decidere", decisions: "nuova decisione" }[sub], (d) => {
        const a = box(d, actId);
        if (a && !findIn(a[sub], item.id)) a[sub].push(clone(item));
      });
      return item.id;
    },
    editSub(actId, sub, itemId, patch) {
      if (!subOk(actId, sub)) return;
      const p = { ...patch };
      if (typeof p.text === "string") { p.text = p.text.trim(); if (!p.text) delete p.text; }
      const label = "done" in p ? (p.done ? `spuntato in ${sub}` : `riaperto in ${sub}`) : `modificato in ${sub}`;
      if ("done" in p && p.done) p.doneAt ??= today();   // quando è stato completato (serve all'archivio)
      apply(label, (d) => {
        const x = findIn(box(d, actId)?.[sub], itemId);
        if (!x) return;
        Object.assign(x, p);
        if ("done" in p && !p.done) delete x.doneAt;
      });
    },
    removeSub(actId, sub, itemId) {
      if (!subOk(actId, sub)) return () => {};
      const a = data && box(data, actId);
      const idx = a ? a[sub].findIndex((x) => x.id === itemId) : -1;
      if (idx < 0) return () => {};
      return archiveSub(actId, sub, itemId, "deleted");
    },
    /** una decisione non più valida: va nell'archivio come "superata" */
    supersedeDecision(actId, itemId) { return archiveSub(actId || "", "decisions", itemId, "superseded"); },

    // ---------- archivio ----------
    restore(archiveId) {
      const z = data && findIn(data.archive, archiveId);
      if (!z || !canRestore(data, z)) return false;
      apply(z.kind === "activity" ? `attività ${z.item.name} ripristinata` : `ripristinato in ${z.kind}`, (d) => {
        const y = findIn(d.archive, archiveId);
        if (y && restoreIn(d, y)) d.archive = d.archive.filter((w) => w.id !== archiveId);
      });
      return true;
    },
    /** elimina per sempre dall'archivio (i file caricati vengono tolti anche dal repo) */
    purge(archiveId) {
      const z = data && findIn(data.archive, archiveId);
      if (!z) return;
      apply("eliminato dall'archivio", (d) => { d.archive = d.archive.filter((w) => w.id !== archiveId); });
      const paths = z.kind === "files" ? [z.item.path] : z.kind === "activity" ? (z.item.files || []).map((f) => f.path) : [];
      paths.forEach(scheduleDelete);
    },

    async uploadFiles(actId, fileList) {
      const files = [...fileList];
      const errors = [], ids = [];
      uploading += files.length;
      emit();
      for (const f of files) {
        try { ids.push(await uploadOne(actId, f)); }
        catch (e) { errors.push(e.message); }
        finally { uploading--; emit(); }
      }
      return { ok: ids.length, errors, ids };
    },
  };

  window.Store = Store;
})();
