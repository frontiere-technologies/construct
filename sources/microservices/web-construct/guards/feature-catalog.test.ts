import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PERMISSION_CODES } from '@/lib/rbac/permission-catalog'
import { inspectExports, scannedFiles } from './entry-point-inventory'

// Questi soli codici sono dichiarati ma privi di porte attive (specifica 5b, §3).
const UNUSED_PERMISSIONS = ['manage-permissions', 'manage-languages', 'edit-translations', 'manage-translation-keys'] as const

// Le altre dichiarazioni indicano controlli diversi dai permessi del catalogo.
const ACCESS_DECLARATIONS = new Set([
  'allowSelfService', 'allowAnonymous', 'allowAnyAuthenticated',
  'requireAdministrator', 'requireAdministratorPage',
  'requirePlatformAdmin', 'requirePlatformAdminPage', 'requireSupportExit',
])

async function loadCatalog() {
  return import('@/lib/tenancy/feature-catalog')
}

function declaredPermissions(): Set<string> {
  return new Set(scannedFiles().flatMap(file =>
    Object.values(inspectExports(readFileSync(file, 'utf8'), file).declared).filter(marker => !ACCESS_DECLARATIONS.has(marker))))
}

describe('platform feature catalog', () => {
  it('covers every permission actually declared by an entry point exactly once', async () => {
    const { FEATURE_CATALOG } = await loadCatalog()
    const mappedPermissions = FEATURE_CATALOG.flatMap(feature => feature.permission === null ? [] : [feature.permission])
    expect(mappedPermissions.sort()).toEqual([...declaredPermissions()].sort())
    expect(new Set(mappedPermissions).size).toBe(mappedPermissions.length)
  })

  it('excludes only the named unused permissions from the permission inventory', () => {
    const declared = declaredPermissions()
    expect(PERMISSION_CODES.filter(code => !declared.has(code)).sort()).toEqual([...UNUSED_PERMISSIONS].sort())
  })

  it('lists every capability once and uses only known areas and dependencies', async () => {
    const { AREA_KEYS, FEATURE_KEYS, FEATURE_CATALOG } = await loadCatalog()
    expect(new Set(AREA_KEYS).size).toBe(6)
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length)
    expect(FEATURE_CATALOG.map(feature => feature.key).sort()).toEqual([...FEATURE_KEYS].sort())
    for (const feature of FEATURE_CATALOG) {
      if (feature.area !== null) expect(AREA_KEYS).toContain(feature.area)
      for (const dependency of feature.dependencies) expect(FEATURE_KEYS).toContain(dependency)
    }
    expect(FEATURE_CATALOG.filter(feature => feature.area === null).map(feature => feature.key).sort())
      .toEqual(['core-app', 'export-tenant-data', 'manage-support-consent', 'read-tenant-audit'])
  })

  it('does not permit cycles in capability dependencies', async () => {
    const { FEATURE_CATALOG } = await loadCatalog()
    const dependencies = new Map<string, readonly string[]>(FEATURE_CATALOG.map(feature => [feature.key, feature.dependencies]))
    const visit = (key: string, ancestors: ReadonlySet<string>): void => {
      expect(ancestors.has(key), `Dependency cycle: ${[...ancestors, key].join(' -> ')}`).toBe(false)
      for (const dependency of dependencies.get(key) ?? []) visit(dependency, new Set([...ancestors, key]))
    }
    for (const feature of FEATURE_CATALOG) visit(feature.key, new Set())
  })

  it('protects the shared catalog and key lists from runtime changes', async () => {
    const { AREA_KEYS, FEATURE_KEYS, FEATURE_CATALOG } = await loadCatalog()
    expect(Object.isFrozen(AREA_KEYS)).toBe(true)
    expect(Object.isFrozen(FEATURE_KEYS)).toBe(true)
    expect(Object.isFrozen(FEATURE_CATALOG)).toBe(true)
    for (const feature of FEATURE_CATALOG) {
      expect(Object.isFrozen(feature)).toBe(true)
      expect(Object.isFrozen(feature.dependencies)).toBe(true)
    }
  })
})
