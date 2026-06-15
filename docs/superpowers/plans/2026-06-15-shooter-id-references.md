# id-based shooter references — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text `skytt` name on journal/invoice rows with a `skytt_id` reference to a member, resolving the display name from a read-only `member_directory` view — eliminating the fragile rename-propagation path.

**Architecture:** Pure-normalized model. `skjuttillfallen.skytt_id` and `skytt_faktura.skytt_id` reference `profiles(id)` with `ON DELETE RESTRICT`. A security-definer view `member_directory(id, full_name)` is readable by all authenticated users; the client loads it into an `id → name` map (`dirById`) and a `nameOf(id)` helper resolves names at render time. Logging uses a member picker (admin) or a locked self (member). Renames become a single `profiles.full_name` update.

**Tech Stack:** Single-file static app (`index.html` inline `<script>`), Supabase (Postgres + RLS + Deno edge functions), GitHub Pages, service worker (`sw.js`).

**Verification note:** No test framework. The standard JS syntax check for the inline script is:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=h.match(/<script>([\s\S]*?)<\/script>/g)||[];let n=0;for(const b of m){const code=b.replace(/^<script>/,'').replace(/<\/script>$/,'');if(/addEventListener|function |const |let /.test(code)){try{new Function(code);n++;}catch(e){console.log('SYNTAX ERROR:',e.message);process.exit(1);}}}console.log('OK -',n,'block(s) clean');"
```

Edge functions are Deno TypeScript — `node --check` cannot parse the type annotations. Verify them with `deno check supabase/functions/<fn>/index.ts` if the Deno CLI is available, otherwise by careful review. DB SQL is verified by running it in the Supabase SQL editor.

---

## File Structure

- `docs/supabase-setup.md` — add the schema migration, the `member_directory` view, and its grant (manual one-time apply, like the existing setup steps).
- `supabase/functions/admin-members/index.ts` — strip rename propagation from `update`.
- `supabase/functions/send-invoice/index.ts` — key `meta`/`saveEmail`/`send` by `skytt_id`.
- `index.html` — directory loader + `nameOf`, logging picker, edit picker, swap every `e.skytt` read, re-key the faktura/att-betala subsystem, remove `renamed` handling.
- `sw.js` — VERSION bump.

The DB and edge-function changes are applied/deployed manually in Supabase (the repo only holds the source and the setup doc). The client cannot be exercised end-to-end until the DB migration is applied and both functions redeployed — that happens in Task 8.

---

## Task 1: DB schema, view, and migration SQL

**Files:**
- Modify: `docs/supabase-setup.md` (append a new section)

- [ ] **Step 1: Append the migration + view section to the setup doc**

Add this section to `docs/supabase-setup.md`:

````markdown
## 7. Normalize shooter references to member id (2026-06-15)

Shooters are now referenced by member id, not a free-text name. Only test data
existed, so this wipes and recreates — no backfill. Run in the SQL editor:

```sql
-- 1. Clear test data (no real data exists yet)
delete from public.skjuttillfallen;
delete from public.skytt_faktura;

-- 2. Replace the free-text shooter name with a member-id reference
alter table public.skjuttillfallen drop column if exists skytt;
alter table public.skjuttillfallen
  add column skytt_id uuid not null
  references public.profiles(id) on delete restrict;

-- 3. Re-key the invoice table by member id
alter table public.skytt_faktura drop constraint if exists skytt_faktura_pkey;
alter table public.skytt_faktura drop column if exists skytt_namn;
alter table public.skytt_faktura
  add column skytt_id uuid primary key
  references public.profiles(id) on delete restrict;

-- 4. Read-only id -> name directory for all authenticated users.
--    security_invoker = off (definer) so it bypasses the profiles self-read RLS,
--    but exposes ONLY id and full_name — never role or email.
drop view if exists public.member_directory;
create view public.member_directory
  with (security_invoker = off) as
  select id, full_name from public.profiles;

