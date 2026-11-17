/*
 * ui.js — INTERFACCIA (di competenza di Claude in VS Code).
 *
 * Contratto:
 *   window.UI = {
 *     mount(rootEl, store)   // una volta all'avvio: struttura fissa + eventi
 *     render(data, status)   // a ogni cambiamento di dati o di stato di salvataggio
 *   }
 *
 * Regole: i dati si modificano SOLO con le azioni di window.Store; `data` è sola lettura.
 * render() ridisegna solo i contenitori "vivi" (riepilogo, fasi, file, liste): i campi di testo
 * (form di aggiunta, foglio di modifica, impostazioni) stanno fuori, così non perdono il cursore.
 */
(function () {
  let store, root;
  let filter = "Tutti";
  let undoTimer;
  let editing = null; // { list, id } dell'elemento aperto nel foglio di modifica
  let lastData = null, lastStatus = null;

  // ---------- utilità ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel) => root.querySelector(sel);
  const hhmm = (d) => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const fmtDate = (iso) => {
    const [y, m, d] = String(iso).split("-").map(Number);
    if (!y || !m || !d) return esc(iso);
    return new Date(y, m - 1, d).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
  };
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const STATUS_LABEL = { todo: "Da fare", doing: "In corso", done: "Fatto" };
  const LISTS = [
    { key: "tasks", title: "Task", placeholder: "Nuovo task", empty: "Nessun task. Aggiungine uno qui sotto." },
    { key: "open", title: "Punti da definire", placeholder: "Nuovo punto da definire", empty: "Niente da definire." },
    { key: "ideas", title: "Idee", placeholder: "Nuova idea", empty: "Ancora nessuna idea." },
  ];
  const FILTERS = ["Tutti", "Notizie", "App"];

  const ICON = {
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    board: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M7 9h6M7 12h10"/></svg>',
  };

  // ---------- struttura (una volta) ----------
  function mount(el, s) {
    root = el;
    store = s;
    root.innerHTML = `
      <header class="top">
        <div class="top-title">
          <p class="eyebrow">Dashboard di progetto</p>
          <h1>App notizie</h1>
        </div>
        <div class="top-actions">
          <span id="sync" class="sync" role="status" aria-live="polite"></span>
          <button class="icon-btn" data-action="settings" aria-label="Impostazioni">${ICON.gear}</button>
        </div>
      </header>

      <div id="banner"></div>

      <section class="card summary" id="summary" aria-label="Riepilogo"></section>

      <section class="card" aria-labelledby="h-phases">
        <div class="card-head"><h2 id="h-phases">Fase</h2><span class="hint">Tocca per cambiare</span></div>
        <div id="phases" class="phases" role="radiogroup" aria-labelledby="h-phases"></div>
      </section>

      <section class="card" aria-labelledby="h-files">
        <div class="card-head wrap">
          <h2 id="h-files">File di lavoro <span id="files-count" class="count"></span></h2>
          <div id="filters" class="seg" role="tablist" aria-label="Filtra i file"></div>
        </div>
        <div id="files" class="files"></div>
        <p class="legend">
          <span><i class="dot todo"></i>Da fare</span>
          <span><i class="dot doing"></i>In corso</span>
          <span><i class="dot done"></i>Fatto</span>
          <span class="legend-tip">Un tocco cambia lo stato</span>
        </p>
      </section>

      <div class="lists">
        ${LISTS.map((l) => `
          <section class="card list-card" aria-labelledby="h-${l.key}">
            <div class="card-head"><h2 id="h-${l.key}">${l.title} <span id="count-${l.key}" class="count"></span></h2></div>
            <ul id="list-${l.key}" class="rows"></ul>
            <form class="add" data-list="${l.key}" autocomplete="off">
              <span class="add-icon">${ICON.plus}</span>
              <input name="text" placeholder="${l.placeholder}" enterkeyhint="done" aria-label="${l.placeholder}">
              <button class="add-btn" aria-label="Aggiungi">Aggiungi</button>
            </form>
          </section>`).join("")}
      </div>

      <section class="card" aria-labelledby="h-dec">
        <div class="card-head"><h2 id="h-dec">Registro decisioni <span id="count-decisions" class="count"></span></h2></div>
        <ul id="decisions" class="rows decisions"></ul>
        <form class="add add-dec" data-list="decisions" autocomplete="off">
          <span class="add-icon">${ICON.plus}</span>
          <input name="text" placeholder="Nuova decisione" enterkeyhint="done" aria-label="Nuova decisione">
          <input name="date" type="date" class="date-input" aria-label="Data">
          <button class="add-btn" aria-label="Aggiungi">Aggiungi</button>
        </form>
      </section>

      <a id="board" class="card board" target="_blank" rel="noopener">
        <span class="board-icon">${ICON.board}</span>
        <span class="board-text"><b>Apri la lavagna</b><small>Mappa del progetto su claude.ai</small></span>
        <span class="board-go">${ICON.arrow}</span>
      </a>

      <footer id="foot" class="foot"></footer>

      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>

      <dialog id="sheet" class="sheet" aria-labelledby="sheet-title">
        <form method="dialog" id="sheet-form">
          <div class="sheet-head">
            <button value="cancel" class="text-btn">Annulla</button>
            <h2 id="sheet-title">Modifica</h2>
            <button type="submit" value="save" class="text-btn strong">Fine</button>
          </div>
          <textarea id="sheet-text" rows="4" aria-label="Testo"></textarea>
          <label id="sheet-date-wrap" class="field-row">Data <input id="sheet-date" type="date"></label>
          <button type="button" data-action="sheet-delete" class="danger-btn">Elimina</button>
        </form>
      </dialog>

      <dialog id="settings" class="sheet" aria-labelledby="settings-title">
        <form method="dialog" id="settings-form">
          <div class="sheet-head">
            <span></span>
            <h2 id="settings-title">Impostazioni</h2>
            <button value="cancel" class="text-btn strong">Chiudi</button>
          </div>
          <div class="group">
            <p class="group-title">Token GitHub</p>
            <p class="group-note">Serve per salvare le modifiche. Resta solo in questo browser.</p>
            <input id="token" type="password" placeholder="github_pat_…" autocomplete="off" spellcheck="false" aria-label="Token GitHub">
            <p id="token-msg" class="token-msg"></p>
          </div>
          <button type="button" data-action="save-token" class="primary-btn">Salva e verifica</button>
          <button type="button" data-action="clear-token" class="danger-btn">Rimuovi token</button>
          <button type="button" data-action="refresh" class="plain-btn">Ricarica i dati</button>
        </form>
      </dialog>`;

    root.addEventListener("click", onClick);
    root.addEventListener("submit", onSubmit);
    root.addEventListener("keydown", onKey);
    $("#sheet").addEventListener("close", onSheetClose);
    // tocco sullo sfondo del foglio = chiudi
    for (const d of root.querySelectorAll("dialog")) {
      d.addEventListener("click", (e) => { if (e.target === d) d.close("cancel"); });
    }
  }

  // ---------- eventi ----------
  function onClick(e) {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const { action, id, list, value } = t.dataset;
    switch (action) {
      case "phase": if (value !== lastData?.phase) store.setPhase(value); break;
      case "filter": filter = value; renderFiles(lastData); break;
      case "file": store.cycleFileStatus(id); break;
      case "toggle": store.toggleItem(list, id); break;
      case "edit": openSheet(list, id); break;
      case "delete": remove(list, id); break;
      case "sheet-delete": {
        const ed = editing;
        editing = null;
        $("#sheet").close("cancel");
        if (ed) remove(ed.list, ed.id);
        break;
      }
      case "settings": openSettings(); break;
      case "save-token": saveToken(); break;
      case "clear-token":
        store.clearToken();
        $("#token").value = "";
        setTokenMsg("Token rimosso.", "");
        break;
      case "refresh": store.refresh(); setTokenMsg("Dati ricaricati.", ""); break;
      case "undo": t._undo?.(); hideToast(); break;
      case "retry": store.flush(); break;
    }
  }

  function onKey(e) {
    // Invio sul testo di una riga = modifica (accessibilità da tastiera)
    if ((e.key === "Enter" || e.key === " ") && e.target.matches(".row-text[data-action]")) {
      e.preventDefault();
      e.target.click();
    }
  }

  function onSubmit(e) {
    const f = e.target.closest("form.add");
    if (!f) return;
    e.preventDefault();
    const text = f.text.value;
    if (!text.trim()) { f.text.focus(); return; }
    if (f.dataset.list === "decisions") store.addDecision(text, f.date.value || undefined);
    else store.addItem(f.dataset.list, text);
    f.text.value = "";
  }

  function remove(list, id) {
    const undo = list === "decisions" ? store.removeDecision(id) : store.removeItem(list, id);
    showUndo(list === "decisions" ? "Decisione eliminata" : "Elemento eliminato", undo);
  }

  // ---------- foglio di modifica ----------
  function findItem(list, id) {
    const arr = list === "decisions" ? lastData?.decisions : lastData?.[list];
    return arr?.find((x) => x.id === id);
  }

  function openSheet(list, id) {
    const item = findItem(list, id);
    if (!item) return;
    editing = { list, id };
    const isDec = list === "decisions";
    $("#sheet-title").textContent = isDec ? "Decisione" : (LISTS.find((l) => l.key === list)?.title || "Modifica");
    $("#sheet-text").value = item.text;
    $("#sheet-date-wrap").hidden = !isDec;
    if (isDec) $("#sheet-date").value = item.date || todayISO();
    $("#sheet").showModal();
    const ta = $("#sheet-text");
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function onSheetClose() {
    const sheet = $("#sheet");
    const ed = editing;
    editing = null;
    if (!ed || sheet.returnValue !== "save") return;
    const item = findItem(ed.list, ed.id);
    if (!item) return; // eliminato nel frattempo
    const text = $("#sheet-text").value.trim();
    if (ed.list === "decisions") {
      const date = $("#sheet-date").value;
      if ((text && text !== item.text) || (date && date !== item.date)) store.editDecision(ed.id, { text, date });
    } else if (text && text !== item.text) {
      store.editItem(ed.list, ed.id, text);
    }
  }

  // ---------- impostazioni ----------
  function openSettings() {
    $("#token").value = "";
    if (lastStatus?.mode === "local") setTokenMsg("Modalità locale: le modifiche restano in memoria e non vengono salvate su GitHub.", "");
    else setTokenMsg(store.hasToken() ? "Token già inserito." : "Nessun token inserito.", store.hasToken() ? "ok" : "");
    $("#settings").showModal();
  }
  function setTokenMsg(text, kind) {
    const el = $("#token-msg");
    el.textContent = text;
    el.className = "token-msg" + (kind ? " " + kind : "");
  }
  function saveToken() {
    const v = $("#token").value.trim();
    if (v) store.setToken(v);
    if (!store.hasToken()) { setTokenMsg("Incolla prima il token.", "err"); return; }
    setTokenMsg("Verifico…", "");
    store.checkToken().then((r) => {
      if (r.ok) { setTokenMsg("Token valido: puoi salvare.", "ok"); $("#token").value = ""; }
      else setTokenMsg(r.error, "err");
    });
  }

  // ---------- toast annulla ----------
  function showUndo(msg, undo) {
    const el = $("#toast");
    el.innerHTML = `<span>${esc(msg)}</span><button data-action="undo">Annulla</button>`;
    el.querySelector("button")._undo = undo;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideToast, 6000);
  }
  function hideToast() {
    const el = $("#toast");
    el.classList.remove("show");
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { el.hidden = true; }, 250);
  }

  // ---------- render ----------
  function ring(pct) {
    const r = 40, c = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r="${r}" class="ring-bg"/>
      <circle cx="50" cy="50" r="${r}" class="ring-fg" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - pct)).toFixed(2)}"/>
    </svg>`;
  }

  function renderSync(status) {
    let cls = "", label = "";
    if (status.error) { cls = "err"; label = "Errore"; }
    else if (status.mode === "local") { cls = "local"; label = "Locale"; }
    else if (status.saving) { cls = "busy"; label = "Salvo…"; }
    else if (status.pending) { cls = "busy"; label = "In attesa…"; }
    else if (!status.canWrite) { cls = "ro"; label = "Sola lettura"; }
    else if (status.lastSaved) { cls = "ok"; label = `Salvato ${hhmm(status.lastSaved)}`; }
    else if (status.lastSync) { cls = "ok"; label = `Aggiornato ${hhmm(status.lastSync)}`; }
    const el = $("#sync");
    el.className = "sync " + cls;
    el.innerHTML = label ? `<i></i><span>${esc(label)}</span>` : "";
    el.title = status.mode === "local" ? "Modalità locale: non salva su GitHub" : "";
  }

  function renderBanner(status) {
    const err = status.error;
    let html = "";
    if (err) {
      const tokenIssue = /token|permesso/i.test(err);
      html = `<div class="banner err" role="alert"><span>${esc(err)}</span>
        <button data-action="${tokenIssue ? "settings" : "retry"}">${tokenIssue ? "Impostazioni" : "Riprova"}</button></div>`;
    } else if (status.mode === "local") {
      html = `<div class="banner info"><span>Modalità locale: le modifiche restano in memoria e non vengono salvate.</span></div>`;
    } else if (!status.canWrite) {
      html = `<div class="banner info"><span>Sola lettura: inserisci il token GitHub per salvare.</span>
        <button data-action="settings">Inserisci</button></div>`;
    }
    const b = $("#banner");
    if (b.innerHTML !== html) b.innerHTML = html;
  }

  function renderSummary(data) {
    const total = data.files.length;
    const done = data.files.filter((f) => f.status === "done").length;
    const doing = data.files.filter((f) => f.status === "doing").length;
    const openTasks = data.tasks.filter((t) => !t.done).length;
    const openPoints = data.open.filter((t) => !t.done).length;
    const idx = data.phases.indexOf(data.phase);
    $("#summary").innerHTML = `
      <div class="ring-block">
        <div class="ring-wrap">
          ${ring(total ? done / total : 0)}
          <div class="ring-label"><b>${done}<small>/${total}</small></b></div>
        </div>
        <div class="ring-text"><b>File completati</b><span>${doing} in corso · ${total - done - doing} da fare</span></div>
      </div>
      <div class="stats">
        <div class="stat"><span class="stat-k">Task aperti</span><b>${openTasks}</b><span class="stat-sub">${data.tasks.length - openTasks} ${data.tasks.length - openTasks === 1 ? "fatto" : "fatti"}</span></div>
        <div class="stat"><span class="stat-k">Da definire</span><b>${openPoints}</b><span class="stat-sub">${openPoints === 1 ? "punto aperto" : "punti aperti"}</span></div>
        <div class="stat"><span class="stat-k">Fase attuale</span><b class="phase-name">${esc(data.phase || "—")}</b><span class="stat-sub">${idx >= 0 ? `${idx + 1} di ${data.phases.length}` : ""}</span></div>
      </div>`;
  }

  function renderPhases(data) {
    const cur = data.phases.indexOf(data.phase);
    $("#phases").innerHTML = data.phases.map((p, i) => {
      const state = i < cur ? "past" : i === cur ? "on" : "";
      return `<button class="phase ${state}" role="radio" aria-checked="${i === cur}" data-action="phase" data-value="${esc(p)}">
        <span class="phase-dot">${i < cur ? ICON.check : i + 1}</span><span class="phase-label">${esc(p)}</span>
      </button>`;
    }).join("");
  }

  function renderFiles(data) {
    if (!data) return;
    $("#filters").innerHTML = FILTERS.map((f) =>
      `<button role="tab" aria-selected="${f === filter}" class="${f === filter ? "on" : ""}" data-action="filter" data-value="${f}">${f}</button>`).join("");
    const files = data.files.filter((f) => filter === "Tutti" || String(f.branch).startsWith(filter));
    const done = files.filter((f) => f.status === "done").length;
    $("#files-count").textContent = `${done}/${files.length}`;
    $("#files").innerHTML = files.length ? files.map((f) => {
      const sub = String(f.branch).split("›").map((s) => s.trim()).join(" › ");
      return `<button class="file ${esc(f.status)}" data-action="file" data-id="${esc(f.id)}"
          aria-label="${esc(f.n)}. ${esc(f.name)}: ${STATUS_LABEL[f.status] || f.status}. Tocca per cambiare">
        <span class="file-n">${esc(f.n)}</span>
        <span class="file-body"><span class="file-name">${esc(f.name)}</span><span class="file-branch">${esc(sub)}</span></span>
        <span class="pill ${esc(f.status)}">${f.status === "done" ? ICON.check : ""}${STATUS_LABEL[f.status] || esc(f.status)}</span>
      </button>`;
    }).join("") : `<p class="empty">Nessun file in questa sezione.</p>`;
  }

  function renderList(data, l) {
    const items = data[l.key];
    const open = items.filter((x) => !x.done).length;
    $(`#count-${l.key}`).textContent = items.length ? String(open) : "";
    $(`#list-${l.key}`).innerHTML = items.length ? items.map((it) => `
      <li class="row ${it.done ? "done" : ""}">
        <button class="check" role="checkbox" aria-checked="${!!it.done}" data-action="toggle" data-list="${l.key}" data-id="${esc(it.id)}"
          aria-label="${it.done ? "Riapri" : "Segna come fatto"}"><span>${ICON.check}</span></button>
        <span class="row-text" tabindex="0" role="button" data-action="edit" data-list="${l.key}" data-id="${esc(it.id)}">${esc(it.text)}</span>
        <button class="del" data-action="delete" data-list="${l.key}" data-id="${esc(it.id)}" aria-label="Elimina">${ICON.x}</button>
      </li>`).join("") : `<li class="empty">${l.empty}</li>`;
  }

  function renderDecisions(data) {
    const decs = data.decisions.map((d, i) => ({ d, i }))
      .sort((a, b) => String(b.d.date).localeCompare(String(a.d.date)) || b.i - a.i)
      .map((x) => x.d);
    $("#count-decisions").textContent = decs.length ? String(decs.length) : "";
    $("#decisions").innerHTML = decs.length ? decs.map((d) => `
      <li class="row">
        <span class="row-text" tabindex="0" role="button" data-action="edit" data-list="decisions" data-id="${esc(d.id)}">
          <time datetime="${esc(d.date)}">${fmtDate(d.date)}</time>${esc(d.text)}
        </span>
        <button class="del" data-action="delete" data-list="decisions" data-id="${esc(d.id)}" aria-label="Elimina">${ICON.x}</button>
      </li>`).join("") : `<li class="empty">Nessuna decisione registrata.</li>`;
  }

  function renderFoot(data, status) {
    const parts = [];
    if (data?.updatedAt) {
      const d = new Date(data.updatedAt);
      if (!isNaN(d)) parts.push(`Dati aggiornati il ${d.toLocaleDateString("it-IT", { day: "numeric", month: "long" })} alle ${hhmm(d)}`);
    }
    parts.push(status.mode === "local" ? "modalità locale" : "salvataggio su GitHub");
    $("#foot").textContent = parts.join(" · ");
  }

  function render(data, status) {
    if (!root) return;
    lastData = data;
    lastStatus = status;
    renderSync(status);
    renderBanner(status);
    root.classList.toggle("is-loading", !data);
    if (!data) return;
    renderSummary(data);
    renderPhases(data);
    renderFiles(data);
    LISTS.forEach((l) => renderList(data, l));
    renderDecisions(data);
    const board = $("#board");
    board.hidden = !data.boardUrl;
    if (data.boardUrl) board.href = data.boardUrl;
    renderFoot(data, status);
    // il foglio aperto su un elemento eliminato altrove si chiude
    if (editing && !findItem(editing.list, editing.id)) { editing = null; $("#sheet").close("cancel"); }
  }

  window.UI = { mount, render };
})();
