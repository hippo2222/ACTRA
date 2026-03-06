# Final Release Checklist v1.1.0

## Pre-Publish

- [ ] Confirm target commit and branch are correct.
- [ ] Confirm `v1.1.0` points to the intended release commit.
- [ ] Run `npm run smoke:release:gate`.
- [ ] Confirm local `git status` is clean before packaging.
- [ ] Verify the packaged app starts on a clean machine/profile.
- [ ] Verify `Welcome`, `Main`, `Complexes`, `Editor`, `S1`, `S3`, `Statistics`, `Settings`, and `Microcards` open without console/runtime breakage.
- [ ] Verify one real end-to-end flow: `Theory Hub -> training -> results -> return to Theory Hub`.
- [ ] Verify one real editor archive roundtrip: export -> delete -> import -> restored.
- [ ] Verify release notes and GitHub release text are ready.

## Publish

- [ ] Push release branch.
- [ ] Push release tag `v1.1.0`.
- [ ] Create GitHub Release from tag `v1.1.0`.
- [ ] Paste the body from `reports/github_release_body_v1.1.0_20260306.md`.
- [ ] Attach packaged build artifacts if applicable.

## Post-Publish

- [ ] Install the release artifact from scratch and smoke it once.
- [ ] Watch the first real user sessions closely.
- [ ] Track import/export issues, theory-sync issues, and session recovery issues first.
- [ ] Keep `npm run smoke:release:gate` as the required gate for every next release.

## Known Non-Blockers

- Product polish can continue after release.
- Generated local smoke/data artifacts must stay out of git history.
- Future improvements remain for deeper analytics, richer conflict resolution, and extended import/export ergonomics.