grant select on public.member_directory to authenticated;
```

A member rename is now just `update public.profiles set full_name = … where id = …`;
no journal/invoice propagation is needed.
````

- [ ] **Step 2: Commit**

```bash
git add docs/supabase-setup.md
git commit -m "Add migration SQL for id-based shooter references"
```

---

## Task 2: Strip rename propagation from admin-members

**Files:**
- Modify: `supabase/functions/admin-members/index.ts` (the `update` action, ~lines 84-142)

- [ ] **Step 1: Replace the `update` action body**

Replace the entire `if (action === "update") { … }` block with:

```ts
    if (action === "update") {
      const { id, full_name, email } = payload;
      if (!id) return json({ ok: false, error: "id saknas" }, 400);
      if (!isEmail(email)) return json({ ok: false, error: "Ogiltig e-post" }, 400);
      const newName = (full_name ?? "").trim();

      // Only call the auth API when the email actually changed.
      const { data: cur, error: getErr } = await admin.auth.admin.getUserById(id);
      if (getErr) throw getErr;
      if (cur.user?.email !== email) {
        const { error: emErr } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
        if (emErr) throw emErr;
      }

      // Names are referenced by id everywhere (journal + faktura resolve through
      // member_directory), so a rename is a single profile update — no propagation.
      const { error: upErr } = await admin.from("profiles").upsert({ id, full_name: newName });
      if (upErr) throw upErr;

      return json({ ok: true, data: { id, email, full_name: newName } });
    }
```

This deletes the old-name fetch, the `skjuttillfallen` rename, the `skytt_faktura`
rename + PK-collision merge, and the `renamed` return field.

- [ ] **Step 2: Verify**

Run (if Deno available): `deno check supabase/functions/admin-members/index.ts`
Expected: no errors. Otherwise review: the function no longer references `oldName`, `renamed`, `skjuttillfallen`, or `skytt_faktura`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-members/index.ts
git commit -m "Drop rename propagation from admin-members update"
```

---

## Task 3: Re-key send-invoice by skytt_id

**Files:**
- Modify: `supabase/functions/send-invoice/index.ts` (the `meta`, `saveEmail`, `send` actions, ~lines 46-91)

- [ ] **Step 1: Replace the three action blocks**

Replace `meta`:

```ts
    if (action === "meta") {
      const { data, error } = await admin
        .from("skytt_faktura").select("skytt_id, email, faktura_skickad");
      if (error) throw error;
      return json({ ok: true, data: data ?? [] });
    }
```

Replace `saveEmail`:

```ts
    if (action === "saveEmail") {
      const skytt_id = (payload.skytt_id ?? "").trim();
      const email = (payload.email ?? "").trim();
      if (!skytt_id) return json({ ok: false, error: "Skytt saknas" }, 400);
      if (!isEmail(email)) return json({ ok: false, error: "Ogiltig e-post" }, 400);
      const { error } = await admin.from("skytt_faktura").upsert({ skytt_id, email });
      if (error) throw error;
      return json({ ok: true, data: { skytt_id, email } });
    }
```

Replace `send` (only the id-keyed lines change; the Brevo block is unchanged):

```ts
    if (action === "send") {
      const skytt_id = (payload.skytt_id ?? "").trim();
      const email = (payload.email ?? "").trim();
      const subject = payload.subject ?? "";
      const text = payload.text ?? "";
      if (!skytt_id) return json({ ok: false, error: "Skytt saknas" }, 400);
      if (!isEmail(email)) return json({ ok: false, error: "Ogiltig e-post" }, 400);
      if (!BREVO_API_KEY) return json({ ok: false, error: "BREVO_API_KEY saknas" }, 500);
      if (!isEmail(BREVO_SENDER_EMAIL)) return json({ ok: false, error: "BREVO_SENDER_EMAIL saknas/ogiltig" }, 500);

      const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", "accept": "application/json" },
        body: JSON.stringify({
          sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
          to: [{ email }],
          subject,
          textContent: text,
        }),
      });
      if (!resp.ok) {
        const detail = await resp.text();
        return json({ ok: false, error: "Brevo " + resp.status + ": " + detail }, 502);
      }
      const { error } = await admin.from("skytt_faktura")
        .upsert({ skytt_id, email, faktura_skickad: new Date().toISOString() });
      if (error) throw error;
      return json({ ok: true, data: { skytt_id, email } });
    }
```

