# Design: id-based shooter references

Date: 2026-06-15
Status: Approved (pending spec review)

## Problem

Journal rows (`skjuttillfallen`) store the shooter as free text in a `skytt`
column, and `skytt_faktura` is keyed by that name string. A member rename must
therefore be propagated by matching the old name across journal rows and the
invoice table — fragile (exact-string match, casing/whitespace drift) and the
source of a real bug where renamed views went stale until a hard refresh.

All shooters are registered members (decided during brainstorming), and only
test data currently exists, so we can start from a clean, normalized model:
reference the member by id and resolve the current name from the profile at
render time. Renames then require zero propagation.

## Decisions

- **Shooters are members only.** Every entry references a real member.
- **Pure normalized model (Approach A).** Drop the stored name; store
  `skytt_id` and resolve the name through a read-only directory.
- **Logging UX follows the approved self-register plan.** A regular member can
  only log themselves (id locked); admin/leader picks any member; revisor is
  read-only.
- **Keep the change small on member deletion.** No deactivate/active flow. The
  `skytt_id` foreign key uses `ON DELETE RESTRICT`, so a member with journal
  history simply cannot be hard-deleted. Member delete flow is otherwise
  unchanged.
- **No data migration.** Only test data exists; wipe and recreate.

## Data model

### `skjuttillfallen`
- Drop column `skytt` (text).
- Add column `skytt_id uuid not null references profiles(id) on delete restrict`.
- `created_by` (the logger) is unchanged. For self-logged member entries
  `skytt_id == created_by`; for admin/leader-logged entries they differ.

### `profiles`
- No schema change. (No `active` column — see deletion decision.)

### `skytt_faktura`
- Re-key from `skytt_namn text primary key` to
  `skytt_id uuid primary key references profiles(id) on delete restrict`.
- `email` (billing email, may differ from login email) and `faktura_skickad`
  are unchanged; they now hang off the member id.

### New view: `public.member_directory`
- `create view public.member_directory as select id, full_name from profiles;`
  (security-invoker is not enough because of profiles RLS — use a
  security-definer view or an equivalent broad select policy; expose **only**
  `id` and `full_name`, never `role` or email).
- Selectable by any authenticated user. This is the one new read exposure;
  acceptable because shooter names already appear in the shared session list.

### RLS / setup SQL (goes into `docs/supabase-setup.md`)
- Grant authenticated `select` on `member_directory`.
- `skjuttillfallen` and `skytt_faktura` write policies are unchanged in intent
  (revisor cannot write; created_by/admin for update/delete). Verify they
  reference no dropped columns.

## Client (`index.html`)

### Name resolution
- Add `loadDirectory()`: selects `id, full_name` from `member_directory` for
  **all** roles, builds a module-level `Map` `dirById` (`id -> full_name`).
  Called during `enterApp` before the first render, and refreshed after any
  member create/rename/delete.
- Add `nameOf(id)` helper returning the resolved name (fallback to a placeholder
  like `"(okänd)"` if an id is missing from the directory).
- Replace every read of `e.skytt` with `nameOf(e.skytt_id)`. Affected sites
  (current line numbers, will shift):
  - `renderLog` display (≈523)
  - `renderAdmin` shooter grouping + table (≈599, 612, 614–628)
  - `renderAdminTable` search filter + display (≈641, 647)
  - `compTotals` / `renderComp` / `renderTotals` grouping + display
    (≈762, 768, 788, 798)
  - CSV/XLSX exports (≈877, 888, 893)
  - faktura builder filter + `fakturaMeta` lookup (≈570, 615)
- Grouping that was keyed by name becomes keyed by `skytt_id`; the name is
  resolved only for display/sort.

### Logging form (quick-add, ≈809–829)
- Replace the free-text `#q-skytt` input with a role-aware control:
  - regular member: locked to self — display own name, set
    `row.skytt_id = own id`.
  - admin/leader: a `<select>` member picker over the directory; set
    `row.skytt_id` from the selection.
- `addRow` writes `skytt_id` instead of `skytt`.

### Edit modal (≈1076–1099)
- The existing `isAdmin` name field (currently a free-text input) becomes a
  member picker bound to `skytt_id`. Non-admins keep a read-only display.

### `fakturaMeta`
- Keyed by `skytt_id` instead of name throughout (load in `loadFakturaMeta`,
  lookups in `renderAdmin`, save/send handlers pass `skytt_id`).

## Edge functions

### `admin-members/index.ts`
- `update` action: **delete** all rename-propagation code (journal rename match,
  `skytt_faktura` rename + PK-collision merge). It becomes a plain
  `profiles.upsert({ id, full_name })` plus the existing email update. Return no
  `renamed` field (and remove the front-end's use of it — the
  `if(renamed>0){ loadAll(); loadFakturaMeta(); renderAll(); }` block and the
  banner suffix are no longer needed; a directory refresh + re-render covers it).
- `delete` action: unchanged. With `ON DELETE RESTRICT` the `profiles.delete`
  will error if the member has journal/faktura rows; surface that error message
  to the admin as-is.

### `send-invoice/index.ts`
- `meta`, `saveEmail`, `send`: switch the key from `skytt_namn` to `skytt_id`
  (uuid). `meta` returns `skytt_id, email, faktura_skickad`. Validation of the
  email is unchanged.

## Rename behaviour (the payoff)

A rename is `update profiles set full_name = …`. After the front-end refreshes
the directory and re-renders, every view shows the new name. No propagation, no
string matching, no stale-view bug class.

## Migration

Only test data exists, so:
1. `delete from skjuttillfallen;` and `delete from skytt_faktura;`
2. Alter `skjuttillfallen`: drop `skytt`, add `skytt_id` (FK, restrict).
3. Alter `skytt_faktura`: drop `skytt_namn` PK, add `skytt_id` PK (FK, restrict).
4. Create `member_directory` view + grant select to authenticated.
5. Redeploy both edge functions.
6. Bump `sw.js` VERSION.

No backfill.

## Testing / verification

- No test framework: `node --check` the inline `index.html` script and both
  edge functions; lint the SQL by running it in the Supabase SQL editor.
- Manual verification (per the project's verify-static-app practice):
  1. Admin logs an entry for member A via the picker → appears in log/admin.
  2. Member logs in → can only log themselves; sees own name locked.
  3. Revisor → read-only, names resolve.
  4. Admin renames member A → every view (log, admin table, Tävling, Total, Att
     betala) shows the new name **without a reload**.
  5. Send/track an invoice for A → faktura meta keyed by id survives a rename.
  6. Attempt to delete a member who has entries → blocked with a clear error.

## Files touched

- `index.html` — picker, `loadDirectory`/`nameOf`, every render/export/search/
  faktura path, remove `renamed` handling.
- `supabase/functions/admin-members/index.ts` — delete rename propagation.
- `supabase/functions/send-invoice/index.ts` — key by `skytt_id`.
- `docs/supabase-setup.md` — schema, view, RLS, migration SQL.
- `sw.js` — VERSION bump.

## Out of scope (YAGNI)

- Member reactivation / soft-delete.
- Merging billing email into `profiles`.
- Backfilling or preserving the old free-text names.
