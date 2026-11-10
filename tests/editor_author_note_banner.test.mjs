import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';

function loadScript(filePath) {
    const fullPath = path.resolve(process.cwd(), filePath);
    return fs.readFileSync(fullPath, 'utf8');
}

function defineGlobal(name, value) {
    Object.defineProperty(global, name, {
        value,
        configurable: true,
        writable: true,
    });
}

function setupGlobalDom() {
    const dom = new JSDOM(
        '<!DOCTYPE html><html><body><main><header class="test-header"><h1>Editor</h1><span id="task-title-display">Title</span></header><div id="workspace"></div></main></body></html>',
        {
            url: 'http://localhost/?module=mod1&topic=top1&task=tsk1',
            runScripts: 'dangerously',
            resources: 'usable',
        }
    );
    defineGlobal('window', dom.window);
    defineGlobal('document', dom.window.document);
    defineGlobal('HTMLElement', dom.window.HTMLElement);
    defineGlobal('Node', dom.window.Node);
    defineGlobal('CustomEvent', dom.window.CustomEvent);
    defineGlobal('FormData', dom.window.FormData);
    defineGlobal('File', dom.window.File);
    defineGlobal('Blob', dom.window.Blob);
    defineGlobal('navigator', dom.window.navigator);
    defineGlobal('URL', dom.window.URL);

    dom.window.fetch = vi.fn();
    dom.window.alert = vi.fn();
    dom.window.confirm = vi.fn(() => true);

    const undoManagerCode = loadScript('frontend/Editor/undo_manager.js');
    dom.window.eval(undoManagerCode + '\n;window.UndoManager = UndoManager;');

    const autoSaveCode = loadScript('frontend/Editor/autosave_manager.js');
    dom.window.eval(autoSaveCode + '\n;window.AutoSaveManager = AutoSaveManager;');

    const baseEditorCode = loadScript('frontend/Editor/base_editor.js');
    dom.window.wt = (key, fallback) => fallback;
    dom.window.eval(baseEditorCode + '\n;window.BaseEditor = BaseEditor;');

    return dom;
}

class TestEditor extends null {
    static create(dom) {
        const Base = dom.window.BaseEditor;
        class ConcreteEditor extends Base {
            validateTask() {
                return null;
            }
            buildTaskData() {
                return {
                    id: this.taskId,
                    meta: {},
                    content: { test: true },
                };
            }
        }
        return new ConcreteEditor();
    }
}

