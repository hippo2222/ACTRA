import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function loadComplexPublicationHelpers() {
  const html = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/Complexes/create.html'),
    'utf8'
  );
  const match = html.match(
    /function parseComplexPublicationTimestamp\(value\) \{[\s\S]*?function updateComplexPublishUi\(\) \{/m
  );

  if (!match) {
    throw new Error('Could not extract complex publication helpers');
  }

  const helperSource = match[0].replace(/\n\s*function updateComplexPublishUi\(\) \{$/, '');
  const factory = new Function(`
    const wt = (k, f) => f || k;
    const state = {
      editingId: '',
      currentVersion: null,
      publication: { item: null },
    };
    function asCleanString(value) {
      return String(value || '').trim();
    }
    function getCurrentComplexPublication() {
      return state.publication.item || null;
    }
    function getCatalogVisibilityLabel(value) {
      return String(value || '').trim() || 'public';
    }
    ${helperSource}
    return {
      setState(next) {
        state.editingId = next.editingId || '';
        state.currentVersion = next.currentVersion || null;
        state.publication.item = next.publicationItem || null;
      },
      getComplexPublicationNotice,
    };
  `);
  return factory();
}

describe('complex publication notice helpers', () => {
  it('marks a saved complex without publication as unpublished', () => {
    const helpers = loadComplexPublicationHelpers();
    helpers.setState({
      editingId: 'complex-1',
      currentVersion: '2026-04-16T10:00:00Z',
    });

    expect(helpers.getComplexPublicationNotice().kind).toBe('unpublished');
  });

  it('marks a newer saved complex as stale relative to publication', () => {
    const helpers = loadComplexPublicationHelpers();
    helpers.setState({
      editingId: 'complex-1',
      currentVersion: '2026-04-16T10:05:00Z',
      publicationItem: {
        item_id: 'catalog-complex-1',
        latest_published_at: '2026-04-16T10:00:00Z',
        catalog_visibility: 'public',
      },
    });

    expect(helpers.getComplexPublicationNotice().kind).toBe('stale');
  });
});
