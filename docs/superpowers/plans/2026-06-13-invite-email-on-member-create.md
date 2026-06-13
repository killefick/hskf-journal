# Swedish Invite Email on New-Member Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an admin creates a member, Supabase sends a Swedish invite email; the member clicks the link, sets their own password, and lands in the app.

**Architecture:** Replace the admin-typed-password account creation with Supabase's native `inviteUserByEmail`. The Swedish email body lives in the Supabase dashboard template; the app reuses its existing set-password modal for the invite landing by detecting `type=invite` in the return URL.

**Tech Stack:** Single static `index.html` (vanilla JS, no build), one Deno Edge Function (`admin-members`), Supabase Auth + Postgres, PWA service worker.

**Testing note:** This project has no test framework. Verification is `node --check` over the extracted inline script plus visual diff review (per project convention). Do not introduce a test runner.

---

### Task 1: Edge Function — switch `create` from password to invite

**Files:**
- Modify: `supabase/functions/admin-members/index.ts:59-73`

- [ ] **Step 1: Replace the `create` action block**

Find the current block (lines 59-73):

```ts
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
```

Replace it with:

```ts
    if (action === "create") {
      const { email, full_name, role, redirectTo } = payload;
      if (!isEmail(email)) return json({ ok: false, error: "Ogiltig e-post" }, 400);
      if (!VALID_ROLES.has(role)) return json({ ok: false, error: "Ogiltig roll" }, 400);

      const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { full_name: full_name ?? "" },
      });
      if (error) throw error;
      const id = invited.user.id;
      const { error: upErr } = await admin.from("profiles").upsert({ id, full_name: full_name ?? "", role });
      if (upErr) throw upErr;
      return json({ ok: true, data: { id, email, full_name: full_name ?? "", role } });
    }
```

Notes: the `password` parameter and its validation are gone; `redirectTo` is now read from the payload and forwarded to Supabase; `inviteUserByEmail` creates the user with no password and queues the invite email. Everything else (validation helpers, profile upsert, response shape) is unchanged.

- [ ] **Step 2: Syntax-check (optional, if Deno is installed)**

Run: `deno check supabase/functions/admin-members/index.ts`
Expected: no errors. If `deno` is not installed, skip — review the diff visually instead; the function is deployed manually by the user via the Supabase CLI.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-members/index.ts
git commit -m "admin-members: invite new members by email instead of admin-set password"
```

---

### Task 2: Client — remove the password field, send `redirectTo`, update copy

**Files:**
- Modify: `index.html:371` (member modal markup)
- Modify: `index.html:914` (add-member button reset)
- Modify: `index.html:917-928` (save handler)

- [ ] **Step 1: Remove the password field from the member modal**

Delete this line (currently line 371):

```html
    <div class="field"><label for="m-pass">Lösenord (minst 8 tecken)</label><input type="password" id="m-pass" autocomplete="new-password"></div>