- [ ] **Step 2: Verify**

Run (if Deno available): `deno check supabase/functions/send-invoice/index.ts`
Expected: no errors. Otherwise review: no remaining `skytt_namn` references.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/send-invoice/index.ts
git commit -m "Key send-invoice by skytt_id"
```

---

## Task 4: Client — directory loader and nameOf helper

**Files:**
- Modify: `index.html` (add near the other loaders, ~after `loadAll` at line 474; wire into `enterApp` ~line 1237)

- [ ] **Step 1: Add `dirById`, `loadDirectory`, and `nameOf`**

Immediately after the `loadAll` function (ends at line 474), add:

```js
// id -> full_name for every member, readable by all roles via the
// member_directory view. Lets any view resolve a shooter name from skytt_id.
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

- [ ] **Step 2: Load the directory during sign-in**

In `enterApp`, find (line ~1237):

```js
  await loadAll(); renderAll();
```

Replace with:

```js
  await loadDirectory(); await loadAll(); renderAll();
```

- [ ] **Step 3: Verify**

Run the inline-script syntax check (see header). Expected: `OK - 1 block(s) clean`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add member_directory loader and nameOf resolver"
```

---

## Task 5: Client — role-aware shooter picker in quick-add

**Files:**
- Modify: `index.html` — quick-add markup (line 227), a new render function, the add handler (~809-829), the Enter-key handler (line 951)

- [ ] **Step 1: Replace the free-text field with a container**

Line 227, replace:

```html
          <div class="field"><label for="q-skytt">Namn</label><input type="text" id="q-skytt" placeholder="För- och efternamn" autocomplete="off"></div>
```

with:

```html
          <div class="field"><label for="q-skytt">Namn</label><div id="q-skytt-wrap"></div></div>
```

- [ ] **Step 2: Add a picker renderer**

Add this function next to the quick-add code (after `renderAll`, line 801):

```js
// Admin/leader picks any member; a regular member is locked to themselves.
function renderSkyttPicker(){
  const wrap=$("#q-skytt-wrap"); if(!wrap) return;
  if(isAdmin){
    wrap.innerHTML=`<select id="q-skytt"><option value="">Välj skytt…</option>`+
      directoryOptions().map(([id,nm])=>`<option value="${esc(id)}">${esc(nm)}</option>`).join("")+
      `</select>`;
  } else {
    wrap.innerHTML=`<div id="q-skytt" class="datum-fast" data-id="${esc(_uid||"")}">${esc(nameOf(_uid))}</div>`;
  }
}
```

- [ ] **Step 3: Call the renderer after the directory loads**

In `enterApp`, the line now reads (from Task 4):

```js
  await loadDirectory(); await loadAll(); renderAll();
```

Replace with:

```js
  await loadDirectory(); renderSkyttPicker(); await loadAll(); renderAll();
```

- [ ] **Step 4: Read `skytt_id` in the add handler**

In the quick-add click handler, replace (lines 809-810):

```js
  const skytt=$("#q-skytt").value.trim(); const skott=$("#q-skott").value;
  if(!skytt){ $("#q-skytt").focus(); return; }
```

with:

```js
  const skyttEl=$("#q-skytt");
  const skytt_id = isAdmin ? (skyttEl.value||"") : (skyttEl.dataset.id||"");
  const skott=$("#q-skott").value;
  if(!skytt_id){ if(isAdmin) skyttEl.focus(); showBanner("warn","Välj en skytt."); return; }
