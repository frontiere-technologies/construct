select t.name, 'not a classified tenant table' as problem
from unnest(array['tenant_platform_policy', 'tenant_area_entitlement', 'tenant_entitlement']) as t(name)
where not exists (select 1 from app_private.table_class tc where tc.table_name = t.name and tc.class = 'tenant')
union all
select t.name, 'the runtime cannot select'
from unnest(array['tenant_platform_policy', 'tenant_area_entitlement', 'tenant_entitlement']) as t(name)
where not has_table_privilege('construct_runtime', format('public.%I', t.name), 'select')
union all
select t.name, 'the runtime can write'
from unnest(array['tenant_platform_policy', 'tenant_area_entitlement', 'tenant_entitlement']) as t(name)
where has_table_privilege('construct_runtime', format('public.%I', t.name), 'insert,update,delete,truncate,trigger,references')
   or has_any_column_privilege('construct_runtime', format('public.%I', t.name), 'insert,update,references')
union all
select f.name, 'helper boundary differs'
from (values ('lock_tenant_policy', 0), ('effective_tenant_feature_codes', 0),
  ('menu_decode_path', 1), ('bind_menu_target', 3), ('menu_feature_binding_guard', 0)) as f(name, arity)
where not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'app_private' and p.proname = f.name and p.pronargs = f.arity
    and not p.prosecdef and 'search_path=""' = any(p.proconfig)
    and has_function_privilege('construct_runtime', p.oid, 'execute')
    and has_function_privilege('construct_owner', p.oid, 'execute')
    and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
order by 1, 2
