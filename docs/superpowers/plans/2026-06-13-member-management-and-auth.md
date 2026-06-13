# Member Management & Auth Self-Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the registration date editable for everyone (default today), add self-service password reset on the login screen, and add an admin-only "Medlemmar" section for managing login accounts via a secure Supabase Edge Function.

**Architecture:** Pieces 1 and 2 are pure client-side edits to the single-file `index.html`. Piece 3 adds a Deno Edge Function (`supabase/functions/admin-members/`) that performs privileged user operations with the `service_role` key after verifying the caller is an admin; the client calls it via `sb.functions.invoke`. Member CRUD routes through the function so the client needs only minimal `profiles` RLS (self-read).

**Tech Stack:** Vanilla JS in `index.html`, `@supabase/supabase-js@2` (loaded via CDN), Supabase Auth + Postgres + Edge Functions (Deno), service worker (`sw.js`).

**Testing note:** This repo has no automated test framework (single static HTML page). Verification gates are **manual browser checks** and (for the Edge Function) `curl`/in-app checks. Do not scaffold a test runner — that is out of scope. Keep commits frequent.

**Spec:** `docs/superpowers/specs/2026-06-13-member-management-and-auth-design.md`

---

## File structure

- **Modify** `index.html` — all client UI/logic (date field, reset flow, members card + modal + wiring).
- **Create** `supabase/functions/admin-members/index.ts` — the Edge Function (list/create/setRole/delete).
- **Create** `supabase/functions/admin-members/deno.json` — minimal Deno config (optional but keeps imports tidy).
- **Modify** `sw.js` — bump `VERSION` once at the end so installed PWAs get the update prompt.
- **Create** `docs/supabase-setup.md` — the manual one-time steps (RLS SQL, function deploy, redirect URL) so they are recorded in the repo.

---

## Task 1: Registration date field editable for everyone

**Files:**
- Modify: `index.html:198` (markup), `index.html:426-433` (`applyPassToForm`), and add a listener near the other pass listeners.

- [ ] **Step 1: Change the markup to a date input**

Replace `index.html:198`:

```html
          <div class="field"><label>Datum</label><div id="p-datum" class="datum-fast"></div></div>
```

with:

```html
          <div class="field"><label for="p-datum">Datum</label><input type="date" id="p-datum"></div>
```

- [ ] **Step 2: Set the value (not textContent) in `applyPassToForm`**

In `index.html:427`, replace:

```js
  $("#p-datum").textContent=pass.datum||today();
```

with:

```js
  $("#p-datum").value=pass.datum||today();
```

- [ ] **Step 3: Add a change listener that persists the chosen date**

Find the init/listener area. Add this listener next to the other pass-form wiring (search for `$("#p-ledare").addEventListener` — add directly after it; if that listener does not exist, add the block just before the `/* ---------- init ---------- */` comment near `index.html:835`):

```js
$("#p-datum").addEventListener("change",()=>{
  pass.datum=$("#p-datum").value||today();
  if(!$("#p-datum").value) $("#p-datum").value=pass.datum;   // guard: never leave it blank
  savePass();
  renderLog();
});
```

- [ ] **Step 4: Manual verification**

Run the app locally: in the project dir, `python -m http.server 8000` (or open the live site after deploy). In the browser:
1. Log in. On "Dagens pass", the Datum field is now a date picker showing today.
2. Change it to yesterday → the "Dagens pass" list at the bottom re-filters to yesterday and `#passDateLabel` updates.
3. Reload the page → the date you picked persists (read from localStorage `hskf_pass`).
4. Register a shooter → the new row uses the selected date (`pass.datum`).

Expected: all four behave as described; clearing the field snaps back to today.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Make registration date editable for all users, default today"
```

---

## Task 2: Self-service password reset (login link + recovery modal)

**Files:**
- Modify: `index.html:184` (add reset link), add a new `#pwModal` near the other modals (after the edit modal, around `index.html:328`), add JS for the link + recovery handling + modal save, and register the `PASSWORD_RECOVERY` handling inside the existing `onAuthStateChange`.

- [ ] **Step 1: Add the "Glömt lösenord?" link to the login card**

In `index.html`, after the login button at line 184:

```html
        <button class="btn primary big" id="loginBtn" style="width:100%">Logga in</button>
```

add:

