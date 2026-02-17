// Layout creation for TestUI: root, sidebar container, and main area.
// Exposes TestUILayout global used by TestUI.web.js.

(function (global) {
  function createLayout() {
    // Root и main используются только для центрального содержимого внутри test-ui-root
    const root = document.createElement("div");
    root.className = "w-full";

    const main = document.createElement("div");
    // Внутренний контейнер без собственной тени/фона – их даёт внешняя карточка из HTML.
    main.className = "w-full flex flex-col items-center justify-start";

    root.appendChild(main);

    // Для панели вопросов используем уже существующую разметку справа
    const list = document.getElementById("question-panel-list");
    const sidebar = list ? list.parentElement : null;

    return { root, sidebar, list, main };
  }

  global.TestUILayout = {
    createLayout,
  };
})(typeof window !== "undefined" ? window : globalThis);
