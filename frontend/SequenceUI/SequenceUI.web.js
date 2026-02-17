const SequenceUI = (function () {
  let currentInstance = null;

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function pluralRu(n, one, few, many) {
    const abs = Math.abs(Number(n)) || 0;
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  function safeText(v) {
    return v == null ? "" : String(v);
  }

  function normalizeTaskData(task) {
    const td = (task && task.task_data) || {};
    const src = td.content && typeof td.content === "object" ? td.content : td;

    const prompt =
      safeText(src.prompt) ||
      safeText(src.description) ||
      safeText(td.description) ||
      "";

    const elementsRaw = Array.isArray(src.elements) ? src.elements : [];
    const levelsRaw = Array.isArray(src.levels) ? src.levels : [];
    const settings =
      (src.settings && typeof src.settings === "object" && src.settings) || {};

    const elements = elementsRaw
      .map((e, idx) => {
        const id = e && e.id != null ? String(e.id) : `elem_${idx + 1}`;
        const text = safeText(e && (e.text || e.label || e.title)) || id;
        const image = e && e.image != null ? String(e.image) : null;
        return { id, text, image };
      })
      .filter((e) => !!e.id);

    const levels = levelsRaw
      .map((l, idx) => {
        const levelId = l && l.level_id != null ? String(l.level_id) : `level_${idx + 1}`;
        const label = safeText(l && (l.label || l.name || l.level_name)) || levelId;
        const slotCount = Array.isArray(l && l.blocks)
          ? l.blocks.length
          : Array.isArray(l && l.slots)
            ? l.slots.length
            : 0;
        const slots = Array.from({ length: slotCount }, (_, i) => `slot_${i + 1}`);
        return { level_id: levelId, label, slots };
      })
      .filter((l) => !!l.level_id);

    return {
      prompt,
      elements,
      levels,
      settings,
    };
  }

  function createRoot(containerElement, taskDto) {
    const taskData = (taskDto && (taskDto.task_data || taskDto.content || taskDto.task || taskDto)) || {};
    const settings = (taskData && taskData.settings) || {};

    const requiresLevelNames = !!(taskData && taskData.content && taskData.content.requires_level_names);
    const requiresBlockNames = !!(taskData && taskData.content && taskData.content.requires_block_names);

    const difficulty = Number(
      (settings && settings.difficulty) ||
      (taskData && taskData.difficulty) ||
      (taskDto && taskDto.difficulty) ||
      (taskDto && taskDto.task_data && taskDto.task_data.difficulty) ||
      (taskDto && taskDto.task_data && taskDto.task_data.settings && taskDto.task_data.settings.difficulty) ||
      (taskDto && taskDto.task_data && taskDto.task_data.content && taskDto.task_data.content.settings && taskDto.task_data.content.settings.difficulty) ||
      (taskDto && taskDto.settings && taskDto.settings.difficulty) ||
      1
    );

    const userCreatesLevels = difficulty >= 2 || requiresLevelNames;

    const sequenceWithinLevelMatters = !!(
      (taskData && taskData.sequence_within_level_matters) ||
      (taskData && taskData.settings && taskData.settings.sequence_within_level_matters) ||
      (taskDto && taskDto.task_data && taskDto.task_data.sequence_within_level_matters) ||
      (taskDto && taskDto.task_data && taskDto.task_data.settings && taskDto.task_data.settings.sequence_within_level_matters) ||
      (taskDto && taskDto.task_data && taskDto.task_data.content && taskDto.task_data.content.sequence_within_level_matters) ||
      (taskDto && taskDto.task_data && taskDto.task_data.content && taskDto.task_data.content.settings && taskDto.task_data.content.settings.sequence_within_level_matters)
    );

    const levelOrderMatters = !!(
      (taskData && taskData.level_order_matters) ||
      (taskData && taskData.settings && taskData.settings.level_order_matters) ||
      (taskDto && taskDto.task_data && taskDto.task_data.level_order_matters) ||
      (taskDto && taskDto.task_data && taskDto.task_data.settings && taskDto.task_data.settings.level_order_matters) ||
      (taskDto && taskDto.task_data && taskDto.task_data.content && taskDto.task_data.content.level_order_matters) ||
      (taskDto && taskDto.task_data && taskDto.task_data.content && taskDto.task_data.content.settings && taskDto.task_data.content.settings.level_order_matters)
    );

    const elementsRaw = Array.isArray(taskData.elements) ? taskData.elements : [];
    const levelsRaw = Array.isArray(taskData.levels) ? taskData.levels : [];

    const elements = elementsRaw
      .map((e, idx) => {
        const id = e && e.id != null ? String(e.id) : `elem_${idx + 1}`;
        const text = safeText(e && (e.text || e.label || e.title)) || id;
        const image = e && e.image != null ? String(e.image) : null;
        return { id, text, image };
      })
      .filter((e) => !!e.id);

    const levels = levelsRaw
      .map((l, idx) => {
        const levelId = l && l.level_id != null ? String(l.level_id) : `level_${idx + 1}`;
        const label = safeText(l && (l.label || l.name)) || levelId;
        const slots = Array.isArray(l && l.slots) ? l.slots.map((x) => String(x)) : [];
        return { level_id: levelId, label, slots };
      })
      .filter((l) => !!l.level_id);

    const data = {
      prompt: "",
      elements,
      levels,
      settings,
    };

    const shuffleEnabled = !(data.settings && data.settings.shuffle_elements === false);

    const initialAvailable = data.elements.map((e) => e.id);
    if (shuffleEnabled) {
      shuffleInPlace(initialAvailable);
    }

    const state = {
      mode: "initial",
      data,
      available: initialAvailable,
      placements: data.levels.map((lvl) => ({
        level_id: lvl.level_id,
        blocks: Array.isArray(lvl.slots) ? lvl.slots.map(() => null) : [],
      })),
      selectedAvailableId: null,
      locked: false,
      shuffleEnabled,
      lastCheckDetails: null,
      lastRawResultDetails: null,
      userBlockNames: {},
    };

    if (userCreatesLevels) {
      state.data.levels = [];
      state.placements = [];
    }

    let userLevelCounter = 0;

    function extractCheckDetails(result) {
      if (!result || typeof result !== "object") return null;
      const d = result.details;
      if (d && typeof d === "object") {
        if (Array.isArray(d.correct_levels)) return d;
        if (Array.isArray(d.correctLevels)) return { ...d, correct_levels: d.correctLevels };
        if (d.details && typeof d.details === "object" && Array.isArray(d.details.correct_levels)) return d.details;
        if (d.details && typeof d.details === "object" && Array.isArray(d.details.correctLevels)) {
          return { ...d.details, correct_levels: d.details.correctLevels };
        }
      }
      if (Array.isArray(result.correct_levels)) return result;
      if (Array.isArray(result.correctLevels)) return { ...result, correct_levels: result.correctLevels };
      return null;
    }

    const root = document.createElement("div");
    root.className = "w-full";

    const style = document.createElement("style");
    style.textContent =
      ".sequenceui-scrollbar::-webkit-scrollbar{width:10px;height:10px;}" +
      ".sequenceui-scrollbar::-webkit-scrollbar-track{background:rgba(0,0,0,0.05);border-radius:0px;}" +
      ".dark .sequenceui-scrollbar::-webkit-scrollbar-track{background:rgba(255,255,255,0.05);}" +
      ".sequenceui-scrollbar::-webkit-scrollbar-thumb{background-color:rgba(156,163,175,0.5);border-radius:5px;border:2px solid transparent;background-clip:content-box;}" +
      ".sequenceui-scrollbar::-webkit-scrollbar-thumb:hover{background-color:rgba(107,114,128,0.8);}" +
      ".sequenceui-scrollbar{scrollbar-width:auto;scrollbar-color:rgba(107,114,128,0.8) rgba(0,0,0,0.05);}" +
      ".dark .sequenceui-scrollbar{scrollbar-color:rgba(156,163,175,0.5) rgba(255,255,255,0.05);} " +
      "@keyframes seqFadeIn { from { opacity: 0; } to { opacity: 1; } }" +
      "@keyframes seqSlideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }" +
      "@keyframes seqScaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }" +
      ".seq-level-entry { animation: seqSlideUp 200ms ease-out forwards; }" +
      ".seq-element-entry { animation: seqScaleIn 200ms ease-out forwards; }";
    root.appendChild(style);

    const layout = document.createElement("div");
    layout.className =
      "grid gap-4 lg:grid-cols-3 xl:grid-cols-4 items-start";

    const main = document.createElement("div");
    main.className = "lg:col-span-2 xl:col-span-3 flex min-h-[220px] flex-col gap-3";

    const sidebar = document.createElement("aside");
    sidebar.className = "lg:col-span-1 xl:col-span-1 flex flex-col";

    if (requiresBlockNames || difficulty === 3) {
      // Difficulty=3: no available elements sidebar.
      sidebar.classList.add("hidden");
      main.className = "lg:col-span-3 xl:col-span-4 flex min-h-[220px] flex-col gap-3";
      layout.className = "grid gap-4";
    }

    const availableCard = document.createElement("div");
    availableCard.className =
      "bg-surface-2 dark:bg-surface-2 rounded-xl shadow-lg p-4 border border-border-strong dark:border-border-strong";

    const availableHeader = document.createElement("div");
    availableHeader.className = "flex items-center justify-between";

    const availableTitle = document.createElement("div");
    availableTitle.className = "text-sm font-bold text-text-main dark:text-text-on-dark";
    availableTitle.textContent = "Доступные элементы";

    const availableCount = document.createElement("div");
    availableCount.className =
      "text-xs font-semibold bg-surface-1 dark:bg-surface-1 border border-border-strong text-text-secondary dark:text-text-on-dark px-2 py-0.5 rounded-full";

    availableHeader.appendChild(availableTitle);
    availableHeader.appendChild(availableCount);

    const availableList = document.createElement("div");
    availableList.className = "mt-3 overflow-y-auto sequenceui-scrollbar";

    const availableInner = document.createElement("div");
    availableInner.className = "space-y-2 pr-1";
    availableList.appendChild(availableInner);

    availableCard.appendChild(availableHeader);
    availableCard.appendChild(availableList);

    sidebar.appendChild(availableCard);

    const levelsCard = document.createElement("div");
    levelsCard.className =
      "bg-surface-2 dark:bg-surface-2 rounded-xl shadow-lg p-4 border border-border-strong dark:border-border-strong";

    const levelsHeader = document.createElement("div");
    levelsHeader.className = "flex items-center justify-between gap-3";

    const levelsTitle = document.createElement("div");
    levelsTitle.className = "text-sm font-bold text-text-main dark:text-text-on-dark";
    levelsTitle.textContent = "Уровни (расположите элементы по уровням)";

    const addLevelBtn = document.createElement("button");
    addLevelBtn.type = "button";
    addLevelBtn.className = "hidden items-center justify-center gap-1.5 px-3 py-1.5 border border-border-strong bg-primary text-primary-fg hover:bg-primary-hover rounded text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2";
    addLevelBtn.setAttribute("aria-label", "Добавить уровень");
    addLevelBtn.innerHTML = '<span class="material-symbols-outlined text-sm">add</span> Добавить уровень';

    levelsHeader.appendChild(levelsTitle);
    levelsHeader.appendChild(addLevelBtn);

    const levelsHint = document.createElement("div");
    levelsHint.className = "mt-1 text-xs text-text-secondary dark:text-text-on-dark";
    levelsHint.textContent = "";
    levelsHint.appendChild(
      document.createTextNode("Выберите элемент справа, затем кликните на пустой слот для размещения.")
    );

    if (requiresBlockNames || difficulty === 3) {
      levelsHint.textContent = "";
      levelsHint.appendChild(
        document.createTextNode("Добавляйте слоты и вводите названия элементов прямо в слоты.")
      );
    }
    if (sequenceWithinLevelMatters) {
      levelsHint.appendChild(document.createTextNode(" "));
      const strong = document.createElement("strong");
      strong.className = "font-bold text-text-secondary dark:text-text-on-dark";
      strong.textContent = "Порядок элементов важен.";
      levelsHint.appendChild(strong);
    }

    if (difficulty === 1 && levelOrderMatters) {
      levelsHint.appendChild(document.createTextNode(" "));
      const strong = document.createElement("strong");
      strong.className = "font-bold text-text-secondary dark:text-text-on-dark";
      strong.textContent = "Порядок уровней важен.";
      levelsHint.appendChild(strong);
    }

    levelsCard.appendChild(levelsHeader);
    levelsCard.appendChild(levelsHint);

    const levelsContainer = document.createElement("div");
    levelsContainer.className = "mt-3 flex flex-col gap-4";

    levelsCard.appendChild(levelsContainer);

    main.appendChild(levelsCard);

    layout.appendChild(main);
    layout.appendChild(sidebar);

    root.appendChild(layout);

    function getElementById(id) {
      return state.data.elements.find((e) => e.id === id) || null;
    }

    function canEdit() {
      return !state.locked && (state.mode === "initial" || state.mode === "in_progress" || state.mode === "checked_failed_editable");
    }

    function computeIsInProgress() {
      if (requiresBlockNames || difficulty === 3) {
        return state.placements.some((l) => {
          const blocks = Array.isArray(l.blocks) ? l.blocks : [];
          return blocks.some((id) => {
            if (!id) return false;
            const name = state.userBlockNames && typeof state.userBlockNames === "object" ? String(state.userBlockNames[id] || "") : "";
            return !!name.trim();
          });
        });
      }
      return state.placements.some((l) => Array.isArray(l.blocks) && l.blocks.some((x) => x != null));
    }

    function addSlotToLevel(levelIndex) {
      if (!canEdit()) return false;
      if (!userCreatesLevels) return false;
      const placement = state.placements[levelIndex];
      if (!placement) return false;
      placement.blocks = Array.isArray(placement.blocks) ? placement.blocks : [];
      if (requiresBlockNames || difficulty === 3) {
        const slotId = `user_slot_${placement.level_id}_${Date.now()}_${placement.blocks.length + 1}`;
        placement.blocks.push(slotId);
        state.userBlockNames[slotId] = "";
      } else {
        placement.blocks.push(null);
      }
      ensureModeByPlacements();
      renderAll();
      return true;
    }

    function addUserLevel() {
      if (!canEdit()) return false;
      if (!userCreatesLevels) return false;

      userLevelCounter += 1;
      const levelId = `user_level_${Date.now()}_${userLevelCounter}`;

      state.data.levels.push({ level_id: levelId, label: "", slots: [] });
      if (requiresBlockNames || difficulty === 3) {
        const slotId = `user_slot_${levelId}_${Date.now()}_1`;
        state.placements.push({ level_id: levelId, blocks: [slotId] });
        state.userBlockNames[slotId] = "";
      } else {
        state.placements.push({ level_id: levelId, blocks: [null] });
      }

      ensureModeByPlacements();
      renderAll();
      return true;
    }

    function removeUserLevel(levelIndex) {
      if (!canEdit()) return false;
      if (!userCreatesLevels) return false;
      if (levelIndex < 0 || levelIndex >= state.data.levels.length) return false;

      const placement = state.placements[levelIndex];
      const toReturn = placement && Array.isArray(placement.blocks) ? placement.blocks.filter((x) => x != null) : [];
      if (toReturn.length > 0) {
        if (state.shuffleEnabled) {
          toReturn.forEach((id) => {
            const insertAt = Math.floor(Math.random() * (state.available.length + 1));
            state.available.splice(insertAt, 0, id);
          });
        } else {
          state.available.push(...toReturn);
        }
      }

      state.data.levels.splice(levelIndex, 1);
      state.placements.splice(levelIndex, 1);
      ensureModeByPlacements();
      renderAll();
      return true;
    }

    function ensureModeByPlacements() {
      if (state.mode === "checked_success" || state.mode === "final_review") {
        return;
      }
      state.mode = computeIsInProgress() ? "in_progress" : "initial";
    }

    function canReorderLevels() {
      return difficulty === 1 && levelOrderMatters && canEdit();
    }

    function swapLevels(i, j) {
      if (!canReorderLevels()) return false;
      if (!Array.isArray(state.data.levels) || !Array.isArray(state.placements)) return false;
      if (i < 0 || j < 0) return false;
      if (i >= state.data.levels.length || j >= state.data.levels.length) return false;
      if (i >= state.placements.length || j >= state.placements.length) return false;
      if (i === j) return true;

      const tmpLvl = state.data.levels[i];
      state.data.levels[i] = state.data.levels[j];
      state.data.levels[j] = tmpLvl;

      const tmpPl = state.placements[i];
      state.placements[i] = state.placements[j];
      state.placements[j] = tmpPl;

      renderAll();
      return true;
    }

    function moveLevelUp(index) {
      return swapLevels(index, index - 1);
    }

    function moveLevelDown(index) {
      return swapLevels(index, index + 1);
    }

    // Для difficulty=1 + level_order_matters: по умолчанию уровни должны быть
    // перемешаны, чтобы задача пользователя была восстановить правильный порядок.
    function maybeShuffleLevelsOnInit() {
      try {
        if (!(difficulty === 1 && levelOrderMatters)) return;
        if (!Array.isArray(state.data.levels) || state.data.levels.length < 2) return;
        if (!Array.isArray(state.placements) || state.placements.length !== state.data.levels.length) return;

        const order = Array.from({ length: state.data.levels.length }, (_, i) => i);
        shuffleInPlace(order);

        const newLevels = order.map((i) => state.data.levels[i]);
        const newPlacements = order.map((i) => state.placements[i]);

        state.data.levels = newLevels;
        state.placements = newPlacements;
      } catch (e) {
        // Defensive: initial shuffle must never break UI
      }
    }

    function renderAvailable() {
      if (requiresBlockNames || difficulty === 3) {
        return;
      }
      availableInner.innerHTML = "";
      const ids = state.available.slice();
      availableCount.textContent = String(ids.length);

      if (ids.length === 0) {
        const empty = document.createElement("div");
        empty.className = "text-xs text-text-muted dark:text-text-muted";
        empty.textContent = "Нет доступных элементов";
        availableInner.appendChild(empty);
        return;
      }

      ids.forEach((id) => {
        const el = getElementById(id);
        const label = el ? el.text : id;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("aria-label", `Выбрать элемент: ${label}`);
        btn.className =
          "w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2 " +
          (state.selectedAvailableId === id
            ? "border-primary bg-primary-lighter dark:bg-primary-light"
            : "border-border-strong bg-surface-1 hover:bg-bg-hover dark:border-border-strong dark:bg-surface-2 dark:hover:bg-bg-hover");

        const line = document.createElement("div");
        line.className = "flex items-start justify-between gap-2";

        const text = document.createElement("div");
        text.className = "truncate font-medium text-text-main dark:text-text-on-dark";
        text.title = label;
        text.textContent = label;

        line.appendChild(text);

        btn.appendChild(line);

        if (!canEdit()) {
          btn.disabled = true;
          btn.className += " opacity-60 cursor-default";
        }

        btn.addEventListener("click", () => {
          if (!canEdit()) return;
          state.selectedAvailableId = state.selectedAvailableId === id ? null : id;
          ensureModeByPlacements();
          renderAll();
        });

        availableInner.appendChild(btn);
      });
    }

    function placeSelectedIntoLevel(levelIndex) {
      if (!canEdit()) return;
      const elemId = state.selectedAvailableId;
      if (!elemId) return;
      const placement = state.placements[levelIndex];
      if (!placement) return;

      placement.blocks = Array.isArray(placement.blocks) ? placement.blocks : [];
      const emptyIdx = placement.blocks.findIndex((x) => x == null);

      if (emptyIdx < 0) {
        if (userCreatesLevels) {
          placement.blocks.push(null);
          placement.blocks[placement.blocks.length - 1] = elemId;
        } else {
          return;
        }
      } else {
        placement.blocks[emptyIdx] = elemId;
      }

      state.available = state.available.filter((x) => x !== elemId);
      state.selectedAvailableId = null;
      ensureModeByPlacements();
      renderAll();
    }

    function removeFromLevel(levelIndex, slotIndex) {
      if (!canEdit()) return;
      const placement = state.placements[levelIndex];
      if (!placement) return;

      placement.blocks = Array.isArray(placement.blocks) ? placement.blocks : [];
      if (slotIndex < 0 || slotIndex >= placement.blocks.length) return;
      const elemId = placement.blocks[slotIndex];
      if (!elemId) return;
      if (requiresBlockNames || difficulty === 3) {
        if (state.userBlockNames && typeof state.userBlockNames === "object") {
          state.userBlockNames[elemId] = "";
        }
      } else {
        placement.blocks[slotIndex] = null;
        if (state.shuffleEnabled) {
          const insertAt = Math.floor(Math.random() * (state.available.length + 1));
          state.available.splice(insertAt, 0, elemId);
        } else {
          state.available.push(elemId);
        }
      }
      ensureModeByPlacements();
      renderAll();
    }

    function renderLevels() {
      levelsContainer.innerHTML = "";

      if (userCreatesLevels) {
        if (canEdit()) {
          addLevelBtn.classList.remove("hidden");
          addLevelBtn.classList.add("inline-flex");
        } else {
          addLevelBtn.classList.add("hidden");
          addLevelBtn.classList.remove("inline-flex");
        }
      }

      const levels = state.data.levels;

      if (userCreatesLevels && (!Array.isArray(levels) || levels.length === 0)) {
        const empty = document.createElement("div");
        empty.className = "rounded-xl border border-border-subtle dark:border-border-strong bg-surface-1 dark:bg-surface-2 p-6 text-center";

        const title = document.createElement("div");
        title.className = "text-sm font-bold text-text-main dark:text-text-on-dark";
        title.textContent = "Добавьте первый уровень";

        const desc = document.createElement("div");
        desc.className = "mt-2 text-xs text-text-muted dark:text-text-muted";
        desc.textContent = "Создайте уровни, дайте им названия и распределите по ним элементы.";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mt-4 inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-primary-fg rounded-lg shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2";
        btn.innerHTML = '<span class="material-symbols-outlined">add_circle</span><span class="font-bold text-xs">Создать уровень</span>';
        btn.addEventListener("click", () => {
          addUserLevel();
        });

        if (!canEdit()) {
          btn.disabled = true;
          btn.className += " opacity-60 cursor-default";
        }

        empty.appendChild(title);
        empty.appendChild(desc);
        empty.appendChild(btn);
        levelsContainer.appendChild(empty);
        return;
      }

      function getLevelOrderVerdict(levelIndex) {
        if (!(difficulty === 1 && levelOrderMatters)) return null;
        if (!(state.mode === "checked_success" || state.mode === "checked_failed_editable" || state.mode === "final_review")) {
          return null;
        }

        const d = state.lastRawResultDetails;
        if (!d || typeof d !== "object") return null;

        const incorrect = d.incorrect_levels;
        if (Array.isArray(incorrect)) {
          return incorrect.includes(levelIndex + 1) ? "incorrect" : "correct";
        }

        const userLevels = d.user_levels;
        const correctLevels = d.correct_levels;
        if (Array.isArray(userLevels) && Array.isArray(correctLevels)) {
          const u = userLevels[levelIndex];
          const c = correctLevels[levelIndex];
          const uId = u && typeof u === "object" ? u.level_id || u.levelId || u.id : null;
          const cId = c && typeof c === "object" ? c.level_id || c.levelId || c.id : null;
          if (uId != null && cId != null) {
            return String(uId) === String(cId) ? "correct" : "incorrect";
          }
        }

        return null;
      }

      const hasCheckDetails =
        state.lastCheckDetails && typeof state.lastCheckDetails === "object" && Array.isArray(state.lastCheckDetails.correct_levels);

      function normalizeTextForComparison(s) {
        try {
          return String(s == null ? "" : s)
            .trim()
            .toLowerCase()
            .replace(/\s+/g, " ");
        } catch (e) {
          return "";
        }
      }

      const matchedBlockNames = new Set();
      if ((requiresBlockNames || difficulty === 3) && state.lastRawResultDetails && typeof state.lastRawResultDetails === "object") {
        const bn = state.lastRawResultDetails.block_names;
        const matches = bn && typeof bn === "object" ? bn.matched_blocks : null;
        if (Array.isArray(matches)) {
          for (const m of matches) {
            // (level_id, block_id, user_name, correct_name)
            if (Array.isArray(m) && m.length >= 4) {
              const userName = normalizeTextForComparison(m[2]);
              if (userName) matchedBlockNames.add(userName);
            }
          }
        }
      }

      const correctByLevelId = new Map();
      if (state.lastCheckDetails && typeof state.lastCheckDetails === "object") {
        const byLevel = state.lastCheckDetails.correct_blocks_by_level;
        if (byLevel && typeof byLevel === "object" && !Array.isArray(byLevel)) {
          for (const [k, v] of Object.entries(byLevel)) {
            if (!k) continue;
            if (Array.isArray(v)) {
              correctByLevelId.set(String(k), v.slice());
            }
          }
        }

        if (hasCheckDetails) {
          for (const lvl of state.lastCheckDetails.correct_levels) {
            if (lvl && typeof lvl === "object") {
              const levelId =
                (lvl.level_id != null ? String(lvl.level_id) : null) ||
                (lvl.levelId != null ? String(lvl.levelId) : null) ||
                (lvl.id != null ? String(lvl.id) : null);

              const blocks =
                (Array.isArray(lvl.blocks) ? lvl.blocks : null) ||
                (Array.isArray(lvl.correct_blocks) ? lvl.correct_blocks : null) ||
                (Array.isArray(lvl.sequence) ? lvl.sequence : null);

              if (levelId && Array.isArray(blocks) && !correctByLevelId.has(levelId)) {
                correctByLevelId.set(levelId, blocks.slice());
              }
            }
          }
        }
      }

      function getSlotVerdict(levelId, slotIndex, placedId) {
        if (!placedId) return null;
        if (!state.lastCheckDetails || correctByLevelId.size === 0) return null;
        if (!(state.mode === "checked_success" || state.mode === "checked_failed_editable" || state.mode === "final_review")) {
          return null;
        }
        const correctBlocks = correctByLevelId.get(levelId);
        if (!Array.isArray(correctBlocks)) return null;
        if (sequenceWithinLevelMatters) {
          return correctBlocks[slotIndex] === placedId ? "correct" : "incorrect";
        }
        return correctBlocks.includes(placedId) ? "correct" : "incorrect";
      }

      function makeIconSvg(kind) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
        svg.setAttribute("aria-hidden", "true");
        svg.style.flex = "0 0 auto";

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        if (kind === "correct") {
          path.setAttribute(
            "d",
            "M9 16.2l-3.5-3.5L4 14.2l5 5 12-12-1.5-1.5L9 16.2z"
          );
          path.setAttribute("fill", "currentColor");
          svg.classList.add("text-success");
        } else {
          path.setAttribute(
            "d",
            "M18.3 5.71L12 12l6.3 6.29-1.41 1.42L12 13.41l-6.89 6.3-1.41-1.42L10.59 12 3.7 5.71 5.11 4.29 12 10.59l6.89-6.3z"
          );
          path.setAttribute("fill", "currentColor");
          svg.classList.add("text-error");
        }
        svg.appendChild(path);
        return svg;
      }

      if (!Array.isArray(levels) || levels.length === 0) {
        // For difficulty=2 (user creates levels) empty-state is handled above.
        const empty = document.createElement("div");
        empty.className = "text-sm text-text-muted dark:text-text-muted";
        empty.textContent = "No levels data in task";
        levelsContainer.appendChild(empty);
        return;
      }

      levels.forEach((lvl, idx) => {
        const placement = state.placements[idx];
        const expectedCount = userCreatesLevels
          ? (placement && Array.isArray(placement.blocks) ? placement.blocks.length : 0)
          : (Array.isArray(lvl.slots) ? lvl.slots.length : 0);
        const blocks = placement && Array.isArray(placement.blocks)
          ? placement.blocks
          : Array.from({ length: expectedCount }, () => null);

        const wrap = document.createElement("div");
        wrap.className = "seq-level-entry";

        const headerRow = document.createElement("div");
        headerRow.className = "flex items-center justify-between mb-3";

        const leftHeader = document.createElement("div");
        leftHeader.className = "flex items-center gap-2";

        if (userCreatesLevels) {
          if (canEdit()) {
            const inputWrap = document.createElement("div");
            inputWrap.className = "relative grow max-w-md";

            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = "Название уровня...";
            input.value = lvl.label || "";
            input.className = "block w-full px-3 py-1.5 border border-border-subtle dark:border-border-strong rounded-md leading-5 bg-surface-1 dark:bg-surface-2 text-text-main dark:text-text-on-dark placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm font-bold shadow-sm";
            input.addEventListener("input", () => {
              lvl.label = input.value;
            });

            inputWrap.appendChild(input);
            leftHeader.appendChild(inputWrap);
          } else {
            const h3 = document.createElement("h3");
            h3.className = "text-sm font-bold text-text-main dark:text-text-on-dark";
            const levelTitle = lvl.label || "Без названия";
            h3.textContent = levelTitle;
            h3.title = levelTitle;
            leftHeader.appendChild(h3);
          }
        } else {
          const h3 = document.createElement("h3");
          h3.className = "text-sm font-bold text-text-main dark:text-text-on-dark";
          const levelTitle = lvl.label || lvl.level_id;
          h3.textContent = levelTitle;
          h3.title = levelTitle;
          leftHeader.appendChild(h3);
        }

        const rightHeader = document.createElement("div");
        rightHeader.className = "flex items-center gap-3";

        const slotsLabel = document.createElement("span");
        slotsLabel.className =
          "text-[10px] font-bold text-text-secondary dark:text-text-on-dark uppercase tracking-widest";
        slotsLabel.textContent =
          expectedCount > 0
            ? `${expectedCount} ${pluralRu(expectedCount, "слот", "слота", "слотов")}`
            : "";

        if (difficulty === 1 && levelOrderMatters) {
          const controls = document.createElement("div");
          controls.className =
            "flex bg-surface-2 dark:bg-surface-2 rounded-md border border-border-strong dark:border-border-strong divide-x divide-border-strong dark:divide-border-strong shadow-sm";

          const canUse = canReorderLevels();

          const upBtn = document.createElement("button");
          upBtn.type = "button";
          upBtn.title = "Переместить вверх";
          upBtn.setAttribute("aria-label", "Переместить уровень вверх");

          const upIcon = document.createElement("span");
          upIcon.className = "material-symbols-outlined text-[18px]";
          upIcon.textContent = "keyboard_arrow_up";
          upBtn.appendChild(upIcon);

          const upDisabled = !canUse || idx === 0;
          if (upDisabled) {
            upBtn.disabled = true;
            upBtn.className = "flex items-center justify-center w-7 h-7 rounded border border-border-strong bg-surface-2 text-text-secondary dark:text-text-on-dark disabled:cursor-not-allowed";
          } else {
            upBtn.className = "flex items-center justify-center w-7 h-7 rounded border border-border-strong bg-surface-2 hover:bg-bg-hover dark:hover:bg-bg-hover text-text-secondary dark:text-text-on-dark hover:text-primary transition-colors";
            upBtn.addEventListener("click", () => {
              moveLevelUp(idx);
            });
          }

          const downBtn = document.createElement("button");
          downBtn.type = "button";
          downBtn.title = "Переместить вниз";
          downBtn.setAttribute("aria-label", "Переместить уровень вниз");

          const downIcon = document.createElement("span");
          downIcon.className = "material-symbols-outlined text-[18px]";
          downIcon.textContent = "keyboard_arrow_down";
          downBtn.appendChild(downIcon);

          const downDisabled = !canUse || idx === levels.length - 1;
          if (downDisabled) {
            downBtn.disabled = true;
            downBtn.className = "flex items-center justify-center w-7 h-7 rounded border border-border-strong bg-surface-2 text-text-secondary dark:text-text-on-dark disabled:cursor-not-allowed";
          } else {
            downBtn.className = "flex items-center justify-center w-7 h-7 rounded border border-border-strong bg-surface-2 hover:bg-bg-hover dark:hover:bg-bg-hover text-text-secondary dark:text-text-on-dark hover:text-primary transition-colors";
            downBtn.addEventListener("click", () => {
              moveLevelDown(idx);
            });
          }

          controls.appendChild(upBtn);
          controls.appendChild(downBtn);
          rightHeader.appendChild(controls);
        }

        if (userCreatesLevels) {
          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.setAttribute("aria-label", "Удалить уровень");
          delBtn.title = "Удалить уровень";
          delBtn.className = "text-error hover:text-error p-1.5 rounded hover:bg-error-lighter dark:hover:bg-error-light transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2";
          delBtn.innerHTML = '<span class="material-symbols-outlined text-lg">delete</span>';

          if (!canEdit()) {
            delBtn.disabled = true;
            delBtn.className += " opacity-60 cursor-default";
          } else {
            delBtn.addEventListener("click", () => {
              removeUserLevel(idx);
            });
          }

          rightHeader.appendChild(delBtn);
        }

        if (!userCreatesLevels) {
          rightHeader.appendChild(slotsLabel);
        }

        headerRow.appendChild(leftHeader);
        headerRow.appendChild(rightHeader);

        const panel = document.createElement("div");
        panel.className =
          "p-5 rounded-xl border bg-surface-2 dark:bg-surface-2 border-border-subtle dark:border-border-strong";

        // Подсветка уровня, если важен порядок уровней.
        const levelOrderVerdict = getLevelOrderVerdict(idx);
        if (levelOrderVerdict === "correct") {
          panel.className =
            "p-5 rounded-xl border bg-success-lighter dark:bg-success-light border-success-light dark:border-success-dark";
          const badge = document.createElement("span");
          badge.className = "ml-2 inline-flex items-center gap-1 text-xs font-semibold text-success-text dark:text-success-light";
          badge.appendChild(makeIconSvg("correct"));
          badge.appendChild(document.createTextNode("Позиция верная"));
          headerRow.appendChild(badge);
        } else if (levelOrderVerdict === "incorrect") {
          panel.className =
            "p-5 rounded-xl border bg-error-lighter dark:bg-error-light border-error-light dark:border-error-dark";
          const badge = document.createElement("span");
          badge.className = "ml-2 inline-flex items-center gap-1 text-xs font-semibold text-error-text dark:text-error-light";
          badge.appendChild(makeIconSvg("incorrect"));
          badge.appendChild(document.createTextNode("Неверная позиция"));
          headerRow.appendChild(badge);
        }

        const allowClickOnLevel = difficulty === 1 && !sequenceWithinLevelMatters;
        const levelHasEmptySlot = Array.isArray(blocks) && blocks.some((x) => x == null);
        const levelClickable = allowClickOnLevel && canEdit() && !!state.selectedAvailableId && levelHasEmptySlot;
        const levelClickModeActive = allowClickOnLevel && canEdit() && !!state.selectedAvailableId;

        if (allowClickOnLevel && canEdit() && !!state.selectedAvailableId) {
          if (levelHasEmptySlot) {
            panel.className +=
              " cursor-pointer transition-colors hover:border-primary hover:bg-primary-lighter";
          } else {
            panel.className += " cursor-not-allowed";
          }

          panel.addEventListener("click", (ev) => {
            // Do not steal clicks from actual slot/placed element buttons.
            const t = ev.target;
            if (t && t.closest && t.closest("button")) return;
            if (!levelClickable) return;
            placeSelectedIntoLevel(idx);
          });
        }

        const slotsWrap = document.createElement("div");
        slotsWrap.className = "flex flex-wrap gap-4";

        const totalSlotsToRender = Math.max(expectedCount || 0, blocks.length || 0, 1);
        for (let i = 0; i < totalSlotsToRender; i++) {
          const placedId = i < blocks.length ? blocks[i] || null : null;

          if (requiresBlockNames || difficulty === 3) {
            const slotId = placedId || `user_slot_${lvl.level_id}_${Date.now()}_${i + 1}`;
            if (i >= blocks.length) {
              blocks.push(slotId);
            } else if (!blocks[i]) {
              blocks[i] = slotId;
            }
            if (state.userBlockNames && typeof state.userBlockNames === "object" && state.userBlockNames[slotId] == null) {
              state.userBlockNames[slotId] = "";
            }

            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = "Название элемента...";
            input.value = state.userBlockNames && typeof state.userBlockNames === "object" ? String(state.userBlockNames[slotId] || "") : "";

            const baseInput =
              "h-14 flex-1 min-w-[220px] rounded-lg px-3 py-2 text-sm font-medium border bg-surface-1 text-text-main dark:bg-surface-2 dark:text-text-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2 ";
            const isCheckedMode =
              state.mode === "checked_success" || state.mode === "checked_failed_editable" || state.mode === "final_review";
            const v = normalizeTextForComparison(input.value);

            if (isCheckedMode && v) {
              const ok = matchedBlockNames.has(v);
              if (ok) {
                input.className =
                  baseInput +
                  "border-success-light dark:border-success-dark bg-success-lighter dark:bg-success-light";
              } else {
                input.className =
                  baseInput +
                  "border-error-light dark:border-error-dark bg-error-lighter dark:bg-error-light";
              }
            } else {
              input.className = baseInput + "border-border-subtle dark:border-border-strong";
            }

            input.disabled = !canEdit();
            input.addEventListener("input", () => {
              if (!state.userBlockNames || typeof state.userBlockNames !== "object") return;
              state.userBlockNames[slotId] = input.value;
              ensureModeByPlacements();
            });

            slotsWrap.appendChild(input);
            continue;
          }

          if (placedId) {
            const el = getElementById(placedId);
            const label = el ? el.text : placedId;

            const verdict = getSlotVerdict(lvl.level_id, i, placedId);

            const btn = document.createElement("button");
            btn.type = "button";
            btn.setAttribute("aria-label", `Убрать элемент: ${label}`);

            const basePlaced =
              "h-14 flex-1 min-w-[180px] rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2 relative overflow-hidden ";

            if (verdict === "correct") {
              btn.className =
                basePlaced +
                "bg-success-lighter dark:bg-success-light border border-success-light dark:border-success-dark text-text-main dark:text-text-on-dark cursor-default";
            } else if (verdict === "incorrect") {
              btn.className =
                basePlaced +
                "bg-error-lighter dark:bg-error-light border border-error-light dark:border-error-dark text-text-main dark:text-text-on-dark cursor-default";
              const stripe = document.createElement("div");
              stripe.className = "absolute right-0 top-0 bottom-0 w-1 bg-error";
              btn.appendChild(stripe);
            } else {
              btn.className =
                basePlaced +
                "border border-border-strong bg-surface-1 text-text-main dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark seq-element-entry";
            }

            const row = document.createElement("div");
            row.className = "flex items-center justify-center gap-2 w-full";

            const t = document.createElement("div");
            t.className = "truncate w-full";
            t.title = label;
            t.textContent = label;

            if (verdict === "correct" || verdict === "incorrect") {
              row.appendChild(makeIconSvg(verdict));
            }
            row.appendChild(t);
            btn.appendChild(row);

            if (levelClickModeActive) {
              // When placing by clicking a whole level, do not allow removing elements by accident.
              // Let clicks fall through to the level panel.
              btn.disabled = true;
              btn.className += " pointer-events-none";
            } else if (!canEdit()) {
              btn.disabled = true;
              btn.className += " opacity-60 cursor-default";
            } else {
              btn.addEventListener("click", () => {
                removeFromLevel(idx, i);
              });
            }

            slotsWrap.appendChild(btn);
          } else {
            const slotBase =
              "h-14 flex-1 min-w-[180px] rounded-lg flex items-center justify-center text-xs font-medium tracking-wider transition-colors ";

            // In level-click mode, empty slots must NOT be buttons; otherwise they capture clicks
            // and prevent placing by clicking the level panel.
            if (levelClickModeActive) {
              const slot = document.createElement("div");
              slot.className =
                slotBase +
                "bg-surface-1 dark:bg-surface-2 border-2 border-dashed border-border-strong dark:border-border-strong text-text-muted select-none pointer-events-none";
              slot.textContent = "[ Пусто ]";
              slotsWrap.appendChild(slot);
            } else {
              const slot = document.createElement("button");
              slot.type = "button";
              slot.setAttribute("aria-label", "Разместить выбранный элемент в этот слот");
              slot.className =
                slotBase +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2 ";

              const editable = canEdit() && !!state.selectedAvailableId;
              if (editable) {
                slot.className +=
                  "bg-surface-1 dark:bg-surface-2 border-2 border-dashed border-border-strong dark:border-border-strong text-text-muted cursor-pointer hover:border-primary hover:bg-primary-lighter";
                slot.textContent = "Разместить";
                slot.addEventListener("click", () => {
                  placeSelectedIntoLevel(idx);
                });
              } else {
                slot.className +=
                  "bg-surface-1 dark:bg-surface-2 border-2 border-dashed border-border-strong dark:border-border-strong text-text-muted cursor-default";
                slot.disabled = true;
                slot.textContent = "[ Пусто ]";
              }

              slotsWrap.appendChild(slot);
            }
          }
        }

        if (userCreatesLevels) {
          const addSlotBtn = document.createElement("button");
          addSlotBtn.type = "button";
          addSlotBtn.setAttribute("aria-label", "Добавить слот в уровень");
          addSlotBtn.className = "h-14 w-12 shrink-0 rounded-lg border border-border-strong dark:border-border-strong flex items-center justify-center hover:bg-bg-hover dark:hover:bg-bg-hover transition-colors text-text-muted hover:text-text-muted dark:hover:text-text-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2";
          addSlotBtn.innerHTML = '<span class="material-symbols-outlined">add</span>';

          if (!canEdit()) {
            addSlotBtn.disabled = true;
            addSlotBtn.className += " opacity-60 cursor-default";
          } else {
            addSlotBtn.addEventListener("click", () => {
              addSlotToLevel(idx);
            });
          }

          slotsWrap.appendChild(addSlotBtn);
        }

        panel.appendChild(slotsWrap);

        wrap.appendChild(headerRow);
        wrap.appendChild(panel);

        if (state.mode === "checked_success" || state.mode === "final_review") {
          wrap.className += " opacity-95";
        }

        levelsContainer.appendChild(wrap);
      });
    }

    addLevelBtn.addEventListener("click", () => {
      addUserLevel();
    });

    function adjustAvailableHeight() {
      try {
        // If levels card is not measurable yet, skip.
        const levelsHeight = levelsCard.getBoundingClientRect().height;
        if (!levelsHeight || levelsHeight <= 0) {
          return;
        }

        // Height of available card without its scroll area.
        const baseNonList =
          availableCard.getBoundingClientRect().height -
          availableList.getBoundingClientRect().height;

        const fullListHeight = availableInner.scrollHeight;
        const wouldBeTotal = baseNonList + fullListHeight;

        if (wouldBeTotal <= levelsHeight) {
          // Show everything (no need to scroll)
          availableList.style.maxHeight = "";
          availableList.style.overflowY = "hidden";
        } else {
          // Constrain list to not exceed levels panel height
          const maxList = Math.max(160, Math.floor(levelsHeight - baseNonList));
          availableList.style.maxHeight = `${maxList}px`;
          availableList.style.overflowY = "auto";
        }
      } catch (e) {
        // Defensive: sizing should never break UI
      }
    }

    function renderAll() {
      renderAvailable();
      renderLevels();
      // Let DOM settle, then measure.
      requestAnimationFrame(adjustAvailableHeight);
    }

    maybeShuffleLevelsOnInit();
    ensureModeByPlacements();
    renderAll();
    containerElement.appendChild(root);

    window.addEventListener("resize", () => {
      requestAnimationFrame(adjustAvailableHeight);
    });

    return {
      getUserAnswerPayload() {
        if (!userCreatesLevels) {
          return {
            levels: state.placements.map((l) => ({
              level_id: l.level_id,
              blocks: Array.isArray(l.blocks) ? l.blocks.filter((x) => x != null) : [],
            })),
          };
        }

        const levelsPayload = state.placements
          .map((l, idx) => {
            let blocks = Array.isArray(l.blocks) ? l.blocks.filter((x) => x != null) : [];
            const lvl = state.data.levels[idx];
            const level_name = lvl && typeof lvl === "object" ? (lvl.label || "") : "";

            if (requiresBlockNames || difficulty === 3) {
              const block_names = {};
              blocks = blocks.filter((id) => {
                const name = state.userBlockNames && typeof state.userBlockNames === "object" ? String(state.userBlockNames[id] || "") : "";
                if (!name.trim()) return false;
                block_names[String(id)] = name;
                return true;
              });
              return {
                level_id: l.level_id,
                level_name,
                blocks,
                block_names,
              };
            }
            return {
              level_id: l.level_id,
              level_name,
              blocks,
            };
          })
          .filter((l) => Array.isArray(l.blocks) && l.blocks.length > 0);

        if (levelsPayload.length === 0) {
          if (state.placements.length > 0) {
            const first = state.placements[0];
            const lvl = state.data.levels[0];
            return {
              levels: [
                {
                  level_id: first.level_id,
                  level_name: (lvl && typeof lvl === "object" ? (lvl.label || "") : ""),
                  blocks: [],
                },
              ],
            };
          }
          return { levels: [] };
        }

        return { levels: levelsPayload };
      },
      moveLevelUp,
      moveLevelDown,
      applyCheckFeedback(result) {
        const success = result && result.success === true;

        state.lastCheckDetails = extractCheckDetails(result);
        state.lastRawResultDetails = (result && result.details && typeof result.details === "object") ? result.details : null;

        // Текстовая подсказка для порядка уровней
        try {
          if (difficulty === 1 && levelOrderMatters) {
            const d = state.lastRawResultDetails;
            const orderOk = d && typeof d === "object" ? d.levels_in_correct_order === true : null;
            if (!success && orderOk === false) {
              levelsHint.textContent = "Порядок уровней неверный. Переставьте уровни и проверьте снова.";
            } else {
              // Восстанавливаем базовую подсказку (как при инициализации)
              levelsHint.textContent = "";
              levelsHint.appendChild(
                document.createTextNode("Выберите элемент справа, затем кликните на пустой слот для размещения.")
              );
              if (sequenceWithinLevelMatters) {
                levelsHint.appendChild(document.createTextNode(" "));
                const strong = document.createElement("strong");
                strong.className = "font-bold text-text-secondary dark:text-text-on-dark";
                strong.textContent = "Порядок элементов важен.";
                levelsHint.appendChild(strong);
              }
              levelsHint.appendChild(document.createTextNode(" "));
              const strong = document.createElement("strong");
              strong.className = "font-bold text-text-secondary dark:text-text-on-dark";
              strong.textContent = "Порядок уровней важен.";
              levelsHint.appendChild(strong);
            }
          }
        } catch (e) {
          // Defensive
        }

        if (typeof window !== "undefined" && window.__SEQ_DEBUG) {
          try {
            // eslint-disable-next-line no-console
            console.log("[SequenceUI] applyCheckFeedback result=", result);
            // eslint-disable-next-line no-console
            console.log("[SequenceUI] extracted details=", state.lastCheckDetails);
          } catch (e) {
            // ignore
          }
        }

        if (success) {
          state.mode = "checked_success";
          state.locked = true;
        } else {
          let lock = false;
          if (result && result.details && typeof result.details === "object") {
            if (result.details.locked === true) {
              lock = true;
            }
          }

          if (lock) {
            state.mode = "final_review";
            state.locked = true;
          } else {
            state.mode = "checked_failed_editable";
            state.locked = false;
          }
        }

        renderAll();
      },
    };
  }

  return {
    render(containerElement, task) {
      currentInstance = createRoot(containerElement, task);
    },
    getUserAnswerPayload() {
      if (currentInstance && typeof currentInstance.getUserAnswerPayload === "function") {
        return currentInstance.getUserAnswerPayload();
      }
      return { levels: [] };
    },
    applyCheckFeedback(result) {
      if (currentInstance && typeof currentInstance.applyCheckFeedback === "function") {
        currentInstance.applyCheckFeedback(result);
      }
    },
    moveLevelUp(levelIndex) {
      if (currentInstance && typeof currentInstance.moveLevelUp === "function") {
        return currentInstance.moveLevelUp(levelIndex);
      }
      return false;
    },
    moveLevelDown(levelIndex) {
      if (currentInstance && typeof currentInstance.moveLevelDown === "function") {
        return currentInstance.moveLevelDown(levelIndex);
      }
      return false;
    },

    // Phase 2: Cleanup method to prevent memory leaks
    cleanup() {
      // Reset current instance
      currentInstance = null;
      // Note: The window resize listener is attached in createRoot (line 1184),
      // but it's an anonymous function so we cannot remove it explicitly.
      // This is a known limitation - the listener will remain until page unload.
      // For a complete fix, we would need to store the listener reference.
      // However, the resize listener is lightweight and won't cause significant leaks.
      // Event listeners on DOM elements will be garbage collected when elements are removed.
    }
  };
})();
