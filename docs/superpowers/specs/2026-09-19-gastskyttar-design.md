# Gästskyttar

Datum: 2026-09-19

## Problem

En gäst sköt på banan idag och hans resultat gick inte att registrera. Journalen
känner bara medlemmar: `skjuttillfallen.skytt_id` är `uuid not null references
public.profiles(id)`, och `profiles.id` är i sin tur `references auth.users` —
en skytt måste alltså ha ett inloggningskonto för att kunna finnas i journalen.

Behovet är en gästskytt från annan förening som deltar i en tävling. Gästen kan
återkomma, kan behöva faktureras för köpta skott, och kan senare värvas som
medlem — då ska historiken följa med.

## Beslut

| Fråga | Beslut |
|---|---|
| Vad är en gäst | Tävlingsdeltagare från annan förening – inte prova-på |
| Identitet | En `profiles`-rad utan konto (`gast = true`), inte fritext på journalraden |
| Återkommande | Ja – gästen väljs ur en lista nästa gång |
| E-post | Valfri. Krävs inte för att registrera, används i steg 2 och 3 |
| Fakturering | Ja, gästen ska kunna debiteras för köpta skott (steg 2) |
| Bli medlem | Ja, med historiken bevarad (steg 3) |
| Årsstatistik | Gästen räknas **inte** i totalt antal skott, antal skyttar eller månadsdiagrammet |
| Tävlingsresultat | Gästen syns, märkt `(gäst)` |
| Vem får skapa gäst | Admin **och** ledare – det är skjutledaren som står vid banan |
| När | Gästalternativet finns alltid, inte bara när passet är en tävling |

## Datamodell

`profiles` slutar betyda "konto" och börjar betyda "person". En medlem är en
person med ett `auth.users`-konto som delar id med profilen; en gäst är en
person utan konto.

```
profiles
  id         uuid primary key      -- = auth.users.id för medlemmar,
                                   --   slumpat gen_random_uuid() för gäster
  full_name  text
  role       text default 'member'
  active     boolean default true
  gast       boolean default false -- NY
  email      text                  -- NY, bara för gäster (medlemmens e-post
                                   --   bor i auth.users och hämtas därifrån)
```

Kopplingen `profiles.id references auth.users on delete cascade` tas bort. Det
är hela poängen: utan den kan en profil existera utan konto. RLS-policyn
`profiles self read` (`id = auth.uid()`) matchar aldrig en gästrad, och
`handle_new_user` rör bara rader som skapas av auth. **En gäst kan därför inte
logga in.**

Allt som idag är nycklat på `profiles(id)` fungerar oförändrat för gäster:

| Funktion | Ändring som krävs |
|---|---|
| `skjuttillfallen.skytt_id` (FK) | ingen |
| `skytt_faktura.skytt_id` (FK, PK) | ingen |
| Namnuppslag via `member_directory` | vyn får kolumnen `gast` |
| Backup/restore | filtret måste sluta utgå från kontolistan (se nedan) |
| RLS + `guard_skjut_write` | ingen |

### Konsekvens av att FK:n försvinner

Radering av en medlem slutar städa `profiles` automatiskt. `admin-members` gör
redan `delete from profiles` efter `deleteUser` i både `delete` (rad ~190) och
`forceDelete` (rad ~205). De raderna går från redundanta till **nödvändiga** och
får inte tas bort.

Raderas ett konto direkt i Supabase-dashboarden blir profilraden kvar som
föräldralös. Den har `gast = false` och skulle då dyka upp under *Medlemmar* i
väljaren trots att kontot är borta. Radering ska därför ske i appen. En
städfråga för den som ändå gör fel läggs i setup-dokumentet.

## SQL (steg 1)

```sql
-- 1. profiles blir "person" i stället för "konto": släpp FK:n mot auth.users.
--    Namnet på constrainten slås upp så att migreringen fungerar oavsett vad
--    den råkar heta i just den här databasen.
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.profiles'::regclass
     and contype = 'f'
     and confrelid = 'auth.users'::regclass;
  if c is not null then
    execute format('alter table public.profiles drop constraint %I', c);
  end if;
end $$;

-- 2. Gästmarkering + valfri e-post.
alter table public.profiles add column if not exists gast boolean not null default false;
alter table public.profiles add column if not exists email text;

-- 3. member_directory exponerar gast så klienten kan dela upp väljaren och
--    hålla gäster utanför årsstatistiken. Fortfarande aldrig roll eller e-post.
drop view if exists public.member_directory;
create view public.member_directory
  with (security_invoker = off) as
  select id, full_name, active, gast from public.profiles;

revoke select on public.member_directory from anon;
grant select on public.member_directory to authenticated;
```

Ingen backfill: befintliga profiler får `gast = false`.

## Edge function: `admin-members` → ny action `createGuest`

```
in:  { action: "createGuest", full_name: string, email?: string }
ut:  { ok: true, data: { id, full_name, email, gast: true } }
```

- **Behörighet:** admin och revisor (ledare). `createGuest` läggs till i
  `REVISOR_ALLOWED`. En ledare kan redan skriva journalrader åt vem som helst,
  så det vidgar inte behörigheten nämnvärt.
- **Rör aldrig auth-API:t.** Skriver bara en `profiles`-rad med hårdkodat
  `role: 'member'`, `gast: true`, `active: true` och `id: crypto.randomUUID()`.
  En gäst kan alltså inte bli ett konto av misstag.
- **Validering:** `full_name` krävs (trimmat, icke-tomt). `email` är valfri men
  måste passera `isEmail` om den är satt.
