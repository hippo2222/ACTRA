import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function loadAddByCodeHelpers() {
  const html = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/Complexes/index.html'),
    'utf8'
  );
  const match = html.match(
    /function countComplexAddRelatedTheoryEntries\(payload = \{\}\) \{[\s\S]*?function getCatalogItemTaskCount\(item = \{\}\) \{/m
  );

  if (!match) {
    throw new Error('Could not extract add-by-code helpers from frontend/Complexes/index.html');
  }

  const source = match[0].replace(/\n\s*function getCatalogItemTaskCount\(item = \{\}\) \{$/, '');
  const factory = new Function(`${source}; return { countComplexAddRelatedTheoryEntries, summarizeComplexAddByCodeResult };`);
  return factory();
}

describe('Complex add-by-code helpers', () => {
  const { countComplexAddRelatedTheoryEntries, summarizeComplexAddByCodeResult } = loadAddByCodeHelpers();

  it('counts related theory linked entries from add-to-library payload', () => {
    expect(countComplexAddRelatedTheoryEntries({ related_theory_library_entries: [{}, {}] })).toBe(2);
    expect(countComplexAddRelatedTheoryEntries({ related_theory_library_entries: [] })).toBe(0);
    expect(countComplexAddRelatedTheoryEntries({})).toBe(0);
  });

  it('surfaces attached theory sync in success summary', () => {
    const summary = summarizeComplexAddByCodeResult({
      created: true,
      related_theory_library_entries: [{ created: true }],
    });

    expect(summary.severity).toBe('success');
    expect(summary.what).toContain('Комплекс');
    expect(summary.impact).toContain('Связанная теория автора');
  });

  it('explains when no theory was attached to the publication', () => {
    const summary = summarizeComplexAddByCodeResult({
      created: true,
      related_theory_library_entries: [],
    });

    expect(summary.impact).toContain('нет прикреплённой теории');
  });
});
