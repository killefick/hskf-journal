# Backup snapshot + safe restore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin download a complete JSON snapshot of all data and restore it via non-destructive merge/upsert (journal client-side, billing via a new `send-invoice` action).

**Architecture:** No schema changes. Backup reads journal (`sb.from(TABLE).select("*")`), members (`admin-members` `list`), and billing (`send-invoice` `meta`) and downloads one JSON file. Restore parses the file, keeps only rows whose `skytt_id` still exists, upserts the journal client-side (admin RLS allows it) and the billing rows through a new admin-gated `send-invoice` `restore` action (that table is service-role only).

**Tech Stack:** Single-file static app (`index.html` inline `<script>`), Supabase (Deno edge function `send-invoice`), service worker.

**Spec:** `docs/superpowers/specs/2026-06-15-backup-restore-design.md`

**Verification:** No test framework. Inline-script syntax check:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/g)||[];let n=0;for(const b of m){const code=b.replace(/^<script>/,'').replace(/<\/script>$/,'');if(/addEventListener|function |const |let /.test(code)){try{new Function(code);n++;}catch(e){console.log('SYNTAX ERROR:',e.message);process.exit(1);}}}console.log('OK -',n,'block(s) clean');"
```

`send-invoice` is Deno TS — use `deno check` if available, else review. No SQL migration. Deploy = redeploy `send-invoice` + push; both done by the user in Task 5.

---

## Task 1: `send-invoice` restore action

**Files:** Modify `supabase/functions/send-invoice/index.ts`

- [ ] **Step 1: Add the `restore` action**

Find the fallback line near the end of the dispatch:

```ts
    return json({ ok: false, error: "Okänd action" }, 400);
```

Insert this block IMMEDIATELY BEFORE it:

```ts
    if (action === "restore") {
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (!rows.length) return json({ ok: true, data: { restored: 0, skipped: 0 } });
      // Only upsert billing rows whose member still exists (FK skytt_id -> profiles).
      const { data: profs, error: pErr } = await admin.from("profiles").select("id");
      if (pErr) throw pErr;
      const ids = new Set((profs ?? []).map((p: any) => p.id));
      const valid = rows
        .filter((r: any) => r && ids.has(r.skytt_id))
        .map((r: any) => ({ skytt_id: r.skytt_id, email: r.email ?? null, faktura_skickad: r.faktura_skickad ?? null }));
      if (valid.length) {
        const { error } = await admin.from("skytt_faktura").upsert(valid);
        if (error) throw error;
      }
      return json({ ok: true, data: { restored: valid.length, skipped: rows.length - valid.length } });
    }
```

- [ ] **Step 2: Verify** — `deno check supabase/functions/send-invoice/index.ts` if available; else re-read the new block (balanced braces; no stray identifiers). Confirm the `meta`/`saveEmail`/`send` actions are untouched.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-invoice/index.ts
git commit -m "send-invoice: add restore action for billing rows"
```
End the commit body with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 2: Client — backup download

**Files:** Modify `index.html` — toolbar buttons + hidden file input (~line 273-278), gating in `enterApp`, the `downloadBackup` handler (near the export handlers ~line 970)

- [ ] **Step 1: Add the two buttons + hidden file input**

Find (line ~277):

```html
      <button class="btn ghost tiny" id="exportXlsx">⤓ Excel</button>
```

Insert IMMEDIATELY AFTER it:

```html
      <button class="btn ghost tiny hide" id="backupBtn">⤓ Säkerhetskopia</button>
      <button class="btn ghost tiny hide" id="restoreBtn">⤴ Återställ</button>
      <input type="file" id="restoreFile" accept="application/json" class="hide">
```

(They start hidden; `enterApp` reveals them for admins in Step 3.)

- [ ] **Step 2: Add the `downloadBackup` handler**

Find the download helper:

```js
function dl(blob,name){ const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click(); }
```

Insert AFTER it:

