import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function loadCatalogListHelpers() {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'frontend/Catalog/catalog.js'),
    'utf8'
  );
  const match = source.match(
    /function getCurrentCatalogUserId\(\) \{[\s\S]*?function mapSavedComplexEntryToItem\(entry\) \{/m
  );

  if (!match) {
    throw new Error('Could not extract catalog list helpers from frontend/Catalog/catalog.js');
  }

  const helperSource = match[0].replace(/\n\s*function mapSavedComplexEntryToItem\(entry\) \{$/, '');
  const factory = new Function(`
    const state = { currentUser: null, query: '', contentType: 'all' };
    function asString(value) { return String(value == null ? '' : value).trim(); }
    ${helperSource}
    return {
      state,
      getCurrentCatalogUserId,
      buildPublicListUrl,
    };
  `);
  return factory();
}

describe('Catalog visibility merge helpers', () => {
  const { state, buildPublicListUrl } = loadCatalogListHelpers();

  it('builds public catalog url for authenticated user', () => {
    state.currentUser = { user_id: 'user_demo' };
    state.query = 'mammography';
    state.contentType = 'complex';

    expect(buildPublicListUrl()).toBe('/api/catalog/items?q=mammography&content_type=complex');
  });

  it('builds public catalog url when user is missing', () => {
    state.currentUser = null;
    state.query = '';
    state.contentType = 'all';

    expect(buildPublicListUrl()).toBe('/api/catalog/items');
  });

  it('keeps own-author label literals in ascii-safe unicode escapes', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'frontend/Catalog/catalog.js'),
      'utf8'
    );

    expect(source).toContain("return '\\u0412\\u044b';");
    expect(source).toContain("|| '\\u041d\\u0435 \\u0443\\u043a\\u0430\\u0437\\u0430\\u043d';");
  });
});
