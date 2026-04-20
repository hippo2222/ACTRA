(function () {
  'use strict';

  const state = {
    overview: null,
    scope: 'topics',
    search: '',
    moduleId: 'all',
    stateFilter: 'all',
    loading: false,
    summaryCollapsed: false,
    selectionMode: false,
    selectedTheoryIds: new Set(),
    lastSelectedTheoryId: '',
    bulkDeleting: false,
    linkedEntryAutoOpened: false,
  };

  const SUMMARY_COLLAPSE_STORAGE_KEY = 'theory-center-summary-collapsed';
  const THEORY_CENTER_TEST_HOOKS_FLAG = '__THEORY_CENTER_ENABLE_TEST_HOOKS__';
  const THEORY_CENTER_AUTO_INIT_DISABLED_FLAG = '__THEORY_CENTER_AUTO_INIT_DISABLED__';
  const THEORY_DELETE_UNDO_WINDOW_MS = 5000;
  const pendingTheoryDeleteJobs = new Map();
  const pendingTheoryDeleteIds = new Set();
  const theoryPublicationBySourceId = new Map();
  const theoryPublicationByItemId = new Map();
  let allTheoryPublicationItems = [];
  let currentTheoryCenterUserId = '';
  let searchTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function theoryCenterConfirm(options) {
    const fallbackMessage = String(options?.message || 'Подтвердите действие.').trim();
    if (typeof window.NotificationUI !== 'undefined' && typeof window.NotificationUI.confirm === 'function') {
      return window.NotificationUI.confirm({
        title: String(options?.title || 'Подтвердите действие'),
        message: fallbackMessage,
        confirmText: String(options?.confirmText || 'Продолжить'),
        cancelText: String(options?.cancelText || 'Отмена'),
        variant: String(options?.variant || 'warning'),
      });
    }
    if (window.WorkspaceImportClient && typeof window.WorkspaceImportClient.confirmAction === 'function') {
      return window.WorkspaceImportClient.confirmAction({
        title: String(options?.title || 'Подтвердите действие'),
        message: fallbackMessage,
        confirmText: String(options?.confirmText || 'Продолжить'),
        cancelText: String(options?.cancelText || 'Отмена'),
        variant: String(options?.variant || 'warning'),
      });
    }
    return Promise.resolve(false);
  }

  function supportsTheorySelectionScope(scope = state.scope) {
    return scope === 'all' || scope === 'orphans' || scope === 'only_title';
  }

  function isTheoryCollectionScope(scope = state.scope) {
    return scope === 'all' || scope === 'orphans' || scope === 'only_title';
  }

  function getTheoryRowId(row) {
    return String(row?.id || row?.library_entry_id || '').trim();
  }

  function getTheoryUsageCount(row) {
    return Number(row?.usage_topics || 0) + Number(row?.usage_complexes || 0);
  }

  function isTheoryRowDeletable(row) {
    if (row?.is_linked_publication) return false;
    return Boolean(getTheoryRowId(row)) && getTheoryUsageCount(row) === 0;
  }

  function getLinkedTheoryRows() {
    return Array.isArray(state.overview?.linked_theories) ? state.overview.linked_theories : [];
  }

  function getWorkspaceTheoryRows() {
    return Array.isArray(state.overview?.theories) ? state.overview.theories : [];
  }

  function isTheoryPendingDeletion(theoryId) {
    return pendingTheoryDeleteIds.has(String(theoryId || '').trim());
  }

  function getScopeRows(scope = state.scope) {
    if (scope === 'complexes') {
      return Array.isArray(state.overview?.complexes) ? state.overview.complexes : [];
    }
    if (scope === 'only_title') {
      const theoryRows = getWorkspaceTheoryRows();
      return theoryRows.filter((row) => row?.has_content === false);
    }
    if (scope === 'all') {
      return getWorkspaceTheoryRows().concat(getLinkedTheoryRows());
    }
    if (scope === 'orphans') {
      return Array.isArray(state.overview?.orphans) ? state.overview.orphans : [];
    }
    return Array.isArray(state.overview?.topics) ? state.overview.topics : [];
  }

  function getVisibleTheoryDeleteRows(rows = null) {
    return (Array.isArray(rows) ? rows : getScopeRows())
      .filter((row) => !isTheoryPendingDeletion(getTheoryRowId(row)));
  }

  function clearTheorySelection(options = {}) {
    state.selectedTheoryIds.clear();
    state.lastSelectedTheoryId = '';
    if (options.exitMode) {
      state.selectionMode = false;
    }
  }

  function pruneSelectedTheoryIds(rows = null) {
    if (!supportsTheorySelectionScope()) {
      clearTheorySelection({ exitMode: true });
      return;
    }

    const visibleIds = new Set(
      (Array.isArray(rows) ? rows : getVisibleRows())
        .map((row) => getTheoryRowId(row))
        .filter(Boolean)
    );

    Array.from(state.selectedTheoryIds).forEach((theoryId) => {
      if (!visibleIds.has(theoryId)) {
        state.selectedTheoryIds.delete(theoryId);
      }
    });

    if (state.lastSelectedTheoryId && !visibleIds.has(state.lastSelectedTheoryId)) {
      state.lastSelectedTheoryId = '';
    }
  }

  function getVisibleSelectableTheoryIds(rows = null) {
    if (!supportsTheorySelectionScope()) return [];
    return (Array.isArray(rows) ? rows : getVisibleRows())
      .filter((row) => isTheoryRowDeletable(row))
      .map((row) => getTheoryRowId(row))
      .filter(Boolean);
  }

  function renderTheorySelectionToggle(row, options = {}) {
    if (!supportsTheorySelectionScope()) {
      return '';
    }

    const theoryId = getTheoryRowId(row);
    if (!theoryId) {
      return '';
    }

    const selectable = isTheoryRowDeletable(row);
    const selected = state.selectedTheoryIds.has(theoryId);
    const title = selectable
      ? (selected
        ? 'Снять выделение'
        : (state.selectionMode ? 'Выбрать теорию' : 'Начать массовые операции с этой теории'))
      : 'Теория связана с темами или комплексами и недоступна для массового удаления';
    const toneClasses = selectable
      ? (selected
        ? 'border-primary bg-primary text-primary-contrast'
        : `${getTheoryNeutralButtonClass()} hover:border-primary hover:text-primary`)
      : 'border-border-subtle bg-bg-secondary text-text-muted';
    const icon = selectable
      ? (selected ? 'check_box' : 'check_box_outline_blank')
      : 'block';
    const baseClasses = options.compact === false
      ? 'theory-card-select-anchor inline-flex h-11 min-w-[46px] items-center justify-center rounded-2xl border px-3'
      : 'inline-flex h-10 w-10 items-center justify-center rounded-2xl border';

    return `
      <button type="button"
        class="theory-mini-btn shrink-0 ${baseClasses} ${toneClasses}"
        data-action="toggle-theory-selection"
        data-theory-id="${escapeHtml(theoryId)}"
        aria-pressed="${selected ? 'true' : 'false'}"
        title="${escapeHtml(title)}"
        ${selectable ? '' : 'disabled'}>
        <span class="material-symbols-outlined text-[18px]">${escapeHtml(icon)}</span>
      </button>
    `;
  }

  function renderTheoryDeleteButton(row) {
    if (!isTheoryRowDeletable(row)) {
      return '';
    }

    return `
      <button type="button"
        class="theory-mini-btn rounded-2xl border border-error-light bg-error-lighter px-3 py-2 text-xs font-semibold text-error-text hover:border-error"
        data-action="delete-theory-record"
        data-theory-id="${escapeHtml(getTheoryRowId(row))}"
        title="Удалить теорию без привязки">
        Удалить
      </button>
    `;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function navigate(url) {
    if (typeof window.navigateWithTransition === 'function') {
      window.navigateWithTransition(url);
      return;
    }
    window.location.href = url;
  }

  async function readJsonSafely(response) {
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  function theoryViewerAssetSrc(assetId, assetUrl) {
    if (assetUrl) return assetUrl;
    if (assetId) return `/api/assets/${encodeURIComponent(String(assetId))}/content`;
    return '';
  }

  function normalizeTheoryViewerImageRef(raw) {
    let value = String(raw || '').trim();
    if (!value) return '';
    if (value.startsWith('/api/local-image?')) {
      try {
        const parsed = new URL(value, window.location.origin);
        const assetId = String(parsed.searchParams.get('asset_id') || '').trim();
        if (assetId) {
          return theoryViewerAssetSrc(assetId, '');
        }
        value = String(parsed.searchParams.get('path') || '').trim();
        if (!value) return '';
      } catch (error) {
        return '';
      }
    }
    if (/^(https?:|data:|blob:|\/api\/|\/assets\/)/i.test(value)) return value;
    return `/api/local-image?path=${encodeURIComponent(value)}`;
  }

  function renderLinkedTheoryDeltaHtml(delta) {
    const ops = Array.isArray(delta?.ops) ? delta.ops : [];
    let html = '';
    let paragraph = '';
    const flushParagraph = () => {
      const text = paragraph.trim();
      if (text) {
        html += `<p style="margin:0 0 1rem 0;line-height:1.7;color:var(--color-text-main);">${text}</p>`;
      }
      paragraph = '';
    };
    ops.forEach((op) => {
      const insert = op?.insert;
      const attrs = op?.attributes && typeof op.attributes === 'object' ? op.attributes : {};
      if (insert && typeof insert === 'object' && insert.image) {
        flushParagraph();
        const src = normalizeTheoryViewerImageRef(insert.image);
        if (src) {
          const align = ['left', 'center', 'right'].includes(String(attrs.align || '').trim()) ? String(attrs.align).trim() : 'left';
          const width = String(attrs.width || 'min(100%, 680px)').trim() || 'min(100%, 680px)';
          const wrapperAlign = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
          html += `<div style="display:flex;justify-content:${wrapperAlign};margin:0 0 1rem 0;"><img src="${escapeHtml(src)}" alt="" style="display:block;max-width:${escapeHtml(width)};width:${escapeHtml(width)};border-radius:18px;"></div>`;
        }
        return;
      }
      if (typeof insert !== 'string') return;
      const fragments = insert.split('\n');
      fragments.forEach((part, index) => {
        if (part) {
          let text = escapeHtml(part);
          if (attrs.bold) text = `<strong>${text}</strong>`;
          if (attrs.italic) text = `<em>${text}</em>`;
          if (attrs.underline) text = `<u>${text}</u>`;
          paragraph += text;
        }
        if (index < fragments.length - 1) {
          flushParagraph();
        }
      });
    });
    flushParagraph();
    return html || '<p style="margin:0;color:var(--color-text-secondary);">Контент теории пока недоступен.</p>';
  }

  function openTheoryCenterModal(markup, bind) {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[1300] bg-scrim backdrop-blur-sm flex items-center justify-center p-4';
    overlay.innerHTML = markup;
    const close = () => overlay.remove();
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelectorAll('[data-close]').forEach((button) => {
      button.addEventListener('click', close);
    });
    document.body.appendChild(overlay);
    if (typeof bind === 'function') bind(overlay, close);
    return close;
  }

  async function fetchTheoryCatalogRows() {
    const response = await fetch('/api/theories');
    const data = await readJsonSafely(response);
    if (!response.ok || !data?.ok || !Array.isArray(data.items)) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    return data.items;
  }

  async function resolveCurrentTheoryCenterUserId() {
    if (currentTheoryCenterUserId) return currentTheoryCenterUserId;
    try {
      const authResponse = await fetch('/api/auth/me');
      const authData = await readJsonSafely(authResponse);
      const userId = String(authData?.user?.user_id || '').trim();
      if (authResponse.ok && authData?.ok && authData?.authenticated && userId) {
        currentTheoryCenterUserId = userId;
        return currentTheoryCenterUserId;
      }
    } catch (error) {
      console.warn('[Theory Center] Failed to resolve current user through auth/me', error);
    }
    return '';
  }

  function getCatalogVisibilityLabel(value) {
    switch (String(value || '').trim().toLowerCase()) {
      case 'access_code':
        return 'По коду';
      case 'private':
        return 'Приватная';
      case 'public':
      default:
        return 'Общий доступ';
    }
  }

  function getCatalogVisibilityToneClass(value) {
    switch (String(value || '').trim().toLowerCase()) {
      case 'access_code':
        return getTheoryToneClass('info');
      case 'private':
        return getTheoryNeutralChipClass();
      case 'public':
      default:
        return getTheoryToneClass('success');
    }
  }

  function getTheoryCatalogVisibilityDescription(value) {
    switch (String(value || '').trim().toLowerCase()) {
      case 'access_code':
        return 'Теория не видна в общем каталоге. Добавить её можно только по коду доступа.';
      case 'private':
        return 'Теория доступна только вам. Другие пользователи не увидят её в каталоге и не смогут открыть по коду.';
      case 'public':
      default:
        return 'Теория видна в общем каталоге и доступна для добавления в библиотеку.';
    }
  }

  function getTheoryVisibilityLock(item) {
    const lock = item?.visibility_lock && typeof item.visibility_lock === 'object' ? item.visibility_lock : null;
    if (!lock) return null;
    return String(lock.forced_visibility || '').trim().toLowerCase() === 'public' ? lock : null;
  }

  function formatTheoryVisibilityLockMessage(lock) {
    const complexTitles = Array.isArray(lock?.complex_titles)
      ? lock.complex_titles.filter((value) => String(value || '').trim())
      : [];
    if (complexTitles.length === 1) {
      return `Теория привязана к публичному комплексу «${complexTitles[0]}», поэтому должна оставаться в общем доступе.`;
    }
    if (complexTitles.length > 1) {
      return `Теория привязана к нескольким публичным комплексам, поэтому должна оставаться в общем доступе.`;
    }
    return 'Теория привязана к опубликованному для всех комплексу, поэтому должна оставаться в общем доступе.';
  }

  function getTheoryPublicationErrorMessage(error, fallback = '') {
    const message = String(error?.message || error || '').trim();
    if (message.includes('theory_catalog_visibility_locked_by_public_complex')) {
      return 'Теория привязана к опубликованному для всех комплексу. Сначала измените публикацию комплекса.';
    }
    return message || fallback;
  }

  function formatPublicationTimestamp(value) {
    const raw = String(value || '').trim();
    if (!raw) return 'ещё не публиковалась';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getAccessCodeValue(item) {
    return String(item?.access_code || item?.payload?.access_code || '').trim();
  }

  function formatAccessCodeDisplay(value) {
    const code = String(value || '').trim().replace(/\s+/g, '').replace(/-/g, '').toUpperCase();
    if (!code) return '';
    return code.match(/.{1,4}/g)?.join('-') || code;
  }

  function rebuildTheoryPublicationIndex(items) {
    theoryPublicationBySourceId.clear();
    theoryPublicationByItemId.clear();
    const normalizedItems = Array.isArray(items) ? items : [];
    normalizedItems.forEach((item) => {
      const itemId = String(item?.item_id || '').trim();
      const sourceId = String(item?.source_workspace_id || item?.source_workspace_ref || '').trim();
      if (itemId) theoryPublicationByItemId.set(itemId, item);
      if (sourceId) theoryPublicationBySourceId.set(sourceId, item);
    });
    allTheoryPublicationItems = normalizedItems;
  }

  function resolveTheoryPublication(row) {
    const sourceItemId = String(
      row?.catalog_item_id
      || row?.item_id
      || row?.source_catalog_item_id
      || row?.sourceLineage?.catalog_item_id
      || row?.source_lineage?.catalog_item_id
      || ''
    ).trim();
    if (sourceItemId && theoryPublicationByItemId.has(sourceItemId)) {
      return theoryPublicationByItemId.get(sourceItemId) || null;
    }
    const theoryId = getTheoryRowId(row);
    if (!theoryId) return null;
    return theoryPublicationBySourceId.get(theoryId) || null;
  }

  async function fetchTheoryPublicationItems() {
    const userId = await resolveCurrentTheoryCenterUserId();
    if (!userId) {
      rebuildTheoryPublicationIndex([]);
      return [];
    }
    const params = new URLSearchParams({
      content_type: 'theory',
      owner_user_id: userId,
      include_owned_non_public: 'true',
    });
    const response = await fetch(`/api/catalog/items?${params.toString()}`);
    const data = await readJsonSafely(response);
    if (!response.ok || !data?.ok || !Array.isArray(data.items)) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    rebuildTheoryPublicationIndex(data.items);
    return data.items;
  }

  function normalizeTheoryLibraryEntryRow(entry) {
    const libraryEntry = entry?.library_entry && typeof entry.library_entry === 'object' ? entry.library_entry : {};
    const item = entry?.item && typeof entry.item === 'object' ? entry.item : {};
    const version = entry?.version && typeof entry.version === 'object' ? entry.version : {};
    return {
      id: String(libraryEntry.library_entry_id || '').trim(),
      library_entry_id: String(libraryEntry.library_entry_id || '').trim(),
      catalog_item_id: String(item.item_id || libraryEntry.catalog_item_id || '').trim(),
      title: String(item.title || 'Связанная теория').trim() || 'Связанная теория',
      owner_user_id: String(item.owner_user_id || '').trim(),
      owner_display_name: String(item.owner_display_name || item.owner_name || '').trim(),
      catalog_visibility: String(item.catalog_visibility || '').trim(),
      updated_at: String(version.published_at || item.latest_published_at || libraryEntry.updated_at || '').trim(),
      created_at: String(libraryEntry.created_at || '').trim(),
      access_state: String(libraryEntry.access_state || 'active').trim(),
      access_reason: String(libraryEntry.access_reason || '').trim(),
      resolved_version_id: String(libraryEntry.resolved_version_id || version.version_id || '').trim(),
      has_content: true,
      image_count: Number(version?.manifest?.image_count || item?.latest_manifest?.image_count || 0),
      is_linked_publication: true,
      can_open_linked: String(libraryEntry.access_state || '').trim() === 'active',
    };
  }

  function getTheoryAuthorMeta(row) {
    if (row?.is_linked_publication) {
      const ownerId = String(row?.owner_user_id || '').trim();
      const ownerName = String(row?.owner_display_name || '').trim();
      return {
        ownerId,
        ownerName,
        isOwnedByCurrentUser: !!currentTheoryCenterUserId && ownerId === currentTheoryCenterUserId,
      };
    }
    const ownership = resolveComplexOwnership(row);
    return {
      ownerId: String(ownership.createdByUserId || '').trim(),
      ownerName: String(ownership.createdByUserName || '').trim(),
      isOwnedByCurrentUser: ownership.isOwnedByCurrentUser === true,
    };
  }

  function getTheoryAuthorLabel(row) {
    const meta = getTheoryAuthorMeta(row);
    if (meta.ownerName) return meta.ownerName;
    if (meta.isOwnedByCurrentUser) return 'Вы';
    return meta.ownerId || 'Автор не указан';
  }

  function renderTheoryAuthorBadge(row) {
    const meta = getTheoryAuthorMeta(row);
    const toneClass = meta.isOwnedByCurrentUser ? getTheoryToneClass('success') : getTheoryNeutralChipClass();
    return `
      <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${toneClass}">
        <span class="material-symbols-outlined text-[14px]">person</span>
        ${escapeHtml(getTheoryAuthorLabel(row))}
      </span>
    `;
  }

  function renderTheoryOriginBadge(row) {
    let icon = 'edit_note';
    let label = 'Родная';
    let toneClass = getTheoryToneClass('primary');
    if (row?.is_linked_publication) {
      icon = 'public';
      label = 'Из каталога';
      toneClass = getTheoryToneClass('info');
    } else {
      const sourceItemId = String(
        row?.source_catalog_item_id
        || row?.sourceLineage?.catalog_item_id
        || row?.source_lineage?.catalog_item_id
        || ''
      ).trim();
      if (sourceItemId) {
        icon = 'download_done';
        label = 'Добавлена из каталога';
        toneClass = getTheoryNeutralChipClass();
      }
    }
    return `
      <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${toneClass}">
        <span class="material-symbols-outlined text-[14px]">${escapeHtml(icon)}</span>
        ${escapeHtml(label)}
      </span>
    `;
  }

  function renderTheoryCatalogStatusBadge(row) {
    const publication = resolveTheoryPublication(row);
    const visibility = String(
      publication?.catalog_visibility
      || row?.catalog_visibility
      || ''
    ).trim().toLowerCase();
    const hasPublication = !!visibility;
    const label = hasPublication ? getCatalogVisibilityLabel(visibility) : 'Не опубликована';
    const toneClass = hasPublication ? getCatalogVisibilityToneClass(visibility) : getTheoryNeutralChipClass();
    const title = hasPublication
      ? getTheoryCatalogVisibilityDescription(visibility)
      : 'Теория пока не опубликована в каталоге.';
    return `
      <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold ${toneClass}" title="${escapeHtml(title)}">
        <span class="material-symbols-outlined text-[14px]">public</span>
        ${escapeHtml(label)}
      </span>
    `;
  }

  function getTheoryLinkedComplexRows(row) {
    if (row?.is_linked_publication) return [];
    const theoryId = getTheoryRowId(row);
    if (!theoryId) return [];
    const complexes = Array.isArray(state.overview?.complexes) ? state.overview.complexes : [];
    return complexes.filter((complexRow) => {
      const theoryIds = Array.isArray(complexRow?.theory_ids) ? complexRow.theory_ids : [];
      return theoryIds.some((value) => String(value || '').trim() === theoryId);
    });
  }

  function getTheoryLinkedComplexNames(row) {
    return Array.from(new Set(
      getTheoryLinkedComplexRows(row)
        .map((complexRow) => String(complexRow?.complex_name || complexRow?.complex_id || '').trim())
        .filter(Boolean)
    ));
  }

  function renderTheoryLinkedComplexBadge(row) {
    const names = getTheoryLinkedComplexNames(row);
    if (!names.length) return '';
    const preview = names.slice(0, 2).join(', ');
    const suffix = names.length > 2 ? ` +${names.length - 2}` : '';
    const label = `${names.length === 1 ? 'Комплекс' : 'Комплексы'}: ${preview}${suffix}`;
    const title = names.length === 1
      ? `Теория привязана к комплексу «${names[0]}» из раздела «Свои комплексы».`
      : `Теория привязана к комплексам из раздела «Свои комплексы»: ${names.join(', ')}.`;
    return `
      <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${getTheoryNeutralChipClass()}" title="${escapeHtml(title)}">
        <span class="material-symbols-outlined text-[14px]">hub</span>
        ${escapeHtml(label)}
      </span>
    `;
  }

  function canOpenTheoryInEditor(row) {
    if (row?.is_linked_publication) return false;
    return getTheoryAuthorMeta(row).isOwnedByCurrentUser === true;
  }

  function getTheoryOpenMeta(row) {
    if (canOpenTheoryInEditor(row)) {
      return {
        label: 'Открыть',
        title: 'Открыть теорию в редакторе',
        opensEditor: true,
      };
    }
    return {
      label: 'Открыть',
      title: `Открыть теорию в режиме просмотра. Редактирование доступно только автору ${getTheoryAuthorLabel(row)}.`,
      opensEditor: false,
    };
  }

  function findTheoryRowById(theoryId) {
    const normalizedId = String(theoryId || '').trim();
    if (!normalizedId) return null;
    return getWorkspaceTheoryRows().find((row) => getTheoryRowId(row) === normalizedId) || null;
  }

  async function fetchTheoryLibraryEntries() {
    const response = await fetch('/api/theory-library');
    const data = await readJsonSafely(response);
    if (!response.ok || !data?.ok || !Array.isArray(data.entries)) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    return data.entries.map(normalizeTheoryLibraryEntryRow);
  }

  async function copyTheoryAccessCode(value) {
    const code = String(value || '').trim().replace(/\s+/g, '').replace(/-/g, '').toUpperCase();
    if (!code) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(code);
        if (typeof window.NotificationUI !== 'undefined' && typeof window.NotificationUI.toast === 'function') {
          window.NotificationUI.toast('Код доступа скопирован.', 'success', 2500);
          return;
        }
      }
    } catch (error) {
      console.warn('[Theory Center] Failed to copy access code', error);
    }
    setFlash(`Код доступа: ${code}`, 'info');
  }

  function mergeTheoryCatalogIntoOverview(overview, theoryRows) {
    const nextOverview = overview && typeof overview === 'object' ? { ...overview } : {};
    if (!Array.isArray(theoryRows)) {
      return nextOverview;
    }

    nextOverview.theories = theoryRows;
    nextOverview.orphans = theoryRows.filter((row) => Boolean(row?.is_orphan));
    nextOverview.summary = {
      ...(nextOverview.summary || {}),
      theories_total: theoryRows.length,
      orphan_theories: nextOverview.orphans.length,
    };
    return nextOverview;
  }

  async function openLinkedTheoryViewer(libraryEntryId) {
    const normalizedId = String(libraryEntryId || '').trim();
    if (!normalizedId) return;
    const response = await fetch(`/api/theory-library/${encodeURIComponent(normalizedId)}`);
    const data = await readJsonSafely(response);
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    const entry = data.library_entry && typeof data.library_entry === 'object' ? data.library_entry : {};
    const snapshot = data.snapshot && typeof data.snapshot === 'object' ? data.snapshot : {};
    const deltaHtml = renderLinkedTheoryDeltaHtml(snapshot.delta);
    openTheoryCenterModal(`
      <div class="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[30px] border border-border-subtle bg-surface-1 shadow-xl">
        <div class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div>
            <p class="text-lg font-bold text-text-main">${escapeHtml(snapshot.title || data?.item?.title || 'Теория')}</p>
            <p class="mt-2 text-sm text-text-secondary">${escapeHtml(entry.access_reason || 'Связанная публикация из каталога.')}</p>
          </div>
          <button type="button" class="btn-secondary h-10 px-4" data-close>Закрыть</button>
        </div>
        <div class="custom-scrollbar overflow-y-auto p-5">
          <div style="max-width:820px;margin:0 auto;">${deltaHtml}</div>
        </div>
      </div>
    `);
  }

  function openWorkspaceTheoryViewer(item, row = null) {
    const itemData = item && typeof item === 'object' ? item : {};
    const rowData = row && typeof row === 'object' ? row : itemData;
    const linkedComplexNames = getTheoryLinkedComplexNames(rowData);
    const deltaHtml = renderLinkedTheoryDeltaHtml(itemData.delta);
    openTheoryCenterModal(`
      <div class="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[30px] border border-border-subtle bg-surface-1 shadow-xl">
        <div class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div class="min-w-0 space-y-3">
            <div>
              <p class="text-lg font-bold text-text-main">${escapeHtml(itemData.title || rowData.title || itemData.id || 'Теория')}</p>
              <p class="mt-2 text-sm text-text-secondary">Просмотр без редактирования. Оригинал доступен для изменения только автору.</p>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              ${renderTheoryAuthorBadge(rowData)}
              ${renderTheoryOriginBadge(rowData)}
              ${renderTheoryCatalogStatusBadge(rowData)}
              ${renderTheoryLinkedComplexBadge(rowData)}
              <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${getTheoryNeutralChipClass({ muted: true })}">
                <span class="material-symbols-outlined text-[14px]">event</span>
                ${escapeHtml(formatDateLabel(itemData.updated_at || itemData.version || rowData.updated_at || rowData.version))}
              </span>
            </div>
          </div>
          <button type="button" class="btn-secondary h-10 px-4 shrink-0" data-close>Закрыть</button>
        </div>
        <div class="custom-scrollbar overflow-y-auto p-5 space-y-4">
          ${linkedComplexNames.length ? `
            <div class="rounded-[22px] border border-border-subtle bg-bg-secondary px-4 py-3">
              <p class="text-xs font-bold uppercase tracking-[0.14em] text-text-secondary">Связанные комплексы</p>
              <p class="mt-2 text-sm text-text-main">${escapeHtml(linkedComplexNames.join(', '))}</p>
            </div>
          ` : ''}
          <div style="max-width:820px;margin:0 auto;">${deltaHtml}</div>
        </div>
      </div>
    `);
  }

  async function openWorkspaceTheoryViewerById(theoryId, row = null) {
    const normalizedTheoryId = String(theoryId || '').trim();
    if (!normalizedTheoryId) return;
    const response = await fetch(`/api/theories/${encodeURIComponent(normalizedTheoryId)}`);
    const data = await readJsonSafely(response);
    if (!response.ok || !data?.ok || !data?.item) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    openWorkspaceTheoryViewer(data.item, row);
  }

  async function openLinkedAccessCodeDialog(libraryEntryId) {
    const normalizedId = String(libraryEntryId || '').trim();
    if (!normalizedId) return;
    openTheoryCenterModal(`
      <div class="w-full max-w-lg overflow-hidden rounded-[28px] border border-border-subtle bg-surface-1 shadow-xl">
        <div class="border-b border-border-subtle px-5 py-4">
          <p class="text-lg font-bold text-text-main">Код доступа</p>
          <p class="mt-2 text-sm text-text-secondary">Введите код автора, чтобы открыть связанную теорию.</p>
        </div>
        <div class="space-y-4 p-5">
          <input id="theory-linked-access-code" type="text" class="w-full rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-3 text-base text-text-main outline-none focus:border-primary" placeholder="Например, AB12CD34" />
          <div id="theory-linked-access-feedback" class="hidden rounded-2xl border border-error-light bg-error-lighter px-4 py-3 text-sm text-error-text"></div>
        </div>
        <div class="flex justify-end gap-3 border-t border-border-subtle px-5 py-4">
          <button type="button" class="btn-secondary h-10 px-4" data-close>Отмена</button>
          <button type="button" class="btn-primary h-10 px-4" data-role="submit-access-code">Открыть</button>
        </div>
      </div>
    `, (overlay, close) => {
      const input = overlay.querySelector('#theory-linked-access-code');
      const feedback = overlay.querySelector('#theory-linked-access-feedback');
      overlay.querySelector('[data-role="submit-access-code"]')?.addEventListener('click', async () => {
        const accessCode = String(input?.value || '').trim();
        if (!accessCode) return;
        try {
          const response = await fetch(`/api/theory-library/${encodeURIComponent(normalizedId)}/access-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ access_code: accessCode }),
          });
          const data = await readJsonSafely(response);
          if (!response.ok || !data?.ok) {
            throw new Error(data?.error || `HTTP ${response.status}`);
          }
          close();
          await loadOverview({ silent: true });
          await openLinkedTheoryViewer(normalizedId);
        } catch (error) {
          if (feedback) {
            feedback.textContent = `Не удалось подтвердить доступ: ${String(error?.message || 'catalog_access_code_required')}`;
            feedback.classList.remove('hidden');
          }
        }
      });
      input?.focus();
    });
  }

  async function deleteTheoryById(theoryId) {
    const normalizedTheoryId = String(theoryId || '').trim();
    if (!normalizedTheoryId) {
      return {
        ok: false,
        theory_id: '',
        error: 'theory_id_required',
        message: 'Theory id is required',
      };
    }

    const response = await fetch(`/api/theories/${encodeURIComponent(normalizedTheoryId)}`, {
      method: 'DELETE',
    });
    const data = await readJsonSafely(response);
    if (response.ok && data?.ok && data.item) {
      return {
        ok: true,
        item: data.item,
      };
    }

    return {
        ok: false,
        theory_id: normalizedTheoryId,
        error: String(data?.error || 'theory_delete_failed'),
        message: String(data?.message || data?.details?.message || `HTTP ${response.status}`),
        usage_topics: Number(data?.usage_topics || 0),
        usage_complexes: Number(data?.usage_complexes || 0),
    };
  }

  async function deleteLinkedTheoryByLibraryEntryId(libraryEntryId) {
    const normalizedLibraryEntryId = String(libraryEntryId || '').trim();
    if (!normalizedLibraryEntryId) {
      return {
        ok: false,
        library_entry_id: '',
        error: 'library_entry_id_required',
        message: 'Library entry id is required',
      };
    }

    const response = await fetch(`/api/theory-library/${encodeURIComponent(normalizedLibraryEntryId)}`, {
      method: 'DELETE',
    });
    const data = await readJsonSafely(response);
    if (response.ok && data?.ok) {
      return {
        ok: true,
        library_entry_id: normalizedLibraryEntryId,
      };
    }

    return {
      ok: false,
      library_entry_id: normalizedLibraryEntryId,
      error: String(data?.error || 'theory_library_delete_failed'),
      message: String(data?.message || data?.details?.message || `HTTP ${response.status}`),
    };
  }

  async function deleteTheoryBatch(theoryIds) {
    const normalizedIds = Array.from(new Set(
      (Array.isArray(theoryIds) ? theoryIds : [])
        .map((theoryId) => String(theoryId || '').trim())
        .filter(Boolean)
    ));

    const deletedItems = [];
    const errors = [];
    for (const theoryId of normalizedIds) {
      try {
        const result = await deleteTheoryById(theoryId);
        if (result?.ok && result.item) {
          deletedItems.push(result.item);
        } else if (result) {
          errors.push(result);
        }
      } catch (error) {
        errors.push({
          ok: false,
          theory_id: theoryId,
          error: 'theory_delete_failed',
          message: error instanceof Error ? error.message : 'Failed to delete theory',
        });
      }
    }

    return {
      requested: normalizedIds.length,
      deleted: deletedItems.length,
      deletedItems,
      errors,
      partial: Boolean(errors.length),
    };
  }

  function dismissTheoryDeleteToast(job) {
    if (job?.toastHandle && typeof job.toastHandle.dismiss === 'function') {
      job.toastHandle.dismiss();
    }
  }

  function showTheoryDeleteUndoToast(jobKey, theoryIds) {
    const count = Array.isArray(theoryIds) ? theoryIds.length : 0;
    const message = count === 1
      ? 'Теория будет удалена.'
      : `Будут удалены теории: ${count}.`;
    if (typeof window.NotificationUI !== 'undefined' && typeof window.NotificationUI.toast === 'function') {
      return window.NotificationUI.toast(message, 'warning', THEORY_DELETE_UNDO_WINDOW_MS, {
        actionLabel: 'Отменить',
        onAction: () => undoPendingTheoryDeletion(jobKey),
        closeable: false,
        showTimer: true,
        timerFormatter: (secondsLeft) => `Удаление через - ${secondsLeft}`,
      });
    }
    setFlash(message, 'warning');
    return null;
  }

  function scheduleTheoryDeletion(theoryIds, options = {}) {
    const normalizedIds = Array.from(new Set(
      (Array.isArray(theoryIds) ? theoryIds : [])
        .map((theoryId) => String(theoryId || '').trim())
        .filter(Boolean)
    )).filter((theoryId) => !isTheoryPendingDeletion(theoryId));

    if (!normalizedIds.length) {
      return;
    }

    if (options.exitSelectionMode) {
      clearTheorySelection({ exitMode: true });
    } else {
      normalizedIds.forEach((theoryId) => state.selectedTheoryIds.delete(theoryId));
      if (state.lastSelectedTheoryId && normalizedIds.includes(state.lastSelectedTheoryId)) {
        state.lastSelectedTheoryId = '';
      }
    }

    normalizedIds.forEach((theoryId) => pendingTheoryDeleteIds.add(theoryId));
    const jobKey = `theory-delete:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const toastHandle = showTheoryDeleteUndoToast(jobKey, normalizedIds);
    const timer = window.setTimeout(() => {
      commitPendingTheoryDeletion(jobKey);
    }, THEORY_DELETE_UNDO_WINDOW_MS);

    pendingTheoryDeleteJobs.set(jobKey, {
      theoryIds: normalizedIds,
      timer,
      toastHandle,
    });

    renderView();
  }

  function undoPendingTheoryDeletion(jobKey) {
    const job = pendingTheoryDeleteJobs.get(jobKey);
    if (!job) {
      return;
    }

    window.clearTimeout(job.timer);
    pendingTheoryDeleteJobs.delete(jobKey);
    dismissTheoryDeleteToast(job);
    job.theoryIds.forEach((theoryId) => pendingTheoryDeleteIds.delete(theoryId));
    renderView();
    setFlash(job.theoryIds.length === 1 ? 'Удаление теории отменено.' : 'Удаление выбранных теорий отменено.', 'info');
  }

  async function commitPendingTheoryDeletion(jobKey) {
    const job = pendingTheoryDeleteJobs.get(jobKey);
    if (!job) {
      return;
    }

    pendingTheoryDeleteJobs.delete(jobKey);
    dismissTheoryDeleteToast(job);
    state.bulkDeleting = true;
    renderView();

    try {
      const result = await deleteTheoryBatch(job.theoryIds);
      job.theoryIds.forEach((theoryId) => pendingTheoryDeleteIds.delete(theoryId));

      const deletedCount = Number(result.deleted || 0);
      const errors = Array.isArray(result.errors) ? result.errors : [];
      await loadOverview({ silent: true });

      if (deletedCount > 0 && !errors.length) {
        setFlash(deletedCount === 1 ? 'Теория удалена.' : `Удалено теорий: ${deletedCount}.`, 'success');
        return;
      }

      if (deletedCount > 0) {
        const linkedCount = errors.filter((item) => String(item?.error || '') === 'theory_in_use').length;
        const otherCount = errors.length - linkedCount;
        let message = `Удалено теорий: ${deletedCount}.`;
        if (linkedCount > 0) {
          message += ` ${linkedCount} не удалены: у них есть привязки.`;
        }
        if (otherCount > 0) {
          message += ` ${otherCount} не удалось обработать.`;
        }
        setFlash(message, 'warning');
        return;
      }

      setFlash('Удаление не выполнено: выбранные теории уже связаны с темами или комплексами.', 'warning');
    } catch (error) {
      console.error('[Theory Center] Failed to delete selected theories', error);
      job.theoryIds.forEach((theoryId) => pendingTheoryDeleteIds.delete(theoryId));
      await loadOverview({ silent: true });
      setFlash('Не удалось удалить теории.', 'error');
    } finally {
      state.bulkDeleting = false;
      renderView();
    }
  }

  function readQueryState() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const scope = String(params.get('scope') || '').trim();
      const search = String(params.get('q') || '').trim();
      const moduleId = String(params.get('module_id') || '').trim();
      const stateFilter = String(params.get('state') || '').trim();
      if (scope === 'all' || scope === 'topics' || scope === 'complexes' || scope === 'orphans' || scope === 'only_title') {
        state.scope = scope;
      }
      if (search) state.search = search;
      if (moduleId) state.moduleId = moduleId;
      if (stateFilter) state.stateFilter = stateFilter;
    } catch (error) {
      console.warn('[Theory Center] Failed to parse query state', error);
    }
  }

  function writeQueryState() {
    try {
      const params = new URLSearchParams();
      params.set('scope', state.scope);
      if (state.search) params.set('q', state.search);
      if (state.moduleId && state.moduleId !== 'all') params.set('module_id', state.moduleId);
      if (state.stateFilter && state.stateFilter !== 'all') params.set('state', state.stateFilter);
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
      window.history.replaceState({}, '', next);
    } catch (error) {
      console.warn('[Theory Center] Failed to write query state', error);
    }
  }

  function readUiState() {
    try {
      state.summaryCollapsed = window.localStorage.getItem(SUMMARY_COLLAPSE_STORAGE_KEY) === '1';
    } catch (error) {
      state.summaryCollapsed = false;
    }
  }

  function writeUiState() {
    try {
      window.localStorage.setItem(SUMMARY_COLLAPSE_STORAGE_KEY, state.summaryCollapsed ? '1' : '0');
    } catch (error) {
      // Ignore storage errors and keep UI working in-memory.
    }
  }

  function applySummaryCollapsedState() {
    const wrap = $('theory-center-summary-wrap');
    const toggle = $('theory-center-summary-toggle');
    const icon = $('theory-center-summary-toggle-icon');
    const label = $('theory-center-summary-toggle-label');
    if (wrap) {
      wrap.dataset.collapsed = state.summaryCollapsed ? '1' : '0';
      wrap.classList.toggle('hidden', state.summaryCollapsed);
    }
    if (toggle) {
      toggle.setAttribute('aria-expanded', state.summaryCollapsed ? 'false' : 'true');
    }
    if (icon) {
      icon.textContent = state.summaryCollapsed ? 'expand_more' : 'expand_less';
    }
    if (label) {
      label.textContent = state.summaryCollapsed ? 'Развернуть' : 'Свернуть';
    }
  }

  function toggleSummaryCollapsed() {
    state.summaryCollapsed = !state.summaryCollapsed;
    writeUiState();
    applySummaryCollapsedState();
  }

  function currentReturnUrl() {
    return `${window.location.pathname}${window.location.search || ''}`;
  }

  function buildTheoryEditorUrl(theoryId, options = {}) {
    const url = new URL('/ui/editor/Theory_Editor.html', window.location.origin);
    const normalizedTheoryId = String(theoryId || '').trim();
    if (normalizedTheoryId) {
      url.searchParams.set('theory_id', normalizedTheoryId);
    }
    const mapping = {
      context: 'context',
      moduleId: 'module_id',
      topicId: 'topic_id',
      moduleName: 'module_name',
      topicName: 'topic_name',
      complexId: 'complex_id',
      complexName: 'complex_name',
      returnUrl: 'return_url',
    };
    Object.entries(mapping).forEach(([sourceKey, targetKey]) => {
      const value = String(options[sourceKey] || '').trim();
      if (!value) return;
      url.searchParams.set(targetKey, value);
    });
    return `${url.pathname}${url.search}`;
  }

  function formatDateLabel(value) {
    if (!value) return '—';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return value;
      }
      return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch (error) {
      return value;
    }
  }

  function setFlash(message, tone, options = {}) {
    const host = $('theory-center-flash');
    if (!host) return;
    const normalizedTone = String(tone || 'info').trim().toLowerCase();
    host.className = 'mt-4 rounded-2xl border px-4 py-3 text-sm';
    host.classList.remove('hidden');
    if (normalizedTone === 'success') {
      host.classList.add('border-success-light', 'bg-success-lighter', 'text-success-darker');
    } else if (normalizedTone === 'warning') {
      host.classList.add('border-warning-light', 'bg-warning-lighter', 'text-warning-darker');
    } else if (normalizedTone === 'error') {
      host.classList.add('border-error-light', 'bg-error-lighter', 'text-error-text');
    } else {
      host.classList.add('border-info-light', 'bg-info-lighter', 'text-info-text');
    }
    host.textContent = message;
    if (options.scroll === true && typeof host.scrollIntoView === 'function') {
      host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function clearFlash() {
    const host = $('theory-center-flash');
    if (!host) return;
    host.classList.add('hidden');
    host.textContent = '';
  }

  function renderLoadingState(message) {
    const host = $('theory-center-list');
    if (!host) return;
    host.innerHTML = `
      <div class="panel-row panel-row--soft justify-center px-5 py-10 text-center text-sm text-text-secondary">
        ${escapeHtml(message || 'Загружаем обзор теории...')}
      </div>
    `;
  }

  function getTheoryToneClass(tone, variant = 'chip') {
    const normalizedTone = String(tone || 'info').trim().toLowerCase();
    const toneClass = `theory-tone--${normalizedTone}`;
    if (variant === 'surface') {
      return `theory-tone-surface ${toneClass}`;
    }
    if (variant === 'button') {
      return `theory-mini-btn--tone ${toneClass}`;
    }
    return `theory-tone-chip ${toneClass}`;
  }

  function getTheoryNeutralChipClass(options = {}) {
    return options.muted
      ? 'theory-neutral-chip theory-neutral-chip--muted'
      : 'theory-neutral-chip';
  }

  function getTheoryNeutralButtonClass() {
    return 'theory-mini-btn--neutral';
  }

  function renderSummaryCards() {
    const host = $('theory-center-summary');
    if (!host) return;
    const summary = state.overview?.summary || {};
    const modules = Array.isArray(state.overview?.filters?.modules) ? state.overview.filters.modules : [];
    const selectedModuleName = state.moduleId && state.moduleId !== 'all'
      ? ((modules.find((row) => String(row.id) === state.moduleId) || {}).name || state.moduleId)
      : '';
    const cards = [
      {
        key: 'topics_without_theory',
        label: 'Тем без теории',
        value: Number(summary.topics_without_theory || 0),
        icon: 'topic',
        tone: 'warning',
        scope: 'topics',
        filter: 'missing',
      },
      {
        key: 'complexes_single_theory',
        label: 'Комплексов с одной теорией',
        value: Number(summary.complexes_single_theory || 0),
        icon: 'menu_book',
        tone: 'success',
        scope: 'complexes',
        filter: 'single',
      },
      {
        key: 'complexes_composite_theory',
        label: 'Комплексов с подборкой теорий',
        value: Number(summary.complexes_composite_theory || 0),
        icon: 'layers',
        tone: 'info',
        scope: 'complexes',
        filter: 'composite',
      },
      {
        key: 'complexes_override_theory',
        label: 'Комплексов со своей теорией',
        value: Number(summary.complexes_override_theory || 0),
        icon: 'edit_note',
        tone: 'primary',
        scope: 'complexes',
        filter: 'own',
      },
      {
        key: 'complexes_without_theory',
        label: 'Комплексов без теории',
        value: Number(summary.complexes_without_theory || 0),
        icon: 'warning',
        tone: 'warning',
        scope: 'complexes',
        filter: 'none',
      },
      {
        key: 'orphan_theories',
        label: 'Без привязки',
        value: Number(summary.orphan_theories || 0),
        icon: 'link_off',
        tone: 'warning',
        scope: 'orphans',
        filter: 'all',
      },
    ];

    host.innerHTML = cards.map((card) => {
      return `
        <button type="button"
          class="theory-summary-card theory-center-panel ${getTheoryToneClass(card.tone, 'surface')} flex min-h-[122px] flex-col items-start gap-3 rounded-[24px] p-4 text-left"
          data-summary-scope="${escapeHtml(card.scope)}"
          data-summary-filter="${escapeHtml(card.filter)}">
          <span class="theory-tone-accent inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em]">
            <span class="material-symbols-outlined text-[18px]">${escapeHtml(card.icon)}</span>
            ${escapeHtml(card.label)}
          </span>
          <strong class="text-3xl font-bold tracking-[-0.03em]">${escapeHtml(card.value)}</strong>
          ${selectedModuleName ? `<span class="text-xs opacity-75">в модуле «${escapeHtml(selectedModuleName)}»</span>` : ''}
        </button>
      `;
    }).join('');

    host.querySelectorAll('[data-summary-scope]').forEach((button) => {
      button.addEventListener('click', () => {
        state.scope = String(button.getAttribute('data-summary-scope') || 'topics');
        state.stateFilter = String(button.getAttribute('data-summary-filter') || 'all');
        syncControlsFromState();
        writeQueryState();
        renderView();
      });
    });
  }

  function getActiveStateOptions() {
    const filters = state.overview?.filters || {};
    return state.scope === 'complexes'
      ? (Array.isArray(filters.complex_states) ? filters.complex_states : [])
      : state.scope === 'topics'
        ? (Array.isArray(filters.topic_states) ? filters.topic_states : [])
        : [{ id: 'all', label: 'Все' }];
  }

  function populateFilters() {
    const moduleSelect = $('theory-center-module-filter');
    const stateSelect = $('theory-center-state-filter');
    if (moduleSelect) {
      const currentValue = state.moduleId || 'all';
      const modules = Array.isArray(state.overview?.filters?.modules) ? state.overview.filters.modules : [];
      moduleSelect.innerHTML = '<option value="all">Все модули</option>' + modules.map((row) => `
        <option value="${escapeHtml(row.id)}">${escapeHtml(row.name || row.id)}</option>
      `).join('');
      moduleSelect.value = modules.some((row) => String(row.id) === currentValue) ? currentValue : 'all';
      state.moduleId = moduleSelect.value || 'all';
      moduleSelect.disabled = isTheoryCollectionScope();
    }

    if (stateSelect) {
      const options = getActiveStateOptions();
      stateSelect.innerHTML = options.map((row) => `
        <option value="${escapeHtml(row.id)}">${escapeHtml(row.label)}</option>
      `).join('');
      const currentValue = state.stateFilter || 'all';
      stateSelect.value = options.some((row) => String(row.id) === currentValue) ? currentValue : 'all';
      state.stateFilter = stateSelect.value || 'all';
      stateSelect.disabled = isTheoryCollectionScope();
    }
  }

  function syncControlsFromState() {
    const searchInput = $('theory-center-search');
    if (searchInput && searchInput.value !== state.search) {
      searchInput.value = state.search;
    }

    const allBtn = $('theory-center-scope-all');
    const topicsBtn = $('theory-center-scope-topics');
    const complexesBtn = $('theory-center-scope-complexes');
    const orphansBtn = $('theory-center-scope-orphans');
    const onlyTitleBtn = $('theory-center-scope-only-title');
    if (allBtn) allBtn.setAttribute('data-active', state.scope === 'all' ? '1' : '0');
    if (topicsBtn) topicsBtn.setAttribute('data-active', state.scope === 'topics' ? '1' : '0');
    if (complexesBtn) complexesBtn.setAttribute('data-active', state.scope === 'complexes' ? '1' : '0');
    if (orphansBtn) orphansBtn.setAttribute('data-active', state.scope === 'orphans' ? '1' : '0');
    if (onlyTitleBtn) onlyTitleBtn.setAttribute('data-active', state.scope === 'only_title' ? '1' : '0');

    populateFilters();
  }

  function buildSearchHaystack(row) {
    if (state.scope === 'all') {
      return [
        row.title,
        row.id,
      ].filter(Boolean).join(' ').toLowerCase();
    }
    if (state.scope === 'topics') {
      return [
        row.topic_name,
        row.module_name,
        row.theory_title,
        row.theory_id,
      ].filter(Boolean).join(' ').toLowerCase();
    }
    if (state.scope === 'complexes') {
      return [
        row.complex_name,
        ...(Array.isArray(row.module_names) ? row.module_names : []),
        ...(Array.isArray(row.theory_titles) ? row.theory_titles : []),
        ...(Array.isArray(row.theory_ids) ? row.theory_ids : []),
      ].filter(Boolean).join(' ').toLowerCase();
    }
    return [
      row.title,
      row.id,
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function getVisibleRows() {
    const rows = getVisibleTheoryDeleteRows(getScopeRows());

    const query = String(state.search || '').trim().toLowerCase();
    return rows.filter((row) => {
      if ((state.scope === 'topics' || state.scope === 'complexes') && state.moduleId && state.moduleId !== 'all') {
        if (state.scope === 'topics') {
          if (String(row.module_id || '') !== state.moduleId) return false;
        } else {
          const moduleIds = Array.isArray(row.module_ids) ? row.module_ids : [];
          if (!moduleIds.includes(state.moduleId)) return false;
        }
      }

      if ((state.scope === 'topics' || state.scope === 'complexes') && state.stateFilter && state.stateFilter !== 'all') {
        const rowState = String(row.theory_state || '').trim();
        if (rowState !== state.stateFilter) return false;
      }

      if (query) {
        if (!buildSearchHaystack(row).includes(query)) return false;
      }

      return true;
    });
  }

  function renderBadges(row, options = {}) {
    const shouldWrap = options.wrap !== false;
    if (state.scope === 'topics') {
      const badgeClass = row.theory_state === 'missing'
        ? getTheoryToneClass('warning')
        : getTheoryToneClass('success');
      const linkedLabel = Number(row.linked_complexes_count || 0) > 0
        ? `${row.linked_complexes_count} комплексов`
        : 'Пока без комплексов';
      const extraBadges = [];
      if (row.theory_has_content === false) {
        extraBadges.push(`
          <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${getTheoryNeutralChipClass()}">
            <span class="material-symbols-outlined text-[14px]">text_ad</span>
            Только заголовок
          </span>
        `);
      }
      if (row.theory_state !== 'missing' && Number(row.theory_image_count || 0) === 0 && row.theory_has_content !== false) {
        extraBadges.push(`
          <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${getTheoryNeutralChipClass()}">
            <span class="material-symbols-outlined text-[14px]">image_not_supported</span>
            Без изображений
          </span>
        `);
      }
        const content = `
          <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}">
            <span class="material-symbols-outlined text-[14px]">${row.theory_state === 'missing' ? 'warning' : 'menu_book'}</span>
            ${escapeHtml(row.theory_state_label)}
          </span>
          <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getTheoryNeutralChipClass()}">
            ${escapeHtml(linkedLabel)}
          </span>
          ${extraBadges.join('')}
        `;
        return shouldWrap
          ? `<div class="flex flex-wrap items-center gap-2">${content}</div>`
          : content;
      }

    const sourceTone = row.theory_source === 'own'
      ? getTheoryToneClass('primary')
      : getTheoryNeutralChipClass();
    const stateToneMap = {
      none: getTheoryToneClass('warning'),
      single: getTheoryToneClass('success'),
      composite: getTheoryToneClass('info'),
      own: getTheoryToneClass('primary'),
    };
    const extraBadges = [];
    if (row.has_empty_content) {
      extraBadges.push(`
        <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${getTheoryNeutralChipClass()}" title="В подборке есть теория только с заголовком">
          <span class="material-symbols-outlined text-[14px]">text_ad</span>
          Есть пустые теории
        </span>
      `);
    }
      const content = `
        <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${sourceTone}">
          <span class="material-symbols-outlined text-[14px]">${row.theory_source === 'own' ? 'edit_note' : 'account_tree'}</span>
          ${escapeHtml(row.theory_source_label)}
        </span>
        <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${stateToneMap[row.theory_state] || stateToneMap.none}">
          <span class="material-symbols-outlined text-[14px]">${row.theory_state === 'composite' ? 'layers' : 'menu_book'}</span>
          ${escapeHtml(row.theory_state_label)}
        </span>
        <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getTheoryNeutralChipClass()}">
          ${escapeHtml(`${row.task_count || 0} заданий`)}
        </span>
        ${row.needs_sync ? `
          <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${getTheoryToneClass('warning')}" title="Теория в одной из тем изменилась. Нажмите &laquo;Синхронизировать&raquo;, чтобы обновить теорию в этом комплексе.">
            <span class="material-symbols-outlined text-[14px]">sync_problem</span>
            Теория устарела
          </span>
        ` : ''}
        ${extraBadges.join('')}
      `;
      return shouldWrap
        ? `<div class="flex flex-wrap items-center gap-2">${content}</div>`
        : content;
    }

  function resolveComplexOwnership(row) {
    if (window.WorkspaceImportClient && typeof window.WorkspaceImportClient.resolveComplexOwnership === 'function') {
      return window.WorkspaceImportClient.resolveComplexOwnership(row);
    }
    const ownership = (row && typeof row.ownership === 'object') ? row.ownership : {};
    return {
      createdByUserId: String(
        ownership.created_by_user_id
        || ownership.createdByUserId
        || row?.created_by_user_id
        || ''
      ).trim(),
      createdByUserName: String(
        ownership.created_by_user_name
        || ownership.createdByUserName
        || row?.created_by_user_name
        || ''
      ).trim(),
      createdVia: String(
        ownership.created_via
        || ownership.createdVia
        || row?.created_via
        || ''
      ).trim() || 'legacy_unknown',
      contentScope: String(
        ownership.content_scope
        || ownership.contentScope
        || row?.content_scope
        || ''
      ).trim() || 'shared_local',
      hasOwner: ownership.has_owner === true || ownership.hasOwner === true || !!ownership.created_by_user_id || !!row?.created_by_user_id,
      isOwnedByCurrentUser: ownership.is_owned_by_current_user === true || ownership.isOwnedByCurrentUser === true,
    };
  }

  function getComplexCreatedViaLabel(createdVia) {
    if (window.WorkspaceImportClient && typeof window.WorkspaceImportClient.getCreatedViaLabel === 'function') {
      return window.WorkspaceImportClient.getCreatedViaLabel(createdVia);
    }
    const normalized = String(createdVia || '').trim().toLowerCase();
    if (normalized === 'workspace_import') return 'Legacy import';
    if (normalized === 'archive_import') return 'Legacy import';
    if (normalized === 'manual_editor') return 'Редактор';
    return normalized || 'Источник не определён';
  }

  function renderComplexOwnershipBadges(row) {
    const ownership = resolveComplexOwnership(row);
    const badges = [];
    if (ownership.isOwnedByCurrentUser) {
      badges.push(`
        <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${getTheoryToneClass('success')}">
          <span class="material-symbols-outlined text-[14px]">person</span>
          Моё
        </span>
      `);
    } else if (ownership.hasOwner) {
      badges.push(`
        <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${getTheoryNeutralChipClass()}">
          <span class="material-symbols-outlined text-[14px]">badge</span>
          ${escapeHtml(ownership.createdByUserName || ownership.createdByUserId)}
        </span>
      `);
    }
    badges.push(`
      <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${getTheoryNeutralChipClass()}">
        <span class="material-symbols-outlined text-[14px]">inventory_2</span>
        ${escapeHtml(getComplexCreatedViaLabel(ownership.createdVia))}
      </span>
    `);
    return badges.join('');
  }

  function renderTheoryPublicationBadge(row) {
    const ownership = resolveComplexOwnership(row);
    if (!ownership.isOwnedByCurrentUser) return '';
    const publication = resolveTheoryPublication(row);
    const label = publication ? getCatalogVisibilityLabel(publication.catalog_visibility) : 'Не опубликована';
    const toneClass = publication ? getCatalogVisibilityToneClass(publication.catalog_visibility) : getTheoryNeutralChipClass();
    const title = publication
      ? getTheoryCatalogVisibilityDescription(publication.catalog_visibility)
      : 'Теория ещё не публиковалась и доступна только вам.';
    return `
      <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass}" title="${escapeHtml(title)}">
        <span class="material-symbols-outlined text-[14px]">public</span>
        ${escapeHtml(label)}
      </span>
    `;
  }

  async function openTheoryPublicationDialog(row = {}) {
    const theoryId = getTheoryRowId(row);
    if (!theoryId) {
      setFlash('Управление публикацией недоступно: не удалось определить теорию.', 'error');
      return;
    }
    const ownership = resolveComplexOwnership(row);
    if (!ownership.isOwnedByCurrentUser) {
      setFlash('Публикацией можно управлять только для своих теорий.', 'warning');
      return;
    }

    const publication = resolveTheoryPublication(row);
    const currentVisibility = String(publication?.catalog_visibility || 'public').trim().toLowerCase() || 'public';
    const visibilityLock = getTheoryVisibilityLock(publication);
    const accessCode = getAccessCodeValue(publication);
    const theoryTitle = escapeHtml(row?.title || theoryId || 'Без названия');

    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-[1220] bg-scrim backdrop-blur-sm flex items-center justify-center p-4';
    modal.innerHTML = `
      <div class="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-border-subtle bg-surface-1 shadow-xl">
        <div class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div class="space-y-1">
            <p class="text-xs font-bold uppercase tracking-[0.16em] text-text-muted">Публикация теории</p>
            <h3 class="text-xl font-bold text-text-main">${theoryTitle}</h3>
            <p class="text-sm text-text-secondary">Здесь можно опубликовать теорию, изменить режим доступа и при необходимости получить код доступа.</p>
          </div>
          <button type="button" class="btn-secondary h-10 px-4" data-role="close">Закрыть</button>
        </div>
        <div class="custom-scrollbar space-y-5 overflow-y-auto p-5">
          <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">Текущий статус</div>
                <div id="theory-publish-current-status" class="mt-1 text-base font-semibold text-text-main">${escapeHtml(publication ? getCatalogVisibilityLabel(publication.catalog_visibility) : 'Не опубликована')}</div>
                <div id="theory-publish-current-meta" class="mt-1 text-sm text-text-secondary">${publication ? `Последняя публикация: ${escapeHtml(formatPublicationTimestamp(publication.latest_published_at))}` : 'После первой публикации теория появится в каталоге или станет доступна по коду.'}</div>
              </div>
              <span id="theory-publish-current-badge" class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${publication ? getCatalogVisibilityToneClass(currentVisibility) : getTheoryNeutralChipClass()}">${escapeHtml(publication ? getCatalogVisibilityLabel(currentVisibility) : 'Не опубликована')}</span>
            </div>
          </div>

          <div class="space-y-3">
            <div>
              <div class="text-sm font-semibold text-text-main">Режим доступа</div>
              <p class="mt-1 text-sm text-text-secondary">${visibilityLock ? escapeHtml(formatTheoryVisibilityLockMessage(visibilityLock)) : 'Если публикация уже существует, доступ можно поменять отдельно от публикации новой версии. Новые правки из редактора увидят другие пользователи только после публикации.'}</p>
            </div>
            ${visibilityLock ? `
              <div class="rounded-2xl border border-warning-light bg-warning-light/40 px-4 py-3 text-sm text-warning-darker">
                Теория используется публичным комплексом. Режим доступа зафиксирован на «Общий доступ».
              </div>
            ` : ''}
            <div class="grid gap-3 md:grid-cols-3">
              ${['public', 'access_code', 'private'].map((visibility) => `
                <label class="rounded-2xl border border-border-subtle bg-surface-1 p-4 transition-colors hover:border-primary-light ${visibilityLock && visibility !== 'public' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}">
                  <div class="flex items-start gap-3">
                    <input type="radio" name="theory-publish-visibility" value="${visibility}" ${visibility === currentVisibility ? 'checked' : ''} ${visibilityLock && visibility !== 'public' ? 'disabled' : ''} class="mt-1 h-4 w-4 text-primary" />
                    <div class="space-y-1 min-w-0">
                      <div class="text-sm font-semibold text-text-main">${escapeHtml(getCatalogVisibilityLabel(visibility))}</div>
                      <div class="text-sm text-text-secondary">${escapeHtml(getTheoryCatalogVisibilityDescription(visibility))}</div>
                    </div>
                  </div>
                </label>
              `).join('')}
            </div>
          </div>

          <div id="theory-publish-access-box" class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4 ${currentVisibility === 'access_code' ? '' : 'hidden'}">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div class="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">Код доступа</div>
                <div id="theory-publish-access-code" class="mt-1 text-base font-semibold tracking-[0.12em] text-text-main">${escapeHtml(accessCode ? formatAccessCodeDisplay(accessCode) : 'Код будет создан после публикации')}</div>
              </div>
              <button type="button" class="btn-secondary h-10 px-4" data-role="copy-access-code">Скопировать код</button>
            </div>
          </div>

          <div id="theory-publish-feedback" class="hidden rounded-2xl border px-4 py-3 text-sm"></div>
        </div>
        <div class="flex flex-wrap justify-end gap-3 border-t border-border-subtle px-5 py-4">
          <button type="button" data-role="update-visibility" class="btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm ${publication ? '' : 'hidden'}">
            <span class="material-symbols-outlined text-[18px]">tune</span>
            <span>Сохранить доступ</span>
          </button>
          <button type="button" data-role="publish-version" class="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm">
            <span class="material-symbols-outlined text-[18px]">publish</span>
            <span>${publication ? 'Опубликовать версию' : 'Опубликовать'}</span>
          </button>
        </div>
      </div>
    `;

    const close = () => modal.remove();
    const getSelectedVisibility = () => {
      const selected = modal.querySelector('input[name="theory-publish-visibility"]:checked');
      return String(selected?.value || currentVisibility || 'public').trim().toLowerCase() || 'public';
    };
    let modalBusy = false;
    const applyVisibilityControlState = (item = null) => {
      const lock = getTheoryVisibilityLock(item || publication);
      const radios = Array.from(modal.querySelectorAll('input[name="theory-publish-visibility"]'));
      let publicRadio = null;
      radios.forEach((radio) => {
        const visibility = String(radio?.value || '').trim().toLowerCase();
        const disabledByLock = !!lock && visibility !== 'public';
        if (visibility === 'public') {
          publicRadio = radio;
        }
        radio.disabled = modalBusy || disabledByLock;
      });
      if (lock) {
        const selected = getSelectedVisibility();
        if (selected !== 'public' && publicRadio) {
          publicRadio.checked = true;
        }
      }
      return lock;
    };
    const setBusy = (busy) => {
      modalBusy = !!busy;
      modal.querySelectorAll('button, input[type="radio"]').forEach((node) => {
        if (busy) {
          node.setAttribute('disabled', 'true');
        } else {
          node.removeAttribute('disabled');
        }
      });
      applyVisibilityControlState(resolveTheoryPublication(row));
    };
    const setFeedback = (message = '', tone = 'info') => {
      const box = modal.querySelector('#theory-publish-feedback');
      if (!box) return;
      if (!message) {
        box.className = 'hidden rounded-2xl border px-4 py-3 text-sm';
        box.textContent = '';
        return;
      }
      const toneClass = tone === 'error'
        ? 'border-error-light bg-error-lighter text-error-text'
        : tone === 'success'
          ? 'border-success-light bg-success-lighter text-success-text'
          : 'border-info-light bg-info-lighter text-info-text';
      box.className = `rounded-2xl border px-4 py-3 text-sm ${toneClass}`;
      box.textContent = message;
    };
    const syncModalState = (item) => {
      const currentItem = item && typeof item === 'object' ? item : null;
      const lock = applyVisibilityControlState(currentItem);
      const selectedVisibility = getSelectedVisibility();
      const currentStatus = modal.querySelector('#theory-publish-current-status');
      const currentMeta = modal.querySelector('#theory-publish-current-meta');
      const currentBadge = modal.querySelector('#theory-publish-current-badge');
      const accessBox = modal.querySelector('#theory-publish-access-box');
      const accessCodeEl = modal.querySelector('#theory-publish-access-code');
      const updateBtn = modal.querySelector('[data-role="update-visibility"]');

      if (currentStatus) {
        currentStatus.textContent = currentItem ? getCatalogVisibilityLabel(currentItem.catalog_visibility) : 'Не опубликована';
      }
      if (currentMeta) {
        currentMeta.textContent = currentItem
          ? `Последняя публикация: ${formatPublicationTimestamp(currentItem.latest_published_at)}`
          : 'После первой публикации теория появится в каталоге или станет доступна по коду.';
      }
      if (currentBadge) {
        currentBadge.className = `inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${currentItem ? getCatalogVisibilityToneClass(currentItem.catalog_visibility) : getTheoryNeutralChipClass()}`;
        currentBadge.textContent = currentItem ? getCatalogVisibilityLabel(currentItem.catalog_visibility) : 'Не опубликована';
      }
      const activeCode = getAccessCodeValue(currentItem);
      const showAccess = selectedVisibility === 'access_code';
      if (accessBox) accessBox.classList.toggle('hidden', !showAccess);
      if (accessCodeEl) {
        accessCodeEl.textContent = activeCode
          ? formatAccessCodeDisplay(activeCode)
          : (selectedVisibility === 'access_code' ? 'Код будет создан после публикации' : '');
      }
      if (updateBtn) {
        const currentItemVisibility = String(currentItem?.catalog_visibility || '').trim().toLowerCase();
        const canUpdateVisibility = !!currentItem && selectedVisibility !== currentItemVisibility && !(lock && selectedVisibility !== 'public');
        updateBtn.disabled = !canUpdateVisibility;
        updateBtn.classList.toggle('opacity-60', !canUpdateVisibility);
      }
    };

    modal.querySelectorAll('[data-role="close"]').forEach((node) => {
      node.addEventListener('click', close);
    });
    modal.addEventListener('click', (event) => {
      if (event.target === modal) close();
    });
    modal.querySelectorAll('input[name="theory-publish-visibility"]').forEach((radio) => {
      radio.addEventListener('change', () => syncModalState(resolveTheoryPublication(row)));
    });
    modal.querySelector('[data-role="copy-access-code"]')?.addEventListener('click', async () => {
      await copyTheoryAccessCode(modal.querySelector('#theory-publish-access-code')?.textContent);
    });
    modal.querySelector('[data-role="update-visibility"]')?.addEventListener('click', async () => {
      const currentItem = resolveTheoryPublication(row);
      if (!currentItem) return;
      const nextVisibility = getSelectedVisibility();
      if (nextVisibility === String(currentItem.catalog_visibility || '').trim().toLowerCase()) {
        setFeedback('Выбранный режим доступа уже сохранён.', 'info');
        return;
      }
      setBusy(true);
      setFeedback('');
      try {
        const resp = await fetch(`/api/catalog/items/${encodeURIComponent(currentItem.item_id)}/visibility`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ catalog_visibility: nextVisibility }),
        });
        const data = await readJsonSafely(resp);
        if (!resp.ok || data?.ok === false) {
          throw new Error(data?.error || `catalog_visibility_update_failed:${resp.status}`);
        }
        rebuildTheoryPublicationIndex(
          allTheoryPublicationItems
            .filter((item) => String(item?.item_id || '').trim() !== String(currentItem.item_id || '').trim())
            .concat(data.item ? [data.item] : [])
        );
        syncModalState(data.item);
        setFeedback(`Доступ обновлён: ${getCatalogVisibilityLabel(data.item?.catalog_visibility)}.`, 'success');
        setFlash(`Статус публикации теории обновлён: ${getCatalogVisibilityLabel(data.item?.catalog_visibility)}.`, 'success');
        renderView();
      } catch (error) {
        console.error('[Theory Center] Visibility update failed', error);
        setFeedback(`Не удалось изменить доступ: ${getTheoryPublicationErrorMessage(error, 'catalog_visibility_update_failed')}`, 'error');
      } finally {
        setBusy(false);
      }
    });
    modal.querySelector('[data-role="publish-version"]')?.addEventListener('click', async () => {
      const selectedVisibility = getSelectedVisibility();
      setBusy(true);
      setFeedback('');
      try {
        const resp = await fetch(`/api/catalog/theories/${encodeURIComponent(theoryId)}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ catalog_visibility: selectedVisibility }),
        });
        const data = await readJsonSafely(resp);
        if (!resp.ok || data?.ok === false) {
          throw new Error(data?.error || `catalog_publish_failed:${resp.status}`);
        }
        rebuildTheoryPublicationIndex(
          allTheoryPublicationItems
            .filter((item) => String(item?.item_id || '').trim() !== String(data.item?.item_id || '').trim())
            .concat(data.item ? [data.item] : [])
        );
        syncModalState(data.item);
        setFeedback(`Публикация обновлена. Режим доступа: ${getCatalogVisibilityLabel(data.item?.catalog_visibility)}.`, 'success');
        setFlash(`Теория опубликована: ${getCatalogVisibilityLabel(data.item?.catalog_visibility)}.`, 'success');
        renderView();
      } catch (error) {
        console.error('[Theory Center] Publish failed', error);
        setFeedback(`Не удалось опубликовать теорию: ${getTheoryPublicationErrorMessage(error, 'catalog_publish_failed')}`, 'error');
      } finally {
        setBusy(false);
      }
    });

    syncModalState(publication);
    document.body.appendChild(modal);
  }

  function renderTopicCard(row) {
    const theoryText = row.has_theory
      ? escapeHtml(row.theory_title || row.theory_id || 'Теория')
      : 'Теория для этой темы пока не задана.';
    return `
      <article class="theory-row-card card-elevated rounded-[28px] p-5">
        <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div class="min-w-0 flex-1 space-y-3">
            <div class="space-y-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${getTheoryNeutralChipClass()}">${escapeHtml(row.module_name || row.module_id)}</span>
              </div>
              <h3 class="text-xl font-bold tracking-[-0.02em] text-text-main">${escapeHtml(row.topic_name || row.topic_id)}</h3>
              ${renderBadges(row)}
            </div>
            <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-3">
              <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">Теория темы</p>
              <p class="mt-2 text-sm text-text-main">${theoryText}</p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 xl:max-w-[420px] xl:justify-end">
            <button type="button" class="theory-mini-btn ${getTheoryNeutralButtonClass()} rounded-2xl border px-4 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary" data-action="open-editor-dashboard">
              Редактор заданий
            </button>
            <button type="button"
              class="theory-mini-btn ${getTheoryToneClass('primary', 'button')} rounded-2xl border px-4 py-2.5 text-sm font-semibold"
              data-action="${row.has_theory ? 'open-topic-theory' : 'create-topic-theory'}"
              data-module-id="${escapeHtml(row.module_id)}"
              data-topic-id="${escapeHtml(row.topic_id)}">
              ${row.has_theory ? 'Открыть теорию' : 'Создать теорию'}
            </button>
          </div>
        </div>
      </article>
    `;
  }

  function renderTheoryItemsStatusText(row) {
    const sl = row.sync_label || '';
    if (sl.includes('больше не задана') || sl.includes('not set')) {
      return 'Ни одна из тем комплекса больше не имеет теории. Синхронизация удалит устаревшую теорию.';
    }
    return 'Теория ещё не назначена. Откройте настройки и выберите или создайте теорию.';
  }

  function renderTheoryItems(row) {
    if (!Array.isArray(row.theory_items) || !row.theory_items.length) {
        return `<p class="text-sm text-text-secondary">${renderTheoryItemsStatusText(row)}</p>`;
    }
    return `
      <div class="flex flex-wrap gap-2">
        ${row.theory_items.map((item) => `
          <button type="button"
            class="theory-chip inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-1 px-3 py-1.5 text-xs font-semibold text-text-main"
            data-action="open-complex-theory-item"
            data-complex-id="${escapeHtml(row.complex_id)}"
            data-theory-id="${escapeHtml(item.theory_id)}">
            <span class="material-symbols-outlined text-[14px]">${row.theory_state === 'composite' ? 'layers' : 'menu_book'}</span>
            ${escapeHtml(item.title_cache || item.theory_id)}
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderComplexCard(row) {
    const modulesText = Array.isArray(row.module_names) && row.module_names.length
      ? row.module_names.join(', ')
      : 'Без модулей';
    const ownershipBadges = renderComplexOwnershipBadges(row);
    const combinedBadges = [renderBadges(row, { wrap: false }), ownershipBadges].filter(Boolean).join('');
    return `
      <article class="theory-row-card card-elevated rounded-[28px] p-5">
        <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div class="min-w-0 flex-1 space-y-3">
            <div class="space-y-2">
              <span class="inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${getTheoryNeutralChipClass()}">${escapeHtml(modulesText)}</span>
              <h3 class="text-xl font-bold tracking-[-0.02em] text-text-main">${escapeHtml(row.complex_name || row.complex_id)}</h3>
              ${combinedBadges ? `
                <div class="flex flex-wrap items-center gap-2 xl:flex-nowrap xl:overflow-x-auto xl:pb-1">
                  ${combinedBadges}
                </div>
              ` : ''}
            </div>
            <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-3">
              <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">Теоретический контекст</p>
              <div class="mt-2">
                ${renderTheoryItems(row)}
              </div>
              ${row.sync_label ? `
                <p class="mt-3 text-sm text-text-secondary" title="Информация о необходимости синхронизации">${escapeHtml(row.sync_label)}</p>
              ` : ''}
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 xl:max-w-[360px] xl:justify-end">
            ${row.needs_sync ? `
              <button type="button"
                class="theory-mini-btn rounded-2xl border border-info-light bg-info-lighter px-4 py-2.5 text-sm font-semibold text-info-text hover:border-primary hover:text-primary"
                data-action="sync-complex"
                data-complex-id="${escapeHtml(row.complex_id)}"
                title="${escapeHtml(row.sync_label || 'Обновить теорию комплекса по текущим теориям тем')}">
                Синхронизировать
              </button>
            ` : ''}
            <button type="button"
              class="theory-mini-btn ${getTheoryNeutralButtonClass()} rounded-2xl border px-4 py-2.5 text-sm font-semibold hover:border-primary hover:text-primary"
              data-action="open-complex"
              data-complex-id="${escapeHtml(row.complex_id)}">
              Открыть комплекс
            </button>
            ${row.open_theory_id ? `
              <button type="button"
                class="theory-mini-btn ${getTheoryToneClass('primary', 'button')} rounded-2xl border px-4 py-2.5 text-sm font-semibold"
                data-action="open-complex-theory"
                data-complex-id="${escapeHtml(row.complex_id)}"
                data-theory-id="${escapeHtml(row.open_theory_id)}"
                title="Открыть теорию комплекса">
                Открыть теорию
              </button>
            ` : ''}
          </div>
        </div>
      </article>
    `;
  }

  function renderOrphanCard(row) {
    const theoryId = getTheoryRowId(row);
    const usageTopics = Number(row.usage_topics || 0);
    const usageComplexes = Number(row.usage_complexes || 0);
    const hasContent = row.has_content !== false;
    const ownership = resolveComplexOwnership(row);
    const openMeta = getTheoryOpenMeta(row);
    const selected = state.selectedTheoryIds.has(theoryId);
    const selectable = isTheoryRowDeletable(row);
    const selectionMode = state.selectionMode && supportsTheorySelectionScope();
    return `
      <article class="theory-row-card card-elevated rounded-[28px] p-5"
        data-theory-id="${escapeHtml(theoryId)}"
        data-selectable="${selectable ? '1' : '0'}"
        data-selection-mode="${selectionMode ? '1' : '0'}"
        data-selected="${selected ? '1' : '0'}">
        <div class="flex flex-col gap-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">Теория</p>
              <h3 class="text-xl font-semibold tracking-[-0.02em] text-text-main truncate">${escapeHtml(row.title || row.id)}</h3>
              <p class="text-[12px] text-text-muted truncate">${escapeHtml(row.id || '')}</p>
            </div>
            <div class="flex items-start gap-2 shrink-0">
              ${renderTheoryDeleteButton(row)}
              <button type="button"
                class="theory-mini-btn ${getTheoryToneClass('primary', 'button')} rounded-2xl border px-3 py-2 text-xs font-semibold"
                data-action="open-orphan-theory"
                data-theory-id="${escapeHtml(row.id)}"
                title="${escapeHtml(openMeta.title)}">
                ${escapeHtml(openMeta.label)}
              </button>
              ${ownership.isOwnedByCurrentUser ? `
                <button type="button"
                  class="theory-mini-btn ${getTheoryNeutralButtonClass()} rounded-2xl border px-3 py-2 text-xs font-semibold hover:border-primary hover:text-primary"
                  data-action="manage-theory-publication"
                  data-theory-id="${escapeHtml(row.id)}">
                  Публикация
                </button>
              ` : ''}
            </div>
          </div>
          <div class="flex items-end justify-between gap-3">
            <div class="min-w-0 flex flex-1 flex-wrap items-center gap-2 text-xs">
              ${renderTheoryAuthorBadge(row)}
              ${renderTheoryOriginBadge(row)}
              ${renderTheoryCatalogStatusBadge(row)}
              <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold ${getTheoryToneClass('warning')}" title="Тема или комплекс не используют эту теорию">
                <span class="material-symbols-outlined text-[14px]">priority_high</span>
                Не привязана
              </span>
              ${renderTheoryLinkedComplexBadge(row)}
              <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${getTheoryNeutralChipClass()}">
                <span class="material-symbols-outlined text-[14px]">menu_book</span>
                Тем: ${usageTopics}
              </span>
              <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${getTheoryNeutralChipClass()}">
                <span class="material-symbols-outlined text-[14px]">inventory_2</span>
                Комплексов: ${usageComplexes}
              </span>
              ${hasContent ? '' : `
                <span class="inline-flex items-center gap-1 rounded-full border border-error-light bg-error-lighter px-2.5 py-1 font-semibold text-error-text">
                  <span class="material-symbols-outlined text-[14px]">text_ad</span>
                  Только заголовок
                </span>
              `}
              <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${getTheoryNeutralChipClass({ muted: true })}" title="Дата последнего обновления">
                <span class="material-symbols-outlined text-[14px]">event</span>
                ${escapeHtml(formatDateLabel(row.updated_at || row.version))}
              </span>
            </div>
            <div class="shrink-0">
              ${renderTheorySelectionToggle(row, { compact: false })}
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderTheoryCatalogCard(row) {
    if (row?.is_linked_publication) {
      const accessState = String(row.access_state || 'active').trim();
      const isLocked = accessState === 'requires_access_code' || accessState === 'revoked' || accessState === 'deleted_source';
      const accessTone = accessState === 'active'
        ? getTheoryToneClass('success')
        : accessState === 'requires_access_code'
          ? getTheoryToneClass('warning')
          : getTheoryNeutralChipClass();
      const accessLabel = accessState === 'active'
        ? 'Связанная публикация'
        : accessState === 'requires_access_code'
          ? 'Нужен код доступа'
          : accessState === 'revoked'
            ? 'Доступ отозван'
            : 'Источник недоступен';
      return `
        <article class="theory-row-card card-elevated rounded-[28px] p-5"
          data-theory-id="${escapeHtml(getTheoryRowId(row))}"
          data-selectable="0"
          data-selection-mode="0"
          data-selected="0">
          <div class="flex flex-col gap-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 space-y-1">
                <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">Связанная теория</p>
                <h3 class="text-xl font-semibold tracking-[-0.02em] text-text-main truncate">${escapeHtml(row.title || row.id)}</h3>
              </div>
              <div class="flex items-start gap-2 shrink-0">
                <button type="button"
                  class="theory-mini-btn rounded-2xl border border-error-light bg-error-lighter px-3 py-2 text-xs font-semibold text-error-text hover:border-error"
                  data-action="delete-linked-theory-record"
                  data-library-entry-id="${escapeHtml(row.library_entry_id)}"
                  title="Убрать связанную теорию из библиотеки">
                  Убрать
                </button>
                <button type="button"
                  class="theory-mini-btn ${getTheoryToneClass('primary', 'button')} rounded-2xl border px-3 py-2 text-xs font-semibold"
                  data-action="${accessState === 'requires_access_code' ? 'enter-linked-access-code' : 'open-linked-theory'}"
                  data-library-entry-id="${escapeHtml(row.library_entry_id)}">
                  ${accessState === 'requires_access_code' ? 'Ввести код' : 'Открыть'}
                </button>
              </div>
            </div>
            <div class="flex items-end justify-between gap-3">
              <div class="min-w-0 flex flex-1 flex-wrap items-center gap-2 text-xs">
                ${renderTheoryAuthorBadge(row)}
                ${renderTheoryOriginBadge(row)}
                ${renderTheoryCatalogStatusBadge(row)}
                <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold ${accessTone}">
                  <span class="material-symbols-outlined text-[14px]">${accessState === 'active' ? 'link' : accessState === 'requires_access_code' ? 'password' : 'lock'}</span>
                  ${escapeHtml(accessLabel)}
                </span>
                ${row.image_count > 0 ? `
                  <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${getTheoryNeutralChipClass()}">
                    <span class="material-symbols-outlined text-[14px]">imagesmode</span>
                    Фото: ${escapeHtml(String(row.image_count))}
                  </span>
                ` : ''}
                <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${getTheoryNeutralChipClass({ muted: true })}">
                  <span class="material-symbols-outlined text-[14px]">event</span>
                  ${escapeHtml(formatDateLabel(row.updated_at))}
                </span>
                ${row.access_reason ? `
                  <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${getTheoryNeutralChipClass()}">
                    <span class="material-symbols-outlined text-[14px]">info</span>
                    ${escapeHtml(row.access_reason)}
                  </span>
                ` : ''}
              </div>
            </div>
          </div>
        </article>
      `;
    }
    const theoryId = getTheoryRowId(row);
    const usageTopics = Number(row.usage_topics || 0);
    const usageComplexes = Number(row.usage_complexes || 0);
    const hasContent = row.has_content !== false;
    const imageCount = Number(row.image_count || 0);
    const ownership = resolveComplexOwnership(row);
    const openMeta = getTheoryOpenMeta(row);
    const selected = state.selectedTheoryIds.has(theoryId);
    const selectable = isTheoryRowDeletable(row);
    const selectionMode = state.selectionMode && supportsTheorySelectionScope();
    return `
      <article class="theory-row-card card-elevated rounded-[28px] p-5"
        data-theory-id="${escapeHtml(theoryId)}"
        data-selectable="${selectable ? '1' : '0'}"
        data-selection-mode="${selectionMode ? '1' : '0'}"
        data-selected="${selected ? '1' : '0'}">
        <div class="flex flex-col gap-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">Теория</p>
              <h3 class="text-xl font-semibold tracking-[-0.02em] text-text-main truncate">${escapeHtml(row.title || row.id)}</h3>
            </div>
            <div class="flex items-start gap-2 shrink-0">
              ${renderTheoryDeleteButton(row)}
              <button type="button"
                class="theory-mini-btn ${getTheoryToneClass('primary', 'button')} rounded-2xl border px-3 py-2 text-xs font-semibold"
                data-action="open-theory-record"
                data-theory-id="${escapeHtml(row.id)}"
                title="${escapeHtml(openMeta.title)}">
                ${escapeHtml(openMeta.label)}
              </button>
              ${ownership.isOwnedByCurrentUser ? `
                <button type="button"
                  class="theory-mini-btn ${getTheoryNeutralButtonClass()} rounded-2xl border px-3 py-2 text-xs font-semibold hover:border-primary hover:text-primary"
                  data-action="manage-theory-publication"
                  data-theory-id="${escapeHtml(row.id)}">
                  Публикация
                </button>
              ` : ''}
            </div>
          </div>
          <div class="flex items-end justify-between gap-3">
            <div class="min-w-0 flex flex-1 flex-wrap items-center gap-2 text-xs">
              ${renderTheoryAuthorBadge(row)}
              ${renderTheoryOriginBadge(row)}
              ${renderTheoryCatalogStatusBadge(row)}
              ${row.is_orphan ? `
                <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold ${getTheoryToneClass('warning')}" title="Теория пока не связана ни с темами, ни с комплексами">
                  <span class="material-symbols-outlined text-[14px]">link_off</span>
                  Без привязки
                </span>
              ` : ''}
              <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${getTheoryNeutralChipClass()}">
                <span class="material-symbols-outlined text-[14px]">menu_book</span>
                Тем: ${usageTopics}
              </span>
              <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${getTheoryNeutralChipClass()}">
                <span class="material-symbols-outlined text-[14px]">inventory_2</span>
                Комплексов: ${usageComplexes}
              </span>
              ${renderTheoryLinkedComplexBadge(row)}
              ${imageCount > 0 ? `
                <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${getTheoryNeutralChipClass()}">
                  <span class="material-symbols-outlined text-[14px]">imagesmode</span>
                  Фото: ${imageCount}
                </span>
              ` : ''}
              ${hasContent ? '' : `
                <span class="inline-flex items-center gap-1 rounded-full border border-error-light bg-error-lighter px-2.5 py-1 font-semibold text-error-text">
                  <span class="material-symbols-outlined text-[14px]">text_ad</span>
                  Только заголовок
                </span>
              `}
              <span class="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${getTheoryNeutralChipClass({ muted: true })}" title="Дата последнего обновления">
                <span class="material-symbols-outlined text-[14px]">event</span>
                ${escapeHtml(formatDateLabel(row.updated_at || row.version))}
              </span>
            </div>
            <div class="shrink-0">
              ${renderTheorySelectionToggle(row, { compact: false })}
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function getSelectionToggleState(rows = null) {
    const normalizedRows = Array.isArray(rows) ? rows : getVisibleRows();
    const supported = supportsTheorySelectionScope();
    const visibleSelectableIds = supported ? getVisibleSelectableTheoryIds(normalizedRows) : [];

    if (state.loading || !state.overview) {
      return {
        disabled: true,
        title: 'Центр теории еще загружается. Подождите несколько секунд.',
      };
    }

    if (!supported) {
      return {
        disabled: true,
        title: 'Массовые операции доступны только в разделах «Теории: Все», «Теории: Без привязки» и «Теории: Только заголовок».',
      };
    }

    return {
      disabled: false,
      title: state.selectionMode
        ? 'Завершить режим массовых операций'
        : 'Включить режим массовых операций',
    };
  }

  function updateSelectionControls(rows = null) {
    const normalizedRows = Array.isArray(rows) ? rows : getVisibleRows();
    if (!supportsTheorySelectionScope()) {
      clearTheorySelection({ exitMode: true });
    } else {
      pruneSelectedTheoryIds(normalizedRows);
    }

    const supported = supportsTheorySelectionScope();
    const visibleSelectableIds = supported ? getVisibleSelectableTheoryIds(normalizedRows) : [];
    const selectedCount = state.selectedTheoryIds.size;
    const toggle = $('theory-center-selection-toggle');
    const toggleWrap = $('theory-center-selection-toggle-wrap');
    const toggleIcon = $('theory-center-selection-toggle-icon');
    const toggleLabel = $('theory-center-selection-toggle-label');
    const bulkBar = $('theory-center-bulk-bar');
    const counter = $('theory-center-selection-counter');
    const note = $('theory-center-selection-note');
    const selectVisibleBtn = $('theory-center-selection-select-visible');
    const deleteBtn = $('theory-center-selection-delete');
    const cancelBtn = $('theory-center-selection-cancel');
    const toggleState = getSelectionToggleState(normalizedRows);

    if (toggle) {
      toggle.disabled = toggleState.disabled;
      toggle.setAttribute('data-active', supported && state.selectionMode ? '1' : '0');
      toggle.setAttribute('aria-disabled', toggleState.disabled ? 'true' : 'false');
      toggle.setAttribute('data-unavailable', toggleState.disabled ? '1' : '0');
      toggle.title = toggleState.title;
    }
    if (toggleWrap) {
      toggleWrap.title = toggleState.title;
      toggleWrap.dataset.disabled = toggleState.disabled ? '1' : '0';
      toggleWrap.setAttribute('aria-label', toggleState.title);
    }
    if (toggleIcon) {
      toggleIcon.textContent = supported && state.selectionMode ? 'close' : 'checklist';
    }
    if (toggleLabel) {
      toggleLabel.textContent = supported && state.selectionMode ? 'Завершить выбор' : 'Массовые операции';
    }

    if (bulkBar) {
      const visible = supported && state.selectionMode;
      bulkBar.hidden = !visible;
      bulkBar.classList.toggle('hidden', !visible);
      bulkBar.style.display = visible ? 'flex' : 'none';
      bulkBar.style.position = 'fixed';
      bulkBar.style.left = '0';
      bulkBar.style.right = '0';
      bulkBar.style.top = 'auto';
      bulkBar.style.bottom = '1.5rem';
      bulkBar.style.zIndex = '70';
      bulkBar.setAttribute('aria-hidden', visible ? 'false' : 'true');
    }
    if (counter) {
      counter.textContent = `Выбрано: ${selectedCount}`;
    }
    if (note) {
      note.textContent = isTheoryCollectionScope()
        ? 'Можно выделять только теории без привязки к темам и комплексам.'
        : 'В этом разделе выделение доступно только на карточках отдельных теорий без привязки.';
    }
    if (selectVisibleBtn) {
      const allVisibleSelected = visibleSelectableIds.length > 0
        && visibleSelectableIds.every((theoryId) => state.selectedTheoryIds.has(theoryId));
      selectVisibleBtn.disabled = state.bulkDeleting || !visibleSelectableIds.length;
      selectVisibleBtn.title = allVisibleSelected ? 'Снять выделение со всех видимых теорий' : 'Выделить все видимые теории без привязки';
      selectVisibleBtn.innerHTML = `
        <span class="material-symbols-outlined text-[18px]">${allVisibleSelected ? 'remove_done' : 'select_all'}</span>
        ${allVisibleSelected ? 'Снять все' : 'Все видимые'}
      `;
    }
    if (deleteBtn) {
      deleteBtn.disabled = state.bulkDeleting || !selectedCount;
    }
    if (cancelBtn) {
      cancelBtn.disabled = state.bulkDeleting;
    }
  }

  function selectTheoryRange(startId, endId, shouldSelect, rows = null) {
    const orderedIds = getVisibleSelectableTheoryIds(rows);
    const startIndex = orderedIds.indexOf(String(startId || '').trim());
    const endIndex = orderedIds.indexOf(String(endId || '').trim());
    if (startIndex === -1 || endIndex === -1) {
      return false;
    }

    const [minIndex, maxIndex] = [Math.min(startIndex, endIndex), Math.max(startIndex, endIndex)];
    for (let index = minIndex; index <= maxIndex; index += 1) {
      const theoryId = orderedIds[index];
      if (shouldSelect) {
        state.selectedTheoryIds.add(theoryId);
      } else {
        state.selectedTheoryIds.delete(theoryId);
      }
    }
    return true;
  }

  function toggleTheorySelection(theoryId, options = {}) {
    const normalizedTheoryId = String(theoryId || '').trim();
    if (!normalizedTheoryId || !supportsTheorySelectionScope()) {
      return;
    }

    const rows = getVisibleRows();
    const selectableIds = new Set(getVisibleSelectableTheoryIds(rows));
    if (!selectableIds.has(normalizedTheoryId)) {
      setFlash('Для массового удаления доступны только теории без привязки.', 'warning');
      return;
    }

    if (!state.selectionMode) {
      state.selectionMode = true;
    }

    const shouldSelect = typeof options.force === 'boolean'
      ? options.force
      : !state.selectedTheoryIds.has(normalizedTheoryId);
    const usedRangeSelection = Boolean(options.shiftKey)
      && Boolean(state.lastSelectedTheoryId)
      && state.lastSelectedTheoryId !== normalizedTheoryId
      && selectTheoryRange(state.lastSelectedTheoryId, normalizedTheoryId, shouldSelect, rows);

    if (!usedRangeSelection) {
      if (shouldSelect) {
        state.selectedTheoryIds.add(normalizedTheoryId);
      } else {
        state.selectedTheoryIds.delete(normalizedTheoryId);
      }
    }

    if (!state.selectedTheoryIds.size) {
      state.selectionMode = false;
      state.lastSelectedTheoryId = '';
    } else {
      state.lastSelectedTheoryId = shouldSelect ? normalizedTheoryId : '';
    }
    renderList();
  }

  function toggleTheorySelectionMode() {
    if (!supportsTheorySelectionScope()) {
      setFlash('Массовые операции доступны только в теоретических разделах.', 'info');
      updateSelectionControls([]);
      return;
    }

    state.selectionMode = !state.selectionMode;
    if (!state.selectionMode) {
      clearTheorySelection();
    }
    renderView();
  }

  function cancelTheorySelection() {
    clearTheorySelection({ exitMode: true });
    renderView();
  }

  function selectAllVisibleTheories() {
    if (!supportsTheorySelectionScope()) {
      setFlash('Массовые операции доступны только в теоретических разделах.', 'info');
      return;
    }

    const rows = getVisibleRows();
    const selectableIds = getVisibleSelectableTheoryIds(rows);
    if (!selectableIds.length) {
      setFlash('На текущем экране нет теорий без привязки для массовых операций.', 'info');
      updateSelectionControls(rows);
      return;
    }

    state.selectionMode = true;
    const allVisibleSelected = selectableIds.every((theoryId) => state.selectedTheoryIds.has(theoryId));
    if (allVisibleSelected) {
      selectableIds.forEach((theoryId) => state.selectedTheoryIds.delete(theoryId));
      if (!state.selectedTheoryIds.size) {
        state.selectionMode = false;
      }
      state.lastSelectedTheoryId = '';
      renderList();
      return;
    }

    selectableIds.forEach((theoryId) => state.selectedTheoryIds.add(theoryId));
    state.lastSelectedTheoryId = selectableIds[selectableIds.length - 1] || state.lastSelectedTheoryId;
    renderList();

    const skippedCount = rows.length - selectableIds.length;
    if (skippedCount > 0) {
      setFlash(
        `Выделены ${selectableIds.length} теории без привязки. Ещё ${skippedCount} пропущены: они уже используются.`,
        'info'
      );
    }
  }

  function deleteSelectedTheories() {
    if (state.bulkDeleting || !state.selectedTheoryIds.size) {
      return;
    }

    scheduleTheoryDeletion(Array.from(state.selectedTheoryIds), { exitSelectionMode: true });
  }

  function deleteSingleTheory(theoryId) {
    const normalizedTheoryId = String(theoryId || '').trim();
    if (state.bulkDeleting || !normalizedTheoryId) {
      return;
    }

    scheduleTheoryDeletion([normalizedTheoryId]);
  }

  function renderEmptyState() {
    const host = $('theory-center-list');
    if (!host) return;
    const scopeLabel = state.scope === 'complexes'
      ? 'комплексы'
      : state.scope === 'orphans'
        ? 'теории без привязки'
        : state.scope === 'only_title'
          ? 'теории только с заголовком'
        : state.scope === 'all'
          ? 'теории'
          : 'темы';
    host.innerHTML = `
      <div class="empty-state-card">
        <div class="mx-auto flex max-w-md flex-col items-center gap-3">
          <span class="empty-state-card__icon">
            <span class="material-symbols-outlined text-[26px]">search_off</span>
          </span>
          <h3 class="empty-state-card__title">Ничего не найдено</h3>
          <p class="empty-state-card__copy text-sm leading-6">
            По текущим фильтрам подходящие ${escapeHtml(scopeLabel)} не найдены. Попробуйте сбросить состояние или изменить поиск.
          </p>
        </div>
      </div>
    `;
  }

  function renderAllTheoryGroups(rows) {
    const linkedRows = rows.filter((row) => row?.is_linked_publication);
    const workspaceRows = rows.filter((row) => !row?.is_linked_publication);
    const sections = [];
    if (linkedRows.length) {
      sections.push(`
        <section class="space-y-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">Связанные публикации</p>
              <p class="mt-1 text-sm text-text-secondary">Теории из каталога, которые читаются в центре как связанные публикации.</p>
            </div>
            <span class="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${getTheoryNeutralChipClass()}">${escapeHtml(String(linkedRows.length))}</span>
          </div>
          ${linkedRows.map(renderTheoryCatalogCard).join('')}
        </section>
      `);
    }
    if (workspaceRows.length) {
      sections.push(`
        <section class="space-y-4">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-text-secondary">Рабочие теории</p>
              <p class="mt-1 text-sm text-text-secondary">Авторские материалы и локальные теории, которые можно редактировать.</p>
            </div>
            <span class="inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${getTheoryNeutralChipClass()}">${escapeHtml(String(workspaceRows.length))}</span>
          </div>
          ${workspaceRows.map(renderTheoryCatalogCard).join('')}
        </section>
      `);
    }
    return sections.join('<div class="h-2"></div>');
  }

  function renderList() {
    const title = $('theory-center-list-title');
    const subtitle = $('theory-center-list-subtitle');
    const summaryEl = $('theory-center-result-summary');
    const host = $('theory-center-list');
    if (!host) return;

    const rows = getVisibleRows();
    const total = getVisibleTheoryDeleteRows(getScopeRows()).length;

    if (title) {
      title.textContent = state.scope === 'all'
        ? 'Теории: Все'
        : state.scope === 'complexes'
        ? 'Комплексы'
        : state.scope === 'orphans'
          ? 'Теории: Без привязки'
          : state.scope === 'only_title'
            ? 'Теории: Только заголовок'
          : 'Темы';
    }
    if (subtitle) {
      subtitle.textContent = state.scope === 'all'
        ? 'Рабочие теории и связанные публикации из каталога в одном центре.'
        : state.scope === 'complexes'
        ? 'Показываем источник теории у комплексов и быстрые действия по обновлению.'
        : state.scope === 'orphans'
          ? 'Теории, которые пока не привязаны ни к одной теме или комплексу.'
          : state.scope === 'only_title'
            ? 'Теории, в которых пока есть только заголовок без основного текста.'
          : 'Показываем темы, их теорию и влияние на связанные комплексы.';
    }
    if (summaryEl) {
      summaryEl.textContent = `Показано ${rows.length} из ${total}`;
    }

    updateSelectionControls(rows);

    if (!rows.length) {
      renderEmptyState();
      return;
    }

    if (state.scope === 'all' || state.scope === 'only_title') {
      host.innerHTML = state.scope === 'all'
        ? renderAllTheoryGroups(rows)
        : rows.map(renderTheoryCatalogCard).join('');
    } else if (state.scope === 'orphans') {
      host.innerHTML = rows.map(renderOrphanCard).join('');
    } else {
      host.innerHTML = rows.map((row) => state.scope === 'complexes' ? renderComplexCard(row) : renderTopicCard(row)).join('');
    }
  }

  function renderView() {
    syncControlsFromState();
    renderSummaryCards();
    applySummaryCollapsedState();
    renderList();
  }

  function getTopicRow(moduleId, topicId) {
    const rows = Array.isArray(state.overview?.topics) ? state.overview.topics : [];
    return rows.find((row) => String(row.module_id) === String(moduleId) && String(row.topic_id) === String(topicId)) || null;
  }

  function getComplexRow(complexId) {
    const rows = Array.isArray(state.overview?.complexes) ? state.overview.complexes : [];
    return rows.find((row) => String(row.complex_id) === String(complexId)) || null;
  }

  async function loadOverview(options = {}) {
    if (state.loading) return;
    state.loading = true;
    if (!options.silent) {
      renderLoadingState('Обновляем обзор теории...');
    }
    try {
      const overviewResponse = await fetch('/api/theory-center/overview');
      const overviewData = await readJsonSafely(overviewResponse);
      if (!overviewResponse.ok || !overviewData?.ok) {
        throw new Error(overviewData?.error || `HTTP ${overviewResponse.status}`);
      }

      let nextOverview = overviewData;
      if (!Array.isArray(nextOverview?.theories)) {
        const theoryRows = await fetchTheoryCatalogRows().catch((error) => {
          console.warn('[Theory Center] Failed to load theory catalog', error);
          return null;
        });
        nextOverview = mergeTheoryCatalogIntoOverview(nextOverview, theoryRows);
      }
      const linkedTheoryRows = await fetchTheoryLibraryEntries().catch((error) => {
        console.warn('[Theory Center] Failed to load linked theory library', error);
        return [];
      });
      nextOverview = {
        ...(nextOverview || {}),
        linked_theories: linkedTheoryRows,
      };
      await fetchTheoryPublicationItems().catch((error) => {
        console.warn('[Theory Center] Failed to load theory publication index', error);
        rebuildTheoryPublicationIndex([]);
      });

      state.overview = nextOverview;
      clearFlash();
      renderView();
      if (!state.linkedEntryAutoOpened) {
        const params = new URLSearchParams(window.location.search || '');
        const linkedEntryId = String(params.get('linked_entry_id') || '').trim();
        if (linkedEntryId && linkedTheoryRows.some((row) => row.library_entry_id === linkedEntryId)) {
          state.linkedEntryAutoOpened = true;
          const targetRow = linkedTheoryRows.find((row) => row.library_entry_id === linkedEntryId);
          if (targetRow?.access_state === 'requires_access_code') {
            openLinkedAccessCodeDialog(linkedEntryId);
          } else {
            openLinkedTheoryViewer(linkedEntryId).catch((error) => {
              console.warn('[Theory Center] Failed to auto-open linked theory', error);
            });
          }
        }
      }
    } catch (error) {
      console.error('[Theory Center] Failed to load overview', error);
      setFlash('Не удалось загрузить обзор теории. Попробуйте обновить страницу позже.', 'error');
      renderLoadingState('Обзор теории недоступен.');
    } finally {
      state.loading = false;
    }
  }

  function openTopicTheory(moduleId, topicId, createNew) {
    const row = getTopicRow(moduleId, topicId);
    if (!row) return;
    const url = buildTheoryEditorUrl(createNew ? '' : row.theory_id, {
      context: 'topic',
      moduleId: row.module_id,
      topicId: row.topic_id,
      moduleName: row.module_name,
      topicName: row.topic_name,
      returnUrl: currentReturnUrl(),
    });
    navigate(url);
  }

  function openComplexTheory(complexId, theoryId) {
    const row = getComplexRow(complexId);
    if (!row) return;
    const url = buildTheoryEditorUrl(theoryId, {
      context: 'complex',
      complexId: row.complex_id,
      complexName: row.complex_name,
      returnUrl: currentReturnUrl(),
    });
    navigate(url);
  }

  async function openTheoryRecord(theoryId, context = '') {
    const normalizedTheoryId = String(theoryId || '').trim();
    if (!normalizedTheoryId) return;
    const row = findTheoryRowById(normalizedTheoryId);
    if (row && !canOpenTheoryInEditor(row)) {
      await openWorkspaceTheoryViewerById(normalizedTheoryId, row);
      return;
    }
    const url = buildTheoryEditorUrl(normalizedTheoryId, {
      context,
      returnUrl: currentReturnUrl(),
    });
    navigate(url);
  }

  function openOrphanTheory(theoryId) {
    return openTheoryRecord(theoryId, 'orphan');
  }

  async function syncComplex(complexId, button) {
    if (button) {
      button.disabled = true;
      button.classList.add('opacity-70');
    }
    try {
      const response = await fetch(`/api/complexes/${encodeURIComponent(complexId)}/sync-theory-from-topics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dry_run: false, propagation_mode: 'safe' }),
      });
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      const status = String(data?.summary?.status || 'none').trim().toLowerCase();
      setFlash(
        status === 'composite'
          ? 'Комплекс обновлен и теперь использует подборку теорий из тем.'
          : 'Комплекс синхронизирован по текущим теориям тем.',
        'success'
      );
      await loadOverview({ silent: true });
    } catch (error) {
      console.error('[Theory Center] Failed to sync complex', error);
      setFlash('Не удалось обновить теорию комплекса из тем.', 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove('opacity-70');
      }
    }
  }

  function handleListClick(event) {
    const button = event.target.closest('[data-action]');
    if (button) {
      const action = String(button.getAttribute('data-action') || '').trim();
      if (action === 'toggle-theory-selection') {
        toggleTheorySelection(button.getAttribute('data-theory-id'), { shiftKey: Boolean(event.shiftKey) });
        return;
      }
      if (action === 'open-editor-dashboard') {
        navigate('/ui/editor');
        return;
      }
      if (action === 'create-topic-theory') {
        openTopicTheory(button.getAttribute('data-module-id'), button.getAttribute('data-topic-id'), true);
        return;
      }
      if (action === 'open-topic-theory') {
        openTopicTheory(button.getAttribute('data-module-id'), button.getAttribute('data-topic-id'), false);
        return;
      }
      if (action === 'open-complex') {
        const complexId = String(button.getAttribute('data-complex-id') || '').trim();
        if (complexId) navigate(`/ui/complexes/create?id=${encodeURIComponent(complexId)}`);
        return;
      }
      if (action === 'open-complex-theory' || action === 'open-complex-theory-item') {
        openComplexTheory(button.getAttribute('data-complex-id'), button.getAttribute('data-theory-id'));
        return;
      }
      if (action === 'sync-complex') {
        syncComplex(button.getAttribute('data-complex-id'), button);
        return;
      }
      if (action === 'open-theory-record') {
        openTheoryRecord(button.getAttribute('data-theory-id'), state.scope === 'orphans' ? 'orphan' : '').catch((error) => {
          console.error('[Theory Center] Failed to open theory record', error);
          setFlash('Не удалось открыть теорию.', 'error');
        });
        return;
      }
      if (action === 'open-linked-theory') {
        openLinkedTheoryViewer(button.getAttribute('data-library-entry-id')).catch((error) => {
          console.error('[Theory Center] Failed to open linked theory', error);
          setFlash('Не удалось открыть связанную теорию.', 'error');
        });
        return;
      }
      if (action === 'enter-linked-access-code') {
        openLinkedAccessCodeDialog(button.getAttribute('data-library-entry-id'));
        return;
      }
      if (action === 'manage-theory-publication') {
        const theoryId = String(button.getAttribute('data-theory-id') || '').trim();
        const rows = Array.isArray(state.overview?.theories) ? state.overview.theories : [];
        const row = rows.find((item) => getTheoryRowId(item) === theoryId) || null;
        if (!row) {
          setFlash('Не удалось найти теорию для управления публикацией.', 'error');
          return;
        }
        openTheoryPublicationDialog(row);
        return;
      }
      if (action === 'open-orphan-theory') {
        openOrphanTheory(button.getAttribute('data-theory-id')).catch((error) => {
          console.error('[Theory Center] Failed to open orphan theory', error);
          setFlash('Не удалось открыть теорию.', 'error');
        });
        return;
      }
      if (action === 'delete-theory-record') {
        deleteSingleTheory(button.getAttribute('data-theory-id'));
        return;
      }
      if (action === 'delete-linked-theory-record') {
        theoryCenterConfirm({
          title: 'Убрать связанную теорию?',
          message: 'Связанная теория будет удалена только из вашей библиотеки. Публикация автора не изменится.',
          confirmText: 'Убрать',
          cancelText: 'Отмена',
          variant: 'warning',
        }).then(async (confirmed) => {
          if (!confirmed) return;
          const libraryEntryId = button.getAttribute('data-library-entry-id');
          button.setAttribute('disabled', 'disabled');
          button.classList.add('opacity-70');
          try {
            const result = await deleteLinkedTheoryByLibraryEntryId(libraryEntryId);
            if (!result?.ok) {
              throw new Error(String(result?.error || result?.message || 'theory_library_delete_failed'));
            }
            await loadOverview({ silent: true });
            setFlash('Связанная теория убрана из библиотеки.', 'success');
          } catch (error) {
            console.error('[Theory Center] Failed to delete linked theory entry', error);
            await loadOverview({ silent: true });
            setFlash('Не удалось убрать связанную теорию из библиотеки.', 'error');
          } finally {
            button.removeAttribute('disabled');
            button.classList.remove('opacity-70');
          }
        });
        return;
      }
    }

    if (state.selectionMode && supportsTheorySelectionScope()) {
      const card = event.target.closest('[data-theory-id]');
      if (!card) return;
      if (String(card.getAttribute('data-selectable') || '0') !== '1') return;
      toggleTheorySelection(card.getAttribute('data-theory-id'), { shiftKey: Boolean(event.shiftKey) });
    }
  }

  function bindStaticActions() {
    const homeBtn = $('theory-center-go-home');
    if (homeBtn) {
      homeBtn.addEventListener('click', () => navigate('/ui/main'));
    }

    const editorBtn2 = $('theory-center-go-editor');
    if (editorBtn2) {
      editorBtn2.addEventListener('click', () => navigate('/ui/editor'));
    }

    const backBtn = $('theory-center-back-complexes');
    if (backBtn) {
      backBtn.addEventListener('click', () => navigate('/ui/complexes'));
    }

    const editorBtn = $('theory-center-open-editor');
    if (editorBtn) {
      editorBtn.addEventListener('click', () => navigate('/ui/editor/Theory_Editor.html'));
    }

    const summaryToggleBtn = $('theory-center-summary-toggle');
    if (summaryToggleBtn) {
      summaryToggleBtn.addEventListener('click', () => toggleSummaryCollapsed());
    }

    const selectionToggleBtn = $('theory-center-selection-toggle');
    if (selectionToggleBtn) {
      selectionToggleBtn.addEventListener('click', (event) => {
        if (event.currentTarget instanceof HTMLElement) {
          event.currentTarget.blur();
        }
        toggleTheorySelectionMode();
      });
    }

    const selectionSelectVisibleBtn = $('theory-center-selection-select-visible');
    if (selectionSelectVisibleBtn) {
      selectionSelectVisibleBtn.addEventListener('click', (event) => {
        if (event.currentTarget instanceof HTMLElement) {
          event.currentTarget.blur();
        }
        selectAllVisibleTheories();
      });
    }

    const selectionDeleteBtn = $('theory-center-selection-delete');
    if (selectionDeleteBtn) {
      selectionDeleteBtn.addEventListener('click', (event) => {
        if (event.currentTarget instanceof HTMLElement) {
          event.currentTarget.blur();
        }
        deleteSelectedTheories();
      });
    }

    const selectionCancelBtn = $('theory-center-selection-cancel');
    if (selectionCancelBtn) {
      selectionCancelBtn.addEventListener('click', (event) => {
        if (event.currentTarget instanceof HTMLElement) {
          event.currentTarget.blur();
        }
        cancelTheorySelection();
      });
    }

    const searchInput = $('theory-center-search');
    if (searchInput) {
      searchInput.addEventListener('input', (event) => {
        window.clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => {
          state.search = String(event.target.value || '').trim();
          writeQueryState();
          renderList();
        }, 140);
      });
    }

    const allBtn = $('theory-center-scope-all');
    const topicsBtn = $('theory-center-scope-topics');
    const complexesBtn = $('theory-center-scope-complexes');
    const orphansBtn = $('theory-center-scope-orphans');
    const onlyTitleBtn = $('theory-center-scope-only-title');
    [allBtn, topicsBtn, complexesBtn, orphansBtn, onlyTitleBtn].filter(Boolean).forEach((button) => {
      button.addEventListener('click', () => {
        const nextScope = String(button.getAttribute('data-scope') || 'all').trim();
        if (!nextScope || nextScope === state.scope) return;
        state.scope = nextScope;
        state.stateFilter = 'all';
        writeQueryState();
        renderView();
      });
    });

    const moduleSelect = $('theory-center-module-filter');
    if (moduleSelect) {
      moduleSelect.addEventListener('change', (event) => {
        state.moduleId = String(event.target.value || 'all');
        writeQueryState();
        renderView();
      });
    }

    const stateSelect = $('theory-center-state-filter');
    if (stateSelect) {
      stateSelect.addEventListener('change', (event) => {
        state.stateFilter = String(event.target.value || 'all');
        writeQueryState();
        renderView();
      });
    }

    const listHost = $('theory-center-list');
    if (listHost) {
      listHost.addEventListener('click', handleListClick);
    }
  }

  function init() {
    readQueryState();
    readUiState();
    bindStaticActions();
    syncControlsFromState();
    updateSelectionControls([]);
    applySummaryCollapsedState();
    writeQueryState();
    loadOverview();
  }

  if (typeof window !== 'undefined' && window[THEORY_CENTER_TEST_HOOKS_FLAG]) {
    window.__theoryCenterTestExports = {
      state,
      readQueryState,
      writeQueryState,
      readUiState,
      applySummaryCollapsedState,
      toggleSummaryCollapsed,
      renderSummaryCards,
      renderTopicCard,
      renderOrphanCard,
      renderTheoryCatalogCard,
      rebuildTheoryPublicationIndex,
      theoryViewerAssetSrc,
      normalizeTheoryViewerImageRef,
      renderLinkedTheoryDeltaHtml,
      openTheoryRecord,
      renderList,
      getVisibleRows,
      setFlash,
      syncControlsFromState,
      updateSelectionControls,
      toggleTheorySelectionMode,
      cancelTheorySelection,
      selectAllVisibleTheories,
      deleteSelectedTheories,
      toggleTheorySelection,
    };
  }

  if (typeof window !== 'undefined' && window[THEORY_CENTER_AUTO_INIT_DISABLED_FLAG]) {
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

