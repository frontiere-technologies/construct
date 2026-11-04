import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, it } from 'vitest'
import { MENU_ROUTE_BINDINGS } from '@/lib/rbac/menu-feature-binding'

function pageRoutes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return pageRoutes(path)
    if (entry.name !== 'page.tsx') return []
    const segments = relative(join(process.cwd(), 'app'), directory).split('/').filter(part => !part.startsWith('('))
    return ['/' + segments.filter(Boolean).join('/')]
  })
}

it('requires an explicit menu capability for each real tenant page, including future pages', () => {
  const routes = pageRoutes(join(process.cwd(), 'app')).filter(route => route !== '/platform' && !route.startsWith('/platform/') && route !== '/[...slug]')
  expect(MENU_ROUTE_BINDINGS.map(binding => binding.route).sort()).toEqual(routes.sort())
})
