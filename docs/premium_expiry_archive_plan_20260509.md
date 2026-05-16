# Premium Expiry Archive Plan (2026-05-09)

## Goal

Define and implement what happens when a user loses Premium while their workspace already exceeds free-plan limits.

The policy must be predictable for the author, must not silently delete content, and must preserve the existing catalog ownership rule: if an author deletes their published source complex, the publication is no longer available to other users.

## Current Ground Truth

- `resolve_effective_plan(user)` already turns an expired timed Premium into `free` when `premium_expires_at` is in the past.
- `WorkspaceLimitsService` already blocks new creation/import for free users above limits:
  - tasks: `20` personal tasks;
  - theories: `5` personal, `10` workspace + linked-library total;
  - complexes: `5` personal, `10` workspace + linked-library total.
- Published catalog content is represented as `CatalogItem` + immutable `CatalogVersion` snapshot.
- Other users add published complexes through their own `complex_library_entry`.
- Existing catalog access states already include `active`, `requires_access_code`, `revoked`, and `deleted_source`.
- Known gap: `DELETE /api/complexes/<id>` currently deletes the workspace complex and local session state, but does not explicitly revoke/remove the matching catalog publication.

## Product Rules

1. Premium expiry never deletes user content.
2. Premium expiry does not automatically unpublish content.
3. If a free user is above a limit, excess entities become `premium_archived`.
4. Archived entities remain visible to their owner and can be opened for read-only inspection and deleted.
5. Archived entities cannot be edited, started, published, republished, used as new dependencies, imported, copied, or added to another object.
6. Free overage is resolved only by deleting excess content or restoring Premium.
7. Archive is not a separate product area. It is integrated into the existing entity pages, especially `Complexes`, with filters/badges.
8. If the author deletes a published workspace complex, its catalog publication is revoked/removed from public access, and other users lose access to that linked publication.
9. Other users should not lose access merely because the author's Premium expired. They lose access only when the author explicitly deletes/unpublishes the source or changes visibility to a locked state.

## Archive Selection

For each limited entity kind, free-plan active slots are assigned deterministically:

- sort owner-created personal items by `created_at ASC`, then stable id/ref `ASC`;
- keep the first free-limit items active;
- mark newer items beyond the free limit as `premium_archived`.

For library-total limits on complexes/theories:

- apply the same deterministic ordering across the user's workspace items and linked-library entries;
- entries beyond the free library limit become `premium_archived` for that user;
- archived linked-library entries remain listed but cannot be opened/started until Premium is restored or the user removes enough entries.

## Access Matrix

| Action | Active | Premium archived |
| --- | --- | --- |
| List | yes | yes |
| View details/read-only | yes | yes |
| Delete/remove from own library | yes | yes |
| Edit | yes | no |
| Start training/pass complex | yes | no |
| Publish/republish | yes | no |
| Expand publication visibility/access code | yes | no |
| Narrow publication visibility/unpublish by setting private | yes | yes, when a publication already exists |
| Copy/fork/import/add as dependency | yes | no |

Archived-action failures should return `409 premium_archived_content` with a structured payload:

- `entity_kind`;
- `entity_id` or ref;
- `plan`;
- `limit_kind`;
- `message`;
- `resolution_actions: ["delete_excess", "restore_premium"]`.

## Publication And Deletion Semantics

### Premium Expired, Publication Exists

- Publication remains in its previous visibility state.
- Existing readers keep access if the publication remains `public` or they have valid access-code state.
- New readers may still add the publication if:
  - catalog visibility allows it;
  - the reader's own limits allow it.
- The author cannot publish a new version from an archived workspace source.
- The author cannot expand visibility from an archived workspace source (`private -> access_code/public`, `access_code -> public`).
- The author can narrow visibility from an archived workspace source (`public -> access_code/private`, `access_code -> private`) so Premium never forces an author to keep content broadly available.

### Author Deletes Published Complex

Deleting the source workspace complex must also update catalog state.

Target behavior:

- public catalog listing no longer shows the item;
- existing `complex_library_entry` rows for other users resolve as `deleted_source` or `revoked`;
- linked-library detail returns no runnable snapshot;
- reader UI shows a clear unavailable state with an action to remove the dead entry from their library;
- active/paused sessions for that linked publication are invalidated or fail cleanly with a source-deleted message.

This is an explicit owner action and is different from Premium expiry.

### Author Unpublishes Without Deleting

Use the existing visibility model:

- `private` removes public access;
- existing readers resolve to `revoked`;
- the item can remain restorable by the author if their workspace source is active and they have permission to manage publication.

