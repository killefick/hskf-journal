# Design: deactivate / reactivate member

Date: 2026-06-15
Status: Approved (pending spec review)

## Problem

With shooters referenced by member id and the `skytt_id` foreign key set to
`ON DELETE RESTRICT` (see [shooter-id references](2026-06-15-shooter-id-references-design.md)),
a member who has any journal history can no longer be hard-deleted. There is no
way to remove a departed member from the active roster while keeping their
billing/audit history intact. This adds a reversible **deactivate** that takes a
member off the active roster and blocks their login, plus **reactivate** to undo
it.

## Decisions (from brainstorming)

- **Deactivate blocks login** by banning the auth account (reversible).
- **Keep both** deactivate and the existing hard `delete`. Delete stays for
  cleaning up a never-used / mistakenly-created account with no history (still
  FK-blocked once they have entries); deactivate is the path for members who
  have left but have history.
- **New logging excludes** deactivated members (not in the quick-add picker),
  but **editing old entries and invoicing still work** for them (run off
  historical entries by id; the name still resolves).
- Boolean flag only — no `deactivated_at` timestamp (YAGNI).

## Data model

### `profiles`
- Add `active boolean not null default true`.

### `member_directory` view
- Recreate to include the flag:
  `create view public.member_directory with (security_invoker = off) as
   select id, full_name, active from public.profiles;`
- Grant unchanged (`grant select ... to authenticated`).

## Edge function: `admin-members/index.ts`

All actions remain admin-gated (caller `profiles.role === 'admin'`).

### `list` (modify)
- Also return `active` per member. Change the profiles select to
  `select id, full_name, role, active`, and map
  `active: byId.get(u.id)?.active ?? true` into each member object.

### `deactivate` (new)
```ts
if (action === "deactivate") {
  const { id } = payload;
  if (!id) return json({ ok: false, error: "id saknas" }, 400);
  if (id === callerId) return json({ ok: false, error: "Du kan inte inaktivera ditt eget konto" }, 400);
  const { error: upErr } = await admin.from("profiles").upsert({ id, active: false });
  if (upErr) throw upErr;
  // Ban the login (reversible). ~100 years.
  const { error: banErr } = await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  if (banErr) throw banErr;
  return json({ ok: true, data: { id, active: false } });
}
```

### `reactivate` (new)
```ts
if (action === "reactivate") {
  const { id } = payload;
  if (!id) return json({ ok: false, error: "id saknas" }, 400);
  const { error: upErr } = await admin.from("profiles").upsert({ id, active: true });
  if (upErr) throw upErr;
  const { error: banErr } = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
  if (banErr) throw banErr;
  return json({ ok: true, data: { id, active: true } });
}
```

### `delete` (unchanged)

## Client: `index.html`

### Directory & name resolution
- `loadDirectory()` selects `id, full_name, active`; `dirById` becomes a Map of
  `id -> { name, active }`.
- `nameOf(id)` resolves from the full map (`dirById.get(id)?.name`), so
  deactivated members still render on historical entries. Fallback `"(okänd)"`.
- `directoryOptions()` returns **active members only**, sorted by name — this is
  the quick-add picker source. (Quick-add for a regular member is still their own
  locked id; a member who is themselves deactivated cannot log in at all, so no
  special-casing is needed there.)

### Edit-modal picker guard
- The edit modal (admin) builds its `<select>` from active members **plus** the
  entry's current `skytt_id` if that member is inactive, so opening and saving an
  old entry never silently reassigns it. An included inactive option is labelled
  `"<name> (inaktiv)"`. Concretely: start from `directoryOptions()`; if
  `e.skytt_id` is set and not already present (i.e. inactive), prepend
  `[e.skytt_id, nameOf(e.skytt_id) + " (inaktiv)"]`. Preselect `e.skytt_id`.

### Medlemmar list (`renderMembers`)
- Show an `Inaktiv` pill for members where `active === false`.
- Per-row buttons (for members other than self):
  - active member → **Inaktivera** button (`data-deact="<id>"`)
  - inactive member → **Återaktivera** button (`data-react="<id>"`)
  - **Ta bort** and the role `<select>` stay as they are.
- Self row keeps its current behaviour (no delete/deactivate of own account).

### Medlemmar handlers
- In the member `tbody` click handler, add branches:
  - `data-deact`: confirm `"Inaktivera <namn>? Hen kan inte längre logga in eller registreras på nya pass."`, then
    `invoke("admin-members",{body:{action:"deactivate",id}})`; on success
    `await loadMembers(); await loadDirectory(); renderSkyttPicker();`.
  - `data-react`: confirm `"Återaktivera <namn>?"`, then `action:"reactivate"`,
    same refresh.
  - Error handling mirrors the existing delete branch (showBanner on
    `r.error || !r.data?.ok`).

## Migration (`docs/supabase-setup.md`)

New section §9:
```sql
alter table public.profiles
  add column if not exists active boolean not null default true;

drop view if exists public.member_directory;
create view public.member_directory
  with (security_invoker = off) as
  select id, full_name, active from public.profiles;

grant select on public.member_directory to authenticated;
```
No data backfill (default `true` covers existing members). Redeploy
`admin-members` after.

## Testing / verification

- `node --check` the inline `index.html` script; `deno check` the edge function
  if available, else review; run the SQL in the Supabase editor.
- Manual:
  1. Deactivate a member → they vanish from the quick-add picker; an `Inaktiv`
     pill shows in Medlemmar; their existing log entries still show their name.
  2. That member can no longer sign in (banned).
  3. Reactivate → they return to the picker and can sign in again.
  4. Edit an old entry whose shooter is now inactive → the picker preselects them
     (labelled "(inaktiv)") and saving keeps the same shooter.
  5. Invoice a deactivated member with outstanding shots → still works.
  6. Deactivating your own account is rejected.

## Files touched

- `supabase/functions/admin-members/index.ts` — `deactivate`/`reactivate`
  actions; `active` in `list`.
- `index.html` — directory `active` flag, picker filtering, edit-modal guard,
  Medlemmar pill + buttons + handlers.
- `docs/supabase-setup.md` — §9 (active column + view).
- `sw.js` — VERSION bump (v35 → v36).

## Out of scope (YAGNI)

- A separate "show inactive" filter/toggle in Medlemmar (inactive members just
  stay in the list with a pill).
- Bulk deactivate.
- `deactivated_at` audit timestamp.
