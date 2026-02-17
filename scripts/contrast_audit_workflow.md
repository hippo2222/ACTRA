# Contrast Audit Workflow

## One-command automated run

Run full theme audit for S1/S2/S3 + S1 state matrix:

```bash
npm run audit:contrast:auto
```

Optional base URL override:

```bash
node scripts/run_contrast_suite.js --base-url http://127.0.0.1:8000
```

## Individual runs

Base pages (S1 coverage + S2 + S3):

```bash
node scripts/contrast_audit.js --config scripts/contrast_audit.config.json
```

S1 state matrix only:

```bash
node scripts/contrast_audit.js --config scripts/contrast_audit.s1_state_matrix.config.json
```

## S1 state matrix scenarios

Configured in `scripts/contrast_audit.s1_state_matrix.config.json`:

- `answering`
- `review success`
- `review failure`
- `pause modal`
- `resume modal`

The matrix uses:

- active session auto-discovery (`autoSession`)
- auto-create session fallback when active list is empty
- shared session reuse between pages (`usePreviousSession`)
- strict UI-guide contrast mode (`strictAA`, `uiGuideStrict`)
- state simulation (`hover`, `focus`, `active`, `disabled`, `data-active=true`)

## URL placeholders

Configs support session placeholders in page URLs:

- `{sessionId}`
- `:sessionId`
- `__SESSION_ID__`
- `session_auto_placeholder`

`scripts/contrast_audit.js` resolves `autoSession` and replaces placeholders automatically.
