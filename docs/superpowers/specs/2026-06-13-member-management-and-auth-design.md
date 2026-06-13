# Member management & auth self-service — design

Date: 2026-06-13
Status: Approved (design)

## Context

`index.html` is a single-file static app (served from GitHub Pages) backed by Supabase.
Auth is Supabase Auth; the anon/publishable key ships in the client. Admin status is
derived in `enterApp()` by reading the caller's own row from the `profiles` table and
checking `role === "admin"`. The shooting journal rows live in the `skjuttillfallen`
table. A service worker (`sw.js`) caches assets; `VERSION` is bumped on every deploy.

This design adds three independent pieces. The first two are pure client-side; the
third needs a Supabase Edge Function because creating/managing login accounts requires
the `service_role` key, which must never live in client code.

## Goals

1. **Registration date editable for everyone**, defaulting to today.
2. **Self-service password reset** from the login screen (email link), no backend.
3. **Admin "Medlemmar" section** to add, list, re-role, reset, and remove members,
   backed by a single admin-verified Edge Function.

## Non-goals

- Email-invite onboarding flow (admin sets an initial password instead).
- Bulk member import.
- Audit logging of admin actions.
- Changing the journal data model (`skjuttillfallen`) in any way.

---

## Piece 1 — Registration date field

**Current:** `#p-datum` renders as `<div id="p-datum" class="datum-fast">` showing
`pass.datum || today()` (read-only). `applyPassToForm()` sets its `textContent`.

**Change:**
- Replace the markup with `<input type="date" id="p-datum">`.
- `applyPassToForm()` sets `.value` (instead of `.textContent`) to `pass.datum || today()`.
- Add a `change` listener on `#p-datum`: `pass.datum = $("#p-datum").value || today();
  savePass(); renderLog();` (renderLog re-filters the session list by the new date and
  updates `#passDateLabel`).
- Init already runs `pass.datum = today(); savePass();`, so "today as standard" is
  preserved; the value persists in localStorage across reloads as it does today.

**Availability:** all users (not gated on `isAdmin`).

**Edge cases:** if the input is cleared (empty value), fall back to `today()` so
`pass.datum` is never blank.

---

## Piece 2 — Self-service password reset (client-only)

**Login screen (`#authView`):** add a "Glömt lösenord?" link below the login button.
Clicking it reads the email field (or prompts if empty) and calls:

```js
sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })
```

Then shows a confirmation banner ("Om kontot finns skickas en återställningslänk …").
Errors are surfaced via the existing `showBanner("warn", …)`.

**Recovery handling:** Supabase fires a `PASSWORD_RECOVERY` event through
`sb.auth.onAuthStateChange` when the user returns via the email link (the recovery
token is in the URL hash). On that event:
- Show a "Sätt nytt lösenord" modal (new modal `#pwModal`, two password inputs:
  new + confirm).
- On save: validate the two match and length ≥ 8, then
  `sb.auth.updateUser({ password })`. On success, close modal, banner "Lösenord
  uppdaterat", and let the normal authed flow continue.

**Supabase config (manual, one-time):** add the deployed site URL
(`https://killefick.github.io/hskf-journal/`) to *Auth → URL Configuration →
Redirect URLs*. Documented in the plan; cannot be done from the repo.

---

## Piece 3 — Members section + Edge Function

### 3a. RLS prerequisite (manual SQL, one-time)

Ensure each authenticated user can read **their own** `profiles` row (this is what
`enterApp()` needs to set `isAdmin`; a missing policy here is the suspected cause of the
prior "admin can't edit date" bug):

```sql
alter table public.profiles enable row level security;

create policy "profiles self read"
  on public.profiles for select
  using (auth.uid() = id);
```

No broad read policy is needed: the members **list** is served by the Edge Function
using `service_role`, so the client never selects other users' profile rows directly.

### 3b. Edge Function `admin-members`

A single Deno Edge Function handling four actions. It is invoked from the client via
`sb.functions.invoke('admin-members', { body: { action, ... } })`, which automatically
attaches the logged-in user's JWT in the `Authorization` header.

**Authorization (every action):**
1. Read the caller's JWT from the `Authorization` header; resolve the user via a
   service-role client (`auth.getUser(jwt)`).
2. Look up that user's `profiles.role` with the service-role client.
3. If not `admin`, return HTTP 403. Otherwise proceed.

The function uses the auto-injected `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
env vars provided by the Supabase edge runtime. The service_role key never appears in
the repo or client.

**Actions:**
- `list` → returns `[{ id, email, full_name, role }]`. Pulls emails from
  `auth.admin.listUsers()` and joins names/roles from `profiles`.
- `create { email, full_name, role, password }` →
  `auth.admin.createUser({ email, password, email_confirm: true })`, then upsert a
  `profiles` row `{ id, full_name, role }`. Returns the new member. Validates email
  format, role ∈ {`admin`,`member`}, password length ≥ 8.
- `setRole { id, role }` → upsert `profiles.role` for that id. Validates role.
- `delete { id }` → `auth.admin.deleteUser(id)` (profiles row removed via FK cascade,
  or explicit delete if no cascade). Guard: a caller cannot delete their own account.

**Responses:** JSON `{ ok: true, data }` or `{ ok: false, error }` with appropriate
HTTP status. CORS headers permit the GitHub Pages origin (and `*` for invoke is fine
since auth is enforced by JWT).

### 3c. Members UI (admin-only)

A new card `#membersCard` inside `#adminView`, rendered only when `isAdmin`:

- Header "Medlemmar" + a "＋ Lägg till medlem" button.
- Table: Namn | E-post | Roll (badge) | Åtgärder.
- Per-row actions: **Roll** (toggle/select member↔admin → `setRole`),
  **↺ Återställ lösenord** (sends reset email via `resetPasswordForEmail`),
  **🗑 Ta bort** (confirm → `delete`). The current admin's own row hides the delete
  action.
- "Lägg till medlem" opens modal `#memberModal`: E-post, Namn, Roll (select), Lösenord
  (initial). On save → `create`, then refresh the list.

Loading the list calls `admin-members { action: "list" }` when the admin view opens
(or when the members card first renders). Errors surface via `showBanner`.

### 3d. Deploy steps (manual, one-time — documented in the plan)

1. Run the RLS SQL above (3a).
2. `supabase functions deploy admin-members` (service_role auto-injected at runtime).
3. Add the site URL to Auth redirect URLs (shared with Piece 2).

---

## Data flow summary

- Date field & reset link & recovery: client ↔ Supabase Auth/anon directly.
- Members CRUD: client (admin JWT) → `admin-members` Edge Function (service_role) →
  Supabase Auth admin API + `profiles`.

## Testing

- **Piece 1:** load page, change date input, reload → date persists; session list filters
  to the chosen date; clearing the field falls back to today.
- **Piece 2:** request reset for a known email → email arrives; follow link → recovery
  modal appears → set password → can log in with the new password.
- **Piece 3:** as admin, add a member (then log in as them); change their role and
  confirm admin button visibility flips; send reset email; remove a member. As a
  non-admin, confirm the Medlemmar card is absent and a forged `admin-members` invoke
  returns 403.

## Deployment

Bump `sw.js` `VERSION` (currently `v15` → next) on deploy so installed PWA users get the
update prompt. Edge Function and SQL are applied in Supabase separately from the git push.
