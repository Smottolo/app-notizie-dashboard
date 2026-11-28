/*
 * ui.js — INTERFACCIA (di competenza di Claude in VS Code).
 *
 * Due viste:
 *   - Scrivania (#/): Timeline, Diario del progetto, Da decidere / Da fare / Parcheggio idee,
 *     le tre aree (App, Contenuti, Commerciale) con gruppi e attività, Archivio (richiudibile).
 *   - Pagina attività (#/a/<id>): diario a sinistra, file al centro, decisioni / da decidere / da fare / note a destra.
 * Diario e Da decidere: su Mac scorrono dentro la sezione, su iPhone sono paginati (‹ 1 di 3 ›).
 *
 * Contratto: window.UI = { mount(rootEl, store), render(data, status) }.
 * I dati si leggono e si modificano tramite window.Model (js/ui/model.js), che usa solo le azioni di window.Store.
 * render() ridisegna solo i contenitori "vivi": i campi di testo stanno fuori e non perdono il cursore.
 */
(function () {
  let store, root;
  const Model = window.Model;
  let undoTimer;
  let lastData = null, lastStatus = null;
  let view = "desk";             // desk | activity
  let current = null;            // id dell'attività aperta
  let shownNoteFor = null;       // per non sovrascrivere le note mentre si scrive
  let deskScroll = 0;
  let mobileArea = "app";
  const pages = { feed: 0, open: 0, archive: 0 };   // pagina corrente (solo su iPhone)
  const phoneMq = window.matchMedia("(max-width: 700px)");
  const isPhone = () => phoneMq.matches;
  let archFilter = "all";
  let quickAct = "";             // ultima attività scelta nell'annotazione veloce ("" = In comune)
  let pendingFiles = [];         // allegati scelti nel composer del diario, non ancora caricati
  let prioMode = "urgency";      // urgency | milestone
  let prioFilter = "all";
  let prioExpanded = false;
  let editing = null;            // { kind, list?, a?, id }
  let editingActivity = null;    // id, oppure "new:<area>"
  let editingGroup = null;       // id, oppure "new:<area>"
  let msWork = null;             // copia di lavoro dei traguardi nel foglio "Modifica traguardi"
  let msArea = "app";

  // ---------- utilità ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel) => root.querySelector(sel);
  const hhmm = (d) => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  const parseISO = (iso) => { const [y, m, d] = String(iso).split("-").map(Number); return y && m && d ? new Date(y, m - 1, d) : null; };
  const fmtDate = (iso, withYear = true) => {
    const d = parseISO(iso);
    return d ? d.toLocaleDateString("it-IT", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }) : esc(iso);
  };
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const daysFromToday = (iso) => {
    const d = parseISO(iso);
    if (!d) return null;
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((d - t) / 86400000);
  };
  const fmtSize = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1).replace(".", ",")} MB`;

  const AREAS = Model.AREAS;
  const LAUNCH = Model.LAUNCH;
  const areaById = (id) => AREAS.find((a) => a.id === id);
  const PRI = { alta: { label: "Alta", rank: 0, bang: "!!!" }, media: { label: "Media", rank: 1, bang: "!!" }, bassa: { label: "Bassa", rank: 2, bang: "!" } };
  // stato di un'attività: nei dati todo / doing / done (+ doneKind "paused" | "ended")
  const PHASES = {
    todo: { label: "Da fare", tip: "Da fare: non ancora iniziata" },
    doing: { label: "Attiva", tip: "Attiva: ci stiamo lavorando" },
    paused: { label: "Sospesa", tip: "Sospesa: trattata, siamo passati oltre, ma potremmo tornarci" },
    ended: { label: "Terminata", tip: "Terminata: chiusa, non ci si torna" },
  };
  const LISTS = [
    { key: "tasks", title: "Task generali", placeholder: "Nuovo task generale", empty: "Nessun task generale." },
    { key: "open", title: "Punti da definire", placeholder: "Nuovo punto da definire", empty: "Niente da definire." },
    { key: "ideas", title: "Idee", placeholder: "Nuova idea", empty: "Ancora nessuna idea." },
  ];

  let pendingRoute = false;     // link diretto a un'attività aperto prima che arrivino i dati
  let noteTimer = null;
  function flushNote() {
    clearTimeout(noteTimer);
    noteTimer = null;
    const el = root && $("#p-note");
    if (current && el && shownNoteFor === current && Model.activity(current) && el.value !== Model.activity(current).note) Model.setNote(current, el.value);
  }

  const ICON = {
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="M13.5 6.5l4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    board: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M7 9h6M7 12h10"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M10.5 18.5h3"/></svg>',
    news: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h13v14H6a2 2 0 0 1-2-2V5Z"/><path d="M17 9h3v8a2 2 0 0 1-2 2M7.5 9h6M7.5 12.5h6M7.5 16h4"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></svg>',
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    rocket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9-.8-.8-2.1-.8-2.9-.1Z"/><path d="M12 15l-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2Z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
    upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>',
    tray: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13h5l1.5 3h5L16 13h5"/><path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5l2.5-8Z"/></svg>',
    note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v11l-5 5H5V4Z"/><path d="M14 20v-5h5M8.5 8.5h7M8.5 12h4"/></svg>',
    question: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/></svg>',
    gavel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4l6 6M11 7l6 6M12.5 5.5l-5 5 6 6 5-5M10 13l-6 6"/><path d="M3 21h8"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5ZM8 7.5h8M8 11h5"/></svg>',
    clip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4l7.9-7.9"/></svg>',
    chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5Z"/></svg>',
    grip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"/></svg>',
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>',
    person: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="M19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/></svg>',
    ring: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/></svg>',
    live: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="live-halo" cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/></svg>',
    resume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 3.8v3.6h-3.6"/><path d="M8.6 12.3l2.3 2.3 4.4-4.5"/></svg>',
    ended: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="currentColor" stroke="none"/><path class="tick" d="M8.2 12.3l2.6 2.6 5-5.1"/></svg>',
    archive: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="4.5" rx="1.2"/><path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5M10 12.5h4"/></svg>',
    restore: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.2 3.8v3.6h3.6"/></svg>',
    hybrid: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="3.5"/><path d="M2 20a6 6 0 0 1 10.5-4"/><path d="M17 9l1.2 3.3 3.3 1.2-3.3 1.2L17 18l-1.2-3.3-3.3-1.2 3.3-1.2L17 9Z"/></svg>',
  };
  const OWNER_ICON = { Andrea: ICON.person, Agente: ICON.spark, Ibrido: ICON.hybrid };
  const PHASE_ICON = { todo: ICON.ring, doing: ICON.live, paused: ICON.resume, ended: ICON.ended };
  /**
   * controllo dello stato: Da fare · Attiva · [Sospesa | Terminata]
   * Sospesa e Terminata condividono l'ultimo posto: quella scelta è grande, l'altra diventa una piccola icona.
   * compact (card delle attività): solo lo stato scelto mostra il nome, gli altri sono icone.
   */
  function phaseControl(act, compact = false) {
    const cur = Model.phase(act);
    const bigOfPair = cur === "ended" ? "ended" : "paused";
    const btn = (k) => {
      const on = cur === k;
      const label = compact ? on : k === "todo" || k === "doing" || k === bigOfPair;
      return `<button type="button" role="radio" aria-checked="${on}" class="ph ${k} ${on ? "on" : ""} ${label ? "" : "mini"}"
        data-action="phase" data-id="${esc(act.id)}" data-value="${k}" title="${PHASES[k].tip}" aria-label="${PHASES[k].label}">
        <span class="ph-ico">${PHASE_ICON[k]}</span>${label ? `<span class="ph-label">${PHASES[k].label}</span>` : ""}</button>`;
    };
    return `<div class="phase ${compact ? "compact" : ""}" role="radiogroup" aria-label="Stato di ${esc(act.name)}">
      ${btn("todo")}${btn("doing")}<span class="ph-pair">${btn("paused")}${btn("ended")}</span>
    </div>`;
  }
  /** paginazione su iPhone: ritorna gli elementi della pagina corrente e disegna ‹ 1 di 3 › */
  function paginate(key, items, per, pagerSel) {
    const pager = $(pagerSel);
    if (!isPhone() || items.length <= per) {
      pages[key] = 0;
      pager.innerHTML = "";
      return items;
    }
    const n = Math.ceil(items.length / per);
    pages[key] = Math.min(Math.max(pages[key], 0), n - 1);
    const p = pages[key];
    pager.innerHTML = `<div class="pager">
      <button type="button" data-action="page" data-key="${key}" data-value="-1" aria-label="Pagina precedente" ${p === 0 ? "disabled" : ""}>${ICON.back}</button>
      <span>${p + 1} di ${n}</span>
      <button type="button" data-action="page" data-key="${key}" data-value="1" aria-label="Pagina successiva" ${p === n - 1 ? "disabled" : ""}>${ICON.chevron}</button>
    </div>`;
    return items.slice(p * per, p * per + per);
  }
  /** sfumatura in fondo alle sezioni che scorrono, finché c'è altro da vedere */
  function updateFade(el) {
    if (!el) return;
    const always = el.classList.contains("act-scroll");   // diario e decisioni dell'attività scorrono anche su iPhone
    el.classList.toggle("fade", (always || !isPhone()) && el.scrollHeight - el.scrollTop - el.clientHeight > 4);
  }
  const ownerChip = (o) => `<span class="owner ${esc(o).toLowerCase()}">${OWNER_ICON[o] || ""}${esc(o)}</span>`;
  const radioSeg = (name, options, checked) => options.map(([v, l, icon = ""]) =>
    `<label class="rseg-opt"><input type="radio" name="${name}" value="${esc(v)}" ${v === checked ? "checked" : ""}><span>${icon}${esc(l)}</span></label>`).join("");
  const priPick = (name, checked = "media") => `<div class="pri-pick" role="radiogroup" aria-label="Priorità">
    ${Object.entries(PRI).map(([k, p]) => `<label class="pri-opt ${k}"><input type="radio" name="${name}" value="${k}" ${k === checked ? "checked" : ""}><span>${p.label}</span></label>`).join("")}
  </div>`;
  /** <option> dei traguardi di un'area (+ Lancio) */
  function milestoneOptions(areaId, selected, emptyLabel) {
    const area = areaById(areaId);
    const opt = (m) => `<option value="${m.id}" ${m.id === selected ? "selected" : ""}>${esc(m.name)}${Model.isReached(m.id) ? " (raggiunto)" : ""}</option>`;
    return `<option value="">${emptyLabel}</option>${(area?.milestones || []).map(opt).join("")}${opt(LAUNCH)}`;
  }

  // ---------- struttura (una volta) ----------
  function mount(el, s) {
    root = el;
    store = s;
    root.innerHTML = `
      <header class="top" id="desk-top">
        <div class="top-title">
          <p class="eyebrow">Scrivania di progetto</p>
          <h1>App notizie</h1>
        </div>
        <div class="top-actions">
          <span class="sync" role="status" aria-live="polite"></span>
          <a id="board" class="pill-btn small board-btn" target="_blank" rel="noopener" title="Apri la lavagna del progetto su claude.ai">${ICON.board}<span>Lavagna</span></a>
          <button class="icon-btn" data-action="settings" aria-label="Impostazioni">${ICON.gear}</button>
        </div>
      </header>

      <nav class="navbar" id="act-nav" hidden>
        <button class="back-btn" data-action="go-desk">${ICON.back}<span>Scrivania</span></button>
        <div class="top-actions">
          <span class="sync" role="status"></span>
          <button class="icon-btn" data-action="settings" aria-label="Impostazioni">${ICON.gear}</button>
        </div>
      </nav>

      <div id="banner"></div>

      <!-- ================= SCRIVANIA ================= -->
      <div id="view-desk">
        <section class="card roadmap" aria-labelledby="h-road">
          <div class="card-head">
            <h2 id="h-road"><span class="h-icon accent">${ICON.rocket}</span>Timeline</h2>
            <div class="head-actions">
              <span class="hint">Tocca un traguardo per segnarlo raggiunto</span>
              <button class="pill-btn small" data-action="edit-milestones">${ICON.pencil}<span>Traguardi</span></button>
            </div>
          </div>
          <div id="roadmap" class="road-rows"></div>
        </section>

        <div class="hub">
          <section class="card journal" aria-labelledby="h-journal">
            <div class="card-head">
              <h2 id="h-journal"><span class="h-icon green">${ICON.book}</span>Diario del progetto</h2>
              <span id="journal-count" class="count"></span>
            </div>
            <form class="quick-log" id="quick-log" autocomplete="off">
              <div class="rseg ql-kind">${radioSeg("kind", [["done", "Fatto", ICON.check], ["decision", "Decisione", ICON.gavel]], "done")}</div>
              <textarea name="text" rows="2" placeholder="Cosa hai fatto?" aria-label="Testo" enterkeyhint="send"></textarea>
              <div class="quick-opts">
                <select name="act" id="ql-act" class="select-input act-select" aria-label="Attività"></select>
                <input name="date" type="date" class="date-input" aria-label="Data">
                <button class="add-btn show">Annota</button>
              </div>
            </form>
            <div id="prio-filter" class="chips" role="tablist" aria-label="Filtra per area"></div>
            <ol id="feed" class="feed scrollbox"></ol>
            <div id="feed-pager"></div>
          </section>

          <div class="hub-side">
            <section class="card decide-card" aria-labelledby="h-open">
              <div class="card-head">
                <h2 id="h-open"><span class="h-icon orange">${ICON.question}</span>Da decidere</h2>
                <span id="open-count" class="count"></span>
              </div>
              <p class="card-sub">I punti aperti che bloccano l'avanzamento, generali e delle attività.</p>
              <ul id="open-list" class="rows scrollbox"></ul>
              <div id="open-pager"></div>
              <form class="add add-wrap" data-kind="hub-open" autocomplete="off">
                <span class="add-icon">${ICON.plus}</span>
                <input name="text" placeholder="Nuovo punto da decidere" enterkeyhint="done" aria-label="Nuovo punto da decidere">
                <select name="act" class="select-input act-select" aria-label="Attività"></select>
                <button class="add-btn">Aggiungi</button>
              </form>
            </section>

            <section class="card todo-card" aria-labelledby="h-todo">
              <div class="card-head">
                <h2 id="h-todo"><span class="h-icon indigo">${ICON.check}</span>Da fare</h2>
                <span id="todo-count" class="count"></span>
              </div>
              <div id="prio-mode" class="seg full small-seg" role="tablist" aria-label="Ordina"></div>
              <ol id="prio-list" class="rows prio-list"></ol>
              <button id="prio-more" class="more-btn" data-action="prio-more" hidden></button>
              <form class="add add-wrap" data-kind="hub-task" autocomplete="off">
                <span class="add-icon">${ICON.plus}</span>
                <input name="text" placeholder="Qualcosa da fare" enterkeyhint="done" aria-label="Nuovo task">
                <select name="act" class="select-input act-select" aria-label="Attività"></select>
                <button class="add-btn">Aggiungi</button>
              </form>
            </section>

            <details class="card ideas-card" id="ideas-box">
              <summary><span class="h-icon yellow">${ICON.spark}</span><b>Parcheggio idee</b><span id="count-ideas" class="count"></span><span class="sum-chev">${ICON.chevron}</span></summary>
              <ul id="list-ideas" class="rows"></ul>
              ${addForm({ kind: "real", list: "ideas", placeholder: "Nuova idea" })}
            </details>
          </div>
        </div>

        <div class="areas">
          <div class="mobile-switch"><div id="area-switch" class="seg full" role="tablist" aria-label="Area"></div></div>
          ${AREAS.map((a) => `
            <section class="area ${a.id}" id="area-${a.id}" aria-labelledby="h-${a.id}">
              <div class="area-head">
                <span class="area-icon ${a.id}">${ICON[a.icon]}</span>
                <div class="area-title"><h2 id="h-${a.id}">${a.name}</h2><p id="area-sub-${a.id}"></p></div>
              </div>
              <p id="area-next-${a.id}" class="area-next"></p>
              <div id="groups-${a.id}" class="groups"></div>
              <div class="area-add">
                <button class="new-act" data-action="new-activity" data-value="${a.id}">${ICON.plus}<span>Attività</span></button>
                <button class="new-act" data-action="new-group" data-value="${a.id}">${ICON.folder}<span>Gruppo</span></button>
              </div>
            </section>`).join("")}
        </div>

        <details class="card archive-card" id="archive-box">
          <summary><span class="h-icon">${ICON.archive}</span><b>Archivio</b><span id="archive-count" class="count"></span><span class="sum-chev">${ICON.chevron}</span></summary>
          <div class="archive-inner">
            <p class="card-sub">Task completati, punti decisi, decisioni superate ed elementi eliminati. Niente si perde: da qui puoi sempre ripristinare.</p>
            <div id="archive-filter" class="chips" role="tablist" aria-label="Filtra l'archivio"></div>
            <ul id="archive-list" class="rows archive-list scrollbox"></ul>
            <div id="archive-pager"></div>
          </div>
        </details>
      </div>

      <!-- ================= PAGINA ATTIVITÀ ================= -->
      <div id="view-activity" hidden>
        <header class="act-hero">
          <span id="p-icon" class="area-icon big"></span>
          <div class="act-hero-text">
            <p id="p-crumb" class="crumb"></p>
            <h1 id="p-title"></h1>
            <p id="p-hint" class="act-hint"></p>
          </div>
          <div class="act-hero-actions">
            <button class="pill-btn" data-action="edit-activity">${ICON.pencil}<span>Modifica</span></button>
            <button class="pill-btn danger" data-action="delete-activity" aria-label="Elimina attività">${ICON.trash}</button>
          </div>
        </header>

        <div class="facts">
          <div class="fact"><span class="fact-k">Chi se ne occupa</span><div id="p-owner" class="seg full" role="radiogroup" aria-label="Chi se ne occupa"></div></div>
          <div class="fact"><span class="fact-k">Stato</span><div id="p-status"></div></div>
          <div class="fact"><span class="fact-k">Orizzonte</span><p id="p-until" class="fact-v"></p></div>
        </div>

        <div class="act-grid">
          <section class="card col-tasks col-log" aria-labelledby="h-plog">
            <div class="card-head"><h2 id="h-plog"><span class="h-icon green">${ICON.book}</span>Diario</h2><span id="p-count-log" class="count"></span></div>
            <form class="log-form" id="log-form" autocomplete="off">
              <textarea name="text" rows="2" placeholder="Cosa hai fatto?" aria-label="Cosa hai fatto?"></textarea>
              <textarea name="detail" rows="3" placeholder="Dettagli, link, cosa resta in sospeso… (facoltativo)" aria-label="Dettagli" class="log-detail-input" hidden></textarea>
              <ul id="log-pending" class="pending-files"></ul>
              <div class="log-opts">
                <button type="button" class="chip-btn" data-action="log-detail" id="log-detail-btn">${ICON.plus}Dettagli</button>
                <label class="chip-btn">${ICON.clip}Allega<input type="file" id="log-files" multiple hidden></label>
                <input name="date" type="date" class="date-input" aria-label="Data">
                <button class="add-btn show" id="log-submit">Annota</button>
              </div>
            </form>
            <ol id="p-log" class="log-list scrollbox act-scroll"></ol>
          </section>

          <section class="card col-files" aria-labelledby="h-pfiles">
            <div class="card-head"><h2 id="h-pfiles"><span class="h-icon">${ICON.tray}</span>File</h2><span id="p-count-files" class="count"></span></div>
            <ul id="p-files" class="file-grid"></ul>
            <label class="dropzone" id="dropzone">
              <input id="file-input" type="file" multiple hidden>
              <span class="drop-icon">${ICON.upload}</span>
              <span><b>Carica file</b><small class="drop-hint">oppure trascinali qui · max 25 MB</small></span>
            </label>
            <p id="upload-note" class="upload-note"></p>
          </section>

          <div class="col-side">
            <section class="card" aria-labelledby="h-pdec">
              <div class="card-head"><h2 id="h-pdec"><span class="h-icon">${ICON.gavel}</span>Decisioni</h2><span id="p-count-dec" class="count"></span></div>
              <ul id="p-dec" class="rows decisions scrollbox act-scroll"></ul>
              ${addForm({ kind: "ddec", placeholder: "Nuova decisione", date: true })}
            </section>
            <section class="card" aria-labelledby="h-popen">
              <div class="card-head"><h2 id="h-popen"><span class="h-icon">${ICON.question}</span>Da decidere</h2><span id="p-count-open" class="count"></span></div>
              <ul id="p-open" class="rows"></ul>
              ${addForm({ kind: "dopen", placeholder: "Nuovo punto da decidere" })}
            </section>
            <section class="card" aria-labelledby="h-ptasks">
              <div class="card-head"><h2 id="h-ptasks"><span class="h-icon indigo">${ICON.check}</span>Da fare</h2><span id="p-count-tasks" class="count"></span></div>
              <ul id="p-tasks" class="rows"></ul>
              <form class="add add-task" data-kind="dtask" autocomplete="off">
                <div class="add-line">
                  <span class="add-icon">${ICON.plus}</span>
                  <input name="text" placeholder="Qualcosa da fare" enterkeyhint="done" aria-label="Nuovo task">
                </div>
                <div class="add-opts">
                  ${priPick("priority")}
                  <label class="opt-field"><span>Scadenza</span><input name="due" type="date" class="date-input"></label>
                  <label class="opt-field"><span>Traguardo</span><select name="milestone" id="p-task-ms" class="select-input"></select></label>
                  <button class="add-btn show">Aggiungi</button>
                </div>
              </form>
            </section>
            <section class="card" aria-labelledby="h-pnote">
              <div class="card-head"><h2 id="h-pnote"><span class="h-icon">${ICON.note}</span>Note</h2></div>
              <textarea id="p-note" class="note" rows="6" placeholder="Appunti, link, idee su questa attività…" aria-labelledby="h-pnote"></textarea>
            </section>
          </div>
        </div>
      </div>

      <footer id="foot" class="foot"></footer>
      <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>

      <!-- foglio: modifica di un elemento -->
      <dialog id="sheet" class="sheet" aria-labelledby="sheet-title">
        <form method="dialog" id="sheet-form">
          <div class="sheet-head">
            <button value="cancel" class="text-btn">Annulla</button>
            <h2 id="sheet-title">Modifica</h2>
            <button type="submit" value="save" class="text-btn strong">Fine</button>
          </div>
          <textarea id="sheet-text" rows="3" aria-label="Testo"></textarea>
          <textarea id="sheet-detail" rows="5" aria-label="Dettagli" placeholder="Dettagli (facoltativi)" hidden></textarea>
          <div class="form-group">
            <div id="sheet-pri-wrap" class="f-row"><span>Priorità</span>${priPick("sheet-pri")}</div>
            <label id="sheet-ms-wrap" class="f-row"><span>Traguardo</span><select id="sheet-ms" class="select-input"></select></label>
            <label id="sheet-date-wrap" class="f-row"><span id="sheet-date-label">Data</span><input id="sheet-date" type="date" class="date-input"></label>
          </div>
          <button type="button" data-action="sheet-supersede" id="sheet-supersede" class="plain-btn">${ICON.archive} Segna come superata</button>
          <button type="button" data-action="sheet-delete" class="danger-btn">Elimina</button>
          <p class="f-note center">Quello che elimini va nell'Archivio, in fondo alla scrivania: puoi ripristinarlo quando vuoi.</p>
        </form>
      </dialog>

      <!-- foglio: nuova attività / modifica attività -->
      <dialog id="act-sheet" class="sheet" aria-labelledby="act-sheet-title">
        <form method="dialog" id="act-form" autocomplete="off">
          <div class="sheet-head">
            <button value="cancel" class="text-btn" formnovalidate>Annulla</button>
            <h2 id="act-sheet-title">Nuova attività</h2>
            <button type="submit" value="save" class="text-btn strong">Salva</button>
          </div>
          <div class="form-group">
            <label class="f-row stack"><span>Nome</span><input name="name" required placeholder="Es. Onboarding" class="text-input"></label>
            <div class="f-row stack"><span>Area</span><div class="rseg" id="af-area">${radioSeg("area", AREAS.map((a) => [a.id, a.name]), "app")}</div></div>
            <label class="f-row stack"><span>Gruppo</span><select name="group" id="af-group" class="select-input"></select></label>
            <div class="f-row stack"><span>Chi se ne occupa</span><div class="rseg">${radioSeg("owner", Model.OWNERS.map((o) => [o, o, OWNER_ICON[o]]), "Ibrido")}</div></div>
            <label class="f-row stack"><span>Nota breve</span><input name="hint" placeholder="Facoltativa, es. «solo nazionale, per ora»" class="text-input"></label>
            <label class="f-row stack"><span>Si chiude con</span><select name="until" id="af-until" class="select-input"></select></label>
          </div>
          <button type="button" data-action="act-delete" id="af-delete" class="danger-btn">Elimina attività</button>
        </form>
      </dialog>

      <!-- foglio: nuovo gruppo / modifica gruppo -->
      <dialog id="group-sheet" class="sheet" aria-labelledby="group-sheet-title">
        <form method="dialog" id="group-form" autocomplete="off">
          <div class="sheet-head">
            <button value="cancel" class="text-btn" formnovalidate>Annulla</button>
            <h2 id="group-sheet-title">Nuovo gruppo</h2>
            <button type="submit" value="save" class="text-btn strong">Salva</button>
          </div>
          <div class="form-group">
            <label class="f-row stack"><span>Nome del gruppo</span><input name="name" required placeholder="Es. Stile e design" class="text-input"></label>
            <p id="group-area-note" class="f-note"></p>
          </div>
          <div id="group-move" class="move-row">
            <button type="button" class="plain-btn" data-action="group-up">${ICON.up}Sposta su</button>
            <button type="button" class="plain-btn" data-action="group-down">${ICON.down}Sposta giù</button>
          </div>
          <button type="button" data-action="group-delete" id="group-delete" class="danger-btn">Elimina gruppo</button>
          <p id="group-delete-note" class="f-note center">Le attività del gruppo non vengono eliminate: restano nell'area come card a sé.</p>
        </form>
      </dialog>

      <!-- foglio: modifica traguardi -->
      <dialog id="ms-sheet" class="sheet" aria-labelledby="ms-sheet-title">
        <form method="dialog" id="ms-form" autocomplete="off">
          <div class="sheet-head">
            <button value="cancel" class="text-btn">Annulla</button>
            <h2 id="ms-sheet-title">Traguardi</h2>
            <button type="submit" value="save" class="text-btn strong">Fine</button>
          </div>
          <div id="ms-area" class="seg full" role="tablist" aria-label="Area"></div>
          <ol id="ms-list" class="ms-list"></ol>
          <button type="button" class="plain-btn" data-action="ms-add">${ICON.plus} Aggiungi traguardo</button>
          <p class="f-note center">I traguardi vanno in ordine di tempo. Il Lancio è comune a tutte le aree.<br>Se elimini un traguardo, i task e le attività collegati restano, senza traguardo.</p>
        </form>
      </dialog>

      <dialog id="settings" class="sheet" aria-labelledby="settings-title">
        <form method="dialog">
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
    // le modifiche si applicano al tocco su "Fine"/"Salva" (submit), la chiusura serve solo a fare pulizia
    const onSave = (formSel, fn) => $(formSel).addEventListener("submit", (e) => { if (e.submitter?.value === "save") fn(); });
    onSave("#sheet-form", onSheetClose);
    onSave("#act-form", onActSheetClose);
    onSave("#group-form", onGroupSheetClose);
    onSave("#ms-form", onMsSheetClose);
    $("#sheet").addEventListener("close", () => { editing = null; });
    $("#act-sheet").addEventListener("close", () => { editingActivity = null; });
    $("#group-sheet").addEventListener("close", () => { editingGroup = null; });
    $("#ms-sheet").addEventListener("close", () => { msWork = null; });
    setupMilestoneDrag();
    $("#ms-list").addEventListener("input", (e) => {
      const i = Number(e.target.dataset.i);
      if (msWork && e.target.matches("input") && msWork[msArea][i]) msWork[msArea][i].name = e.target.value;
    });
    $("#act-form").addEventListener("change", (e) => { if (e.target.name === "area") fillActFormArea(e.target.value); });
    for (const d of root.querySelectorAll("dialog")) {
      d.addEventListener("click", (e) => { if (e.target === d) d.close("cancel"); });
    }
    $("#file-input").addEventListener("change", (e) => {
      if (current && e.target.files.length) upload(current, e.target.files);
      e.target.value = "";
    });
    const dz = $("#dropzone");
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("over"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("over");
      if (current && e.dataTransfer.files.length) upload(current, e.dataTransfer.files);
    });
    // note: si salvano poco dopo che smetti di scrivere, quando esci dal campo o cambi pagina
    $("#p-note").addEventListener("input", () => { clearTimeout(noteTimer); noteTimer = setTimeout(flushNote, 800); });
    $("#p-note").addEventListener("blur", flushNote);
    // diario: annotazione veloce (barra laterale) e composer della pagina attività
    $("#quick-log").addEventListener("submit", (e) => { e.preventDefault(); submitQuickLog(); });
    $("#ql-act").addEventListener("change", (e) => { quickAct = e.target.value; });
    $("#quick-log").addEventListener("change", (e) => {
      if (e.target.name === "kind") $("#quick-log").text.placeholder = e.target.value === "decision" ? "Cosa avete deciso?" : "Cosa hai fatto?";
    });
    $("#log-form").addEventListener("submit", (e) => { e.preventDefault(); submitLog(); });
    for (const ta of [$("#quick-log").text, $("#log-form").text]) {
      ta.addEventListener("keydown", (e) => {   // Invio = annota, Maiusc+Invio = a capo
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ta.form.requestSubmit(); }
      });
    }
    $("#log-files").addEventListener("change", (e) => {
      pendingFiles.push(...e.target.files);
      e.target.value = "";
      renderPending();
    });
    for (const sel of ["#feed", "#open-list", "#archive-list", "#p-log", "#p-dec"]) $(sel).addEventListener("scroll", (e) => updateFade(e.target), { passive: true });
    $("#archive-box").addEventListener("toggle", () => renderArchive());
    phoneMq.addEventListener("change", () => render(lastData, lastStatus));
    window.addEventListener("resize", () => root.querySelectorAll(".track.scroll").forEach(roadFade), { passive: true });
    window.addEventListener("hashchange", route);

    route();
  }

  async function upload(actId, files) {
    const n = files.length;
    showToast(n === 1 ? `Carico «${files[0].name}»…` : `Carico ${n} file…`);
    const res = await Model.addFiles(actId, files);
    if (res.errors.length) showToast(res.errors[0] + (res.errors.length > 1 ? ` (e altri ${res.errors.length - 1})` : ""));
    else showToast(n === 1 ? "File caricato" : `${n} file caricati`);
  }

  function addForm({ kind, list = "", placeholder, date = false }) {
    return `<form class="add ${date ? "add-wrap" : ""}" data-kind="${kind}" data-list="${list}" autocomplete="off">
      <span class="add-icon">${ICON.plus}</span>
      <input name="text" placeholder="${placeholder}" enterkeyhint="done" aria-label="${placeholder}">
      ${date ? `<input name="date" type="date" class="date-input" aria-label="Data">` : ""}
      <button class="add-btn">Aggiungi</button>
    </form>`;
  }

  // ---------- navigazione ----------
  function route() {
    const m = location.hash.match(/^#\/a\/(.+)$/);
    const id = m && decodeURIComponent(m[1]);
    const wasDesk = view === "desk";
    flushNote();
    if (id && !window.Store.data) { pendingRoute = true; return; }
    if (id && Model.activity(id)) {
      if (wasDesk) deskScroll = window.scrollY;
      view = "activity";
      if (current !== id) { current = id; shownNoteFor = null; pendingFiles = []; renderPending(); }
      render(lastData, lastStatus);
      window.scrollTo(0, 0);
    } else {
      view = "desk";
      current = null;
      render(lastData, lastStatus);
      if (!wasDesk) requestAnimationFrame(() => window.scrollTo(0, deskScroll));
    }
  }
  const goActivity = (id) => { location.hash = `#/a/${encodeURIComponent(id)}`; };
  const goDesk = () => { if (location.hash && location.hash !== "#/") location.hash = "#/"; else route(); };

  // ---------- eventi ----------
  function onClick(e) {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const { action, kind, list, a, id, value } = t.dataset;
    switch (action) {
      case "open-activity": goActivity(id); break;
      case "go-desk": goDesk(); break;
      case "phase": if (id) Model.setPhase(id, value); break;
      case "page": {
        pages[t.dataset.key] += Number(value);
        if (t.dataset.key === "feed") renderJournal(lastData);
        else if (t.dataset.key === "open") renderOpen(lastData);
        else renderArchive();
        const sec = t.closest(".card");
        if (sec && sec.getBoundingClientRect().top < 0) sec.scrollIntoView({ block: "start", behavior: "smooth" });
        break;
      }
      case "arch-filter": archFilter = value; pages.archive = 0; renderArchive(); break;
      case "restore": restoreFromArchive(t.dataset.key); break;
      case "purge":
        if (confirm("Eliminare per sempre questo elemento? Non si potrà più ripristinare.")) { Model.purge(id); showToast("Eliminato per sempre"); }
        break;
      case "sheet-supersede": {
        const ed = editing;
        editing = null;
        $("#sheet").close("cancel");
        if (ed) showUndo("Decisione superata: è nell'Archivio", Model.supersedeDecision(ed.kind === "ddec" ? ed.a : "", ed.id));
        break;
      }
      case "owner": if (current) Model.setOwner(current, value); break;
      case "milestone": Model.clickMilestone(id); break;
      case "road-scroll": {
        const tr = t.parentElement.querySelector(".track");
        tr.scrollBy({ left: Number(value) * Math.max(160, tr.clientWidth * 0.7), behavior: "smooth" });
        break;
      }
      case "area": mobileArea = value; renderAreas(); break;
      case "log-detail": {
        const ta = $("#log-form").detail;
        ta.hidden = !ta.hidden;
        $("#log-detail-btn").classList.toggle("on", !ta.hidden);
        if (!ta.hidden) ta.focus();
        break;
      }
      case "unpend": pendingFiles.splice(Number(t.dataset.i), 1); renderPending(); break;
      case "prio-mode": prioMode = value; prioExpanded = false; renderPriorities(lastData); break;
      case "prio-filter": prioFilter = value; pages.feed = 0; $("#feed").scrollTop = 0; renderJournal(lastData); break;
      case "prio-more": prioExpanded = !prioExpanded; renderPriorities(lastData); break;
      case "new-activity": openActSheet(null, value, t.dataset.group || ""); break;
      case "new-group": openGroupSheet(null, value); break;
      case "edit-group": openGroupSheet(id); break;
      case "group-up": case "group-down": {
        const g = editingGroup && Model.group(editingGroup);
        if (g) Model.moveBlock(g.area, "g:" + g.id, action === "group-up" ? -1 : 1);
        break;
      }
      case "group-delete": {
        const gid = editingGroup;
        editingGroup = null;
        $("#group-sheet").close("cancel");
        const g = gid && Model.group(gid);
        if (g) showUndo(`Gruppo «${g.name}» eliminato`, Model.removeGroup(gid));
        break;
      }
      case "edit-milestones": openMsSheet(); break;
      case "ms-area": msArea = value; renderMsSheet(); break;
      case "ms-add": msWork[msArea].push({ id: "", name: "" }); renderMsSheet(true); break;
      case "ms-del": msWork[msArea].splice(Number(t.dataset.i), 1); renderMsSheet(); break;
      case "ms-up": case "ms-down": {
        const list = msWork[msArea], i = Number(t.dataset.i), j = i + (action === "ms-up" ? -1 : 1);
        if (j >= 0 && j < list.length) { [list[i], list[j]] = [list[j], list[i]]; renderMsSheet(); }
        break;
      }
      case "edit-activity": if (current) openActSheet(current); break;
      case "delete-activity": if (current) deleteActivity(current); break;
      case "act-delete": {
        const id2 = editingActivity;
        editingActivity = null;
        $("#act-sheet").close("cancel");
        if (id2 && !id2.startsWith("new:")) deleteActivity(id2);
        break;
      }
      case "toggle": toggle(kind, list, a, id); break;
      case "edit": openSheet({ kind, list, a, id }); break;
      case "delete": remove({ kind, list, a, id }); break;
      case "sheet-delete": {
        const ed = editing;
        editing = null;
        $("#sheet").close("cancel");
        if (ed) remove(ed);
        break;
      }
      case "settings": openSettings(); break;
      case "save-token": saveToken(); break;
      case "clear-token": store.clearToken(); $("#token").value = ""; setTokenMsg("Token rimosso.", ""); break;
      case "refresh": store.refresh(); setTokenMsg("Dati ricaricati.", ""); break;
      case "undo": t._undo?.(); hideToast(); break;
      case "retry": store.flush(); break;
    }
  }

  function onKey(e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[role=button][data-action]")) {
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
    switch (f.dataset.kind) {
      case "real": store.addItem(f.dataset.list, text); break;
      case "decision": store.addDecision(text, f.date.value || undefined); f.date.value = ""; break;
      case "dtask":
        if (!current) return;
        Model.addTask(current, { text, priority: f.priority.value || "media", due: f.due.value, milestone: f.milestone.value });
        f.due.value = "";
        break;
      case "ddec": if (current) Model.addDecision(current, text, f.date.value); f.date.value = ""; break;
      case "dopen": if (current) Model.addOpen(current, text); break;
      case "hub-open": if (f.act.value) Model.addOpen(f.act.value, text); else store.addItem("open", text); break;
      case "hub-task": if (f.act.value) Model.addTask(f.act.value, { text }); else store.addItem("tasks", text); break;
    }
    f.text.value = "";
    f.text.focus();
  }

  function toggle(kind, list, a, id) {
    if (kind === "real") store.toggleItem(list, id);
    else if (kind === "dtask") Model.toggleTask(a, id);
    else if (kind === "dopen") Model.toggleOpen(a, id);
  }

  function remove({ kind, list, a, id }) {
    let undo, msg = "Eliminato";
    if (kind === "real") undo = store.removeItem(list, id);
    else if (kind === "decision") { undo = store.removeDecision(id); msg = "Decisione eliminata"; }
    else if (kind === "dtask") { undo = Model.removeTask(a, id); msg = "Task eliminato"; }
    else if (kind === "dopen") undo = Model.removeOpen(a, id);
    else if (kind === "ddec") { undo = Model.removeDecision(a, id); msg = "Decisione eliminata"; }
    else if (kind === "dfile") { undo = Model.removeFile(a, id); msg = "File rimosso"; }
    else if (kind === "dlog") { undo = Model.removeLog(a, id); msg = "Voce del diario eliminata"; }
    if (undo) showUndo(`${msg}: è nell'Archivio`, undo);
  }

  function deleteActivity(id) {
    const act = Model.activity(id);
    if (!act) return;
    if (current === id) flushNote();
    const undo = Model.removeActivity(id);
    if (current === id) goDesk();
    showUndo(`«${act.name}» spostata nell'Archivio`, undo);
  }

  // ---------- timeline ----------
  // Ogni area è una striscia che scorre in orizzontale (i traguardi possono essere tanti), con i nomi
  // sempre leggibili; il Lancio resta fisso in fondo. La striscia si porta da sola sul prossimo traguardo.
  const roadSeen = {};            // area -> progresso già mostrato (per lo scorrimento automatico)
  function nodeHtml(m, i, nodes, reached, next) {
    const isLaunch = m.id === LAUNCH.id;
    const ok = reached[i];
    const isNext = next && m.id === next.id;
    // segmento a destra di questo nodo: pieno se il nodo seguente è raggiunto, tenue se è il prossimo
    const right = i < nodes.length - 1 ? (reached[i + 1] ? "seg-ok" : (next && nodes[i + 1].id === next.id && ok) ? "seg-next" : "") : "";
    const left = i > 0 ? (ok ? "in-ok" : isNext && reached[i - 1] ? "in-next" : "") : "";
    return `<li class="node ${ok ? "ok" : ""} ${isNext ? "next" : ""} ${isLaunch ? "launch" : ""} ${right} ${left}">
      <button data-action="milestone" data-id="${m.id}" aria-pressed="${ok}" title="${esc(m.name)}${ok ? " · raggiunto" : ""}">
        <span class="dot">${ok ? ICON.check : isLaunch ? ICON.flag : `<small>${i + 1}</small>`}</span>
        <span class="node-name">${esc(m.name)}</span>
      </button>
    </li>`;
  }
  function renderRoadmap() {
    const html = AREAS.map((a) => {
      const done = Model.progress(a.id);
      const next = Model.nextMilestone(a.id);
      const nodes = [...a.milestones, LAUNCH];
      const reached = nodes.map((m) => Model.isReached(m.id));
      const k = nodes.length - 1;
      return `<div class="road ${a.id}">
        <div class="road-label">
          <span class="road-name"><i></i>${a.name}</span>
          <span class="road-count">${done} di ${a.milestones.length}</span>
        </div>
        <div class="road-strip">
          <button class="road-arrow l" data-action="road-scroll" data-value="-1" tabindex="-1" aria-label="Traguardi precedenti">${ICON.back}</button>
          <ol class="track scroll" data-area="${a.id}">${nodes.slice(0, k).map((m, i) => nodeHtml(m, i, nodes, reached, next)).join("")}</ol>
          <button class="road-arrow r" data-action="road-scroll" data-value="1" tabindex="-1" aria-label="Traguardi successivi">${ICON.chevron}</button>
        </div>
        <ol class="track launch-track">${nodeHtml(nodes[k], k, nodes, reached, next)}</ol>
      </div>`;
    }).join("");
    const box = $("#roadmap");
    if (box.dataset.html !== html) {
      const keep = Object.fromEntries([...box.querySelectorAll(".track.scroll")].map((t) => [t.dataset.area, t.scrollLeft]));
      box.innerHTML = html;
      box.dataset.html = html;
      box.querySelectorAll(".track.scroll").forEach((t) => {
        t.scrollLeft = keep[t.dataset.area] || 0;
        t.addEventListener("scroll", () => roadFade(t), { passive: true });
      });
    }
    // porta in vista il prossimo traguardo: all'apertura e quando cambia il progresso
    box.querySelectorAll(".track.scroll").forEach((t) => {
      const area = t.dataset.area;
      const p = Model.progress(area);
      if (roadSeen[area] !== p && t.clientWidth) {
        const nodes = t.querySelectorAll(".node");
        const target = nodes[Math.max(0, p - 1)];     // l'ultimo raggiunto a sinistra, poi il prossimo
        const left = target && p > 0 ? target.offsetLeft - 8 : 0;
        t.scrollTo({ left, behavior: roadSeen[area] === undefined ? "auto" : "smooth" });
        roadSeen[area] = p;
      }
      roadFade(t);
    });
  }
  function roadFade(t) {
    const max = t.scrollWidth - t.clientWidth;
    const strip = t.parentElement;
    strip.classList.toggle("more-l", t.scrollLeft > 4);
    strip.classList.toggle("more-r", t.scrollLeft < max - 4);
  }

  // ---------- priorità ----------
  function tierOf(t) {
    const days = t.due ? daysFromToday(t.due) : null;
    if (days !== null && days < 0) return 0;                               // scaduto
    if (t.milestone && t.area && Model.isReached(t.milestone)) return 0;    // traguardo già passato
    if (t.priority === "alta") return 1;
    if (days !== null && days <= 2) return 2;                              // in scadenza
    if (t.milestone && t.area && Model.nextMilestone(t.area)?.id === t.milestone) return 2; // serve per il prossimo traguardo
    return t.priority === "media" ? 3 : 4;
  }
  function sortByUrgency(list) {
    return list.slice().sort((x, y) =>
      (x.done - y.done) ||
      (tierOf(x) - tierOf(y)) ||
      ((x.due || "9999").localeCompare(y.due || "9999")) ||
      (PRI[x.priority]?.rank ?? 1) - (PRI[y.priority]?.rank ?? 1) ||
      (x.created || 0) - (y.created || 0));
  }
  function dueChip(iso) {
    if (!iso) return "";
    const d = daysFromToday(iso);
    let t, cls = "";
    if (d < 0) { t = d === -1 ? "Scaduto ieri" : `Scaduto da ${-d} gg`; cls = "late"; }
    else if (d === 0) { t = "Oggi"; cls = "soon"; }
    else if (d === 1) { t = "Domani"; cls = "soon"; }
    else if (d < 7) t = `Tra ${d} gg`;
    else t = fmtDate(iso, false);
    return `<span class="due ${cls}">${t}</span>`;
  }
  function msChip(id) {
    if (!id) return "";
    const m = Model.milestone(id);
    if (!m) return "";
    return `<span class="ms ${Model.isReached(id) ? "passed" : ""}">${ICON.flag}${esc(m.name)}</span>`;
  }

  function allOpenTasks(data) {
    const out = [];
    for (const act of Model.activities()) {
      for (const t of Model.get(act.id).tasks) if (!t.done) out.push({ ...t, a: act.id, kind: "dtask", act, area: act.area });
    }
    for (const t of data.tasks) if (!t.done) out.push({ ...t, kind: "real", list: "tasks", priority: "media", due: "", area: "common" });
    return sortByUrgency(out);
  }

  function taskRow(t, { context = false, showMs = true } = {}) {
    const kind = t.kind || "dtask";
    const attrs = `data-kind="${kind}" data-list="${t.list || ""}" data-a="${t.a || ""}" data-id="${esc(t.id)}"`;
    const bang = kind === "dtask" && PRI[t.priority] ? `<span class="bang ${t.priority}" title="Priorità ${PRI[t.priority].label.toLowerCase()}">${PRI[t.priority].bang}</span>` : "";
    const ctx = context
      ? (t.act
        ? `<button class="ctx ${t.area}" data-action="open-activity" data-id="${esc(t.act.id)}"><i></i>${esc(t.act.name)}</button>`
        : `<span class="ctx common"><i></i>In comune</span>`)
      : "";
    return `<li class="row task ${t.done ? "done" : ""}">
      <button class="check" role="checkbox" aria-checked="${!!t.done}" data-action="toggle" ${attrs} aria-label="${t.done ? "Riapri" : "Segna come fatto"}"><span>${ICON.check}</span></button>
      <div class="row-main">
        <span class="row-text" tabindex="0" role="button" data-action="edit" ${attrs}>${bang}${esc(t.text)}</span>
        <span class="row-meta">${ctx}${dueChip(t.due)}${showMs ? msChip(t.milestone) : ""}</span>
      </div>
      <button class="del" data-action="delete" ${attrs} aria-label="Elimina">${ICON.x}</button>
    </li>`;
  }

  function simpleRow(it, { kind, list = "", a = "" }) {
    const attrs = `data-kind="${kind}" data-list="${list}" data-a="${a}" data-id="${esc(it.id)}"`;
    return `<li class="row ${it.done ? "done" : ""}">
      <button class="check" role="checkbox" aria-checked="${!!it.done}" data-action="toggle" ${attrs} aria-label="${it.done ? "Riapri" : "Segna come fatto"}"><span>${ICON.check}</span></button>
      <span class="row-text" tabindex="0" role="button" data-action="edit" ${attrs}>${esc(it.text)}</span>
      <button class="del" data-action="delete" ${attrs} aria-label="Elimina">${ICON.x}</button>
    </li>`;
  }

  function decisionRow(d, kind, a = "") {
    const attrs = `data-kind="${kind}" data-a="${a}" data-id="${esc(d.id)}"`;
    return `<li class="row">
      <span class="row-text" tabindex="0" role="button" data-action="edit" ${attrs}>
        <time datetime="${esc(d.date)}">${fmtDate(d.date)}</time>${esc(d.text)}
      </span>
      <button class="del" data-action="delete" ${attrs} aria-label="Elimina">${ICON.x}</button>
    </li>`;
  }
  const sortDecisions = (arr) => arr.map((d, i) => ({ d, i }))
    .sort((a, b) => String(b.d.date).localeCompare(String(a.d.date)) || b.i - a.i).map((x) => x.d);

  // ---------- diario ----------
  function relDay(iso) {
    const n = daysFromToday(iso);
    if (n === 0) return "Oggi";
    if (n === -1) return "Ieri";
    const d = parseISO(iso);
    if (!d) return esc(iso);
    if (n > -7 && n < 0) return d.toLocaleDateString("it-IT", { weekday: "long" }).replace(/^./, (c) => c.toUpperCase());
    return d.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  }
  /** allegati di una voce: i file a cui punta, cercati tra quelli della sua attività (o "In comune") */
  function entryFiles(e) {
    const all = Model.filesOf(e.a ?? current ?? "");
    return (e.files || []).map((id) => all.find((f) => f.id === id)).filter(Boolean);
  }
  function fileChip(f, big = false) {
    const url = Model.fileUrl(f);
    const img = f.type?.startsWith("image/");
    const inner = big && img && url
      ? `<img src="${esc(url)}" alt="" loading="lazy"><span>${esc(f.name)}</span>`
      : `${img ? ICON.image : ICON.file}<span>${esc(f.name)}</span>`;
    return url ? `<a class="att ${big && img && url ? "att-img" : ""}" href="${esc(url)}" target="_blank" rel="noopener">${inner}</a>` : `<span class="att">${inner}</span>`;
  }
  /** una voce del diario; context = mostra a quale attività appartiene (nella barra laterale) */
  function logEntry(e, { context = false } = {}) {
    const a = e.a ?? current ?? "";
    const attrs = `data-kind="dlog" data-a="${esc(a)}" data-id="${esc(e.id)}"`;
    const files = entryFiles({ ...e, a });
    const where = context && e.act
      ? `<button class="ctx ${e.act.area}" data-action="open-activity" data-id="${esc(e.act.id)}"><i></i>${esc(e.act.name)}</button>`
      : "";
    return `<li class="log-entry">
      <span class="log-mark" title="Fatto">${ICON.check}</span>
      <div class="log-body">
        <div class="log-top">
          <span class="log-text" tabindex="0" role="button" data-action="edit" ${attrs}>${esc(e.text)}</span>
          <button class="del" data-action="delete" ${attrs} aria-label="Elimina voce">${ICON.x}</button>
        </div>
        ${e.detail ? `<p class="log-detail ${context ? "clamp" : ""}">${esc(e.detail)}</p>` : ""}
        ${files.length ? `<div class="log-files">${context ? `<span class="att">${ICON.clip}<span>${files.length} ${files.length === 1 ? "allegato" : "allegati"}</span></span>` : files.map((f) => fileChip(f, true)).join("")}</div>` : ""}
        ${where || e.source === "chat" ? `<div class="log-meta">${where}${e.source === "chat" ? `<span class="src" title="Annotato da una chat di Claude">${ICON.chat}da chat</span>` : ""}</div>` : ""}
      </div>
    </li>`;
  }
  /** voci raggruppate per giorno */
  function logGroups(entries, opts) {
    let html = "", day = null;
    for (const e of entries) {
      if (e.date !== day) { day = e.date; html += `<li class="log-day"><span>${relDay(day)}</span></li>`; }
      html += logEntry(e, opts);
    }
    return html;
  }

  /** voce "decisione" nel diario del progetto */
  function decisionEntry(e) {
    const kind = e.act ? "ddec" : "decision";
    const attrs = `data-kind="${kind}" data-a="${esc(e.a)}" data-id="${esc(e.id)}"`;
    const where = e.act
      ? `<button class="ctx ${e.act.area}" data-action="open-activity" data-id="${esc(e.act.id)}"><i></i>${esc(e.act.name)}</button>`
      : "";
    return `<li class="log-entry dec">
      <span class="log-mark dec" title="Decisione">${ICON.gavel}</span>
      <div class="log-body">
        <div class="log-top">
          <span class="log-text" tabindex="0" role="button" data-action="edit" ${attrs}><span class="sr-only">Decisione: </span>${esc(e.text)}</span>
          <button class="del" data-action="delete" ${attrs} aria-label="Elimina decisione">${ICON.x}</button>
        </div>
        ${where ? `<div class="log-meta">${where}</div>` : ""}
      </div>
    </li>`;
  }
  /** tutto il diario del progetto: cose fatte e decisioni (generali e delle attività), dalla più recente */
  function allJournal(data) {
    const out = Model.allLog().map((e) => ({ ...e, type: "log" }));
    for (const d of data.decisions) out.push({ ...d, type: "dec", act: null, a: "" });
    for (const act of Model.activities()) for (const d of act.decisions || []) out.push({ ...d, type: "dec", act, a: act.id });
    return out.sort((x, y) => String(y.date).localeCompare(String(x.date)) || (x.type === y.type ? (y.created || 0) - (x.created || 0) : x.type === "log" ? -1 : 1));
  }

  function renderJournal(data) {
    $("#prio-filter").innerHTML = [["all", "Tutto"], ...AREAS.map((a) => [a.id, a.name]), ["common", "In comune"]].map(([k, l]) =>
      `<button role="tab" aria-selected="${prioFilter === k}" class="chip ${k} ${prioFilter === k ? "on" : ""}" data-action="prio-filter" data-value="${k}">${k !== "all" ? "<i></i>" : ""}${l}</button>`).join("");
    const all = allJournal(data);
    const list = prioFilter === "all" ? all : prioFilter === "common" ? all.filter((e) => !e.act) : all.filter((e) => e.act?.area === prioFilter);
    const week = all.filter((e) => daysFromToday(e.date) > -7);
    const nDone = week.filter((e) => e.type === "log").length, nDec = week.length - nDone;
    $("#journal-count").textContent = week.length ? `questa settimana: ${nDone} ${nDone === 1 ? "fatto" : "fatti"} · ${nDec} ${nDec === 1 ? "decisione" : "decisioni"}` : "";
    // su Mac tutto, dentro la sezione che scorre; su iPhone a pagine
    const shown = paginate("feed", list, 8, "#feed-pager");
    let html = "", day = null;
    for (const e of shown) {
      if (e.date !== day) {
        day = e.date;
        const ofDay = list.filter((x) => x.date === day);
        const f = ofDay.filter((x) => x.type === "log").length, dd = ofDay.length - f;
        const sum = [f ? `${f} ${f === 1 ? "fatto" : "fatti"}` : "", dd ? `${dd} ${dd === 1 ? "decisione" : "decisioni"}` : ""].filter(Boolean).join(" · ");
        html += `<li class="log-day"><span>${relDay(day)}</span><small>${sum}</small></li>`;
      }
      html += e.type === "dec" ? decisionEntry(e) : logEntry(e, { context: true });
    }
    $("#feed").innerHTML = html || `<li class="empty feed-empty">${all.length ? "Niente in questa area." : "Ancora niente. Annota qui cosa hai fatto o deciso, oppure a fine sessione chiedi a Claude di aggiornare la dashboard."}</li>`;
    updateFade($("#feed"));
    const dateIn = $("#quick-log").date;
    if (!dateIn.value) dateIn.value = todayISO();
  }

  /** <option> per scegliere dove va una cosa: In comune oppure un'attività */
  function actOptions() {
    return `<option value="">In comune</option>` + AREAS.map((a) => `<optgroup label="${esc(a.name)}">${
      Model.blocks(a.id).flatMap((b) => b.group ? b.acts.map((x) => [x, b.group.name]) : [[b.act, ""]])
        .map(([x, g]) => `<option value="${esc(x.id)}">${g ? esc(g) + " › " : ""}${esc(x.name)}</option>`).join("")
    }</optgroup>`).join("");
  }
  function fillActSelects() {
    const html = actOptions();
    root.querySelectorAll(".act-select").forEach((sel) => {
      if (document.activeElement === sel) return;   // non mentre lo stai usando
      const keep = sel.id === "ql-act" ? quickAct : sel.value;
      if (sel.dataset.html !== html) { sel.innerHTML = html; sel.dataset.html = html; }
      sel.value = Model.activity(keep) ? keep : "";
    });
  }

  function renderOpen(data) {
    const items = [
      ...data.open.filter((o) => !o.done).map((o) => ({ ...o, kind: "real", list: "open", a: "" })),
      ...Model.activities().flatMap((act) => (act.open || []).filter((o) => !o.done).map((o) => ({ ...o, kind: "dopen", a: act.id, act }))),
    ];
    $("#open-count").textContent = items.length ? String(items.length) : "";
    const shown = paginate("open", items, 5, "#open-pager");
    $("#open-list").innerHTML = items.length ? shown.map((o) => {
      const attrs = `data-kind="${o.kind}" data-list="${o.list || ""}" data-a="${esc(o.a)}" data-id="${esc(o.id)}"`;
      const where = o.act
        ? `<button class="ctx ${o.act.area}" data-action="open-activity" data-id="${esc(o.act.id)}"><i></i>${esc(o.act.name)}</button>`
        : `<span class="ctx common"><i></i>In comune</span>`;
      return `<li class="row">
        <button class="check" role="checkbox" aria-checked="false" data-action="toggle" ${attrs} aria-label="Segna come deciso"><span>${ICON.check}</span></button>
        <div class="row-main">
          <span class="row-text" tabindex="0" role="button" data-action="edit" ${attrs}>${esc(o.text)}</span>
          <span class="row-meta">${where}</span>
        </div>
        <button class="del" data-action="delete" ${attrs} aria-label="Elimina">${ICON.x}</button>
      </li>`;
    }).join("") : `<li class="empty">Nessun punto aperto. Niente blocca l'avanzamento.</li>`;
    updateFade($("#open-list"));
  }

  function renderIdeas(data) {
    const items = data.ideas.filter((x) => !x.done);   // quelle spuntate vanno nell'Archivio
    $("#count-ideas").textContent = items.length ? String(items.length) : "";
    $("#list-ideas").innerHTML = items.length ? items.map((it) => simpleRow(it, { kind: "real", list: "ideas" })).join("") : `<li class="empty">Nessuna idea parcheggiata.</li>`;
  }

  function submitQuickLog() {
    const f = $("#quick-log");
    const text = f.text.value.trim();
    if (!text) { f.text.focus(); return; }
    quickAct = f.act.value;
    const date = f.date.value || todayISO();
    const isDec = f.querySelector("input[name=kind]:checked")?.value === "decision";
    if (isDec) { if (quickAct) Model.addDecision(quickAct, text, date); else store.addDecision(text, date); }
    else Model.addLog(quickAct, { text, date });
    f.text.value = "";
    f.date.value = todayISO();
    const where = quickAct ? ` in «${Model.activity(quickAct)?.name}»` : "";
    showToast(isDec ? `Decisione annotata${where}` : `Annotato${where}`);
  }

  function renderPending() {
    $("#log-pending").innerHTML = pendingFiles.map((f, i) =>
      `<li class="att">${f.type?.startsWith("image/") ? ICON.image : ICON.file}<span>${esc(f.name)}</span><small>${fmtSize(f.size)}</small>
        <button type="button" class="unpend" data-action="unpend" data-i="${i}" aria-label="Togli ${esc(f.name)}">${ICON.x}</button></li>`).join("");
  }

  async function submitLog() {
    const f = $("#log-form");
    const actId = current;
    const text = f.text.value.trim();
    if (!actId || !text) { f.text.focus(); return; }
    const btn = $("#log-submit");
    btn.disabled = true;
    let ids = [];
    if (pendingFiles.length) {
      btn.textContent = "Carico…";
      const res = await Model.addFiles(actId, pendingFiles);
      ids = res.ids;
      if (res.errors.length) showToast(res.errors[0]);
    }
    Model.addLog(actId, { text, detail: f.detail.value, date: f.date.value || todayISO(), files: ids });
    f.text.value = "";
    f.detail.value = "";
    f.detail.hidden = true;
    $("#log-detail-btn").classList.remove("on");
    f.date.value = todayISO();
    pendingFiles = [];
    renderPending();
    btn.disabled = false;
    btn.textContent = "Annota";
    showToast("Annotato nel diario");
    f.text.focus();
  }

  function renderPriorities(data) {
    if (!data) return;
    const all = allOpenTasks(data);
    const tips = { urgency: "Scadute, priorità alta, in scadenza o per il prossimo traguardo, poi il resto", milestone: "Raggruppate per traguardo, dentro ogni gruppo per urgenza" };
    $("#prio-mode").innerHTML = [["urgency", "Per urgenza"], ["milestone", "Per traguardo"]].map(([k, l]) =>
      `<button role="tab" title="${tips[k]}" aria-selected="${prioMode === k}" class="${prioMode === k ? "on" : ""}" data-action="prio-mode" data-value="${k}">${l}</button>`).join("");
    const list = all;
    const urgent = all.filter((t) => tierOf(t) <= 1).length;
    $("#todo-count").textContent = all.length ? `${all.length}${urgent ? ` · ${urgent} urgenti` : ""}` : "";
    const LIMIT = 7;
    let html = "", shownCount = 0;

    if (prioMode === "urgency") {
      const shown = prioExpanded ? list : list.slice(0, LIMIT);
      shownCount = shown.length;
      html = shown.map((t) => taskRow(t, { context: true })).join("");
    } else {
      // gruppi: traguardi di ogni area in ordine, poi Lancio, poi senza traguardo
      const groups = [];
      for (const a of AREAS) {
        for (const m of a.milestones) groups.push({ id: m.id, area: a, name: m.name });
      }
      groups.push({ id: LAUNCH.id, name: "Lancio" }, { id: "", name: "Senza traguardo" });
      for (const g of groups) {
        const tasks = list.filter((t) => (t.milestone || "") === g.id);
        if (!tasks.length) continue;
        if (!prioExpanded && shownCount >= LIMIT) break;
        const room = prioExpanded ? tasks.length : Math.max(0, LIMIT - shownCount);
        const isNext = g.area && Model.nextMilestone(g.area.id)?.id === g.id;
        const passed = g.id && Model.isReached(g.id);
        html += `<li class="prio-group ${g.area?.id || ""}">
          ${g.area ? `<i></i>${esc(g.area.name)} · ` : g.id ? ICON.flag : ""}<b>${esc(g.name)}</b>
          ${isNext ? '<span class="badge next">prossimo</span>' : passed ? '<span class="badge passed">superato</span>' : ""}
          <span class="prio-group-n">${tasks.length}</span>
        </li>`;
        html += tasks.slice(0, room).map((t) => taskRow(t, { context: true, showMs: false })).join("");
        shownCount += Math.min(room, tasks.length);
      }
    }
    $("#prio-list").innerHTML = html || `<li class="empty">Niente in sospeso. I task si aggiungono dalla pagina di ogni attività, se servono.</li>`;
    const more = $("#prio-more");
    more.hidden = list.length <= LIMIT;
    more.textContent = prioExpanded ? "Mostra meno" : `Mostra tutte (${list.length})`;
  }

  // ---------- archivio ----------
  const ARCH = {
    tasks: { icon: ICON.check, done: "Task completato", deleted: "Task eliminato" },
    open: { icon: ICON.question, done: "Punto deciso", deleted: "Punto eliminato" },
    ideas: { icon: ICON.spark, done: "Idea spuntata", deleted: "Idea eliminata" },
    decisions: { icon: ICON.gavel, superseded: "Decisione superata", deleted: "Decisione eliminata" },
    log: { icon: ICON.book, deleted: "Voce di diario eliminata" },
    files: { icon: ICON.file, deleted: "File eliminato" },
    activity: { icon: ICON.folder, deleted: "Attività eliminata" },
  };
  const REASON = { done: "Completato", superseded: "Superata", deleted: "Eliminato" };
  function renderArchive() {
    const all = Model.archive();
    $("#archive-count").textContent = all.length ? String(all.length) : "";
    if (!$("#archive-box").open) return;      // chiuso: basta il numero
    const n = (r) => all.filter((x) => x.reason === r).length;
    $("#archive-filter").innerHTML = [["all", "Tutto", all.length], ["done", "Completati", n("done")], ["superseded", "Superate", n("superseded")], ["deleted", "Eliminati", n("deleted")]]
      .filter(([k, , c]) => k === "all" || c)
      .map(([k, l, c]) => `<button role="tab" aria-selected="${archFilter === k}" class="chip ${archFilter === k ? "on" : ""}" data-action="arch-filter" data-value="${k}">${l}<small>${c}</small></button>`).join("");
    const list = archFilter === "all" ? all : all.filter((x) => x.reason === archFilter);
    const shown = paginate("archive", list, 8, "#archive-pager");
    $("#archive-list").innerHTML = list.length ? shown.map((x) => {
      const k = ARCH[x.kind] || { icon: ICON.archive };
      const text = x.kind === "files" || x.kind === "activity" ? x.item.name : x.item.text;
      const live = x.act && x.kind !== "activity" && Model.activity(x.act.id);
      const where = x.kind === "activity"
        ? `<span class="ctx ${x.item.area}"><i></i>${esc(areaById(x.item.area)?.name || "")}</span>`
        : x.act
          ? live ? `<button class="ctx ${x.act.area}" data-action="open-activity" data-id="${esc(x.act.id)}"><i></i>${esc(x.act.name)}</button>`
            : `<span class="ctx ${x.act.area}" title="Anche l'attività è nell'archivio"><i></i>${esc(x.act.name)}</span>`
          : `<span class="ctx common"><i></i>In comune</span>`;
      return `<li class="row arch ${x.reason}">
        <span class="arch-ico">${k.icon}</span>
        <div class="row-main">
          <span class="row-text">${esc(text)}</span>
          <span class="row-meta"><span class="arch-type">${k[x.reason] || REASON[x.reason] || ""}</span>${where}${x.date ? `<time datetime="${esc(x.date)}">${fmtDate(x.date)}</time>` : ""}</span>
        </div>
        <button class="restore-btn" data-action="restore" data-key="${esc(x.key)}" ${x.canRestore ? "" : `disabled title="Ripristina prima l'attività «${esc(x.act?.name || "")}»"`}>${ICON.restore}<span>Ripristina</span></button>
        ${x.archiveId ? `<button class="del purge" data-action="purge" data-id="${esc(x.archiveId)}" aria-label="Elimina per sempre" title="Elimina per sempre">${ICON.trash}</button>` : `<span class="purge-slot"></span>`}
      </li>`;
    }).join("") : `<li class="empty">${all.length ? "Niente in questo filtro." : "L'archivio è vuoto. Qui finiscono le cose completate, superate o eliminate."}</li>`;
    updateFade($("#archive-list"));
  }
  function restoreFromArchive(key) {
    const x = Model.archive().find((y) => y.key === key);
    if (!x) return;
    const label = ARCH[x.kind]?.[x.reason] || "Elemento";
    if (x.archiveId) {
      if (!Model.restore(x.archiveId)) { showToast(`Ripristina prima l'attività «${x.act?.name || ""}»`); return; }
    } else if (!x.act) {
      store.toggleItem(x.kind, x.item.id);
    } else if (x.kind === "tasks") Model.toggleTask(x.act.id, x.item.id);
    else if (x.kind === "open") Model.toggleOpen(x.act.id, x.item.id);
    const where = x.kind === "activity" ? ` in ${areaById(x.item.area)?.name}` : x.act ? ` in «${x.act.name}»` : "";
    showToast(`${label.split(" ")[0]} ripristinat${x.kind === "activity" || x.kind === "decisions" || x.kind === "ideas" ? "a" : x.kind === "log" ? "a" : "o"}${where}`);
  }

  // ---------- aree ----------
  function activityRow(act) {
    const d = Model.get(act.id);
    const st = Model.phase(act);
    const open = d.tasks.filter((t) => !t.done).map((t) => ({ ...t, area: act.area }));
    const top = sortByUrgency(open)[0];
    const urgent = open.some((t) => tierOf(t) <= 1);
    const openPts = d.open.filter((o) => !o.done).length;
    const until = act.until ? Model.milestone(act.until) : null;
    const last = Model.lastLog(act.id);
    const tags = [ownerChip(act.owner)];
    if (open.length) tags.push(`<span>${open.length} da fare</span>`);
    if (d.files.length) tags.push(`<span>${d.files.length} file</span>`);
    if (openPts) tags.push(`<span>${openPts} da decidere</span>`);
    if (until) tags.push(`<span class="until" title="Si chiude con questo traguardo">${ICON.flag}${esc(until.name)}</span>`);
    return `<div class="activity ${st}">
      <button class="act-open" data-action="open-activity" data-id="${esc(act.id)}" aria-label="Apri ${esc(act.name)}"></button>
      <span class="act-body">
        <span class="act-name">${esc(act.name)}${urgent ? '<i class="urgent-dot" title="Ha task urgenti"></i>' : ""}</span>
        ${last ? `<span class="act-meta"><b class="act-when">${relDay(last.date)}</b> ${esc(last.text)}</span>` : act.hint ? `<span class="act-meta">${esc(act.hint)}</span>` : ""}
        <span class="act-foot"><span class="act-tags">${tags.join("")}</span>${phaseControl(act, true)}</span>
      </span>
      <span class="act-go">${ICON.chevron}</span>
    </div>`;
  }

  function renderAreas() {
    $("#area-switch").innerHTML = AREAS.map((a) =>
      `<button role="tab" aria-selected="${mobileArea === a.id}" class="${mobileArea === a.id ? "on" : ""}" data-action="area" data-value="${a.id}">${a.name}</button>`).join("");
    for (const area of AREAS) {
      $(`#area-${area.id}`).classList.toggle("mobile-hidden", mobileArea !== area.id);
      const acts = Model.activities().filter((x) => x.area === area.id);
      const nGroups = Model.groupsOf(area.id).length;
      const lastDates = acts.map((x) => Model.lastLog(x.id)?.date).filter(Boolean).sort();
      const lastDay = lastDates[lastDates.length - 1];
      $(`#area-sub-${area.id}`).textContent = `${nGroups ? `${nGroups} ${nGroups === 1 ? "gruppo" : "gruppi"} · ` : ""}${acts.length} attività${lastDay ? ` · ultima voce: ${relDay(lastDay).toLowerCase()}` : ""}`;
      const next = Model.nextMilestone(area.id);
      $(`#area-next-${area.id}`).innerHTML = next ? `${ICON.flag}<span>Prossimo traguardo:</span><b>${esc(next.name)}</b>` : `${ICON.check}<b>Lanciato</b>`;
      const blocks = Model.blocks(area.id);
      $(`#groups-${area.id}`).innerHTML = blocks.length ? blocks.map((b) => b.group ? `
        <div class="group-card">
          <div class="group-head">
            <span class="group-ico">${ICON.folder}</span>
            <h3 class="group-name">${esc(b.group.name)}</h3>
            <span class="group-n">${b.acts.length}</span>
            <button class="mini-btn" data-action="new-activity" data-value="${area.id}" data-group="${esc(b.group.id)}" aria-label="Aggiungi un'attività a ${esc(b.group.name)}" title="Aggiungi attività">${ICON.plus}</button>
            <button class="mini-btn" data-action="edit-group" data-id="${esc(b.group.id)}" aria-label="Modifica il gruppo ${esc(b.group.name)}" title="Modifica gruppo">${ICON.pencil}</button>
          </div>
          <div class="group-body">
            ${b.acts.length ? b.acts.map(activityRow).join("") : `<p class="group-empty">Gruppo vuoto: aggiungi un'attività con il +</p>`}
          </div>
        </div>` : `<div class="group-card solo">${activityRow(b.act)}</div>`).join("")
        : `<p class="empty">Nessuna attività. Aggiungine una.</p>`;
    }
  }

  // ---------- pagina attività ----------
  function renderActivity() {
    const act = current && Model.activity(current);
    if (!act) {
      // attività eliminata (qui o da un'altra parte): si torna alla scrivania senza salvare nulla
      clearTimeout(noteTimer);
      current = null;
      shownNoteFor = null;
      if (view === "activity") goDesk();
      return;
    }
    const area = areaById(act.area);
    const d = Model.get(act.id);
    $("#p-icon").className = `area-icon big ${area.id}`;
    $("#p-icon").innerHTML = ICON[area.icon];
    $("#p-crumb").innerHTML = `<span class="crumb-area ${area.id}">${area.name}</span>${act.group ? ` › ${esc(Model.group(act.group)?.name || "")}` : ""}`;
    $("#p-title").textContent = act.name;
    $("#p-hint").textContent = act.hint;
    $("#p-hint").hidden = !act.hint;
    document.title = `${act.name} · App notizie`;

    $("#p-owner").innerHTML = Model.OWNERS.map((o) =>
      `<button role="radio" aria-checked="${act.owner === o}" class="${act.owner === o ? "on" : ""}" data-action="owner" data-value="${o}">${OWNER_ICON[o]}${o}</button>`).join("");
    $("#p-status").innerHTML = phaseControl(act);
    const until = act.until ? Model.milestone(act.until) : null;
    $("#p-until").innerHTML = until
      ? `${ICON.flag}<span>Si chiude con <b>${esc(until.name)}</b>${Model.isReached(until.id) ? " · raggiunto" : ""}</span>`
      : `<span>Continua a evolvere anche dopo il lancio</span>`;

    // diario
    const entries = Model.sortLog(d.log || []);
    $("#p-count-log").textContent = entries.length ? `${entries.length} ${entries.length === 1 ? "voce" : "voci"}` : "";
    $("#p-log").innerHTML = entries.length ? logGroups(entries)
      : `<li class="empty">Qui finisce quello che fai su questa attività: una riga per volta, con dettagli e file se servono.</li>`;
    const lf = $("#log-form");
    if (!lf.date.value) lf.date.value = todayISO();

    // da fare
    const tasks = sortByUrgency(d.tasks.map((t) => ({ ...t, a: act.id, area: act.area })));
    const openN = tasks.filter((t) => !t.done).length;
    $("#p-count-tasks").textContent = d.tasks.length ? `${openN} ${openN === 1 ? "aperto" : "aperti"}` : "";
    $("#p-tasks").innerHTML = tasks.length ? tasks.map((t) => taskRow(t)).join("") : `<li class="empty">Niente in sospeso.</li>`;
    const msSel = $("#p-task-ms");
    if (document.activeElement !== msSel) {
      const keep = msSel.value;
      msSel.innerHTML = milestoneOptions(act.area, keep, "Nessuno");
    }

    // file
    $("#p-count-files").textContent = d.files.length || "";
    $("#p-files").innerHTML = d.files.map((x) => {
      const url = Model.fileUrl(x);
      const img = x.type?.startsWith("image/");
      const thumb = img && url ? `<img src="${esc(url)}" alt="" loading="lazy">` : `<span class="file-ico ${img ? "img" : ""}">${img ? ICON.image : ICON.file}</span>`;
      const inner = `<span class="file-thumb">${thumb}</span>
        <span class="file-meta"><b title="${esc(x.name)}">${esc(x.name)}</b><small>${fmtSize(x.size || 0)}</small></span>`;
      return `<li class="file-tile">
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="file-open">${inner}</a>` : `<span class="file-open">${inner}</span>`}
        <button class="file-del" data-action="delete" data-kind="dfile" data-a="${act.id}" data-id="${x.id}" aria-label="Rimuovi ${esc(x.name)}">${ICON.x}</button>
      </li>`;
    }).join("");

    const up = lastStatus?.uploading || 0;
    $("#upload-note").innerHTML = up
      ? `<b>Caricamento in corso: ${up} file…</b>`
      : lastStatus?.mode === "local"
        ? "Modalità locale: i file restano solo in questa pagina."
        : "I file vanno nel repo GitHub del progetto, che è <b>pubblico</b>: chiunque abbia il link può vederli.";

    // decisioni, da decidere
    $("#p-count-dec").textContent = d.decisions.length || "";
    $("#p-dec").innerHTML = d.decisions.length ? sortDecisions(d.decisions).map((x) => decisionRow(x, "ddec", act.id)).join("") : `<li class="empty">Nessuna decisione presa.</li>`;
    const openPts = d.open.filter((o) => !o.done).length;
    $("#p-count-open").textContent = d.open.length ? String(openPts) : "";
    $("#p-open").innerHTML = d.open.length ? d.open.map((o) => simpleRow(o, { kind: "dopen", a: act.id })).join("") : `<li class="empty">Nessun punto in sospeso.</li>`;

    // note: si aggiornano solo quando cambi attività (mai mentre scrivi)
    const note = $("#p-note");
    if (shownNoteFor !== act.id) { note.value = d.note; shownNoteFor = act.id; }
    updateFade($("#p-log"));
    updateFade($("#p-dec"));
  }

  // ---------- foglio: modifica elemento ----------
  function findItem({ kind, list, a, id }) {
    if (kind === "real") return lastData?.[list]?.find((x) => x.id === id);
    if (kind === "decision") return lastData?.decisions.find((x) => x.id === id);
    if (kind === "dtask") return Model.get(a).tasks.find((x) => x.id === id);
    if (kind === "dopen") return Model.get(a).open.find((x) => x.id === id);
    if (kind === "ddec") return Model.get(a).decisions.find((x) => x.id === id);
    if (kind === "dlog") return Model.logOf(a).find((x) => x.id === id);
    return null;
  }

  function openSheet(ref) {
    const item = findItem(ref);
    if (!item) return;
    editing = ref;
    const titles = { real: LISTS.find((l) => l.key === ref.list)?.title, decision: "Decisione", ddec: "Decisione", dtask: "Da fare", dopen: "Da decidere", dlog: "Voce del diario" };
    $("#sheet-title").textContent = titles[ref.kind] || "Modifica";
    $("#sheet-text").value = item.text;
    const isTask = ref.kind === "dtask", isLog = ref.kind === "dlog", isDec = ref.kind === "decision" || ref.kind === "ddec" || isLog;
    $("#sheet-detail").hidden = !isLog;
    $("#sheet-supersede").hidden = !(ref.kind === "decision" || ref.kind === "ddec");
    $("#sheet-detail").value = isLog ? item.detail || "" : "";
    $("#sheet-pri-wrap").hidden = !isTask;
    $("#sheet-ms-wrap").hidden = !isTask;
    $("#sheet-date-wrap").hidden = !(isTask || isDec);
    $("#sheet-date-label").textContent = isTask ? "Scadenza" : "Data";
    if (isTask) {
      root.querySelectorAll("input[name=sheet-pri]").forEach((r) => (r.checked = r.value === (item.priority || "media")));
      $("#sheet-ms").innerHTML = milestoneOptions(Model.activity(ref.a)?.area, item.milestone || "", "Nessun traguardo");
      $("#sheet-date").value = item.due || "";
    } else if (isDec) {
      $("#sheet-date").value = item.date || todayISO();
    }
    $("#sheet").showModal();
    const ta = $("#sheet-text");
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function onSheetClose() {
    const ed = editing;
    editing = null;
    if (!ed) return;
    const item = findItem(ed);
    if (!item) return;
    const text = $("#sheet-text").value.trim();
    const date = $("#sheet-date").value;
    switch (ed.kind) {
      case "real": if (text && text !== item.text) store.editItem(ed.list, ed.id, text); break;
      case "decision":
        if ((text && text !== item.text) || (date && date !== item.date)) store.editDecision(ed.id, { text, date });
        break;
      case "ddec": Model.editDecision(ed.a, ed.id, { text, date }); break;
      case "dtask": {
        const priority = root.querySelector("input[name=sheet-pri]:checked")?.value || item.priority;
        Model.editTask(ed.a, ed.id, { text, priority, due: date, milestone: $("#sheet-ms").value });
        break;
      }
      case "dopen": Model.editOpen(ed.a, ed.id, { text }); break;
      case "dlog": {
        const patch = { detail: $("#sheet-detail").value.trim() };
        if (text) patch.text = text;
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) patch.date = date;
        Model.editLog(ed.a, ed.id, patch);
        break;
      }
    }
  }

  // ---------- foglio: nuova / modifica attività ----------
  function fillActFormArea(areaId, keepUntil = "", keepGroup = "") {
    $("#af-group").innerHTML = `<option value="">Nessun gruppo (card a sé)</option>` +
      Model.groupsOf(areaId).map((g) => `<option value="${esc(g.id)}" ${g.id === keepGroup ? "selected" : ""}>${esc(g.name)}</option>`).join("");
    $("#af-until").innerHTML = milestoneOptions(areaId, keepUntil, "Continua dopo il lancio");
  }

  function openActSheet(id, areaId, groupId = "") {
    const f = $("#act-form");
    f.reset();
    const act = id ? Model.activity(id) : null;
    editingActivity = act ? act.id : `new:${areaId}`;
    $("#act-sheet-title").textContent = act ? "Modifica attività" : "Nuova attività";
    $("#af-delete").hidden = !act;
    const area = act ? act.area : areaId;
    f.querySelectorAll("input[name=area]").forEach((r) => (r.checked = r.value === area));
    f.querySelectorAll("input[name=owner]").forEach((r) => (r.checked = r.value === (act?.owner || "Ibrido")));
    f.name.value = act?.name || "";
    f.hint.value = act?.hint || "";
    fillActFormArea(area, act?.until || "", act ? act.group : groupId);
    $("#act-sheet").showModal();
    f.name.focus();
  }

  function onActSheetClose() {
    const key = editingActivity;
    editingActivity = null;
    if (!key) return;
    const f = $("#act-form");
    const vals = {
      name: f.name.value,
      area: f.querySelector("input[name=area]:checked")?.value,
      group: f.group.value,
      owner: f.querySelector("input[name=owner]:checked")?.value || "Ibrido",
      hint: f.hint.value,
      until: f.until.value,
    };
    if (!vals.name.trim()) return;
    if (key.startsWith("new:")) {
      const id = Model.addActivity(vals);
      if (id) { mobileArea = vals.area; showToast(`«${vals.name.trim()}» aggiunta in ${areaById(vals.area).name}${vals.group ? " › " + Model.group(vals.group).name : ""}`); }
    } else {
      Model.editActivity(key, vals);
    }
  }

  // ---------- foglio: gruppo ----------
  function openGroupSheet(id, areaId) {
    const f = $("#group-form");
    f.reset();
    const g = id ? Model.group(id) : null;
    editingGroup = g ? g.id : `new:${areaId}`;
    const area = areaById(g ? g.area : areaId);
    $("#group-sheet-title").textContent = g ? "Modifica gruppo" : "Nuovo gruppo";
    $("#group-area-note").textContent = g
      ? `Area ${area.name} · ${Model.blocks(area.id).find((b) => b.group?.id === g.id)?.acts.length || 0} attività`
      : `Nell'area ${area.name}. Poi aggiungi le attività con il + del gruppo.`;
    $("#group-move").hidden = !g;
    $("#group-delete").hidden = !g;
    $("#group-delete-note").hidden = !g;
    f.name.value = g?.name || "";
    $("#group-sheet").showModal();
    f.name.focus();
  }
  function onGroupSheetClose() {
    const key = editingGroup;
    editingGroup = null;
    if (!key) return;
    const name = $("#group-form").name.value;
    if (!name.trim()) return;
    if (key.startsWith("new:")) { Model.addGroup(key.slice(4), name); mobileArea = key.slice(4); }
    else Model.renameGroup(key, name);
  }

  // ---------- foglio: traguardi ----------
  function openMsSheet() {
    msWork = Object.fromEntries(AREAS.map((a) => [a.id, a.milestones.map((m) => ({ ...m }))]));
    msArea = AREAS.some((a) => a.id === mobileArea) ? mobileArea : "app";
    renderMsSheet();
    $("#ms-sheet").showModal();
  }
  function renderMsSheet(focusLast = false) {
    $("#ms-area").innerHTML = AREAS.map((a) =>
      `<button type="button" role="tab" aria-selected="${msArea === a.id}" class="${msArea === a.id ? "on" : ""}" data-action="ms-area" data-value="${a.id}">${a.name}</button>`).join("");
    const list = msWork[msArea];
    $("#ms-list").innerHTML = list.map((m, i) => `
      <li class="ms-row ${msArea}">
        <span class="ms-n">${i + 1}</span>
        <input data-i="${i}" value="${esc(m.name)}" placeholder="Nome del traguardo" class="text-input" aria-label="Traguardo ${i + 1}">
        <button type="button" class="mini-btn danger" data-action="ms-del" data-i="${i}" aria-label="Elimina">${ICON.trash}</button>
        <span class="drag-handle" data-i="${i}" role="button" tabindex="0" aria-label="Trascina per spostare (oppure usa le frecce su e giù)" title="Trascina per spostare">${ICON.grip}</span>
      </li>`).join("") + `<li class="ms-row launch"><span class="ms-n">${ICON.flag}</span><span class="ms-launch">Lancio <small>comune a tutte le aree</small></span></li>`;
    if (focusLast) $("#ms-list").querySelectorAll("input")[list.length - 1]?.focus();
  }
  function moveMilestone(from, to) {
    const list = msWork?.[msArea];
    if (!list || from === to || to < 0 || to >= list.length) return;
    list.splice(to, 0, list.splice(from, 1)[0]);
    renderMsSheet();
  }

  /** trascinamento dei traguardi con la maniglia ≡ (mouse e dito, con i pointer events) */
  function setupMilestoneDrag() {
    const listEl = $("#ms-list");
    let drag = null;
    listEl.addEventListener("pointerdown", (e) => {
      const handle = e.target.closest(".drag-handle");
      if (!handle || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.preventDefault();
      const rows = [...listEl.querySelectorAll(".ms-row:not(.launch)")];
      const li = handle.closest(".ms-row");
      const from = rows.indexOf(li);
      const rects = rows.map((r) => r.getBoundingClientRect());
      drag = { id: e.pointerId, handle, li, rows, rects, from, to: from, startY: e.clientY };
      handle.setPointerCapture(e.pointerId);
      li.classList.add("dragging");
      listEl.classList.add("is-dragging");
    });
    listEl.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { rects, from, rows, li } = drag;
      const base = rects[from];
      const dy = Math.max(rects[0].top - base.top, Math.min(rects[rects.length - 1].top - base.top, e.clientY - drag.startY));
      li.style.transform = `translateY(${dy}px)`;
      const center = base.top + base.height / 2 + dy;
      let to = from;
      rects.forEach((r, k) => {
        const mid = r.top + r.height / 2;
        if (k > from && center >= mid - r.height / 4) to = k;
        if (k < from && center <= mid + r.height / 4 && k < to) to = k;
      });
      drag.to = to;
      const h = base.height;
      rows.forEach((r, k) => {
        if (k === from) return;
        const shift = from < to && k > from && k <= to ? -h : from > to && k >= to && k < from ? h : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { from, to } = drag;
      drag = null;
      listEl.classList.remove("is-dragging");
      moveMilestone(from, to);
      if (from === to) renderMsSheet();
    };
    listEl.addEventListener("pointerup", end);
    listEl.addEventListener("pointercancel", end);
    listEl.addEventListener("keydown", (e) => {
      const handle = e.target.closest(".drag-handle");
      if (!handle || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      const i = Number(handle.dataset.i), j = i + (e.key === "ArrowUp" ? -1 : 1);
      moveMilestone(i, j);
      listEl.querySelector(`.drag-handle[data-i="${j}"]`)?.focus();
    });
  }
  function onMsSheetClose() {
    const work = msWork;
    msWork = null;
    if (!work) return;
    for (const a of AREAS) {
      const before = JSON.stringify(a.milestones.map((m) => [m.id, m.name]));
      const after = JSON.stringify(work[a.id].filter((m) => m.name.trim()).map((m) => [m.id, m.name.trim()]));
      if (before !== after) Model.setMilestones(a.id, work[a.id]);
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

  // ---------- toast ----------
  function showToast(msg, undo) {
    const el = $("#toast");
    el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-action="undo">Annulla</button>' : ""}`;
    el.classList.toggle("plain", !undo);
    if (undo) el.querySelector("button")._undo = undo;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("show"));
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideToast, undo ? 6000 : 3000);
  }
  const showUndo = (msg, undo) => showToast(msg, undo);
  function hideToast() {
    const el = $("#toast");
    el.classList.remove("show");
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { el.hidden = true; }, 250);
  }

  // ---------- stato ----------
  function renderSync(status) {
    let cls = "", label = "";
    if (status.error) { cls = "err"; label = "Errore"; }
    else if (status.mode === "local") { cls = "local"; label = "Locale"; }
    else if (status.saving) { cls = "busy"; label = "Salvo…"; }
    else if (status.pending) { cls = "busy"; label = "In attesa…"; }
    else if (!status.canWrite) { cls = "ro"; label = "Sola lettura"; }
    else if (status.lastSaved) { cls = "ok"; label = `Salvato ${hhmm(status.lastSaved)}`; }
    else if (status.lastSync) { cls = "ok"; label = `Aggiornato ${hhmm(status.lastSync)}`; }
    root.querySelectorAll(".sync").forEach((el) => {
      el.className = "sync " + cls;
      el.innerHTML = label ? `<i></i><span>${esc(label)}</span>` : "";
    });
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
    if (!root || !status) return;
    lastData = data;
    lastStatus = status;
    const isDesk = view === "desk";
    $("#desk-top").hidden = !isDesk;
    $("#view-desk").hidden = !isDesk;
    $("#act-nav").hidden = isDesk;
    $("#view-activity").hidden = isDesk;
    if (isDesk) document.title = "App notizie · Dashboard";
    renderSync(status);
    renderBanner(status);
    const board = $("#board");
    board.hidden = !data?.boardUrl;
    if (data?.boardUrl) board.href = data.boardUrl;
    root.classList.toggle("is-loading", !data);
    if (!data) return;
    if (pendingRoute) { pendingRoute = false; route(); return; }
    if (isDesk) {
      renderRoadmap();
      renderJournal(data);
      renderOpen(data);
      renderPriorities(data);
      renderIdeas(data);
      fillActSelects();
      renderAreas();
      renderArchive();
    } else {
      renderActivity();
    }
    renderFoot(data, status);
    if (editing && !findItem(editing)) { editing = null; $("#sheet").close("cancel"); }
  }

  window.UI = { mount, render };
})();
