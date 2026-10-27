import { expect, it } from 'vitest'
import { is, SQL, sql } from 'drizzle-orm'
import { getTableConfig, getViewConfig, PgDialect, PgTable, PgView } from 'drizzle-orm/pg-core'
import type { IndexedColumn } from 'drizzle-orm/pg-core'
import { withGlobal } from '@/lib/db/tenant-db'
import * as drizzleSchema from '@/lib/db/schema'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { assertExactCatalogSection } from './schema-contract'

describeIntegration('database runtime boundary', () => {
  it('keeps the deployed catalog aligned with the complete Drizzle model', async () => {
    const tableConfigs = Object.values(drizzleSchema)
      .filter(value => is(value, PgTable))
      .map(table => getTableConfig(table))
      .sort((left, right) => left.name.localeCompare(right.name))
    const expectedTables = tableConfigs.map(config => config.name)
    const deployedTables = await withGlobal(tx => tx.execute<{ tableName: string }>(sql`
      select c.relname as "tableName"
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and c.relname <> 'construct_schema_migration'
      order by c.relname
    `))
    assertExactCatalogSection('tables', expectedTables, deployedTables.map(row => row.tableName))

    const deployedColumns = await withGlobal(tx => tx.execute<{
      tableName: string
      columnName: string
      sqlType: string
      notNull: boolean
      hasDefault: boolean
    }>(sql`
      select c.relname as "tableName", a.attname as "columnName",
        format_type(a.atttypid, a.atttypmod) as "sqlType", a.attnotnull as "notNull",
        -- A column generated as identity has no pg_attrdef row, but Drizzle models it (and the
        -- database fills it) as having a default.
        (defaults.adbin is not null or a.attidentity <> '') as "hasDefault"
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join pg_attrdef defaults on defaults.adrelid = c.oid and defaults.adnum = a.attnum
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and c.relname <> 'construct_schema_migration'
      order by c.relname, a.attnum
    `))
    const normalizeType = (value: string) => value.replace('character varying', 'varchar')
    const expectedColumns = tableConfigs.flatMap(config => config.columns.map(column => ({
      tableName: config.name,
      columnName: column.name,
      sqlType: normalizeType(column.getSQLType()),
      notNull: column.notNull,
      hasDefault: column.hasDefault,
    })))
    assertExactCatalogSection('columns', expectedColumns, deployedColumns.map(column => ({ ...column, sqlType: normalizeType(column.sqlType) })))

    const dialect = new PgDialect()
    const normalizeExpression = (value: string | null | undefined) => (value ?? '')
      .replaceAll('"', '')
      .replaceAll(/\b[a-z_][a-z0-9_]*\./g, '')
      .replaceAll(/[()\s]/g, '')
      .toLowerCase()
    const expectedIndexes = tableConfigs.flatMap(config => config.indexes.map(index => {
      // Drizzle types `name` as optional because an index may be declared
      // anonymous. This schema names every one, and an anonymous index could not
      // be matched against pg_class.relname anyway — so fail loudly rather than
      // substituting a placeholder that would silently collide with the next one.
      const indexName = index.config.name
      if (!indexName) throw new Error(`index on ${config.name} has no name; the catalog comparison needs one`)
      return {
        indexName,
        unique: index.config.unique,
        // An index column is either a real column or a raw SQL expression.
        // `'name' in column` reads like a narrowing but leaves the SQL branch in
        // the union, so `sqlToQuery` received a type it could not accept; `is()`
        // is Drizzle's own type guard and narrows both branches properly.
        columns: index.config.columns.map(column => {
          if (is(column, SQL)) return dialect.sqlToQuery(column).sql
          // A failed `is()` cannot narrow `Partial<SQL | IndexedColumn>` — the
          // negative branch of a type predicate does not distribute over a
          // Partial of a union — so the remaining branch is asserted. The
          // assertion is safe precisely because the SQL case returned above.
          return String((column as Partial<IndexedColumn>).name)
        }),
        predicate: normalizeExpression(index.config.where ? dialect.sqlToQuery(index.config.where).sql : null),
      }
    })).sort((left, right) => left.indexName.localeCompare(right.indexName))
    const deployedIndexes = await withGlobal(tx => tx.execute<{ indexName: string; unique: boolean; columns: string[]; predicate: string | null }>(sql`
      select index_class.relname as "indexName", idx.indisunique as unique,
        array_agg(attribute.attname order by key_position.ordinality) as columns,
        pg_get_expr(idx.indpred, idx.indrelid) as predicate
      from pg_index idx
      join pg_class table_class on table_class.oid = idx.indrelid
      join pg_namespace n on n.oid = table_class.relnamespace
      join pg_class index_class on index_class.oid = idx.indexrelid
      left join pg_constraint constraint_row on constraint_row.conindid = idx.indexrelid
      cross join lateral unnest(idx.indkey) with ordinality as key_position(attnum, ordinality)
      join pg_attribute attribute on attribute.attrelid = table_class.oid and attribute.attnum = key_position.attnum
      where n.nspname = 'public' and constraint_row.oid is null
      group by index_class.relname, idx.indisunique, idx.indpred, idx.indrelid
      order by index_class.relname
    `))
    assertExactCatalogSection('indexes', expectedIndexes, deployedIndexes.map(index => ({
      ...index,
      predicate: normalizeExpression(index.predicate),
    })))

    const expectedForeignKeys = tableConfigs.flatMap(config => config.foreignKeys.map(foreignKey => {
      const reference = foreignKey.reference()
      return `${config.name}:${reference.columns.map(column => column.name).join(',')}->${getTableConfig(reference.foreignTable).name}:${reference.foreignColumns.map(column => column.name).join(',')}:${foreignKey.onDelete ?? 'no action'}:${foreignKey.onUpdate ?? 'no action'}`
    })).sort()
    const deployedForeignKeys = await withGlobal(tx => tx.execute<{
      tableName: string
      columns: string[]
      foreignTable: string
      foreignColumns: string[]
      onDelete: string
      onUpdate: string
    }>(sql`
      select source.relname as "tableName",
        array_agg(source_column.attname order by key_position.ordinality) as columns,
        target.relname as "foreignTable",
        array_agg(target_column.attname order by key_position.ordinality) as "foreignColumns",
        case constraint_row.confdeltype when 'c' then 'cascade' when 'n' then 'set null' when 'r' then 'restrict' when 'a' then 'no action' else 'set default' end as "onDelete",
        case constraint_row.confupdtype when 'c' then 'cascade' when 'n' then 'set null' when 'r' then 'restrict' when 'a' then 'no action' else 'set default' end as "onUpdate"
      from pg_constraint constraint_row
      join pg_class source on source.oid = constraint_row.conrelid
      join pg_namespace n on n.oid = source.relnamespace
      join pg_class target on target.oid = constraint_row.confrelid
      cross join lateral unnest(constraint_row.conkey, constraint_row.confkey) with ordinality as key_position(source_attnum, target_attnum, ordinality)
      join pg_attribute source_column on source_column.attrelid = source.oid and source_column.attnum = key_position.source_attnum
      join pg_attribute target_column on target_column.attrelid = target.oid and target_column.attnum = key_position.target_attnum
      where n.nspname = 'public' and constraint_row.contype = 'f'
      group by source.relname, target.relname, constraint_row.oid
      order by source.relname, constraint_row.oid
    `))
    assertExactCatalogSection(
      'foreign keys',
      expectedForeignKeys,
      deployedForeignKeys.map(key => `${key.tableName}:${key.columns.join(',')}->${key.foreignTable}:${key.foreignColumns.join(',')}:${key.onDelete}:${key.onUpdate}`).sort(),
    )

    // Annotated, not inferred. With a single view in the schema, `config.name`
    // infers as the literal "role_list_view", and since the helper takes both
    // sides as the same T the deployed rows — plain strings read from pg_class —
    // could never satisfy it. Widening here keeps the helper's guarantee that the
    // two sides have the same shape.
    interface ViewShape { viewName: string; columns: { name: string; type: string }[] }
    const expectedViews: ViewShape[] = Object.values(drizzleSchema)
      .filter(value => is(value, PgView))
      .map(view => {
        const config = getViewConfig(view)
        return {
          viewName: config.name,
          // `selectedFields` is an untyped bag of column-ish values, so each
          // access is probed rather than assumed.
          columns: Object.values(config.selectedFields as Record<string, unknown>).map(value => {
            const field = value as { name?: unknown; getSQLType?: () => string }
            return {
              name: typeof field.name === 'string' ? field.name : '',
              type: typeof field.getSQLType === 'function' ? field.getSQLType() : '',
            }
          }),
        }
      })
      .sort((left, right) => left.viewName.localeCompare(right.viewName))
    const deployedViewColumns = await withGlobal(tx => tx.execute<{ viewName: string; name: string; type: string }>(sql`
      select view_class.relname as "viewName", attribute.attname as name,
        format_type(attribute.atttypid, attribute.atttypmod) as type
      from pg_class view_class
      join pg_namespace n on n.oid = view_class.relnamespace
      join pg_attribute attribute on attribute.attrelid = view_class.oid and attribute.attnum > 0 and not attribute.attisdropped
      where n.nspname = 'public' and view_class.relkind = 'v'
      order by view_class.relname, attribute.attnum
    `))
    const deployedViews = Array.from(new Set(deployedViewColumns.map(column => column.viewName))).map(viewName => ({
      viewName,
      columns: deployedViewColumns.filter(column => column.viewName === viewName).map(column => ({
        name: column.name,
        type: normalizeType(column.type),
      })),
    }))
    assertExactCatalogSection('views', expectedViews, deployedViews)
  })

  it('defines a non-privileged runtime role', async () => {
    const roles = await withGlobal(tx => tx.execute<{
      rolcanlogin: boolean
      rolsuper: boolean
      rolcreatedb: boolean
      rolcreaterole: boolean
      rolreplication: boolean
      rolbypassrls: boolean
    }>(sql`
      select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      from pg_roles where rolname = 'construct_runtime'
    `))
    expect(roles).toEqual([{
      rolcanlogin: false,
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
    }])
  })

  it('does not expose application relations through Data API roles', async () => {
    const grants = await withGlobal(tx => tx.execute(sql`
      select grantee, table_name, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('PUBLIC', 'anon', 'authenticated')
        and table_name <> 'construct_schema_migration'
    `))
    expect(grants).toHaveLength(0)

    // Default privileges are recorded per owner role and per schema, and
    // 0005_data_api_default_privileges.sql can only revoke its own: `alter default
    // privileges` without FOR ROLE applies to the current role, and altering another
    // role's defaults requires membership in it. On Supabase the platform keeps its
    // own entries under supabase_admin, a superuser no client role can join, so an
    // assertion of "zero entries anywhere" can never hold there — it also swept up
    // the storage, graphql and graphql_public schemas, which hold no application
    // data. What is enforceable, and what 0005 achieves, is that no owner *we*
    // control leaves anon/authenticated with default privileges in public.
    //
    // Expressed as a subset check rather than a count so a regression still fails:
    // if the migration's own defaults come back, `postgres` appears here and the
    // assertion breaks. Residual risk accepted deliberately: supabase_admin's
    // entries would grant anon/authenticated on tables created in public *by
    // supabase_admin*. Application tables are created by the migration identity, so
    // they do not inherit them, and the revoke in 0002_runtime_boundary.sql plus RLS
    // cover the relations that exist. See docs/reviews/2026-08-19-env-configuration.md,
    // finding DB-3.
    const PLATFORM_OWNED_ROLES = ['supabase_admin']
    const defaultGrantOwners = await withGlobal(tx => tx.execute(sql`
      select distinct defaclrole::regrole::text as owner
      from pg_default_acl defaults
      cross join lateral aclexplode(coalesce(defaults.defaclacl, acldefault(defaults.defaclobjtype, defaults.defaclrole))) acl
      join pg_roles grantee on grantee.oid = acl.grantee
      where grantee.rolname in ('anon', 'authenticated')
        and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE', 'USAGE')
        and defaults.defaclnamespace = 'public'::regnamespace
    `))
    const ownersWeControl = (defaultGrantOwners as unknown as { owner: string }[])
      .map(row => row.owner)
      .filter(owner => !PLATFORM_OWNED_ROLES.includes(owner))
    expect(ownersWeControl).toEqual([])
  })

  it('uses an invoker-rights view and declares reverse lookup indexes', async () => {
    const views = await withGlobal(tx => tx.execute<{ reloptions: string[] | null }>(sql`
      select c.reloptions
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'role_list_view'
    `))
    expect(views[0]?.reloptions).toContain('security_invoker=true')

    const indexes = await withGlobal(tx => tx.execute<{ indexname: string }>(sql`
      select indexname from pg_indexes
      where schemaname = 'public'
        and indexname in ('user_role_id_role_user_id_idx', 'permission_parent_order_idx')
      order by indexname
    `))
    expect(indexes.map(row => row.indexname)).toEqual([
      'permission_parent_order_idx',
      'user_role_id_role_user_id_idx',
    ])
  })

  it('runs every function in public and app_private with the caller rights', async () => {
    const definers = await withGlobal(tx => tx.execute<{ name: string }>(sql`
      select p.proname as name
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app_private') and p.prosecdef
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by p.proname
    `))
    expect(definers.map(row => row.name)).toEqual([])
  })

  it('lets construct_owner, and only it, own the application objects', async () => {
    const [owner] = await withGlobal(tx => tx.execute<{ rolcanlogin: boolean; rolbypassrls: boolean; rolsuper: boolean }>(sql`
      select rolcanlogin, rolbypassrls, rolsuper from pg_roles where rolname = 'construct_owner'
    `))
    expect(owner).toEqual({ rolcanlogin: false, rolbypassrls: false, rolsuper: false })

    const strays = await withGlobal(tx => tx.execute<{ name: string; owner: string }>(sql`
      select c.relname as name, r.rolname as owner
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_roles r on r.oid = c.relowner
      where n.nspname in ('public', 'app_private') and c.relkind in ('r', 'p', 'v', 'S')
        and c.relname <> 'construct_schema_migration'
        and r.rolname <> 'construct_owner'
        and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      union all
      select p.proname, r.rolname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles r on r.oid = p.proowner
      where n.nspname in ('public', 'app_private') and r.rolname <> 'construct_owner'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      union all
      select n.nspname, r.rolname
      from pg_namespace n
      join pg_roles r on r.oid = n.nspowner
      where n.nspname = 'app_private' and r.rolname <> 'construct_owner'
      order by 1
    `))
    expect(strays).toEqual([])
  })

  it('classifies every application table', async () => {
    const unclassified = await withGlobal(tx => tx.execute<{ name: string }>(sql`
      select c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and c.relname <> 'construct_schema_migration'
        and not exists (select 1 from app_private.table_class tc where tc.table_name = c.relname)
      order by 1
    `))
    expect(unclassified.map(row => row.name)).toEqual([])
  })

  it('forces row level security on every classified table', async () => {
    const loose = await withGlobal(tx => tx.execute<{ name: string }>(sql`
      select tc.table_name as name
      from app_private.table_class tc
      join pg_class c on c.relname = tc.table_name and c.relnamespace = 'public'::regnamespace
      where not (c.relrowsecurity and c.relforcerowsecurity)
      order by 1
    `))
    expect(loose.map(row => row.name)).toEqual([])
  })

  it('guards every tenant table with the tenant policies, a leading index and composite keys', async () => {
    const violations = await withGlobal(tx => tx.execute<{ name: string; problem: string }>(sql`
      with tenant_tables as (
        select c.oid, c.relname
        from app_private.table_class tc
        join pg_class c on c.relname = tc.table_name and c.relnamespace = 'public'::regnamespace
        where tc.class = 'tenant'
      )
      select t.relname as name, 'id_tenant' as problem from tenant_tables t
      where not exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname = 'id_tenant'
                        and a.attnotnull and a.atttypid = 'int8'::regtype)
      union all
      select t.relname, 'tenant foreign key' from tenant_tables t
      where not exists (
        select 1 from pg_constraint k
        where k.conrelid = t.oid and k.contype = 'f' and k.confrelid = 'public.tenant'::regclass
          and k.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = t.oid and a.attname = 'id_tenant')])
      union all
      select t.relname, 'tenant default' from tenant_tables t
      where not exists (
        select 1 from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
        where d.adrelid = t.oid and a.attname = 'id_tenant'
          and pg_get_expr(d.adbin, d.adrelid) like '%current_tenant_id%')
      union all
      select t.relname, 'tenant_boundary' from tenant_tables t
      where not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = t.relname and p.policyname = 'tenant_boundary'
          and p.permissive = 'RESTRICTIVE' and p.cmd = 'ALL'
          and p.roles @> array['construct_runtime', 'construct_owner']::name[]
          and p.qual like '%current_tenant_id%' and p.with_check like '%current_tenant_id%')
      union all
      select t.relname, 'tenant_access' from tenant_tables t
      where not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = t.relname and p.policyname = 'tenant_access'
          and p.permissive = 'PERMISSIVE' and p.cmd = 'ALL')
      union all
      select t.relname, 'leading index' from tenant_tables t
      where not exists (
        select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
        where i.indrelid = t.oid and a.attname = 'id_tenant')
      union all
      select t.relname, 'foreign key ' || k.conname from tenant_tables t
      join pg_constraint k on k.conrelid = t.oid and k.contype = 'f'
      join tenant_tables target on target.oid = k.confrelid
      where not exists (
        select 1 from unnest(k.conkey) key_column(attnum)
        join pg_attribute a on a.attrelid = t.oid and a.attnum = key_column.attnum
        where a.attname = 'id_tenant')
      order by 1, 2
    `))
    expect(violations).toEqual([])
  })

  it('gives global tables the policies and grants of their class', async () => {
    const violations = await withGlobal(tx => tx.execute<{ name: string; problem: string }>(sql`
      select tc.table_name as name, 'policy' as problem
      from app_private.table_class tc
      where tc.class <> 'tenant' and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = tc.table_name
          and p.policyname = case tc.class
            when 'global_write' then 'global_access'
            when 'global_insert_only' then 'global_insert'
            else 'global_read' end)
      union all
      select tc.table_name, 'write grant on a read-only table'
      from app_private.table_class tc
      where tc.class = 'global_read'
        and has_table_privilege('construct_runtime', format('public.%I', tc.table_name), 'insert,update,delete')
      union all
      select tc.table_name, 'insert-only table the runtime cannot insert into'
      from app_private.table_class tc
      where tc.class = 'global_insert_only'
        and not has_table_privilege('construct_runtime', format('public.%I', tc.table_name), 'insert')
      union all
      select tc.table_name, 'insert-only table the runtime can read, update, delete or truncate'
      from app_private.table_class tc
      where tc.class = 'global_insert_only'
        and has_table_privilege('construct_runtime', format('public.%I', tc.table_name), 'select,update,delete,truncate,references,trigger')
      union all
      select tc.table_name, 'insert-only table with a policy beyond global_owner and global_insert'
      from app_private.table_class tc
      join pg_policies p on p.schemaname = 'public' and p.tablename = tc.table_name
      where tc.class = 'global_insert_only' and p.policyname not in ('global_owner', 'global_insert')
      union all
      select tc.table_name, 'insert-only table whose global_insert is not an insert policy of construct_runtime alone'
      from app_private.table_class tc
      where tc.class = 'global_insert_only' and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = tc.table_name and p.policyname = 'global_insert'
          and p.cmd = 'INSERT' and p.roles = array['construct_runtime']::name[])
      union all
      select tc.table_name, 'insert-only table whose identity sequence gives the runtime more than usage'
      from app_private.table_class tc
      where tc.class = 'global_insert_only'
        and pg_get_serial_sequence(format('public.%I', tc.table_name), 'id') is not null
        and (not has_sequence_privilege('construct_runtime', pg_get_serial_sequence(format('public.%I', tc.table_name), 'id'), 'usage')
          or has_sequence_privilege('construct_runtime', pg_get_serial_sequence(format('public.%I', tc.table_name), 'id'), 'select,update'))
      order by 1, 2
    `))
    expect(violations).toEqual([])
  })

  /**
   * Un registro di tenant è una tabella di tenant come le altre (stesse policy, controllate sopra)
   * con un privilegio in meno: il ruolo dell'app inserisce e legge, mai modifica né cancella
   * (specifica 2026-10-26, MT5-DEC-15). L'elenco è esplicito e controllato qui e in
   * `db.mjs boundary-check`: una tabella di tenant nuova che dovesse essere solo accodabile va
   * aggiunta in entrambi.
   */
  it('keeps the tenant audit tables append-only for the runtime role', async () => {
    const violations = await withGlobal(tx => tx.execute<{ name: string; problem: string }>(sql`
      select t.name, 'not a classified tenant table' as problem
      from unnest(array['tenant_audit_event']) as t(name)
      where not exists (select 1 from app_private.table_class tc where tc.table_name = t.name and tc.class = 'tenant')
      union all
      select t.name, 'the runtime cannot select and insert'
      from unnest(array['tenant_audit_event']) as t(name)
      where not has_table_privilege('construct_runtime', format('public.%I', t.name), 'select')
         or not has_table_privilege('construct_runtime', format('public.%I', t.name), 'insert')
      union all
      select t.name, 'the runtime can update, delete or truncate'
      from unnest(array['tenant_audit_event']) as t(name)
      where has_table_privilege('construct_runtime', format('public.%I', t.name), 'update,delete,truncate')
      union all
      select t.name, 'the identity sequence gives the runtime other than usage'
      from unnest(array['tenant_audit_event']) as t(name)
      where pg_get_serial_sequence(format('public.%I', t.name), 'id') is null
         or not has_sequence_privilege('construct_runtime', pg_get_serial_sequence(format('public.%I', t.name), 'id'), 'usage')
         or has_sequence_privilege('construct_runtime', pg_get_serial_sequence(format('public.%I', t.name), 'id'), 'select,update')
      order by 1, 2
    `))
    expect(violations).toEqual([])
  })

  it('keeps migration history inaccessible to the runtime role', async () => {
    const privileges = await withGlobal(tx => tx.execute<{ allowed: boolean }>(sql`
      select has_table_privilege('construct_runtime', 'public.construct_schema_migration', 'select') as allowed
    `))
    expect(privileges[0].allowed).toBe(false)
  })

  /**
   * Every assertion above this one names `construct_runtime` literally, which
   * makes them all independent of who is connected: they establish that the role
   * is hemmed in, never that the application reaches the database through it. For
   * months nothing checked the second half, and the gap was not hypothetical — the
   * test database connected as the migration owner (a Supabase `postgres` holding
   * `pg_read_all_data`, `service_role` and `construct_runtime` at once), so the
   * whole section passed while the boundary it describes was bypassed on the only
   * database it ran against.
   *
   * This spec closes it by probing `current_user` instead of a name. It is the
   * one assertion here that fails when DATABASE_URL is repointed at a privileged
   * login, so it is what stops the split in db.mjs from being quietly undone.
   */
  it('connects through the runtime role and nothing wider', async () => {
    const [identity] = await withGlobal(tx => tx.execute<{
      rolsuper: boolean
      rolcreatedb: boolean
      rolcreaterole: boolean
      rolreplication: boolean
      rolbypassrls: boolean
    }>(sql`
      select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      from pg_roles where rolname = current_user
    `))
    expect(identity).toEqual({
      rolsuper: false,
      rolcreatedb: false,
      rolcreaterole: false,
      rolreplication: false,
      rolbypassrls: false,
    })

    // `distinct` because a role granted by two grantors yields two rows in
    // pg_auth_members, and the platform roles are exactly the kind of membership
    // this assertion exists to reject — a duplicate must not read as a second one.
    const memberships = await withGlobal(tx => tx.execute<{ granted: string }>(sql`
      select distinct granted.rolname as granted
      from pg_auth_members membership
      join pg_roles member on member.oid = membership.member
      join pg_roles granted on granted.oid = membership.roleid
      where member.rolname = current_user
      order by granted.rolname
    `))
    expect(memberships.map(row => row.granted)).toEqual(['construct_runtime'])

    // Membership alone is not enough: a login can hold privileges granted
    // directly, which inherit from nothing and so survive every check above.
    const directGrants = await withGlobal(tx => tx.execute<{ source: string }>(sql`
      select 'table' as source from information_schema.role_table_grants where grantee = current_user
      union all select 'routine' from information_schema.role_routine_grants where grantee = current_user
      union all select 'usage' from information_schema.role_usage_grants where grantee = current_user
    `))
    expect(directGrants.map(row => row.source)).toEqual([])

    // The same probe the boundary is described by, asked of the live connection
    // rather than of the role name — this is the one that was reported false while
    // the connection in front of it answered true.
    const history = await withGlobal(tx => tx.execute<{ allowed: boolean }>(sql`
      select has_table_privilege(current_user, 'public.construct_schema_migration', 'select') as allowed
    `))
    expect(history[0].allowed).toBe(false)
  })
})
