import { afterAll, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import { withTenant } from '@/lib/db/tenant-db'
import { closeOwner, withOwner, deleteTenantForTest } from '@/lib/db/testing'
import { describeIntegration } from '@/lib/i18n/test-support/db-fixtures'
import { menuEntry, roleFunctionality } from '@/lib/db/schema'
import { tenantIdForTest } from '@/lib/tenancy/testing'
import { createPolicyFixture } from '@/lib/tenancy/policy-test-fixture'
import { bindMenuTarget } from './menu-feature-binding'
import { getSidebarMenu } from './navigation-service'
import type { CreateNavItemInput } from './types'

const actorState = vi.hoisted(() => ({ tenantId: 1 }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/rbac/auth-guard', async () => {
  const { tenantIdForTest } = await import('@/lib/tenancy/testing')
  return { requirePermission: async () => ({ userId: '00000000-0000-4000-8000-0000000000a1', tenantId: tenantIdForTest(actorState.tenantId), roleIds: [0, 1], isAdmin: true, permissions: new Set<string>() }) }
})
const { createNavigationItem, updateNavigationItem, moveNavigationItem } = await import('./navigation-actions')

const origin = 'https://construct.example.test'
const customInput = (areaKey: CreateNavItemInput['areaKey'] = 'navigation'): CreateNavItemInput => ({
  name: 'Custom binding', idItemType: 2, idFunctionalityType: 2, functionalityLink: 'https://outside.test/user-management',
  areaKey, iconPath: null, idItemParent: null, description: '', itemTranslation: {}, tagTranslations: {},
})

afterAll(closeOwner)

describeIntegration('menu feature binding in the database', () => {
  it('classifies a copied internal item by its canonical path with a fresh numeric id', async () => {
    const fixture = await createPolicyFixture('menu-binding')
    try {
      const [entry] = await withTenant(fixture.tenantId, tx => tx.execute<{ area_key: string; feature_key: string }>(sql`
        select area_key, feature_key from public.menu_entry where id_menu_entry = ${fixture.menuEntryId}`))
      expect(entry).toMatchObject({ area_key: 'people', feature_key: 'read-users' })
    } finally { await fixture.close() }
  })
})

// Tutte le operazioni rimangono nella prova Docker e ripuliscono il tenant dedicato.
describeIntegration('menu binding invariants', () => {
  it('rejects a forged capability for an internal absolute alias', async () => {
    const f = await createPolicyFixture('forged')
    try {
      await expect(withTenant(f.tenantId, async tx => {
        await tx.execute(sql`select set_config('app.menu_origin', 'https://construct.example.test', true)`)
        await tx.execute(sql`insert into public.menu_entry (name, id_functionality_type, functionality_link, area_key, feature_key)
          values ('forged', 2, 'https://construct.example.test/user-management/?a=1#x', 'navigation', 'use-custom-content')`)
      })).rejects.toThrow()
    } finally { await f.close() }
  })

  it('fails closed on an absolute URL without trusted transaction origin', async () => {
    const f = await createPolicyFixture('no-origin')
    try {
      await expect(withTenant(f.tenantId, tx => tx.execute(sql`insert into public.menu_entry
        (name, id_functionality_type, functionality_link) values ('absolute', 2, 'https://example.net')`))).rejects.toThrow()
    } finally { await f.close() }
  })
})

describeIntegration('binding parity and preservation', () => {
  it('matches the URL classifier in SQL across internal aliases and real external targets', async () => {
    const f = await createPolicyFixture('url-parity')
    try {
      await withTenant(f.tenantId, async tx => {
        await tx.execute(sql`select set_config('app.menu_origin', ${origin}, true)`)
        for (const link of ['/user-management', 'user-management', '/user-management/?sort=x#grid',
          'https://CONSTRUCT.EXAMPLE.TEST:443/user-management/', 'https://construct.example.test:00443/user-management', '//construct.example.test/user-management',
          '/other/../user-management', '/%75ser-management', '/other/%2e%2e/user-management',
          '/functionalities/create', '/functionalities/7/edit', '/roles-permissions/2', '/admin/tenant-settings',
          '/embedded/77', '/generic-home', 'https://outside.test/user-management']) {
          const [binding] = await tx.execute<{ area_key: string | null; feature_key: string | null }>(sql`
            select * from app_private.bind_menu_target(${link}, 2, null)`)
          expect(binding, link).toEqual({
            area_key: bindMenuTarget({ link, functionalityType: 2, areaKey: null }, origin).areaKey,
            feature_key: bindMenuTarget({ link, functionalityType: 2, areaKey: null }, origin).featureKey,
          })
        }
      })
    } finally { await f.close() }
  })

  it('retains type 4/5 link behavior and classifies by the real target', async () => {
    const f = await createPolicyFixture('legacy')
    try {
      await withTenant(f.tenantId, async tx => {
        await tx.execute(sql`select set_config('app.menu_origin', ${origin}, true)`)
        for (const type of [4, 5]) {
          const [internal] = await tx.execute<{ feature_key: string }>(sql`insert into public.menu_entry
            (name, id_functionality_type, functionality_link) values ('legacy internal', ${type}, '/user-management') returning feature_key`)
          const [external] = await tx.execute<{ feature_key: string }>(sql`insert into public.menu_entry
            (name, id_functionality_type, functionality_link) values ('legacy external', ${type}, 'https://outside.test') returning feature_key`)
          expect(internal.feature_key).toBe('read-users')
          expect(external.feature_key).toBe('use-custom-content')
        }
      })
    } finally { await f.close() }
  })

  it('copies absolute internal/external URLs and a suspended presentation area without rebinding ids', async () => {
    const f = await createPolicyFixture('copy-bind')
    let copy: ReturnType<typeof tenantIdForTest> | undefined
    try {
      const sourceIds = await withOwner(async tx => {
        await tx.execute(sql`select set_config('app.menu_origin', ${origin}, true)`)
        const entries = await tx.insert(menuEntry).values([
          { name: 'Absolute internal', idFunctionalityType: 2, functionalityLink: `${origin}/user-management/?a=1#t` },
          { name: 'Absolute external', idFunctionalityType: 1, functionalityLink: 'https://outside.test/user-management', areaKey: 'people' },
        ]).returning({ id: menuEntry.idMenuEntry })
        await tx.execute(sql`update public.tenant_area_entitlement set enabled = false where area_code = 'people'`)
        return entries.map(entry => entry.id)
      }, f.tenantId)
      const [created] = await withOwner(async tx => {
        await tx.execute(sql`select set_config('app.menu_origin', ${origin}, true)`)
        return tx.execute<{ id: number }>(sql`select app_private.copy_tenant(${f.tenantId}, ${f.slug + '-copy'}, 'Binding copy', false)::int as id`)
      })
      copy = tenantIdForTest(created.id)
      const entries = await withTenant(copy, tx => tx.select().from(menuEntry))
      const internal = entries.find(entry => entry.name === 'Absolute internal')!
      const external = entries.find(entry => entry.name === 'Absolute external')!
      expect([internal.idMenuEntry, external.idMenuEntry].every(id => !sourceIds.includes(id))).toBe(true)
      expect(internal).toMatchObject({ areaKey: 'people', featureKey: 'read-users', functionalityLink: `${origin}/user-management/?a=1#t` })
      expect(external).toMatchObject({ areaKey: 'people', featureKey: 'use-custom-content', functionalityLink: 'https://outside.test/user-management' })
    } finally { if (copy) await deleteTenantForTest(copy); await f.close() }
  })

  it('filters all granted aliases without deleting grants and restores them when the feature returns', async () => {
    const f = await createPolicyFixture('sidebar')
    try {
      const [alias] = await withOwner(async tx => {
        await tx.execute(sql`select set_config('app.menu_origin', ${origin}, true)`)
        const [entry] = await tx.insert(menuEntry).values({ name: 'Alias', idFunctionalityType: 2, functionalityLink: `${origin}/user-management` }).returning()
        await tx.insert(roleFunctionality).values([f.menuEntryId, entry.idMenuEntry].map(id => ({ idRole: f.roleId, idMenuEntry: id })))
        return [entry]
      }, f.tenantId)
      expect((await getSidebarMenu(f.tenantId, [f.roleId])).map(item => item.id)).toEqual(expect.arrayContaining([String(alias.idMenuEntry), String(f.menuEntryId)]))
      await withOwner(tx => tx.execute(sql`insert into public.tenant_entitlement (feature_code, allowed) values ('read-users', false)`), f.tenantId)
      expect(await getSidebarMenu(f.tenantId, [f.roleId])).toEqual([])
      expect(await withTenant(f.tenantId, tx => tx.select().from(roleFunctionality).where(eq(roleFunctionality.idRole, f.roleId)))).toHaveLength(2)
      await withOwner(tx => tx.execute(sql`update public.tenant_entitlement set allowed = true where feature_code = 'read-users';`), f.tenantId)
      expect((await getSidebarMenu(f.tenantId, [f.roleId])).map(item => item.id)).toHaveLength(2)
    } finally { await f.close() }
  })

  it('rejects new presentation areas while preserving moves and labels of suspended entries', async () => {
    const f = await createPolicyFixture('actions')
    actorState.tenantId = f.tenantId
    vi.stubEnv('AUTH_URL', origin)
    try {
      const { id } = await createNavigationItem(customInput('people'))
      await withOwner(tx => tx.execute(sql`update public.tenant_area_entitlement set enabled = false where area_code = 'people'`), f.tenantId)
      await expect(createNavigationItem(customInput('people'))).rejects.toThrow(/unavailable/)
      await updateNavigationItem(id, { ...customInput(), areaKey: undefined, name: 'Renamed while suspended' })
      await moveNavigationItem(id, { targetParentId: null, orderPosition: 0 })
      const [entry] = await withTenant(f.tenantId, tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)))
      expect(entry).toMatchObject({ areaKey: 'people', featureKey: 'use-custom-content', name: 'Renamed while suspended' })
      const { id: allowed } = await createNavigationItem(customInput())
      await expect(updateNavigationItem(allowed, customInput('people'))).rejects.toThrow(/unavailable/)
      const [unchanged] = await withTenant(f.tenantId, tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, allowed)))
      expect(unchanged.areaKey).toBe('navigation')
    } finally { vi.unstubAllEnvs(); actorState.tenantId = 1; await f.close() }
  })
})