```

In the same handler, in the `row` object (line 816), replace `skytt,` with `skytt_id,`.

In the reset block (line 832), replace:

```js
    $("#q-skytt").value=""; $("#q-skott").value=""; $("#q-poang").value=""; $("#q-anm").value="";
    $("#q-skytt").focus();
```

with:

```js
    if(isAdmin){ const s=$("#q-skytt"); if(s) s.value=""; }
    $("#q-skott").value=""; $("#q-poang").value=""; $("#q-anm").value="";
    (isAdmin ? $("#q-skytt") : $("#q-skott")).focus();
```

- [ ] **Step 5: Guard the Enter-key handler**

Line 951 reads:

```js
$("#q-skytt").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$("#q-skott").focus();}});
```

The `#q-skytt` element no longer exists at parse time (it's rendered later), so replace with a delegated guard:

```js
document.addEventListener("keydown",e=>{ if(e.target&&e.target.id==="q-skytt"&&e.key==="Enter"){ e.preventDefault(); $("#q-skott").focus(); } });
```

Also update the focus line in `enterApp` (line 1238):

```js
  if(!isRevisor) $("#q-skytt").focus();
```

Replace with:

```js
  if(!isRevisor){ const s=$("#q-skytt"); if(s&&s.tagName==="SELECT") s.focus(); else $("#q-skott").focus(); }
```

- [ ] **Step 6: Verify**

Run the inline-script syntax check. Expected: `OK - 1 block(s) clean`.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Role-aware shooter picker in quick-add (skytt_id)"
```

---

## Task 6: Client — shooter picker in the edit modal

**Files:**
- Modify: `index.html` — edit modal builder (~1076-1079), edit save handler (~1097-1099)

- [ ] **Step 1: Render a picker instead of a free-text field**

Replace (lines 1076-1079):

```js
  $("#e-skytt-wrap").innerHTML = isAdmin
    ? '<input type="text" id="e-skytt" autocomplete="off">'
    : '<div id="e-skytt" class="datum-fast"></div>';
  if(isAdmin) $("#e-skytt").value=e.skytt||""; else $("#e-skytt").textContent=e.skytt||"";
```

with:

```js
  $("#e-skytt-wrap").innerHTML = isAdmin
    ? `<select id="e-skytt">`+directoryOptions().map(([id,nm])=>`<option value="${esc(id)}">${esc(nm)}</option>`).join("")+`</select>`
    : '<div id="e-skytt" class="datum-fast"></div>';
  if(isAdmin) $("#e-skytt").value=e.skytt_id||""; else $("#e-skytt").textContent=nameOf(e.skytt_id);
```

- [ ] **Step 2: Save `skytt_id` in the edit handler**

Replace (lines 1097-1099):

```js
    const namn=$("#e-skytt").value.trim();
    if(!namn){ alert("Ange ett namn."); return; }
    row.skytt=namn;
```

with:

```js
    const sid=$("#e-skytt").value;
    if(!sid){ alert("Välj en skytt."); return; }
    row.skytt_id=sid;
```

- [ ] **Step 3: Verify**

Run the inline-script syntax check. Expected: `OK - 1 block(s) clean`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Shooter picker in edit modal (skytt_id)"
```

---

## Task 7: Client — resolve names in renders, exports, and search

**Files:**
- Modify: `index.html` — `renderLog`, `renderAdmin`, `renderAdminTable`, `compTotals`, `renderComp`, `renderTotals`, `summaryRows`, `logRows`, `payRows`, `compResultRows`

Each edit swaps a `e.skytt` read for `nameOf(e.skytt_id)`, or re-keys a name grouping to `skytt_id` with the name resolved for display.

- [ ] **Step 1: `renderLog`** (line 523) — replace `<span class="nm">${esc(e.skytt)}</span>` with `<span class="nm">${esc(nameOf(e.skytt_id))}</span>`.

