import type { MenuItem } from '@/types/menu'

/**
 * La barra laterale della console e la voce "Piattaforma" dei tenant (specifica 2026-10-26,
 * MT5-DEC-3). Il menu dei tenant è un dato di tenant (`menu_entry`): la sezione della piattaforma
 * non ne fa parte e si aggiunge qui, a mano, solo per gli amministratori di piattaforma. Gli id non
 * sono numeri, come quelli del menu dei tenant, quindi non si confondono con una riga di `menu_entry`.
 *
 * La sezione ha Tenant, Amministratori, Registro (MT5-DEC-16), Lingue e Traduzioni (MT5-DEC-17,
 * MT5-DEC-24).
 */
type Translate = (key: string) => string

const SECTION_ID = 'platform'

const base = {
  parentId: null,
  visible: true,
  active: true,
} as const

/** La sezione "Piattaforma" con le sue pagine, e, se serve, il collegamento per tornare al tenant. */
export function buildPlatformMenu(t: Translate, options: { backToTenant: boolean }): MenuItem[] {
  const items: MenuItem[] = [
    {
      ...base, id: SECTION_ID, label: t('platform.nav.section'), icon: 'ShieldCheck', type: 'container', order: 1, position: 'main',
      collapsible: true, defaultExpanded: true,
    },
    {
      ...base, id: `${SECTION_ID}-tenants`, parentId: SECTION_ID, label: t('platform.nav.tenants'), icon: 'Building2',
      route: '/platform', type: 'link', order: 1, position: 'main',
    },
    {
      ...base, id: `${SECTION_ID}-admins`, parentId: SECTION_ID, label: t('platform.nav.admins'), icon: 'Users',
      route: '/platform/admins', type: 'link', order: 2, position: 'main',
    },
    {
      ...base, id: `${SECTION_ID}-audit`, parentId: SECTION_ID, label: t('platform.nav.audit'), icon: 'ScrollText',
      route: '/platform/audit', type: 'link', order: 3, position: 'main',
    },
    {
      ...base, id: `${SECTION_ID}-languages`, parentId: SECTION_ID, label: t('platform.nav.languages'), icon: 'Languages',
      route: '/platform/languages', type: 'link', order: 4, position: 'main',
    },
    {
      ...base, id: `${SECTION_ID}-translations`, parentId: SECTION_ID, label: t('platform.nav.translations'), icon: 'BookA',
      route: '/platform/translations', type: 'link', order: 5, position: 'main',
    },
  ]
  if (options.backToTenant) {
    items.push({
      ...base, id: `${SECTION_ID}-back`, label: t('platform.nav.back_to_tenant'), icon: 'ArrowLeft',
      route: '/', type: 'link', order: 0, position: 'top',
    })
  }
  return items
}

/** La voce che porta alla console dalla barra di un tenant: un solo collegamento, in fondo al menu. */
export function platformEntryItem(t: Translate): MenuItem {
  return {
    ...base, id: SECTION_ID, label: t('platform.nav.section'), icon: 'ShieldCheck', route: '/platform', type: 'link',
    order: Number.MAX_SAFE_INTEGER, position: 'main',
  }
}