describeIntegration('trusted origin and transaction boundary', () => {
  it.each([
    ['http://127.0.0.1', 'http://127.1/user-management'],
    ['http://127.0.0.1', 'http://0x7f000001/user-management'],
    ['http://127.0.0.1', 'http://0177.0.0.1/user-management'],
    ['http://[::1]', 'http://[0:0:0:0:0:0:0:1]/user-management'],
    [origin, '/../../user-management'],
    [origin, 'https://construct.example.test:/user-management'],
  ])('keeps URL and SQL aligned for %s, %s', async (appOrigin, link) => {
    const f = await createPolicyFixture('origin')
    try {
      const [binding] = await withTenant(f.tenantId, async tx => {
        await tx.execute(sql`select set_config('app.menu_origin', ${appOrigin}, true)`)
        return tx.execute<{ area_key: string; feature_key: string }>(sql`select * from app_private.bind_menu_target(${link}, 2, null)`)
      })
      expect(bindMenuTarget({ link, functionalityType: 2, areaKey: null }, appOrigin)).toEqual({ areaKey: 'people', featureKey: 'read-users' })
      expect(binding).toEqual({ area_key: 'people', feature_key: 'read-users' })
    } finally { await f.close() }
  })

  it('rolls back a whole copy of a model with absolute URLs when the origin is missing', async () => {
    const f = await createPolicyFixture('copy-fail')
    const slug = f.slug.slice(0, 25) + '-copy-no-origin'
    try {
      await withOwner(async tx => {
        await tx.execute(sql`select set_config('app.menu_origin', ${origin}, true)`)
        await tx.insert(menuEntry).values({ name: 'Absolute source', idFunctionalityType: 2, functionalityLink: `${origin}/user-management` })
      }, f.tenantId)
      let failure: unknown
      try {
        await withOwner(tx => tx.execute(sql`select app_private.copy_tenant(${f.tenantId}, ${slug}, 'Rejected copy', false)`))
      } catch (err) { failure = err }
      const message = (err: unknown): string => err && typeof err === 'object'
        ? ('message' in err ? String(err.message) : '') + ('cause' in err ? message(err.cause) : '') : ''
      expect(message(failure)).toContain('menu_origin_required')
      const rows = await withOwner(tx => tx.execute(sql`select id from public.tenant where slug = ${slug}`))
      expect(rows).toHaveLength(0)
    } finally { await f.close() }
  })

  it('rechecks a presentation area after waiting for the common tenant lock', async () => {
    const f = await createPolicyFixture('locking')
    actorState.tenantId = f.tenantId
    vi.stubEnv('AUTH_URL', origin)
    let pending: Promise<unknown> | undefined
    try {
      await withOwner(async tx => {
        await tx.execute(sql`select app_private.lock_tenant_policy()`)
        let settled = false
        pending = createNavigationItem(customInput('people')).then(() => { settled = true; return null }, error => { settled = true; return error })
        await new Promise(resolve => setTimeout(resolve, 60))
        expect(settled).toBe(false)
        await tx.execute(sql`update public.tenant_area_entitlement set enabled = false where area_code = 'people'`)
      }, f.tenantId)
      expect(await pending).toBeInstanceOf(Error)
      expect((await withTenant(f.tenantId, tx => tx.select().from(menuEntry))).some(row => row.name === 'Custom binding')).toBe(false)
    } finally { if (pending) await pending; vi.unstubAllEnvs(); actorState.tenantId = 1; await f.close() }
  })

  it('removes embedded content from the admission menu when custom content is suspended', async () => {
    const f = await createPolicyFixture('embedded')
    try {
      const [entry] = await withOwner(async tx => {
        await tx.execute(sql`select set_config('app.menu_origin', ${origin}, true)`)
        const [created] = await tx.insert(menuEntry).values({ name: 'Embedded', idFunctionalityType: 1, functionalityLink: 'https://outside.test/page' }).returning()
        await tx.insert(roleFunctionality).values({ idRole: f.roleId, idMenuEntry: created.idMenuEntry })
        return [created]
      }, f.tenantId)
      expect((await getSidebarMenu(f.tenantId, [f.roleId])).map(item => item.route)).toContain(`/embedded/${entry.idMenuEntry}`)
      await withOwner(tx => tx.execute(sql`insert into public.tenant_entitlement (feature_code, allowed) values ('use-custom-content', false)`), f.tenantId)
      expect(await getSidebarMenu(f.tenantId, [f.roleId])).toEqual([])
    } finally { await f.close() }
  })
})

