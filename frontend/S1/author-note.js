/**
 * ACTRA S1 Player - Author Task Note Module
 * Enables authors to add/edit/delete private revision notes during playback.
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./routes', './api-client', './ui-helpers', './session-state'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./routes'),
            require('./api-client'),
            require('./ui-helpers'),
            require('./session-state')
        );
    } else {
        root.AuthorNoteUI = factory(
            root.SessionRoutes,
            root.SessionAPI,
            root.UIHelpers,
            root.SessionState
        );
    }
}(typeof self !== 'undefined' ? self : this, function (SessionRoutes, SessionAPI, UIHelpers, SessionState) {
    'use strict';

    let isSaving = false;
    let isInitialized = false;

    function wt(key, fallback, params = null) {
        if (typeof window !== 'undefined' && typeof window.wt === 'function') {
            return window.wt(key, fallback, params);
        }
        if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
            const val = window.i18n.t(key, params);
            return val !== key ? val : fallback;
        }
        return fallback;
    }

    function getTaskIdentifiers(task) {
        if (!task) return null;
        let moduleId = task.module_id;
        let topicId = task.topic_id;
        let taskId = task.task_id;
        if ((!moduleId || !topicId || !taskId) && task.task_ref) {
            const parts = String(task.task_ref).split('/');
            if (parts.length >= 3) {
                moduleId = moduleId || parts[0];
                topicId = topicId || parts[1];
                taskId = taskId || parts[2];
            }
        }
        if (!moduleId || !topicId || !taskId) return null;
        return {
            moduleId: String(moduleId).trim(),
            topicId: String(topicId).trim(),
            taskId: String(taskId).trim()
        };
    }

    function isCurrentTaskAuthor(task) {
        if (!task) return false;
        const authorMeta = task.author_meta;
        if (!authorMeta || typeof authorMeta !== 'object') return false;
        return authorMeta.is_author === true;
    }

    function getAuthorNote(task) {
        if (!task || !task.author_meta) return null;
        const note = task.author_meta.author_note;
        if (!note || typeof note !== 'object') return null;
        const text = String(note.text || '').trim();
        if (!text) return null;
        return {
            text: text,
            status: String(note.status || 'open').toLowerCase(),
            updated_at: String(note.updated_at || '')
        };
    }

    function formatUpdatedAt(isoStr) {
        if (!isoStr) return '';
        try {
            const d = new Date(isoStr);
            if (Number.isNaN(d.getTime())) return '';
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const hours = String(d.getHours()).padStart(2, '0');
            const mins = String(d.getMinutes()).padStart(2, '0');
            return `${day}.${month} ${hours}:${mins}`;
        } catch (_) {
            return '';
        }
    }

    function getElements() {
        if (typeof document === 'undefined') return {};
        return {
            btn: document.getElementById('s1-author-note-btn'),
            badge: document.getElementById('s1-author-note-badge'),
            dialog: document.getElementById('s1-author-note-dialog'),
            input: document.getElementById('s1-author-note-input'),
            charCount: document.getElementById('s1-author-note-char-count'),
            updatedAt: document.getElementById('s1-author-note-updated-at'),
            saveBtn: document.getElementById('s1-author-note-save'),
            cancelBtn: document.getElementById('s1-author-note-cancel'),
            deleteBtn: document.getElementById('s1-author-note-delete'),
            closeBtn: document.getElementById('s1-author-note-close')
        };
    }

    function updateCharCount(len) {
        const els = getElements();
        if (els.charCount) {
            els.charCount.textContent = `${len}/2000`;
        }
    }

    function syncAuthorNoteButton(task) {
        const els = getElements();
        if (!els.btn) return;

        const isAuthor = isCurrentTaskAuthor(task);
        if (!isAuthor) {
            els.btn.classList.add('hidden');
            closeAuthorNoteDialog();
            return;
        }

        els.btn.classList.remove('hidden');
        const note = getAuthorNote(task);
        const hasOpenNote = !!(note && note.status !== 'resolved');

        if (hasOpenNote) {
            els.btn.classList.add('has-note', 'border-amber-500/40', 'bg-amber-500/10', 'text-amber-600', 'dark:text-amber-400');
            els.btn.classList.remove('bg-surface-2', 'text-text-secondary');
            if (els.badge) els.badge.classList.remove('hidden');
            const preview = note.text.length > 50 ? note.text.slice(0, 47) + '...' : note.text;
            els.btn.setAttribute('title', `${wt('s1.author_note_title', 'Заметка автора к заданию')}: ${preview}`);
        } else {
            els.btn.classList.remove('has-note', 'border-amber-500/40', 'bg-amber-500/10', 'text-amber-600', 'dark:text-amber-400');
            els.btn.classList.add('bg-surface-2', 'text-text-secondary');
            if (els.badge) els.badge.classList.add('hidden');
            els.btn.setAttribute('title', wt('s1.author_note_title', 'Заметка автора к заданию'));
        }
    }

    function openAuthorNoteDialog() {
        const task = (SessionState && SessionState.currentTask) ? SessionState.currentTask : null;
        if (!isCurrentTaskAuthor(task)) return;

        const els = getElements();
        if (!els.dialog || !els.input) return;

        const note = getAuthorNote(task);
        const currentText = note ? note.text : '';
        els.input.value = currentText;

        updateCharCount(currentText.length);

        if (els.updatedAt) {
            const formatted = note && note.updated_at ? formatUpdatedAt(note.updated_at) : '';
            els.updatedAt.textContent = formatted ? `${wt('s1.author_note_updated_prefix', 'Обновлено: ')}${formatted}` : '';
        }

        if (els.deleteBtn) {
            els.deleteBtn.classList.toggle('hidden', !note);
        }

        if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.updateDOM === 'function') {
            window.i18n.updateDOM();
        }

        if (typeof els.dialog.showModal === 'function') {
            els.dialog.showModal();
        } else {
            els.dialog.setAttribute('open', '');
        }

        setTimeout(() => {
            if (els.input) {
                els.input.focus();
                els.input.setSelectionRange(els.input.value.length, els.input.value.length);
            }
        }, 50);
    }

    function closeAuthorNoteDialog() {
        const els = getElements();
        if (!els.dialog) return;
        if (typeof els.dialog.close === 'function' && els.dialog.open) {
            els.dialog.close();
        } else {
            els.dialog.removeAttribute('open');
        }
    }

    function setBusy(busy) {
        isSaving = !!busy;
        const els = getElements();
        if (els.saveBtn) {
            els.saveBtn.disabled = busy;
            const saveLabel = els.saveBtn.querySelector('[data-i18n]') || els.saveBtn;
            if (busy) {
                saveLabel.textContent = wt('s1.author_note_saving', 'Сохранение...');
            } else {
                saveLabel.textContent = wt('s1.author_note_save', 'Сохранить');
            }
        }
        if (els.deleteBtn) {
            els.deleteBtn.disabled = busy;
        }
        if (els.cancelBtn) {
            els.cancelBtn.disabled = busy;
        }
        if (els.input) {
            els.input.disabled = busy;
        }
    }

    async function saveAuthorNote() {
        if (isSaving) return;
        const task = (SessionState && SessionState.currentTask) ? SessionState.currentTask : null;
        const ids = getTaskIdentifiers(task);
        if (!ids) {
            closeAuthorNoteDialog();
            return;
        }

        const els = getElements();
        const text = els.input ? String(els.input.value || '').trim() : '';

        const existingNote = getAuthorNote(task);
        if (!text) {
            if (existingNote) {
                await deleteAuthorNote();
            } else {
                closeAuthorNoteDialog();
            }
            return;
        }

        setBusy(true);
        try {
            const res = await SessionAPI.saveTaskAuthorNote(ids.moduleId, ids.topicId, ids.taskId, {
                text: text,
                status: 'open'
            });

            if (res && res.status === 200 && res.data && res.data.ok) {
                if (!task.author_meta) task.author_meta = { is_author: true };
                task.author_meta.author_note = res.data.author_note || {
                    text: text,
                    status: 'open',
                    updated_at: new Date().toISOString()
                };
                syncAuthorNoteButton(task);
                closeAuthorNoteDialog();
                if (UIHelpers && typeof UIHelpers.showStatus === 'function') {
                    UIHelpers.showStatus(wt('s1.author_note_saved', 'Заметка сохранена'), 'success', {
                        autoHideMs: 3000,
                        dismissible: true
                    });
                }
            } else {
                const errMsg = (res && res.data && res.data.error) ? res.data.error : wt('s1.author_note_error', 'Не удалось сохранить заметку');
                if (UIHelpers && typeof UIHelpers.showStatus === 'function') {
                    UIHelpers.showStatus(errMsg, 'error', { autoHideMs: 4000 });
                }
            }
        } catch (err) {
            console.error('Failed to save author note', err);
            if (UIHelpers && typeof UIHelpers.showStatus === 'function') {
                UIHelpers.showStatus(wt('s1.author_note_error', 'Не удалось сохранить заметку'), 'error', { autoHideMs: 4000 });
            }
        } finally {
            setBusy(false);
        }
    }

    async function deleteAuthorNote() {
        if (isSaving) return;
        const task = (SessionState && SessionState.currentTask) ? SessionState.currentTask : null;
        const ids = getTaskIdentifiers(task);
        if (!ids) {
            closeAuthorNoteDialog();
            return;
        }

        setBusy(true);
        try {
            const res = await SessionAPI.saveTaskAuthorNote(ids.moduleId, ids.topicId, ids.taskId, {
                delete: true
            });

            if (res && res.status === 200 && res.data && res.data.ok) {
                if (task.author_meta) {
                    task.author_meta.author_note = null;
                }
                syncAuthorNoteButton(task);
                closeAuthorNoteDialog();
                if (UIHelpers && typeof UIHelpers.showStatus === 'function') {
                    UIHelpers.showStatus(wt('s1.author_note_deleted', 'Заметка удалена'), 'info', {
                        autoHideMs: 3000,
                        dismissible: true
                    });
                }
            } else {
                const errMsg = (res && res.data && res.data.error) ? res.data.error : wt('s1.author_note_error', 'Не удалось сохранить заметку');
                if (UIHelpers && typeof UIHelpers.showStatus === 'function') {
                    UIHelpers.showStatus(errMsg, 'error', { autoHideMs: 4000 });
                }
            }
        } catch (err) {
            console.error('Failed to delete author note', err);
            if (UIHelpers && typeof UIHelpers.showStatus === 'function') {
                UIHelpers.showStatus(wt('s1.author_note_error', 'Не удалось сохранить заметку'), 'error', { autoHideMs: 4000 });
            }
        } finally {
            setBusy(false);
        }
    }

    function init() {
        if (isInitialized) return;
        const els = getElements();
        if (!els.btn && !els.dialog) return;
        isInitialized = true;

        if (els.btn) {
            els.btn.addEventListener('click', (e) => {
                e.preventDefault();
                openAuthorNoteDialog();
            });
        }

        if (els.cancelBtn) {
            els.cancelBtn.addEventListener('click', (e) => {
                e.preventDefault();
                closeAuthorNoteDialog();
            });
        }

        if (els.closeBtn) {
            els.closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                closeAuthorNoteDialog();
            });
        }

        if (els.dialog) {
            els.dialog.addEventListener('click', (e) => {
                if (e.target === els.dialog) {
                    closeAuthorNoteDialog();
                }
            });
            els.dialog.addEventListener('cancel', () => {
                // native Escape key closes dialog
            });
        }

        if (els.input) {
            els.input.addEventListener('input', () => {
                updateCharCount(els.input.value.length);
            });
            els.input.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    saveAuthorNote();
                }
            });
        }

        if (els.saveBtn) {
            els.saveBtn.addEventListener('click', (e) => {
                e.preventDefault();
                saveAuthorNote();
            });
        }

        if (els.deleteBtn) {
            els.deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                deleteAuthorNote();
            });
        }
    }

    return {
        init: init,
        syncAuthorNoteButton: syncAuthorNoteButton,
        openAuthorNoteDialog: openAuthorNoteDialog,
        closeAuthorNoteDialog: closeAuthorNoteDialog,
        saveAuthorNote: saveAuthorNote,
        deleteAuthorNote: deleteAuthorNote,
        isCurrentTaskAuthor: isCurrentTaskAuthor,
        getAuthorNote: getAuthorNote,
        getTaskIdentifiers: getTaskIdentifiers,
        formatUpdatedAt: formatUpdatedAt
    };
}));