- [ ] **Step 2: `renderAdmin` shooters count** (line 599) — replace
  `const shooters=new Set(ye.map(e=>(e.skytt||"").trim().toLowerCase()).filter(Boolean));`
  with
  `const shooters=new Set(ye.map(e=>e.skytt_id).filter(Boolean));`

- [ ] **Step 3: `renderAdmin` per-shooter map** (line 612) — replace
  `ye.forEach(e=>{const k=(e.skytt||"–").trim(); if(!map[k])map[k]=...`
  with
  `ye.forEach(e=>{const k=e.skytt_id; if(!k)return; if(!map[k])map[k]=...` (rest of the line unchanged). The map is now keyed by id.

- [ ] **Step 4: `renderAdmin` shooter row display** (line 627) — in the row template, replace the name cell `<td>${esc(n)}</td>` with `<td>${esc(nameOf(n))}</td>`. (`n` is now an id; `data-faktura`/`data-paid`/`data-mailedit`/`data-unpaid` keep carrying `n` (the id) — handled in Task 8.)

- [ ] **Step 5: `renderAdminTable` search filter** (line 641) — replace
  `if(q)rows=rows.filter(e=>`${e.skytt} ${e.skjutledare} ${e.anmarkning} ${e.tavling_namn||""}`.toLowerCase().includes(q));`
  with
  `if(q)rows=rows.filter(e=>`${nameOf(e.skytt_id)} ${e.skjutledare} ${e.anmarkning} ${e.tavling_namn||""}`.toLowerCase().includes(q));`

- [ ] **Step 6: `renderAdminTable` row display** (line 647) — replace `<td>${esc(e.skytt)}</td>` with `<td>${esc(nameOf(e.skytt_id))}</td>`.

- [ ] **Step 7: `compTotals`** (lines 762, 768-770, 773-774) — re-key by id:
  - Line 762: replace `byComp.get(name).push({skytt:(e.skytt||"–").trim(), p});` with `byComp.get(name).push({id:e.skytt_id, p});`
  - Lines 768-770: replace `r.skytt` with `r.id` (3 occurrences: `agg.has(r.skytt)`, `agg.set(r.skytt,…)`, `agg.get(r.skytt)`).
  - Lines 773-774: replace
    `return [...agg.entries()].map(([skytt,a])=>({skytt,...a})).sort((x,y)=>(y.total-x.total)||(y.segrar-x.segrar)||x.skytt.localeCompare(y.skytt,"sv"));`
    with
    `return [...agg.entries()].map(([id,a])=>({id,...a})).sort((x,y)=>(y.total-x.total)||(y.segrar-x.segrar)||nameOf(x.id).localeCompare(nameOf(y.id),"sv"));`

- [ ] **Step 8: `renderComp`** (line 788) — replace `<td>${esc(e.skytt)}</td>` with `<td>${esc(nameOf(e.skytt_id))}</td>`.

- [ ] **Step 9: `renderTotals`** (line 798) — replace `<td>${esc(r.skytt)}</td>` with `<td>${esc(nameOf(r.id))}</td>`.

- [ ] **Step 10: `summaryRows`** (line 860) — replace
  `const shooters=new Set(ye.map(e=>(e.skytt||"").trim().toLowerCase()).filter(Boolean)).size;`
  with
  `const shooters=new Set(ye.map(e=>e.skytt_id).filter(Boolean)).size;`

- [ ] **Step 11: `logRows`** (line 877) — replace `e.skytt` (2nd array element) with `nameOf(e.skytt_id)`.

- [ ] **Step 12: `payRows`** (lines 881-883) — re-key by id, resolve name in output:
  - Line 881: replace `const k=(e.skytt||"–").trim();` with `const k=e.skytt_id; if(!k)return;`
  - Lines 882-883: replace
    `.sort((a,b)=>a[0].localeCompare(b[0],"sv")).map(([n,v])=>[n,v.kopta,…])`
    with
    `.sort((a,b)=>nameOf(a[0]).localeCompare(nameOf(b[0]),"sv")).map(([n,v])=>[nameOf(n),v.kopta,…])`
    (keep the two `Math.round(...)` values unchanged).

