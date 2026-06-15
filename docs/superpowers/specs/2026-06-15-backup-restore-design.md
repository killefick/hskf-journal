# Design: backup snapshot + safe restore

Date: 2026-06-15
Status: Approved (pending spec review)

## Problem

The club's official journal lives in Supabase. On the free tier there's no
point-in-time recovery, and an accidental mass-delete or bad edit has no in-app
undo. We want an admin to be able to take a complete, self-contained snapshot of
all data and, if needed, restore it — without ever making things worse.

## Decisions (from brainstorming)

- **Snapshot + in-app restore** (not just a fuller export).
- **Restore = merge/upsert by id** — non-destructive: brings back deleted rows,
  reverts edits, never deletes anything added after the backup.
- **Manual, one-click** — no scheduled/automated backups (would need cron +
  storage infra; future work).
- **No DB schema changes.** Journal restore uses existing admin RLS; billing
  restore goes through the service-role `send-invoice` function. Deploy =
  redeploy `send-invoice` + push the front-end. No SQL migration.

## Inherent limitations (documented, not bugs)

- **Deleted members can't be restored.** Members are auth users keyed by a
  unique id; the journal references that id. A re-invited member gets a *new*
  id, so rows for a deleted member stay orphaned. Restore **skips and reports**
  any row whose `skytt_id` is not in the current member set. (This is why
  **deactivate** — which keeps the id — is the correct way to remove someone.)
- Not scheduled; relies on the admin taking snapshots.

## Snapshot file format

A single JSON file `hskf-backup-YYYY-MM-DD.json`:

```json
{
  "meta": { "app": "hskf-journal", "format": 1, "exported_at": "<ISO>",
            "counts": { "members": 0, "skjuttillfallen": 0, "skytt_faktura": 0 } },
  "members": [ { "id": "<uuid>", "full_name": "", "role": "member", "active": true, "email": "" } ],
  "skjuttillfallen": [ { /* every column of every journal row */ } ],
  "skytt_faktura": [ { "skytt_id": "<uuid>", "email": "", "faktura_skickad": null } ]
}
```

`members` is reference data: it makes the journal's `skytt_id`s human-meaningful
inside the file and lets the admin see who would need re-inviting.

## Snapshot download (client, admin-only)

A `Säkerhetskopiera` button in the admin toolbar (next to ⤓ CSV / ⤓ Excel,
`index.html:276`). On click:
1. `members` ← `sb.functions.invoke("admin-members", {body:{action:"list"}})`.
2. `skjuttillfallen` ← `sb.from(TABLE).select("*")` (fresh full read, all years).
3. `skytt_faktura` ← `sb.functions.invoke("send-invoice", {body:{action:"meta"}})`.
4. Build the object above (counts from the array lengths), then download via the
   existing `dl(blob, name)` helper (`index.html:1011`) as
   `application/json`, filename `hskf-backup-${today()}.json`.

Any step erroring → `showBanner("warn", …)` and abort (no partial file).

## Restore (client, admin-only)

A `Återställ` button + a hidden `<input type="file" accept="application/json">`.
On file pick:
1. Read with `FileReader`, `JSON.parse`. Validate `meta.app === "hskf-journal"`
   and `meta.format === 1` and that the three arrays exist; otherwise error
   banner and stop (no writes).
2. Fetch current members (`admin-members` `list`) → `Set` of existing ids.
3. Partition `skjuttillfallen`: **restorable** = `skytt_id` in the set;
   **skipped** = not in the set. Same partition for `skytt_faktura` by `skytt_id`.
4. Confirm dialog (Swedish):
   `Återställ N journalposter och M fakturarader? K poster hoppas över (medlemmen finns inte längre). Detta lägger till/uppdaterar rader men raderar ingenting.`
5. On confirm:
   - Journal: `sb.from(TABLE).upsert(restorableRows)` (upsert on PK `id`,
     preserving each row's original `created_by`). Chunk to ≤500 rows/call.
   - Billing: `sb.functions.invoke("send-invoice", {body:{action:"restore", rows: restorableFaktura}})`.
6. Banner: `Återställt: N journalposter, M fakturarader. K hoppades över.` then
   `await loadAll(); await loadDirectory(); await loadFakturaMeta(); renderAll();`.

Errors at any write step → warn banner with the message; because upsert is
idempotent, a retry is safe.

## Edge function: `send-invoice` new `restore` action

Admin-gated (the function already verifies `profiles.role==='admin'`). Adds:

```ts
if (action === "restore") {
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!rows.length) return json({ ok: true, data: { restored: 0, skipped: 0 } });
  // Only upsert rows whose member still exists (FK skytt_id -> profiles).
  const { data: profs, error: pErr } = await admin.from("profiles").select("id");
  if (pErr) throw pErr;
  const ids = new Set((profs ?? []).map((p: any) => p.id));
  const valid = rows.filter((r: any) => r && ids.has(r.skytt_id)).map((r: any) => ({
    skytt_id: r.skytt_id, email: r.email ?? null, faktura_skickad: r.faktura_skickad ?? null,
  }));
  if (valid.length) {
    const { error } = await admin.from("skytt_faktura").upsert(valid);
    if (error) throw error;
  }
  return json({ ok: true, data: { restored: valid.length, skipped: rows.length - valid.length } });
}
```

## UI placement & gating

- Both buttons live in `.admin-toolbar` (`index.html:273`). Gate them to admin
  only — toggle `hide` on `!isAdmin` in `enterApp` (same pattern as
  `#dbSettings`), so a revisor (read-only auditor) sees neither. Backup itself
  also requires admin because it calls the admin-gated edge functions.
- The hidden file input can sit anywhere in the admin view; trigger it with
  `.click()` from the Återställ button.

## Verification

- `node --check` the inline script; `deno check` `send-invoice` if available,
  else review.
- Manual:
  1. Download a backup → valid JSON with the three arrays + counts.
  2. Delete a journal row, restore the file → the row returns; rows added after
     the backup are untouched.
  3. Edit a row, restore → it reverts to the backup value.
  4. Deactivate a member, restore → their rows restore fine (id preserved).
  5. Hard-delete a member with history is FK-blocked anyway; simulate a missing
     member by restoring a backup that predates an existing member set — those
     rows are skipped and counted, no error.
  6. Restore a non-backup / wrong-format JSON → clean error, no writes.
  7. Revisor sees no backup/restore buttons.
- Bump `sw.js` VERSION.

## Files touched

- `index.html` — backup gather/download, restore upload/parse/partition/upsert,
  two admin-gated toolbar buttons + hidden file input, admin gating in `enterApp`.
- `supabase/functions/send-invoice/index.ts` — `restore` action.
- `sw.js` — VERSION bump.
- `docs/supabase-setup.md` — short note that `send-invoice` gained a `restore`
  action (redeploy needed; no SQL).

## Out of scope (YAGNI)

- Scheduled/automated backups; off-site upload.
- Restoring/recreating members (auth users).
- Exact-replace restore (we chose non-destructive merge).
- Versioned/multi-format migration beyond `format: 1`.
