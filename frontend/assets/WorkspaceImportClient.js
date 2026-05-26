(function attachWorkspaceImportClient(global) {
  'use strict';

  function wt(key, fallback) {
    if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
      var v = window.i18n.t(key); if (v !== key) return v;
    }
    return fallback;
  }

  function asString(value) {
    return String(value == null ? '' : value).trim();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function resolveComplexOwnership(payload) {
    const ownership = (payload && typeof payload.ownership === 'object') ? payload.ownership : {};
    const createdByUserId = asString(
      ownership.created_by_user_id
      || ownership.createdByUserId
      || payload?.created_by_user_id
    );
    const updatedByUserId = asString(
      ownership.updated_by_user_id
      || ownership.updatedByUserId
      || payload?.updated_by_user_id
      || createdByUserId
    );
    return {
      createdByUserId,
      createdByUserName: asString(
        ownership.created_by_user_name
        || ownership.createdByUserName
        || payload?.created_by_user_name
      ),
      updatedByUserId,
      createdVia: asString(
        ownership.created_via
        || ownership.createdVia
        || payload?.created_via
      ) || 'legacy_unknown',
      contentScope: asString(
        ownership.content_scope
        || ownership.contentScope
        || payload?.content_scope
      ) || 'shared_local',
      hasOwner: ownership.has_owner === true || ownership.hasOwner === true || !!createdByUserId,
      isOwnedByCurrentUser: ownership.is_owned_by_current_user === true || ownership.isOwnedByCurrentUser === true,
      isSharedLibrary: ownership.is_shared_library !== false && ownership.isSharedLibrary !== false,
    };
  }

  function getCreatedViaLabel(createdVia) {
    const normalized = asString(createdVia).toLowerCase();
    if (normalized === 'workspace_import') return 'Legacy import';
    if (normalized === 'archive_import') return 'Legacy import';
    switch (asString(createdVia).toLowerCase()) {
      case 'complex_builder':
        return wt('wic.created_via_builder', 'Конструктор');
      case 'manual_editor':
        return wt('wic.created_via_editor', 'Редактор');
      case 'analysis_auto':
        return wt('wic.created_via_ai', 'AI генерация');
      case 'topic_propagation':
        return wt('wic.created_via_topic_sync', 'Синхронизация тем');
      case 'single_complex_sync':
        return wt('wic.created_via_complex_sync', 'Синхронизация комплекса');
      case 'workspace_import':
      case 'archive_import':
        return 'Legacy import';
      default:
        return asString(createdVia) || wt('wic.source_unknown', 'Источник не определён');
    }
  }

  function shouldShowWorkspaceCopyAction(payload) {
    void payload;
    return false;
    return !resolveComplexOwnership(payload).isOwnedByCurrentUser;
  }

  function buildWorkspaceImportRequest(payload) {
    const complexId = asString(payload?.id || payload?.complex_id);
    return {
      source_complex_id: complexId,
      source_catalog_item_id: asString(
        payload?.source_catalog_item_id
        || payload?.sourceLineage?.catalog_item_id
        || payload?.source_lineage?.catalog_item_id
      ) || (complexId ? 'internal_workspace_complex:' + complexId : ''),
      source_catalog_version_id: asString(
        payload?.source_catalog_version_id
        || payload?.sourceLineage?.catalog_version_id
        || payload?.source_lineage?.catalog_version_id
      ) || 'draft',
      prefer_existing_by_lineage: payload?.prefer_existing_by_lineage !== false && payload?.preferExistingByLineage !== false,
    };
  }

  function normalizeWorkspaceImportNodeSummary(node) {
    const ownership = (node && typeof node.ownership === 'object') ? node.ownership : {};
    const workspaceCopy = (node && typeof node.workspace_copy === 'object') ? node.workspace_copy : {};
    const sourceLineage = (node && typeof node.source_lineage === 'object') ? node.source_lineage : {};
    return {
      title: asString(node?.name || node?.title || node?.workspace_entity_ref || node?.workspace_entity_id) || wt('wic.untitled', 'Без названия'),
      workspaceRef: asString(node?.workspace_entity_ref || node?.workspace_entity_id),
      copyKind: asString(workspaceCopy.kind || workspaceCopy.workspace_copy_kind),
      createdVia: asString(ownership.created_via || node?.created_via),
      ownerId: asString(ownership.created_by_user_id || node?.created_by_user_id),
      sourceRef: asString(
        sourceLineage.entity_id
        || node?.source_entity_id
        || sourceLineage.catalog_item_id
        || node?.source_catalog_item_id
      ),
    };
  }

  function renderWorkspaceImportNodePreview(title, nodes, emptyText) {
    const normalizedNodes = Array.isArray(nodes) ? nodes : [];
    if (!normalizedNodes.length) {
      return `<div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-3 text-sm text-text-secondary">${escapeHtml(emptyText || wt('wic.no_items', 'Нет элементов.'))}</div>`;
    }

    const preview = normalizedNodes.slice(0, 4).map((node) => {
      const summary = normalizeWorkspaceImportNodeSummary(node);
      const badges = [
        summary.copyKind ? `<span class="inline-flex items-center rounded-full border border-border-subtle bg-surface-1 px-2 py-0.5 text-[10px] font-semibold text-text-secondary">${escapeHtml(summary.copyKind)}</span>` : '',
        summary.createdVia ? `<span class="inline-flex items-center rounded-full border border-border-subtle bg-surface-1 px-2 py-0.5 text-[10px] font-semibold text-text-secondary">${escapeHtml(summary.createdVia)}</span>` : '',
      ].filter(Boolean).join('');

      return `
        <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-3">
          <div class="text-sm font-semibold text-text-main break-words">${escapeHtml(summary.title)}</div>
          ${badges ? `<div class="mt-2 flex flex-wrap gap-1">${badges}</div>` : ''}
          ${summary.workspaceRef ? `<div class="mt-2 text-[11px] text-text-secondary break-all">${wt('wic.copy_label', 'Копия')}: ${escapeHtml(summary.workspaceRef)}</div>` : ''}
          ${summary.sourceRef ? `<div class="mt-1 text-[11px] text-text-secondary break-all">${wt('wic.source_label', 'Источник')}: ${escapeHtml(summary.sourceRef)}</div>` : ''}
        </div>
      `;
    }).join('');

    const remainder = normalizedNodes.length > 4
      ? `<div class="px-1 text-xs text-text-secondary">+${escapeHtml(String(normalizedNodes.length - 4))} ${wt('wic.more_suffix', 'ещё')}</div>`
      : '';

    return `
      <div class="space-y-2">
        <div class="text-sm font-semibold text-text-main">${escapeHtml(title)}</div>
        <div class="space-y-2">${preview}${remainder}</div>
      </div>
    `;
  }

  function showModalOverlay(markup, options) {
    if (!global.document || !global.document.body) {
      return Promise.resolve(null);
    }

    const zIndexClass = asString(options && options.zIndexClass) || 'z-[1220]';
    const overlay = global.document.createElement('div');
    overlay.className = `fixed inset-0 ${zIndexClass} bg-scrim backdrop-blur-sm flex items-center justify-center p-4`;
    overlay.innerHTML = markup;

    return new Promise((resolve) => {
      const close = (resultValue) => {
        overlay.remove();
        resolve(resultValue);
      };

      overlay.querySelectorAll('[data-role="close"], [data-role="cancel"]').forEach((node) => {
        node.addEventListener('click', () => close(null));
      });

      const confirmButton = overlay.querySelector('[data-role="confirm"]');
      if (confirmButton) {
        confirmButton.addEventListener('click', () => close(options && Object.prototype.hasOwnProperty.call(options, 'confirmResult') ? options.confirmResult : true));
      }

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          close(null);
        }
      });

      global.document.body.appendChild(overlay);
    });
  }

  function confirmAction(options) {
    if (global.NotificationUI && typeof global.NotificationUI.confirm === 'function') {
      return global.NotificationUI.confirm({
        title: asString(options && options.title) || wt('wic.confirm_title', 'Подтвердите действие'),
        message: asString(options && options.message) || wt('wic.confirm_message', 'Подтвердите действие.'),
        confirmText: asString(options && options.confirmText) || wt('wic.confirm_ok', 'Продолжить'),
        cancelText: asString(options && options.cancelText) || wt('wic.cancel', 'Отмена'),
        variant: asString(options && options.variant) || 'warning',
      });
    }

    const title = asString(options && options.title) || wt('wic.confirm_title', 'Подтвердите действие');
    const message = asString(options && options.message) || wt('wic.confirm_message', 'Подтвердите действие.');
    const confirmText = asString(options && options.confirmText) || wt('wic.confirm_ok', 'Продолжить');
    const cancelText = asString(options && options.cancelText) || wt('wic.cancel', 'Отмена');
    const variant = asString(options && options.variant).toLowerCase();
    const confirmButtonClass = variant === 'error'
      ? 'border border-error-light bg-error-lighter text-error-text hover:border-error hover:bg-error-lighter'
      : 'btn-primary';

    const config = (options && typeof options === 'object') ? options : {};
    const dialogTitle = asString(config.title) || wt('wic.workspace_copy_title', 'Перед созданием рабочей версии');
    const dialogLead = asString(config.lead) || wt('wic.workspace_copy_lead', 'Проверьте, что именно будет создано в вашем workspace. Источник при этом не изменится.');
    const sourceLabel = asString(config.sourceLabel) || wt('wic.source_label', 'Источник');
    const targetLabel = asString(config.targetLabel) || wt('wic.will_be_created', 'Будет создано');
    const modeValue = asString(config.modeValue) || wt('wic.independent_version', 'Независимая версия в workspace');
    const dialogCancelText = asString(config.cancelText) || wt('wic.cancel', 'Отмена');
    const dialogConfirmText = asString(config.confirmText) || wt('wic.create_version', 'Создать свою версию');

    return showModalOverlay(`
      <div class="w-full max-w-lg overflow-hidden rounded-[28px] border border-border-subtle bg-surface-1 shadow-xl">
        <div class="border-b border-border-subtle px-5 py-4">
          <p class="text-lg font-bold text-text-main">${escapeHtml(title)}</p>
          <p class="mt-2 text-sm text-text-secondary">${escapeHtml(message)}</p>
        </div>
        <div class="flex justify-end gap-3 px-5 py-4">
          <button type="button" class="btn-secondary h-10 px-4" data-role="cancel">${escapeHtml(cancelText)}</button>
          <button type="button" class="${confirmButtonClass} h-10 px-4" data-role="confirm">${escapeHtml(confirmText)}</button>
        </div>
      </div>
    `, {
      confirmResult: true,
      zIndexClass: 'z-[1250]',
    }).then((resultValue) => Boolean(resultValue));
  }

  function openPreviewDialog(previewData, request, payload, options) {
    const summary = (previewData && typeof previewData.summary === 'object') ? previewData.summary : {};
    const workspace = (previewData && typeof previewData.workspace === 'object') ? previewData.workspace : {};
    const result = (previewData && typeof previewData.result === 'object') ? previewData.result : {};
    const source = (previewData && typeof previewData.source === 'object') ? previewData.source : {};
    const totalNodes = (summary && typeof summary.total_nodes === 'object') ? summary.total_nodes : {};
    const createdCounts = (summary && typeof summary.created_counts === 'object') ? summary.created_counts : {};
    const reusedCounts = (summary && typeof summary.reused_counts === 'object') ? summary.reused_counts : {};
    const routeNamespace = asString(previewData?.route_contract?.namespace) || 'internal_workspace_import';
    const payloadTitle = asString(payload?.name || payload?.complex_name || payload?.complexName || payload?.id || payload?.complex_id);
    const complexTitle = payloadTitle || asString(workspace?.complex_id) || asString(request?.source_complex_id) || wt('wic.complex_label', 'Комплекс');

    return showModalOverlay(`
      <div class="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-border-subtle bg-surface-1 shadow-xl">
        <div class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div>
            <p class="text-lg font-bold text-text-main">${wt('wic.preview_title', 'Перед добавлением в библиотеку')}</p>
            <p class="mt-1 text-sm text-text-secondary">${wt('wic.preview_lead', 'Проверьте, что именно будет создано в вашей библиотеке. Одинаковые названия не объединяются автоматически.')}</p>
          </div>
          <button type="button" class="btn-secondary h-10 px-4" data-role="close">${wt('wic.close', 'Закрыть')}</button>
        </div>
        <div class="custom-scrollbar space-y-5 overflow-y-auto p-5">
          <div class="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-3">
              <div class="text-xs uppercase tracking-wide text-text-secondary">${wt('wic.tasks_label', 'Задания')}</div>
              <div class="mt-1 text-2xl font-bold text-text-main">${escapeHtml(String(totalNodes.tasks || 0))}</div>
            </div>
            <div class="rounded-2xl border border-success-light bg-success-lighter px-4 py-3">
              <div class="text-xs uppercase tracking-wide text-success-darker">${wt('wic.will_create', 'Создаст')}</div>
              <div class="mt-1 text-2xl font-bold text-success-darker">${escapeHtml(String(createdCounts.tasks || 0))}</div>
            </div>
            <div class="rounded-2xl border border-warning-light bg-warning-lighter px-4 py-3">
              <div class="text-xs uppercase tracking-wide text-warning-darker">${wt('wic.will_reuse', 'Переиспользует')}</div>
              <div class="mt-1 text-2xl font-bold text-warning-darker">${escapeHtml(String(reusedCounts.tasks || 0))}</div>
            </div>
            <div class="rounded-2xl border border-info-light bg-info-lighter px-4 py-3">
              <div class="text-xs uppercase tracking-wide text-info-text">${wt('wic.theories_label', 'Теории')}</div>
              <div class="mt-1 text-2xl font-bold text-info-text">${escapeHtml(String(totalNodes.theories || 0))}</div>
            </div>
          </div>

          <div class="grid gap-5 lg:grid-cols-2">
            <div class="space-y-2 rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4 text-sm">
              <div class="font-semibold text-text-main">${wt('wic.source_label', 'Источник')}</div>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <span class="text-text-secondary">${wt('wic.complex_label', 'Комплекс')}</span>
                <span class="font-medium text-text-main break-words">${escapeHtml(complexTitle)}</span>
              </div>
              ${source.catalog_item_id || request?.source_catalog_item_id ? `
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <span class="text-text-secondary">${wt('wic.publication_label', 'Публикация')}</span>
                  <span class="font-mono text-text-main break-all">${escapeHtml(source.catalog_item_id || request?.source_catalog_item_id || '')}</span>
                </div>
              ` : ''}
              ${source.catalog_version_id || request?.source_catalog_version_id ? `
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <span class="text-text-secondary">${wt('wic.version_label', 'Версия')}</span>
                  <span class="font-mono text-text-main break-all">${escapeHtml(source.catalog_version_id || request?.source_catalog_version_id || '')}</span>
                </div>
              ` : ''}
            </div>
            <div class="space-y-2 rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4 text-sm">
              <div class="font-semibold text-text-main">${wt('wic.will_be_created', 'Будет создано')}</div>
              ${(workspace.complex_ref || workspace.complex_id) ? `
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <span class="text-text-secondary">${wt('wic.working_version', 'Рабочая версия')}</span>
                  <span class="font-mono text-text-main break-all">${escapeHtml(workspace.complex_ref || workspace.complex_id || '')}</span>
                </div>
              ` : ''}
              <div class="flex flex-wrap items-start justify-between gap-3">
                <span class="text-text-secondary">${wt('wic.modules_topics_theories', 'Модули / Темы / Теории')}</span>
                <span class="font-medium text-text-main">${escapeHtml(`${totalNodes.modules || 0} / ${totalNodes.topics || 0} / ${totalNodes.theories || 0}`)}</span>
              </div>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <span class="text-text-secondary">${wt('wic.mode_label', 'Режим')}</span>
                <span class="font-medium text-text-main">${wt('wic.independent_version', 'Независимая версия в workspace')}</span>
              </div>
            </div>
          </div>

          <div class="grid gap-4 lg:grid-cols-2">
            ${renderWorkspaceImportNodePreview(wt('wic.complex_label', 'Комплекс'), result.complex ? [result.complex] : [], wt('wic.no_complex', 'Комплекс не найден.'))}
            ${renderWorkspaceImportNodePreview(wt('wic.modules_label', 'Модули'), result.modules, wt('wic.no_modules', 'Модулей нет.'))}
            ${renderWorkspaceImportNodePreview(wt('wic.topics_label', 'Темы'), result.topics, wt('wic.no_topics', 'Тем нет.'))}
            ${renderWorkspaceImportNodePreview(wt('wic.tasks_label', 'Задания'), result.tasks, wt('wic.no_tasks', 'Заданий нет.'))}
            ${renderWorkspaceImportNodePreview(wt('wic.theories_label', 'Теории'), result.theories, wt('wic.no_theories', 'Теорий нет.'))}
          </div>
        </div>
        <div class="flex justify-end gap-3 border-t border-border-subtle px-5 py-4">
          <button type="button" class="btn-secondary h-10 px-4" data-role="cancel">${wt('wic.close', 'Закрыть')}</button>
          <button type="button" class="btn-primary h-10 px-4" data-role="confirm">${wt('wic.add_to_library', 'Добавить в библиотеку')}</button>
        </div>
      </div>
    `, {
      confirmResult: {
        request: request || {},
        previewData: previewData || {},
        payload: payload || {},
      },
      zIndexClass: 'z-[1220]',
    });
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch (_error) {
      return null;
    }
  }

  async function fetchPreview(request, options) {
    const fetchImpl = options && typeof options.fetchImpl === 'function' ? options.fetchImpl : global.fetch.bind(global);
    const endpoint = asString(options && options.endpoint) || '/api/internal/workspace/import/complex-copy/preview';
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request || {}),
    });
    const data = await readJson(response);
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'workspace_import_preview_failed:' + response.status);
    }
    return data;
  }

  async function execute(request, options) {
    const fetchImpl = options && typeof options.fetchImpl === 'function' ? options.fetchImpl : global.fetch.bind(global);
    const endpoint = asString(options && options.endpoint) || '/api/internal/workspace/import/complex-copy';
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request || {}),
    });
    const data = await readJson(response);
    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || 'workspace_import_execute_failed:' + response.status);
    }
    return data;
  }

  function resolveImportedComplexId(result) {
    return asString(
      result?.workspace?.complex_id
      || result?.result?.complex?.complex_id
      || result?.result?.complex?.workspace_entity_id
    );
  }

  function resolveTaskCount(result) {
    return Number(result?.summary?.total_nodes?.tasks || result?.result?.tasks?.length || 0);
  }

  global.WorkspaceImportClient = {
    resolveComplexOwnership: resolveComplexOwnership,
    getCreatedViaLabel: getCreatedViaLabel,
    shouldShowWorkspaceCopyAction: shouldShowWorkspaceCopyAction,
    buildWorkspaceImportRequest: buildWorkspaceImportRequest,
    normalizeWorkspaceImportNodeSummary: normalizeWorkspaceImportNodeSummary,
    confirmAction: confirmAction,
    openPreviewDialog: openPreviewDialog,
    fetchPreview: fetchPreview,
    execute: execute,
    resolveImportedComplexId: resolveImportedComplexId,
    resolveTaskCount: resolveTaskCount,
  };
})(window);
