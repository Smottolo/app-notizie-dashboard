// Avvio dell'app (INFRASTRUTTURA). Collega lo store all'interfaccia.
(async function () {
  const root = document.getElementById("app");
  window.UI.mount(root, window.Store);
  window.Store.subscribe((data, status) => window.UI.render(data, status));
  await window.Store.init();
})();