- [ ] **Step 13: `compResultRows`** (line 888) — replace `e.skytt` (3rd array element) with `nameOf(e.skytt_id)`.

- [ ] **Step 14: Verify**

Run the inline-script syntax check. Expected: `OK - 1 block(s) clean`.

- [ ] **Step 15: Commit**

```bash
git add index.html
git commit -m "Resolve shooter names by id in renders, exports, search"
```

---

## Task 8: Client — re-key the faktura / att-betala subsystem by id

**Files:**
- Modify: `index.html` — `loadFakturaMeta` (555-562), `buildInvoiceText` (567-592), `renderAdmin` faktura cells (615-624), `setShooterPaid` (983-989), `sendFaktura` (992-1006), `editFakturaEmail` (1009-1016), `shooterTbody` handler (1018-1031), `sendAllFaktura` (1033-1057)

Throughout, `fakturaMeta` becomes keyed by `skytt_id`; the `data-faktura`/`data-paid`/`data-unpaid`/`data-mailedit` attributes carry an id; user-facing dialog/banner text uses `nameOf(id)`.

- [ ] **Step 1: `loadFakturaMeta`** (line 560) — replace
  `(data.data||[]).forEach(r=>{ m[(r.skytt_namn||"").trim()]={email:r.email||"",faktura_skickad:r.faktura_skickad||null}; });`
  with
  `(data.data||[]).forEach(r=>{ m[r.skytt_id]={email:r.email||"",faktura_skickad:r.faktura_skickad||null}; });`

- [ ] **Step 2: `buildInvoiceText`** (lines 567-571) — take an id, resolve the name:
  - Line 567: replace `function buildInvoiceText(name, year){` with `function buildInvoiceText(id, year){\n  const name=nameOf(id);`
  - Line 570: replace `.filter(e=>(e.skytt||"–").trim()===name && e.kopt && !e.betald && (+e.antal_skott||0)>0)` with `.filter(e=>e.skytt_id===id && e.kopt && !e.betald && (+e.antal_skott||0)>0)`
  - The `${name}` interpolations in the email body (lines 578, 587) now use the resolved `name` — no further change.

- [ ] **Step 3: `renderAdmin` faktura cell lookup** (line 615) — `const fm=fakturaMeta[n]||{};` already uses `n`, which is now the id (from Task 7 Step 3). The `data-mailedit="${esc(n)}"` (619), `data-faktura="${esc(n)}"` and `data-paid="${esc(n)}"` (624), `data-unpaid="${esc(n)}"` (625) all now carry the id — no change needed beyond Task 7 having made `n` an id. **No edit in this step; confirm only.**

- [ ] **Step 4: `setShooterPaid`** (lines 983-989) — operate on id, show name:
  - Line 983: `async function setShooterPaid(name,year,paid){` → `async function setShooterPaid(id,year,paid){\n  const name=nameOf(id);`
  - Line 984: `entries.filter(e=>(e.skytt||"–").trim()===name && …` → `entries.filter(e=>e.skytt_id===id && …` (rest unchanged).

- [ ] **Step 5: `sendFaktura`** (lines 992-1006) — id-keyed:
  ```js
  async function sendFaktura(id, year){
    const name=nameOf(id);
    const fm=fakturaMeta[id]||{};
    let email=fm.email;
    if(!email){
      email=(prompt(`E-postadress för faktura till ${name}:`)||"").trim();
      if(!email) return false;
      const sv=await sb.functions.invoke("send-invoice",{body:{action:"saveEmail",skytt_id:id,email}});
      if(sv.error||!sv.data?.ok){ showBanner("warn","Kunde inte spara e-post: "+esc((sv.data&&sv.data.error)||(sv.error&&sv.error.message)||"okänt fel")); return false; }
      fakturaMeta[id]={...fm,email};
    }
    const {subject,text}=buildInvoiceText(id,year);
    const r=await sb.functions.invoke("send-invoice",{body:{action:"send",skytt_id:id,email,subject,text}});
    if(r.error||!r.data?.ok){ showBanner("warn",`Kunde inte skicka faktura till ${esc(name)}: `+esc((r.data&&r.data.error)||(r.error&&r.error.message)||"okänt fel")); return false; }
    fakturaMeta[id]={email,faktura_skickad:new Date().toISOString()};
    return true;
  }
  ```

