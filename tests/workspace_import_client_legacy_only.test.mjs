import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

function readText(relativePath) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

describe('WorkspaceImportClient legacy-only gating', () => {
  it('hard-disables workspace-copy actions and keeps explicit legacy labels', () => {
    const source = readText('frontend/assets/WorkspaceImportClient.js');

    expect(source).toContain("if (normalized === 'workspace_import') return 'Legacy import';");
    expect(source).toContain("if (normalized === 'archive_import') return 'Legacy import';");
    expect(source).toContain('return false;');
  });
});
