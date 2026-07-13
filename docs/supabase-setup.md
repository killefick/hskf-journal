# Supabase one-time setup

These steps are applied in the Supabase project (not via the git repo).

## 1. profiles self-read RLS

Each logged-in user must be able to read their own profiles row so the app can
determine admin status. Run in the SQL editor:

```sql
alter table public.profiles enable row level security;

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read"
  on public.profiles for select
  using (auth.uid() = id);
```

No broad read policy is needed; the admin "Medlemmar" list is served by the
admin-members Edge Function using the service_role key.

## 2. Deploy the admin-members Edge Function

From the repo root, with the Supabase CLI logged in and linked to the project:

```bash
supabase functions deploy admin-members
```

The function reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the runtime
environment (auto-injected by Supabase) — the service_role key is never stored
in the repo.

## 3. Auth redirect URL (for password reset)

In Supabase: Authentication -> URL Configuration -> Redirect URLs, add:

    https://killefick.github.io/hskf-journal/

This is the page the password-reset email link returns to.

## 4. The `revisor` role — trusted logger + auditor

> **Changed 2026-06-17.** `revisor` is no longer a write-blocked, read-only role.
> A revisor can now **log shots for any shooter (like an admin)** and see
> everything, but cannot manage members, edit/delete other people's posts, mark
> paid, or send invoices. Those limits are enforced by the base RLS policies plus
> the `guard_skjut_write` trigger (see README / step 12 / step 13) — no
> revisor-specific write-block policy.
>
> **If you previously applied the old read-only-revisor policies from this step,
> undo them by running step 13**, which restores the base policies and the
> revisor-aware trigger.

Assign the role from the app (Admin & analys -> Medlemmar -> role dropdown), or
directly:

```sql
update profiles set role='revisor'
  where id = (select id from auth.users where email = 'granskare@exempel.se');
```

## 5. "Betald"-kolumn för att nollställa skottpengar (migrering)

Admin kan markera en skytts köpta skott som betalda, vilket nollställer "Att betala"
för den skytten (posterna ligger kvar i journalen). Lägg till kolumnen en gång:

```sql
alter table skjuttillfallen
  add column if not exists betald boolean not null default false;
```

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

### 6b. Svensk mall för lösenordsåterställning

Authentication -> Email Templates -> "Reset Password". Sätt ämne och brödtext,
och behåll variabeln `{{ .ConfirmationURL }}` som länk:

**Ämne:**

    Återställ ditt lösenord – Hillareds skytteförening

**Brödtext (HTML):**

    <h2>Återställ ditt lösenord</h2>
    <p>Vi fick en begäran om att återställa lösenordet till ditt konto i
    Hillareds skytteförenings skjutjournal.</p>
    <p>Klicka på länken nedan för att välja ett nytt lösenord:</p>
    <p><a href="{{ .ConfirmationURL }}">Välj nytt lösenord</a></p>
    <p>Om du inte begärde en återställning kan du bortse från det här mejlet –
    ditt lösenord ändras inte.</p>

Länken returnerar till samma adress som inbjudan (redirect-URL från steg 3).

### 6c. Svensk mall för bekräftelse av registrering

Authentication -> Email Templates -> "Confirm signup". Sätt ämne och brödtext,
och behåll variabeln `{{ .ConfirmationURL }}` som länk:

**Ämne:**

    Bekräfta din e-postadress – Hillareds skytteförening

**Brödtext (HTML):**

    <h2>Bekräfta din e-postadress</h2>
    <p>Följ länken nedan för att bekräfta den här e-postadressen och slutföra registreringen.</p>
    <p><a href="{{ .ConfirmationURL }}">Bekräfta e-postadress</a></p>

### 6d. Svensk mall för byte av e-postadress

Authentication -> Email Templates -> "Change Email Address". Sätt ämne och
brödtext, och behåll variablerna `{{ .ConfirmationURL }}` och `{{ .NewEmail }}`:

**Ämne:**

    Bekräfta din nya e-postadress – Hillareds skytteförening

**Brödtext (HTML):**

    <h2>Bekräfta din nya e-postadress</h2>
    <p>Följ länken nedan för att bekräfta {{ .NewEmail }} som din nya e-postadress.</p>
    <p><a href="{{ .ConfirmationURL }}">Bekräfta ny e-postadress</a></p>
    <p>Om du inte begärde den här ändringen kan du bortse från det här mejlet.</p>