```

The modal now collects only e-post, namn, and roll.

- [ ] **Step 2: Drop the password reset in the add-member button handler**

Find (line 914):

```js
$("#addMemberBtn").addEventListener("click",()=>{ $("#mErr").textContent=""; $("#m-email").value=""; $("#m-name").value=""; $("#m-role").value="member"; $("#m-pass").value=""; $("#memberModal").classList.add("open"); });
```

Replace with (remove the `$("#m-pass").value="";` clause):

```js
$("#addMemberBtn").addEventListener("click",()=>{ $("#mErr").textContent=""; $("#m-email").value=""; $("#m-name").value=""; $("#m-role").value="member"; $("#memberModal").classList.add("open"); });
```

- [ ] **Step 3: Update the save handler to invite instead of create-with-password**

Find (lines 917-928):

```js
$("#m-save").addEventListener("click",async()=>{
  const email=$("#m-email").value.trim(), full_name=$("#m-name").value.trim(), role=$("#m-role").value, password=$("#m-pass").value;
  if(!email||!full_name){ $("#mErr").textContent="Fyll i e-post och namn."; return; }
  if(password.length<8){ $("#mErr").textContent="Lösenord minst 8 tecken."; return; }
  const btn=$("#m-save"); btn.disabled=true; btn.textContent="Skapar…";
  const r=await sb.functions.invoke("admin-members",{body:{action:"create",email,full_name,role,password}});
  btn.disabled=false; btn.textContent="Skapa medlem";
  if(r.error||!r.data?.ok){ $("#mErr").textContent=(r.data&&r.data.error)||(r.error&&r.error.message)||"Kunde inte skapa medlem."; return; }
  $("#memberModal").classList.remove("open");
  showBanner("ok","Medlem skapad.",5000);
  await loadMembers();
});
```

Replace with:

```js
$("#m-save").addEventListener("click",async()=>{
  const email=$("#m-email").value.trim(), full_name=$("#m-name").value.trim(), role=$("#m-role").value;
  if(!email||!full_name){ $("#mErr").textContent="Fyll i e-post och namn."; return; }
  const btn=$("#m-save"); btn.disabled=true; btn.textContent="Bjuder in…";
  const r=await sb.functions.invoke("admin-members",{body:{action:"create",email,full_name,role,redirectTo:location.origin+location.pathname}});
  btn.disabled=false; btn.textContent="Skapa medlem";
  if(r.error||!r.data?.ok){ $("#mErr").textContent=(r.data&&r.data.error)||(r.error&&r.error.message)||"Kunde inte skapa medlem."; return; }
  $("#memberModal").classList.remove("open");
  showBanner("ok","Inbjudan skickad.",5000);
  await loadMembers();
});
```

Changes: `password` removed from the destructure, the body, and validation; busy label is now "Bjuder in…"; `redirectTo` is sent; success banner reads "Inbjudan skickad."

- [ ] **Step 4: Syntax-check the inline script**

Run (from repo root, Bash tool):

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const b=[...h.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim()).join('\n;\n');fs.writeFileSync('.tmp-app.js',b);" && node --check .tmp-app.js && echo SYNTAX_OK && rm .tmp-app.js
```

Expected: prints `SYNTAX_OK` with no error.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Member modal: invite by email, drop admin password field"
```

---

### Task 3: Client — open the set-password modal on invite landing

**Files:**
- Modify: `index.html:421` (insert invite-flag capture before client creation)
- Modify: `index.html:1046-1049` (extend `onAuthStateChange`)

- [ ] **Step 1: Capture the invite flag before the Supabase client consumes the hash**

Find (line 421):

```js
const sb = REMOTE ? supabase.createClient(URL_, KEY_) : null;
```

Insert a line immediately **above** it so the result becomes:

```js
let inviteFlow = location.hash.includes("type=invite");
const sb = REMOTE ? supabase.createClient(URL_, KEY_) : null;
```

This must run before `createClient`, because the client's `detectSessionInUrl` clears the hash as it establishes the session.

- [ ] **Step 2: Open the set-password modal for the invite event**

Find (lines 1046-1049):

```js
  sb.auth.onAuthStateChange((evt,session)=>{
    if(evt==="PASSWORD_RECOVERY"){ $("#pwErr").textContent=""; $("#pw-new").value=""; $("#pw-new2").value=""; $("#pwModal").classList.add("open"); return; }
    applyAuth(session);
  });
```

Replace with:

```js
  sb.auth.onAuthStateChange((evt,session)=>{
    if(evt==="PASSWORD_RECOVERY" || (evt==="SIGNED_IN" && inviteFlow)){
      inviteFlow=false;
      $("#pwErr").textContent=""; $("#pw-new").value=""; $("#pw-new2").value=""; $("#pwModal").classList.add("open"); return;
    }
    applyAuth(session);
  });
```

An invite link returns as a `SIGNED_IN` event (not `PASSWORD_RECOVERY`), so without this an invited user would be silently signed in with no password. The flag is cleared after first use so normal sign-ins are unaffected. The existing `#pwModal` save handler (`sb.auth.updateUser({password})`) is reused unchanged.

- [ ] **Step 3: Syntax-check the inline script**

