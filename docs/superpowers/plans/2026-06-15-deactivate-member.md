# Deactivate / reactivate member — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reversible "deactivate member" (profiles.active=false + auth ban) that removes a member from the active roster and blocks their login while keeping their journal/billing history, plus "reactivate" to undo it. Keep the existing hard delete.

**Architecture:** A `profiles.active` boolean, surfaced through the `member_directory` view. The `admin-members` edge function gains `deactivate`/`reactivate` actions (flag + auth ban toggle) and returns `active` in `list`. The client filters the quick-add picker to active members, keeps name resolution working for inactive ones (historical entries), guards the edit picker so editing an old entry can't silently reassign an inactive shooter, and adds Inaktivera/Återaktivera buttons to the Medlemmar table.

**Tech Stack:** Single-file static app (`index.html` inline `<script>`), Supabase (Postgres + RLS + Deno edge function `admin-members`), GitHub Pages, service worker (`sw.js`).

**Spec:** `docs/superpowers/specs/2026-06-15-deactivate-member-design.md`

**Verification note:** No test framework. Standard JS syntax check for the inline script:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/g)||[];let n=0;for(const b of m){const code=b.replace(/^<script>/,'').replace(/<\/script>$/,'');if(/addEventListener|function |const |let /.test(code)){try{new Function(code);n++;}catch(e){console.log('SYNTAX ERROR:',e.message);process.exit(1);}}}console.log('OK -',n,'block(s) clean');"
```

`admin-members/index.ts` is Deno TypeScript — `node --check` can't parse it; use `deno check` if available, else careful review. DB SQL is verified by running it in the Supabase SQL editor.

The DB migration (Task 1) and edge-function redeploy (Task 2) are applied manually in Supabase by the user; the client changes (Tasks 3–5) must not be pushed until the migration is live (handled in Task 6).

---

## Task 1: DB migration — `active` column + view (setup doc)

**Files:**
- Modify: `docs/supabase-setup.md` (append a new section)

- [ ] **Step 1: Append section §9**

Append to `docs/supabase-setup.md`:

````markdown
## 9. Deactivate / reactivate member (2026-06-15)

Adds a reversible active/inactive flag on members. Deactivation also bans the
auth login (done in the `admin-members` function, not here). Run in the SQL editor:

```sql
alter table public.profiles
  add column if not exists active boolean not null default true;

-- member_directory must expose `active` so the client can filter the logging
-- picker to active members while still resolving names for inactive ones.
drop view if exists public.member_directory;
create view public.member_directory
  with (security_invoker = off) as
  select id, full_name, active from public.profiles;

grant select on public.member_directory to authenticated;
```

No backfill — existing members default to `active = true`. Redeploy
`admin-members` after (it gains `deactivate`/`reactivate`).
````

- [ ] **Step 2: Commit**

```bash
git add docs/supabase-setup.md
git commit -m "Add migration SQL for member active flag"
```
End the commit body with:
`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## Task 2: admin-members — `active` in list + deactivate/reactivate

**Files:**
- Modify: `supabase/functions/admin-members/index.ts`

- [ ] **Step 1: Return `active` from the `list` action**

Find the `list` action block. Change the profiles select to include `active`:

```ts
      const { data: profs, error: pErr } = await admin.from("profiles").select("id, full_name, role, active");
```

And add `active` to each mapped member object (after the `role:` line):

```ts
      const members = list.users.map((u: any) => ({
        id: u.id,
        email: u.email,
        full_name: byId.get(u.id)?.full_name ?? "",
        role: byId.get(u.id)?.role ?? "member",
        active: byId.get(u.id)?.active ?? true,
      }));
```

- [ ] **Step 2: Add `deactivate` and `reactivate` actions**

Immediately BEFORE the `if (action === "delete") {` block, insert:

```ts
    if (action === "deactivate") {
      const { id } = payload;
      if (!id) return json({ ok: false, error: "id saknas" }, 400);
      if (id === callerId) return json({ ok: false, error: "Du kan inte inaktivera ditt eget konto" }, 400);
      const { error: upErr } = await admin.from("profiles").upsert({ id, active: false });
      if (upErr) throw upErr;
      // Block the login too (reversible). ~100 years.
      const { error: banErr } = await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
      if (banErr) throw banErr;
      return json({ ok: true, data: { id, active: false } });
    }

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

- [ ] **Step 3: Verify**

Run `deno check supabase/functions/admin-members/index.ts` if Deno is available; otherwise re-read the two new blocks + the `list` change to confirm balanced braces and that `active` is selected and mapped.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/admin-members/index.ts
git commit -m "admin-members: active in list + deactivate/reactivate actions"
```
End the commit body with the Co-Authored-By trailer.

---

## Task 3: Client — directory `active` flag + edit-picker guard

**Files:**
- Modify: `index.html` (the `loadDirectory`/`nameOf`/`directoryOptions` block ~lines 475-488; the edit-modal picker ~lines 1104-1107)

- [ ] **Step 1: Carry `active` in the directory; filter the picker**

Replace the whole block (currently lines 477-488):