- [ ] **Step 6: `editFakturaEmail`** (lines 1009-1016) — id-keyed:
  ```js
  async function editFakturaEmail(id){
    const name=nameOf(id);
    const cur=(fakturaMeta[id]&&fakturaMeta[id].email)||"";
    const email=(prompt(`E-postadress för ${name}:`,cur)||"").trim();
    if(!email||email===cur) return;
    const sv=await sb.functions.invoke("send-invoice",{body:{action:"saveEmail",skytt_id:id,email}});
    if(sv.error||!sv.data?.ok){ showBanner("warn","Kunde inte spara e-post: "+esc((sv.data&&sv.data.error)||(sv.error&&sv.error.message)||"okänt fel")); return; }
    fakturaMeta[id]={...(fakturaMeta[id]||{}),email};
    renderAdmin();
  }
  ```

- [ ] **Step 7: `shooterTbody` click handler** (lines 1022-1030) — the `data-*` values are ids; show names in confirms:
  ```js
    if(f){
      if(confirm(`Skicka faktura till ${nameOf(f.dataset.faktura)}?`)){
        if(await sendFaktura(f.dataset.faktura,f.dataset.y)) showBanner("ok",`Faktura skickad till ${esc(nameOf(f.dataset.faktura))}.`,4000);
        renderAdmin();
      }
    }
    else if(me){ await editFakturaEmail(me.dataset.mailedit); }
    else if(p && confirm(`Markera ${nameOf(p.dataset.paid)}s köpta skott som betalda för ${p.dataset.y}?`)) await setShooterPaid(p.dataset.paid,p.dataset.y,true);
    else if(u && confirm(`Ångra betald-markering för ${nameOf(u.dataset.unpaid)} (${u.dataset.y})?`)) await setShooterPaid(u.dataset.unpaid,u.dataset.y,false);
  ```

- [ ] **Step 8: `sendAllFaktura`** (lines 1035-1057) — group outstanding by id, resolve names in messages:
  - Line 1037: `entriesForYear(y).forEach(e=>{const k=(e.skytt||"–").trim(); out[k]=(out[k]||0)+rowOutstanding(e);});` → `entriesForYear(y).forEach(e=>{const k=e.skytt_id; if(!k)return; out[k]=(out[k]||0)+rowOutstanding(e);});`
  - Lines 1040-1041 (`missing`, `already`) keep filtering on the keys `n` (now ids) against `fakturaMeta[n]` — no change.
  - Line 1044: `already.join(", ")` → `already.map(nameOf).join(", ")`
  - Line 1052: `buildInvoiceText(n,y)` — `n` is already an id, no change.
  - Line 1053: `{action:"send",skytt_namn:n,…}` → `{action:"send",skytt_id:n,…}`
  - Line 1057: `Saknar e-post: ${esc(missing.join(", "))}` → `Saknar e-post: ${esc(missing.map(nameOf).join(", "))}`

- [ ] **Step 9: Verify**

Run the inline-script syntax check. Expected: `OK - 1 block(s) clean`.

- [ ] **Step 10: Commit**

```bash
git add index.html
git commit -m "Re-key faktura/att-betala subsystem by skytt_id"
```

---

## Task 9: Remove `renamed` handling, refresh directory on member changes, bump SW

**Files:**
- Modify: `index.html` — member-save handler (~1159-1167), member delete handler, `sw.js`