```html
        <div style="text-align:center;margin-top:12px"><a href="#" id="forgotLink" style="font-size:13px;color:var(--forest)">Glömt lösenord?</a></div>
```

- [ ] **Step 2: Add the "set new password" modal markup**

After the edit modal's closing markup (the `</div></div>` that ends `#editModal`, around `index.html:328` — locate the line containing `id="editModal"` and find its matching close), add a new modal:

```html
<!-- SET NEW PASSWORD MODAL (password recovery) -->
<div class="modal-bg" id="pwModal"><div class="modal">
  <div class="m-head"><h3>Sätt nytt lösenord</h3></div>
  <div class="m-body">
    <div class="field"><label for="pw-new">Nytt lösenord</label><input type="password" id="pw-new" autocomplete="new-password"></div>
    <div class="field"><label for="pw-new2">Bekräfta lösenord</label><input type="password" id="pw-new2" autocomplete="new-password"></div>
    <div id="pwErr" style="color:var(--rust-d);font-size:13px;min-height:18px"></div>
  </div>
  <div class="m-foot">
    <button class="btn ghost" id="pw-cancel">Avbryt</button>
    <button class="btn primary" id="pw-save">Spara lösenord</button>
  </div>
</div></div>
```

> Note: match the footer/button classes used by the existing `#editModal` (look at its `m-foot`/button markup and mirror the class names exactly so styling is consistent).

- [ ] **Step 3: Wire the forgot-password link**

Add to the init block (near the other `addEventListener` calls in the `(async function(){…})()` init, around `index.html:850`):

```js
$("#forgotLink").addEventListener("click",async(ev)=>{
  ev.preventDefault();
  const email=$("#authEmail").value.trim();
  if(!email){ $("#authErr").textContent="Fyll i din e-post först, tryck sedan Glömt lösenord."; return; }
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
  if(error){ showBanner("warn","Kunde inte skicka återställning: "+esc(error.message)); return; }
  showBanner("ok","Om kontot finns har en återställningslänk skickats till e-posten.",6000);
});
```

> `showBanner("ok", …)` is valid — the `.banner.ok` success style is defined in CSS (`index.html:137`) and already used at `index.html:786`.

- [ ] **Step 4: Handle the PASSWORD_RECOVERY event**

The init registers `sb.auth.onAuthStateChange((_e,session)=>applyAuth(session));` at `index.html:854`. Replace it with a version that intercepts recovery:

```js
sb.auth.onAuthStateChange((evt,session)=>{
  if(evt==="PASSWORD_RECOVERY"){ $("#pwErr").textContent=""; $("#pw-new").value=""; $("#pw-new2").value=""; $("#pwModal").classList.add("open"); return; }
  applyAuth(session);
});
```

- [ ] **Step 5: Wire the recovery modal save/cancel**

Add near the other modal listeners (e.g. after the `#editModal` listeners around `index.html:733`):

```js
$("#pw-cancel").addEventListener("click",()=>$("#pwModal").classList.remove("open"));
$("#pwModal").addEventListener("click",e=>{if(e.target.id==="pwModal")$("#pwModal").classList.remove("open");});
$("#pw-save").addEventListener("click",async()=>{
  const a=$("#pw-new").value, b=$("#pw-new2").value;
  if(a.length<8){ $("#pwErr").textContent="Minst 8 tecken."; return; }
  if(a!==b){ $("#pwErr").textContent="Lösenorden matchar inte."; return; }
  const {error}=await sb.auth.updateUser({password:a});
  if(error){ $("#pwErr").textContent=error.message; return; }
  $("#pwModal").classList.remove("open");
  showBanner("ok","Lösenord uppdaterat.",5000);
});
```

- [ ] **Step 6: Manual verification**

1. On the login screen, leave email empty → click "Glömt lösenord?" → inline error asks for email.
2. Enter a real member email → click it → success banner; a reset email arrives (requires the redirect URL config in Task 7 / `docs/supabase-setup.md`).
3. Click the email link → app opens, `#pwModal` appears. Enter mismatched passwords → error. Enter matching ≥8-char password → "Lösenord uppdaterat".
4. Log out, log in with the new password → success.

