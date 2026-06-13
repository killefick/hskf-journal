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

## 4. Enforce the read-only `revisor` role in the database (recommended)

The app hides all editing for `revisor` users in the UI, but for a true audit
role the database should also reject writes. The existing `update`/`delete`
policies require `created_by = auth.uid()` or admin — which still lets a former
member who became a revisor change their own old rows. Re-create all three write
policies so a revisor can never insert, update, or delete:

```sql
-- helper: is the caller a revisor?
-- (uses the profiles table; coalesce so a missing row is treated as non-revisor)
drop policy if exists "insert" on skjuttillfallen;
create policy "insert" on skjuttillfallen for insert to authenticated
  with check (coalesce((select role from public.profiles where id = auth.uid()), 'member') <> 'revisor');

drop policy if exists "update" on skjuttillfallen;
create policy "update" on skjuttillfallen for update to authenticated
  using ((created_by = auth.uid() or public.is_admin())
         and coalesce((select role from public.profiles where id = auth.uid()), 'member') <> 'revisor')
  with check ((created_by = auth.uid() or public.is_admin())
         and coalesce((select role from public.profiles where id = auth.uid()), 'member') <> 'revisor');

drop policy if exists "delete" on skjuttillfallen;
create policy "delete" on skjuttillfallen for delete to authenticated
  using ((created_by = auth.uid() or public.is_admin())
         and coalesce((select role from public.profiles where id = auth.uid()), 'member') <> 'revisor');
```

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
