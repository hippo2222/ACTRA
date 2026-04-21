(function initCatalogPage(global) {
  'use strict';

  const state = {
    items: [],
    filteredItems: [],
    savedComplexEntries: [],
    currentUser: null,
    authenticated: false,
    workspaceLimits: null,
    loading: false,
    error: '',
    query: '',
    contentType: 'all',
    selectedItemId: '',
    statusByVersionKey: new Map(),
    pendingStatusKeys: new Set(),
    versionCache: new Map(),
    complexLibraryDetailCache: new Map(),
    listRequestId: 0,
  };

  const TASK_TYPE_LABELS = {
    click: 'Клик',
    test: 'Тест',
    open_answer: 'Открытый ответ',
    sequence_assembly: 'Последовательность',
    draw: 'Рисование',
    video: 'Видео',
  };

  function getTaskTypeLabel(type) {
    const key = String(type || '').trim().toLowerCase();
    return TASK_TYPE_LABELS[key] || key || 'Другое';
  }

  function getTaskTypeBreakdown(snapshot) {
    const deps = snapshot && typeof snapshot.dependencies === 'object' ? snapshot.dependencies : {};
    const tasksMap = deps.tasks && typeof deps.tasks === 'object' ? deps.tasks : {};
    const counts = {};
    const namesByType = {};

    Object.values(tasksMap).forEach((taskPayload) => {
      if (!taskPayload || typeof taskPayload !== 'object') return;
      const taskData = taskPayload.task_data && typeof taskPayload.task_data === 'object' ? taskPayload.task_data : {};
      const rawType = String(taskData.type || taskData.task_type || '').trim().toLowerCase();
      if (rawType) {
        counts[rawType] = (counts[rawType] || 0) + 1;
        if (!namesByType[rawType]) namesByType[rawType] = [];
        const taskName = cleanTaskDisplayName(getTaskPayloadName(taskPayload, ''), 'Задание');
        namesByType[rawType].push(taskName);
      }
    });

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        type,
        label: getTaskTypeLabel(type),
        count,
        names: namesByType[type].sort((a, b) => a.localeCompare(b))
      }));
  }

  function getDeltaImageAttributes(attrs) {
    const imageAttrs = {};
    if (!attrs || typeof attrs !== 'object') return imageAttrs;
    const width = String(attrs.width || '').trim();
    if (width) imageAttrs.width = width;
    const align = String(attrs.align || '').trim();
    if (['left', 'center', 'right'].includes(align)) imageAttrs.align = align;
    const rotate = String(attrs.rotate || '').trim();
    if (['0', '90', '180', '270'].includes(rotate)) imageAttrs.rotate = rotate;
    const float = String(attrs.float || '').trim();
    if (['none', 'left', 'right'].includes(float)) imageAttrs.float = float;
    const flip = String(attrs.flip || '').trim();
    if (['none', 'horizontal'].includes(flip)) imageAttrs.flip = flip;
    return imageAttrs;
  }

  function normalizeCatalogTheoryImageRef(raw) {
    const value = asString(raw);
    if (!value) return '';
    if (value.startsWith('data:')) return value;
    if (value.startsWith('/')) return value;
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    return `/api/local-image?path=${encodeURIComponent(value)}`;
  }

  function getDeltaLineAttrs(rawAttrs) {
    const attrs = rawAttrs && typeof rawAttrs === 'object' ? rawAttrs : {};
    const lineAttrs = {};
    if (attrs.list === 'ordered' || attrs.list === 'bullet' || attrs.list === 'check') {
      lineAttrs.list = attrs.list;
    }
    if (attrs.blockquote) lineAttrs.blockquote = true;
    const header = Number(attrs.header);
    if (Number.isInteger(header) && header >= 1 && header <= 6) lineAttrs.header = header;
    return lineAttrs;
  }

  function renderInlineDeltaText(text, attributes) {
    const escaped = escapeHtml(text).replace(/\u00A0/g, '&nbsp;');
    if (!attributes || typeof attributes !== 'object') return escaped;
    const styles = [];
    if (attributes.color) styles.push(`color:${escapeHtml(attributes.color)}`);
    if (attributes.background) styles.push(`background:${escapeHtml(attributes.background)}`);
    if (attributes.size) styles.push(`font-size:${escapeHtml(attributes.size)}`);
    let content = escaped;
    if (attributes.bold) content = `<strong>${content}</strong>`;
    if (attributes.italic) content = `<em>${content}</em>`;
    if (attributes.underline) content = `<u>${content}</u>`;
    if (attributes.strike) content = `<s>${content}</s>`;
    if (styles.length) content = `<span style="${styles.join(';')}">${content}</span>`;
    return content;
  }

  function deltaToLines(delta) {
    const ops = delta && Array.isArray(delta.ops) ? delta.ops : [];
    const lines = [];
    let segments = [];

    const pushLine = (attrs) => {
      lines.push({ segments: segments.slice(), attrs: getDeltaLineAttrs(attrs) });
      segments = [];
    };

    for (const op of ops) {
      if (!op || typeof op !== 'object' || !('insert' in op)) continue;
      const attrs = op.attributes || {};
      const insert = op.insert;
      if (typeof insert === 'string') {
        const chunks = insert.split('\n');
        for (let i = 0; i < chunks.length; i += 1) {
          if (chunks[i]) segments.push({ kind: 'text', value: chunks[i], attrs });
          if (i < chunks.length - 1) pushLine(attrs);
        }
        continue;
      }
      if (insert && typeof insert === 'object' && typeof insert.image === 'string') {
        segments.push({ kind: 'image', value: insert.image, attrs: getDeltaImageAttributes(attrs) });
      }
    }
    if (segments.length || !lines.length) lines.push({ segments: segments.slice(), attrs: {} });
    return lines;
  }

  function renderDeltaLineSegments(segments) {
    if (!Array.isArray(segments) || !segments.length) return '<br>';
    let html = '';
    for (const segment of segments) {
      if (!segment || typeof segment !== 'object') continue;
      if (segment.kind === 'text') {
        html += renderInlineDeltaText(segment.value || '', segment.attrs || {});
      } else if (segment.kind === 'image' && typeof segment.value === 'string') {
        const normalizedSrc = normalizeCatalogTheoryImageRef(segment.value);
        if (!normalizedSrc) continue;
        const src = escapeHtml(normalizedSrc);
        const attrs = segment.attrs || {};
        const width = String(attrs.width || '100%').trim() || '100%';
        const align = String(attrs.align || 'left').trim() || 'left';
        const rotate = String(attrs.rotate || '0').trim() || '0';
        const float = String(attrs.float || 'none').trim() || 'none';
        const flip = String(attrs.flip || 'none').trim() || 'none';
        const flipScale = flip === 'horizontal' ? ' scaleX(-1)' : '';
        const transformStyle = rotate !== '0' || flip === 'horizontal' ? `transform:rotate(${rotate}deg)${flipScale};` : '';
        let imageLayoutStyle = 'display:block;';

        let wrapperStyle = '';
        if (float === 'left') wrapperStyle = 'display:inline-block;float:left;margin:0 16px 8px 0;';
        else if (float === 'right') wrapperStyle = 'display:inline-block;float:right;margin:0 0 8px 16px;';
        else {
          const textAlign = align === 'center' ? 'text-align:center;' : align === 'right' ? 'text-align:right;' : '';
          wrapperStyle = `display:block;${textAlign}`;
          if (align === 'center') imageLayoutStyle = 'display:block;margin-left:auto;margin-right:auto;';
          else if (align === 'right') imageLayoutStyle = 'display:block;margin-left:auto;';
        }

        html += `<span class="theory-image-wrapper" style="${wrapperStyle}"><img src="${src}" alt="" style="${imageLayoutStyle}max-width:${width};width:${width};border-radius:12px;${transformStyle}"></span>`;
      }
    }
    return html || '<br>';
  }

  function deltaToHtml(delta) {
    const blocks = [];
    const lines = deltaToLines(delta);
    let activeListType = null;
    let listItems = [];

    const flushList = () => {
      if (!activeListType || !listItems.length) {
        activeListType = null;
        listItems = [];
        return;
      }
      if (activeListType === 'ordered') blocks.push(`<ol style="list-style-type:decimal;padding-left:1.5rem;margin-bottom:0.5rem;">${listItems.join('')}</ol>`);
      else blocks.push(`<ul style="list-style-type:disc;padding-left:1.5rem;margin-bottom:0.5rem;">${listItems.join('')}</ul>`);
      activeListType = null;
      listItems = [];
    };

    for (const line of lines) {
      const attrs = line && typeof line === 'object' ? line.attrs || {} : {};
      const lineHtml = renderDeltaLineSegments(line && line.segments);
      const listType = attrs.list === 'ordered' ? 'ordered' : (attrs.list === 'bullet' || attrs.list === 'check' ? 'bullet' : null);

      if (listType) {
        if (activeListType && activeListType !== listType) flushList();
        activeListType = listType;
        listItems.push(`<li>${lineHtml}</li>`);
        continue;
      }

      flushList();
      const header = Number(attrs.header);
      if (Number.isInteger(header) && header >= 1 && header <= 6) {
        const fontSizes = { 1: '1.25rem', 2: '1.1rem', 3: '1rem' };
        const size = fontSizes[header] || '1rem';
        blocks.push(`<h${header} style="font-size:${size};font-weight:700;margin:1rem 0 0.5rem;">${lineHtml}</h${header}>`);
      } else if (attrs.blockquote) {
        blocks.push(`<blockquote style="border-left:4px solid var(--color-border-subtle);padding-left:0.75rem;font-style:italic;margin:0.5rem 0;">${lineHtml}</blockquote>`);
      } else {
        blocks.push(`<p style="margin-bottom:0.5rem;">${lineHtml}</p>`);
      }
    }
    flushList();
    return blocks.length ? blocks.join('') : '<p style="color:var(--color-text-secondary);">Теория пуста.</p>';
  }

  async function openTheoryModal(itemName, theoryId, options = {}) {
    const hasInlineItem = !!(options && typeof options === 'object' && options.item && typeof options.item === 'object');
    if (!theoryId && !hasInlineItem) return;
    const stale = global.document.getElementById('theory-viewer-dialog');
    if (stale) stale.remove();

    const shell = global.document.querySelector('.catalog-shell');
    if (shell) shell.classList.add('catalog-shell--blurred');

    try {
      let theoryItem = options && typeof options === 'object' && options.item && typeof options.item === 'object'
        ? options.item
        : null;
      if (!theoryItem) {
        const data = await fetchJson(`/api/theories/${encodeURIComponent(theoryId)}`);
        if (!data || !data.ok || !data.item) {
          showToast('Теория не загружена.', 'error');
          return;
        }
        theoryItem = data.item;
      }

      const html = deltaToHtml(theoryItem.delta);
      const updatedAt = theoryItem.updated_at ? formatRelativeDate(theoryItem.updated_at) : '—';

      const dialog = global.document.createElement('dialog');
      dialog.id = 'theory-viewer-dialog';
      dialog.className = 'theory-dialog';
      dialog.style.cssText = `
        border:none; padding:0; margin:auto; width:calc(100vw - 2rem); max-width:56rem;
        max-height:calc(100dvh - 2rem); border-radius:2.5rem; overflow:hidden;
        box-shadow:0 32px 80px -16px rgba(0,0,0,0.6); background:var(--color-surface-1,#fff);
        border:2px solid var(--color-border-strong,#cbd5e1); display:flex; flex-direction:column;
        transform:scale(0.92) translateY(20px); opacity:0;
        transition:transform 0.35s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease;
      `;

      dialog.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:1.5rem;padding:1.5rem 2rem;border-bottom:2px solid var(--color-border-subtle);background:var(--color-bg-secondary);flex-shrink:0;">
          <div style="min-width:0;flex:1;">
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.2rem;">
              <span class="material-symbols-outlined" style="font-size:17px;color:var(--color-primary);flex-shrink:0;">menu_book</span>
              <p style="font-size:1.0625rem;font-weight:800;color:var(--color-text-main);margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-0.02em;">${escapeHtml(theoryItem.title || 'Теория')}</p>
            </div>
            <p style="font-size:0.7rem;color:var(--color-text-secondary);margin:0;display:flex;align-items:center;gap:0.3rem;flex-wrap:wrap;">
              <span class="material-symbols-outlined" style="font-size:13px;">inventory_2</span>
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${escapeHtml(itemName || '—')}</span>
              <span>•</span>
              <span class="material-symbols-outlined" style="font-size:13px;">history</span>
              <span>Обновлено: ${escapeHtml(updatedAt)}</span>
            </p>
          </div>
          <button type="button" class="theory-dialog-close" style="display:flex;align-items:center;justify-content:center;width:2.1rem;height:2.1rem;border-radius:0.5rem;border:none;background:transparent;color:var(--color-text-secondary);cursor:pointer;">
            <span class="material-symbols-outlined" style="font-size:24px;">close</span>
          </button>
        </div>
        <div style="padding:1.625rem 1.75rem;overflow-y:auto;flex:1;min-height:180px;color:var(--color-text-main);line-height:1.7;font-size:0.9375rem;">
          ${html}
        </div>
      `;

      global.document.body.appendChild(dialog);
      dialog.showModal();

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          dialog.style.transform = 'scale(1) translateY(0)';
          dialog.style.opacity = '1';
        });
      });

      const close = () => {
        dialog.style.transform = 'scale(0.94) translateY(10px)';
        dialog.style.opacity = '0';
        if (shell) shell.classList.remove('catalog-shell--blurred');
        setTimeout(() => { dialog.close(); dialog.remove(); }, 280);
      };

      dialog.querySelector('.theory-dialog-close').addEventListener('click', close);
      dialog.addEventListener('click', (e) => {
        if (e.target === dialog) close();
      });
      dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(); });

    } catch (err) {
      console.error('Failed to open theory modal', err);
      showToast('Окно теории не открыто.', 'error');
    }
  }

  async function loadVersionDetail(item) {
    const itemId = asString(item && item.item_id);
    const versionId = asString(item && item.latest_version_id);
    if (!itemId || !versionId) return null;
    const cacheKey = `${itemId}:${versionId}`;
    if (state.versionCache.has(cacheKey)) return state.versionCache.get(cacheKey);
    try {
      const payload = await fetchJson(
        `/api/catalog/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(versionId)}`,
        { method: 'GET', credentials: 'same-origin' }
      );
      const version = payload && typeof payload.version === 'object' ? payload.version : {};
      state.versionCache.set(cacheKey, version);
      return version;
    } catch (error) {
      console.warn('[Catalog] Failed to load version detail:', error);
      return null;
    }
  }

  async function loadComplexLibraryEntryDetail(libraryEntryId, options = {}) {
    const entryId = asString(libraryEntryId);
    if (!entryId) return null;
    const cacheKey = options && options.accessCode ? `${entryId}:${asString(options.accessCode)}` : entryId;
    if (!options.force && state.complexLibraryDetailCache.has(cacheKey)) {
      return state.complexLibraryDetailCache.get(cacheKey);
    }
    const payload = options && options.accessCode
      ? await fetchJson(`/api/complex-library/${encodeURIComponent(entryId)}/access-code`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_code: options.accessCode }),
      })
      : await fetchJson(`/api/complex-library/${encodeURIComponent(entryId)}`, {
        method: 'GET',
        credentials: 'same-origin',
      });
    state.complexLibraryDetailCache.set(cacheKey, payload);
    const versionId = asString(payload && payload.version && payload.version.version_id);
    const itemId = asString(payload && payload.item && payload.item.item_id);
    const versionKey = itemId && versionId ? `${itemId}:${versionId}` : '';
    if (versionKey) state.statusByVersionKey.set(versionKey, payload);
    return payload;
  }

  const els = {};

  function $(id) {
    return global.document.getElementById(id);
  }

  function asString(value) {
    return String(value == null ? '' : value).trim();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function navigate(url) {
    const target = asString(url);
    if (!target) return;
    if (typeof global.navigateWithTransition === 'function') {
      global.navigateWithTransition(target);
      return;
    }
    global.location.href = target;
  }

  function resolveSavedCatalogUrl() {
    return '/ui/catalog?content_type=saved';
  }

  function resolveComplexesLibraryUrl() {
    return '/ui/complexes';
  }

  function debounce(fn, delay) {
    let timer = 0;
    return function debounced(...args) {
      global.clearTimeout(timer);
      timer = global.setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function showToast(message, variant = 'info', timeout = 3200) {
    const text = asString(message);
    if (!text) return;
    if (global.NotificationUI && typeof global.NotificationUI.toast === 'function') {
      global.NotificationUI.toast(text, variant, timeout);
      return;
    }
    console.info('[Catalog]', text);
  }

  function formatRelativeDate(value) {
    const raw = asString(value);
    if (!raw) return 'Дата не указана';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    const deltaMs = Date.now() - date.getTime();
    const deltaDays = Math.round(deltaMs / 86400000);
    if (Math.abs(deltaDays) < 1) return 'Сегодня';
    if (deltaDays === 1) return 'Вчера';
    if (deltaDays > 1 && deltaDays < 7) return `${deltaDays} дн. назад`;
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  function normalizeCount(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function getLatestManifest(item) {
    return (item && typeof item.latest_manifest === 'object') ? item.latest_manifest : {};
  }

  function getDependencyCounts(item) {
    const manifest = getLatestManifest(item);
    return (manifest && typeof manifest.dependency_counts === 'object') ? manifest.dependency_counts : {};
  }

  function getTaskCount(item) {
    const manifest = getLatestManifest(item);
    return normalizeCount(manifest.task_count || getDependencyCounts(item).tasks);
  }

  function getTheoryCount(item) {
    return normalizeCount(getDependencyCounts(item).theories);
  }

  function getFreshnessLabel(item) {
    return formatRelativeDate(item && item.latest_published_at);
  }

  function getVersionKey(item) {
    const itemId = asString(item && item.item_id);
    if (item && item.content_type === 'theory') return itemId;
    const versionId = asString(item && item.latest_version_id);
    return itemId && versionId ? `${itemId}:${versionId}` : '';
  }

  function isSavedComplexItem(item) {
    return !!(item && item.content_type === 'complex' && item.is_saved_complex && item.linked_library_entry_id);
  }

  function getStatus(item) {
    const key = getVersionKey(item);
    return key ? state.statusByVersionKey.get(key) || null : null;
  }

  function isOwnPublication(item) {
    const ownerId = asString(item && item.owner_user_id);
    const currentUserId = asString(state.currentUser && state.currentUser.user_id);
    return !!ownerId && !!currentUserId && ownerId === currentUserId;
  }

  function getDisplayOwnerLegacy(item) {
    if (isOwnPublication(item)) return 'Вы';
    return asString(item && item.owner_user_id) || 'Не указан';
  }

  function getDescription(item) {
    const text = asString(item && item.description);
    if (text) return text;
    if (isSavedComplexItem(item)) {
      return 'Связанная публикация сохраняется в каталоге и открывается только для чтения.';
    }
    return item && item.content_type === 'theory'
      ? 'Можно добавить в Теоретический центр как связанную публикацию.'
      : 'Можно сохранить в каталоге как связанную публикацию и просматривать без создания отдельной версии в workspace.';
  }

  function getTypeLabel(item) {
    return item && item.content_type === 'theory' ? 'Теория' : 'Комплекс';
  }

  function getTypeKey(item) {
    return item && item.content_type === 'theory' ? 'theory' : 'complex';
  }

  function getTypeIcon(item) {
    return getTypeKey(item) === 'theory' ? 'menu_book' : 'account_tree';
  }

  function getTypeBadgeClass(item) {
    return getTypeKey(item) === 'theory'
      ? 'catalog-badge catalog-badge--type catalog-badge--theory'
      : 'catalog-badge catalog-badge--type catalog-badge--complex';
  }

  function getTheoryMetaText(item) {
    const theoryCount = getTheoryCount(item);
    if (theoryCount > 2) return `${theoryCount} теории`;
    if (theoryCount > 0) return 'Есть теория';
    return '';
  }

  function getCardStatusBadge(item) {
    if (isOwnPublication(item)) {
      return { text: 'Моя публикация', icon: 'person', className: 'catalog-badge catalog-badge--primary' };
    }
    const status = getStatus(item);
    if (status && status.library_status && status.library_status.already_in_library) {
      const accessState = asString(status.library_status.access_state);
      if (accessState === 'requires_access_code') {
        return { text: 'Нужен код', icon: 'password', className: 'catalog-badge catalog-badge--warning' };
      }
      if (accessState === 'revoked' || accessState === 'deleted_source') {
        return { text: 'Доступ закрыт', icon: 'lock', className: 'catalog-badge catalog-badge--muted' };
      }
      return { text: 'Добавлен', icon: 'bookmark_added', className: 'catalog-badge catalog-badge--success' };
    }
    return null;
  }

  function getPrimaryAction(item) {
    const latestVersionId = asString(item && item.latest_version_id);
    if (!latestVersionId) {
      return { key: 'unavailable', label: 'Нет версии', className: 'catalog-card__button catalog-card__button--ghost', disabled: true };
    }
    if (!state.authenticated) {
      return { key: 'login', label: 'Войти, чтобы добавить', className: 'btn-secondary catalog-card__button' };
    }
    if (isOwnPublication(item)) {
      return null;
    }
    const status = getStatus(item);
    if (status && status.library_status && status.library_status.already_in_library) {
      const accessState = asString(status.library_status.access_state);
      if (accessState === 'requires_access_code') {
        return { key: 'open-library', label: 'Ввести код', className: 'btn-secondary catalog-card__button' };
      }
      return { key: 'open-library', label: 'Открыть в библиотеке', className: 'btn-secondary catalog-card__button' };
    }
    return { key: 'preview', label: 'Добавить в библиотеку', className: 'btn-primary catalog-card__button' };
  }

  function getRelationshipBadge(item) {
    if (!item || state.contentType === 'saved') return null;
    if (item.content_type === 'complex' && item.linked_theory_item && asString(item.linked_theory_item.item_id)) {
      return {
        text: '\u0421\u0432\u044f\u0437\u0430\u043d\u043d\u0430\u044f \u0442\u0435\u043e\u0440\u0438\u044f',
        icon: 'hub',
        className: 'catalog-badge catalog-badge--linked',
      };
    }
    if (item.content_type === 'theory') {
      const linkedComplexCount = normalizeCount(item.linked_complex_count);
      if (linkedComplexCount > 1) {
        return {
          text: `\u0412 ${linkedComplexCount} \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u0430\u0445`,
          icon: 'hub',
          className: 'catalog-badge catalog-badge--linked',
        };
      }
      if (linkedComplexCount === 1) {
        return {
          text: '\u0412\u0445\u043e\u0434\u0438\u0442 \u0432 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0442',
          icon: 'hub',
          className: 'catalog-badge catalog-badge--linked',
        };
      }
    }
    return null;
  }

  function getBundleActionLabel(item, action) {
    if (!action) return '';
    if (action.key !== 'preview') return action.label;
    return item && item.content_type === 'theory'
      ? '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0442\u0435\u043e\u0440\u0438\u044e'
      : '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441';
  }

  function fetchJson(url, options) {
    return global.fetch(url, options).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        const error = asString(payload && payload.error) || `http_${response.status}`;
        const detail = new Error(error);
        detail.payload = payload;
        detail.status = response.status;
        throw detail;
      }
      return payload;
    });
  }

  async function loadCurrentUser() {
    try {
      const payload = await fetchJson('/api/auth/me', { method: 'GET', credentials: 'same-origin' });
      state.currentUser = payload && payload.user ? payload.user : null;
      state.authenticated = !!(payload && payload.authenticated);
    } catch (error) {
      state.currentUser = null;
      state.authenticated = false;
    }
    els.authNote.classList.toggle('is-visible', !state.authenticated);
  }

  async function loadWorkspaceLimits() {
    try {
      const payload = await fetchJson('/api/workspace-limits/summary', { method: 'GET', credentials: 'same-origin' });
      state.workspaceLimits = payload;
      return payload;
    } catch (error) {
      state.workspaceLimits = null;
      return null;
    }
  }

  function isPremiumWorkspacePlan() {
    return asString(state.workspaceLimits?.plan).toLowerCase() === 'premium';
  }

  function getWorkspaceLimitEntity(kind) {
    const key = kind === 'theory' ? 'theories' : kind === 'complex' ? 'complexes' : 'tasks';
    return state.workspaceLimits && typeof state.workspaceLimits[key] === 'object'
      ? state.workspaceLimits[key]
      : null;
  }

  function getWorkspaceLimitMessage(entitySummary, options = {}) {
    if (!entitySummary || isPremiumWorkspacePlan()) return '';
    const label = asString(options.label) || 'элементов';
    const personalCount = Number(entitySummary.personal_count || 0);
    const personalLimit = Number(entitySummary.personal_limit || 0);
    const libraryCount = Number(entitySummary.library_total_count || 0);
    const libraryLimit = Number(entitySummary.library_limit || 0);
    if (Number(entitySummary.remaining_personal || 0) <= 0 && Number(entitySummary.remaining_library || 0) <= 0) {
      return `Лимит ${label} достигнут: свои ${personalCount}/${personalLimit}, библиотека ${libraryCount}/${libraryLimit}.`;
    }
    if (Number(entitySummary.remaining_library || 0) <= 0) {
      return `Библиотека ${label} заполнена: ${libraryCount}/${libraryLimit}.`;
    }
    if (Number(entitySummary.remaining_personal || 0) <= 0) {
      return `Лимит своих ${label} достигнут: ${personalCount}/${personalLimit}.`;
    }
    return '';
  }

  function buildWorkspaceLimitNote(preview) {
    const evaluation = preview && preview.workspace_limits && typeof preview.workspace_limits === 'object'
      ? preview.workspace_limits
      : null;
    const summary = evaluation && evaluation.summary ? evaluation.summary : state.workspaceLimits;
    if (!summary) return '';
    if (isPremiumWorkspacePlan()) return 'Premium-план: лимиты библиотеки не применяются.';

    const notes = [];
    const theories = summary && typeof summary.theories === 'object' ? summary.theories : null;
    const complexes = summary && typeof summary.complexes === 'object' ? summary.complexes : null;
    const createdCounts = preview?.summary?.created_counts || {};
    if (preview?.item?.content_type === 'theory' && theories) {
      notes.push(`Теории в библиотеке: ${Number(theories.library_total_count || 0)}/${Number(theories.library_limit || 0)}.`);
      if (Number(createdCounts.theories || 0) > 0) notes.push('После добавления будет занят 1 слот теории.');
    }
    if (preview?.item?.content_type === 'complex' && complexes) {
      notes.push(`Комплексы в библиотеке: ${Number(complexes.library_total_count || 0)}/${Number(complexes.library_limit || 0)}.`);
      if (Number(createdCounts.complexes || 0) > 0) notes.push('После добавления будет занят 1 слот комплекса.');
      if (Number(createdCounts.theories || 0) > 0 && theories) {
        notes.push(`Связанная теория тоже займет слот: ${Number(theories.library_total_count || 0)}/${Number(theories.library_limit || 0)} сейчас.`);
      }
    }
    if (preview?.blocked && Array.isArray(evaluation?.errors) && evaluation.errors.length) {
      notes.push(getWorkspaceLimitMessage(
        preview.item?.content_type === 'theory' ? theories : complexes,
        { label: preview.item?.content_type === 'theory' ? 'теорий' : 'комплексов' }
      ));
    }
    return notes.filter(Boolean).join(' ');
  }

  function getCurrentCatalogUserId() {
    return asString(state.currentUser && state.currentUser.user_id);
  }

  function buildPublicListUrl() {
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    if (state.contentType !== 'all') params.set('content_type', state.contentType);
    const qs = params.toString();
    return qs ? `/api/catalog/items?${qs}` : '/api/catalog/items';
  }

  function buildListUrl() {
    if (state.contentType === 'saved') return '/api/complex-library';
    return buildPublicListUrl();
  }

  function mapSavedComplexEntryToItem(entry) {
    const libraryEntry = entry && typeof entry.library_entry === 'object' ? entry.library_entry : {};
    const item = entry && typeof entry.item === 'object' ? entry.item : {};
    const version = entry && typeof entry.version === 'object' ? entry.version : {};
    return {
      ...item,
      latest_version_id: asString(version.version_id || item.latest_version_id),
      latest_published_at: asString(version.published_at || item.latest_published_at),
      linked_library_entry_id: asString(libraryEntry.library_entry_id),
      linked_access_state: asString(libraryEntry.access_state),
      linked_access_reason: asString(libraryEntry.access_reason),
      is_saved_complex: true,
    };
  }

  function filterSavedComplexItems(items) {
    const query = asString(state.query).toLowerCase();
    if (!query) return items.slice();
    return items.filter((item) => {
      const haystack = [
        asString(item.title),
        asString(item.description),
        asString(item.item_id),
        asString(item.owner_display_name),
        asString(item.owner_user_id),
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  function getDisplayOwner(item) {
    const ownerDisplayName = asString(item && (item.owner_display_name || item.owner_name));
    if (isOwnPublication(item)) return '\u0412\u044b';
    return ownerDisplayName || asString(item && item.owner_user_id) || '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d';
  }

  async function loadCatalogItems() {
    const requestId = ++state.listRequestId;
    state.loading = true;
    state.error = '';
    render();
    if (state.contentType === 'saved' && !state.authenticated) {
      state.loading = false;
      state.items = [];
      state.filteredItems = [];
      state.error = '';
      render();
      return;
    }
    try {
      const payload = await fetchJson(buildListUrl(), { method: 'GET', credentials: 'same-origin' });
      if (requestId !== state.listRequestId) return;
      if (state.contentType === 'saved') {
        state.savedComplexEntries = Array.isArray(payload.entries) ? payload.entries : [];
        state.items = state.savedComplexEntries.map(mapSavedComplexEntryToItem);
        state.filteredItems = filterSavedComplexItems(state.items);
        state.items.forEach((item, index) => {
          const entry = state.savedComplexEntries[index];
          const key = getVersionKey(item);
          if (!key) return;
          state.statusByVersionKey.set(key, {
            ok: true,
            item: entry && entry.item,
            version: entry && entry.version,
            library_entry: entry && entry.library_entry,
            library_status: {
              already_in_library: true,
              action: asString((entry && entry.library_entry && entry.library_entry.access_state) === 'requires_access_code' ? 'enter_access_code' : 'open_linked'),
              content_type: 'complex',
              library_entity_id: entry && entry.library_entry && entry.library_entry.library_entry_id,
              library_entity_ref: entry && entry.item && entry.item.item_id,
              access_state: entry && entry.library_entry && entry.library_entry.access_state,
              access_reason: entry && entry.library_entry && entry.library_entry.access_reason,
              locked: ['requires_access_code', 'revoked', 'deleted_source'].includes(asString(entry && entry.library_entry && entry.library_entry.access_state)),
            },
          });
        });
      } else {
        state.items = Array.isArray(payload.items) ? payload.items : [];
        state.filteredItems = state.items.slice();
      }
      if (!state.filteredItems.some((item) => asString(item.item_id) === state.selectedItemId)) {
        state.selectedItemId = state.filteredItems[0] ? asString(state.filteredItems[0].item_id) : '';
      }
      state.loading = false;
      render();
      refreshVisibleStatuses();
    } catch (error) {
      if (requestId !== state.listRequestId) return;
      state.loading = false;
      state.items = [];
      state.filteredItems = [];
      state.error = error && error.message ? error.message : 'catalog_list_failed';
      render();
    }
  }

  async function refreshVisibleStatuses() {
    if (!state.authenticated) return;
    if (state.contentType === 'saved') return;
    const requests = state.filteredItems
      .map((item) => ({ item, versionKey: getVersionKey(item) }))
      .filter(({ item, versionKey }) => versionKey && !state.statusByVersionKey.has(versionKey) && !state.pendingStatusKeys.has(versionKey))
      .map(({ item, versionKey }) => {
        state.pendingStatusKeys.add(versionKey);
        const statusUrl = `/api/catalog/items/${encodeURIComponent(asString(item.item_id))}/library-status`;
        return fetchJson(statusUrl, { method: 'GET', credentials: 'same-origin' })
          .then((payload) => {
            state.statusByVersionKey.set(versionKey, payload);
          })
          .catch(() => {
            state.statusByVersionKey.set(versionKey, {
              ok: false,
              library_status: {
                already_in_library: false,
                action: 'create_link',
                content_type: item.content_type,
              },
            });
          })
          .finally(() => {
            state.pendingStatusKeys.delete(versionKey);
          });
      });
    if (!requests.length) return;
    await Promise.allSettled(requests);
    render();
  }

  function renderSummary() {
    const total = state.filteredItems.length;
    const typeLabel =
      state.contentType === 'saved' ? 'сохранённых комплексов'
        : state.contentType === 'complex' ? 'комплексов'
        : state.contentType === 'theory' ? 'теорий'
          : 'публикаций';
    if (state.loading) {
      els.summary.textContent = 'Загружаем каталог…';
      return;
    }
    if (state.error) {
      els.summary.textContent = 'Каталог сейчас недоступен';
      return;
    }
    if (!total) {
      els.summary.textContent = 'Пустой результат поиска';
      return;
    }
    els.summary.textContent = `Найдено ${total} ${typeLabel}`;
  }

  function buildCatalogRenderEntries(items) {
    const sourceItems = Array.isArray(items) ? items : [];
    if (state.contentType !== 'all') {
      return sourceItems.map((item) => ({ kind: 'single', item }));
    }
    const itemById = new Map();
    sourceItems.forEach((item) => {
      const itemId = asString(item && item.item_id);
      if (itemId) itemById.set(itemId, item);
    });
    const consumedIds = new Set();
    const entries = [];
    sourceItems.forEach((item) => {
      const itemId = asString(item && item.item_id);
      if (!itemId || consumedIds.has(itemId)) return;
      const bundle = item && typeof item.bundle === 'object' ? item.bundle : null;
      const pairedItemId = asString(bundle && bundle.paired_item_id);
      const pairedItem = pairedItemId ? itemById.get(pairedItemId) : null;
      if (pairedItem && !consumedIds.has(pairedItemId)) {
        const complexItem = item && item.content_type === 'complex'
          ? item
          : pairedItem && pairedItem.content_type === 'complex'
            ? pairedItem
            : null;
        const theoryItem = item && item.content_type === 'theory'
          ? item
          : pairedItem && pairedItem.content_type === 'theory'
            ? pairedItem
            : null;
        if (complexItem && theoryItem) {
          entries.push({
            kind: 'bundle',
            bundleId: asString(bundle && bundle.bundle_id) || `${asString(complexItem.item_id)}::${asString(theoryItem.item_id)}`,
            complexItem,
            theoryItem,
          });
          consumedIds.add(asString(complexItem.item_id));
          consumedIds.add(asString(theoryItem.item_id));
          return;
        }
      }
      consumedIds.add(itemId);
      entries.push({ kind: 'single', item });
    });
    return entries;
  }

  function createCatalogCardElement(item, options = {}) {
    const { showPrimaryAction = true, withinBundle = false } = options;
    const card = global.document.createElement('article');
    const cardStatusBadge = getCardStatusBadge(item);
    const relationshipBadge = getRelationshipBadge(item);
    const theoryMeta = item.content_type === 'complex' ? getTheoryMetaText(item) : '';
    const primaryAction = showPrimaryAction ? getPrimaryAction(item) : null;
    const isSelected = asString(item.item_id) === state.selectedItemId;
    const typeKey = getTypeKey(item);
    card.className = `catalog-card catalog-card--${typeKey}${withinBundle ? ' catalog-card--bundled' : ''}${isSelected ? ' is-selected' : ''}`;
    card.setAttribute('data-item-id', asString(item.item_id));
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    card.innerHTML = `
        <div class="catalog-card__header">
          <div class="catalog-card__byline">
            <span class="catalog-card__meta-item">
              <span class="material-symbols-outlined">person</span>
              ${escapeHtml(getDisplayOwner(item))}
            </span>
            <span class="catalog-card__meta-item">
              <span class="material-symbols-outlined">schedule</span>
              ${escapeHtml(getFreshnessLabel(item))}
            </span>
          </div>
          <div class="catalog-card__badges">
            <span class="${escapeHtml(getTypeBadgeClass(item))}">
              <span class="material-symbols-outlined">${escapeHtml(getTypeIcon(item))}</span>
              ${escapeHtml(getTypeLabel(item))}
            </span>
            ${cardStatusBadge ? `
              <span class="${escapeHtml(cardStatusBadge.className)}">
                ${cardStatusBadge.icon ? `<span class="material-symbols-outlined">${escapeHtml(cardStatusBadge.icon)}</span>` : ''}
                ${escapeHtml(cardStatusBadge.text)}
              </span>
            ` : ''}
            ${relationshipBadge ? `
              <span class="${escapeHtml(relationshipBadge.className)}">
                ${relationshipBadge.icon ? `<span class="material-symbols-outlined">${escapeHtml(relationshipBadge.icon)}</span>` : ''}
                ${escapeHtml(relationshipBadge.text)}
              </span>
            ` : ''}
          </div>
        </div>
        <div>
          <h2 class="catalog-card__title" title="${escapeHtml(asString(item.title) || 'Без названия')}">${escapeHtml(asString(item.title) || 'Без названия')}</h2>
          <p class="catalog-card__description" title="${escapeHtml(getDescription(item))}">${escapeHtml(getDescription(item))}</p>
        </div>
        <div class="catalog-card__meta">
          <span class="catalog-card__meta-item">
            <span class="material-symbols-outlined">task_alt</span>
            ${item.content_type === 'complex' ? `${escapeHtml(String(getTaskCount(item)))} заданий` : `${escapeHtml(String(normalizeCount(getLatestManifest(item).image_count || 0)))} изображ.`}
          </span>
          ${theoryMeta ? `
            <span class="catalog-card__meta-item">
              <span class="material-symbols-outlined">menu_book</span>
              ${escapeHtml(theoryMeta)}
            </span>
          ` : ''}
        </div>
        ${primaryAction ? `
          <div class="catalog-card__footer">
            <div class="catalog-card__actions">
              <button type="button" class="${escapeHtml(primaryAction.className)}" data-action="${escapeHtml(primaryAction.key)}"${primaryAction.disabled ? ' disabled' : ''}>
                ${escapeHtml(primaryAction.label)}
              </button>
            </div>
          </div>
        ` : ''}
      `;
    card.addEventListener('click', () => selectItem(asString(item.item_id)));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectItem(asString(item.item_id));
      }
    });
    if (primaryAction) {
      card.querySelector(`[data-action="${primaryAction.key}"]`)?.addEventListener('click', async (event) => {
        event.stopPropagation();
        selectItem(asString(item.item_id));
        await handlePrimaryAction(item);
      });
    }
    return card;
  }

  function createBundleActionButton(item) {
    const primaryAction = getPrimaryAction(item);
    if (!primaryAction) return null;
    const button = global.document.createElement('button');
    button.type = 'button';
    button.className = primaryAction.className;
    button.textContent = getBundleActionLabel(item, primaryAction);
    if (primaryAction.disabled) button.disabled = true;
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      selectItem(asString(item.item_id));
      await handlePrimaryAction(item);
    });
    return button;
  }

  function createCatalogBundleElement(complexItem, theoryItem) {
    const bundle = global.document.createElement('section');
    const isSelected = [complexItem, theoryItem].some((item) => asString(item && item.item_id) === state.selectedItemId);
    bundle.className = `catalog-bundle${isSelected ? ' is-selected' : ''}`;
    bundle.setAttribute('data-bundle-id', `${asString(complexItem && complexItem.item_id)}::${asString(theoryItem && theoryItem.item_id)}`);
    bundle.innerHTML = `
      <div class="catalog-bundle__header">
        <div>
          <p class="catalog-bundle__eyebrow">\u0421\u0432\u044f\u0437\u0430\u043d\u043d\u044b\u0435 \u043f\u0443\u0431\u043b\u0438\u043a\u0430\u0446\u0438\u0438</p>
        </div>
      </div>
      <div class="catalog-bundle__cards">
        <div class="catalog-bundle__connector" aria-hidden="true">
          <span class="material-symbols-outlined">link</span>
        </div>
      </div>
      <div class="catalog-bundle__actions"></div>
    `;
    const cardsHost = bundle.querySelector('.catalog-bundle__cards');
    cardsHost?.appendChild(createCatalogCardElement(complexItem, { showPrimaryAction: false, withinBundle: true }));
    cardsHost?.appendChild(createCatalogCardElement(theoryItem, { showPrimaryAction: false, withinBundle: true }));
    const actionsHost = bundle.querySelector('.catalog-bundle__actions');
    const complexActionButton = createBundleActionButton(complexItem);
    const theoryActionButton = createBundleActionButton(theoryItem);
    if (complexActionButton) actionsHost?.appendChild(complexActionButton);
    if (theoryActionButton) actionsHost?.appendChild(theoryActionButton);
    if (!complexActionButton && !theoryActionButton) {
      actionsHost?.classList.add('catalog-bundle__actions--empty');
    }
    return bundle;
  }

  function renderCards() {
    els.grid.innerHTML = '';
    if (state.loading || state.error || !state.filteredItems.length) return;
    const fragment = global.document.createDocumentFragment();
    buildCatalogRenderEntries(state.filteredItems).forEach((entry) => {
      if (entry.kind === 'bundle') {
        fragment.appendChild(createCatalogBundleElement(entry.complexItem, entry.theoryItem));
        return;
      }
      fragment.appendChild(createCatalogCardElement(entry.item));
    });
    els.grid.appendChild(fragment);
  }

  function triggerPanelContentAnimation(blockEl) {
    if (!blockEl) return;
    blockEl.classList.remove('catalog-animate-in');
    void blockEl.offsetWidth; // Force a CSS reflow
    blockEl.classList.add('catalog-animate-in');
  }

  function isPointerNearPreviewScrollbar(element, event) {
    if (!element || !event) return false;
    if (element.scrollHeight <= element.clientHeight + 1) return false;
    const rect = element.getBoundingClientRect();
    const nativeScrollbarWidth = Math.max(0, element.offsetWidth - element.clientWidth);
    const interactiveWidth = Math.max(nativeScrollbarWidth + 6, 18);
    return event.clientX >= rect.right - interactiveWidth;
  }

  function bindTheoryPreviewInteractions(previewEl, openPreviewTheory) {
    if (!previewEl || typeof openPreviewTheory !== 'function') return;
    let suppressNextClick = false;
    let scrollIntentTimer = null;

    const setScrollIntent = (enabled) => {
      previewEl.classList.toggle('is-scroll-intent', !!enabled);
    };

    previewEl.addEventListener('pointermove', (event) => {
      setScrollIntent(isPointerNearPreviewScrollbar(previewEl, event));
    });

    previewEl.addEventListener('pointerleave', () => {
      setScrollIntent(false);
    });

    previewEl.addEventListener('pointerdown', (event) => {
      suppressNextClick = isPointerNearPreviewScrollbar(previewEl, event);
      setScrollIntent(suppressNextClick);
    });

    previewEl.addEventListener('scroll', () => {
      setScrollIntent(true);
      if (scrollIntentTimer) global.clearTimeout(scrollIntentTimer);
      scrollIntentTimer = global.setTimeout(() => {
        setScrollIntent(false);
        scrollIntentTimer = null;
      }, 180);
    });

    previewEl.addEventListener('click', (event) => {
      if (suppressNextClick || isPointerNearPreviewScrollbar(previewEl, event)) {
        suppressNextClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      suppressNextClick = false;
      openPreviewTheory();
    });

    previewEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openPreviewTheory();
      }
    });
  }

  function syncTheoryPreviewLayout(previewEl) {
    if (!previewEl) return;
    const canvas = previewEl.querySelector('.catalog-detail__theory-preview-canvas');
    const inner = previewEl.querySelector('.catalog-detail__theory-preview-inner');
    if (!canvas || !inner) return;
    const previewScale = 0.5;

    const applyLayout = () => {
      const previousDetailHeight = els.detail ? els.detail.offsetHeight : 0;
      const naturalHeight = Math.max(inner.scrollHeight, inner.offsetHeight, inner.clientHeight);
      const height = Math.max(1, Math.ceil(naturalHeight * previewScale));
      canvas.style.width = '100%';
      canvas.style.height = `${height}px`;

      if (els.detail) {
        global.requestAnimationFrame(() => {
          smoothSyncDetailHeight(previousDetailHeight);
        });
      }
    };

    global.requestAnimationFrame(() => {
      applyLayout();
      global.requestAnimationFrame(applyLayout);
    });

    if (typeof global.ResizeObserver === 'function' && !previewEl.__catalogTheoryPreviewObserver) {
      const observer = new global.ResizeObserver(() => {
        applyLayout();
      });
      observer.observe(inner);
      previewEl.__catalogTheoryPreviewObserver = observer;
    }

    inner.querySelectorAll('img').forEach((img) => {
      if (!img.complete) {
        img.addEventListener('load', applyLayout, { once: true });
        img.addEventListener('error', applyLayout, { once: true });
      }
    });
  }

  function smoothSyncDetailHeight(previousHeight = 0) {
    if (!els.detail) return;
    const detail = els.detail;
    const startHeight = Math.max(1, Math.ceil(previousHeight || detail.offsetHeight || 0));

    detail.style.transition = 'none';
    detail.style.height = `${startHeight}px`;
    detail.style.overflow = 'hidden';
    void detail.offsetWidth;

    const targetHeight = getDetailNaturalHeight();
    if (Math.abs(startHeight - targetHeight) <= 1) return;

    if (detail.__catalogHeightCleanupTimer) {
      global.clearTimeout(detail.__catalogHeightCleanupTimer);
      detail.__catalogHeightCleanupTimer = null;
    }

    const shrinking = targetHeight < startHeight;
    const duration = shrinking ? 340 : 220;
    const easing = shrinking
      ? 'cubic-bezier(0.22, 1, 0.36, 1)'
      : 'cubic-bezier(0.4, 0, 0.2, 1)';
    animateDetailHeight(startHeight, targetHeight, duration, easing);
  }

  function snapDetailHeightToContent() {
    if (!els.detail) return;
    const detail = els.detail;
    if (detail.__catalogHeightCleanupTimer) {
      global.clearTimeout(detail.__catalogHeightCleanupTimer);
      detail.__catalogHeightCleanupTimer = null;
    }
    detail.style.transition = 'none';
    detail.style.height = `${getDetailNaturalHeight()}px`;
    detail.style.overflow = 'hidden';
    global.requestAnimationFrame(() => {
      detail.style.transition = '';
      detail.style.height = '';
      detail.style.overflow = '';
    });
  }

  function animateDetailHeight(startHeight, targetHeight, duration, easing) {
    if (!els.detail) return;
    const detail = els.detail;

    if (detail.__catalogHeightCleanupTimer) {
      global.clearTimeout(detail.__catalogHeightCleanupTimer);
      detail.__catalogHeightCleanupTimer = null;
    }

    detail.style.transition = 'none';
    detail.style.height = `${startHeight}px`;
    detail.style.overflow = 'hidden';
    void detail.offsetWidth;

    global.requestAnimationFrame(() => {
      global.requestAnimationFrame(() => {
        detail.style.transition = `height ${duration}ms ${easing}`;
        detail.style.height = `${targetHeight}px`;

        detail.__catalogHeightCleanupTimer = global.setTimeout(() => {
          detail.style.transition = '';
          detail.style.height = '';
          detail.style.overflow = '';
          detail.__catalogHeightCleanupTimer = null;
        }, duration + 30);
      });
    });
  }

  function getDetailNaturalHeight() {
    if (!els.detail) return 0;
    const detail = els.detail;
    const previousHeight = detail.style.height;
    const previousOverflow = detail.style.overflow;
    const previousTransition = detail.style.transition;

    detail.style.transition = 'none';
    detail.style.height = '';
    detail.style.overflow = '';
    const naturalHeight = Math.max(1, Math.ceil(detail.scrollHeight || detail.offsetHeight || 0));

    detail.style.height = previousHeight;
    detail.style.overflow = previousOverflow;
    detail.style.transition = previousTransition;

    return naturalHeight;
  }

  function renderDetailWithAnimation(updateFn, duration = 400) {
    if (!els.detail) {
      updateFn();
      return;
    }
    const oldHeight = els.detail.offsetHeight;
    els.detail.style.height = `${oldHeight}px`;
    els.detail.style.overflow = 'hidden';
    els.detail.style.transition = 'none';
    void els.detail.offsetWidth;

    updateFn();

    const newHeight = getDetailNaturalHeight();
    if (oldHeight > 0 && newHeight > 0 && Math.abs(oldHeight - newHeight) > 1) {
      const shrinking = newHeight < oldHeight;
      const resolvedDuration = shrinking ? Math.max(duration, 340) : duration;
      const easing = shrinking
        ? 'cubic-bezier(0.22, 1, 0.36, 1)'
        : 'cubic-bezier(0.4, 0, 0.2, 1)';
      animateDetailHeight(oldHeight, newHeight, resolvedDuration, easing);
      return;
    }

    els.detail.style.transition = '';
    els.detail.style.height = '';
    els.detail.style.overflow = '';
  }

  function renderDetail() {
    renderDetailWithAnimation(() => {
      const item = state.filteredItems.find((entry) => asString(entry.item_id) === state.selectedItemId) || null;
      if (!item) {
        const wasHidden = els.detailEmpty.classList.contains('catalog-hidden');
        els.detailEmpty.classList.remove('catalog-hidden');
        els.detailContent.classList.add('catalog-hidden');
        els.detailContent.innerHTML = '';
        if (wasHidden) {
          triggerPanelContentAnimation(els.detailEmpty);
        }
        return;
      }

      const primaryAction = getPrimaryAction(item);
      const isComplex = item.content_type === 'complex';
      const detailAction = primaryAction && ['preview', 'open-library'].includes(primaryAction.key)
        ? null
        : primaryAction;
      const descriptionText = asString(item.description);
      const asyncBlockId = `catalog-detail-async-${Date.now()}`;
      const descriptionRowHtml = isComplex ? `
        <div class="catalog-detail__row">
          <p class="catalog-detail__kicker">Описание комплекса</p>
          <p class="catalog-detail__text ${!descriptionText ? 'catalog-detail__text--placeholder' : ''}">${escapeHtml(descriptionText || 'Описание отсутствует.')}</p>
        </div>
      ` : '';

      els.detailEmpty.classList.add('catalog-hidden');
      els.detailContent.classList.remove('catalog-hidden');
      els.detailContent.innerHTML = `
        ${descriptionRowHtml}
        <div id="${asyncBlockId}" class="catalog-detail__async">
          <div class="catalog-detail__loading">
            <span class="material-symbols-outlined catalog-detail__spinner">progress_activity</span>
            <span>Загружаем подробности…</span>
          </div>
        </div>
        ${detailAction ? `
          <div class="catalog-detail__actions">
            <button type="button" id="catalog-detail-primary" class="${escapeHtml(primaryAction.className)}"${primaryAction.disabled ? ' disabled' : ''}>
              ${escapeHtml(detailAction.label)}
            </button>
          </div>
        ` : ''}
      `;
      if (detailAction) {
        els.detailContent.querySelector('#catalog-detail-primary')?.addEventListener('click', async () => {
          await handlePrimaryAction(item);
        });
      }

      // Lazy-load version detail
      const capturedItemId = state.selectedItemId;
      const detailLoader = isComplex && isSavedComplexItem(item)
        ? loadComplexLibraryEntryDetail(asString(item.linked_library_entry_id)).catch(() => null)
        : loadVersionDetail(item);
      detailLoader.then((version) => {
        if (state.selectedItemId !== capturedItemId) return;
        const asyncBlock = global.document.getElementById(asyncBlockId);
        if (!asyncBlock) return;

        const previousDetailHeight = els.detail ? els.detail.offsetHeight : 0;
          const snapshot = version && typeof version.snapshot === 'object' ? version.snapshot : {};

          if (isComplex) {
            const status = getStatus(item);
            const accessState = asString(status?.library_status?.access_state || item.linked_access_state);
            if (isSavedComplexItem(item) && ['requires_access_code', 'revoked', 'deleted_source'].includes(accessState)) {
              asyncBlock.innerHTML = `
                <div class="catalog-detail__row">
                  <p class="catalog-detail__kicker">Доступ</p>
                  <p class="catalog-detail__text">${escapeHtml(asString(status?.library_status?.access_reason || item.linked_access_reason || 'Содержимое публикации сейчас недоступно.'))}</p>
                </div>
              `;
            } else {
              const breakdown = getTaskTypeBreakdown(snapshot);
              if (breakdown.length > 0) {
                asyncBlock.innerHTML = `
                <div class="catalog-detail__row">
                  <p class="catalog-detail__kicker">Состав заданий</p>
                  <div class="catalog-detail__breakdown">
                    ${breakdown.map((entry, idx) => `
                      <div class="catalog-detail__breakdown-group">
                        <button type="button" class="catalog-detail__breakdown-row" data-breakdown-toggle="${idx}">
                          <span class="catalog-detail__breakdown-label">${escapeHtml(entry.label)}</span>
                          <div style="display:flex;align-items:center;gap:0.5rem;">
                            <span class="catalog-detail__breakdown-count">${escapeHtml(String(entry.count))}</span>
                            <span class="material-symbols-outlined catalog-detail__breakdown-chevron">expand_more</span>
                          </div>
                        </button>
                        <div class="catalog-detail__breakdown-list" data-breakdown-list="${idx}" style="height:0; overflow:hidden; transition:height 0.4s ease;">
                          <ul class="catalog-detail__breakdown-items">
                            ${entry.names.map(name => `<li class="catalog-detail__breakdown-item">${escapeHtml(name)}</li>`).join('')}
                          </ul>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </div>
                `;
                asyncBlock.querySelectorAll('[data-breakdown-toggle]').forEach(btn => {
                  btn.addEventListener('click', () => {
                    const idx = btn.getAttribute('data-breakdown-toggle');
                    const list = asyncBlock.querySelector(`[data-breakdown-list="${idx}"]`);
                    if (list) {
                      const expanding = list.style.height === '0px' || list.style.height === '0' || !list.style.height;
                      const targetHeight = expanding ? `${list.scrollHeight}px` : '0px';
                      list.style.height = targetHeight;
                      btn.classList.toggle('is-open', expanding);
                      global.requestAnimationFrame(() => {
                        snapDetailHeightToContent();
                      });
                    }
                  });
                });
            } else {
              asyncBlock.innerHTML = `
                <div class="catalog-detail__row">
                  <p class="catalog-detail__kicker">Задания</p>
                  <p class="catalog-detail__text catalog-detail__text--placeholder">Информация о структуре недоступна.</p>
                </div>
              `;
            }
          }
          } else {
            const delta = snapshot.delta && typeof snapshot.delta === 'object' ? snapshot.delta : (snapshot && typeof snapshot === 'object' && snapshot.delta ? snapshot.delta : {});
            const ops = Array.isArray(delta.ops) ? delta.ops : [];
            const previewHtml = deltaToHtml({ ops });

            if (previewHtml) {
              asyncBlock.innerHTML = `
                <div class="catalog-detail__row">
                  <p class="catalog-detail__kicker">Миниатюра содержания</p>
                  <div class="catalog-detail__theory-preview" role="button" tabindex="0" title="Нажмите, чтобы открыть теорию">
                    <div class="catalog-detail__theory-preview-canvas">
                      <div class="catalog-detail__theory-preview-inner">
                        ${previewHtml}
                      </div>
                    </div>
                    <div class="catalog-detail__theory-preview-overlay">
                      <span class="material-symbols-outlined">open_in_full</span>
                      <span>Открыть теорию</span>
                    </div>
                  </div>
                </div>
              `;
              const previewEl = asyncBlock.querySelector('.catalog-detail__theory-preview');
              if (previewEl) {
                const openPreviewTheory = () => openTheoryModal(
                  asString(item.title),
                  asString(item.source_workspace_id),
                  {
                    item: {
                      title: asString(item.title) || 'Теория',
                      delta: { ops },
                      updated_at: asString(item.latest_published_at) || asString(version && version.created_at) || '',
                    },
                  },
                );
                syncTheoryPreviewLayout(previewEl);
                bindTheoryPreviewInteractions(previewEl, openPreviewTheory);
              }
            } else {
              asyncBlock.innerHTML = `
                <div class="catalog-detail__row">
                  <p class="catalog-detail__kicker">Содержание</p>
                  <p class="catalog-detail__text catalog-detail__text--placeholder">Контент теории не доступен для предпросмотра.</p>
                </div>
              `;
            }
          }
        smoothSyncDetailHeight(previousDetailHeight);
      });
    });
  }

  function renderVisibility() {
    const hasItems = state.filteredItems.length > 0;
    els.loading.classList.toggle('is-visible', state.loading);
    els.error.classList.toggle('is-visible', !state.loading && !!state.error);
    els.empty.classList.toggle('is-visible', !state.loading && !state.error && !hasItems);
    els.grid.classList.toggle('catalog-hidden', state.loading || !!state.error || !hasItems);
    els.error.textContent = state.error ? `Не удалось загрузить каталог: ${state.error}` : '';
  }

  function render() {
    renderSummary();
    renderVisibility();
    renderCards();
    renderDetail();
  }

  function selectItem(itemId) {
    state.selectedItemId = asString(itemId);
    render();
  }

  let modalDepth = 0;

  function openModal(markup, onMount, options = {}) {
    return new Promise((resolve) => {
      const modalOptions = options && typeof options === 'object' ? options : {};
      const prefersReducedMotion = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
      const overlay = global.document.createElement('div');
      overlay.className = `catalog-modal-overlay fixed inset-0 z-[1300] flex items-center justify-center p-4 ${modalOptions.variant === 'confirm' ? 'catalog-modal-overlay--confirm' : ''}`.trim();
      overlay.innerHTML = markup;
      const body = global.document.body;
      const shell = modalOptions.blurCatalogShell ? global.document.querySelector('.catalog-shell') : null;
      if (modalDepth === 0) {
        body.dataset.modalOverflowRestore = body.style.overflow || '';
      }
      modalDepth += 1;
      body.style.overflow = 'hidden';
      if (shell) {
        const blurDepth = Number(shell.dataset.modalBlurDepth || '0') + 1;
        shell.dataset.modalBlurDepth = String(blurDepth);
        shell.classList.add('catalog-shell--blurred');
      }
      let closed = false;
      const finalizeClose = (resultValue) => {
        overlay.remove();
        modalDepth = Math.max(0, modalDepth - 1);
        if (shell) {
          const blurDepth = Math.max(0, Number(shell.dataset.modalBlurDepth || '1') - 1);
          if (blurDepth > 0) {
            shell.dataset.modalBlurDepth = String(blurDepth);
          } else {
            delete shell.dataset.modalBlurDepth;
            shell.classList.remove('catalog-shell--blurred');
          }
        }
        if (modalDepth === 0) {
          body.style.overflow = body.dataset.modalOverflowRestore || '';
          delete body.dataset.modalOverflowRestore;
        }
        resolve(resultValue);
      };
      const close = (resultValue) => {
        if (closed) return;
        if (prefersReducedMotion) {
          closed = true;
          finalizeClose(resultValue);
          return;
        }
        closed = true;
        overlay.classList.remove('is-visible');
        overlay.classList.add('is-closing');
        global.setTimeout(() => finalizeClose(resultValue), 190);
      };
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close(null);
      });
      overlay.querySelectorAll('[data-close], [data-action="close"]').forEach((button) => {
        button.addEventListener('click', () => close(null));
      });
      overlay.querySelectorAll('[data-action-key]').forEach((button) => {
        button.addEventListener('click', () => close(asString(button.getAttribute('data-action-key'))));
      });
      global.document.body.appendChild(overlay);
      if (prefersReducedMotion) {
        overlay.classList.add('is-visible');
      } else {
        global.requestAnimationFrame(() => {
          global.requestAnimationFrame(() => {
            if (!closed) overlay.classList.add('is-visible');
          });
        });
      }
      if (typeof onMount === 'function') {
        onMount(overlay, close);
      }
    });
  }

  function parseTaskRef(ref) {
    const raw = asString(ref);
    if (!raw) return null;
    const parts = raw.split('/').map((part) => asString(part)).filter(Boolean);
    if (parts.length < 3) return null;
    return { moduleId: parts[0], topicId: parts[1], taskId: parts[parts.length - 1], taskRef: raw };
  }

  function cleanTaskDisplayName(rawName, fallback = 'Задание') {
    const text = asString(rawName).trim();
    if (!text) return fallback;
    const cleaned = text
      .replace(/^\s*(?:задание|task)\s*[-–—:]\s*/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return cleaned || fallback;
  }

  function getTaskPayloadName(taskPayload, fallbackRef) {
    const payload = taskPayload && typeof taskPayload === 'object' ? taskPayload : {};
    const taskData = payload.task_data && typeof payload.task_data === 'object' ? payload.task_data : {};
    const taskMeta = taskData.meta && typeof taskData.meta === 'object' ? taskData.meta : {};
    const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    return asString(taskData.name) || asString(taskData.title) || asString(taskMeta.name) || asString(metadata.name) || asString(fallbackRef) || 'Задание';
  }

  function getTaskPayloadType(taskPayload) {
    const payload = taskPayload && typeof taskPayload === 'object' ? taskPayload : {};
    const taskData = payload.task_data && typeof payload.task_data === 'object' ? payload.task_data : {};
    return getTaskTypeLabel(taskData.type || taskData.task_type || '');
  }

  function prettyJson(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return String(value == null ? '' : value);
    }
  }

  function collectTheoryButtonPayloads(snapshot) {
    const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const deps = safeSnapshot.dependencies && typeof safeSnapshot.dependencies === 'object' ? safeSnapshot.dependencies : {};
    return deps.theories && typeof deps.theories === 'object' ? deps.theories : {};
  }

  function buildComplexStructure(snapshot) {
    const safeSnapshot = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const complex = safeSnapshot.complex && typeof safeSnapshot.complex === 'object' ? safeSnapshot.complex : {};
    const deps = safeSnapshot.dependencies && typeof safeSnapshot.dependencies === 'object' ? safeSnapshot.dependencies : {};
    const modulesMap = deps.modules && typeof deps.modules === 'object' ? deps.modules : {};
    const topicsMap = deps.topics && typeof deps.topics === 'object' ? deps.topics : {};
    const tasksMap = deps.tasks && typeof deps.tasks === 'object' ? deps.tasks : {};
    const topicTheoryLinks = deps.topic_theory_links && typeof deps.topic_theory_links === 'object' ? deps.topic_theory_links : {};
    const moduleOrder = [];
    const moduleBuckets = new Map();
    const looseTasks = [];

    (Array.isArray(complex.tasks) ? complex.tasks : []).forEach((taskRef) => {
      const parsed = parseTaskRef(taskRef);
      if (!parsed) return;
      const topicRef = `${parsed.moduleId}/${parsed.topicId}`;
      const modulePayload = modulesMap[parsed.moduleId] && typeof modulesMap[parsed.moduleId] === 'object' ? modulesMap[parsed.moduleId] : {};
      const topicPayload = topicsMap[topicRef] && typeof topicsMap[topicRef] === 'object' ? topicsMap[topicRef] : {};
      const taskPayload = tasksMap[parsed.taskRef] && typeof tasksMap[parsed.taskRef] === 'object' ? tasksMap[parsed.taskRef] : {};

      if (!moduleBuckets.has(parsed.moduleId)) {
        moduleOrder.push(parsed.moduleId);
        moduleBuckets.set(parsed.moduleId, {
          moduleId: parsed.moduleId,
          title: asString(modulePayload.name) || asString(modulePayload.title) || parsed.moduleId,
          description: asString(modulePayload.description),
          topics: new Map(),
          topicOrder: [],
        });
      }
      const moduleBucket = moduleBuckets.get(parsed.moduleId);
      if (!moduleBucket.topics.has(topicRef)) {
        moduleBucket.topicOrder.push(topicRef);
        moduleBucket.topics.set(topicRef, {
          topicRef,
          topicId: parsed.topicId,
          title: asString(topicPayload.name) || asString(topicPayload.title) || parsed.topicId,
          description: asString(topicPayload.description),
          theoryLink: topicTheoryLinks[topicRef] && typeof topicTheoryLinks[topicRef] === 'object' ? topicTheoryLinks[topicRef] : null,
          tasks: [],
        });
      }
      const topicBucket = moduleBucket.topics.get(topicRef);
      const taskNode = {
        taskRef: parsed.taskRef,
        taskId: parsed.taskId,
        title: getTaskPayloadName(taskPayload, parsed.taskRef),
        typeLabel: getTaskPayloadType(taskPayload),
        payload: taskPayload,
      };
      topicBucket.tasks.push(taskNode);
      if (!Object.keys(modulePayload).length && !Object.keys(topicPayload).length) looseTasks.push(taskNode);
    });

    return {
      complex,
      modules: moduleOrder.map((moduleId) => {
        const bucket = moduleBuckets.get(moduleId);
        return {
          moduleId: bucket.moduleId,
          title: bucket.title,
          description: bucket.description,
          topics: bucket.topicOrder.map((topicRef) => bucket.topics.get(topicRef)),
        };
      }),
      looseTasks,
      theories: collectTheoryButtonPayloads(snapshot),
    };
  }

  function openAccessCodeDialog(title) {
    const label = asString(title) || 'публикации';
    return openModal(`
      <div class="w-full max-w-md overflow-hidden rounded-[28px] border border-border-subtle bg-surface-1 shadow-xl">
        <div class="border-b border-border-subtle px-5 py-4">
          <p class="text-lg font-bold text-text-main">Код доступа</p>
          <p class="mt-2 text-sm text-text-secondary">Введите код, чтобы снова открыть ${escapeHtml(label)} в библиотеке.</p>
        </div>
        <form class="space-y-4 p-5" data-access-code-form>
          <label class="flex flex-col gap-2 text-sm font-semibold text-text-main">
            Код доступа
            <input name="access_code" type="text" class="h-11 rounded-2xl border border-border-subtle bg-surface-2 px-4 outline-none" placeholder="Например, AB12CD34" autocomplete="off">
          </label>
          <div class="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <button type="button" class="btn-secondary h-10 px-4" data-close>Закрыть</button>
            <button type="submit" class="btn-primary h-10 px-4">Открыть</button>
          </div>
        </form>
      </div>
    `, (overlay, close) => {
      const form = overlay.querySelector('[data-access-code-form]');
      const input = form && form.querySelector('input[name="access_code"]');
      if (input) input.focus();
      form?.addEventListener('submit', (event) => {
        event.preventDefault();
        const value = asString(input && input.value);
        if (!value) {
          showToast('Введите код доступа.', 'warning');
          return;
        }
        close(value);
      });
    });
  }

  function openTaskReadOnlyModal(taskNode, context = {}) {
    const payload = taskNode && typeof taskNode === 'object' ? taskNode.payload || {} : {};
    const taskData = payload.task_data && typeof payload.task_data === 'object' ? payload.task_data : {};
    const meta = taskData.meta && typeof taskData.meta === 'object' ? taskData.meta : {};
    const title = asString(taskNode && taskNode.title) || 'Задание';
    const typeLabel = asString(taskNode && taskNode.typeLabel) || 'Другое';
    const subtitle = [
      asString(context.moduleTitle),
      asString(context.topicTitle),
    ].filter(Boolean).join(' / ');
    return openModal(`
      <div class="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[30px] border border-border-subtle bg-surface-1 shadow-xl">
        <div class="border-b border-border-subtle px-5 py-4">
          <p class="text-lg font-bold text-text-main">${escapeHtml(title)}</p>
          <p class="mt-2 text-sm text-text-secondary">${escapeHtml(typeLabel)}${subtitle ? ` • ${escapeHtml(subtitle)}` : ''}</p>
        </div>
        <div class="custom-scrollbar space-y-4 overflow-y-auto p-5">
          ${asString(meta.description || taskData.description || taskData.prompt || taskData.question) ? `
            <div class="catalog-detail__row">
              <p class="catalog-detail__kicker">Кратко</p>
              <p class="catalog-detail__text">${escapeHtml(asString(meta.description || taskData.description || taskData.prompt || taskData.question))}</p>
            </div>
          ` : ''}
          <div class="catalog-detail__row">
            <p class="catalog-detail__kicker">Данные задания</p>
            <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:0.78rem;line-height:1.5;color:var(--color-text-main);">${escapeHtml(prettyJson(taskData && Object.keys(taskData).length ? taskData : payload))}</pre>
          </div>
        </div>
        <div class="flex justify-end border-t border-border-subtle px-5 py-4">
          <button type="button" class="btn-secondary h-10 px-4" data-close>Закрыть</button>
        </div>
      </div>
    `);
  }

  function openLinkedComplexViewer(detail) {
    const libraryEntry = detail && typeof detail.library_entry === 'object' ? detail.library_entry : {};
    const item = detail && typeof detail.item === 'object' ? detail.item : {};
    const version = detail && typeof detail.version === 'object' ? detail.version : {};
    const snapshot = detail && typeof detail.snapshot === 'object' ? detail.snapshot : {};
    const structure = buildComplexStructure(snapshot);
    const complex = structure.complex || {};
    const theoryPayloads = structure.theories || {};
    const accessState = asString(libraryEntry.access_state);
    const locked = ['requires_access_code', 'revoked', 'deleted_source'].includes(accessState);
    const complexTheoryId = complex && complex.theory_link && complex.theory_link.theory_id ? asString(complex.theory_link.theory_id) : '';
    return openModal(`
      <div class="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-[30px] border border-border-subtle bg-surface-1 shadow-xl">
        <div class="flex items-start justify-between gap-4 border-b border-border-subtle px-6 py-5">
          <div>
            <p class="text-xl font-bold text-text-main">${escapeHtml(asString(item.title) || asString(complex.name) || 'Комплекс')}</p>
            <p class="mt-2 text-sm text-text-secondary">${escapeHtml(asString(version.published_at) ? `Опубликовано ${formatRelativeDate(version.published_at)}` : (asString(libraryEntry.access_reason) || 'Связанная публикация только для чтения.'))}</p>
          </div>
          <button type="button" class="btn-secondary h-10 px-4" data-close>Закрыть</button>
        </div>
        <div class="custom-scrollbar grid gap-5 overflow-y-auto px-6 py-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div class="space-y-4">
            ${locked ? `
              <div class="catalog-detail__row">
                <p class="catalog-detail__kicker">Доступ</p>
                <p class="catalog-detail__text">${escapeHtml(asString(libraryEntry.access_reason) || 'Содержимое публикации сейчас недоступно.')}</p>
              </div>
            ` : `
              ${asString(complex.description) ? `
                <div class="catalog-detail__row">
                  <p class="catalog-detail__kicker">Описание</p>
                  <p class="catalog-detail__text">${escapeHtml(asString(complex.description))}</p>
                </div>
              ` : ''}
              ${structure.modules.map((module) => `
                <section class="catalog-detail__row">
                  <p class="catalog-detail__kicker">Модуль</p>
                  <div>
                    <p class="catalog-detail__text" style="margin-top:0;">${escapeHtml(module.title)}</p>
                    ${module.description ? `<p class="catalog-detail__text" style="font-weight:600;color:var(--color-text-secondary);">${escapeHtml(module.description)}</p>` : ''}
                  </div>
                  <div class="space-y-3">
                    ${module.topics.map((topic) => `
                      <div class="rounded-2xl border border-border-subtle bg-surface-2 px-4 py-3">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p class="catalog-detail__text" style="margin-top:0;">${escapeHtml(topic.title)}</p>
                            ${topic.description ? `<p class="catalog-detail__text" style="font-weight:600;color:var(--color-text-secondary);">${escapeHtml(topic.description)}</p>` : ''}
                          </div>
                          ${topic.theoryLink && topic.theoryLink.theory_id ? `
                            <button type="button" class="btn-secondary h-9 px-3" data-open-theory-id="${escapeHtml(asString(topic.theoryLink.theory_id))}">
                              Теория темы
                            </button>
                          ` : ''}
                        </div>
                        <div class="mt-3 flex flex-col gap-2">
                          ${topic.tasks.map((task) => `
                            <button type="button" class="flex items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-surface-1 px-4 py-3 text-left transition hover:border-primary-light hover:bg-bg-secondary" data-open-task-ref="${escapeHtml(task.taskRef)}">
                              <span>
                                <span style="display:block;font-weight:800;color:var(--color-text-main);">${escapeHtml(task.title)}</span>
                                <span style="display:block;margin-top:0.25rem;font-size:0.78rem;color:var(--color-text-secondary);">${escapeHtml(task.typeLabel)}</span>
                              </span>
                              <span class="material-symbols-outlined" style="color:var(--color-text-secondary);">open_in_new</span>
                            </button>
                          `).join('')}
                        </div>
                      </div>
                    `).join('')}
                  </div>
                </section>
              `).join('')}
              ${structure.looseTasks.length ? `
                <div class="catalog-detail__row">
                  <p class="catalog-detail__kicker">Дополнительные задания</p>
                  <div class="flex flex-col gap-2">
                    ${structure.looseTasks.map((task) => `
                      <button type="button" class="flex items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-surface-1 px-4 py-3 text-left transition hover:border-primary-light hover:bg-bg-secondary" data-open-task-ref="${escapeHtml(task.taskRef)}">
                        <span>
                          <span style="display:block;font-weight:800;color:var(--color-text-main);">${escapeHtml(task.title)}</span>
                          <span style="display:block;margin-top:0.25rem;font-size:0.78rem;color:var(--color-text-secondary);">${escapeHtml(task.typeLabel)}</span>
                        </span>
                        <span class="material-symbols-outlined" style="color:var(--color-text-secondary);">open_in_new</span>
                      </button>
                    `).join('')}
                  </div>
                </div>
              ` : ''}
            `}
          </div>
          <aside class="space-y-4">
            <div class="catalog-detail__row">
              <p class="catalog-detail__kicker">Статус</p>
              <p class="catalog-detail__text">${escapeHtml(locked ? (asString(libraryEntry.access_reason) || 'Доступ закрыт') : 'Связанная публикация в вашей библиотеке')}</p>
            </div>
            <div class="catalog-detail__row">
              <p class="catalog-detail__kicker">Сводка</p>
              <div class="catalog-detail__breakdown">
                <div class="catalog-detail__breakdown-group"><div class="catalog-detail__breakdown-row"><span class="catalog-detail__breakdown-label">Модули</span><span class="catalog-detail__breakdown-count">${escapeHtml(String(structure.modules.length))}</span></div></div>
                <div class="catalog-detail__breakdown-group"><div class="catalog-detail__breakdown-row"><span class="catalog-detail__breakdown-label">Задания</span><span class="catalog-detail__breakdown-count">${escapeHtml(String(getTaskCount(item)))}</span></div></div>
                <div class="catalog-detail__breakdown-group"><div class="catalog-detail__breakdown-row"><span class="catalog-detail__breakdown-label">Теории</span><span class="catalog-detail__breakdown-count">${escapeHtml(String(getTheoryCount(item)))}</span></div></div>
              </div>
            </div>
            ${complexTheoryId ? `
              <div class="catalog-detail__row">
                <p class="catalog-detail__kicker">Связанная теория комплекса</p>
                <button type="button" class="btn-secondary h-10 px-4" data-open-theory-id="${escapeHtml(complexTheoryId)}">Открыть теорию</button>
              </div>
            ` : ''}
          </aside>
        </div>
      </div>
    `, (overlay) => {
      overlay.querySelectorAll('[data-open-task-ref]').forEach((button) => {
        button.addEventListener('click', () => {
          const taskRef = asString(button.getAttribute('data-open-task-ref'));
          for (const module of structure.modules) {
            for (const topic of module.topics) {
              const task = topic.tasks.find((entry) => asString(entry.taskRef) === taskRef);
              if (task) {
                openTaskReadOnlyModal(task, { moduleTitle: module.title, topicTitle: topic.title });
                return;
              }
            }
          }
          const looseTask = structure.looseTasks.find((entry) => asString(entry.taskRef) === taskRef);
          if (looseTask) openTaskReadOnlyModal(looseTask, {});
        });
      });
      overlay.querySelectorAll('[data-open-theory-id]').forEach((button) => {
        button.addEventListener('click', () => {
          const theoryId = asString(button.getAttribute('data-open-theory-id'));
          const theoryItem = theoryPayloads[theoryId] && typeof theoryPayloads[theoryId] === 'object'
            ? theoryPayloads[theoryId]
            : null;
          openTheoryModal(
            asString(item.title) || 'Комплекс',
            theoryId,
            theoryItem ? { item: theoryItem } : {},
          );
        });
      });
    });
  }

  function buildPreviewRows(item) {
    const manifest = getLatestManifest(item);
    const deps = manifest && typeof manifest.dependency_counts === 'object' ? manifest.dependency_counts : {};
    const rows = [
      ['Комплекс', 1, 'Linked', 'Каталог'],
      ['Модули', normalizeCount(deps.modules), 'Read-only', 'Каталог'],
      ['Темы', normalizeCount(deps.topics), 'Read-only', 'Каталог'],
      ['Задания', getTaskCount(item), 'Read-only', 'Каталог'],
      ['Теории', normalizeCount(deps.theories), 'Read-only', 'Каталог'],
    ];
    return rows.map((row) => `
      <div class="catalog-dialog-list__row">
        <div>${escapeHtml(String(row[0]))}</div>
        <div>${escapeHtml(String(normalizeCount(row[1])))}</div>
        <div>${escapeHtml(String(row[2]))}</div>
        <div>${escapeHtml(String(row[3]))}</div>
      </div>
    `).join('');
  }

  async function openComplexPreview(preview) {
    const already = !!(preview && preview.library_status && preview.library_status.already_in_library);
    const item = preview && preview.item ? preview.item : {};
    const accessReason = asString(preview?.library_status?.access_reason) || 'Комплекс сохранится в каталоге как связанная публикация без создания отдельной версии в workspace.';
    const buttonLabel = already ? 'Открыть в библиотеке' : 'Продолжить';
    return openModal(`
      <div class="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[30px] border border-border-subtle bg-surface-1 shadow-xl">
        <div class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div>
            <p class="text-lg font-bold text-text-main">Добавление комплекса в библиотеку</p>
            <p class="mt-2 text-sm text-text-secondary">Комплекс сохранится в вашем личном linked-списке внутри каталога и будет открываться только для чтения.</p>
          </div>
          <button type="button" class="btn-secondary h-10 px-4" data-close>Закрыть</button>
        </div>
        <div class="custom-scrollbar space-y-4 overflow-y-auto p-5">
          <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-3">
            <div class="text-sm font-semibold text-text-main">${escapeHtml(asString(item.title) || 'Комплекс')}</div>
            <div class="mt-1 text-xs text-text-secondary">${escapeHtml(asString(item.description) || accessReason)}</div>
          </div>
          <div class="catalog-dialog-list">
            <div class="catalog-dialog-list__row catalog-dialog-list__row--head">
              <div>Сущность</div>
              <div>Всего</div>
              <div>Режим</div>
              <div>Где открывается</div>
            </div>
            ${buildPreviewRows(item)}
          </div>
          <div class="catalog-dialog-note">
            Задания, темы и связанные теории не импортируются в workspace. Авторские обновления будут резолвиться через последнюю доступную версию публикации.
          </div>
        </div>
        <div class="flex justify-end gap-3 border-t border-border-subtle px-5 py-4">
          <button type="button" class="btn-secondary h-10 px-4" data-action="close">Закрыть</button>
          <button type="button" class="${already ? 'btn-secondary' : 'btn-primary'} h-10 px-4" data-action-key="${already ? 'open' : 'confirm'}">${buttonLabel}</button>
        </div>
      </div>
    `);
  }

  async function openTheoryPreview(preview) {
    const already = !!(preview && preview.library_status && preview.library_status.already_in_library);
    const accessState = asString(preview?.library_status?.access_state);
    const actionLabel = already
      ? (accessState === 'requires_access_code' ? 'Открыть в Теоретическом центре' : 'Открыть в библиотеке')
      : 'Продолжить';
    const bodyText = already
      ? 'Эта теория уже есть у вас как связанная публикация и открывается через Теоретический центр.'
      : 'Теория будет добавлена в Теоретический центр как связанная публикация и всегда сможет резолвить актуальную доступную версию автора.';
    return openModal(`
      <div class="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[30px] border border-border-subtle bg-surface-1 shadow-xl">
        <div class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div>
            <p class="text-lg font-bold text-text-main">Превью добавления теории</p>
            <p class="mt-2 text-sm text-text-secondary">${escapeHtml(bodyText)}</p>
          </div>
          <button type="button" class="btn-secondary h-10 px-4" data-close>Закрыть</button>
        </div>
        <div class="space-y-4 p-5">
          <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-3">
            <div class="text-sm font-semibold text-text-main">${escapeHtml(asString(preview?.item?.title) || 'Теория')}</div>
            <div class="mt-1 text-xs text-text-secondary">${escapeHtml(asString(preview?.library_status?.access_reason) || 'Связанная публикация будет доступна через Теоретический центр.')}</div>
          </div>
          <div class="catalog-dialog-note">
            После добавления теория не появится в редакторе как отдельная рабочая версия. Она будет читаться в Теоретическом центре как общий linked-материал автора.
          </div>
        </div>
        <div class="flex justify-end gap-3 border-t border-border-subtle px-5 py-4">
          <button type="button" class="btn-secondary h-10 px-4" data-action="close">Закрыть</button>
          <button type="button" class="${already ? 'btn-secondary' : 'btn-primary'} h-10 px-4" data-action-key="${already ? 'open' : 'confirm'}">${escapeHtml(actionLabel)}</button>
        </div>
      </div>
    `);
  }

  async function openSuccessDialog(resultPayload) {
    const entityLabel = resultPayload && resultPayload.item && resultPayload.item.content_type === 'theory'
      ? 'Теория добавлена в библиотеку'
      : 'Комплекс добавлен в библиотеку';
    return openModal(`
      <div class="w-full max-w-xl overflow-hidden rounded-[30px] border border-border-subtle bg-surface-1 shadow-xl">
        <div class="p-6 text-center">
          <svg class="catalog-success-icon" viewBox="0 0 120 120" fill="none" aria-hidden="true">
            <circle cx="60" cy="60" r="52" fill="color-mix(in srgb, var(--color-success-lighter) 88%, white 12%)" stroke="var(--color-success-light)" stroke-width="4"></circle>
            <path d="M37 61.5L52.5 77L84 45.5" stroke="var(--color-success-darker)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"></path>
          </svg>
          <p class="text-xl font-bold text-text-main">${escapeHtml(entityLabel)}</p>
          <p class="mt-2 text-sm text-text-secondary">${resultPayload && resultPayload.item && resultPayload.item.content_type === 'theory' ? 'Связанная публикация появилась в Теоретическом центре. Там её можно читать как общий материал автора.' : 'Связанная публикация сохранена в каталоге и открывается только для чтения без создания отдельной версии в workspace.'}</p>
        </div>
        <div class="flex justify-end gap-3 border-t border-border-subtle px-5 py-4">
          <button type="button" class="btn-secondary h-10 px-4" data-action="close">Закрыть</button>
          <button type="button" class="btn-primary h-10 px-4" data-action-key="open">Открыть в библиотеке</button>
        </div>
      </div>
    `);
  }

  function buildConfirmFacts(facts) {
    return (Array.isArray(facts) ? facts : [])
      .map((fact) => {
        const label = asString(fact && fact.label);
        const value = asString(fact && fact.value);
        if (!label || !value) return '';
        return `
          <div class="catalog-confirm-modal__fact">
            <span class="catalog-confirm-modal__fact-label">${escapeHtml(label)}</span>
            <span class="catalog-confirm-modal__fact-value">${escapeHtml(value)}</span>
          </div>
        `;
      })
      .filter(Boolean)
      .join('');
  }

  function buildConfirmSummaryItems(items) {
    return (Array.isArray(items) ? items : [])
      .map((item) => {
        const icon = asString(item && item.icon) || 'done';
        const title = asString(item && item.title);
        const text = asString(item && item.text);
        if (!title) return '';
        return `
          <div class="catalog-confirm-modal__summary-item">
            <span class="material-symbols-outlined">${escapeHtml(icon)}</span>
            <div>
              <p class="catalog-confirm-modal__summary-title">${escapeHtml(title)}</p>
              ${text ? `<p class="catalog-confirm-modal__summary-text">${escapeHtml(text)}</p>` : ''}
            </div>
          </div>
        `;
      })
      .filter(Boolean)
      .join('');
  }

  async function openCatalogComplexConfirmModal(preview) {
    const already = !!(preview && preview.library_status && preview.library_status.already_in_library);
    const item = preview && preview.item ? preview.item : {};
    const owner = getDisplayOwner(item) || 'Автор не указан';
    const title = already ? 'Комплекс уже в библиотеке' : 'Добавить комплекс в библиотеку';
    const primaryLabel = already ? 'Открыть в библиотеке' : 'Добавить';
    const factsMarkup = buildConfirmFacts([
      { label: 'Задания', value: String(getTaskCount(item)) },
    ]);
    const summaryMarkup = buildConfirmSummaryItems([
      {
        icon: 'bookmark_added',
        title: already ? 'Уже сохранён в библиотеке каталога' : 'Появится в вашей библиотеке каталога',
        text: already ? 'Можно открыть из каталога в любой момент.' : 'Материал сохранится рядом с другими вашими публикациями.',
      },
      {
        icon: 'visibility',
        title: 'Открывается только для чтения',
        text: 'Комплекс можно просматривать без редактирования авторского оригинала.',
      },
      {
        icon: 'edit_off',
        title: 'Копия в редактор не создаётся',
        text: 'Добавление не переносит материал в рабочий редактор.',
      },
    ]);
    return openModal(`
      <div class="catalog-confirm-modal custom-scrollbar">
        <div class="catalog-confirm-modal__header">
          <div>
            <p class="catalog-confirm-modal__eyebrow">Комплекс</p>
            <p class="catalog-confirm-modal__headline">${escapeHtml(title)}</p>
          </div>
          <button type="button" class="btn-secondary h-10 px-4" data-close>Отмена</button>
        </div>
        <div class="catalog-confirm-modal__body">
          <section class="catalog-confirm-modal__hero">
            <p class="catalog-confirm-modal__item-title">${escapeHtml(asString(item.title) || 'Комплекс')}</p>
            <div class="catalog-confirm-modal__meta">
              <span class="catalog-confirm-modal__meta-item">Автор: ${escapeHtml(owner)}</span>
              <span class="catalog-confirm-modal__meta-item">Раздел: Каталог</span>
            </div>
            ${asString(item.description) ? `<p class="catalog-confirm-modal__description">${escapeHtml(asString(item.description))}</p>` : ''}
          </section>
          ${factsMarkup ? `<div class="catalog-confirm-modal__facts">${factsMarkup}</div>` : ''}
          <div class="catalog-confirm-modal__summary">${summaryMarkup}</div>
        </div>
        <div class="catalog-confirm-modal__footer">
          <button type="button" class="btn-secondary h-10 px-4" data-action="close">Отмена</button>
          <button type="button" class="${already ? 'btn-secondary' : 'btn-primary'} h-10 px-4" data-action-key="${already ? 'open' : 'confirm'}">${escapeHtml(primaryLabel)}</button>
        </div>
      </div>
    `, null, { blurCatalogShell: true, variant: 'confirm' });
  }

  async function openCatalogTheoryConfirmModal(preview) {
    const already = !!(preview && preview.library_status && preview.library_status.already_in_library);
    const item = preview && preview.item ? preview.item : {};
    const owner = getDisplayOwner(item) || 'Автор не указан';
    const title = already ? 'Теория уже в библиотеке' : 'Добавить теорию';
    const subtitle = already
      ? 'Теория уже сохранена и доступна через Теоретический центр.'
      : 'Теория появится в Теоретическом центре и будет доступна для чтения.';
    const primaryLabel = already ? 'Открыть в Теоретическом центре' : 'Добавить';
    const summaryMarkup = buildConfirmSummaryItems([
      {
        icon: 'bookmark_added',
        title: already ? 'Уже сохранена в Теоретическом центре' : 'Появится в Теоретическом центре',
        text: 'Материал будет доступен рядом с другими сохранёнными теориями.',
      },
      {
        icon: 'visibility',
        title: 'Откроется как общая публикация',
        text: 'Теория читается без редактирования авторского оригинала.',
      },
      {
        icon: 'content_copy',
        title: 'Отдельная версия в workspace не создаётся',
        text: 'Добавление не переносит материал в отдельный редактор.',
      },
    ]);
    return openModal(`
      <div class="catalog-confirm-modal catalog-confirm-modal--theory custom-scrollbar">
        <div class="catalog-confirm-modal__header">
          <div>
            <p class="catalog-confirm-modal__eyebrow">Теория</p>
            <p class="catalog-confirm-modal__headline">${escapeHtml(title)}</p>
            <p class="catalog-confirm-modal__lead">${escapeHtml(subtitle)}</p>
          </div>
          <button type="button" class="btn-secondary h-10 px-4" data-close>Отмена</button>
        </div>
        <div class="catalog-confirm-modal__body">
          <section class="catalog-confirm-modal__hero">
            <p class="catalog-confirm-modal__item-title">${escapeHtml(asString(item.title) || 'Теория')}</p>
            <div class="catalog-confirm-modal__meta">
              <span class="catalog-confirm-modal__meta-item">Автор: ${escapeHtml(owner)}</span>
              <span class="catalog-confirm-modal__meta-item">Раздел: Теоретический центр</span>
            </div>
            ${asString(item.description) ? `<p class="catalog-confirm-modal__description">${escapeHtml(asString(item.description))}</p>` : ''}
          </section>
          <div class="catalog-confirm-modal__summary">${summaryMarkup}</div>
        </div>
        <div class="catalog-confirm-modal__footer">
          <button type="button" class="btn-secondary h-10 px-4" data-action="close">Отмена</button>
          <button type="button" class="${already ? 'btn-secondary' : 'btn-primary'} h-10 px-4" data-action-key="${already ? 'open' : 'confirm'}">${escapeHtml(primaryLabel)}</button>
        </div>
      </div>
    `, null, { blurCatalogShell: true, variant: 'confirm' });
  }

  async function openCatalogComplexConfirmModal(preview) {
    const already = !!(preview && preview.library_status && preview.library_status.already_in_library);
    const item = preview && preview.item ? preview.item : {};
    const owner = getDisplayOwner(item) || '\u0410\u0432\u0442\u043e\u0440 \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d';
    const relatedTheoryName = asString(item?.linked_theory_item?.title);
    const title = already
      ? '\u041a\u043e\u043c\u043f\u043b\u0435\u043a\u0441 \u0443\u0436\u0435 \u0432 \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0435'
      : '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441 \u0432 \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0443';
    const primaryLabel = already
      ? '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0432 \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0435'
      : '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441';
    const factsMarkup = buildConfirmFacts([
      { label: '\u0417\u0430\u0434\u0430\u043d\u0438\u044f', value: String(getTaskCount(item)) },
      ...(relatedTheoryName ? [{ label: '\u0422\u0435\u043e\u0440\u0438\u044f', value: relatedTheoryName }] : []),
    ]);
    const summaryMarkup = buildConfirmSummaryItems([
      {
        icon: 'bookmark_added',
        title: already
          ? '\u0423\u0436\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d \u0432 \u0432\u0430\u0448\u0435\u0439 \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0435 \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0430'
          : '\u041f\u043e\u044f\u0432\u0438\u0442\u0441\u044f \u0432 \u0432\u0430\u0448\u0435\u0439 \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0435 \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0430',
        text: already
          ? '\u041c\u043e\u0436\u043d\u043e \u043e\u0442\u043a\u0440\u044b\u0442\u044c \u0438\u0437 \u043a\u0430\u0442\u0430\u043b\u043e\u0433\u0430 \u0432 \u043b\u044e\u0431\u043e\u0439 \u043c\u043e\u043c\u0435\u043d\u0442.'
          : '\u041c\u0430\u0442\u0435\u0440\u0438\u0430\u043b \u0441\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u0441\u044f \u0440\u044f\u0434\u043e\u043c \u0441 \u0434\u0440\u0443\u0433\u0438\u043c\u0438 \u0432\u0430\u0448\u0438\u043c\u0438 \u043f\u0443\u0431\u043b\u0438\u043a\u0430\u0446\u0438\u044f\u043c\u0438.',
      },
      {
        icon: 'visibility',
        title: '\u041e\u0442\u043a\u0440\u044b\u0432\u0430\u0435\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u0434\u043b\u044f \u0447\u0442\u0435\u043d\u0438\u044f',
        text: '\u041a\u043e\u043c\u043f\u043b\u0435\u043a\u0441 \u043c\u043e\u0436\u043d\u043e \u043f\u0440\u043e\u0441\u043c\u0430\u0442\u0440\u0438\u0432\u0430\u0442\u044c \u0431\u0435\u0437 \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u044f \u0430\u0432\u0442\u043e\u0440\u0441\u043a\u043e\u0433\u043e \u043e\u0440\u0438\u0433\u0438\u043d\u0430\u043b\u0430.',
      },
      ...(relatedTheoryName ? [{
        icon: 'menu_book',
        title: '\u0422\u0435\u043e\u0440\u0438\u044f \u0431\u0443\u0434\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u0432\u043d\u0443\u0442\u0440\u0438 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u0430',
        text: `${relatedTheoryName} \u043e\u0442\u043a\u0440\u043e\u0435\u0442\u0441\u044f \u0432 \u043a\u043e\u043d\u0442\u0435\u043a\u0441\u0442\u0435 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u0430, \u043d\u043e \u043d\u0435 \u043f\u043e\u044f\u0432\u0438\u0442\u0441\u044f \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e \u0432 \u0426\u0435\u043d\u0442\u0440\u0435 \u0442\u0435\u043e\u0440\u0438\u0438.`,
      }] : []),
      {
        icon: relatedTheoryName ? 'library_add_check' : 'edit_off',
        title: relatedTheoryName
          ? '\u0414\u043b\u044f \u0441\u0432\u043e\u0438\u0445 \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u043e\u0432 \u043d\u0443\u0436\u043d\u0430 \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u0430\u044f \u0442\u0435\u043e\u0440\u0438\u044f'
          : '\u041a\u043e\u043f\u0438\u044f \u0432 \u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440 \u043d\u0435 \u0441\u043e\u0437\u0434\u0430\u0451\u0442\u0441\u044f',
        text: relatedTheoryName
          ? '\u0427\u0442\u043e\u0431\u044b \u043f\u0440\u0438\u0432\u044f\u0437\u044b\u0432\u0430\u0442\u044c \u044d\u0442\u0443 \u0442\u0435\u043e\u0440\u0438\u044e \u043a \u0441\u0432\u043e\u0438\u043c \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u0430\u043c, \u0435\u0451 \u043d\u0443\u0436\u043d\u043e \u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e.'
          : '\u0414\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u043d\u0435 \u043f\u0435\u0440\u0435\u043d\u043e\u0441\u0438\u0442 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b \u0432 \u0440\u0430\u0431\u043e\u0447\u0438\u0439 \u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440.',
      },
    ]);
    return openModal(`
      <div class="catalog-confirm-modal custom-scrollbar">
        <div class="catalog-confirm-modal__header">
          <div>
            <p class="catalog-confirm-modal__eyebrow">\u041a\u043e\u043c\u043f\u043b\u0435\u043a\u0441</p>
            <p class="catalog-confirm-modal__headline">${escapeHtml(title)}</p>
          </div>
          <button type="button" class="btn-secondary h-10 px-4" data-close>\u041e\u0442\u043c\u0435\u043d\u0430</button>
        </div>
        <div class="catalog-confirm-modal__body">
          <section class="catalog-confirm-modal__hero">
            <p class="catalog-confirm-modal__item-title">${escapeHtml(asString(item.title) || '\u041a\u043e\u043c\u043f\u043b\u0435\u043a\u0441')}</p>
            <div class="catalog-confirm-modal__meta">
              <span class="catalog-confirm-modal__meta-item">\u0410\u0432\u0442\u043e\u0440: ${escapeHtml(owner)}</span>
              <span class="catalog-confirm-modal__meta-item">\u0420\u0430\u0437\u0434\u0435\u043b: \u041a\u0430\u0442\u0430\u043b\u043e\u0433</span>
            </div>
            ${asString(item.description) ? `<p class="catalog-confirm-modal__description">${escapeHtml(asString(item.description))}</p>` : ''}
          </section>
          ${factsMarkup ? `<div class="catalog-confirm-modal__facts">${factsMarkup}</div>` : ''}
          <div class="catalog-confirm-modal__summary">${summaryMarkup}</div>
        </div>
        <div class="catalog-confirm-modal__footer">
          <button type="button" class="btn-secondary h-10 px-4" data-action="close">\u041e\u0442\u043c\u0435\u043d\u0430</button>
          <button type="button" class="${already ? 'btn-secondary' : 'btn-primary'} h-10 px-4" data-action-key="${already ? 'open' : 'confirm'}">${escapeHtml(primaryLabel)}</button>
        </div>
      </div>
    `, null, { blurCatalogShell: true, variant: 'confirm' });
  }

  async function openCatalogTheoryConfirmModal(preview) {
    const already = !!(preview && preview.library_status && preview.library_status.already_in_library);
    const item = preview && preview.item ? preview.item : {};
    const owner = getDisplayOwner(item) || '\u0410\u0432\u0442\u043e\u0440 \u043d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d';
    const linkedComplexes = Array.isArray(item?.linked_complex_items) ? item.linked_complex_items : [];
    const relatedComplexTitle = asString(linkedComplexes[0]?.title);
    const title = already
      ? '\u0422\u0435\u043e\u0440\u0438\u044f \u0443\u0436\u0435 \u0432 \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0435'
      : '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0442\u0435\u043e\u0440\u0438\u044e';
    const subtitle = already
      ? '\u0422\u0435\u043e\u0440\u0438\u044f \u0443\u0436\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0430 \u0438 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u0447\u0435\u0440\u0435\u0437 \u0422\u0435\u043e\u0440\u0435\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0446\u0435\u043d\u0442\u0440.'
      : relatedComplexTitle
        ? '\u0422\u0435\u043e\u0440\u0438\u044f \u043f\u043e\u044f\u0432\u0438\u0442\u0441\u044f \u0432 \u0422\u0435\u043e\u0440\u0435\u0442\u0438\u0447\u0435\u0441\u043a\u043e\u043c \u0446\u0435\u043d\u0442\u0440\u0435 \u043a\u0430\u043a \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u044b\u0439 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b. \u041a\u043e\u043c\u043f\u043b\u0435\u043a\u0441 \u043f\u0440\u0438 \u044d\u0442\u043e\u043c \u043d\u0443\u0436\u043d\u043e \u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0442\u044c \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e.'
        : '\u0422\u0435\u043e\u0440\u0438\u044f \u043f\u043e\u044f\u0432\u0438\u0442\u0441\u044f \u0432 \u0422\u0435\u043e\u0440\u0435\u0442\u0438\u0447\u0435\u0441\u043a\u043e\u043c \u0446\u0435\u043d\u0442\u0440\u0435 \u0438 \u0431\u0443\u0434\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u0434\u043b\u044f \u0447\u0442\u0435\u043d\u0438\u044f.';
    const primaryLabel = already
      ? '\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u0432 \u0422\u0435\u043e\u0440\u0435\u0442\u0438\u0447\u0435\u0441\u043a\u043e\u043c \u0446\u0435\u043d\u0442\u0440\u0435'
      : '\u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u0442\u0435\u043e\u0440\u0438\u044e';
    const summaryMarkup = buildConfirmSummaryItems([
      {
        icon: 'bookmark_added',
        title: already
          ? '\u0423\u0436\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0430 \u0432 \u0422\u0435\u043e\u0440\u0435\u0442\u0438\u0447\u0435\u0441\u043a\u043e\u043c \u0446\u0435\u043d\u0442\u0440\u0435'
          : '\u041f\u043e\u044f\u0432\u0438\u0442\u0441\u044f \u0432 \u0422\u0435\u043e\u0440\u0435\u0442\u0438\u0447\u0435\u0441\u043a\u043e\u043c \u0446\u0435\u043d\u0442\u0440\u0435',
        text: '\u041c\u0430\u0442\u0435\u0440\u0438\u0430\u043b \u0431\u0443\u0434\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d \u0440\u044f\u0434\u043e\u043c \u0441 \u0434\u0440\u0443\u0433\u0438\u043c\u0438 \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u043c\u0438 \u0442\u0435\u043e\u0440\u0438\u044f\u043c\u0438.',
      },
      {
        icon: 'library_add_check',
        title: '\u041c\u043e\u0436\u043d\u043e \u043f\u0440\u0438\u0432\u044f\u0437\u044b\u0432\u0430\u0442\u044c \u043a \u0441\u0432\u043e\u0438\u043c \u043a\u043e\u043c\u043f\u043b\u0435\u043a\u0441\u0430\u043c',
        text: '\u041f\u043e\u0441\u043b\u0435 \u0434\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u0442\u0435\u043e\u0440\u0438\u044f \u0441\u0442\u0430\u043d\u0435\u0442 \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e\u0439 \u0441\u0443\u0449\u043d\u043e\u0441\u0442\u044c\u044e \u0432 \u0432\u0430\u0448\u0435\u0439 \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0435.',
      },
      ...(relatedComplexTitle ? [{
        icon: 'account_tree',
        title: '\u041a\u043e\u043c\u043f\u043b\u0435\u043a\u0441 \u043d\u0435 \u0434\u043e\u0431\u0430\u0432\u0438\u0442\u0441\u044f \u0430\u0432\u0442\u043e\u043c\u0430\u0442\u0438\u0447\u0435\u0441\u043a\u0438',
        text: `${relatedComplexTitle} \u043e\u0441\u0442\u0430\u043d\u0435\u0442\u0441\u044f \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e\u0439 \u043f\u0443\u0431\u043b\u0438\u043a\u0430\u0446\u0438\u0435\u0439 \u0438 \u0434\u043e\u0431\u0430\u0432\u043b\u044f\u0435\u0442\u0441\u044f \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u043e.`,
      }] : []),
      {
        icon: 'content_copy',
        title: '\u041b\u0438\u0447\u043d\u0430\u044f \u043a\u043e\u043f\u0438\u044f \u043d\u0435 \u0441\u043e\u0437\u0434\u0430\u0451\u0442\u0441\u044f',
        text: '\u0414\u043e\u0431\u0430\u0432\u043b\u0435\u043d\u0438\u0435 \u043d\u0435 \u043f\u0435\u0440\u0435\u043d\u043e\u0441\u0438\u0442 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b \u0432 \u043e\u0442\u0434\u0435\u043b\u044c\u043d\u044b\u0439 \u0440\u0435\u0434\u0430\u043a\u0442\u043e\u0440.',
      },
    ]);
    return openModal(`
      <div class="catalog-confirm-modal catalog-confirm-modal--theory custom-scrollbar">
        <div class="catalog-confirm-modal__header">
          <div>
            <p class="catalog-confirm-modal__eyebrow">\u0422\u0435\u043e\u0440\u0438\u044f</p>
            <p class="catalog-confirm-modal__headline">${escapeHtml(title)}</p>
            <p class="catalog-confirm-modal__lead">${escapeHtml(subtitle)}</p>
          </div>
          <button type="button" class="btn-secondary h-10 px-4" data-close>\u041e\u0442\u043c\u0435\u043d\u0430</button>
        </div>
        <div class="catalog-confirm-modal__body">
          <section class="catalog-confirm-modal__hero">
            <p class="catalog-confirm-modal__item-title">${escapeHtml(asString(item.title) || '\u0422\u0435\u043e\u0440\u0438\u044f')}</p>
            <div class="catalog-confirm-modal__meta">
              <span class="catalog-confirm-modal__meta-item">\u0410\u0432\u0442\u043e\u0440: ${escapeHtml(owner)}</span>
              <span class="catalog-confirm-modal__meta-item">\u0420\u0430\u0437\u0434\u0435\u043b: \u0422\u0435\u043e\u0440\u0435\u0442\u0438\u0447\u0435\u0441\u043a\u0438\u0439 \u0446\u0435\u043d\u0442\u0440</span>
            </div>
            ${asString(item.description) ? `<p class="catalog-confirm-modal__description">${escapeHtml(asString(item.description))}</p>` : ''}
          </section>
          <div class="catalog-confirm-modal__summary">${summaryMarkup}</div>
        </div>
        <div class="catalog-confirm-modal__footer">
          <button type="button" class="btn-secondary h-10 px-4" data-action="close">\u041e\u0442\u043c\u0435\u043d\u0430</button>
          <button type="button" class="${already ? 'btn-secondary' : 'btn-primary'} h-10 px-4" data-action-key="${already ? 'open' : 'confirm'}">${escapeHtml(primaryLabel)}</button>
        </div>
      </div>
    `, null, { blurCatalogShell: true, variant: 'confirm' });
  }

  async function openCatalogComplexConfirmModal(preview) {
    const already = !!(preview && preview.library_status && preview.library_status.already_in_library);
    const item = preview && preview.item ? preview.item : {};
    const owner = getDisplayOwner(item) || 'Автор не указан';
    const relatedTheoryName = asString(item?.linked_theory_item?.title);
    const primaryLabel = already
      ? 'Открыть в библиотеке'
      : preview?.blocked
        ? 'Лимит достигнут'
        : 'Добавить комплекс';
    const factsMarkup = buildConfirmFacts([
      { label: 'Задания', value: String(getTaskCount(item)) },
      ...(relatedTheoryName ? [{ label: 'Теория', value: relatedTheoryName }] : []),
    ]);
    const summaryMarkup = buildConfirmSummaryItems([
      {
        icon: 'bookmark_added',
        title: already ? 'Уже сохранен в вашей библиотеке каталога' : 'Появится в вашей библиотеке каталога',
        text: already ? 'Можно открыть из каталога в любой момент.' : 'Материал сохранится рядом с другими вашими публикациями.',
      },
      {
        icon: 'visibility',
        title: 'Открывается только для чтения',
        text: 'Комплекс можно просматривать без редактирования авторского оригинала.',
      },
      ...(relatedTheoryName ? [{
        icon: 'menu_book',
        title: 'Связанная теория добавится вместе с комплексом',
        text: `${relatedTheoryName} будет доступна в библиотеке пользователя.`,
      }] : []),
    ]);
    const limitNote = buildWorkspaceLimitNote(preview);
    return openModal(`
      <div class="catalog-confirm-modal custom-scrollbar">
        <div class="catalog-confirm-modal__header">
          <div>
            <p class="catalog-confirm-modal__eyebrow">Комплекс</p>
            <p class="catalog-confirm-modal__headline">${escapeHtml(already ? 'Комплекс уже в библиотеке' : 'Добавить комплекс в библиотеку')}</p>
          </div>
          <button type="button" class="btn-secondary h-10 px-4" data-close>Отмена</button>
        </div>
        <div class="catalog-confirm-modal__body">
          <section class="catalog-confirm-modal__hero">
            <p class="catalog-confirm-modal__item-title">${escapeHtml(asString(item.title) || 'Комплекс')}</p>
            <div class="catalog-confirm-modal__meta">
              <span class="catalog-confirm-modal__meta-item">Автор: ${escapeHtml(owner)}</span>
              <span class="catalog-confirm-modal__meta-item">Раздел: Каталог</span>
            </div>
            ${asString(item.description) ? `<p class="catalog-confirm-modal__description">${escapeHtml(asString(item.description))}</p>` : ''}
          </section>
          ${limitNote ? `<div class="mb-4 rounded-2xl border border-warning-light bg-warning-lighter px-4 py-3 text-sm text-warning-darker">${escapeHtml(limitNote)}</div>` : ''}
          ${factsMarkup ? `<div class="catalog-confirm-modal__facts">${factsMarkup}</div>` : ''}
          <div class="catalog-confirm-modal__summary">${summaryMarkup}</div>
        </div>
        <div class="catalog-confirm-modal__footer">
          <button type="button" class="btn-secondary h-10 px-4" data-action="close">Отмена</button>
          <button type="button" class="${already || preview?.blocked ? 'btn-secondary' : 'btn-primary'} h-10 px-4" data-action-key="${already ? 'open' : 'confirm'}" ${preview?.blocked && !already ? 'disabled' : ''}>${escapeHtml(primaryLabel)}</button>
        </div>
      </div>
    `, null, { blurCatalogShell: true, variant: 'confirm' });
  }

  async function openCatalogTheoryConfirmModal(preview) {
    const already = !!(preview && preview.library_status && preview.library_status.already_in_library);
    const item = preview && preview.item ? preview.item : {};
    const owner = getDisplayOwner(item) || 'Автор не указан';
    const relatedComplexTitle = asString((Array.isArray(item?.linked_complex_items) ? item.linked_complex_items : [])[0]?.title);
    const primaryLabel = already
      ? 'Открыть в Теоретическом центре'
      : preview?.blocked
        ? 'Лимит достигнут'
        : 'Добавить теорию';
    const summaryMarkup = buildConfirmSummaryItems([
      {
        icon: 'bookmark_added',
        title: already ? 'Уже сохранена в Теоретическом центре' : 'Появится в Теоретическом центре',
        text: 'Материал будет доступен рядом с другими сохраненными теориями.',
      },
      {
        icon: 'library_add_check',
        title: 'Можно привязывать к своим комплексам',
        text: 'После добавления теория станет отдельной сущностью в вашей библиотеке.',
      },
      ...(relatedComplexTitle ? [{
        icon: 'account_tree',
        title: 'Комплекс не добавится автоматически',
        text: `${relatedComplexTitle} останется отдельной публикацией и добавляется отдельно.`,
      }] : []),
    ]);
    const limitNote = buildWorkspaceLimitNote(preview);
    return openModal(`
      <div class="catalog-confirm-modal catalog-confirm-modal--theory custom-scrollbar">
        <div class="catalog-confirm-modal__header">
          <div>
            <p class="catalog-confirm-modal__eyebrow">Теория</p>
            <p class="catalog-confirm-modal__headline">${escapeHtml(already ? 'Теория уже в библиотеке' : 'Добавить теорию')}</p>
          </div>
          <button type="button" class="btn-secondary h-10 px-4" data-close>Отмена</button>
        </div>
        <div class="catalog-confirm-modal__body">
          <section class="catalog-confirm-modal__hero">
            <p class="catalog-confirm-modal__item-title">${escapeHtml(asString(item.title) || 'Теория')}</p>
            <div class="catalog-confirm-modal__meta">
              <span class="catalog-confirm-modal__meta-item">Автор: ${escapeHtml(owner)}</span>
              <span class="catalog-confirm-modal__meta-item">Раздел: Теоретический центр</span>
            </div>
            ${asString(item.description) ? `<p class="catalog-confirm-modal__description">${escapeHtml(asString(item.description))}</p>` : ''}
          </section>
          ${limitNote ? `<div class="mb-4 rounded-2xl border border-warning-light bg-warning-lighter px-4 py-3 text-sm text-warning-darker">${escapeHtml(limitNote)}</div>` : ''}
          <div class="catalog-confirm-modal__summary">${summaryMarkup}</div>
        </div>
        <div class="catalog-confirm-modal__footer">
          <button type="button" class="btn-secondary h-10 px-4" data-action="close">Отмена</button>
          <button type="button" class="${already || preview?.blocked ? 'btn-secondary' : 'btn-primary'} h-10 px-4" data-action-key="${already ? 'open' : 'confirm'}" ${preview?.blocked && !already ? 'disabled' : ''}>${escapeHtml(primaryLabel)}</button>
        </div>
      </div>
    `, null, { blurCatalogShell: true, variant: 'confirm' });
  }

  function resolveLibraryTarget(resultPayload) {
    const libraryStatus = resultPayload && resultPayload.library_status ? resultPayload.library_status : {};
    const contentType = asString(libraryStatus.content_type || resultPayload?.item?.content_type) || 'complex';
    const libraryEntityId = asString(libraryStatus.library_entity_id)
      || asString(resultPayload?.workspace?.complex_id)
      || asString(resultPayload?.workspace?.theory_ids && resultPayload.workspace.theory_ids[0]);
    if (contentType === 'complex') {
      return resolveComplexesLibraryUrl();
    }
    if (!libraryEntityId) return '';
    if (contentType === 'theory') {
      const returnUrl = `${global.location.pathname}${global.location.search}`;
      return `/ui/editor/Theory_Center.html?linked_entry_id=${encodeURIComponent(libraryEntityId)}&return_url=${encodeURIComponent(returnUrl)}`;
    }
    return '';
  }

  function resolveSourceTarget(item) {
    const sourceId = asString(item && item.source_workspace_id);
    if (!sourceId) return '';
    if (item && item.content_type === 'theory') {
      const returnUrl = `${global.location.pathname}${global.location.search}`;
      return `/ui/editor/Theory_Editor.html?theory_id=${encodeURIComponent(sourceId)}&return_url=${encodeURIComponent(returnUrl)}`;
    }
    return `/ui/complexes/create?id=${encodeURIComponent(sourceId)}`;
  }

  async function executeAddToLibrary(item) {
    let payload;
    try {
      payload = await fetchJson(`/api/catalog/items/${encodeURIComponent(asString(item.item_id))}/library`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch (error) {
      if (error?.status === 409 && error?.payload?.error === 'workspace_limit_reached') {
        await loadWorkspaceLimits();
        const summary = getWorkspaceLimitEntity(item?.content_type === 'theory' ? 'theory' : 'complex');
        showToast(getWorkspaceLimitMessage(summary, { label: item?.content_type === 'theory' ? 'теорий' : 'комплексов' }) || 'Лимит библиотеки достигнут.', 'warning', 4200);
      }
      throw error;
    }
    const versionKey = getVersionKey(item);
    if (versionKey) {
      state.statusByVersionKey.set(versionKey, {
        ok: true,
        item: payload.item,
        version: payload.version,
        library_entry: payload.library_entry,
        library_status: payload.library_status,
      });
    }
    await loadWorkspaceLimits();
    render();
    showToast(item && item.content_type === 'theory' ? 'Теория добавлена в Теоретический центр.' : 'Комплекс добавлен в сохранённые публикации каталога.', 'success', 2800);
    return payload;
  }

  async function openPreviewFlow(item) {
    const versionId = asString(item && item.latest_version_id);
    const basePreview = {
      ok: true,
      item,
      library_status: getStatus(item)?.library_status || {
        already_in_library: false,
        action: 'create_link',
        content_type: item?.content_type || 'complex',
      },
    };
    let preview = basePreview;
    if (versionId) {
      try {
        preview = await fetchJson(`/api/catalog/items/${encodeURIComponent(asString(item.item_id))}/versions/${encodeURIComponent(versionId)}/add-to-library/preview`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
      } catch (error) {
        if (error?.status === 409 && error?.payload?.error === 'workspace_limit_reached') {
          await loadWorkspaceLimits();
          preview = {
            ...basePreview,
            blocked: true,
            workspace_limits: error.payload?.details ? { blocked: true, errors: [error.payload.details], summary: state.workspaceLimits } : null,
          };
        } else {
          throw error;
        }
      }
    }
    const modalAction = item && item.content_type === 'theory'
      ? await openCatalogTheoryConfirmModal(preview)
      : await openCatalogComplexConfirmModal(preview);
    if (!modalAction) return;
    if (modalAction === 'open') {
      if (item && item.content_type === 'theory') {
        const target = resolveLibraryTarget(preview);
        if (target) navigate(target);
      } else {
        navigate(resolveComplexesLibraryUrl());
      }
      return;
    }
    if (modalAction !== 'confirm') return;
    await executeAddToLibrary(item);
  }

  async function handlePrimaryAction(item) {
    const action = getPrimaryAction(item);
    if (!action || action.disabled) return;
    if (action.key === 'login') {
      showToast('Войдите в аккаунт, чтобы добавлять публикации в библиотеку.', 'warning', 3400);
      navigate('/ui/welcome');
      return;
    }
    if (action.key === 'open-library') {
      const status = getStatus(item);
      if (item && item.content_type === 'theory') {
        const target = resolveLibraryTarget(status || { item, library_status: { content_type: item.content_type } });
        if (target) {
          navigate(target);
        } else {
          showToast('Запись в библиотеке пока не найдена.', 'warning');
        }
        return;
      }
      navigate(resolveComplexesLibraryUrl());
      return;
    }
    if (action.key === 'preview') {
      try {
        await openPreviewFlow(item);
      } catch (error) {
        if (error && error.status === 403) {
          showToast('Для добавления в библиотеку нужно войти в аккаунт.', 'warning');
          navigate('/ui/welcome');
          return;
        }
        showToast(`Не удалось открыть превью: ${asString(error && error.message) || 'unknown_error'}`, 'error', 4200);
      }
    }
  }

  function renderSummary() {
    const total = state.filteredItems.length;
    const typeLabel =
      state.contentType === 'saved' ? 'сохраненных комплексов'
        : state.contentType === 'complex' ? 'комплексов'
        : state.contentType === 'theory' ? 'теорий'
          : 'публикаций';
    const theorySummary = getWorkspaceLimitEntity('theory');
    const complexSummary = getWorkspaceLimitEntity('complex');
    const slotsText = !state.authenticated || isPremiumWorkspacePlan() || (!theorySummary && !complexSummary)
      ? ''
      : ` · Слоты: теории ${Number(theorySummary?.library_total_count || 0)}/${Number(theorySummary?.library_limit || 0)}, комплексы ${Number(complexSummary?.library_total_count || 0)}/${Number(complexSummary?.library_limit || 0)}`;
    if (state.loading) {
      els.summary.textContent = 'Загружаем каталог...';
      return;
    }
    if (state.error) {
      els.summary.textContent = 'Каталог сейчас недоступен';
      return;
    }
    if (!total) {
      els.summary.textContent = `Пустой результат поиска${slotsText}`;
      return;
    }
    els.summary.textContent = `Найдено ${total} ${typeLabel}${slotsText}`;
  }

  function bindEvents() {
    els.searchInput.addEventListener('input', debounce((event) => {
      state.query = asString(event.target && event.target.value);
      loadCatalogItems();
    }, 260));

    global.document.querySelectorAll('[data-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = asString(button.getAttribute('data-filter')) || 'all';
        if (state.contentType === next) return;
        state.contentType = next;
        global.document.querySelectorAll('[data-filter]').forEach((node) => {
          node.classList.toggle('is-active', node === button);
        });
        try {
          const url = new URL(global.location.href);
          if (next === 'all') url.searchParams.delete('content_type');
          else url.searchParams.set('content_type', next);
          global.history.replaceState({}, '', `${url.pathname}${url.search}`);
        } catch (_) {}
        loadCatalogItems();
      });
    });

    global.document.addEventListener('click', (event) => {
      const isCard = event.target.closest('.catalog-card');
      const isDetailPanel = event.target.closest('#catalog-detail');
      
      if (!isCard && !isDetailPanel && state.selectedItemId) {
        state.selectedItemId = '';
        const selectedElements = els.grid.querySelectorAll('.catalog-card.is-selected');
        selectedElements.forEach(el => el.classList.remove('is-selected'));
        renderDetail();
      }
    });
  }

  async function init() {
    els.searchInput = $('catalog-search-input');
    els.summary = $('catalog-summary');
    els.loading = $('catalog-loading');
    els.error = $('catalog-error');
    els.empty = $('catalog-empty');
    els.grid = $('catalog-grid');
    els.detail = $('catalog-detail');
    els.detailEmpty = $('catalog-detail-empty');
    els.detailContent = $('catalog-detail-content');
    els.authNote = $('catalog-auth-note');

    const params = new URLSearchParams(global.location.search || '');
    const initialContentType = asString(params.get('content_type')).toLowerCase();
    if (['all', 'complex', 'theory', 'saved'].includes(initialContentType)) {
      state.contentType = initialContentType;
    }
    global.document.querySelectorAll('[data-filter]').forEach((node) => {
      node.classList.toggle('is-active', asString(node.getAttribute('data-filter')) === state.contentType);
    });

    bindEvents();
    await loadCurrentUser();
    await loadWorkspaceLimits();
    await loadCatalogItems();
  }

  if (global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window);
