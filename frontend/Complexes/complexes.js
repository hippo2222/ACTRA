function wt(key, fallback) {
            if (!window.i18n) return fallback;
            const result = window.i18n.t(key);
            return result !== key ? result : fallback;
          }

          function _applyComplexesI18n() {
            if (window.i18n) window.i18n.updateDOM();
            fetchComplexes();
          }

          window.addEventListener('i18n:changed', _applyComplexesI18n);

          function parseSessionTime(value) {
            if (!value) return 0;
            const parsed = Date.parse(value);
            return Number.isFinite(parsed) ? parsed : 0;
          }

          function pickPreferredSession(existing, incoming) {
            if (!incoming) return existing || null;
            if (!existing) return incoming;

            if (!!incoming.paused !== !!existing.paused) {
              return incoming.paused ? incoming : existing;
            }

            const incomingTs = Math.max(
              parseSessionTime(incoming.paused_at),
              parseSessionTime(incoming.updated_at),
              parseSessionTime(incoming.start_time)
            );
            const existingTs = Math.max(
              parseSessionTime(existing.paused_at),
              parseSessionTime(existing.updated_at),
              parseSessionTime(existing.start_time)
            );
            return incomingTs >= existingTs ? incoming : existing;
          }

          function formatPausedAt(value) {
            if (!value) return "";
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return "";
            return date.toLocaleString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
          }

          function formatDateLabel(value) {
            if (!value) return "—";
            try {
              const date = new Date(value);
              if (Number.isNaN(date.getTime())) {
                return value;
              }
              return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
            } catch (error) {
              return value;
            }
          }

          function escapeHtml(value) {
            return String(value || "")
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#39;");
          }

          function composeComplexFeedbackMessage(parts = {}) {
            const payload = {
              what: String(parts.what || ""),
              impact: String(parts.impact || ""),
              next: String(parts.next || ""),
            };
            if (typeof NotificationUI !== "undefined" && typeof NotificationUI.voiceMessage === "function") {
              return NotificationUI.voiceMessage(payload);
            }
            return [payload.what, payload.impact, payload.next].filter(Boolean).join(" ");
          }

          function resolveComplexFeedbackVariant(level = "info") {
            if (typeof NotificationUI !== "undefined" && typeof NotificationUI.resolveVariant === "function") {
              return NotificationUI.resolveVariant(level);
            }
            const key = String(level || "").trim().toLowerCase();
            if (key === "success" || key === "warning" || key === "error" || key === "info") return key;
            if (key === "blocking") return "error";
            return "info";
          }

          function showComplexVoiceToast({ severity = "info", what = "", impact = "", next = "", timeout = 4200 } = {}) {
            const message = composeComplexFeedbackMessage({ what, impact, next });
            if (!message) return;
            if (typeof NotificationUI !== "undefined" && typeof NotificationUI.toastVoice === "function") {
              NotificationUI.toastVoice({ severity, what, impact, next, timeout });
              return;
            }
            if (typeof NotificationUI !== "undefined" && typeof NotificationUI.toast === "function") {
              NotificationUI.toast(message, resolveComplexFeedbackVariant(severity), timeout);
              return;
            }
            console.warn("[Complexes] Toast unavailable:", message);
          }

          function escapeAttributeSelectorValue(value) {
            const raw = String(value || "");
            if (window.CSS && typeof window.CSS.escape === "function") {
              return window.CSS.escape(raw);
            }
            return raw
              .replace(/\\/g, "\\\\")
              .replace(/"/g, '\\"');
          }

          function localImageSrc(path) {
            if (!path) return "";
            if (/^(https?:|data:)/i.test(path) || path.startsWith("/")) return path;
            return `/api/local-image?path=${encodeURIComponent(path)}`;
          }

          const selectedComplexes = new Set();
          let selectionMode = false;
          let renderedComplexIds = [];
          let hasLoadedComplexesOnce = false;
          let isComplexesLoading = false;
          let complexesSkeletonTimer = null;
          const pinnedComplexIds = new Set();
          let activeComplexFilter = "all";
          let activeComplexSearch = "";
          let activeTheoryFilterId = "";
          const VALID_COMPLEX_SORT_KEYS = new Set(['name-asc', 'name-desc', 'date-desc', 'date-asc', 'tasks-desc']);
          function normalizeComplexSortKey(sortKey) {
            return VALID_COMPLEX_SORT_KEYS.has(sortKey) ? sortKey : 'name-asc';
          }

          let activeComplexSort = 'name-asc';
          try {
            sessionStorage.removeItem('cx-sort');
          } catch(_) {}
          let allComplexItems = [];
          let allComplexPublicationItems = [];
          const complexPublicationBySourceId = new Map();
          const complexPublicationByItemId = new Map();
          const theoryLibraryEntryByCatalogItemId = new Map();
          const theoryLibraryEntryBySourceTheoryId = new Map();
          let currentComplexesUserId = "";
          let currentComplexesUserIdPromise = null;
          let complexTaskNameCache = {};
          let workspaceLimitsSummary = null;
          let workspacePlanName = "";
          const linkedComplexDetailCache = new Map();
          let pendingLinkedComplexRevealId = "";

          function getComplexLimitSummary() {
            return workspaceLimitsSummary && typeof workspaceLimitsSummary === "object"
              ? workspaceLimitsSummary
              : null;
          }

          function isComplexPremiumPlan() {
            return String(workspacePlanName || "").trim().toLowerCase() === "premium";
          }

          function renderComplexLibraryLimitBadge() {
            const badge = document.getElementById("complex-library-limit-badge");
            const summary = getComplexLimitSummary();
            if (!badge) return;
            const setPremiumPromoTrigger = (enabled) => {
              if (enabled) {
                badge.setAttribute("data-premium-promo-trigger", "");
                badge.setAttribute("data-premium-promo-feature", "complexes-limit");
                badge.setAttribute("role", "button");
                badge.setAttribute("tabindex", "0");
              } else {
                badge.removeAttribute("data-premium-promo-trigger");
                badge.removeAttribute("data-premium-promo-feature");
                badge.removeAttribute("role");
                badge.removeAttribute("tabindex");
              }
            };
            if (!summary) {
              badge.hidden = true;
              badge.textContent = "";
              badge.className = "cx-breadcrumb-limit";
              setPremiumPromoTrigger(false);
              return;
            }

            badge.hidden = false;
            if (isComplexPremiumPlan()) {
              badge.className = "cx-breadcrumb-limit cx-breadcrumb-limit--premium";
              setPremiumPromoTrigger(false);
              badge.textContent = wt('complexes.premium_unlimited', 'Premium · без лимита');
              return;
            }

            const personalBlocked = Number(summary.remaining_personal || 0) <= 0;
            const libraryBlocked = Number(summary.remaining_library || 0) <= 0;
            badge.className = personalBlocked || libraryBlocked
              ? "cx-breadcrumb-limit cx-breadcrumb-limit--warning"
              : "cx-breadcrumb-limit";
            badge.textContent = wt('complexes.limit_badge', 'Мои комплексы {pc}/{pl} · Библиотека {ltc}/{ll}')
              .replace('{pc}', Number(summary.personal_count || 0))
              .replace('{pl}', Number(summary.personal_limit || 0))
              .replace('{ltc}', Number(summary.library_total_count || 0))
              .replace('{ll}', Number(summary.library_limit || 0));
            setPremiumPromoTrigger(true);
          }

          function getComplexArchivedItems() {
            const summary = getComplexLimitSummary();
            return Array.isArray(summary?.archived_items) ? summary.archived_items : [];
          }

          function getArchivedItemRefs(item) {
            if (!item || typeof item !== "object") return [];
            return [item.id, item.ref, item.workspace_entity_id, item.workspace_entity_ref, item.library_entry_id]
              .map((value) => String(value || "").trim())
              .filter(Boolean);
          }

          function resolveComplexArchiveItem(complex) {
            const archivedItems = getComplexArchivedItems();
            if (!archivedItems.length || !complex || typeof complex !== "object") return null;
            const complexId = normalizeComplexId(complex?.id);
            const linkedLibraryEntryId = getLinkedLibraryEntryId(complex);
            const candidateRefs = new Set([
              complexId,
              normalizeComplexId(complex?.workspace_entity_id),
              normalizeComplexId(complex?.workspace_entity_ref),
              String(complex?.source_catalog_item_id || "").trim(),
              linkedLibraryEntryId,
            ].filter(Boolean));
            const preferredScope = linkedLibraryEntryId ? "linked_library" : "workspace";
            return archivedItems.find((item) => {
              if (!item || typeof item !== "object") return false;
              const itemScope = String(item.scope || "").trim();
              if (itemScope && itemScope !== preferredScope) return false;
              return getArchivedItemRefs(item).some((ref) => candidateRefs.has(ref));
            }) || null;
          }

          function isComplexPremiumArchived(complex) {
            return !!resolveComplexArchiveItem(complex);
          }

          function renderComplexArchiveNotice() {
            const notice = document.getElementById("complex-premium-archive-notice");
            const copy = document.getElementById("complex-premium-archive-notice-copy");
            const summary = getComplexLimitSummary();
            if (!notice) return;
            const archivedCount = Number(summary?.archived_count || 0);
            const hasArchived = archivedCount > 0 || getComplexArchivedItems().length > 0;
            notice.classList.toggle("hidden", !hasArchived);
            if (!hasArchived || !copy) return;
            const visibleCount = getComplexArchivedItems().length;
            const countText = archivedCount > 0 ? archivedCount : visibleCount;
            const truncated = summary?.archived_items_truncated === true;
            copy.textContent = wt('complexes.archive_notice_detail', 'В архиве Premium: {count} шт. Они не удалены: их можно открыть для просмотра или удалить, но нельзя запускать, редактировать и публиковать до освобождения лимита или продления Premium.')
              .replace('{count}', `${countText}${truncated ? "+" : ""}`);
          }

          async function fetchComplexWorkspaceLimits() {
            try {
              const response = await fetch("/api/workspace-limits/summary", {
                credentials: "same-origin",
              });
              const data = await response.json().catch(() => ({}));
              if (!response.ok || data?.ok === false) {
                throw new Error(data?.error || `http_${response.status}`);
              }
              workspacePlanName = String(data?.plan || "").trim();
              workspaceLimitsSummary = data && typeof data.complexes === "object" ? data.complexes : null;
              return workspaceLimitsSummary;
            } catch (error) {
              console.warn("[Complexes] Failed to load workspace limits", error);
              workspacePlanName = "";
              workspaceLimitsSummary = null;
              return null;
            } finally {
              renderComplexLibraryLimitBadge();
              renderComplexArchiveNotice();
            }
          }

          async function resolveCurrentComplexesUserId(forceRefresh = false) {
            if (!forceRefresh && currentComplexesUserId) {
              return currentComplexesUserId;
            }
            if (!forceRefresh && currentComplexesUserIdPromise) {
              return currentComplexesUserIdPromise;
            }

            currentComplexesUserIdPromise = (async () => {
              try {
                const resp = await fetch("/api/users/current");
                const data = await resp.json().catch(() => ({}));
                const userId = String(data?.user?.user_id || "").trim();
                currentComplexesUserId = userId;
                return currentComplexesUserId;
              } catch (error) {
                console.warn("[Complexes] Failed to resolve current user", error);
                return currentComplexesUserId || "";
              } finally {
                currentComplexesUserIdPromise = null;
              }
            })();

            return currentComplexesUserIdPromise;
          }

          function appendUserIdQuery(path, userId) {
            const normalizedUserId = String(userId || "").trim();
            if (!normalizedUserId) return path;
            const separator = path.includes("?") ? "&" : "?";
            return `${path}${separator}user_id=${encodeURIComponent(normalizedUserId)}`;
          }

          function withUserIdPayload(payload, userId) {
            const normalizedUserId = String(userId || "").trim();
            if (!normalizedUserId) return payload;
            return { ...(payload || {}), user_id: normalizedUserId };
          }

          function getCatalogVisibilityLabel(value) {
            switch (String(value || "").trim().toLowerCase()) {
              case "access_code":
                return wt('complexes.vis_by_code', 'По коду');
              case "private":
                return wt('complexes.vis_private', 'Приватный');
              case "public":
              default:
                return wt('complexes.vis_public', 'Общий доступ');
            }
          }

          function getCatalogVisibilityToneClass(value) {
            switch (String(value || "").trim().toLowerCase()) {
              case "access_code":
                return "pill-info";
              case "private":
                return "pill-neutral";
              case "public":
              default:
                return "pill-success";
            }
          }

          function getCatalogVisibilityDescription(value) {
            switch (String(value || "").trim().toLowerCase()) {
              case "access_code":
                return wt('complexes.vis_desc_code', 'Комплекс не виден в общем каталоге. Добавить его можно только по коду доступа.');
              case "private":
                return wt('complexes.vis_desc_private', 'Комплекс доступен только вам. Другие пользователи не увидят его в каталоге и не смогут открыть по коду.');
              case "public":
              default:
                return wt('complexes.vis_desc_public', 'Комплекс виден в общем каталоге и доступен для добавления в библиотеку.');
            }
          }

          function getCatalogVisibilityAccessRank(value) {
            switch (String(value || "").trim().toLowerCase()) {
              case "private":
                return 0;
              case "access_code":
                return 1;
              case "public":
                return 2;
              default:
                return null;
            }
          }

          function isCatalogVisibilityExpansion(currentVisibility, nextVisibility) {
            const currentRank = getCatalogVisibilityAccessRank(currentVisibility);
            const nextRank = getCatalogVisibilityAccessRank(nextVisibility);
            return currentRank !== null && nextRank !== null && nextRank > currentRank;
          }

          function getPremiumArchivedPublicationErrorMessage(error, fallback = "catalog_visibility_update_failed") {
            const message = String(error?.message || error || "").trim();
            if (message.includes("premium_archived_content")) {
              return wt('complexes.premium_archived_err', 'Источник находится в архиве Premium. Сужение доступа доступно, а публикация новой версии и расширение доступа вернутся после восстановления Premium.');
            }
            return message || fallback;
          }

          function formatPublicationTimestamp(value) {
            const raw = String(value || "").trim();
            if (!raw) return wt('complexes.never_published', 'ещё не публиковался');
            const date = new Date(raw);
            if (Number.isNaN(date.getTime())) return raw;
            return date.toLocaleString("ru-RU", {
              day: "2-digit",
              month: "long",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
          }

          function resolveComplexTasksCount(item) {
            if (Array.isArray(item?.tasks) && item.tasks.length > 0) {
              return item.tasks.length;
            }
            const explicitCount = Number(
              item?.task_count
              ?? item?.linked_manifest?.task_count
              ?? item?.linked_version?.manifest?.task_count
              ?? item?.latest_manifest?.task_count
              ?? 0
            );
            return Number.isFinite(explicitCount) && explicitCount > 0 ? explicitCount : 0;
          }

          function isLinkedLibraryComplex(complex) {
            if (!complex || typeof complex !== "object") return false;
            if (String(complex?.linked_library_entry_id || complex?.library_entry_id || "").trim()) {
              return true;
            }
            const ownership = resolveComplexOwnership(complex);
            const createdVia = String(ownership.createdVia || "").trim().toLowerCase();
            const contentScope = String(ownership.contentScope || "").trim().toLowerCase();
            return createdVia === "catalog_linked" || contentScope === "linked_library";
          }

          function getLinkedLibraryEntryId(complex) {
            return String(complex?.linked_library_entry_id || complex?.library_entry_id || "").trim();
          }

          function getLinkedLibraryAccessState(complex) {
            return String(
              complex?.linked_library_access_state
              || complex?.library_entry?.access_state
              || ""
            ).trim().toLowerCase() || "active";
          }

          function getLinkedLibraryAccessReason(complex) {
            return String(
              complex?.linked_library_access_reason
              || complex?.library_entry?.access_reason
              || ""
            ).trim();
          }

          function buildLinkedRuntimeComplexId(libraryEntryId) {
            const normalized = String(libraryEntryId || "").trim();
            if (!normalized) return "";
            try {
              const bytes = new TextEncoder().encode(normalized);
              let binary = "";
              bytes.forEach((byte) => {
                binary += String.fromCharCode(byte);
              });
              const token = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
              return token ? `linked_library__${token}` : "";
            } catch (_error) {
              return "";
            }
          }

          function isLinkedRuntimeComplexId(complexId) {
            return String(complexId || "").trim().startsWith("linked_library__");
          }

          function getLinkedLibraryStatusMeta(complex) {
            const accessState = getLinkedLibraryAccessState(complex);
            switch (accessState) {
              case "requires_access_code":
                return {
                  icon: "password",
                  text: wt('complexes.linked_state_needs_code_text', 'Нужен код'),
                  toneClass: "pill-info",
                  summary: wt('complexes.linked_state_needs_code_summary', 'Доступ по коду'),
                };
              case "revoked":
                return {
                  icon: "lock",
                  text: wt('complexes.linked_state_revoked_text', 'Доступ закрыт'),
                  toneClass: "pill-neutral",
                  summary: wt('complexes.linked_state_revoked_summary', 'Доступ закрыт'),
                };
              case "deleted_source":
                return {
                  icon: "visibility_off",
                  text: wt('complexes.linked_state_hidden_text', 'Источник скрыт'),
                  toneClass: "pill-neutral",
                  summary: wt('complexes.linked_state_hidden_summary', 'Источник недоступен'),
                };
              case "active":
              default:
                return {
                  icon: "visibility",
                  text: wt('complexes.linked_state_readonly_text', 'Только чтение'),
                  toneClass: "pill-info",
                  summary: wt('complexes.linked_state_readonly_summary', 'Только чтение'),
                };
            }
          }

          function resolveLinkedComplexPrimaryAction(complex) {
            const accessState = getLinkedLibraryAccessState(complex);
            if (accessState === "requires_access_code") {
              return {
                key: "enter-access-code",
                icon: "password",
                label: wt('complexes.linked_btn_enter_code', 'Ввести код'),
                expandedLabel: wt('complexes.linked_btn_enter_code', 'Ввести код'),
              };
            }
            if (accessState === "revoked" || accessState === "deleted_source") {
              return {
                key: "show-status",
                icon: "info",
                label: wt('complexes.linked_btn_access_status', 'Статус доступа'),
                expandedLabel: wt('complexes.linked_btn_collapse', 'Свернуть'),
              };
            }
            return {
              key: "open-linked",
              icon: "visibility",
              label: wt('complexes.linked_btn_open', 'Открыть'),
              expandedLabel: wt('complexes.linked_btn_collapse', 'Свернуть'),
            };
          }

          function normalizeLinkedLibraryComplexEntry(entryPayload = {}) {
            const libraryEntry = entryPayload?.library_entry && typeof entryPayload.library_entry === "object"
              ? entryPayload.library_entry
              : {};
            const item = entryPayload?.item && typeof entryPayload.item === "object"
              ? entryPayload.item
              : {};
            const version = entryPayload?.version && typeof entryPayload.version === "object"
              ? entryPayload.version
              : {};
            const snapshot = entryPayload?.snapshot && typeof entryPayload.snapshot === "object"
              ? entryPayload.snapshot
              : {};
            const snapshotComplex = snapshot?.complex && typeof snapshot.complex === "object"
              ? snapshot.complex
              : {};
            const snapshotDependencies = snapshot?.dependencies && typeof snapshot.dependencies === "object"
              ? snapshot.dependencies
              : {};
            const manifest = version?.manifest && typeof version.manifest === "object"
              ? version.manifest
              : {};
            const dependencyCounts = manifest?.dependency_counts && typeof manifest.dependency_counts === "object"
              ? manifest.dependency_counts
              : {};
            const linkedId = String(libraryEntry?.library_entry_id || "").trim();
            const linkedName = String(snapshotComplex?.name || item?.title || wt('complexes.linked_complex_fallback', 'Комплекс')).trim() || wt('complexes.linked_complex_fallback', 'Комплекс');
            const linkedDescription = String(snapshotComplex?.description || item?.description || "").trim();
            const linkedTasks = Array.isArray(snapshotComplex?.tasks) ? snapshotComplex.tasks.slice() : [];
            const taskCount = linkedTasks.length || Number(manifest?.task_count || 0) || 0;
            const ownerUserId = String(item?.owner_user_id || snapshotComplex?.created_by_user_id || "").trim();
            const ownerDisplayName = String(item?.owner_display_name || "").trim();
            const runtimeComplexId = buildLinkedRuntimeComplexId(linkedId || String(item?.item_id || "").trim());
            const rawLinkedEmbeddedTheoryItems = extractLinkedEmbeddedTheoryItemsFromSnapshot(snapshot);
            const primaryTheoryLink = snapshotComplex?.theory_link && typeof snapshotComplex.theory_link === "object"
              ? snapshotComplex.theory_link
              : null;
            const linkedEmbeddedTheoryItems = canUseEmbeddedTheorySnapshotAsPrimaryLinkedSource(
              primaryTheoryLink,
              rawLinkedEmbeddedTheoryItems
            )
              ? rawLinkedEmbeddedTheoryItems
              : [];
            const linkedTheoryIds = linkedEmbeddedTheoryItems
              .map((theoryItem) => String(theoryItem?.theoryId || "").trim())
              .filter(Boolean);
            const normalizedTheoryLink = resolvePreferredComplexTheoryLink(
              primaryTheoryLink,
              linkedEmbeddedTheoryItems
            );
            const rawTheorySyncMeta = snapshotComplex?.theory_sync_meta && typeof snapshotComplex.theory_sync_meta === "object"
              ? { ...snapshotComplex.theory_sync_meta }
              : {};
            if (!Array.isArray(rawTheorySyncMeta.theory_ids) || !rawTheorySyncMeta.theory_ids.length) {
              rawTheorySyncMeta.theory_ids = linkedTheoryIds.slice();
            }
            if (!rawTheorySyncMeta.topic_count && snapshotDependencies?.topic_theory_links && typeof snapshotDependencies.topic_theory_links === "object") {
              rawTheorySyncMeta.topic_count = Object.keys(snapshotDependencies.topic_theory_links).length;
            }
            const normalizedTheorySyncStatus = String(snapshotComplex?.theory_sync_status || "").trim().toLowerCase()
              || (linkedTheoryIds.length > 1 ? "composite" : (normalizedTheoryLink ? "ok" : "none"));
            const normalizedTheoryMode = String(snapshotComplex?.theory_mode || "").trim().toLowerCase()
              || (normalizedTheoryLink ? "override" : "inherit");
            return {
              id: runtimeComplexId || `linked_library__${String(item?.item_id || "").trim()}`,
              name: linkedName,
              description: linkedDescription,
              tasks: linkedTasks,
              task_count: taskCount,
              chains: Array.isArray(snapshotComplex?.chains) ? snapshotComplex.chains.slice() : [],
              theory_link: normalizedTheoryLink,
              has_theory: Boolean(normalizedTheoryLink || linkedEmbeddedTheoryItems.length),
              theory_mode: normalizedTheoryMode,
              theory_sync_status: normalizedTheorySyncStatus,
              theory_sync_meta: rawTheorySyncMeta,
              settings: snapshotComplex?.settings && typeof snapshotComplex.settings === "object"
                ? { ...snapshotComplex.settings }
                : {},
              linked_embedded_theories: linkedEmbeddedTheoryItems,
              linked_library_entry_id: linkedId,
              linked_library_access_state: String(libraryEntry?.access_state || "").trim() || "active",
              linked_library_access_reason: String(libraryEntry?.access_reason || "").trim(),
              linked_library_resolved_version_id: String(libraryEntry?.resolved_version_id || "").trim(),
              linked_manifest: manifest,
              linked_dependency_counts: dependencyCounts,
              linked_catalog_item: item,
              linked_version: version,
              linked_snapshot_loaded: Boolean(snapshotComplex && Object.keys(snapshotComplex).length),
              source_catalog_item_id: String(item?.item_id || "").trim(),
              source_catalog_visibility: String(item?.catalog_visibility || "").trim(),
              created_at: libraryEntry?.created_at || item?.created_at || version?.published_at || "",
              updated_at: libraryEntry?.updated_at || item?.updated_at || version?.published_at || "",
              created_by_user_id: ownerUserId,
              updated_by_user_id: ownerUserId,
              ownership: {
                created_by_user_id: ownerUserId,
                created_by_user_name: ownerDisplayName || ownerUserId || null,
                updated_by_user_id: ownerUserId,
                created_via: "catalog_linked",
                content_scope: "linked_library",
                has_owner: Boolean(ownerUserId),
                is_owned_by_current_user: false,
                is_shared_library: true,
              },
            };
          }

          function normalizeLinkedLibraryComplexEntriesForList(payload) {
            const entries = Array.isArray(payload?.entries) ? payload.entries : [];
            return entries
              .map((entry) => normalizeLinkedLibraryComplexEntry(entry))
              .filter((complex) => normalizeComplexId(complex?.id));
          }

          function mergeWorkspaceAndLinkedComplexItems(workspaceItems, linkedItems) {
            const merged = [];
            const linkedEntryIds = new Set();
            const runtimeIds = new Set();

            const remember = (complex) => {
              const runtimeId = normalizeComplexId(complex?.id);
              const libraryEntryId = getLinkedLibraryEntryId(complex);
              if (runtimeId) runtimeIds.add(runtimeId);
              if (libraryEntryId) linkedEntryIds.add(libraryEntryId);
            };

            (Array.isArray(workspaceItems) ? workspaceItems : []).forEach((complex) => {
              if (!complex || typeof complex !== "object") return;
              merged.push(complex);
              remember(complex);
            });

            (Array.isArray(linkedItems) ? linkedItems : []).forEach((complex) => {
              if (!complex || typeof complex !== "object") return;
              const runtimeId = normalizeComplexId(complex?.id);
              const libraryEntryId = getLinkedLibraryEntryId(complex);
              if ((runtimeId && runtimeIds.has(runtimeId)) || (libraryEntryId && linkedEntryIds.has(libraryEntryId))) {
                return;
              }
              merged.push(complex);
              remember(complex);
            });

            return merged;
          }

          async function fetchLinkedComplexLibraryItemsForList() {
            try {
              const resp = await fetch("/api/complex-library", {
                credentials: "same-origin",
              });
              const data = await resp.json().catch(() => ({}));
              if (!resp.ok || data?.ok === false) {
                const error = String(data?.error || `complex_library_load_failed:${resp.status}`).trim();
                if (resp.status !== 403 || error !== "guest_cannot_read_library_status") {
                  console.warn("[Complexes] Failed to load linked complex library", error);
                }
                return [];
              }
              return normalizeLinkedLibraryComplexEntriesForList(data);
            } catch (error) {
              console.warn("[Complexes] Failed to load linked complex library", error);
              return [];
            }
          }

          function extractLinkedEmbeddedTheoryItemsFromSnapshot(snapshot) {
            const payload = snapshot && typeof snapshot === "object" ? snapshot : {};
            const complexPayload = payload?.complex && typeof payload.complex === "object" ? payload.complex : {};
            const dependencies = payload?.dependencies && typeof payload.dependencies === "object" ? payload.dependencies : {};
            const theoriesMap = dependencies?.theories && typeof dependencies.theories === "object" ? dependencies.theories : {};
            const topicTheoryLinks = dependencies?.topic_theory_links && typeof dependencies.topic_theory_links === "object"
              ? dependencies.topic_theory_links
              : {};
            const orderedTheoryIds = [];
            const seenTheoryIds = new Set();

            const rememberTheoryId = (rawTheoryId) => {
              const theoryId = String(rawTheoryId || "").trim();
              if (!theoryId || seenTheoryIds.has(theoryId)) return;
              seenTheoryIds.add(theoryId);
              orderedTheoryIds.push(theoryId);
            };

            const directTheoryLink = complexPayload?.theory_link && typeof complexPayload.theory_link === "object"
              ? complexPayload.theory_link
              : {};
            rememberTheoryId(directTheoryLink?.theory_id);

            const syncMeta = complexPayload?.theory_sync_meta && typeof complexPayload.theory_sync_meta === "object"
              ? complexPayload.theory_sync_meta
              : {};
            if (Array.isArray(syncMeta?.theory_ids)) {
              syncMeta.theory_ids.forEach(rememberTheoryId);
            }

            Object.values(topicTheoryLinks).forEach((linkPayload) => {
              if (linkPayload && typeof linkPayload === "object") {
                rememberTheoryId(linkPayload?.theory_id);
              }
            });

            Object.keys(theoriesMap).forEach(rememberTheoryId);

            return orderedTheoryIds.map((theoryId) => {
              const theoryPayload = theoriesMap[theoryId] && typeof theoriesMap[theoryId] === "object"
                ? theoriesMap[theoryId]
                : {};
              const title = String(
                theoryPayload?.title
                || directTheoryLink?.title_cache
                || directTheoryLink?.theory_title
                || directTheoryLink?.title
                || ""
              ).trim();
              return {
                theoryId,
                id: String(theoryPayload?.id || theoryId).trim() || theoryId,
                title: title || theoryId,
                updated_at: String(theoryPayload?.updated_at || theoryPayload?.version || directTheoryLink?.updated_at || "").trim(),
                delta: theoryPayload?.delta && typeof theoryPayload.delta === "object"
                  ? theoryPayload.delta
                  : { ops: [] },
                images: Array.isArray(theoryPayload?.images) ? theoryPayload.images.slice() : [],
                source: "linked_snapshot",
              };
            });
          }

          function getComplexEmbeddedTheoryItems(complex) {
            if (!complex || typeof complex !== "object") return [];
            const embeddedItems = Array.isArray(complex?.linked_embedded_theories)
              ? complex.linked_embedded_theories
              : [];
            return embeddedItems
              .filter((item) => item && typeof item === "object" && String(item?.theoryId || item?.id || "").trim())
              .map((item) => ({ ...item }));
          }

          async function fetchLinkedTheoryEmbeddedItem(libraryEntryId) {
            const normalizedLibraryEntryId = String(libraryEntryId || "").trim();
            if (!normalizedLibraryEntryId) return null;
            const resp = await fetch(`/api/theory-library/${encodeURIComponent(normalizedLibraryEntryId)}`);
            const data = await resp.json();
            if (!resp.ok || !data?.ok || !data?.snapshot) {
              throw new Error(data?.error || "linked_theory_load_failed");
            }
            const libraryEntry = data.library_entry && typeof data.library_entry === "object" ? data.library_entry : {};
            const item = data.item && typeof data.item === "object" ? data.item : {};
            const snapshot = data.snapshot && typeof data.snapshot === "object" ? data.snapshot : {};
            return {
              theoryId: `linked:${normalizedLibraryEntryId}`,
              id: String(snapshot.id || normalizedLibraryEntryId).trim() || normalizedLibraryEntryId,
              title: String(snapshot.title || item.title || wt('complexes.theory_from_catalog', 'Теория из каталога')).trim(),
              updated_at: String(snapshot.updated_at || snapshot.version || libraryEntry.updated_at || "").trim(),
              delta: snapshot.delta && typeof snapshot.delta === "object" ? snapshot.delta : { ops: [] },
              source: "linked_library",
              sourceKind: "linked_library",
              libraryEntryId: normalizedLibraryEntryId,
              accessState: String(libraryEntry.access_state || "").trim(),
              accessReason: String(libraryEntry.access_reason || "").trim(),
            };
          }

          function normalizeTheoryViewerImageRef(raw) {
            let value = String(raw || "").trim();
            if (!value) return "";
            if (value.startsWith("/api/local-image?")) {
              try {
                const parsed = new URL(value, window.location.origin);
                const assetId = String(parsed.searchParams.get("asset_id") || "").trim();
                if (assetId) {
                  return `/api/assets/${encodeURIComponent(assetId)}/content`;
                }
                value = String(parsed.searchParams.get("path") || "").trim();
                if (!value) return "";
              } catch {
                return "";
              }
            }
            if (/^(https?:|data:|blob:|\/api\/|\/assets\/)/i.test(value)) return value;
            return `/api/local-image?path=${encodeURIComponent(value)}`;
          }

          function getTheoryLineAttributes(rawAttrs) {
            const lineAttrs = {};
            const attrs = rawAttrs && typeof rawAttrs === "object" ? rawAttrs : {};
            if (attrs.list === "ordered" || attrs.list === "bullet" || attrs.list === "check") {
              lineAttrs.list = attrs.list;
            }
            if (attrs.blockquote) {
              lineAttrs.blockquote = true;
            }
            const header = Number(attrs.header);
            if (Number.isInteger(header) && header >= 1 && header <= 6) {
              lineAttrs.header = header;
            }
            if (attrs.align && ["left", "center", "right", "justify"].includes(String(attrs.align).trim().toLowerCase())) {
              lineAttrs.align = String(attrs.align).trim().toLowerCase();
            }
            return lineAttrs;
          }

          function getTheoryImageAttributes(attrs) {
            const source = attrs && typeof attrs === "object" ? attrs : {};
            const imageAttrs = {};
            if (source.width) imageAttrs.width = String(source.width);
            if (source.align) imageAttrs.align = String(source.align);
            if (source.rotate) imageAttrs.rotate = String(source.rotate);
            if (source.float) imageAttrs.float = String(source.float);
            if (source.flip) imageAttrs.flip = String(source.flip);
            return imageAttrs;
          }

          function renderTheoryInline(text, attributes) {
            if (!text) return "";
            const attrs = attributes || {};
            const hasFormatting = Boolean(
              attrs.bold || attrs.italic || attrs.underline || attrs.strike || attrs.color || attrs.background || attrs.size || attrs.link
            );
            if (!hasFormatting) {
              return escapeHtml(text).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
            }

            const match = String(text).match(/^(\s*)([\s\S]*?)(\s*)$/);
            const leading = match ? match[1] : "";
            const core = match ? match[2] : text;
            const trailing = match ? match[3] : "";

            if (!core) {
              return escapeHtml(text).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
            }

            let html = escapeHtml(core).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
            if (attrs.bold) html = `<strong>${html}</strong>`;
            if (attrs.italic) html = `<em>${html}</em>`;
            if (attrs.underline) html = `<u>${html}</u>`;
            if (attrs.strike) html = `<s>${html}</s>`;

            const inlineStyles = [];
            if (attrs.color) inlineStyles.push(`color:${escapeHtml(attrs.color)}`);
            if (attrs.background) inlineStyles.push(`background-color:${escapeHtml(attrs.background)}`);
            if (attrs.size) {
              const sizeVal = String(attrs.size).trim();
              if (sizeVal === "small") inlineStyles.push("font-size:0.82em");
              else if (sizeVal === "large") inlineStyles.push("font-size:1.25em");
              else if (sizeVal === "huge") inlineStyles.push("font-size:1.6em");
              else if (/^\d+(px|rem|em|%)$/i.test(sizeVal)) inlineStyles.push(`font-size:${escapeHtml(sizeVal)}`);
            }

            if (inlineStyles.length > 0) {
              html = `<span style="${inlineStyles.join(';')}">${html}</span>`;
            }

            if (attrs.link) {
              const href = escapeHtml(String(attrs.link).trim());
              html = `<a href="${href}" target="_blank" rel="noopener noreferrer">${html}</a>`;
            }

            const leadHtml = escapeHtml(leading).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
            const trailHtml = escapeHtml(trailing).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
            return leadHtml + html + trailHtml;
          }

          function deltaToTheoryLines(delta) {
            const ops = delta && Array.isArray(delta.ops) ? delta.ops : [];
            const lines = [];
            let segments = [];

            const pushLine = (attrs) => {
              lines.push({
                segments: segments.slice(),
                attrs: getTheoryLineAttributes(attrs),
              });
              segments = [];
            };

            for (const op of ops) {
              if (!op || typeof op !== "object" || !("insert" in op)) continue;
              const attrs = op.attributes || {};
              const insert = op.insert;
              if (typeof insert === "string") {
                const parts = insert.split("\n");
                for (let index = 0; index < parts.length; index += 1) {
                  const chunk = parts[index];
                  if (chunk) {
                    segments.push({ kind: "text", value: chunk, attrs });
                  }
                  if (index < parts.length - 1) {
                    pushLine(attrs);
                  }
                }
                continue;
              }

              if (insert && typeof insert === "object" && typeof insert.image === "string") {
                const normalizedImage = normalizeTheoryViewerImageRef(insert.image);
                if (normalizedImage) {
                  segments.push({
                    kind: "image",
                    value: normalizedImage,
                    attrs: getTheoryImageAttributes(attrs),
                  });
                }
              }
            }

            if (segments.length || !lines.length) {
              lines.push({ segments: segments.slice(), attrs: {} });
            }
            return lines;
          }

          function renderTheoryLineContent(segments) {
            if (!Array.isArray(segments) || !segments.length) return "<br>";
            let html = "";
            for (const segment of segments) {
              if (!segment || typeof segment !== "object") continue;
              if (segment.kind === "text") {
                html += renderTheoryInline(segment.value || "", segment.attrs || {});
                continue;
              }
              if (segment.kind === "image" && segment.value) {
                const safeRef = escapeHtml(segment.value);
                const attrs = segment.attrs || {};
                const width = attrs.width || "min(100%, 720px)";
                const align = attrs.align || "left";
                const float = attrs.float || "none";
                const flip = attrs.flip || "none";
                const rotate = attrs.rotate || "0";
                const alignClass = align === "center" ? "mx-auto" : align === "right" ? "ml-auto" : "";
                const flipScale = flip === "horizontal" ? " scaleX(-1)" : "";
                const transformStyle = rotate !== "0" || flip === "horizontal"
                  ? `transform:rotate(${rotate}deg)${flipScale};`
                  : "";

                let wrapperStyle = "";
                if (float === "left") {
                  wrapperStyle = "display:inline-block;float:left;margin:0 16px 12px 0;";
                } else if (float === "right") {
                  wrapperStyle = "display:inline-block;float:right;margin:0 0 12px 16px;";
                } else {
                  const textAlign = align === "center" ? "text-align:center;" : align === "right" ? "text-align:right;" : "";
                  wrapperStyle = `display:block;${textAlign}`;
                }

                html += `<span class="theory-image-wrapper" style="${wrapperStyle}"><img src="${safeRef}" alt="" class="theory-image ${alignClass}" style="max-width:${escapeHtml(width)};width:${escapeHtml(width)};${transformStyle}" /></span>`;
              }
            }
            return html || "<br>";
          }

          function renderTheoryDeltaHtml(delta) {
            const lines = deltaToTheoryLines(delta);
            const blocks = [];
            let activeListType = null;
            let activeListItems = [];

            const flushList = () => {
              if (!activeListType || !activeListItems.length) {
                activeListType = null;
                activeListItems = [];
                return;
              }
              const listTag = activeListType === "ordered" ? "ol" : "ul";
              blocks.push(`<${listTag}>${activeListItems.join("")}</${listTag}>`);
              activeListType = null;
              activeListItems = [];
            };

            for (const line of lines) {
              const attrs = line && typeof line === "object" ? line.attrs || {} : {};
              const lineHtml = renderTheoryLineContent(line && line.segments);
              const listType =
                attrs.list === "ordered"
                  ? "ordered"
                  : attrs.list === "bullet" || attrs.list === "check"
                    ? "bullet"
                    : null;

              if (listType) {
                if (activeListType && activeListType !== listType) flushList();
                activeListType = listType;
                const align = attrs.align ? ` style="text-align: ${attrs.align}"` : "";
                activeListItems.push(`<li${align}>${lineHtml}</li>`);
                continue;
              }

              flushList();
              const headerLevel = Number(attrs.header);
              const align = attrs.align ? ` style="text-align: ${attrs.align}"` : "";

              if (Number.isInteger(headerLevel) && headerLevel >= 1 && headerLevel <= 6) {
                blocks.push(`<h${headerLevel}${align}>${lineHtml}</h${headerLevel}>`);
              } else if (attrs.blockquote) {
                blocks.push(`<blockquote${align}>${lineHtml}</blockquote>`);
              } else {
                blocks.push(`<p${align}>${lineHtml}</p>`);
              }
            }

            flushList();
            return blocks.length ? blocks.join("") : `<p style="margin:0;color:var(--color-text-secondary);">${wt('complexes.theory_empty_content', 'Контент теории пока недоступен.')}</p>`;
          }

          async function openComplexTheoryViewer(complexName, theoryIds, options = {}) {
            const rawIds = Array.isArray(theoryIds) ? theoryIds : [theoryIds];
            const ids = rawIds.map((id) => String(id || "").trim()).filter(Boolean);
            const embeddedItems = Array.isArray(options?.embeddedTheoryItems) ? options.embeddedTheoryItems : [];
            const singleEmbedded = options?.embeddedTheoryItem || null;

            const existing = document.getElementById("complex-theory-viewer-dialog");
            if (existing) existing.remove();

            const loadedTheories = [];
            if (singleEmbedded) {
              loadedTheories.push(singleEmbedded);
            } else {
              for (const id of ids) {
                const found = embeddedItems.find((item) => String(item.theoryId || item.id || "").trim() === id);
                if (found) {
                  loadedTheories.push(found);
                  continue;
                }
                if (id.startsWith("linked:")) {
                  const libraryEntryId = id.replace(/^linked:/, "");
                  try {
                    const linkedItem = await fetchLinkedTheoryEmbeddedItem(libraryEntryId);
                    if (linkedItem) loadedTheories.push(linkedItem);
                  } catch (e) {
                    console.warn("Failed to load linked theory", id, e);
                  }
                  continue;
                }
                try {
                  const resp = await fetch(`/api/theories/${encodeURIComponent(id)}`);
                  const data = await resp.json();
                  if (resp.ok && data?.ok && data?.item) {
                    loadedTheories.push(data.item);
                  }
                } catch (e) {
                  console.warn("Failed to fetch theory", id, e);
                }
              }
            }

            if (!loadedTheories.length) {
              showComplexVoiceToast({
                severity: "warning",
                what: wt('complexes.theory_not_found_what', 'Теория не найдена.'),
                impact: wt('complexes.theory_not_found_impact', 'Не удалось загрузить данные теоретического материала.'),
                next: wt('complexes.theory_not_found_next', 'Проверьте наличие теории в редакторе.'),
              });
              return;
            }

            const isComposite = loadedTheories.length > 1;
            let activeIndex = 0;

            const dialog = document.createElement("dialog");
            dialog.id = "complex-theory-viewer-dialog";
            dialog.className = "fixed inset-0 z-[1300] m-auto flex h-full max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[24px] border border-border-subtle bg-surface-1 shadow-2xl backdrop:bg-scrim backdrop:backdrop-blur-sm p-0";

            const renderContent = () => {
              const currentTheory = loadedTheories[activeIndex] || loadedTheories[0];
              const deltaHtml = renderTheoryDeltaHtml(currentTheory.delta);
              const theoryTitle = currentTheory.title || wt('complexes.theory_title_fallback', 'Теория');
              const updatedAt = currentTheory.updated_at ? formatDateLabel(currentTheory.updated_at) : '—';

              const tabsHtml = isComposite
                ? `
                  <div class="flex items-center gap-2 border-b border-border-subtle bg-bg-secondary px-6 py-2.5 overflow-x-auto">
                    <span class="text-xs font-bold uppercase tracking-wider text-text-muted mr-1">${wt('complexes.theories_tabs_label', 'Разделы:')}</span>
                    ${loadedTheories.map((th, idx) => `
                      <button type="button" data-tab-idx="${idx}" class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${idx === activeIndex ? 'bg-primary text-white shadow-sm' : 'bg-surface-1 text-text-secondary hover:bg-bg-tertiary hover:text-text-main border border-border-subtle'}">
                        <span class="material-symbols-outlined text-[14px]">menu_book</span>
                        <span class="truncate max-w-[160px]">${escapeHtml(th.title || `${wt('complexes.tab_prefix', 'Теория')} ${idx + 1}`)}</span>
                      </button>
                    `).join('')}
                  </div>
                `
                : '';

              dialog.innerHTML = `
                <div class="flex items-start justify-between gap-4 border-b border-border-subtle bg-bg-secondary px-6 py-4 flex-shrink-0">
                  <div class="min-w-0 space-y-1">
                    <div class="flex items-center gap-2">
                      <span class="material-symbols-outlined text-[18px] text-primary">menu_book</span>
                      <h3 class="text-lg font-bold text-text-main truncate">${escapeHtml(theoryTitle)}</h3>
                    </div>
                    <div class="flex items-center gap-2 text-xs text-text-secondary flex-wrap">
                      ${complexName ? `<span class="inline-flex items-center gap-1 font-medium"><span class="material-symbols-outlined text-[14px]">folder</span>${escapeHtml(complexName)}</span><span>•</span>` : ''}
                      <span class="inline-flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">schedule</span>${wt('complexes.updated_at_label', 'Обновлено:')} ${escapeHtml(updatedAt)}</span>
                    </div>
                  </div>
                  <button type="button" data-action="close" class="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-muted hover:bg-bg-tertiary hover:text-text-main transition-colors flex-shrink-0" aria-label="${wt('complexes.close_btn', 'Закрыть')}">
                    <span class="material-symbols-outlined">close</span>
                  </button>
                </div>
                ${tabsHtml}
                <div class="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
                  <div class="theory-rendered-view mx-auto w-full max-w-5xl leading-relaxed text-text-main text-[0.95rem]">${deltaHtml}</div>
                </div>
                <div class="flex items-center justify-end border-t border-border-subtle bg-surface-1 px-6 py-3 flex-shrink-0">
                  <button type="button" data-action="close" class="btn-secondary inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg">
                    <span>${wt('complexes.close_btn', 'Закрыть')}</span>
                  </button>
                </div>
              `;

              dialog.querySelectorAll('[data-action="close"]').forEach((btn) => {
                btn.addEventListener("click", () => close());
              });

              if (isComposite) {
                dialog.querySelectorAll('[data-tab-idx]').forEach((btn) => {
                  btn.addEventListener("click", () => {
                    activeIndex = parseInt(btn.getAttribute("data-tab-idx"), 10) || 0;
                    renderContent();
                  });
                });
              }
            };

            const close = () => {
              dialog.close();
              dialog.remove();
            };

            dialog.addEventListener("click", (e) => {
              if (e.target === dialog) close();
            });
            dialog.addEventListener("cancel", (e) => {
              e.preventDefault();
              close();
            });

            document.body.appendChild(dialog);
            renderContent();
            dialog.showModal();
          }

          async function openTheoryModal(complexName, theoryId, options = {}) {
            return openComplexTheoryViewer(complexName, theoryId, options);
          }

          function applyLinkedDetailButtonState(btn, expanded) {
            if (!btn) return;
            const linkedActionKey = btn.getAttribute("data-linked-action-key") || "";
            if (!linkedActionKey) return;
            btn.classList.add("cx-card-action-btn--primary", "btn-primary", "min-w-[12rem]");
            btn.classList.remove("cx-card-action-btn--theory", "btn-secondary");
            const collapsedLabel = btn.getAttribute("data-collapsed-label") || wt('complexes.btn_open', 'Открыть');
            const expandedLabel = btn.getAttribute("data-expanded-label") || wt('complexes.btn_collapse', 'Свернуть');
            const collapsedIcon = linkedActionKey === "enter-access-code"
              ? "password"
              : linkedActionKey === "show-status"
                ? "info"
                : linkedActionKey === "open-linked"
                  ? "visibility"
                  : "expand_more";
            const icon = btn.querySelector(".material-symbols-outlined");
            if (icon) icon.textContent = expanded ? "expand_less" : collapsedIcon;
            const label = btn.querySelector(".truncate");
            if (label) label.textContent = expanded ? expandedLabel : collapsedLabel;
            btn.title = expanded ? expandedLabel : collapsedLabel;
          }

          function rebuildComplexPublicationIndex(items) {
            complexPublicationBySourceId.clear();
            complexPublicationByItemId.clear();
            const normalizedItems = Array.isArray(items) ? items : [];
            normalizedItems.forEach((item) => {
              const itemId = String(item?.item_id || "").trim();
              const sourceId = normalizeComplexId(item?.source_workspace_id || item?.source_workspace_ref);
              if (itemId) {
                complexPublicationByItemId.set(itemId, item);
              }
              if (sourceId) {
                complexPublicationBySourceId.set(sourceId, item);
              }
            });
            allComplexPublicationItems = normalizedItems;
          }

          function resolveComplexPublication(complex) {
            const sourceItemId = String(
              complex?.source_catalog_item_id
              || complex?.sourceLineage?.catalog_item_id
              || complex?.source_lineage?.catalog_item_id
              || ""
            ).trim();
            if (sourceItemId && complexPublicationByItemId.has(sourceItemId)) {
              return complexPublicationByItemId.get(sourceItemId) || null;
            }
            const complexId = normalizeComplexId(complex?.id);
            if (!complexId) return null;
            return complexPublicationBySourceId.get(complexId) || null;
          }

          function rebuildTheoryLibraryEntryIndex(entries) {
            theoryLibraryEntryByCatalogItemId.clear();
            theoryLibraryEntryBySourceTheoryId.clear();
            const normalizedEntries = Array.isArray(entries) ? entries : [];
            normalizedEntries.forEach((entryPayload) => {
              const libraryEntry = entryPayload?.library_entry && typeof entryPayload.library_entry === "object"
                ? entryPayload.library_entry
                : {};
              const item = entryPayload?.item && typeof entryPayload.item === "object"
                ? entryPayload.item
                : {};
              const version = entryPayload?.version && typeof entryPayload.version === "object"
                ? entryPayload.version
                : {};
              const normalizedEntry = {
                libraryEntryId: String(libraryEntry?.library_entry_id || "").trim(),
                accessState: String(libraryEntry?.access_state || "").trim(),
                accessReason: String(libraryEntry?.access_reason || "").trim(),
                catalogItemId: String(item?.item_id || libraryEntry?.catalog_item_id || "").trim(),
                sourceTheoryId: String(
                  item?.source_workspace_id
                  || item?.source_theory_id
                  || version?.source_workspace_id
                  || ""
                ).trim(),
              };
              if (normalizedEntry.catalogItemId) {
                theoryLibraryEntryByCatalogItemId.set(normalizedEntry.catalogItemId, normalizedEntry);
              }
              if (normalizedEntry.sourceTheoryId) {
                theoryLibraryEntryBySourceTheoryId.set(normalizedEntry.sourceTheoryId, normalizedEntry);
              }
            });
          }

          function resolveCurrentUserLinkedTheoryLink(theoryLink) {
            if (!theoryLink || typeof theoryLink !== "object") {
              return theoryLink;
            }
            const sourceKind = String(
              theoryLink?.source_kind
              || theoryLink?.sourceKind
              || (theoryLink?.library_entry_id ? "linked_library" : "workspace")
              || "workspace"
            ).trim().toLowerCase();
            if (sourceKind !== "linked_library") {
              return theoryLink;
            }
            const catalogItemId = String(theoryLink?.catalog_item_id || "").trim();
            const sourceTheoryId = String(
              theoryLink?.source_theory_id
              || theoryLink?.theory_id
              || ""
            ).trim();
            const mappedEntry = (catalogItemId && theoryLibraryEntryByCatalogItemId.get(catalogItemId))
              || (sourceTheoryId && theoryLibraryEntryBySourceTheoryId.get(sourceTheoryId))
              || null;
            if (!mappedEntry?.libraryEntryId) {
              return theoryLink;
            }
            return {
              ...theoryLink,
              library_entry_id: mappedEntry.libraryEntryId,
              access_state: mappedEntry.accessState || theoryLink?.access_state || "",
              access_reason: mappedEntry.accessReason || theoryLink?.access_reason || "",
              catalog_item_id: mappedEntry.catalogItemId || catalogItemId,
              source_theory_id: mappedEntry.sourceTheoryId || sourceTheoryId,
            };
          }

          function canUseEmbeddedTheorySnapshotAsPrimaryLinkedSource(theoryLink, embeddedTheoryItems) {
            const normalizedEmbeddedTheoryItems = Array.isArray(embeddedTheoryItems)
              ? embeddedTheoryItems.filter((item) => item && typeof item === "object")
              : [];
            if (normalizedEmbeddedTheoryItems.length !== 1) {
              return false;
            }
            if (!theoryLink || typeof theoryLink !== "object") {
              return true;
            }
            const sourceKind = String(
              theoryLink?.source_kind
              || theoryLink?.sourceKind
              || (theoryLink?.library_entry_id ? "linked_library" : "workspace")
              || "workspace"
            ).trim().toLowerCase();
            if (sourceKind !== "linked_library") {
              return false;
            }
            const catalogItemId = String(theoryLink?.catalog_item_id || "").trim();
            return !catalogItemId;
          }

          function resolvePreferredComplexTheoryLink(theoryLink, embeddedTheoryItems) {
            const normalizedEmbeddedTheoryItems = Array.isArray(embeddedTheoryItems)
              ? embeddedTheoryItems.filter((item) => item && typeof item === "object")
              : [];
            const resolvedTheoryLink = theoryLink && typeof theoryLink === "object"
              ? resolveCurrentUserLinkedTheoryLink({ ...theoryLink })
              : null;
            const sourceKind = String(
              theoryLink?.source_kind
              || theoryLink?.sourceKind
              || (theoryLink?.library_entry_id ? "linked_library" : "workspace")
              || "workspace"
            ).trim().toLowerCase();
            const catalogItemId = String(theoryLink?.catalog_item_id || "").trim();
            const sourceTheoryId = String(
              theoryLink?.source_theory_id
              || theoryLink?.theory_id
              || ""
            ).trim();
            const currentUserMappedEntry = (catalogItemId && theoryLibraryEntryByCatalogItemId.get(catalogItemId))
              || (sourceTheoryId && theoryLibraryEntryBySourceTheoryId.get(sourceTheoryId))
              || null;
            if (
              sourceKind === "linked_library"
              && !currentUserMappedEntry?.libraryEntryId
              && canUseEmbeddedTheorySnapshotAsPrimaryLinkedSource(theoryLink, normalizedEmbeddedTheoryItems)
            ) {
              return {
                theory_id: normalizedEmbeddedTheoryItems[0].theoryId,
                relation: "link",
                title_cache: normalizedEmbeddedTheoryItems[0].title || theoryLink?.title_cache || "",
                updated_at: normalizedEmbeddedTheoryItems[0].updated_at || theoryLink?.updated_at || "",
              };
            }
            if (resolvedTheoryLink) {
              return resolvedTheoryLink;
            }
            if (normalizedEmbeddedTheoryItems.length === 1) {
              return {
                theory_id: normalizedEmbeddedTheoryItems[0].theoryId,
                relation: "link",
                title_cache: normalizedEmbeddedTheoryItems[0].title || "",
                updated_at: normalizedEmbeddedTheoryItems[0].updated_at || "",
              };
            }
            return null;
          }

          function getAccessCodeValue(item) {
            return String(item?.access_code || item?.payload?.access_code || "").trim();
          }

          function formatAccessCodeDisplay(value) {
            const code = String(value || "").trim().replace(/\s+/g, "").replace(/-/g, "").toUpperCase();
            if (!code) return "";
            return code.match(/.{1,4}/g)?.join("-") || code;
          }

          function showComplexModalOverlay(markup, options = {}) {
            if (!document.body) return Promise.resolve(null);
            const overlay = document.createElement("div");
            overlay.className = `fixed inset-0 ${options.zIndexClass || "z-[1220]"} bg-scrim backdrop-blur-sm flex items-center justify-center p-4`;
            overlay.innerHTML = markup;
            return new Promise((resolve) => {
              const close = (resultValue) => {
                overlay.remove();
                resolve(resultValue);
              };
              overlay.querySelectorAll('[data-role="close"], [data-role="cancel"]').forEach((node) => {
                node.addEventListener("click", () => close(null));
              });
              overlay.addEventListener("click", (event) => {
                if (event.target === overlay) close(null);
              });
              document.body.appendChild(overlay);
            });
          }

          function countComplexAddRelatedTheoryEntries(payload = {}) {
            return Array.isArray(payload?.related_theory_library_entries)
              ? payload.related_theory_library_entries.length
              : 0;
          }

          function summarizeComplexAddByCodeResult(payload = {}) {
            const relatedTheoryCount = countComplexAddRelatedTheoryEntries(payload);
            const reused = payload?.reused === true;
            const what = reused
              ? wt('complexes.code_already_added', 'Комплекс по коду уже есть в вашей библиотеке.')
              : wt('complexes.code_added', 'Комплекс добавлен в вашу библиотеку по коду.');
            if (relatedTheoryCount === 1) {
              return {
                severity: "success",
                what,
                impact: wt('complexes.code_theory_synced', 'Связанная теория автора тоже синхронизирована с Теоретическим центром.'),
                next: wt('complexes.code_open_theory_hub', 'Комплекс уже доступен на этой странице, а теорию можно открыть из Центра теории.'),
              };
            }
            if (relatedTheoryCount > 1) {
              return {
                severity: "success",
                what,
                impact: wt('complexes.code_theories_synced_n', 'Вместе с комплексом синхронизированы связанные теории автора: {n}.').replace('{n}', relatedTheoryCount),
                next: wt('complexes.code_theories_in_hub', 'Комплекс уже доступен на этой странице, а теории появились в Центре теории.'),
              };
            }
            return {
              severity: "success",
              what,
              impact: wt('complexes.code_no_theory', 'У этой публикации нет прикреплённой теории, поэтому в Теоретический центр ничего не добавлялось.'),
              next: wt('complexes.code_available', 'Комплекс уже доступен на этой странице.'),
            };
          }

          function getCatalogItemTaskCount(item = {}) {
            const latestManifest = item?.latest_manifest && typeof item.latest_manifest === "object"
              ? item.latest_manifest
              : {};
            const dependencyCounts = latestManifest?.dependency_counts && typeof latestManifest.dependency_counts === "object"
              ? latestManifest.dependency_counts
              : {};
            const rawCount = latestManifest?.task_count ?? dependencyCounts?.tasks ?? 0;
            const parsed = Number(rawCount || 0);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
          }

          function getCatalogItemTheoryCount(item = {}) {
            const latestManifest = item?.latest_manifest && typeof item.latest_manifest === "object"
              ? item.latest_manifest
              : {};
            const dependencyCounts = latestManifest?.dependency_counts && typeof latestManifest.dependency_counts === "object"
              ? latestManifest.dependency_counts
              : {};
            const rawCount = dependencyCounts?.theories ?? 0;
            const parsed = Number(rawCount || 0);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
          }

          async function resolveCatalogItemByAccessCode(accessCode) {
            const resp = await fetch("/api/catalog/access-code/resolve", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ access_code: String(accessCode || "").trim() }),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data?.ok !== true) {
              const error = String(data?.error || `catalog_access_code_resolve_failed:${resp.status}`).trim();
              const detail = new Error(error);
              detail.status = resp.status;
              detail.payload = data;
              throw detail;
            }
            return data;
          }

          async function addCatalogComplexToLibraryByCode(itemId, accessCode) {
            const resp = await fetch(`/api/catalog/items/${encodeURIComponent(String(itemId || "").trim())}/library`, {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ access_code: String(accessCode || "").trim() }),
            });
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok || data?.ok !== true) {
              const error = String(data?.error || `catalog_add_item_to_library_failed:${resp.status}`).trim();
              const detail = new Error(error);
              detail.status = resp.status;
              detail.payload = data;
              throw detail;
            }
            return data;
          }

          async function openComplexAddByCodeDialog(initialValue = "") {
            return new Promise((resolve) => {
              const overlay = document.createElement("div");
              overlay.className = "fixed inset-0 z-[1220] bg-scrim backdrop-blur-sm flex items-center justify-center p-4";
              overlay.innerHTML = `
                <div class="w-full max-w-lg rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-xl">
                  <div class="space-y-2">
                    <p class="text-lg font-bold text-text-main">${wt('complexes.code_dialog_title', 'Добавить комплекс по коду')}</p>
                    <p class="text-sm text-text-secondary">${wt('complexes.code_dialog_copy', 'Введите код доступа, который прислал автор. Если к комплексу прикреплена теория, она тоже синхронизируется с вашим Теоретическим центром.')}</p>
                  </div>
                  <form data-role="access-form" class="mt-4 space-y-4">
                    <input
                      data-role="access-input"
                      type="text"
                      autocomplete="off"
                      value="${escapeHtml(String(initialValue || "").trim())}"
                      placeholder="${wt('complexes.code_input_placeholder', 'Например, AB12-CD34-EF56-GH78')}"
                      class="w-full rounded-xl border border-border-subtle bg-surface-2 px-4 py-3 text-text-main outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                    />
                    <div class="flex justify-end gap-3">
                      <button type="button" class="btn-secondary h-10 px-4" data-role="cancel">${wt('complexes.btn_cancel', 'Отмена')}</button>
                      <button type="submit" class="btn-primary h-10 px-4">${wt('complexes.btn_check_code', 'Проверить код')}</button>
                    </div>
                  </form>
                </div>
              `;
              const close = (resultValue = null) => {
                overlay.remove();
                resolve(resultValue);
              };
              overlay.addEventListener("click", (event) => {
                if (event.target === overlay) close(null);
              });
              overlay.querySelector('[data-role="cancel"]')?.addEventListener("click", () => close(null));
              overlay.querySelector('[data-role="access-form"]')?.addEventListener("submit", (event) => {
                event.preventDefault();
                const value = overlay.querySelector('[data-role="access-input"]')?.value || "";
                close(String(value || "").trim());
              });
              document.body.appendChild(overlay);
              overlay.querySelector('[data-role="access-input"]')?.focus();
              overlay.querySelector('[data-role="access-input"]')?.select?.();
            });
          }

          async function openComplexAddByCodeConfirmDialog(item = {}) {
            const taskCount = getCatalogItemTaskCount(item);
            const theoryCount = getCatalogItemTheoryCount(item);
            const ownerLabel = String(item?.owner_display_name || item?.owner_user_id || wt('complexes.author_unknown', 'Автор не указан')).trim();
            const description = String(item?.description || "").trim();
            return new Promise((resolve) => {
              const overlay = document.createElement("div");
              overlay.className = "fixed inset-0 z-[1220] bg-scrim backdrop-blur-sm flex items-center justify-center p-4";
              overlay.innerHTML = `
                <div class="w-full max-w-2xl rounded-[28px] border border-border-subtle bg-surface-1 shadow-xl overflow-hidden">
                  <div class="border-b border-border-subtle px-5 py-4">
                    <p class="text-xs font-bold uppercase tracking-[0.16em] text-text-muted">${wt('complexes.code_dialog_kicker', 'Комплекс по коду')}</p>
                    <p class="mt-2 text-xl font-black text-text-main">${wt('complexes.code_confirm_title', 'Добавить публикацию в библиотеку?')}</p>
                    <p class="mt-2 text-sm text-text-secondary">${wt('complexes.code_confirm_copy', 'Комплекс сохранится как связанная публикация без создания отдельной редактируемой версии в workspace.')}</p>
                  </div>
                  <div class="space-y-4 px-5 py-5">
                    <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4">
                      <p class="text-base font-bold text-text-main">${escapeHtml(String(item?.title || wt('complexes.complex_fallback', 'Комплекс')).trim())}</p>
                      <div class="mt-2 flex flex-wrap gap-2 text-xs text-text-secondary">
                        <span class="pill pill-sm pill-neutral">${wt('complexes.author_prefix', 'Автор')}: ${escapeHtml(ownerLabel)}</span>
                        <span class="pill pill-sm pill-neutral">${wt('complexes.tasks_prefix', 'Заданий')}: ${escapeHtml(String(taskCount))}</span>
                        <span class="pill pill-sm ${theoryCount > 0 ? "pill-info" : "pill-neutral"}">${wt('complexes.theory_prefix', 'Теория')}: ${escapeHtml(theoryCount > 0 ? (theoryCount === 1 ? wt('complexes.theory_attached_one', 'прикреплена') : wt('complexes.theory_attached_n', 'прикреплено {n}').replace('{n}', theoryCount)) : wt('complexes.theory_not_attached', 'не прикреплена'))}</span>
                      </div>
                      ${description ? `<p class="mt-3 text-sm text-text-secondary">${escapeHtml(description)}</p>` : ""}
                    </div>
                    <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4">
                      <div class="space-y-3 text-sm text-text-secondary">
                        <p>${wt('complexes.code_confirm_note', 'После добавления комплекс появится на этой странице как связанная публикация каталога.')}</p>
                        <p>${escapeHtml(theoryCount > 0
                          ? wt('complexes.code_confirm_theory_yes', 'Связанная теория автора тоже будет добавлена в Теоретический центр.')
                          : wt('complexes.code_confirm_theory_no', 'Связанной теории у этой публикации нет, поэтому в Теоретический центр ничего не добавится.'))}</p>
                      </div>
                    </div>
                  </div>
                  <div class="flex justify-end gap-3 border-t border-border-subtle px-5 py-4">
                    <button type="button" class="btn-secondary h-10 px-4" data-role="cancel">${wt('complexes.btn_cancel', 'Отмена')}</button>
                    <button type="button" class="btn-primary h-10 px-4" data-role="confirm">${wt('complexes.btn_add', 'Добавить')}</button>
                  </div>
                </div>
              `;
              const close = (resultValue = false) => {
                overlay.remove();
                resolve(Boolean(resultValue));
              };
              overlay.addEventListener("click", (event) => {
                if (event.target === overlay) close(false);
              });
              overlay.querySelector('[data-role="cancel"]')?.addEventListener("click", () => close(false));
              overlay.querySelector('[data-role="confirm"]')?.addEventListener("click", () => close(true));
              document.body.appendChild(overlay);
            });
          }

          async function addComplexByAccessCodeFlow() {
            const accessCode = await openComplexAddByCodeDialog();
            if (!accessCode) return;
            try {
              const resolvedPayload = await resolveCatalogItemByAccessCode(accessCode);
              const item = resolvedPayload?.item && typeof resolvedPayload.item === "object"
                ? resolvedPayload.item
                : {};
              if (String(item?.content_type || "").trim().toLowerCase() !== "complex") {
                showComplexVoiceToast({
                  severity: "warning",
                  what: wt('complexes.code_err_wrong_type_what', 'Этот код относится не к комплексу.'),
                  impact: wt('complexes.code_err_wrong_type_impact', 'На странице «Комплексы» можно добавлять только публикации комплексов.'),
                  next: wt('complexes.code_err_wrong_type_next', 'Если это теория, откройте Теоретический центр или общий каталог.'),
                });
                return;
              }
              const confirmed = await openComplexAddByCodeConfirmDialog(item);
              if (!confirmed) return;
              const addPayload = await addCatalogComplexToLibraryByCode(item.item_id, accessCode);
              await fetchComplexes();
              showComplexVoiceToast(summarizeComplexAddByCodeResult(addPayload));
            } catch (error) {
              const errorText = String(error?.message || "").trim();
              if (error?.status === 403 || errorText === "guest_cannot_add_to_library") {
                showComplexVoiceToast({
                  severity: "warning",
                  what: wt('complexes.code_err_unauthorized_what', 'Добавление по коду доступно только после входа в аккаунт.'),
                  impact: wt('complexes.code_err_unauthorized_impact', 'Без авторизации библиотека не может сохранить связанную публикацию.'),
                  next: wt('complexes.code_err_unauthorized_next', 'Войдите в аккаунт и повторите попытку.'),
                });
                window.navigateWithTransition?.("/");
                return;
              }
              if (errorText === "catalog_access_code_not_found" || errorText === "invalid_access_code") {
                showComplexVoiceToast({
                  severity: "warning",
                  what: wt('complexes.code_err_not_found_what', 'Код не найден.'),
                  impact: wt('complexes.code_err_not_found_impact', 'Публикация с таким кодом сейчас недоступна.'),
                  next: wt('complexes.code_err_not_found_next', 'Проверьте код у автора и попробуйте ещё раз.'),
                });
                return;
              }
              showComplexVoiceToast({
                severity: "error",
                what: wt('complexes.code_err_general_what', 'Не удалось добавить комплекс по коду.'),
                impact: wt('complexes.code_err_general_impact', 'Библиотека комплексов осталась без изменений.'),
                next: errorText || wt('complexes.code_err_general_next', 'Повторите попытку позже.'),
              });
            }
          }

          function getComplexSortName(item) {
            return String(item?.name || '').trim();
          }

          function getComplexSortTimestamp(item) {
            const raw = item?.updated_at ?? item?.created_at ?? null;
            if (raw == null || raw === '') return null;
            if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
            const parsed = Date.parse(String(raw));
            return Number.isFinite(parsed) ? parsed : null;
          }

          function getComplexSortTaskCount(item) {
            return resolveComplexTasksCount(item);
          }

          function compareComplexNames(a, b, direction = 'asc') {
            const collator = new Intl.Collator('ru-RU', { sensitivity: 'base', numeric: true });
            const direct = collator.compare(getComplexSortName(a), getComplexSortName(b));
            if (direct !== 0) {
              return direction === 'desc' ? -direct : direct;
            }
            return collator.compare(String(a?.id || ''), String(b?.id || ''));
          }

          function compareComplexTimestamps(a, b, direction = 'desc') {
            const aTime = getComplexSortTimestamp(a);
            const bTime = getComplexSortTimestamp(b);
            if (aTime == null && bTime == null) return compareComplexNames(a, b, 'asc');
            if (aTime == null) return 1;
            if (bTime == null) return -1;
            if (aTime !== bTime) {
              return direction === 'asc' ? aTime - bTime : bTime - aTime;
            }
            return compareComplexNames(a, b, 'asc');
          }

          function compareComplexTaskCounts(a, b) {
            const diff = getComplexSortTaskCount(b) - getComplexSortTaskCount(a);
            if (diff !== 0) return diff;
            const dateDiff = compareComplexTimestamps(a, b, 'desc');
            if (dateDiff !== 0) return dateDiff;
            return compareComplexNames(a, b, 'asc');
          }

          function sortComplexItems(items, sortKey) {
            const arr = items.slice();
            switch (normalizeComplexSortKey(sortKey)) {
              case 'name-desc':
                return arr.sort((a, b) => compareComplexNames(a, b, 'desc'));
              case 'date-desc':
                return arr.sort((a, b) => compareComplexTimestamps(a, b, 'desc'));
              case 'date-asc':
                return arr.sort((a, b) => compareComplexTimestamps(a, b, 'asc'));
              case 'tasks-desc':
                return arr.sort((a, b) => compareComplexTaskCounts(a, b));
              default: // 'name-asc'
                return arr.sort((a, b) => compareComplexNames(a, b, 'asc'));
            }
          }

          function updateSortUi() {
            const select = document.getElementById('complex-sort-select');
            if (select && select.value !== activeComplexSort) {
              select.value = activeComplexSort;
            }
            const btns = document.querySelectorAll('.cx-sort-btn[data-sort]');
            btns.forEach((btn) => {
              const active = btn.getAttribute('data-sort') === activeComplexSort;
              btn.classList.toggle('active', active);
              btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            });
          }

          function setComplexSort(sortKey) {
            activeComplexSort = normalizeComplexSortKey(sortKey);
            updateSortUi();
            if (allComplexItems.length) {
              rerenderComplexList(allComplexItems);
            }
          }

          function bindComplexSort() {
            const select = document.getElementById('complex-sort-select');
            if (select) {
              select.addEventListener('change', () => setComplexSort(select.value));
            }
            document.querySelectorAll('.cx-sort-btn[data-sort]').forEach((btn) => {
              btn.addEventListener('click', () => setComplexSort(btn.getAttribute('data-sort')));
            });
            updateSortUi();
          }
          const loadingRevealDelayMs = window.ACTRA_CONFIG?.ui?.loadingRevealDelayMs ?? 280;

          function readInitialTheoryFilterFromUrl() {
            try {
              const params = new URLSearchParams(window.location.search || "");
              return String(params.get("theory_id") || "").trim();
            } catch (error) {
              return "";
            }
          }

          function updateTheoryFilterUrl() {
            try {
              const url = new URL(window.location.href);
              if (activeTheoryFilterId) {
                url.searchParams.set("theory_id", activeTheoryFilterId);
              } else {
                url.searchParams.delete("theory_id");
              }
              window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
            } catch (error) {
              console.warn("[Complexes] Failed to update theory filter URL", error);
            }
          }

          function resolveTheoryFilterLabel(theoryId) {
            const normalizedTheoryId = String(theoryId || "").trim();
            if (!normalizedTheoryId) return "";
            const items = Array.isArray(allComplexItems) ? allComplexItems : [];
            for (const complex of items) {
              const theoryLink = (complex && typeof complex.theory_link === "object") ? complex.theory_link : null;
              const linkedTheoryId = String(theoryLink?.theory_id || "").trim();
              if (linkedTheoryId && linkedTheoryId === normalizedTheoryId) {
                const title = String(
                  theoryLink?.theory_title
                  || theoryLink?.title
                  || theoryLink?.theory_name
                  || ""
                ).trim();
                if (title) return title;
              }
            }
            return normalizedTheoryId;
          }

          function updateComplexTheoryBanner() {
            const banner = document.getElementById("complex-theory-banner");
            const copy = document.getElementById("complex-theory-banner-copy");
            if (!banner || !copy) return;
            if (!activeTheoryFilterId) {
              banner.classList.add("hidden");
              return;
            }
            copy.textContent = wt('complexes.theory_banner_copy', 'Показаны комплексы, связанные с теорией «{name}».')
              .replace('{name}', resolveTheoryFilterLabel(activeTheoryFilterId));
            banner.classList.remove("hidden");
          }

          function setTheoryFilter(theoryId, { updateUrl = true } = {}) {
            activeTheoryFilterId = String(theoryId || "").trim();
            updateComplexTheoryBanner();
            if (updateUrl) updateTheoryFilterUrl();
            applyComplexFilters();
          }

          function normalizeComplexId(value) {
            if (value === null || value === undefined) return "";
            return String(value);
          }

          function normalizeComplexSearch(value) {
            return String(value || "")
              .toLocaleLowerCase("ru-RU")
              .trim();
          }

          function getComplexTheoryLinkTarget(theoryLink) {
            if (!theoryLink || typeof theoryLink !== "object") {
              return {
                sourceKind: "workspace",
                theoryId: "",
                libraryEntryId: "",
              };
            }
            const effectiveTheoryLink = resolveCurrentUserLinkedTheoryLink(theoryLink);
            const sourceKind = String(
              effectiveTheoryLink?.source_kind
              || effectiveTheoryLink?.sourceKind
              || (effectiveTheoryLink?.library_entry_id ? "linked_library" : "workspace")
              || "workspace"
            ).trim().toLowerCase() === "linked_library"
              ? "linked_library"
              : "workspace";
            const accessState = String(effectiveTheoryLink?.access_state || "").trim().toLowerCase();
            const isMissing = effectiveTheoryLink?.missing === true;
            if (sourceKind === "linked_library") {
              const isBlockedLinkedTheory = accessState === "revoked"
                || accessState === "deleted_source"
                || accessState === "requires_access_code";
              if (isBlockedLinkedTheory || isMissing) {
                return {
                  sourceKind: "workspace",
                  theoryId: "",
                  libraryEntryId: "",
                };
              }
            } else if (isMissing) {
              return {
                sourceKind: "workspace",
                theoryId: "",
                libraryEntryId: "",
              };
            }
            return {
              sourceKind,
              theoryId: String(effectiveTheoryLink?.theory_id || "").trim(),
              libraryEntryId: String(effectiveTheoryLink?.library_entry_id || "").trim(),
            };
          }

          function resolveComplexTheoryMode(complex) {
            const rawMode = String(complex?.theory_mode || "").trim().toLowerCase();
            if (rawMode === "inherit" || rawMode === "override") return rawMode;
            const theoryTarget = getComplexTheoryLinkTarget(
              (complex && typeof complex.theory_link === "object") ? complex.theory_link : null
            );
            return (theoryTarget.theoryId || theoryTarget.libraryEntryId) ? "override" : "inherit";
          }

          function resolveComplexTheorySyncStatus(complex) {
            const rawStatus = String(complex?.theory_sync_status || "").trim().toLowerCase();
            if (rawStatus === "conflict") return "composite";
            if (rawStatus === "ok" || rawStatus === "none" || rawStatus === "composite") return rawStatus;
            const theoryIds = Array.isArray(complex?.theory_sync_meta?.theory_ids)
              ? complex.theory_sync_meta.theory_ids.map((value) => String(value || "").trim()).filter(Boolean)
              : [];
            if (theoryIds.length > 1) return "composite";
            const theoryTarget = getComplexTheoryLinkTarget(
              (complex && typeof complex.theory_link === "object") ? complex.theory_link : null
            );
            return (theoryTarget.theoryId || theoryTarget.libraryEntryId) ? "ok" : "none";
          }

          function hasComplexTheoryTopicRefs(complex) {
            const tasks = Array.isArray(complex?.tasks) ? complex.tasks : [];
            return tasks.some((task) => {
              const rawRef = typeof task === "string"
                ? task
                : String(task?.task_ref || task?.task_id || "").trim();
              return rawRef.split("/").filter(Boolean).length >= 3;
            });
          }

          function isComplexTheoryManualSyncRelevant(complex) {
            const mode = resolveComplexTheoryMode(complex);
            if (mode !== "inherit") return false;
            if (!hasComplexTheoryTopicRefs(complex)) return false;

            const syncMeta = (complex && typeof complex.theory_sync_meta === "object") ? complex.theory_sync_meta : {};
            const source = String(syncMeta.source || "").trim().toLowerCase();
            const createdVia = String(complex?.ownership?.created_via || complex?.created_via || "").trim().toLowerCase();
            const currentSources = new Set([
              "complex_create",
              "complex_update",
              "topic_propagation",
              "single_complex_sync",
            ]);

            if (createdVia === "archive_import" || createdVia === "workspace_import") return true;
            if (!source) return true;
            return !currentSources.has(source);
          }

          function getDeltaImageAttributes(attrs) {
            const imageAttrs = {};
            if (!attrs || typeof attrs !== "object") return imageAttrs;
            const width = String(attrs.width || "").trim();
            if (width) imageAttrs.width = width;
            const align = String(attrs.align || "").trim();
            if (["left", "center", "right"].includes(align)) imageAttrs.align = align;
            const rotate = String(attrs.rotate || "").trim();
            if (["0", "90", "180", "270"].includes(rotate)) imageAttrs.rotate = rotate;
            const float = String(attrs.float || "").trim();
            if (["none", "left", "right"].includes(float)) imageAttrs.float = float;
            const flip = String(attrs.flip || "").trim();
            if (["none", "horizontal"].includes(flip)) imageAttrs.flip = flip;
            return imageAttrs;
          }

          function buildComplexTheoryBadges(complex) {
            const mode = resolveComplexTheoryMode(complex);
            const syncStatus = resolveComplexTheorySyncStatus(complex);

            const modeBadge = mode === "inherit"
              ? `<span class="cx-card-badge pill pill-sm pill-neutral">
                    <span class="material-symbols-outlined text-sm">account_tree</span> ${wt('complexes.theory_mode_inherit', 'Наследование')}
                 </span>`
              : `<span class="cx-card-badge pill pill-sm pill-info">
                    <span class="material-symbols-outlined text-sm">tune</span> ${wt('complexes.theory_mode_local', 'Локальная теория')}
                 </span>`;

            const statusBadge = syncStatus === "composite"
              ? `<span class="cx-card-badge pill pill-sm pill-info">
                    <span class="material-symbols-outlined text-sm">layers</span> ${wt('complexes.theory_mode_composite', 'Подборка теорий')}
                  </span>`
              : "";

            return { mode, syncStatus, modeBadge, statusBadge };
          }

          function resolveComplexOwnership(complex) {
            if (window.WorkspaceImportClient && typeof window.WorkspaceImportClient.resolveComplexOwnership === "function") {
              return window.WorkspaceImportClient.resolveComplexOwnership(complex);
            }
            const ownership = (complex && typeof complex.ownership === "object") ? complex.ownership : {};
            const createdByUserId = String(
              ownership.created_by_user_id || complex?.created_by_user_id || ""
            ).trim();
            const updatedByUserId = String(
              ownership.updated_by_user_id || complex?.updated_by_user_id || createdByUserId || ""
            ).trim();
            const createdVia = String(
              ownership.created_via || complex?.created_via || ""
            ).trim() || "legacy_unknown";
            const contentScope = String(
              ownership.content_scope || complex?.content_scope || ""
            ).trim() || "shared_local";
            const normalizedCurrentUserId = String(currentComplexesUserId || "").trim();
            const explicitOwnership = ownership.is_owned_by_current_user === true;
            const inferredOwnership = !!(
              normalizedCurrentUserId
              && createdByUserId
              && createdByUserId === normalizedCurrentUserId
            );
            const isOwnedByCurrentUser = explicitOwnership || inferredOwnership;
            return {
              createdByUserId,
              createdByUserName: ownership.created_by_user_name || null,
              updatedByUserId,
              createdVia,
              contentScope,
              hasOwner: ownership.has_owner === true || !!createdByUserId,
              isOwnedByCurrentUser,
              isSharedLibrary: ownership.is_shared_library !== false,
            };
          }

          function isImportedLibraryComplex(complex) {
            if (isLinkedLibraryComplex(complex)) {
              return false;
            }
            const ownership = resolveComplexOwnership(complex);
            const createdVia = String(ownership.createdVia || "").trim().toLowerCase();
            if (createdVia === "workspace_import" || createdVia === "archive_import") {
              return true;
            }
            return !!String(
              complex?.source_catalog_item_id
              || complex?.sourceLineage?.catalog_item_id
              || complex?.source_lineage?.catalog_item_id
              || ""
            ).trim();
          }

          function shouldDisplayComplexInLibrary(complex) {
            const ownership = resolveComplexOwnership(complex);
            if (ownership.isOwnedByCurrentUser) return true;
            return isImportedLibraryComplex(complex) || isLinkedLibraryComplex(complex);
          }

          function resolveComplexCreatedViaLabel(createdVia) {
            if (window.WorkspaceImportClient && typeof window.WorkspaceImportClient.getCreatedViaLabel === "function") {
              return window.WorkspaceImportClient.getCreatedViaLabel(createdVia);
            }
            const normalizedCreatedVia = String(createdVia || "").trim().toLowerCase();
            if (normalizedCreatedVia === "workspace_import") return "Legacy import";
            if (normalizedCreatedVia === "archive_import") return "Legacy import";
            switch (String(createdVia || "").trim().toLowerCase()) {
              case "complex_builder":
                return wt('complexes.created_via_author', 'Авторский');
              case "manual_editor":
                return wt('complexes.created_via_author', 'Авторский');
              case "workspace_import":
              case "archive_import":
                return "Legacy import";
              case "analysis_auto":
                return wt('complexes.created_via_ai', 'Собрано ИИ');
              case "topic_propagation":
                return wt('complexes.created_via_topics', 'Обновлено из тем');
              case "single_complex_sync":
                return wt('complexes.created_via_topics', 'Обновлено из тем');
              default:
                return wt('complexes.created_via_external', 'Внешний источник');
            }
          }

          function buildComplexOwnershipBadges(complex) {
            const ownership = resolveComplexOwnership(complex);
            const isLinked = isLinkedLibraryComplex(complex);
            const isImported = isImportedLibraryComplex(complex);
            const isForeignLocalShared = !ownership.isOwnedByCurrentUser && !isImported && !isLinked && ownership.hasOwner;
            const ownerBadge = ownership.isOwnedByCurrentUser
              ? isImported
                ? `<span class="cx-card-badge pill pill-sm pill-info" title="${wt('complexes.badge_imported_title', 'Рабочая версия, импортированная из публикации')}">
                      <span class="material-symbols-outlined text-sm">content_copy</span> ${wt('complexes.badge_imported', 'Импортировано')}
                   </span>`
                : `<span class="cx-card-badge pill pill-sm pill-success" title="${wt('complexes.badge_mine_title', 'Создано в вашей библиотеке')}">
                      <span class="material-symbols-outlined text-sm">person</span> ${wt('complexes.badge_mine', 'Мой комплекс')}
                   </span>`
              : isForeignLocalShared
                ? `<span class="cx-card-badge pill pill-sm pill-neutral" title="${wt('complexes.badge_shared_title', 'Комплекс создан другим локальным профилем и пока живёт как общий объект библиотеки')}">
                      <span class="material-symbols-outlined text-sm">group</span> ${wt('complexes.badge_shared', 'Общий объект')}
                   </span>`
              : ownership.hasOwner
                ? `<span class="cx-card-badge pill pill-sm pill-neutral max-w-full" title="${wt('complexes.badge_author_title', 'Автор исходного комплекса')}">
                      <span class="material-symbols-outlined text-sm">badge</span> ${wt('complexes.author_prefix', 'Автор')}: ${escapeHtml(ownership.createdByUserName || ownership.createdByUserId)}
                   </span>`
                : "";
            const createdViaLabel = resolveComplexCreatedViaLabel(ownership.createdVia);
            const sourceBadge = isLinked
              ? `<span class="cx-card-badge pill pill-sm pill-neutral" title="${wt('complexes.badge_from_catalog_title', 'Этот комплекс добавлен из каталога и открыт только для чтения')}">
                    <span class="material-symbols-outlined text-sm">link</span> ${wt('complexes.badge_from_catalog', 'Из каталога')}
                 </span>`
              : isImported
              ? `<span class="cx-card-badge pill pill-sm pill-neutral" title="${wt('complexes.badge_copy_origin_title', 'Как эта копия появилась в библиотеке')}">
                    <span class="material-symbols-outlined text-sm">inventory_2</span> ${escapeHtml(createdViaLabel)}
                 </span>`
              : !ownership.isOwnedByCurrentUser && !isForeignLocalShared
                ? `<span class="cx-card-badge pill pill-sm pill-neutral" title="${wt('complexes.badge_external_title', 'Этот объект пришёл из внешнего источника')}">
                      <span class="material-symbols-outlined text-sm">inventory_2</span> ${escapeHtml(createdViaLabel)}
                   </span>`
                : "";
            const finalOwnerBadge = ownership.isOwnedByCurrentUser && isImported
              ? `<span class="cx-card-badge pill pill-sm pill-info" title="Legacy import preserved from an older workspace flow">
                      <span class="material-symbols-outlined text-sm">history</span> Legacy import
                   </span>`
              : ownerBadge;
            return { ownership, ownerBadge: finalOwnerBadge, sourceBadge, isImported, isLinked, isForeignLocalShared };
          }

          function getComplexById(complexId) {
            const normalized = normalizeComplexId(complexId);
            if (!normalized) return null;
            return (Array.isArray(allComplexItems) ? allComplexItems : []).find((item) => normalizeComplexId(item?.id) === normalized) || null;
          }

          function resolveComplexTaskDisplayName(task) {
            const ref = typeof task === "string"
              ? task
              : String(task?.task_ref || task?.task_id || "").trim();
            let taskName = complexTaskNameCache[ref] || "";
            if (!taskName) {
              taskName = ref;
              if (ref.includes("/")) {
                const parts = ref.split("/");
                taskName = parts[parts.length - 1];
              }
              taskName = taskName.replace(/\.(json|xml|bin)$/i, "").replace(/_/g, " ");
              taskName = taskName.charAt(0).toUpperCase() + taskName.slice(1);
            }
            return { ref, taskName };
          }

          function buildComplexTaskRows(tasksList = []) {
            const taskTypeLabels = { test: wt('complexes.task_type_test', 'Тест'), click: wt('complexes.task_type_click', 'Клик'), draw: wt('complexes.task_type_draw', 'Рисование'), sequence_assembly: wt('complexes.task_type_sequence', 'Последовательность'), image_labeling: wt('complexes.task_type_image_labeling', 'Подписи на рисунке'), open_answer: wt('complexes.task_type_open', 'Открытый ответ') };
            return tasksList.map((task, index) => {
              const { taskName } = resolveComplexTaskDisplayName(task);
              const typeBadge = task?.type ? (taskTypeLabels[task.type] || task.type) : "";
              return `<div class="cx-detail-row panel-row panel-row--soft px-3 py-2 text-sm">
                <span class="cx-detail-title text-text-main font-medium"><span class="text-text-disabled mr-2">#${index + 1}</span>${escapeHtml(taskName || `${wt('complexes.task_fallback', 'Задание')} ${index + 1}`)}</span>
                ${typeBadge ? `<span class="cx-detail-type text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-md bg-bg-tertiary border border-border-subtle">${escapeHtml(typeBadge)}</span>` : ""}
              </div>`;
            }).join("");
          }

          function buildLinkedComplexDetailBody(detail) {
            const libraryEntry = detail?.library_entry && typeof detail.library_entry === "object" ? detail.library_entry : {};
            const snapshot = detail?.snapshot && typeof detail.snapshot === "object" ? detail.snapshot : {};
            const snapshotComplex = snapshot?.complex && typeof snapshot.complex === "object" ? snapshot.complex : {};
            const tasksList = Array.isArray(snapshotComplex?.tasks) ? snapshotComplex.tasks : [];
            const description = String(snapshotComplex?.description || "").trim();
            const accessReason = String(libraryEntry?.access_reason || "").trim();
            const rows = buildComplexTaskRows(tasksList);
            return `
              ${description ? `<p class="text-sm text-text-secondary">${escapeHtml(description)}</p>` : ""}
              ${accessReason ? `<p class="text-xs text-text-secondary">${escapeHtml(accessReason)}</p>` : ""}
              ${tasksList.length ? `<div class="cx-detail-list">${rows}</div>` : `<p class="text-sm text-text-secondary">${wt('complexes.no_tasks', 'В этом комплексе пока нет заданий.')}</p>`}
            `;
          }

          async function requestLinkedComplexAccessCode(complex) {
            const codeResult = await showComplexModalOverlay(`
              <div class="w-full max-w-md rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-xl">
                <div class="space-y-2">
                  <p class="text-lg font-bold text-text-main">${wt('complexes.access_code_title', 'Введите код доступа')}</p>
                  <p class="text-sm text-text-secondary">${escapeHtml(complex?.name || wt('complexes.complex_fallback', 'Комплекс'))}</p>
                </div>
                <form data-role="access-form" class="mt-4 space-y-4">
                  <input data-role="access-input" type="text" autocomplete="off" placeholder="${wt('complexes.access_code_placeholder', 'Код доступа')}" class="w-full rounded-xl border border-border-subtle bg-surface-2 px-4 py-3 text-text-main outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" />
                  <div class="flex justify-end gap-3">
                    <button type="button" class="btn-secondary h-10 px-4" data-role="cancel">${wt('complexes.btn_cancel', 'Отмена')}</button>
                    <button type="submit" class="btn-primary h-10 px-4">${wt('complexes.btn_open', 'Открыть')}</button>
                  </div>
                </form>
              </div>
            `);
            if (!codeResult) return "";
            return String(codeResult).trim();
          }

          async function openLinkedComplexAccessDialog(complex) {
            return new Promise((resolve) => {
              const overlay = document.createElement("div");
              overlay.className = "fixed inset-0 z-[1220] bg-scrim backdrop-blur-sm flex items-center justify-center p-4";
              overlay.innerHTML = `
                <div class="w-full max-w-md rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-xl">
                  <div class="space-y-2">
                    <p class="text-lg font-bold text-text-main">${wt('complexes.access_code_title', 'Введите код доступа')}</p>
                    <p class="text-sm text-text-secondary">${escapeHtml(complex?.name || wt('complexes.complex_fallback', 'Комплекс'))}</p>
                  </div>
                  <form data-role="access-form" class="mt-4 space-y-4">
                    <input data-role="access-input" type="text" autocomplete="off" placeholder="${wt('complexes.access_code_placeholder', 'Код доступа')}" class="w-full rounded-xl border border-border-subtle bg-surface-2 px-4 py-3 text-text-main outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15" />
                    <div class="flex justify-end gap-3">
                      <button type="button" class="btn-secondary h-10 px-4" data-role="cancel">${wt('complexes.btn_cancel', 'Отмена')}</button>
                      <button type="submit" class="btn-primary h-10 px-4">${wt('complexes.btn_open', 'Открыть')}</button>
                    </div>
                  </form>
                </div>
              `;
              const close = (value = "") => {
                overlay.remove();
                resolve(String(value || "").trim());
              };
              overlay.addEventListener("click", (event) => {
                if (event.target === overlay) close("");
              });
              overlay.querySelector('[data-role="cancel"]')?.addEventListener("click", () => close(""));
              overlay.querySelector('[data-role="access-form"]')?.addEventListener("submit", (event) => {
                event.preventDefault();
                const value = overlay.querySelector('[data-role="access-input"]')?.value || "";
                close(value);
              });
              document.body.appendChild(overlay);
              overlay.querySelector('[data-role="access-input"]')?.focus();
            });
          }

          async function ensureLinkedComplexDetailLoaded(complexId) {
            const complex = getComplexById(complexId);
            if (!isLinkedLibraryComplex(complex)) return null;
            const libraryEntryId = getLinkedLibraryEntryId(complex);
            if (!libraryEntryId) return null;
            const cacheKey = libraryEntryId;
            const detailPanel = document.querySelector(`[data-detail-for="${escapeAttributeSelectorValue(complexId)}"]`);
            const detailBody = detailPanel?.querySelector("[data-linked-detail-body]");
            if (detailBody) {
              detailBody.innerHTML = `<p class="text-sm text-text-secondary">${wt('complexes.loading_detail', 'Загружаем состав комплекса…')}</p>`;
            }
            try {
              let detail = linkedComplexDetailCache.get(cacheKey) || null;
              if (!detail) {
                const resp = await fetch(`/api/complex-library/${encodeURIComponent(libraryEntryId)}`, {
                  credentials: "same-origin",
                });
                detail = await resp.json();
                if (!resp.ok || !detail?.ok) {
                  throw new Error(detail?.error || `complex_library_detail_failed:${resp.status}`);
                }
                linkedComplexDetailCache.set(cacheKey, detail);
              }
              if (detailBody) {
                detailBody.innerHTML = buildLinkedComplexDetailBody(detail);
              }
              const snapshotComplex = detail?.snapshot?.complex && typeof detail.snapshot.complex === "object"
                ? detail.snapshot.complex
                : null;
              const embeddedTheoryItems = extractLinkedEmbeddedTheoryItemsFromSnapshot(detail?.snapshot);
              if (embeddedTheoryItems.length) {
                complex.linked_embedded_theories = embeddedTheoryItems;
                if (!complex.theory_link && embeddedTheoryItems.length === 1) {
                  complex.theory_link = {
                    theory_id: embeddedTheoryItems[0].theoryId,
                    relation: "link",
                    title_cache: embeddedTheoryItems[0].title || "",
                    updated_at: embeddedTheoryItems[0].updated_at || "",
                  };
                }
                complex.has_theory = true;
                if (!complex.theory_sync_meta || typeof complex.theory_sync_meta !== "object") {
                  complex.theory_sync_meta = {};
                }
                if (!Array.isArray(complex.theory_sync_meta.theory_ids) || !complex.theory_sync_meta.theory_ids.length) {
                  complex.theory_sync_meta.theory_ids = embeddedTheoryItems.map((item) => item.theoryId);
                }
              }
              const resolvedTasks = Array.isArray(snapshotComplex?.tasks) ? snapshotComplex.tasks.slice() : [];
              if (resolvedTasks.length) {
                complex.tasks = resolvedTasks;
                complex.task_count = resolvedTasks.length;
                const card = document.querySelector(`[data-complex-card-id="${escapeAttributeSelectorValue(complexId)}"]`);
                const inlineMeta = card?.querySelector(".cx-card-meta-stack .cx-card-inline-meta");
                if (inlineMeta) {
                  inlineMeta.innerHTML = `<span>${wt('complexes.tasks_count_label', 'Заданий')}: <strong>${resolvedTasks.length}</strong></span>`;
                }
                const taskEyebrows = detailPanel ? Array.from(detailPanel.querySelectorAll(".cx-detail-panel__eyebrow")) : [];
                const taskEyebrow = taskEyebrows.length ? taskEyebrows[taskEyebrows.length - 1] : null;
                if (taskEyebrow) {
                  taskEyebrow.textContent = `${wt('complexes.tasks_eyebrow', 'Задания')} (${resolvedTasks.length})`;
                }
                const detailStats = detailPanel?.querySelector(".cx-detail-panel__stats");
                if (detailStats) {
                  detailStats.innerHTML = `<span class="cx-detail-stat"><span>${wt('complexes.tasks_count_label', 'Заданий')}</span><strong>${resolvedTasks.length}</strong></span>`;
                }
              }
              return detail;
            } catch (error) {
              if (detailBody) {
                detailBody.innerHTML = `<p class="text-sm text-status-error">${wt('complexes.err_load_detail', 'Не удалось загрузить состав комплекса.')}</p>`;
              }
              showComplexVoiceToast({
                severity: "error",
                what: wt('complexes.linked_open_fail_what', 'Не удалось открыть linked-комплекс.'),
                impact: wt('complexes.linked_open_fail_impact', 'Карточка осталась в списке, но содержимое не загрузилось.'),
                next: String(error?.message || "").trim() || wt('complexes.retry_later', 'Повторите попытку позже.'),
              });
              return null;
            }
          }

          async function copyComplexAccessCode(value) {
            const code = String(value || "").trim().replace(/\s+/g, "").replace(/-/g, "").toUpperCase();
            if (!code) return;
            try {
              if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                await navigator.clipboard.writeText(code);
                showComplexVoiceToast({
                  severity: "success",
                  what: wt('complexes.code_copied_what', 'Код доступа скопирован.'),
                  impact: wt('complexes.code_copied_impact', 'Его можно отправить пользователю для добавления комплекса.'),
                  next: wt('complexes.code_copied_next', 'Никаких дополнительных действий не требуется.'),
                  timeout: 2600,
                });
                return;
              }
            } catch (error) {
              console.warn("[Complexes] Failed to copy access code", error);
            }
            showComplexVoiceToast({
              severity: "info",
              what: wt('complexes.code_ready_what', 'Код доступа готов.'),
              impact: `${wt('complexes.toast_code_label', 'Код')}: ${code}`,
              next: wt('complexes.code_ready_next', 'Скопируйте его вручную.'),
              timeout: 3600,
            });
          }

          async function openComplexPublicationDialog(complex = {}) {
            const complexId = normalizeComplexId(complex?.id);
            if (!complexId) {
              showComplexVoiceToast({
                severity: "error",
                what: wt('complexes.publish_mgmt_unavail', 'Управление публикацией недоступно.'),
                impact: wt('complexes.publish_mgmt_unavail_impact', 'Не удалось определить комплекс для этого действия.'),
                next: wt('complexes.publish_mgmt_unavail_next', 'Обновите страницу и повторите попытку.'),
              });
              return;
            }

            const publication = resolveComplexPublication(complex);
            const isPremiumArchivedSource = isComplexPremiumArchived(complex);
            if (isPremiumArchivedSource && !publication) {
              showComplexVoiceToast({
                severity: "warning",
                what: wt('complexes.publish_archive_unavail_what', 'Публикация недоступна для архива Premium.'),
                impact: wt('complexes.publish_archive_unavail_impact', 'Комплекс не удалён и остаётся доступным для просмотра, но опубликовать его можно после восстановления Premium.'),
                next: wt('complexes.publish_archive_unavail_next', 'Удалите лишние комплексы до лимита Free или продлите Premium.'),
              });
              return;
            }

            const currentVisibility = String(publication?.catalog_visibility || "public").trim().toLowerCase() || "public";
            const accessCode = getAccessCodeValue(publication);
            const complexName = escapeHtml(complex?.name || wt('complexes.untitled_complex', 'Без названия'));
            const archivePolicyText = isPremiumArchivedSource
              ? wt('complexes.archive_policy_premium', 'Источник комплекса находится в архиве Premium. Опубликованная версия остаётся доступной, но новую версию и расширение доступа можно сделать только после восстановления Premium. Сузить доступ или скрыть публикацию можно сейчас.')
              : wt('complexes.archive_policy_default', 'Здесь можно опубликовать комплекс и отдельно поменять режим доступа без перехода в редактор.');

            const modal = document.createElement("dialog");
            modal.id = "complex-publication-dialog";
            modal.style.cssText = [
              "border:none",
              "padding:0",
              "margin:auto",
              "width:calc(100vw - 2rem)",
              "max-width:48rem",
              "max-height:calc(100dvh - 2rem)",
              "background:transparent",
              "overflow:visible",
            ].join(";");
            modal.innerHTML = `
              <style>
                #complex-publication-dialog::backdrop {
                  background: rgba(0,0,0,0.72);
                  backdrop-filter: blur(16px) saturate(1.2);
                  -webkit-backdrop-filter: blur(16px) saturate(1.2);
                  opacity: 0;
                  transition: opacity 0.25s ease;
                }
                #complex-publication-dialog[data-open]::backdrop {
                  opacity: 1;
                }
              </style>
              <div class="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] border border-border-subtle bg-surface-1 shadow-xl">
                <div class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
                  <div class="space-y-1">
                    <p class="text-xs font-bold uppercase tracking-[0.16em] text-text-muted">${wt('complexes.publish_kicker', 'Публикация комплекса')}</p>
                    <h3 class="text-xl font-bold text-text-main">${complexName}</h3>
                    <p class="text-sm text-text-secondary">${escapeHtml(archivePolicyText)}</p>
                  </div>
                  <button type="button" class="btn-secondary h-10 px-4" data-role="close">${wt('complexes.btn_close', 'Закрыть')}</button>
                </div>
                <div class="custom-scrollbar space-y-5 overflow-y-auto p-5">
                  ${isPremiumArchivedSource ? `
                    <div class="rounded-2xl border border-warning-light bg-warning-light/40 px-4 py-3 text-sm text-warning-darker">
                      ${wt('complexes.premium_archive_source_warn', 'Источник в архиве Premium. Текущая публикация не снята с доступа автоматически; обновление версии и расширение доступа заблокированы до восстановления Premium.')}
                    </div>
                  ` : ""}
                  <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div class="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">${wt('complexes.publish_current_status_label', 'Текущий статус')}</div>
                        <div id="complex-publish-current-status" class="mt-1 text-base font-semibold text-text-main">${escapeHtml(publication ? getCatalogVisibilityLabel(publication.catalog_visibility) : wt('complexes.not_published', 'Не опубликован'))}</div>
                        <div id="complex-publish-current-meta" class="mt-1 text-sm text-text-secondary">${publication ? `${wt('complexes.last_published_prefix', 'Последняя публикация')}: ${escapeHtml(formatPublicationTimestamp(publication.latest_published_at))}` : wt('complexes.first_publish_hint', 'После первой публикации комплекс появится в каталоге или станет доступен по коду.')}</div>
                      </div>
                      <span id="complex-publish-current-badge" class="pill pill-sm ${publication ? getCatalogVisibilityToneClass(currentVisibility) : "pill-neutral"}">${escapeHtml(publication ? getCatalogVisibilityLabel(currentVisibility) : wt('complexes.not_published', 'Не опубликован'))}</span>
                    </div>
                  </div>

                  <div class="space-y-3">
                    <div>
                      <div class="text-sm font-semibold text-text-main">${wt('complexes.access_mode_label', 'Режим доступа')}</div>
                      <p class="mt-1 text-sm text-text-secondary">${isPremiumArchivedSource ? wt('complexes.access_mode_premium_desc', "Можно выбрать только текущий или более закрытый режим доступа. Расширение доступа вернётся после Premium.") : wt('complexes.access_mode_default_desc', "Если публикация уже существует, доступ можно поменять отдельно от публикации новой версии. Новые правки из редактора увидят другие пользователи только после публикации.")}</p>
                    </div>
                    <div class="grid gap-3 md:grid-cols-3">
                      ${["public", "access_code", "private"].map((visibility) => `
                        <label class="rounded-2xl border border-border-subtle bg-surface-1 p-4 hover:border-primary-light transition-colors ${isPremiumArchivedSource && isCatalogVisibilityExpansion(currentVisibility, visibility) ? "cursor-not-allowed opacity-60" : "cursor-pointer"}">
                          <div class="flex items-start gap-3">
                            <input type="radio" name="complex-publish-visibility" value="${visibility}" ${visibility === currentVisibility ? "checked" : ""} ${isPremiumArchivedSource && isCatalogVisibilityExpansion(currentVisibility, visibility) ? "disabled" : ""} class="mt-1 h-4 w-4 text-primary" />
                            <div class="space-y-1 min-w-0">
                              <div class="text-sm font-semibold text-text-main">${escapeHtml(getCatalogVisibilityLabel(visibility))}</div>
                              <div class="text-sm text-text-secondary">${escapeHtml(getCatalogVisibilityDescription(visibility))}</div>
                            </div>
                          </div>
                        </label>
                      `).join("")}
                    </div>
                  </div>

                  <div id="complex-publish-access-box" class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-4 ${accessCode ? "" : "hidden"}">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div class="text-xs font-bold uppercase tracking-[0.14em] text-text-muted">${wt('complexes.access_code_label', 'Код доступа')}</div>
                        <div id="complex-publish-access-code" class="mt-1 text-base font-semibold tracking-[0.12em] text-text-main">${escapeHtml(accessCode ? formatAccessCodeDisplay(accessCode) : wt('complexes.code_will_be_created', 'Код будет создан после публикации'))}</div>
                      </div>
                      <button type="button" class="btn-secondary h-10 px-4" data-role="copy-access-code">${wt('complexes.btn_copy_code', 'Скопировать код')}</button>
                    </div>
                  </div>

                  <div id="complex-publish-feedback" class="hidden rounded-2xl border px-4 py-3 text-sm"></div>
                </div>
                <div class="flex flex-wrap justify-end gap-3 border-t border-border-subtle px-5 py-4">
                  <button type="button" data-role="update-visibility" class="btn-secondary inline-flex items-center gap-2 px-4 py-2 text-sm ${publication ? "" : "hidden"}">
                    <span class="material-symbols-outlined text-[18px]">tune</span>
                    <span>${wt('complexes.btn_save_access', 'Сохранить доступ')}</span>
                  </button>
                  <button type="button" data-role="publish-version" class="btn-primary inline-flex items-center gap-2 px-4 py-2 text-sm">
                    <span class="material-symbols-outlined text-[18px]">publish</span>
                    <span>${publication ? wt('complexes.btn_publish_version', 'Опубликовать версию') : wt('complexes.btn_publish', 'Опубликовать')}</span>
                  </button>
                </div>
              </div>
            `;

            const close = () => {
              modal.removeAttribute("data-open");
              try {
                if (typeof modal.close === "function" && modal.open) {
                  modal.close();
                }
              } catch (_) {
                // noop
              }
              modal.remove();
            };
            const getSelectedVisibility = () => {
              const selected = modal.querySelector('input[name="complex-publish-visibility"]:checked');
              return String(selected?.value || currentVisibility || "public").trim().toLowerCase() || "public";
            };
            let modalBusy = false;
            const applyVisibilityControlState = (item = null) => {
              const currentItemVisibility = String(item?.catalog_visibility || currentVisibility || "public").trim().toLowerCase() || "public";
              modal.querySelectorAll('input[name="complex-publish-visibility"]').forEach((radio) => {
                const visibility = String(radio?.value || "").trim().toLowerCase();
                radio.disabled = modalBusy || (isPremiumArchivedSource && isCatalogVisibilityExpansion(currentItemVisibility, visibility));
              });
            };
            const setBusy = (busy) => {
              modalBusy = !!busy;
              modal.querySelectorAll("button, input[type='radio']").forEach((node) => {
                if (busy) {
                  node.setAttribute("disabled", "true");
                } else {
                  node.removeAttribute("disabled");
                }
              });
              applyVisibilityControlState(resolveComplexPublication(complex));
            };
            const setFeedback = (message = "", tone = "info") => {
              const box = modal.querySelector("#complex-publish-feedback");
              if (!box) return;
              if (!message) {
                box.className = "hidden rounded-2xl border px-4 py-3 text-sm";
                box.textContent = "";
                return;
              }
              const toneClass = tone === "error"
                ? "border-error-light bg-error-lighter text-error-text"
                : tone === "success"
                  ? "border-success-light bg-success-lighter text-success-text"
                  : "border-info-light bg-info-lighter text-info-text";
              box.className = `rounded-2xl border px-4 py-3 text-sm ${toneClass}`;
              box.textContent = message;
            };
            const syncModalState = (item) => {
              const currentItem = item && typeof item === "object" ? item : null;
              const selectedVisibility = getSelectedVisibility();
              const currentStatus = modal.querySelector("#complex-publish-current-status");
              const currentMeta = modal.querySelector("#complex-publish-current-meta");
              const currentBadge = modal.querySelector("#complex-publish-current-badge");
              const accessBox = modal.querySelector("#complex-publish-access-box");
              const accessCodeEl = modal.querySelector("#complex-publish-access-code");
              const updateBtn = modal.querySelector('[data-role="update-visibility"]');
              const publishBtn = modal.querySelector('[data-role="publish-version"]');

              applyVisibilityControlState(currentItem);
              if (currentStatus) {
                currentStatus.textContent = currentItem ? getCatalogVisibilityLabel(currentItem.catalog_visibility) : wt('complexes.not_published', 'Не опубликован');
              }
              if (currentMeta) {
                currentMeta.textContent = currentItem
                  ? `${wt('complexes.last_published_prefix', 'Последняя публикация')}: ${formatPublicationTimestamp(currentItem.latest_published_at)}`
                  : wt('complexes.first_publish_hint', 'После первой публикации комплекс появится в каталоге или станет доступен по коду.');
              }
              if (currentBadge) {
                currentBadge.className = `pill pill-sm ${currentItem ? getCatalogVisibilityToneClass(currentItem.catalog_visibility) : "pill-neutral"}`;
                currentBadge.textContent = currentItem ? getCatalogVisibilityLabel(currentItem.catalog_visibility) : wt('complexes.not_published', 'Не опубликован');
              }
              const activeCode = getAccessCodeValue(currentItem);
              const showAccess = selectedVisibility === "access_code";
              if (accessBox) accessBox.classList.toggle("hidden", !showAccess);
              if (accessCodeEl) {
                accessCodeEl.textContent = activeCode
                  ? formatAccessCodeDisplay(activeCode)
                  : (selectedVisibility === "access_code" ? wt('complexes.code_will_be_created', 'Код будет создан после публикации') : "");
              }
              if (updateBtn) {
                const currentItemVisibility = String(currentItem?.catalog_visibility || "").trim().toLowerCase();
                const blockedByArchive = isPremiumArchivedSource && isCatalogVisibilityExpansion(currentItemVisibility, selectedVisibility);
                const canUpdateVisibility = !!currentItem && selectedVisibility !== currentItemVisibility && !blockedByArchive;
                updateBtn.disabled = !canUpdateVisibility;
                updateBtn.classList.toggle("opacity-60", !canUpdateVisibility);
                updateBtn.title = blockedByArchive
                  ? wt('complexes.archive_expand_blocked', 'Расширение доступа для архива Premium недоступно до восстановления Premium.')
                  : "";
              }
              if (publishBtn) {
                publishBtn.disabled = modalBusy || isPremiumArchivedSource;
                publishBtn.classList.toggle("opacity-60", isPremiumArchivedSource);
                publishBtn.title = isPremiumArchivedSource
                  ? wt('complexes.archive_publish_blocked', 'Новая версия недоступна, пока источник находится в архиве Premium.')
                  : "";
              }
            };

            modal.querySelectorAll('[data-role="close"]').forEach((node) => {
              node.addEventListener("click", close);
            });
            modal.addEventListener("cancel", (event) => {
              event.preventDefault();
              close();
            });
            modal.addEventListener("close", () => {
              if (document.body.contains(modal)) {
                modal.remove();
              }
            });
            modal.addEventListener("click", (event) => {
              const rect = modal.getBoundingClientRect();
              const isOutside =
                event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom;
              if (isOutside) close();
            });
            modal.querySelectorAll('input[name="complex-publish-visibility"]').forEach((radio) => {
              radio.addEventListener("change", () => syncModalState(resolveComplexPublication(complex)));
            });
            modal.querySelector('[data-role="copy-access-code"]')?.addEventListener("click", async () => {
              await copyComplexAccessCode(modal.querySelector("#complex-publish-access-code")?.textContent);
            });
            modal.querySelector('[data-role="update-visibility"]')?.addEventListener("click", async () => {
              const currentItem = resolveComplexPublication(complex);
              if (!currentItem) return;
              const nextVisibility = getSelectedVisibility();
              if (nextVisibility === String(currentItem.catalog_visibility || "").trim().toLowerCase()) {
                setFeedback(wt('complexes.access_already_saved', 'Выбранный режим доступа уже сохранён.'), "info");
                return;
              }
              if (isPremiumArchivedSource && isCatalogVisibilityExpansion(currentItem.catalog_visibility, nextVisibility)) {
                setFeedback(wt('complexes.archive_access_restrict_only', 'Источник находится в архиве Premium: можно только сузить доступ или скрыть публикацию.'), "error");
                return;
              }
              setBusy(true);
              setFeedback("");
              try {
                const resp = await fetch(`/api/catalog/items/${encodeURIComponent(currentItem.item_id)}/visibility`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ catalog_visibility: nextVisibility }),
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || data?.ok === false) {
                  throw new Error(data?.error || `catalog_visibility_update_failed:${resp.status}`);
                }
                rebuildComplexPublicationIndex(
                  allComplexPublicationItems
                    .filter((item) => String(item?.item_id || "").trim() !== String(currentItem.item_id || "").trim())
                    .concat(data.item ? [data.item] : [])
                );
                syncModalState(data.item);
                setFeedback(`${wt('complexes.access_updated_prefix', 'Доступ обновлён')}: ${getCatalogVisibilityLabel(data.item?.catalog_visibility)}.`, "success");
                showComplexVoiceToast({
                  severity: "success",
                  what: wt('complexes.publish_status_updated', 'Статус публикации обновлён.'),
                  impact: `${wt('complexes.now_accessible_as', 'Теперь комплекс доступен как')} «${getCatalogVisibilityLabel(data.item?.catalog_visibility)}».`,
                  next: wt('complexes.card_already_updated', 'Карточка комплекса уже обновлена.'),
                  timeout: 2800,
                });
                await fetchComplexes();
              } catch (error) {
                console.error("[Complexes] Visibility update failed", error);
                setFeedback(`${wt('complexes.err_change_access', 'Не удалось изменить доступ')}: ${getPremiumArchivedPublicationErrorMessage(error)}`, "error");
              } finally {
                setBusy(false);
              }
            });
            modal.querySelector('[data-role="publish-version"]')?.addEventListener("click", async () => {
              if (isPremiumArchivedSource) {
                setFeedback(wt('complexes.archive_new_version_blocked', 'Новая версия недоступна, пока источник находится в архиве Premium. Сузить доступ можно кнопкой «Сохранить доступ».'), "error");
                return;
              }
              const selectedVisibility = getSelectedVisibility();
              setBusy(true);
              setFeedback("");
              try {
                const resp = await fetch(`/api/catalog/complexes/${encodeURIComponent(complexId)}/publish`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ catalog_visibility: selectedVisibility }),
                });
                const data = await resp.json().catch(() => ({}));
                if (!resp.ok || data?.ok === false) {
                  throw new Error(data?.error || `catalog_publish_failed:${resp.status}`);
                }
                rebuildComplexPublicationIndex(
                  allComplexPublicationItems
                    .filter((item) => String(item?.item_id || "").trim() !== String(data.item?.item_id || "").trim())
                    .concat(data.item ? [data.item] : [])
                );
                syncModalState(data.item);
                setFeedback(`${wt('complexes.publish_updated_prefix', 'Публикация обновлена. Режим доступа')}: ${getCatalogVisibilityLabel(data.item?.catalog_visibility)}.`, "success");
                showComplexVoiceToast({
                  severity: "success",
                  what: wt('complexes.complex_published', 'Комплекс опубликован.'),
                  impact: `${wt('complexes.current_access_mode', 'Текущий режим доступа')}: ${getCatalogVisibilityLabel(data.item?.catalog_visibility)}.`,
                  next: selectedVisibility === "access_code"
                    ? wt('complexes.copy_code_hint', 'Код доступа можно сразу скопировать из окна.')
                    : wt('complexes.card_already_updated', 'Карточка комплекса уже обновлена.'),
                  timeout: 3000,
                });
                await fetchComplexes();
              } catch (error) {
                console.error("[Complexes] Publish failed", error);
                setFeedback(`${wt('complexes.err_publish_complex', 'Не удалось опубликовать комплекс')}: ${getPremiumArchivedPublicationErrorMessage(error, "catalog_publish_failed")}`, "error");
              } finally {
                setBusy(false);
              }
            });

            document.body.appendChild(modal);
            if (typeof modal.showModal === "function") {
              modal.showModal();
              requestAnimationFrame(() => modal.setAttribute("data-open", "true"));
            } else {
              modal.setAttribute("open", "true");
              modal.setAttribute("data-open", "true");
            }
            syncModalState(publication);
          }

          function syncComplexSelectionUi() {
            const toggleBtn = document.getElementById("toggle-select-complexes");
            const actionBar = document.getElementById("complex-selection-action-bar");
            const counter = document.getElementById("complex-selection-counter");
            const exportBtn = document.getElementById("complex-export-selected");
            const shouldShowBar = selectionMode || selectedComplexes.size > 0;

            if (toggleBtn) {
              toggleBtn.classList.toggle("ring-2", selectionMode);
              toggleBtn.classList.toggle("ring-primary-light", selectionMode);
              toggleBtn.classList.toggle("border-primary-light", selectionMode);
            }

            if (actionBar) {
              actionBar.classList.toggle("hidden", !shouldShowBar);
              actionBar.classList.toggle("flex", shouldShowBar);
            }
            if (counter) {
              counter.textContent = `${selectedComplexes.size} ${wt('complexes.selected_count', 'выбрано')}`;
            }
            if (exportBtn) {
              exportBtn.disabled = selectedComplexes.size === 0;
            }

            const selectBoxes = document.querySelectorAll("[data-complex-select-box]");
            selectBoxes.forEach((el) => {
              el.classList.toggle("is-visible", selectionMode);
            });
          }

          function updateComplexCardSelectionState(complexId) {
            const normalizedId = normalizeComplexId(complexId);
            if (!normalizedId) return;
            const card = document.querySelector(`[data-complex-card-id="${normalizedId}"]`);
            if (!card) return;

            const shell = card.querySelector("[data-complex-card-shell]");
            const checkbox = card.querySelector("input.complex-select-checkbox");
            const isSelected = selectedComplexes.has(normalizedId);
            const theoryId = card.getAttribute("data-complex-theory-id") || "";
            const isTheoryFocused = !!(activeTheoryFilterId && theoryId === activeTheoryFilterId);

            if (shell) {
              shell.classList.toggle("border-primary", isSelected);
              shell.classList.toggle("ring-2", isSelected);
              shell.classList.toggle("ring-primary-lighter", isSelected);
              shell.classList.toggle("border-primary-light", !isSelected && isTheoryFocused);
              shell.classList.toggle("ring-1", !isSelected && isTheoryFocused);
              shell.classList.toggle("ring-primary-light", !isSelected && isTheoryFocused);
              shell.classList.toggle("border-border-subtle", !isSelected && !isTheoryFocused);
            }
            if (checkbox) {
              checkbox.checked = isSelected;
            }
          }

          function updateAllComplexCardSelectionStates() {
            const cards = document.querySelectorAll("[data-complex-card-id]");
            cards.forEach((card) => {
              const complexId = normalizeComplexId(card.getAttribute("data-complex-card-id"));
              updateComplexCardSelectionState(complexId);
            });
          }

          function setComplexSelectionMode(enabled) {
            selectionMode = !!enabled;
            if (!selectionMode) {
              selectedComplexes.clear();
            }
            updateAllComplexCardSelectionStates();
            syncComplexSelectionUi();
          }

          function toggleComplexSelectionMode() {
            setComplexSelectionMode(!selectionMode);
          }

          function cancelComplexSelection() {
            setComplexSelectionMode(false);
          }

          function handleComplexSelection(complexId, isSelected) {
            const normalizedId = normalizeComplexId(complexId);
            if (!normalizedId) return;
            const card = document.querySelector(`[data-complex-card-id="${escapeAttributeSelectorValue(normalizedId)}"]`);
            if (
              card?.getAttribute("data-complex-archived") === "true"
              || card?.getAttribute("data-complex-linked-access-state") === "deleted_source"
              || card?.getAttribute("data-complex-linked-access-state") === "revoked"
            ) {
              selectedComplexes.delete(normalizedId);
              updateComplexCardSelectionState(normalizedId);
              syncComplexSelectionUi();
              return;
            }

            if (!selectionMode) selectionMode = true;
            if (isSelected) {
              selectedComplexes.add(normalizedId);
            } else {
              selectedComplexes.delete(normalizedId);
            }
            updateComplexCardSelectionState(normalizedId);
            syncComplexSelectionUi();
          }

          function selectAllVisibleComplexes() {
            if (!selectionMode) {
              selectionMode = true;
            }
            const visibleCards = Array.from(
              document.querySelectorAll("[data-complex-card-id]:not([hidden])")
            );
            const visibleIds = visibleCards
              .filter((card) => (
                card.getAttribute("data-complex-archived") !== "true"
                && !["deleted_source", "revoked"].includes(card.getAttribute("data-complex-linked-access-state") || "")
              ))
              .map((card) => normalizeComplexId(card.getAttribute("data-complex-card-id")))
              .filter(Boolean);
            const targetIds = visibleIds.length
              ? visibleIds
              : renderedComplexIds.filter((complexId) => {
                  const card = document.querySelector(`[data-complex-card-id="${escapeAttributeSelectorValue(complexId)}"]`);
                  return (
                    card?.getAttribute("data-complex-archived") !== "true"
                    && !["deleted_source", "revoked"].includes(card?.getAttribute("data-complex-linked-access-state") || "")
                  );
                });
            targetIds.forEach((complexId) => {
              selectedComplexes.add(complexId);
            });
            updateAllComplexCardSelectionStates();
            syncComplexSelectionUi();
          }

          function getComplexArchiveFilename(response) {
            const disposition = response.headers.get("Content-Disposition") || "";
            const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
            if (utf8Match && utf8Match[1]) {
              try {
                return decodeURIComponent(utf8Match[1].replace(/"/g, ""));
              } catch (_) {
                return utf8Match[1].replace(/"/g, "");
              }
            }
            const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
            if (plainMatch && plainMatch[1]) {
              return plainMatch[1].trim();
            }
            const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
            return `export_complexes_${stamp}.zip`;
          }

          async function getComplexArchiveError(response) {
            const contentType = response.headers.get("Content-Type") || "";
            if (contentType.includes("application/json")) {
              const data = await response.json().catch(() => ({}));
              return data?.error || data?.message || `http_${response.status}`;
            }
            const text = await response.text().catch(() => "");
            return text.trim() || `http_${response.status}`;
          }

          function downloadComplexArchiveBlob(blob, filename) {
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filename || "export_complexes.zip";
            link.style.display = "none";
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }

          async function exportComplexArchive(complexIdsOrId) {
            const complexIds = Array.isArray(complexIdsOrId)
              ? complexIdsOrId
              : [complexIdsOrId];
            const normalizedIds = complexIds
              .map((value) => normalizeComplexId(value))
              .filter(Boolean);
            if (!normalizedIds.length) {
              throw new Error("complex_ids_required");
            }

            const response = await fetch("/api/complexes/export", {
              method: "POST",
              credentials: "same-origin",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                complex_ids: normalizedIds,
                include_tasks: true,
                include_theories: true,
              }),
            });

            if (!response.ok) {
              throw new Error(await getComplexArchiveError(response));
            }

            const blob = await response.blob();
            if (!blob || blob.size === 0) {
              throw new Error("empty_archive");
            }

            downloadComplexArchiveBlob(blob, getComplexArchiveFilename(response));
          }

          async function exportSelectedComplexes() {
            if (selectedComplexes.size === 0) return;
            const exportBtn = document.getElementById("complex-export-selected");
            const originalHtml = exportBtn ? exportBtn.innerHTML : "";
            if (exportBtn) {
              exportBtn.disabled = true;
              exportBtn.innerHTML = '<div class="h-5 w-5 animate-spin rounded-full border-2 border-primary-fg border-b-transparent"></div>';
            }
            try {
              await exportComplexArchive(Array.from(selectedComplexes));
              showComplexVoiceToast({
                severity: "success",
                what: wt('complexes.export_bulk_what', 'Экспорт комплексов готов.'),
                impact: `${wt('complexes.export_bulk_impact_prefix', 'Файл сформирован для')} ${selectedComplexes.size} ${wt('complexes.export_bulk_impact_suffix', 'комплексов.')}.`,
                next: wt('complexes.export_bulk_next', 'Архив можно использовать для импорта в другой профиль.'),
              });
            } catch (err) {
              console.error("Bulk complex export failed", err);
              showComplexVoiceToast({
                severity: "error",
                what: wt('complexes.export_bulk_fail_what', 'Экспорт комплексов не выполнен.'),
                impact: wt('complexes.export_bulk_fail_impact', 'Файл архива не был сформирован.'),
                next: err?.message ? `${wt('complexes.check_reason_prefix', 'Проверьте причину')} (${err.message}) ${wt('complexes.and_retry_export', 'и повторите экспорт.')}.` : wt('complexes.retry_export_later', 'Повторите экспорт позже.'),
              });
            } finally {
              if (exportBtn) {
                exportBtn.innerHTML = originalHtml;
                exportBtn.disabled = selectedComplexes.size === 0;
              }
            }
          }

          function renderComplexesSkeleton(listEl, count = 4) {
            const cards = Array.from({ length: count }, (_, index) => `
              <div class="p-4 @container">
                <div class="card-elevated rounded-lg p-4 animate-pulse" style="animation-delay:${index * 0.04}s">
                  <div class="h-6 w-1/3 rounded bg-bg-tertiary mb-2"></div>
                  <div class="h-4 w-2/3 rounded bg-bg-tertiary mb-4"></div>
                  <div class="h-4 w-1/2 rounded bg-bg-tertiary mb-6"></div>
                  <div class="flex gap-2">
                    <div class="h-10 w-24 rounded bg-bg-tertiary"></div>
                    <div class="h-10 w-24 rounded bg-bg-tertiary"></div>
                    <div class="h-10 w-24 rounded bg-bg-tertiary"></div>
                  </div>
                </div>
              </div>
            `);
            listEl.innerHTML = cards.join("");
          }

          function scheduleComplexesSkeleton(listEl) {
            if (complexesSkeletonTimer) {
              clearTimeout(complexesSkeletonTimer);
            }
            complexesSkeletonTimer = setTimeout(() => {
              if (!isComplexesLoading || hasLoadedComplexesOnce) return;
              renderComplexesSkeleton(listEl);
              complexesSkeletonTimer = null;
            }, loadingRevealDelayMs);
          }

          function clearComplexesSkeletonTimer() {
            if (!complexesSkeletonTimer) return;
            clearTimeout(complexesSkeletonTimer);
            complexesSkeletonTimer = null;
          }

          async function fetchComplexes() {
            const listEl = document.getElementById("complexes-list");
            const emptyEl = document.getElementById("empty-state");
            const errorEl = document.getElementById("error-state");
            const filterEmptyEl = document.getElementById("filtered-empty-state");
            if (!listEl) return;
            const isInitialLoad = !hasLoadedComplexesOnce;

            isComplexesLoading = true;
            const workspaceLimitsPromise = fetchComplexWorkspaceLimits();
            if (isInitialLoad) {
              scheduleComplexesSkeleton(listEl);
            }
            listEl.classList.remove("hidden");
            if (emptyEl) emptyEl.hidden = true;
            if (errorEl) errorEl.hidden = true;
            if (filterEmptyEl) filterEmptyEl.hidden = true;

            try {
              const userId = await resolveCurrentComplexesUserId();
              const [complexesResp, linkedLibraryItems, sessionsResp, quickAccessResp, catalogResp] = await Promise.all([
                fetch("/api/complexes"),
                fetchLinkedComplexLibraryItemsForList(),
                fetch(appendUserIdQuery("/api/sessions/active", userId)),
                fetch(appendUserIdQuery("/api/ui/quick-access", userId)),
                fetch("/api/editor/catalog"),
                workspaceLimitsPromise,
              ]);
              const data = await complexesResp.json();
              let sessions = [];
              let quickAccessData = null;
              try {
                const sessionsPayload = await sessionsResp.json();
                if (sessionsPayload && sessionsPayload.ok && Array.isArray(sessionsPayload.items)) {
                  sessions = sessionsPayload.items;
                }
              } catch (_) {
                sessions = [];
              }

              const taskNameCache = {};
              try {
                const catalogPayload = await catalogResp.json();
                if (catalogPayload && catalogPayload.ok && Array.isArray(catalogPayload.modules)) {
                  for (const mod of catalogPayload.modules) {
                    const modId = mod.id || "";
                    for (const topic of (mod.topics || [])) {
                      const topicId = topic.id || "";
                      for (const task of (topic.tasks || [])) {
                        const taskId = task.id || "";
                        if (modId && topicId && taskId && task.name) {
                          taskNameCache[`${modId}/${topicId}/${taskId}`] = task.name;
                        }
                      }
                    }
                  }
                }
              } catch (_) {}
              complexTaskNameCache = taskNameCache;

              try {
                const quickAccessPayload = await quickAccessResp.json();
                if (quickAccessPayload && quickAccessPayload.ok) quickAccessData = quickAccessPayload;
              } catch (_) {
                quickAccessData = null;
              }

              if (!data.ok) {
                listEl.innerHTML = "";
                setComplexSelectionMode(false);
                if (errorEl) errorEl.hidden = false;
                updateComplexFilterSummary(0, 0);
                return;
              }

              const workspaceItems = Array.isArray(data.items) ? data.items : [];
              const items = mergeWorkspaceAndLinkedComplexItems(workspaceItems, linkedLibraryItems);
              allComplexItems = items;
              pinnedComplexIds.clear();
              if (quickAccessData && Array.isArray(quickAccessData.pinned)) {
                quickAccessData.pinned.forEach((id) => {
                  const normalizedId = normalizeComplexId(id);
                  if (normalizedId) pinnedComplexIds.add(normalizedId);
                });
              }

              renderedComplexIds = items
                .map((complex) => normalizeComplexId(complex && complex.id))
                .filter(Boolean);
              const renderedIdSet = new Set(renderedComplexIds);
              for (const selectedId of Array.from(selectedComplexes)) {
                if (!renderedIdSet.has(selectedId)) {
                  selectedComplexes.delete(selectedId);
                }
              }

              const statusByComplexId = new Map();
              const reviewStateByComplexId = new Map();
              try {
                const healthResp = await fetch("/api/calendar/health");
                const healthData = await healthResp.json();
                const ok = healthData && (healthData.success || healthData.ok);
                if (ok && Array.isArray(healthData.complexes)) {
                  for (const item of healthData.complexes) {
                    if (!item) continue;
                    const id = normalizeComplexId(item.complex_id || item.id);
                    if (!id) continue;
                    statusByComplexId.set(id, item.status);
                    reviewStateByComplexId.set(id, !!item.is_critical);
                  }
                }
              } catch (_) {}

              const pausedMap = new Map();
              sessions.forEach((session) => {
                const complexId = normalizeComplexId(session && session.complex_id);
                if (!complexId) return;
                const existing = pausedMap.get(complexId);
                pausedMap.set(complexId, pickPreferredSession(existing, session));
              });
              if (quickAccessData && Array.isArray(quickAccessData.items)) {
                quickAccessData.items.forEach((item) => {
                  const complexId = normalizeComplexId(item?.complex?.id);
                  const pausedSession = item?.paused_session;
                  if (!complexId || !pausedSession) return;
                  const existing = pausedMap.get(complexId);
                  pausedMap.set(complexId, pickPreferredSession(existing, pausedSession));
                });
              }

              if (items.length === 0) {
                listEl.innerHTML = "";
                setComplexSelectionMode(false);
                if (emptyEl) emptyEl.hidden = false;
                updateComplexFilterSummary(0, 0);
                return;
              }

              listEl.innerHTML = "";
              const sortedItems = sortComplexItems(items, activeComplexSort);
              let renderIndex = 0;
              for (const complex of sortedItems) {
                const complexId = normalizeComplexId(complex.id);
                const isSelected = selectedComplexes.has(complexId);
                const card = document.createElement("article");
                card.className = "p-4 @container cx-card";
                card.style.animationDelay = `${renderIndex * 0.06}s`;
                card.setAttribute("data-complex-card-id", complexId);
                renderIndex += 1;

                const adaptiveOn = !!(complex.settings && complex.settings.adaptive_difficulty);
                const tasksList = Array.isArray(complex.tasks) ? complex.tasks : [];
                const tasksCount = resolveComplexTasksCount(complex);
                const pausedSession = pausedMap.get(complexId);
                const isPaused = !!(pausedSession && pausedSession.paused);
                const pausedAtLabel = formatPausedAt(pausedSession && (pausedSession.paused_at || pausedSession.updated_at || pausedSession.start_time));
                const pausedDisplayIndex = pausedSession && typeof pausedSession.display_task_index === "number"
                  ? pausedSession.display_task_index
                  : (pausedSession && typeof pausedSession.current_task_index === "number"
                    ? Math.max(0, pausedSession.current_task_index - 1)
                    : null);
                const pausedProgress = typeof pausedDisplayIndex === "number" ? pausedDisplayIndex + 1 : null;
                const pausedTotal = pausedSession && typeof pausedSession.total_tasks === "number" ? pausedSession.total_tasks : null;
                const pausedBadge = isPaused
                  ? `<span class="cx-card-badge pill pill-sm pill-warning"><span class="material-symbols-outlined text-sm">pause</span> ${wt('complexes.status_paused', 'На паузе')}</span>`
                  : "";
                const pausedPercent = (isPaused && pausedProgress && pausedTotal && pausedTotal > 0)
                  ? Math.round((pausedProgress / pausedTotal) * 100)
                  : 0;
                const pausedProgressInline = (isPaused && pausedProgress && pausedTotal)
                  ? `<span class="inline-flex items-center gap-2 whitespace-nowrap"><span>${wt('complexes.progress_label', 'Прогресс')} ${pausedProgress}/${pausedTotal}</span><span class="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-bg-secondary"><span class="block h-1.5 rounded-full bg-warning transition-all" style="width: ${pausedPercent}%"></span></span></span>`
                  : "";
                const pausedInfo = isPaused
                  ? `<div class="cx-card-inline-meta"><span>${pausedAtLabel ? `${wt('complexes.paused_at_label', 'Пауза')}: ${pausedAtLabel}` : wt('complexes.paused_attempt', 'Попытка на паузе')}</span>${pausedProgressInline}</div>`
                  : "";
                const calendarStatus = statusByComplexId.get(complexId) || "new";
                const isPinned = pinnedComplexIds.has(complexId);
                const needsReview = reviewStateByComplexId.get(complexId) === true;
                const statusBadge = isPaused
                  ? ""
                  : calendarStatus === "frozen"
                    ? `<span class="cx-card-badge pill pill-sm pill-neutral"><span class="material-symbols-outlined text-sm">ac_unit</span> ${wt('complexes.status_frozen', 'Заморожен')}</span>`
                    : calendarStatus === "in_progress"
                      ? `<span class="cx-card-badge pill pill-sm pill-success"><span class="material-symbols-outlined text-sm">play_arrow</span> ${wt('complexes.status_active', 'Активен')}</span>`
                      : calendarStatus === "mastered"
                        ? `<span class="cx-card-badge pill pill-sm pill-info"><span class="material-symbols-outlined text-sm">school</span> ${wt('complexes.status_mastered', 'Освоен')}</span>`
                        : `<span class="cx-card-badge pill pill-sm pill-neutral"><span class="material-symbols-outlined text-sm">check_box_outline_blank</span> ${wt('complexes.status_new', 'Не начат')}</span>`;

                const safeComplexId = escapeHtml(complexId);
                const safeComplexName = escapeHtml(complex.name || wt('complexes.no_name', 'Без названия'));
                const safeComplexDescription = escapeHtml(complex.description || wt('complexes.no_description', 'Нет описания'));
                const theoryLink = (complex && typeof complex.theory_link === "object") ? complex.theory_link : null;
                const theoryId = theoryLink && typeof theoryLink.theory_id === "string" ? theoryLink.theory_id : "";
                const safeTheoryId = escapeHtml(theoryId);
                const isTheoryFocused = !!(activeTheoryFilterId && theoryId === activeTheoryFilterId);
                const theoryContext = buildComplexTheoryBadges(complex);
                const hasTheoryContext = !!(complex.has_theory || theoryId || theoryContext.syncStatus === "composite");
                const ownershipContext = buildComplexOwnershipBadges(complex);
                const linkedAccessState = ownershipContext.isLinked ? getLinkedLibraryAccessState(complex) : "active";
                const isLinkedSourceDeleted = linkedAccessState === "deleted_source";
                const isLinkedUnavailable = linkedAccessState === "revoked" || isLinkedSourceDeleted;
                const isLinkedLocked = isLinkedUnavailable || linkedAccessState === "requires_access_code";
                const linkedStatusBadge = ownershipContext.isLinked && linkedAccessState !== "active"
                  ? isLinkedSourceDeleted
                    ? `<span class="cx-card-badge pill pill-sm pill-neutral" title="${wt('complexes.source_deleted_title_hint', 'Автор удалил исходный комплекс. Запуск больше недоступен.')}">
                        <span class="material-symbols-outlined text-sm">visibility_off</span> ${wt('complexes.badge_source_deleted', 'Источник удалён')}
                      </span>`
                    : linkedAccessState === "revoked"
                      ? `<span class="cx-card-badge pill pill-sm pill-neutral" title="${wt('complexes.access_revoked_title_hint', 'Автор закрыл доступ к публикации.')}">
                          <span class="material-symbols-outlined text-sm">lock</span> ${wt('complexes.badge_access_revoked', 'Доступ закрыт')}
                        </span>`
                      : `<span class="cx-card-badge pill pill-sm pill-info" title="${wt('complexes.code_required_title_hint', 'Для этой публикации нужен код доступа.')}">
                          <span class="material-symbols-outlined text-sm">password</span> ${wt('complexes.badge_needs_code', 'Нужен код')}
                        </span>`
                  : "";
                const archiveItem = resolveComplexArchiveItem(complex);
                const isPremiumArchived = !!archiveItem;
                const theoryModeBadge = theoryContext.modeBadge || "";
                const theoryStatusBadge = theoryContext.statusBadge || "";
                const ownerBadge = ownershipContext.ownerBadge || "";
                const sourceBadge = ownershipContext.sourceBadge || "";
                const premiumArchiveBadge = isPremiumArchived
                  ? `<span class="cx-card-badge pill pill-sm pill-warning" title="${wt('complexes.archive_badge_title', 'Комплекс доступен только для просмотра и удаления, пока превышен лимит Free')}">
                      <span class="material-symbols-outlined text-sm">inventory_2</span> ${wt('complexes.badge_archive_premium', 'Архив Premium')}
                    </span>`
                  : "";
                const premiumArchiveInfo = isPremiumArchived
                  ? `<div class="cx-card-inline-meta"><span>${wt('complexes.archive_info', 'Комплекс в архиве Premium: доступен просмотр и удаление. Запуск, редактирование и публикация заблокированы.')}</span></div>`
                  : "";
                const archivedDisabledAttr = isPremiumArchived
                  ? `disabled aria-disabled="true" data-premium-archived="true" title="${wt('complexes.premium_archive_disabled_hint', 'Недоступно для архива Premium')}"`
                  : "";
                const linkedUnavailableInfo = isLinkedSourceDeleted
                  ? `<div class="cx-card-inline-meta"><span>${wt('complexes.source_deleted_info', 'Автор удалил исходный комплекс. Он больше недоступен для прохождения; можно только убрать этот след из вашей библиотеки.')}</span></div>`
                  : linkedAccessState === "revoked"
                    ? `<div class="cx-card-inline-meta"><span>${wt('complexes.access_revoked_info', 'Автор закрыл доступ к публикации. Комплекс нельзя запустить; можно удалить его из вашей библиотеки.')}</span></div>`
                    : "";
                const linkedLockedDisabledAttr = isLinkedLocked
                  ? `disabled aria-disabled="true" data-linked-unavailable="true" title="${isLinkedSourceDeleted ? wt('complexes.badge_source_deleted', 'Источник удалён') : linkedAccessState === "revoked" ? wt('complexes.badge_access_revoked', 'Доступ закрыт') : wt('complexes.locked_needs_code', 'Нужен код доступа')}"`
                  : "";
                const blockedActionAttr = archivedDisabledAttr || linkedLockedDisabledAttr;
                const theoryActionLabel = theoryContext.mode === "inherit" ? wt('complexes.theory_inherit', 'Теория (наследование)') : wt('complexes.theory_mode', 'Теория');
                const theoryBadge = hasTheoryContext
                  ? `<span class="cx-card-badge pill pill-sm pill-info"><span class="material-symbols-outlined text-sm">menu_book</span> ${wt('complexes.badge_theory', 'Теория')}</span>`
                  : "";
                const compositeTheoryIds = !theoryId && theoryContext.syncStatus === "composite"
                  ? (Array.isArray(complex?.theory_sync_meta?.theory_ids) ? complex.theory_sync_meta.theory_ids.map(String).filter(Boolean) : [])
                  : [];
                const theoryButton = theoryId
                  ? `<button type="button" class="theory-btn cx-card-action-btn cx-card-action-btn--theory btn-secondary inline-flex items-center justify-center gap-1.5 text-sm font-medium border-primary-light bg-primary-lighter text-primary hover:border-primary hover:bg-primary-lighter hover:text-primary" title="${theoryActionLabel}" data-theory-id="${safeTheoryId}" data-complex-id="${safeComplexId}" data-complex-name="${safeComplexName}"><span class="material-symbols-outlined text-lg">menu_book</span><span class="truncate">${wt('complexes.btn_theory', 'Теория')}</span></button>`
                  : compositeTheoryIds.length > 0
                    ? `<button type="button" class="composite-theory-btn cx-card-action-btn cx-card-action-btn--theory btn-secondary inline-flex items-center justify-center gap-1.5 text-sm font-medium border-info-light bg-info-lighter text-info-text hover:border-info hover:bg-info-lighter hover:text-info" title="${wt('complexes.open_all_theories_title', 'Открыть все теории комплекса ({count})').replace('{count}', compositeTheoryIds.length)}" data-composite-ids="${escapeHtml(compositeTheoryIds.join(","))}" data-complex-id="${safeComplexId}" data-complex-name="${safeComplexName}"><span class="material-symbols-outlined text-lg">layers</span><span class="truncate">${wt('complexes.btn_theories_n', 'Теории ({n})').replace('{n}', compositeTheoryIds.length)}</span></button>`
                    : "";

                const searchSource = [complex.name || "", complex.description || "", ...tasksList.map((task) => typeof task === "string" ? task : (task.task_ref || task.task_id || ""))].join(" ");
                const detailRows = buildComplexTaskRows(tasksList);
                const detailContent = isLinkedSourceDeleted
                  ? `<div class="panel-row panel-row--soft px-3 py-3 text-sm text-text-secondary">${wt('complexes.source_deleted_detail', 'Автор удалил исходный комплекс. Содержимое больше не выдаётся для прохождения; удалите эту карточку, чтобы убрать её из библиотеки.')}</div>`
                  : linkedAccessState === "revoked"
                    ? `<div class="panel-row panel-row--soft px-3 py-3 text-sm text-text-secondary">${wt('complexes.access_revoked_detail', 'Автор закрыл доступ к публикации. Содержимое недоступно, но запись оставлена как поясняющий след в вашей библиотеке.')}</div>`
                    : tasksCount > 0
                      ? `<div class="cx-detail-list">${detailRows}</div>`
                      : `<p class="text-sm text-text-secondary">${wt('complexes.no_tasks', 'Нет заданий')}</p>`;
                const safePausedSessionId = isPaused ? escapeHtml(pausedSession.session_id || "") : "";
                const safeResumeUrl = isPaused ? escapeHtml(pausedSession?.resume_target?.url || "") : "";
                const pinBtnClass = isPinned
                  ? "pin-btn cx-card-action-btn--icon border-primary-light bg-primary-lighter text-primary"
                  : "pin-btn cx-card-action-btn--icon";

                card.setAttribute("aria-labelledby", `cx-title-${safeComplexId}`);
                card.setAttribute("data-complex-search", normalizeComplexSearch(searchSource));
                card.setAttribute("data-complex-status", calendarStatus);
                card.setAttribute("data-complex-paused", isPaused ? "true" : "false");
                card.setAttribute("data-complex-pinned", isPinned ? "true" : "false");
                card.setAttribute("data-complex-critical", needsReview ? "true" : "false");
                card.setAttribute("data-complex-theory-id", theoryId || "");
                card.setAttribute("data-complex-owned", ownershipContext.ownership.isOwnedByCurrentUser ? "true" : "false");
                card.setAttribute("data-complex-imported", ownershipContext.ownership.createdVia === "archive_import" ? "true" : "false");
                card.setAttribute("data-complex-linked", ownershipContext.isLinked ? "true" : "false");
                card.setAttribute("data-complex-linked-access-state", linkedAccessState);
                card.setAttribute("data-complex-archived", isPremiumArchived ? "true" : "false");
                card.innerHTML = `
            <div data-complex-card-shell class="cx-card-shell card-elevated relative flex flex-col items-stretch justify-start rounded-lg border ${isSelected ? "border-primary ring-2 ring-primary-lighter" : (isTheoryFocused ? "border-primary-light ring-1 ring-primary-light" : "border-border-subtle")} ${isPremiumArchived ? "cx-card-shell--premium-archived" : ""} ${isLinkedUnavailable ? "cx-card-shell--linked-unavailable" : ""} cx-card-inner">
              <div data-complex-select-box class="cx-card-select-box absolute right-3 top-3 z-10 ${selectionMode ? "is-visible" : ""}">
                <input type="checkbox" class="complex-select-checkbox h-5 w-5 rounded border-border-strong text-primary focus:ring-primary" data-complex-id="${safeComplexId}" ${isSelected ? "checked" : ""} ${isPremiumArchived || isLinkedUnavailable ? "disabled" : ""} aria-label="${wt('complexes.select_complex_aria', 'Выбрать комплекс')}">
              </div>
              <div class="cx-card-body flex w-full min-w-0 grow flex-col items-stretch justify-center gap-3 p-4">
                <div class="cx-card-top">
                  <div class="cx-card-heading">
                    <div class="cx-card-title-row">
                      <h2 id="cx-title-${safeComplexId}" class="cx-card-title text-text-main text-lg font-bold leading-tight tracking-[-0.015em]" title="${safeComplexName}">${safeComplexName}</h2>
                    </div>
                    <div class="cx-card-badges">${premiumArchiveBadge}${linkedStatusBadge}${pausedBadge}${statusBadge}${theoryBadge}${theoryModeBadge}${theoryStatusBadge}${ownerBadge}${sourceBadge}</div>
                  </div>
                  <p class="cx-card-description text-[15px] font-normal">${safeComplexDescription}</p>
                  <div class="cx-card-meta-stack">${premiumArchiveInfo}${linkedUnavailableInfo}${pausedInfo}<p class="cx-card-inline-meta"><span>${wt('complexes.total_tasks', 'Всего заданий')}: <strong>${tasksCount}</strong></span><span class="cx-meta-divider">•</span><span>${wt('complexes.adaptive_label', 'Адаптивность')}: <strong>${adaptiveOn ? wt('complexes.on', 'Вкл') : wt('complexes.off', 'Выкл')}</strong></span></p></div>
                </div>
                <div class="cx-card-actions">
                  <div class="cx-card-actions-primary">
                    <button type="button" class="start-btn cx-btn cx-card-action-btn cx-card-action-btn--primary btn-primary inline-flex items-center justify-center text-sm font-bold" data-complex-id="${safeComplexId}" ${isPaused ? `data-session-id="${safePausedSessionId}" data-resume-url="${safeResumeUrl}"` : ""} ${blockedActionAttr} aria-label="${isPaused ? wt('complexes.btn_continue', 'Продолжить') : wt('complexes.btn_start', 'Запустить')}">
                      <span class="material-symbols-outlined text-lg">play_arrow</span>
                      <span class="truncate">${isPaused ? wt('complexes.btn_continue', 'Продолжить') : wt('complexes.btn_start', 'Запустить')}</span>
                    </button>
                    ${isPaused ? `
                      <button type="button" class="restart-session-btn cx-card-action-btn cx-card-action-btn--session btn-secondary inline-flex items-center justify-center gap-1.5 text-sm font-medium border-warning-light bg-warning-lighter text-warning-text hover:border-warning hover:bg-warning-lighter hover:text-warning" data-complex-id="${safeComplexId}" data-session-id="${safePausedSessionId}" ${blockedActionAttr} title="${wt('complexes.btn_restart_title', 'Сбросить текущую попытку и начать заново')}">
                        <span class="material-symbols-outlined text-lg">restart_alt</span>
                        <span class="truncate">${wt('complexes.btn_restart', 'Заново')}</span>
                      </button>
                    ` : ""}
                    ${theoryButton}
                    <button type="button" class="detail-toggle-btn cx-card-action-btn cx-card-action-btn--toggle btn-secondary inline-flex items-center justify-center gap-1 text-sm font-medium" data-complex-id="${safeComplexId}" aria-expanded="false" aria-controls="cx-detail-${safeComplexId}" title="${wt('complexes.btn_details', 'Показать задания комплекса')}">
                      <span class="truncate">${wt('complexes.btn_details', 'Подробнее')}</span>
                      <span class="material-symbols-outlined text-lg cx-toggle-chevron">expand_more</span>
                    </button>
                  </div>
                  <div class="cx-card-actions-secondary">
                    <button type="button" class="${pinBtnClass}" data-complex-id="${safeComplexId}" title="${isPinned ? wt('complexes.pin_already', 'Уже в быстром доступе') : wt('complexes.pin_title', 'Закрепить в быстром доступе')}" aria-label="${isPinned ? wt('complexes.pin_already', 'Уже в быстром доступе') : wt('complexes.pin_title', 'Закрепить в быстром доступе')}">
                      <span class="material-symbols-outlined text-lg">push_pin</span>
                    </button>
                    <div class="cx-card-menu-wrapper relative">
                      <button type="button" class="cx-card-menu-btn cx-card-action-btn--icon" data-complex-id="${safeComplexId}" aria-haspopup="menu" aria-expanded="false" title="${wt('complexes.more_actions', 'Другие действия')}" aria-label="${wt('complexes.more_actions', 'Другие действия')}">
                        <span class="material-symbols-outlined text-lg">more_vert</span>
                      </button>
                      <div class="cx-card-menu-dropdown" role="menu" hidden>
                        ${ownershipContext.ownership.isOwnedByCurrentUser ? `
                          <button type="button" role="menuitem" class="edit-btn cx-card-menu-item" data-complex-id="${safeComplexId}" ${blockedActionAttr}>
                            <span class="material-symbols-outlined">edit</span>
                            <span class="truncate">${wt('complexes.btn_edit', 'Редактировать')}</span>
                          </button>
                        ` : ""}
                        <button type="button" role="menuitem" class="export-btn cx-card-menu-item" data-complex-id="${safeComplexId}" ${blockedActionAttr}>
                          <span class="material-symbols-outlined">download</span>
                          <span class="truncate">${wt('complexes.btn_export', 'Экспорт')}</span>
                        </button>
                        ${isPaused ? `
                          <button type="button" role="menuitem" class="delete-session-btn cx-card-menu-item" data-complex-id="${safeComplexId}" data-session-id="${safePausedSessionId}">
                            <span class="material-symbols-outlined">delete_sweep</span>
                            <span class="truncate">${wt('complexes.btn_delete_session', 'Удалить сессию')}</span>
                          </button>
                        ` : ""}
                        <div class="cx-card-menu-divider" role="separator"></div>
                        <button type="button" role="menuitem" class="delete-btn cx-card-menu-item cx-card-menu-item--danger" data-complex-id="${safeComplexId}" title="${wt('complexes.btn_delete_title', 'Удалить комплекс')}">
                          <span class="material-symbols-outlined">delete</span>
                          <span class="truncate">${wt('complexes.btn_delete', 'Удалить')}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div id="cx-detail-${safeComplexId}" class="detail-panel border-t border-border-subtle" data-detail-for="${safeComplexId}">
                <div class="cx-detail-panel__inner">
                  <div class="cx-detail-panel__head">
                    <div class="cx-detail-panel__title-wrap">
                      <p class="cx-detail-panel__eyebrow">${wt('complexes.detail_eyebrow', 'Комплекс')}</p>
                      <h3 class="cx-detail-panel__title">${safeComplexName}</h3>
                      ${complex.description ? `<p class="cx-detail-panel__copy">${safeComplexDescription}</p>` : ""}
                    </div>
                    <div class="cx-detail-panel__stats"><span class="cx-detail-stat"><span>${wt('complexes.tasks_count_label', 'Заданий')}</span><strong>${tasksCount}</strong></span></div>
                  </div>
                  <div><p class="cx-detail-panel__eyebrow">${wt('complexes.tasks_eyebrow', 'Задания')} (${tasksCount})</p>${detailContent}</div>
                </div>
              </div>
            </div>`;
                listEl.appendChild(card);
              }

              attachActionHandlers();
              updateSortUi();
            } catch (err) {
              console.error("Failed to load complexes", err);
              listEl.innerHTML = "";
              setComplexSelectionMode(false);
              if (errorEl) errorEl.hidden = false;
            } finally {
              isComplexesLoading = false;
              clearComplexesSkeletonTimer();
              hasLoadedComplexesOnce = true;
              if (isInitialLoad) {
                window.PageBoot?.ready();
              }
            }
          }

          function attachActionHandlers() {
            const selectCheckboxes = document.querySelectorAll("input.complex-select-checkbox[data-complex-id]");
            selectCheckboxes.forEach((checkbox) => {
              checkbox.addEventListener("click", (event) => {
                event.stopPropagation();
                const complexId = checkbox.getAttribute("data-complex-id");
                handleComplexSelection(complexId, checkbox.checked);
              });
            });

            const selectableCards = document.querySelectorAll("[data-complex-card-id]");
            selectableCards.forEach((card) => {
              card.addEventListener("click", (event) => {
                if (!selectionMode) return;
                if (event.target.closest("button, a, input, label, [role='button']")) return;
                const complexId = card.getAttribute("data-complex-card-id");
                const checkbox = card.querySelector("input.complex-select-checkbox");
                const nextChecked = checkbox ? !checkbox.checked : !selectedComplexes.has(normalizeComplexId(complexId));
                handleComplexSelection(complexId, nextChecked);
              });
            });

            const markRecent = async (complexId) => {
              if (!complexId) return;
              try {
                const userId = await resolveCurrentComplexesUserId();
                await fetch("/api/ui/quick-access/recent", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(withUserIdPayload({ complex_id: complexId }, userId)),
                });
              } catch (_) {}
            };

            const resumePausedSession = async (complexId, sessionId, preferredResumeUrl = "") => {
              const userId = await resolveCurrentComplexesUserId();
              const resp = await fetch(`/api/session/${encodeURIComponent(sessionId)}/resume`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(withUserIdPayload({ source: "complexes_list" }, userId)),
              });
              const data = await resp.json().catch(() => ({}));
              if (!resp.ok || !data.ok) {
                showComplexVoiceToast({
                  severity: "error",
                  what: wt('complexes.resume_fail_what', 'Сессию не удалось возобновить.'),
                  impact: wt('complexes.resume_fail_impact', 'Переход в тренажёр отменён.'),
                  next: data?.error ? `${wt('complexes.check_reason_prefix', 'Проверьте причину')} (${data.error}) ${wt('complexes.and_retry', 'и повторите.')}.` : wt('complexes.retry_later', 'Повторите попытку чуть позже.'),
                });
                return false;
              }
              await markRecent(complexId);
              const resumeUrl =
                (typeof preferredResumeUrl === "string" && preferredResumeUrl) ||
                (typeof data?.resume_target?.url === "string" && data.resume_target.url) ||
                `/session/${encodeURIComponent(sessionId)}`;
              window.navigateWithTransition(resumeUrl);
              return true;
            };

            const deletePausedSession = async (sessionId) => {
              const userId = await resolveCurrentComplexesUserId();
              const resp = await fetch(`/api/session/${encodeURIComponent(sessionId)}/cancel`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(withUserIdPayload({}, userId)),
              });
              const data = await resp.json().catch(() => ({}));
              if (!resp.ok || !data.ok) {
                showComplexVoiceToast({
                  severity: "error",
                  what: wt('complexes.delete_session_fail_what', 'Сохранённую сессию не удалось удалить.'),
                  impact: wt('complexes.delete_session_fail_impact', 'Состояние комплекса на паузе пока сохранено.'),
                  next: data?.error ? `${wt('complexes.check_reason_prefix', 'Проверьте причину')} (${data.error}) ${wt('complexes.and_retry', 'и повторите.')}.` : wt('complexes.retry_later_short', 'Повторите чуть позже.'),
                });
                return false;
              }
              return true;
            };

            const startOrRestartSession = async (complexId, { force = false } = {}) => {
              const userId = await resolveCurrentComplexesUserId();
              const resp = await fetch(`/api/session/${complexId}/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(withUserIdPayload(force ? { force: true } : {}, userId)),
              });
              const data = await resp.json().catch(() => ({}));

              if (resp.status === 409 && data.error === "paused_session_exists" && data.session_id) {
                const resume = await NotificationUI.confirm({
                  title: wt('complexes.paused_session_found_title', 'Найдена сессия на паузе'),
                  message: wt('complexes.paused_session_found_msg', 'Для этого комплекса уже есть сессия на паузе.\nПродолжить её или начать заново?'),
                  confirmText: wt('complexes.btn_continue', 'Продолжить'),
                  cancelText: wt('complexes.btn_restart', 'Начать заново'),
                  variant: "primary",
                });
                if (resume) {
                  return resumePausedSession(complexId, data.session_id, "");
                }
                return startOrRestartSession(complexId, { force: true });
              }

              if (!data.ok || !data.session_id) {
                console.error(force ? "Failed to restart session" : "Failed to start session", data);
                showComplexVoiceToast({
                  severity: "error",
                  what: wt('complexes.session_not_started', 'Сессия не запущена.'),
                  impact: force ? wt('complexes.old_attempt_not_reset', 'Старая попытка не была сброшена.') : wt('complexes.new_run_not_created', 'Новый прогон комплекса не создан.'),
                  next: data?.error ? `${wt('complexes.check_reason_prefix', 'Проверьте причину')} (${data.error}) ${wt('complexes.and_retry', 'и повторите.')}.` : wt('complexes.retry_start_later', 'Повторите запуск позже.'),
                });
                return false;
              }

              await markRecent(complexId);
              window.navigateWithTransition(`/session/${data.session_id}`);
              return true;
            };

            const startButtons = document.querySelectorAll("button.start-btn[data-complex-id]");
            startButtons.forEach((btn) => {
              btn.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const complexId = btn.getAttribute("data-complex-id");
                const sessionId = btn.getAttribute("data-session-id");
                const preferredResumeUrl = btn.getAttribute("data-resume-url") || "";
                if (!complexId) return;
                btn.setAttribute("disabled", "true");
                try {
                  if (sessionId) {
                    const resumed = await resumePausedSession(complexId, sessionId, preferredResumeUrl);
                    if (!resumed) btn.removeAttribute("disabled");
                  } else {
                    const started = await startOrRestartSession(complexId);
                    if (!started) btn.removeAttribute("disabled");
                  }
                } catch (err) {
                  console.error("Error starting session", err);
                  showComplexVoiceToast({
                    severity: "error",
                    what: wt('complexes.session_network_fail_what', 'Сессия не запущена из-за сетевой ошибки.'),
                    impact: wt('complexes.session_network_fail_impact', 'Переход к комплексу отменён.'),
                    next: wt('complexes.check_network_retry_start', 'Проверьте сеть и повторите запуск.'),
                  });
                  btn.removeAttribute("disabled");
                }
              });
            });

            const restartSessionButtons = document.querySelectorAll("button.restart-session-btn[data-complex-id]");
            restartSessionButtons.forEach((btn) => {
              btn.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                const complexId = btn.getAttribute("data-complex-id");
                if (!complexId) return;
                btn.setAttribute("disabled", "true");
                try {
                  const restarted = await startOrRestartSession(complexId, { force: true });
                  if (!restarted) btn.removeAttribute("disabled");
                } catch (err) {
                  console.error("Error restarting session", err);
                  showComplexVoiceToast({
                    severity: "error",
                    what: wt('complexes.restart_fail_what', 'Сессию не удалось перезапустить.'),
                    impact: wt('complexes.restart_fail_impact', 'Старая попытка пока остаётся на паузе.'),
                    next: wt('complexes.check_network_retry', 'Проверьте сеть и повторите попытку.'),
                  });
                  btn.removeAttribute("disabled");
                }
              });
            });

            const closeAllCardMenus = () => {
              document.querySelectorAll(".cx-card-menu-dropdown:not([hidden])").forEach((dropdown) => {
                dropdown.hidden = true;
                const toggle = dropdown.closest(".cx-card-menu-wrapper")?.querySelector(".cx-card-menu-btn");
                if (toggle) toggle.setAttribute("aria-expanded", "false");
              });
            };

            const menuButtons = document.querySelectorAll("button.cx-card-menu-btn");
            menuButtons.forEach((btn) => {
              btn.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                const wrapper = btn.closest(".cx-card-menu-wrapper");
                const dropdown = wrapper?.querySelector(".cx-card-menu-dropdown");
                if (!dropdown) return;
                const wasOpen = !dropdown.hidden;
                closeAllCardMenus();
                if (!wasOpen) {
                  dropdown.hidden = false;
                  btn.setAttribute("aria-expanded", "true");
                }
              });
            });

            if (!window._cxCardMenuGlobalListenersAttached) {
              document.addEventListener("click", (event) => {
                if (!event.target.closest(".cx-card-menu-wrapper")) {
                  closeAllCardMenus();
                }
              });
              document.addEventListener("keydown", (event) => {
                if (event.key === "Escape") {
                  closeAllCardMenus();
                }
              });
              window._cxCardMenuGlobalListenersAttached = true;
            }

            const deleteSessionButtons = document.querySelectorAll("button.delete-session-btn[data-session-id]");
            deleteSessionButtons.forEach((btn) => {
              btn.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                closeAllCardMenus();
                const sessionId = btn.getAttribute("data-session-id");
                if (!sessionId) return;
                const deleteConfirmed = await NotificationUI.confirm({
                  title: wt('complexes.delete_session_confirm_title', 'Удалить сохранённую сессию?'),
                  message: wt('complexes.delete_session_confirm_msg', 'Состояние комплекса на паузе будет удалено. Сам комплекс останется в списке.'),
                  confirmText: wt('complexes.btn_delete_session', 'Удалить сессию'),
                  cancelText: wt('complexes.btn_cancel', 'Отмена'),
                  variant: "error",
                });
                if (!deleteConfirmed) return;
                btn.setAttribute("disabled", "true");
                try {
                  const deleted = await deletePausedSession(sessionId);
                  if (!deleted) {
                    btn.removeAttribute("disabled");
                    return;
                  }
                  showComplexVoiceToast({
                    severity: "success",
                    what: wt('complexes.session_deleted_what', 'Сохранённая сессия удалена.'),
                    impact: wt('complexes.session_deleted_impact', 'Комплекс остаётся в каталоге без паузы.'),
                    next: wt('complexes.session_deleted_next', 'Его можно сразу запустить заново.'),
                  });
                  fetchComplexes();
                } catch (err) {
                  console.error("Error deleting paused session", err);
                  showComplexVoiceToast({
                    severity: "error",
                    what: wt('complexes.session_delete_net_fail_what', 'Сохранённая сессия не удалена из-за сетевой ошибки.'),
                    impact: wt('complexes.session_delete_net_fail_impact', 'Пауза для комплекса сохранена.'),
                    next: wt('complexes.check_network_retry', 'Проверьте сеть и повторите попытку.'),
                  });
                  btn.removeAttribute("disabled");
                }
              });
            });

            const exportButtons = document.querySelectorAll("button.export-btn[data-complex-id]");
            exportButtons.forEach((btn) => {
              btn.addEventListener("click", async () => {
                closeAllCardMenus();
                const complexId = btn.getAttribute("data-complex-id");
                if (!complexId) return;
                btn.setAttribute("disabled", "true");
                try {
                  await exportComplexArchive(complexId);
                  showComplexVoiceToast({
                    severity: "success",
                    what: wt('complexes.export_what', 'Экспорт комплекса готов.'),
                    impact: wt('complexes.export_impact', 'Архив сформирован и скачан.'),
                    next: wt('complexes.export_next', 'Файл можно импортировать в другой профиль.'),
                  });
                } catch (err) {
                  console.error("Complex export failed", err);
                  showComplexVoiceToast({
                    severity: "error",
                    what: wt('complexes.export_fail_what', 'Экспорт комплекса не выполнен.'),
                    impact: wt('complexes.export_fail_impact', 'Архив не был сформирован.'),
                    next: err?.message ? `${wt('complexes.check_reason_prefix', 'Проверьте причину')} (${err.message}) ${wt('complexes.and_retry_export', 'и повторите экспорт.')}.` : wt('complexes.retry_export_later', 'Повторите экспорт позже.'),
                  });
                } finally {
                  btn.removeAttribute("disabled");
                }
              });
            });

            const editButtons = document.querySelectorAll("button.edit-btn[data-complex-id]");
            editButtons.forEach((btn) => {
              btn.addEventListener("click", () => {
                closeAllCardMenus();
                const complexId = btn.getAttribute("data-complex-id");
                if (complexId) {
                  window.navigateWithTransition(`/complexes/create?id=${complexId}`);
                }
              });
            });

            const deleteButtons = document.querySelectorAll("button.delete-btn[data-complex-id]");
            deleteButtons.forEach((btn) => {
              btn.addEventListener("click", async () => {
                closeAllCardMenus();
                const complexId = btn.getAttribute("data-complex-id");
                if (!complexId) return;
                const delConfirmed = await NotificationUI.confirm({
                  title: wt('complexes.delete_complex_confirm_title', 'Удалить комплекс?'),
                  message: wt('complexes.delete_complex_confirm_msg', 'Это действие нельзя отменить.'),
                  confirmText: wt('complexes.btn_delete', 'Удалить'),
                  cancelText: wt('complexes.btn_cancel', 'Отмена'),
                  variant: "error",
                });
                if (!delConfirmed) return;
                btn.setAttribute("disabled", "true");
                try {
                  const resp = await fetch(`/api/complexes/${complexId}`, {
                    method: "DELETE",
                  });
                  const data = await resp.json().catch(() => ({}));
                  if (!data.ok) {
                    showComplexVoiceToast({
                      severity: "error",
                      what: wt('complexes.delete_complex_fail_what', 'Комплекс не удалён.'),
                      impact: wt('complexes.delete_complex_fail_impact', 'Каталог остался без изменений.'),
                      next: data?.error ? `${wt('complexes.check_reason_prefix', 'Проверьте причину')} (${data.error}) ${wt('complexes.and_retry', 'и повторите.')}.` : wt('complexes.retry_delete_later', 'Повторите удаление позже.'),
                    });
                    btn.removeAttribute("disabled");
                    return;
                  }
                  fetchComplexes();
                } catch (err) {
                  console.error("Error deleting complex", err);
                  showComplexVoiceToast({
                    severity: "error",
                    what: wt('complexes.delete_complex_net_fail_what', 'Комплекс не удалён из-за сетевой ошибки.'),
                    impact: wt('complexes.delete_complex_net_fail_impact', 'Текущая карточка сохранена.'),
                    next: wt('complexes.check_network_retry_delete', 'Проверьте сеть и повторите удаление.'),
                  });
                  btn.removeAttribute("disabled");
                }
              });
            });

            const pinButtons = document.querySelectorAll("button.pin-btn[data-complex-id]");
            pinButtons.forEach((btn) => {
              btn.addEventListener("click", async () => {
                const complexId = btn.getAttribute("data-complex-id");
                if (!complexId) return;
                btn.setAttribute("disabled", "true");
                try {
                  const userId = await resolveCurrentComplexesUserId();
                  const resp = await fetch("/api/ui/quick-access/pin", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(withUserIdPayload({ complex_id: complexId }, userId)),
                  });
                  const data = await resp.json().catch(() => ({}));
                  if (data.ok) {
                    pinnedComplexIds.add(complexId);
                    const card = btn.closest("[data-complex-card-id]");
                    if (card) {
                      card.setAttribute("data-complex-pinned", "true");
                    }
                    btn.classList.add("border-primary-light", "bg-primary-lighter", "text-primary");
                    btn.setAttribute("title", wt('complexes.pin_already', 'Уже в быстром доступе'));
                    btn.setAttribute("aria-label", wt('complexes.pin_already', 'Уже в быстром доступе'));
                    applyComplexFilters();
                    showComplexVoiceToast({
                      severity: "success",
                      what: wt('complexes.pin_success_what', 'Комплекс закреплён в быстром доступе.'),
                      impact: wt('complexes.pin_success_impact', 'Он появится в быстрых переходах на главном экране.'),
                      next: wt('complexes.pin_success_next', 'Продолжайте работу с комплексом как обычно.'),
                    });
                  } else {
                    showComplexVoiceToast({
                      severity: "error",
                      what: wt('complexes.pin_fail_what', 'Закрепление не выполнено.'),
                      impact: wt('complexes.pin_fail_impact', 'Комплекс не добавлен в быстрый доступ.'),
                      next: data?.error ? `${wt('complexes.check_reason_prefix', 'Проверьте причину')} (${data.error}) ${wt('complexes.and_retry', 'и повторите.')}.` : wt('complexes.retry_later', 'Повторите попытку позже.'),
                    });
                  }
                } catch (err) {
                  console.error("Error pinning complex", err);
                  showComplexVoiceToast({
                    severity: "error",
                    what: wt('complexes.pin_net_fail_what', 'Закрепление недоступно из-за сетевой ошибки.'),
                    impact: wt('complexes.pin_net_fail_impact', 'Список быстрого доступа не изменился.'),
                    next: wt('complexes.check_network_retry_action', 'Проверьте сеть и повторите действие.'),
                  });
                } finally {
                  btn.removeAttribute("disabled");
                }
              });
            });

            const detailButtons = document.querySelectorAll("button.detail-toggle-btn[data-complex-id]");
            detailButtons.forEach((btn) => {
              btn.addEventListener("click", (event) => {
                event.preventDefault();
                const complexId = btn.getAttribute("data-complex-id");
                const panel = document.querySelector(`[data-detail-for="${escapeAttributeSelectorValue(complexId)}"]`);
                if (!panel) return;
                const isExpanded = panel.classList.contains("expanded");
                panel.classList.toggle("expanded", !isExpanded);
                btn.setAttribute("aria-expanded", String(!isExpanded));
                const label = btn.querySelector(".truncate");
                if (label) label.textContent = !isExpanded ? wt('complexes.btn_collapse', 'Свернуть') : wt('complexes.btn_details', 'Подробнее');
                const chevron = btn.querySelector(".cx-toggle-chevron");
                if (chevron) chevron.classList.toggle("is-expanded", !isExpanded);
              });
            });

            const theoryButtons = document.querySelectorAll("button.theory-btn[data-theory-id]");
            theoryButtons.forEach((btn) => {
              btn.addEventListener("click", async () => {
                const theoryId = btn.getAttribute("data-theory-id");
                const complexName = btn.getAttribute("data-complex-name") || "";
                const complexId = btn.getAttribute("data-complex-id") || "";
                await openComplexTheoryViewer(complexName, theoryId, { complexId });
              });
            });

            const compositeTheoryButtons = document.querySelectorAll("button.composite-theory-btn[data-complex-id]");
            compositeTheoryButtons.forEach((btn) => {
              btn.addEventListener("click", async () => {
                const complexId = btn.getAttribute("data-complex-id") || "";
                const complexName = btn.getAttribute("data-complex-name") || "";
                const theoryIds = (btn.getAttribute("data-composite-ids") || "")
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean);
                await openComplexTheoryViewer(complexName, theoryIds, { complexId });
              });
            });

            syncComplexSelectionUi();
            applyComplexFilters();
          }

          function ensureComplexOwnershipControls() {
            // Logic moved to HTML for stability and uniform grid layout
          }

          function getComplexFilterLabel(filterId) {
            switch (filterId) {
              case "mine":
                return wt('complexes.flabel_mine', 'авторские');
              case "imported":
                return wt('complexes.flabel_imported', 'из каталога');
              case "active":
                return wt('complexes.flabel_active', 'в работе');
              case "paused":
                return wt('complexes.flabel_paused', 'на паузе');
              case "pinned":
                return wt('complexes.flabel_pinned', 'закреплённые');
              case "frozen":
                return wt('complexes.flabel_frozen', 'замороженные');
              case "review":
                return wt('complexes.flabel_review', 'нужно повторить');
              case "archived":
                return wt('complexes.flabel_archived', 'архив Premium');
              default:
                return wt('complexes.flabel_all', 'все комплексы библиотеки');
            }
          }

          function updateComplexFilterSummary(total, visible) {
            const summaryEl = document.getElementById("complex-filter-summary");
            if (!summaryEl) return;
            const activeFilterParts = [];
            if (activeComplexFilter !== "all") {
              activeFilterParts.push(getComplexFilterLabel(activeComplexFilter));
            }
            if (activeTheoryFilterId) {
              activeFilterParts.push(`${wt('complexes.theory_filter_prefix', 'теория')} «${resolveTheoryFilterLabel(activeTheoryFilterId)}»`);
            }
            const activeLabel = activeFilterParts.length ? activeFilterParts.join(" + ") : wt('complexes.flabel_all', 'все комплексы библиотеки');
            
            const badgeContainer = summaryEl.closest(".cx-controls-summary-badge") || summaryEl.parentElement;
            if (!total) {
              summaryEl.textContent = wt('complexes.summary_empty', 'Пусто');
              if (badgeContainer) badgeContainer.setAttribute("title", wt('complexes.summary_empty_title', 'В библиотеке пока нет комплексов'));
              return;
            }
            if (visible === total && !activeComplexSearch && activeComplexFilter === "all" && !activeTheoryFilterId) {
              summaryEl.textContent = `${wt('complexes.filter_all', 'Все')}: ${total}`;
              if (badgeContainer) badgeContainer.setAttribute("title", `${wt('complexes.summary_all', 'Показаны все комплексы библиотеки')}: ${total}`);
              return;
            }
            if (!visible) {
              summaryEl.textContent = `0 из ${total}`;
              if (badgeContainer) badgeContainer.setAttribute("title", `${wt('complexes.summary_no_match', 'Нет совпадений')}: ${activeLabel}`);
              return;
            }
            summaryEl.textContent = `${visible} из ${total}`;
            if (badgeContainer) badgeContainer.setAttribute("title", `${wt('complexes.summary_shown', 'Показано')} ${visible} ${wt('complexes.summary_of', 'из')} ${total} (${activeLabel})`);
          }

          function updateComplexFilterUi() {
            const chips = document.querySelectorAll(".complex-filter-chip[data-filter]");
            chips.forEach((chip) => {
              const isActive = chip.getAttribute("data-filter") === activeComplexFilter;
              chip.classList.toggle("pill-info", isActive);
              chip.classList.toggle("pill-neutral", !isActive);
              chip.classList.toggle("shadow-sm", isActive);
              chip.setAttribute("aria-selected", isActive ? "true" : "false");
              if (chip.getAttribute("data-filter") === "imported") chip.textContent = wt('complexes.filter_imported', 'Из каталога');
            });
          }

          function applyComplexFilters() {
            const listEl = document.getElementById("complexes-list");
            const filterEmptyEl = document.getElementById("filtered-empty-state");
            if (!listEl) return;
            const cards = Array.from(listEl.querySelectorAll("[data-complex-card-id]"));
            if (!cards.length) {
              listEl.classList.remove("hidden");
              if (filterEmptyEl) filterEmptyEl.hidden = true;
              updateComplexFilterSummary(0, 0);
              return;
            }

            const normalizedQuery = normalizeComplexSearch(activeComplexSearch);
            let visibleCount = 0;

            cards.forEach((card) => {
              const searchText = card.getAttribute("data-complex-search") || "";
              const matchesQuery = !normalizedQuery || searchText.includes(normalizedQuery);
              const status = card.getAttribute("data-complex-status") || "new";
              const isPaused = card.getAttribute("data-complex-paused") === "true";
              const isPinned = card.getAttribute("data-complex-pinned") === "true";
              const needsReview = card.getAttribute("data-complex-critical") === "true";
              const isOwnedByCurrentUser = card.getAttribute("data-complex-owned") === "true";
              const isImported = card.getAttribute("data-complex-imported") === "true";
              const isLinked = card.getAttribute("data-complex-linked") === "true";
              const isArchived = card.getAttribute("data-complex-archived") === "true";
              const theoryId = card.getAttribute("data-complex-theory-id") || "";

              let matchesFilter = true;
              if (activeComplexFilter === "mine") {
                matchesFilter = isOwnedByCurrentUser && !isImported;
              } else if (activeComplexFilter === "imported") {
                matchesFilter = isImported || isLinked;
              } else if (activeComplexFilter === "active") {
                matchesFilter = status === "in_progress" || isPaused;
              } else if (activeComplexFilter === "paused") {
                matchesFilter = isPaused;
              } else if (activeComplexFilter === "pinned") {
                matchesFilter = isPinned;
              } else if (activeComplexFilter === "frozen") {
                matchesFilter = status === "frozen";
              } else if (activeComplexFilter === "review") {
                matchesFilter = needsReview;
              } else if (activeComplexFilter === "archived") {
                matchesFilter = isArchived;
              }

              const matchesTheory = !activeTheoryFilterId || theoryId === activeTheoryFilterId;

              const shouldShow = matchesQuery && matchesFilter && matchesTheory;
              card.hidden = !shouldShow;
              if (shouldShow) visibleCount += 1;
            });

            listEl.classList.toggle("hidden", visibleCount === 0);
            if (filterEmptyEl) {
              filterEmptyEl.hidden = visibleCount !== 0;
            }
            updateComplexFilterSummary(cards.length, visibleCount);
          }

          function rerenderComplexList(items) {
            const listEl = document.getElementById("complexes-list");
            if (!listEl) return;
            // Re-sort already rendered cards in DOM by reordering children
            const sortedItems = sortComplexItems(items, activeComplexSort);
            const sortedIds = sortedItems.map((c) => normalizeComplexId(c.id));
            sortedIds.forEach((id) => {
              const card = listEl.querySelector(`[data-complex-card-id="${CSS.escape(id)}"]`);
              if (card) listEl.appendChild(card);
            });
            applyComplexFilters();
          }

          function bindComplexFilters() {
            ensureComplexOwnershipControls();
            const searchInput = document.getElementById("complex-search-input");
            const searchClearBtn = document.getElementById("complex-search-clear");

            const syncSearchClearVisibility = () => {
              if (searchClearBtn) {
                searchClearBtn.hidden = !searchInput?.value;
              }
            };

            if (searchInput) {
              searchInput.addEventListener("input", () => {
                activeComplexSearch = searchInput.value || "";
                syncSearchClearVisibility();
                applyComplexFilters();
              });

              searchInput.addEventListener("keydown", (e) => {
                if (e.key === "Escape") {
                  if (searchInput.value) {
                    searchInput.value = "";
                    activeComplexSearch = "";
                    syncSearchClearVisibility();
                    applyComplexFilters();
                  }
                  searchInput.blur();
                }
              });
            }

            if (searchClearBtn && searchInput) {
              searchClearBtn.addEventListener("click", () => {
                searchInput.value = "";
                activeComplexSearch = "";
                syncSearchClearVisibility();
                applyComplexFilters();
                searchInput.focus();
              });
            }

            if (!window._cxSearchGlobalShortcutAttached) {
              document.addEventListener("keydown", (e) => {
                if (e.defaultPrevented) return;
                const activeTag = document.activeElement?.tagName?.toLowerCase();
                const isEditable = activeTag === "input" || activeTag === "textarea" || document.activeElement?.isContentEditable;

                if ((e.key === "/" && !isEditable) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
                  e.preventDefault();
                  if (searchInput) {
                    searchInput.focus();
                    searchInput.select();
                  }
                }
              });
              window._cxSearchGlobalShortcutAttached = true;
            }

            const chips = document.querySelectorAll(".complex-filter-chip[data-filter]");
            chips.forEach((chip) => {
              chip.addEventListener("click", () => {
                activeComplexFilter = chip.getAttribute("data-filter") || "all";
                updateComplexFilterUi();
                applyComplexFilters();
              });
            });
            const deleteButtons = document.querySelectorAll("button.delete-btn[data-complex-id]");
            deleteButtons.forEach((btn) => {
              btn.addEventListener("click", async () => {
                const complexId = btn.getAttribute("data-complex-id");
                if (!complexId) return;
                const complex = getComplexById(complexId);
                const isLinkedLibrary = isLinkedLibraryComplex(complex);
                const linkedLibraryEntryId = isLinkedLibrary ? getLinkedLibraryEntryId(complex) : "";
                if (isLinkedLibrary && !linkedLibraryEntryId) return;
                const delConfirmed = await NotificationUI.confirm({
                  title: isLinkedLibrary ? wt('complexes.delete_from_library_title', 'Удалить комплекс из библиотеки?') : wt('complexes.delete_complex_confirm_title', 'Удалить комплекс?'),
                  message: isLinkedLibrary
                    ? wt('complexes.delete_from_library_msg', 'Комплекс исчезнет из вашего списка, но прошлые результаты останутся в статистике.')
                    : wt('complexes.delete_complex_confirm_msg', 'Это действие нельзя отменить.'),
                  confirmText: wt('complexes.btn_delete', 'Удалить'),
                  cancelText: wt('complexes.btn_cancel', 'Отмена'),
                  variant: 'error'
                });
                if (!delConfirmed) return;
                btn.setAttribute("disabled", "true");
                try {
                  const resp = isLinkedLibrary
                    ? await fetch(`/api/complex-library/${encodeURIComponent(linkedLibraryEntryId)}`, {
                        method: "DELETE",
                        credentials: "same-origin",
                      })
                    : await fetch(`/api/complexes/${complexId}`, {
                        method: "DELETE",
                      });
                  const data = await resp.json();
                  if (!data.ok) {
                    showComplexVoiceToast({
                      severity: "error",
                      what: isLinkedLibrary ? wt('complexes.delete_lib_fail_what', 'Комплекс не удалён из библиотеки.') : wt('complexes.delete_complex_fail_what', 'Комплекс не удалён.'),
                      impact: isLinkedLibrary ? wt('complexes.delete_lib_fail_impact', 'Карточка осталась в вашем списке.') : wt('complexes.delete_complex_fail_impact', 'Каталог остался без изменений.'),
                      next: data?.error ? `${wt('complexes.check_reason_prefix', 'Проверьте причину')} (${data.error}) ${wt('complexes.and_retry', 'и повторите.')}.` : wt('complexes.retry_delete_later', 'Повторите удаление позже.'),
                    });
                    btn.removeAttribute("disabled");
                    return;
                  }
                  if (isLinkedLibrary) {
                    showComplexVoiceToast({
                      severity: "success",
                      what: wt('complexes.delete_lib_success_what', 'Комплекс удалён из библиотеки.'),
                      impact: wt('complexes.delete_lib_success_impact', 'Он больше не отображается в разделе комплексов.'),
                      next: wt('complexes.delete_lib_success_next', 'При необходимости его можно снова добавить из каталога.'),
                    });
                  }
                  // Refresh list
                  fetchComplexes();
                } catch (err) {
                  console.error("Error deleting complex", err);
                  showComplexVoiceToast({
                    severity: "error",
                    what: isLinkedLibrary ? wt('complexes.delete_lib_net_fail_what', 'Комплекс не удалён из библиотеки из-за сетевой ошибки.') : wt('complexes.delete_complex_net_fail_what', 'Комплекс не удалён из-за сетевой ошибки.'),
                    impact: wt('complexes.delete_complex_net_fail_impact', 'Текущая карточка сохранена.'),
                    next: wt('complexes.check_network_retry_delete', 'Проверьте сеть и повторите удаление.'),
                  });
                  btn.removeAttribute("disabled");
                }
              });
            });
            // Pin to quick access
            const pinButtons = document.querySelectorAll("button.pin-btn[data-complex-id]");
            pinButtons.forEach((btn) => {
              btn.addEventListener("click", async () => {
                const complexId = btn.getAttribute("data-complex-id");
                if (!complexId) return;
                btn.setAttribute("disabled", "true");
                try {
                  const userId = await resolveCurrentComplexesUserId();
                  const resp = await fetch("/api/ui/quick-access/pin", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(withUserIdPayload({ complex_id: complexId }, userId)),
                  });
                  const data = await resp.json();
                  if (data.ok) {
                    pinnedComplexIds.add(complexId);
                    const card = btn.closest("[data-complex-card-id]");
                    if (card) {
                      card.setAttribute("data-complex-pinned", "true");
                    }
                    btn.classList.remove("bg-transparent", "text-text-secondary", "hover:bg-bg-tertiary");
                    btn.classList.add("bg-primary-lighter", "text-primary");
                    btn.setAttribute("title", wt('complexes.pin_already', 'Уже в быстром доступе'));
                    applyComplexFilters();
                    showComplexVoiceToast({
                      severity: "success",
                      what: wt('complexes.pin_success_what', 'Комплекс закреплён в быстром доступе.'),
                      impact: wt('complexes.pin_success_impact', 'Он появится в быстрых переходах на главном экране.'),
                      next: wt('complexes.pin_success_next', 'Продолжайте работу с комплексом как обычно.'),
                    });
                  } else {
                    showComplexVoiceToast({
                      severity: "error",
                      what: wt('complexes.pin_fail_what', 'Закрепление не выполнено.'),
                      impact: wt('complexes.pin_fail_impact', 'Комплекс не добавлен в быстрый доступ.'),
                      next: data?.error ? `${wt('complexes.check_reason_prefix', 'Проверьте причину')} (${data.error}) ${wt('complexes.and_retry', 'и повторите.')}.` : wt('complexes.retry_later', 'Повторите попытку позже.'),
                    });
                  }
                } catch (err) {
                  showComplexVoiceToast({
                    severity: "error",
                    what: wt('complexes.pin_net_fail_what', 'Закрепление недоступно из-за сетевой ошибки.'),
                    impact: wt('complexes.pin_net_fail_impact', 'Список быстрого доступа не изменился.'),
                    next: wt('complexes.check_network_retry_action', 'Проверьте сеть и повторите действие.'),
                  });
                } finally {
                  btn.removeAttribute("disabled");
                }
              });
            });
            // Detail toggle
            const detailButtons = document.querySelectorAll("button.detail-toggle-btn[data-complex-id]");
            detailButtons.forEach((btn) => {
              btn.addEventListener("click", async () => {
                const complexId = btn.getAttribute("data-complex-id");
                const linkedActionKey = btn.getAttribute("data-linked-action-key") || "";
                if (linkedActionKey === "enter-access-code") {
                  const complex = getComplexById(complexId);
                  const accessCode = await openLinkedComplexAccessDialog(complex);
                  if (!accessCode) return;
                  const libraryEntryId = getLinkedLibraryEntryId(complex);
                  if (!libraryEntryId) return;
                  try {
                    const resp = await fetch(`/api/complex-library/${encodeURIComponent(libraryEntryId)}/access-code`, {
                      method: "POST",
                      credentials: "same-origin",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ access_code: accessCode }),
                    });
                    const data = await resp.json();
                    if (!resp.ok || !data?.ok) {
                      throw new Error(data?.error || `complex_library_access_code_failed:${resp.status}`);
                    }
                    pendingLinkedComplexRevealId = complexId;
                    linkedComplexDetailCache.set(libraryEntryId, data);
                    await fetchComplexes();
                    return;
                  } catch (error) {
                    showComplexVoiceToast({
                      severity: "error",
                      what: wt('complexes.access_code_rejected_what', 'Код доступа не принят.'),
                      impact: wt('complexes.access_code_rejected_impact', 'Linked-комплекс пока остаётся закрытым.'),
                      next: String(error?.message || "").trim() || wt('complexes.access_code_rejected_next', 'Проверьте код и повторите попытку.'),
                    });
                    return;
                  }
                }
                const selectorValue = escapeAttributeSelectorValue(complexId);
                const panel = document.querySelector(`[data-detail-for="${selectorValue}"]`);
                if (!panel) return;
                const complex = getComplexById(complexId);
                const isExpanded = panel.classList.contains("expanded");
                panel.classList.toggle("expanded", !isExpanded);
                const icon = btn.querySelector(".material-symbols-outlined");
                if (icon) icon.textContent = !isExpanded ? "expand_less" : "expand_more";
                const collapsedLabel = btn.getAttribute("data-collapsed-label") || wt('complexes.btn_details', 'Подробнее');
                const expandedLabel = btn.getAttribute("data-expanded-label") || wt('complexes.btn_collapse', 'Свернуть');
                const label = btn.querySelector(".truncate");
                queueMicrotask(async () => {
                  if (label) label.textContent = !isExpanded ? expandedLabel : collapsedLabel;
                  if (
                    !isExpanded
                    && (
                      linkedActionKey === "open-linked"
                      || (isLinkedLibraryComplex(complex) && getLinkedLibraryAccessState(complex) === "active")
                    )
                  ) {
                    await ensureLinkedComplexDetailLoaded(complexId);
                  }
                });
                if (label) label.textContent = !isExpanded ? wt('complexes.btn_collapse', 'Свернуть') : wt('complexes.btn_details', 'Подробнее');
                applyLinkedDetailButtonState(btn, !isExpanded);
              });
            });

            const theoryButtons = document.querySelectorAll("button.theory-btn[data-theory-id], button.theory-btn[data-library-entry-id]");
            theoryButtons.forEach((btn) => {
              btn.addEventListener("click", async () => {
                try {
                  const theoryId = btn.getAttribute("data-theory-id");
                  const libraryEntryId = btn.getAttribute("data-library-entry-id");
                  const complexName = btn.getAttribute("data-complex-name") || "";
                  const complexId = btn.getAttribute("data-complex-id") || "";
                  const complex = getComplexById(complexId);
                  if (libraryEntryId) {
                    const embeddedTheoryItem = await fetchLinkedTheoryEmbeddedItem(libraryEntryId);
                    await openTheoryModal(complexName, embeddedTheoryItem?.theoryId || "", {
                      embeddedTheoryItem,
                      readOnly: true,
                      hideComplexesButton: true,
                    });
                    return;
                  }
                  await openComplexTheoryViewer(complexName, theoryId, {
                    complexId,
                    embeddedTheoryItems: getComplexEmbeddedTheoryItems(complex),
                    readOnly: isLinkedLibraryComplex(complex),
                  });
                } catch (error) {
                  console.error("Failed to open complex theory", error);
                  showComplexVoiceToast({
                    severity: "error",
                    what: wt('complexes.theory_not_opened_what', 'Теория не открыта.'),
                    impact: wt('complexes.theory_not_opened_impact', 'Просмотр теории для комплекса сейчас недоступен.'),
                    next: wt('complexes.theory_not_opened_next', 'Проверьте доступность связанной теории и повторите попытку.'),
                  });
                }
              });
            });

          function openTheorySyncConfirmDialog(complexId) {
            return new Promise((resolve) => {
              const stale = document.getElementById("theory-sync-confirm-dialog");
              if (stale) stale.remove();

              const dialog = document.createElement("dialog");
              dialog.id = "theory-sync-confirm-dialog";
              dialog.style.cssText = [
                "border:none", "padding:0", "margin:auto",
                "width:calc(100vw - 2rem)", "max-width:28rem",
                "border-radius:1rem",
                "background:var(--color-surface-1,#fff)",
                "border:1px solid var(--color-border-subtle,#e2e8f0)",
                "box-shadow:0 20px 48px -8px rgba(0,0,0,0.35)",
                "transform:scale(0.95) translateY(8px)",
                "opacity:0",
                "transition:transform 0.25s cubic-bezier(0.16,1,0.3,1),opacity 0.2s ease",
                "overflow:hidden",
              ].join(";");

              dialog.innerHTML = `
                <style>
                  #theory-sync-confirm-dialog::backdrop {
                    background: rgba(0,0,0,0.45);
                    backdrop-filter: blur(6px) saturate(0.8);
                    -webkit-backdrop-filter: blur(6px) saturate(0.8);
                    opacity: 0;
                    transition: opacity 0.2s ease;
                  }
                  #theory-sync-confirm-dialog[data-open]::backdrop { opacity: 1; }
                </style>

                <!-- Header -->
                <div style="display:flex;align-items:flex-start;gap:0.875rem;padding:1.25rem 1.375rem 0;">
                  <div style="flex-shrink:0;width:2.25rem;height:2.25rem;border-radius:0.625rem;background:var(--color-primary-lighter,#eef2ff);display:flex;align-items:center;justify-content:center;">
                    <span class="material-symbols-outlined" style="font-size:18px;color:var(--color-primary,#6366f1);">sync</span>
                  </div>
                  <div style="min-width:0;flex:1;padding-top:0.125rem;">
                    <p style="margin:0 0 0.25rem;font-size:0.9375rem;font-weight:800;color:var(--color-text-main,#0f172a);letter-spacing:-0.01em;">${wt('complexes.theory_rebuild_title', 'Пересобрать теорию комплекса из тем?')}</p>
                    <p style="margin:0;font-size:0.8rem;color:var(--color-text-secondary,#64748b);line-height:1.5;">${wt('complexes.theory_rebuild_body', 'Комплекс в режиме <strong style=\"color:var(--color-text-main,#0f172a);font-weight:600;\">наследования</strong> собирает теорию из тем, связанных с его заданиями. Эта команда заново перечитает эти связи и обновит наследуемую теорию комплекса.')}</p>
                  </div>
                </div>

                <!-- Explanation -->
                <div style="margin:0.875rem 1.375rem;border-radius:0.625rem;background:var(--color-bg-tertiary,#f1f5f9);padding:0.75rem 0.875rem;display:flex;flex-direction:column;gap:0.5rem;">
                  <div style="display:flex;align-items:flex-start;gap:0.5rem;">
                    <span class="material-symbols-outlined" style="font-size:15px;color:var(--color-primary,#6366f1);margin-top:1px;flex-shrink:0;">account_tree</span>
                    <p style="margin:0;font-size:0.7875rem;color:var(--color-text-secondary,#64748b);line-height:1.5;">${wt('complexes.rebuild_hint_1', 'Это полезно, если комплекс был импортирован, давно не обновлялся или связи теорий в темах менялись вне обычного сценария редактирования.')}</p>
                  </div>
                  <div style="display:flex;align-items:flex-start;gap:0.5rem;">
                    <span class="material-symbols-outlined" style="font-size:15px;color:var(--color-primary,#6366f1);margin-top:1px;flex-shrink:0;">refresh</span>
                    <p style="margin:0;font-size:0.7875rem;color:var(--color-text-secondary,#64748b);line-height:1.5;">${wt('complexes.rebuild_hint_2', 'Если всё уже актуально, ничего лишнего не произойдёт: система просто подтвердит, что пересборка не понадобилась.')}</p>
                  </div>
                  <div style="display:flex;align-items:flex-start;gap:0.5rem;">
                    <span class="material-symbols-outlined" style="font-size:15px;color:var(--color-text-muted,#94a3b8);margin-top:1px;flex-shrink:0;">shield</span>
                    <p style="margin:0;font-size:0.7875rem;color:var(--color-text-secondary,#64748b);line-height:1.5;">${wt('complexes.rebuild_hint_3', 'Пересборка идёт в безопасном режиме: локальная теория комплекса не будет принудительно перезаписана, если для него включён собственный режим.')}</p>
                  </div>
                </div>

                <!-- Actions -->
                <div style="display:flex;align-items:center;justify-content:flex-end;gap:0.5rem;padding:0 1.375rem 1.25rem;">
                  <button id="tsc-cancel" type="button"
                          style="height:2.25rem;padding:0 1rem;border-radius:0.5rem;border:1px solid var(--color-border-subtle,#e2e8f0);background:var(--color-surface-2,#f8fafc);font-size:0.8125rem;font-weight:600;color:var(--color-text-secondary,#64748b);cursor:pointer;transition:all 0.15s ease;">
                    ${wt('complexes.btn_cancel', 'Отмена')}
                  </button>
                  <button id="tsc-confirm" type="button"
                          style="height:2.25rem;padding:0 1.125rem;border-radius:0.5rem;border:none;background:var(--color-primary,#6366f1);font-size:0.8125rem;font-weight:700;color:#fff;cursor:pointer;display:inline-flex;align-items:center;gap:0.375rem;transition:all 0.15s ease;">
                    <span class="material-symbols-outlined" style="font-size:16px;">sync</span>
                    ${wt('complexes.btn_update', 'Обновить')}
                  </button>
                </div>
              `;

              document.body.appendChild(dialog);
              dialog.showModal();

              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  dialog.setAttribute("data-open", "");
                  dialog.style.transform = "scale(1) translateY(0)";
                  dialog.style.opacity = "1";
                });
              });

              const close = (result) => {
                dialog.removeAttribute("data-open");
                dialog.style.transform = "scale(0.95) translateY(8px)";
                dialog.style.opacity = "0";
                setTimeout(() => { dialog.close(); dialog.remove(); resolve(result); }, 220);
              };

              dialog.querySelector("#tsc-cancel").addEventListener("click", () => close(false));
              dialog.querySelector("#tsc-confirm").addEventListener("click", () => close(true));
              dialog.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); close(false); } });
              dialog.addEventListener("click", (e) => {
                const r = dialog.getBoundingClientRect();
                if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(false);
              });
            });
          }

            const theorySyncButtons = document.querySelectorAll("button.theory-sync-btn[data-complex-id]");
            theorySyncButtons.forEach((btn) => {
              btn.addEventListener("click", async () => {
                const complexId = btn.getAttribute("data-complex-id");
                if (!complexId) return;

                const confirmed = await openTheorySyncConfirmDialog(complexId);
                if (!confirmed) return;

                btn.setAttribute("disabled", "true");
                btn.classList.add("opacity-70");
                try {
                  const resp = await fetch(
                    `/api/complexes/${encodeURIComponent(complexId)}/sync-theory-from-topics`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        dry_run: false,
                        propagation_mode: "safe",
                      }),
                    }
                  );
                  const data = await resp.json();
                  if (!resp.ok || !data?.ok) {
                    showComplexVoiceToast({
                      severity: "error",
                      what: wt('complexes.theory_sync_fail_what', 'Синхронизация теории не выполнена.'),
                      impact: wt('complexes.theory_sync_fail_impact', 'Карточка комплекса осталась без изменений.'),
                      next: data?.error
                        ? `${wt('complexes.check_reason_prefix', 'Проверьте причину')} (${data.error}) ${wt('complexes.and_retry', 'и повторите.')}.`
                        : wt('complexes.retry_later', 'Повторите попытку позже.'),
                    });
                    return;
                  }

                  const summary = data.summary || {};
                  const action = summary.action || "skipped";
                  const reason = summary.reason || "";
                  const status = summary.status || "none";

                  if (action === "updated") {
                    if (status === "composite") {
                      showComplexVoiceToast({
                        severity: "info",
                        what: wt('complexes.theory_sync_composite_what', 'Синхронизация собрала несколько теорий.'),
                        impact: wt('complexes.theory_sync_composite_impact', 'Комплекс получил составной теоретический контекст по связанным темам.'),
                        next: wt('complexes.theory_sync_composite_next', 'Это нормальный сценарий для многотемного комплекса. При желании можно задать общую теорию вручную.'),
                      });
                    } else {
                      showComplexVoiceToast({
                        severity: "success",
                        what: wt('complexes.theory_sync_ok_what', 'Наследуемая теория синхронизирована.'),
                        impact: wt('complexes.theory_sync_ok_impact', 'Контекст теории обновлён по связанным темам.'),
                        next: wt('complexes.theory_sync_ok_next', 'Можно запускать комплекс или продолжить редактирование.'),
                      });
                    }
                  } else if (reason === "unchanged") {
                    showComplexVoiceToast({
                      severity: "info",
                      what: wt('complexes.theory_sync_unchanged_what', 'Синхронизация не требуется.'),
                      impact: wt('complexes.theory_sync_unchanged_impact', 'Текущий теоретический контекст уже актуален.'),
                      next: wt('complexes.theory_sync_unchanged_next', 'Дополнительные действия не нужны.'),
                    });
                  } else if (reason === "mode_override") {
                    showComplexVoiceToast({
                      severity: "warning",
                      what: wt('complexes.theory_sync_skipped_what', 'Синхронизация пропущена.'),
                      impact: wt('complexes.theory_sync_override_impact', 'Комплекс в режиме локальной теории (override).'),
                      next: wt('complexes.theory_sync_override_next', 'Для наследования переключите режим в редакторе комплекса.'),
                    });
                  } else if (reason === "no_topic_refs") {
                    showComplexVoiceToast({
                      severity: "info",
                      what: wt('complexes.theory_sync_skipped_what', 'Синхронизация пропущена.'),
                      impact: wt('complexes.theory_sync_notopics_impact', 'В комплексе нет валидных ссылок на темы.'),
                      next: wt('complexes.theory_sync_notopics_next', 'Проверьте состав заданий комплекса.'),
                    });
                  } else {
                    showComplexVoiceToast({
                      severity: "info",
                      what: wt('complexes.theory_sync_noop_what', 'Синхронизация завершена без изменений.'),
                      impact: wt('complexes.theory_sync_noop_impact', 'Теоретический контекст не изменился.'),
                      next: wt('complexes.theory_sync_noop_next', 'Можно продолжать работу.'),
                    });
                  }
                  fetchComplexes();
                } catch (err) {
                  console.error("Complex theory sync failed", err);
                  showComplexVoiceToast({
                    severity: "error",
                    what: wt('complexes.theory_sync_net_fail_what', 'Синхронизация не выполнена из-за сетевой ошибки.'),
                    impact: wt('complexes.theory_sync_net_fail_impact', 'Состояние комплекса осталось прежним.'),
                    next: wt('complexes.check_network_retry_action', 'Проверьте сеть и повторите действие.'),
                  });
                } finally {
                  btn.removeAttribute("disabled");
                  btn.classList.remove("opacity-70");
                }
              });
            });

            const compositeTheoryButtons = document.querySelectorAll("button.composite-theory-btn[data-complex-id]");
            compositeTheoryButtons.forEach((btn) => {
              btn.addEventListener("click", async () => {
                const complexId = btn.getAttribute("data-complex-id") || "";
                const complexName = btn.getAttribute("data-complex-name") || "";
                const complex = getComplexById(complexId);
                const theoryIds = (btn.getAttribute("data-composite-ids") || "")
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean);
                await openComplexTheoryViewer(complexName, theoryIds, {
                  complexId,
                  embeddedTheoryItems: getComplexEmbeddedTheoryItems(complex),
                  readOnly: isLinkedLibraryComplex(complex),
                });
              });
            });

            syncComplexSelectionUi();
            applyComplexFilters();
          }

          async function chooseComplexImportFile() {
            return new Promise((resolve) => {
              const overlay = document.createElement("div");
              overlay.className = "fixed inset-0 z-[1220] bg-scrim backdrop-blur-sm flex items-center justify-center p-4";
              overlay.setAttribute("data-role", "dialog");

              overlay.innerHTML = `
                <div class="w-full max-w-2xl rounded-[28px] border border-border-subtle bg-surface-1 shadow-xl overflow-hidden">
                  <div class="border-b border-border-subtle px-5 py-4">
                    <p class="text-xs font-bold uppercase tracking-[0.16em] text-text-muted">${wt('complexes.import_kicker', 'Импорт')}</p>
                    <p class="mt-2 text-xl font-black text-text-main">${wt('complexes.import_dialog_title', 'Импорт комплекса заданий')}</p>
                  </div>
                  <div class="space-y-4 px-5 py-5 text-sm text-text-secondary" id="import-dialog-body">
                    <p>${wt('complexes.import_dialog_desc', 'Выберите ZIP-архив с комплексами для импорта в вашу библиотеку.')}</p>
                    <input type="file" id="complex-file-input" accept=".zip" style="display: none" />
                  </div>
                  <div class="flex justify-end gap-3 border-t border-border-subtle px-5 py-4">
                    <button type="button" class="btn-secondary h-10 px-4" data-role="cancel">${wt('complexes.btn_cancel', 'Отмена')}</button>
                    <button type="button" class="btn-primary h-10 px-4" data-role="confirm">${wt('complexes.btn_choose_file', 'Выбрать файл')}</button>
                  </div>
                </div>
              `;

              const fileInput = overlay.querySelector("#complex-file-input");
              const bodyContainer = overlay.querySelector("#import-dialog-body");
              const confirmBtn = overlay.querySelector('[data-role="confirm"]');
              const cancelBtn = overlay.querySelector('[data-role="cancel"]');

              const close = (resultValue = false) => {
                overlay.remove();
                resolve(Boolean(resultValue));
              };

              overlay.addEventListener("click", (event) => {
                if (event.target === overlay) close(false);
              });

              cancelBtn?.addEventListener("click", () => close(false));

              confirmBtn?.addEventListener("click", () => {
                fileInput.click();
              });

              fileInput.addEventListener("change", async () => {
                const file = fileInput.files[0];
                if (!file) return;

                // Show loading state while checking the archive
                bodyContainer.innerHTML = `
                  <div class="flex flex-col items-center justify-center py-8 space-y-3">
                    <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    <p class="text-sm text-text-secondary">${wt('complexes.import_checking', 'Проверка архива...')}</p>
                  </div>
                `;
                if (confirmBtn) confirmBtn.style.display = "none";
                if (cancelBtn) cancelBtn.style.display = "none";

                try {
                  const formData = new FormData();
                  formData.append("file", file);

                  const checkResp = await fetch("/api/complexes/import/check", {
                    method: "POST",
                    body: formData,
                  });
                  const checkData = await checkResp.json();

                  if (!checkData.ok) {
                    throw new Error(checkData.error || "validation_failed");
                  }

                  // Change dialog to the confirmation card layout
                  overlay.setAttribute("data-role", "confirm-card");
                  
                  const limits = checkData.workspace_limits;
                  let limitExceeded = false;
                  let limitWarningHtml = "";
                  if (limits && limits.plan !== "premium") {
                    const remainingComplexes = limits.complexes?.remaining_personal ?? 0;
                    const remainingTasks = limits.tasks?.remaining_personal ?? 0;
                    const complexesToImport = checkData.summary?.total || 0;
                    const tasksToImport = checkData.manifest?.entities?.tasks?.length || 0;

                    let complexExceeded = complexesToImport > remainingComplexes;
                    let taskExceeded = tasksToImport > remainingTasks;

                    if (complexExceeded || taskExceeded) {
                      limitExceeded = true;
                      let messages = [];
                      if (complexExceeded) {
                        messages.push(
                          wt('complexes.limit_complex_desc', 'Комплексов для импорта: {required}, доступно слотов: {remaining}.')
                            .replace('{required}', complexesToImport)
                            .replace('{remaining}', remainingComplexes)
                        );
                      }
                      if (taskExceeded) {
                        messages.push(
                          wt('complexes.limit_task_desc', 'Заданий для импорта: {required}, доступно слотов: {remaining}.')
                            .replace('{required}', tasksToImport)
                            .replace('{remaining}', remainingTasks)
                        );
                      }
                      limitWarningHtml = `
                        <div class="rounded-2xl border border-error-light bg-error-lighter px-4 py-3 text-sm text-error-text animate-slide-up-fade">
                          <div class="font-bold">${wt('complexes.limit_exceeded_title', 'Недостаточно свободных слотов для импорта')}</div>
                          <div class="mt-1 space-y-1">
                            ${messages.map(msg => `<div>${escapeHtml(msg)}</div>`).join('')}
                          </div>
                          <div class="mt-2 text-xs font-semibold text-error-text/80">
                            ${wt('complexes.limit_exceeded_action', 'Пожалуйста, освободите место в вашем аккаунте, чтобы продолжить импорт.')}
                          </div>
                        </div>
                      `;
                    }
                  }

                  // Re-render overlay content for confirmation card
                  overlay.innerHTML = `
                    <div class="w-full max-w-2xl rounded-[28px] border border-border-subtle bg-surface-1 shadow-xl overflow-hidden animate-slide-up-fade">
                      <div class="border-b border-border-subtle px-5 py-4">
                        <p class="text-xs font-bold uppercase tracking-[0.16em] text-text-muted">${wt('complexes.import_kicker', 'Импорт')}</p>
                        <p class="mt-2 text-xl font-black text-text-main">${wt('complexes.import_preview_title', 'Подтверждение импорта')}</p>
                      </div>
                      <div class="space-y-4 px-5 py-5 text-sm text-text-secondary" id="import-dialog-body">
                        <p class="font-bold text-text-main">${wt('complexes.import_preview_subtitle', 'Будут импортированы следующие элементы:')}</p>
                        <div class="grid grid-cols-2 gap-3">
                          <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-3">
                            <div class="text-xs uppercase tracking-wide text-text-muted">${wt('complexes.import_total', 'Всего комплексов')}</div>
                            <div class="mt-1 text-2xl font-bold text-text-main">${checkData.summary?.total || 0}</div>
                          </div>
                          <div class="rounded-2xl border border-border-subtle bg-bg-secondary px-4 py-3">
                            <div class="text-xs uppercase tracking-wide text-text-muted">${wt('complexes.import_conflicts', 'Конфликты')}</div>
                            <div class="mt-1 text-2xl font-bold text-text-main">${checkData.summary?.conflicts || 0}</div>
                          </div>
                        </div>

                        ${limitWarningHtml}

                        <!-- Resolution options -->
                        <div class="space-y-3 pt-2">
                          <div class="flex flex-col space-y-1">
                            <label class="text-xs font-bold text-text-secondary">${wt('complexes.import_opt_complexes', 'Разрешение конфликтов для комплексов')}</label>
                            <select id="complex-conflict-resolution" class="rounded-xl border border-border-subtle bg-surface-2 px-3 py-2 text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 text-sm">
                              <option value="new_id" selected>${wt('complexes.opt_new_id_comp', 'Создать новые ID (копия)')}</option>
                              <option value="overwrite">${wt('complexes.opt_overwrite', 'Перезаписать существующие')}</option>
                              <option value="skip">${wt('complexes.opt_skip', 'Пропустить импорт')}</option>
                            </select>
                          </div>

                          <div class="flex flex-col space-y-1">
                            <label class="text-xs font-bold text-text-secondary">${wt('complexes.import_opt_tasks', 'Разрешение конфликтов для заданий')}</label>
                            <select id="task-conflict-resolution" class="rounded-xl border border-border-subtle bg-surface-2 px-3 py-2 text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 text-sm">
                              <option value="skip" selected>${wt('complexes.opt_skip', 'Пропустить импорт')}</option>
                              <option value="overwrite">${wt('complexes.opt_overwrite', 'Перезаписать существующие')}</option>
                              <option value="new_id">${wt('complexes.opt_new_id_task', 'Создать новые ID')}</option>
                            </select>
                          </div>

                          <div class="flex flex-col space-y-1">
                            <label class="text-xs font-bold text-text-secondary">${wt('complexes.import_opt_theories', 'Разрешение конфликтов для теорий')}</label>
                            <select id="theory-conflict-resolution" class="rounded-xl border border-border-subtle bg-surface-2 px-3 py-2 text-text-main outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 text-sm">
                              <option value="reuse_if_same_hash" selected>${wt('complexes.opt_reuse_same', 'Переиспользовать при совпадении хэша')}</option>
                              <option value="overwrite">${wt('complexes.opt_overwrite', 'Перезаписать существующие')}</option>
                              <option value="new_id">${wt('complexes.opt_new_id_theo', 'Создать новые ID')}</option>
                              <option value="skip">${wt('complexes.opt_skip', 'Пропустить импорт')}</option>
                            </select>
                          </div>
                        </div>

                        ${checkData.errors && checkData.errors.length > 0 ? `
                          <div class="rounded-2xl border border-error-light bg-error-lighter px-4 py-3">
                            <div class="text-xs uppercase tracking-wide text-error-text font-bold">${wt('complexes.import_errors', 'Ошибки')}</div>
                            <ul class="mt-1 list-disc list-inside text-xs text-error-text space-y-1">
                              ${checkData.errors.map(err => `<li>${escapeHtml(err.name || err.id)}: ${escapeHtml(err.error)}</li>`).join('')}
                            </ul>
                          </div>
                        ` : ''}

                        ${checkData.warnings && checkData.warnings.length > 0 ? `
                          <div class="rounded-2xl border border-warning-light bg-warning-lighter px-4 py-3">
                            <div class="text-xs uppercase tracking-wide text-warning-darker font-bold">${wt('complexes.import_warnings', 'Предупреждения')}</div>
                            <ul class="mt-1 list-disc list-inside text-xs text-warning-darker space-y-1">
                              ${checkData.warnings.map(warn => `<li>${escapeHtml(warn)}</li>`).join('')}
                            </ul>
                          </div>
                        ` : ''}
                      </div>
                      <div class="flex justify-end gap-3 border-t border-border-subtle px-5 py-4">
                        <button type="button" class="btn-secondary h-10 px-4" data-role="cancel">${wt('complexes.btn_cancel', 'Отмена')}</button>
                        <button type="button" class="btn-primary h-10 px-4 ${limitExceeded ? 'opacity-50 cursor-not-allowed' : ''}" data-role="confirm" ${limitExceeded ? "disabled" : ""}>${wt('complexes.btn_import_confirm', 'Импортировать')}</button>
                      </div>
                    </div>
                  `;

                  const confirmCancelBtn = overlay.querySelector('[data-role="cancel"]');
                  const confirmSubmitBtn = overlay.querySelector('[data-role="confirm"]');
                  const confirmBody = overlay.querySelector("#import-dialog-body");

                  confirmCancelBtn?.addEventListener("click", () => close(false));

                  confirmSubmitBtn?.addEventListener("click", async () => {
                    const complexRes = overlay.querySelector("#complex-conflict-resolution")?.value || "new_id";
                    const taskRes = overlay.querySelector("#task-conflict-resolution")?.value || "skip";
                    const theoryRes = overlay.querySelector("#theory-conflict-resolution")?.value || "reuse_if_same_hash";

                    // Show progress bar
                    confirmBody.innerHTML = `
                      <div class="space-y-4 py-4">
                        <div class="flex items-center justify-between text-sm text-text-secondary mb-1">
                          <span id="import-progress-label">${wt('complexes.import_progress_start', 'Подготовка...')}</span>
                          <span id="import-progress-percent">0%</span>
                        </div>
                        <div class="w-full bg-surface-alt rounded-full h-3 overflow-hidden">
                          <div id="import-progress-fill" class="h-full bg-primary rounded-full transition-all duration-300 ease-out" style="width: 0%"></div>
                        </div>
                      </div>
                    `;
                    if (confirmSubmitBtn) confirmSubmitBtn.style.display = "none";
                    if (confirmCancelBtn) confirmCancelBtn.style.display = "none";

                    try {
                      const confirmForm = new FormData();
                      confirmForm.append("cache_id", checkData.cache_id);
                      confirmForm.append("complex_conflict_resolution", complexRes);
                      confirmForm.append("task_conflict_resolution", taskRes);
                      confirmForm.append("theory_conflict_resolution", theoryRes);
                      confirmForm.append("atomic_mode", "bundle");
                      confirmForm.append("skip_errors", "false");
                      confirmForm.append("idempotency_key", "complex-import-" + Math.random().toString(36).substring(2, 15));

                      const confirmResp = await fetch("/api/complexes/import/confirm", {
                        method: "POST",
                        body: confirmForm,
                      });

                      if (!confirmResp.ok) {
                        let errText = `HTTP ${confirmResp.status}`;
                        try {
                          const errJson = await confirmResp.json();
                          errText = errJson?.error || errText;
                        } catch (_) {}
                        throw new Error(errText);
                      }

                      const reader = confirmResp.body.getReader();
                      const decoder = new TextDecoder();
                      let buffer = "";
                      let finalResult = null;

                      while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split("\n");
                        buffer = lines.pop();

                        for (const line of lines) {
                          if (!line.trim()) continue;
                          try {
                            const msg = JSON.parse(line);
                            if (msg.type === "progress") {
                              const pct = Math.round((msg.current / (msg.total || 1)) * 100);
                              const fill = document.getElementById("import-progress-fill");
                              const label = document.getElementById("import-progress-label");
                              const pctEl = document.getElementById("import-progress-percent");
                              if (fill) fill.style.width = `${pct}%`;
                              if (label) label.textContent = msg.status || `Импорт: ${msg.current} из ${msg.total}`;
                              if (pctEl) pctEl.textContent = `${pct}%`;
                            } else if (msg.type === "result") {
                              finalResult = msg.data;
                            } else if (msg.type === "error") {
                              throw new Error(msg.error);
                            }
                          } catch (e) {
                            console.error("Error parsing stream line:", e);
                          }
                        }
                      }

                      if (finalResult && finalResult.ok) {
                        showComplexVoiceToast({
                          severity: "success",
                          what: wt('complexes.import_success_what', 'Импорт успешно завершён.'),
                          impact: `${wt('im.k680', 'Добавлено:')} ${finalResult.imported_complexes || 0} комплексов.`,
                          next: wt('complexes.import_success_next', 'Список комплексов обновлён.'),
                        });
                        close(true);
                        // Refresh complexes
                        fetchComplexes();
                      } else {
                        throw new Error(finalResult?.error || "import_failed");
                      }

                    } catch (err) {
                      console.error("Confirm import failed:", err);
                      showComplexVoiceToast({
                        severity: "error",
                        what: wt('complexes.import_failed_what', 'Импорт завершился ошибкой.'),
                        impact: wt('complexes.import_failed_impact', 'Данные не были импортированы.'),
                        next: String(err?.message || "").trim() || "Проверьте архив и повторите попытку.",
                      });
                      close(false);
                    }
                  });

                } catch (err) {
                  console.error("Check import failed:", err);
                  showComplexVoiceToast({
                    severity: "error",
                    what: wt('complexes.import_failed_what', 'Проверка архива завершилась ошибкой.'),
                    impact: wt('complexes.import_failed_impact', 'Не удалось прочитать данные архива.'),
                    next: String(err?.message || "").trim() || "Проверьте корректность zip-файла.",
                  });
                  close(false);
                }
              });

              document.body.appendChild(overlay);
            });
          }
          document.addEventListener("DOMContentLoaded", () => {
            activeTheoryFilterId = readInitialTheoryFilterFromUrl();
            bindComplexFilters();
            bindComplexSort();
            fetchComplexes();
            const toggleSelectBtn = document.getElementById("toggle-select-complexes");
            if (toggleSelectBtn) {
              toggleSelectBtn.addEventListener("click", () => {
                toggleComplexSelectionMode();
              });
            }
            const selectAllBtn = document.getElementById("complex-select-all");
            if (selectAllBtn) {
              selectAllBtn.addEventListener("click", () => {
                selectAllVisibleComplexes();
              });
            }
            const exportSelectedBtn = document.getElementById("complex-export-selected");
            if (exportSelectedBtn) {
              exportSelectedBtn.addEventListener("click", async () => {
                await exportSelectedComplexes();
              });
            }
            const cancelSelectionBtn = document.getElementById("complex-selection-cancel");
            if (cancelSelectionBtn) {
              cancelSelectionBtn.addEventListener("click", () => {
                cancelComplexSelection();
              });
            }
            const createBtn = document.getElementById("create-complex");
            if (createBtn) {
              createBtn.addEventListener("click", () => {
                window.navigateWithTransition("/complexes/create");
              });
            }
            const importBtn = document.getElementById("import-complexes");
            if (importBtn) {
              importBtn.addEventListener("click", () => {
                chooseComplexImportFile();
              });
            }
            const theoryCenterBtn = document.getElementById("open-theory-center");
            if (theoryCenterBtn) {
              theoryCenterBtn.addEventListener("click", () => {
                window.navigateWithTransition("/theory-center?scope=complexes");
              });
            }
            const catalogBtn = document.getElementById("open-catalog");
            if (catalogBtn) {
              catalogBtn.addEventListener("click", () => {
                window.navigateWithTransition("/catalog");
              });
            }
            const addByCodeBtn = document.getElementById("add-complex-by-code");
            if (addByCodeBtn) {
              addByCodeBtn.addEventListener("click", async () => {
                await addComplexByAccessCodeFlow();
              });
            }
            const emptyCreateBtns = document.querySelectorAll("#empty-state button");
            emptyCreateBtns.forEach((btn) => {
              btn.addEventListener("click", () => {
                window.navigateWithTransition("/complexes/create");
              });
            });
            const retryButton = document.getElementById("retry-load");
            if (retryButton) {
              retryButton.addEventListener("click", () => {
                fetchComplexes();
              });
            }
            // Back button navigation
            const backButton = document.getElementById("back-button");
            if (backButton) {
              backButton.addEventListener("click", () => {
                window.navigateWithTransition("/main");
              });
            }
            // Breadcrumb home navigation
            const breadcrumbHome = document.getElementById("breadcrumb-home");
            if (breadcrumbHome) {
              breadcrumbHome.addEventListener("click", () => {
                window.navigateWithTransition("/main");
              });
            }
            syncComplexSelectionUi();
          });