```js
let dirById = new Map();
async function loadDirectory(){
  if(!REMOTE){ dirById = new Map(); return; }
  const {data,error}=await sb.from("member_directory").select("id,full_name");
  if(error){ showBanner("warn","Kunde inte läsa medlemskatalogen: "+esc(error.message)); return; }
  dirById = new Map((data||[]).map(r=>[r.id, r.full_name||""]));
}
function nameOf(id){ return dirById.get(id) || "(okänd)"; }
// Members sorted by name, for the logging/edit pickers.
function directoryOptions(){
  return [...dirById.entries()].sort((a,b)=>a[1].localeCompare(b[1],"sv"));
}
```

with:

```js
// id -> { name, active } for every member. Inactive members stay in the map so
// historical entries still resolve a name; only the pickers filter them out.
let dirById = new Map();
async function loadDirectory(){
  if(!REMOTE){ dirById = new Map(); return; }
  const {data,error}=await sb.from("member_directory").select("id,full_name,active");
  if(error){ showBanner("warn","Kunde inte läsa medlemskatalogen: "+esc(error.message)); return; }
  dirById = new Map((data||[]).map(r=>[r.id, {name:r.full_name||"", active:r.active!==false}]));
}
function nameOf(id){ return dirById.get(id)?.name || "(okänd)"; }
// Active members sorted by name, for the logging/edit pickers.
function directoryOptions(){
  return [...dirById.entries()].filter(([,v])=>v.active).map(([id,v])=>[id,v.name])
    .sort((a,b)=>a[1].localeCompare(b[1],"sv"));
}
// Edit picker = active members PLUS the entry's current shooter even if now
// inactive, so editing an old entry never silently reassigns it.
function editPickerOptions(currentId){
  const opts=directoryOptions();
  if(currentId && !opts.some(([id])=>id===currentId)) opts.unshift([currentId, nameOf(currentId)+" (inaktiv)"]);
  return opts;
}
```

(`renderSkyttPicker` and the member-locked self path are unaffected: the admin quick-add picker uses `directoryOptions()` which is now active-only, and the member path uses `nameOf(_uid)` which still returns a string.)

- [ ] **Step 2: Use the guard in the edit modal**

Find (the edit-modal builder, ~lines 1104-1105):

```js
  $("#e-skytt-wrap").innerHTML = isAdmin
    ? `<select id="e-skytt">`+directoryOptions().map(([id,nm])=>`<option value="${esc(id)}">${esc(nm)}</option>`).join("")+`</select>`
```

Replace with:

```js
  $("#e-skytt-wrap").innerHTML = isAdmin
    ? `<select id="e-skytt">`+editPickerOptions(e.skytt_id).map(([id,nm])=>`<option value="${esc(id)}">${esc(nm)}</option>`).join("")+`</select>`
```

(The next line, `if(isAdmin) $("#e-skytt").value=e.skytt_id||""; else ...`, is unchanged — the preselect now always has a matching option.)

- [ ] **Step 3: Verify**

