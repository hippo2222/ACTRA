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

  function normalizeTextForComparison(value) {
    try {
      return String(value == null ? "" : value)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
    } catch (e) {
      return "";
    }
  }

  function normalizeBlocksForComparison(blocks, preserveOrder) {
    const normalized = Array.isArray(blocks)
      ? blocks.filter((blockId) => blockId != null).map((blockId) => String(blockId))
      : [];
    return preserveOrder ? normalized : normalized.slice().sort();
  }

  function getLevelSourceId(levelLike) {
    return safeText(
      levelLike && (levelLike.level_id || levelLike.levelId || levelLike.id)
    );
  }

  function getLevelBlocks(levelLike) {
    const blocks =
      (Array.isArray(levelLike && levelLike.blocks) && levelLike.blocks) ||
      (Array.isArray(levelLike && levelLike.correct_blocks) && levelLike.correct_blocks) ||
      (Array.isArray(levelLike && levelLike.sequence) && levelLike.sequence) ||
      [];
    return blocks
      .filter((blockId) => blockId != null)
      .map((blockId) => String(blockId));
  }

  function getLevelLabelForComparison(levelLike, originalLevelLabelById) {
    const explicitLabel = safeText(
      levelLike && (levelLike.level_name || levelLike.label || levelLike.name)
    );
    if (explicitLabel) return explicitLabel;

    const levelId = getLevelSourceId(levelLike);
    return (originalLevelLabelById && originalLevelLabelById[levelId]) || levelId;
  }

  function buildUserLevelReferenceMapForComparison({
    levelList,
    placementList,
    correctLevels,
    sequenceWithinLevelMatters,
    originalLevelLabelById,
  }) {
    const usedCorrectIndices = new Set();
    const mappings = new Map();

    function findUnusedCorrectIndex(predicate) {
      for (let idx = 0; idx < correctLevels.length; idx++) {
        if (usedCorrectIndices.has(idx)) continue;
        if (predicate(correctLevels[idx], idx)) return idx;
      }
      return -1;
    }

    (Array.isArray(placementList) ? placementList : []).forEach((placement, idx) => {
      const level = Array.isArray(levelList) ? levelList[idx] : null;
      if (!level || level.level_id == null) return;

      const userBlocks =
        placement && Array.isArray(placement.blocks) ? placement.blocks : [];
      const matchedIndex = findUnusedCorrectIndex((correctLevel) => {
        const normalizedUser = normalizeBlocksForComparison(
          userBlocks,
          sequenceWithinLevelMatters
        );
        const normalizedCorrect = normalizeBlocksForComparison(
          getLevelBlocks(correctLevel),
          sequenceWithinLevelMatters
        );
        if (normalizedUser.length !== normalizedCorrect.length) return false;
        return normalizedUser.every((blockId, blockIdx) => blockId === normalizedCorrect[blockIdx]);
      });
      if (matchedIndex < 0) return;

      usedCorrectIndices.add(matchedIndex);
      mappings.set(String(level.level_id), correctLevels[matchedIndex]);
    });

    (Array.isArray(levelList) ? levelList : []).forEach((level) => {
      if (!level || level.level_id == null) return;
      const levelId = String(level.level_id);
      if (mappings.has(levelId)) return;

      const userLabel = normalizeTextForComparison(level.label);
      if (!userLabel) return;

      const matchedIndex = findUnusedCorrectIndex((correctLevel) => {
        return (
          userLabel ===
          normalizeTextForComparison(
            getLevelLabelForComparison(correctLevel, originalLevelLabelById)
          )
        );
      });
      if (matchedIndex < 0) return;

      usedCorrectIndices.add(matchedIndex);
      mappings.set(levelId, correctLevels[matchedIndex]);
    });

    return mappings;
  }

  function resolveCheckedCorrectBlocksByLevel({
    lastCheckDetails,
    lastRawResultDetails,
    userCreatesLevels,
    requiresBlockNames,
    difficulty,
    levelList,
    placementList,
    sequenceWithinLevelMatters,
    originalLevelLabelById,
  }) {
    const correctByLevelId = new Map();

    if (lastCheckDetails && typeof lastCheckDetails === "object") {
      const byLevel = lastCheckDetails.correct_blocks_by_level;
      if (byLevel && typeof byLevel === "object" && !Array.isArray(byLevel)) {
        for (const [levelId, blocks] of Object.entries(byLevel)) {
          if (!levelId || !Array.isArray(blocks)) continue;
          correctByLevelId.set(String(levelId), blocks.slice());
        }
      }

      if (Array.isArray(lastCheckDetails.correct_levels)) {
        for (const level of lastCheckDetails.correct_levels) {
          if (!level || typeof level !== "object") continue;
          const levelId = getLevelSourceId(level);
          const blocks = getLevelBlocks(level);
          if (levelId && blocks.length > 0 && !correctByLevelId.has(levelId)) {
            correctByLevelId.set(levelId, blocks.slice());
          }
        }
      }
    }

    if (!userCreatesLevels || requiresBlockNames || difficulty === 3) {
      return correctByLevelId;
    }

    const details =
      lastRawResultDetails && typeof lastRawResultDetails === "object"
        ? lastRawResultDetails
        : {};
    const correctLevels = Array.isArray(details.correct_levels_data)
      ? details.correct_levels_data
      : [];
    const userLevelReferenceMap = buildUserLevelReferenceMapForComparison({
      levelList,
      placementList,
      correctLevels,
      sequenceWithinLevelMatters,
      originalLevelLabelById,
    });

    userLevelReferenceMap.forEach((correctLevel, userLevelId) => {
      if (!userLevelId) return;
      const correctLevelId = getLevelSourceId(correctLevel);
      const matchedBlocks =
        correctLevelId && correctByLevelId.has(correctLevelId)
          ? correctByLevelId.get(correctLevelId)
          : null;

      if (Array.isArray(matchedBlocks)) {
        correctByLevelId.set(String(userLevelId), matchedBlocks.slice());
        return;
      }

      if (!correctByLevelId.has(String(userLevelId))) {
        correctByLevelId.set(String(userLevelId), getLevelBlocks(correctLevel));
      }
    });

    return correctByLevelId;
  }

  function normalizeTaskData(task) {
    function resolveSequenceImageUrl(rawValue) {
      if (!rawValue && rawValue !== 0) return null;

      if (Array.isArray(rawValue)) {
        for (const item of rawValue) {
          const resolved = resolveSequenceImageUrl(item);
          if (resolved) return resolved;
        }
        return null;
      }

      if (rawValue && typeof rawValue === "object") {
        const nested = rawValue.image && typeof rawValue.image === "object" ? rawValue.image : null;
        const directUrl =
          rawValue.asset_url ||
          rawValue.image_asset_url ||
          rawValue.image_url ||
          rawValue.url ||
          rawValue.src ||
          (nested &&
            (nested.asset_url ||
              nested.image_asset_url ||
              nested.image_url ||
              nested.url ||
              nested.src)) ||
          "";
        if (directUrl) return resolveSequenceImageUrl(directUrl);

        const assetId =
          rawValue.asset_id ||
          rawValue.image_asset_id ||
          (nested && (nested.asset_id || nested.image_asset_id)) ||
          "";
        if (assetId) {
          return `/api/assets/${encodeURIComponent(String(assetId))}/content`;
        }
        const legacyPath =
          rawValue.image_path ||
          rawValue.path ||
          (nested && (nested.image_path || nested.path)) ||
          "";
        if (legacyPath) return resolveSequenceImageUrl(legacyPath);
        return null;
      }

      const raw = String(rawValue).trim();
      if (!raw) return null;
      if (/^(https?:|data:)/i.test(raw) || raw.startsWith("/")) return raw;
      return `/api/local-image?path=${encodeURIComponent(raw)}`;
    }

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
        const image = resolveSequenceImageUrl(e);
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
    const normalizedData = normalizeTaskData(taskDto || {});
    const settings = {
      ...((normalizedData.settings && typeof normalizedData.settings === "object") ? normalizedData.settings : {}),
      ...(((taskData && taskData.settings) && typeof taskData.settings === "object") ? taskData.settings : {}),
    };

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

    const elements = normalizedData.elements;
    const levels = normalizedData.levels;

    const data = {
      prompt: normalizedData.prompt,
      elements,
      levels,
      settings,
    };

    const originalLevels = data.levels.map((lvl) => ({
      level_id: String(lvl.level_id),
      label: safeText(lvl.label),
      slots: Array.isArray(lvl.slots) ? lvl.slots.slice() : [],
    }));
    const originalLevelLabelById = new Map(
      originalLevels.map((level) => [String(level.level_id), safeText(level.label)])
    );
    const defaultElementTextById = new Map(
      data.elements.map((element) => [String(element.id), safeText(element.text)])
    );
    const initialElementIds = data.elements.map((e) => e.id);

    const shuffleEnabled = !(data.settings && data.settings.shuffle_elements === false);

    const initialAvailable = initialElementIds.slice();
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
      comparisonView: "user",
    };
    const levelNameInputById = new Map();
    const invalidLevelNameIds = new Set();

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
      ".seq-level-entry,.seq-element-entry{transform:translateZ(0);backface-visibility:hidden;}" +
      ".seq-level-entry[data-reordering='true']{will-change:transform;}";
    root.appendChild(style);

    const layout = document.createElement("div");
    layout.className =
      "grid min-h-0 gap-4 items-start lg:grid-cols-3 xl:grid-cols-4";

    const main = document.createElement("div");
    main.className = "min-w-0 lg:col-span-2 xl:col-span-3 flex min-h-[220px] flex-col gap-3";

    const sidebar = document.createElement("aside");
    sidebar.className = "min-w-0 lg:col-span-1 xl:col-span-1 flex min-h-[220px] flex-col";
    sidebar.dataset.sequenceui = "available-sidebar";
    if (requiresBlockNames || difficulty === 3) {
      // Difficulty=3: no available elements sidebar.
      sidebar.classList.add("hidden");
      main.className = "min-w-0 lg:col-span-3 xl:col-span-4 flex min-h-[220px] flex-col gap-3";
      layout.className = "grid min-h-0 gap-4";
    }

    const availableStickyFrame = document.createElement("div");
    availableStickyFrame.className = "w-full";
    availableStickyFrame.dataset.sequenceui = "available-sticky-frame";

    const availableCard = document.createElement("div");
    availableCard.className =
      "flex min-h-[220px] flex-col overflow-hidden rounded-xl border border-border-strong bg-surface-2 p-4 shadow-lg dark:border-border-strong dark:bg-surface-2";
    availableCard.dataset.sequenceui = "available-card";
    availableCard.style.maxHeight = "calc(100vh - 7rem)";

    const availableHeader = document.createElement("div");
    availableHeader.className = "flex items-start justify-between gap-3";

    const availableTitle = document.createElement("div");
    availableTitle.className = "text-sm font-bold text-text-main dark:text-text-on-dark";
    availableTitle.textContent = "\u0414\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u044b";

    const availableCount = document.createElement("div");
    availableCount.className =
      "text-xs font-semibold bg-surface-1 dark:bg-surface-1 border border-border-strong text-text-secondary dark:text-text-on-dark px-2 py-0.5 rounded-full";
    availableCount.dataset.sequenceui = "available-count";

    availableHeader.appendChild(availableTitle);
    availableHeader.appendChild(availableCount);

    const availableHint = document.createElement("div");
    availableHint.className = "mt-2 text-xs leading-relaxed text-text-main dark:text-text-on-dark";
    availableHint.textContent = "\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442 \u0437\u0434\u0435\u0441\u044c, \u0437\u0430\u0442\u0435\u043c \u043a\u043b\u0438\u043a\u043d\u0438\u0442\u0435 \u043f\u043e \u043f\u0443\u0441\u0442\u043e\u043c\u0443 \u0441\u043b\u043e\u0442\u0443 \u043d\u0443\u0436\u043d\u043e\u0433\u043e \u0443\u0440\u043e\u0432\u043d\u044f.";

    const availableList = document.createElement("div");
    availableList.className = "mt-3 min-h-0 flex-1 overflow-y-auto pr-1 sequenceui-scrollbar";
    availableList.dataset.sequenceui = "available-list";

    const availableInner = document.createElement("div");
    availableInner.className = "space-y-2 pr-1";
    availableList.appendChild(availableInner);

    availableCard.appendChild(availableHeader);
    availableCard.appendChild(availableHint);
    availableCard.appendChild(availableList);

    availableStickyFrame.appendChild(availableCard);
    sidebar.appendChild(availableStickyFrame);

    const levelsCard = document.createElement("div");
    levelsCard.className =
      "flex min-h-[220px] flex-col rounded-xl border border-border-strong bg-surface-2 p-4 shadow-lg dark:border-border-strong dark:bg-surface-2";
    levelsCard.dataset.sequenceui = "levels-card";

    const levelsHeader = document.createElement("div");
    levelsHeader.className = "flex items-start justify-between gap-3";

    const levelsTitle = document.createElement("div");
    levelsTitle.className = "min-w-0 text-base font-bold leading-tight text-text-main dark:text-text-on-dark";
    levelsTitle.textContent = data.prompt || "\u0420\u0430\u0441\u043f\u043e\u043b\u043e\u0436\u0438\u0442\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u044b \u043f\u043e \u0443\u0440\u043e\u0432\u043d\u044f\u043c";
    levelsTitle.title = levelsTitle.textContent;
    levelsTitle.dataset.sequenceui = "task-prompt";

    const addLevelBtn = document.createElement("button");
    addLevelBtn.type = "button";
    addLevelBtn.className = "hidden items-center justify-center gap-1.5 px-3 py-1.5 border border-border-strong bg-primary text-primary-fg hover:bg-primary-hover rounded text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2";
    addLevelBtn.setAttribute("aria-label", "\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0443\u0440\u043e\u0432\u0435\u043d\u044c");
    addLevelBtn.innerHTML = '<span class="material-symbols-outlined text-sm">add</span> \u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0443\u0440\u043e\u0432\u0435\u043d\u044c';

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "hidden items-center justify-center gap-1.5 px-3 py-1.5 border border-border-strong bg-surface-1 text-text-main hover:bg-bg-hover rounded text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:border-border-strong dark:bg-surface-1 dark:text-text-on-dark dark:hover:bg-bg-hover dark:focus-visible:ring-offset-surface-2";
    clearBtn.setAttribute("aria-label", "\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c");
    clearBtn.dataset.sequenceui = "clear-button";
    clearBtn.innerHTML = '<span class="material-symbols-outlined text-sm">backspace</span> \u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c';

    const levelsActions = document.createElement("div");
    levelsActions.className = "flex flex-wrap items-center justify-end gap-2";
    levelsActions.appendChild(clearBtn);
    levelsActions.appendChild(addLevelBtn);

    levelsHeader.appendChild(levelsTitle);
    levelsHeader.appendChild(levelsActions);

    const levelsHint = document.createElement("div");
    levelsHint.className = "mt-2 text-xs leading-relaxed text-text-main dark:text-text-on-dark";
    levelsHint.textContent = "\u041f\u0440\u043e\u0447\u0438\u0442\u0430\u0439\u0442\u0435 \u0444\u043e\u0440\u043c\u0443\u043b\u0438\u0440\u043e\u0432\u043a\u0443 \u0432\u044b\u0448\u0435, \u0437\u0430\u0442\u0435\u043c \u0440\u0430\u0441\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u0435 \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u044b \u043f\u043e \u043f\u043e\u0434\u0445\u043e\u0434\u044f\u0449\u0438\u043c \u0443\u0440\u043e\u0432\u043d\u044f\u043c. \u041d\u0430\u0437\u0432\u0430\u043d\u0438\u044f \u0443\u0440\u043e\u0432\u043d\u0435\u0439 \u043f\u043e\u0434\u0441\u043a\u0430\u0437\u044b\u0432\u0430\u044e\u0442, \u043a\u0443\u0434\u0430 \u0438\u043c\u0435\u043d\u043d\u043e \u043d\u0443\u0436\u043d\u043e \u043f\u043e\u043c\u0435\u0441\u0442\u0438\u0442\u044c \u043a\u0430\u0436\u0434\u044b\u0439 \u044d\u043b\u0435\u043c\u0435\u043d\u0442.";
    if (requiresBlockNames || difficulty === 3) {
      levelsHint.textContent = "\u041f\u0440\u043e\u0447\u0438\u0442\u0430\u0439\u0442\u0435 \u0444\u043e\u0440\u043c\u0443\u043b\u0438\u0440\u043e\u0432\u043a\u0443 \u0432\u044b\u0448\u0435, \u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0439\u0442\u0435 \u0441\u043b\u043e\u0442\u044b \u0438 \u0432\u0432\u043e\u0434\u0438\u0442\u0435 \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u044f \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u043e\u0432 \u043f\u0440\u044f\u043c\u043e \u0432 \u043d\u0443\u0436\u043d\u044b\u0435 \u0443\u0440\u043e\u0432\u043d\u0438.";
    }
    if (sequenceWithinLevelMatters) {
      levelsHint.appendChild(document.createTextNode(" "));
      const strong = document.createElement("strong");
      strong.className = "font-bold text-text-main dark:text-text-on-dark";
      strong.textContent = "\u041f\u043e\u0440\u044f\u0434\u043e\u043a \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u043e\u0432 \u0432\u043d\u0443\u0442\u0440\u0438 \u0443\u0440\u043e\u0432\u043d\u044f \u0432\u0430\u0436\u0435\u043d.";
      levelsHint.appendChild(strong);
    }

    if (difficulty === 1 && levelOrderMatters) {
      levelsHint.appendChild(document.createTextNode(" "));
      const strong = document.createElement("strong");
      strong.className = "font-bold text-text-main dark:text-text-on-dark";
      strong.textContent = "\u041f\u043e\u0440\u044f\u0434\u043e\u043a \u0443\u0440\u043e\u0432\u043d\u0435\u0439 \u0442\u043e\u0436\u0435 \u0432\u0430\u0436\u0435\u043d.";
      levelsHint.appendChild(strong);
    }

    const comparisonToolbar = document.createElement("div");
    comparisonToolbar.className = "mt-3 hidden flex-wrap items-center justify-between gap-3";
    comparisonToolbar.dataset.sequenceui = "comparison-toolbar";

    const comparisonStatus = document.createElement("div");
    comparisonStatus.className = "text-xs font-medium text-text-secondary dark:text-text-on-dark";
    comparisonStatus.dataset.sequenceui = "comparison-status";

    const comparisonToggle = document.createElement("div");
    comparisonToggle.className = "inline-flex overflow-hidden rounded-lg border border-border-strong dark:border-border-strong";

    const userViewBtn = document.createElement("button");
    userViewBtn.type = "button";
    userViewBtn.dataset.sequenceui = "comparison-view-user";
    userViewBtn.textContent = "\u041c\u043e\u0439 \u043e\u0442\u0432\u0435\u0442";

    const referenceViewBtn = document.createElement("button");
    referenceViewBtn.type = "button";
    referenceViewBtn.dataset.sequenceui = "comparison-view-reference";
    referenceViewBtn.textContent = "\u042d\u0442\u0430\u043b\u043e\u043d";

    comparisonToggle.appendChild(userViewBtn);
    comparisonToggle.appendChild(referenceViewBtn);
    comparisonToolbar.appendChild(comparisonStatus);
    comparisonToolbar.appendChild(comparisonToggle);

    levelsCard.appendChild(levelsHeader);
    levelsCard.appendChild(levelsHint);
    levelsCard.appendChild(comparisonToolbar);

    const levelsContainer = document.createElement("div");
    levelsContainer.className = "mt-3 flex flex-col gap-4";
    levelsContainer.dataset.sequenceui = "levels-list";

    levelsCard.appendChild(levelsContainer);

    main.appendChild(levelsCard);

    layout.appendChild(main);
    layout.appendChild(sidebar);

    root.appendChild(layout);

    function getElementById(id) {
      return state.data.elements.find((e) => e.id === id) || null;
    }

    function getAvailableGroups(sourceIds = state.available) {
      const groups = [];
      const indexByKey = new Map();

      sourceIds.forEach((id) => {
        const element = getElementById(id);
        const label = element ? element.text : id;
        const image = element && element.image ? element.image : "";
        const key = `${label}:::${image}`;

        let groupIndex = indexByKey.get(key);
        if (groupIndex == null) {
          groupIndex = groups.length;
          indexByKey.set(key, groupIndex);
          groups.push({
            key,
            label,
            image,
            ids: [],
          });
        }

        groups[groupIndex].ids.push(id);
      });

      return groups;
    }

    function removeAvailableOccurrence(elemId) {
      const availableIndex = state.available.findIndex((x) => x === elemId);
      if (availableIndex < 0) return false;
      state.available.splice(availableIndex, 1);
      return true;
    }

    function isCheckedState(mode = state.mode) {
      return (
        mode === "checked_success" ||
        mode === "checked_failed_editable" ||
        mode === "final_review"
      );
    }

    function hasReferenceLevelsData() {
      const details = state.lastRawResultDetails;
      return !!(
        details &&
        typeof details === "object" &&
        Array.isArray(details.correct_levels_data) &&
        details.correct_levels_data.length > 0
      );
    }

    function isReferenceView() {
      return state.comparisonView === "reference" && isCheckedState() && hasReferenceLevelsData();
    }

    function getCurrentComparisonView() {
      return isReferenceView() ? "reference" : "user";
    }

    function getLevelLabelFromSource(levelLike) {
      return getLevelLabelForComparison(
        levelLike,
        Object.fromEntries(originalLevelLabelById.entries())
      );
    }

    function getBlocksFromLevelSource(levelLike) {
      return getLevelBlocks(levelLike);
    }

    function blocksMatchForComparison(userBlocks, correctBlocks) {
      const normalizedUser = normalizeBlocksForComparison(
        userBlocks,
        sequenceWithinLevelMatters
      );
      const normalizedCorrect = normalizeBlocksForComparison(
        correctBlocks,
        sequenceWithinLevelMatters
      );
      if (normalizedUser.length !== normalizedCorrect.length) return false;
      return normalizedUser.every((blockId, idx) => blockId === normalizedCorrect[idx]);
    }

    function buildReferenceRenderModel() {
      const details =
        state.lastRawResultDetails && typeof state.lastRawResultDetails === "object"
          ? state.lastRawResultDetails
          : {};
      const correctLevels = Array.isArray(details.correct_levels_data)
        ? details.correct_levels_data
        : [];
      const detailsElements = Array.isArray(details.elements_data) ? details.elements_data : [];
      const elementTextById = new Map(defaultElementTextById);

      detailsElements.forEach((element) => {
        if (!element || typeof element !== "object" || element.id == null) return;
        elementTextById.set(
          String(element.id),
          safeText(element.text || element.label || element.title)
        );
      });

      const levels = [];
      const placements = [];
      const blockNames = {};

      correctLevels.forEach((level, idx) => {
        const levelId =
          safeText(level && (level.level_id || level.levelId || level.id)) ||
          `reference_level_${idx + 1}`;
        const blocks = getBlocksFromLevelSource(level);
        const sourceBlockNames =
          level && level.block_names && typeof level.block_names === "object"
            ? level.block_names
            : {};

        levels.push({
          level_id: levelId,
          label: getLevelLabelFromSource(level),
          slots: blocks.map((_, slotIndex) => `slot_${slotIndex + 1}`),
        });
        placements.push({
          level_id: levelId,
          blocks: blocks.slice(),
        });

        blocks.forEach((blockId) => {
          const key = String(blockId);
          if (sourceBlockNames[key] != null) {
            blockNames[key] = safeText(sourceBlockNames[key]);
          } else if (elementTextById.has(key)) {
            blockNames[key] = safeText(elementTextById.get(key));
          }
        });
      });

      return {
        levels,
        placements,
        blockNames,
      };
    }

    function getCurrentRenderModel() {
      if (isReferenceView()) {
        return buildReferenceRenderModel();
      }
      return {
        levels: state.data.levels,
        placements: state.placements,
        blockNames: state.userBlockNames,
      };
    }

    function buildUserLevelReferenceMap(levelList, placementList) {
      const details =
        state.lastRawResultDetails && typeof state.lastRawResultDetails === "object"
          ? state.lastRawResultDetails
          : {};
      const correctLevels = Array.isArray(details.correct_levels_data)
        ? details.correct_levels_data
        : [];
      return buildUserLevelReferenceMapForComparison({
        levelList,
        placementList,
        correctLevels,
        sequenceWithinLevelMatters,
        originalLevelLabelById: Object.fromEntries(originalLevelLabelById.entries()),
      });
    }

    function canEdit() {
      return (
        !state.locked &&
        !isReferenceView() &&
        (state.mode === "initial" ||
          state.mode === "in_progress" ||
          state.mode === "checked_failed_editable")
      );
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

    function hasClearableContent() {
      if (requiresBlockNames || difficulty === 3) {
        return state.placements.some((placement) => {
          const blocks = placement && Array.isArray(placement.blocks) ? placement.blocks : [];
          return blocks.some((blockId) => {
            if (!blockId) return false;
            const value =
              state.userBlockNames && typeof state.userBlockNames === "object"
                ? String(state.userBlockNames[blockId] || "")
                : "";
            return !!value.trim();
          });
        });
      }

      return state.placements.some((placement) => {
        return Array.isArray(placement && placement.blocks) && placement.blocks.some((x) => x != null);
      });
    }

    function clearAllPlacements() {
      if (!canEdit() || state.mode === "checked_failed_editable") return false;

      state.selectedAvailableId = null;
      invalidLevelNameIds.clear();

      if (requiresBlockNames || difficulty === 3) {
        state.placements.forEach((placement) => {
          const blocks = placement && Array.isArray(placement.blocks) ? placement.blocks : [];
          blocks.forEach((blockId) => {
            if (!blockId) return;
            if (state.userBlockNames && typeof state.userBlockNames === "object") {
              state.userBlockNames[String(blockId)] = "";
            }
          });
        });
      } else {
        state.placements.forEach((placement, idx) => {
          const expectedCount =
            placement && Array.isArray(placement.blocks)
              ? placement.blocks.length
              : Array.isArray(state.data.levels[idx] && state.data.levels[idx].slots)
                ? state.data.levels[idx].slots.length
                : 0;
          placement.blocks = Array.from({ length: expectedCount }, () => null);
        });
        state.available = initialAvailable.slice();
      }

      ensureModeByPlacements();
      renderAll();
      return true;
    }

    function getMeaningfulBlockIdsForPlacement(placement) {
      const blocks = placement && Array.isArray(placement.blocks) ? placement.blocks : [];
      if (requiresBlockNames || difficulty === 3) {
        return blocks.filter((blockId) => {
          if (!blockId) return false;
          const value =
            state.userBlockNames && typeof state.userBlockNames === "object"
              ? String(state.userBlockNames[String(blockId)] || "")
              : "";
          return !!value.trim();
        });
      }
      return blocks.filter((blockId) => blockId != null);
    }

    function findFirstMissingLevelName() {
      if (!userCreatesLevels || difficulty < 2) return null;
      for (let index = 0; index < state.data.levels.length; index += 1) {
        const level = state.data.levels[index];
        const placement = state.placements[index];
        const label = level && typeof level === "object" ? String(level.label || "") : "";
        const hasMeaningfulBlocks =
          placement && typeof placement === "object"
            ? getMeaningfulBlockIdsForPlacement(placement).length > 0
            : false;
        if (!label.trim() && hasMeaningfulBlocks) {
          return {
            index,
            levelId: String(
              (placement && placement.level_id) ||
              (level && level.level_id) ||
              index
            ),
          };
        }
      }
      return null;
    }

    function focusMissingLevelName(levelId) {
      if (!levelId) return false;
      invalidLevelNameIds.clear();
      invalidLevelNameIds.add(String(levelId));
      renderAll({ preserveScroll: true });
      const input = levelNameInputById.get(String(levelId));
      if (!input) return false;
      try {
        input.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      } catch (e) {
        try {
          input.scrollIntoView();
        } catch (innerErr) {
          // Ignore scroll failures.
        }
      }
      try {
        input.focus({ preventScroll: true });
      } catch (e) {
        input.focus();
      }
      if (typeof input.select === "function") {
        input.select();
      }
      return true;
    }

    function validateBeforeSubmit() {
      const missingLevel = findFirstMissingLevelName();
      if (missingLevel) {
        focusMissingLevelName(missingLevel.levelId);
        return {
          valid: false,
          reason: "missing_level_name",
          message: "Добавьте название уровня перед проверкой",
        };
      }
      invalidLevelNameIds.clear();
      return { valid: true };
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
      if (placement && placement.level_id != null) {
        invalidLevelNameIds.delete(String(placement.level_id));
      }
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
      state.comparisonView = "user";
    }

    function canReorderLevels() {
      return difficulty === 1 && levelOrderMatters && canEdit();
    }

    function captureLevelRects() {
      const rects = new Map();
      const nodes = levelsContainer.querySelectorAll("[data-sequenceui-level-id]");
      nodes.forEach((node) => {
        rects.set(node.dataset.sequenceuiLevelId, node.getBoundingClientRect());
      });
      return rects;
    }

    function animateLevelReorder(previousRects) {
      if (!(previousRects instanceof Map) || previousRects.size === 0) {
        return;
      }

      const nodes = levelsContainer.querySelectorAll("[data-sequenceui-level-id]");
      nodes.forEach((node) => {
        const before = previousRects.get(node.dataset.sequenceuiLevelId);
        if (!before) return;

        const after = node.getBoundingClientRect();
        const deltaY = before.top - after.top;
        if (Math.abs(deltaY) < 1) return;

        node.dataset.reordering = "true";
        node.style.transition = "none";
        node.style.transform = `translateY(${deltaY}px)`;

        requestAnimationFrame(() => {
          node.style.transition = "transform 160ms ease-out";
          node.style.transform = "translateY(0)";
          node.addEventListener("transitionend", () => {
            node.style.transition = "";
            node.style.transform = "";
            delete node.dataset.reordering;
          }, { once: true });
        });
      });
    }

    function swapLevels(i, j) {
      if (!canReorderLevels()) return false;
      if (!Array.isArray(state.data.levels) || !Array.isArray(state.placements)) return false;
      if (i < 0 || j < 0) return false;
      if (i >= state.data.levels.length || j >= state.data.levels.length) return false;
      if (i >= state.placements.length || j >= state.placements.length) return false;
      if (i === j) return true;

      const previousRects = captureLevelRects();

      const tmpLvl = state.data.levels[i];
      state.data.levels[i] = state.data.levels[j];
      state.data.levels[j] = tmpLvl;

      const tmpPl = state.placements[i];
      state.placements[i] = state.placements[j];
      state.placements[j] = tmpPl;

      renderAll({ preserveScroll: true });
      animateLevelReorder(previousRects);
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
      const renderModel = getCurrentRenderModel();
      const ids = isReferenceView()
        ? buildAvailableFromPlacements(renderModel.placements)
        : state.available.slice();
      const groups = getAvailableGroups(ids);
      availableCount.textContent = `${ids.length} ${pluralRu(ids.length, "\u044d\u043b\u0435\u043c\u0435\u043d\u0442", "\u044d\u043b\u0435\u043c\u0435\u043d\u0442\u0430", "\u044d\u043b\u0435\u043c\u0435\u043d\u0442\u043e\u0432")}`;

      if (ids.length === 0) {
        const empty = document.createElement("div");
        empty.className = "text-xs text-text-muted dark:text-text-muted";
        empty.textContent = "\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0445 \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u043e\u0432";
        availableInner.appendChild(empty);
        return;
      }

      groups.forEach((group) => {
        const representativeId = group.ids[0];
        const label = group.label;
        const isSelected = !isReferenceView() && group.ids.includes(state.selectedAvailableId);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("aria-label", `Выбрать элемент: ${label}`);
        btn.dataset.sequenceui = "available-item";
        btn.className =
          "w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2 " +
          (isSelected
            ? "border-primary bg-primary-lighter dark:border-primary dark:bg-primary dark:text-primary-fg"
            : "border-border-strong bg-surface-1 hover:bg-bg-hover dark:border-border-strong dark:bg-surface-2 dark:hover:bg-bg-hover");

        const line = document.createElement("div");
        line.className = "flex items-start justify-between gap-2";

        const text = document.createElement("div");
        text.className = `truncate font-medium ${isSelected ? "text-text-main dark:text-primary-fg" : "text-text-main dark:text-text-on-dark"}`;
        text.title = label;
        text.textContent = label;
        line.appendChild(text);

        if (group.ids.length > 1) {
          const countBadge = document.createElement("span");
          countBadge.className = "shrink-0 rounded-full border border-border-strong bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-text-main dark:border-border-strong dark:bg-surface-1 dark:text-text-on-dark";
          countBadge.dataset.sequenceui = "available-duplicate-count";
          countBadge.textContent = `x${group.ids.length}`;
          line.appendChild(countBadge);
        }

        btn.appendChild(line);

        if (!canEdit()) {
          btn.disabled = true;
          btn.className += " opacity-60 cursor-default";
        }

        btn.addEventListener("click", () => {
          if (!canEdit()) return;
          state.selectedAvailableId = isSelected ? null : representativeId;
          ensureModeByPlacements();
          renderAll();
        });

        availableInner.appendChild(btn);
      });
    }

    function placeSelectedIntoLevel(levelIndex, slotIndex) {
      if (!canEdit()) return;
      const elemId = state.selectedAvailableId;
      if (!elemId) return;
      const placement = state.placements[levelIndex];
      if (!placement) return;

      placement.blocks = Array.isArray(placement.blocks) ? placement.blocks : [];
      let targetIdx = -1;

      if (
        typeof slotIndex === "number" &&
        Number.isInteger(slotIndex) &&
        slotIndex >= 0 &&
        slotIndex < placement.blocks.length
      ) {
        if (placement.blocks[slotIndex] != null) {
          return;
        }
        targetIdx = slotIndex;
      } else {
        targetIdx = placement.blocks.findIndex((x) => x == null);
      }

      if (targetIdx < 0) {
        if (userCreatesLevels) {
          placement.blocks.push(null);
          targetIdx = placement.blocks.length - 1;
        } else {
          return;
        }
      }
      placement.blocks[targetIdx] = elemId;

      removeAvailableOccurrence(elemId);
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
      levelNameInputById.clear();
      const referenceView = isReferenceView();
      const renderModel = getCurrentRenderModel();
      const levels = renderModel.levels;
      const placements = renderModel.placements;
      const blockNamesSource = renderModel.blockNames;

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

      function getLevelOrderVerdict(levelIndex, level) {
        if (referenceView) return null;
        if (!(difficulty === 1 && levelOrderMatters)) return null;
        if (!isCheckedState()) {
          return null;
        }

        const d = state.lastRawResultDetails;
        if (!d || typeof d !== "object") return null;

        const correctLevelsData = Array.isArray(d.correct_levels_data)
          ? d.correct_levels_data
          : [];
        const currentLevelId = safeText(level && (level.level_id || level.levelId || level.id));
        const expectedLevel =
          levelIndex >= 0 && levelIndex < correctLevelsData.length
            ? correctLevelsData[levelIndex]
            : null;
        const expectedLevelId = safeText(
          expectedLevel &&
            (expectedLevel.level_id || expectedLevel.levelId || expectedLevel.id)
        );
        if (currentLevelId && expectedLevelId) {
          return currentLevelId === expectedLevelId ? "correct" : "incorrect";
        }

        const userLevels = d.user_levels_data || d.user_levels;
        const correctLevels = d.correct_levels_data || d.correct_levels;
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
        state.lastCheckDetails &&
        typeof state.lastCheckDetails === "object" &&
        Array.isArray(state.lastCheckDetails.correct_levels);

      const matchedBlockNames = new Set();
      if (
        !referenceView &&
        (requiresBlockNames || difficulty === 3) &&
        state.lastRawResultDetails &&
        typeof state.lastRawResultDetails === "object"
      ) {
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

      const correctByLevelId = resolveCheckedCorrectBlocksByLevel({
        lastCheckDetails: state.lastCheckDetails,
        lastRawResultDetails: state.lastRawResultDetails,
        userCreatesLevels,
        requiresBlockNames,
        difficulty,
        levelList: state.data.levels,
        placementList: state.placements,
        sequenceWithinLevelMatters,
        originalLevelLabelById: Object.fromEntries(originalLevelLabelById.entries()),
      });

      const userLevelReferenceMap =
        !referenceView && userCreatesLevels
          ? buildUserLevelReferenceMap(state.data.levels, state.placements)
          : new Map();

      const matchedLevelIds = new Set();
      const unmatchedLevelIds = new Set();
      if (
        !referenceView &&
        userCreatesLevels &&
        state.lastRawResultDetails &&
        typeof state.lastRawResultDetails === "object"
      ) {
        const levelNames =
          state.lastRawResultDetails.level_names &&
          typeof state.lastRawResultDetails.level_names === "object"
            ? state.lastRawResultDetails.level_names
            : null;
        const matchedLevels =
          levelNames && Array.isArray(levelNames.matched_levels)
            ? levelNames.matched_levels
            : [];
        const unmatchedLevels =
          levelNames && Array.isArray(levelNames.unmatched_levels)
            ? levelNames.unmatched_levels
            : [];

        matchedLevels.forEach((entry) => {
          if (!Array.isArray(entry) || entry.length < 1 || !entry[0]) return;
          matchedLevelIds.add(String(entry[0]));
        });
        unmatchedLevels.forEach((entry) => {
          if (!Array.isArray(entry) || entry.length < 2 || !entry[0] || !entry[1]) return;
          unmatchedLevelIds.add(String(entry[0]));
        });
      }

      function getLevelNameVerdict(level) {
        if (referenceView || !userCreatesLevels || !isCheckedState()) return null;

        const levelId = safeText(level && level.level_id);
        if (matchedLevelIds.has(levelId)) return "correct";
        if (unmatchedLevelIds.has(levelId)) return "incorrect";

        const matchedCorrectLevel = userLevelReferenceMap.get(levelId);
        if (!matchedCorrectLevel) return null;

        const userLabel = normalizeTextForComparison(level && level.label);
        const correctLabel = normalizeTextForComparison(getLevelLabelFromSource(matchedCorrectLevel));
        if (!userLabel || !correctLabel) return null;
        return userLabel === correctLabel ? "correct" : "incorrect";
      }

      function getSlotVerdict(levelId, slotIndex, placedId) {
        if (referenceView) return null;
        if (!placedId) return null;
        if (!state.lastCheckDetails || correctByLevelId.size === 0) return null;
        if (!isCheckedState()) {
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
        empty.textContent = "В задаче нет уровней";
        levelsContainer.appendChild(empty);
        return;
      }

      levels.forEach((lvl, idx) => {
        const placement = placements[idx];
        const expectedCount = userCreatesLevels
          ? (placement && Array.isArray(placement.blocks) ? placement.blocks.length : 0)
          : (Array.isArray(lvl.slots) ? lvl.slots.length : 0);
        const blocks = placement && Array.isArray(placement.blocks)
          ? (referenceView ? placement.blocks.slice() : placement.blocks)
          : Array.from({ length: expectedCount }, () => null);

        const wrap = document.createElement("div");
        wrap.className = "seq-level-entry";
        wrap.dataset.sequenceuiLevelId = String(lvl.level_id || idx);

        const headerRow = document.createElement("div");
        headerRow.className = "flex items-center justify-between mb-3";

        const leftHeader = document.createElement("div");
        leftHeader.className = "flex items-center gap-2";

        if (userCreatesLevels && !referenceView) {
          if (canEdit()) {
            const inputWrap = document.createElement("div");
            inputWrap.className = "relative grow max-w-md";

            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = "Название уровня...";
            input.value = lvl.label || "";
            const levelInputId = String(lvl.level_id || idx);
            const isMissingLevelName =
              invalidLevelNameIds.has(levelInputId) &&
              getMeaningfulBlockIdsForPlacement(state.placements[idx]).length > 0;
            input.className =
              "block w-full px-3 py-1.5 border rounded-md leading-5 bg-surface-1 dark:bg-surface-2 text-text-main dark:text-text-on-dark placeholder:text-text-muted focus:outline-none focus:ring-1 text-sm font-bold shadow-sm " +
              (isMissingLevelName
                ? "border-error-light dark:border-error-dark bg-error-lighter dark:bg-error-light focus:ring-error focus:border-error"
                : "border-border-subtle dark:border-border-strong focus:ring-primary focus:border-primary");
            input.setAttribute("aria-invalid", isMissingLevelName ? "true" : "false");
            input.dataset.sequenceuiLevelNameInput = levelInputId;
            input.addEventListener("input", () => {
              lvl.label = input.value;
              if (input.value.trim()) {
                invalidLevelNameIds.delete(levelInputId);
                input.className = "block w-full px-3 py-1.5 border border-border-subtle dark:border-border-strong rounded-md leading-5 bg-surface-1 dark:bg-surface-2 text-text-main dark:text-text-on-dark placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-sm font-bold shadow-sm";
                input.setAttribute("aria-invalid", "false");
              }
            });
            levelNameInputById.set(levelInputId, input);

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
          "text-[10px] font-bold text-text-main dark:text-text-on-dark uppercase tracking-widest";
        slotsLabel.textContent =
          expectedCount > 0
            ? `${expectedCount} ${pluralRu(expectedCount, "слот", "слота", "слотов")}`
            : "";

        if (difficulty === 1 && levelOrderMatters && !referenceView) {
          const controls = document.createElement("div");
          controls.className =
            "flex overflow-hidden rounded-md border border-border-strong bg-surface-2 shadow-sm dark:border-border-strong dark:bg-surface-2 divide-x divide-border-strong dark:divide-border-strong";
          controls.dataset.sequenceui = "level-order-controls";

          const canUse = canReorderLevels();

          const upBtn = document.createElement("button");
          upBtn.type = "button";
          upBtn.title = "\u041f\u0435\u0440\u0435\u043c\u0435\u0441\u0442\u0438\u0442\u044c \u0432\u0432\u0435\u0440\u0445";
          upBtn.setAttribute("aria-label", "\u041f\u0435\u0440\u0435\u043c\u0435\u0441\u0442\u0438\u0442\u044c \u0443\u0440\u043e\u0432\u0435\u043d\u044c \u0432\u0432\u0435\u0440\u0445");

          const upIcon = document.createElement("span");
          upIcon.className = "material-symbols-outlined text-[18px]";
          upIcon.textContent = "keyboard_arrow_up";
          upBtn.appendChild(upIcon);

          const upDisabled = !canUse || idx === 0;
          if (upDisabled) {
            upBtn.disabled = true;
            upBtn.className = "flex h-8 w-8 items-center justify-center bg-surface-2 text-text-secondary opacity-70 dark:bg-surface-2 dark:text-text-on-dark disabled:cursor-not-allowed";
          } else {
            upBtn.className = "flex h-8 w-8 items-center justify-center bg-surface-1 text-text-secondary shadow-sm transition-colors hover:bg-bg-hover hover:text-primary dark:bg-surface-1 dark:text-text-on-dark dark:hover:bg-bg-hover";
            upBtn.addEventListener("click", () => {
              moveLevelUp(idx);
            });
          }

          const downBtn = document.createElement("button");
          downBtn.type = "button";
          downBtn.title = "\u041f\u0435\u0440\u0435\u043c\u0435\u0441\u0442\u0438\u0442\u044c \u0432\u043d\u0438\u0437";
          downBtn.setAttribute("aria-label", "\u041f\u0435\u0440\u0435\u043c\u0435\u0441\u0442\u0438\u0442\u044c \u0443\u0440\u043e\u0432\u0435\u043d\u044c \u0432\u043d\u0438\u0437");

          const downIcon = document.createElement("span");
          downIcon.className = "material-symbols-outlined text-[18px]";
          downIcon.textContent = "keyboard_arrow_down";
          downBtn.appendChild(downIcon);

          const downDisabled = !canUse || idx === levels.length - 1;
          if (downDisabled) {
            downBtn.disabled = true;
            downBtn.className = "flex h-8 w-8 items-center justify-center bg-surface-2 text-text-secondary opacity-70 dark:bg-surface-2 dark:text-text-on-dark disabled:cursor-not-allowed";
          } else {
            downBtn.className = "flex h-8 w-8 items-center justify-center bg-surface-1 text-text-secondary shadow-sm transition-colors hover:bg-bg-hover hover:text-primary dark:bg-surface-1 dark:text-text-on-dark dark:hover:bg-bg-hover";
            downBtn.addEventListener("click", () => {
              moveLevelDown(idx);
            });
          }

          controls.appendChild(upBtn);
          controls.appendChild(downBtn);
          rightHeader.appendChild(controls);
        }

        if (userCreatesLevels && !referenceView) {
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
        const levelOrderVerdict = getLevelOrderVerdict(idx, lvl);
        const levelNameVerdict = getLevelNameVerdict(lvl);
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

        if (levelOrderVerdict == null && levelNameVerdict === "correct") {
          panel.className =
            "p-5 rounded-xl border bg-success-lighter dark:bg-success-light border-success-light dark:border-success-dark";
          const badge = document.createElement("span");
          badge.className = "ml-2 inline-flex items-center gap-1 text-xs font-semibold text-success-text dark:text-success-light";
          badge.appendChild(makeIconSvg("correct"));
          badge.appendChild(document.createTextNode("Название верное"));
          headerRow.appendChild(badge);
        } else if (levelOrderVerdict == null && levelNameVerdict === "incorrect") {
          panel.className =
            "p-5 rounded-xl border bg-error-lighter dark:bg-error-light border-error-light dark:border-error-dark";
          const badge = document.createElement("span");
          badge.className = "ml-2 inline-flex items-center gap-1 text-xs font-semibold text-error-text dark:text-error-light";
          badge.appendChild(makeIconSvg("incorrect"));
          badge.appendChild(document.createTextNode("Название неверное"));
          headerRow.appendChild(badge);
        } else if (levelOrderVerdict == null && levelNameVerdict == null && referenceView) {
          const badge = document.createElement("span");
          badge.className = "ml-2 inline-flex items-center gap-1 text-xs font-semibold text-success-text dark:text-success-light";
          badge.appendChild(makeIconSvg("correct"));
          badge.appendChild(document.createTextNode("Эталон"));
          headerRow.appendChild(badge);
        }

        const allowClickOnLevel = difficulty === 1 && !sequenceWithinLevelMatters;
        const emptySlotCount = Array.isArray(blocks)
          ? blocks.reduce((count, blockId) => count + (blockId == null ? 1 : 0), 0)
          : 0;
        const levelHasEmptySlot = emptySlotCount > 0;
        const levelClickable =
          allowClickOnLevel &&
          canEdit() &&
          !!state.selectedAvailableId &&
          emptySlotCount === 1;
        const levelClickModeActive = levelClickable;

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
            if (!referenceView && state.userBlockNames && typeof state.userBlockNames === "object" && state.userBlockNames[slotId] == null) {
              state.userBlockNames[slotId] = "";
            }

            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = "Название элемента...";
            input.value =
              blockNamesSource && typeof blockNamesSource === "object"
                ? String(blockNamesSource[slotId] || "")
                : "";

            const baseInput =
              "h-14 flex-1 min-w-[220px] rounded-lg px-3 py-2 text-sm font-medium border bg-surface-1 text-text-main dark:bg-surface-2 dark:text-text-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2 ";
            const showVerdicts = !referenceView && isCheckedState();
            const v = normalizeTextForComparison(input.value);

            if (referenceView) {
              input.className =
                baseInput +
                "border-success-light dark:border-success-dark bg-success-lighter dark:bg-success-light";
            } else if (showVerdicts && v) {
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

            input.disabled = referenceView || !canEdit();
            input.readOnly = referenceView;
            input.addEventListener("input", () => {
              if (referenceView) return;
              if (!state.userBlockNames || typeof state.userBlockNames !== "object") return;
              state.userBlockNames[slotId] = input.value;
              ensureModeByPlacements();
            });

            slotsWrap.appendChild(input);
            continue;
          }

          if (placedId) {
            const el = getElementById(placedId);
            const label =
              (blockNamesSource && typeof blockNamesSource === "object" && blockNamesSource[placedId]) ||
              (el ? el.text : placedId);

            const verdict = referenceView ? "correct" : getSlotVerdict(lvl.level_id, i, placedId);

            const btn = document.createElement("button");
            btn.type = "button";
            btn.setAttribute("aria-label", `Убрать элемент: ${label}`);

            const basePlaced =
              "h-14 flex-1 min-w-[180px] rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2 relative overflow-hidden ";

            if (verdict === "correct") {
              btn.className =
                basePlaced +
                "bg-success-lighter dark:bg-success-light border border-success-light dark:border-success-dark text-black dark:text-text-on-dark cursor-default";
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
              btn.className += " cursor-default";
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
                  placeSelectedIntoLevel(idx, i);
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

        if (userCreatesLevels && !referenceView) {
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

    clearBtn.addEventListener("click", () => {
      clearAllPlacements();
    });

    userViewBtn.addEventListener("click", () => {
      if (getCurrentComparisonView() === "user") return;
      state.selectedAvailableId = null;
      state.comparisonView = "user";
      renderAll({ preserveScroll: true });
    });

    referenceViewBtn.addEventListener("click", () => {
      if (!hasReferenceLevelsData() || !isCheckedState()) return;
      if (getCurrentComparisonView() === "reference") return;
      state.selectedAvailableId = null;
      state.comparisonView = "reference";
      renderAll({ preserveScroll: true });
    });

    function renderToolbar() {
      const referenceView = isReferenceView();
      const canShowAddLevel = userCreatesLevels && canEdit();
      const canShowClear =
        !referenceView &&
        state.mode !== "checked_failed_editable" &&
        canEdit() &&
        hasClearableContent();
      const canShowComparison = hasReferenceLevelsData() && isCheckedState();
      const activeView = getCurrentComparisonView();

      root.dataset.sequenceuiComparisonView = activeView;

      if (canShowAddLevel) {
        addLevelBtn.classList.remove("hidden");
        addLevelBtn.classList.add("inline-flex");
      } else {
        addLevelBtn.classList.add("hidden");
        addLevelBtn.classList.remove("inline-flex");
      }

      if (canShowClear) {
        clearBtn.classList.remove("hidden");
        clearBtn.classList.add("inline-flex");
      } else {
        clearBtn.classList.add("hidden");
        clearBtn.classList.remove("inline-flex");
      }

      if (canShowComparison) {
        comparisonToolbar.classList.remove("hidden");
        comparisonToolbar.classList.add("flex");
      } else {
        comparisonToolbar.classList.add("hidden");
        comparisonToolbar.classList.remove("flex");
      }

      userViewBtn.className =
        "px-3 py-1.5 text-xs font-bold transition-colors " +
        (activeView === "user"
          ? "bg-primary text-primary-fg"
          : "bg-surface-1 text-text-main hover:bg-bg-hover dark:bg-surface-1 dark:text-text-on-dark dark:hover:bg-bg-hover");
      referenceViewBtn.className =
        "px-3 py-1.5 text-xs font-bold transition-colors " +
        (activeView === "reference"
          ? "bg-primary text-primary-fg"
          : "bg-surface-1 text-text-main hover:bg-bg-hover dark:bg-surface-1 dark:text-text-on-dark dark:hover:bg-bg-hover");

      userViewBtn.disabled = activeView === "user";
      referenceViewBtn.disabled = activeView === "reference";

      comparisonStatus.textContent =
        activeView === "reference"
          ? "Показан эталонный вариант."
          : "Показан ваш ответ с отметками проверки.";
    }

    function refreshScrollablePanels() {
      try {
        const availableOverflow = availableList.scrollHeight > (availableList.clientHeight + 2);
        const levelsOverflow = levelsContainer.scrollHeight > (levelsContainer.clientHeight + 2);
        availableCard.dataset.sequenceuiOverflow = availableOverflow ? "true" : "false";
        levelsCard.dataset.sequenceuiOverflow = levelsOverflow ? "true" : "false";
      } catch (e) {
        // Defensive: sizing should never break UI
      }
    }

    function getScrollPositions() {
      return {
        availableTop: availableList.scrollTop,
        levelsTop: levelsContainer.scrollTop,
      };
    }

    function restoreScrollPositions(positions) {
      if (!positions) return;
      availableList.scrollTop = positions.availableTop || 0;
      levelsContainer.scrollTop = positions.levelsTop || 0;
    }

    function buildAvailableFromPlacements(placements) {
      const remaining = initialAvailable.slice();
      if (!Array.isArray(placements)) return remaining;

      placements.forEach((placement) => {
        const blocks = placement && Array.isArray(placement.blocks) ? placement.blocks : [];
        blocks.forEach((rawBlockId) => {
          if (rawBlockId == null) return;
          const blockId = String(rawBlockId);
          const remainingIndex = remaining.findIndex((candidateId) => candidateId === blockId);
          if (remainingIndex >= 0) {
            remaining.splice(remainingIndex, 1);
          }
        });
      });

      return remaining;
    }

    function cloneOriginalLevel(level) {
      return {
        level_id: String(level.level_id),
        label: safeText(level.label),
        slots: Array.isArray(level.slots) ? level.slots.slice() : [],
      };
    }

    function restoreFixedLevels(draftLevels) {
      const originalLevelById = new Map(
        originalLevels.map((level) => [String(level.level_id), cloneOriginalLevel(level)])
      );
      const restoredLevels = [];
      const restoredPlacements = [];
      const seenLevelIds = new Set();

      (Array.isArray(draftLevels) ? draftLevels : []).forEach((draftLevel) => {
        if (!draftLevel || typeof draftLevel !== "object") return;
        const levelId = safeText(draftLevel.level_id || draftLevel.levelId || draftLevel.id);
        if (!levelId || seenLevelIds.has(levelId) || !originalLevelById.has(levelId)) return;

        seenLevelIds.add(levelId);
        const baseLevel = cloneOriginalLevel(originalLevelById.get(levelId));
        const draftBlocks = Array.isArray(draftLevel.blocks) ? draftLevel.blocks : [];
        const restoredBlocks = Array.from({ length: baseLevel.slots.length }, (_, slotIndex) => {
          const blockId = draftBlocks[slotIndex];
          return blockId != null ? String(blockId) : null;
        });

        restoredLevels.push(baseLevel);
        restoredPlacements.push({
          level_id: baseLevel.level_id,
          blocks: restoredBlocks,
        });
      });

      originalLevels.forEach((level) => {
        if (seenLevelIds.has(String(level.level_id))) return;
        const baseLevel = cloneOriginalLevel(level);
        restoredLevels.push(baseLevel);
        restoredPlacements.push({
          level_id: baseLevel.level_id,
          blocks: Array.from({ length: baseLevel.slots.length }, () => null),
        });
      });

      state.data.levels = restoredLevels;
      state.placements = restoredPlacements;
      state.userBlockNames = {};
    }

    function restoreUserCreatedLevels(draftLevels) {
      const restoredLevels = [];
      const restoredPlacements = [];
      const restoredBlockNames = {};

      (Array.isArray(draftLevels) ? draftLevels : []).forEach((draftLevel, levelIndex) => {
        if (!draftLevel || typeof draftLevel !== "object") return;

        const fallbackLevelId = `user_level_restored_${Date.now()}_${levelIndex + 1}`;
        const levelId = safeText(draftLevel.level_id || draftLevel.levelId || draftLevel.id) || fallbackLevelId;
        const levelLabel = safeText(draftLevel.level_name || draftLevel.label || draftLevel.name);
        const sourceBlockNames =
          draftLevel.block_names && typeof draftLevel.block_names === "object"
            ? draftLevel.block_names
            : {};

        let restoredBlocks = (Array.isArray(draftLevel.blocks) ? draftLevel.blocks : [])
          .filter((blockId) => blockId != null)
          .map((blockId) => String(blockId));

        if (restoredBlocks.length === 0) {
          if (requiresBlockNames || difficulty === 3) {
            restoredBlocks = [`user_slot_${levelId}_restored_1`];
          } else {
            restoredBlocks = [null];
          }
        }

        restoredLevels.push({
          level_id: levelId,
          label: levelLabel,
          slots: restoredBlocks.map((_, slotIndex) => `slot_${slotIndex + 1}`),
        });
        restoredPlacements.push({
          level_id: levelId,
          blocks: restoredBlocks.slice(),
        });

        if (requiresBlockNames || difficulty === 3) {
          restoredBlocks.forEach((blockId) => {
            if (!blockId) return;
            restoredBlockNames[String(blockId)] = safeText(sourceBlockNames[String(blockId)] || "");
          });
        }
      });

      state.data.levels = restoredLevels;
      state.placements = restoredPlacements;
      state.userBlockNames = restoredBlockNames;
      userLevelCounter = restoredLevels.length;
    }

    function restoreInput(draft) {
      try {
        if (!draft || typeof draft !== "object") return;

        const draftLevels = Array.isArray(draft.levels) ? draft.levels : [];
        state.selectedAvailableId = null;

        if (userCreatesLevels) {
          restoreUserCreatedLevels(draftLevels);
        } else {
          restoreFixedLevels(draftLevels);
        }

        state.available = buildAvailableFromPlacements(state.placements);

        const preserveCheckedMode =
          state.mode === "checked_success" ||
          state.mode === "checked_failed_editable" ||
          state.mode === "final_review";

        if (!preserveCheckedMode) {
          state.locked = false;
          state.comparisonView = "user";
          ensureModeByPlacements();
        }

        renderAll({ preserveScroll: true });
      } catch (e) {
        console.warn("[SequenceUI] restoreInput error:", e);
      }
    }

    function renderAll(options = {}) {
      const preserveScroll = options.preserveScroll !== false;
      const scrollPositions = preserveScroll ? getScrollPositions() : null;

      renderToolbar();
      renderAvailable();
      renderLevels();
      restoreScrollPositions(scrollPositions);
      // Let DOM settle, then measure.
      requestAnimationFrame(refreshScrollablePanels);
    }

    function syncAvailableSidebarStickyMode() {
      const isDesktopViewport =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function"
          ? window.matchMedia("(min-width: 1024px)").matches
          : (typeof window !== "undefined" ? window.innerWidth >= 1024 : true);

      if (isDesktopViewport && !sidebar.classList.contains("hidden")) {
        sidebar.style.position = "sticky";
        sidebar.style.top = "6rem";
        sidebar.style.alignSelf = "start";
        sidebar.style.height = "fit-content";
      } else {
        sidebar.style.position = "";
        sidebar.style.top = "";
        sidebar.style.alignSelf = "";
        sidebar.style.height = "";
      }
    }

    maybeShuffleLevelsOnInit();
    ensureModeByPlacements();
    renderAll();
    containerElement.appendChild(root);
    syncAvailableSidebarStickyMode();

    const onResize = () => {
      syncAvailableSidebarStickyMode();
      requestAnimationFrame(refreshScrollablePanels);
    };
    window.addEventListener("resize", onResize);

    return {
      getUserAnswerPayload() {
        if (!userCreatesLevels) {
          return {
            levels: state.placements.map((l) => ({
              level_id: l.level_id,
              blocks: Array.isArray(l.blocks)
                ? (l.blocks.some((blockId) => blockId != null) ? l.blocks.slice() : [])
                : [],
            })),
          };
        }

        const levelsPayload = state.placements
          .map((l, idx) => {
            let blocks = getMeaningfulBlockIdsForPlacement(l);
            const lvl = state.data.levels[idx];
            const level_name = lvl && typeof lvl === "object" ? (lvl.label || "") : "";

            if (requiresBlockNames || difficulty === 3) {
              const block_names = {};
              blocks.forEach((id) => {
                const name = state.userBlockNames && typeof state.userBlockNames === "object" ? String(state.userBlockNames[id] || "") : "";
                if (!name.trim()) return;
                block_names[String(id)] = name;
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
          .filter((l) => difficulty === 2 || (Array.isArray(l.blocks) && l.blocks.length > 0));

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
      getViewState() {
        const scrollPositions = getScrollPositions();
        return {
          mode: state.mode,
          comparison_view: getCurrentComparisonView(),
          selected_available_id:
            state.selectedAvailableId != null ? String(state.selectedAvailableId) : null,
          scroll_positions: scrollPositions,
        };
      },
      validateBeforeSubmit,
      moveLevelUp,
      moveLevelDown,
      restoreInput,
      restoreViewState(viewState) {
        if (!viewState || typeof viewState !== "object") return;

        const nextSelectedId =
          viewState.selected_available_id == null
            ? null
            : String(viewState.selected_available_id);
        if (
          nextSelectedId &&
          Array.isArray(state.available) &&
          state.available.includes(nextSelectedId)
        ) {
          state.selectedAvailableId = nextSelectedId;
        } else if (!nextSelectedId) {
          state.selectedAvailableId = null;
        }

        if (
          typeof viewState.mode === "string" &&
          (viewState.mode === "initial" ||
            viewState.mode === "in_progress" ||
            viewState.mode === "checked_success" ||
            viewState.mode === "checked_failed_editable" ||
            viewState.mode === "final_review")
        ) {
          state.mode = viewState.mode;
        }

        state.comparisonView =
          viewState.comparison_view === "reference" && isCheckedState() && hasReferenceLevelsData()
            ? "reference"
            : "user";

        renderAll({ preserveScroll: false });

        const scrollPositions =
          viewState.scroll_positions && typeof viewState.scroll_positions === "object"
            ? viewState.scroll_positions
            : null;
        restoreScrollPositions(scrollPositions);
        requestAnimationFrame(refreshScrollablePanels);
      },
      applyCheckFeedback(result) {
        const success = result && result.success === true;

        state.lastCheckDetails = extractCheckDetails(result);
        state.lastRawResultDetails = (result && result.details && typeof result.details === "object") ? result.details : null;
        state.comparisonView = "user";

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
              if (requiresBlockNames || difficulty === 3) {
                levelsHint.appendChild(document.createTextNode("Введите названия элементов и уровней."));
              } else {
                levelsHint.appendChild(
                  document.createTextNode("Выберите элемент справа, затем кликните на пустой слот для размещения.")
                );
              }
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
      cleanup() {
        window.removeEventListener("resize", onResize);
      },
    };
  }

  return {
    __testHooks: {
      normalizeTaskData,
      resolveCheckedCorrectBlocksByLevel,
    },
    render(containerElement, task) {
      if (currentInstance && typeof currentInstance.cleanup === "function") {
        currentInstance.cleanup();
      }
      currentInstance = createRoot(containerElement, task);
    },
    getUserAnswerPayload() {
      if (currentInstance && typeof currentInstance.getUserAnswerPayload === "function") {
        return currentInstance.getUserAnswerPayload();
      }
      return { levels: [] };
    },
    getViewState() {
      if (currentInstance && typeof currentInstance.getViewState === "function") {
        return currentInstance.getViewState();
      }
      return null;
    },
    validateBeforeSubmit() {
      if (currentInstance && typeof currentInstance.validateBeforeSubmit === "function") {
        return currentInstance.validateBeforeSubmit();
      }
      return { valid: true };
    },
    applyCheckFeedback(result) {
      if (currentInstance && typeof currentInstance.applyCheckFeedback === "function") {
        currentInstance.applyCheckFeedback(result);
      }
    },
    restoreInput(draft) {
      if (currentInstance && typeof currentInstance.restoreInput === "function") {
        currentInstance.restoreInput(draft);
      }
    },
    restoreViewState(viewState) {
      if (currentInstance && typeof currentInstance.restoreViewState === "function") {
        currentInstance.restoreViewState(viewState);
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
      if (currentInstance && typeof currentInstance.cleanup === "function") {
        currentInstance.cleanup();
      }
      currentInstance = null;
    }
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = SequenceUI;
}


