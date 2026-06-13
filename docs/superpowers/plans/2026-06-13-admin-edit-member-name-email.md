# Admin Edit Member Name & Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin edit an existing member's name and email from the Medlemmar tab.

**Architecture:** Add an `update` action to the `admin-members` Supabase Edge Function (name → `profiles.full_name`, email → Auth via `updateUserById` with `email_confirm:true`). On the client, reuse the existing "Lägg till medlem" modal as a dual-mode add/edit dialog driven by a module-level `editingMemberId` flag, with a new ✎ Redigera button per row.

**Tech Stack:** Single-file static app (`index.html` inline `<script>`), Supabase Edge Function (Deno/TypeScript), GitHub Pages, service worker cache-bust via `sw.js` VERSION.

**Note on verification:** This repo has no automated test framework. Per project convention, the inline `<script>` is syntax-checked with `node --check` and behavior is verified manually. The edge function (Deno/TS) is verified by review and manual testing after redeploy. Reference: `docs/superpowers/specs/2026-06-13-admin-edit-member-name-email-design.md`.

---

### Task 1: Add `update` action to the edge function

**Files:**
- Modify: `supabase/functions/admin-members/index.ts` (insert a new action block after the `setRole` block, before the `delete` block, ~line 82)

- [ ] **Step 1: Add the `update` action block**

In `supabase/functions/admin-members/index.ts`, immediately after the closing `}` of the `if (action === "setRole")` block (currently ending ~line 82) and before `if (action === "delete")`, insert:

```ts
    if (action === "update") {
      const { id, full_name, email } = payload;
      if (!id) return json({ ok: false, error: "id saknas" }, 400);
      if (!isEmail(email)) return json({ ok: false, error: "Ogiltig e-post" }, 400);

      // Only call the auth API when the email actually changed.
      const { data: cur, error: getErr } = await admin.auth.admin.getUserById(id);
      if (getErr) throw getErr;
      if (cur.user?.email !== email) {
        const { error: emErr } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
        if (emErr) throw emErr;
      }

      const { error: upErr } = await admin.from("profiles").upsert({ id, full_name: full_name ?? "" });
      if (upErr) throw upErr;
      return json({ ok: true, data: { id, email, full_name: full_name ?? "" } });
    }
```

- [ ] **Step 2: Visually verify the block placement and balance**

Read the surrounding region and confirm: the new block sits between `setRole` and `delete`, uses the existing `isEmail` helper (defined at top of file) and `json` helper, and braces are balanced. There is no Node/Deno checker run here — review only.

Expected: `update` appears as a peer of the other `if (action === ...)` blocks; the trailing `return json({ ok: false, error: "Okänd action" }, 400);` still follows the `delete` block.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-members/index.ts
git commit -m "Add update action to admin-members (edit name + email)"
```

---

### Task 2: Add the ✎ Redigera button to each member row

**Files:**
- Modify: `index.html` — `renderMembers()` row template (~line 684-693)

- [ ] **Step 1: Add the edit button to the row actions cell**

In `index.html`, in `renderMembers()`, locate the actions `<td>` (the one with `style="white-space:nowrap;text-align:right"`, ~line 688). It currently contains `${sel}`, the login-link button, and the conditional delete button. Insert the edit button immediately after `${sel}` and before the login-link button:

```js
        ${sel}
        <button class="btn ghost tiny" data-editm="${esc(m.id)}" data-name="${esc(m.full_name)}" data-email="${esc(m.email)}">✎ Redigera</button>
        <button class="btn ghost tiny" data-reset="${esc(m.email)}">✉ Inloggningslänk</button>
        ${isMe?"":`<button class="btn ghost tiny" data-delm="${esc(m.id)}">🗑 Ta bort</button>`}
```

(The login-link and delete buttons are unchanged — shown for placement context.)

- [ ] **Step 2: Syntax-check the inline script**

Extract the inline `<script>` from `index.html` and run `node --check` on it:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n;\n');fs.writeFileSync('.check.js',m);"
node --check .check.js && rm .check.js
```

Expected: no output (exit 0) = syntax OK. If it errors, fix the template literal and re-run.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Add Redigera button to member rows"
```

---

### Task 3: Make the modal dual-mode (add vs edit) — state + open handlers

**Files:**
- Modify: `index.html` — member-modal handlers (~line 1120-1122) and the `#memberTbody` click handler (~line 702-714)

- [ ] **Step 1: Add the mode flag and rewrite the Add-member open handler**

In `index.html`, replace the existing `#addMemberBtn` click handler (currently the single line ~1120) with a flag declaration plus a reset-to-add handler:

```js
let editingMemberId = null;
$("#addMemberBtn").addEventListener("click",()=>{
  editingMemberId=null;
  $("#memberModal").querySelector("h3").textContent="Lägg till medlem";
  $("#m-save").textContent="Skapa medlem";
  $("#m-role").closest(".field").classList.remove("hide");
  $("#mErr").textContent=""; $("#m-email").value=""; $("#m-name").value=""; $("#m-role").value="member";
  $("#memberModal").classList.add("open");
});
```

- [ ] **Step 2: Add the edit-button branch to the members click handler**