describeIntegration('menu target edits', () => {
  it('rebinds a URL change from custom content to an internal page without retaining the old area', async () => {
    const f = await createPolicyFixture('url-edit')
    actorState.tenantId = f.tenantId
    vi.stubEnv('AUTH_URL', origin)
    try {
      const { id } = await createNavigationItem(customInput())
      await updateNavigationItem(id, { ...customInput(), areaKey: undefined, functionalityLink: `${origin}/user-management/?sort=name#grid` })
      const [entry] = await withTenant(f.tenantId, tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, id)))
      expect(entry).toMatchObject({ areaKey: 'people', featureKey: 'read-users' })
    } finally { vi.unstubAllEnvs(); actorState.tenantId = 1; await f.close() }
  })

  it('keeps immutable menu targets protected before rebinding or moving', async () => {
    const f = await createPolicyFixture('immutable')
    actorState.tenantId = f.tenantId
    try {
      await withOwner(tx => tx.update(menuEntry).set({ isImmutable: 1 }).where(eq(menuEntry.idMenuEntry, f.menuEntryId)), f.tenantId)
      await expect(updateNavigationItem(f.menuEntryId, customInput())).rejects.toThrow(/immutable/)
      await expect(moveNavigationItem(f.menuEntryId, { targetParentId: null, orderPosition: 0 })).rejects.toThrow(/immutable/)
      const [entry] = await withTenant(f.tenantId, tx => tx.select().from(menuEntry).where(eq(menuEntry.idMenuEntry, f.menuEntryId)))
      expect(entry).toMatchObject({ areaKey: 'people', featureKey: 'read-users', functionalityLink: '/user-management' })
    } finally { actorState.tenantId = 1; await f.close() }
  })
})