Expected: all steps behave as described. (Step 2-4 require the Supabase redirect URL to be configured — if not yet done, verify the link click shows the success banner and revisit after Task 7.)

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Add self-service password reset with recovery modal"
```

---

## Task 3: profiles self-read RLS (manual Supabase) + record setup doc

**Files:**
- Create: `docs/supabase-setup.md`

- [ ] **Step 1: Write the setup doc**

Create `docs/supabase-setup.md`:

```markdown
# Supabase one-time setup

These steps are applied in the Supabase project (not via the git repo).

## 1. profiles self-read RLS

Each logged-in user must be able to read their own profiles row so the app can
determine admin status. Run in the SQL editor:

\`\`\`sql
alter table public.profiles enable row level security;

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read"
  on public.profiles for select
  using (auth.uid() = id);
\`\`\`

No broad read policy is needed; the admin "Medlemmar" list is served by the
admin-members Edge Function using the service_role key.

## 2. Deploy the admin-members Edge Function

From the repo root, with the Supabase CLI logged in and linked to the project:

\`\`\`bash
supabase functions deploy admin-members
\`\`\`

The function reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the runtime
environment (auto-injected by Supabase) — the service_role key is never stored
in the repo.

## 3. Auth redirect URL (for password reset)

In Supabase: Authentication -> URL Configuration -> Redirect URLs, add:

    https://killefick.github.io/hskf-journal/

This is the page the password-reset email link returns to.
```

- [ ] **Step 2: Apply the RLS SQL in Supabase**

Run the SQL from section 1 of the doc in the Supabase SQL editor. (Manual; cannot be done from the repo.)

- [ ] **Step 3: Verify self-read works**

Log into the app as the known admin. Confirm the user label top-right shows "· admin" and the "🔒 Admin & analys" button is visible (this proves `enterApp()` read `profiles.role`). If the earlier diagnostic banner about "Kunde inte läsa behörighet" no longer appears, the policy is correct.

- [ ] **Step 4: Commit**

```bash
git add docs/supabase-setup.md
git commit -m "Document Supabase setup: profiles RLS, function deploy, redirect URL"
```

---

## Task 4: admin-members Edge Function

**Files:**
- Create: `supabase/functions/admin-members/index.ts`
- Create: `supabase/functions/admin-members/deno.json`

- [ ] **Step 1: Create the Deno config**

Create `supabase/functions/admin-members/deno.json`:

```json
{
  "imports": {
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2"
  }
}
```

- [ ] **Step 2: Write the function**

Create `supabase/functions/admin-members/index.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const VALID_ROLES = new Set(["admin", "member"]);
const isEmail = (s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // --- verify caller is an admin ---
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "Missing auth" }, 401);

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ ok: false, error: "Invalid auth" }, 401);
  const callerId = userData.user.id;

  const { data: prof, error: profErr } = await admin
    .from("profiles").select("role").eq("id", callerId).maybeSingle();
  if (profErr) return json({ ok: false, error: "Role lookup failed: " + profErr.message }, 500);
  if (!prof || prof.role !== "admin") return json({ ok: false, error: "Forbidden" }, 403);

  // --- dispatch ---
  let payload: any;
  try { payload = await req.json(); } catch { return json({ ok: false, error: "Bad JSON" }, 400); }
  const action = payload?.action;

  try {
    if (action === "list") {
      const { data: list, error } = await admin.auth.admin.listUsers();
      if (error) throw error;
      const { data: profs, error: pErr } = await admin.from("profiles").select("id, full_name, role");
      if (pErr) throw pErr;
      const byId = new Map((profs ?? []).map((p: any) => [p.id, p]));
      const members = list.users.map((u: any) => ({
        id: u.id,
        email: u.email,
        full_name: byId.get(u.id)?.full_name ?? "",
        role: byId.get(u.id)?.role ?? "member",
      }));
      return json({ ok: true, data: members });
    }

    if (action === "create") {
      const { email, full_name, role, password } = payload;
      if (!isEmail(email)) return json({ ok: false, error: "Ogiltig e-post" }, 400);
      if (!VALID_ROLES.has(role)) return json({ ok: false, error: "Ogiltig roll" }, 400);
      if (!password || String(password).length < 8) return json({ ok: false, error: "Lösenord minst 8 tecken" }, 400);

      const { data: created, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
      });
      if (error) throw error;
      const id = created.user.id;
      const { error: upErr } = await admin.from("profiles").upsert({ id, full_name: full_name ?? "", role });
      if (upErr) throw upErr;
      return json({ ok: true, data: { id, email, full_name: full_name ?? "", role } });
    }

    if (action === "setRole") {
      const { id, role } = payload;
      if (!id) return json({ ok: false, error: "id saknas" }, 400);
      if (!VALID_ROLES.has(role)) return json({ ok: false, error: "Ogiltig roll" }, 400);
      const { error } = await admin.from("profiles").upsert({ id, role });
      if (error) throw error;
      return json({ ok: true, data: { id, role } });
    }

    if (action === "delete") {
      const { id } = payload;
      if (!id) return json({ ok: false, error: "id saknas" }, 400);
      if (id === callerId) return json({ ok: false, error: "Du kan inte ta bort ditt eget konto" }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
      await admin.from("profiles").delete().eq("id", id); // no-op if FK cascade already removed it
      return json({ ok: true, data: { id } });
    }

    return json({ ok: false, error: "Okänd action" }, 400);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
```

