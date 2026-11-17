/*
 * store.js — livello dati della dashboard (INFRASTRUTTURA, non modificare l'API pubblica).
 *
 * - Legge data.json dall'API di GitHub (sempre la versione più recente, non la copia in cache di Pages).
 * - Salva con l'API Contents di GitHub usando il token salvato nel browser.
 * - Ogni modifica è un'operazione (funzione) messa in coda: al salvataggio la coda viene
 *   riapplicata sull'ultima versione remota, così le modifiche fatte nel frattempo dalle chat
 *   di claude.ai non vengono mai sovrascritte. In caso di conflitto (409) riprova da solo.
 *
 * API pubblica (window.Store):
 *   Store.data                         -> stato corrente (sola lettura per la UI!)
 *   Store.status                       -> { mode, saving, pending, error, lastSync, lastSaved, canWrite }
 *   Store.subscribe(fn)                -> fn(data, status) a ogni cambiamento; ritorna unsubscribe
 *   Store.init()                       -> Promise, carica i dati
 *   Store.refresh()                    -> ricarica dal repo
 *   Store.setToken(t) / clearToken() / hasToken()
 *   Store.checkToken()                 -> Promise<{ok, login?, error?}>
 *
 *   Azioni (tutte salvano da sole):
 *   setPhase(name)
 *   cycleFileStatus(fileId)            todo -> doing -> done -> todo
 *   setFileStatus(fileId, status)
 *   addItem(list, text)                list = "tasks" | "open" | "ideas"; ritorna l'id
 *   toggleItem(list, id)
 *   editItem(list, id, text)
 *   removeItem(list, id)               ritorna una funzione undo()
 *   addDecision(text, date?)           date "AAAA-MM-GG" (default oggi); ritorna l'id
 *   editDecision(id, {text?, date?})
 *   removeDecision(id)                 ritorna una funzione undo()
 */
(function () {
  const C = window.APP_CONFIG;
  const TOKEN_KEY = "appNotizie.githubToken";
  const LISTS = ["tasks", "open", "ideas"];
  const STATUSES = ["todo", "doing", "done"];
  const API = `https://api.github.com/repos/${C.owner}/${C.repo}/contents/${C.dataPath}`;

  let data = null;
  let remote = null;      // ultima versione remota nota
  let sha = null;
  let queue = [];         // [{label, fn}] operazioni non ancora salvate
  let timer = null;
  let saving = false;
  let error = null;
  let lastSync = null;
  let lastSaved = null;   // ultimo salvataggio riuscito su GitHub
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
  const b64encode = (str) => {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const safeStorage = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
    del(k) { try { localStorage.removeItem(k); } catch {} },
  };
  const token = () => safeStorage.get(TOKEN_KEY);

  function status() {
    return {
      mode: C.localMode ? "local" : "github",
      saving,
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
    d.phases ??= ["Pianificazione", "Progettazione", "Sviluppo", "Test", "Lancio"];
    d.files ??= [];
    LISTS.forEach((l) => (d[l] ??= []));
    d.decisions ??= [];
    return d;
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

  // ---------- azioni ----------
  const findIn = (arr, id) => arr.find((x) => x.id === id);

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
      window.addEventListener("beforeunload", (e) => { if (queue.length || saving) { e.preventDefault(); e.returnValue = ""; } });
    },
    refresh,
    flush,

    hasToken: () => !!token(),
    setToken(t) { safeStorage.set(TOKEN_KEY, t.trim()); error = null; emit(); if (queue.length) schedule(); },
    clearToken() { safeStorage.del(TOKEN_KEY); emit(); },
    async checkToken() {
      if (!token()) return { ok: false, error: "Nessun token inserito." };
      try {
        const r = await fetch(`https://api.github.com/repos/${C.owner}/${C.repo}`, { headers: headers(true), cache: "no-store" });
        if (r.status === 401) return { ok: false, error: "Token non valido o scaduto." };
        if (!r.ok) return { ok: false, error: `Il token non vede il repo (GitHub ${r.status}).` };
        const j = await r.json();
        if (!j.permissions?.push) return { ok: false, error: "Il token può leggere ma non scrivere (serve Contents: Read and write)." };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    setPhase(name) {
      apply(`fase → ${name}`, (d) => { if (d.phases.includes(name)) d.phase = name; });
    },
    setFileStatus(fileId, s) {
      if (!STATUSES.includes(s)) return;
      apply(`file ${fileId} → ${s}`, (d) => { const f = findIn(d.files, fileId); if (f) f.status = s; });
    },
    cycleFileStatus(fileId) {
      const f = data && findIn(data.files, fileId);
      if (!f) return;
      const next = STATUSES[(STATUSES.indexOf(f.status) + 1) % STATUSES.length];
      Store.setFileStatus(fileId, next);
    },

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
      apply(`${done ? "spuntato" : "riaperto"} in ${list}`, (d) => { const x = findIn(d[list], id); if (x) x.done = done; });
    },
    editItem(list, id, text) {
      if (!text.trim()) return;
      apply(`modificato in ${list}`, (d) => { const x = findIn(d[list], id); if (x) x.text = text.trim(); });
    },
    removeItem(list, id) {
      const arr = data?.[list] || [];
      const idx = arr.findIndex((x) => x.id === id);
      if (idx < 0) return () => {};
      const saved = clone(arr[idx]);
      apply(`eliminato da ${list}`, (d) => { d[list] = d[list].filter((x) => x.id !== id); });
      return () => apply(`ripristinato in ${list}`, (d) => {
        if (!findIn(d[list], saved.id)) d[list].splice(Math.min(idx, d[list].length), 0, clone(saved));
      });
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
      const saved = clone(data.decisions[idx]);
      apply("decisione eliminata", (d) => { d.decisions = d.decisions.filter((x) => x.id !== id); });
      return () => apply("decisione ripristinata", (d) => {
        if (!findIn(d.decisions, saved.id)) d.decisions.splice(Math.min(idx, d.decisions.length), 0, clone(saved));
      });
    },
  };

  window.Store = Store;
})();
