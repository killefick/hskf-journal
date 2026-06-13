# Spec: Admin can edit a member's name and email

**Date:** 2026-06-13
**Status:** Approved, ready for implementation plan

## Goal

Let an **admin** change an existing member's **name** (`profiles.full_name`) and
**email** (Supabase Auth `auth.users.email`) from the **Medlemmar** admin tab.
Today that tab can change role and delete a member, and invite new ones, but
there is no way to edit an existing member's name or email.

## Approach

Reuse the existing **"Lägg till medlem"** modal as a dual-mode add/edit dialog,
and add a new `update` action to the `admin-members` edge function. Email changes
take effect immediately (admin is trusted, `email_confirm: true`) — the member is
not asked to confirm. Role stays out of the edit modal because it already has its
own inline dropdown in the table; editing only touches name + email.

## Changes

### 1. Edge function — `supabase/functions/admin-members/index.ts`

Add an `update` action alongside `list` / `create` / `setRole` / `delete`:

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

The admin-gate and CORS at the top of the function already cover this action; no
other edge-function changes are needed.

#### Name propagation (rename everywhere)

A member's name is duplicated by **exact string match** (there is no member FK on
journal data) in two tables: `skjuttillfallen.skytt` (every journal entry — the
grouping key for the per-shooter / Tävling / Totals views) and
`skytt_faktura.skytt_namn` (saved invoice email + sent-status). When the name
changes, the `update` action propagates it server-side (service role bypasses
RLS):

1. Fetch the **old** name by id: `select full_name from profiles where id = :id`
   (before the upsert) — the client never sends the old name.
2. Upsert the profile to the new name.
3. If old name is non-empty and differs from new: `update skjuttillfallen set
   skytt = new where skytt = old` (with `.select("id")` to count affected rows)
   and `update skytt_faktura set skytt_namn = new where skytt_namn = old`.
4. Return `renamed` = the journal row count in the response data.

Caveats (inherent, no FK): if the profile name never matched the journal `skytt`
spelling, nothing is renamed; if two members share an identical name, both their
journal rows move together. Out of scope: fuzzy/case-insensitive matching,
linking entries to member IDs.

### 2. Members table row — `renderMembers` (`index.html`, ~line 684)

Add an **✎ Redigera** button per row (before the role dropdown / login-link /
delete). It carries the data needed to prefill the modal:

```html
<button class="btn ghost tiny" data-editm="${esc(m.id)}"
  data-name="${esc(m.full_name)}" data-email="${esc(m.email)}">✎ Redigera</button>
```

### 3. Dual-mode modal state + open handlers (`index.html`, ~line 1120)

Introduce a module-level mode flag and a small helper that resets the modal to
add-mode, then wire the edit button:

```js
let editingMemberId = null;

// Add mode (existing button) — reset to "create"
$("#addMemberBtn").addEventListener("click",()=>{
  editingMemberId=null;
  $("#memberModal").querySelector("h3").textContent="Lägg till medlem";
  $("#m-save").textContent="Skapa medlem";
  $("#m-role").closest(".field").classList.remove("hide");
  $("#mErr").textContent=""; $("#m-email").value=""; $("#m-name").value=""; $("#m-role").value="member";
  $("#memberModal").classList.add("open");
});
```

Edit button (in the existing `#memberTbody` click handler, alongside
`data-reset` / `data-delm`):

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

### 4. Save handler branch — `#m-save` click (`index.html`, ~line 1123)

Branch on `editingMemberId`:

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
  let msg=editingMemberId?"Medlem uppdaterad.":"Inbjudan skickad.";
  const renamed=editingMemberId?(r.data?.renamed||0):0;
  if(renamed>0) msg+=` ${renamed} journalpost${renamed===1?"":"er"} omdöpt${renamed===1?"":"a"}.`;
  showBanner("ok",msg,5000);
  await loadMembers();
});
```

Confirm a `.hide` CSS rule exists (it is used elsewhere in `index.html`); if so,
reuse it for hiding the role field.

## Verification

- Extract the inline `<script>` and `node --check` it.
- `node --check supabase/functions/admin-members/index.ts` is not meaningful
  (Deno/TS) — rely on review for the edge function.
- Bump `VERSION` in `sw.js`.
- Redeploy the `admin-members` edge function (Supabase dashboard, per project
  convention) so the `update` action exists server-side.
- Manual: as admin, open Medlemmar → ✎ Redigera on a member → modal shows
  "Redigera medlem", prefilled email + name, no Roll field → change name and
  email, Spara → row reflects both, banner "Medlem uppdaterad." The member can
  log in with the new email (e.g. request an Inloggningslänk to the new address).
  Editing only the name (email unchanged) succeeds without touching auth. Empty
  name or email shows "Fyll i e-post och namn." Opening Lägg till medlem
  afterwards shows add-mode again (title, Skapa medlem button, Roll field back).

## Out of scope (YAGNI)

- Self-service profile editing (members editing their own name/email).
- Editing role inside the modal (role keeps its inline dropdown).
- Email-change confirmation flow (double opt-in to the new address).
- Bulk editing.