- [ ] **Step 3: Commit (deploy happens in Task 5)**

```bash
git add supabase/functions/admin-members/index.ts supabase/functions/admin-members/deno.json
git commit -m "Add admin-members Edge Function for member CRUD"
```

---

## Task 5: Deploy and verify the Edge Function (manual)

**Files:** none (deploy + verification only).

- [ ] **Step 1: Deploy**

From the repo root, with the Supabase CLI linked to the project:

```bash
supabase functions deploy admin-members
```

Expected: deploy succeeds; the function appears in the Supabase dashboard under Edge Functions.

- [ ] **Step 2: Verify auth gating (negative test)**

Call the function without an admin token and confirm it is rejected. From a logged-in browser session as a NON-admin, run in the devtools console:

```js
const r = await sb.functions.invoke('admin-members', { body: { action: 'list' } });
console.log(r);
```

Expected: an error / `{ ok: false, error: "Forbidden" }` (HTTP 403). A logged-out call returns 401.

- [ ] **Step 3: Verify list (positive test)**

As the admin, in the devtools console:

```js
const r = await sb.functions.invoke('admin-members', { body: { action: 'list' } });
console.log(r.data);
```

Expected: `{ ok: true, data: [ {id,email,full_name,role}, ... ] }` listing existing users.

No commit (manual step).

---

## Task 6: Members section UI + wiring (admin-only)

**Files:**
- Modify: `index.html` — add `#membersCard` in `#adminView` (after `#compCard`, around `index.html:288`), add `#memberModal` near the other modals, add render + action JS, and trigger a member load when the admin view opens.

- [ ] **Step 1: Add the Medlemmar card markup**

In `index.html`, after the `#compCard` card closes (the `</div>` ending it, around line 288) and before `#adminView` closes at line 289, add:

```html
    <div class="card" id="membersCard">
      <div class="card-head">
        <h2>Medlemmar <span id="memberCount" class="hint"></span></h2>
        <button class="btn ghost tiny" id="addMemberBtn">＋ Lägg till medlem</button>
      </div>
      <div class="tbl-scroll">
        <table>
          <thead><tr><th>Namn</th><th>E-post</th><th>Roll</th><th></th></tr></thead>
          <tbody id="memberTbody"></tbody>
        </table>
      </div>
      <div class="empty hide" id="memberEmpty"><div>Inga medlemmar laddade.</div></div>
    </div>
```

- [ ] **Step 2: Add the add-member modal markup**

Near the other modals (after `#pwModal` from Task 2), add:

```html
<!-- ADD MEMBER MODAL -->
<div class="modal-bg" id="memberModal"><div class="modal">
  <div class="m-head"><h3>Lägg till medlem</h3></div>
  <div class="m-body">
    <div class="field"><label for="m-email">E-post</label><input type="email" id="m-email" autocomplete="off" inputmode="email"></div>
    <div class="field"><label for="m-name">Namn</label><input type="text" id="m-name" autocomplete="off"></div>
    <div class="field"><label for="m-role">Roll</label><select id="m-role"><option value="member">Medlem</option><option value="admin">Admin</option></select></div>
    <div class="field"><label for="m-pass">Lösenord (minst 8 tecken)</label><input type="text" id="m-pass" autocomplete="off"></div>
    <div id="mErr" style="color:var(--rust-d);font-size:13px;min-height:18px"></div>
  </div>
  <div class="m-foot">
    <button class="btn ghost" id="m-cancel">Avbryt</button>
    <button class="btn primary" id="m-save">Skapa medlem</button>
  </div>
</div></div>
```