describe('BaseEditor Pulsing Note Button & Accessible Modal (Remediated)', () => {
    let dom;
    let editor;

    beforeEach(() => {
        dom = setupGlobalDom();
        editor = TestEditor.create(dom);
        editor.moduleId = 'mod1';
        editor.topicId = 'top1';
        editor.taskId = 'tsk1';
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('getAuthorNote & getAuthorNoteRaw', () => {
        it('returns active note when metadata.author_note is open and has text', () => {
            editor.task = {
                metadata: {
                    author_note: {
                        text: 'Fix clinical wording in step 2',
                        status: 'open',
                        updated_at: '2026-11-09T18:00:00Z',
                    },
                },
            };

            const note = editor.getAuthorNote();
            expect(note).not.toBeNull();
            expect(note.text).toBe('Fix clinical wording in step 2');
            expect(note.status).toBe('open');
        });

        it('returns active note when stored under task_data.meta.author_note', () => {
            editor.task = {
                task_data: {
                    meta: {
                        author_note: {
                            text: 'Review image coordinates',
                            status: 'open',
                        },
                    },
                },
            };

            const note = editor.getAuthorNote();
            expect(note).not.toBeNull();
            expect(note.text).toBe('Review image coordinates');
        });

        it('returns null when note status is resolved', () => {
            editor.task = {
                metadata: {
                    author_note: {
                        text: 'Old resolved note',
                        status: 'resolved',
                    },
                },
            };

            expect(editor.getAuthorNote()).toBeNull();
            expect(editor.getAuthorNoteRaw()).toEqual({
                text: 'Old resolved note',
                status: 'resolved',
            });
        });

        it('returns null when note text is whitespace only', () => {
            editor.task = {
                metadata: {
                    author_note: {
                        text: '   ',
                        status: 'open',
                    },
                },
            };

            expect(editor.getAuthorNote()).toBeNull();
        });

        it('returns null when task has no note', () => {
            editor.task = { metadata: {} };
            expect(editor.getAuthorNote()).toBeNull();
            expect(editor.getAuthorNoteRaw()).toBeNull();
        });
    });

    describe('renderAuthorNoteButton (No hanging banner, unobtrusive pulsing button)', () => {
        it('renders pulsing header button with flag icon and does NOT create a hanging banner', () => {
            editor.task = {
                metadata: {
                    author_note: {
                        text: 'Double check chest CT window level',
                        status: 'open',
                        updated_at: '2026-11-09T14:30:00Z',
                    },
                },
            };

            editor.renderAuthorNoteButton();

            // Hanging banner MUST NOT exist
            expect(dom.window.document.getElementById('editor-author-note-banner')).toBeNull();

            // Pulsing button MUST exist in header
            const btn = dom.window.document.getElementById('editor-author-note-btn');
            expect(btn).not.toBeNull();
            expect(btn.classList.contains('author-note-btn--pulse')).toBe(true);

            // Tooltip contains full note text without truncation
            expect(btn.getAttribute('title')).toContain('Double check chest CT window level');

            // Flag icon inside button
            const flag = btn.querySelector('.material-symbols-outlined');
            expect(flag).not.toBeNull();
            expect(flag.textContent.trim()).toBe('flag');
        });

        it('removes button and banner when note becomes resolved or empty', () => {
            editor.task = {
                metadata: {
                    author_note: {
                        text: 'Temporary note',
                        status: 'open',
                    },
                },
            };
            editor.renderAuthorNoteButton();
            expect(dom.window.document.getElementById('editor-author-note-btn')).not.toBeNull();

            // Note is now resolved
            editor.task.metadata.author_note.status = 'resolved';
            editor.renderAuthorNoteButton();
            expect(dom.window.document.getElementById('editor-author-note-btn')).toBeNull();
        });

        it('re-renders on handleBaseLocaleChanged', () => {
            editor.task = {
                metadata: {
                    author_note: {
                        text: 'Note in russian',
                        status: 'open',
                    },
                },
            };
            editor.renderAuthorNoteButton();
            expect(dom.window.document.getElementById('editor-author-note-btn')).not.toBeNull();

            editor.handleBaseLocaleChanged();
            expect(dom.window.document.getElementById('editor-author-note-btn')).not.toBeNull();
        });
    });

    describe('resolveAuthorNote', () => {
        it('sends POST with status: resolved, updates task metadata, and removes button', async () => {
            editor.task = {
                metadata: {
                    author_note: {
                        text: 'Needs clarification on option B',
                        status: 'open',
                    },
                },
            };
            editor.renderAuthorNoteButton();

            const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});

            dom.window.fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    ok: true,
                    author_note: {
                        text: 'Needs clarification on option B',
                        status: 'resolved',
                        updated_at: '2026-11-09T19:00:00Z',
                    },
                }),
            });

            await editor.resolveAuthorNote();

            expect(dom.window.fetch).toHaveBeenCalledWith(
                '/api/editor/task/mod1/top1/tsk1/author-note',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({
                        text: 'Needs clarification on option B',
                        status: 'resolved',
                    }),
                })
            );

            expect(editor.task.metadata.author_note.status).toBe('resolved');
            expect(dom.window.document.getElementById('editor-author-note-btn')).toBeNull();
            expect(toastSpy).toHaveBeenCalledWith(
                expect.stringContaining('исправленная'),
                'success'
            );
        });

        it('handles resolve failure gracefully by keeping button and showing error toast', async () => {
            editor.task = {
                metadata: {
                    author_note: {
                        text: 'Unresolvable note',
                        status: 'open',
                    },
                },
            };
            editor.renderAuthorNoteButton();

            const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});

            dom.window.fetch.mockResolvedValueOnce({
                ok: false,
                status: 500,
                json: async () => ({
                    ok: false,
                    error: 'server_error',
                }),
            });

            await editor.resolveAuthorNote();

            expect(toastSpy).toHaveBeenCalledWith('server_error', 'error');
            expect(editor.task.metadata.author_note.status).toBe('open');
            expect(dom.window.document.getElementById('editor-author-note-btn')).not.toBeNull();
        });
    });

    describe('openAuthorNoteEditPrompt modal with Accessible High-Contrast Buttons', () => {
        it('opens modal, pre-fills textarea without truncation, and provides high-contrast actions', async () => {
            editor.task = {
                metadata: {
                    author_note: {
                        text: 'Original draft note with full text shown',
                        status: 'open',
                    },
                },
            };
            editor.renderAuthorNoteButton();

            editor.openAuthorNoteEditPrompt();

            const modal = dom.window.document.getElementById('editor-author-note-modal');
            expect(modal).not.toBeNull();

            const textarea = modal.querySelector('#editor-author-note-textarea');
            expect(textarea.value).toBe('Original draft note with full text shown');

            // High-contrast resolve button verification (dark emerald with white text)
            const resolveBtn = modal.querySelector('#author-note-resolve-btn');
            expect(resolveBtn).not.toBeNull();
            expect(resolveBtn.style.backgroundColor).toContain('rgb(4, 120, 87)'); // #047857
            expect(resolveBtn.style.color).toContain('rgb(255, 255, 255)');

            // Delete button exists
            const deleteBtn = modal.querySelector('#author-note-delete-btn');
            expect(deleteBtn).not.toBeNull();

            // Type updated text and save
            textarea.value = 'Updated note with new details';
            textarea.dispatchEvent(new dom.window.Event('input'));

            const toastSpy = vi.spyOn(editor, 'showToast').mockImplementation(() => {});

            dom.window.fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    ok: true,
                    author_note: {
                        text: 'Updated note with new details',
                        status: 'open',
                        updated_at: '2026-11-09T19:30:00Z',
                    },
                }),
            });

            const saveBtn = modal.querySelector('#author-note-save-btn');
            saveBtn.click();

            await new Promise((r) => setTimeout(r, 10));

            expect(dom.window.fetch).toHaveBeenCalledWith(
                '/api/editor/task/mod1/top1/tsk1/author-note',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({
                        text: 'Updated note with new details',
                        status: 'open',
                    }),
                })
            );
        });

        it('delete button removes author note and closes modal', async () => {
            editor.task = {
                metadata: {
                    author_note: {
                        text: 'Note to be deleted',
                        status: 'open',
                    },
                },
            };
            editor.renderAuthorNoteButton();
            editor.openAuthorNoteEditPrompt();

            const modal = dom.window.document.getElementById('editor-author-note-modal');
            const deleteBtn = modal.querySelector('#author-note-delete-btn');

            dom.window.fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ ok: true }),
            });

            deleteBtn.click();
            await new Promise((r) => setTimeout(r, 10));

            expect(dom.window.fetch).toHaveBeenCalledWith(
                '/api/editor/task/mod1/top1/tsk1/author-note',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({ delete: true }),
                })
            );

            expect(dom.window.document.getElementById('editor-author-note-btn')).toBeNull();
            expect(dom.window.document.getElementById('editor-author-note-modal')).toBeNull();
        });

        it('closes modal on Escape key', () => {
            editor.task = {
                metadata: {
                    author_note: { text: 'Test note', status: 'open' },
                },
            };
            editor.openAuthorNoteEditPrompt();
            expect(dom.window.document.getElementById('editor-author-note-modal')).not.toBeNull();

            dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
            expect(dom.window.document.getElementById('editor-author-note-modal')).toBeNull();
        });
    });
});
