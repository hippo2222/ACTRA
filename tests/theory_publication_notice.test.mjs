import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function loadTheoryPublicationHelpers() {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/Editor/theory_editor.js'),
    'utf8'
  );
  const match = source.match(
    /function parseTheoryPublicationTimestamp\(value\) \{[\s\S]*?function updateTheoryPublicationControls\(\) \{/m
  );

  if (!match) {
    throw new Error('Could not extract theory publication helpers');
  }

  const helperSource = match[0].replace(/\nfunction updateTheoryPublicationControls\(\) \{$/, '');
  const factory = new Function(`
    const wt = (k, f) => f || k;
    const theoryEditorState = { activeItem: null, publicationItem: null };
    function resolveTheoryPublication(item = null) {
      return item?.publication || theoryEditorState.publicationItem || null;
    }
    ${helperSource}
    return {
      setState(next) {
        theoryEditorState.activeItem = next.activeItem || null;
        theoryEditorState.publicationItem = next.publicationItem || null;
      },
      getTheoryPublicationSyncState,
      getTheoryPublicationNotice,
    };
  `);
  return factory();
}

describe('theory publication notice helpers', () => {
  it('marks a saved theory without publication as unpublished', () => {
    const helpers = loadTheoryPublicationHelpers();
    helpers.setState({
      activeItem: {
        id: 'theory-1',
        updated_at: '2026-04-16T10:00:00Z',
      },
    });

    expect(helpers.getTheoryPublicationSyncState()).toBe('unpublished');
    expect(helpers.getTheoryPublicationNotice().kind).toBe('unpublished');
  });

  it('marks a newer saved theory as needing publication refresh', () => {
    const helpers = loadTheoryPublicationHelpers();
    helpers.setState({
      activeItem: {
        id: 'theory-1',
        updated_at: '2026-04-16T10:05:00Z',
      },
      publicationItem: {
        item_id: 'catalog-theory-1',
        latest_published_at: '2026-04-16T10:00:00Z',
      },
    });

    expect(helpers.getTheoryPublicationSyncState()).toBe('stale');
    expect(helpers.getTheoryPublicationNotice().kind).toBe('stale');
  });
});