## Main Page UX

When a user's Premium expires and their workspace is above free limits, show a main-page banner/card.

Required content:

- Premium ended and the account is now on Free.
- N complexes/tasks/theories or library entries are archived.
- Archived content is read-only and cannot be trained, edited, or republished.
- Existing publications remain available in their previous state. Authors can narrow or hide an existing publication, but cannot update the version or expand access until Premium is restored.
- Deleting an archived published complex will also remove its publication from the catalog and close access for other users.
- Primary action: open the relevant page with the archive filter.
- Secondary action: open Premium settings.

Suggested route targets:

- `/complexes?filter=archived`
- editor/dashboard archive filter for tasks
- theory center/editor archive filter for theories
- `/settings#premium`

## Complexes UI

Archive should be integrated into the existing `Complexes` page:

- Add filters/tabs: `Active`, `Archive`, `All`.
- Add an archive badge on archived cards.
- Disable start/edit/publish-version buttons for archived cards.
- If an archived card already has a publication, the publication dialog should explain that the source is archived, keep the current publication visible, allow only narrowing access, and block publishing a new version.
- Keep delete available.
- For archived published cards, delete confirmation must explicitly say:
  - the workspace complex will be deleted;
  - the catalog publication will be removed/revoked;
  - other users who added it will lose access.
- Workspace limit badge should show active count, archived count, and total/free limit.

Do not create a separate top-level Archive page for this iteration.

## Backend Implementation Plan

### Phase 1. Archive State Computation

- Extend `WorkspaceLimitsService` with a deterministic archive-state read model.
- Add helpers to annotate tasks, complexes, theories, and linked-library entries with:
  - `workspace_access_state`;
  - `is_premium_archived`;
  - `archive_reason`;
  - `allowed_actions`.
- Extend `/api/workspace-limits/summary` with:
  - `active_count`;
  - `archived_count`;
  - `overage_count`;
  - item refs for archived entities, capped for UI summaries.

### Phase 2. API Enforcement

- Add a shared guard for archived entities.
- Apply guard to:
  - complex update/start/publish/visibility routes;
  - task save/create/use-as-dependency flows;
  - theory update/publish/copy flows;
  - catalog add/fork/import flows where archived entities would be used.
- Preserve read/list/delete routes.

### Phase 3. Delete Publication Cascade

- Add catalog-service operation for source deletion, for example `handle_workspace_source_deleted(content_type, owner_user_id, source_workspace_id/ref)`.
- Wire `DELETE /api/complexes/<id>` to revoke/remove the matching catalog item before or immediately after workspace deletion.
- Ensure existing `complex_library_entry` records resolve as `deleted_source` or `revoked`.
- Invalidate active linked-library runtime sessions for affected catalog item/library entries.
- Add the same policy later for published theories if theory delete currently has the same gap.

### Phase 4. UI Surfacing

- Add main-page Premium-expired overage banner.
- Add archive filter/badges/actions to `Complexes`.
- Add unavailable-state rendering for reader-owned linked publications whose source was deleted/revoked.
- Add premium CTA and delete-excess CTA from all relevant blocked actions.

### Phase 5. Tests

Backend tests:

- expired timed Premium resolves to `free`;
- over-limit newest entities become `premium_archived`;
- archived entities can be read/listed/deleted but not edited/started/published;
- Premium restoration clears archive restrictions;
- deleting excess content recomputes archive state;
- author deleting a published complex revokes/removes catalog access for readers;
- Premium expiry alone does not revoke reader access.

Frontend/static tests:

- main page contains Premium-expired overage banner wiring;
- `Complexes` has archive filter and archived card state;
- archived published delete confirmation mentions catalog removal and other users losing access;
- linked-library revoked/deleted source states render as unavailable, not as broken blank cards.

## Rollout Order

1. Implement backend read-model and tests for archive state.
2. Enforce archived-action blocking on backend.
3. Implement delete-publication cascade for complexes.
4. Add UI archive surfaces and main-page banner.
5. Add reader-facing unavailable states.
6. Run hosted smoke gates for complex editor, catalog/library, linked theory/open flows, and main UI.

## Open Decisions

- Whether source deletion should physically delete catalog item rows or keep them with a `deleted_source`/`revoked` status. Preferred: keep rows for audit and reader-facing unavailable state.
- Whether archived linked-library entries should count toward free library total. Preferred: yes, because deleting/removing is the user's way to get below the limit.
- Whether admin/moderation deletion should differ from author deletion. Preferred: same reader outcome, but with separate audit reason.
