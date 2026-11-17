/*
 * model.js — letture comode sui dati e azioni per l'interfaccia (INTERFACCIA).
 *
 * Non tiene dati suoi: legge sempre window.Store.data (sola lettura) e modifica solo con le azioni
 * di window.Store, che salvano su GitHub con il merge sicuro.
 * Le aree sono fisse (App, Contenuti, Commerciale); traguardi, gruppi e attività vengono da data.json.
 */
(function () {
  const S = () => window.Store;
  const D = () => window.Store.data;
  const LAUNCH = { id: "m-launch", name: "Lancio" };
  const OWNERS = ["Andrea", "Agente", "Ibrido"];
  const EMPTY = Object.freeze({ tasks: [], open: [], files: [], decisions: [], note: "", status: "todo" });
  const areaData = (id) => D()?.areas.find((a) => a.id === id);

  // definizione fissa delle aree (per disegnare la struttura prima che arrivino i dati)
  const AREAS = [
    { id: "app", name: "App", icon: "phone" },
    { id: "content", name: "Contenuti", icon: "news" },
    { id: "commercial", name: "Commerciale", icon: "briefcase" },
  ].map((a) => Object.defineProperty(a, "milestones", { get: () => areaData(a.id)?.milestones || [], enumerable: true }));

  const areaOfMilestone = (id) => AREAS.find((a) => a.milestones.some((m) => m.id === id));
  const progress = (areaId) => areaData(areaId)?.progress || 0;

  const Model = {
    AREAS, LAUNCH, OWNERS,
    subscribe: () => () => {},           // gli aggiornamenti arrivano già da Store.subscribe
    get: (id) => Model.activity(id) || EMPTY,
    fileUrl: (f) => S().fileUrl(f),

    // ---------- traguardi ----------
    milestone: (id) => id === LAUNCH.id ? LAUNCH : AREAS.flatMap((a) => a.milestones).find((m) => m.id === id),
    areaOfMilestone,
    progress,
    isReached(id) {
      if (id === LAUNCH.id) return !!D()?.launched;
      const a = areaOfMilestone(id);
      return !!a && a.milestones.findIndex((m) => m.id === id) < progress(a.id);
    },
    nextMilestone(areaId) {
      const a = AREAS.find((x) => x.id === areaId);
      return a?.milestones[progress(areaId)] || (D()?.launched ? null : LAUNCH);
    },
    /** tocco su un traguardo: lo raggiunge (con tutti i precedenti); sull'ultimo raggiunto lo annulla */
    clickMilestone(id) {
      if (id === LAUNCH.id) { S().setLaunched(!D()?.launched); return; }
      const a = areaOfMilestone(id);
      if (!a) return;
      const i = a.milestones.findIndex((m) => m.id === id);
      S().setProgress(a.id, i === progress(a.id) - 1 ? i : i + 1);
    },
    setMilestones: (areaId, list) => S().setMilestones(areaId, list),

    // ---------- gruppi ----------
    groupsOf: (areaId) => (areaData(areaId)?.order || []).filter((k) => k.startsWith("g:"))
      .map((k) => D().groups.find((g) => g.id === k.slice(2))).filter(Boolean),
    group: (id) => D()?.groups.find((g) => g.id === id),
    blocks(areaId) {
      const d = D();
      if (!d) return [];
      return (areaData(areaId)?.order || []).map((k) => {
        const id = k.slice(2);
        if (k.startsWith("g:")) {
          const group = d.groups.find((g) => g.id === id);
          return group && { group, acts: d.activities.filter((a) => a.group === id) };
        }
        const act = d.activities.find((a) => a.id === id);
        return act && { act };
      }).filter(Boolean);
    },
    addGroup: (areaId, name) => S().addGroup(areaId, name),
    renameGroup: (id, name) => S().renameGroup(id, name),
    removeGroup: (id) => S().removeGroup(id),
    moveBlock: (areaId, key, dir) => S().moveBlock(areaId, key, dir),

    // ---------- attività ----------
    activities: () => D()?.activities || [],
    activity: (id) => D()?.activities.find((a) => a.id === id),
    addActivity: (fields) => S().addActivity(fields),
    editActivity: (id, patch) => S().editActivity(id, patch),
    removeActivity: (id) => S().removeActivity(id),
    setOwner: (id, owner) => S().editActivity(id, { owner }),
    setStatus: (id, s) => S().setActivityStatus(id, s),
    setNote: (id, text) => S().setNote(id, text),

    // ---------- dentro un'attività ----------
    addTask: (a, fields) => S().addSub(a, "tasks", fields),
    toggleTask(a, id) { const t = Model.get(a).tasks.find((x) => x.id === id); if (t) S().editSub(a, "tasks", id, { done: !t.done }); },
    editTask: (a, id, patch) => S().editSub(a, "tasks", id, patch),
    removeTask: (a, id) => S().removeSub(a, "tasks", id),
    addOpen: (a, text) => S().addSub(a, "open", { text }),
    toggleOpen(a, id) { const o = Model.get(a).open.find((x) => x.id === id); if (o) S().editSub(a, "open", id, { done: !o.done }); },
    editOpen: (a, id, patch) => S().editSub(a, "open", id, patch),
    removeOpen: (a, id) => S().removeSub(a, "open", id),
    addDecision: (a, text, date) => S().addSub(a, "decisions", { text, date }),
    editDecision(a, id, { text, date } = {}) {
      const patch = {};
      if (text?.trim()) patch.text = text;
      if (/^\d{4}-\d{2}-\d{2}$/.test(date || "")) patch.date = date;
      if (Object.keys(patch).length) S().editSub(a, "decisions", id, patch);
    },
    removeDecision: (a, id) => S().removeSub(a, "decisions", id),
    addFiles: (a, files) => S().uploadFiles(a, files),
    removeFile: (a, id) => S().removeSub(a, "files", id),
  };

  window.Model = Model;
})();
