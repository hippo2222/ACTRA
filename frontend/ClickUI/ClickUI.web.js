(function (global) {
  console.log('[ClickUI] v20260523-2 loaded');
  const ClickUI = {};

  function wt(key, fallback) {
    if (!window.i18n || typeof window.i18n.t !== "function") return fallback;
    const v = window.i18n.t(key);
    return v !== key ? v : fallback;
  }

  const CLICKUI_BUILD_ID = "2025-12-18T20:52:00Z";
  try {
    if (global && global.console && typeof global.console.log === "function") {
      global.console.log("[ClickUI] build", CLICKUI_BUILD_ID);
    }
  } catch (e) {
    // ignore
  }

  const state = {
    taskDto: null,
    container: null,
    root: null,
    img: null,
    imageWrapper: null,
    viewport: null,
    contentLayer: null,
    markerLayer: null,
    drawLayer: null,
    refLayer: null,
    clicks: [],
    polygons: [],
    lines: [],
    actionHistory: [],
    autoBrushFromClicks: false,
    maxClicks: 0,
    maxPolygons: 0,
    maxStrokes: 0,
    foundClickTargets: null,
    tempHintTimer: null,
    locked: false,
    mode: "click",
    zoom: 1,
    panX: 0,
    panY: 0,
    isPointerDown: false,
    panStart: null,
    activeStroke: null,
    showRef: false,
    showRefContours: true,
    showRefPolygons: true,
    showRefLines: true,
    showRefLabels: true,
    showUserMarks: true,
    userLinesCheckedStyle: false,
    userMarksCheckedStyle: false,
    badRefTargets: null,
    labelsContainer: null,
    labelOverlay: null,
    labelsInputs: [],
    labelsClicks: [],
    labelsPolygons: [],
    labelsLines: [],
    highlightLabelErrors: false,
    labelEval: null,
    soloDuringDraw: false,
    additionalModal: null,
    additionalModalKeyHandler: null,
    targetColors: [],
    targetRows: [],
    targetsProgress: null,
    userActionsListEl: null,
    userActionRows: [],
    actionInterpretation: null,
    actionInterpretationActive: false,
    hoveredActionKey: null,
    pendingViewState: null,
    undoAttentionTimer: null,
    targetsAttentionTimer: null,
    labelsRemovalTimer: null,
    targetsInstructionEl: null,
    targetsPanelTitleEl: null,
    targetsListSectionEl: null,
    outlineVerbEls: [],
    reviewHost: null,
    reviewComparisonEl: null,
    runtimeMode: false,
    globalHoveredInfo: null,
  };

  function _getThemeColor(varName, fallback) {
    try {
      if (typeof document === "undefined" || !document.documentElement) return fallback;
      const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      return value || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function _parseRgb(color) {
    if (!color) return null;
    const value = String(color).trim();
    if (!value) return null;
    if (value.startsWith("#")) {
      const raw = value.slice(1);
      const normalized =
        raw.length === 3
          ? raw
              .split("")
              .map((c) => c + c)
              .join("")
          : raw;
      if (normalized.length < 6) return null;
      const int = parseInt(normalized.slice(0, 6), 16);
      if (Number.isNaN(int)) return null;
      return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
    }
    const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!match) return null;
    return {
      r: Math.round(parseFloat(match[1])),
      g: Math.round(parseFloat(match[2])),
      b: Math.round(parseFloat(match[3])),
    };
  }

  const TARGET_COLOR_PALETTE = [
    { varName: "--color-primary", fallback: "#2563eb" },
    { varName: "--color-error", fallback: "#dc2626" },
    { varName: "--color-success", fallback: "#16a34a" },
    { varName: "--color-accent", fallback: "#9333ea" },
    { varName: "--color-warning", fallback: "#ea580c" },
    { varName: "--color-info", fallback: "#0d9488" },
    { varName: "--color-secondary", fallback: "#c026d3" },
  ];

  function _assignTargetColors(taskDto) {
    const targets = _getTargets(taskDto);
    if (!Array.isArray(targets) || !targets.length) {
      state.targetColors = [];
      return;
    }
    const palette = TARGET_COLOR_PALETTE.map((entry) =>
      _getThemeColor(entry.varName, entry.fallback)
    );
    state.targetColors = targets.map((_, idx) => palette[idx % palette.length]);
  }

  function _getTargetColor(idx) {
    if (!Array.isArray(state.targetColors) || !state.targetColors.length) {
      const entry = TARGET_COLOR_PALETTE[idx % TARGET_COLOR_PALETTE.length];
      return _getThemeColor(entry.varName, entry.fallback);
    }
    return state.targetColors[idx % state.targetColors.length];
  }

  function _withAlpha(color, alpha) {
    const rgb = _parseRgb(color);
    const clamped = Math.max(0, Math.min(1, alpha));
    if (!rgb) return `rgba(0,0,0,${clamped})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
  }

  function _updateTargetsProgressUI() {
    if (!state.targetsProgress) return;
    const total = state.targetsProgress.total || 0;
    const found =
      state.foundClickTargets instanceof Set ? state.foundClickTargets.size : 0;
    const isConfirmedProgress = state.locked === true;
    const isDrawingTask = _taskRequiresDrawing(state.taskDto);
    const clicksLimit =
      Number.isFinite(state.maxClicks) && state.maxClicks > 0 ? state.maxClicks : total;
    const usedClicks = Math.min(Array.isArray(state.clicks) ? state.clicks.length : 0, clicksLimit || 0);
    let titleText = wt("clickui.progress_search", "Прогресс поиска");
    let labelText = total ? wt("clickui.found_of", "Найдено {found} из {total}").replace("{found}", found).replace("{total}", total) : wt("clickui.no_targets", "Цели отсутствуют");
    let percent = total ? Math.min(100, Math.round((found / total) * 100)) : 0;

    if (!isConfirmedProgress && !isDrawingTask) {
      titleText = wt("clickui.available_clicks", "Доступные клики");
      labelText = clicksLimit ? wt("clickui.used_of", "Использовано {used} из {limit}").replace("{used}", usedClicks).replace("{limit}", clicksLimit) : wt("clickui.no_clicks", "Клики отсутствуют");
      percent = clicksLimit ? Math.min(100, Math.round((usedClicks / clicksLimit) * 100)) : 0;
    }
    if (state.targetsProgress.titleEl) {
      state.targetsProgress.titleEl.textContent = titleText;
    }
    if (state.targetsProgress.labelEl) {
      state.targetsProgress.labelEl.textContent = labelText;
    }
    if (state.targetsProgress.barEl) {
      state.targetsProgress.barEl.style.width = `${percent}%`;
    }
    return;
    if (state.targetsProgress.labelEl) {
      state.targetsProgress.labelEl.textContent = total
        ? wt("clickui.found_of", "Найдено {found} из {total}").replace("{found}", found).replace("{total}", total)
        : wt("clickui.no_targets", "Цели отсутствуют");
    }
    if (state.targetsProgress.barEl) {
      const percent = total ? Math.min(100, Math.round((found / total) * 100)) : 0;
      state.targetsProgress.barEl.style.width = `${percent}%`;
    }
  }

  function _syncFoundTargetsUI() {
    _updateTargetsProgressUI();
    _refreshTargetRowsState();
    if (typeof state._updateLiveProgress === "function") {
      state._updateLiveProgress();
    }
  }

  function _normalizeFoundTargetsSet(foundTargets) {
    const next = new Set();
    if (foundTargets instanceof Set) {
      foundTargets.forEach((idx) => {
        if (typeof idx === "number" && Number.isInteger(idx) && idx >= 0) {
          next.add(idx);
        }
      });
      return next;
    }
    if (!Array.isArray(foundTargets)) return next;
    foundTargets.forEach((entry) => {
      if (typeof entry === "number" && Number.isInteger(entry) && entry >= 0) {
        next.add(entry);
        return;
      }
      if (!entry || typeof entry !== "object") return;
      const idx =
        typeof entry.target_index === "number"
          ? entry.target_index
          : typeof entry.targetIndex === "number"
            ? entry.targetIndex
            : null;
      if (idx !== null && Number.isInteger(idx) && idx >= 0) {
        next.add(idx);
      }
    });
    return next;
  }

  function _rebuildFoundTargetsFromClicks() {
    state.foundClickTargets = new Set();
    try {
      const clicks = Array.isArray(state.clicks) ? state.clicks : [];
      for (const click of clicks) {
        const hit = _checkClickHit(click && click.x, click && click.y);
        if (hit && hit.hit && state.foundClickTargets) {
          state.foundClickTargets.add(hit.targetIndex);
        }
      }
    } catch (e) {
      // ignore
    }
  }

  function _refreshTargetRowsState() {
    if (!Array.isArray(state.targetRows)) return;
    const isConfirmedProgress = state.locked === true;
    const foundSet =
      state.foundClickTargets instanceof Set ? state.foundClickTargets : new Set();
    const badSet = state.badRefTargets instanceof Set ? state.badRefTargets : new Set();
    state.targetRows.forEach((entry) => {
      if (!entry || !entry.el) return;
      const { idx, el, badge, statusPill } = entry;
      el.classList.remove(
        "ring-2",
        "ring-success-light",
        "bg-success-lighter",
        "ring-error-light",
        "bg-error-lighter"
      );
      if (badge) {
        badge.classList.remove(
          "border-success-light",
          "bg-success-lighter",
          "text-success-text",
          "border-error-light",
          "bg-error-lighter",
          "text-error-text"
        );
        badge.textContent = String(idx + 1);
      }
      if (statusPill) {
        statusPill.className = "hidden";
        statusPill.textContent = "";
      }
      if (isConfirmedProgress && foundSet.has(idx)) {
        el.classList.add("ring-2", "ring-success-light", "bg-success-lighter");
        if (badge) badge.textContent = "✓";
        if (badge) {
          badge.textContent = String(idx + 1);
          badge.classList.add("border-success-light", "bg-success-lighter", "text-success-text");
        }
        if (statusPill) {
          statusPill.className =
            "inline-flex items-center rounded-full border border-success-light bg-success-lighter px-2 py-0.5 text-[11px] font-semibold text-success-text";
          statusPill.textContent = wt("clickui.status_found", "Найдена");
        }
      } else {
        if (badge) badge.textContent = String(idx + 1);
        if (isConfirmedProgress && badSet.has(idx)) {
          el.classList.add("ring-2", "ring-error-light", "bg-error-lighter");
          if (badge) {
            badge.classList.add("border-error-light", "bg-error-lighter", "text-error-text");
          }
          if (statusPill) {
            statusPill.className =
              "inline-flex items-center rounded-full border border-error-light bg-error-lighter px-2 py-0.5 text-[11px] font-semibold text-error-text";
            statusPill.textContent = wt("clickui.status_check", "Проверь");
          }
        }
      }
    });
  }

  function _refreshTargetRowColors() {
    if (!Array.isArray(state.targetRows)) return;
    state.targetRows.forEach((entry) => {
      if (!entry) return;
      const color = _getTargetColor(entry.idx || 0);
      if (entry.badge) {
        entry.badge.style.backgroundColor = color;
        entry.badge.style.color = _getThemeColor("--color-text-on-dark", "#ffffff");
        entry.badge.style.borderColor = _withAlpha(color, 0.4);
        entry.badge.style.boxShadow = `0 0 0 2px ${_withAlpha(color, 0.12)}`;
      }
      if (entry.icon) entry.icon.style.color = "";
      if (entry.dot) {
        entry.dot.style.backgroundColor = color;
        entry.dot.style.boxShadow = `0 0 0 2px ${_withAlpha(color, 0.18)}`;
      }
    });
  }

  function _getActionKey(kind, index) {
    return `${kind}:${index}`;
  }

  function _getActionKindLabel(kind) {
    if (kind === "click") return wt("clickui.kind_click", "Клик");
    if (kind === "polygon") return wt("clickui.kind_polygon", "Контур");
    return wt("clickui.kind_line", "Штрих");
  }

  function _getTargetLabelByIndex(targetIndex) {
    const targets = _getTargets(state.taskDto);
    if (!Array.isArray(targets) || targetIndex == null || targetIndex < 0 || targetIndex >= targets.length) {
      return "";
    }
    const target = targets[targetIndex];
    return String((target && target.label) || "").trim();
  }

  function _normalizePercentValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric > 0 && numeric <= 1 ? numeric * 100 : numeric;
  }

  function _formatPercentValue(value) {
    const numeric = _normalizePercentValue(value);
    if (!Number.isFinite(numeric)) return "";
    const rounded = Math.round(numeric * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
  }

  function _collectUserActions() {
    const actions = [];
    const itemsByKind = {
      click: Array.isArray(state.clicks) ? state.clicks : [],
      polygon: Array.isArray(state.polygons) ? state.polygons : [],
      line: Array.isArray(state.lines) ? state.lines : [],
    };
    const counters = { click: 0, polygon: 0, line: 0 };
    const used = {
      click: new Set(),
      polygon: new Set(),
      line: new Set(),
    };

    function pushAction(kind, index) {
      const source = itemsByKind[kind];
      if (!Array.isArray(source) || index < 0 || index >= source.length) return;
      used[kind].add(index);
      actions.push({
        key: _getActionKey(kind, index),
        kind,
        index,
        title: `${_getActionKindLabel(kind)} ${index + 1}`,
      });
    }

    const history = Array.isArray(state.actionHistory) ? state.actionHistory : [];
    history.forEach((entry) => {
      const kind = entry && typeof entry.kind === "string" ? entry.kind : "";
      if (kind !== "click" && kind !== "polygon" && kind !== "line") return;
      const index = counters[kind];
      counters[kind] += 1;
      pushAction(kind, index);
    });

    ["click", "polygon", "line"].forEach((kind) => {
      const source = itemsByKind[kind];
      for (let index = 0; index < source.length; index += 1) {
        if (used[kind].has(index)) continue;
        pushAction(kind, index);
      }
    });

    return actions;
  }

  function _setActionInterpretation(nextInterpretation, isActive) {
    state.actionInterpretation = nextInterpretation && typeof nextInterpretation === "object" ? nextInterpretation : null;
    state.actionInterpretationActive = isActive === true;
    if (!state.actionInterpretationActive) {
      state.actionInterpretation = null;
    }
  }

  function _resetActionInterpretation() {
    _setActionInterpretation(null, false);
    if (state.hoveredActionKey) {
      state.hoveredActionKey = null;
    }
    _syncUserActionRowsState();
  }

  function _getActionInterpretation(actionKey) {
    if (!state.actionInterpretation || typeof state.actionInterpretation !== "object") return null;
    const info = state.actionInterpretation[actionKey];
    return info && typeof info === "object" ? info : null;
  }

  function _describeActionInterpretation(action) {
    const interpretation = _getActionInterpretation(action.key);
    const isChecked = state.actionInterpretationActive === true;
    if (!interpretation) {
      if (isChecked) {
        return {
          tone: "neutral",
          statusText: wt("clickui.not_matched_status", "Не сопоставлено"),
          detailText: wt("clickui.not_matched_detail", "Система не нашла явного совпадения с целью."),
          color: null,
        };
      }
      return {
        tone: "pending",
        statusText: wt("clickui.pending_status", "Ожидает проверки"),
        detailText: wt("clickui.pending_detail", "Интерпретация появится после проверки."),
        color: null,
      };
    }

    const targetIndex =
      typeof interpretation.targetIndex === "number" && interpretation.targetIndex >= 0
        ? interpretation.targetIndex
        : null;
    const targetLabel = targetIndex != null ? _getTargetLabelByIndex(targetIndex) : "";
    const parts = [];
    if (targetIndex != null) {
      const targetRef = _getTargetDisplayReference(state.taskDto, targetIndex);
      const targetText = targetLabel ? `${targetRef} "${targetLabel}"` : targetRef;
      parts.push(targetText);
    } else {
      parts.push(wt("clickui.target_undefined", "Цель не определена"));
    }

    const coverageText = _formatPercentValue(interpretation.coverage);
    const thresholdText = _formatPercentValue(interpretation.threshold);
    if (coverageText && thresholdText) {
      parts.push(wt("clickui.coverage_of", "Совпадение {coverage} из {threshold}").replace("{coverage}", coverageText).replace("{threshold}", thresholdText));
    } else if (coverageText) {
      parts.push(wt("clickui.coverage_only", "Совпадение {coverage}").replace("{coverage}", coverageText));
    }

    const success =
      interpretation.success === true ||
      interpretation.click_success === true ||
      interpretation.polygon_success === true ||
      interpretation.line_success === true;
    const tone = success ? "success" : targetIndex != null ? "error" : "neutral";

    return {
      tone,
      statusText:
        targetIndex == null
          ? wt("clickui.not_matched_status", "Не сопоставлено")
          : success
            ? wt("clickui.status_counted", "Засчитано")
            : wt("clickui.status_not_counted", "Не засчитано"),
      detailText: parts.join(". "),
      color: targetIndex != null ? _getTargetColor(targetIndex) : null,
    };
  }

  function _syncUserActionRowsState() {
    if (!Array.isArray(state.userActionRows)) return;
    state.userActionRows.forEach((entry) => {
      if (!entry || !entry.el) return;
      entry.el.classList.remove("ring-1", "ring-primary", "shadow-md");
      if (state.hoveredActionKey === entry.key) {
        entry.el.classList.add("ring-1", "ring-primary", "shadow-md");
      }
    });
  }

  function _setHoveredActionKey(actionKey) {
    const nextKey = actionKey || null;
    if (state.hoveredActionKey === nextKey) return;
    state.hoveredActionKey = nextKey;
    _syncUserActionRowsState();
    _renderMarkers();
    _renderDrawing();
    if (nextKey) {
      const parts = nextKey.split(":");
      const targetIndex = _findTargetIndex(state.taskDto, parts[0], Number(parts[1]));
      _setGlobalHover({ targetIndex, actionKey: nextKey });
    } else {
      _setGlobalHover(null);
    }
  }

  function _buildActionInterpretationMap(details) {
    const map = Object.create(null);

    function assign(kind, matchedIndex, payload) {
      if (!Number.isInteger(matchedIndex) || matchedIndex < 0) return;
      map[_getActionKey(kind, matchedIndex)] = payload;
    }

    function hasAssignment(kind, matchedIndex) {
      if (!Number.isInteger(matchedIndex) || matchedIndex < 0) return false;
      return !!map[_getActionKey(kind, matchedIndex)];
    }

    const clickResults = Array.isArray(details && details.click_results) ? details.click_results : [];
    clickResults.forEach((result) => {
      if (!result || typeof result !== "object") return;
      const matchedIndex =
        typeof result.matched_click_idx === "number" ? result.matched_click_idx : null;
      if (matchedIndex == null) return;
      assign("click", matchedIndex, {
        targetIndex: typeof result.target_index === "number" ? result.target_index : null,
        success: result.click_success === true,
        coverage: result.coverage,
        threshold: result.threshold,
      });
    });

    const foundTargets = _normalizeFoundTargetsSet(
      (Array.isArray(details && details.found_targets) && details.found_targets) ||
      (Array.isArray(details && details.foundTargets) && details.foundTargets) ||
      null
    );
    if (foundTargets.size && Array.isArray(state.clicks) && state.clicks.length) {
      const usedTargetIndexes = new Set();
      clickResults.forEach((result) => {
        if (!result || typeof result !== "object") return;
        const targetIndex = typeof result.target_index === "number" ? result.target_index : null;
        if (targetIndex != null) usedTargetIndexes.add(targetIndex);
      });

      state.clicks.forEach((click, idx) => {
        if (!click || hasAssignment("click", idx)) return;
        const x = Number(click.x);
        const y = Number(click.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const hit = _checkClickHit(x, y);
        if (!hit || hit.hit !== true || typeof hit.targetIndex !== "number") return;
        if (!foundTargets.has(hit.targetIndex) || usedTargetIndexes.has(hit.targetIndex)) return;
        assign("click", idx, {
          targetIndex: hit.targetIndex,
          success: true,
        });
        usedTargetIndexes.add(hit.targetIndex);
      });
    }

    const polygonResults = Array.isArray(details && details.polygon_results) ? details.polygon_results : [];
    polygonResults.forEach((result) => {
      if (!result || typeof result !== "object") return;
      const matchedIndex =
        typeof result.matched_polygon_idx === "number" ? result.matched_polygon_idx : null;
      if (matchedIndex == null) return;
      assign("polygon", matchedIndex, {
        targetIndex: typeof result.target_index === "number" ? result.target_index : null,
        success: result.polygon_success === true,
        coverage: result.coverage,
        threshold: result.threshold,
      });
    });

    const lineResults = Array.isArray(details && details.line_results) ? details.line_results : [];
    lineResults.forEach((result) => {
      if (!result || typeof result !== "object") return;
      const matchedIndex =
        typeof result.matched_line_idx === "number" ? result.matched_line_idx : null;
      if (matchedIndex == null) return;
      assign("line", matchedIndex, {
        targetIndex: typeof result.target_index === "number" ? result.target_index : null,
        success: result.line_success === true,
        coverage: result.coverage,
        threshold: result.threshold,
      });
    });

    // L1/L2: backend returns targets_info with matched_click_idx instead of click_results.
    // Parse it so click markers get the correct target index (color + hover).
    const targetsInfoItems = Array.isArray(details && details.targets_info) ? details.targets_info : [];
    targetsInfoItems.forEach((info) => {
      if (!info || typeof info !== "object") return;
      const targetIdx = typeof info.index === "number" ? info.index : null;
      const clickIdx = typeof info.matched_click_idx === "number" ? info.matched_click_idx : null;
      if (targetIdx == null || clickIdx == null) return;
      // Skip only if existing assignment already has a valid targetIndex.
      // If click_results assigned targetIndex:null first, targets_info should still override.
      if (hasAssignment("click", clickIdx)) {
        const existingKey = _getActionKey("click", clickIdx);
        if (map[existingKey] && map[existingKey].targetIndex != null) return;
      }
      assign("click", clickIdx, {
        targetIndex: targetIdx,
        success: info.found === true,
      });
    });

    return map;
  }

  function _refreshUserActionsPanel() {
    if (!state.userActionsListEl) return;
    state.userActionsListEl.innerHTML = "";
    state.userActionRows = [];

    const actions = _collectUserActions();
    if (!actions.length) {
      const empty = _createEl(
        "div",
        "flex items-start gap-2.5 rounded-xl border border-dashed border-border-strong bg-surface-1/70 px-3 py-2.5 dark:border-border-strong dark:bg-surface-1/40",
        ""
      );
      const emptyIcon = _createEl(
        "span",
        "material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-text-secondary dark:text-text-secondary",
        "history_toggle_off"
      );
      const emptyText = _createEl(
        "div",
        "text-[12px] leading-5 text-text-secondary dark:text-text-secondary",
        wt("clickui.no_actions_yet", "Пока нет действий. Первые клики, контуры и штрихи появятся здесь автоматически.")
      );
      empty.appendChild(emptyIcon);
      empty.appendChild(emptyText);
      state.userActionsListEl.appendChild(empty);
      return;
    }

    actions.forEach((action) => {
      const description = _describeActionInterpretation(action);
      const accentColor = _getActionDisplayColor(state.taskDto, action.kind, action.index);
      const row = document.createElement("div");
      row.className =
        "task-chip flex w-full items-start gap-2.5 rounded-xl border border-border-strong bg-surface-1 px-3 py-2.5 text-left shadow-sm dark:border-border-strong dark:bg-surface-1";
      row.setAttribute("data-clickui", "user-action-row");
      row.setAttribute("data-clickui-action-key", action.key);
      row.setAttribute("data-clickui-panel-row", "action");
      const _actionTargetIdx = _findTargetIndex(state.taskDto, action.kind, action.index);
      if (_actionTargetIdx !== null) {
        row.setAttribute("data-target-index", String(_actionTargetIdx));
      }
      row.addEventListener("mouseenter", () => _setGlobalHover({ targetIndex: _actionTargetIdx, actionKey: action.key }));
      row.addEventListener("mouseleave", () => _setGlobalHover(null));

      const badge = _createEl(
        "div",
        "task-chip flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold shadow-sm",
        String(action.index + 1)
      );
      badge.style.backgroundColor = accentColor;
      badge.style.color = _getThemeColor("--color-text-on-dark", "#ffffff");
      badge.style.borderColor = _withAlpha(accentColor, 0.3);
      badge.style.boxShadow = `0 0 0 2px ${_withAlpha(accentColor, 0.14)}`;

      const body = _createEl("div", "min-w-0 flex-1", "");
      const titleRow = _createEl("div", "flex items-start justify-between gap-2", "");
      const title = _createEl(
        "div",
        "text-[13px] font-semibold leading-5 text-text-main dark:text-text-on-dark",
        action.title
      );
      const status = _createEl(
        "div",
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em]",
        description.statusText
      );
      if (description.tone === "success") {
        status.className += " border-success-light bg-success-lighter text-success-text";
      } else if (description.tone === "error") {
        status.className += " border-error-light bg-error-lighter text-error-text";
      } else if (description.tone === "pending") {
        status.className +=
          " border-info-light bg-info-light/20 text-primary dark:border-info-light dark:bg-info-light/15 dark:text-primary";
      } else {
        status.className +=
          " border-border-strong bg-surface-2 text-text-main dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark";
      }
      titleRow.appendChild(title);
      titleRow.appendChild(status);

      const detail = _createEl(
        "div",
        "mt-1 text-[12px] leading-5 text-text-secondary dark:text-text-secondary",
        description.detailText
      );
      body.appendChild(titleRow);
      body.appendChild(detail);

      row.appendChild(badge);
      row.appendChild(body);

      state.userActionsListEl.appendChild(row);
      state.userActionRows.push({ key: action.key, el: row });
    });

    _syncUserActionRowsState();
  }

  function _renderUserActionsSection() {
    // Panel card: same border-2 style as targets panel for visual consistency
    const section = _createEl(
      "div",
      "shrink-0 flex flex-col overflow-hidden rounded-2xl border-2 border-border-strong bg-surface-2 shadow-sm dark:border-border-strong dark:bg-surface-2",
      ""
    );
    section.setAttribute("data-clickui", "user-actions-section");

    // Header: px-5 py-4 — same rhythm as targets panel header
    const header = _createEl(
      "div",
      "flex items-center gap-3 border-b border-border-strong bg-surface-1 px-4 py-3 dark:border-border-strong",
      ""
    );
    const headerIcon = _createEl(
      "span",
      "material-symbols-outlined shrink-0 text-[18px] text-text-secondary dark:text-text-secondary",
      "history"
    );
    const titleWrap = _createEl("div", "min-w-0 flex-1", "");
    titleWrap.appendChild(
      _createEl(
        "div",
        "text-[12px] font-bold uppercase tracking-[0.08em] text-text-main dark:text-text-on-dark",
        wt("clickui.your_actions", "Ваши действия")
      )
    );
    titleWrap.appendChild(
      _createEl(
        "div",
        "mt-1 text-[12px] leading-5 text-text-secondary dark:text-text-secondary",
        wt("clickui.your_actions_desc", "Что вы сделали и результат системной проверки.")
      )
    );
    header.appendChild(headerIcon);
    header.appendChild(titleWrap);
    section.appendChild(header);

    // List wrapper: px-4 py-4 — one step inset from bar header px-5
    const listWrap = _createEl("div", "px-3 py-3", "");
    const list = _createEl(
      "div",
      "flex max-h-52 flex-col gap-2 overflow-y-auto pr-1",
      ""
    );
    list.setAttribute("data-clickui", "user-actions-list");
    listWrap.appendChild(list);
    section.appendChild(listWrap);
    state.userActionsListEl = list;
    _refreshUserActionsPanel();
    return section;
  }

  function _debugEnabled() {
    return !!global.CLICKUI_DEBUG;
  }

  function _clientLog(tag, payload) {
    try {
      if (!_debugEnabled()) return;
      const body = JSON.stringify({ tag, payload });
      if (navigator && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon("/api/client-log", blob);
        return;
      }
      if (typeof fetch === "function") {
        fetch("/api/client-log", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => { });
      }
    } catch (e) {
      // ignore
    }
  }

  function _getTaskType(taskDto) {
    if (!taskDto) return null;
    return (
      taskDto.task_type ||
      taskDto.type ||
      (taskDto.task_data && (taskDto.task_data.task_type || taskDto.task_data.type)) ||
      null
    );
  }

  function _allLabelFieldsFilled() {
    _ensureLabelsLengths();
    const clicksOk = (state.labelsClicks || []).every((s) => String(s || "").trim().length > 0);
    const polygonsOk = (state.labelsPolygons || []).every((s) => String(s || "").trim().length > 0);
    const linesOk = (state.labelsLines || []).every((s) => String(s || "").trim().length > 0);
    return clicksOk && polygonsOk && linesOk;
  }

  function _getTargets(taskDto) {
    const answerKey = (taskDto && taskDto.answer_key) || {};
    return Array.isArray(answerKey.targets) ? answerKey.targets : [];
  }

  function _isFreehandTarget(t) {
    return _getTargetShape(t) === "freehand";
  }

  function _getTargetShape(target) {
    if (!target || typeof target !== "object") return "";
    const rawShape = String(target.shape || target.type || "").toLowerCase().trim();
    if (rawShape) return rawShape;
    if (Array.isArray(target.points)) {
      if (target.points.length >= 3) return "polygon";
      if (target.points.length >= 2) return "freehand";
    }
    return "";
  }

  function _taskRequiresDrawing(taskDto = state.taskDto) {
    if (!taskDto) return false;
    const taskType = _getTaskType(taskDto);
    if (taskType === "draw") return true;
    const td = taskDto.task_data || {};
    const content = td.content || taskDto.content || {};
    return Boolean(
      content.requires_drawing ||
      td.requires_drawing ||
      taskDto.requires_drawing
    );
  }

  function _getTargetInteractionMeta(taskDto, target) {
    const shape = _getTargetShape(target);
    const isDrawTask = _taskRequiresDrawing(taskDto);

    if (shape === "freehand" || shape === "line") {
      return { shape, icon: "gesture", label: wt("clickui.shape_line", "Линия"), actionFamily: "line" };
    }

    if (shape === "point") {
      return { shape, icon: "gps_fixed", label: wt("clickui.shape_point", "Точка"), actionFamily: "point" };
    }

    if (isDrawTask) {
      return { shape: shape || "polygon", icon: "interests", label: wt("clickui.shape_polygon", "Контур"), actionFamily: "outline" };
    }

    return { shape: shape || "polygon", icon: "interests", label: wt("clickui.shape_area", "Область"), actionFamily: "click" };
  }

  function _summarizeTargetInteractions(taskDto, targets) {
    const summary = {
      hasClick: false,
      hasOutline: false,
      hasLine: false,
      hasPoint: false,
    };

    if (!Array.isArray(targets)) return summary;

    targets.forEach((target) => {
      const meta = _getTargetInteractionMeta(taskDto, target);
      if (meta.actionFamily === "click") summary.hasClick = true;
      if (meta.actionFamily === "outline") summary.hasOutline = true;
      if (meta.actionFamily === "line") summary.hasLine = true;
      if (meta.actionFamily === "point") summary.hasPoint = true;
    });

    return summary;
  }

  function _buildTargetDisplayIndexes(taskDto, targets) {
    if (!Array.isArray(targets) || !targets.length) return [];

    const counters = {
      click: 0,
      outline: 0,
      line: 0,
      point: 0,
    };

    return targets.map((target) => {
      const meta = _getTargetInteractionMeta(taskDto, target);
      const family =
        meta &&
        typeof meta.actionFamily === "string" &&
        Object.prototype.hasOwnProperty.call(counters, meta.actionFamily)
          ? meta.actionFamily
          : "click";
      counters[family] += 1;
      return counters[family];
    });
  }

  function _getTargetDisplayReference(taskDto, targetIndex) {
    const targets = _getTargets(taskDto);
    if (!Array.isArray(targets) || targetIndex == null || targetIndex < 0 || targetIndex >= targets.length) {
      return "";
    }

    const target = targets[targetIndex];
    const displayIndexes = _buildTargetDisplayIndexes(taskDto, targets);
    const displayIndex = Number.isInteger(displayIndexes[targetIndex]) ? displayIndexes[targetIndex] : targetIndex + 1;
    const meta = _getTargetInteractionMeta(taskDto, target);
    const baseLabel = meta && meta.label ? meta.label : wt("clickui.target_fallback", "Цель");
    return `${baseLabel} #${displayIndex}`;
  }

  function _findTargetIndex(taskDto, kind, actionIndex) {
    const key = _getActionKey(kind, actionIndex);
    const interpretation = _getActionInterpretation(key);
    if (interpretation && typeof interpretation.targetIndex === "number" && interpretation.targetIndex >= 0) {
      return interpretation.targetIndex;
    }
    return null;
  }

  function _getActionDisplayColor(taskDto, kind, actionIndex) {
    const targetIdx = _findTargetIndex(taskDto, kind, actionIndex);
    if (targetIdx !== null) {
      return _getTargetColor(targetIdx);
    }
    if (kind === "polygon") return _getThemeColor("--color-success", "#22c55e");
    if (kind === "line") return _getThemeColor("--color-primary", "#1349ec");
    return _getThemeColor("--color-accent-strong", "#d97706");
  }

  function _getRawTaskType(taskDto) {
    const td = (taskDto && taskDto.task_data) || {};
    return String(
      (taskDto && taskDto.task_type) ||
        td.task_type ||
        td._original_type ||
        (taskDto && taskDto.type) ||
        ""
    )
      .trim()
      .toLowerCase();
  }

  function _recalcLimitsFromTask(taskDto) {
    const targets = _getTargets(taskDto);
    let clickCount = 0;
    let polygonCount = 0;
    let strokeCount = 0;
    for (const t of targets) {
      if (_isFreehandTarget(t)) strokeCount += 1;
      else {
        clickCount += 1;
        polygonCount += 1;
      }
    }
    state.maxClicks = clickCount;
    state.maxPolygons = polygonCount;
    state.maxStrokes = strokeCount;
  }

  function _requiresDrawing() {
    return _taskRequiresDrawing(state.taskDto);
  }

  function _buildTargetsInstruction(taskDto, targets) {
    const { hasClick, hasOutline, hasLine, hasPoint } = _summarizeTargetInteractions(taskDto, targets);

    // L2+: targets list is hidden, user clicks areas and labels them
    if (_shouldHideTargetsList(taskDto)) {
      if (hasClick || hasPoint) {
        return wt("clickui.desc_click_label", "Кликай по нужным областям на изображении и вводи название каждой области в появившееся поле.");
      }
      if (hasOutline) {
        return wt("clickui.desc_outline_label", "Обведи нужные области на изображении и давай каждой название.");
      }
      if (hasLine) {
        return wt("clickui.desc_line_label", "Проведи линии по нужным фрагментам изображения и давай каждой линии название.");
      }
    }

    if (hasOutline && hasLine) {
      return wt("clickui.desc_outline_line", "Список ниже показывает, что искать: цели с типом «Контур» нужно обвести по границе, а цели с типом «Линия» провести по нужному фрагменту. Номер и цвет помогают сопоставить цель и результат.");
    }
    if (hasOutline) {
      return wt("clickui.desc_outline", "Список ниже показывает, что искать. Для каждой цели обведи нужную область на изображении и замкни контур. Номер и цвет помогают сопоставить цель и результат.");
    }
    if (hasLine && !hasClick && !hasPoint) {
      return wt("clickui.desc_line", "Список ниже показывает, что искать. Для каждой цели проведи линию по нужному фрагменту изображения. Номер и цвет помогают сопоставить цель и результат.");
    }
    if (hasClick && hasLine) {
      return wt("clickui.desc_click_line", "Список ниже показывает, что искать: цели с типом «Область» нужно кликать, а цели с типом «Линия» проводить по изображению. Номер и цвет помогают сопоставить цель и результат.");
    }
    if (hasPoint && !hasClick && !hasLine) {
      return wt("clickui.desc_point", "Список ниже показывает, что искать. Затем для каждой цели кликни по соответствующей точке на изображении. Номер и цвет помогают сопоставить цель и результат.");
    }
    if (hasClick || hasPoint) {
      return wt("clickui.desc_click", "Список ниже показывает, что искать. Затем для каждой цели кликни по соответствующей области на изображении. Номер и цвет помогают сопоставить цель и результат.");
    }
    return wt("clickui.desc_default", "Прочитай названия целей ниже и отмечай на изображении только те фрагменты, которые соответствуют строкам списка.");
  }

  function _buildTargetsStatusInstruction(taskDto, targets) {
    const { hasClick, hasOutline, hasLine, hasPoint } = _summarizeTargetInteractions(taskDto, targets);

    // L2+: targets list is hidden, user clicks areas and labels them
    if (_shouldHideTargetsList(taskDto)) {
      if (hasClick || hasPoint) {
        return wt("clickui.status_click_label", "Кликай по областям и давай каждой название.");
      }
      if (hasOutline) {
        return wt("clickui.status_outline_label", "Обводи области и давай каждой название.");
      }
      if (hasLine) {
        return wt("clickui.status_line_label", "Проводи линии и давай каждой название.");
      }
    }

    if (hasOutline && hasLine) {
      return wt("clickui.status_outline_line", "Сверяйся со списком целей: контуры нужно обводить, а линии проводить по изображению.");
    }
    if (hasOutline) {
      return wt("clickui.status_outline", "Сверяйся со списком целей и обводи только нужные области.");
    }
    if (hasLine && !hasClick && !hasPoint) {
      return wt("clickui.status_line", "Сверяйся со списком целей и проводи только нужные линии.");
    }
    if (hasClick && hasLine) {
      return wt("clickui.status_click_line", "Сверяйся со списком целей: области кликай, а линии проводи по изображению.");
    }
    if (hasPoint && !hasClick && !hasLine) {
      return wt("clickui.status_point", "Сверяйся со списком целей и кликай только по нужным точкам.");
    }
    if (hasClick || hasPoint) {
      return wt("clickui.status_click", "Сверяйся со списком целей и кликай только по подходящим областям.");
    }
    return wt("clickui.status_default", "Сверяйся со списком целей и отмечай только подходящие фрагменты.");
  }

  function _pointInPolygon(x, y, points) {
    // Ray casting algorithm
    if (!Array.isArray(points) || points.length < 3) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = Number(points[i][0]);
      const yi = Number(points[i][1]);
      const xj = Number(points[j][0]);
      const yj = Number(points[j][1]);

      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function _checkClickHit(x, y) {
    const targets = _getTargets(state.taskDto);
    for (let idx = 0; idx < targets.length; idx += 1) {
      const t = targets[idx];
      if (_isFreehandTarget(t)) continue;
      const shape = (t && (t.shape || t.type)) || null;
      if (shape === "polygon" && Array.isArray(t.points)) {
        if (_pointInPolygon(x, y, t.points)) return { hit: true, targetIndex: idx };
      } else if (shape === "point") {
        const pt = Array.isArray(t.point) ? t.point : null;
        if (pt && pt.length >= 2) {
          const dx = x - (Number(pt[0]) || 0);
          const dy = y - (Number(pt[1]) || 0);
          const r = 12;
          if (dx * dx + dy * dy <= r * r) return { hit: true, targetIndex: idx };
        }
      }
    }
    return { hit: false, targetIndex: null };
  }

  function _getPrompt(taskDto) {
    const td = (taskDto && taskDto.task_data) || {};
    const content = td.content || {};
    return (
      content.question ||
      td.question ||
      content.prompt ||
      td.prompt ||
      taskDto.question ||
      taskDto.prompt ||
      ""
    );
  }

  function _renderTargetsPanel(taskDto) {
    const targets = _getTargets(taskDto);
    if (!Array.isArray(targets) || !targets.length) {
      state.targetsProgress = null;
      state.targetRows = [];
      return null;
    }

    const panel = _createEl(
      "div",
      "task-chip flex flex-col rounded-2xl border-2 border-border-strong bg-surface-2 shadow-sm dark:border-border-strong dark:bg-surface-2 overflow-hidden",
      ""
    );

    const header = _createEl(
      "div",
      "px-4 pt-4 pb-3 border-b border-border-strong dark:border-border-strong bg-surface-1/60",
      ""
    );
    const title = _createEl(
      "h3",
      "text-sm font-semibold text-text-main dark:text-text-on-dark",
      _taskRequiresDrawing(taskDto) ? wt("clickui.what_to_mark", "Что нужно отметить") : wt("clickui.targets_to_find", "Цели для поиска")
    );
    const subtitle = _createEl(
      "p",
      "mt-1 text-xs leading-relaxed text-text-main dark:text-text-on-dark",
      _buildTargetsInstruction(taskDto, targets)
    );
    header.appendChild(title);
    header.appendChild(subtitle);
    panel.appendChild(header);

    const progressSection = _createEl("div", "task-chip px-4 py-3 border-b border-border-strong dark:border-border-strong bg-surface-1/40", "");
    const progressLabel = _createEl(
      "div",
      "text-xs font-medium text-text-secondary dark:text-text-on-dark",
      ""
    );
    const progressTrack = _createEl(
      "div",
      "task-chip mt-2 h-2 rounded-full bg-bg-secondary dark:bg-bg-secondary",
      ""
    );
    const progressFill = _createEl(
      "div",
      "task-chip h-2 rounded-full bg-primary transition-all duration-200",
      ""
    );
    progressTrack.appendChild(progressFill);
    progressSection.appendChild(progressLabel);
    progressSection.appendChild(progressTrack);
    panel.appendChild(progressSection);

    state.targetsProgress = {
      total: targets.length,
      titleEl: progressTitle,
      labelEl: progressLabel,
      barEl: progressFill,
    };

    const list = _createEl("div", "flex flex-col divide-y divide-border-subtle dark:divide-border-strong", "");
    state.targetRows = [];

    targets.forEach((t, idx) => {
      const meta = _getTargetInteractionMeta(taskDto, t);
      const color = _getTargetColor(idx);
      const item = _createEl(
        "div",
        "task-chip flex items-center gap-3 px-4 py-3 transition-colors hover:bg-bg-hover/40",
        ""
      );

      const badge = _createEl(
        "div",
        "task-chip flex size-8 items-center justify-center rounded-full border-2 border-border-strong bg-surface-2 text-text-main dark:bg-surface-2 dark:text-text-on-dark text-xs font-bold",
        String(idx + 1)
      );

      const info = _createEl("div", "flex-1 min-w-0", "");
      const label = _createEl(
        "div",
        "text-sm font-semibold text-text-main truncate dark:text-text-on-dark",
        t.label || wt("clickui.target_n", "Цель {n}").replace("{n}", idx + 1)
      );
      const metaRow = _createEl("div", "mt-0.5 flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary", "");
      const iconEl = _createEl(
        "span",
        "material-symbols-outlined text-base",
        meta.icon
      );
      iconEl.style.color = color;
      const metaText = _createEl("span", "", meta.label);
      metaRow.appendChild(iconEl);
      metaRow.appendChild(metaText);
      info.appendChild(label);
      info.appendChild(metaRow);

      const colorDot = _createEl(
        "div",
        "task-chip size-3 rounded-full shadow-sm",
        ""
      );
      colorDot.style.backgroundColor = color;

      item.appendChild(badge);
      item.appendChild(info);
      item.appendChild(colorDot);
      list.appendChild(item);

      state.targetRows.push({ idx, el: item, badge, icon: iconEl, dot: colorDot });
    });

    const sideColumn = _createEl("div", "flex flex-col gap-4", "");
    const labelsControls = _createEl("div", "flex flex-col gap-2", "");
    const labelsTitle = _createEl(
      "div",
      "text-xs font-semibold uppercase tracking-wide text-text-main dark:text-text-on-dark",
      wt("clickui.labels_title", "Подписи")
    );
    labelsControls.appendChild(labelsTitle);

    const labelsButtons = _createEl("div", "flex gap-2 rounded-xl border border-border-subtle bg-surface-1 p-1", "");
    const labelModes = [
      { key: "off", label: wt("clickui.labels_hide", "Скрыть") },
      { key: "compact", label: wt("clickui.labels_compact", "Компактно") },
    ];
    labelModes.forEach((mode) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = mode.label;
      btn.className =
        "task-chip flex-1 rounded-lg border border-border-strong bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-main shadow-sm transition-colors hover:bg-bg-hover focus:outline-none focus:ring-2 focus:ring-primary-light dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark";
      btn.addEventListener("click", () => {
        state.labelMode = mode.key;
        _updateLabelModeButtons(labelsButtons);
        _renderTargetSidebar();
        _renderLabelsInputs(null);
      });
      btn.dataset.mode = mode.key;
      labelsButtons.appendChild(btn);
    });
    labelsControls.appendChild(labelsButtons);
    sideColumn.appendChild(labelsControls);

    panel.appendChild(list);
    _updateTargetsProgressUI();
    _refreshTargetRowsState();

    return panel;
  }

  function _shouldAccentOutlineGuidance(taskDto, targets) {
    if (!state.runtimeMode) return false;
    if (_getRawTaskType(taskDto) !== "click") return false;
    if (_getDifficultyLevel(taskDto) < 3) return false;
    if (!Array.isArray(targets) || !targets.length) return false;
    return targets.some((target) => {
      const shape = _getTargetShape(target);
      return shape !== "point" && shape !== "freehand" && shape !== "line";
    });
  }

  function _clearOutlineGuidanceAttention(targets = null) {
    const panelTitleEl =
      targets && targets.panelTitleEl ? targets.panelTitleEl : state.targetsPanelTitleEl;
    const listSectionEl =
      targets && targets.listSectionEl ? targets.listSectionEl : state.targetsListSectionEl;
    const outlineVerbEls =
      targets && Array.isArray(targets.outlineVerbEls)
        ? targets.outlineVerbEls
        : Array.isArray(state.outlineVerbEls)
          ? state.outlineVerbEls
          : [];
    if (state.targetsAttentionTimer) {
      clearTimeout(state.targetsAttentionTimer);
      state.targetsAttentionTimer = null;
    }
    if (panelTitleEl) {
      panelTitleEl.classList.remove("clickui-targets-attention");
    }
    if (listSectionEl) {
      listSectionEl.classList.remove("clickui-targets-attention");
    }
    outlineVerbEls.forEach((el) => {
      try {
        el.classList.remove("clickui-outline-verb-attention");
      } catch (e) {
        // ignore
      }
    });
  }

  function _flashOutlineGuidanceAttention(targets = null) {
    const panelTitleEl =
      targets && targets.panelTitleEl ? targets.panelTitleEl : state.targetsPanelTitleEl;
    const listSectionEl =
      targets && targets.listSectionEl ? targets.listSectionEl : state.targetsListSectionEl;
    const outlineVerbEls =
      targets && Array.isArray(targets.outlineVerbEls)
        ? targets.outlineVerbEls
        : Array.isArray(state.outlineVerbEls)
          ? state.outlineVerbEls
          : [];
    _clearOutlineGuidanceAttention(targets);
    if (panelTitleEl) {
      panelTitleEl.classList.add("clickui-targets-attention");
    }
    if (listSectionEl) {
      listSectionEl.classList.add("clickui-targets-attention");
    }
    outlineVerbEls.forEach((el) => {
      try {
        el.classList.add("clickui-outline-verb-attention");
      } catch (e) {
        // ignore
      }
    });
    state.targetsAttentionTimer = setTimeout(() => {
      state.targetsAttentionTimer = null;
      _clearOutlineGuidanceAttention(targets);
    }, 1800);
  }

  function _renderTargetsPanelV2(taskDto) {
    const targets = _getTargets(taskDto);
    _clearOutlineGuidanceAttention();
    state.targetsPanelTitleEl = null;
    state.targetsListSectionEl = null;
    state.outlineVerbEls = [];
    if (!Array.isArray(targets) || !targets.length) {
      state.targetsProgress = null;
      state.targetRows = [];
      state.userActionsListEl = null;
      state.userActionRows = [];
      return null;
    }
    const shouldAccentOutlineGuidance = _shouldAccentOutlineGuidance(taskDto, targets);
    const targetsInstruction = _buildTargetsInstruction(taskDto, targets);
    const promptText = String(_getPrompt(taskDto) || "").trim();
    const hideTargetsList = _shouldHideTargetsList(taskDto);
    const shouldShowPromptText = Boolean(promptText);
    const shouldShowInstructionText = Boolean(targetsInstruction && targetsInstruction !== promptText);
    const targetsPanelTitle =
      _taskRequiresDrawing(taskDto) || shouldAccentOutlineGuidance
        ? "\u0427\u0442\u043e \u043d\u0443\u0436\u043d\u043e \u043e\u0442\u043c\u0435\u0442\u0438\u0442\u044c"
        : "\u0426\u0435\u043b\u0438 \u0434\u043b\u044f \u043f\u043e\u0438\u0441\u043a\u0430";
    const targetsPanelIcon =
      _taskRequiresDrawing(taskDto) || shouldAccentOutlineGuidance ? "draw" : "my_location";

    const panel = _createEl(
      "div",
      "task-chip flex min-h-0 flex-col overflow-hidden rounded-2xl border-2 border-border-strong bg-surface-2 shadow-sm dark:border-border-strong dark:bg-surface-2",
      ""
    );
    panel.setAttribute("data-clickui", "targets-panel");

    // Header: px-5 py-4 — symmetric, generous
    const header = _createEl(
      "div",
      "border-b border-border-strong bg-surface-1 px-4 py-3.5 dark:border-border-strong",
      ""
    );
    header.setAttribute("data-clickui", "targets-header");
    const titleRow = _createEl("div", "flex items-center gap-2", "");
    const titleIcon = _createEl(
      "span",
      "material-symbols-outlined text-[18px] text-primary dark:text-primary",
      targetsPanelIcon
    );
    const title = _createEl(
      "h3",
      "text-[15px] font-bold text-text-main dark:text-text-on-dark",
      targetsPanelTitle
    );
    title.setAttribute("data-clickui", "targets-title");
    titleRow.appendChild(titleIcon);
    titleRow.appendChild(title);
    state.targetsPanelTitleEl = header;
    // Instruction chip: same horizontal inset as content rows (px-4) but nested inside px-5 header
    // so we give it mt-3 and let it fill the full column naturally
    const subtitleWrap = _createEl(
      "div",
      "mt-2.5 rounded-xl border border-info-light/35 bg-info-light/15 px-3 py-2.5 dark:border-info-light/30 dark:bg-info-light/10",
      ""
    );
    subtitleWrap.setAttribute("data-clickui", "targets-subtitle-wrap");
    if (shouldShowPromptText) {
      const promptEl = _createEl(
        "p",
        "break-words text-[14px] font-semibold leading-5 text-text-main dark:text-text-on-dark",
        promptText
      );
      promptEl.setAttribute("data-clickui", "targets-prompt");
      subtitleWrap.appendChild(promptEl);
    }
    if (shouldShowInstructionText) {
      const subtitle = _createEl(
        "div",
        shouldShowPromptText
          ? "mt-2 break-words text-[12px] leading-5 text-text-secondary dark:text-text-secondary"
          : "break-words text-[13px] leading-6 text-text-secondary dark:text-text-secondary",
        targetsInstruction
      );
      subtitle.setAttribute("data-clickui", "targets-instruction");
      subtitleWrap.appendChild(subtitle);
      state.targetsInstructionEl = subtitle;
    } else {
      state.targetsInstructionEl = null;
    }
    if (shouldAccentOutlineGuidance && hideTargetsList) {
      const actionChip = _createEl(
        "span",
        "mt-2 inline-flex w-fit items-center rounded-full border border-warning-light bg-warning-lighter px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-warning-darker transition-transform dark:border-warning-light dark:bg-warning-light dark:text-warning-lighter",
        "\u041e\u0431\u0432\u0435\u0441\u0442\u0438"
      );
      actionChip.setAttribute("data-clickui", "target-verb-outline");
      subtitleWrap.appendChild(actionChip);
      state.outlineVerbEls.push(actionChip);
    }
    header.appendChild(titleRow);
    header.appendChild(subtitleWrap);
    panel.appendChild(header);
    if (hideTargetsList) {
      state.targetsProgress = null;
      state.targetRows = [];
      state.userActionsListEl = null;
      state.userActionRows = [];
      if (shouldAccentOutlineGuidance) {
        _flashOutlineGuidanceAttention({
          panelTitleEl: header,
          listSectionEl: subtitleWrap,
          outlineVerbEls: state.outlineVerbEls.slice(),
        });
      }
      return panel;
    }

    // List section: px-4 py-4 — consistent inset, one unit less than header
    const listSection = _createEl("div", "px-3 py-3 lg:py-2.5", "");
    listSection.setAttribute("data-clickui", "targets-list-section");
    state.targetsListSectionEl = listSection;
    const list = _createEl("div", "flex flex-col gap-2.5", "");
    list.setAttribute("data-clickui", "targets-list");
    const displayIndexes = _buildTargetDisplayIndexes(taskDto, targets);
    state.targetRows = [];

    targets.forEach((target, idx) => {
      const meta = _getTargetInteractionMeta(taskDto, target);
      const displayIndex = Number.isInteger(displayIndexes[idx]) ? displayIndexes[idx] : idx + 1;
      // Row: px-4 py-3 — horizontal matches list container, vertical gives the row breathing room
      const item = _createEl(
        "div",
        "task-chip flex items-start gap-2.5 rounded-xl border border-border-strong bg-surface-1 px-3 py-2.5 shadow-sm ring-2 ring-transparent transition-colors duration-200 hover:bg-bg-hover/30 dark:border-border-strong dark:bg-surface-1",
        ""
      );
      item.setAttribute("data-clickui", "target-row");

      // Badge: size-8 = 32px, perfectly circular
      const badge = _createEl(
        "div",
        "task-chip mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-[12px] font-bold shadow-sm",
        String(displayIndex)
      );
      const color = _getTargetColor(idx);
      badge.style.backgroundColor = color;
      badge.style.color = _getThemeColor("--color-text-on-dark", "#ffffff");
      badge.style.borderColor = _withAlpha(color, 0.4);
      badge.style.boxShadow = `0 0 0 2px ${_withAlpha(color, 0.12)}`;

      const info = _createEl("div", "min-w-0 flex-1", "");
      // Label: text-sm, semibold — clearly the primary text
      const label = _createEl(
        "div",
        "text-[13px] font-semibold leading-5 text-text-main dark:text-text-on-dark",
        target.label || wt("clickui.target_n", "Цель {n}").replace("{n}", idx + 1)
      );
      // Meta row: mt-1.5 below label — not too close, not too far
      const metaRow = _createEl(
        "div",
        "mt-1 flex flex-wrap items-center gap-1.5 text-xs",
        ""
      );
      // Kind chip: clean pill, icon + label
      const kindChip = _createEl(
        "span",
        "inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-text-main dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark",
        ""
      );
      const iconEl = _createEl(
        "span",
        "material-symbols-outlined text-[13px]",
        meta.icon
      );
      iconEl.style.color = color;
      kindChip.appendChild(iconEl);
      kindChip.appendChild(_createEl("span", "", `${meta.label} #${displayIndex}`));
      metaRow.appendChild(kindChip);
      if (shouldAccentOutlineGuidance && meta.actionFamily === "outline") {
        const actionChip = _createEl(
          "span",
          "inline-flex items-center rounded-full border border-warning-light bg-warning-lighter px-2.5 py-0.5 text-[11px] font-semibold text-warning-darker transition-transform dark:border-warning-light dark:bg-warning-light dark:text-warning-lighter",
          wt("clickui.verb_outline", "Обвести")
        );
        actionChip.setAttribute("data-clickui", "target-verb-outline");
        metaRow.appendChild(actionChip);
        state.outlineVerbEls.push(actionChip);
      }
      info.appendChild(label);
      info.appendChild(metaRow);

      const sideInfo = _createEl(
        "div",
        "flex shrink-0 flex-col items-end gap-1.5 self-start",
        ""
      );
      sideInfo.appendChild(_createEl("span", "sr-only", wt("clickui.target_color_sr", "Цвет цели")));

      const statusPill = _createEl("div", "hidden", "");
      sideInfo.appendChild(statusPill);

      item.setAttribute("data-target-index", String(idx));
      item.setAttribute("data-clickui-panel-row", "target");
      item.addEventListener("mouseenter", () => _setGlobalHover({ targetIndex: idx }));
      item.addEventListener("mouseleave", () => _setGlobalHover(null));
      item.appendChild(badge);
      item.appendChild(info);
      item.appendChild(sideInfo);
      list.appendChild(item);

      state.targetRows.push({ idx, el: item, badge, icon: iconEl, dot: null, statusPill });
    });

    listSection.appendChild(list);
    panel.appendChild(listSection);
    state.targetsProgress = null;
    _refreshTargetRowsState();
    if (shouldAccentOutlineGuidance) {
      _flashOutlineGuidanceAttention({
        panelTitleEl: header,
        listSectionEl: listSection,
        outlineVerbEls: state.outlineVerbEls.slice(),
      });
    }

    return panel;
  }

  function _getDifficultyLevel(taskDto) {
    try {
      const td = (taskDto && taskDto.task_data) || {};
      const dl = td._difficulty_level != null ? td._difficulty_level : taskDto && taskDto.difficulty;
      const n = Number(dl);
      return Number.isFinite(n) ? n : null;
    } catch (e) {
      return null;
    }
  }

  function _getImagePath(taskDto) {
    const td = (taskDto && taskDto.task_data) || {};
    const content = td.content || {};
    const directUrl =
      td.image_asset_url ||
      content.image_asset_url ||
      td.image_url ||
      content.image_url ||
      "";
    if (directUrl) return directUrl;

    const directAssetId =
      td.image_asset_id ||
      content.image_asset_id ||
      td.asset_id ||
      content.asset_id ||
      "";
    if (directAssetId) {
      return { asset_id: directAssetId };
    }

    return (
      td.image_path ||
      content.image_path ||
      td.image ||
      content.image ||
      ""
    );
  }

  function _resolveImageUrl(taskDto) {
    const raw = _getImagePath(taskDto);
    return _resolveAssetUrl(raw);
  }

  const Metadata = (function () {
    if (typeof global !== "undefined" && global.TaskMetadataPanel) {
      return global.TaskMetadataPanel;
    }
    if (typeof require === "function") {
      try {
        return require("./TaskMetadataPanel.js");
      } catch (e) {
        // ignore
      }
    }
    return null;
  })();

  const _resolveAssetUrl =
    Metadata && typeof Metadata.resolveAssetUrl === "function"
      ? Metadata.resolveAssetUrl
      : function (rawPath) {
        if (!rawPath && rawPath !== 0) return "";
        if (rawPath && typeof rawPath === "object") {
          const nested = rawPath.image && typeof rawPath.image === "object" ? rawPath.image : null;
          const directUrl =
            rawPath.asset_url ||
            rawPath.image_asset_url ||
            rawPath.image_url ||
            rawPath.url ||
            rawPath.src ||
            (nested &&
              (nested.asset_url ||
                nested.image_asset_url ||
                nested.url ||
                nested.image_url ||
                nested.src)) ||
            "";
          if (directUrl) return _resolveAssetUrl(directUrl);

          const assetId =
            rawPath.asset_id ||
            rawPath.image_asset_id ||
            (nested && (nested.asset_id || nested.image_asset_id)) ||
            "";
          if (assetId) {
            return `/api/assets/${encodeURIComponent(String(assetId))}/content`;
          }
          const legacyPath =
            rawPath.image_path ||
            rawPath.path ||
            (nested && (nested.path || nested.image_path)) ||
            "";
          if (legacyPath) return _resolveAssetUrl(legacyPath);
          return "";
        }
        const raw = String(rawPath).trim();
        if (!raw) return "";
        if (/^(https?:|data:)/i.test(raw)) return raw;
        if (raw.startsWith("/")) return raw;
        return `/api/local-image?path=${encodeURIComponent(raw)}`;
      };

  const _normalizeAdditionalInfo =
    Metadata && typeof Metadata.normalizeAdditionalInfo === "function"
      ? Metadata.normalizeAdditionalInfo
      : function (raw) {
        if (!raw || typeof raw !== "object") return null;
        const fallback = { type: "none" };
        try {
          let type = typeof raw.type === "string" ? raw.type.toLowerCase() : "";
          const text = typeof raw.text === "string" ? raw.text.trim() : "";
          const images = Array.isArray(raw.images) ? raw.images.filter(Boolean) : [];
          if (!type) {
            if (text && images.length) type = "combined";
            else if (images.length) type = "image";
            else if (text) type = "text";
            else type = "none";
          }
          if (type === "none") return null;
          const info = { type, text: "", images: [] };
          if (type === "text") {
            if (!text) return null;
            info.text = text;
          } else if (type === "image") {
            if (!images.length) return null;
            info.images = images.slice(0, 3);
          } else if (type === "combined") {
            if (!text && !images.length) return null;
            info.text = text || "";
            info.images = images.slice(0, 3);
          }
          return info;
        } catch (e) {
          return fallback;
        }
      };

  function _getAdditionalInfo(taskDto) {
    if (!taskDto || !_normalizeAdditionalInfo) return null;
    const sources = [
      taskDto.additionalInfo,
      taskDto.task_data && taskDto.task_data.additionalInfo,
      taskDto.task_data && taskDto.task_data.content && taskDto.task_data.content.additionalInfo,
      taskDto.content && taskDto.content.additionalInfo,
    ];
    for (const src of sources) {
      const normalized = _normalizeAdditionalInfo(src);
      if (normalized) return normalized;
    }
    return null;
  }

  function _teardownAdditionalModal() {
    try {
      if (state.additionalModal && state.additionalModal.overlay) {
        const parent = state.additionalModal.overlay.parentNode;
        if (parent) parent.removeChild(state.additionalModal.overlay);
      }
      if (state.additionalModalKeyHandler && typeof document !== "undefined") {
        document.removeEventListener("keydown", state.additionalModalKeyHandler);
      }
    } catch (e) {
      // ignore
    } finally {
      state.additionalModal = null;
      state.additionalModalKeyHandler = null;
    }
  }

  function _ensureAdditionalModal() {
    if (state.additionalModal && state.additionalModal.overlay) return state.additionalModal;
    if (typeof document === "undefined") return null;

    const overlay = _createEl(
      "div",
      "fixed inset-0 z-[999] hidden bg-scrim-intense backdrop-blur-sm px-4 py-8",
      ""
    );
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-hidden", "true");

    const inner = _createEl(
      "div",
      "relative mx-auto flex h-full max-w-5xl flex-col items-center justify-center gap-4",
      ""
    );
    const figure = _createEl("figure", "flex w-full flex-col items-center gap-3", "");
    const viewport = _createEl(
      "div",
      "relative flex w-full flex-1 items-center justify-center overflow-hidden rounded-2xl bg-scrim-weak shadow-2xl",
      ""
    );
    viewport.style.maxHeight = "80vh";
    viewport.style.touchAction = "none";
    const zoomLayer = _createEl("div", "select-none transition-none will-change-transform", "");
    zoomLayer.style.transformOrigin = "0 0";
    zoomLayer.style.cursor = "zoom-in";
    const img = document.createElement("img");
    img.className = "max-h-[80vh] w-auto max-w-full object-contain select-none pointer-events-none";
    img.alt = "";
    const caption = _createEl("figcaption", "text-center text-sm text-text-on-dark opacity-80", "");

    zoomLayer.appendChild(img);
    viewport.appendChild(zoomLayer);
    figure.appendChild(viewport);
    figure.appendChild(caption);

    const closeBtn = _createEl(
      "button",
      "absolute right-4 top-4 rounded-full bg-glass-light p-2 text-text-on-dark hover:bg-glass-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-on-dark",
      ""
    );
    closeBtn.setAttribute("type", "button");
    closeBtn.setAttribute("aria-label", wt("clickui.close_fullscreen_aria", "Закрыть полноэкранное изображение"));
    const closeIcon = _createEl("span", "material-symbols-outlined text-2xl", "close");
    closeBtn.appendChild(closeIcon);

    inner.appendChild(figure);
    inner.appendChild(closeBtn);
    overlay.appendChild(inner);

    const handleOverlayClick = (ev) => {
      if (ev.target === overlay || closeBtn.contains(ev.target)) {
        _closeAdditionalModal();
      }
    };

    overlay.addEventListener("click", handleOverlayClick);
    closeBtn.addEventListener("click", handleOverlayClick);

    const handleWheel = (ev) => {
      const modal = state.additionalModal;
      if (!modal || !modal.viewport || modal.viewport !== viewport) return;
      ev.preventDefault();
      const delta = ev.deltaY;
      if (!Number.isFinite(delta) || delta === 0) return;
      const factor = delta < 0 ? 1.1 : 0.9;
      const nextScale = Math.min(
        modal.maxScale,
        Math.max(modal.minScale, modal.scale * factor)
      );
      if (nextScale === modal.scale) return;

      const viewportRect = modal.viewport.getBoundingClientRect();
      const originX = ev.clientX - viewportRect.left;
      const originY = ev.clientY - viewportRect.top;
      const relX = (originX - modal.translateX) / modal.scale;
      const relY = (originY - modal.translateY) / modal.scale;

      modal.scale = nextScale;
      if (nextScale === modal.minScale) {
        modal.translateX = 0;
        modal.translateY = 0;
      } else {
        modal.translateX = originX - relX * nextScale;
        modal.translateY = originY - relY * nextScale;
      }
      _applyAdditionalModalTransform(modal);
      _updateAdditionalModalCursor(modal);
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });

    let panPointerId = null;
    let lastX = 0;
    let lastY = 0;

    const handlePointerDown = (ev) => {
      const modal = state.additionalModal;
      if (!modal || modal.viewport !== viewport || modal.scale <= modal.minScale) return;
      panPointerId = ev.pointerId;
      viewport.setPointerCapture(ev.pointerId);
      modal.isPanning = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      _updateAdditionalModalCursor(modal);
      ev.preventDefault();
    };

    const handlePointerMove = (ev) => {
      const modal = state.additionalModal;
      if (
        !modal ||
        modal.viewport !== viewport ||
        !modal.isPanning ||
        panPointerId !== ev.pointerId
      )
        return;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      modal.translateX += dx;
      modal.translateY += dy;
      lastX = ev.clientX;
      lastY = ev.clientY;
      _applyAdditionalModalTransform(modal);
    };

    const endPan = (ev) => {
      const modal = state.additionalModal;
      if (!modal || modal.viewport !== viewport || panPointerId !== ev.pointerId) return;
      try {
        viewport.releasePointerCapture(ev.pointerId);
      } catch (err) {
        // ignore
      }
      modal.isPanning = false;
      panPointerId = null;
      _updateAdditionalModalCursor(modal);
    };

    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove);
    viewport.addEventListener("pointerup", endPan);
    viewport.addEventListener("pointercancel", endPan);

    img.addEventListener("load", () => {
      const modal = state.additionalModal;
      if (!modal || modal.img !== img) return;
      _resetAdditionalModalTransform(modal);
    });

    const keyHandler = (ev) => {
      if (ev.key === "Escape") _closeAdditionalModal();
    };
    document.addEventListener("keydown", keyHandler);

    document.body.appendChild(overlay);
    state.additionalModal = {
      overlay,
      viewport,
      zoomLayer,
      img,
      caption,
      scale: 1,
      translateX: 0,
      translateY: 0,
      minScale: 1,
      maxScale: 6,
      isPanning: false
    };
    _applyAdditionalModalTransform(state.additionalModal);
    _updateAdditionalModalCursor(state.additionalModal);
    state.additionalModalKeyHandler = keyHandler;
    return state.additionalModal;
  }

  function _openAdditionalModal(url, captionText) {
    const modal = _ensureAdditionalModal();
    if (!modal || !url) return;
    _resetAdditionalModalTransform(modal);
    modal.img.src = url;
    modal.img.alt = captionText || "";
    modal.caption.textContent = captionText || "";
    modal.overlay.classList.remove("hidden");
    modal.overlay.setAttribute("aria-hidden", "false");
  }

  function _closeAdditionalModal() {
    if (!state.additionalModal || !state.additionalModal.overlay) return;
    state.additionalModal.overlay.classList.add("hidden");
    state.additionalModal.overlay.setAttribute("aria-hidden", "true");
    if (state.additionalModal.img) state.additionalModal.img.src = "";
    _resetAdditionalModalTransform(state.additionalModal);
  }

  function _resetAdditionalModalTransform(modal) {
    if (!modal) return;
    modal.scale = modal.minScale || 1;
    modal.translateX = 0;
    modal.translateY = 0;
    modal.isPanning = false;
    _applyAdditionalModalTransform(modal);
    _updateAdditionalModalCursor(modal);
  }

  function _applyAdditionalModalTransform(modal) {
    if (!modal || !modal.zoomLayer) return;
    modal.zoomLayer.style.transform = `translate(${modal.translateX}px, ${modal.translateY}px) scale(${modal.scale})`;
  }

  function _updateAdditionalModalCursor(modal) {
    if (!modal || !modal.zoomLayer) return;
    const cursor =
      modal.scale && modal.scale > (modal.minScale || 1) && modal.isPanning ? "grabbing" :
        modal.scale && modal.scale > (modal.minScale || 1) ? "grab" :
          "zoom-in";
    modal.zoomLayer.style.cursor = cursor;
  }

  function _createAdditionalInfoCard(info) {
    if (!info) return null;
    const card = _createEl(
      "div",
      "task-chip overflow-hidden rounded-2xl border-2 border-border-strong bg-surface-2 text-sm text-text-main shadow-sm dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark",
      ""
    );
    card.setAttribute("data-clickui", "additional-info");

    const header = _createEl(
      "div",
      "flex items-center gap-2 border-b border-border-strong bg-surface-1 px-4 py-3 text-[12px] font-bold uppercase tracking-[0.08em] text-text-main dark:border-border-strong dark:text-text-on-dark",
      ""
    );
    header.appendChild(
      _createEl(
        "span",
        "material-symbols-outlined text-[17px] text-text-secondary dark:text-text-secondary",
        "library_books"
      )
    );
    header.appendChild(_createEl("span", "", wt("clickui.extra_materials", "Доп. материалы")));
    card.appendChild(header);

    const body = _createEl("div", "flex flex-col gap-2.5 px-4 py-3", "");
    card.appendChild(body);

    if (info.text) {
      const textEl = _createEl(
        "div",
        "whitespace-pre-wrap text-[13px] leading-6 text-text-main dark:text-text-on-dark",
        info.text
      );
      body.appendChild(textEl);
    }

    if (info.images && info.images.length) {
      const gallery = _createEl("div", "flex flex-wrap gap-2", "");
      info.images.slice(0, 3).forEach((imgPath, idx) => {
        const url = _resolveAssetUrl(imgPath);
        if (!url) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className =
          "group relative h-20 w-[7.25rem] overflow-hidden rounded-xl border border-border-subtle bg-surface-2 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-border-strong dark:bg-surface-2";

        const img = document.createElement("img");
        img.src = url;
        img.alt = info.text ? wt("clickui.extra_img_n", "Доп. изображение {n}").replace("{n}", idx + 1) : wt("clickui.extra_img_default", "Дополнительное изображение");
        img.className = "h-full w-full object-cover transition duration-200 group-hover:scale-105";

        const overlay = _createEl(
          "div",
          "pointer-events-none absolute inset-0 flex items-center justify-center bg-scrim opacity-0 transition group-hover:opacity-100",
          ""
        );
        const icon = _createEl("span", "material-symbols-outlined text-text-on-dark", "open_in_full");
        overlay.appendChild(icon);

        button.appendChild(img);
        button.appendChild(overlay);
        button.addEventListener("click", () => _openAdditionalModal(url, img.alt));
        gallery.appendChild(button);
      });
      body.appendChild(gallery);
    }

    if (!info.text && (!info.images || !info.images.length)) {
      body.appendChild(
        _createEl(
          "div",
          "text-[13px] text-text-muted dark:text-text-muted",
          wt("clickui.no_extra_materials", "Дополнительные материалы отсутствуют")
        )
      );
    }

    return card;
  }

  function _createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function _escapeHtml(text) {
    const el = document.createElement("span");
    el.textContent = text != null ? String(text) : "";
    return el.innerHTML;
  }

  function _clearMarkers() {
    if (!state.markerLayer) return;
    state.markerLayer.innerHTML = "";
  }

  function _applyTransform() {
    if (!state.contentLayer) return;
    state.contentLayer.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    state.contentLayer.style.transformOrigin = "0 0";
  }

  function _shouldHideTargetsList(taskDto) {
    const explicitRequiresLabels =
      (taskDto && taskDto.task_data && taskDto.task_data.content && taskDto.task_data.content.requires_labels) ||
      (taskDto && taskDto.task_data && taskDto.task_data.requires_labels) ||
      (taskDto && taskDto.content && taskDto.content.requires_labels) ||
      (taskDto && taskDto.requires_labels);
    return explicitRequiresLabels == null ? _getDifficultyLevel(taskDto) >= 2 : Boolean(explicitRequiresLabels);
  }

  function _sanitizeViewState(viewState) {
    if (!viewState || typeof viewState !== "object") return null;
    const nextZoom = Number(viewState.zoom);
    const nextPanX = Number(viewState.panX);
    const nextPanY = Number(viewState.panY);
    const requestedMode = String(viewState.mode || "").trim();
    const mode =
      requestedMode === "pan" || requestedMode === "brush" || requestedMode === "click"
        ? requestedMode
        : "click";

    return {
      zoom: Number.isFinite(nextZoom) ? Math.max(0.25, Math.min(6, nextZoom)) : null,
      panX: Number.isFinite(nextPanX) ? nextPanX : null,
      panY: Number.isFinite(nextPanY) ? nextPanY : null,
      mode,
      showRef: viewState.showRef === true,
      showRefContours: viewState.showRefContours !== false,
      showRefPolygons: viewState.showRefPolygons !== false,
      showRefLines: viewState.showRefLines !== false,
      showRefLabels: viewState.showRefLabels !== false,
      showUserMarks: viewState.showUserMarks !== false,
    };
  }

  function _applyRestoredViewState(viewState, options = {}) {
    const safeViewState = _sanitizeViewState(viewState);
    if (!safeViewState) return;

    const applyViewport = options.applyViewport !== false;

    state.showRef = safeViewState.showRef;
    state.showRefContours = safeViewState.showRefContours;
    state.showRefPolygons = safeViewState.showRefPolygons;
    state.showRefLines = safeViewState.showRefLines;
    state.showRefLabels = safeViewState.showRefLabels;
    state.showUserMarks = safeViewState.showUserMarks;
    _setMode(safeViewState.mode);

    if (
      applyViewport &&
      safeViewState.zoom != null &&
      safeViewState.panX != null &&
      safeViewState.panY != null
    ) {
      state.zoom = safeViewState.zoom;
      state.panX = safeViewState.panX;
      state.panY = safeViewState.panY;
      _applyTransform();
    }

    _renderMarkers();
    _renderDrawing();
    _renderReference();
    _applyUserMarksVisibility();
    if (typeof state._updateToolbar === "function") state._updateToolbar();
    if (typeof state._updateLabelsIndicator === "function") state._updateLabelsIndicator();
  }

  function _clearDrawing() {
    if (!state.drawLayer) return;
    state.drawLayer.innerHTML = "";
  }

  function _requiresLabels() {
    const taskDto = state.taskDto;
    const explicit =
      (taskDto && taskDto.task_data && taskDto.task_data.content
        ? taskDto.task_data.content.requires_labels
        : null) ??
      (taskDto && taskDto.task_data ? taskDto.task_data.requires_labels : null) ??
      (taskDto && taskDto.content ? taskDto.content.requires_labels : null);
    if (explicit === true) return true;
    const difficulty = _getDifficultyLevel(taskDto);
    const iteration =
      taskDto && Number.isFinite(Number(taskDto.iteration)) ? Number(taskDto.iteration) : null;
    const inferredLevel = Math.max(Number(difficulty) || 0, Number(iteration) || 0, 1);
    if (inferredLevel >= 2) return true;
    return explicit === false ? false : false;
  }

  function _hasAnyUserMarks() {
    return Boolean(
      (state.clicks && state.clicks.length) ||
      (state.polygons && state.polygons.length) ||
      (state.lines && state.lines.length)
    );
  }

  function _ensureLabelsLengths() {
    if (!Array.isArray(state.labelsClicks)) state.labelsClicks = [];
    if (!Array.isArray(state.labelsPolygons)) state.labelsPolygons = [];
    if (!Array.isArray(state.labelsLines)) state.labelsLines = [];
    if (Array.isArray(state.clicks) && state.labelsClicks.length !== state.clicks.length) {
      state.labelsClicks = state.clicks.map((_, i) => state.labelsClicks[i] || "");
    }
    if (Array.isArray(state.polygons) && state.labelsPolygons.length !== state.polygons.length) {
      state.labelsPolygons = state.polygons.map((_, i) => state.labelsPolygons[i] || "");
    }
    if (Array.isArray(state.lines) && state.labelsLines.length !== state.lines.length) {
      state.labelsLines = state.lines.map((_, i) => state.labelsLines[i] || "");
    }
  }

  function _clearReference() {
    if (!state.refLayer) return;
    state.refLayer.innerHTML = "";
  }

  function _centroid(points) {
    if (!Array.isArray(points) || points.length < 1) return null;
    let x = 0;
    let y = 0;
    let n = 0;
    for (const p of points) {
      const xy = _normalizeXY(p);
      if (!xy) continue;
      x += xy[0];
      y += xy[1];
      n += 1;
    }
    if (!n) return null;
    return { x: x / n, y: y / n };
  }

  function _normalizeXY(p) {
    if (Array.isArray(p) && p.length >= 2) {
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
      return null;
    }
    if (p && typeof p === "object") {
      const x = Number(p.x);
      const y = Number(p.y);
      if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
    }
    return null;
  }

  function _pointsLookNormalized(pointsXY) {
    if (!Array.isArray(pointsXY) || !pointsXY.length) return false;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const xy of pointsXY) {
      if (!xy) continue;
      if (xy[0] > maxX) maxX = xy[0];
      if (xy[1] > maxY) maxY = xy[1];
    }
    return maxX <= 1.5 && maxY <= 1.5;
  }

  function _getReviewCanvasSize() {
    const width =
      Number(state.img && (state.img.naturalWidth || state.img.width)) ||
      Number((state.taskDto && state.taskDto.image_width) || 0) ||
      640;
    const height =
      Number(state.img && (state.img.naturalHeight || state.img.height)) ||
      Number((state.taskDto && state.taskDto.image_height) || 0) ||
      360;
    return {
      width: Math.max(1, width),
      height: Math.max(1, height),
    };
  }

  function _scaleReviewPoint(xy, naturalW, naturalH) {
    if (!xy) return null;
    const isNorm = xy[0] <= 1.5 && xy[1] <= 1.5;
    return {
      x: isNorm ? xy[0] * naturalW : xy[0],
      y: isNorm ? xy[1] * naturalH : xy[1],
    };
  }

  function _appendReviewPath(svg, points, options) {
    const opts = options || {};
    const naturalW = Number(opts.naturalW) || 1;
    const naturalH = Number(opts.naturalH) || 1;
    const normalized = Array.isArray(points) ? points.map((p) => _normalizeXY(p)).filter(Boolean) : [];
    if (!normalized.length) return null;
    const isNorm = _pointsLookNormalized(normalized);
    const scaled = normalized.map((xy) => ({
      x: isNorm ? xy[0] * naturalW : xy[0],
      y: isNorm ? xy[1] * naturalH : xy[1],
    }));
    if (!scaled.length) return null;
    if (!opts.closed && scaled.length < 2) return null;

    const d = scaled
      .map((pt, idx) => `${idx === 0 ? "M" : "L"} ${pt.x} ${pt.y}`)
      .join(" ");
    if (!d) return null;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", opts.closed ? `${d} Z` : d);
    path.setAttribute("fill", opts.closed ? opts.fill || "none" : "none");
    path.setAttribute("stroke", opts.stroke || "#2563eb");
    path.setAttribute("stroke-width", String(opts.strokeWidth || 4));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    if (opts.strokeDasharray) path.setAttribute("stroke-dasharray", opts.strokeDasharray);
    if (opts.strokeOpacity != null) path.setAttribute("stroke-opacity", String(opts.strokeOpacity));
    if (opts.fillOpacity != null) path.setAttribute("fill-opacity", String(opts.fillOpacity));
    if (opts.targetIndex != null) {
      path.setAttribute("data-target-index", String(opts.targetIndex));
      path.style.pointerEvents = "auto";
    }
    svg.appendChild(path);
    return scaled;
  }

  function _appendReviewMarker(svg, point, options) {
    const opts = options || {};
    const naturalW = Number(opts.naturalW) || 1;
    const naturalH = Number(opts.naturalH) || 1;
    const scaled = _scaleReviewPoint(_normalizeXY(point), naturalW, naturalH);
    if (!scaled) return null;

    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    if (opts.targetIndex != null) {
      g.setAttribute("data-target-index", String(opts.targetIndex));
      g.style.pointerEvents = "auto";
    }

    const outer = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    outer.setAttribute("cx", String(scaled.x));
    outer.setAttribute("cy", String(scaled.y));
    outer.setAttribute("r", String(opts.radius || 14));
    outer.setAttribute("fill", opts.fill || "#f59e0b");
    outer.setAttribute("fill-opacity", String(opts.fillOpacity != null ? opts.fillOpacity : 0.94));
    outer.setAttribute("stroke", opts.stroke || "#ffffff");
    outer.setAttribute("stroke-width", String(opts.strokeWidth || 3));
    g.appendChild(outer);

    if (opts.label) {
      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(scaled.x));
      text.setAttribute("y", String(scaled.y + 1));
      text.setAttribute("fill", opts.labelColor || "#ffffff");
      text.setAttribute("font-size", String(opts.labelSize || 12));
      text.setAttribute("font-family", "Inter, system-ui, sans-serif");
      text.setAttribute("font-weight", "700");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("dominant-baseline", "middle");
      text.textContent = String(opts.label);
      g.appendChild(text);
    }

    svg.appendChild(g);
    return scaled;
  }

  function _buildReviewSummary(parts) {
    const safeParts = Array.isArray(parts)
      ? parts.filter((part) => typeof part === "string" && part.trim())
      : [];
    return safeParts.length ? safeParts.join(" • ") : wt("clickui.no_marks", "Без отметок");
  }

  function _normalizeReviewLabelText(value) {
    const text = String(value == null ? "" : value).trim();
    return text || wt("clickui.no_name", "Без названия");
  }

  function _buildReviewLabelsBlock(titleText, items, dataTestUi) {
    const safeItems = Array.isArray(items) ? items : [];
    if (!safeItems.length) return null;

    const block = _createEl(
      "div",
      "mt-3 rounded-2xl border border-border-strong bg-surface-1 px-3 py-3 shadow-sm dark:border-border-strong dark:bg-surface-1",
      ""
    );
    if (dataTestUi) {
      block.setAttribute("data-clickui", dataTestUi);
    }

    block.appendChild(
      _createEl(
        "div",
        "text-xs font-semibold uppercase tracking-wide text-text-secondary dark:text-text-muted",
        titleText || wt("clickui.labels_default", "Названия")
      )
    );

    const list = _createEl("div", "mt-2 flex flex-col gap-2", "");
    safeItems.forEach((item, idx) => {
      const row = _createEl(
        "div",
        "rounded-xl border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-main dark:border-border-subtle dark:bg-surface-2 dark:text-text-on-dark",
        ""
      );
      if (item && item.targetIndex != null) {
        row.setAttribute("data-target-index", String(item.targetIndex));
      }
      const fallbackTitle =
        item && item.kind === "freehand"
          ? wt("clickui.shape_line_n", "Линия {n}").replace("{n}", idx + 1)
          : item && item.kind === "point"
            ? wt("clickui.shape_point_n", "Точка {n}").replace("{n}", idx + 1)
            : item && item.kind === "click"
              ? wt("clickui.shape_area_n", "Область {n}").replace("{n}", idx + 1)
              : wt("clickui.shape_polygon_n", "Контур {n}").replace("{n}", idx + 1);
      row.textContent = `${item && item.title ? item.title : fallbackTitle}: ${_normalizeReviewLabelText(item && item.label)}`;
      list.appendChild(row);
    });
    block.appendChild(list);
    return block;
  }

  function _setGlobalHover(hoverInfo) {
    console.log('[ClickUI] _setGlobalHover', JSON.stringify(hoverInfo));
    state.globalHoveredInfo = hoverInfo;
    _updateGlobalHoverOpacities();
  }

  function _updateGlobalHoverOpacities() {
    const hoverInfo = state.globalHoveredInfo;
    const svgElements = [];
    const panelElements = [];
    console.log('[ClickUI] _updateGlobalHoverOpacities hoverInfo=', JSON.stringify(hoverInfo),
      'labelOverlay=', !!state.labelOverlay,
      'targetRows=', Array.isArray(state.targetRows) ? state.targetRows.map(r => r.el ? r.el.getAttribute('data-target-index') : 'no-el') : 'N/A'
    );

    if (state.refLayer) {
      svgElements.push(...state.refLayer.querySelectorAll("[data-target-index]"));
    }
    if (state.labelOverlay) {
      svgElements.push(...state.labelOverlay.querySelectorAll("[data-target-index]"));
    }
    if (state.drawLayer) {
      svgElements.push(...state.drawLayer.querySelectorAll("[data-target-index], [data-clickui-action-key]"));
    }
    if (state.markerLayer) {
      svgElements.push(...state.markerLayer.querySelectorAll("[data-target-index], [data-clickui-action-key]"));
    }
    if (Array.isArray(state.targetRows)) {
      state.targetRows.forEach(r => { if (r.el) panelElements.push(r.el); });
    }
    if (Array.isArray(state.userActionRows)) {
      state.userActionRows.forEach(r => { if (r.el) panelElements.push(r.el); });
    }
    if (state.labelsContainer) {
      svgElements.push(...state.labelsContainer.querySelectorAll("[data-target-index]"));
    }

    if (!hoverInfo) {
      svgElements.forEach(el => { el.style.opacity = ""; });
      panelElements.forEach(el => {
        el.style.opacity = "";
        el.style.boxShadow = "";
        el.style.transform = "";
      });
      return;
    }

    const { targetIndex, actionKey } = hoverInfo;

    function _elMatches(el) {
      const elTargetIdxAttr = el.getAttribute("data-target-index");
      const elTargetIdx = (elTargetIdxAttr !== null && elTargetIdxAttr !== "") ? Number(elTargetIdxAttr) : null;
      const elActionKey = el.getAttribute("data-clickui-action-key");
      if (targetIndex !== null && targetIndex !== undefined) {
        if (elTargetIdx === targetIndex) return true;
        if (actionKey && elActionKey === actionKey) return true;
      } else if (actionKey) {
        if (elActionKey === actionKey) return true;
      }
      return false;
    }

    // SVG / canvas elements: opacity dim approach
    svgElements.forEach(el => {
      el.style.transition = "opacity 0.15s ease-in-out";
      el.style.opacity = _elMatches(el) ? "1" : "0.08";
    });

    // Panel rows: ring-highlight on match, subtle dim otherwise
    panelElements.forEach(el => {
      el.style.transition = "opacity 0.15s ease-in-out, box-shadow 0.15s ease-in-out, transform 0.15s ease-in-out";
      if (_elMatches(el)) {
        const elTargetIdxAttr = el.getAttribute("data-target-index");
        const elTargetIdx = (elTargetIdxAttr !== null && elTargetIdxAttr !== "") ? Number(elTargetIdxAttr) : null;
        const ringColor = elTargetIdx !== null ? _getTargetColor(elTargetIdx) : _getThemeColor("--color-accent", "#d97706");
        el.style.opacity = "1";
        el.style.boxShadow = `0 0 0 2px ${ringColor}, 0 2px 10px ${_withAlpha(ringColor, 0.22)}`;
        el.style.transform = "translateX(2px)";
      } else {
        el.style.opacity = "0.45";
        el.style.boxShadow = "";
        el.style.transform = "";
      }
    });

    // Bring hovered label text to front (last in SVG = rendered on top)
    if (targetIndex !== null && targetIndex !== undefined) {
      const labelContainer = state.labelOverlay || state.refLayer;
      if (labelContainer) {
        const labelSvg = labelContainer.querySelector("svg");
        if (labelSvg) {
          const hoveredLabel = labelSvg.querySelector(`text[data-target-index="${targetIndex}"]`);
          if (hoveredLabel) labelSvg.appendChild(hoveredLabel);
        }
      }
    }
  }

  function _setupReviewHoverEffects(card) {
    const hoverables = Array.from(card.querySelectorAll("[data-target-index]"));
    if (!hoverables.length) return;

    hoverables.forEach((el) => {
      el.style.transition = "opacity 0.2s ease-in-out";
    });

    hoverables.forEach((el) => {
      const targetIndexStr = el.getAttribute("data-target-index");
      if (targetIndexStr === null || targetIndexStr === undefined) return;

      el.addEventListener("mouseenter", () => {
        hoverables.forEach((other) => {
          if (other.getAttribute("data-target-index") !== targetIndexStr) {
            other.style.opacity = "0.08";
          } else {
            other.style.opacity = "1";
          }
        });
      });

      el.addEventListener("mouseleave", () => {
        hoverables.forEach((other) => {
          other.style.opacity = "";
        });
      });
    });
  }

  function _createReviewPreviewCard(config) {
    const opts = config || {};
    const card = _createEl(
      "section",
      "rounded-2xl border border-border-strong bg-surface-2 p-3 shadow-sm dark:border-border-strong dark:bg-surface-2",
      ""
    );
    if (opts.dataTestUi) {
      card.setAttribute("data-clickui", opts.dataTestUi);
    }

    const header = _createEl("div", "mb-2 flex items-start justify-between gap-3", "");
    const headerText = _createEl("div", "min-w-0", "");
    const title = _createEl(
      "div",
      "text-sm font-semibold text-text-main dark:text-text-on-dark",
      opts.title || ""
    );
    const description = _createEl(
      "div",
      "mt-0.5 text-xs leading-5 text-text-secondary dark:text-text-muted",
      opts.description || ""
    );
    headerText.appendChild(title);
    headerText.appendChild(description);
    header.appendChild(headerText);

    const imageUrl = opts.imageUrl ? String(opts.imageUrl) : "";
    if (imageUrl && typeof opts.openImage === "function") {
      const zoomBtn = document.createElement("button");
      zoomBtn.type = "button";
      zoomBtn.className =
        "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-strong bg-surface-1 text-text-main shadow-sm transition-colors hover:bg-bg-hover dark:border-border-strong dark:bg-surface-1 dark:text-text-on-dark dark:hover:bg-bg-hover";
      zoomBtn.title = wt("clickui.open_img", "Открыть изображение");
      zoomBtn.setAttribute("aria-label", wt("clickui.open_img", "Открыть изображение"));
      zoomBtn.setAttribute("data-clickui", `${opts.dataTestUi || "review"}-zoom`);
      const icon = _createEl("span", "material-symbols-outlined text-[18px]", "zoom_in");
      zoomBtn.appendChild(icon);
      zoomBtn.addEventListener("click", () => {
        opts.openImage(imageUrl, opts.title || wt("clickui.review_title", "Разбор ответа"));
      });
      header.appendChild(zoomBtn);
    }

    card.appendChild(header);

    const frame = _createEl(
      "div",
      "relative overflow-hidden rounded-2xl border border-border-strong bg-surface-1 shadow-inner dark:border-border-strong dark:bg-surface-1",
      ""
    );
    frame.style.aspectRatio = `${opts.naturalW || 1} / ${opts.naturalH || 1}`;
    frame.style.minHeight = "220px";
    frame.setAttribute("data-clickui", `${opts.dataTestUi || "review"}-frame`);

    if (imageUrl) {
      const img = document.createElement("img");
      img.src = imageUrl;
      img.alt = opts.title || "";
      img.draggable = false;
      img.className = "absolute inset-0 h-full w-full object-contain";
      frame.appendChild(img);
    } else {
      const placeholder = _createEl(
        "div",
        "absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-text-muted dark:text-text-muted",
        wt("clickui.orig_img_unavail", "Исходное изображение недоступно")
      );
      frame.appendChild(placeholder);
    }

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "absolute inset-0 h-full w-full");
    svg.style.pointerEvents = "none";
    svg.setAttribute("viewBox", `0 0 ${opts.naturalW || 1} ${opts.naturalH || 1}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    frame.appendChild(svg);

    if (typeof opts.renderSvg === "function") {
      opts.renderSvg(svg);
    }

    card.appendChild(frame);
    if (opts.labelsBlock) {
      card.appendChild(opts.labelsBlock);
    }
    _setupReviewHoverEffects(card);
    return card;
  }

  function _clearReviewComparison() {
    if (state.reviewComparisonEl && state.reviewComparisonEl.parentNode) {
      state.reviewComparisonEl.parentNode.removeChild(state.reviewComparisonEl);
    }
    state.reviewComparisonEl = null;
    if (state.reviewHost) {
      state.reviewHost.classList.add("hidden");
    }
  }

  function _buildUserReviewPreviewCard(imageUrl, naturalW, naturalH) {
    const parts = [];
    if (Array.isArray(state.clicks) && state.clicks.length) {
      parts.push(state.clicks.length === 1 ? wt("clickui.one_click", "1 клик") : wt("clickui.n_clicks", "{n} клика").replace("{n}", state.clicks.length));
    }
    if (Array.isArray(state.polygons) && state.polygons.length) {
      parts.push(state.polygons.length === 1 ? wt("clickui.one_polygon", "1 контур") : wt("clickui.n_polygons", "{n} контура").replace("{n}", state.polygons.length));
    }
    if (Array.isArray(state.lines) && state.lines.length) {
      parts.push(state.lines.length === 1 ? wt("clickui.one_line", "1 линия") : wt("clickui.n_lines", "{n} линии").replace("{n}", state.lines.length));
    }

    const shouldShowLabels = _requiresLabels() || _requiresDrawing();
    let labelsBlock = null;
    if (shouldShowLabels) {
      const labelItems = [];
      (state.clicks || []).forEach((_, idx) => {
        labelItems.push({
          kind: "click",
          title: wt("clickui.shape_area_n", "Область {n}").replace("{n}", idx + 1),
          label: state.labelsClicks && state.labelsClicks[idx],
          targetIndex: _findTargetIndex(state.taskDto, "click", idx),
        });
      });
      (state.polygons || []).forEach((_, idx) => {
        labelItems.push({
          kind: "polygon",
          title: wt("clickui.shape_polygon_n", "Контур {n}").replace("{n}", idx + 1),
          label: state.labelsPolygons && state.labelsPolygons[idx],
          targetIndex: _findTargetIndex(state.taskDto, "polygon", idx),
        });
      });
      (state.lines || []).forEach((_, idx) => {
        labelItems.push({
          kind: "freehand",
          title: wt("clickui.shape_line_n", "Линия {n}").replace("{n}", idx + 1),
          label: state.labelsLines && state.labelsLines[idx],
          targetIndex: _findTargetIndex(state.taskDto, "line", idx),
        });
      });
      labelsBlock = _buildReviewLabelsBlock(wt("clickui.user_labels", "Названия пользователя"), labelItems, "review-user-labels");
    }

    return _createReviewPreviewCard({
      dataTestUi: "review-user-preview",
      title: wt("clickui.your_answer", "Ваш ответ"),
      description: _buildReviewSummary(parts),
      imageUrl,
      naturalW,
      naturalH,
      openImage: _openAdditionalModal,
      labelsBlock,
      renderSvg(svg) {
        (state.polygons || []).forEach((poly, idx) => {
          const color = _getActionDisplayColor(state.taskDto, "polygon", idx);
          const targetIndex = _findTargetIndex(state.taskDto, "polygon", idx);
          _appendReviewPath(svg, poly && poly.points, {
            closed: true,
            naturalW,
            naturalH,
            stroke: color,
            fill: _withAlpha(color, 0.16),
            strokeWidth: 4,
            targetIndex: targetIndex !== null ? targetIndex : undefined,
          });
        });

        (state.lines || []).forEach((line, idx) => {
          const color = _getActionDisplayColor(state.taskDto, "line", idx);
          const targetIndex = _findTargetIndex(state.taskDto, "line", idx);
          _appendReviewPath(svg, line && line.points, {
            closed: false,
            naturalW,
            naturalH,
            stroke: color,
            strokeWidth: 4,
            strokeDasharray: "10 6",
            strokeOpacity: 0.92,
            targetIndex: targetIndex !== null ? targetIndex : undefined,
          });
        });

        (state.clicks || []).forEach((click, idx) => {
          const targetIndex = _findTargetIndex(state.taskDto, "click", idx);
          _appendReviewMarker(svg, [click && click.x, click && click.y], {
            naturalW,
            naturalH,
            radius: 14,
            fill: _getActionDisplayColor(state.taskDto, "click", idx),
            stroke: "#ffffff",
            label: idx + 1,
            targetIndex: targetIndex !== null ? targetIndex : undefined,
          });
        });
      },
    });
  }

  function _buildReferenceReviewPreviewCard(imageUrl, naturalW, naturalH) {
    const targets = _getTargets(state.taskDto);
    const points = targets.filter((target) => _getTargetShape(target) === "point").length;
    const outlines = targets.filter((target) => _getTargetShape(target) === "polygon").length;
    const lines = targets.filter((target) => _getTargetShape(target) === "freehand").length;
    const parts = [];
    if (points) {
      parts.push(points === 1 ? wt("clickui.one_point", "1 точка") : wt("clickui.n_points", "{n} точки").replace("{n}", points));
    }
    if (outlines) {
      parts.push(outlines === 1 ? wt("clickui.one_polygon", "1 контур") : wt("clickui.n_polygons", "{n} контура").replace("{n}", outlines));
    }
    if (lines) {
      parts.push(lines === 1 ? wt("clickui.one_line", "1 линия") : wt("clickui.n_lines", "{n} линии").replace("{n}", lines));
    }

    const shouldShowLabels = _requiresLabels() || _requiresDrawing();
    let labelsBlock = null;
    if (shouldShowLabels) {
      const labelItems = targets.map((target, idx) => {
        const meta = _getTargetInteractionMeta(state.taskDto, target);
        return {
          kind: _getTargetShape(target),
          title: `${meta && meta.label ? meta.label : wt("clickui.target_fallback", "Цель")} ${idx + 1}`,
          label: target && target.label,
          targetIndex: idx,
        };
      });
      labelsBlock = _buildReviewLabelsBlock(wt("clickui.ref_labels", "Эталонные названия"), labelItems, "review-reference-labels");
    }

    return _createReviewPreviewCard({
      dataTestUi: "review-reference-preview",
      title: wt("clickui.reference", "Эталон"),
      description: _buildReviewSummary(parts),
      imageUrl,
      naturalW,
      naturalH,
      openImage: _openAdditionalModal,
      labelsBlock,
      renderSvg(svg) {
        targets.forEach((target, idx) => {
          const shape = _getTargetShape(target);
          const isBad = state.badRefTargets instanceof Set && state.badRefTargets.has(idx);
          const baseColor = isBad ? _getThemeColor("--color-error", "#ef4444") : _getTargetColor(idx);

          if (shape === "polygon") {
            _appendReviewPath(svg, target && target.points, {
              closed: true,
              naturalW,
              naturalH,
              stroke: baseColor,
              fill: _withAlpha(baseColor, isBad ? 0.12 : 0.18),
              strokeWidth: isBad ? 5 : 4,
              targetIndex: idx,
            });
          } else if (shape === "freehand") {
            _appendReviewPath(svg, target && target.points, {
              closed: false,
              naturalW,
              naturalH,
              stroke: baseColor,
              strokeWidth: isBad ? 5 : 4,
              strokeDasharray: "10 6",
              strokeOpacity: 0.92,
              targetIndex: idx,
            });
          } else if (shape === "point") {
            _appendReviewMarker(svg, target && target.point, {
              naturalW,
              naturalH,
              radius: 15,
              fill: baseColor,
              stroke: "#ffffff",
              label: idx + 1,
              targetIndex: idx,
            });
          } else if (Array.isArray(target && target.points) && target.points.length >= 2) {
            const inferClosed = target.points.length >= 3;
            _appendReviewPath(svg, target.points, {
              closed: inferClosed,
              naturalW,
              naturalH,
              stroke: baseColor,
              fill: inferClosed ? _withAlpha(baseColor, isBad ? 0.12 : 0.18) : undefined,
              strokeWidth: isBad ? 5 : 4,
              strokeDasharray: inferClosed ? undefined : "10 6",
              targetIndex: idx,
            });
          } else if (target && (target.point || target.coordinates || target.x != null)) {
            const pt = target.point || (target.x != null ? [target.x, target.y] : null);
            if (pt) {
              _appendReviewMarker(svg, pt, {
                naturalW,
                naturalH,
                radius: 15,
                fill: baseColor,
                stroke: "#ffffff",
                label: idx + 1,
                targetIndex: idx,
              });
            }
          }
        });
      },
    });
  }

  function _renderReviewComparison(result) {
    _clearReviewComparison();
    if (!state.reviewHost) return;
    // Разбор ответа показывается для всех уровней сложности (L1, L2, L3).
    // Убрана старая проверка, которая скрывала блок для L2/L3.

    const imageUrl = _resolveImageUrl(state.taskDto);
    const canvasSize = _getReviewCanvasSize();
    const section = _createEl(
      "section",
      "rounded-[28px] border border-border-strong bg-surface-1/80 p-4 shadow-sm dark:border-border-strong dark:bg-surface-1/80",
      ""
    );
    section.setAttribute("data-clickui", "review-comparison");

    const title = _createEl(
      "div",
      "text-base font-semibold text-text-main dark:text-text-on-dark",
      result && result.success === true ? wt("clickui.review_success_title", "Разбор ответа") : wt("clickui.review_error_title", "Разбор ошибок")
    );
    const note = _createEl(
      "div",
      "mt-1 text-sm leading-6 text-text-secondary dark:text-text-muted",
      result && result.success === true
        ? wt("clickui.review_success_desc", "Показываем, что вы отметили на изображении, и рядом оставляем эталон для быстрой сверки.")
        : wt("clickui.review_error_desc", "Слева сохранён ваш ответ, справа показан эталон на том же изображении, чтобы различия считывались визуально.")
    );
    const grid = _createEl("div", "mt-4 grid gap-3 xl:grid-cols-2", "");
    grid.appendChild(_buildUserReviewPreviewCard(imageUrl, canvasSize.width, canvasSize.height));
    grid.appendChild(_buildReferenceReviewPreviewCard(imageUrl, canvasSize.width, canvasSize.height));

    section.appendChild(title);
    section.appendChild(note);
    section.appendChild(grid);
    state.reviewHost.classList.remove("hidden");
    state.reviewHost.appendChild(section);
    state.reviewComparisonEl = section;
  }

  function _renderReference() {
    if (!state.refLayer || !state.img) return;
    _clearReference();

    if (!state.showRef) return;

    const taskDto = state.taskDto;
    const answerKey = (taskDto && taskDto.answer_key) || {};
    const targets = Array.isArray(answerKey.targets) ? answerKey.targets : [];
    if (!targets.length) return;

    if (_debugEnabled()) {
      try {
        let polyCount = 0;
        let lineCount = 0;
        let pointCount = 0;
        let unknownCount = 0;

        for (const t of targets) {
          if (!t || typeof t !== "object") {
            unknownCount += 1;
            continue;
          }
          const shape = (t.shape || t.type) != null ? String(t.shape || t.type).toLowerCase() : "";
          if (shape === "polygon") polyCount += 1;
          else if (shape === "freehand") lineCount += 1;
          else if (shape === "point") pointCount += 1;
          else if (Array.isArray(t.points)) {
            if (t.points.length >= 3) polyCount += 1;
            else if (t.points.length >= 2) lineCount += 1;
            else unknownCount += 1;
          } else if (Array.isArray(t.point) || t.coordinates) {
            pointCount += 1;
          } else {
            unknownCount += 1;
          }
        }

        const sample = targets.slice(0, 2).map((t) => {
          const shape = t && (t.shape || t.type);
          const ptsN = Array.isArray(t && t.points) ? t.points.length : null;
          return { shape, points: ptsN, label: t && t.label };
        });

        console.log("[ClickUI][ref] flags", {
          showRef: state.showRef,
          showRefContours: state.showRefContours,
          showRefPolygons: state.showRefPolygons,
          showRefLines: state.showRefLines,
          showRefLabels: state.showRefLabels,
          targets: targets.length,
          polyCount,
          lineCount,
          pointCount,
          unknownCount,
          sample,
        });
      } catch (e) {
        // ignore
      }
    }

    const naturalW = state.img.naturalWidth || 1;
    const naturalH = state.img.naturalHeight || 1;
    const zoom = state.zoom || 1;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "absolute inset-0 h-full w-full z-10");
    // ВАЖНО: pointer-events задаём через inline-стиль, а не через Tailwind-класс.
    // Tailwind-класс pointer-events-none на SVG-элементе блокирует события
    // у всех дочерних элементов на уровне браузера, не давая им переопределить
    // pointer-events своими собственными значениями (visiblePainted и т.п.).
    // Inline-стиль none на SVG-рутовом элементе — прозрачные зоны пропускают
    // клики, но дочерние polygon/path/circle с явным pointer-events могут
    // получать события мыши.
    svg.style.pointerEvents = "none";
    // Do not rely only on Tailwind classes for sizing; make overlay sizing explicit.
    svg.setAttribute("width", String(naturalW));
    svg.setAttribute("height", String(naturalH));
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";
    svg.style.position = "absolute";
    svg.style.left = "0";
    svg.style.top = "0";
    svg.style.zIndex = "10";
    svg.setAttribute("viewBox", `0 0 ${naturalW} ${naturalH}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const strokePoly = _getThemeColor("--color-accent", "#a855f7");
    const fillPoly = _withAlpha(strokePoly, 0.18);
    const strokeLine = _getThemeColor("--color-warning", "#f59e0b");
    const errorStroke = _getThemeColor("--color-error", "#f43f5e");
    const errorFill = _withAlpha(errorStroke, 0.1);
    const labelFill = _getThemeColor("--color-text-main", "#0f172a");
    const labelStroke = _getThemeColor("--color-text-on-dark", "#ffffff");

    const bad = state.badRefTargets instanceof Set ? state.badRefTargets : null;

    let appendedPolygons = 0;
    let appendedLines = 0;
    let appendedPoints = 0;

    const normalEls = [];
    const badEls = [];
    const labelEls = [];

    function _isLikelyNormalized(pointsXY) {
      // If coordinates are in [0..1] (or a bit above due to rounding), treat as normalized.
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const xy of pointsXY) {
        if (!xy) continue;
        if (xy[0] > maxX) maxX = xy[0];
        if (xy[1] > maxY) maxY = xy[1];
      }
      return maxX <= 1.5 && maxY <= 1.5;
    }

    targets.forEach((t, idx) => {
      if (!t || typeof t !== "object") return;
      const shape = (t && (t.shape || t.type)) || null;
      let shapeLower = String(shape || "").toLowerCase();
      // Fallback: infer shape from points ONLY if shape/type is missing.
      if (!shapeLower && Array.isArray(t.points)) {
        if (t.points.length >= 3) shapeLower = "polygon";
        else if (t.points.length >= 2) shapeLower = "freehand";
      }
      const label = (t.label != null ? String(t.label) : "").trim();

      let labelPos = null;

      const isBad = bad ? bad.has(idx) : false;
      const baseColor = isBad ? errorStroke : _getTargetColor(idx);
      const baseFill = _withAlpha(baseColor, isBad ? 0.1 : 0.18);

      if (state.showRefContours) {
        if (
          state.showRefPolygons &&
          shapeLower === "polygon" &&
          Array.isArray(t.points) &&
          t.points.length >= 3
        ) {
          const norm = t.points.map((p) => _normalizeXY(p)).filter(Boolean);
          const isNorm = _isLikelyNormalized(norm);
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          const pts = norm
            .map((xy) => {
              const x = isNorm ? xy[0] * naturalW : xy[0];
              const y = isNorm ? xy[1] * naturalH : xy[1];
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
              return `${x},${y}`;
            })
            .join(" ");

          if (_debugEnabled()) {
            try {
              console.log("[ClickUI][ref] polygon target", {
                idx,
                isNorm,
                bbox: { minX, minY, maxX, maxY },
                pointsN: norm.length,
              });
            } catch (e) {
              // ignore
            }
          }

          if (pts) {
            const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            poly.setAttribute("data-clickui-ref", "polygon");
            poly.setAttribute("points", pts);
            poly.setAttribute("fill", baseFill);
            poly.setAttribute("stroke", baseColor);
            poly.setAttribute("stroke-width", String((isBad ? 3 : 2) / zoom));
            poly.setAttribute("stroke-opacity", "0.75");
            poly.setAttribute("data-target-index", String(idx));
            poly.setAttribute("pointer-events", "visiblePainted");

            // Also set inline styles to prevent any external CSS from overriding SVG attributes.
            poly.style.stroke = baseColor;
            poly.style.strokeWidth = String((isBad ? 3 : 2) / zoom);
            poly.style.strokeOpacity = "0.75";
            poly.style.fill = baseFill;
            poly.style.pointerEvents = "visiblePainted";

            if (isBad) {
              poly.classList.add("clickui-bad-target");
            }
            poly.addEventListener("mouseenter", () => _setGlobalHover({ targetIndex: idx }));
            poly.addEventListener("mouseleave", () => _setGlobalHover(null));

            (isBad ? badEls : normalEls).push(poly);
            appendedPolygons += 1;
            labelPos = _centroid(t.points);
          }
        } else if (
          state.showRefLines &&
          shapeLower === "freehand" &&
          Array.isArray(t.points) &&
          t.points.length >= 2
        ) {
          const norm = t.points.map((p) => _normalizeXY(p)).filter(Boolean);
          const isNorm = _isLikelyNormalized(norm);
          const d = norm
            .map((xy, i) => {
              const x = isNorm ? xy[0] * naturalW : xy[0];
              const y = isNorm ? xy[1] * naturalH : xy[1];
              return `${i === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .join(" ");
          if (d) {
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("data-clickui-ref", "freehand");
            path.setAttribute("d", d);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", baseColor);
            path.setAttribute("stroke-width", String((isBad ? 3 : 2) / zoom));
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            path.setAttribute("stroke-opacity", "0.85");
            path.setAttribute("stroke-dasharray", `${10 / zoom} ${6 / zoom}`);
            path.setAttribute("data-target-index", String(idx));
            path.setAttribute("pointer-events", "visibleStroke");

            // Inline styles as well.
            path.style.stroke = baseColor;
            path.style.strokeWidth = String((isBad ? 3 : 2) / zoom);
            path.style.strokeOpacity = "0.85";
            path.style.strokeDasharray = `${10 / zoom} ${6 / zoom}`;
            path.style.pointerEvents = "visibleStroke";

            if (isBad) {
              path.classList.add("clickui-bad-target");
            }
            path.addEventListener("mouseenter", () => _setGlobalHover({ targetIndex: idx }));
            path.addEventListener("mouseleave", () => _setGlobalHover(null));

            (isBad ? badEls : normalEls).push(path);
            appendedLines += 1;
            labelPos = _centroid(t.points);
          }
        } else if (shapeLower === "point") {
          const pt = _normalizeXY(t.point);
          if (pt) {
            const isNorm = pt[0] <= 1.5 && pt[1] <= 1.5;
            const x = isNorm ? pt[0] * naturalW : pt[0];
            const y = isNorm ? pt[1] * naturalH : pt[1];
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("cx", String(x));
            circle.setAttribute("cy", String(y));
            circle.setAttribute("r", String(10 / zoom));
            circle.setAttribute("fill", baseFill);
            circle.setAttribute("stroke", baseColor);
            circle.setAttribute("stroke-width", String(2 / zoom));
            circle.setAttribute("data-target-index", String(idx));
            circle.setAttribute("pointer-events", "auto");
            circle.style.pointerEvents = "auto";

            circle.addEventListener("mouseenter", () => _setGlobalHover({ targetIndex: idx }));
            circle.addEventListener("mouseleave", () => _setGlobalHover(null));

            (bad && bad.has(idx) ? badEls : normalEls).push(circle);
            appendedPoints += 1;
            labelPos = { x, y };
          }
        }
      } else {
        // If contours are hidden but labels are on, we still need a label position.
        if (shapeLower === "point") {
          const pt = _normalizeXY(t.point);
          if (pt) labelPos = { x: Number(pt[0]) || 0, y: Number(pt[1]) || 0 };
        } else if (Array.isArray(t.points)) {
          labelPos = _centroid(t.points);
        }
      }

      if (state.showRefLabels) {
        const textValue = label || `#${idx + 1}`;
        if (labelPos && typeof labelPos.x === "number" && typeof labelPos.y === "number") {
          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", String(labelPos.x));
          text.setAttribute("y", String(labelPos.y));
          // High-contrast label: dark fill with light stroke, readable on any background.
          text.setAttribute("fill", labelFill);
          text.setAttribute("stroke", labelStroke);
          text.setAttribute("stroke-width", String(3 / zoom));
          text.setAttribute("paint-order", "stroke fill");
          text.setAttribute("stroke-linejoin", "round");
          text.setAttribute("font-size", String(13 / zoom));
          text.setAttribute("font-family", "Inter, system-ui, sans-serif");
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("dominant-baseline", "middle");
          text.setAttribute("data-target-index", String(idx));
          text.setAttribute("pointer-events", "auto");
          text.style.pointerEvents = "auto";
          text.style.cursor = "pointer";

          text.textContent = textValue;
          text.addEventListener("mouseenter", () => _setGlobalHover({ targetIndex: idx }));
          text.addEventListener("mouseleave", () => _setGlobalHover(null));

          labelEls.push(text);
        }
      }
    });

    for (const el of normalEls) svg.appendChild(el);
    for (const el of badEls) svg.appendChild(el);

    state.refLayer.appendChild(svg);

    // Labels rendered in a dedicated overlay above markerLayer (z-40) so they
    // are never occluded by click-marker HTML divs at z-30.
    if (state.labelOverlay) {
      state.labelOverlay.innerHTML = "";
      if (labelEls.length) {
        const labelSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        labelSvg.setAttribute("viewBox", `0 0 ${naturalW} ${naturalH}`);
        labelSvg.setAttribute("preserveAspectRatio", "none");
        labelSvg.style.pointerEvents = "none";
        labelSvg.style.position = "absolute";
        labelSvg.style.inset = "0";
        labelSvg.style.width = "100%";
        labelSvg.style.height = "100%";
        for (const el of labelEls) labelSvg.appendChild(el);
        state.labelOverlay.appendChild(labelSvg);
      }
    }

    if (_debugEnabled()) {
      try {
        const csSvg = window.getComputedStyle ? window.getComputedStyle(svg) : null;
        const csRef = window.getComputedStyle ? window.getComputedStyle(state.refLayer) : null;
        const refPolys = svg.querySelectorAll('[data-clickui-ref="polygon"]').length;
        const refLines = svg.querySelectorAll('[data-clickui-ref="freehand"]').length;

        const firstPoly = svg.querySelector('[data-clickui-ref="polygon"]');
        const firstLine = svg.querySelector('[data-clickui-ref="freehand"]');
        const csPoly = firstPoly && window.getComputedStyle ? window.getComputedStyle(firstPoly) : null;
        const csLine = firstLine && window.getComputedStyle ? window.getComputedStyle(firstLine) : null;

        const polyAttrs = firstPoly
          ? {
            stroke: firstPoly.getAttribute("stroke"),
            strokeOpacity: firstPoly.getAttribute("stroke-opacity"),
            fill: firstPoly.getAttribute("fill"),
            strokeWidth: firstPoly.getAttribute("stroke-width"),
          }
          : null;
        const lineAttrs = firstLine
          ? {
            stroke: firstLine.getAttribute("stroke"),
            strokeOpacity: firstLine.getAttribute("stroke-opacity"),
            strokeDasharray: firstLine.getAttribute("stroke-dasharray"),
            strokeWidth: firstLine.getAttribute("stroke-width"),
          }
          : null;

        const dbg = {
          svgChildren: svg.childNodes ? svg.childNodes.length : null,
          refLayerChildren: state.refLayer.childNodes ? state.refLayer.childNodes.length : null,
          appendedPolygons,
          appendedLines,
          appendedPoints,
          refPolys,
          refLines,
          naturalW,
          naturalH,
          svgViewBox: svg.getAttribute("viewBox"),
          imgRect: state.img ? state.img.getBoundingClientRect() : null,
          contentRect: state.contentLayer ? state.contentLayer.getBoundingClientRect() : null,
          refRect: state.refLayer ? state.refLayer.getBoundingClientRect() : null,
          svgRect: svg.getBoundingClientRect ? svg.getBoundingClientRect() : null,
          refStyle: csRef
            ? { display: csRef.display, visibility: csRef.visibility, opacity: csRef.opacity, zIndex: csRef.zIndex }
            : null,
          svgStyle: csSvg
            ? { display: csSvg.display, visibility: csSvg.visibility, opacity: csSvg.opacity, position: csSvg.position }
            : null,
          polyAttrs,
          polyStyle: csPoly
            ? {
              stroke: csPoly.stroke,
              strokeOpacity: csPoly.strokeOpacity,
              fill: csPoly.fill,
              fillOpacity: csPoly.fillOpacity,
            }
            : null,
          lineAttrs,
          lineStyle: csLine
            ? {
              stroke: csLine.stroke,
              strokeOpacity: csLine.strokeOpacity,
              strokeDasharray: csLine.strokeDasharray,
            }
            : null,
        };
        // Save + print full JSON so you can just copy it from the console.
        try {
          window.__CLICKUI_LAST_REF_RENDERED = dbg;
        } catch (e) {
          // ignore
        }
        console.log("[ClickUI][ref] rendered", dbg);
        try {
          console.log("[ClickUI][ref] rendered JSON\n" + JSON.stringify(dbg, null, 2));
        } catch (e) {
          // ignore
        }

        _clientLog("ref_rendered", dbg);
      } catch (e) {
        // ignore
      }
    }
  }

  function _renderDrawing() {
    if (!state.drawLayer || !state.img) return;
    _clearDrawing();

    const naturalW = state.img.naturalWidth || 1;
    const naturalH = state.img.naturalHeight || 1;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "absolute inset-0 h-full w-full pointer-events-none z-20");
    svg.setAttribute("viewBox", `0 0 ${naturalW} ${naturalH}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const zoom = state.zoom || 1;
    const primaryStroke = _getThemeColor("--color-primary", "#1349ec");
    const errorStroke = _getThemeColor("--color-error", "#ef4444");
    const successStroke = _getThemeColor("--color-success", "#22c55e");
    const textOnDark = _getThemeColor("--color-text-on-dark", "#ffffff");
    const strokeColor = state.userLinesCheckedStyle ? errorStroke : primaryStroke;
    const strokeOpacity = state.userLinesCheckedStyle ? "0.5" : "0.9";

    function attachActionHover(node, actionKey) {
      if (!node || !actionKey) return;
      node.setAttribute("data-clickui-action-key", actionKey);
      node.addEventListener("mouseenter", () => _setHoveredActionKey(actionKey));
      node.addEventListener("mouseleave", () => _setHoveredActionKey(null));
      node.addEventListener("focus", () => _setHoveredActionKey(actionKey));
      node.addEventListener("blur", () => _setHoveredActionKey(null));
    }

    // Live preview of the active stroke while drawing (so the user sees it in real time)
    if (Array.isArray(state.activeStroke) && state.activeStroke.length >= 2) {
      const pts = state.activeStroke.filter(Boolean);
      const d = pts
        .map((p, i) => {
          const x = Array.isArray(p) ? p[0] : p.x;
          const y = Array.isArray(p) ? p[1] : p.y;
          if (typeof x !== "number" || typeof y !== "number") return null;
          return `${i === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .filter(Boolean)
        .join(" ");

      if (d) {
        const preview = document.createElementNS("http://www.w3.org/2000/svg", "path");
        preview.setAttribute("d", d);
        preview.setAttribute("fill", "none");
        preview.setAttribute("stroke", _requiresDrawing() ? successStroke : strokeColor);
        preview.setAttribute("stroke-width", String(3.5 / zoom));
        preview.setAttribute("stroke-linecap", "round");
        preview.setAttribute("stroke-linejoin", "round");
        preview.setAttribute("stroke-opacity", "0.55");
        svg.appendChild(preview);
      }
    }

    const allPolygons = state.soloDuringDraw ? [] : Array.isArray(state.polygons) ? state.polygons : [];
    allPolygons.forEach((poly, idx) => {
      const pts = (poly && Array.isArray(poly.points) ? poly.points : []).filter(Boolean);
      if (pts.length < 3) return;
      const actionKey = _getActionKey("polygon", idx);
      const mappedColor = _getActionDisplayColor(state.taskDto, "polygon", idx);
      const isHovered = state.hoveredActionKey === actionKey;
      const pathOpacity = state.userLinesCheckedStyle ? "0.55" : isHovered ? "1" : "0.9";

      const d = pts
        .map((p, i) => {
          const x = Array.isArray(p) ? p[0] : p.x;
          const y = Array.isArray(p) ? p[1] : p.y;
          if (typeof x !== "number" || typeof y !== "number") return null;
          return `${i === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .filter(Boolean)
        .join(" ");
      if (!d) return;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `${d} Z`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", mappedColor);
      path.setAttribute("stroke-width", String((isHovered ? 5 : 3.5) / zoom));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("stroke-opacity", pathOpacity);
      path.setAttribute("pointer-events", "visibleStroke");
      attachActionHover(path, actionKey);
      svg.appendChild(path);

      const first = pts[0];
      const x0 = Array.isArray(first) ? first[0] : first.x;
      const y0 = Array.isArray(first) ? first[1] : first.y;
      if (typeof x0 === "number" && typeof y0 === "number") {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("transform", `translate(${x0} ${y0})`);
        g.setAttribute("tabindex", "0");
        attachActionHover(g, actionKey);
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", String(11 / zoom));
        circle.setAttribute("fill", mappedColor);
        circle.setAttribute("stroke", textOnDark);
        circle.setAttribute("stroke-width", String(2 / zoom));
        circle.setAttribute("opacity", state.userLinesCheckedStyle ? "0.6" : isHovered ? "1" : "0.95");

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", "0");
        text.setAttribute("y", "1");
        text.setAttribute("fill", textOnDark);
        text.setAttribute("font-size", String(11 / zoom));
        text.setAttribute("font-family", "Inter, system-ui, sans-serif");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.textContent = String(idx + 1);

        g.appendChild(circle);
        g.appendChild(text);
        svg.appendChild(g);
      }
    });

    const allLines = state.soloDuringDraw ? [] : Array.isArray(state.lines) ? state.lines : [];
    allLines.forEach((line, idx) => {
      const pts = (line && Array.isArray(line.points) ? line.points : []).filter(Boolean);
      if (pts.length < 2) return;
      const actionKey = _getActionKey("line", idx);
      const mappedColor = _getActionDisplayColor(state.taskDto, "line", idx);
      const isHovered = state.hoveredActionKey === actionKey;

      const d = pts
        .map((p, i) => {
          const x = Array.isArray(p) ? p[0] : p.x;
          const y = Array.isArray(p) ? p[1] : p.y;
          if (typeof x !== "number" || typeof y !== "number") return null;
          return `${i === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .filter(Boolean)
        .join(" ");

      if (!d) return;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", mappedColor);
      path.setAttribute("stroke-width", String((isHovered ? 5 : 3.5) / zoom));
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("stroke-opacity", isHovered ? "1" : strokeOpacity);
      path.setAttribute("pointer-events", "visibleStroke");
      attachActionHover(path, actionKey);
      svg.appendChild(path);

      // Stroke numbering (separate from click markers): show near the first point
      const first = pts[0];
      const x0 = Array.isArray(first) ? first[0] : first.x;
      const y0 = Array.isArray(first) ? first[1] : first.y;
      if (typeof x0 === "number" && typeof y0 === "number") {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("transform", `translate(${x0} ${y0})`);
        g.setAttribute("tabindex", "0");
        attachActionHover(g, actionKey);

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", String(11 / zoom));
        circle.setAttribute("fill", mappedColor);
        circle.setAttribute("stroke", textOnDark);
        circle.setAttribute("stroke-width", String(2 / zoom));
        circle.setAttribute("opacity", state.userLinesCheckedStyle ? "0.6" : isHovered ? "1" : "0.95");

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", "0");
        text.setAttribute("y", "1");
        text.setAttribute("fill", textOnDark);
        text.setAttribute("font-size", String(11 / zoom));
        text.setAttribute("font-family", "Inter, system-ui, sans-serif");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.textContent = String(idx + 1);

        g.appendChild(circle);
        g.appendChild(text);
        svg.appendChild(g);
      }
    });

    state.drawLayer.appendChild(svg);
  }

  function _renderMarkers() {
    _clearMarkers();
    if (!state.markerLayer || !state.img) return;

    if (state.soloDuringDraw) return;

    const textOnDark = _getThemeColor("--color-text-on-dark", "#ffffff");
    const zoom = state.zoom || 1;
    const markerPx = Math.max(18, Math.round(32 / zoom));
    const markerFontPx = Math.max(9, Math.round(11 / zoom));
    const markerBorderPx = Math.max(1, Math.round(2 / zoom));

    const rect = state.img.getBoundingClientRect();
    const naturalW = state.img.naturalWidth || rect.width || 1;
    const naturalH = state.img.naturalHeight || rect.height || 1;

    state.clicks.forEach((c, idx) => {
      const actionKey = _getActionKey("click", idx);
      const targetIdx = _findTargetIndex(state.taskDto, "click", idx);
      const color = _getActionDisplayColor(state.taskDto, "click", idx);
      const isHovered = state.hoveredActionKey === actionKey;
      const dot = _createEl(
        "div",
        "absolute flex items-center justify-center -translate-x-1/2 -translate-y-1/2 rounded-full font-bold shadow-md clickui-marker-entry",
        ""
      );
      dot.style.width = `${markerPx}px`;
      dot.style.height = `${markerPx}px`;
      dot.style.fontSize = `${markerFontPx}px`;
      dot.style.borderWidth = `${markerBorderPx}px`;
      dot.style.borderStyle = "solid";

      dot.textContent = String(idx + 1);
      dot.style.left = `${c.x}px`;
      dot.style.top = `${c.y}px`;
      dot.title = wt("clickui.click_coord_title", "Клик {n}: ({x}, {y})").replace("{n}", idx + 1).replace("{x}", Math.round(c.x)).replace("{y}", Math.round(c.y));
      dot.style.backgroundColor = color;
      dot.style.borderColor = textOnDark;
      dot.style.color = textOnDark;
      if (state.userMarksCheckedStyle) {
        dot.style.opacity = "0.8";
      } else {
        dot.style.opacity = "1";
      }
      dot.style.boxShadow = isHovered
        ? `0 0 0 3px ${_withAlpha(color, 0.24)}`
        : `0 6px 18px ${_withAlpha(color, 0.16)}`;
      dot.style.zIndex = isHovered ? "3" : "1";
      dot.tabIndex = 0;
      dot.setAttribute("data-clickui-action-key", actionKey);
      if (targetIdx !== null) {
        dot.setAttribute("data-target-index", String(targetIdx));
      }
      dot.addEventListener("mouseenter", () => _setHoveredActionKey(actionKey));
      dot.addEventListener("mouseleave", () => _setHoveredActionKey(null));
      dot.addEventListener("focus", () => _setHoveredActionKey(actionKey));
      dot.addEventListener("blur", () => _setHoveredActionKey(null));
      state.markerLayer.appendChild(dot);
    });
  }

  function _getClickFromEvent(ev) {
    if (!state.img) return null;
    const rect = state.img.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const naturalW = state.img.naturalWidth || rect.width;
    const naturalH = state.img.naturalHeight || rect.height;

    const x = (ev.clientX - rect.left) * (naturalW / rect.width);
    const y = (ev.clientY - rect.top) * (naturalH / rect.height);

    return {
      x,
      y,
      scale_factor: 1.0,
      offset_x: 0.0,
      offset_y: 0.0,
    };
  }

  function _setMode(mode) {
    state.mode = mode;
    if (mode === "click") {
      state.autoBrushFromClicks = false;
    }
    if (state.imageWrapper) {
      if (mode === "pan") {
        state.imageWrapper.style.cursor = "grab";
      } else if (mode === "brush") {
        state.imageWrapper.style.cursor = "crosshair";
      } else {
        state.imageWrapper.style.cursor = "crosshair";
      }
    }

    if (typeof state._updateToolbar === "function") {
      state._updateToolbar();
    }
  }

  function _setZoom(nextZoom) {
    const z = Math.max(0.25, Math.min(6, Number(nextZoom) || 1));
    state.zoom = z;
    _applyTransform();
    _renderMarkers();
    _renderDrawing();
  }

  function _zoomAtClientPoint(nextZoom, clientX, clientY) {
    if (!state.viewport) {
      _setZoom(nextZoom);
      return;
    }

    const z = Math.max(0.25, Math.min(6, Number(nextZoom) || 1));
    const rect = state.viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      _setZoom(z);
      return;
    }

    const anchorX = clientX != null ? clientX - rect.left : rect.width / 2;
    const anchorY = clientY != null ? clientY - rect.top : rect.height / 2;

    const worldX = (anchorX - state.panX) / (state.zoom || 1);
    const worldY = (anchorY - state.panY) / (state.zoom || 1);

    state.zoom = z;
    state.panX = anchorX - worldX * state.zoom;
    state.panY = anchorY - worldY * state.zoom;
    _applyTransform();
    _renderMarkers();
    _renderDrawing();
  }

  function _resetView() {
    state.panX = 0;
    state.panY = 0;
    state.zoom = 1;
    _applyTransform();
  }

  function _undoLastAction() {
    if (state.locked) return;

    const _dbgSnap = (stage) => {
      try {
        const hist = Array.isArray(state.actionHistory) ? state.actionHistory : [];
        return {
          stage,
          mode: state.mode,
          maxClicks: state.maxClicks,
          maxStrokes: state.maxStrokes,
          maxPolygons: state.maxPolygons,
          clicks: Array.isArray(state.clicks) ? state.clicks.length : null,
          lines: Array.isArray(state.lines) ? state.lines.length : null,
          polygons: Array.isArray(state.polygons) ? state.polygons.length : null,
          activeStroke: Array.isArray(state.activeStroke) ? state.activeStroke.length : null,
          histLen: hist.length,
          histTail: hist.slice(Math.max(0, hist.length - 8)).map((a) => (a ? a.kind : null)),
          autoBrushFromClicks: !!state.autoBrushFromClicks,
          ignoreClicksUntil: state.ignoreClicksUntil || 0,
          now: Date.now(),
        };
      } catch (e) {
        return { stage, error: String(e && e.message ? e.message : e) };
      }
    };

    _clientLog("undo", _dbgSnap("before"));

    if (Array.isArray(state.activeStroke) && state.activeStroke.length > 0) {
      state.activeStroke = null;
      _renderDrawing();
      _renderLabelsInputs(null);
      if (typeof state._updateToolbar === "function") state._updateToolbar();
      if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
      _clientLog("undo", _dbgSnap("after_cancel_active_stroke"));
      return;
    }

    const hist = Array.isArray(state.actionHistory) ? state.actionHistory : [];

    // If history got out of sync (e.g. older sessions / edge cases), prefer undoing
    // actual existing marks in the UI over trusting history.
    try {
      const histClicks = hist.reduce((n, a) => n + (a && a.kind === "click" ? 1 : 0), 0);
      const histLines = hist.reduce((n, a) => n + (a && a.kind === "line" ? 1 : 0), 0);
      const histPolys = hist.reduce((n, a) => n + (a && a.kind === "polygon" ? 1 : 0), 0);
      const clicksNow = Array.isArray(state.clicks) ? state.clicks.length : 0;
      const linesNow = Array.isArray(state.lines) ? state.lines.length : 0;
      const polysNow = Array.isArray(state.polygons) ? state.polygons.length : 0;

      if (linesNow > histLines) {
        state.lines.pop();
        if (Array.isArray(state.labelsLines) && state.labelsLines.length) state.labelsLines.pop();
        _resetActionInterpretation();
        _renderDrawing();
        _renderLabelsInputs(null);
        _refreshUserActionsPanel();
        if (typeof state._updateToolbar === "function") state._updateToolbar();
        _syncFoundTargetsUI();
        _clientLog("undo", _dbgSnap("after_force_line"));
        return;
      }
      if (polysNow > histPolys) {
        state.polygons.pop();
        if (Array.isArray(state.labelsPolygons) && state.labelsPolygons.length) state.labelsPolygons.pop();
        _resetActionInterpretation();
        _renderDrawing();
        _renderLabelsInputs(null);
        _refreshUserActionsPanel();
        if (typeof state._updateToolbar === "function") state._updateToolbar();
        if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
        _clientLog("undo", _dbgSnap("after_force_polygon"));
        return;
      }
      if (clicksNow > histClicks) {
        state.clicks.pop();
        if (Array.isArray(state.labelsClicks) && state.labelsClicks.length) state.labelsClicks.pop();
        _rebuildFoundTargetsFromClicks();
        _resetActionInterpretation();
        _renderMarkers();
        _renderLabelsInputs(null);
        _refreshUserActionsPanel();
        if (typeof state._updateToolbar === "function") state._updateToolbar();
        if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
        _clientLog("undo", _dbgSnap("after_force_click"));
        return;
      }
    } catch (e) {
      // ignore
    }

    const last = hist.length ? hist[hist.length - 1] : null;
    if (!last) return;
    hist.pop();
    state.actionHistory = hist;

    if (last.kind === "click") {
      if (Array.isArray(state.clicks) && state.clicks.length) state.clicks.pop();
      if (Array.isArray(state.labelsClicks) && state.labelsClicks.length) state.labelsClicks.pop();
      _rebuildFoundTargetsFromClicks();
      _resetActionInterpretation();
      _renderMarkers();

      if (
        state.autoBrushFromClicks &&
        !_requiresDrawing() &&
        state.mode === "brush" &&
        state.maxClicks > 0 &&
        Array.isArray(state.clicks) &&
        state.clicks.length < state.maxClicks
      ) {
        _setMode("click");
        state.autoBrushFromClicks = false;
      }
    } else if (last.kind === "polygon") {
      if (Array.isArray(state.polygons) && state.polygons.length) state.polygons.pop();
      if (Array.isArray(state.labelsPolygons) && state.labelsPolygons.length) state.labelsPolygons.pop();
      _resetActionInterpretation();
      _renderDrawing();
    } else if (last.kind === "line") {
      if (Array.isArray(state.lines) && state.lines.length) state.lines.pop();
      if (Array.isArray(state.labelsLines) && state.labelsLines.length) state.labelsLines.pop();
      _resetActionInterpretation();
      _renderDrawing();
    }

    _renderLabelsInputs(null);
    _refreshUserActionsPanel();
    if (typeof state._updateToolbar === "function") state._updateToolbar();
    _syncFoundTargetsUI();
    _clientLog("undo", _dbgSnap("after"));
  }

  function _applyUserMarksVisibility() {
    const isOn = state.showUserMarks !== false;
    if (state.markerLayer) {
      state.markerLayer.style.display = isOn ? "" : "none";
    }
    if (state.drawLayer) {
      state.drawLayer.style.display = isOn ? "" : "none";
    }
  }

  function _clearClicks() {
    if (state.locked) return;
    state.clicks = [];
    state.foundClickTargets = new Set();
    state.labelsClicks = [];
    state.actionHistory = [];
    state.autoBrushFromClicks = false;
    _resetActionInterpretation();
    _renderMarkers();
    _renderDrawing();
    _renderReference();
    _renderLabelsInputs(null);
    _refreshUserActionsPanel();
    _syncFoundTargetsUI();
  }

  function _clearLines() {
    if (state.locked) return;
    state.polygons = [];
    state.lines = [];
    state.activeStroke = null;
    state.labelsPolygons = [];
    state.labelsLines = [];
    state.actionHistory = [];
    state.autoBrushFromClicks = false;
    _resetActionInterpretation();
    _renderDrawing();
    _renderLabelsInputs(null);
    _refreshUserActionsPanel();
    if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
  }

  /**
   * Maps a label-row (kind + 0-based sequential index) to the corresponding
   * answer_key.targets index, for use in hover isolation.
   *
   * For Level 2 (click rows): click i -> target that was hit by click i.
   * We look this up from state.lastTargetsInfo if available (set during
   * applyCheckFeedback), or fall back to a direct 1:1 mapping.
   *
   * For Level 3 (polygon/line rows): polygon i -> target index i.
   */
  function _findLabelRowTargetIndex(kind, idx0based) {
    try {
      const targets = _getTargets(state.taskDto);
      if (!targets.length) return null;

      if (kind === "polygon" || kind === "line") {
        // L3: polygons map 1:1 to targets; lines come after polygons.
        if (kind === "polygon") {
          return idx0based < targets.length ? idx0based : null;
        }
        // line: offset by number of polygon targets
        const polyCount = targets.filter((t) => _getTargetShape(t) === "polygon").length;
        const lineIdx = polyCount + idx0based;
        return lineIdx < targets.length ? lineIdx : null;
      }

      if (kind === "click") {
        // L2: try to use the last targets_info mapping from the evaluator.
        const targetsInfo = Array.isArray(state.lastTargetsInfo) ? state.lastTargetsInfo : [];
        if (targetsInfo.length) {
          // targetsInfo[targetIdx].matched_click_idx tells us which click hit which target.
          // Build click_idx -> target_idx map.
          const clickToTarget = {};
          targetsInfo.forEach((info) => {
            if (info && typeof info.matched_click_idx === "number" && info.matched_click_idx !== null) {
              clickToTarget[info.matched_click_idx] = info.index;
            }
          });
          if (typeof clickToTarget[idx0based] === "number") {
            return clickToTarget[idx0based];
          }
        }
        // Fallback: direct 1:1 mapping (click i -> target i)
        return idx0based < targets.length ? idx0based : null;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  function _renderLabelsInputs(foundTargets) {
    if (!state.labelsContainer) return;

    state.labelsInputs = [];
    function _clearLabelsCard(animate) {
      if (!state.labelsContainer) return;
      if (state.labelsRemovalTimer) {
        clearTimeout(state.labelsRemovalTimer);
        state.labelsRemovalTimer = null;
      }
      const existingCard =
        state.labelsCardEl || state.labelsContainer.querySelector('[data-clickui="labels-card"]');
      state.labelsCardEl = null;
      if (!existingCard) {
        state.labelsContainer.innerHTML = "";
        if (typeof state._updateLabelsIndicator === "function") state._updateLabelsIndicator();
        return;
      }
      if (!animate) {
        state.labelsContainer.innerHTML = "";
        if (typeof state._updateLabelsIndicator === "function") state._updateLabelsIndicator();
        return;
      }
      if (existingCard.dataset.exiting === "1") return;
      existingCard.dataset.exiting = "1";
      existingCard.classList.remove("clickui-card-entry");
      existingCard.classList.add("clickui-card-exit");
      existingCard.style.height = `${existingCard.offsetHeight}px`;
      existingCard.style.opacity = "1";
      existingCard.style.transform = "translateY(0)";
      existingCard.style.overflow = "hidden";
      requestAnimationFrame(() => {
        try {
          existingCard.style.height = "0px";
          existingCard.style.opacity = "0";
          existingCard.style.transform = "translateY(-6px)";
        } catch (e) {
          // ignore
        }
      });
      state.labelsRemovalTimer = setTimeout(() => {
        try {
          if (existingCard.parentNode === state.labelsContainer) {
            existingCard.remove();
          }
        } catch (e) {
          // ignore
        }
        state.labelsRemovalTimer = null;
        if (typeof state._updateLabelsIndicator === "function") state._updateLabelsIndicator();
      }, 220);
    }

    const requiresLabels = _requiresLabels();
    if (!requiresLabels) {
      _clearLabelsCard(true);
      return;
    }

    _ensureLabelsLengths();

    // For L2: show labels UI only after user has at least one click/stroke.
    if (!_hasAnyUserMarks()) {
      _clearLabelsCard(true);
      return;
    }

    _clearLabelsCard(false);

    const labelsInSideColumn = Boolean(
      state.labelsContainer &&
      typeof state.labelsContainer.closest === "function" &&
      state.labelsContainer.closest('[data-clickui="side-column"]')
    );
    const card = _createEl(
      "section",
      labelsInSideColumn
        ? "task-chip flex flex-col overflow-hidden rounded-2xl border-2 border-border-strong bg-surface-2 shadow-sm dark:border-border-strong dark:bg-surface-2"
        : "mt-4 flex flex-col gap-4 rounded-2xl border border-border-strong bg-surface-2 p-4 shadow-sm dark:border-border-strong dark:bg-surface-2",
      ""
    );
    card.setAttribute("data-clickui", "labels-card");

    const header = _createEl(
      "div",
      labelsInSideColumn
        ? "border-b border-border-strong bg-surface-1 px-4 py-3.5 dark:border-border-strong"
        : "flex flex-col gap-1",
      ""
    );
    header.appendChild(
      _createEl(
        "div",
        "text-[12px] font-bold uppercase tracking-[0.08em] text-text-main dark:text-text-on-dark",
        wt("clickui.your_actions", "Ваши действия")
      )
    );
    header.appendChild(
      _createEl(
        "div",
        labelsInSideColumn
          ? "hidden"
          : "text-[13px] leading-5 text-text-secondary dark:text-text-on-dark",
        wt("clickui.label_targets_prompt", "Подпиши отмеченные цели перед проверкой ответа.")
      )
    );
    card.appendChild(header);

    const grid = _createEl(
      "div",
      labelsInSideColumn
        ? "grid grid-cols-1 gap-3 px-4 py-3"
        : "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3",
      ""
    );
    card.appendChild(grid);

    function _makeRow(kind, idx1based, value, onChange) {
      const id = `clickui-${kind}-${idx1based}`;

      const wrap = _createEl(
        "div",
        labelsInSideColumn
          ? "flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-1 px-3 py-2.5 shadow-sm dark:border-border-strong dark:bg-surface-1"
          : "flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-1 px-3.5 py-3 shadow-sm dark:border-border-strong dark:bg-surface-1",
        ""
      );
      const top = _createEl(
        "div",
        labelsInSideColumn ? "contents" : "flex items-center justify-between gap-3",
        ""
      );
      const labelText =
        kind === "click"
          ? wt("clickui.click_n", "Клик {n}").replace("{n}", idx1based)
          : kind === "polygon"
            ? wt("clickui.polygon_n", "Контур {n}").replace("{n}", idx1based)
            : wt("clickui.line_n", "Штрих {n}").replace("{n}", idx1based);

      const lbl = document.createElement("label");
      lbl.setAttribute("for", id);
      lbl.className =
        labelsInSideColumn
          ? "sr-only"
          : "text-[12px] font-semibold uppercase tracking-[0.06em] text-text-main dark:text-text-on-dark";
      lbl.textContent = labelText;

      const badge = _createEl(
        "span",
        labelsInSideColumn
          ? "task-chip flex size-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold shadow-sm"
          : "flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-fg text-[10px] font-bold",
        String(idx1based)
      );
      if (labelsInSideColumn) {
        const accentColor = _getActionDisplayColor(state.taskDto, kind, idx1based - 1);
        badge.style.backgroundColor = accentColor;
        badge.style.color = _getThemeColor("--color-text-on-dark", "#ffffff");
        badge.style.borderColor = _withAlpha(accentColor, 0.3);
        badge.style.boxShadow = `0 0 0 2px ${_withAlpha(accentColor, 0.14)}`;
      }

      const statusIcon = document.createElement("span");
      statusIcon.className = "material-symbols-outlined text-[16px]";
      statusIcon.style.visibility = "hidden";

      try {
        if (state.locked && state.labelEval) {
          const le = state.labelEval;
          const lineBase = _requiresDrawing() ? (state.polygons.length || 0) : (state.clicks.length || 0);
          let flatIndex = null;
          if (_requiresDrawing()) {
            if (kind === "polygon") flatIndex = idx1based - 1;
            else if (kind === "line") flatIndex = lineBase + (idx1based - 1);
          } else {
            if (kind === "click") flatIndex = idx1based - 1;
            else if (kind === "line") flatIndex = lineBase + (idx1based - 1);
          }

          if (flatIndex != null) {
            if (le.matched && le.matched.has(flatIndex)) {
              statusIcon.textContent = "check";
              statusIcon.classList.add("text-success", "dark:text-success");
              statusIcon.style.visibility = "visible";
            } else if (le.unmatched && le.unmatched.has(flatIndex)) {
              statusIcon.textContent = "close";
              statusIcon.classList.add("text-error", "dark:text-error");
              statusIcon.style.visibility = "visible";
            }
          }
        }
      } catch (e) {
        // ignore
      }

      const left = _createEl(
        "div",
        labelsInSideColumn ? "flex shrink-0 items-center gap-2.5" : "flex min-w-0 items-center gap-2.5",
        ""
      );
      left.appendChild(badge);
      if (!labelsInSideColumn) left.appendChild(lbl);
      top.appendChild(left);
      const right = _createEl(
        "div",
        labelsInSideColumn ? "flex shrink-0 items-center gap-2 self-center" : "flex shrink-0 items-center gap-2",
        ""
      );
      right.appendChild(statusIcon);
      if (!labelsInSideColumn) {
        top.appendChild(right);
      }

      const input = document.createElement("input");
      input.id = id;
      input.type = "text";
      input.setAttribute("aria-label", wt("clickui.name_for", "Название для {label}").replace("{label}", labelText));
      input.placeholder = wt("clickui.enter_name_placeholder", "Введите название...");
      input.disabled = state.locked;
      const baseInputClass =
        "block min-h-[44px] w-full rounded-xl border border-border-strong bg-surface-2 px-3.5 py-2.5 text-[14px] leading-5 text-text-main transition-colors placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-light disabled:cursor-not-allowed disabled:bg-bg-disabled disabled:text-text-secondary dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark dark:placeholder:text-text-secondary";
      input.className = baseInputClass;
      input.value = value || "";

      function _applyInputHighlight() {
        const hasText = String(input.value || "").trim().length > 0;
        // Reset to base each time to avoid class accumulation.
        input.className = baseInputClass;

        // After check: if backend returned per-label correctness, highlight accordingly.
        // Mapping: payload order is
        //  - L2: labels_clicks then labels_lines
        //  - L3: labels_polygons then labels_lines
        if (state.locked && state.labelEval && hasText) {
          const le = state.labelEval;
          const clickBase = 0;
          const polyBase = 0;
          const lineBase = _requiresDrawing() ? (state.polygons.length || 0) : (state.clicks.length || 0);
          let flatIndex = null;
          if (_requiresDrawing()) {
            if (kind === "polygon") flatIndex = polyBase + (idx1based - 1);
            else if (kind === "line") flatIndex = lineBase + (idx1based - 1);
          } else {
            if (kind === "click") flatIndex = clickBase + (idx1based - 1);
            else if (kind === "line") flatIndex = lineBase + (idx1based - 1);
          }

          if (flatIndex != null) {
            if (le.matched && le.matched.has(flatIndex)) {
              input.className +=
                " border-success-light dark:border-success-dark bg-success-lighter dark:bg-success-light";
              return;
            }
            if (le.unmatched && le.unmatched.has(flatIndex)) {
              input.className +=
                " border-error-light dark:border-error-dark bg-error-lighter dark:bg-error-light";
              return;
            }
          }
        }

        if (state.highlightLabelErrors && !hasText) {
          input.className +=
            " border-error focus:border-error focus:ring-error dark:border-error bg-error-lighter dark:bg-error-light";
          return;
        }

        if (hasText) {
          input.className += " border-success-light dark:border-success-dark bg-success-lighter dark:bg-success-light";
        }
      }

      _applyInputHighlight();
      input.addEventListener("input", () => {
        onChange(input.value);

        _applyInputHighlight();

        if (state.highlightLabelErrors && _allLabelFieldsFilled()) {
          state.highlightLabelErrors = false;
          _renderLabelsInputs(null);
        }
      });

      if (labelsInSideColumn) {
        input.className += " flex-1 min-w-0";
        wrap.appendChild(top);
        wrap.appendChild(input);
        wrap.appendChild(right);
      } else {
        wrap.appendChild(top);
        wrap.appendChild(input);
      }

      // Attach hover isolation: resolve which target this row belongs to and
      // wire mouseenter/mouseleave to the global hover system.
      try {
        const targetIdx = _findLabelRowTargetIndex(kind, idx1based - 1);
        if (targetIdx !== null && targetIdx !== undefined) {
          wrap.setAttribute("data-target-index", String(targetIdx));
          wrap.style.transition = "opacity 0.15s ease-in-out";
          wrap.addEventListener("mouseenter", () => _setGlobalHover({ targetIndex: targetIdx }));
          wrap.addEventListener("mouseleave", () => _setGlobalHover(null));
        }
      } catch (e) {
        // ignore
      }

      return { wrap, input };
    }

    if (_requiresDrawing()) {
      // L3: contours first
      for (let i = 0; i < state.polygons.length; i += 1) {
        const row = _makeRow("polygon", i + 1, state.labelsPolygons[i], (v) => {
          state.labelsPolygons[i] = String(v || "");
        });
        grid.appendChild(row.wrap);
        state.labelsInputs.push({ kind: "polygon", index: i, input: row.input });
      }
    } else {
      // L2: clicks first
      for (let i = 0; i < state.clicks.length; i += 1) {
        const row = _makeRow("click", i + 1, state.labelsClicks[i], (v) => {
          state.labelsClicks[i] = String(v || "");
        });
        grid.appendChild(row.wrap);
        state.labelsInputs.push({ kind: "click", index: i, input: row.input });
      }
    }

    // Then strokes (always)
    for (let i = 0; i < state.lines.length; i += 1) {
      const row = _makeRow("line", i + 1, state.labelsLines[i], (v) => {
        state.labelsLines[i] = String(v || "");
      });
      grid.appendChild(row.wrap);
      state.labelsInputs.push({ kind: "line", index: i, input: row.input });
    }

    card.classList.add("clickui-card-entry");
    state.labelsContainer.appendChild(card);
    state.labelsCardEl = card;
    if (typeof state._updateLabelsIndicator === "function") state._updateLabelsIndicator();
  }

  ClickUI.createRoot = function createRoot(container, taskDto, options) {
    const runtimeMode = !!(options && options.runtimeMode);
    _teardownAdditionalModal();
    state.taskDto = taskDto;
    state.container = container;
    state.clicks = [];
    state.polygons = [];
    state.lines = [];
    state.actionHistory = [];
    state.autoBrushFromClicks = false;
    state.foundClickTargets = new Set();
    _recalcLimitsFromTask(taskDto);
    state.activeStroke = null;
    state.locked = false;
    state.mode = "click";
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.isPointerDown = false;
    state.panStart = null;
    state.showRef = false;
    state.showRefContours = true;
    state.showRefPolygons = true;
    state.showRefLines = true;
    state.showRefLabels = true;
    state.showUserMarks = true;
    state.badRefTargets = null;
    state.labelsClicks = [];
    state.labelsPolygons = [];
    state.labelsLines = [];
    state.highlightLabelErrors = false;
    state.labelEval = null;
    _assignTargetColors(taskDto);
    state.targetRows = [];
    state.targetsProgress = null;
    state.userActionsListEl = null;
    state.userActionRows = [];
    state.hoveredActionKey = null;
    state.pendingViewState = null;
    state.reviewHost = null;
    state.reviewComparisonEl = null;
    if (state.targetsAttentionTimer) {
      clearTimeout(state.targetsAttentionTimer);
      state.targetsAttentionTimer = null;
    }
    state.targetsPanelTitleEl = null;
    state.targetsListSectionEl = null;
    state.outlineVerbEls = [];
    state.runtimeMode = runtimeMode;
    _setActionInterpretation(null, false);

    if (state._themeListener) {
      window.removeEventListener("themechanged", state._themeListener);
    }
    state._themeListener = () => {
      _assignTargetColors(state.taskDto);
      _refreshTargetRowColors();
      _refreshUserActionsPanel();
      _renderMarkers();
      _renderDrawing();
      _renderReference();
    };
    window.addEventListener("themechanged", state._themeListener);

    // Inject ClickUI entrance animation styles once
    if (!document.getElementById("clickui-anim-style")) {
      const _s = document.createElement("style");
      _s.id = "clickui-anim-style";
      _s.textContent =
        "@keyframes cuiSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }" +
        ".cui-layout-enter { animation: cuiSlideUp 250ms ease-out forwards; }";
      document.head.appendChild(_s);
    }

    const root = _createEl("div", "flex flex-col gap-2.5 cui-layout-enter", "");

    // Prevent horizontal layout shift when vertical scrollbar appears (e.g., after label inputs are rendered).
    try {
      const de = document && document.documentElement;
      const body = document && document.body;
      if (de && de.style) {
        if ("scrollbarGutter" in de.style) {
          de.style.scrollbarGutter = "stable";
          if (body && body.style && "scrollbarGutter" in body.style) body.style.scrollbarGutter = "stable";
        } else {
          // Fallback for older engines: always reserve scrollbar space.
          de.style.overflowY = "scroll";
        }
      }
    } catch (e) {
      // ignore
    }

    const layout = _createEl(
      "div",
      "flex min-h-[68vh] flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-4",
      ""
    );
    const mainColumn = _createEl(
      "div",
      "flex min-h-[68vh] flex-1 flex-col gap-3",
      ""
    );
    const sideColumn = _createEl(
      "div",
      "flex w-full flex-col gap-3 lg:w-80 lg:sticky lg:top-3 lg:self-start lg:max-h-[calc(100vh-128px)] lg:overflow-y-auto lg:pr-1 xl:w-96 2xl:w-[420px]",
      ""
    );
    sideColumn.setAttribute("data-clickui", "side-column");
    let sideHasContent = false;

    state.metadataApi = null;
    if (!runtimeMode) {
      if (!Metadata || typeof Metadata.create !== "function") {
        throw new Error("TaskMetadataPanel is required but not available");
      }

      Metadata.openImageModal = (url, caption) => {
        _openAdditionalModal(url, caption);
      };

      const metadata = Metadata.create({
        taskDto,
        mode: "click",
        annotationTotals: {
          total: state.maxClicks || 0,
          clicks: state.maxClicks || 0,
          polygons: state.maxPolygons || 0,
          freehand: state.maxStrokes || 0,
        },
        onChange: () => {},
      });
      state.metadataApi = metadata.api;
      mainColumn.appendChild(metadata.rootEl);
    }

    const imgUrl = _resolveImageUrl(taskDto);

    const wrapperRow = _createEl(
      "div",
      "flex flex-1 flex-col gap-3 lg:flex-row lg:items-stretch",
      ""
    );
    const reviewHost = _createEl("div", "hidden", "");
    reviewHost.setAttribute("data-clickui", "review-host");

    const wrapper = _createEl(
      "div",
      "group relative flex-1 min-h-[480px] overflow-hidden rounded-2xl border-2 border-border-strong bg-surface-2 shadow-inner select-none dark:border-border-strong dark:bg-surface-2 lg:min-h-[560px]",
      ""
    );

    const viewport = _createEl(
      "div",
      "relative flex h-full min-h-[480px] w-full items-center justify-center overflow-hidden bg-surface-2 dark:bg-surface-2 lg:min-h-[560px]",
      ""
    );
    viewport.setAttribute("data-clickui", "viewport");
    const contentLayer = _createEl("div", "absolute left-0 top-0", "");

    const img = document.createElement("img");
    img.className = "block select-none";
    img.alt = "task image";
    img.draggable = false;
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.width = "1px";
    img.style.height = "1px";
    if (imgUrl) {
      img.src = imgUrl;
    }

    const imgError = _createEl(
      "div",
      "hidden absolute inset-0 flex items-center justify-center text-sm text-text-muted dark:text-text-muted",
      wt("clickui.img_load_fail", "Не удалось загрузить изображение")
    );

    // refLayer: убираем pointer-events-none из Tailwind-класса и выставляем
    // через inline-стиль, чтобы дочерние SVG-элементы (polygon, path, circle)
    // с явным pointer-events: visiblePainted могли получать события мыши.
    const refLayer = _createEl("div", "absolute inset-0 z-10", "");
    const drawLayer = _createEl("div", "pointer-events-none absolute inset-0 z-20", "");
    const markerLayer = _createEl("div", "pointer-events-none absolute inset-0 z-30", "");
    const labelOverlay = _createEl("div", "pointer-events-none absolute inset-0 z-40", "");

    // Fallback styles (do not rely only on Tailwind classes for positioning/z-index).
    refLayer.style.position = "absolute";
    refLayer.style.left = "0";
    refLayer.style.top = "0";
    refLayer.style.right = "0";
    refLayer.style.bottom = "0";
    refLayer.style.zIndex = "10";
    refLayer.style.pointerEvents = "none";

    drawLayer.style.position = "absolute";
    drawLayer.style.left = "0";
    drawLayer.style.top = "0";
    drawLayer.style.right = "0";
    drawLayer.style.bottom = "0";
    drawLayer.style.zIndex = "20";

    markerLayer.style.position = "absolute";
    markerLayer.style.left = "0";
    markerLayer.style.top = "0";
    markerLayer.style.right = "0";
    markerLayer.style.bottom = "0";
    markerLayer.style.zIndex = "30";

    labelOverlay.style.position = "absolute";
    labelOverlay.style.left = "0";
    labelOverlay.style.top = "0";
    labelOverlay.style.right = "0";
    labelOverlay.style.bottom = "0";
    labelOverlay.style.zIndex = "40";
    labelOverlay.style.pointerEvents = "none";

    contentLayer.appendChild(img);
    contentLayer.appendChild(imgError);
    contentLayer.appendChild(refLayer);
    contentLayer.appendChild(drawLayer);
    contentLayer.appendChild(markerLayer);
    contentLayer.appendChild(labelOverlay);
    viewport.appendChild(contentLayer);
    wrapper.appendChild(viewport);

    const toolbar = _createEl(
      "div",
      "pointer-events-auto absolute left-3 top-3 z-30 flex w-11 flex-col gap-2.5 sm:w-12",
      ""
    );

    const toolGroup = _createEl(
      "div",
      "flex flex-col overflow-hidden rounded-2xl border border-border-strong bg-surface-1/95 shadow-md backdrop-blur-sm divide-y divide-border-strong dark:border-border-strong dark:bg-surface-2/95 dark:divide-border-strong",
      ""
    );

    const zoomGroup = _createEl(
      "div",
      "flex flex-col overflow-hidden rounded-2xl border border-border-strong bg-surface-1/95 shadow-md backdrop-blur-sm divide-y divide-border-strong dark:border-border-strong dark:bg-surface-2/95 dark:divide-border-strong",
      ""
    );

    const toolbarButtonBaseClass =
      "flex h-10 w-full items-center justify-center bg-surface-2 text-text-main transition-colors duration-150 focus:outline-none dark:bg-surface-2 dark:text-text-on-dark sm:h-11";
    const toolbarButtonIdleClass =
      `${toolbarButtonBaseClass} hover:bg-bg-hover dark:hover:bg-bg-hover`;
    const toolbarButtonActiveClass =
      `${toolbarButtonBaseClass} bg-primary-lighter text-primary shadow-inner dark:bg-primary-dark dark:text-primary-light`;
    const hintBaseClass =
      "flex items-start gap-2.5 rounded-xl border border-border-strong bg-surface-1 px-3 py-3 text-[13px] leading-5 text-text-secondary shadow-sm transition-colors duration-150 ease-out dark:border-border-strong dark:bg-surface-1 dark:text-text-on-dark";
    const hintWarningClass =
      "flex items-start gap-2.5 rounded-xl border border-warning-light bg-warning-lighter px-3 py-3 text-[13px] leading-5 text-warning-darker transition-colors duration-150 ease-out dark:border-warning-light dark:bg-warning-light dark:text-warning-lighter";

    function _iconBtn({ title, icon, sizeClass, kind, onClick }) {
      const b = document.createElement("button");
      b.type = "button";
      b.title = title;
      b.className = kind === "zoom" ? `${toolbarButtonIdleClass} hover:text-primary` : toolbarButtonIdleClass;
      b.addEventListener("click", onClick);

      const s = document.createElement("span");
      s.className = `material-symbols-outlined ${sizeClass || "text-[20px]"}`;
      s.textContent = icon;
      b.appendChild(s);
      return b;
    }

    function _activeBtn(btn, iconSize) {
      btn.className = toolbarButtonActiveClass;
      btn.innerHTML = "";
      const s = document.createElement("span");
      s.className = `material-symbols-outlined ${iconSize || "text-[20px]"}`;
      s.textContent = btn.dataset.icon || "";
      btn.appendChild(s);
    }

    function _inactiveBtn(btn, iconSize) {
      btn.className = toolbarButtonIdleClass;
      btn.innerHTML = "";
      const s = document.createElement("span");
      s.className = `material-symbols-outlined ${iconSize || "text-[20px]"}`;
      s.textContent = btn.dataset.icon || "";
      btn.appendChild(s);
    }

    const selectBtn = _iconBtn({
      title: wt("clickui.mode_click_title", "Режим клика"),
      icon: "arrow_selector_tool",
      sizeClass: "text-[18px]",
      kind: "tool",
      onClick: () => _setMode("click"),
    });
    selectBtn.dataset.icon = "arrow_selector_tool";

    const brushBtn = _iconBtn({
      title: wt("clickui.mode_draw_title", "Режим рисования"),
      icon: "edit",
      sizeClass: "text-[20px]",
      kind: "tool",
      onClick: () => {
        state.autoBrushFromClicks = false;
        _setMode("brush");
      },
    });
    brushBtn.dataset.icon = "edit";

    const panBtn = _iconBtn({
      title: wt("clickui.mode_pan_title", "Перемещение"),
      icon: "pan_tool",
      sizeClass: "text-[20px]",
      kind: "tool",
      onClick: () => {
        state.autoBrushFromClicks = false;
        _setMode("pan");
      },
    });
    panBtn.dataset.icon = "pan_tool";

    const undoBtn = _iconBtn({
      title: wt("clickui.undo_title", "Отменить"),
      icon: "undo",
      sizeClass: "text-[20px]",
      kind: "tool",
      onClick: _undoLastAction,
    });
    undoBtn.dataset.icon = "undo";
    undoBtn.setAttribute("data-clickui", "toolbar-undo");
    undoBtn.style.transition =
      "background-color 180ms ease-out, color 180ms ease-out, box-shadow 180ms ease-out, transform 180ms ease-out, opacity 160ms ease-out";

    function _syncUndoButtonState() {
      if (!undoBtn) return;
      const canUndo =
        (Array.isArray(state.actionHistory) && state.actionHistory.length > 0) ||
        (Array.isArray(state.activeStroke) && state.activeStroke.length > 0);
      undoBtn.style.opacity = canUndo ? "1" : "0.4";
      undoBtn.style.pointerEvents = canUndo ? "auto" : "none";
      const shouldHighlight = canUndo && Date.now() < (state.undoAttentionUntil || 0);
      if (shouldHighlight) {
        const accentColor = _getThemeColor("--color-error", "#ef4444");
        undoBtn.style.backgroundColor = _withAlpha(accentColor, 0.1);
        undoBtn.style.color = accentColor;
        undoBtn.style.setProperty("--clickui-undo-border", _withAlpha(accentColor, 0.85));
        undoBtn.style.setProperty("--clickui-undo-ring", _withAlpha(accentColor, 0.22));
        undoBtn.classList.add("clickui-undo-attention");
        undoBtn.style.transform = "scale(1.03)";
      } else {
        undoBtn.style.backgroundColor = "";
        undoBtn.style.color = "";
        undoBtn.style.removeProperty("--clickui-undo-border");
        undoBtn.style.removeProperty("--clickui-undo-ring");
        undoBtn.classList.remove("clickui-undo-attention");
        undoBtn.style.transform = "";
      }
    }

    function _flashUndoButtonAttention() {
      if (!undoBtn) return;
      state.undoAttentionUntil = Date.now() + 1400;
      if (state.undoAttentionTimer) {
        clearTimeout(state.undoAttentionTimer);
        state.undoAttentionTimer = null;
      }
      _syncUndoButtonState();
      state.undoAttentionTimer = setTimeout(() => {
        state.undoAttentionTimer = null;
        state.undoAttentionUntil = 0;
        _syncUndoButtonState();
      }, 1450);
    }

    toolGroup.appendChild(selectBtn);
    toolGroup.appendChild(brushBtn);
    toolGroup.appendChild(panBtn);
    toolGroup.appendChild(undoBtn);

    const zoomInBtn = _iconBtn({
      title: wt("clickui.zoom_in_title", "Увеличить"),
      icon: "add",
      sizeClass: "text-[20px]",
      kind: "zoom",
      onClick: () => _zoomAtClientPoint(state.zoom * 1.15, null, null),
    });
    const zoomOutBtn = _iconBtn({
      title: wt("clickui.zoom_out_title", "Уменьшить"),
      icon: "remove",
      sizeClass: "text-[20px]",
      kind: "zoom",
      onClick: () => _zoomAtClientPoint(state.zoom / 1.15, null, null),
    });
    zoomGroup.appendChild(zoomInBtn);
    zoomGroup.appendChild(zoomOutBtn);

    const clearWrap = _createEl("div", "pt-0.5", "");
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.title = wt("clickui.clear_title", "Очистить");
    clearBtn.className =
      "flex h-10 w-full items-center justify-center rounded-xl border border-border-strong bg-error-light/95 text-error-text shadow-md transition-colors duration-150 hover:bg-error-light/85 focus:outline-none dark:border-border-strong dark:bg-error-light dark:text-error-lighter sm:h-11";
    const clearIcon = document.createElement("span");
    clearIcon.className = "material-symbols-outlined text-[20px]";
    clearBtn.appendChild(clearIcon);
    clearBtn.addEventListener("click", () => {
      if (state.mode === "brush") _clearLines();
      else _clearClicks();
      if (typeof state._updateToolbar === "function") state._updateToolbar();
    });
    clearWrap.appendChild(clearBtn);

    toolbar.appendChild(toolGroup);
    toolbar.appendChild(zoomGroup);
    toolbar.appendChild(clearWrap);

    const difficultyLevel = _getDifficultyLevel(taskDto);
    let hasTargetsPanel = false;
    let suppressStatusCard = false;
    const labelsWorkflowInPanel = runtimeMode && _shouldHideTargetsList(taskDto);
    let runtimeAdditionalCard = null;
      if (runtimeMode) {
        const targetsPanel = _renderTargetsPanelV2(taskDto);
        if (targetsPanel) {
          targetsPanel.className += " w-full shrink-0";
          sideColumn.appendChild(targetsPanel);
          if (difficultyLevel === 1) {
            const userActionsPanel = _renderUserActionsSection();
            if (userActionsPanel) {
              userActionsPanel.className += " w-full shrink-0";
              sideColumn.appendChild(userActionsPanel);
            }
            suppressStatusCard = true;
          }
          sideHasContent = true;
          hasTargetsPanel = true;
        }
    }

    if (runtimeMode) {
      const additionalInfo = _getAdditionalInfo(taskDto);
      runtimeAdditionalCard = _createAdditionalInfoCard(additionalInfo);
      if (runtimeAdditionalCard) {
        runtimeAdditionalCard.classList.add("w-full", "shrink-0");
        sideColumn.classList.remove(
          "lg:sticky",
          "lg:top-3",
          "lg:self-start",
          "lg:max-h-[calc(100vh-128px)]",
          "lg:overflow-y-auto",
          "lg:pr-1"
        );
      }
    }

    const labelsContainer = _createEl("div", "w-full shrink-0", "");
    labelsContainer.setAttribute("data-clickui", "labels-section");

    wrapperRow.appendChild(wrapper);
    wrapper.appendChild(toolbar);

    const controls = _createEl("div", "mt-2.5 flex flex-col gap-2", "");

    const refToggles = _createEl(
      "div",
      "hidden flex flex-wrap items-center gap-2.5 rounded-xl border border-border-subtle bg-surface-1 px-3 py-2 text-[13px] text-text-secondary shadow-sm dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark",
      ""
    );
    refToggles.setAttribute("data-clickui", "ref-toggles");

    const chkShowRef = document.createElement("input");
    chkShowRef.type = "checkbox";
    chkShowRef.className = "rounded border-border-subtle text-primary focus:ring-0";
    chkShowRef.checked = state.showRef;
    chkShowRef.setAttribute("data-clickui", "ref-show");
    chkShowRef.addEventListener("change", () => {
      state.showRef = chkShowRef.checked;
      _renderReference();
    });
    const lblShowRef = _createEl("label", "flex items-center gap-2", "");
    lblShowRef.appendChild(chkShowRef);
    lblShowRef.appendChild(_createEl("span", "", wt("clickui.reference_toggle", "Референс")));

    const chkUserMarks = document.createElement("input");
    chkUserMarks.type = "checkbox";
    chkUserMarks.className = "rounded border-border-subtle text-primary focus:ring-0";
    chkUserMarks.checked = state.showUserMarks;
    chkUserMarks.setAttribute("data-clickui", "user-marks");
    chkUserMarks.addEventListener("change", () => {
      state.showUserMarks = chkUserMarks.checked;
      _applyUserMarksVisibility();
    });
    const lblUserMarks = _createEl("label", "flex items-center gap-2", "");
    lblUserMarks.appendChild(chkUserMarks);
    lblUserMarks.appendChild(_createEl("span", "", wt("clickui.user_marks_toggle", "Мои отметки")));
    const chkContours = document.createElement("input");
    chkContours.type = "checkbox";
    chkContours.className = "rounded border-border-subtle text-primary focus:ring-0";
    chkContours.checked = state.showRefPolygons;
    chkContours.setAttribute("data-clickui", "ref-polygons");
    chkContours.addEventListener("change", () => {
      state.showRefPolygons = chkContours.checked;
      _renderReference();
    });
    const lblContours = _createEl("label", "flex items-center gap-2", "");
    lblContours.appendChild(chkContours);
    lblContours.appendChild(_createEl("span", "", wt("clickui.polygons_toggle", "Полигоны")));

    const chkLines = document.createElement("input");
    chkLines.type = "checkbox";
    chkLines.className = "rounded border-border-subtle text-primary focus:ring-0";
    chkLines.checked = state.showRefLines;
    chkLines.setAttribute("data-clickui", "ref-lines");
    chkLines.addEventListener("change", () => {
      state.showRefLines = chkLines.checked;
      _renderReference();
    });
    const lblLines = _createEl("label", "flex items-center gap-2", "");
    lblLines.appendChild(chkLines);
    lblLines.appendChild(_createEl("span", "", wt("clickui.lines_toggle", "Линии")));

    const chkLabels = document.createElement("input");
    chkLabels.type = "checkbox";
    chkLabels.className = "rounded border-border-subtle text-primary focus:ring-0";
    chkLabels.checked = state.showRefLabels;
    chkLabels.addEventListener("change", () => {
      state.showRefLabels = chkLabels.checked;
      _renderReference();
    });
    const lblLabels = _createEl("label", "flex items-center gap-2", "");
    lblLabels.appendChild(chkLabels);
    lblLabels.appendChild(_createEl("span", "", wt("clickui.labels_toggle_checkbox", "Названия")));

    refToggles.appendChild(lblShowRef);
    refToggles.appendChild(lblUserMarks);
    refToggles.appendChild(lblContours);
    refToggles.appendChild(lblLines);
    refToggles.appendChild(lblLabels);
    const hint = _createEl(
      "div",
      hintBaseClass,
      ""
    );
    hint.style.transition = "opacity 160ms ease-out, background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out";
    hint.style.opacity = "1";
    hint.setAttribute("data-clickui", "hint");
    const hintIcon = _createEl(
      "span",
      "material-symbols-outlined text-[18px] text-text-secondary dark:text-text-on-dark",
      "info"
    );
    hintIcon.style.transition = "color 150ms ease-out";
    let hintIconLastText = hintIcon.textContent;
    let hintIconLastClass = hintIcon.className;
    const hintText = _createEl("div", "", "");
    hintText.innerHTML = "";
    hintText.style.transition = "opacity 220ms ease-out, transform 220ms ease-out";
    hintText.style.opacity = "1";
    hintText.style.transform = "translateY(0)";
    let hintHtmlLast = "";
    let hintHtmlAnimSeq = 0;

    function _setHintHtml(nextHtml) {
      try {
        const html = String(nextHtml || "");
        if (html === hintHtmlLast) return;
        hintHtmlLast = html;
        hintHtmlAnimSeq += 1;
        const seq = hintHtmlAnimSeq;
        hintText.style.opacity = "0";
        hintText.style.transform = "translateY(2px)";

        // Swap content after fade-out starts so the transition is perceptible.
        setTimeout(() => {
          try {
            if (seq !== hintHtmlAnimSeq) return;
            hintText.innerHTML = html;
            requestAnimationFrame(() => {
              try {
                if (seq !== hintHtmlAnimSeq) return;
                hintText.style.opacity = "1";
                hintText.style.transform = "translateY(0)";
              } catch (e) {
                // ignore
              }
            });
          } catch (e) {
            // ignore
          }
        }, 90);
      } catch (e) {
        // ignore
      }
    }

    function _setHintIcon(nextText, nextClassName) {
      try {
        const nextT = nextText != null ? String(nextText) : "";
        const nextC = nextClassName ? String(nextClassName) : "";
        if (nextT === String(hintIconLastText || "") && nextC === String(hintIconLastClass || "")) return;
        hintIconLastText = nextT;
        hintIconLastClass = nextC;

        if (nextC) hintIcon.className = nextC;
        if (nextT != null) hintIcon.textContent = nextT;
      } catch (e) {
        // ignore
      }
    }
    hint.appendChild(hintIcon);
    hint.appendChild(hintText);

    const liveStatus = _createEl(
      "div",
      "text-[11px] font-medium leading-5 text-text-secondary dark:text-text-on-dark",
      ""
    );
    liveStatus.setAttribute("data-clickui", "live-status");

    const checkStatus = _createEl(
      "div",
      "text-[11px] font-semibold leading-5 text-text-secondary dark:text-text-on-dark text-right",
      ""
    );
    checkStatus.setAttribute("data-clickui", "check-status");
    state.checkStatusEl = checkStatus;

    hint.className += " w-full";
    checkStatus.className =
      "text-[11px] font-semibold leading-5 text-text-secondary dark:text-text-on-dark text-right xl:text-left";
    const statusCard = _createEl(
      "div",
      "flex flex-col gap-2.5 rounded-2xl border border-border-strong bg-surface-2 p-3.5 shadow-sm dark:border-border-strong dark:bg-surface-2",
      ""
    );
    statusCard.setAttribute("data-clickui", "status-card");
    statusCard.classList.add("w-full", "shrink-0");
    const statusMeta = _createEl("div", "flex flex-col gap-0.5", "");
    statusMeta.appendChild(liveStatus);
    statusMeta.appendChild(checkStatus);
    statusCard.appendChild(hint);
    statusCard.appendChild(statusMeta);
    // In L1 runtime flow, targets panel already shows progress/state better.
    // Avoid duplicating the same information in a separate status card.
    if (!(suppressStatusCard || labelsWorkflowInPanel)) {
      sideColumn.appendChild(statusCard);
      sideHasContent = true;
    }
    if (runtimeMode) {
      sideColumn.appendChild(labelsContainer);
      sideHasContent = true;
    }
    if (runtimeAdditionalCard) {
      sideColumn.appendChild(runtimeAdditionalCard);
      sideHasContent = true;
    }

    const labelsIndicator = document.createElement("button");
    labelsIndicator.type = "button";
    labelsIndicator.className =
      "fixed right-3 bottom-24 z-50 rounded-full bg-primary text-primary-fg text-xs font-semibold px-3 py-2.5 shadow-lg hover:bg-primary-hover transition-colors opacity-0 pointer-events-none";
    labelsIndicator.style.opacity = "0";
    labelsIndicator.style.transition = "opacity 160ms ease-out";
    labelsIndicator.textContent = wt("clickui.your_actions_down", "Ваши действия ↓");
    labelsIndicator.addEventListener("click", () => {
      try {
        if (state.labelsCardEl && typeof state.labelsCardEl.scrollIntoView === "function") {
          state.labelsCardEl.scrollIntoView({ behavior: "smooth", block: "start" });
          state.labelsCardEl.classList.add("ring-2", "ring-info");
          setTimeout(() => {
            try {
              if (state.labelsCardEl) state.labelsCardEl.classList.remove("ring-2", "ring-info");
            } catch (e) {
              // ignore
            }
          }, 900);
        }
      } catch (e) {
        // ignore
      }
    });
    state.labelsIndicatorEl = null;

    function _getViewportMetrics() {
      try {
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        return { vh, vw };
      } catch (e) {
        return { vh: 0, vw: 0 };
      }
    }

    function _isBelowFold(el, marginPx) {
      try {
        if (!el || typeof el.getBoundingClientRect !== "function") return false;
        const r = el.getBoundingClientRect();
        const { vh } = _getViewportMetrics();
        if (vh <= 0) return false;
        const m = typeof marginPx === "number" ? marginPx : 24;
        // If the top of the labels card is below the visible area, we need an indicator.
        return r.top > vh - m;
      } catch (e) {
        return false;
      }
    }

    state._updateLabelsIndicator = function updateLabelsIndicator() {
      try {
        const scrollTop =
          (typeof window !== "undefined" && typeof window.scrollY === "number" ? window.scrollY : 0) ||
          (document.documentElement && typeof document.documentElement.scrollTop === "number"
            ? document.documentElement.scrollTop
            : 0) ||
          0;
        const atTop = scrollTop <= 1;
        const hasAnyInputs = Array.isArray(state.labelsInputs) && state.labelsInputs.length > 0;
        const should = atTop && hasAnyInputs;
        if (!state.labelsIndicatorEl) return;
        if (should) {
          state.labelsIndicatorEl.classList.remove("pointer-events-none");
          state.labelsIndicatorEl.classList.add("pointer-events-auto");
          state.labelsIndicatorEl.style.opacity = "0.75";
        } else {
          state.labelsIndicatorEl.classList.remove("pointer-events-auto");
          state.labelsIndicatorEl.classList.add("pointer-events-none");
          state.labelsIndicatorEl.style.opacity = "0";
        }
      } catch (e) {
        // ignore
      }
    };

    window.addEventListener(
      "scroll",
      () => {
        if (typeof state._updateLabelsIndicator === "function") state._updateLabelsIndicator();
      },
      { passive: true }
    );
    window.addEventListener(
      "resize",
      () => {
        if (typeof state._updateLabelsIndicator === "function") state._updateLabelsIndicator();
      },
      { passive: true }
    );

    if (!document.getElementById("clickui-style")) {
      const style = document.createElement("style");
      style.id = "clickui-style";
      style.textContent = `
        @keyframes clickuiPulse { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
        @keyframes clickuiFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes clickuiScaleIn { from { opacity: 0; transform: translate(-50%, -50%) scale(0.6); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
        @keyframes clickuiSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes clickuiUndoAttention {
          0%, 100% { box-shadow: inset 0 0 0 1px var(--clickui-undo-border), 0 0 0 0 var(--clickui-undo-ring); }
          50% { box-shadow: inset 0 0 0 1px var(--clickui-undo-border), 0 0 0 4px var(--clickui-undo-ring); }
        }
        @keyframes clickuiTargetsAttention {
          0%, 100% { box-shadow: inset 0 0 0 1px var(--clickui-targets-border, transparent), 0 0 0 0 var(--clickui-targets-ring, transparent); transform: translateY(0); }
          50% { box-shadow: inset 0 0 0 1px var(--clickui-targets-border, transparent), 0 0 0 6px var(--clickui-targets-ring, transparent); transform: translateY(-1px); }
        }
        @keyframes clickuiOutlineVerbAttention {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }
        .clickui-bad-target { animation: clickuiPulse 1.8s ease-in-out infinite }
        .clickui-marker-entry { animation: clickuiScaleIn 250ms ease-out forwards; }
        .clickui-card-entry { animation: clickuiSlideUp 250ms ease-out forwards; }
        .clickui-card-exit { transition: height 200ms ease, opacity 180ms ease, transform 180ms ease; }
        .clickui-undo-attention { animation: clickuiUndoAttention 780ms ease-in-out infinite; }
        .clickui-targets-attention { animation: clickuiTargetsAttention 900ms ease-in-out 2; }
        .clickui-outline-verb-attention { animation: clickuiOutlineVerbAttention 680ms ease-in-out 2; }
      `;
      document.head.appendChild(style);
    }

    function _setLiveStatus(kind, text) {
      if (!liveStatus) return;
      if (kind === "ok") {
        liveStatus.className = "text-[11px] font-semibold leading-5 text-success-text dark:text-success";
      } else if (kind === "bad") {
        liveStatus.className = "text-[11px] font-semibold leading-5 text-error-text dark:text-error";
      } else {
        liveStatus.className = "text-[11px] font-medium leading-5 text-text-secondary dark:text-text-on-dark";
      }
      liveStatus.textContent = text || "";
    }

    function _updateTargetsPanelInstruction() {
      try {
        if (!state.targetsInstructionEl) return;
        if (!_shouldHideTargetsList(state.taskDto)) return;
        const targets = _getTargets(state.taskDto);
        const instructionText = _buildTargetsStatusInstruction(state.taskDto, targets);
        const total = state.maxClicks;
        const done = Math.min(Array.isArray(state.clicks) ? state.clicks.length : 0, total || 0);
        const progressHtml =
          total > 0
            ? wt("clickui.progress_clicks_limit", "<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Сделано {done} кликов из {total} доступных.</span>").replace("{done}", done).replace("{total}", total)
            : wt("clickui.progress_clicks", "<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Сделано {done} кликов.</span>").replace("{done}", done);
        const extraHtml = _hasAnyUserMarks()
          ? wt("clickui.enter_names_prompt", "<div class=\"mt-0.5 leading-snug\">Введи названия для отмеченных целей и нажми «Проверить ответ».</div>")
          : "";
        const progressMarkup = _requiresDrawing()
          ? (() => {
              const donePoly = Array.isArray(state.polygons) ? state.polygons.length : 0;
              const doneLines = Array.isArray(state.lines) ? state.lines.length : 0;
              const totalPoly = state.maxPolygons;
              const totalLines = state.maxStrokes;
              if (totalPoly > 0 && totalLines > 0) {
                return wt("clickui.progress_poly_and_lines", "<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Контуры {donePoly} из {totalPoly}. Линии {doneLines} из {totalLines}.</span>").replace("{donePoly}", donePoly).replace("{totalPoly}", totalPoly).replace("{doneLines}", doneLines).replace("{totalLines}", totalLines);
              }
              if (totalPoly > 0) {
                return wt("clickui.progress_poly_only", "<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Контуры {donePoly} из {totalPoly}.</span>").replace("{donePoly}", donePoly).replace("{totalPoly}", totalPoly);
              }
              if (totalLines > 0) {
                return wt("clickui.progress_lines_only", "<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Линии {doneLines} из {totalLines}.</span>").replace("{doneLines}", doneLines).replace("{totalLines}", totalLines);
              }
              return wt("clickui.progress_mark_fragments", "<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Отметь нужные фрагменты.</span>");
            })()
          : progressHtml;
        state.targetsInstructionEl.innerHTML =
          `<div class="leading-snug">${_escapeHtml(instructionText)}</div>` +
          `<div class="mt-1">${progressMarkup}</div>` +
          extraHtml;
      } catch (e) {
        // ignore
      }
    }

    function _updateLiveProgress() {
      if (!liveStatus) return;
      if (state.mode === "brush") {
        const hasActive = Array.isArray(state.activeStroke) && state.activeStroke.length >= 1;
        const doneLines = state.lines.length + (hasActive && !_requiresDrawing() ? 1 : 0);
        const totalLines = state.maxStrokes;
        if (_requiresDrawing()) {
          const willBePoly =
            hasActive &&
            Array.isArray(state.activeStroke) &&
            state.activeStroke.length >= 3 &&
            (function () {
              const pts = state.activeStroke;
              const a = pts[0];
              const b = pts[pts.length - 1];
              const dx = (a[0] || 0) - (b[0] || 0);
              const dy = (a[1] || 0) - (b[1] || 0);
              return dx * dx + dy * dy <= 14 * 14;
            })();

          const donePoly = state.polygons.length + (hasActive && willBePoly ? 1 : 0);
          const totalPoly = state.maxPolygons;
          const left =
            totalPoly > 0
              ? wt("clickui.status_poly_limit", "Контуры: {done}/{total}. ").replace("{done}", donePoly).replace("{total}", totalPoly)
              : wt("clickui.status_poly", "Контуры: {done}. ").replace("{done}", donePoly);
          const right =
            totalLines > 0
              ? wt("clickui.status_lines_limit", "Штрихи: {done}/{total}. ").replace("{done}", doneLines).replace("{total}", totalLines)
              : wt("clickui.status_lines", "Штрихи: {done}. ").replace("{done}", doneLines);
          _setLiveStatus("neutral", `${left}${right}${wt("clickui.drag_border_guidance", "Зажми и веди мышью по границе.")}`);
        } else {
          _setLiveStatus(
            "neutral",
            totalLines > 0
              ? wt("clickui.drawn_lines_limit", "Нарисовано {done} штрихов из {total}. Зажми и веди мышью по границе.").replace("{done}", doneLines).replace("{total}", totalLines)
              : wt("clickui.drawn_lines", "Нарисовано {done} штрихов. Зажми и веди мышью по границе.").replace("{done}", doneLines)
          );
        }
        return;
      }

      const found = state.foundClickTargets ? state.foundClickTargets.size : 0;
      const total = state.maxClicks;
      const usedClicks = Math.min(Array.isArray(state.clicks) ? state.clicks.length : 0, total || 0);
      const isConfirmedProgress = state.locked === true;
      _setLiveStatus(
        "neutral",
        isConfirmedProgress
          ? total > 0
            ? wt("clickui.found_targets_limit", "Найдено целей: {found}/{total}").replace("{found}", found).replace("{total}", total)
            : wt("clickui.found_targets", "Найдено целей: {found}").replace("{found}", found)
          : total > 0
            ? wt("clickui.used_clicks_limit", "Использовано кликов: {used}/{total}").replace("{used}", usedClicks).replace("{total}", total)
            : wt("clickui.used_clicks", "Использовано кликов: {used}").replace("{used}", usedClicks)
      );
    }

    state._updateLiveProgress = _updateLiveProgress;

    function _flashHint(message) {
      if (state.tempHintTimer) {
        clearTimeout(state.tempHintTimer);
        state.tempHintTimer = null;
      }

      if (_shouldHideTargetsList(state.taskDto) && state.targetsInstructionEl) {
        state.targetsInstructionEl.innerHTML =
          `<span class="font-semibold text-warning-darker dark:text-warning-lighter">${_escapeHtml(message)}</span>`;
        state.tempHintTimer = setTimeout(() => {
          state.tempHintTimer = null;
          if (typeof state._updateToolbar === "function") state._updateToolbar();
        }, 3000);
        return;
      }

      if (!hintText) return;

      hint.className = hintWarningClass;
      _setHintIcon("warning", "material-symbols-outlined text-[18px] text-warning dark:text-warning-light");
      _setHintHtml(
        `<span class="font-semibold text-text-main dark:text-text-on-dark">${_escapeHtml(message)}</span>`
      );

      state.tempHintTimer = setTimeout(() => {
        state.tempHintTimer = null;
        if (typeof state._updateToolbar === "function") state._updateToolbar();
      }, 3000);
    }

    controls.appendChild(refToggles);

    mainColumn.appendChild(wrapperRow);
    mainColumn.appendChild(controls);
    mainColumn.appendChild(reviewHost);
    if (!runtimeMode) {
      mainColumn.appendChild(labelsContainer);
    }

    layout.appendChild(mainColumn);
    if (sideHasContent) {
      layout.appendChild(sideColumn);
    }
    root.appendChild(layout);

    img.addEventListener("load", () => {
      const naturalW = img.naturalWidth || 1;
      const naturalH = img.naturalHeight || 1;

      img.style.width = `${naturalW}px`;
      img.style.height = `${naturalH}px`;
      contentLayer.style.width = `${naturalW}px`;
      contentLayer.style.height = `${naturalH}px`;

      const viewportRect = viewport.getBoundingClientRect();
      const fitX = viewportRect.width > 0 ? viewportRect.width / naturalW : 1;
      const fitY = viewportRect.height > 0 ? viewportRect.height / naturalH : 1;
      state.zoom = Math.max(0.25, Math.min(6, Math.min(fitX, fitY)));
      state.panX = (viewportRect.width - naturalW * state.zoom) / 2;
      state.panY = (viewportRect.height - naturalH * state.zoom) / 2;

      if (state.pendingViewState) {
        const pendingViewState = state.pendingViewState;
        state.pendingViewState = null;
        _applyRestoredViewState(pendingViewState, { applyViewport: true });
      } else {
        _applyTransform();
        _renderMarkers();
        _renderDrawing();
        _renderReference();
      }
      if (typeof state._updateLabelsIndicator === "function") state._updateLabelsIndicator();
    });

    img.addEventListener("error", () => {
      imgError.classList.remove("hidden");
    });

    viewport.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const dir = ev.deltaY > 0 ? -1 : 1;
        const factor = dir > 0 ? 1.15 : 1 / 1.15;
        _zoomAtClientPoint(state.zoom * factor, ev.clientX, ev.clientY);
      },
      { passive: false }
    );

    function _onPointerDown(ev) {
      if (state.locked) return;
      if (!state.img) return;
      if (ev.button != null && ev.button !== 0) return;

      state.isPointerDown = true;
      if (state.mode === "pan") {
        state.panStart = {
          x: ev.clientX,
          y: ev.clientY,
          panX: state.panX,
          panY: state.panY,
        };
        if (state.imageWrapper) state.imageWrapper.style.cursor = "grabbing";
        return;
      }

      if (state.mode === "brush") {
        state.ignoreClicksUntil = Date.now() + 350;
        const drawingTask = _requiresDrawing();
        const linesFull = state.maxStrokes > 0 && state.lines.length >= state.maxStrokes;
        const polygonsFull = state.maxPolygons > 0 && state.polygons.length >= state.maxPolygons;
        if ((!drawingTask && linesFull) || (drawingTask && linesFull && polygonsFull)) {
          _flashHint(wt("clickui.limit_lines_hint", "Достигнут лимит штрихов. Нажми «Проверить» для завершения."));
          _setLiveStatus("bad", wt("clickui.limit_lines_status", "Лимит штрихов"));
          _flashUndoButtonAttention();
          return;
        }
        const pt = _getClickFromEvent(ev);
        if (!pt) return;
        state.soloDuringDraw = true;
        _renderMarkers();
        state.activeStroke = [[pt.x, pt.y]];
        _renderDrawing();
        _updateLiveProgress();
        if (typeof state._updateToolbar === "function") state._updateToolbar();
        return;
      }
    }

    function _onPointerMove(ev) {
      if (!state.isPointerDown) return;
      if (state.locked) return;

      if (state.mode === "pan") {
        if (!state.panStart) return;
        const dx = ev.clientX - state.panStart.x;
        const dy = ev.clientY - state.panStart.y;
        state.panX = state.panStart.panX + dx;
        state.panY = state.panStart.panY + dy;
        _applyTransform();
        return;
      }

      if (state.mode === "brush") {
        const pt = _getClickFromEvent(ev);
        if (!pt || !state.activeStroke) return;

        const last = state.activeStroke[state.activeStroke.length - 1];
        const dx = pt.x - last[0];
        const dy = pt.y - last[1];
        if (dx * dx + dy * dy < 4) return;

        state.activeStroke.push([pt.x, pt.y]);
        _renderDrawing();
        _updateLiveProgress();
        if (typeof state._updateToolbar === "function") state._updateToolbar();
      }
    }

    function _distanceSq(a, b) {
      const dx = (a[0] || 0) - (b[0] || 0);
      const dy = (a[1] || 0) - (b[1] || 0);
      return dx * dx + dy * dy;
    }

    function _getNaturalCoordinateScale(options) {
      const opts = options || {};
      if (Number.isFinite(Number(opts.coordinateScale)) && Number(opts.coordinateScale) > 0) {
        return Number(opts.coordinateScale);
      }

      const img = opts.img || state.img;
      if (!img) return 1;

      const naturalW = Number(opts.naturalWidth != null ? opts.naturalWidth : img.naturalWidth || img.width || 0);
      const naturalH = Number(opts.naturalHeight != null ? opts.naturalHeight : img.naturalHeight || img.height || 0);
      const rect =
        opts.rect ||
        (typeof img.getBoundingClientRect === "function" ? img.getBoundingClientRect() : null);

      if (!rect || !rect.width || !rect.height || !naturalW || !naturalH) {
        return 1;
      }

      const scaleX = naturalW / rect.width;
      const scaleY = naturalH / rect.height;
      const scale = Math.max(scaleX, scaleY);
      return Number.isFinite(scale) && scale > 0 ? scale : 1;
    }

    const _CLOSE_STROKE_DISTANCE_PX = 14;
    const _MIN_CLOSED_STROKE_POINTS = 5;
    const _MIN_CLOSED_STROKE_EXCURSION_PX = 18;

    function _getClosedStrokePoints(points, options) {
      if (!Array.isArray(points) || points.length < _MIN_CLOSED_STROKE_POINTS) return null;
      const coordinateScale = _getNaturalCoordinateScale(options);
      const closeStrokeDistancePx = _CLOSE_STROKE_DISTANCE_PX * coordinateScale;
      const minClosedStrokeExcursionPx = _MIN_CLOSED_STROKE_EXCURSION_PX * coordinateScale;
      const start = points[0];
      let hadMeaningfulExcursion = false;
      for (let idx = 1; idx < points.length; idx += 1) {
        const distSq = _distanceSq(start, points[idx]);
        if (distSq >= minClosedStrokeExcursionPx * minClosedStrokeExcursionPx) {
          hadMeaningfulExcursion = true;
        }
        if (
          idx >= (_MIN_CLOSED_STROKE_POINTS - 1) &&
          hadMeaningfulExcursion &&
          distSq <= closeStrokeDistancePx * closeStrokeDistancePx
        ) {
          return points.slice(0, idx + 1);
        }
      }
      return null;
    }

    function _onPointerUp() {
      if (!state.isPointerDown) return;
      state.isPointerDown = false;

      if (state.mode === "pan") {
        state.panStart = null;
        if (state.imageWrapper) state.imageWrapper.style.cursor = "grab";
      }

      if (state.mode === "brush") {
        state.ignoreClicksUntil = Date.now() + 350;
        // Finalize active stroke: classify as contour (polygon) vs freehand stroke
        try {
          let pts = Array.isArray(state.activeStroke) ? state.activeStroke : [];
          // If user just clicked (no movement), we still want it to count as a stroke.
          // Convert single-point stroke into a minimal 2-point stroke.
          if (pts.length === 1) {
            const p0 = pts[0];
            pts = [p0, [p0[0], p0[1]]];
          }
          if (pts.length >= 2) {
            const closedStrokePoints = _requiresDrawing() ? _getClosedStrokePoints(pts) : null;
            const isClosed = !!closedStrokePoints;
            const drawingTask = _requiresDrawing();
            if (isClosed) {
              pts = closedStrokePoints;
              if (_requiresDrawing() && state.maxPolygons > 0 && state.polygons.length >= state.maxPolygons) {
                _flashHint(wt("clickui.limit_polygons_hint", "Достигнут лимит контуров. Нарисуй штрихи (фрихенд) или нажми «Проверить». "));
                _setLiveStatus("bad", wt("clickui.limit_polygons_status", "Лимит контуров"));
              } else {
                state.polygons = Array.isArray(state.polygons) ? state.polygons : [];
                state.polygons.push({ points: pts });
                state.labelsPolygons = Array.isArray(state.labelsPolygons) ? state.labelsPolygons : [];
                state.labelsPolygons.push("");
                state.actionHistory = Array.isArray(state.actionHistory) ? state.actionHistory : [];
                state.actionHistory.push({ kind: "polygon" });
                _resetActionInterpretation();
                _clientLog("finalize_stroke", {
                  kind: "polygon",
                  now: Date.now(),
                  mode: state.mode,
                  pts: Array.isArray(pts) ? pts.length : null,
                  clicks: Array.isArray(state.clicks) ? state.clicks.length : null,
                  lines: Array.isArray(state.lines) ? state.lines.length : null,
                  polygons: Array.isArray(state.polygons) ? state.polygons.length : null,
                  histTail: (Array.isArray(state.actionHistory) ? state.actionHistory : [])
                    .slice(-8)
                    .map((a) => (a ? a.kind : null)),
                });
              }
            } else if (drawingTask && state.maxStrokes > 0 && state.lines.length >= state.maxStrokes) {
              _flashHint(wt("clickui.limit_lines_hint_undo", "Достигнут лимит штрихов. Нажми «Проверить» для завершения или «Отменить», чтобы убрать последний штрих. "));
              _setLiveStatus("bad", wt("clickui.limit_lines_status", "Лимит штрихов"));
              _flashUndoButtonAttention();
            } else {
              state.lines = Array.isArray(state.lines) ? state.lines : [];
              state.lines.push({ points: pts });
              state.labelsLines = Array.isArray(state.labelsLines) ? state.labelsLines : [];
              state.labelsLines.push("");
              state.actionHistory = Array.isArray(state.actionHistory) ? state.actionHistory : [];
              state.actionHistory.push({ kind: "line" });
              _resetActionInterpretation();
              _clientLog("finalize_stroke", {
                kind: "line",
                now: Date.now(),
                mode: state.mode,
                pts: Array.isArray(pts) ? pts.length : null,
                clicks: Array.isArray(state.clicks) ? state.clicks.length : null,
                lines: Array.isArray(state.lines) ? state.lines.length : null,
                polygons: Array.isArray(state.polygons) ? state.polygons.length : null,
                histTail: (Array.isArray(state.actionHistory) ? state.actionHistory : [])
                  .slice(-8)
                  .map((a) => (a ? a.kind : null)),
              });
            }
          }
        } catch (e) {
          // ignore
        }

        if (_debugEnabled()) {
          try {
            console.log("[ClickUI][stroke] end", {
              requiresDrawing: _requiresDrawing(),
              polygons: Array.isArray(state.polygons) ? state.polygons.length : null,
              lines: Array.isArray(state.lines) ? state.lines.length : null,
              maxPolygons: state.maxPolygons,
              maxStrokes: state.maxStrokes,
            });
          } catch (e) {
            // ignore
          }
        }

        state.soloDuringDraw = false;
        state.activeStroke = null;
        _renderDrawing();
        _renderMarkers();
        _renderLabelsInputs(null);
        _refreshUserActionsPanel();
        if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
        if (typeof state._updateToolbar === "function") state._updateToolbar();
      }
    }

    viewport.addEventListener("pointerdown", _onPointerDown);
    window.addEventListener("pointermove", _onPointerMove);
    window.addEventListener("pointerup", _onPointerUp);
    window.addEventListener("pointercancel", _onPointerUp);

    viewport.addEventListener("click", (ev) => {
      _clientLog("evt_click", {
        now: Date.now(),
        mode: state.mode,
        ignored: Date.now() < (state.ignoreClicksUntil || 0),
        ignoreClicksUntil: state.ignoreClicksUntil || 0,
        clicks: Array.isArray(state.clicks) ? state.clicks.length : null,
        lines: Array.isArray(state.lines) ? state.lines.length : null,
        polygons: Array.isArray(state.polygons) ? state.polygons.length : null,
        histTail: (Array.isArray(state.actionHistory) ? state.actionHistory : [])
          .slice(-6)
          .map((a) => (a ? a.kind : null)),
      });
      if (Date.now() < (state.ignoreClicksUntil || 0)) return;
      if (state.locked) return;
      if (_requiresDrawing()) return;
      if (state.mode !== "click") return;
      if (state.maxClicks > 0 && state.clicks.length >= state.maxClicks) {
        if (state.maxStrokes > 0) {
          state.autoBrushFromClicks = true;
          _setMode("brush");
        }
        _flashHint(wt("clickui.limit_clicks_hint", "Достигнут лимит кликов. Нажми «Проверить» для завершения или «Отменить», чтобы убрать последний клик."));
        _flashUndoButtonAttention();
        _setLiveStatus("bad", wt("clickui.limit_clicks_status", "Лимит кликов"));
        return;
      }
      const click = _getClickFromEvent(ev);
      if (!click) return;

      const hit = _checkClickHit(click.x, click.y);
      if (hit.hit) {
        if (state.foundClickTargets && state.foundClickTargets.has(hit.targetIndex)) {
          _flashHint(wt("clickui.already_found_hint", "Эта цель уже была найдена."));
          _setLiveStatus("bad", wt("clickui.already_found_status", "Уже найдено ({ref})").replace("{ref}", _getTargetDisplayReference(state.taskDto, hit.targetIndex)));
          return;
        }
        if (state.foundClickTargets) {
          state.foundClickTargets.add(hit.targetIndex);
          _syncFoundTargetsUI();
        }
        _setLiveStatus("ok", wt("clickui.hit_status", "Попадание ({ref})").replace("{ref}", _getTargetDisplayReference(state.taskDto, hit.targetIndex)));
      } else {
        _setLiveStatus("bad", wt("clickui.miss_status", "Мимо"));
      }

      state.clicks.push(click);
      state.labelsClicks = Array.isArray(state.labelsClicks) ? state.labelsClicks : [];
      state.labelsClicks.push("");
      state.actionHistory = Array.isArray(state.actionHistory) ? state.actionHistory : [];
      state.actionHistory.push({ kind: "click" });
      _resetActionInterpretation();
      _clientLog("add_click", {
        now: Date.now(),
        mode: state.mode,
        clicks: Array.isArray(state.clicks) ? state.clicks.length : null,
        lines: Array.isArray(state.lines) ? state.lines.length : null,
        polygons: Array.isArray(state.polygons) ? state.polygons.length : null,
        histTail: (Array.isArray(state.actionHistory) ? state.actionHistory : [])
          .slice(-8)
          .map((a) => (a ? a.kind : null)),
      });
      _renderMarkers();
      _renderLabelsInputs(null);
      _refreshUserActionsPanel();
      _syncFoundTargetsUI();
      if (state.maxClicks > 0 && state.clicks.length >= state.maxClicks && state.maxStrokes > 0) {
        state.autoBrushFromClicks = true;
        _setMode("brush");
      }
      if (typeof state._updateToolbar === "function") state._updateToolbar();
    });

    state.root = root;
    state.img = img;
    state.imageWrapper = wrapper;
    state.viewport = viewport;
    state.contentLayer = contentLayer;
    state.markerLayer = markerLayer;
    state.drawLayer = drawLayer;
    state.refLayer = refLayer;
    state.labelOverlay = labelOverlay;
    state.labelsContainer = labelsContainer;
    state.labelsInputs = [];
    state.reviewHost = reviewHost;
    state.reviewComparisonEl = null;
    if (state.checkStatusEl) state.checkStatusEl.textContent = "";

    state._updateToolbar = function updateToolbar() {
      const modeNow = state.mode;
      const modeChanged = modeNow !== state._lastHintMode;
      state._lastHintMode = modeNow;
      void modeChanged;

      if (_requiresDrawing() && selectBtn) {
        // Keep click tool hidden in L3 even if className is overwritten.
        selectBtn.style.display = "none";
      } else if (selectBtn) {
        selectBtn.style.display = "";
      }

      if (state.mode === "click") {
        _activeBtn(selectBtn, "text-[18px]");
        _inactiveBtn(brushBtn, "text-[20px]");
        _inactiveBtn(panBtn, "text-[20px]");
        _syncUndoButtonState();
        clearBtn.title = wt("clickui.clear_clicks", "Очистить все клики");
        clearIcon.textContent = "delete";

        hint.className = hintBaseClass;
        _setHintIcon("info", "material-symbols-outlined text-[18px] text-text-secondary dark:text-text-on-dark");

        if (hintText) {
          const done = state.clicks.length;
          const total = state.maxClicks;
          const targets = _getTargets(state.taskDto);
          const instructionHtml =
            `<div class="leading-snug">${_escapeHtml(_buildTargetsStatusInstruction(state.taskDto, targets))}</div>`;
          const baseHtml =
            total > 0
              ? wt("clickui.progress_clicks_limit", "<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Сделано {done} кликов из {total} доступных.</span>").replace("{done}", done).replace("{total}", total)
              : wt("clickui.progress_clicks", "<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Сделано {done} кликов.</span>").replace("{done}", done);
          const extraHtml =
            _requiresLabels() && _hasAnyUserMarks()
              ? wt("clickui.enter_names_prompt", "<div class=\"mt-0.5 leading-snug\">Введи названия для отмеченных целей и нажми «Проверить ответ».</div>")
              : "";
          _setHintHtml(instructionHtml + `<div class="mt-1">${baseHtml}</div>` + extraHtml);
        }
      } else if (state.mode === "brush") {
        _inactiveBtn(selectBtn, "text-[18px]");
        _activeBtn(brushBtn, "text-[20px]");
        _inactiveBtn(panBtn, "text-[20px]");
        _syncUndoButtonState();
        clearBtn.title = _requiresDrawing()
          ? wt("clickui.clear_contours_lines", "Очистить контуры и линии")
          : wt("clickui.clear_lines", "Очистить штрихи");
        clearIcon.textContent = "ink_eraser";

        hint.className = hintBaseClass;
        _setHintIcon("gesture", "material-symbols-outlined text-[18px] text-text-secondary dark:text-text-on-dark");

        if (hintText) {
          const hasActive = Array.isArray(state.activeStroke) && state.activeStroke.length >= 1;
          const doneLines = state.lines.length + (hasActive && !_requiresDrawing() ? 1 : 0);
          const totalLines = state.maxStrokes;
          let baseHtml = "";
          if (_requiresDrawing()) {
            const willBePoly = hasActive && !!_getClosedStrokePoints(state.activeStroke);
            const donePoly = state.polygons.length + (hasActive && willBePoly ? 1 : 0);
            const totalPoly = state.maxPolygons;
            if (totalPoly > 0 && totalLines > 0) {
              const polyText = wt("clickui.drawn_poly_limit", "Контуры {done} из {total}.").replace("{done}", donePoly).replace("{total}", totalPoly);
              const lineText = wt("clickui.drawn_lines_limit_no_guide", "Линии {done} из {total}.").replace("{done}", doneLines).replace("{total}", totalLines);
              baseHtml = `<span class=\"font-semibold text-text-main dark:text-text-on-dark\">${polyText} ${lineText}</span> ` + wt("clickui.closed_stroke_info", "Замкнутый штрих засчитывается как контур, незамкнутый — как линия.");
            } else if (totalPoly > 0) {
              baseHtml = wt("clickui.draw_poly_guidance", `<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Контуры {done} из {total}.</span> Обведи нужную область и замкни линию.`).replace("{done}", donePoly).replace("{total}", totalPoly);
            } else if (totalLines > 0) {
              baseHtml = wt("clickui.draw_lines_guidance", `<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Линии {done} из {total}.</span> Проведи линию по нужному фрагменту изображения.`).replace("{done}", doneLines).replace("{total}", totalLines);
            } else {
              baseHtml = wt("clickui.draw_mark_fragments_guidance", `<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Отметь нужные фрагменты.</span> Рисуй только по тем строкам, которые показаны в списке целей.`);
            }
          } else {
            if (totalLines > 0) {
              baseHtml = wt("clickui.draw_lines_guidance", `<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Линии {done} из {total}.</span> Проведи линию по нужному фрагменту изображения.`).replace("{done}", doneLines).replace("{total}", totalLines);
            } else {
              baseHtml = wt("clickui.draw_lines_guidance_no_limit", `<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Линии {done}.</span> Проведи линию по нужному фрагменту изображения.`).replace("{done}", doneLines);
            }
          }

          const extraHtml =
            _requiresLabels() && _hasAnyUserMarks()
              ? wt("clickui.enter_names_prompt", "<div class=\"mt-0.5 leading-snug\">Введи названия для отмеченных целей и нажми «Проверить ответ».</div>")
              : "";
          _setHintHtml(baseHtml + extraHtml);
        }
      } else {
        _inactiveBtn(selectBtn, "text-[18px]");
        _inactiveBtn(brushBtn, "text-[20px]");
        _activeBtn(panBtn, "text-[20px]");
        _syncUndoButtonState();
        clearBtn.title = wt("clickui.clear_all", "Очистить всё");
        clearIcon.textContent = "delete";

        hint.className = hintBaseClass;
        _setHintIcon("info", "material-symbols-outlined text-[18px] text-text-secondary dark:text-text-on-dark");
      }

      _updateTargetsPanelInstruction();

    };

    if (_requiresDrawing()) {
      // Level 3: contour drawing only (no click tool)
      selectBtn.classList.add("hidden");
      _setMode("brush");
    } else {
      _setMode("click");
    }
    if (typeof state._updateToolbar === "function") state._updateToolbar();
    _applyUserMarksVisibility();
    _updateLiveProgress();
    _renderLabelsInputs(null);

    return root;
  };

  ClickUI.render = function render(container, taskDto, options) {
    const taskType = _getTaskType(taskDto);
    if (taskType !== "click" && taskType !== "draw") return;

    const root = ClickUI.createRoot(container, taskDto, options);
    container.appendChild(root);
  };

  ClickUI.restoreInput = function restoreInput(draft) {
    if (!draft || typeof draft !== "object") return;

    function _normalizePoint(point) {
      if (!point) return null;
      const x = Number(Array.isArray(point) ? point[0] : point.x);
      const y = Number(Array.isArray(point) ? point[1] : point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return [x, y];
    }

    function _normalizePointsCollection(items, minPoints) {
      if (!Array.isArray(items)) return [];
      return items
        .map((item) => {
          const rawPoints = Array.isArray(item && item.points) ? item.points : [];
          const points = rawPoints.map(_normalizePoint).filter(Boolean);
          return points.length >= minPoints ? { points } : null;
        })
        .filter(Boolean);
    }

    const nextClicks = Array.isArray(draft.clicks)
      ? draft.clicks
          .map((click) => {
            const x = Number(click && click.x);
            const y = Number(click && click.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { x, y, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 };
          })
          .filter(Boolean)
      : [];

    state.clicks = nextClicks;
    state.polygons = _normalizePointsCollection(draft.polygons, 3);
    state.lines = _normalizePointsCollection(draft.lines, 2);
    state.labelsClicks = Array.isArray(draft.labels_clicks) ? draft.labels_clicks.map((s) => String(s || "")) : [];
    state.labelsPolygons = Array.isArray(draft.labels_polygons)
      ? draft.labels_polygons.map((s) => String(s || ""))
      : [];
    state.labelsLines = Array.isArray(draft.labels_lines) ? draft.labels_lines.map((s) => String(s || "")) : [];
    state.highlightLabelErrors = false;
    state.labelEval = null;
    state.badRefTargets = null;
    state.showRef = false;
    state.showRefContours = true;
    state.showRefPolygons = true;
    state.showRefLines = true;
    state.userLinesCheckedStyle = false;
    state.userMarksCheckedStyle = false;
    state.locked = false;
    state.hoveredActionKey = null;
    _setActionInterpretation(null, false);

    const restoredActionHistory = Array.isArray(draft.action_history)
      ? draft.action_history
          .map((item) => String(item && item.kind ? item.kind : "").trim())
          .filter((kind) => kind === "click" || kind === "polygon" || kind === "line")
          .map((kind) => ({ kind }))
      : [];
    state.actionHistory = restoredActionHistory.length
      ? restoredActionHistory
      : [
          ...state.clicks.map(() => ({ kind: "click" })),
          ...state.polygons.map(() => ({ kind: "polygon" })),
          ...state.lines.map(() => ({ kind: "line" })),
        ];

    if (Array.isArray(draft.found_targets)) {
      state.foundClickTargets = _normalizeFoundTargetsSet(draft.found_targets);
    } else {
      _rebuildFoundTargetsFromClicks();
    }

    _ensureLabelsLengths();
    if (_requiresDrawing()) {
      _setMode("brush");
    } else if (state.maxClicks > 0 && state.clicks.length >= state.maxClicks && state.maxStrokes > 0) {
      state.autoBrushFromClicks = true;
      _setMode("brush");
    } else {
      state.autoBrushFromClicks = false;
      _setMode("click");
    }
    _renderMarkers();
    _renderDrawing();
    _renderReference();
    _renderLabelsInputs(null);
    _refreshUserActionsPanel();
    _applyUserMarksVisibility();
    _syncFoundTargetsUI();
    if (typeof state._updateToolbar === "function") state._updateToolbar();
  };

  ClickUI.getUserAnswerPayload = function getUserAnswerPayload() {
    const taskDto = state.taskDto;
    const answerKey = (taskDto && taskDto.answer_key) || {};
    const targets = Array.isArray(answerKey.targets) ? answerKey.targets : [];

    const clicks = state.clicks.map((c) => ({
      x: c.x,
      y: c.y,
      scale_factor: 1.0,
      offset_x: 0.0,
      offset_y: 0.0,
    }));

    const payload = {
      clicks,
      found_targets: state.foundClickTargets instanceof Set ? Array.from(state.foundClickTargets).sort((a, b) => a - b) : [],
      total_targets: targets.length,
    };

    if (_requiresDrawing()) {
      if (state.img) {
        payload.image_width = state.img.naturalWidth || null;
        payload.image_height = state.img.naturalHeight || null;
        if (typeof state.img.getBoundingClientRect === "function") {
          const rect = state.img.getBoundingClientRect();
          payload.display_width = rect && Number.isFinite(rect.width) ? rect.width : null;
          payload.display_height = rect && Number.isFinite(rect.height) ? rect.height : null;
        }
      }
      payload.brush_radius = state.brushRadius != null ? state.brushRadius : 8;

      if (Array.isArray(state.polygons) && state.polygons.length) {
        payload.polygons = state.polygons
          .map((p) => ({ points: (p && Array.isArray(p.points) ? p.points : []).filter(Boolean) }))
          .filter((p) => Array.isArray(p.points) && p.points.length >= 3);
      }
    }

    if (Array.isArray(state.lines) && state.lines.length) {
      payload.lines = state.lines
        .map((l) => {
          const pts = (l && Array.isArray(l.points) ? l.points : []).filter(Boolean);
          return { points: pts };
        })
        .filter((l) => Array.isArray(l.points) && l.points.length >= 2);
    }

    if (_requiresLabels() && _hasAnyUserMarks()) {
      _ensureLabelsLengths();
      if (_requiresDrawing()) {
        payload.labels_polygons = (state.labelsPolygons || []).map((s) => String(s || "").trim());
        payload.labels_lines = (state.labelsLines || []).map((s) => String(s || "").trim());
      } else {
        payload.labels_clicks = (state.labelsClicks || []).map((s) => String(s || "").trim());
        payload.labels_lines = (state.labelsLines || []).map((s) => String(s || "").trim());
      }
    }

    if (Array.isArray(state.actionHistory) && state.actionHistory.length) {
      payload.action_history = state.actionHistory
        .map((entry) => String(entry && entry.kind ? entry.kind : "").trim())
        .filter((kind) => kind === "click" || kind === "polygon" || kind === "line")
        .map((kind) => ({ kind }));
    }

    if (
      !payload.clicks.length &&
      !(payload.polygons && payload.polygons.length) &&
      !(payload.lines && payload.lines.length)
    ) {
      return {};
    }

    return payload;
  };

  ClickUI.getViewState = function getViewState() {
    return {
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
      mode: state.mode,
      showRef: !!state.showRef,
      showRefContours: state.showRefContours !== false,
      showRefPolygons: state.showRefPolygons !== false,
      showRefLines: state.showRefLines !== false,
      showRefLabels: state.showRefLabels !== false,
      showUserMarks: state.showUserMarks !== false,
    };
  };

  ClickUI.restoreViewState = function restoreViewState(viewState) {
    const safeViewState = _sanitizeViewState(viewState);
    if (!safeViewState) return;

    const canApplyViewport =
      !!(state.img && state.img.complete && (state.img.naturalWidth || 0) > 0);
    state.pendingViewState = canApplyViewport ? null : safeViewState;
    _applyRestoredViewState(safeViewState, { applyViewport: canApplyViewport });
  };

  ClickUI.applyCheckFeedback = function applyCheckFeedback(result) {
    state.locked = true;

    if (!result || !result.details || typeof result.details !== "object") {
      return;
    }

    const details = result.details;
    _setActionInterpretation(_buildActionInterpretationMap(details), true);
    _refreshUserActionsPanel();

    const foundTargets =
      (Array.isArray(details.found_targets) && details.found_targets) ||
      (Array.isArray(details.foundTargets) && details.foundTargets) ||
      null;
    state.foundClickTargets = _normalizeFoundTargetsSet(foundTargets);
    _syncFoundTargetsUI();

    const error = details.error || null;

    const stage = details.stage || null;

    const bad = new Set();
    try {
      const clickResults = Array.isArray(details.click_results) ? details.click_results : [];
      const lineResults = Array.isArray(details.line_results) ? details.line_results : [];
      // Level 2: backend returns targets_info instead of click_results/line_results
      const targetsInfo = Array.isArray(details.targets_info) ? details.targets_info : [];

      const taskDto = state.taskDto;
      const answerKey = (taskDto && taskDto.answer_key) || {};
      const targets = Array.isArray(answerKey.targets) ? answerKey.targets : [];

      function _inferShapeLower(t) {
        const s = (t && (t.shape || t.type)) || "";
        let sl = String(s).toLowerCase();
        if (!sl && t && Array.isArray(t.points)) {
          if (t.points.length >= 3) sl = "polygon";
          else if (t.points.length >= 2) sl = "freehand";
        }
        return sl;
      }

      clickResults.forEach((r) => {
        if (!r || typeof r !== "object") return;
        const idx = typeof r.target_index === "number" ? r.target_index : null;
        const ok = r.click_success === true;
        if (idx == null || ok) return;
        const shape = _inferShapeLower(targets[idx]);
        if (shape === "polygon") bad.add(idx);
      });

      lineResults.forEach((r) => {
        if (!r || typeof r !== "object") return;
        const idx = typeof r.target_index === "number" ? r.target_index : null;
        const ok = r.line_success === true;
        if (idx == null || ok) return;
        const shape = _inferShapeLower(targets[idx]);
        if (shape === "freehand") bad.add(idx);
      });

      // Level 2: parse targets_info (found: false => mark as bad)
      if (!clickResults.length && !lineResults.length && targetsInfo.length) {
        targetsInfo.forEach((info) => {
          if (!info || typeof info !== "object") return;
          if (info.found === false) {
            const idx = typeof info.index === "number" ? info.index : null;
            if (idx == null) return;
            bad.add(idx);
          }
        });
      }
    } catch (e) {
      // ignore
    }

    state.badRefTargets = bad.size ? bad : null;
    // Store targets_info for _findLabelRowTargetIndex (hover mapping in Level 2).
    try {
      state.lastTargetsInfo = Array.isArray(details.targets_info) ? details.targets_info : [];
    } catch (e) {
      state.lastTargetsInfo = [];
    }
    if (stage === "lines" || error === "lines_missing") {
      state.locked = false;
      _setMode("brush");
    }

    if (stage === "clicks") {
      state.locked = false;
      _setMode("click");
    }

    if (state.checkStatusEl) {
      const isFinal = stage !== "lines" && error !== "lines_missing";
      if (isFinal && typeof result.message === "string" && result.message.trim()) {
        state.checkStatusEl.textContent = result.message;
        state.checkStatusEl.className =
          result.success === true
            ? "text-xs font-semibold text-success-text dark:text-success"
            : "text-xs font-semibold text-error-text dark:text-error";
      } else {
        state.checkStatusEl.textContent = "";
      }
    }

    if (stage !== "lines" && error !== "lines_missing") {
      const hintEl = state.root ? state.root.querySelector('[data-clickui="hint"]') : null;
      if (hintEl) {
        hintEl.classList.add("hidden");
      }
    }

    // После любой проверки показываем референсные цели с возможностью выключить.
    state.showRef = true;
    state.showRefContours = true;
    state.showRefPolygons = true;
    state.showRefLines = true;
    state.userLinesCheckedStyle = true;
    state.userMarksCheckedStyle = true;
    // Keep the user's own marks visible after check so the result screen
    // reflects exactly what was submitted and can later be reused in history.
    state.showUserMarks = true;
    if (state.root) {
      const toggles = state.root.querySelector('[data-clickui="ref-toggles"]');
      if (toggles) {
        toggles.classList.remove("hidden");
      }

      const chk = state.root.querySelector('[data-clickui="ref-show"]');
      if (chk && chk instanceof HTMLInputElement) {
        chk.checked = true;
      }

      const chkUser = state.root.querySelector('[data-clickui="user-marks"]');
      if (chkUser && chkUser instanceof HTMLInputElement) {
        chkUser.checked = true;
      }

      const chkPolys = state.root.querySelector('[data-clickui="ref-polygons"]');
      if (chkPolys && chkPolys instanceof HTMLInputElement) {
        chkPolys.checked = state.showRefPolygons;
      }

      const chkLines = state.root.querySelector('[data-clickui="ref-lines"]');
      if (chkLines && chkLines instanceof HTMLInputElement) {
        chkLines.checked = state.showRefLines;
      }
    }

    if (_debugEnabled()) {
      try {
        const flags = {
          showRef: state.showRef,
          showRefContours: state.showRefContours,
          showRefPolygons: state.showRefPolygons,
          showRefLines: state.showRefLines,
          showRefLabels: state.showRefLabels,
          badRefTargets: state.badRefTargets instanceof Set ? Array.from(state.badRefTargets) : null,
        };
        try {
          window.__CLICKUI_LAST_REF_FLAGS = flags;
        } catch (e) {
          // ignore
        }
        console.log("[ClickUI][applyCheckFeedback] ref flags", flags);
        try {
          console.log("[ClickUI][applyCheckFeedback] ref flags JSON\n" + JSON.stringify(flags, null, 2));
        } catch (e) {
          // ignore
        }

        _clientLog("ref_flags", flags);
      } catch (e) {
        // ignore
      }
    }

    _applyUserMarksVisibility();

    if (error === "labels_missing") {
      state.locked = false;
      state.highlightLabelErrors = true;
    } else {
      state.highlightLabelErrors = false;
    }
    _syncFoundTargetsUI();

    // Capture label correctness from evaluator (if provided) for green/red highlighting.
    state.labelEval = null;
    try {
      const labelsBlock = details.labels && typeof details.labels === "object" ? details.labels : null;
      const matched = labelsBlock && Array.isArray(labelsBlock.matched_labels) ? labelsBlock.matched_labels : [];
      const unmatched = labelsBlock && Array.isArray(labelsBlock.unmatched_labels) ? labelsBlock.unmatched_labels : [];
      if (matched.length || unmatched.length) {
        state.labelEval = {
          matched: new Set(matched.map((t) => (Array.isArray(t) ? t[0] : null)).filter((x) => typeof x === "number")),
          unmatched: new Set(
            unmatched.map((t) => (Array.isArray(t) ? t[0] : null)).filter((x) => typeof x === "number")
          ),
          success: labelsBlock.success === true,
        };
      }
    } catch (e) {
      // ignore
    }
    _renderLabelsInputs(null);

    const success = result.success === true;
    if (state.markerLayer) {
      if (success) {
        state.markerLayer.classList.add("opacity-100");
      } else {
        state.markerLayer.classList.add("opacity-100");
      }
    }

    _renderMarkers();
    _renderDrawing();
    // Re-assign palette so _renderReference uses fresh colors (important for Level 2).
    _assignTargetColors(state.taskDto);
    _renderReference();
    _renderReviewComparison(result);

    if (_debugEnabled()) {
      try {
        console.log("[ClickUI][applyCheckFeedback] after _renderReference", {
          refLayerChildren: state.refLayer && state.refLayer.childNodes ? state.refLayer.childNodes.length : null,
        });
      } catch (e) {
        // ignore
      }
    }
  };

  // Phase 2: Cleanup method to prevent memory leaks
  ClickUI.cleanup = function cleanup() {
    // Teardown additional modal if exists
    _teardownAdditionalModal();

    if (state._themeListener) {
      window.removeEventListener("themechanged", state._themeListener);
    }
    if (state.targetsAttentionTimer) {
      clearTimeout(state.targetsAttentionTimer);
    }

    // Reset state object to initial values
    Object.assign(state, {
      taskDto: null,
      container: null,
      canvas: null,
      ctx: null,
      image: null,
      clicks: [],
      labels: {},
      targets: [],
      foundClickTargets: new Set(),
      maxClicks: 0,
      locked: false,
      mode: "click",
      zoom: 1,
      panX: 0,
      panY: 0,
      isPointerDown: false,
      panStart: null,
      showRef: false,
      showRefContours: true,
      showRefPolygons: true,
      showRefLines: true,
      showRefLabels: true,
      showUserMarks: true,
      badRefTargets: null,
      polygons: [],
      lines: [],
      actionHistory: [],
      activeStroke: null,
      labelsPolygons: [],
      labelsLines: [],
      labelsClicks: [],
      labelsInputs: [],
      highlightLabelErrors: false,
      labelEval: null,
      soloDuringDraw: false,
      brushRadius: 8,
      maxPolygons: 0,
      maxStrokes: 0,
      targetColors: [],
      targetRows: [],
      targetsProgress: null,
      targetsInstructionEl: null,
      targetsPanelTitleEl: null,
      targetsListSectionEl: null,
      outlineVerbEls: [],
      targetsAttentionTimer: null,
      userActionsListEl: null,
      userActionRows: [],
      actionInterpretation: null,
      actionInterpretationActive: false,
      hoveredActionKey: null,
      pendingViewState: null,
      reviewHost: null,
      reviewComparisonEl: null,
      runtimeMode: false,
      additionalModal: null,
      additionalModalKeyHandler: null,
      _themeListener: null,
    });

    // Note: Window event listeners (pointermove, pointerup, pointercancel) are attached
    // in createRoot (lines 2869-2871) as anonymous functions, so we cannot remove them.
    // This is a known limitation. For a complete fix, we would need to store references.
    // However, these listeners check state.isPointerDown and state.locked, so they won't
    // do much work when not actively interacting. The memory leak is minimal.
    // Event listeners on DOM elements will be garbage collected when elements are removed.
  };

  global.ClickUI = ClickUI;
})(window);
