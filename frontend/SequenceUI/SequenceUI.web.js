const SequenceUI = (function () {
  let currentInstance = null;

  function wt(key, fallback) {
    if (!window.i18n || typeof window.i18n.t !== "function") return fallback;
    const v = window.i18n.t(key);
    return v !== key ? v : fallback;
  }

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

  // ---------------------------------------------------------------------------
  // Hierarchy / Classification mode: pure helpers (no DOM access).
  // ---------------------------------------------------------------------------
  const HIERARCHY_TINT_COUNT = 6;
  const HIERARCHY_COL_COUNT = 6;
  const HIERARCHY_MIN_ZOOM = 0.6;
  const HIERARCHY_MAX_ZOOM = 1.4;

  const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  function toRoman(num) {
    if (num >= 1 && num <= ROMAN_NUMERALS.length) return ROMAN_NUMERALS[num - 1];
    return String(num);
  }

  function normalizeHierarchyNodes(rawNodes) {
    const list = Array.isArray(rawNodes) ? rawNodes : [];
    const seen = new Set();
    const result = [];
    list.forEach((raw, idx) => {
      if (!raw || typeof raw !== "object") return;
      const nodeId = safeText(raw.node_id || raw.nodeId || raw.id) || `node_${idx + 1}`;
      if (seen.has(nodeId)) return;
      seen.add(nodeId);
      const rawSlots = Array.isArray(raw.slots)
        ? raw.slots
        : Array.isArray(raw.blocks)
          ? raw.blocks
          : [];
      const parentRaw = raw.parent_id != null ? raw.parent_id : raw.parentId;
      const colTitleRaw = raw.column_title != null ? raw.column_title : raw.columnTitle;
      result.push({
        node_id: nodeId,
        level_id: safeText(raw.level_id != null ? raw.level_id : raw.levelId),
        parent_id: parentRaw != null && String(parentRaw) !== "" ? String(parentRaw) : null,
        slotCount: Math.max(1, rawSlots.length),
        correctIds: rawSlots.filter((id) => id != null).map((id) => String(id)),
        columnTitle: colTitleRaw != null ? safeText(colTitleRaw).trim() : "",
      });
    });
    return result;
  }

  // Deterministic tree layout: every parent sits above the centre of its children span,
  // every tier lies on its own grid row. Mirrors the editor layout engine.
  function computeHierarchyGridLayout(nodes, tierIds) {
    const tierIndexById = new Map((tierIds || []).map((id, idx) => [String(id), idx]));
    const nodeById = new Map(nodes.map((n) => [n.node_id, n]));
    const children = new Map();
    const roots = [];
    nodes.forEach((n) => {
      if (n.parent_id && n.parent_id !== n.node_id && nodeById.has(n.parent_id)) {
        if (!children.has(n.parent_id)) children.set(n.parent_id, []);
        children.get(n.parent_id).push(n);
      } else {
        roots.push(n);
      }
    });

    const spanById = new Map();
    const computeSpan = (node, trail) => {
      if (spanById.has(node.node_id)) return spanById.get(node.node_id);
      if (trail.has(node.node_id)) return 1;
      const nextTrail = new Set(trail);
      nextTrail.add(node.node_id);
      const kids = children.get(node.node_id) || [];
      let span = 0;
      kids.forEach((kid) => {
        span += computeSpan(kid, nextTrail);
      });
      span = Math.max(1, span);
      spanById.set(node.node_id, span);
      return span;
    };
    nodes.forEach((n) => computeSpan(n, new Set()));

    const colStartById = new Map();
    const assign = (node, colStart, trail) => {
      if (trail.has(node.node_id)) return;
      const nextTrail = new Set(trail);
      nextTrail.add(node.node_id);
      colStartById.set(node.node_id, colStart);
      let cursor = colStart;
      (children.get(node.node_id) || []).forEach((kid) => {
        assign(kid, cursor, nextTrail);
        cursor += spanById.get(kid.node_id) || 1;
      });
    };
    let nextCol = 1;
    roots.forEach((root) => {
      assign(root, nextCol, new Set());
      nextCol += spanById.get(root.node_id) || 1;
    });

    const rootIdxByNodeId = new Map();
    const rootNodeByNodeId = new Map();
    const traceRoot = (node, rootIndex, rootNode, trail) => {
      if (trail.has(node.node_id)) return;
      const nextTrail = new Set(trail);
      nextTrail.add(node.node_id);
      rootIdxByNodeId.set(node.node_id, rootIndex);
      rootNodeByNodeId.set(node.node_id, rootNode);
      (children.get(node.node_id) || []).forEach((kid) => {
        traceRoot(kid, rootIndex, rootNode, nextTrail);
      });
    };
    roots.forEach((root, rIdx) => {
      traceRoot(root, rIdx, root, new Set());
    });

    const placementByNodeId = new Map();
    nodes.forEach((n) => {
      placementByNodeId.set(n.node_id, {
        node: n,
        tierIdx: tierIndexById.has(String(n.level_id)) ? tierIndexById.get(String(n.level_id)) : 0,
        colStart: colStartById.get(n.node_id) || 1,
        colSpan: spanById.get(n.node_id) || 1,
        hasChildren: (children.get(n.node_id) || []).length > 0,
        rootIdx: rootIdxByNodeId.has(n.node_id) ? rootIdxByNodeId.get(n.node_id) : 0,
        rootNode: rootNodeByNodeId.get(n.node_id) || n,
      });
    });

    const hasColumnHeaders = roots.some((r) => !!r.columnTitle) || roots.length > 1;

    return {
      totalCols: Math.max(1, nextCol - 1),
      byNodeId: placementByNodeId,
      children,
      roots,
      hasColumnHeaders,
    };
  }

  function buildRoundedElbowPath(px, py, cx, cy, radius = 8) {
    if (Math.abs(cx - px) < 1) {
      return `M ${px} ${py} L ${cx} ${cy}`;
    }
    const midY = py + (cy - py) / 2;
    const dir = cx > px ? 1 : -1;
    const r = Math.max(0, Math.min(radius, Math.abs(cx - px) / 2, Math.abs(cy - py) / 4));
    return (
      `M ${px} ${py} L ${px} ${midY - r} Q ${px} ${midY} ${px + dir * r} ${midY} ` +
      `L ${cx - dir * r} ${midY} Q ${cx} ${midY} ${cx} ${midY + r} L ${cx} ${cy}`
    );
  }

  function clampHierarchyZoom(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 1;
    return Math.max(HIERARCHY_MIN_ZOOM, Math.min(HIERARCHY_MAX_ZOOM, Math.round(num * 100) / 100));
  }

  let activeHierarchySlotPopover = null;
  function showHierarchySlotPopover(anchorEl, contentText) {
    hideHierarchySlotPopover();
    if (!contentText || typeof document === "undefined") return;
    const popover = document.createElement("div");
    popover.className = "seqh-slot-popover";
    popover.textContent = contentText;
    document.body.appendChild(popover);
    const rect = anchorEl.getBoundingClientRect();
    const popoverW = Math.min(320, (typeof window !== "undefined" ? window.innerWidth : 1024) - 32);
    let left = rect.left + rect.width / 2 - popoverW / 2;
    left = Math.max(16, Math.min((typeof window !== "undefined" ? window.innerWidth : 1024) - popoverW - 16, left));
    let top = rect.bottom + 8;
    if (typeof window !== "undefined" && top + 100 > window.innerHeight && rect.top > 120) {
      top = rect.top - 8 - (popover.offsetHeight || 60);
    }
    popover.style.width = `${popoverW}px`;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => popover.classList.add("is-visible"));
    } else {
      popover.classList.add("is-visible");
    }
    activeHierarchySlotPopover = popover;
  }

  function hideHierarchySlotPopover() {
    if (activeHierarchySlotPopover) {
      if (activeHierarchySlotPopover.parentNode) {
        activeHierarchySlotPopover.parentNode.removeChild(activeHierarchySlotPopover);
      }
      activeHierarchySlotPopover = null;
    }
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
      safeText(td.prompt) ||
      safeText(src.description) ||
      safeText(td.description) ||
      safeText(task && task.prompt) ||
      "";

    const elementsRaw = (Array.isArray(src.elements) && src.elements.length > 0)
      ? src.elements
      : (Array.isArray(td.elements) && td.elements.length > 0)
        ? td.elements
        : (Array.isArray(task && task.elements) ? task.elements : (Array.isArray(src.elements) ? src.elements : []));

    const levelsRaw = (Array.isArray(src.levels) && src.levels.length > 0)
      ? src.levels
      : (Array.isArray(td.levels) && td.levels.length > 0)
        ? td.levels
        : (Array.isArray(task && task.levels) ? task.levels : (Array.isArray(src.levels) ? src.levels : []));

    const settings = {
      ...((task && task.settings && typeof task.settings === "object") ? task.settings : {}),
      ...((td && td.settings && typeof td.settings === "object") ? td.settings : {}),
      ...((src && src.settings && typeof src.settings === "object") ? src.settings : {}),
    };

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

    // Hierarchy / Classification mode detection (independent from linear sequences).
    const hierarchySources = [
      taskData && taskData.content,
      taskData,
      taskDto && taskDto.task_data && taskDto.task_data.content,
      taskDto && taskDto.task_data,
      taskDto && taskDto.answer_key,
      settings,
    ].filter((src) => src && typeof src === "object");
    const pickHierarchyField = (key) => {
      for (const src of hierarchySources) {
        if (src[key] !== undefined && src[key] !== null && src[key] !== "") return src[key];
      }
      return undefined;
    };
    let hierarchyNodes = [];
    for (const src of hierarchySources) {
      const candidate = normalizeHierarchyNodes(src.nodes);
      if (candidate.length > 0) {
        hierarchyNodes = candidate;
        break;
      }
    }
    const displayModeRaw = safeText(pickHierarchyField("display_mode")).trim().toLowerCase();
    const isHierarchy =
      displayModeRaw === "hierarchy" &&
      hierarchyNodes.length > 0 &&
      normalizedData.levels.length > 0;
    const colorDifferentiation = isHierarchy && pickHierarchyField("color_differentiation") !== false;
    // In hierarchy mode the skeleton (nodes) is fixed: the learner never creates levels or slots.
    const userCreatesLevels = !isHierarchy && (difficulty >= 2 || requiresLevelNames);
    // Difficulty 2 (hierarchy): tier names are typed by the learner into the left column.
    const hierarchyTierNamesTyped =
      isHierarchy && (difficulty === 2 || (requiresLevelNames && difficulty < 3));

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

    const canonicalOrderMap = new Map();
    initialAvailable.forEach((id, idx) => {
      if (!canonicalOrderMap.has(id)) {
        canonicalOrderMap.set(id, idx);
      }
    });

    function restoreAvailableItem(elemId) {
      if (elemId == null) return;
      const targetOrder = canonicalOrderMap.has(elemId) ? canonicalOrderMap.get(elemId) : 999;
      let insertAt = state.available.findIndex((id) => {
        const o = canonicalOrderMap.has(id) ? canonicalOrderMap.get(id) : 999;
        return o > targetOrder;
      });
      if (insertAt < 0) {
        insertAt = state.available.length;
      }
      state.available.splice(insertAt, 0, elemId);
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

    // ---- Hierarchy state (nodes become the placement units; tiers stay in data.levels) ----
    const hierarchyBlind = isHierarchy && (requiresBlockNames || difficulty === 3);
    const hierarchyNodeById = new Map(hierarchyNodes.map((node) => [node.node_id, node]));
    const hierarchyLayout = isHierarchy
      ? computeHierarchyGridLayout(hierarchyNodes, data.levels.map((lvl) => lvl.level_id))
      : null;
    const hierarchyElementTierById = new Map();
    if (isHierarchy && !hierarchyBlind) {
      const knownElementIds = new Set(data.elements.map((el) => String(el.id)));
      hierarchyNodes.forEach((node) => {
        node.correctIds.forEach((id) => {
          if (knownElementIds.has(id) && !hierarchyElementTierById.has(id)) {
            hierarchyElementTierById.set(id, String(node.level_id));
          }
        });
      });
    }
    const hierarchyState = {
      zoom: 1,
      fitted: false,
      minimapVisible: hierarchyNodes.length > 12,
      activeTab: 0,
      prevTabCounts: null,
      scrollLeft: 0,
      scrollTop: 0,
      hintTimer: null,
      autoScrollVec: { x: 0, y: 0 },
      autoScrollRaf: 0,
      heightAnimRaf: null,
    };

    function getHierarchySlotId(node, slotIndex) {
      return `hn_${node.node_id}_${slotIndex + 1}`;
    }

    function buildInitialHierarchyPlacements() {
      return hierarchyNodes.map((node) => ({
        node_id: node.node_id,
        level_id: node.level_id,
        blocks: Array.from({ length: node.slotCount }, (_, slotIndex) =>
          hierarchyBlind ? getHierarchySlotId(node, slotIndex) : null
        ),
      }));
    }

    if (isHierarchy) {
      state.placements = buildInitialHierarchyPlacements();
      if (hierarchyBlind) {
        state.placements.forEach((placement) => {
          placement.blocks.forEach((slotId) => {
            state.userBlockNames[slotId] = "";
          });
        });
      }
      if (hierarchyTierNamesTyped) {
        // Tier names are hidden and must be typed by the learner (difficulty 2).
        state.data.levels = state.data.levels.map((lvl) => ({ ...lvl, label: "" }));
      }
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
      ".sequenceui-scrollbar::-webkit-scrollbar{width:8px;height:8px;}" +
      ".sequenceui-scrollbar::-webkit-scrollbar-track{background:color-mix(in srgb,var(--color-surface-2,#f3f4f6) 70%,transparent);border-radius:4px;}" +
      ".dark .sequenceui-scrollbar::-webkit-scrollbar-track{background:rgba(255,255,255,0.05);}" +
      ".sequenceui-scrollbar::-webkit-scrollbar-thumb{background-color:color-mix(in srgb,var(--color-border-strong,#9ca3af) 80%,transparent);border-radius:4px;border:1px solid transparent;background-clip:content-box;}" +
      ".sequenceui-scrollbar::-webkit-scrollbar-thumb:hover{background-color:var(--color-text-secondary,#4b5563);}" +
      ".sequenceui-scrollbar{scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--color-border-strong,#9ca3af) 80%,transparent) transparent;}" +
      ".dark .sequenceui-scrollbar{scrollbar-color:rgba(156,163,175,0.5) rgba(255,255,255,0.05);} " +
      ".seq-level-entry,.seq-element-entry{transform:translateZ(0);backface-visibility:hidden;}" +
      ".seq-level-entry[data-reordering='true']{will-change:transform;}" +
      ".seq-available-item{transition:transform 140ms cubic-bezier(0.16,1,0.3,1),box-shadow 140ms ease,border-color 140ms ease,background-color 140ms ease;cursor:grab;touch-action:manipulation;overflow-wrap:anywhere!important;word-break:break-word!important;}" +
      ".seq-available-item:active:not(:disabled){transform:scale(0.97)!important;cursor:grabbing;}" +
      ".seq-available-item:disabled{cursor:default;}" +
      ".seq-placed-item,.seq-drag-avatar{overflow-wrap:anywhere!important;word-break:break-word!important;}" +
      ".seq-slot-target{transition:border-color 150ms ease,box-shadow 150ms ease,background-color 150ms ease,transform 150ms cubic-bezier(0.16,1,0.3,1);touch-action:manipulation;}" +
      ".seq-slot-target.seq-slot-hover{border-style:dashed!important;border-width:2px!important;border-color:var(--color-primary,#6366f1)!important;background-color:color-mix(in srgb,var(--color-primary,#6366f1) 8%,transparent)!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--color-primary,#6366f1) 18%,transparent)!important;transform:scale(1.02);}" +
      ".seq-element-entry{transition:transform 140ms cubic-bezier(0.16,1,0.3,1),box-shadow 140ms ease,border-color 140ms ease;touch-action:manipulation;}" +
      ".seq-element-entry:active:not(:disabled):not([disabled]){transform:scale(0.97)!important;}" +
      ".seq-placed-item{transition:transform 140ms cubic-bezier(0.16,1,0.3,1),box-shadow 140ms ease,border-color 140ms ease,background-color 140ms ease;touch-action:manipulation;}" +
      ".seq-placed-item:not([disabled]):not(:disabled){cursor:grab;}" +
      ".seq-placed-item:active:not([disabled]):not(:disabled){cursor:grabbing;transform:scale(0.97)!important;}" +
      ".seq-placed-item.seq-slot-hover{outline:2px solid var(--color-primary,#6366f1)!important;outline-offset:2px!important;background-color:color-mix(in srgb,var(--color-primary,#6366f1) 12%,transparent)!important;transform:scale(1.02);}" +
      ".seq-drag-avatar{background:var(--color-surface-1,#ffffff)!important;color:var(--color-text-main,#111827)!important;border:1.5px solid color-mix(in srgb,var(--color-primary,#6366f1) 60%,var(--color-border-strong,#d1d5db) 40%)!important;box-shadow:0 14px 28px -4px rgba(15,23,42,0.16),0 6px 14px -2px rgba(15,23,42,0.08),0 0 0 1px color-mix(in srgb,var(--color-primary,#6366f1) 20%,transparent)!important;border-radius:0.5rem!important;transition:box-shadow 140ms ease,border-color 140ms ease;}" +
      ".seq-drag-avatar.seq-avatar-snapping{border-color:var(--color-primary,#6366f1)!important;box-shadow:0 18px 36px -4px rgba(99,102,241,0.38),0 8px 16px -2px rgba(99,102,241,0.22),0 0 0 2px var(--color-primary,#6366f1)!important;}" +
      ".dark .seq-drag-avatar,[data-theme^='dark'] .seq-drag-avatar{background:var(--color-surface-2,#1f2937)!important;color:var(--color-text-on-dark,#f9fafb)!important;border-color:color-mix(in srgb,var(--color-primary-light,#818cf8) 60%,var(--color-border-strong,#374151) 40%)!important;box-shadow:0 18px 32px -4px rgba(0,0,0,0.55),0 8px 16px -4px rgba(0,0,0,0.35),0 0 0 1px color-mix(in srgb,var(--color-primary-light,#818cf8) 25%,transparent)!important;}" +
      ".dark .seq-drag-avatar.seq-avatar-snapping,[data-theme^='dark'] .seq-drag-avatar.seq-avatar-snapping{border-color:var(--color-primary-light,#818cf8)!important;box-shadow:0 20px 38px -4px rgba(129,140,248,0.45),0 10px 18px -2px rgba(129,140,248,0.25),0 0 0 2px var(--color-primary-light,#818cf8)!important;}" +
      "@media (max-height:768px){" +
      ".seq-levels-container{gap:0.375rem!important;margin-top:0.375rem!important;}" +
      ".seq-level-panel{padding:0.45rem 0.625rem!important;}" +
      ".seq-level-header-row{margin-bottom:0.2rem!important;padding-bottom:0.2rem!important;}" +
      ".seq-slot-target,.seq-placed-item{min-height:2.15rem!important;padding-top:0.2rem!important;padding-bottom:0.2rem!important;}" +
      ".seq-level-index{background:color-mix(in srgb,var(--color-surface-1,#ffffff) 94%,white 6%);border:1px solid color-mix(in srgb,var(--color-border-strong,#d1d5db) 74%,var(--color-primary-light,#818cf8) 26%);color:color-mix(in srgb,var(--color-accent-dark,#4338ca) 78%,var(--color-text-main,#111827) 22%);box-shadow:inset 0 1px 0 rgba(255,255,255,0.5);}" +
      ".dark .seq-level-index,[data-theme^='dark'] .seq-level-index{background:color-mix(in srgb,var(--color-surface-1,#1f2937) 74%,white 26%);border-color:color-mix(in srgb,var(--color-primary-light,#818cf8) 54%,white 46%);color:var(--color-text-main,#f9fafb);box-shadow:none;}" +
      ".seq-level-entry{margin-bottom:0.25rem!important;}" +
      ".seq-levels-header{padding:0.45rem 0.75rem!important;margin-bottom:0.25rem!important;}" +
      ".seq-levels-header .text-base{font-size:0.875rem!important;}" +
      "}" +
      "@property --mask-top-size{syntax:'<length>';inherits:false;initial-value:0px;}" +
      "@property --mask-bottom-size{syntax:'<length>';inherits:false;initial-value:0px;}" +
      ".seq-available-list{" +
      "overscroll-behavior:contain;" +
      "--mask-top-size:0px;" +
      "--mask-bottom-size:0px;" +
      "mask-image:linear-gradient(to bottom,transparent 0px,black var(--mask-top-size,0px),black calc(100% - var(--mask-bottom-size,0px)),transparent 100%);" +
      "-webkit-mask-image:linear-gradient(to bottom,transparent 0px,black var(--mask-top-size,0px),black calc(100% - var(--mask-bottom-size,0px)),transparent 100%);" +
      "transition:--mask-top-size 150ms ease,--mask-bottom-size 150ms ease;" +
      "}" +
      "@media (prefers-reduced-motion:reduce){" +
      ".seq-available-item,.seq-slot-target,.seq-element-entry,.seq-level-entry,.seq-drag-avatar,.seq-placed-item{transition:none!important;transform:none!important;}" +
      "}";
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
      "flex min-h-[220px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-surface-1 p-3.5 shadow-xs dark:border-border-subtle dark:bg-surface-1";
    availableCard.dataset.sequenceui = "available-card";
    availableCard.style.maxHeight = isHierarchy ? "clamp(280px, calc(100vh - 15rem), 590px)" : "calc(100vh - 7rem)";

    const availableHeader = document.createElement("div");
    availableHeader.className = "flex items-center justify-between gap-2 pb-2.5 border-b border-border-subtle";

    const availableTitle = document.createElement("div");
    availableTitle.className = "text-sm font-bold text-text-main dark:text-text-on-dark";
    availableTitle.textContent = wt("sequenceui.available_items", "Доступные элементы");

    const availableCount = document.createElement("div");
    availableCount.className =
      "inline-flex items-center justify-center min-w-[1.5rem] px-2 py-0.5 text-xs font-bold tabular-nums text-text-secondary bg-surface-2 border border-border-subtle rounded-full shrink-0 whitespace-nowrap";
    availableCount.dataset.sequenceui = "available-count";

    availableHeader.appendChild(availableTitle);
    availableHeader.appendChild(availableCount);

    const availableHint = document.createElement("div");
    availableHint.className =
      "mt-2 text-xs leading-relaxed text-text-secondary dark:text-text-on-dark" +
      (isHierarchy ? " hidden" : "");
    availableHint.textContent = wt("sequenceui.available_hint", "Перетащите элемент в нужный слот или нажмите на него, а затем на слот.");

    const availableList = document.createElement("div");
    availableList.className = "seq-available-list mt-3 min-h-0 flex-1 overflow-y-auto pr-1 sequenceui-scrollbar overscroll-contain";
    availableList.dataset.sequenceui = "available-list";

    const availableInner = document.createElement("div");
    availableInner.className = "space-y-2 pr-1 pb-10";
    availableList.appendChild(availableInner);

    function updateAvailableScrollMask() {
      if (!availableList) return;
      const scrollTop = availableList.scrollTop;
      const scrollHeight = availableList.scrollHeight;
      const clientHeight = availableList.clientHeight;
      const distFromBottom = Math.max(0, scrollHeight - scrollTop - clientHeight);

      // Top fade: smoothly scales from 0px up to 28px over the first 24px of scroll
      const topSize = scrollHeight > clientHeight ? Math.min(28, Math.max(0, scrollTop * 1.2)) : 0;
      // Bottom fade: smoothly scales from 0px up to 32px over the last 28px before bottom
      const bottomSize = scrollHeight > clientHeight ? Math.min(32, Math.max(0, distFromBottom * 1.2)) : 0;

      availableList.style.setProperty("--mask-top-size", `${Math.round(topSize)}px`);
      availableList.style.setProperty("--mask-bottom-size", `${Math.round(bottomSize)}px`);
    }

    availableList.addEventListener("scroll", updateAvailableScrollMask, { passive: true });
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(updateAvailableScrollMask);
    }
    setTimeout(updateAvailableScrollMask, 120);

    availableCard.appendChild(availableHeader);
    availableCard.appendChild(availableHint);

    // Tier tabs (hierarchy mode only): flat rail on surface-1 (Anti-Matryoshka compliance)
    const availableTabsScroll = document.createElement("div");
    availableTabsScroll.className = "seqh-tabs-scroll hidden";
    const availableTabs = document.createElement("div");
    availableTabs.className = "seqh-tabs hidden";
    availableTabs.setAttribute("role", "tablist");
    availableTabs.dataset.sequenceui = "available-tier-tabs";
    availableTabsScroll.appendChild(availableTabs);
    availableCard.appendChild(availableTabsScroll);

    const availableTabsCaption = document.createElement("div");
    availableTabsCaption.className = "seqh-tab-caption hidden";
    availableTabsCaption.dataset.sequenceui = "available-tier-caption";
    availableCard.appendChild(availableTabsCaption);

    if (isHierarchy) {
      availableHint.classList.add("hidden");
    }
    availableCard.appendChild(availableList);

    availableStickyFrame.appendChild(availableCard);
    sidebar.appendChild(availableStickyFrame);

    const levelsCard = document.createElement("div");
    levelsCard.className =
      "flex min-h-[220px] flex-col gap-3 bg-transparent border-0 shadow-none p-0";
    levelsCard.dataset.sequenceui = "levels-card";

    const levelsHeader = document.createElement("div");
    levelsHeader.className = "seq-levels-header flex items-start justify-between gap-3 p-3.5 rounded-xl border border-border-subtle bg-surface-1 dark:bg-surface-2 shadow-sm";

    const levelsPromptCol = document.createElement("div");
    levelsPromptCol.className = "min-w-0 flex-1";

    const levelsTitle = document.createElement("div");
    levelsTitle.className = "min-w-0 text-base font-bold leading-tight text-text-main dark:text-text-on-dark";
    levelsTitle.textContent = data.prompt || wt("sequenceui.default_prompt", "Расположите элементы по уровням");
    levelsTitle.title = levelsTitle.textContent;
    levelsTitle.dataset.sequenceui = "task-prompt";

    const addLevelBtn = document.createElement("button");
    addLevelBtn.type = "button";
    addLevelBtn.className = "hidden items-center justify-center gap-1.5 px-3 py-1.5 border border-border-strong bg-primary text-primary-fg hover:bg-primary-hover rounded text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2";
    addLevelBtn.setAttribute("aria-label", wt("sequenceui.create_level_btn", "Создать уровень"));
    addLevelBtn.innerHTML = '<span class="material-symbols-outlined text-sm">add</span> ' + wt("sequenceui.create_level_btn", "Создать уровень");

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "hidden items-center justify-center gap-1.5 px-3 py-1.5 border border-border-strong bg-surface-1 text-text-main hover:bg-bg-hover rounded text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:border-border-strong dark:bg-surface-1 dark:text-text-on-dark dark:hover:bg-bg-hover dark:focus-visible:ring-offset-surface-2";
    clearBtn.setAttribute("aria-label", wt("sequenceui.clear_btn", "Сбросить всё"));
    clearBtn.title = wt("sequenceui.clear_btn_tooltip", "Сбросить все заполненные слоты");
    clearBtn.dataset.sequenceui = "clear-button";
    clearBtn.innerHTML = '<span class="material-symbols-outlined text-sm">restart_alt</span> ' + wt("sequenceui.clear_btn", "Сбросить всё");

    const levelsActions = document.createElement("div");
    levelsActions.className = "flex flex-wrap items-center justify-end gap-2";
    levelsActions.appendChild(clearBtn);
    levelsActions.appendChild(addLevelBtn);

    const levelsHint = document.createElement("div");
    levelsHint.className = "mt-1.5 text-xs leading-relaxed text-text-secondary dark:text-text-on-dark";
    levelsHint.textContent = wt("sequenceui.levels_hint_d1", "Распределите элементы по уровням с помощью перетаскивания или кликов. Для возврата элемента нажмите на него в слоте или перетащите обратно в список.");
    if (requiresBlockNames || difficulty === 3) {
      levelsHint.textContent = wt("sequenceui.levels_hint_d3", "Прочитайте формулировку выше, добавляйте слоты и вводите названия элементов прямо в нужные уровни.");
    }
    if (sequenceWithinLevelMatters) {
      levelsHint.appendChild(document.createTextNode(" "));
      const strong = document.createElement("strong");
      strong.className = "font-bold text-text-main dark:text-text-on-dark";
      strong.textContent = wt("sequenceui.order_within_matters", "Порядок элементов внутри уровня важен.");
      levelsHint.appendChild(strong);
    }

    if (difficulty === 1 && levelOrderMatters) {
      levelsHint.appendChild(document.createTextNode(" "));
      const strong = document.createElement("strong");
      strong.className = "font-bold text-text-main dark:text-text-on-dark";
      strong.textContent = wt("sequenceui.order_levels_matters", "Порядок уровней тоже важен.");
      levelsHint.appendChild(strong);
    }

    if (isHierarchy) {
      levelsHint.textContent = hierarchyBlind
        ? wt("seq.hierarchy_hint_d3", "Восстановите схему по памяти: уровни подписаны, впишите названия в узлы и группы.")
        : hierarchyTierNamesTyped
          ? wt("seq.hierarchy_hint_d2", "Введите названия уровней слева и распределите карточки по узлам схемы.")
          : wt("seq.hierarchy_hint_d1", "Выберите уровень справа и разместите карточки в узлах схемы.");
      if (sequenceWithinLevelMatters) {
        levelsHint.appendChild(document.createTextNode(" "));
        const hierarchyOrderNote = document.createElement("strong");
        hierarchyOrderNote.className = "font-bold text-text-main dark:text-text-on-dark";
        hierarchyOrderNote.textContent = wt("sequenceui.order_within_matters", "Порядок элементов внутри уровня важен.");
        levelsHint.appendChild(hierarchyOrderNote);
      }
    }

    levelsPromptCol.appendChild(levelsTitle);
    levelsPromptCol.appendChild(levelsHint);

    levelsHeader.appendChild(levelsPromptCol);
    levelsHeader.appendChild(levelsActions);

    const comparisonToolbar = document.createElement("div");
    comparisonToolbar.className = isHierarchy
      ? "seqh-toolbar__comparison hidden items-center gap-3"
      : "mt-3 hidden flex-wrap items-center justify-between gap-3";
    comparisonToolbar.dataset.sequenceui = "comparison-toolbar";

    const comparisonStatus = document.createElement("div");
    comparisonStatus.className = "text-xs font-semibold text-text-secondary dark:text-text-on-dark flex items-center gap-1.5";
    comparisonStatus.dataset.sequenceui = "comparison-status";

    const comparisonToggle = document.createElement("div");
    comparisonToggle.className = "inline-flex p-0.5 rounded-lg border border-border-subtle bg-surface-2 gap-0.5";

    const userViewBtn = document.createElement("button");
    userViewBtn.type = "button";
    userViewBtn.dataset.sequenceui = "comparison-view-user";
    userViewBtn.textContent = wt("sequenceui.my_answer_btn", "Мой ответ");

    const referenceViewBtn = document.createElement("button");
    referenceViewBtn.type = "button";
    referenceViewBtn.dataset.sequenceui = "comparison-view-reference";
    referenceViewBtn.textContent = wt("sequenceui.reference_badge", "Эталон");

    comparisonToggle.appendChild(userViewBtn);
    comparisonToggle.appendChild(referenceViewBtn);
    comparisonToolbar.appendChild(comparisonStatus);
    comparisonToolbar.appendChild(comparisonToggle);

    const levelsContainer = document.createElement("div");
    levelsContainer.className = "seq-levels-container flex flex-col gap-4";
    levelsContainer.dataset.sequenceui = "levels-list";
    if (!isHierarchy) {
      levelsContainer.classList.add("mt-3");
    }

    if (isHierarchy) {
      const promptSection = document.createElement("div");
      promptSection.className = "seq-prompt-section flex flex-col gap-2 mb-2";
      promptSection.appendChild(levelsHeader);
      // NOTE: comparisonToolbar is mounted into seqh-toolbar directly to eliminate CLS and save vertical space

      levelsCard.appendChild(levelsContainer);
      main.appendChild(levelsCard);

      layout.appendChild(main);
      layout.appendChild(sidebar);

      root.appendChild(promptSection);
      root.appendChild(layout);
    } else {
      levelsCard.appendChild(levelsHeader);
      levelsCard.appendChild(comparisonToolbar);
      levelsCard.appendChild(levelsContainer);
      main.appendChild(levelsCard);

      layout.appendChild(main);
      layout.appendChild(sidebar);

      root.appendChild(layout);
    }

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
      if (isHierarchy) {
        const hierarchyDetails = state.lastRawResultDetails;
        return !!(
          hierarchyDetails &&
          typeof hierarchyDetails === "object" &&
          Array.isArray(hierarchyDetails.correct_nodes_data) &&
          hierarchyDetails.correct_nodes_data.length > 0
        );
      }
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
      if (isHierarchy) {
        return buildHierarchyReferenceModel();
      }
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
      const missingLevel = isHierarchy ? findFirstMissingHierarchyTierName() : findFirstMissingLevelName();
      if (missingLevel) {
        focusMissingLevelName(missingLevel.levelId);
        return {
          valid: false,
          reason: "missing_level_name",
          message: wt("sequenceui.validation_add_level_name", "Добавьте название уровня перед проверкой"),
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
        toReturn.forEach((id) => {
          restoreAvailableItem(id);
        });
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
      return !isHierarchy && difficulty === 1 && levelOrderMatters && canEdit();
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

    // Последовательность уровней строго определяется сверху вниз (как в редакторе).
    // Порядок уровней не перемешивается при инициализации.
    function maybeShuffleLevelsOnInit() {
      // Intentional no-op: level sequence is strictly top-to-bottom everywhere.
    }

    function setupSequencePointerDrag(triggerEl, getDragConfig) {
      if (!triggerEl || typeof getDragConfig !== "function") return;

      triggerEl.addEventListener("pointerdown", (startEvt) => {
        if (!canEdit() || isReferenceView() || state.locked) return;
        if (startEvt.button !== 0 && startEvt.pointerType === "mouse") return;

        const config = getDragConfig();
        if (!config || !config.labelText) return;

        const startX = startEvt.clientX;
        const startY = startEvt.clientY;
        let isDragging = false;
        let dragAvatar = null;
        let hoveredSlotTarget = null;

        function onPointerMove(moveEvt) {
          const dx = moveEvt.clientX - startX;
          const dy = moveEvt.clientY - startY;

          // Drag threshold (> 4px) to distinguish intentional drag from a simple click
          if (!isDragging && Math.hypot(dx, dy) > 4) {
            isDragging = true;
            if (isHierarchy) {
              applyHierarchyTierFocus(config.elemId);
            }

            dragAvatar = document.createElement("div");
            dragAvatar.className =
              "seq-drag-avatar fixed z-[999999] pointer-events-none select-none flex items-center justify-start rounded-lg px-3 py-2 text-sm";
            dragAvatar.style.maxWidth = "320px";
            dragAvatar.style.boxSizing = "border-box";
            dragAvatar.style.willChange = "transform";
            dragAvatar.style.top = "0px";
            dragAvatar.style.left = "0px";
            if (config.originElement) {
              const origRect = config.originElement.getBoundingClientRect();
              if (origRect.width > 0) {
                dragAvatar.style.width = `${Math.min(360, Math.max(260, Math.round(origRect.width)))}px`;
              }
            }

            const dragAvatarText = document.createElement("div");
            dragAvatarText.className =
              "break-words leading-snug text-text-main dark:text-text-on-dark font-medium text-xs sm:text-sm text-left grow";
            dragAvatarText.textContent = config.labelText;

            dragAvatar.appendChild(dragAvatarText);
            document.body.appendChild(dragAvatar);

            if (config.originElement) {
              config.originElement.style.opacity = "0.3";
              config.originElement.style.transform = "scale(0.96)";
              config.originElement.style.transition = "opacity 120ms ease, transform 120ms ease";
            }
          }

          if (isDragging && dragAvatar) {
            const w = dragAvatar.offsetWidth || 140;
            const h = dragAvatar.offsetHeight || 36;

            if (isHierarchy) {
              updateHierarchyDragAutoScroll(moveEvt.clientX, moveEvt.clientY);
            }
            const targetUnderCursor = document.elementFromPoint(moveEvt.clientX, moveEvt.clientY);
            let slotTarget = targetUnderCursor
              ? targetUnderCursor.closest('[data-sequenceui-slot="true"]') ||
                targetUnderCursor.closest('[data-sequenceui-placed-item="true"]')
              : null;

            if (slotTarget && config.originElement && slotTarget === config.originElement) {
              slotTarget = null;
            }

            if (!slotTarget && targetUnderCursor) {
              const levelPanel = targetUnderCursor.closest("[data-sequenceui-level-id]");
              if (levelPanel) {
                const emptySlot = levelPanel.querySelector('[data-sequenceui-slot="true"]');
                if (emptySlot) {
                  slotTarget = emptySlot;
                }
              }
            }

            if (hoveredSlotTarget && hoveredSlotTarget !== slotTarget) {
              hoveredSlotTarget.classList.remove("seq-slot-hover");
              hoveredSlotTarget = null;
            }
            if (slotTarget && slotTarget !== hoveredSlotTarget) {
              hoveredSlotTarget = slotTarget;
              hoveredSlotTarget.classList.add("seq-slot-hover");
            }

            const isOverTarget = Boolean(slotTarget);
            const avatarScale = isOverTarget ? 0.98 : 1.02;
            const avatarRotate = isOverTarget ? "0deg" : "1deg";
            dragAvatar.style.transform = `translate3d(${moveEvt.clientX - w / 2}px, ${moveEvt.clientY - h / 2}px, 0) scale(${avatarScale}) rotate(${avatarRotate})`;
            if (isOverTarget) {
              dragAvatar.classList.add("seq-avatar-snapping");
            } else {
              dragAvatar.classList.remove("seq-avatar-snapping");
            }
          }
        }

        function onPointerUp(upEvt) {
          window.removeEventListener("pointermove", onPointerMove);
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerUp);

          if (isHierarchy) {
            stopHierarchyDragAutoScroll();
            applyHierarchyTierFocus(state.selectedAvailableId);
          }
          if (hoveredSlotTarget) {
            hoveredSlotTarget.classList.remove("seq-slot-hover");
            hoveredSlotTarget = null;
          }

          if (isDragging && dragAvatar) {
            if (typeof config.onDragEnd === "function") {
              config.onDragEnd();
            }

            const dropX = upEvt.clientX;
            const dropY = upEvt.clientY;
            const w = dragAvatar.offsetWidth || 140;
            const h = dragAvatar.offsetHeight || 36;

            const dropTarget = document.elementFromPoint(dropX, dropY);
            let targetSlot = dropTarget
              ? dropTarget.closest('[data-sequenceui-slot="true"]') ||
                dropTarget.closest('[data-sequenceui-placed-item="true"]')
              : null;

            if (targetSlot && config.originElement && targetSlot === config.originElement) {
              targetSlot = null;
            }

            if (!targetSlot && dropTarget) {
              const levelPanel = dropTarget.closest("[data-sequenceui-level-id]");
              if (levelPanel) {
                const emptySlot = levelPanel.querySelector('[data-sequenceui-slot="true"]');
                if (emptySlot) {
                  targetSlot = emptySlot;
                }
              }
            }

            const isSidebarDrop = Boolean(
              dropTarget &&
                (dropTarget.closest("#available-inner") ||
                  dropTarget.closest('[data-sequenceui="available-sidebar"]'))
            );

            const dropRect = {
              left: dropX - w / 2,
              top: dropY - h / 2,
              width: w,
              height: h,
            };

            if ((targetSlot || isSidebarDrop) && typeof config.onDrop === "function") {
              dragAvatar.remove();
              config.onDrop(
                targetSlot,
                dropRect,
                isSidebarDrop
              );
            } else {
              dragAvatar.remove();
              if (config.originElement) {
                config.originElement.style.opacity = "";
                config.originElement.style.transform = "";
                config.originElement.style.transition = "";
              }
            }
          }
        }

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
      });
    }

    function createAvailableCardButton(group) {
      const representativeId = group.ids[0];
      const label = group.label;
      const isSelected = !isReferenceView() && group.ids.includes(state.selectedAvailableId);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", wt("sequenceui.select_element_aria", "Выбрать элемент: {label}").replace("{label}", label));
      btn.dataset.sequenceui = "available-item";
      btn.dataset.sequenceuiElementId = representativeId;
      btn.className =
        "seq-available-item w-full text-left rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2 " +
        (isSelected
          ? "border-primary bg-primary-lighter dark:border-primary dark:bg-primary dark:text-primary-fg"
          : "border-border-subtle bg-surface-1 hover:border-primary/50 hover:bg-bg-hover shadow-xs dark:border-border-subtle dark:bg-surface-1 dark:hover:bg-bg-hover");

      const line = document.createElement("div");
      line.className = "flex items-start justify-between gap-2";

      const text = document.createElement("div");
      text.className = `break-words leading-snug ${isSelected ? '!line-clamp-none' : 'line-clamp-3'} font-medium ${isSelected ? "text-text-main dark:text-primary-fg" : "text-text-main dark:text-text-on-dark"}`;
      text.title = label;
      text.textContent = label;
      line.appendChild(text);

      if (group.ids.length > 1) {
        const countBadge = document.createElement("span");
        countBadge.className =
          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold self-start mt-0.5 transition-colors " +
          (isSelected
            ? "border border-white/40 bg-white/20 text-white"
            : "border border-border-subtle bg-surface-2 text-text-secondary dark:border-border-subtle dark:bg-surface-2 dark:text-text-on-dark");
        countBadge.dataset.sequenceui = "available-duplicate-count";
        countBadge.textContent = `x${group.ids.length}`;
        line.appendChild(countBadge);
      }

      btn.appendChild(line);

      if (!canEdit()) {
        btn.disabled = true;
        btn.className += " opacity-60 cursor-default";
      }

      let lastDragEndedAt = 0;

      btn.addEventListener("click", () => {
        if (!canEdit()) return;
        if (Date.now() - lastDragEndedAt < 160) return;
        state.selectedAvailableId = isSelected ? null : representativeId;
        ensureModeByPlacements();
        renderAll();
      });

      if (canEdit()) {
        setupSequencePointerDrag(btn, () => ({
          elemId: representativeId,
          labelText: label,
          originElement: btn,
          onDragEnd: () => {
            lastDragEndedAt = Date.now();
          },
          onDrop: (targetSlot, dropRect) => {
            lastDragEndedAt = Date.now();
            if (targetSlot) {
              const levelIndex = parseInt(targetSlot.dataset.sequenceuiLevelIdx, 10);
              const slotIndex = parseInt(targetSlot.dataset.sequenceuiSlotIdx, 10);
              placeElementIntoLevel(levelIndex, slotIndex, representativeId, dropRect);
            } else if (btn) {
              btn.style.opacity = "";
              btn.style.transform = "";
            }
          },
        }));
      }

      return btn;
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
      const hierarchyTabInfo = isHierarchy ? renderHierarchyTabs(ids) : null;
      const groups = getAvailableGroups(hierarchyTabInfo ? hierarchyTabInfo.visibleIds : ids);
      availableCount.textContent = String(ids.length);
      const fullCountLabel = `${ids.length} ${pluralRu(ids.length, wt("sequenceui.plural_element_one", "элемент"), wt("sequenceui.plural_element_few", "элемента"), wt("sequenceui.plural_element_many", "элементов"))}`;
      availableCount.title = fullCountLabel;
      availableCount.setAttribute("aria-label", fullCountLabel);

      if (hierarchyTabInfo && hierarchyTabInfo.isAccordion) {
        if (!hierarchyState.collapsedTiers) {
          hierarchyState.collapsedTiers = new Set();
        }

        const tiers = state.data.levels;
        tiers.forEach((lvl, idx) => {
          const tierId = String(lvl.level_id);
          const tierElementIds = ids.filter((id) => hierarchyElementTierById.get(String(id)) === tierId);
          const tierGroups = getAvailableGroups(tierElementIds);
          const tierLabel = getHierarchyTabLabel(tierId);
          const isCompleted = tierElementIds.length === 0;
          const isCollapsed = hierarchyState.collapsedTiers.has(tierId) || (isCompleted && !hierarchyState.userExpandedTiers?.has(tierId));

          const groupEl = document.createElement("div");
          groupEl.className = "seqh-pool-group" + (isCollapsed ? " is-collapsed" : "");
          groupEl.dataset.tierId = tierId;

          const headerBtn = document.createElement("button");
          headerBtn.type = "button";
          headerBtn.className = "seqh-pool-group__header" + (isCompleted ? " is-completed" : "");
          headerBtn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
          headerBtn.dataset.sequenceui = "available-tier-header";
          headerBtn.dataset.tierId = tierId;

          if (colorDifferentiation) {
            const tint = String(idx % HIERARCHY_TINT_COUNT);
            headerBtn.dataset.tint = tint;
            headerBtn.style.setProperty("--seqh-tint", `var(--seqh-tint-${tint})`);
          }

          const left = document.createElement("div");
          left.className = "seqh-pool-group__left";
          const roman = document.createElement("span");
          roman.className = "seqh-pool-group__index";
          roman.textContent = (ROMAN_NUMERALS[idx] || String(idx + 1)) + ".";
          const title = document.createElement("span");
          title.className = "seqh-pool-group__title";
          title.textContent = tierLabel;
          title.title = tierLabel;
          left.appendChild(roman);
          left.appendChild(title);

          const right = document.createElement("div");
          right.className = "seqh-pool-group__right";
          const badge = document.createElement("span");
          badge.className = "seqh-pool-group__badge";
          if (isCompleted) {
            badge.textContent = "✓";
            badge.title = wt("seq.tier_completed_badge", "Все карточки этого уровня размещены");
          } else {
            badge.textContent = String(tierElementIds.length);
            badge.title = wt("seq.tab_items_remaining", "осталось элементов: {count}").replace("{count}", String(tierElementIds.length));
          }
          const chevron = document.createElement("span");
          chevron.className = "material-symbols-outlined seqh-pool-group__chevron";
          chevron.textContent = "expand_more";
          chevron.setAttribute("aria-hidden", "true");
          right.appendChild(badge);
          right.appendChild(chevron);

          headerBtn.appendChild(left);
          headerBtn.appendChild(right);

          headerBtn.addEventListener("click", () => {
            if (hierarchyState.collapsedTiers.has(tierId)) {
              hierarchyState.collapsedTiers.delete(tierId);
              if (!hierarchyState.userExpandedTiers) hierarchyState.userExpandedTiers = new Set();
              hierarchyState.userExpandedTiers.add(tierId);
            } else {
              hierarchyState.collapsedTiers.add(tierId);
              if (hierarchyState.userExpandedTiers) hierarchyState.userExpandedTiers.delete(tierId);
            }
            renderAvailable();
          });

          groupEl.appendChild(headerBtn);

          const itemsContainer = document.createElement("div");
          itemsContainer.className = "seqh-pool-group__items";

          tierGroups.forEach((group) => {
            itemsContainer.appendChild(createAvailableCardButton(group));
          });

          groupEl.appendChild(itemsContainer);
          availableInner.appendChild(groupEl);
        });

        requestAnimationFrame(updateAvailableScrollMask);
        return;
      }

      if (ids.length === 0 || (hierarchyTabInfo && hierarchyTabInfo.visibleIds.length === 0)) {
        const tierDone = !!hierarchyTabInfo && ids.length > 0;
        const empty = document.createElement("div");
        empty.className = "text-xs text-text-muted dark:text-text-muted";
        empty.textContent = tierDone
          ? wt("seq.tier_completed_badge", "Все карточки этого уровня размещены")
          : wt("sequenceui.no_available_items", "Нет доступных элементов");
        availableInner.appendChild(empty);
        requestAnimationFrame(updateAvailableScrollMask);
        return;
      }

      groups.forEach((group) => {
        availableInner.appendChild(createAvailableCardButton(group));
      });
      requestAnimationFrame(updateAvailableScrollMask);
    }

    function isMotionReduced() {
      return (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      );
    }

    function findAvailableButton(elemId) {
      if (!availableInner || !elemId) return null;
      const buttons = availableInner.querySelectorAll('[data-sequenceui="available-item"]');
      for (let idx = 0; idx < buttons.length; idx++) {
        if (buttons[idx].dataset && buttons[idx].dataset.sequenceuiElementId === String(elemId)) {
          return buttons[idx];
        }
      }
      const targetElement = getElementById(elemId);
      const targetLabel = targetElement ? targetElement.text : String(elemId);
      for (let idx = 0; idx < buttons.length; idx++) {
        const btn = buttons[idx];
        const btnElement = getElementById(btn.dataset.sequenceuiElementId);
        const btnLabel = btnElement ? btnElement.text : btn.dataset.sequenceuiElementId;
        if (btnLabel === targetLabel) {
          return btn;
        }
      }
      return null;
    }

    function findPlacedButton(levelIndex, slotIndex) {
      if (!levelsContainer) return null;
      const buttons = levelsContainer.querySelectorAll('[data-sequenceui-placed-item="true"]');
      for (let idx = 0; idx < buttons.length; idx++) {
        const ds = buttons[idx].dataset;
        if (
          ds &&
          ds.sequenceuiLevelIdx === String(levelIndex) &&
          ds.sequenceuiSlotIdx === String(slotIndex)
        ) {
          return buttons[idx];
        }
      }
      return null;
    }

    function animateFLIPSequencePlacement(fromOrigin, targetPlacedNode) {
      if (isMotionReduced() || !targetPlacedNode) return;
      if (typeof targetPlacedNode.animate !== "function") return;

      let fromRect = null;
      if (fromOrigin && typeof fromOrigin.getBoundingClientRect === "function") {
        fromRect = fromOrigin.getBoundingClientRect();
      } else if (fromOrigin && typeof fromOrigin.left === "number") {
        fromRect = fromOrigin;
      }
      if (!fromRect || !fromRect.width || !fromRect.height) return;

      const toRect = targetPlacedNode.getBoundingClientRect();
      if (!toRect.width || !toRect.height) return;

      const deltaX = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2);
      const deltaY = (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2);
      const scaleX = Math.max(0.35, Math.min(2.5, fromRect.width / toRect.width));
      const scaleY = Math.max(0.35, Math.min(2.5, fromRect.height / toRect.height));

      targetPlacedNode.style.transformOrigin = "50% 50%";
      targetPlacedNode.style.willChange = "transform, opacity";

      const anim = targetPlacedNode.animate(
        [
          {
            transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
            opacity: 0.88,
            boxShadow: "0 12px 28px -4px rgba(99, 102, 241, 0.35), 0 4px 10px -2px rgba(99, 102, 241, 0.2)",
          },
          {
            transform: "translate3d(0, 0, 0) scale(1.02, 0.98)",
            opacity: 1,
            boxShadow: "0 4px 12px -2px rgba(99, 102, 241, 0.15)",
            offset: 0.72,
          },
          {
            transform: "translate3d(0, 0, 0) scale(1, 1)",
            opacity: 1,
            boxShadow: "none",
          },
        ],
        {
          duration: 220,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        }
      );

      if (anim && typeof anim.addEventListener === "function") {
        anim.addEventListener("finish", () => {
          targetPlacedNode.style.willChange = "";
          targetPlacedNode.style.transformOrigin = "";
        });
      }
    }

    function animateFLIPSequenceReturn(fromOrigin, targetAvailableNode) {
      if (isMotionReduced() || !targetAvailableNode) return;
      if (typeof targetAvailableNode.animate !== "function") return;

      let fromRect = null;
      if (fromOrigin && typeof fromOrigin.getBoundingClientRect === "function") {
        fromRect = fromOrigin.getBoundingClientRect();
      } else if (fromOrigin && typeof fromOrigin.left === "number") {
        fromRect = fromOrigin;
      }
      if (!fromRect || !fromRect.width || !fromRect.height) return;

      const toRect = targetAvailableNode.getBoundingClientRect();
      if (!toRect.width || !toRect.height) return;

      const deltaX = (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2);
      const deltaY = (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2);
      const scaleX = Math.max(0.35, Math.min(2.5, fromRect.width / toRect.width));
      const scaleY = Math.max(0.35, Math.min(2.5, fromRect.height / toRect.height));

      targetAvailableNode.style.transformOrigin = "50% 50%";
      targetAvailableNode.style.willChange = "transform, opacity";

      const anim = targetAvailableNode.animate(
        [
          {
            transform: `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleX}, ${scaleY})`,
            opacity: 0.88,
            borderColor: "var(--color-primary, #6366f1)",
            boxShadow: "0 10px 24px -2px rgba(99, 102, 241, 0.3)",
          },
          {
            transform: "translate3d(0, 0, 0) scale(1.02, 0.98)",
            opacity: 1,
            borderColor: "var(--color-primary, #6366f1)",
            boxShadow: "0 4px 10px -2px rgba(99, 102, 241, 0.15)",
            offset: 0.72,
          },
          {
            transform: "translate3d(0, 0, 0) scale(1, 1)",
            opacity: 1,
            borderColor: "",
            boxShadow: "none",
          },
        ],
        {
          duration: 220,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        }
      );

      if (anim && typeof anim.addEventListener === "function") {
        anim.addEventListener("finish", () => {
          targetAvailableNode.style.willChange = "";
          targetAvailableNode.style.transformOrigin = "";
        });
      }
    }

    function findEmptySlot(levelIndex, slotIndex) {
      if (!levelsContainer) return null;
      const slots = levelsContainer.querySelectorAll('[data-sequenceui-slot="true"]');
      for (let idx = 0; idx < slots.length; idx++) {
        const ds = slots[idx].dataset;
        if (
          ds &&
          ds.sequenceuiLevelIdx === String(levelIndex) &&
          ds.sequenceuiSlotIdx === String(slotIndex)
        ) {
          return slots[idx];
        }
      }
      return null;
    }

    function animateEmptySlotEntry(levelIndex, slotIndex) {
      if (isMotionReduced()) return;
      const slotNode = findEmptySlot(levelIndex, slotIndex);
      if (!slotNode || typeof slotNode.animate !== "function") return;
      slotNode.animate(
        [
          {
            transform: "scale(0.95)",
            opacity: 0.45,
            borderColor: "color-mix(in srgb, var(--color-primary, #6366f1) 50%, var(--color-border-subtle, #e5e7eb) 50%)",
          },
          {
            transform: "scale(1)",
            opacity: 1,
            borderColor: "",
          },
        ],
        {
          duration: 180,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        }
      );
    }

    function captureAvailableItemRects() {
      const map = new Map();
      if (!availableInner) return map;
      const items = availableInner.querySelectorAll('[data-sequenceui="available-item"]');
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const id = item.dataset.sequenceuiElementId;
        if (id && typeof item.getBoundingClientRect === "function") {
          map.set(id, item.getBoundingClientRect());
        }
      }
      return map;
    }

    function animateFLIPAvailableList(prevRects, skipElementId = null) {
      if (isMotionReduced() || !availableInner || !prevRects || prevRects.size === 0) return;
      const items = availableInner.querySelectorAll('[data-sequenceui="available-item"]');
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const id = item.dataset.sequenceuiElementId;
        if (!id || id === skipElementId) continue;
        const prevRect = prevRects.get(id);
        if (!prevRect) continue;
        if (typeof item.getBoundingClientRect !== "function") continue;
        const currentRect = item.getBoundingClientRect();
        const dy = (prevRect.top + prevRect.height / 2) - (currentRect.top + currentRect.height / 2);
        if (Math.abs(dy) > 2 && typeof item.animate === "function") {
          item.animate(
            [
              { transform: `translate3d(0, ${dy}px, 0)` },
              { transform: "translate3d(0, 0, 0)" },
            ],
            {
              duration: 200,
              easing: "cubic-bezier(0.16, 1, 0.3, 1)",
            }
          );
        }
      }
    }

    function placeElementIntoLevel(levelIndex, slotIndex, specificElemId = null, originRect = null) {
      if (!canEdit()) return;
      const elemId = specificElemId || state.selectedAvailableId;
      if (!elemId) return;
      const placement = state.placements[levelIndex];
      if (!placement) return;

      placement.blocks = Array.isArray(placement.blocks) ? placement.blocks : [];
      let targetIdx = -1;
      if (isHierarchy && !isElementAllowedInHierarchyNode(elemId, levelIndex)) {
        rejectWrongTierDrop(levelIndex, slotIndex, elemId);
        return;
      }
      let displacedElemId = null;
      let displacedSlotRect = null;

      if (
        typeof slotIndex === "number" &&
        Number.isInteger(slotIndex) &&
        slotIndex >= 0 &&
        slotIndex < placement.blocks.length
      ) {
        if (placement.blocks[slotIndex] != null) {
          displacedElemId = placement.blocks[slotIndex];
          const occupiedNode = findPlacedButton(levelIndex, slotIndex);
          if (occupiedNode && typeof occupiedNode.getBoundingClientRect === "function") {
            displacedSlotRect = occupiedNode.getBoundingClientRect();
          }
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

      let fromRect = originRect;
      if (!fromRect && availableInner) {
        const selectedBtn = findAvailableButton(elemId);
        if (selectedBtn && typeof selectedBtn.getBoundingClientRect === "function") {
          fromRect = selectedBtn.getBoundingClientRect();
        }
      }

      const prevAvailableRects = captureAvailableItemRects();

      placement.blocks[targetIdx] = elemId;

      removeAvailableOccurrence(elemId);
      if (displacedElemId) {
        restoreAvailableItem(displacedElemId);
      }
      if (state.selectedAvailableId === elemId) {
        state.selectedAvailableId = null;
      }
      ensureModeByPlacements();
      renderAll();

      if (!isHierarchy && fromRect && fromRect.width && fromRect.height) {
        const placedNode = findPlacedButton(levelIndex, targetIdx);
        if (placedNode) {
          animateFLIPSequencePlacement(fromRect, placedNode);
        }
      }

      if (!isHierarchy && displacedElemId && displacedSlotRect && displacedSlotRect.width && displacedSlotRect.height) {
        const returnedNode = findAvailableButton(displacedElemId);
        if (returnedNode) {
          animateFLIPSequenceReturn(displacedSlotRect, returnedNode);
        }
      }

      animateFLIPAvailableList(prevAvailableRects, elemId);
    }

    function placeSelectedIntoLevel(levelIndex, slotIndex, originRect = null) {
      return placeElementIntoLevel(levelIndex, slotIndex, state.selectedAvailableId, originRect);
    }

    function removeFromLevel(levelIndex, slotIndex, originRect = null) {
      if (!canEdit()) return;
      const placement = state.placements[levelIndex];
      if (!placement) return;

      placement.blocks = Array.isArray(placement.blocks) ? placement.blocks : [];
      if (slotIndex < 0 || slotIndex >= placement.blocks.length) return;
      const elemId = placement.blocks[slotIndex];
      if (!elemId) return;

      let fromSlotRect = originRect;
      if (!fromSlotRect) {
        const clickedBtn = findPlacedButton(levelIndex, slotIndex);
        if (clickedBtn && typeof clickedBtn.getBoundingClientRect === "function") {
          fromSlotRect = clickedBtn.getBoundingClientRect();
        }
      }

      const prevAvailableRects = captureAvailableItemRects();

      if (requiresBlockNames || difficulty === 3) {
        if (state.userBlockNames && typeof state.userBlockNames === "object") {
          state.userBlockNames[elemId] = "";
        }
      } else {
        placement.blocks[slotIndex] = null;
        restoreAvailableItem(elemId);
      }
      ensureModeByPlacements();
      renderAll();

      animateEmptySlotEntry(levelIndex, slotIndex);

      if (!isHierarchy && fromSlotRect && fromSlotRect.width && fromSlotRect.height) {
        const availableBtn = findAvailableButton(elemId);
        if (availableBtn) {
          animateFLIPSequenceReturn(fromSlotRect, availableBtn);
          const badge = availableBtn.querySelector('[data-sequenceui="available-duplicate-count"]');
          if (badge && typeof badge.animate === "function" && !isMotionReduced()) {
            badge.animate(
              [
                { transform: "scale(1.35)" },
                { transform: "scale(1)" },
              ],
              {
                duration: 200,
                easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
              }
            );
          }
        }
      }

      animateFLIPAvailableList(prevAvailableRects, elemId);
    }

    function movePlacedElement(sourceLevelIdx, sourceSlotIdx, targetLevelIdx, targetSlotIdx, originRect = null) {
      if (!canEdit()) return;
      if (sourceLevelIdx === targetLevelIdx && sourceSlotIdx === targetSlotIdx) {
        return;
      }
      const sourcePlacement = state.placements[sourceLevelIdx];
      const targetPlacement = state.placements[targetLevelIdx];
      if (!sourcePlacement || !targetPlacement) return;

      const sourceBlocks = Array.isArray(sourcePlacement.blocks) ? sourcePlacement.blocks : [];
      const targetBlocks = Array.isArray(targetPlacement.blocks) ? targetPlacement.blocks : [];
      if (sourceSlotIdx < 0 || sourceSlotIdx >= sourceBlocks.length) return;

      const elemId = sourceBlocks[sourceSlotIdx];
      if (!elemId) return;

      let targetIdx = targetSlotIdx;
      if (typeof targetIdx !== "number" || targetIdx < 0 || targetIdx >= targetBlocks.length) {
        targetIdx = targetBlocks.findIndex((x) => x == null);
      }
      if (targetIdx < 0) {
        if (userCreatesLevels) {
          targetBlocks.push(null);
          targetIdx = targetBlocks.length - 1;
        } else {
          return;
        }
      }

      let fromRect = originRect;
      if (!fromRect) {
        const sourceBtn = findPlacedButton(sourceLevelIdx, sourceSlotIdx);
        if (sourceBtn && typeof sourceBtn.getBoundingClientRect === "function") {
          fromRect = sourceBtn.getBoundingClientRect();
        }
      }

      const displacedElemId = targetBlocks[targetIdx];
      if (isHierarchy) {
        if (!isElementAllowedInHierarchyNode(elemId, targetLevelIdx)) {
          rejectWrongTierDrop(targetLevelIdx, targetIdx, elemId);
          return;
        }
        if (displacedElemId && !isElementAllowedInHierarchyNode(displacedElemId, sourceLevelIdx)) {
          rejectWrongTierDrop(targetLevelIdx, targetIdx, displacedElemId);
          return;
        }
      }
      let targetNodeRect = null;
      if (displacedElemId) {
        const targetBtn = findPlacedButton(targetLevelIdx, targetIdx);
        if (targetBtn && typeof targetBtn.getBoundingClientRect === "function") {
          targetNodeRect = targetBtn.getBoundingClientRect();
        }
      }

      targetBlocks[targetIdx] = elemId;
      sourceBlocks[sourceSlotIdx] = displacedElemId;

      ensureModeByPlacements();
      renderAll();

      if (!isHierarchy && fromRect && fromRect.width && fromRect.height) {
        const placedNode = findPlacedButton(targetLevelIdx, targetIdx);
        if (placedNode) {
          animateFLIPSequencePlacement(fromRect, placedNode);
        }
      }
      if (!isHierarchy && displacedElemId && targetNodeRect && targetNodeRect.width && targetNodeRect.height) {
        const swappedNode = findPlacedButton(sourceLevelIdx, sourceSlotIdx);
        if (swappedNode) {
          animateFLIPSequencePlacement(targetNodeRect, swappedNode);
        }
      } else if (!displacedElemId) {
        animateEmptySlotEntry(sourceLevelIdx, sourceSlotIdx);
      }
    }

    function renderLevels() {
      if (isHierarchy) {
        renderHierarchyLevels();
        return;
      }
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
        title.textContent = wt("sequenceui.add_first_level_title", "Добавьте первый уровень");

        const desc = document.createElement("div");
        desc.className = "mt-2 text-xs text-text-muted dark:text-text-muted";
        desc.textContent = wt("sequenceui.add_first_level_desc", "Создайте уровни, дайте им названия и распределите по ним элементы.");

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "mt-4 inline-flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-primary-fg rounded-lg shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2";
        btn.innerHTML = '<span class="material-symbols-outlined">add_circle</span><span class="font-bold text-xs">' + wt("sequenceui.create_level_btn", "Создать уровень") + '</span>';
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
        empty.textContent = wt("sequenceui.empty_task_levels", "В задаче нет уровней");
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
        leftHeader.className = "flex items-center gap-2.5 min-w-0";

        const indexBadge = document.createElement("div");
        indexBadge.className =
          "seq-level-index w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 select-none";
        indexBadge.dataset.sequenceui = "level-index-badge";
        indexBadge.textContent = String(idx + 1);
        leftHeader.appendChild(indexBadge);

        if (userCreatesLevels && !referenceView) {
          if (canEdit()) {
            const inputWrap = document.createElement("div");
            inputWrap.className = "relative grow max-w-md";

            const input = document.createElement("input");
            input.type = "text";
            input.placeholder = wt("sequenceui.level_name_placeholder", "Название уровня...");
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
            const levelTitle = lvl.label || wt("sequenceui.level_no_name", "Без названия");
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
            ? `${expectedCount} ${pluralRu(expectedCount, wt("sequenceui.plural_slot_one", "слот"), wt("sequenceui.plural_slot_few", "слота"), wt("sequenceui.plural_slot_many", "слотов"))}`
            : "";

        if (difficulty === 1 && levelOrderMatters && !referenceView) {
          const controls = document.createElement("div");
          controls.className =
            "flex overflow-hidden rounded-md border border-border-strong bg-surface-2 shadow-sm dark:border-border-strong dark:bg-surface-2 divide-x divide-border-strong dark:divide-border-strong";
          controls.dataset.sequenceui = "level-order-controls";

          const canUse = canReorderLevels();

          const upBtn = document.createElement("button");
          upBtn.type = "button";
          upBtn.title = wt("sequenceui.move_level_up", "Переместить вверх");
          upBtn.setAttribute("aria-label", wt("sequenceui.move_level_up_aria", "Переместить уровень вверх"));

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
          downBtn.title = wt("sequenceui.move_level_down", "Переместить вниз");
          downBtn.setAttribute("aria-label", wt("sequenceui.move_level_down_aria", "Переместить уровень вниз"));

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
          delBtn.setAttribute("aria-label", wt("sequenceui.delete_level_aria", "Удалить уровень"));
          delBtn.title = wt("sequenceui.delete_level_aria", "Удалить уровень");
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
        headerRow.className = "seq-level-header-row flex items-center justify-between mb-3 border-b border-border-subtle/60 pb-2.5";

        const panel = document.createElement("div");
        panel.className =
          "seq-level-panel p-4 rounded-xl border border-border-subtle bg-surface-1 shadow-sm dark:border-border-strong dark:bg-surface-2 transition-all";

        // Подсветка уровня, если важен порядок уровней.
        const levelOrderVerdict = getLevelOrderVerdict(idx, lvl);
        const levelNameVerdict = getLevelNameVerdict(lvl);
        if (levelOrderVerdict === "correct") {
          panel.className =
            "seq-level-panel p-4 rounded-xl border bg-success-lighter dark:bg-success-light border-success-light dark:border-success-dark";
          const badge = document.createElement("span");
          badge.className = "ml-2 inline-flex items-center gap-1 text-xs font-semibold text-success-text dark:text-success-light";
          badge.appendChild(makeIconSvg("correct"));
          badge.appendChild(document.createTextNode(wt("sequenceui.pos_correct", "Позиция верная")));
          headerRow.appendChild(badge);
        } else if (levelOrderVerdict === "incorrect") {
          panel.className =
            "seq-level-panel p-4 rounded-xl border bg-error-lighter dark:bg-error-light border-error-light dark:border-error-dark";
          const badge = document.createElement("span");
          badge.className = "ml-2 inline-flex items-center gap-1 text-xs font-semibold text-error-text dark:text-error-light";
          badge.appendChild(makeIconSvg("incorrect"));
          badge.appendChild(document.createTextNode(wt("sequenceui.pos_incorrect", "Неверная позиция")));
          headerRow.appendChild(badge);
        }

        if (levelOrderVerdict == null && levelNameVerdict === "correct") {
          panel.className =
            "seq-level-panel p-4 rounded-xl border bg-success-lighter dark:bg-success-light border-success-light dark:border-success-dark";
          const badge = document.createElement("span");
          badge.className = "ml-2 inline-flex items-center gap-1 text-xs font-semibold text-success-text dark:text-success-light";
          badge.appendChild(makeIconSvg("correct"));
          badge.appendChild(document.createTextNode(wt("sequenceui.name_correct", "Название верное")));
          headerRow.appendChild(badge);
        } else if (levelOrderVerdict == null && levelNameVerdict === "incorrect") {
          panel.className =
            "seq-level-panel p-4 rounded-xl border bg-error-lighter dark:bg-error-light border-error-light dark:border-error-dark";
          const badge = document.createElement("span");
          badge.className = "ml-2 inline-flex items-center gap-1 text-xs font-semibold text-error-text dark:text-error-light";
          badge.appendChild(makeIconSvg("incorrect"));
          badge.appendChild(document.createTextNode(wt("sequenceui.name_incorrect", "Название неверное")));
          headerRow.appendChild(badge);
        } else if (levelOrderVerdict == null && levelNameVerdict == null && referenceView) {
          const badge = document.createElement("span");
          badge.className = "ml-2 inline-flex items-center gap-1 text-xs font-semibold text-success-text dark:text-success-light";
          badge.appendChild(makeIconSvg("correct"));
          badge.appendChild(document.createTextNode(wt("sequenceui.reference_badge", "Эталон")));
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

        if (allowClickOnLevel && canEdit() && !!state.selectedAvailableId) {
          if (levelHasEmptySlot) {
            panel.className +=
              " cursor-pointer transition-colors hover:border-primary hover:bg-primary-lighter";
          } else {
            panel.className += " cursor-not-allowed";
          }

          panel.addEventListener("click", (ev) => {
            // Do not steal clicks from actual slot/placed element buttons or inputs.
            const t = ev.target;
            if (t && t.closest && (t.closest("button") || t.closest("input"))) return;
            if (t && t.closest && (t.closest('[data-sequenceui-placed-item="true"]') || t.closest('[data-sequenceui-slot="true"]'))) return;
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
            input.placeholder = wt("sequenceui.element_name_placeholder", "Название элемента...");
            input.value =
              blockNamesSource && typeof blockNamesSource === "object"
                ? String(blockNamesSource[slotId] || "")
                : "";

            const baseInput =
              "min-h-[3.5rem] h-auto flex-1 min-w-[220px] rounded-lg px-3 py-2 text-sm font-medium border bg-surface-1 text-text-main dark:bg-surface-2 dark:text-text-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2 ";
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
            btn.setAttribute("aria-label", wt("sequenceui.remove_element_aria", "Убрать элемент: {label}").replace("{label}", label));
            btn.dataset.sequenceuiPlacedItem = "true";
            btn.dataset.sequenceuiElementId = String(placedId);
            btn.dataset.sequenceuiLevelIdx = String(idx);
            btn.dataset.sequenceuiSlotIdx = String(i);

            const basePlaced =
              "seq-element-entry seq-placed-item min-h-[3.5rem] h-auto flex-1 min-w-[180px] rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2 relative overflow-hidden ";

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
                "border border-border-strong bg-surface-1 text-text-main dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark hover:border-primary";
            }

            const row = document.createElement("div");
            row.className = "flex items-center justify-between gap-1.5 w-full";

            const gripIcon = document.createElement("span");
            gripIcon.className = "material-symbols-outlined text-[16px] text-text-muted shrink-0 select-none cursor-grab";
            gripIcon.textContent = "drag_indicator";
            gripIcon.setAttribute("aria-hidden", "true");

            const t = document.createElement("div");
            t.className = "break-words leading-tight line-clamp-4 text-center grow text-xs font-semibold";
            t.title = label;
            t.textContent = label;

            const removeIcon = document.createElement("span");
            removeIcon.className = "material-symbols-outlined text-[16px] text-text-muted hover:text-error shrink-0 transition-colors cursor-pointer";
            removeIcon.textContent = "close";
            removeIcon.title = wt("sequenceui.remove_from_slot_tooltip", "Убрать из слота");
            removeIcon.setAttribute("aria-hidden", "true");

            if (verdict === "correct" || verdict === "incorrect") {
              row.appendChild(makeIconSvg(verdict));
              row.appendChild(t);
            } else {
              row.appendChild(gripIcon);
              row.appendChild(t);
              row.appendChild(removeIcon);
            }
            btn.appendChild(row);

            if (!canEdit()) {
              btn.disabled = true;
              btn.className += " cursor-default";
            } else {
              let lastPlacedDragEndedAt = 0;
              btn.addEventListener("click", () => {
                if (Date.now() - lastPlacedDragEndedAt < 160) return;
                if (state.selectedAvailableId) {
                  state.selectedAvailableId = null;
                }
                removeFromLevel(idx, i);
              });

              setupSequencePointerDrag(btn, () => ({
                elemId: placedId,
                labelText: label,
                originElement: btn,
                onDragEnd: () => {
                  lastPlacedDragEndedAt = Date.now();
                },
                onDrop: (targetSlot, dropRect, isSidebarDrop) => {
                  lastPlacedDragEndedAt = Date.now();
                  if (isSidebarDrop) {
                    removeFromLevel(idx, i, dropRect);
                    return;
                  }
                  if (targetSlot) {
                    const targetLevelIdx = parseInt(targetSlot.dataset.sequenceuiLevelIdx, 10);
                    const targetSlotIdx = parseInt(targetSlot.dataset.sequenceuiSlotIdx, 10);
                    if (targetLevelIdx === idx && targetSlotIdx === i) {
                      btn.style.opacity = "";
                      btn.style.transform = "";
                      return;
                    }
                    movePlacedElement(idx, i, targetLevelIdx, targetSlotIdx, dropRect);
                    return;
                  }
                  btn.style.opacity = "";
                  btn.style.transform = "";
                },
              }));
            }

            slotsWrap.appendChild(btn);
          } else {
            const slotBase =
              "seq-slot-target min-h-[3.5rem] h-auto flex-1 min-w-[180px] rounded-lg flex items-center justify-center text-xs font-medium tracking-wider transition-colors py-2 ";

            const slot = document.createElement("button");
            slot.type = "button";
            slot.dataset.sequenceuiSlot = "true";
            slot.dataset.sequenceuiLevelIdx = String(idx);
            slot.dataset.sequenceuiSlotIdx = String(i);
            slot.setAttribute("aria-label", wt("sequenceui.place_selected_element_aria", "Разместить выбранный элемент в этот слот"));
            slot.className =
              slotBase +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2 ";

            const editable = canEdit() && !!state.selectedAvailableId;
            if (editable) {
              slot.className +=
                "bg-surface-2/60 dark:bg-surface-2 border-2 border-dashed border-border-strong dark:border-border-strong text-text-muted cursor-pointer hover:border-primary hover:bg-primary-lighter";
              slot.textContent = wt("sequenceui.place_btn", "Разместить");
              slot.addEventListener("click", () => {
                placeSelectedIntoLevel(idx, i);
              });
            } else {
              slot.className +=
                "bg-surface-2/30 dark:bg-surface-2/60 border-2 border-dashed border-border-subtle dark:border-border-strong text-text-muted cursor-default";
              slot.disabled = true;
              slot.textContent = wt("sequenceui.slot_empty_label", "Пусто");
            }

            slotsWrap.appendChild(slot);
          }
        }

        if (userCreatesLevels && !referenceView) {
          const addSlotBtn = document.createElement("button");
          addSlotBtn.type = "button";
          addSlotBtn.setAttribute("aria-label", wt("sequenceui.add_slot_aria", "Добавить слот в уровень"));
          addSlotBtn.className = "min-h-[3.5rem] h-auto w-12 shrink-0 rounded-lg border border-border-strong dark:border-border-strong flex items-center justify-center hover:bg-bg-hover dark:hover:bg-bg-hover transition-colors text-text-muted hover:text-text-muted dark:hover:text-text-on-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-1 dark:focus-visible:ring-offset-surface-2";
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

        panel.appendChild(headerRow);
        panel.appendChild(slotsWrap);

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

    // =====================================================================
    // Hierarchy / Classification mode (display_mode === "hierarchy")
    // Placement units are skeleton nodes; tiers live in state.data.levels.
    // =====================================================================
    const HIERARCHY_PAD = 16;
    const hierarchyNodeIndexById = new Map(hierarchyNodes.map((node, idx) => [node.node_id, idx]));
    const hierarchyTierOrderByNodeId = new Map();
    if (isHierarchy) {
      const byTier = new Map();
      hierarchyNodes.forEach((node) => {
        const info = hierarchyLayout.byNodeId.get(node.node_id);
        const tierIdx = info ? info.tierIdx : 0;
        if (!byTier.has(tierIdx)) byTier.set(tierIdx, []);
        byTier.get(tierIdx).push(node);
      });
      byTier.forEach((list) => {
        list
          .slice()
          .sort(
            (a, b) =>
              hierarchyLayout.byNodeId.get(a.node_id).colStart -
              hierarchyLayout.byNodeId.get(b.node_id).colStart
          )
          .forEach((node, order) => hierarchyTierOrderByNodeId.set(node.node_id, order + 1));
      });

      style.textContent += [
        ":root{--seqh-tint-0:#6366f1;--seqh-tint-1:#0d9488;--seqh-tint-2:#64748b;--seqh-tint-3:#b45309;--seqh-tint-4:#be185d;--seqh-tint-5:#0369a1;--seqh-col-0:#2563eb;--seqh-col-1:#ea580c;--seqh-col-2:#059669;--seqh-col-3:#7c3aed;--seqh-col-4:#e11d48;--seqh-col-5:#0891b2;}",
        ".seqh-shell{position:relative;display:flex;flex-direction:column;border:1px solid var(--color-border-subtle,#e5e7eb);border-radius:1rem;background:color-mix(in srgb,var(--color-surface-2,#f3f4f6) 45%,var(--color-bg-main,#ffffff));overflow:hidden;}",
        ".seqh-toolbar{display:flex;align-items:center;justify-content:space-between;gap:0.75rem;padding:0.5rem 0.75rem;border-bottom:1px solid var(--color-border-subtle,#e5e7eb);font-size:0.75rem;color:var(--color-text-muted,#6b7280);min-height:2.4rem;box-sizing:border-box;}",
        ".seqh-toolbar__hint{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}@media (max-width:1120px){.seqh-toolbar__hint{display:none!important;}}.seqh-shell:has(.seqh-toolbar__comparison.flex) .seqh-toolbar__hint{display:none!important;}",
        ".seqh-toolbar__comparison{display:none;align-items:center;gap:0.75rem;}",
        ".seqh-toolbar__comparison.flex{display:flex!important;}",
        ".seqh-toolbar__tools{display:inline-flex;align-items:center;gap:0.125rem;flex:none;}",
        ".seqh-tool-btn{display:inline-flex;align-items:center;justify-content:center;width:1.75rem;height:1.75rem;border-radius:0.45rem;border:none;background:transparent;color:var(--color-text-secondary,#4b5563);cursor:pointer;transition:background-color 140ms ease,color 140ms ease,transform 120ms ease;}",
        ".seqh-tool-btn:hover:not(:disabled){background:var(--color-bg-hover,#f3f4f6);color:var(--color-text-main,#111827);}",
        ".seqh-tool-btn:active:not(:disabled){transform:scale(0.94);}",
        ".seqh-tool-btn:disabled{opacity:0.35;cursor:not-allowed;}",
        ".seqh-tool-btn:focus-visible{outline:2px solid var(--color-primary,#6366f1);outline-offset:1px;}",
        ".seqh-tool-btn.is-active{color:var(--color-primary,#6366f1);background:color-mix(in srgb,var(--color-primary,#6366f1) 12%,transparent);}",
        ".seqh-tool-btn .material-symbols-outlined{font-size:18px;}",
        ".seqh-zoom-label{min-width:2.75rem;text-align:center;font-size:0.6875rem;font-weight:700;color:var(--color-text-secondary,#4b5563);font-variant-numeric:tabular-nums;}",
        ".seqh-body{position:relative;display:flex;min-height:0;width:100%;}",
        ".seqh-tier-cell{position:relative;z-index:4;display:flex;align-items:stretch;min-width:0;padding:0.2rem 0.4rem;}",
        ".seqh-tier{width:100%;display:flex;flex-direction:column;justify-content:center;gap:0.35rem;padding:0.55rem 0.75rem;border-radius:0.65rem;background:var(--color-surface-1,#ffffff);border:1px solid var(--color-border-subtle,#e5e7eb);box-shadow:0 1px 2px rgba(15,23,42,0.06);transition:border-color 160ms ease,background-color 160ms ease;}",
        ".seqh-tier[data-tint]{border-left:4px solid var(--seqh-tint);background:color-mix(in srgb,var(--seqh-tint) 6%,var(--color-surface-1,#ffffff));border-color:color-mix(in srgb,var(--seqh-tint) 25%,var(--color-border-subtle,#e5e7eb));}",
        ".seqh-tier__head{display:flex;align-items:center;gap:0.5rem;min-width:0;width:100%;}",
        ".seqh-tier__index{display:inline-flex;align-items:center;justify-content:center;flex:none;width:1.35rem;height:1.35rem;border-radius:0.35rem;font-size:0.6875rem;font-weight:800;font-family:var(--font-mono,monospace);background:var(--color-surface-1,#ffffff);border:1px solid var(--color-border-strong,#d1d5db);color:var(--color-text-main,#111827);letter-spacing:0.02em;}",
        ".seqh-tier__name{min-width:0;flex:1;font-size:0.8125rem;font-weight:700;line-height:1.3;color:var(--color-text-main,#111827);word-break:normal!important;overflow-wrap:normal!important;hyphens:none!important;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}",
        ".seqh-tier__input{width:100%;min-width:0;font-size:0.8125rem;font-weight:600;line-height:1.35;padding:0.35rem 0.5rem;border-radius:0.35rem;border:1px dashed color-mix(in srgb,var(--color-border-subtle,#e5e7eb) 75%,var(--color-text-muted,#6b7280));background:transparent;color:var(--color-text-main,#111827);transition:border-color 140ms ease,background-color 140ms ease,box-shadow 140ms ease;}",
        ".seqh-tier__input:focus{outline:none;background:var(--color-surface-1,#ffffff);border:1px solid var(--color-primary,#6366f1);box-shadow:0 0 0 2px color-mix(in srgb,var(--color-primary,#6366f1) 20%,transparent);}",
        ".seqh-tier__input.is-invalid{border-color:var(--color-error,#dc2626);}",
        ".seqh-tier[data-verdict='correct']{border-color:var(--color-success,#16a34a);background:color-mix(in srgb,var(--color-success,#16a34a) 8%,var(--color-surface-1,#ffffff));}",
        ".seqh-tier[data-verdict='incorrect']{border-color:var(--color-error,#dc2626);background:color-mix(in srgb,var(--color-error,#dc2626) 8%,var(--color-surface-1,#ffffff));}",
        ".seqh-viewport-wrap{position:relative;flex:1;min-width:0;width:100%;}",
        ".seqh-viewport{position:relative;height:clamp(300px,calc(100vh - 280px),760px);overflow:auto;padding:" + HIERARCHY_PAD + "px;cursor:grab;overscroll-behavior:contain;}",
        ".seqh-viewport:focus-visible{outline:2px solid var(--color-primary,#6366f1);outline-offset:-2px;}",
        ".seqh-viewport.is-panning{cursor:grabbing;user-select:none;}",
        ".seqh-sizer{position:relative;margin-inline:auto;margin-block:auto;}",
        ".seqh-slot-popover{position:fixed;z-index:9999;max-width:320px;padding:0.6rem 0.75rem;border-radius:0.5rem;background:var(--color-surface-1,#ffffff);color:var(--color-text-main,#111827);border:1px solid var(--color-border-subtle,#e5e7eb);box-shadow:0 10px 25px -5px rgba(0,0,0,0.18),0 8px 10px -6px rgba(0,0,0,0.1);font-size:0.8125rem;line-height:1.45;pointer-events:none;opacity:0;transition:opacity 120ms ease;}",
        ".seqh-slot-popover.is-visible{opacity:1;}",
        ".seqh-stage{position:absolute;left:0;top:0;width:max-content;transform-origin:0 0;transition:transform 160ms cubic-bezier(0.22,1,0.36,1);padding-bottom:2.5rem!important;padding-right:1.5rem!important;}",
        ".seqh-svg{position:absolute;left:0;top:0;pointer-events:none;overflow:visible;z-index:2;}",
        ".seqh-link{fill:none;stroke:color-mix(in srgb,var(--color-primary,#6366f1) 40%,var(--color-border-strong,#d1d5db));stroke-width:2px;stroke-linecap:round;stroke-linejoin:round;transition:stroke 150ms ease-out,stroke-width 150ms ease-out;}",
        ".seqh-link[data-tint]{stroke:color-mix(in srgb,var(--seqh-tint) 55%,var(--color-border-strong,#d1d5db));}",
        ".seqh-link.is-active{stroke:var(--color-primary,#6366f1);stroke-width:3px;}",
        ".seqh-grid{position:relative;z-index:3;display:grid;grid-auto-rows:minmax(112px,auto);column-gap:14px;row-gap:14px;align-items:start;}",
        ".seqh-grid-corner-spacer{grid-column:1 / 2;grid-row:1;pointer-events:none;background:transparent;}",
        ".seqh-col-lane{grid-row:1 / -1;align-self:stretch;pointer-events:none;z-index:0;border-radius:0.85rem;margin:-6px -8px;background:transparent;border:1px dashed color-mix(in srgb,var(--seqh-col-accent) 18%,transparent);}",
        ".seqh-col-header-cell{grid-row:1;z-index:5;display:flex;justify-content:center;min-width:0;align-items:stretch;}",
        ".seqh-col-header{position:relative;width:100%;max-width:clamp(300px,26vw,380px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.35rem;padding:0.55rem 0.75rem;border-radius:0.75rem;background:var(--color-surface-1,#ffffff);border:1.5px solid color-mix(in srgb,var(--seqh-col-accent) 45%,var(--color-border-subtle,#e5e7eb));border-top:4px solid var(--seqh-col-accent);box-shadow:0 1px 3px rgba(15,23,42,0.06);text-align:center;box-sizing:border-box;}",
        ".seqh-col-badge{display:inline-flex;align-items:center;gap:0.25rem;font-size:0.65rem;font-weight:800;letter-spacing:0.06em;text-transform:uppercase;color:var(--seqh-col-accent);font-variant-numeric:tabular-nums;}",
        ".seqh-col-title{font-size:0.875rem;font-weight:700;color:var(--color-text-main,#111827);line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;}",
        ".seqh-band{grid-column:1/-1;align-self:stretch;z-index:0;border-radius:0.85rem;pointer-events:none;margin:-6px -8px;}",
        ".seqh-band[data-tint]{background:color-mix(in srgb,var(--seqh-tint) 10%,transparent);border:1.5px solid color-mix(in srgb,var(--seqh-tint) 22%,transparent);}",
        ".seqh-node-cell{position:relative;z-index:4;display:flex;justify-content:center;min-width:0;}",
        ".seqh-node{position:relative;width:100%;max-width:clamp(300px,26vw,380px);display:flex;flex-direction:column;gap:0.4rem;padding:0.55rem 0.65rem;border-radius:0.85rem;background:var(--color-surface-1,#ffffff);border:1px solid var(--color-border-subtle,#e5e7eb);box-shadow:0 1px 2px rgba(15,23,42,0.06);box-sizing:border-box;transition:opacity 180ms ease,border-color 180ms ease,box-shadow 180ms ease;}",
        ".seqh-node[data-col-idx]{border-top:3px solid var(--seqh-col-accent);}",
        ".seqh-node--empty[data-slot-count='1']{background:color-mix(in srgb,var(--color-surface-1,#ffffff) 65%,transparent);border:2px dashed color-mix(in srgb,var(--color-border-strong,#64748b) 85%,transparent);box-shadow:none;}",
        ".seqh-node--empty:not([data-slot-count='1']){background:var(--color-surface-1,#ffffff);border:1px solid var(--color-border-subtle,#e5e7eb);box-shadow:0 1px 2px rgba(15,23,42,0.06);}",
        ".seqh-node--empty[data-tint]{border-top:3px solid color-mix(in srgb,var(--seqh-tint) 70%,var(--color-border-subtle,#e5e7eb));}",
        ".seqh-node--empty[data-col-idx]{border-top:3px solid color-mix(in srgb,var(--seqh-col-accent) 70%,var(--color-border-subtle,#e5e7eb));}",
        ".seqh-node--empty[data-slot-count='1'] .seqh-slot--empty{border:none!important;background:transparent!important;box-shadow:none!important;}",
        ".seqh-node--empty[data-slot-count='1']:hover,.seqh-node--empty[data-slot-count='1']:focus-within{border-color:color-mix(in srgb,var(--color-primary,#6366f1) 75%,transparent);background:color-mix(in srgb,var(--color-primary,#6366f1) 5%,var(--color-surface-1,#ffffff));}",
        ".seqh-node--empty:not([data-slot-count='1']):hover,.seqh-node--empty:not([data-slot-count='1']):focus-within{background:var(--color-surface-1,#ffffff);border-color:color-mix(in srgb,var(--color-primary,#6366f1) 55%,var(--color-border-subtle,#e5e7eb));}",
        ".seqh-node[data-tint]{border-top:3px solid color-mix(in srgb,var(--seqh-tint) 70%,var(--color-border-subtle,#e5e7eb));}",
        ".seqh-node[data-col-idx]{border-top:3px solid var(--seqh-col-accent);}",
        ".seqh-node:hover,.seqh-node:focus-within,.seqh-node.is-path{border-color:color-mix(in srgb,var(--color-primary,#6366f1) 55%,var(--color-border-subtle,#e5e7eb));box-shadow:0 2px 8px rgba(15,23,42,0.1);}",
        ".seqh-node[data-verdict='correct']{border-color:var(--color-success,#16a34a);}",
        ".seqh-node[data-verdict='incorrect']{border-color:var(--color-error,#dc2626);}",
        ".seqh-node[data-verdict='missed']{border-color:color-mix(in srgb,var(--color-warning,#d97706) 70%,transparent);border-style:dashed;background:color-mix(in srgb,var(--color-surface-1,#ffffff) 75%,transparent);}",
        ".seqh-node[data-verdict='unfilled']{border-color:color-mix(in srgb,var(--color-border-subtle,#e5e7eb) 90%,transparent);opacity:0.88;}",
        ".seqh-node[data-verdict='reference']{border-color:var(--color-success,#16a34a);}",
        ".seqh-node__head{display:flex;align-items:center;justify-content:space-between;gap:0.5rem;min-height:1.5rem;}",
        ".seqh-node__badge{font-size:0.625rem;font-weight:800;letter-spacing:0.05em;color:var(--color-text-muted,#6b7280);font-variant-numeric:tabular-nums;}",
        ".seqh-node__col-tag{display:inline-flex;align-items:center;gap:0.25rem;font-size:0.6875rem;font-weight:700;color:var(--seqh-col-accent,var(--color-primary,#6366f1));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;}",
        ".seqh-node__status{display:inline-flex;align-items:center;gap:0.3rem;font-size:0.6875rem;font-weight:700;color:var(--color-text-muted,#6b7280);white-space:nowrap;}",
        ".seqh-node__status .material-symbols-outlined{font-size:16px;}",
        ".seqh-node__swapped-badge{display:inline-flex;align-items:center;padding:0.12rem 0.35rem;border-radius:0.35rem;background:color-mix(in srgb,var(--color-success,#16a34a) 12%,transparent);color:var(--color-success,#16a34a);font-weight:700;font-size:0.6875rem;line-height:1;white-space:nowrap;}",
        ".seqh-node__slots{display:flex;flex-direction:column;gap:0.35rem;}",
        ".seqh-slot{display:flex;align-items:center;justify-content:center;gap:0.3rem;width:100%;min-height:2.4rem;padding:0.25rem 0.5rem;border-radius:0.55rem;font-size:0.75rem;font-weight:600;line-height:1.25;text-align:center;}",
        ".seqh-slot--empty{border:2px dashed color-mix(in srgb,var(--color-border-strong,#64748b) 80%,transparent);background:color-mix(in srgb,var(--color-surface-2,#f3f4f6) 65%,transparent);border-radius:0.65rem;color:var(--color-text-secondary,#4b5563);cursor:default;transition:border-color 140ms ease,background-color 140ms ease,box-shadow 140ms ease;letter-spacing:0.02em;}",
        ".seqh-slot--empty:not(:disabled){cursor:pointer;}",
        ".seqh-slot--empty:not(:disabled):hover{border-color:var(--color-primary,#6366f1);background:color-mix(in srgb,var(--color-primary,#6366f1) 8%,transparent);box-shadow:0 0 0 2px color-mix(in srgb,var(--color-primary,#6366f1) 15%,transparent);}",
        ".seqh-slot--placed{border:1px solid var(--color-border-strong,#d1d5db);background:var(--color-surface-1,#ffffff);color:var(--color-text-main,#111827);position:relative;overflow:hidden;animation:seqhSlotEntry 200ms cubic-bezier(0.16,1,0.3,1) both;}",
        ".seqh-node[data-slot-count='1'] .seqh-slot--placed{border:none!important;box-shadow:none!important;background:transparent!important;padding:0.15rem 0.25rem!important;}",
        ".seqh-link--col-stem{stroke-dasharray:4 2;stroke-width:2px;opacity:0.8;}",
        ".seqh-slot--placed:not(:disabled):hover{border-color:var(--color-primary,#6366f1);}",
        ".seqh-slot--placed .seqh-slot__text{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;}",
        ".seqh-slot--incorrect{display:flex;flex-direction:column;gap:0.35rem;padding:0.45rem 0.6rem;border-radius:0.65rem;border:1px solid var(--color-error,#dc2626);background:color-mix(in srgb,var(--color-error,#dc2626) 6%,var(--color-surface-1,#ffffff));box-sizing:border-box;width:100%;text-align:left;}",
        ".seqh-slot--missed{display:flex;flex-direction:column;gap:0.35rem;padding:0.45rem 0.6rem;border-radius:0.65rem;border:1.5px dashed color-mix(in srgb,var(--color-warning,#d97706) 65%,transparent);background:color-mix(in srgb,var(--color-warning,#f59e0b) 6%,var(--color-surface-1,#ffffff));box-sizing:border-box;width:100%;text-align:left;}",
        ".seqh-slot--static{border:1px solid var(--color-success,#16a34a);background:color-mix(in srgb,var(--color-success,#16a34a) 10%,var(--color-surface-1,#ffffff));color:var(--color-text-main,#111827);display:-webkit-box;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere;}",
        ".seqh-slot__input{width:100%;min-height:2.4rem;padding:0.3rem 0.5rem;border-radius:0.55rem;border:1px solid var(--color-border-subtle,#e5e7eb);background:var(--color-surface-1,#ffffff);color:var(--color-text-main,#111827);font-size:0.75rem;font-weight:600;}",
        ".seqh-slot__input:focus{outline:none;border-color:var(--color-primary,#6366f1);box-shadow:0 0 0 2px color-mix(in srgb,var(--color-primary,#6366f1) 20%,transparent);}",
        ".seqh-slot__input[data-verdict='correct']{border-color:var(--color-success,#16a34a);background:color-mix(in srgb,var(--color-success,#16a34a) 10%,var(--color-surface-1,#ffffff));}",
        ".seqh-slot__input[data-verdict='incorrect']{border-color:var(--color-error,#dc2626);background:color-mix(in srgb,var(--color-error,#dc2626) 8%,var(--color-surface-1,#ffffff));}",
        ".seqh-focusing .seqh-node:not(.seqh-tier-match){opacity:0.45;}",
        ".seqh-focusing .seqh-tier:not(.seqh-tier-match){opacity:0.6;}",
        ".seqh-focusing .seqh-node.seqh-tier-match .seqh-slot--empty{border-color:color-mix(in srgb,var(--color-primary,#6366f1) 65%,var(--color-border-strong,#d1d5db));}",
        ".seqh-focusing .seqh-tier.seqh-tier-match{border-color:var(--color-primary,#6366f1);box-shadow:0 0 0 2px color-mix(in srgb,var(--color-primary,#6366f1) 18%,transparent);}",
        ".seqh-shake{animation:seqhShake 280ms cubic-bezier(0.36,0.07,0.19,0.97);}",
        "@keyframes seqhShake{0%,100%{transform:translateX(0);}20%{transform:translateX(-5px);}40%{transform:translateX(5px);}60%{transform:translateX(-3px);}80%{transform:translateX(3px);}}",
        "@keyframes seqhSlotEntry{from{opacity:0;transform:scale(0.97);}to{opacity:1;transform:scale(1);}}",
        "@media (prefers-reduced-motion:reduce){.seqh-slot--placed{animation:none!important;}.seqh-node{transition:none!important;}}",
        ".seqh-hint{position:absolute;left:0.75rem;bottom:0.75rem;max-width:60%;padding:0.4rem 0.7rem;border-radius:0.6rem;font-size:0.75rem;font-weight:600;background:var(--color-surface-1,#ffffff);color:var(--color-text-main,#111827);border:1px solid var(--color-error,#dc2626);box-shadow:0 6px 18px rgba(15,23,42,0.14);opacity:0;transform:translateY(6px);pointer-events:none;transition:opacity 150ms ease-out,transform 150ms ease-out;z-index:40;}",
        ".seqh-hint.is-visible{opacity:1;transform:translateY(0);}",
        ".seqh-minimap{position:absolute;right:0.75rem;bottom:0.75rem;border-radius:0.65rem;background:color-mix(in srgb,var(--color-surface-1,#ffffff) 88%,transparent);backdrop-filter:blur(8px);border:1px solid color-mix(in srgb,var(--color-border-strong,#d1d5db) 60%,transparent);box-shadow:0 2px 8px rgba(15,23,42,0.08);z-index:30;overflow:hidden;cursor:pointer;touch-action:none;opacity:0.3;transition:opacity 200ms ease,transform 180ms ease,box-shadow 200ms ease,border-color 200ms ease;}",
        ".seqh-minimap:hover,.seqh-minimap:focus-within,.seqh-minimap.is-interacting{opacity:1;border-color:var(--color-primary,#6366f1);box-shadow:0 4px 16px rgba(15,23,42,0.16);}",
        ".seqh-minimap.is-hidden{opacity:0!important;pointer-events:none;transform:translateY(6px) scale(0.96);}",
        ".seqh-minimap__svg{display:block;width:100%;height:100%;}",
        ".seqh-minimap__view{position:absolute;border:1.5px solid var(--color-primary,#6366f1);background:color-mix(in srgb,var(--color-primary,#6366f1) 12%,transparent);border-radius:3px;pointer-events:none;box-shadow:0 0 0 1px rgba(255,255,255,0.3);}",
        ".seqh-tabs-scroll{position:relative;width:100%;margin-top:0.35rem;margin-bottom:0.15rem;box-sizing:border-box;}",
        ".seqh-tabs{position:relative;display:flex;align-items:stretch;gap:0.35rem;padding:1px;border:none!important;background:transparent!important;box-shadow:none!important;box-sizing:border-box;width:100%;}",
        ".seqh-tabs.hidden{display:none!important;}",
        ".seqh-tabs--wrap{flex-wrap:wrap;}",
        ".seqh-tab{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;gap:0.35rem;flex:1 1 0;min-width:0;height:2.05rem;padding:0.2rem 0.45rem;border:1px solid var(--color-border-subtle,#e5e7eb);border-radius:0.5rem;background:var(--color-surface-2,#f3f4f6);font-size:0.75rem;font-weight:700;color:var(--color-text-secondary,#4b5563);cursor:pointer;transition:background-color 140ms ease,border-color 140ms ease,color 140ms ease,box-shadow 140ms ease;box-sizing:border-box;user-select:none;}",
        ".seqh-tabs--wrap .seqh-tab{flex:0 1 calc(25% - 0.28rem);min-width:2.85rem;}",
        "@media (max-width:340px){.seqh-tabs--wrap .seqh-tab{flex:0 1 calc(33.333% - 0.25rem);}}",
        ".seqh-tab[data-tint]:not(.is-active){border-color:color-mix(in srgb,var(--seqh-tint) 35%,var(--color-border-subtle,#e5e7eb));background:color-mix(in srgb,var(--seqh-tint) 5%,var(--color-surface-2,#f3f4f6));}",
        ".seqh-tab:hover:not(.is-active){background:var(--color-surface-1,#ffffff);border-color:color-mix(in srgb,var(--seqh-tint,var(--color-border-strong,#cbd5e1)) 65%,var(--color-border-subtle,#e5e7eb));color:var(--color-text-main,#111827);}",
        ".seqh-tab.is-active{background:var(--color-surface-1,#ffffff)!important;border:2px solid var(--seqh-tint,var(--color-primary,#6366f1))!important;color:var(--seqh-tint,var(--color-primary,#6366f1))!important;box-shadow:0 1px 3px rgba(15,23,42,0.08),0 0 0 1px color-mix(in srgb,var(--seqh-tint,var(--color-primary,#6366f1)) 15%,transparent);font-weight:800;}",
        ".seqh-tab:focus-visible{outline:2px solid var(--color-primary,#6366f1);outline-offset:1px;}",
        ".seqh-tab.is-completed:not(.is-active){opacity:0.85;}",
        ".seqh-tab__index{font-variant-numeric:tabular-nums;font-weight:800;font-size:0.75rem;line-height:1;}",
        ".seqh-tab__label.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0;}",
        ".seqh-tab__count{display:inline-flex;align-items:center;justify-content:center;flex:none;min-width:1.2rem;height:1.2rem;padding:0 0.25rem;border-radius:999px;font-size:0.625rem;font-weight:800;background:color-mix(in srgb,var(--color-text-muted,#6b7280) 18%,transparent);color:var(--color-text-secondary,#4b5563);font-variant-numeric:tabular-nums;line-height:1;}",
        ".seqh-tab.is-active .seqh-tab__count{background:color-mix(in srgb,var(--seqh-tint,var(--color-primary,#6366f1)) 18%,transparent);color:var(--seqh-tint,var(--color-primary,#6366f1));}",
        ".seqh-tab.is-completed .seqh-tab__count{background:color-mix(in srgb,var(--color-success,#16a34a) 15%,transparent);color:var(--color-success,#16a34a);}",
        ".seqh-tab__count .material-symbols-outlined{font-size:13px;color:var(--color-success,#16a34a);}",
        ".seqh-tab-caption{display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-top:0.4rem;margin-bottom:0.25rem;padding:0.35rem 0.55rem;border-radius:0.5rem;background:color-mix(in srgb,var(--seqh-tint,var(--color-primary,#6366f1)) 8%,transparent);border-left:3px solid var(--seqh-tint,var(--color-primary,#6366f1));font-size:0.6875rem;font-weight:600;color:var(--color-text-main,#111827);line-height:1.3;box-sizing:border-box;}",
        ".seqh-tab-caption.hidden{display:none!important;}",
        ".seqh-tab-caption__title{flex:1;min-width:0;line-height:1.25;overflow-wrap:anywhere;}",
        ".seqh-tab-caption__badge{flex:none;font-size:0.625rem;font-weight:700;color:var(--seqh-tint,var(--color-primary,#6366f1));}",
        ".seqh-zoom-slider{width:4.5rem;height:1.25rem;margin:0 0.2rem;cursor:pointer;background:transparent;-webkit-appearance:none;appearance:none;vertical-align:middle;}",
        ".seqh-zoom-slider:focus-visible{outline:none;}",
        ".seqh-zoom-slider::-webkit-slider-runnable-track{width:100%;height:4px;background:var(--color-border-subtle,#e2e8f0);border-radius:9999px;transition:background 150ms ease;}",
        ".seqh-zoom-slider:hover::-webkit-slider-runnable-track{background:var(--color-border-normal,#cbd5e1);}",
        ".seqh-zoom-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:12px;height:12px;border-radius:50%;background:var(--color-primary,#6366f1);margin-top:-4px;box-shadow:0 1px 2px rgba(0,0,0,0.15);transition:transform 120ms ease,background 120ms ease;}",
        ".seqh-zoom-slider::-webkit-slider-thumb:hover{transform:scale(1.2);background:color-mix(in srgb,var(--color-primary,#6366f1) 85%,#000);}",
        ".seqh-zoom-slider::-moz-range-track{width:100%;height:4px;background:var(--color-border-subtle,#e2e8f0);border-radius:9999px;}",
        ".seqh-zoom-slider::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:var(--color-primary,#6366f1);border:none;box-shadow:0 1px 2px rgba(0,0,0,0.15);transition:transform 120ms ease,background 120ms ease;}",
        ".seqh-zoom-slider::-moz-range-thumb:hover{transform:scale(1.2);background:color-mix(in srgb,var(--color-primary,#6366f1) 85%,#000);}",
        ".seqh-pool-group{display:flex;flex-direction:column;gap:0.35rem;margin-bottom:0.75rem;}",
        ".seqh-pool-group__header{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:0.4rem;width:100%;padding:0.4rem 0.6rem;border-radius:0.5rem;background:var(--color-surface-1,#ffffff);border:1px solid var(--color-border-subtle,#e5e7eb);font-size:0.75rem;font-weight:700;color:var(--color-text-main,#111827);cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,0.04);transition:background 140ms ease,border-color 140ms ease;box-sizing:border-box;user-select:none;}",
        ".seqh-pool-group__header:hover{background:var(--color-bg-hover,#f8fafc);border-color:var(--color-primary,#6366f1);}",
        ".seqh-pool-group__header[data-tint]{border-left:3px solid var(--seqh-tint);}",
        ".seqh-pool-group__header.is-completed{opacity:0.8;background:color-mix(in srgb,var(--color-success,#16a34a) 8%,var(--color-surface-1,#ffffff));border-color:color-mix(in srgb,var(--color-success,#16a34a) 30%,transparent);}",
        ".seqh-pool-group__left{display:flex;align-items:center;gap:0.4rem;min-width:0;flex:1;}",
        ".seqh-pool-group__index{font-variant-numeric:tabular-nums;font-weight:800;color:var(--seqh-tint,var(--color-primary,#6366f1));}",
        ".seqh-pool-group__title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
        ".seqh-pool-group__right{display:flex;align-items:center;gap:0.35rem;flex:none;}",
        ".seqh-pool-group__badge{font-size:0.6875rem;font-weight:700;padding:0.1rem 0.4rem;border-radius:999px;background:var(--color-surface-2,#f3f4f6);color:var(--color-text-secondary,#4b5563);font-variant-numeric:tabular-nums;}",
        ".seqh-pool-group__header.is-completed .seqh-pool-group__badge{background:color-mix(in srgb,var(--color-success,#16a34a) 15%,transparent);color:var(--color-success,#16a34a);}",
        ".seqh-pool-group__chevron{font-size:16px;color:var(--color-text-muted,#6b7280);transition:transform 180ms ease;}",
        ".seqh-pool-group.is-collapsed .seqh-pool-group__chevron{transform:rotate(-90deg);}",
        ".seqh-pool-group.is-collapsed .seqh-pool-group__items{display:none!important;}",
        ".seqh-pool-group__items{display:flex;flex-direction:column;gap:0.35rem;padding-left:0.25rem;}",
        "@media (prefers-reduced-motion:reduce){.seqh-stage,.seqh-tabs__pill,.seqh-node,.seqh-hint,.seqh-minimap,.seqh-link,.seqh-tier,.seqh-tab,.seqh-pool-group__chevron{transition:none!important;animation:none!important;}.seqh-shake{animation:none!important;}}",
      ].join("");
    }

    function getHierarchyTierIndex(levelId) {
      return state.data.levels.findIndex((lvl) => String(lvl.level_id) === String(levelId));
    }

    function getHierarchyNeutralTierName(levelId) {
      return wt("seq.tab_tier_neutral", "Уровень {num}").replace("{num}", String(getHierarchyTierIndex(levelId) + 1));
    }

    function getHierarchyTabLabel(levelId) {
      const idx = getHierarchyTierIndex(levelId);
      const lvl = idx >= 0 ? state.data.levels[idx] : null;
      const label = lvl ? safeText(lvl.label).trim() : "";
      if (!label) return getHierarchyNeutralTierName(levelId);
      return wt("seq.tab_tier_named", "{num}. {name}")
        .replace("{num}", String(idx + 1))
        .replace("{name}", label);
    }

    function buildHierarchyReferenceModel() {
      const details =
        state.lastRawResultDetails && typeof state.lastRawResultDetails === "object"
          ? state.lastRawResultDetails
          : {};
      const refNodes = Array.isArray(details.correct_nodes_data) ? details.correct_nodes_data : [];
      const refById = new Map();
      refNodes.forEach((ref) => {
        if (ref && typeof ref === "object" && ref.node_id != null) {
          refById.set(String(ref.node_id), ref);
        }
      });
      const textById = new Map(defaultElementTextById);
      (Array.isArray(details.elements_data) ? details.elements_data : []).forEach((element) => {
        if (!element || typeof element !== "object" || element.id == null) return;
        textById.set(String(element.id), safeText(element.text || element.label || element.title));
      });

      const levels = state.data.levels.map((lvl) => ({
        ...lvl,
        label: originalLevelLabelById.get(String(lvl.level_id)) || safeText(lvl.label),
      }));
      const blockNames = {};
      const placements = hierarchyNodes.map((node) => {
        const ref = refById.get(node.node_id);
        const blocks = ref ? getBlocksFromLevelSource(ref) : [];
        const names = ref && ref.block_names && typeof ref.block_names === "object" ? ref.block_names : {};
        blocks.forEach((blockId) => {
          const key = String(blockId);
          blockNames[key] = safeText(names[key] != null ? names[key] : textById.get(key) || key);
        });
        const count = Math.max(node.slotCount, blocks.length);
        return {
          node_id: node.node_id,
          level_id: node.level_id,
          blocks: Array.from({ length: count }, (_, idx) => (blocks[idx] != null ? blocks[idx] : null)),
        };
      });
      return { levels, placements, blockNames };
    }

    function getHierarchyVerdictContext() {
      const d = state.lastRawResultDetails;
      if (!d || typeof d !== "object" || isReferenceView() || !isCheckedState()) return null;
      if (!Array.isArray(d.correct_nodes) && !(d.correct_blocks_by_node && typeof d.correct_blocks_by_node === "object")) {
        return null;
      }
      const mapping = d.node_mapping && typeof d.node_mapping === "object" ? d.node_mapping : {};
      const inverse = new Map();
      Object.keys(mapping).forEach((refId) => inverse.set(String(mapping[refId]), String(refId)));
      const levelNames = d.level_names && typeof d.level_names === "object" ? d.level_names : null;
      const matchedTiers = new Set();
      const unmatchedTiers = new Set();
      if (levelNames) {
        (Array.isArray(levelNames.matched_levels) ? levelNames.matched_levels : []).forEach((entry) => {
          if (Array.isArray(entry) && entry[0]) matchedTiers.add(String(entry[0]));
        });
        (Array.isArray(levelNames.unmatched_levels) ? levelNames.unmatched_levels : []).forEach((entry) => {
          if (Array.isArray(entry) && entry[0] && entry[1]) unmatchedTiers.add(String(entry[0]));
        });
      }
      return {
        correctNodes: new Set((Array.isArray(d.correct_nodes) ? d.correct_nodes : []).map(String)),
        matchedByNode:
          d.correct_blocks_by_node && typeof d.correct_blocks_by_node === "object" ? d.correct_blocks_by_node : {},
        mapping,
        inverse,
        matchedTiers,
        unmatchedTiers,
      };
    }

    function getHierarchySlotVerdict(ctx, nodeId, slotId, hasContent) {
      if (!ctx || !hasContent) return null;
      const matched = ctx.matchedByNode[nodeId];
      if (!Array.isArray(matched)) return "incorrect";
      return matched.some((id) => id != null && String(id) === String(slotId)) ? "correct" : "incorrect";
    }

    function isHierarchySwappedBranch(ctx, node) {
      if (!ctx || !ctx.correctNodes.has(node.node_id)) return false;
      const refId = ctx.inverse.get(node.node_id);
      if (!refId || refId === node.node_id) return false;
      const refNode = hierarchyNodeById.get(refId);
      if (!refNode) return false;
      const refParent = refNode.parent_id;
      const userParent = node.parent_id;
      if (!refParent && !userParent) return true;
      if (!refParent || !userParent) return false;
      return String(ctx.mapping[refParent]) === String(userParent);
    }

    function isElementAllowedInHierarchyNode(elemId, placementIdx) {
      if (!isHierarchy || hierarchyBlind) return true;
      const tierId = hierarchyElementTierById.get(String(elemId));
      if (!tierId) return true;
      const placement = state.placements[placementIdx];
      return !placement || String(placement.level_id) === tierId;
    }

    function showHierarchyHint(text) {
      const hint = levelsContainer.querySelector(".seqh-hint");
      if (!hint) return;
      hint.textContent = text;
      hint.classList.add("is-visible");
      if (hierarchyState.hintTimer) clearTimeout(hierarchyState.hintTimer);
      hierarchyState.hintTimer = setTimeout(() => {
        hint.classList.remove("is-visible");
        hierarchyState.hintTimer = null;
      }, 2800);
    }

    function shakeHierarchyTarget(placementIdx, slotIdx) {
      let target = levelsContainer.querySelector(
        `[data-sequenceui-level-idx="${placementIdx}"][data-sequenceui-slot-idx="${slotIdx}"]`
      );
      if (!target) target = levelsContainer.querySelector(`[data-seqh-node-idx="${placementIdx}"]`);
      if (!target) return;
      target.classList.remove("seqh-shake");
      void target.offsetWidth;
      target.classList.add("seqh-shake");
      target.addEventListener("animationend", () => target.classList.remove("seqh-shake"), { once: true });
    }

    function rejectWrongTierDrop(placementIdx, slotIdx, elemId) {
      const tierId = hierarchyElementTierById.get(String(elemId));
      const tierName = hierarchyTierNamesTyped
        ? getHierarchyNeutralTierName(tierId)
        : safeText((state.data.levels[getHierarchyTierIndex(tierId)] || {}).label) || getHierarchyNeutralTierName(tierId);
      // Re-render resets drag leftovers on the origin element, then show feedback on fresh DOM.
      renderAll({ preserveScroll: true });
      showHierarchyHint(
        wt("seq.wrong_tier_drop_hint", "Этот элемент относится к уровню «{tier}»").replace("{tier}", tierName)
      );
      shakeHierarchyTarget(placementIdx, slotIdx);
    }

    function applyHierarchyTierFocus(elemId) {
      const shell = levelsContainer.querySelector(".seqh-shell");
      if (!shell) return;
      const tierId = elemId != null && !hierarchyBlind ? hierarchyElementTierById.get(String(elemId)) : null;
      shell.classList.toggle("seqh-focusing", !!tierId);
      shell.querySelectorAll("[data-tier-id]").forEach((el) => {
        el.classList.toggle("seqh-tier-match", !!tierId && el.dataset.tierId === String(tierId));
      });
    }

    function updateHierarchyDragAutoScroll(clientX, clientY) {
      const viewport = levelsContainer.querySelector(".seqh-viewport");
      if (!viewport) return;
      const rect = viewport.getBoundingClientRect();
      const edge = 48;
      const speed = 14;
      let vx = 0;
      let vy = 0;
      if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
        if (clientX - rect.left < edge) vx = -speed;
        else if (rect.right - clientX < edge) vx = speed;
        if (clientY - rect.top < edge) vy = -speed;
        else if (rect.bottom - clientY < edge) vy = speed;
      }
      hierarchyState.autoScrollVec = { x: vx, y: vy };
      if ((vx || vy) && !hierarchyState.autoScrollRaf && typeof requestAnimationFrame === "function") {
        const tick = () => {
          const vec = hierarchyState.autoScrollVec;
          const el = levelsContainer.querySelector(".seqh-viewport");
          if (!el || (!vec.x && !vec.y)) {
            hierarchyState.autoScrollRaf = 0;
            return;
          }
          el.scrollLeft += vec.x;
          el.scrollTop += vec.y;
          hierarchyState.autoScrollRaf = requestAnimationFrame(tick);
        };
        hierarchyState.autoScrollRaf = requestAnimationFrame(tick);
      }
    }

    function stopHierarchyDragAutoScroll() {
      hierarchyState.autoScrollVec = { x: 0, y: 0 };
      if (hierarchyState.autoScrollRaf && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(hierarchyState.autoScrollRaf);
      }
      hierarchyState.autoScrollRaf = 0;
    }

    function findFirstMissingHierarchyTierName() {
      if (!hierarchyTierNamesTyped) return null;
      for (let index = 0; index < state.data.levels.length; index += 1) {
        const lvl = state.data.levels[index];
        const hasContent = state.placements.some(
          (placement) =>
            String(placement.level_id) === String(lvl.level_id) &&
            getMeaningfulBlockIdsForPlacement(placement).length > 0
        );
        if (hasContent && !safeText(lvl.label).trim()) {
          return { index, levelId: String(lvl.level_id) };
        }
      }
      return null;
    }

    function restoreHierarchyInput(draft) {
      const draftNodes = new Map();
      (Array.isArray(draft.nodes) ? draft.nodes : []).forEach((node) => {
        if (node && typeof node === "object" && node.node_id != null) {
          draftNodes.set(String(node.node_id), node);
        }
      });

      if (hierarchyTierNamesTyped) {
        const names = new Map();
        (Array.isArray(draft.levels) ? draft.levels : []).forEach((lvl) => {
          if (!lvl || typeof lvl !== "object") return;
          const id = safeText(lvl.level_id || lvl.levelId || lvl.id);
          if (id) names.set(id, safeText(lvl.level_name || lvl.label || lvl.name));
        });
        state.data.levels = state.data.levels.map((lvl) => ({
          ...lvl,
          label: names.get(String(lvl.level_id)) || "",
        }));
      }

      state.userBlockNames = {};
      state.placements = hierarchyNodes.map((node) => {
        const draftNode = draftNodes.get(node.node_id);
        const draftBlocks =
          draftNode && Array.isArray(draftNode.blocks)
            ? draftNode.blocks.filter((id) => id != null).map((id) => String(id))
            : [];
        const draftNames =
          draftNode && draftNode.block_names && typeof draftNode.block_names === "object"
            ? draftNode.block_names
            : {};
        const blocks = Array.from({ length: node.slotCount }, (_, slotIndex) => {
          if (hierarchyBlind) {
            const slotId = getHierarchySlotId(node, slotIndex);
            state.userBlockNames[slotId] = safeText(draftNames[slotId]);
            return slotId;
          }
          const id = draftBlocks[slotIndex];
          return id != null && getElementById(id) ? id : null;
        });
        return { node_id: node.node_id, level_id: node.level_id, blocks };
      });
    }

    function buildHierarchyAnswerPayload() {
      const nodes = state.placements.map((placement) => {
        const node = hierarchyNodeById.get(placement.node_id);
        const blocks = getMeaningfulBlockIdsForPlacement(placement);
        const entry = {
          node_id: placement.node_id,
          level_id: placement.level_id,
          parent_id: node ? node.parent_id : null,
          blocks,
        };
        if (node && node.columnTitle) {
          entry.column_title = node.columnTitle;
        }
        if (hierarchyBlind) {
          const blockNames = {};
          blocks.forEach((id) => {
            const name = safeText(state.userBlockNames[String(id)]);
            if (name.trim()) blockNames[String(id)] = name;
          });
          entry.block_names = blockNames;
        }
        return entry;
      });

      const levels = state.data.levels.map((lvl) => {
        const tierNodes = nodes.filter((entry) => String(entry.level_id) === String(lvl.level_id));
        const level = {
          level_id: lvl.level_id,
          level_name: safeText(lvl.label),
          blocks: tierNodes.reduce((acc, entry) => acc.concat(entry.blocks), []),
        };
        if (hierarchyBlind) {
          level.block_names = tierNodes.reduce((acc, entry) => Object.assign(acc, entry.block_names || {}), {});
        }
        return level;
      });

      return { display_mode: "hierarchy", levels, nodes };
    }

    const ROMAN_NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

    function renderHierarchyTabs(ids) {
      const hideTabs = hierarchyBlind || isReferenceView() || hierarchyElementTierById.size === 0;
      if (hideTabs) {
        if (availableTabsScroll) availableTabsScroll.classList.add("hidden");
        availableTabs.classList.add("hidden");
        availableTabsCaption.classList.add("hidden");
        return { visibleIds: ids };
      }

      const tiers = state.data.levels;
      if (tiers.length >= 5) {
        if (availableTabsScroll) availableTabsScroll.classList.add("hidden");
        availableTabs.classList.add("hidden");
        availableTabsCaption.classList.add("hidden");
        return { isAccordion: true, visibleIds: ids };
      }

      const tierIds = tiers.map((lvl) => String(lvl.level_id));
      const counts = tierIds.map(
        (tierId) => ids.filter((id) => hierarchyElementTierById.get(String(id)) === tierId).length
      );

      let active = Math.min(Math.max(0, hierarchyState.activeTab), Math.max(0, tiers.length - 1));
      const prev = hierarchyState.prevTabCounts;
      if (prev && prev[active] > 0 && counts[active] === 0) {
        // The active tier just ran out of cards: softly move on to the next unfinished tier.
        const forward = counts.findIndex((count, idx) => idx > active && count > 0);
        const anyIdx = counts.findIndex((count) => count > 0);
        const target = forward >= 0 ? forward : anyIdx;
        if (target >= 0) active = target;
      }
      hierarchyState.activeTab = active;
      hierarchyState.prevTabCounts = counts.slice();

      availableTabs.classList.toggle("seqh-tabs--wrap", tiers.length >= 5);

      Array.from(availableTabs.querySelectorAll("button")).forEach((btn) => btn.remove());
      tiers.forEach((lvl, idx) => {
        const tierId = tierIds[idx];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "seqh-tab" + (idx === active ? " is-active" : "");
        btn.setAttribute("role", "tab");
        btn.setAttribute("aria-selected", idx === active ? "true" : "false");
        btn.tabIndex = idx === active ? 0 : -1;
        btn.dataset.sequenceui = "available-tier-tab";
        btn.dataset.tierId = tierId;

        const labelText = getHierarchyTabLabel(tierId);
        btn.title = labelText;

        if (colorDifferentiation) {
          const tint = String(idx % HIERARCHY_TINT_COUNT);
          btn.dataset.tint = tint;
          btn.style.setProperty("--seqh-tint", `var(--seqh-tint-${tint})`);
        }

        const numSpan = document.createElement("span");
        numSpan.className = "seqh-tab__index";
        numSpan.textContent = ROMAN_NUMERALS[idx] || String(idx + 1);

        const label = document.createElement("span");
        label.className = "seqh-tab__label sr-only";
        label.textContent = labelText;

        const count = document.createElement("span");
        count.className = "seqh-tab__count";
        if (counts[idx] === 0) {
          btn.classList.add("is-completed");
          const icon = document.createElement("span");
          icon.className = "material-symbols-outlined";
          icon.textContent = "check";
          icon.setAttribute("aria-hidden", "true");
          count.appendChild(icon);
          count.title = wt("seq.tier_completed_badge", "Все карточки этого уровня размещены");
        } else {
          btn.classList.remove("is-completed");
          count.textContent = String(counts[idx]);
        }
        if (prev && prev[idx] !== counts[idx] && typeof count.animate === "function" && !isMotionReduced()) {
          count.animate([{ transform: "scale(1.35)" }, { transform: "scale(1)" }], {
            duration: 200,
            easing: "cubic-bezier(0.34, 1.45, 0.64, 1)",
          });
        }

        const remainingText = counts[idx] > 0
          ? wt("seq.tab_items_remaining", "осталось элементов: {count}").replace("{count}", String(counts[idx]))
          : wt("seq.tier_completed_badge", "Все карточки этого уровня размещены");
        btn.setAttribute("aria-label", `${labelText}, ${remainingText}`);

        btn.appendChild(numSpan);
        btn.appendChild(label);
        btn.appendChild(count);
        btn.addEventListener("click", () => {
          if (hierarchyState.activeTab === idx) return;
          hierarchyState.activeTab = idx;
          if (availableList) availableList.scrollTop = 0;
          renderAvailable();
          requestAnimationFrame(updateAvailableScrollMask);
        });
        btn.addEventListener("keydown", (e) => {
          let newIdx = -1;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            newIdx = (idx + 1) % tiers.length;
          } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            newIdx = (idx - 1 + tiers.length) % tiers.length;
          } else if (e.key === "Home") {
            newIdx = 0;
          } else if (e.key === "End") {
            newIdx = tiers.length - 1;
          }
          if (newIdx >= 0) {
            e.preventDefault();
            const targetBtn = availableTabs.querySelectorAll("button[data-sequenceui='available-tier-tab']")[newIdx];
            if (targetBtn) {
              targetBtn.focus();
              targetBtn.click();
            }
          }
        });
        availableTabs.appendChild(btn);
      });
      if (availableTabsScroll) availableTabsScroll.classList.remove("hidden");
      availableTabs.classList.remove("hidden");
      availableTabsCaption.classList.remove("hidden");

      const activeTierId = tierIds[active];
      const activeTierLabel = getHierarchyTabLabel(activeTierId);

      availableTabsCaption.innerHTML = "";
      if (colorDifferentiation) {
        const activeTint = String(active % HIERARCHY_TINT_COUNT);
        availableTabsCaption.dataset.tint = activeTint;
        availableTabsCaption.style.setProperty("--seqh-tint", `var(--seqh-tint-${activeTint})`);
      } else {
        delete availableTabsCaption.dataset.tint;
        availableTabsCaption.style.removeProperty("--seqh-tint");
      }
      const titleSpan = document.createElement("span");
      titleSpan.className = "seqh-tab-caption__title";
      titleSpan.textContent = activeTierLabel;
      titleSpan.title = activeTierLabel;
      availableTabsCaption.appendChild(titleSpan);

      const remainingSpan = document.createElement("span");
      remainingSpan.className = "seqh-tab-caption__badge";
      const remainingCount = counts[active] || 0;
      if (remainingCount === 0) {
        remainingSpan.textContent = "✓ " + wt("seq.tab_badge_completed", "Готово");
        remainingSpan.title = wt("seq.tier_completed_badge", "Все карточки этого уровня размещены");
      } else {
        remainingSpan.textContent = wt("seq.tab_badge_remaining", "{count} шт.").replace("{count}", String(remainingCount));
        remainingSpan.title = wt("seq.tab_items_remaining", "осталось элементов: {count}").replace("{count}", String(remainingCount));
      }
      availableTabsCaption.appendChild(remainingSpan);

      return {
        visibleIds: ids.filter((id) => {
          const tierId = hierarchyElementTierById.get(String(id));
          return tierId === undefined || tierId === activeTierId;
        }),
      };
    }

    function makeHierarchyIcon(kind) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "14");
      svg.setAttribute("height", "14");
      svg.setAttribute("aria-hidden", "true");
      svg.style.flex = "0 0 auto";
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      if (kind === "correct") {
        path.setAttribute("d", "M9 16.2l-3.5-3.5L4 14.2l5 5 12-12-1.5-1.5L9 16.2z");
        svg.classList.add("text-success");
      } else {
        path.setAttribute(
          "d",
          "M18.3 5.71L12 12l6.3 6.29-1.41 1.42L12 13.41l-6.89 6.3-1.41-1.42L10.59 12 3.7 5.71 5.11 4.29 12 10.59l6.89-6.3z"
        );
        svg.classList.add("text-error");
      }
      path.setAttribute("fill", "currentColor");
      svg.appendChild(path);
      return svg;
    }

    function makeHierarchyToolButton(iconName, label) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "seqh-tool-btn";
      btn.title = label;
      btn.setAttribute("aria-label", label);
      const icon = document.createElement("span");
      icon.className = "material-symbols-outlined";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = iconName;
      btn.appendChild(icon);
      return btn;
    }

    function getHierarchyOffsetWithin(el, ancestor) {
      let x = 0;
      let y = 0;
      let node = el;
      let guard = 0;
      while (node && node !== ancestor && guard < 12) {
        x += node.offsetLeft || 0;
        y += node.offsetTop || 0;
        node = node.offsetParent;
        guard += 1;
      }
      return { x, y, w: el.offsetWidth || 0, h: el.offsetHeight || 0 };
    }

    function getHierarchyCanvasParts() {
      const shell = levelsContainer.querySelector(".seqh-shell");
      if (!shell) return null;
      return {
        shell,
        viewport: shell.querySelector(".seqh-viewport"),
        sizer: shell.querySelector(".seqh-sizer"),
        stage: shell.querySelector(".seqh-stage"),
        tiersInner: shell.querySelector(".seqh-tiers-inner"),
        zoomLabel: shell.querySelector(".seqh-zoom-label"),
        zoomSlider: shell.querySelector(".seqh-zoom-slider"),
      };
    }

    function syncHierarchyTierColumn() {
      const parts = getHierarchyCanvasParts();
      if (!parts || !parts.stage || !parts.tiersInner) return;
      const z = hierarchyState.zoom;
      const bands = parts.stage.querySelectorAll(".seqh-band");
      const naturalH = parts.stage.offsetHeight || 0;
      parts.tiersInner.style.height = `${HIERARCHY_PAD * 2 + naturalH * z}px`;
      bands.forEach((band) => {
        const tier = parts.shell.querySelector(`.seqh-tier[data-tier-id="${band.dataset.tierId}"]`);
        if (!tier) return;
        const top = HIERARCHY_PAD + (band.offsetTop || 0) * z;
        const height = Math.max(40, (band.offsetHeight || 0) * z);
        tier.style.top = `${top}px`;
        tier.style.height = `${height}px`;
      });
      parts.tiersInner.style.transform = `translateY(${-(parts.viewport ? parts.viewport.scrollTop : 0)}px)`;
    }

    function renderHierarchyConnectors() {
      const parts = getHierarchyCanvasParts();
      if (!parts || !parts.stage) return;
      const svg = parts.stage.querySelector(".seqh-svg");
      if (!svg) return;
      const naturalW = parts.stage.offsetWidth || 0;
      const naturalH = parts.stage.offsetHeight || 0;
      svg.setAttribute("width", String(naturalW));
      svg.setAttribute("height", String(naturalH));
      svg.setAttribute("viewBox", `0 0 ${naturalW} ${naturalH}`);
      svg.innerHTML = "";

      const cards = new Map();
      parts.stage.querySelectorAll(".seqh-node[data-node-id]").forEach((el) => {
        cards.set(el.getAttribute("data-node-id"), el);
      });
      hierarchyNodes.forEach((node) => {
        if (!node.parent_id || !cards.has(node.node_id) || !cards.has(node.parent_id)) return;
        const parentPos = getHierarchyOffsetWithin(cards.get(node.parent_id), parts.stage);
        const childPos = getHierarchyOffsetWithin(cards.get(node.node_id), parts.stage);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("class", "seqh-link");
        path.setAttribute(
          "d",
          buildRoundedElbowPath(
            parentPos.x + parentPos.w / 2,
            parentPos.y + parentPos.h + 3,
            childPos.x + childPos.w / 2,
            childPos.y
          )
        );
        path.dataset.childId = node.node_id;
        path.dataset.parentId = node.parent_id;
        if (colorDifferentiation) {
          const info = hierarchyLayout.byNodeId.get(node.node_id);
          const colAccent = (info && info.rootIdx !== undefined && hierarchyLayout.hasColumnHeaders)
            ? `var(--seqh-col-${info.rootIdx % HIERARCHY_COL_COUNT})`
            : `var(--seqh-tint-${(info ? info.tierIdx : 0) % HIERARCHY_TINT_COUNT})`;
          path.style.setProperty("--seqh-tint", colAccent);
          path.style.stroke = colAccent;
        }
        svg.appendChild(path);
      });

      if (hierarchyLayout && hierarchyLayout.hasColumnHeaders) {
        hierarchyLayout.roots.forEach((root, rIdx) => {
          const colHeaderEl = parts.stage.querySelector(`.seqh-col-header-cell[data-col-idx="${rIdx}"]`);
          const rootCard = cards.get(root.node_id);
          if (!colHeaderEl || !rootCard) return;
          const headerPos = getHierarchyOffsetWithin(colHeaderEl, parts.stage);
          const rootPos = getHierarchyOffsetWithin(rootCard, parts.stage);
          const stem = document.createElementNS("http://www.w3.org/2000/svg", "path");
          stem.setAttribute("class", "seqh-link seqh-link--col-stem");
          stem.dataset.childId = root.node_id;
          stem.dataset.parentId = `col_header_${rIdx}`;
          const stemX = rootPos.x + rootPos.w / 2;
          stem.setAttribute(
            "d",
            `M ${stemX} ${headerPos.y + headerPos.h} L ${stemX} ${rootPos.y}`
          );
          const colAccent = `var(--seqh-col-${rIdx % HIERARCHY_COL_COUNT})`;
          stem.style.setProperty("--seqh-tint", colAccent);
          stem.style.stroke = colAccent;
          svg.appendChild(stem);
        });
      }
    }

    function highlightHierarchyPath(nodeId) {
      const parts = getHierarchyCanvasParts();
      if (!parts) return;
      const chain = new Set();
      if (nodeId) {
        let cursor = hierarchyNodeById.get(nodeId);
        let guard = 0;
        while (cursor && guard < 64) {
          chain.add(cursor.node_id);
          cursor = cursor.parent_id ? hierarchyNodeById.get(cursor.parent_id) : null;
          guard += 1;
        }
      }
      parts.stage.querySelectorAll(".seqh-link").forEach((path) => {
        const active =
          !!nodeId && (chain.has(path.dataset.childId) || path.dataset.parentId === nodeId);
        path.classList.toggle("is-active", active);
      });
      parts.stage.querySelectorAll(".seqh-node").forEach((card) => {
        card.classList.toggle("is-path", !!nodeId && chain.has(card.dataset.nodeId));
      });
    }

    function getHierarchyContentSize() {
      const parts = getHierarchyCanvasParts();
      if (!parts || !parts.stage) return { w: 0, h: 0, naturalW: 0, naturalH: 0 };
      const naturalW = parts.stage.offsetWidth || 0;
      const naturalH = parts.stage.offsetHeight || 0;
      return {
        naturalW,
        naturalH,
        w: naturalW * hierarchyState.zoom + HIERARCHY_PAD * 2,
        h: naturalH * hierarchyState.zoom + HIERARCHY_PAD * 2,
      };
    }

    function updateHierarchyMinimap() {
      const parts = getHierarchyCanvasParts();
      if (!parts || !parts.viewport || !parts.stage) return;
      const minimap = parts.shell.querySelector(".seqh-minimap");
      const mapBtn = parts.shell.querySelector('[data-seqh-tool="minimap"]');
      if (!minimap) return;
      const size = getHierarchyContentSize();
      const vp = parts.viewport;
      const fits = vp.clientWidth > 0 && size.w <= vp.clientWidth + 1 && size.h <= vp.clientHeight + 1;
      const hidden = !hierarchyState.minimapVisible || fits || size.w <= 0 || size.h <= 0;
      minimap.classList.toggle("is-hidden", hidden);
      if (mapBtn) {
        mapBtn.classList.toggle("is-active", hierarchyState.minimapVisible);
        mapBtn.setAttribute("aria-pressed", hierarchyState.minimapVisible ? "true" : "false");
      }
      if (hidden) return;

      const scale = Math.min(150 / size.w, 96 / size.h);
      const miniW = Math.max(40, Math.round(size.w * scale));
      const miniH = Math.max(24, Math.round(size.h * scale));
      minimap.style.width = `${miniW}px`;
      minimap.style.height = `${miniH}px`;

      const svg = minimap.querySelector(".seqh-minimap__svg");
      const view = minimap.querySelector(".seqh-minimap__view");
      if (!svg || !view) return;
      svg.setAttribute("viewBox", `0 0 ${size.w} ${size.h}`);
      svg.innerHTML = "";
      const z = hierarchyState.zoom;
      // 1. Guides for tiers
      parts.stage.querySelectorAll(".seqh-band").forEach((band) => {
        const top = HIERARCHY_PAD + (band.offsetTop || 0) * z;
        const height = Math.max(8, (band.offsetHeight || 0) * z);
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", String(top));
        rect.setAttribute("width", String(size.w));
        rect.setAttribute("height", String(height));
        rect.setAttribute("rx", "4");
        rect.setAttribute("fill", "rgba(100, 116, 139, 0.05)");
        svg.appendChild(rect);
      });

      // 2. Connectors between parent and child nodes
      const cardMap = new Map();
      parts.stage.querySelectorAll(".seqh-node[data-node-id]").forEach((card) => {
        cardMap.set(card.getAttribute("data-node-id"), card);
      });
      hierarchyNodes.forEach((node) => {
        if (!node.parent_id || !cardMap.has(node.node_id) || !cardMap.has(node.parent_id)) return;
        const pCard = cardMap.get(node.parent_id);
        const cCard = cardMap.get(node.node_id);
        const pPos = getHierarchyOffsetWithin(pCard, parts.stage);
        const cPos = getHierarchyOffsetWithin(cCard, parts.stage);
        const px = HIERARCHY_PAD + (pPos.x + pPos.w / 2) * z;
        const py = HIERARCHY_PAD + (pPos.y + pPos.h) * z;
        const cx = HIERARCHY_PAD + (cPos.x + cPos.w / 2) * z;
        const cy = HIERARCHY_PAD + cPos.y * z;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line.setAttribute("d", buildRoundedElbowPath(px, py, cx, cy, 6 * z));
        line.setAttribute("fill", "none");
        line.setAttribute("stroke", "rgba(99, 102, 241, 0.45)");
        line.setAttribute("stroke-width", String(Math.max(1.5, 2 * z)));
        svg.appendChild(line);
      });

      // 3. Node cards on top of connectors
      parts.stage.querySelectorAll(".seqh-node[data-node-id]").forEach((card) => {
        const pos = getHierarchyOffsetWithin(card, parts.stage);
        const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rect.setAttribute("x", String(HIERARCHY_PAD + pos.x * z));
        rect.setAttribute("y", String(HIERARCHY_PAD + pos.y * z));
        rect.setAttribute("width", String(Math.max(6, pos.w * z)));
        rect.setAttribute("height", String(Math.max(6, pos.h * z)));
        rect.setAttribute("rx", String(Math.max(2, 4 * z)));
        const tint = card.dataset.tint;
        rect.setAttribute("fill", tint != null ? "rgba(99, 102, 241, 0.28)" : "rgba(100, 116, 139, 0.2)");
        rect.setAttribute("stroke", tint != null ? "rgba(99, 102, 241, 0.7)" : "rgba(100, 116, 139, 0.6)");
        rect.setAttribute("stroke-width", String(Math.max(1, 1.5 * z)));
        svg.appendChild(rect);
      });
      view.style.left = `${Math.min(100, (vp.scrollLeft / size.w) * 100)}%`;
      view.style.top = `${Math.min(100, (vp.scrollTop / size.h) * 100)}%`;
      view.style.width = `${Math.min(100, (vp.clientWidth / size.w) * 100)}%`;
      view.style.height = `${Math.min(100, (vp.clientHeight / size.h) * 100)}%`;
    }

    function applyHierarchyZoom(nextZoom) {
      const parts = getHierarchyCanvasParts();
      if (!parts || !parts.stage || !parts.sizer) return;
      const z = clampHierarchyZoom(nextZoom);
      hierarchyState.zoom = z;
      const naturalW = parts.stage.offsetWidth || 0;
      const naturalH = parts.stage.offsetHeight || 0;
      parts.stage.style.transform = `scale(${z})`;
      parts.sizer.style.width = `${naturalW * z}px`;
      parts.sizer.style.height = `${naturalH * z}px`;
      if (parts.zoomLabel) parts.zoomLabel.textContent = `${Math.round(z * 100)}%`;
      if (parts.zoomSlider && Number(parts.zoomSlider.value) !== Math.round(z * 100)) {
        parts.zoomSlider.value = String(Math.round(z * 100));
      }
      const outBtn = parts.shell.querySelector('[data-seqh-tool="zoom-out"]');
      const inBtn = parts.shell.querySelector('[data-seqh-tool="zoom-in"]');
      if (outBtn) outBtn.disabled = z <= HIERARCHY_MIN_ZOOM;
      if (inBtn) inBtn.disabled = z >= HIERARCHY_MAX_ZOOM;
      syncHierarchyTierColumn();
      updateHierarchyMinimap();
    }

    function computeHierarchyFitZoom() {
      const parts = getHierarchyCanvasParts();
      if (!parts || !parts.viewport || !parts.stage) return 1;
      const naturalW = parts.stage.offsetWidth || 0;
      const naturalH = parts.stage.offsetHeight || 0;
      const availW = parts.viewport.clientWidth - HIERARCHY_PAD * 2;
      const availH = parts.viewport.clientHeight - HIERARCHY_PAD * 2;
      if (!naturalW || !naturalH || availW <= 0 || availH <= 0) return 1;
      const scaleW = availW / naturalW;
      const scaleH = availH / naturalH;
      // Strict 2D First-Fold Invariant: never exceed vertical or horizontal available bounds
      let fit = Math.min(1.0, scaleW, scaleH);
      return clampHierarchyZoom(fit);
    }

    function fitHierarchyCanvas() {
      const parts = getHierarchyCanvasParts();
      if (!parts || !parts.viewport) return;
      applyHierarchyZoom(computeHierarchyFitZoom());
      parts.viewport.scrollLeft = 0;
      parts.viewport.scrollTop = 0;
      syncHierarchyTierColumn();
      updateHierarchyMinimap();
    }

    function zoomHierarchyAt(nextZoom, clientX, clientY) {
      const parts = getHierarchyCanvasParts();
      if (!parts || !parts.viewport) return;
      const vp = parts.viewport;
      const rect = vp.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      const z0 = hierarchyState.zoom;
      const cx = (vp.scrollLeft + px - HIERARCHY_PAD) / z0;
      const cy = (vp.scrollTop + py - HIERARCHY_PAD) / z0;
      applyHierarchyZoom(nextZoom);
      const z1 = hierarchyState.zoom;
      vp.scrollLeft = Math.max(0, cx * z1 + HIERARCHY_PAD - px);
      vp.scrollTop = Math.max(0, cy * z1 + HIERARCHY_PAD - py);
      syncHierarchyTierColumn();
      updateHierarchyMinimap();
    }

    function zoomHierarchyFromCenter(delta) {
      const parts = getHierarchyCanvasParts();
      if (!parts || !parts.viewport) return;
      const rect = parts.viewport.getBoundingClientRect();
      zoomHierarchyAt(hierarchyState.zoom + delta, rect.left + rect.width / 2, rect.top + rect.height / 2);
    }

    function layoutHierarchyCanvas() {
      const parts = getHierarchyCanvasParts();
      if (!parts || !parts.viewport) return;
      if (!hierarchyState.fitted && parts.viewport.clientWidth > 0) {
        hierarchyState.zoom = computeHierarchyFitZoom();
        hierarchyState.fitted = true;
      }
      applyHierarchyZoom(hierarchyState.zoom);
      parts.viewport.scrollLeft = hierarchyState.scrollLeft;
      parts.viewport.scrollTop = hierarchyState.scrollTop;
      syncHierarchyTierColumn();
      renderHierarchyConnectors();
      updateHierarchyMinimap();
    }

    function animateHierarchyHeightTransitions(prevHeights) {
      if (!prevHeights || !prevHeights.size || isMotionReduced()) return;
      const parts = getHierarchyCanvasParts();
      if (!parts || !parts.stage) return;

      const currentNodes = parts.stage.querySelectorAll(".seqh-node[data-node-id]");
      const transitioningNodes = [];

      currentNodes.forEach((node) => {
        const id = node.getAttribute("data-node-id");
        if (!id || !prevHeights.has(id)) return;
        const prevH = prevHeights.get(id);
        const targetH = node.offsetHeight;
        if (Math.abs(prevH - targetH) > 2) {
          transitioningNodes.push({ node, id, prevH, targetH });
        }
      });

      if (!transitioningNodes.length) return;

      transitioningNodes.forEach(({ node, prevH }) => {
        node.style.height = `${prevH}px`;
        node.style.overflow = "hidden";
      });

      void parts.stage.offsetHeight;

      transitioningNodes.forEach(({ node, targetH }) => {
        node.style.transition = "height 240ms cubic-bezier(0.16, 1, 0.3, 1)";
        node.style.height = `${targetH}px`;
      });

      if (hierarchyState.heightAnimRaf) {
        cancelAnimationFrame(hierarchyState.heightAnimRaf);
        hierarchyState.heightAnimRaf = null;
      }

      const startTime = performance.now();
      const animDuration = 260;

      function step() {
        const elapsed = performance.now() - startTime;
        renderHierarchyConnectors();
        syncHierarchyTierColumn();
        updateHierarchyMinimap();

        if (elapsed < animDuration) {
          hierarchyState.heightAnimRaf = requestAnimationFrame(step);
        } else {
          hierarchyState.heightAnimRaf = null;
          transitioningNodes.forEach(({ node }) => {
            node.style.height = "";
            node.style.overflow = "";
            node.style.transition = "";
          });
          renderHierarchyConnectors();
          syncHierarchyTierColumn();
          updateHierarchyMinimap();
        }
      }

      hierarchyState.heightAnimRaf = requestAnimationFrame(step);
    }

    function populateHierarchyNodeCard(
      card,
      node,
      placementIdx,
      model,
      refPlacementByNodeId,
      verdictCtx,
      editable,
      referenceView,
      refModel
    ) {
      const info = hierarchyLayout.byNodeId.get(node.node_id);
      if (!info) return;

      const placement = model.placements[placementIdx] || { blocks: [] };
      const blocks = Array.isArray(placement.blocks) ? placement.blocks : [];
      const targetRefId =
        (verdictCtx && verdictCtx.inverse && verdictCtx.inverse.get(String(node.node_id))) || String(node.node_id);
      const refPlacement = refPlacementByNodeId.get(targetRefId);
      const refBlocks = refPlacement && Array.isArray(refPlacement.blocks) ? refPlacement.blocks : [];
      const blockNamesSource = model.blockNames || {};

      const totalSlots = Math.max(node.slotCount || 1, blocks.length, refBlocks.length, 1);

      card.className = "seqh-node";
      card.dataset.nodeId = node.node_id;
      card.dataset.tierId = String(node.level_id);
      card.dataset.seqhNodeIdx = String(placementIdx);
      card.dataset.slotCount = String(totalSlots);
      card.setAttribute("data-node-id", node.node_id);
      card.setAttribute("data-sequenceui-level-id", node.node_id);
      card.setAttribute("data-slot-count", String(totalSlots));
      card.setAttribute("role", "group");

      if (colorDifferentiation) {
        const tint = String(info.tierIdx % HIERARCHY_TINT_COUNT);
        card.dataset.tint = tint;
        card.style.setProperty("--seqh-tint", `var(--seqh-tint-${tint})`);
      }

      if (hierarchyLayout && hierarchyLayout.hasColumnHeaders) {
        const rootIdx = info.rootIdx !== undefined ? info.rootIdx : 0;
        const colAccentIdx = rootIdx % HIERARCHY_COL_COUNT;
        card.dataset.colIdx = String(colAccentIdx);
        card.style.setProperty("--seqh-col-accent", `var(--seqh-col-${colAccentIdx})`);
      }

      let nodeVerdict = null;
      const hasPlacedBlocks = blocks.length > 0 && blocks.some((b) => b != null);
      if (!hasPlacedBlocks) {
        card.classList.add("seqh-node--empty");
      } else {
        card.classList.remove("seqh-node--empty");
      }

      if (referenceView) {
        nodeVerdict = "reference";
      } else if (verdictCtx) {
        if (hasPlacedBlocks) {
          nodeVerdict = verdictCtx.correctNodes.has(node.node_id) ? "correct" : "incorrect";
        } else {
          nodeVerdict = refBlocks.length > 0 && refBlocks.some((b) => b != null) ? "missed" : "unfilled";
        }
      }
      if (nodeVerdict) card.dataset.verdict = nodeVerdict;
      else delete card.dataset.verdict;

      let head = card.querySelector(".seqh-node__head");
      if (!head) {
        head = document.createElement("div");
        head.className = "seqh-node__head";
        card.appendChild(head);
      }
      head.innerHTML = "";
      const badge = document.createElement("span");
      badge.className = "seqh-node__badge";
      badge.textContent = `${info.tierIdx + 1}.${hierarchyTierOrderByNodeId.get(node.node_id) || 1}`;
      head.appendChild(badge);

      const colTitle = (info && info.rootNode && info.rootNode.columnTitle) || "";
      const rootIdx = (info && info.rootIdx !== undefined) ? info.rootIdx : 0;
      if (colTitle) {
        const colTag = document.createElement("span");
        colTag.className = "seqh-node__col-tag";
        colTag.textContent = `• ${toRoman(rootIdx + 1)} · ${colTitle}`;
        colTag.title = `${toRoman(rootIdx + 1)} · ${colTitle}`;
        head.appendChild(colTag);
      }

      if (nodeVerdict === "correct" || nodeVerdict === "incorrect") {
        const status = document.createElement("span");
        status.className = "seqh-node__status";
        status.appendChild(makeHierarchyIcon(nodeVerdict));
        if (nodeVerdict === "correct" && isHierarchySwappedBranch(verdictCtx, node)) {
          const swapped = document.createElement("span");
          swapped.className = "seqh-node__swapped-badge";
          swapped.textContent = wt("seq.branch_swapped_ok", "Порядок изменен");
          status.appendChild(swapped);
        }
        head.appendChild(status);
      } else if (nodeVerdict === "missed") {
        const status = document.createElement("span");
        status.className =
          "seqh-node__status seqh-node__status--missed flex items-center gap-1 text-[11px] font-semibold text-warning-text dark:text-warning-light";
        const icon = document.createElement("span");
        icon.className = "material-symbols-outlined text-[14px]";
        icon.textContent = "warning";
        icon.setAttribute("aria-hidden", "true");
        const label = document.createElement("span");
        label.textContent = wt("seq.diff_missed_label", "Пропущен этап");
        status.appendChild(icon);
        status.appendChild(label);
        head.appendChild(status);
      } else if (nodeVerdict === "unfilled") {
        const status = document.createElement("span");
        status.className =
          "seqh-node__status seqh-node__status--unfilled text-[11px] font-medium text-text-muted select-none";
        status.textContent = "—";
        head.appendChild(status);
      }

      let slotsWrap = card.querySelector(".seqh-node__slots");
      if (!slotsWrap) {
        slotsWrap = document.createElement("div");
        slotsWrap.className = "seqh-node__slots";
        card.appendChild(slotsWrap);
      }
      slotsWrap.innerHTML = "";

      for (let slotIdx = 0; slotIdx < totalSlots; slotIdx += 1) {
        const placedId = slotIdx < blocks.length ? blocks[slotIdx] || null : null;
        const expectedBlockId = slotIdx < refBlocks.length ? refBlocks[slotIdx] || null : null;
        const expectedText =
          expectedBlockId != null
            ? (refModel && refModel.blockNames && refModel.blockNames[expectedBlockId]) ||
              (getElementById(expectedBlockId) || {}).text ||
              String(expectedBlockId)
            : null;

        if (hierarchyBlind && !referenceView) {
          const slotId = placedId || getHierarchySlotId(node, slotIdx);
          if (state.userBlockNames[slotId] == null) state.userBlockNames[slotId] = "";
          const input = document.createElement("input");
          input.type = "text";
          const placeholder = wt("seq.node_input_placeholder", "Введите элемент...");
          input.placeholder = placeholder;
          input.setAttribute("aria-label", placeholder);
          input.className = "seqh-slot__input";
          input.value = safeText(state.userBlockNames[slotId]);
          input.disabled = !editable;
          const slotVerdict = getHierarchySlotVerdict(verdictCtx, node.node_id, slotId, !!input.value.trim());
          if (slotVerdict) input.dataset.verdict = slotVerdict;
          input.addEventListener("input", () => {
            state.userBlockNames[slotId] = input.value;
            ensureModeByPlacements();
          });
          slotsWrap.appendChild(input);
          continue;
        }

        if (placedId && referenceView) {
          const refText = blockNamesSource[placedId] || (getElementById(placedId) || {}).text || placedId;
          const staticSlot = document.createElement("div");
          staticSlot.className = "seqh-slot seqh-slot--static";
          staticSlot.textContent = refText;
          staticSlot.title = refText;
          slotsWrap.appendChild(staticSlot);
          continue;
        }

        if (placedId) {
          const element = getElementById(placedId);
          const label = (blockNamesSource && blockNamesSource[placedId]) || (element ? element.text : placedId);
          const slotVerdict = getHierarchySlotVerdict(verdictCtx, node.node_id, placedId, true);

          if (slotVerdict === "incorrect" && verdictCtx && expectedText) {
            const diffSlot = document.createElement("div");
            diffSlot.className =
              "seqh-slot seqh-slot--incorrect bg-error-lighter dark:bg-error-light border-error-light dark:border-error-dark";
            diffSlot.dataset.sequenceuiPlacedItem = "true";
            diffSlot.dataset.sequenceuiElementId = String(placedId);
            diffSlot.dataset.sequenceuiLevelIdx = String(placementIdx);
            diffSlot.dataset.sequenceuiSlotIdx = String(slotIdx);

            const userRow = document.createElement("div");
            userRow.className = "flex items-start gap-1.5 text-xs text-error dark:text-error-light";
            const userIcon = document.createElement("span");
            userIcon.className = "material-symbols-outlined text-[15px] shrink-0 mt-0.5 select-none";
            userIcon.textContent = "close";
            userIcon.setAttribute("aria-hidden", "true");
            const userPrefix = document.createElement("span");
            userPrefix.className = "text-[11px] font-bold opacity-80 shrink-0 mt-0.5";
            userPrefix.textContent = wt("seq.diff_user_choice", "Ваш выбор") + ":";
            const userText = document.createElement("span");
            userText.className = "line-through opacity-85 leading-snug";
            userText.title = label;
            userText.textContent = label;
            userRow.appendChild(userIcon);
            userRow.appendChild(userPrefix);
            userRow.appendChild(userText);
            diffSlot.appendChild(userRow);

            const refRow = document.createElement("div");
            refRow.className = "flex items-start gap-1.5 text-xs font-medium text-success dark:text-success-light";
            const refIcon = document.createElement("span");
            refIcon.className = "material-symbols-outlined text-[15px] shrink-0 mt-0.5 select-none";
            refIcon.textContent = "check";
            refIcon.setAttribute("aria-hidden", "true");
            const refPrefix = document.createElement("span");
            refPrefix.className = "text-[11px] font-bold opacity-80 shrink-0 mt-0.5";
            refPrefix.textContent = wt("seq.diff_expected_prefix", "Эталон:");
            const refText = document.createElement("span");
            refText.className = "leading-snug";
            refText.title = expectedText;
            refText.textContent = expectedText;
            refRow.appendChild(refIcon);
            refRow.appendChild(refPrefix);
            refRow.appendChild(refText);
            diffSlot.appendChild(refRow);

            slotsWrap.appendChild(diffSlot);
            continue;
          }

          const btn = document.createElement("button");
          btn.type = "button";
          btn.setAttribute(
            "aria-label",
            wt("sequenceui.remove_element_aria", "Убрать элемент: {label}").replace("{label}", label)
          );
          btn.dataset.sequenceuiPlacedItem = "true";
          btn.dataset.sequenceuiElementId = String(placedId);
          btn.dataset.sequenceuiLevelIdx = String(placementIdx);
          btn.dataset.sequenceuiSlotIdx = String(slotIdx);
          btn.className =
            "seq-element-entry seq-placed-item seqh-slot seqh-slot--placed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
            (slotVerdict === "correct"
              ? "bg-success-lighter dark:bg-success-light border-success-light dark:border-success-dark"
              : slotVerdict === "incorrect"
                ? "bg-error-lighter dark:bg-error-light border-error-light dark:border-error-dark"
                : "");

          if (slotVerdict && totalSlots > 1) btn.appendChild(makeHierarchyIcon(slotVerdict));
          else if (!slotVerdict) {
            const grip = document.createElement("span");
            grip.className = "material-symbols-outlined text-[16px] text-text-muted shrink-0 select-none";
            grip.textContent = "drag_indicator";
            grip.setAttribute("aria-hidden", "true");
            btn.appendChild(grip);
          }
          btn.title = label;
          btn.setAttribute("aria-label", label);
          const text = document.createElement("span");
          text.className = "seqh-slot__text";
          text.title = label;
          text.textContent = label;
          btn.appendChild(text);

          btn.addEventListener("mouseenter", () => {
            if (text.scrollHeight > text.clientHeight + 2 || text.scrollWidth > text.clientWidth + 2) {
              showHierarchySlotPopover(btn, label);
            }
          });
          btn.addEventListener("mouseleave", hideHierarchySlotPopover);
          btn.addEventListener("focus", () => {
            if (text.scrollHeight > text.clientHeight + 2 || text.scrollWidth > text.clientWidth + 2) {
              showHierarchySlotPopover(btn, label);
            }
          });
          btn.addEventListener("blur", hideHierarchySlotPopover);

          if (!slotVerdict) {
            const remove = document.createElement("span");
            remove.className = "material-symbols-outlined text-[16px] text-text-muted shrink-0";
            remove.textContent = "close";
            remove.title = wt("sequenceui.remove_from_slot_tooltip", "Убрать из слота");
            remove.setAttribute("aria-hidden", "true");
            remove.addEventListener("click", hideHierarchySlotPopover);
            btn.appendChild(remove);
          }

          if (!editable) {
            btn.disabled = true;
          } else {
            let lastPlacedDragEndedAt = 0;
            btn.addEventListener("click", () => {
              hideHierarchySlotPopover();
              if (Date.now() - lastPlacedDragEndedAt < 160) return;
              state.selectedAvailableId = null;
              removeFromLevel(placementIdx, slotIdx);
            });
            setupSequencePointerDrag(btn, () => ({
              elemId: placedId,
              labelText: label,
              originElement: btn,
              onDragEnd: () => {
                lastPlacedDragEndedAt = Date.now();
              },
              onDrop: (targetSlot, dropRect, isSidebarDrop) => {
                lastPlacedDragEndedAt = Date.now();
                if (isSidebarDrop) {
                  removeFromLevel(placementIdx, slotIdx, dropRect);
                  return;
                }
                if (targetSlot) {
                  const targetIdx = parseInt(targetSlot.dataset.sequenceuiLevelIdx, 10);
                  const targetSlotIdx = parseInt(targetSlot.dataset.sequenceuiSlotIdx, 10);
                  if (targetIdx === placementIdx && targetSlotIdx === slotIdx) {
                    btn.style.opacity = "";
                    btn.style.transform = "";
                    return;
                  }
                  movePlacedElement(placementIdx, slotIdx, targetIdx, targetSlotIdx, dropRect);
                  return;
                }
                btn.style.opacity = "";
                btn.style.transform = "";
              },
            }));
          }
          slotsWrap.appendChild(btn);
        } else {
          if (verdictCtx && expectedText) {
            const missedSlot = document.createElement("div");
            missedSlot.className = "seqh-slot seqh-slot--missed";
            missedSlot.dataset.sequenceuiSlot = "true";
            missedSlot.dataset.sequenceuiLevelIdx = String(placementIdx);
            missedSlot.dataset.sequenceuiSlotIdx = String(slotIdx);

            if (totalSlots > 1) {
              const missedHead = document.createElement("div");
              missedHead.className =
                "flex items-center gap-1.5 text-[11px] font-semibold text-warning-text dark:text-warning-light";
              const warnIcon = document.createElement("span");
              warnIcon.className = "material-symbols-outlined text-[14px] select-none";
              warnIcon.textContent = "warning";
              warnIcon.setAttribute("aria-hidden", "true");
              const missedLabel = document.createElement("span");
              missedLabel.textContent = wt("seq.diff_missed_label", "Пропущен этап");
              missedHead.appendChild(warnIcon);
              missedHead.appendChild(missedLabel);
              missedSlot.appendChild(missedHead);
            }

            const refRow = document.createElement("div");
            refRow.className = "flex items-start gap-1.5 text-xs font-medium text-text-main dark:text-text-on-dark";
            const refPrefix = document.createElement("span");
            refPrefix.className = "text-[11px] font-bold text-text-muted shrink-0 mt-0.5";
            refPrefix.textContent = wt("seq.diff_expected_prefix", "Эталон:");
            const refText = document.createElement("span");
            refText.className = "leading-snug";
            refText.title = expectedText;
            refText.textContent = expectedText;
            refRow.appendChild(refPrefix);
            refRow.appendChild(refText);
            missedSlot.appendChild(refRow);

            slotsWrap.appendChild(missedSlot);
            continue;
          }

          const slot = document.createElement("button");
          slot.type = "button";
          slot.dataset.sequenceuiSlot = "true";
          slot.dataset.sequenceuiLevelIdx = String(placementIdx);
          slot.dataset.sequenceuiSlotIdx = String(slotIdx);
          slot.className =
            "seq-slot-target seqh-slot seqh-slot--empty focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
          slot.setAttribute(
            "aria-label",
            wt("sequenceui.place_selected_element_aria", "Разместить выбранный элемент в этот слот")
          );
          if (editable && state.selectedAvailableId) {
            slot.textContent = wt("sequenceui.place_btn", "Разместить");
            slot.addEventListener("click", () => {
              placeSelectedIntoLevel(placementIdx, slotIdx);
            });
          } else {
            slot.textContent = wt("sequenceui.slot_empty_label", "Пусто");
            if (!editable) slot.disabled = true;
          }
          slotsWrap.appendChild(slot);
        }
      }

      if (!card._hasPathListeners) {
        card._hasPathListeners = true;
        card.addEventListener("mouseenter", () => highlightHierarchyPath(node.node_id));
        card.addEventListener("mouseleave", () => highlightHierarchyPath(null));
        card.addEventListener("focusin", () => highlightHierarchyPath(node.node_id));
        card.addEventListener("focusout", () => highlightHierarchyPath(null));
      }
    }

    function canPatchHierarchyInPlace(shell, referenceView) {
      if (!shell) return false;
      if (shell.dataset.referenceView !== String(referenceView)) return false;
      if (shell.dataset.colorDiff !== (colorDifferentiation ? "true" : "false")) return false;
      const wasChecked = shell.dataset.checked === "true";
      if (wasChecked !== isCheckedState()) return false;
      const grid = shell.querySelector(".seqh-grid");
      if (!grid) return false;
      for (let i = 0; i < hierarchyNodes.length; i++) {
        const node = hierarchyNodes[i];
        if (!grid.querySelector(`.seqh-node[data-node-id="${node.node_id}"]`)) {
          return false;
        }
      }
      return true;
    }

    function renderHierarchyLevels() {
      const prevViewport = levelsContainer.querySelector(".seqh-viewport");
      if (prevViewport) {
        hierarchyState.scrollLeft = prevViewport.scrollLeft;
        hierarchyState.scrollTop = prevViewport.scrollTop;
      }

      const referenceView = isReferenceView();
      const model = getCurrentRenderModel();
      const levels = model.levels;
      const placements = model.placements;
      const verdictCtx = getHierarchyVerdictContext();
      const editable = canEdit();

      const refModel = isCheckedState() ? buildHierarchyReferenceModel() : null;
      const refPlacementByNodeId = new Map();
      if (refModel && Array.isArray(refModel.placements)) {
        refModel.placements.forEach((p) => {
          if (p && p.node_id != null) {
            refPlacementByNodeId.set(String(p.node_id), p);
          }
        });
      }

      const existingShell = levelsContainer.querySelector(".seqh-shell");
      if (canPatchHierarchyInPlace(existingShell, referenceView)) {
        existingShell.dataset.mode = state.mode;
        existingShell.dataset.checked = isCheckedState() ? "true" : "false";
        const prevHeights = new Map();
        if (!isMotionReduced()) {
          const oldNodes = existingShell.querySelectorAll(".seqh-node[data-node-id]");
          oldNodes.forEach((node) => {
            const id = node.getAttribute("data-node-id");
            if (id && node.offsetHeight > 0) {
              prevHeights.set(id, node.offsetHeight);
            }
          });
        }

        renderToolbar();

        hierarchyNodes.forEach((node, placementIdx) => {
          const card = existingShell.querySelector(`.seqh-node[data-node-id="${node.node_id}"]`);
          if (card) {
            populateHierarchyNodeCard(
              card,
              node,
              placementIdx,
              model,
              refPlacementByNodeId,
              verdictCtx,
              editable,
              referenceView,
              refModel
            );
          }
        });

        levels.forEach((lvl) => {
          const levelId = String(lvl.level_id);
          const tier = existingShell.querySelector(`.seqh-tier[data-tier-id="${levelId}"]`);
          if (tier) {
            const input = tier.querySelector(".seqh-tier__input");
            if (input && input.value !== safeText(lvl.label)) {
              input.value = safeText(lvl.label);
            }
          }
        });

        applyHierarchyTierFocus(state.selectedAvailableId);
        animateHierarchyHeightTransitions(prevHeights);
        requestAnimationFrame(() => {
          renderHierarchyConnectors();
          syncHierarchyTierColumn();
          updateHierarchyMinimap();
        });
        return;
      }

      const prevHeights = new Map();
      if (!isMotionReduced()) {
        const oldNodes = levelsContainer.querySelectorAll(".seqh-node[data-node-id]");
        oldNodes.forEach((node) => {
          const id = node.getAttribute("data-node-id");
          if (id && node.offsetHeight > 0) {
            prevHeights.set(id, node.offsetHeight);
          }
        });
      }

      levelsContainer.innerHTML = "";
      levelNameInputById.clear();

      if (isCheckedState()) {
        sidebar.classList.add("hidden");
        main.className = "min-w-0 col-span-full flex min-h-[220px] flex-col gap-3";
        layout.className = "grid min-h-0 gap-4 grid-cols-1";
      } else if (!requiresBlockNames && difficulty !== 3) {
        sidebar.classList.remove("hidden");
        main.className = "min-w-0 lg:col-span-2 xl:col-span-3 flex min-h-[220px] flex-col gap-3";
        layout.className = "grid min-h-0 gap-4 items-start lg:grid-cols-3 xl:grid-cols-4";
      }

      const shell = document.createElement("div");
      shell.className = "seqh-shell";
      shell.dataset.sequenceui = "hierarchy-shell";
      shell.dataset.colorDiff = colorDifferentiation ? "true" : "false";
      shell.dataset.referenceView = String(referenceView);
      shell.dataset.mode = state.mode;
      shell.dataset.checked = isCheckedState() ? "true" : "false";
      if (state.mode === "checked_success" || state.mode === "final_review") {
        shell.style.opacity = "0.97";
      }

      // ---- Toolbar: pan hint + zoom/fit/minimap controls ----
      const toolbar = document.createElement("div");
      toolbar.className = "seqh-toolbar";
      const hintText = document.createElement("span");
      hintText.className = "seqh-toolbar__hint";
      hintText.textContent = wt(
        "seq.canvas_pan_hint",
        "Панорама: перетаскивание • Зум: колесо"
      );
      const tools = document.createElement("div");
      tools.className = "seqh-toolbar__tools";
      const zoomOutBtn = makeHierarchyToolButton("remove", wt("seq.zoom_out", "Отдалить"));
      zoomOutBtn.dataset.seqhTool = "zoom-out";
      const zoomSlider = document.createElement("input");
      zoomSlider.type = "range";
      zoomSlider.className = "seqh-zoom-slider";
      zoomSlider.min = String(Math.round(HIERARCHY_MIN_ZOOM * 100));
      zoomSlider.max = String(Math.round(HIERARCHY_MAX_ZOOM * 100));
      zoomSlider.step = "1";
      zoomSlider.value = String(Math.round(hierarchyState.zoom * 100));
      zoomSlider.setAttribute("aria-label", wt("seq.zoom_slider", "Масштаб холста"));
      zoomSlider.title = wt("seq.zoom_slider", "Масштаб холста");
      const zoomInBtn = makeHierarchyToolButton("add", wt("seq.zoom_in", "Приблизить"));
      zoomInBtn.dataset.seqhTool = "zoom-in";
      const zoomLabel = document.createElement("span");
      zoomLabel.className = "seqh-zoom-label";
      zoomLabel.setAttribute("aria-live", "polite");
      zoomLabel.textContent = `${Math.round(hierarchyState.zoom * 100)}%`;
      const fitBtn = makeHierarchyToolButton("fit_screen", wt("seq.zoom_fit", "Вписать в экран"));
      fitBtn.dataset.seqhTool = "fit";
      const mapBtn = makeHierarchyToolButton("map", wt("seq.minimap_toggle", "Миникарта схемы"));
      mapBtn.dataset.seqhTool = "minimap";
      mapBtn.setAttribute("aria-pressed", hierarchyState.minimapVisible ? "true" : "false");
      if (hierarchyState.minimapVisible) mapBtn.classList.add("is-active");
      zoomOutBtn.addEventListener("click", () => zoomHierarchyFromCenter(-0.1));
      zoomInBtn.addEventListener("click", () => zoomHierarchyFromCenter(0.1));
      zoomSlider.addEventListener("input", (e) => {
        applyHierarchyZoom(Number(e.target.value) / 100);
      });
      fitBtn.addEventListener("click", () => fitHierarchyCanvas());
      mapBtn.addEventListener("click", () => {
        hierarchyState.minimapVisible = !hierarchyState.minimapVisible;
        updateHierarchyMinimap();
      });
      [zoomOutBtn, zoomSlider, zoomInBtn, zoomLabel, fitBtn, mapBtn].forEach((el) => tools.appendChild(el));
      toolbar.appendChild(hintText);
      toolbar.appendChild(comparisonToolbar);
      toolbar.appendChild(tools);
      shell.appendChild(toolbar);

      // ---- Body: unified stage with integrated tier column ----
      const body = document.createElement("div");
      body.className = "seqh-body";

      const viewportWrap = document.createElement("div");
      viewportWrap.className = "seqh-viewport-wrap";
      const viewport = document.createElement("div");
      viewport.className = "seqh-viewport";
      viewport.tabIndex = 0;
      viewport.setAttribute("role", "region");
      viewport.setAttribute("aria-label", wt("se.canvas_header_col", "Холст схемы и связей"));
      const sizer = document.createElement("div");
      sizer.className = "seqh-sizer";
      const stage = document.createElement("div");
      stage.className = "seqh-stage";
      stage.style.transform = `scale(${hierarchyState.zoom})`;
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "seqh-svg");
      svg.setAttribute("aria-hidden", "true");
      stage.appendChild(svg);

      const grid = document.createElement("div");
      grid.className = "seqh-grid";
      grid.style.gridTemplateColumns = `220px repeat(${hierarchyLayout.totalCols}, minmax(280px, 340px))`;

      const hasColumnHeaders = !!(hierarchyLayout && hierarchyLayout.hasColumnHeaders);
      const rowShift = hasColumnHeaders ? 2 : 1;

      if (hasColumnHeaders) {
        const cornerSpacer = document.createElement("div");
        cornerSpacer.className = "seqh-grid-corner-spacer";
        cornerSpacer.style.gridColumn = "1 / 2";
        cornerSpacer.style.gridRow = "1";
        grid.appendChild(cornerSpacer);

        hierarchyLayout.roots.forEach((root, rIdx) => {
          const rootInfo = hierarchyLayout.byNodeId.get(root.node_id);
          if (!rootInfo) return;
          const colAccent = `var(--seqh-col-${rIdx % HIERARCHY_COL_COUNT})`;

          const colLane = document.createElement("div");
          colLane.className = "seqh-col-lane";
          colLane.dataset.colIdx = String(rIdx % HIERARCHY_COL_COUNT);
          colLane.style.setProperty("--seqh-col-accent", colAccent);
          colLane.style.gridColumn = `${rootInfo.colStart + 1} / span ${rootInfo.colSpan}`;
          colLane.style.gridRow = "1 / -1";
          grid.appendChild(colLane);

          const headerCell = document.createElement("div");
          headerCell.className = "seqh-col-header-cell";
          headerCell.dataset.colIdx = String(rIdx);
          headerCell.style.setProperty("--seqh-col-accent", colAccent);
          headerCell.style.gridColumn = `${rootInfo.colStart + 1} / span ${rootInfo.colSpan}`;
          headerCell.style.gridRow = "1";

          const header = document.createElement("div");
          header.className = "seqh-col-header";
          header.style.setProperty("--seqh-col-accent", colAccent);

          const badge = document.createElement("span");
          badge.className = "seqh-col-badge";
          badge.textContent = `${toRoman(rIdx + 1)} ${wt("seq.col_badge_label", "КОЛОНКА")}`;
          header.appendChild(badge);

          const titleText = root.columnTitle || wt("seq.col_default_title", "Колонка {num}").replace("{num}", toRoman(rIdx + 1));
          const title = document.createElement("div");
          title.className = "seqh-col-title";
          title.textContent = titleText;
          title.title = titleText;
          header.appendChild(title);

          headerCell.appendChild(header);
          grid.appendChild(headerCell);
        });
      }

      levels.forEach((lvl, tierIdx) => {
        const levelId = String(lvl.level_id);
        const tint = String(tierIdx % HIERARCHY_TINT_COUNT);

        const band = document.createElement("div");
        band.className = "seqh-band";
        band.dataset.tierId = levelId;
        band.style.gridColumn = "1 / -1";
        band.style.gridRow = String(tierIdx + rowShift);
        if (colorDifferentiation) {
          band.dataset.tint = tint;
          band.style.setProperty("--seqh-tint", `var(--seqh-tint-${tint})`);
        }
        grid.appendChild(band);

        const tierCell = document.createElement("div");
        tierCell.className = "seqh-tier-cell seqh-tiers";
        tierCell.style.gridColumn = "1 / 2";
        tierCell.style.gridRow = String(tierIdx + rowShift);

        const tier = document.createElement("div");
        tier.className = "seqh-tier";
        tier.dataset.tierId = levelId;
        if (colorDifferentiation) {
          tier.dataset.tint = tint;
          tier.style.setProperty("--seqh-tint", `var(--seqh-tint-${tint})`);
        }

        const head = document.createElement("div");
        head.className = "seqh-tier__head";
        const indexBadge = document.createElement("span");
        indexBadge.className = "seqh-tier__index";
        indexBadge.dataset.sequenceui = "level-index-badge";
        indexBadge.textContent = String(tierIdx + 1);
        head.appendChild(indexBadge);

        if (hierarchyTierNamesTyped && !referenceView) {
          const nameVerdict =
            verdictCtx && verdictCtx.matchedTiers.has(levelId)
              ? "correct"
              : verdictCtx && verdictCtx.unmatchedTiers.has(levelId)
                ? "incorrect"
                : null;
          if (nameVerdict) tier.dataset.verdict = nameVerdict;
          const hasContent = state.placements.some(
            (placement) =>
              String(placement.level_id) === levelId && getMeaningfulBlockIdsForPlacement(placement).length > 0
          );
          const input = document.createElement("input");
          input.type = "text";
          const inputPlaceholder = wt("seq.tier_input_placeholder", "Введите название уровня {num}...").replace(
            "{num}",
            String(tierIdx + 1)
          );
          input.placeholder = inputPlaceholder;
          input.setAttribute("aria-label", inputPlaceholder);
          input.value = safeText(lvl.label);
          input.dataset.sequenceuiLevelNameInput = levelId;
          const isMissing = invalidLevelNameIds.has(levelId) && hasContent;
          input.className = "seqh-tier__input" + (isMissing ? " is-invalid" : "");
          input.setAttribute("aria-invalid", isMissing ? "true" : "false");
          input.disabled = !editable;
          input.addEventListener("input", () => {
            lvl.label = input.value;
            if (input.value.trim()) {
              invalidLevelNameIds.delete(levelId);
              input.classList.remove("is-invalid");
              input.setAttribute("aria-invalid", "false");
            }
            renderHierarchyTabs(isReferenceView() ? [] : state.available.slice());
          });
          levelNameInputById.set(levelId, input);
          tier.appendChild(head);
          tier.appendChild(input);
        } else {
          const name = document.createElement("span");
          name.className = "seqh-tier__name";
          const nameText = safeText(lvl.label) || levelId;
          name.textContent = nameText;
          name.title = nameText;
          head.appendChild(name);
          tier.appendChild(head);
        }
        tierCell.appendChild(tier);
        grid.appendChild(tierCell);
      });

      hierarchyNodes.forEach((node, placementIdx) => {
        const info = hierarchyLayout.byNodeId.get(node.node_id);
        if (!info) return;

        const cell = document.createElement("div");
        cell.className = "seqh-node-cell";
        cell.style.gridColumn = `${info.colStart + 1} / span ${info.colSpan}`;
        cell.style.gridRow = String(info.tierIdx + rowShift);

        const card = document.createElement("div");
        populateHierarchyNodeCard(
          card,
          node,
          placementIdx,
          model,
          refPlacementByNodeId,
          verdictCtx,
          editable,
          referenceView,
          refModel
        );

        cell.appendChild(card);
        grid.appendChild(cell);
      });

      stage.appendChild(grid);
      sizer.appendChild(stage);
      viewport.appendChild(sizer);
      viewportWrap.appendChild(viewport);

      // ---- Minimap + hint overlays (outside the scrolled content) ----
      const minimap = document.createElement("div");
      minimap.className = "seqh-minimap is-hidden";
      minimap.dataset.sequenceui = "hierarchy-minimap";
      const miniSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      miniSvg.setAttribute("class", "seqh-minimap__svg");
      miniSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      miniSvg.setAttribute("aria-hidden", "true");
      const miniView = document.createElement("div");
      miniView.className = "seqh-minimap__view";
      minimap.appendChild(miniSvg);
      minimap.appendChild(miniView);
      const navigateFromMinimap = (evt) => {
        const rect = minimap.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const size = getHierarchyContentSize();
        const fx = Math.min(1, Math.max(0, (evt.clientX - rect.left) / rect.width));
        const fy = Math.min(1, Math.max(0, (evt.clientY - rect.top) / rect.height));
        viewport.scrollLeft = Math.max(0, fx * size.w - viewport.clientWidth / 2);
        viewport.scrollTop = Math.max(0, fy * size.h - viewport.clientHeight / 2);
      };
      minimap.addEventListener("pointerdown", (evt) => {
        evt.preventDefault();
        minimap.classList.add("is-interacting");
        navigateFromMinimap(evt);
        const onMove = (moveEvt) => navigateFromMinimap(moveEvt);
        const onUp = () => {
          minimap.classList.remove("is-interacting");
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
      viewportWrap.appendChild(minimap);

      const hint = document.createElement("div");
      hint.className = "seqh-hint";
      hint.setAttribute("role", "status");
      hint.setAttribute("aria-live", "polite");
      viewportWrap.appendChild(hint);

      body.appendChild(viewportWrap);
      shell.appendChild(body);
      levelsContainer.appendChild(shell);

      // ---- Viewport interactions: background panning + Ctrl/Cmd wheel zoom ----
      viewport.addEventListener("scroll", () => {
        updateHierarchyMinimap();
      });
      viewport.addEventListener("pointerdown", (evt) => {
        if (evt.button !== 0 && evt.pointerType === "mouse") return;
        const target = evt.target;
        if (
          target &&
          target.closest &&
          target.closest('button, input, textarea, .seqh-node, [data-sequenceui-slot="true"], [data-sequenceui-placed-item="true"]')
        ) {
          return;
        }
        const startX = evt.clientX;
        const startY = evt.clientY;
        const startLeft = viewport.scrollLeft;
        const startTop = viewport.scrollTop;
        viewport.classList.add("is-panning");
        const onMove = (moveEvt) => {
          viewport.scrollLeft = startLeft - (moveEvt.clientX - startX);
          viewport.scrollTop = startTop - (moveEvt.clientY - startY);
        };
        const onUp = () => {
          viewport.classList.remove("is-panning");
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
      });
      viewport.addEventListener(
        "wheel",
        (evt) => {
          if (!evt.ctrlKey && !evt.metaKey) return;
          evt.preventDefault();
          zoomHierarchyAt(hierarchyState.zoom + (evt.deltaY < 0 ? 0.1 : -0.1), evt.clientX, evt.clientY);
        },
        { passive: false }
      );

      applyHierarchyTierFocus(state.selectedAvailableId);
      applyHierarchyZoom(hierarchyState.zoom);
      animateHierarchyHeightTransitions(prevHeights);
      renderHierarchyConnectors();
      requestAnimationFrame(layoutHierarchyCanvas);
    }

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

      if (isHierarchy) {
        comparisonToggle.classList.add("hidden");
        comparisonStatus.textContent = wt(
          "seq.debriefing_title",
          "Разбор решения: верные шаги, исправления и пропущенные этапы"
        );
      } else {
        comparisonToggle.classList.remove("hidden");
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
            ? wt("sequenceui.ref_shown_desc", "Показан эталонный вариант.")
            : wt("sequenceui.user_answer_shown_desc", "Показан ваш ответ с отметками проверки.");
      }
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
          if (isHierarchy) {
            restoreHierarchyInput(draft);
          } else {
            restoreFixedLevels(draftLevels);
          }
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
      requestAnimationFrame(updateAvailableScrollMask);
    }

    maybeShuffleLevelsOnInit();
    ensureModeByPlacements();
    renderAll();
    containerElement.appendChild(root);
    syncAvailableSidebarStickyMode();

    const onResize = () => {
      syncAvailableSidebarStickyMode();
      requestAnimationFrame(refreshScrollablePanels);
      requestAnimationFrame(updateAvailableScrollMask);
      if (isHierarchy) {
        requestAnimationFrame(() => {
          renderHierarchyConnectors();
          syncHierarchyTierColumn();
        });
      }
    };
    window.addEventListener("resize", onResize);

    return {
      getUserAnswerPayload() {
        if (isHierarchy) {
          return buildHierarchyAnswerPayload();
        }
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
          hierarchy_zoom: isHierarchy ? hierarchyState.zoom : undefined,
          hierarchy_active_tab: isHierarchy ? hierarchyState.activeTab : undefined,
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

        if (isHierarchy) {
          const restoredZoom = Number(viewState.hierarchy_zoom);
          if (Number.isFinite(restoredZoom) && restoredZoom > 0) {
            hierarchyState.zoom = clampHierarchyZoom(restoredZoom);
            hierarchyState.fitted = true;
          }
          const restoredTab = Number(viewState.hierarchy_active_tab);
          if (Number.isInteger(restoredTab) && restoredTab >= 0) {
            hierarchyState.activeTab = restoredTab;
          }
        }
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
          if (!isHierarchy && difficulty === 1 && levelOrderMatters) {
            const d = state.lastRawResultDetails;
            const orderOk = d && typeof d === "object" ? d.levels_in_correct_order === true : null;
            if (!success && orderOk === false) {
              levelsHint.textContent = wt("sequenceui.level_order_incorrect_hint", "Порядок уровней неверный. Переставьте уровни и проверьте снова.");
            } else {
              // Восстанавливаем базовую подсказку (как при инициализации)
              levelsHint.textContent = "";
              if (requiresBlockNames || difficulty === 3) {
                levelsHint.appendChild(document.createTextNode(wt("sequenceui.base_prompt_enter_names", "Введите названия элементов и уровней.")));
              } else {
                levelsHint.appendChild(
                  document.createTextNode(wt("sequenceui.base_prompt_select_and_click", "Выберите элемент справа, затем кликните на пустой слот для размещения."))
                );
              }
              if (sequenceWithinLevelMatters) {
                levelsHint.appendChild(document.createTextNode(" "));
                const strong = document.createElement("strong");
                strong.className = "font-bold text-text-secondary dark:text-text-on-dark";
                strong.textContent = wt("sequenceui.settings_elements_order_matters", "Порядок элементов важен.");
                levelsHint.appendChild(strong);
              }
              levelsHint.appendChild(document.createTextNode(" "));
              const strong = document.createElement("strong");
              strong.className = "font-bold text-text-secondary dark:text-text-on-dark";
              strong.textContent = wt("sequenceui.settings_level_order_matters", "Порядок уровней важен.");
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
        if (isHierarchy) {
          requestAnimationFrame(() => fitHierarchyCanvas());
        }
      },
      cleanup() {
        stopHierarchyDragAutoScroll();
        if (hierarchyState.heightAnimRaf) {
          cancelAnimationFrame(hierarchyState.heightAnimRaf);
          hierarchyState.heightAnimRaf = null;
        }
        if (hierarchyState.hintTimer) {
          clearTimeout(hierarchyState.hintTimer);
          hierarchyState.hintTimer = null;
        }
        window.removeEventListener("resize", onResize);
        if (availableList) {
          availableList.removeEventListener("scroll", updateAvailableScrollMask);
        }
        if (root && root.parentElement) {
          root.remove();
        }
      },
      movePlacedElement,
      removeFromLevel,
      placeElementIntoLevel,
      placeSelectedIntoLevel,
    };
  }

  return {
    __testHooks: {
      normalizeTaskData,
      resolveCheckedCorrectBlocksByLevel,
      normalizeHierarchyNodes,
      computeHierarchyGridLayout,
      buildRoundedElbowPath,
      clampHierarchyZoom,
      getCurrentInstance: () => currentInstance,
    },
    render(containerElement, task) {
      if (currentInstance && typeof currentInstance.cleanup === "function") {
        currentInstance.cleanup();
      }
      if (containerElement && containerElement.innerHTML) {
        containerElement.innerHTML = "";
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

if (typeof window !== "undefined") {
  window.SequenceUI = SequenceUI;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = SequenceUI;
}