Run the inline-script syntax check (see header). Expected: `OK - 1 block(s) clean`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Directory carries active flag; guard edit picker for inactive shooters"
```
End the commit body with the Co-Authored-By trailer.

---

## Task 4: Client — Medlemmar pill, buttons, handlers, CSS

**Files:**
- Modify: `index.html` (pill CSS ~line 121; `renderMembers` ~lines 689-711; member `tbody` click handler ~lines 718-743)

- [ ] **Step 1: Add the `inaktiv` pill style**

Find (line ~121): `  .pill.revisor{background:#e6e2f3;color:#4b3f7a}`
Insert immediately AFTER it:

```css
  .pill.inaktiv{background:#e4e2db;color:#6a6a5e}
```

- [ ] **Step 2: Show the Inaktiv pill + Inaktivera/Återaktivera button in `renderMembers`**

Find the status cell (line ~702):

```js
      <td><span class="pill ${rolePill(m.role)}">${roleLabel(m.role)}</span></td>
```

Replace with:

```js
      <td><span class="pill ${rolePill(m.role)}">${roleLabel(m.role)}</span>${m.active===false?` <span class="pill inaktiv">Inaktiv</span>`:""}</td>
```

Then find the actions cell's delete button line (line ~707):

```js
        ${isMe?"":`<button class="btn ghost tiny" data-delm="${esc(m.id)}">🗑 Ta bort</button>`}
```

Replace with (adds a deactivate/reactivate button before delete; self gets neither):

```js
        ${isMe?"":(m.active===false
          ? `<button class="btn ghost tiny" data-react="${esc(m.id)}">↻ Återaktivera</button>`
          : `<button class="btn ghost tiny" data-deact="${esc(m.id)}">⏸ Inaktivera</button>`)}
        ${isMe?"":`<button class="btn ghost tiny" data-delm="${esc(m.id)}">🗑 Ta bort</button>`}
```

- [ ] **Step 3: Handle the new buttons**

In the member `tbody` click handler, find (line ~731-732):

```js
  const resetBtn=ev.target.closest("[data-reset]");
  const delBtn=ev.target.closest("[data-delm]");
```

Replace with:

```js
  const resetBtn=ev.target.closest("[data-reset]");
  const delBtn=ev.target.closest("[data-delm]");
  const deactBtn=ev.target.closest("[data-deact]");
  const reactBtn=ev.target.closest("[data-react]");
```

Then find the end of the `else if(delBtn){ ... }` block (lines ~736-742):

```js
  } else if(delBtn){
    if(!confirm("Ta bort medlemmen permanent?")) return;
    const r=await sb.functions.invoke("admin-members",{body:{action:"delete",id:delBtn.dataset.delm}});
    if(r.error||!r.data?.ok){ showBanner("warn","Kunde inte ta bort: "+esc((r.data&&r.data.error)||(r.error&&r.error.message)||"okänt fel")); return; }
    await loadMembers();
    await loadDirectory(); renderSkyttPicker();
  }
```

Replace with (appends two more branches):

```js
  } else if(delBtn){
    if(!confirm("Ta bort medlemmen permanent?")) return;
    const r=await sb.functions.invoke("admin-members",{body:{action:"delete",id:delBtn.dataset.delm}});
    if(r.error||!r.data?.ok){ showBanner("warn","Kunde inte ta bort: "+esc((r.data&&r.data.error)||(r.error&&r.error.message)||"okänt fel")); return; }
    await loadMembers();
    await loadDirectory(); renderSkyttPicker();
  } else if(deactBtn){
    const nm=members.find(m=>m.id===deactBtn.dataset.deact)?.full_name||"";
    if(!confirm(`Inaktivera ${nm}? Hen kan inte längre logga in eller registreras på nya pass.`)) return;
    const r=await sb.functions.invoke("admin-members",{body:{action:"deactivate",id:deactBtn.dataset.deact}});
    if(r.error||!r.data?.ok){ showBanner("warn","Kunde inte inaktivera: "+esc((r.data&&r.data.error)||(r.error&&r.error.message)||"okänt fel")); return; }
    await loadMembers();
    await loadDirectory(); renderSkyttPicker();
  } else if(reactBtn){
    const nm=members.find(m=>m.id===reactBtn.dataset.react)?.full_name||"";
    if(!confirm(`Återaktivera ${nm}?`)) return;
    const r=await sb.functions.invoke("admin-members",{body:{action:"reactivate",id:reactBtn.dataset.react}});
    if(r.error||!r.data?.ok){ showBanner("warn","Kunde inte återaktivera: "+esc((r.data&&r.data.error)||(r.error&&r.error.message)||"okänt fel")); return; }
    await loadMembers();
    await loadDirectory(); renderSkyttPicker();
  }
```

- [ ] **Step 4: Verify**

Run the inline-script syntax check. Expected: `OK - 1 block(s) clean`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Medlemmar: Inaktivera/Återaktivera buttons + Inaktiv pill"
```
End the commit body with the Co-Authored-By trailer.

---

## Task 5: Bump service-worker version

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: Bump VERSION**

In `sw.js`, change `const VERSION = "v35";` to `const VERSION = "v36";`.

- [ ] **Step 2: Verify**

Run `node --check sw.js`. Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "Bump SW to v36 for deactivate-member feature"
```
End the commit body with the Co-Authored-By trailer.

---

## Task 6: Apply, deploy, verify (manual / user)

**Files:** none (operational)

- [ ] **Step 1: Apply the DB migration** — run `docs/supabase-setup.md` §9 in the Supabase SQL editor. Confirm `profiles.active` exists and `member_directory` now returns `active`.

- [ ] **Step 2: Redeploy `admin-members`** — paste `supabase/functions/admin-members/index.ts` into the dashboard editor (or `supabase functions deploy admin-members`). `send-invoice` is unchanged this time.

- [ ] **Step 3: Push** — `git push` (deploys `index.html`/`sw.js` v36 to GitHub Pages).

- [ ] **Step 4: Manual verification:**
  1. Deactivate a member → they disappear from the quick-add picker; an `Inaktiv` pill shows in Medlemmar; their existing log entries still show their name.
  2. That member can no longer sign in (banned).
  3. Reactivate → they return to the picker and can sign in again.
  4. Edit an old entry whose shooter is now inactive → the picker preselects them, labelled "(inaktiv)", and saving keeps the same shooter.
  5. Invoice a deactivated member who has outstanding shots → still works.
  6. Deactivating your own account → rejected with an error.

- [ ] **Step 5: Update memory** — note the `active` flag + deactivate/reactivate in `project-self-register-shooter-names.md` / `reference-supabase.md`.

---

## Notes for the implementer

- `members[]` (the admin list array) now carries `active` per row; `dirById` values are `{name, active}` objects (not bare strings) — every `nameOf` already goes through `.name`, and `directoryOptions()`/`editPickerOptions()` are the only readers of `active` on the client.
- The refresh sequence after any member mutation is always `await loadMembers(); await loadDirectory(); renderSkyttPicker();` — reuse it verbatim so the picker and directory never drift.
- Do not touch the `send-invoice` function or the FK constraints; deactivate is purely a flag + auth ban and leaves all history in place.
