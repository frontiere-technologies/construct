with policy_tables(name) as (
  values ('tenant_platform_policy'), ('tenant_area_entitlement'), ('tenant_entitlement')
), helpers(signature, runtime_execute) as (
  values
    ('app_private.lock_tenant_policy()', true),
    ('app_private.effective_tenant_feature_codes()', true),
    ('app_private.menu_decode_path(text)', true),
    ('app_private.bind_menu_target(text,bigint,text)', true),
    ('app_private.menu_feature_binding_guard()', true),
    ('app_private.tenant_grant_feature_guard()', true),
    ('app_private.tenant_resource_write_lock()', false),
    ('app_private.tenant_resource_insert_guard()', false),
    ('app_private.configure_tenant_transaction(bigint)', true),
    ('app_private.assert_tenant_data_coverage(text)', true),
    ('app_private.check_tenant_archive_restore(jsonb,text,text,jsonb,uuid)', false),
    ('app_private.allocate_restore_ids(jsonb,regclass)', false),
    ('app_private.restore_tenant_archive(jsonb,text,text,jsonb,uuid)', false),
    ('app_private.normalize_platform_tenant_audit()', false),
    ('app_private.erase_tenant(bigint,text,uuid)', false),
    ('public.apply_role_permission_deltas(bigint,bigint[],bigint[])', true),
    ('public.apply_role_functionality_deltas(bigint,bigint[],bigint[])', true)
), guards(table_name, trigger_name, helper, trigger_type) as (
  values
    ('menu_entry', 'menu_feature_binding_guard', 'menu_feature_binding_guard', 23),
    ('role_permission', 'tenant_permission_feature_guard', 'tenant_grant_feature_guard', 23),
    ('role_functionality', 'tenant_functionality_feature_guard', 'tenant_grant_feature_guard', 23),
    ('tenant_membership', 'tenant_resource_write_lock', 'tenant_resource_write_lock', 22),
    ('role', 'tenant_resource_write_lock', 'tenant_resource_write_lock', 22),
    ('menu_entry', 'tenant_resource_write_lock', 'tenant_resource_write_lock', 22),
    ('tenant_membership', 'tenant_resource_insert_guard', 'tenant_resource_insert_guard', 4),
    ('role', 'tenant_resource_insert_guard', 'tenant_resource_insert_guard', 4),
    ('menu_entry', 'tenant_resource_insert_guard', 'tenant_resource_insert_guard', 4),
    ('platform_audit_event', 'normalize_platform_tenant_audit', 'normalize_platform_tenant_audit', 7)
)
select t.name, 'not a classified tenant table' as problem
from policy_tables t
where not exists (select 1 from app_private.table_class tc where tc.table_name = t.name and tc.class = 'tenant')
union all
select t.name, 'the runtime cannot select'
from policy_tables t
where not has_table_privilege('construct_runtime', format('public.%I', t.name), 'select')
union all
select t.name, 'the runtime can write'
from policy_tables t
where has_table_privilege('construct_runtime', format('public.%I', t.name), 'insert,update,delete,truncate,trigger,references')
   or has_any_column_privilege('construct_runtime', format('public.%I', t.name), 'insert,update,references')
union all
select f.signature, 'helper boundary differs'
from helpers f
where not exists (
  select 1 from pg_proc p
  where p.oid = to_regprocedure(f.signature) and p.proowner = 'construct_owner'::regrole
    and not p.prosecdef and 'search_path=""' = any(p.proconfig)
    and has_function_privilege('construct_runtime', p.oid, 'execute') = f.runtime_execute
    -- The functionality delta keeps its 0024 invoker ACL. Its policy lock lives in app_private.
    and (f.signature = 'public.apply_role_functionality_deltas(bigint,bigint[],bigint[])'
      or not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE')))
union all
select g.table_name, 'missing or disabled trigger ' || g.trigger_name
from guards g
where not exists (
  select 1 from pg_trigger t
  where t.tgrelid = to_regclass(format('public.%I', g.table_name)) and t.tgname = g.trigger_name
    and t.tgfoid = to_regprocedure(format('app_private.%I()', g.helper))
    and t.tgenabled in ('O', 'A') and t.tgtype = g.trigger_type)
union all
select 'platform_audit_event', 'missing or unvalidated tenant association constraint'
where not exists (
  select 1 from pg_constraint
  where conrelid = to_regclass('public.platform_audit_event')
    and conname = 'platform_audit_event_tenant_association_check' and contype = 'c' and convalidated)
order by 1, 2
