import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function loadLinkedLibraryMergeHelpers() {
  const html = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/Complexes/index.html'),
    'utf8'
  );
  const match = html.match(
    /function mergeWorkspaceAndLinkedComplexItems\(workspaceItems, linkedItems\) \{[\s\S]*?async function fetchLinkedComplexLibraryItemsForList\(\) \{/m
  );

  if (!match) {
    throw new Error('Could not extract linked library merge helpers from frontend/Complexes/index.html');
  }

  const source = match[0].replace(/\n\s*async function fetchLinkedComplexLibraryItemsForList\(\) \{$/, '');
  const factory = new Function(`
    function normalizeComplexId(value) {
      if (value === null || value === undefined) return "";
      return String(value);
    }
    function getLinkedLibraryEntryId(complex) {
      return String(complex?.linked_library_entry_id || complex?.library_entry_id || "").trim();
    }
    ${source}
    return { mergeWorkspaceAndLinkedComplexItems };
  `);
  return factory();
}

describe('Complex linked library list merge', () => {
  const { mergeWorkspaceAndLinkedComplexItems } = loadLinkedLibraryMergeHelpers();

  it('appends linked library complexes after workspace complexes', () => {
    const merged = mergeWorkspaceAndLinkedComplexItems(
      [{ id: 'own-complex', name: 'Own' }],
      [{ id: 'linked_library__abc', linked_library_entry_id: 'complex_library::catalog::reader' }]
    );

    expect(merged.map((item) => item.id)).toEqual(['own-complex', 'linked_library__abc']);
  });

  it('deduplicates linked complexes by runtime id and library entry id', () => {
    const merged = mergeWorkspaceAndLinkedComplexItems(
      [{ id: 'linked_library__abc', linked_library_entry_id: 'complex_library::catalog::reader' }],
      [
        { id: 'linked_library__abc', linked_library_entry_id: 'complex_library::catalog::reader' },
        { id: 'linked_library__other', linked_library_entry_id: 'complex_library::catalog::reader' },
        { id: 'linked_library__fresh', linked_library_entry_id: 'complex_library::fresh::reader' },
      ]
    );

    expect(merged.map((item) => item.id)).toEqual(['linked_library__abc', 'linked_library__fresh']);
  });
});