```js
// Admin: download a complete JSON snapshot (journal + billing + member reference).
async function downloadBackup(){
  const btn=$("#backupBtn"), lbl=btn.textContent; btn.disabled=true; btn.textContent="Säkerhetskopierar…";
  try{
    const mem=await sb.functions.invoke("admin-members",{body:{action:"list"}});
    if(mem.error||!mem.data?.ok) throw new Error((mem.data&&mem.data.error)||(mem.error&&mem.error.message)||"kunde inte läsa medlemmar");
    const {data:jrows,error:jErr}=await sb.from(TABLE).select("*");
    if(jErr) throw jErr;
    const fak=await sb.functions.invoke("send-invoice",{body:{action:"meta"}});
    if(fak.error||!fak.data?.ok) throw new Error((fak.data&&fak.data.error)||(fak.error&&fak.error.message)||"kunde inte läsa fakturadata");
    const members=mem.data.data||[], skjut=jrows||[], faktura=fak.data.data||[];
    const backup={meta:{app:"hskf-journal",format:1,exported_at:new Date().toISOString(),
      counts:{members:members.length,skjuttillfallen:skjut.length,skytt_faktura:faktura.length}},
      members,skjuttillfallen:skjut,skytt_faktura:faktura};
    dl(new Blob([JSON.stringify(backup,null,2)],{type:"application/json"}),`hskf-backup-${today()}.json`);
    showBanner("ok",`Säkerhetskopia skapad: ${skjut.length} journalposter, ${members.length} medlemmar.`,5000);
  }catch(e){ showBanner("warn","Kunde inte säkerhetskopiera: "+esc(String((e&&e.message)||e))); }
  finally{ btn.disabled=false; btn.textContent=lbl; }
}
$("#backupBtn").addEventListener("click",downloadBackup);
```

- [ ] **Step 3: Reveal the buttons for admins**

In `enterApp`, find:

```js
  $("#dbSettings").classList.toggle("hide", !isAdmin);
```

Insert AFTER it:

```js
  $("#backupBtn").classList.toggle("hide", !isAdmin);
  $("#restoreBtn").classList.toggle("hide", !isAdmin);
```

- [ ] **Step 4: Verify** — run the inline-script syntax check. Expected `OK - 1 block(s) clean`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Admin backup: one-click full JSON snapshot download"
```
End the commit body with the Co-Authored-By trailer.

---

## Task 3: Client — restore (upload, partition, merge/upsert)

**Files:** Modify `index.html` — add the restore handlers right after the `$("#backupBtn")` listener from Task 2

- [ ] **Step 1: Add the restore handlers**

Immediately AFTER the line `$("#backupBtn").addEventListener("click",downloadBackup);`, insert:

```js
// Admin: restore from a backup file. Non-destructive merge/upsert by id; rows
// whose member no longer exists are skipped and reported.
$("#restoreBtn").addEventListener("click",()=>$("#restoreFile").click());
$("#restoreFile").addEventListener("change",async ev=>{
  const file=ev.target.files&&ev.target.files[0]; ev.target.value="";
  if(!file) return;
  let backup;
  try{ backup=JSON.parse(await file.text()); }catch{ showBanner("warn","Ogiltig fil (inte giltig JSON)."); return; }
  if(!backup||backup.meta?.app!=="hskf-journal"||backup.meta?.format!==1||!Array.isArray(backup.skjuttillfallen)||!Array.isArray(backup.skytt_faktura)){
    showBanner("warn","Det här är ingen giltig HSKF-säkerhetskopia."); return;
  }
  const mem=await sb.functions.invoke("admin-members",{body:{action:"list"}});
  if(mem.error||!mem.data?.ok){ showBanner("warn","Kunde inte läsa medlemmar för återställning."); return; }
  const ids=new Set((mem.data.data||[]).map(m=>m.id));
  const jOk=backup.skjuttillfallen.filter(r=>r&&ids.has(r.skytt_id));
  const fOk=backup.skytt_faktura.filter(r=>r&&ids.has(r.skytt_id));
  const skipped=(backup.skjuttillfallen.length-jOk.length)+(backup.skytt_faktura.length-fOk.length);
  if(!confirm(`Återställ ${jOk.length} journalposter och ${fOk.length} fakturarader? ${skipped} poster hoppas över (medlemmen finns inte längre). Detta lägger till/uppdaterar rader men raderar ingenting.`)) return;
  const btn=$("#restoreBtn"), lbl=btn.textContent; btn.disabled=true; btn.textContent="Återställer…";
  try{
    for(let i=0;i<jOk.length;i+=500){
      const {error}=await sb.from(TABLE).upsert(jOk.slice(i,i+500));
      if(error) throw error;
    }
    if(fOk.length){
      const r=await sb.functions.invoke("send-invoice",{body:{action:"restore",rows:fOk}});
      if(r.error||!r.data?.ok) throw new Error((r.data&&r.data.error)||(r.error&&r.error.message)||"fakturarader");
    }
    await loadAll(); await loadDirectory(); await loadFakturaMeta(); renderAll();
    showBanner("ok",`Återställt: ${jOk.length} journalposter, ${fOk.length} fakturarader. ${skipped} hoppades över.`,7000);
  }catch(e){ showBanner("warn","Återställning misslyckades: "+esc(String((e&&e.message)||e))); }
  finally{ btn.disabled=false; btn.textContent=lbl; }
});
```

- [ ] **Step 2: Verify** — run the inline-script syntax check. Expected `OK - 1 block(s) clean`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Admin restore: non-destructive merge/upsert from backup file"
```
End the commit body with the Co-Authored-By trailer.

