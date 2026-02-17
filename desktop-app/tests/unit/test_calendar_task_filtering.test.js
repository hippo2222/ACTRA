/**
 * Тесты для filterSyntheticTasks и normalizeTasks
 * 
 * Проверяет, что:
 * 1. filterSyntheticTasks корректно фильтрует по is_synthetic флагу
 * 2. normalizeTasks корректно преобразует задачи и сохраняет is_synthetic
 * 3. Нет ложных срабатываний на substring match имён
 */

import { describe, test, expect } from 'vitest';

// Функции которые мы тестируем (скопированы из calendar.html для тестирования)
const normalizeTasks = (tasks) => {
    return (tasks || []).map(t => {
        if (typeof t === 'string') {
            return { name: t, is_completed: false, is_synthetic: false };
        }
        return {
            name: t?.name || t?.complex_name || t?.task_id || '',
            is_completed: Boolean(t?.is_completed),
            is_synthetic: Boolean(t?.is_synthetic),
            complex_id: t?.complex_id || '',
        };
    });
};

const filterSyntheticTasks = (tasks) => {
    if (!tasks) return [];  // Проверка на null/undefined
    return tasks.filter(t => {
        if (!t || !t.name) return false;
        // Фильтруем синтетические задачи по флагу, а не по имени
        if (t.is_synthetic) return false;
        // убираем чисто временные строки типа (~12 мин)
        if (/^\(~\d+\s*мин\)/i.test((t.name || '').toLowerCase())) return false;
        return true;
    });
};

describe('normalizeTasks', () => {
    test('should normalize string tasks', () => {
        const tasks = ['Task 1', 'Task 2'];
        const result = normalizeTasks(tasks);
        
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({
            name: 'Task 1',
            is_completed: false,
            is_synthetic: false
        });
    });

    test('should preserve is_synthetic flag from object', () => {
        const tasks = [
            { name: 'Python Basics', is_synthetic: false, complex_id: 'python' },
            { name: 'Daily Mix', is_synthetic: true, complex_id: 'daily_mix' }
        ];
        const result = normalizeTasks(tasks);
        
        expect(result[0].is_synthetic).toBe(false);
        expect(result[1].is_synthetic).toBe(true);
    });

    test('should default is_synthetic to false if missing', () => {
        const tasks = [
            { name: 'Math', complex_id: 'math' }  // no is_synthetic field
        ];
        const result = normalizeTasks(tasks);
        
        expect(result[0].is_synthetic).toBe(false);
    });

    test('should handle undefined/null complex_id', () => {
        const tasks = [
            { name: 'Task 1' },
            { name: 'Task 2', complex_id: undefined }
        ];
        const result = normalizeTasks(tasks);
        
        expect(result[0].complex_id).toBe('');
        expect(result[1].complex_id).toBe('');
    });

    test('should handle empty tasks array', () => {
        const result = normalizeTasks([]);
        expect(result).toEqual([]);
    });

    test('should handle null/undefined tasks', () => {
        expect(normalizeTasks(null)).toEqual([]);
        expect(normalizeTasks(undefined)).toEqual([]);
    });
});

describe('filterSyntheticTasks', () => {
    test('should filter out synthetic tasks by flag', () => {
        const tasks = [
            { name: 'Python', is_synthetic: false },
            { name: 'Daily Mix', is_synthetic: true },
            { name: 'English', is_synthetic: false }
        ];
        const result = filterSyntheticTasks(tasks);
        
        expect(result).toHaveLength(2);
        expect(result.map(t => t.name)).toEqual(['Python', 'English']);
    });

    test('should NOT filter real task with "повторение" in name', () => {
        // IMPORTANT: Старый код фильтровал бы это!
        const tasks = [
            { name: 'Повторение грамматики', is_synthetic: false, complex_id: 'grammar' }
        ];
        const result = filterSyntheticTasks(tasks);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Повторение грамматики');
    });

    test('should NOT filter real task with "изучение" in name', () => {
        const tasks = [
            { name: 'Изучение истории', is_synthetic: false, complex_id: 'history' }
        ];
        const result = filterSyntheticTasks(tasks);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Изучение истории');
    });

    test('should NOT filter task named like Daily Mix if is_synthetic=false', () => {
        const tasks = [
            { name: 'Daily Mix Challenge', is_synthetic: false, complex_id: 'custom_mix' }
        ];
        const result = filterSyntheticTasks(tasks);
        
        // Should NOT be filtered because is_synthetic is false!
        expect(result).toHaveLength(1);
    });

    test('should filter time-duration strings like (~12 мин)', () => {
        const tasks = [
            { name: '(~12 мин)', is_synthetic: false },
            { name: '(~30 мин)', is_synthetic: false },
            { name: 'Real Task', is_synthetic: false }
        ];
        const result = filterSyntheticTasks(tasks);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Real Task');
    });

    test('should handle null/undefined tasks', () => {
        expect(filterSyntheticTasks(null)).toEqual([]);
        expect(filterSyntheticTasks(undefined)).toEqual([]);
    });

    test('should filter out tasks with missing name', () => {
        const tasks = [
            { name: '', is_synthetic: false },
            { is_synthetic: false },
            { name: 'Valid', is_synthetic: false }
        ];
        const result = filterSyntheticTasks(tasks);
        
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Valid');
    });

    test('should handle tasks without is_synthetic field (defaults to false)', () => {
        const tasks = [
            { name: 'Task 1' },  // no is_synthetic field
            { name: 'Task 2', is_synthetic: false },
            { name: 'Task 3', is_synthetic: true }
        ];
        const result = filterSyntheticTasks(tasks);
        
        // Task 1 and 2 should pass (is_synthetic is falsy for both)
        expect(result).toHaveLength(2);
    });
});

describe('Integration: normalizeTasks -> filterSyntheticTasks', () => {
    test('should normalize then filter correctly', () => {
        const rawTasks = [
            { name: 'Python Basics', complex_id: 'python', is_synthetic: false },
            { name: 'Daily Mix', complex_id: 'daily_mix', is_synthetic: true },
            { name: 'English Grammar', complex_id: 'english', is_synthetic: false }
        ];
        
        const normalized = normalizeTasks(rawTasks);
        const filtered = filterSyntheticTasks(normalized);
        
        expect(filtered).toHaveLength(2);
        expect(filtered.map(t => t.name)).toEqual(['Python Basics', 'English Grammar']);
    });

    test('should handle empty result after filtering', () => {
        const rawTasks = [
            { name: 'Daily Mix 1', is_synthetic: true },
            { name: 'Daily Mix 2', is_synthetic: true }
        ];
        
        const normalized = normalizeTasks(rawTasks);
        const filtered = filterSyntheticTasks(normalized);
        
        expect(filtered).toHaveLength(0);
    });

    test('CRITICAL: should not filter real tasks even with old names', () => {
        // Это критично для backwards compatibility
        const rawTasks = [
            { name: 'Повторение материала', complex_id: 'repeat1', is_synthetic: false },
            { name: 'Изучение нового', complex_id: 'study1', is_synthetic: false },
            { name: 'Daily Mix старого типа', complex_id: 'old_mix', is_synthetic: false }
        ];
        
        const normalized = normalizeTasks(rawTasks);
        const filtered = filterSyntheticTasks(normalized);
        
        expect(filtered).toHaveLength(3);
    });
});
