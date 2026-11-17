/*
 * ui.js — INTERFACCIA (questo file è di competenza di Claude in VS Code).
 *
 * Questa è una versione base, funzionante ma volutamente semplice, che serve a collaudare
 * l'infrastruttura. Può essere riscritta liberamente, rispettando il contratto:
 *
 *   window.UI = {
 *     mount(rootEl, store)   // chiamata una volta all'avvio
 *     render(data, status)   // chiamata a ogni cambiamento dei dati o dello stato di salvataggio
 *   }
 *
 * Per modificare i dati usare SOLO le azioni di window.Store (vedi js/store.js):
 * mai modificare `data` direttamente e mai chiamare l'API di GitHub da qui.
 */
(function () {
  let store, root;
  let filter = "Tutti";
  let undoTimer;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const STATUS_LABEL = { todo: "Da fare", doing: "In corso", done: "Fatto" };
  const LISTS = [
    { key: "tasks", title: "Task", placeholder: "Nuovo task" },
    { key: "open", title: "Punti da definire", placeholder: "Nuovo punto da definire" },
    { key: "ideas", title: "Idee", placeholder: "Nuova idea" },
  ];
  const $ = (sel) => root.querySelector(sel);
  const hhmm = (d) => d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

  function mount(el, s) {
    root = el;
    store = s;
    root.innerHTML = `
      <header class="top">
        <h1>App notizie</h1>
        <div class="top-right">
          <span id="sync" class="sync"></span>
          <button class="icon" data-action="settings" aria-label="Impostazioni">⚙︎</button>
        </div>
      </header>
      <div id="banner"></div>
      <section class="card" id="summary"></section>
      <section class="card"><h2>Fasi</h2><div id="phases" class="phases"></div></section>
      <section class="card">
        <div class="row-between"><h2>File di lavoro</h2><div id="filters" class="seg"></div></div>
        <div id="files" class="files"></div>
      </section>
      ${LISTS.map((l) => `
        <section class="card">
          <h2>${l.title}</h2>
          <ul id="list-${l.key}" class="list"></ul>
          <form class="add" data-list="${l.key}">
            <input name="text" placeholder="${l.placeholder}" autocomplete="off">
            <button>Aggiungi</button>
          </form>
        </section>`).join("")}
      <section class="card">
        <h2>Registro decisioni</h2>
        <ul id="decisions" class="list"></ul>
        <form class="add" data-list="decisions">
          <input name="date" type="date" class="date">
          <input name="text" placeholder="Nuova decisione" autocomplete="off">
          <button>Aggiungi</button>
        </form>
      </section>
      <p class="foot"><a id="board" target="_blank" rel="noopener">Apri la lavagna ↗</a></p>
      <div id="toast" class="toast" hidden></div>
      <dialog id="settings">
        <form method="dialog" class="settings">
          <h2>Token GitHub</h2>
          <p>Serve per salvare le modifiche. Resta solo in questo browser.</p>
          <input id="token" type="password" placeholder="github_pat_…" autocomplete="off">
          <p id="token-msg" class="muted"></p>
          <div class="row-between">
            <button type="button" data-action="clear-token" class="secondary">Rimuovi</button>
            <span>
              <button value="cancel" class="secondary">Chiudi</button>
              <button type="button" data-action="save-token">Salva e verifica</button>
            </span>
          </div>
        </form>
      </dialog>`;

    root.addEventListener("click", onClick);
    root.addEventListener("submit", onSubmit);
  }

  function onClick(e) {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    const { action, id, list, value } = t.dataset;
    switch (action) {
      case "phase": store.setPhase(value); break;
      case "filter": filter = value; render(store.data, store.status); break;
      case "file": store.cycleFileStatus(id); break;
      case "toggle": store.toggleItem(list, id); break;
      case "edit": {
        const item = store.data[list].find((x) => x.id === id);
        const text = prompt("Modifica", item.text);
        if (text != null) list === "decisions" ? store.editDecision(id, { text }) : store.editItem(list, id, text);
        break;
      }
      case "delete": {
        const undo = list === "decisions" ? store.removeDecision(id) : store.removeItem(list, id);
        showUndo("Elemento eliminato", undo);
        break;
      }
      case "settings": {
        $("#token").value = "";
        $("#token-msg").textContent = store.hasToken() ? "Token già inserito." : "Nessun token inserito.";
        $("#settings").showModal();
        break;
      }
      case "save-token": {
        const v = $("#token").value.trim();
        if (v) store.setToken(v);
        $("#token-msg").textContent = "Verifico…";
        store.checkToken().then((r) => {
          $("#token-msg").textContent = r.ok ? "✅ Token valido: puoi salvare." : "⚠️ " + r.error;
        });
        break;
      }
      case "clear-token": store.clearToken(); $("#token-msg").textContent = "Token rimosso."; break;
      case "undo": t._undo?.(); hideToast(); break;
      case "retry": store.flush(); break;
    }
  }

  function onSubmit(e) {
    const f = e.target.closest("form.add");
    if (!f) return;
    e.preventDefault();
    const text = f.text.value;
    if (!text.trim()) return;
    if (f.dataset.list === "decisions") store.addDecision(text, f.date.value || undefined);
    else store.addItem(f.dataset.list, text);
    f.text.value = "";
  }

  function showUndo(msg, undo) {
    const el = $("#toast");
    el.innerHTML = `<span>${esc(msg)}</span><button data-action="undo">Annulla</button>`;
    el.querySelector("button")._undo = undo;
    el.hidden = false;
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideToast, 6000);
  }
  function hideToast() { $("#toast").hidden = true; }

  function ring(pct) {
    const r = 26, c = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="${r}" class="ring-bg"/>
      <circle cx="32" cy="32" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/>
    </svg>`;
  }

  function render(data, status) {
    if (!root) return;
    // stato di sincronizzazione
    const sync = status.mode === "local" ? "Modalità locale (non salva)"
      : status.saving ? "Salvataggio…"
      : status.pending ? "Modifiche da salvare…"
      : status.lastSaved ? `Salvato ✓ ${hhmm(status.lastSaved)}`
      : status.lastSync ? `Aggiornato ${hhmm(status.lastSync)}` : "";
    $("#sync").textContent = sync;
    $("#banner").innerHTML = status.error
      ? `<div class="banner">${esc(status.error)} <button data-action="${status.error.includes("token") || status.error.includes("Token") ? "settings" : "retry"}">${status.error.toLowerCase().includes("token") ? "Impostazioni" : "Riprova"}</button></div>`
      : !status.canWrite ? `<div class="banner info">Sola lettura: inserisci il token GitHub per salvare. <button data-action="settings">Inserisci</button></div>` : "";
    if (!data) return;

    const done = data.files.filter((f) => f.status === "done").length;
    const total = data.files.length;
    const openTasks = data.tasks.filter((t) => !t.done).length;
    const openPoints = data.open.filter((t) => !t.done).length;
    $("#summary").innerHTML = `
      <div class="stat ring-stat">${ring(total ? done / total : 0)}<div><b>${done}/${total}</b><span>file completati</span></div></div>
      <div class="stat"><b>${openTasks}</b><span>task aperti</span></div>
      <div class="stat"><b>${openPoints}</b><span>punti da definire</span></div>
      <div class="stat"><b>${esc(data.phase)}</b><span>fase attuale</span></div>`;

    $("#phases").innerHTML = data.phases.map((p, i) => `
      ${i ? '<span class="arrow">→</span>' : ""}
      <button class="phase ${p === data.phase ? "on" : ""}" data-action="phase" data-value="${esc(p)}">${esc(p)}</button>`).join("");

    $("#filters").innerHTML = ["Tutti", "Notizie", "App"].map((f) =>
      `<button class="${f === filter ? "on" : ""}" data-action="filter" data-value="${f}">${f}</button>`).join("");

    const files = data.files.filter((f) => filter === "Tutti" || f.branch.startsWith(filter));
    $("#files").innerHTML = files.map((f) => `
      <button class="file ${f.status}" data-action="file" data-id="${f.id}">
        <span class="n">${f.n}</span>
        <span class="name">${esc(f.name)}</span>
        <span class="branch">${esc(f.branch)}</span>
        <span class="pill">${STATUS_LABEL[f.status] || f.status}</span>
      </button>`).join("");

    for (const l of LISTS) {
      const items = data[l.key];
      $(`#list-${l.key}`).innerHTML = items.length ? items.map((it) => `
        <li class="${it.done ? "done" : ""}">
          <input type="checkbox" ${it.done ? "checked" : ""} data-action="toggle" data-list="${l.key}" data-id="${it.id}" aria-label="Spunta">
          <span class="text" data-action="edit" data-list="${l.key}" data-id="${it.id}">${esc(it.text)}</span>
          <button class="del" data-action="delete" data-list="${l.key}" data-id="${it.id}" aria-label="Elimina">✕</button>
        </li>`).join("") : `<li class="empty">Nessun elemento</li>`;
    }

    const decs = [...data.decisions].sort((a, b) => b.date.localeCompare(a.date));
    $("#decisions").innerHTML = decs.length ? decs.map((d) => `
      <li>
        <span class="date">${esc(d.date.split("-").reverse().join("/"))}</span>
        <span class="text" data-action="edit" data-list="decisions" data-id="${d.id}">${esc(d.text)}</span>
        <button class="del" data-action="delete" data-list="decisions" data-id="${d.id}" aria-label="Elimina">✕</button>
      </li>`).join("") : `<li class="empty">Nessuna decisione</li>`;

    $("#board").href = data.boardUrl || "#";
  }

  window.UI = { mount, render };
})();
