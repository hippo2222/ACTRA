# Git Root Recovery

If you see messages like "not a git repository" in `d:\Ai Ai\radioproject`, this folder currently has no `.git`.

## Option 1 (Recommended): keep remote history

1. Clone official repo into a clean directory.
2. Copy local changes into that clone.
3. Commit and push from the cloned repo.

Quick template:

```powershell
git clone <REMOTE_URL> "..\radioproject_git"
robocopy "d:\Ai Ai\radioproject" "..\radioproject_git" /E /XD .git node_modules .venv dist build logs /XF coverage.xml
cd "..\radioproject_git"
git status
git add .
git commit -m "Initial local snapshot"
git push
```

## Option 2: local git only (no prior history)

Use helper script:

```powershell
cd "d:\Ai Ai\radioproject"
.\scripts\fix_git_root.ps1 -Mode init-local
```

Optional remote setup:

```powershell
.\scripts\fix_git_root.ps1 -Mode init-local -RemoteUrl "<REMOTE_URL>"
```

## Helper script modes

- `show-clone-plan`: prints safer migration steps (default)
- `init-local`: initializes `.git`, adds files, and commits snapshot

Run:

```powershell
.\scripts\fix_git_root.ps1
```

