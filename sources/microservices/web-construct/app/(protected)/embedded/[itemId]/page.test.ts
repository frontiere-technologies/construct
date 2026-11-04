import { beforeEach, expect, it, vi } from 'vitest'
import type { MenuEntryRow } from '@/lib/rbac/types'
import EmbeddedItemPage from './page'

const state = vi.hoisted(() => ({ item: null as MenuEntryRow | null, canEmbed: true }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('not_found') }, redirect: () => { throw new Error('redirect') } }))
vi.mock('@/lib/tenancy/request-tenant', async () => {
  const { tenantIdForTest } = await import('@/lib/tenancy/testing')
  return { resolveRequestTenant: async () => tenantIdForTest(1) }
})
vi.mock('@/lib/auth-session', () => ({ getSession: async () => ({
  expires: '2099-01-01T00:00:00Z',
  user: { id: '00000000-0000-4000-8000-000000000001', email: 'embedded@example.test', roleIds: [2], accountActive: true },
}) }))
vi.mock('@/lib/rbac/navigation-service', () => ({
  getNavigationItemById: async () => state.item,
  getSidebarMenu: async () => [{ id: '17', label: 'Frame', type: 'link', route: '/embedded/17', parentId: null, order: 0, visible: true, active: true, position: 'main' }],
}))
vi.mock('@/lib/rbac/embedded-check', () => ({ checkEmbeddable: async () => state.canEmbed }))

beforeEach(() => {
  state.canEmbed = true
  state.item = {
    id_menu_entry: 17, id_parent: null, name: 'Frame', order_position: 0, navbar_position: null,
    icon_path: null, id_functionality_type: 1, functionality_link: 'https://authoring-only.test/raw',
    canonical_link: 'https://actual-target.test/frame', area_key: 'navigation', feature_key: 'use-custom-content',
    open_in_new_tab: 1, item_translation: null, is_immutable: 0,
  }
})

it('renders the iframe destination from the canonical target rather than the authoring value', async () => {
  const result = await EmbeddedItemPage({ params: Promise.resolve({ itemId: '17' }) })
  expect(result.props.url).toBe('https://actual-target.test/frame')
})

it('shows the same canonical destination when embedding is blocked', async () => {
  state.canEmbed = false
  const result = await EmbeddedItemPage({ params: Promise.resolve({ itemId: '17' }) })
  expect(result.props.url).toBe('https://actual-target.test/frame')
})

it('does not fall back to the raw URL when a canonical target is absent', async () => {
  state.item = { ...state.item!, canonical_link: null }
  await expect(EmbeddedItemPage({ params: Promise.resolve({ itemId: '17' }) })).rejects.toThrow('not_found')
})
