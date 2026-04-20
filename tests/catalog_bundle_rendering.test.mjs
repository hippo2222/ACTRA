import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function loadCatalogBundleHelpers() {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/Catalog/catalog.js'),
    'utf8'
  );
  const match = source.match(
    /function buildCatalogRenderEntries\(items\) \{[\s\S]*?\n  function createCatalogCardElement/m
  );

  if (!match) {
    throw new Error('Could not extract catalog bundle helpers from frontend/Catalog/catalog.js');
  }

  const helperSource = match[0].replace(/\n\s*function createCatalogCardElement[\s\S]*$/, '');
  const factory = new Function(`
    const state = { contentType: 'all' };
    function asString(value) { return String(value == null ? '' : value).trim(); }
    ${helperSource}
    return {
      state,
      buildCatalogRenderEntries,
    };
  `);
  return factory();
}

describe('Catalog bundle rendering helpers', () => {
  const { state, buildCatalogRenderEntries } = loadCatalogBundleHelpers();

  it('groups a linked public complex and theory into one bundle in all filter', () => {
    state.contentType = 'all';
    const entries = buildCatalogRenderEntries([
      {
        item_id: 'theory-1',
        content_type: 'theory',
        title: 'Theory first in sort order',
        bundle: { role: 'theory', paired_item_id: 'complex-1', bundle_id: 'bundle-1' },
      },
      {
        item_id: 'complex-1',
        content_type: 'complex',
        title: 'Complex second in sort order',
        bundle: { role: 'complex', paired_item_id: 'theory-1', bundle_id: 'bundle-1' },
      },
      {
        item_id: 'theory-standalone',
        content_type: 'theory',
        title: 'Standalone theory',
      },
    ]);

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: 'bundle',
      bundleId: 'bundle-1',
      complexItem: { item_id: 'complex-1' },
      theoryItem: { item_id: 'theory-1' },
    });
    expect(entries[1]).toMatchObject({
      kind: 'single',
      item: { item_id: 'theory-standalone' },
    });
  });

  it('keeps items separate when filtering only theories', () => {
    state.contentType = 'theory';
    const entries = buildCatalogRenderEntries([
      {
        item_id: 'theory-1',
        content_type: 'theory',
        title: 'Theory',
        bundle: { role: 'theory', paired_item_id: 'complex-1', bundle_id: 'bundle-1' },
      },
      {
        item_id: 'complex-1',
        content_type: 'complex',
        title: 'Complex',
        bundle: { role: 'complex', paired_item_id: 'theory-1', bundle_id: 'bundle-1' },
      },
    ]);

    expect(entries).toEqual([
      {
        kind: 'single',
        item: expect.objectContaining({ item_id: 'theory-1' }),
      },
      {
        kind: 'single',
        item: expect.objectContaining({ item_id: 'complex-1' }),
      },
    ]);
  });

  it('does not bundle a theory linked to multiple complexes', () => {
    state.contentType = 'all';
    const entries = buildCatalogRenderEntries([
      {
        item_id: 'theory-shared',
        content_type: 'theory',
        title: 'Shared theory',
        linked_complex_count: 2,
      },
      {
        item_id: 'complex-1',
        content_type: 'complex',
        title: 'Complex one',
      },
    ]);

    expect(entries).toEqual([
      {
        kind: 'single',
        item: expect.objectContaining({ item_id: 'theory-shared' }),
      },
      {
        kind: 'single',
        item: expect.objectContaining({ item_id: 'complex-1' }),
      },
    ]);
  });
});
