# Legacy RBAC Migration Recovery

Use this procedure only when upgrading a database that still has `users.role`, or when verification shows that legacy administrator assignments were not copied into `user_role`. Stop application writers before recovery. Never edit a completed migration or its recorded checksum.

## Preflight and backup

- [ ] ID=RBAC-REC-1, Title=Stop writers, Action=Scale the web deployment to zero or otherwise prevent role/status mutations.
- [ ] ID=RBAC-REC-2, Title=Record counts, Action=Run the preflight queries below and retain their output with the incident.
- [ ] ID=RBAC-REC-3, Title=Create backup, Action=Create and verify a custom-format backup using the operator-only migration identity.

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

```bash
pg_dump --format=custom --file=construct-before-rbac-recovery.dump "$MIGRATION_DATABASE_URL"
pg_restore --list construct-before-rbac-recovery.dump
```

Stop immediately if the backup cannot be listed, the authoritative legacy value is unavailable, or the intended administrator identities cannot be confirmed.

## Repair

- [ ] ID=RBAC-REC-4, Title=Restore assignments, Action=Inside one transaction, restore Administrator role `1` from `users.role` or another approved authoritative source.
- [ ] ID=RBAC-REC-5, Title=Verify invariant, Action=Confirm at least one intended active administrator and compare the migrated count with the preflight count before commit.

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
