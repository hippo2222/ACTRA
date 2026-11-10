import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Task Import Studio — Sequence & Grouping Didactic Support', () => {
    let Studio;

    beforeEach(() => {
        global.window = {
            __ACTRA_DEV_MODE__: true,
            i18n: {
                t: (key, fallback) => {
                    const dict = {
                        'studio.task_types.sequence': 'Последовательность',
                        'studio.stage3.sequence_steps_label': 'Правильный порядок шагов:',
                        'studio.stage3.sequence_groups_label': 'Группы и элементы:',
                        'studio.stage3.level_unnamed': 'Уровень',
                        'studio.stage3.more_steps_fmt': 'ещё {n} шаг.',
                        'studio.stage3.collapse': 'Свернуть',
                        'studio.sandbox.badge_grouping': 'Группировка',
                        'studio.sandbox.badge_steps_count': '{count} этапов',
                        'studio.sandbox.badge_std_missing': 'Нет эталона!',
                        'studio.sandbox.warn_missing_group_titles': 'Рекомендуется указать названия групп вместо числовых уровней',
                        'studio.sandbox.warn_level_legend_in_prompt': 'Легенда уровней обнаружена в тексте задания. Названия уровней лучше задавать в [заголовках]',
                    };
                    return dict[key] || fallback || key;
                }
            },
            addEventListener: () => {},
        };
        global.document = {
            addEventListener: () => {},
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: (tag) => ({
                setAttribute: () => {},
                appendChild: () => {},
                addEventListener: () => {},
                classList: { add: () => {}, remove: () => {} },
            }),
        };

        const code = fs.readFileSync(path.resolve(process.cwd(), 'frontend/Editor/task_import_studio.js'), 'utf-8');
        const fn = new Function(code);
        fn();
        Studio = global.window.__StudioInternal;
    });

    describe('isTautologicalLevelLabel', () => {
        it('detects machine and numeric placeholders across languages', () => {
            expect(Studio.isTautologicalLevelLabel('', 0)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('Level 1', 0)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('level 2', 1)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('level_1', 0)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('Уровень 1', 0)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('уровень 2', 1)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('Рівень 3', 2)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('Этап 1', 0)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('Етап 2', 1)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('Группа 1', 0)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('Група 2', 1)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('Stage 1', 0)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('1', 0)).toBe(true);
            expect(Studio.isTautologicalLevelLabel('#1', 0)).toBe(true);
        });

        it('retains meaningful didactic group and stage names', () => {
            expect(Studio.isTautologicalLevelLabel('Смещение в сторону затемнения', 0)).toBe(false);
            expect(Studio.isTautologicalLevelLabel('Отсутствие смещения средостения', 1)).toBe(false);
            expect(Studio.isTautologicalLevelLabel('Первичный осмотр', 0)).toBe(false);
            expect(Studio.isTautologicalLevelLabel('Group A (Active)', 0)).toBe(false);
        });
    });

    describe('extractSequenceLevels', () => {
        it('extracts canonical levels and strips tautological placeholders', () => {
            const task = {
                type: 'sequence_assembly',
                prompt: 'Тестовое задание',
                elements: [
                    { id: 'elem_1', text: 'Элемент 1' },
                    { id: 'elem_2', text: 'Элемент 2' }
                ],
                levels: [
                    { level_id: 'level_1', level_name: 'Level 1', blocks: ['elem_1'] },
                    { level_id: 'level_2', level_name: 'Уровень 2', blocks: ['elem_2'] }
                ]
            };
            const levels = Studio.extractSequenceLevels(task);
            expect(levels).toHaveLength(2);
            expect(levels[0].title).toBe('');
            expect(levels[0].items).toEqual(['Элемент 1']);
            expect(levels[1].title).toBe('');
            expect(levels[1].items).toEqual(['Элемент 2']);
        });

        it('preserves custom group names and multi-element memberships', () => {
            const task = {
                type: 'sequence_assembly',
                prompt: 'Сгруппируйте патологии',
                elements: [
                    { id: 'elem_1', text: 'Ателектаз' },
                    { id: 'elem_2', text: 'Пневмосклероз' },
                    { id: 'elem_3', text: 'Пневмоторакс' }
                ],
                levels: [
                    { level_id: 'level_1', level_name: 'В сторону затемнения', blocks: ['elem_1', 'elem_2'] },
                    { level_id: 'level_2', level_name: 'В противоположную сторону', blocks: ['elem_3'] }
                ]
            };
            const levels = Studio.extractSequenceLevels(task);
            expect(levels).toHaveLength(2);
            expect(levels[0].title).toBe('В сторону затемнения');
            expect(levels[0].items).toEqual(['Ателектаз', 'Пневмосклероз']);
            expect(levels[1].title).toBe('В противоположную сторону');
            expect(levels[1].items).toEqual(['Пневмоторакс']);
        });
    });

    describe('serializeTaskToText', () => {
        it('serializes custom group names and flags, omitting tautological names', () => {
            const task = {
                type: 'sequence_assembly',
                prompt: 'Сгруппируйте патологии',
                level_order_matters: false,
                sequence_within_level_matters: false,
                elements: [
                    { id: 'element_1', text: 'Ателектаз' },
                    { id: 'element_2', text: 'Пневмоторакс' }
                ],
                levels: [
                    { level_id: 'level_1', level_name: 'В сторону затемнения', blocks: ['element_1'] },
                    { level_id: 'level_2', level_name: 'Level 2', blocks: ['element_2'] }
                ]
            };
            const text = Studio.serializeTaskToText(task);
            expect(text).toContain('@SEQUENCE');
            expect(text).toContain('@ level_order_matters: false');
            expect(text).toContain('@ sequence_within_level_matters: false');
            expect(text).toContain('level_1 [В сторону затемнения]: element_1');
            expect(text).toContain('level_2: element_2');
            expect(text).not.toContain('[Level 2]');
        });
    });

    describe('renderTaskPreviewSnippet', () => {
        it('renders group headers for grouping tasks instead of flat arrows', () => {
            const task = {
                type: 'sequence_assembly',
                elements: [
                    { id: 'element_1', text: 'Ателектаз' },
                    { id: 'element_2', text: 'Пневмоторакс' }
                ],
                levels: [
                    { level_id: 'level_1', level_name: 'В сторону затемнения', blocks: ['element_1'] },
                    { level_id: 'level_2', level_name: 'В противоположную сторону', blocks: ['element_2'] }
                ]
            };
            const html = Studio.renderTaskPreviewSnippet(task);
            expect(html).toContain('[В сторону затемнения]:');
            expect(html).toContain('Ателектаз');
            expect(html).toContain('[В противоположную сторону]:');
            expect(html).toContain('Пневмоторакс');
            expect(html).not.toContain('→');
        });

        it('renders linear steps with arrows for non-grouped sequences', () => {
            const task = {
                type: 'sequence_assembly',
                items: ['Осмотр', 'Пальпация', 'Перкуссия']
            };
            const html = Studio.renderTaskPreviewSnippet(task);
            expect(html).toContain('1.');
            expect(html).toContain('Осмотр');
            expect(html).toContain('→');
        });
    });

    describe('auditTaskDidactics', () => {
        it('detects grouping task and assigns Grouping badge and warnings for unnamed groups', () => {
            const task = {
                type: 'sequence_assembly',
                level_order_matters: false,
                elements: [
                    { id: 'elem_1', text: 'A' },
                    { id: 'elem_2', text: 'B' }
                ],
                levels: [
                    { level_id: 'level_1', blocks: ['elem_1'] },
                    { level_id: 'level_2', blocks: ['elem_2'] }
                ]
            };
            const audit = Studio.auditTaskDidactics(task);
            expect(audit.badges.some(b => b.text === 'Группировка')).toBe(true);
            expect(audit.warnings).toContain('Рекомендуется указать названия групп вместо числовых уровней');
        });

        it('detects level legend leaked in prompt text and raises didactic warning', () => {
            const task = {
                type: 'sequence_assembly',
                prompt: 'Сгруппируйте патологии (Уровень 1 — смещение в сторону затемнения):',
                items: ['Ателектаз', 'Пневмоторакс']
            };
            const audit = Studio.auditTaskDidactics(task);
            expect(audit.warnings).toContain('Легенда уровней обнаружена в тексте задания. Названия уровней лучше задавать в [заголовках]');
        });
    });
});
