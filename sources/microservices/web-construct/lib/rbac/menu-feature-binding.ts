import { FEATURE_CATALOG, type AreaKey, type FeatureKey } from '@/lib/tenancy/feature-catalog'
import type { TenantPolicySnapshot } from '@/lib/tenancy/tenant-policy-types'

export interface MenuFeatureBinding {
  areaKey: AreaKey | null
  featureKey: FeatureKey | null
}

/** Ogni pagina reale deve dichiarare il binding; solo il catch-all esistente mostra Home.
 * La guardia menu-route-inventory impedisce che una nuova porta erediti questo fallback. */
export const MENU_ROUTE_BINDINGS = [
  { route: '/', featureKey: 'core-app' },
  { route: '/profile', featureKey: 'core-app' },
  { route: '/settings', featureKey: 'core-app' },
  { route: '/login', featureKey: 'core-app' },
  { route: '/register', featureKey: 'core-app' },
  { route: '/forgot-password', featureKey: 'core-app' },
  { route: '/set-password', featureKey: 'core-app' },
  { route: '/select-tenant', featureKey: 'core-app' },
  { route: '/no-tenant', featureKey: 'core-app' },
  { route: '/user-management', featureKey: 'read-users' },
  { route: '/roles-permissions', featureKey: 'read-roles' },
  { route: '/roles-permissions/[roleId]', featureKey: 'read-roles' },
  { route: '/functionalities', featureKey: 'read-menu' },
  { route: '/functionalities/create', featureKey: 'manage-menu' },
  { route: '/functionalities/[funcId]/edit', featureKey: 'manage-menu' },
  { route: '/admin/theme', featureKey: 'manage-tenant-theme' },
  { route: '/admin/languages', featureKey: 'read-languages' },
  { route: '/admin/translations', featureKey: 'read-translations' },
  { route: '/admin/tenant-settings', featureKey: 'manage-support-consent' },
  { route: '/admin/audit', featureKey: 'read-tenant-audit' },
  { route: '/embedded/[itemId]', featureKey: 'use-custom-content' },
] as const satisfies readonly { route: string; featureKey: FeatureKey }[]

function matchesRoute(path: string, route: string): boolean {
  const segments = route.split('/')
  const actual = path.split('/')
  return actual.length === segments.length && segments.every((segment, i) =>
    segment.startsWith('[') ? actual[i].length > 0 : segment === actual[i])
}

export function bindMenuTarget(input: {
  link: string | null
  functionalityType: number | null
  areaKey: AreaKey | null
}, appOrigin: string): MenuFeatureBinding {
  if (input.functionalityType == null) {
    if (input.link?.trim()) throw new Error('category_cannot_have_target')
    return { areaKey: input.areaKey, featureKey: null }
  }
  if (![1, 2, 3, 4, 5].includes(input.functionalityType)) throw new Error('unsupported_menu_type')
  if (!input.link?.trim()) throw new Error('menu_target_required')
  if (/[\\\u0000-\u0020\u007f]/.test(input.link.trim())) throw new Error('unsafe_menu_target')
  const authority = /^(?:https?:)?\/\/([^/?#]+)/i.exec(input.link.trim())?.[1]
  if (authority && (authority.includes('%') || /[^\x21-\x7e]/.test(authority))) throw new Error('unsafe_menu_target')
  if (!appOrigin && (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input.link.trim()) || input.link.trim().startsWith('//'))) throw new Error('menu_origin_required')
  // Base sintattica per i soli percorsi relativi quando non è configurata un'origine.
  const origin = appOrigin ? new URL(appOrigin).origin : 'https://menu-relative.invalid'
  const target = new URL(input.link.trim(), origin + '/')
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('unsafe_menu_target')
  if (target.origin !== origin) {
    if (input.functionalityType === 3) throw new Error('internal_menu_target_required')
    return { areaKey: input.areaKey ?? 'navigation', featureKey: 'use-custom-content' }
  }
  const path = decodeURIComponent(target.pathname).replace(/\/+$/, '') || '/'
  if (path === '/platform' || path.startsWith('/platform/') || path === '/api' || path.startsWith('/api/')) {
    throw new Error('not_a_tenant_menu_target')
  }
  const featureKey = MENU_ROUTE_BINDINGS.find(binding => matchesRoute(path, binding.route))?.featureKey ?? 'core-app'
  const areaKey = FEATURE_CATALOG.find(feature => feature.key === featureKey)!.area
  if (featureKey === 'use-custom-content') return { areaKey: input.areaKey ?? areaKey, featureKey }
  if (input.areaKey !== null && input.areaKey !== areaKey) throw new Error('incompatible_menu_area')
  return { areaKey, featureKey }
}

export function canUseMenuEntry(policy: TenantPolicySnapshot, binding: MenuFeatureBinding): boolean {
  if (binding.featureKey === null) return binding.areaKey === null || policy.areas[binding.areaKey]
  const feature = FEATURE_CATALOG.find(candidate => candidate.key === binding.featureKey)
  if (!feature || !policy.enabledFeatures.includes(binding.featureKey)) return false
  // L'eccezione sulla capacità prevale nella propria area; un'area di presentazione diversa
  // (contenuti propri) deve essere concessa separatamente.
  if (binding.areaKey !== feature.area && binding.areaKey !== null && !policy.areas[binding.areaKey]) return false
  return true
}
