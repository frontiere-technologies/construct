import { expect, it } from 'vitest'
import { is, SQL, sql } from 'drizzle-orm'
import { getTableConfig, getViewConfig, PgDialect, PgTable, PgView } from 'drizzle-orm/pg-core'
import type { IndexedColumn } from 'drizzle-orm/pg-core'
import { db } from '@/lib/db'
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
    const deployedTables = await db.execute<{ tableName: string }>(sql`
      select c.relname as "tableName"
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and c.relname <> 'construct_schema_migration'
      order by c.relname
    `)
    assertExactCatalogSection('tables', expectedTables, deployedTables.map(row => row.tableName))

    const deployedColumns = await db.execute<{
      tableName: string
      columnName: string
      sqlType: string
      notNull: boolean
      hasDefault: boolean
    }>(sql`
      select c.relname as "tableName", a.attname as "columnName",
        format_type(a.atttypid, a.atttypmod) as "sqlType", a.attnotnull as "notNull",
        (defaults.adbin is not null) as "hasDefault"
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      left join pg_attrdef defaults on defaults.adrelid = c.oid and defaults.adnum = a.attnum
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and c.relname <> 'construct_schema_migration'
      order by c.relname, a.attnum
    `)
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
    const deployedIndexes = await db.execute<{ indexName: string; unique: boolean; columns: string[]; predicate: string | null }>(sql`
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
    `)
    assertExactCatalogSection('indexes', expectedIndexes, deployedIndexes.map(index => ({
      ...index,
      predicate: normalizeExpression(index.predicate),
    })))

    const expectedForeignKeys = tableConfigs.flatMap(config => config.foreignKeys.map(foreignKey => {
      const reference = foreignKey.reference()
      return `${config.name}:${reference.columns.map(column => column.name).join(',')}->${getTableConfig(reference.foreignTable).name}:${reference.foreignColumns.map(column => column.name).join(',')}:${foreignKey.onDelete ?? 'no action'}:${foreignKey.onUpdate ?? 'no action'}`
    })).sort()
    const deployedForeignKeys = await db.execute<{
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
    `)
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
    const deployedViewColumns = await db.execute<{ viewName: string; name: string; type: string }>(sql`
      select view_class.relname as "viewName", attribute.attname as name,
        format_type(attribute.atttypid, attribute.atttypmod) as type
      from pg_class view_class
      join pg_namespace n on n.oid = view_class.relnamespace
      join pg_attribute attribute on attribute.attrelid = view_class.oid and attribute.attnum > 0 and not attribute.attisdropped
      where n.nspname = 'public' and view_class.relkind = 'v'
      order by view_class.relname, attribute.attnum
    `)
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
    const roles = await db.execute<{
      rolcanlogin: boolean
      rolsuper: boolean
      rolcreatedb: boolean
      rolcreaterole: boolean
      rolreplication: boolean
      rolbypassrls: boolean
    }>(sql`
      select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      from pg_roles where rolname = 'construct_runtime'
    `)
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
    const grants = await db.execute(sql`
      select grantee, table_name, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('PUBLIC', 'anon', 'authenticated')
        and table_name <> 'construct_schema_migration'
    `)
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
    const defaultGrantOwners = await db.execute(sql`
      select distinct defaclrole::regrole::text as owner
      from pg_default_acl defaults
      cross join lateral aclexplode(coalesce(defaults.defaclacl, acldefault(defaults.defaclobjtype, defaults.defaclrole))) acl
      join pg_roles grantee on grantee.oid = acl.grantee
      where grantee.rolname in ('anon', 'authenticated')
        and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'EXECUTE', 'USAGE')
        and defaults.defaclnamespace = 'public'::regnamespace
    `)
    const ownersWeControl = (defaultGrantOwners as unknown as { owner: string }[])
      .map(row => row.owner)
      .filter(owner => !PLATFORM_OWNED_ROLES.includes(owner))
    expect(ownersWeControl).toEqual([])
  })

  it('uses an invoker-rights view and declares reverse lookup indexes', async () => {
    const views = await db.execute<{ reloptions: string[] | null }>(sql`
      select c.reloptions
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'role_list_view'
    `)
    expect(views[0]?.reloptions).toContain('security_invoker=true')

    const indexes = await db.execute<{ indexname: string }>(sql`
      select indexname from pg_indexes
      where schemaname = 'public'
        and indexname in ('user_role_id_role_user_id_idx', 'navigation_item_parent_order_idx')
      order by indexname
    `)
    expect(indexes.map(row => row.indexname)).toEqual([
      'navigation_item_parent_order_idx',
      'user_role_id_role_user_id_idx',
    ])
  })

  it('keeps migration history inaccessible to the runtime role', async () => {
    const privileges = await db.execute<{ allowed: boolean }>(sql`
      select has_table_privilege('construct_runtime', 'public.construct_schema_migration', 'select') as allowed
    `)
    expect(privileges[0].allowed).toBe(false)
  })
})
