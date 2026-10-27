import { describe, expect, it } from 'vitest'
import { buildPlatformMenu, platformEntryItem } from './platform-menu'

const t = (key: string) => `«${key}»`

/**
 * La barra laterale della console e la voce "Piattaforma" nei tenant (specifica 2026-10-26,
 * MT5-DEC-3). La voce non viene dal menu del tenant, che è un dato di tenant.
 */
describe('buildPlatformMenu', () => {
  it('has a Platform section with Tenants and Administrators, and nothing else for now', () => {
    const items = buildPlatformMenu(t, { backToTenant: false })
    const section = items.find(item => item.parentId === null && item.type === 'container')
    expect(section).toMatchObject({ label: '«platform.nav.section»', position: 'main', visible: true, active: true })
    const children = items.filter(item => item.parentId === section!.id).sort((a, b) => a.order - b.order)
    expect(children.map(item => [item.label, item.route])).toEqual([
      ['«platform.nav.tenants»', '/platform'],
      ['«platform.nav.admins»', '/platform/admins'],
    ])
  })

  it('adds the way back only for a person who belongs to a tenant on this address', () => {
    expect(buildPlatformMenu(t, { backToTenant: false }).some(item => item.route === '/')).toBe(false)
    const back = buildPlatformMenu(t, { backToTenant: true }).find(item => item.route === '/')
    expect(back).toMatchObject({ label: '«platform.nav.back_to_tenant»', type: 'link', parentId: null, visible: true, active: true })
  })

  it('gives every item a unique id and a parent that exists', () => {
    const items = buildPlatformMenu(t, { backToTenant: true })
    expect(new Set(items.map(item => item.id)).size).toBe(items.length)
    for (const item of items) {
      if (item.parentId !== null) expect(items.some(other => other.id === item.parentId)).toBe(true)
    }
  })
})

describe('platformEntryItem', () => {
  it('is a single link to the console at the top level of the menu', () => {
    expect(platformEntryItem(t)).toMatchObject({
      label: '«platform.nav.section»', route: '/platform', type: 'link', parentId: null, visible: true, active: true, position: 'main',
    })
  })

  it('cannot clash with a tenant menu entry, whose ids are numbers', () => {
    expect(/^\d+$/.test(platformEntryItem(t).id)).toBe(false)
  })
})
