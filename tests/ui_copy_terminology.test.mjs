import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function readText(relativePath) {
  const fullPath = path.resolve(process.cwd(), relativePath);
  return fs.readFileSync(fullPath).toString('utf8');
}

describe('ui terminology cleanup', () => {
  it('does not expose outdated personal-copy wording in active ui flows', () => {
    const files = [
      'frontend/assets/WorkspaceImportClient.js',
      'frontend/Catalog/catalog.js',
      'frontend/Complexes/create.html',
      'frontend/Complexes/index.html',
      'frontend/Editor/dashboard.js',
      'frontend/Editor/import_manager.js',
      'frontend/Editor/theory_center.js',
    ];
    const forbiddenPhrases = [
      /Личная копия/i,
      /личная копия/i,
      /Моя копия/i,
      /Локальная копия/i,
      /Workspace-копия/i,
      /personal copy/i,
      /Preview copy/i,
      /Preview import/i,
    ];

    files.forEach((file) => {
      const source = readText(file);
      forbiddenPhrases.forEach((phrase) => {
        expect(source).not.toMatch(phrase);
      });
    });
  });

  it('marks legacy workspace-import provenance explicitly', () => {
    const createPage = readText('frontend/Complexes/create.html');
    const complexIndex = readText('frontend/Complexes/index.html');
    const theoryCenter = readText('frontend/Editor/theory_center.js');
    const workspaceClient = readText('frontend/assets/WorkspaceImportClient.js');

    expect(workspaceClient).toContain('Legacy import');
    expect(createPage).toContain('Legacy import is internal-only and no longer available from this screen.');
    expect(complexIndex).toContain('Legacy import');
    expect(theoryCenter).toContain('Legacy import');
  });
});
