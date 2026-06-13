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