In the existing `$("#memberTbody").addEventListener("click", ...)` handler (~line 702), it currently reads `resetBtn` and `delBtn` at the top. Add an `editBtn` lookup and an early-returning branch. Insert at the very start of the handler body, before the `const resetBtn=...` line:

```js
  const editBtn=ev.target.closest("[data-editm]");
  if(editBtn){
    editingMemberId=editBtn.dataset.editm;
    $("#memberModal").querySelector("h3").textContent="Redigera medlem";
    $("#m-save").textContent="Spara";
    $("#m-role").closest(".field").classList.add("hide");
    $("#mErr").textContent="";
    $("#m-email").value=editBtn.dataset.email||"";
    $("#m-name").value=editBtn.dataset.name||"";
    $("#memberModal").classList.add("open");
    return;
  }
```

- [ ] **Step 3: Syntax-check the inline script**

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n;\n');fs.writeFileSync('.check.js',m);"
node --check .check.js && rm .check.js
```

Expected: no output (exit 0).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Dual-mode member modal: edit state + open handlers"
```

---

### Task 4: Branch the save handler on add vs edit

**Files:**
- Modify: `index.html` — `#m-save` click handler (~line 1123-1133)

- [ ] **Step 1: Replace the save handler body**

In `index.html`, replace the entire existing `$("#m-save").addEventListener("click", async()=>{ ... })` handler with the branching version:

```js
$("#m-save").addEventListener("click",async()=>{
  const email=$("#m-email").value.trim(), full_name=$("#m-name").value.trim();
  if(!email||!full_name){ $("#mErr").textContent="Fyll i e-post och namn."; return; }
  const btn=$("#m-save"), btnLabel=btn.textContent;
  btn.disabled=true; btn.textContent=editingMemberId?"Sparar…":"Bjuder in…";
  let r;
  if(editingMemberId){
    r=await sb.functions.invoke("admin-members",{body:{action:"update",id:editingMemberId,email,full_name}});
  } else {
    const role=$("#m-role").value;
    r=await sb.functions.invoke("admin-members",{body:{action:"create",email,full_name,role,redirectTo:location.origin+location.pathname}});
  }
  btn.disabled=false; btn.textContent=btnLabel;
  if(r.error||!r.data?.ok){ $("#mErr").textContent=(r.data&&r.data.error)||(r.error&&r.error.message)||"Kunde inte spara."; return; }
  $("#memberModal").classList.remove("open");
  showBanner("ok",editingMemberId?"Medlem uppdaterad.":"Inbjudan skickad.",5000);
  await loadMembers();
});
```

- [ ] **Step 2: Syntax-check the inline script**

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n;\n');fs.writeFileSync('.check.js',m);"
node --check .check.js && rm .check.js
```

Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Branch member save handler: update vs create"
```

---

### Task 5: Bump service-worker version and final verification

**Files:**
- Modify: `sw.js` (VERSION constant near the top)

- [ ] **Step 1: Bump the VERSION**

Open `sw.js`, find the `VERSION` line (current value `v30` per latest release commit). Increment it to the next version, e.g. `v31`. Match the existing exact format/quotes used in the file.

- [ ] **Step 2: Final syntax check of the inline script**

```bash
node -e "const fs=require('fs');const h=fs.readFileSync('index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x=>x[1]).join('\n;\n');fs.writeFileSync('.check.js',m);"
node --check .check.js && rm .check.js
```

Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add sw.js
git commit -m "Bump sw VERSION for member edit feature"
```

- [ ] **Step 4: Deploy the edge function (manual, performed by the user/operator)**

The `admin-members` edge function must be redeployed for the `update` action to exist server-side. Per project convention edge functions are pasted/deployed via the Supabase dashboard (see `docs/supabase-setup.md`). Note this in the handoff; it is not a git step.

- [ ] **Step 5: Manual acceptance test (after deploy + push)**

As an admin, in the Medlemmar tab:
1. Click ✎ Redigera on a member → modal title is "Redigera medlem", email + name prefilled, no Roll field, save button reads "Spara".
2. Change the name and email → Spara → row shows both new values; banner "Medlem uppdaterad."
3. The member can log in with the new email (request an Inloggningslänk to the new address and confirm it arrives / works).
4. Edit only the name (leave email unchanged) → Spara succeeds (auth API not called).
5. Clear the name or email → Spara → inline error "Fyll i e-post och namn."
6. Click ＋ Lägg till medlem → modal is back in add-mode: title "Lägg till medlem", Roll field visible, save button "Skapa medlem", fields blank.

---

## Self-Review Notes

- **Spec coverage:** Edge `update` action (Task 1); ✎ Redigera button (Task 2); dual-mode modal state + open handlers incl. role-field hide (Task 3); save-handler branch (Task 4); sw VERSION bump, edge redeploy, manual acceptance (Task 5). All spec sections covered.
- **Type/name consistency:** `editingMemberId` flag, `action:"update"` payload `{id,email,full_name}`, and the function's `update` handler reading `{id, full_name, email}` are consistent across Tasks 1, 3, 4. `data-editm` / `data-name` / `data-email` set in Task 2 are read in Task 3.
- **No placeholders:** all steps contain concrete code/commands.