> Mirror the exact `m-foot`/button classes used by `#editModal`.

- [ ] **Step 3: Add member-render and load logic**

Add a JS block near the other render functions (e.g. after `renderAdminTable`, around `index.html:540`):

```js
/* ---------- Members (admin) ---------- */
let members=[];
async function loadMembers(){
  const tb=$("#memberTbody");
  tb.innerHTML=`<tr><td colspan="4" class="hint">Laddar…</td></tr>`;
  const {data,error}=await sb.functions.invoke("admin-members",{body:{action:"list"}});
  if(error||!data||!data.ok){ tb.innerHTML=""; $("#memberEmpty").classList.remove("hide"); showBanner("warn","Kunde inte ladda medlemmar: "+esc((error&&error.message)||(data&&data.error)||"okänt fel")); return; }
  members=data.data||[];
  renderMembers();
}
function renderMembers(){
  const me=(window._uid||null);
  $("#memberCount").textContent=members.length?`(${members.length})`:"";
  $("#memberEmpty").classList.toggle("hide",members.length>0);
  $("#memberTbody").innerHTML=members.map(m=>{
    const isMe=m.id===_uid;
    const other=m.role==="admin"?"member":"admin";
    const otherLbl=other==="admin"?"Gör till admin":"Gör till medlem";
    return `<tr>
      <td>${esc(m.full_name)}</td>
      <td>${esc(m.email)}</td>
      <td><span class="pill ${m.role==="admin"?"medlem":""}">${m.role==="admin"?"Admin":"Medlem"}</span></td>
      <td style="white-space:nowrap;text-align:right">
        <button class="btn ghost tiny" data-role="${esc(m.id)}" data-to="${other}">${otherLbl}</button>
        <button class="btn ghost tiny" data-reset="${esc(m.email)}">↺ Återställ</button>
        ${isMe?"":`<button class="btn ghost tiny" data-delm="${esc(m.id)}">🗑 Ta bort</button>`}
      </td>
    </tr>`;
  }).join("");
}
```

> The `_uid` variable already exists (declared at `index.html:818`) and holds the logged-in user's id.

- [ ] **Step 4: Wire the member action buttons (event delegation)**

Add after the render block:

```js
$("#memberTbody").addEventListener("click",async(ev)=>{
  const roleBtn=ev.target.closest("[data-role]");
  const resetBtn=ev.target.closest("[data-reset]");
  const delBtn=ev.target.closest("[data-delm]");
  if(roleBtn){
    const r=await sb.functions.invoke("admin-members",{body:{action:"setRole",id:roleBtn.dataset.role,role:roleBtn.dataset.to}});
    if(r.error||!r.data?.ok){ showBanner("warn","Kunde inte ändra roll."); return; }
    await loadMembers();
  } else if(resetBtn){
    const {error}=await sb.auth.resetPasswordForEmail(resetBtn.dataset.reset,{redirectTo:location.origin+location.pathname});
    showBanner(error?"warn":"ok",error?("Kunde inte skicka: "+esc(error.message)):"Återställningsmejl skickat.",5000);
  } else if(delBtn){
    if(!confirm("Ta bort medlemmen permanent?")) return;
    const r=await sb.functions.invoke("admin-members",{body:{action:"delete",id:delBtn.dataset.delm}});
    if(r.error||!r.data?.ok){ showBanner("warn","Kunde inte ta bort: "+esc((r.data&&r.data.error)||"")); return; }
    await loadMembers();
  }
});
```

- [ ] **Step 5: Wire the add-member modal**

Add near the other modal listeners:

