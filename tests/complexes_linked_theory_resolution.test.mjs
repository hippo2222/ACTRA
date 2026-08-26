import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function loadLinkedTheoryHelpers() {
  const html = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/Complexes/complexes.js'),
    'utf8'
  );
  const match = html.match(
    /function rebuildTheoryLibraryEntryIndex\(entries\) \{[\s\S]*?function getAccessCodeValue\(item\) \{/m
  );

  if (!match) {
    throw new Error('Could not extract linked theory helpers from frontend/Complexes/complexes.js');
  }

  const source = match[0].replace(/\n\s*function getAccessCodeValue\(item\) \{$/, '');
  const factory = new Function(`
    const theoryLibraryEntryByCatalogItemId = new Map();
    const theoryLibraryEntryBySourceTheoryId = new Map();
    ${source}
    return {
      rebuildTheoryLibraryEntryIndex,
      resolveCurrentUserLinkedTheoryLink,
      canUseEmbeddedTheorySnapshotAsPrimaryLinkedSource,
      resolvePreferredComplexTheoryLink,
    };
  `);
  return factory();
}

describe('Complex linked theory resolution', () => {
  const {
    rebuildTheoryLibraryEntryIndex,
    resolveCurrentUserLinkedTheoryLink,
    canUseEmbeddedTheorySnapshotAsPrimaryLinkedSource,
    resolvePreferredComplexTheoryLink,
  } = loadLinkedTheoryHelpers();

  it('rebinds linked theory to the current user library entry by catalog item id', () => {
    rebuildTheoryLibraryEntryIndex([
      {
        library_entry: {
          library_entry_id: 'theory_library::user_entry::123',
          access_state: 'active',
          access_reason: 'Linked for current user',
        },
        item: {
          item_id: 'catalog_theory_demo',
          source_workspace_id: 'th_demo',
        },
      },
    ]);

    const resolved = resolveCurrentUserLinkedTheoryLink({
      source_kind: 'linked_library',
      library_entry_id: 'theory_library::author_entry::999',
      catalog_item_id: 'catalog_theory_demo',
      source_theory_id: 'th_demo',
      access_state: 'active',
    });

    expect(resolved.library_entry_id).toBe('theory_library::user_entry::123');
    expect(resolved.catalog_item_id).toBe('catalog_theory_demo');
    expect(resolved.source_theory_id).toBe('th_demo');
  });

  it('leaves workspace theory links untouched', () => {
    const resolved = resolveCurrentUserLinkedTheoryLink({
      theory_id: 'th_workspace',
      source_kind: 'workspace',
    });

    expect(resolved.theory_id).toBe('th_workspace');
    expect(resolved.library_entry_id).toBeUndefined();
  });

  it('falls back to the embedded theory only for embedded-only linked publications', () => {
    rebuildTheoryLibraryEntryIndex([]);

    const resolved = resolvePreferredComplexTheoryLink(
      {
        source_kind: 'linked_library',
        library_entry_id: 'theory_library::author_entry::999',
        source_theory_id: 'th_embedded',
        title_cache: 'Embedded theory',
      },
      [
        {
          theoryId: 'th_embedded',
          title: 'Embedded theory',
          updated_at: '2026-04-14T20:00:00Z',
        },
      ]
    );

    expect(resolved.theory_id).toBe('th_embedded');
    expect(resolved.library_entry_id).toBeUndefined();
    expect(resolved.title_cache).toBe('Embedded theory');
  });

  it('recognizes when an embedded theory snapshot may stay primary', () => {
    rebuildTheoryLibraryEntryIndex([]);

    expect(
      canUseEmbeddedTheorySnapshotAsPrimaryLinkedSource(
        {
          source_kind: 'linked_library',
          library_entry_id: 'theory_library::author_entry::999',
          source_theory_id: 'th_embedded',
        },
        [{ theoryId: 'th_embedded', title: 'Embedded theory' }]
      )
    ).toBe(true);
  });

  it('does not fall back to embedded theory when a linked publication has catalog item binding but no current-user entry', () => {
    rebuildTheoryLibraryEntryIndex([]);

    const resolved = resolvePreferredComplexTheoryLink(
      {
        source_kind: 'linked_library',
        library_entry_id: 'theory_library::author_entry::999',
        catalog_item_id: 'catalog_theory_demo',
        source_theory_id: 'th_embedded',
        title_cache: 'Embedded theory',
        missing: true,
      },
      [
        {
          theoryId: 'th_embedded',
          title: 'Embedded theory',
          updated_at: '2026-04-14T20:00:00Z',
        },
      ]
    );

    expect(resolved.library_entry_id).toBe('theory_library::author_entry::999');
    expect(resolved.catalog_item_id).toBe('catalog_theory_demo');
    expect(resolved.theory_id).toBeUndefined();
    expect(resolved.missing).toBe(true);
  });
});