---

## Task 4: Docs note + SW bump

**Files:** Modify `docs/supabase-setup.md`, `sw.js`

- [ ] **Step 1: Note the new action in the setup doc**

Append to `docs/supabase-setup.md`:

```markdown
## 10. Backup/restore — send-invoice `restore` action (2026-06-15)

`send-invoice` gained a `restore` action (admin-gated) that bulk-upserts
`skytt_faktura` rows from a backup file, skipping any whose `skytt_id` no longer
exists in `profiles`. No SQL change — just redeploy the function. The journal
half of restore runs client-side via the admin's existing RLS.
```

- [ ] **Step 2: Bump the SW version**

In `sw.js`, change `const VERSION = "v39";` to `const VERSION = "v40";`.

- [ ] **Step 3: Verify** — `node --check sw.js`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add docs/supabase-setup.md sw.js
git commit -m "Doc backup/restore action; bump SW to v40"
```
End the commit body with the Co-Authored-By trailer.

---

## Task 5: Deploy + verify (manual / user)

**Files:** none (operational)

- [ ] **Step 1: Redeploy `send-invoice`** — paste `supabase/functions/send-invoice/index.ts` into the dashboard editor and Deploy. No SQL to run.

- [ ] **Step 2: Push** — `git push` (deploys `index.html`/`sw.js` v40 to GitHub Pages).

- [ ] **Step 3: Verify** (admin, reload first):
  1. Click **⤓ Säkerhetskopia** → a `hskf-backup-<date>.json` downloads; open it and confirm `meta.counts` + the three arrays.
  2. Delete a journal entry, then **⤴ Återställ** that file → confirm dialog shows the counts; after restore the entry is back; entries added since are untouched.
  3. Edit an entry's shots, restore → reverts to the backup value.
  4. Deactivate a member, restore → their rows restore fine.
  5. Restore a random/non-HSKF JSON → clean "ingen giltig HSKF-säkerhetskopia" error, no writes.
  6. Log in as a **revisor** → no Säkerhetskopia/Återställ buttons.

- [ ] **Step 4: Update memory** — note the backup/restore feature + the `send-invoice` `restore` action in `reference-supabase.md`.

---

## Notes for the implementer

- `TABLE` is the `skjuttillfallen` table-name constant; `today()` returns the
  `YYYY-MM-DD` string; `dl(blob,name)` triggers a download; `$`, `esc`,
  `showBanner`, `loadAll`, `loadDirectory`, `loadFakturaMeta`, `renderAll`,
  `isAdmin`, `sb` are all existing globals.
- Journal upsert relies on `id` being the primary key (Supabase upsert's default
  conflict target) — the backup rows include `id`, so deleted rows are
  re-created and existing rows updated. `created_by` is carried in each row, so
  provenance is preserved.
- `skytt_faktura` is service-role only on the client side, which is exactly why
  its restore goes through the `send-invoice` `restore` action rather than a
  direct `sb.from("skytt_faktura").upsert(...)`.