```js
$("#addMemberBtn").addEventListener("click",()=>{ $("#mErr").textContent=""; $("#m-email").value=""; $("#m-name").value=""; $("#m-role").value="member"; $("#m-pass").value=""; $("#memberModal").classList.add("open"); });
$("#m-cancel").addEventListener("click",()=>$("#memberModal").classList.remove("open"));
$("#memberModal").addEventListener("click",e=>{if(e.target.id==="memberModal")$("#memberModal").classList.remove("open");});
$("#m-save").addEventListener("click",async()=>{
  const email=$("#m-email").value.trim(), full_name=$("#m-name").value.trim(), role=$("#m-role").value, password=$("#m-pass").value;
  if(password.length<8){ $("#mErr").textContent="Lösenord minst 8 tecken."; return; }
  const r=await sb.functions.invoke("admin-members",{body:{action:"create",email,full_name,role,password}});
  if(r.error||!r.data?.ok){ $("#mErr").textContent=(r.data&&r.data.error)||(r.error&&r.error.message)||"Kunde inte skapa medlem."; return; }
  $("#memberModal").classList.remove("open");
  showBanner("ok","Medlem skapad.",5000);
  await loadMembers();
});
```

- [ ] **Step 6: Load members when the admin view opens (admin only)**

The admin button handler is at `index.html:697` (`$("#adminBtn").addEventListener("click",…)` which calls `renderAdmin()`). Add a `loadMembers()` call inside that handler, after `renderAdmin();`:

```js
  renderAdmin();
  if(isAdmin) loadMembers();
```

Also gate the card so non-admins never see a stray empty card: in `enterApp()` after `isAdmin` is known (around `index.html:809`), add:

```js
  $("#membersCard").classList.toggle("hide", !isAdmin);
```

- [ ] **Step 7: Manual verification**

As admin (after Task 5 deploy):
1. Open "Admin & analys" → the "Medlemmar" card lists existing users with roles.
2. Click "Lägg till medlem" → enter email, name, role=Medlem, an 8+ char password → "Medlem skapad" → list refreshes with the new member.
3. Open a private window, log in as the new member → succeeds; no Medlemmar card, no admin button.
4. Back as admin, click "Gör till admin" on that member → re-log them in → they now see the admin view.
5. Click "↺ Återställ" → member receives a reset email.
6. Click "🗑 Ta bort" → confirm → member disappears from the list and can no longer log in. Confirm your own row has no delete button.

Expected: all steps behave as described.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Add admin Medlemmar section: list, add, re-role, reset, remove"
```

---

## Task 7: Bump service worker version and final deploy

**Files:**
- Modify: `sw.js:6`

- [ ] **Step 1: Bump VERSION**

In `sw.js:6`, change `const VERSION = "v15";` to `const VERSION = "v16";`.

- [ ] **Step 2: Commit and push**

```bash
git add sw.js
git commit -m "Bump service worker to v16 for member management release"
git push
```

- [ ] **Step 3: Confirm Supabase steps are done**

Verify all three items in `docs/supabase-setup.md` are applied: (1) profiles self-read RLS, (2) `admin-members` deployed, (3) site URL in Auth redirect URLs. The password-reset email link and members CRUD only work fully once all three are in place.

- [ ] **Step 4: Final smoke test on the live site**

Open `https://killefick.github.io/hskf-journal/`, accept the "Uppdatering finns" prompt if shown, then re-run the key checks: editable date persists; forgot-password sends an email and the recovery modal sets a new password; admin can add/re-role/reset/remove a member.

---

## Self-review notes

- **Spec coverage:** Piece 1 → Task 1. Piece 2 (login link, recovery modal, redirect config) → Task 2 + Task 3 doc. Piece 3a (RLS) → Task 3. Piece 3b (Edge Function, all four actions + admin verification + own-account delete guard) → Task 4. Deploy → Task 5. Piece 3c (members card, modal, per-row actions, admin-only visibility) → Task 6. Deploy/SW bump → Task 7. All spec sections map to a task.
- **No automated tests:** intentional — no test framework exists; manual gates used instead (documented in header).
- **Naming consistency:** `loadMembers`/`renderMembers`/`members`/`_uid`, action strings `list`/`create`/`setRole`/`delete`, and DOM ids (`#membersCard`, `#memberModal`, `#memberTbody`, `m-email`/`m-name`/`m-role`/`m-pass`, `#pwModal`, `pw-new`) are used consistently across tasks and match the Edge Function's expected payload keys (`email`, `full_name`, `role`, `password`, `id`).
- **Assumptions verified against source:** `.banner.ok` success style exists (`index.html:137`, used at `:786`); the modal footer pattern is `<div class="m-foot"><button class="btn ghost">…<button class="btn primary">…` (`index.html:315`) — the new `#pwModal` and `#memberModal` mirror it exactly.
