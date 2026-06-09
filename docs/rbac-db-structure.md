# RBAC Database Structure

## Model

```
user  → list of roles  (strings)
role  → list of claims (strings)
```

---

## Tables

### `roles`

Catalog of all available roles in the application.

| Column        | Type          | Notes                           |
|---------------|---------------|---------------------------------|
| `id`          | `text`        | PK, e.g. `"admin"`, `"viewer"` |
| `label`       | `text`        | Human-readable name             |
| `description` | `text`        | Optional description            |
| `created_at`  | `timestamptz` | Default `now()`                 |

### `role_claims`

Maps each role to its feature claims (a claim is an arbitrary string, e.g. `"menu:edit"`, `"reports:read"`).

| Column    | Type   | Notes                              |
|-----------|--------|------------------------------------|
| `role_id` | `text` | FK → `roles.id` ON DELETE CASCADE  |
| `claim`   | `text` | Feature string                     |
| PK        |        | `(role_id, claim)`                 |

### `user_roles`

Maps each Supabase user to their roles.

| Column        | Type          | Notes                                    |
|---------------|---------------|------------------------------------------|
| `user_id`     | `uuid`        | FK → `auth.users.id` ON DELETE CASCADE   |
| `role_id`     | `text`        | FK → `roles.id` ON DELETE CASCADE        |
| `assigned_at` | `timestamptz` | Default `now()`                          |
| PK            |               | `(user_id, role_id)`                     |

---

## Relation with `menu_items`

The existing `roles text[]` column in `menu_items` remains unchanged.
The front-end will compare the user's roles (fetched from `user_roles`) against the `roles` array of each menu item to determine visibility.

---

## Full DDL

Run in the Supabase **SQL Editor** in the order shown below.

```sql
-- ============================================================
-- RBAC Schema
-- ============================================================

-- 1. Roles catalog
create table if not exists roles (
  id          text primary key,
  label       text not null,
  description text,
  created_at  timestamptz not null default now()
);

-- 2. Claims per role
create table if not exists role_claims (
  role_id text not null references roles(id) on delete cascade,
  claim   text not null,
  primary key (role_id, claim)
);

create index if not exists idx_role_claims_role_id on role_claims(role_id);

-- 3. Roles per user
create table if not exists user_roles (
  user_id     uuid not null references auth.users(id) on delete cascade,
  role_id     text not null references roles(id)      on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index if not exists idx_user_roles_user_id on user_roles(user_id);
create index if not exists idx_user_roles_role_id on user_roles(role_id);
```

---

## RLS (Row Level Security)

```sql
-- roles: public read, authenticated write
alter table roles enable row level security;

create policy "roles: public read"
  on roles for select using (true);

create policy "roles: authenticated insert"
  on roles for insert to authenticated with check (true);

create policy "roles: authenticated update"
  on roles for update to authenticated using (true) with check (true);

create policy "roles: authenticated delete"
  on roles for delete to authenticated using (true);

-- role_claims: same policy
alter table role_claims enable row level security;

create policy "role_claims: public read"
  on role_claims for select using (true);

create policy "role_claims: authenticated insert"
  on role_claims for insert to authenticated with check (true);

create policy "role_claims: authenticated update"
  on role_claims for update to authenticated using (true) with check (true);

create policy "role_claims: authenticated delete"
  on role_claims for delete to authenticated using (true);

-- user_roles: each user reads only their own rows
alter table user_roles enable row level security;

create policy "user_roles: read own"
  on user_roles for select
  using (auth.uid() = user_id);

create policy "user_roles: authenticated insert"
  on user_roles for insert to authenticated with check (true);

create policy "user_roles: authenticated delete"
  on user_roles for delete to authenticated using (true);
```

---

## Helper: get all claims for a user

SQL function to retrieve every claim for a given `user_id`:

```sql
create or replace function get_user_claims(p_user_id uuid)
returns table(claim text) language sql security definer as $$
  select distinct rc.claim
  from   user_roles ur
  join   role_claims rc on rc.role_id = ur.role_id
  where  ur.user_id = p_user_id;
$$;
```

---

## How to modify the DB

### Add a new role

```sql
insert into roles (id, label, description)
values ('editor', 'Editor', 'Can edit content');
```

### Add a claim to a role

```sql
insert into role_claims (role_id, claim)
values ('editor', 'articles:write');
```

### Assign a role to a user

```sql
insert into user_roles (user_id, role_id)
values ('<user-uuid>', 'editor');
```

### Remove a claim from a role

```sql
delete from role_claims
where role_id = 'editor' and claim = 'articles:write';
```

### Remove a role (cascades automatically to `role_claims` and `user_roles`)

```sql
delete from roles where id = 'editor';
```

---

## ER Diagram

```
auth.users
    │ (uuid)
    └─< user_roles >─── roles ──< role_claims
         user_id           id        role_id
         role_id          label      claim
                          description
```