### 6e. Egen SMTP (krävs)

Authentication -> SMTP Settings. Supabases inbyggda e-postavsändare levererar
bara till några få projektmedlemmars adresser och är hårt hastighetsbegränsad,
så riktiga medlemsinbjudningar kommer inte fram utan egen SMTP konfigurerad.

## 7. Faktura för ammunition (e-post)

Admin kan skicka en klartext-faktura per e-post till varje skytt med kvarstående
skottpengar (knapparna **Skicka faktura** / **Skicka alla fakturor** under
**Att betala**). Fakturan listar köpta skott per datum, totalsumma, Bankgiro
**370-4624** och meddelandet `<namn> Ammunition`. E-post per skytt sparas i en
egen tabell; klienten läser den aldrig direkt – allt går via en admin-skyddad
edge-funktion som skickar via Brevo.

### 7a. Tabell för e-post och skickat-status

```sql
create table skytt_faktura (
  skytt_namn      text primary key,   -- trimmad skyttnamn, matchar "Att betala"
  email           text,
  faktura_skickad timestamptz
);

-- RLS på utan policies: service_role (edge-funktionen) kringgår RLS, alla
-- direkta authenticated/anon-läsningar och skrivningar nekas.
alter table skytt_faktura enable row level security;
```

### 7b. Brevo-hemligheter och deploy

Sätt API-nyckel och avsändare som funktionshemligheter (Supabase CLI, inloggad
och länkad till projektet). Avsändaradressen måste vara verifierad i Brevo
(Senders & domains), annars vägras utskick:

```bash
supabase secrets set \
  BREVO_API_KEY=xkeysib-... \
  BREVO_SENDER_EMAIL=styrelsen@hillaredsskf.se \
  BREVO_SENDER_NAME="Hillareds skytteförening"

supabase functions deploy send-invoice

## 8. Normalize shooter references to member id (2026-06-15)

Shooters are now referenced by member id, not a free-text name. Only test data
existed, so this wipes and recreates — no backfill. Run in the SQL editor:

````sql
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

revoke select on public.member_directory from anon;
grant select on public.member_directory to authenticated;
````

A member rename is now just `update public.profiles set full_name = … where id = …`;
no journal/invoice propagation is needed.

## 9. Deactivate / reactivate member (2026-06-15)

Adds a reversible active/inactive flag on members. Deactivation also bans the
auth login (done in the `admin-members` function, not here). Run in the SQL editor:

```sql
alter table public.profiles
  add column if not exists active boolean not null default true;

-- member_directory must expose `active` so the client can filter the logging
-- picker to active members while still resolving names for inactive ones.
-- NOTE: Supabase's "Security Definer View" linter warning on this view is
-- expected — the RLS bypass is intentional and it exposes only id/full_name/active.
drop view if exists public.member_directory;
create view public.member_directory
  with (security_invoker = off) as
  select id, full_name, active from public.profiles;

revoke select on public.member_directory from anon;
grant select on public.member_directory to authenticated;
```

No backfill — existing members default to `active = true`. Redeploy
`admin-members` after (it gains `deactivate`/`reactivate`).

## 10. Backup/restore — send-invoice `restore` action (2026-06-15)

`send-invoice` gained a `restore` action (admin-gated) that bulk-upserts
`skytt_faktura` rows from a backup file, skipping any whose `skytt_id` no longer
exists in `profiles`. No SQL change — just redeploy the function. The journal
half of restore runs client-side via the admin's existing RLS.

## 13. Let revisor log shots (2026-06-17)

`revisor` becomes a trusted logger: it can insert journal rows for any shooter
(like an admin) but still can't mark paid, reassign a shooter, or change
purchased-ammo status. This restores the base write policies (undoing the old
read-only-revisor policies from step 4 if you ran them) and replaces the guard
trigger with a revisor-aware version. Run in the SQL editor:

```sql
-- Base write policies (member/admin; revisor passes insert via created_by = self).
drop policy if exists "insert" on skjuttillfallen;
create policy "insert" on skjuttillfallen for insert to authenticated
  with check (public.is_admin() or created_by = auth.uid());

drop policy if exists "update" on skjuttillfallen;
create policy "update" on skjuttillfallen for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (created_by = auth.uid() or public.is_admin());