- **Idempotent på namn:** finns redan en aktiv gäst med samma namn (trimmat,
  skiftlägesokänsligt) returneras den befintliga gästen i stället för att en
  dubblett skapas. Det är skyddet mot att samma gäst läggs upp två gånger.

## Klient (`index.html`)

**Katalogen**

```js
loadDirectory()      // select id, full_name, active, gast
dirById: id -> { name, active, gast }
isGuestId(id)        // dirById.get(id)?.gast === true
nameOf(id)           // oförändrad – rent namn, används i fakturatexter
displayName(id)      // nameOf + " (gäst)" för gäster – används i listor
directoryOptions()   // aktiva MEDLEMMAR (gast = false)
guestOptions()       // aktiva GÄSTER (gast = true)
```

`nameOf` lämnas orörd med flit: fakturamejl och bekräftelsedialoger ska säga
personens namn, inte "Anna Svensson (gäst)".

**Skyttväljaren** (`renderSkyttPicker`, rad ~1084) för admin/ledare:

```
[ Välj skytt…            ]
[ + Ny gästskytt…        ]   <- value="__guest__"
[ -- Medlemmar --        ]   <- optgroup
[ -- Gäster --           ]   <- optgroup, visas bara om det finns gäster
```

Väljs `__guest__` öppnas en liten dialog med **Namn** (krävs) och **E-post**
(valfri). Vid spara: `createGuest` → `loadDirectory()` → `renderSkyttPicker()` →
den nya gästen blir vald. Avbryt återställer väljaren till tomt val.

**Var gästen syns med `(gäst)`:** dagens pass (`renderLog`, rad ~772),
loggtabellen (`renderAdminTable`, rad ~925), tävlingsresultaten (`renderComp`,
rad ~1077) och journalexporten (`logRows`, rad ~1176) samt tävlingsexporten
(rad ~1187).

**Var gästen hålls utanför** (`renderAdmin`, rad ~855): totalt antal skott,
antal skjutdagar, antal skyttar, utestående-summan, månadsdiagrammet och
skyttetabellen filtreras på `!isGuestId(e.skytt_id)`. Samma filter i
betalningsexporten (`payRows`, rad ~1180).

**Redigeringsdialogen** (`editPickerOptions`, rad ~689) får samma uppdelning, så
att en admin kan flytta en felregistrerad rad mellan medlem och gäst.

**Återställning från backup** (rad ~1265): idag byggs `ids` från
`admin-members list`, som listar **auth-konton**. En gästrad skulle då tyst
hoppas över vid återställning. Filtret ska i stället bygga `ids` ur
`member_directory` (alla personer, medlem som gäst).

> Känd begränsning, oförändrad: säkerhetskopian innehåller inte `profiles`. Att
> återställa i en tom databas tappar därför både medlemmar och gäster. Gäller
> redan idag för medlemmar och ligger utanför den här specen.

## Steg 2 – fakturera gäst (byggs inte nu)

- Gästen tillbaka i skyttetabellen i Analys, märkt `(gäst)`, men fortfarande
  utanför rubriksiffrorna och månadsdiagrammet.
- `accountEmail(id)` faller tillbaka på `profiles.email` när personen är gäst.
  Kräver att `admin-members list` även returnerar profiler utan konto — annars
  finns ingen admin-gatad väg till gästens e-post (den får **inte** läggas i
  `member_directory`, som alla inloggade kan läsa).
- Fakturautskicket självt behöver ingen ändring: `skytt_faktura.skytt_id` pekar
  redan på `profiles(id)`.
- Massutskicket ska hoppa över gäster utan e-post, precis som medlemmar utan.

## Steg 3 – gör gäst till medlem (byggs inte nu)

Ny admin-action `convertGuest { id, email, role }`:

1. `inviteUserByEmail(email)` → **nytt** uuid (auth-API:t tillåter inte att man
   väljer id).
2. `update skjuttillfallen set skytt_id = <nytt> where skytt_id = <gammalt>`
3. `update skytt_faktura` likadant — slå ihop om båda har en rad.
4. `delete from profiles where id = <gammalt>`

Ordningen är given av att FK:erna är `on delete restrict`: peka om först,
radera sedan. Steg 3 tar också hand om två luckor som steg 1 lämnar öppna:

- **Felstavad gäst går inte att ta bort i appen.** Idempotensen på namn hindrar
  dubbletter men inte stavfel. Tills steg 3 finns städas de i SQL-editorn.
- `deactivate`/`reactivate` anropar `auth.admin.updateUserById` och kraschar på
  en gäst. Ingen UI-väg anropar dem för gäster i steg 1, men de måste grena på
  `gast` innan gästhantering exponeras.

## Verifiering

Projektet har inget testramverk (se CLAUDE.md), så verifieringen är manuell och
körs i den här ordningen:

1. `node --check` på det inlinade scriptet i `index.html` och på `sw.js`.
2. SQL-blocket körs i Supabase SQL-editorn. Kontrollera efteråt:
   `select id, full_name, gast from public.member_directory limit 5;` ska ha
   kolumnen `gast`, och en `insert` i `profiles` med ett uuid som inte finns i
   `auth.users` ska gå igenom.
3. Deploya `admin-members`.
4. I appen, som admin: registrera en gäst via `+ Ny gästskytt…`, kontrollera att
   hen syns i dagens pass som `Namn (gäst)`, att skottet **inte** syns i
   Analysens rubriksiffror, och att gästen finns kvar i väljaren nästa gång.
5. Som ledare: samma sak — `createGuest` ska vara tillåten.
6. Som medlem: skyttväljaren ska fortfarande vara dold och bara logga en själv.
7. Bumpa `APP_VERSION` i `index.html` och `VERSION` i `sw.js`.
