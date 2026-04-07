import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function loadComplexSortHelpers() {
    const html = fs.readFileSync(
        path.resolve(process.cwd(), 'frontend/Complexes/index.html'),
        'utf8'
    );
    const match = html.match(
        /const VALID_COMPLEX_SORT_KEYS = new Set\([\s\S]*?function updateSortUi\(\) \{/m
    );

    if (!match) {
        throw new Error('Could not extract complex sort helpers from frontend/Complexes/index.html');
    }

    const source = match[0].replace(/\n\s*function updateSortUi\(\) \{$/, '');
    const factory = new Function(`${source}; return { normalizeComplexSortKey, sortComplexItems };`);
    return factory();
}

describe('Complexes sorting helpers', () => {
    const { normalizeComplexSortKey, sortComplexItems } = loadComplexSortHelpers();

    it('falls back to name-asc for unsupported sort keys', () => {
        expect(normalizeComplexSortKey('broken-sort')).toBe('name-asc');
        expect(normalizeComplexSortKey('date-desc')).toBe('date-desc');
    });

    it('sorts by date deterministically and keeps empty timestamps at the end', () => {
        const items = [
            { id: 'b', name: 'Бета', updated_at: '2026-04-02T12:00:00Z' },
            { id: 'a', name: 'Альфа', updated_at: '2026-04-02T12:00:00Z' },
            { id: 'c', name: 'Гамма', created_at: '2026-03-01T09:00:00Z' },
            { id: 'd', name: 'Дельта' },
        ];

        expect(sortComplexItems(items, 'date-desc').map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
        expect(sortComplexItems(items, 'date-asc').map((item) => item.id)).toEqual(['c', 'a', 'b', 'd']);
    });

    it('uses stable name tie-breakers for tasks sorting', () => {
        const items = [
            { id: 'z', name: 'Зета', tasks: [1, 2] },
            { id: 'a', name: 'Альфа', tasks: [1, 2] },
            { id: 'm', name: 'Мю', tasks: [1] },
        ];

        expect(sortComplexItems(items, 'tasks-desc').map((item) => item.id)).toEqual(['a', 'z', 'm']);
    });
});