drop policy if exists "delete" on skjuttillfallen;
create policy "delete" on skjuttillfallen for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- Revisor-aware column guard.
create or replace function public.guard_skjut_write() returns trigger
  language plpgsql security definer set search_path = public as $$
  declare caller_role text;
  begin
    if public.is_admin() then return new; end if;
    select role into caller_role from public.profiles where id = auth.uid();
    if (tg_op = 'INSERT') then
      if coalesce(caller_role,'member') <> 'revisor' then
        if new.created_by is distinct from auth.uid()
          then raise exception 'created_by must be the current user'; end if;
        if new.skytt_id is distinct from auth.uid()
          then raise exception 'members can only log their own shots'; end if;
      end if;
      if coalesce(new.betald, false) <> false
        then raise exception 'only an admin can mark an entry as paid'; end if;
      return new;
    end if;
    if (tg_op = 'UPDATE') then
      if new.skytt_id is distinct from old.skytt_id
        then raise exception 'only an admin can change the shooter'; end if;
      if coalesce(new.kopt,false) is distinct from coalesce(old.kopt,false)
        then raise exception 'only an admin can change purchased-ammo status'; end if;
      if coalesce(new.betald,false) is distinct from coalesce(old.betald,false)
        then raise exception 'only an admin can change paid status'; end if;
      return new;
    end if;
    return new;
  end; $$;
-- trigger itself is unchanged from step 12; create only if missing:
drop trigger if exists guard_skjut_write on skjuttillfallen;
create trigger guard_skjut_write
  before insert or update on skjuttillfallen
  for each row execute function public.guard_skjut_write();
```

## 11. Disable self-registration (REQUIRED)

The app never calls `signUp` — new members are created **only** by an admin
(Medlemmar → Lägg till medlem → invite email), and the invitee sets a password
via the reset link before they can log in. The whole role model assumes nobody
can self-register. Verify it stays off:

Authentication → **Providers → Email → "Allow new users to sign up" = OFF**.

If this is ever enabled, anyone on the internet can create an `authenticated`
account; the `read` policy on `skjuttillfallen` (`using (true)`) would then expose
the entire journal to them. Keep it off.

## 12. Harden journal write policies (2026-06-17)

Brings an existing database up to the secure base in the README. Without this, a
member can call the REST API directly with the public anon key + their own token
and (a) insert journal rows attributed to other members, and (b) flip
`betald`/`kopt` on their own rows to erase ammunition debt — RLS is row-level and
can't restrict columns. Run in the SQL editor:

```sql
-- (a) Tighten insert so a member can only create rows for themselves.
--     If you ran step 4 (revisor), use that variant instead of this one.
drop policy if exists "insert" on skjuttillfallen;
create policy "insert" on skjuttillfallen for insert to authenticated
  with check (public.is_admin() or created_by = auth.uid());

-- (b) Column-level guard: betald/kopt/skytt_id are admin-only to change.
create or replace function public.guard_skjut_write() returns trigger
  language plpgsql security definer set search_path = public as $$
  begin
    if public.is_admin() then return new; end if;
    if (tg_op = 'INSERT') then
      if new.created_by is distinct from auth.uid()
        then raise exception 'created_by must be the current user'; end if;
      if new.skytt_id is distinct from auth.uid()
        then raise exception 'members can only log their own shots'; end if;
      if coalesce(new.betald, false) <> false
        then raise exception 'only an admin can mark an entry as paid'; end if;
      return new;
    end if;
    if (tg_op = 'UPDATE') then
      if new.skytt_id is distinct from old.skytt_id
        then raise exception 'only an admin can change the shooter'; end if;
      if coalesce(new.kopt,false) is distinct from coalesce(old.kopt,false)
        then raise exception 'only an admin can change purchased-ammo status'; end if;
      if coalesce(new.betald,false) is distinct from coalesce(old.betald,false)
        then raise exception 'only an admin can change paid status'; end if;
      return new;
    end if;
    return new;
  end; $$;
drop trigger if exists guard_skjut_write on skjuttillfallen;
create trigger guard_skjut_write
  before insert or update on skjuttillfallen
  for each row execute function public.guard_skjut_write();
```

> **Note on admin inserts for other shooters.** When an admin logs shots for
> another member, `created_by` defaults to the admin's uid while `skytt_id` is the
> other member — allowed because `public.is_admin()` short-circuits the guard.