- [ ] **Step 1: Simplify the member-save success path**

Replace (lines 1159-1167):

```js
  let msg=editingMemberId?"Medlem uppdaterad.":"Inbjudan skickad.";
  const renamed=editingMemberId?(r.data?.data?.renamed||0):0;
  if(renamed>0) msg+=` ${renamed} journalpost${renamed===1?"":"er"} omdöpt${renamed===1?"":"a"}.`;
  showBanner("ok",msg,5000);
  await loadMembers();
  // A rename touched journal rows (and the faktura record) in the DB; refresh the
  // in-memory entries and faktura-meta so the log/Tävling/Totals/Att betala views
  // reflect the new name without a reload.
  if(renamed>0){ await loadAll(); await loadFakturaMeta(); renderAll(); }
```

with:

```js
  const msg=editingMemberId?"Medlem uppdaterad.":"Inbjudan skickad.";
  showBanner("ok",msg,5000);
  await loadMembers();
  // Names resolve through the directory, so a rename only needs a fresh directory
  // + re-render; no journal/faktura propagation. Refresh the picker too.
  await loadDirectory(); renderSkyttPicker(); renderAll();
```

- [ ] **Step 2: Refresh the directory after a member delete**

Find the member delete handler (the `data-delm` branch that calls `admin-members` `delete` then `loadMembers()`). After its `await loadMembers();`, add `await loadDirectory(); renderSkyttPicker();`.

Locate it:

```bash
grep -n "data-delm\|action:\"delete\"" index.html
```

In that handler, after the success `await loadMembers();`, insert:

```js
    await loadDirectory(); renderSkyttPicker();
```

- [ ] **Step 3: Bump the service-worker version**

In `sw.js`, change `const VERSION = "v34";` to `const VERSION = "v35";`.

- [ ] **Step 4: Verify**

Run the inline-script syntax check and `node --check sw.js`. Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add index.html sw.js
git commit -m "Refresh directory on member changes; drop renamed handling; bump SW"
```

---

## Task 10: Apply, deploy, and verify end-to-end

**Files:** none (operational)

- [ ] **Step 1: Apply the DB migration** — run the SQL from `docs/supabase-setup.md` §7 in the Supabase SQL editor. Confirm `skjuttillfallen.skytt_id`, `skytt_faktura.skytt_id`, and the `member_directory` view exist.

- [ ] **Step 2: Redeploy edge functions** — `supabase functions deploy admin-members` and `supabase functions deploy send-invoice`.

- [ ] **Step 3: Push** — `git push` (deploys `index.html`/`sw.js` to GitHub Pages).

- [ ] **Step 4: Manual verification** (per the project's verify-static-app practice):
  1. Admin logs an entry for member A via the picker → appears in log + admin table.
  2. Member logs in → name field is locked to themselves; logging records their own id.
  3. Revisor logs in → read-only; all names resolve.
  4. Admin renames member A in Medlemmar → log, admin table, Tävling, Total, and Att betala all show the new name **with no reload**.
  5. Send/track an invoice for A, then rename A → faktura meta and "skickad" status survive (keyed by id).
  6. Attempt to delete a member who has entries → blocked with a clear error from the FK restrict.

- [ ] **Step 5: Update memory** — mark the self-register/id-normalization project done in `MEMORY.md` and the relevant memory file.

---

## Notes for the implementer

- `_uid` (the logged-in user's id) and `isAdmin`/`isRevisor` are set in `enterApp` before `loadDirectory`/`renderSkyttPicker` run — safe to use in the picker.
- Local (non-REMOTE) mode: `loadDirectory` sets an empty `dirById`, so `nameOf` returns `(okänd)`. The local/offline path predates members entirely; treat it as out of scope (it has no member directory). Do not spend time making local mode resolve names.
- After Task 7 Step 3, the `map` in `renderAdmin` is keyed by id; every consumer of that map's keys (`n`) in Task 8 therefore receives ids — that is the intended contract between the two tasks.
