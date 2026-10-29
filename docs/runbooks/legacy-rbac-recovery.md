# Legacy RBAC Migration Recovery

Use this procedure only when upgrading a database that still has `users.role`, or when verification shows that legacy administrator assignments were not copied into `user_role`. Stop application writers before recovery. Never edit a completed migration or its recorded checksum.

## Which variant applies

The schema changed under `public.user_role` with the multi-tenancy migrations, so the repair SQL depends on the migration version of the database (`node sources/devops/db/db.mjs query "select max(version) from public.construct_schema_migration where completed_at is not null"`).

- **Before migration 0046** (no `public.tenant`): use the legacy variant, `users.role` may still exist.
- **0046 or 0047**: apply the pending migrations through 0048 first with the normal checksummed command, then use the tenant variant. Do not hand-write rows into `user_role` at these versions.
- **0048 or later**: use the tenant variant. `users.role` is dropped by migration 0001, so the source of truth is an approved list of administrator emails (from the pre-migration backup or the incident record), never a guess.

## Who runs the SQL

- The runtime role (`construct_runtime`) cannot run the repair: it is neither allowed to bypass the tenant boundary nor to write memberships freely.
- `construct_owner` is `NOLOGIN`. Connect with the migration identity (`MIGRATION_DATABASE_URL`, a member of `construct_owner`) and start every transaction with `set local role construct_owner;`, exactly as `sources/devops/db/db.mjs` does.
- From 0046 the tenant tables are protected by row level security that is forced for the owner too. Every session that reads or writes `user_role`, `role` or `tenant_membership` must set the tenant first. This runbook repairs the default tenant (`slug = 'default'`).

## Preflight and backup

- [ ] ID=RBAC-REC-1, Title=Stop writers, Action=Scale the web deployment to zero or otherwise prevent role/status mutations.
- [ ] ID=RBAC-REC-2, Title=Record counts, Action=Run the preflight queries below and retain their output with the incident.
- [ ] ID=RBAC-REC-3, Title=Create backup, Action=Create and verify a custom-format backup using the operator-only migration identity.

Before migration 0046:

```sql
select exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'users' and column_name = 'role'
) as legacy_role_present;

select count(*) as legacy_admins from public.users where lower(role) = 'admin';
select count(distinct u.id) as migrated_active_admins
from public.users u
join public.user_role ur on ur.user_id = u.id and ur.id_role = 1
where u.id_user_status = 2;
```

Migration 0048 or later (the tenant is set first, and an active administrator needs an active membership, an active account and the `TENANT_ADMIN` role of the tenant):

```sql
begin;
set local role construct_owner;
select set_config('app.tenant_id', (select id::text from public.tenant where slug = 'default'), true);

select app_private.count_active_admins() as active_admins;
select count(*) as memberships, count(*) filter (where status = 'active') as active_memberships
from public.tenant_membership;
rollback;
```

```bash
pg_dump --format=custom --file=construct-before-rbac-recovery.dump "$MIGRATION_DATABASE_URL"
pg_restore --list construct-before-rbac-recovery.dump
```

Stop immediately if the backup cannot be listed, the authoritative legacy value is unavailable, or the intended administrator identities cannot be confirmed.

## Repair

- [ ] ID=RBAC-REC-4, Title=Restore assignments, Action=Inside one transaction, restore the tenant administrator role from `users.role` (legacy variant) or from the approved list of administrator emails (tenant variant).
- [ ] ID=RBAC-REC-5, Title=Verify invariant, Action=Confirm at least one intended active administrator and compare the migrated count with the preflight count before commit.

### Legacy variant (before migration 0046)

```sql
begin;
lock table public.users, public.user_role in share row exclusive mode;

insert into public.user_role (user_id, id_role)
select id, 1 from public.users where lower(role) = 'admin'
on conflict (user_id, id_role) do nothing;

do $$
begin
  if not exists (
    select 1 from public.users u
    join public.user_role ur on ur.user_id = u.id
    where ur.id_role = 1 and u.id_user_status = 2
  ) then
    raise exception 'recovery would leave no active administrator';
  end if;
end
$$;
commit;
```

