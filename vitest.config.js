import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        exclude: [
            'node_modules/**',
            'BackupArchiveFiles/**',
            '.venv/**',
            // Untracked nested agent worktrees — not part of the active project
            'radioproject_git/**'
        ]
    }
});