Run:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const b=[...h.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim()).join('\n;\n');fs.writeFileSync('.tmp-app.js',b);" && node --check .tmp-app.js && echo SYNTAX_OK && rm .tmp-app.js
```

Expected: prints `SYNTAX_OK`.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Invite landing: open set-password modal on type=invite return"
```

---

### Task 4: Document the Supabase dashboard setup (Swedish template + SMTP)

**Files:**
- Modify: `docs/supabase-setup.md` (append a new section 6)

- [ ] **Step 1: Append section 6 to `docs/supabase-setup.md`**

Add at the end of the file:

```markdown
## 6. Inbjudningsmejl på svenska (för nya medlemmar)

När admin skapar en medlem skickar appen en inbjudan via Supabase
(`inviteUserByEmail`). Medlemmen klickar på länken, väljer ett eget lösenord och
landar i appen. Två manuella inställningar krävs i Supabase-dashboarden.

### 6a. Svensk mall för inbjudan

Authentication -> Email Templates -> "Invite user". Sätt ämne och brödtext, och
behåll variabeln `{{ .ConfirmationURL }}` som länk:

**Ämne:**

    Välkommen till Hillareds skytteförenings skjutjournal

**Brödtext (HTML):**

    <h2>Välkommen till Hillareds skytteförening</h2>
    <p>Ett konto har skapats åt dig i föreningens digitala skjutjournal.</p>
    <p>Klicka på länken nedan för att välja ett lösenord och logga in:</p>
    <p><a href="{{ .ConfirmationURL }}">Välj lösenord och logga in</a></p>
    <p>När du har loggat in kan du registrera dina skjuttillfällen och se din statistik.</p>
    <p>Om du inte väntade dig det här mejlet kan du bortse från det.</p>

Inbjudningslänken returnerar till samma adress som lösenordsåterställningen
(redirect-URL från steg 3) — ingen ny URL behöver läggas till.

### 6b. Egen SMTP (krävs)

Authentication -> SMTP Settings. Supabases inbyggda e-postavsändare levererar
bara till några få projektmedlemmars adresser och är hårt hastighetsbegränsad,
så riktiga medlemsinbjudningar kommer inte fram utan egen SMTP konfigurerad.
```

- [ ] **Step 2: Commit**

```bash
git add docs/supabase-setup.md
git commit -m "Docs: Swedish invite email template + SMTP setup step"
```

---

### Task 5: Bump the service-worker version

**Files:**
- Modify: `sw.js:6`

- [ ] **Step 1: Bump `VERSION`**

Find (line 6):

```js
const VERSION = "v19";
```

Replace with:

```js
const VERSION = "v20";
```

This makes installed PWA users see the "Uppdatering finns" prompt after deploy (per-deploy convention).

- [ ] **Step 2: Commit**

```bash
git add sw.js
git commit -m "Bump sw VERSION to v20"
```

---

## Post-implementation manual verification (after deploy + SMTP configured)

These require the deployed app and the dashboard steps from Task 4 — not part of the code tasks, but the definition of done:

1. Deploy the Edge Function: `supabase functions deploy admin-members`.
2. Push the repo (GitHub Pages auto-deploys the static app).
3. As admin: Admin & analys -> Medlemmar -> Lägg till medlem. Enter a test
   e-post + namn + roll, save. Confirm the banner reads "Inbjudan skickad."
4. Confirm the Swedish invite email arrives at the test address.
5. Click the link -> the set-password modal opens -> choose a password -> land
   in the app, logged in.

## Self-review notes

- **Spec coverage:** Edge Function invite (Task 1), modal/redirectTo/banner
  (Task 2), invite landing (Task 3), dashboard template + SMTP doc (Task 4),
  sw bump (Task 5). All spec sections mapped.
- **Type/name consistency:** `redirectTo` is sent by the client (Task 2) and
  read by the Edge Function (Task 1); `inviteFlow` is declared (Task 3 Step 1)
  and consumed (Task 3 Step 2). `#pwModal`/`#m-pass` ids match the existing
  markup.
- **No placeholders:** every code step shows the exact before/after.