### Tenant variant (migration 0048 or later)

Replace the email list with the approved administrators (lowercase: the comparison uses `lower(email)`). This is a break-glass procedure: the membership of each listed person is **reactivated** (`status = 'active'`) so that the administrator is usable at once; the global account status (`users.id_user_status`) is never changed here, so a globally deactivated account still fails the final check.

Every change to a membership or to a person's roles leaves a row in the tenant audit log (`public.tenant_audit_event`) **in the same transaction**: `member.add` for a person who had no membership, `member.status` when an existing membership is reactivated, `member.roles` when the `TENANT_ADMIN` role is granted. The rows carry `actor_kind = 'command'` and no person, like the rows written by `db.mjs`; replace `operator@example.com` (in the three audit selects) with who runs the repair, and the email list in all three places where it appears. The `id_tenant` column defaults to the tenant set below.

```sql
begin;
set local role construct_owner;
lock table public.users, public.tenant_membership, public.user_role in share row exclusive mode;

select set_config('app.tenant_id', (select id::text from public.tenant where slug = 'default'), true);

-- Who is listed and how things stood before the repair: the audit rows below depend on it.
create temporary table recovery_listed on commit drop as
select u.id as user_id,
       m.status as previous_status,
       exists (
         select 1 from public.user_role ur
         where ur.user_id = u.id and ur.id_role = (select id_role from public.role where system_key = 'TENANT_ADMIN')
       ) as had_admin_role
from public.users u
left join public.tenant_membership m on m.user_id = u.id
where lower(u.email) = any (array['admin@example.com']);

insert into public.tenant_membership (user_id, status)
select id, 'active' from public.users
where lower(email) = any (array['admin@example.com'])
on conflict (id_tenant, user_id) do update set status = 'active';

insert into public.user_role (user_id, id_role)
select u.id, (select id_role from public.role where system_key = 'TENANT_ADMIN')
from public.users u
where lower(u.email) = any (array['admin@example.com'])
on conflict (id_tenant, user_id, id_role) do nothing;

-- The matching audit rows, same transaction (the details have the shape the application writes).
insert into public.tenant_audit_event (actor_kind, actor_email, operation, object_type, object_id, details)
select 'command', 'operator@example.com', 'member.add', 'user', l.user_id::text, '{"invited": false}'::jsonb
from recovery_listed l where l.previous_status is null
union all
select 'command', 'operator@example.com', 'member.status', 'user', l.user_id::text, '{"status": "active"}'::jsonb
from recovery_listed l where l.previous_status is not null and l.previous_status <> 'active'
union all
select 'command', 'operator@example.com', 'member.roles', 'user', l.user_id::text,
       jsonb_build_object('roleIds', (select coalesce(jsonb_agg(ur.id_role order by ur.id_role), '[]'::jsonb)
                                      from public.user_role ur where ur.user_id = l.user_id))
from recovery_listed l where not l.had_admin_role;

do $$
begin
  if app_private.count_active_admins() = 0 then
    raise exception 'recovery would leave no active administrator';
  end if;
end
$$;
commit;
```

If `users.role` has already been dropped, restore the pre-migration backup to an isolated database, export only the approved user IDs/role assignments, and use that verified data as the authoritative insert source. Do not restore an entire production database over newer writes without explicit incident approval.

## Rollback and return to service

- [ ] ID=RBAC-REC-6, Title=Rollback decision, Action=On any count mismatch, roll back the transaction; if it already committed incorrectly, keep writers stopped and use the verified backup or a forward repair.
- [ ] ID=RBAC-REC-7, Title=Reapply migrations, Action=Run the normal checksummed migration command and confirm its history reports no checksum drift.
- [ ] ID=RBAC-REC-8, Title=Resume, Action=Test one administrator login/read and one safe RBAC read before restoring replicas.

```bash
node sources/devops/db/db.mjs schema-check
node sources/devops/db/db.mjs apply
```

Backup retention, restore authorization, and deletion of incident exports belong to the derived application's data-retention policy.
