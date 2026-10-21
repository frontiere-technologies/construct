import { sql } from 'drizzle-orm'
import {
  pgTable, pgView, uuid, text, jsonb, timestamp, bigint, integer, smallint,
  boolean, varchar, primaryKey, unique, index, uniqueIndex, foreignKey, type AnyPgColumn,
} from 'drizzle-orm/pg-core'

export const userStatus = pgTable('user_status', {
  idUserStatus: bigint('id_user_status', { mode: 'number' }).primaryKey(),
  description: text('description').notNull(),
})

export const roleType = pgTable('role_type', {
  idRoleType: bigint('id_role_type', { mode: 'number' }).primaryKey(),
  description: text('description').notNull(),
})

export const functionalityType = pgTable('functionality_type', {
  idFunctionalityType: bigint('id_functionality_type', { mode: 'number' }).primaryKey(),
  description: text('description').notNull(),
})

export const appLanguage = pgTable('app_language', {
  idLanguage: bigint('id_language', { mode: 'number' }).primaryKey().default(sql`nextval('s_id_language')`),
  code: varchar('code', { length: 5 }).notNull().unique(),
  locale: varchar('locale', { length: 10 }).notNull().unique(),
  name: text('name').notNull(),
  nativeName: text('native_name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  dictionaryVersion: bigint('dictionary_version', { mode: 'number' }).notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (t) => [
  uniqueIndex('app_language_single_default').on(t.isDefault).where(sql`${t.isDefault}`),
])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name'),
  email: text('email').unique(),
  avatar: text('avatar'),
  firstName: text('first_name'),
  lastName: text('last_name'),
  username: text('username'),
  phone: text('phone'),
  themeMode: varchar('theme_mode', { length: 6 }).notNull().default('system'),
  textScale: smallint('text_scale').notNull().default(100),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  passwordHash: text('password_hash'),
  authProvider: text('auth_provider'),
  sub: text('sub'),
  country: varchar('country', { length: 3 }),
  branch: text('branch'),
  flow: text('flow'),
  uomRole: text('uom_role'),
  additionalCompany: text('additional_company'),
  ownerCompany: text('owner_company'),
  features: text('features'),
  pictureUrl: text('picture_url'),
  idUserStatus: bigint('id_user_status', { mode: 'number' }).references(() => userStatus.idUserStatus).default(2),
  lastStatusTs: timestamp('last_status_ts', { withTimezone: true, mode: 'string' }),
  idLanguage: bigint('id_language', { mode: 'number' }).references(() => appLanguage.idLanguage, { onDelete: 'set null' }),
}, (t) => [index('users_id_language_idx').on(t.idLanguage)])

const tenantIdColumn = () => bigint('id_tenant', { mode: 'number' })
  .notNull()
  .default(sql`app_private.current_tenant_id()`)
  .references(() => tenant.id)

/** I tenant (specifica 2026-10-13, §2.3). Globale, in sola lettura per l'app dalla 0047. */
export const tenant = pgTable('tenant', {
  id: bigint('id', { mode: 'number' }).primaryKey().default(sql`nextval('public.s_id_tenant')`),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  // Il tenant modello da cui si copia ogni tenant nuovo (specifica 2026-10-20, §2.3, 0050): al massimo uno.
  isTemplate: boolean('is_template').notNull().default(false),
}, (t) => [
  uniqueIndex('tenant_single_template').on(t.isTemplate).where(sql`${t.isTemplate}`),
])

/** Il colore principale dell'app: una riga per tenant (0046; era una riga sola, 0031). */
export const appTheme = pgTable('app_theme', {
  idTenant: bigint('id_tenant', { mode: 'number' }).primaryKey().default(sql`app_private.current_tenant_id()`).references(() => tenant.id),
  primaryColor: varchar('primary_color', { length: 7 }).notNull(),
  // Il colore principale scelto per il modo scuro (DEC-10, 0038): null vuol dire «ricavato dal chiaro».
  primaryDark: varchar('primary_dark', { length: 7 }),
  // Le quattro superfici per modo (DEC-9, 0033): null vuol dire «il valore fisso».
  backgroundLight: varchar('background_light', { length: 7 }),
  cardLight: varchar('card_light', { length: 7 }),
  accentLight: varchar('accent_light', { length: 7 }),
  sidebarLight: varchar('sidebar_light', { length: 7 }),
  backgroundDark: varchar('background_dark', { length: 7 }),
  cardDark: varchar('card_dark', { length: 7 }),
  accentDark: varchar('accent_dark', { length: 7 }),
  sidebarDark: varchar('sidebar_dark', { length: 7 }),
  dateMod: timestamp('date_mod', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
})

export const passwordSetTokens = pgTable('password_set_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  purpose: text('purpose', { enum: ['reset', 'invitation'] }).notNull().default('reset'),
  deliveryStatus: text('delivery_status', { enum: ['pending', 'sent', 'failed'] }).notNull().default('sent'),
  deliveryAttemptedAt: timestamp('delivery_attempted_at', { withTimezone: true, mode: 'string' }),
  deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'string' }),
  deliveryErrorCode: varchar('delivery_error_code', { length: 64 }),
  supersededAt: timestamp('superseded_at', { withTimezone: true, mode: 'string' }),
  requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
}, (t) => [
  index('password_set_tokens_invitation_state_idx')
    .on(t.userId, t.purpose, t.deliveryStatus, t.createdAt)
    .where(sql`${t.usedAt} is null and ${t.supersededAt} is null`),
])

export const allowedDomains = pgTable('allowed_domains', {
  id: uuid('id').primaryKey().defaultRandom(),
  domain: text('domain').notNull().unique(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
})

export const authRateLimit = pgTable('auth_rate_limit', {
  scope: text('scope').notNull(),
  dimension: text('dimension').notNull(),
  identifierHash: varchar('identifier_hash', { length: 64 }).notNull(),
  windowStart: timestamp('window_start', { withTimezone: true, mode: 'string' }).notNull(),
  attempts: integer('attempts').notNull(),
}, (t) => [primaryKey({ columns: [t.scope, t.dimension, t.identifierHash, t.windowStart] })])

export const role = pgTable('role', {
  idRole: bigint('id_role', { mode: 'number' }).primaryKey().default(sql`nextval('s_id_role')`),
  idTenant: tenantIdColumn(),
  idRoleType: bigint('id_role_type', { mode: 'number' }).references(() => roleType.idRoleType),
  description: text('description').notNull(),
  systemKey: text('system_key', { enum: ['REGISTERED', 'TENANT_ADMIN'] }),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).defaultNow(),
  dateMod: timestamp('date_mod', { withTimezone: true, mode: 'string' }),
}, (t) => [
  unique('role_tenant_role_key').on(t.idTenant, t.idRole),
  uniqueIndex('role_tenant_system_key_idx').on(t.idTenant, t.systemKey).where(sql`${t.systemKey} is not null`),
])

/** Chi appartiene a quale tenant, con uno stato per tenant (specifica 2026-10-20, §2.1, 0048). */
export const tenantMembership = pgTable('tenant_membership', {
  idTenant: tenantIdColumn(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['active', 'deactivated'] }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'tenant_membership_pkey', columns: [t.idTenant, t.userId] }),
  index('tenant_membership_user_id_idx').on(t.userId),
])

export const userRole = pgTable('user_role', {
  idTenant: tenantIdColumn(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  idRole: bigint('id_role', { mode: 'number' }).notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.idTenant, t.userId, t.idRole] }),
  foreignKey({ name: 'user_role_role_fkey', columns: [t.idTenant, t.idRole], foreignColumns: [role.idTenant, role.idRole] }).onDelete('cascade'),
  // Nessun ruolo senza appartenenza al tenant (0048).
  foreignKey({ name: 'user_role_membership_fkey', columns: [t.idTenant, t.userId], foreignColumns: [tenantMembership.idTenant, tenantMembership.userId] }).onDelete('cascade'),
  index('user_role_id_role_user_id_idx').on(t.idTenant, t.idRole, t.userId),
])

export const permission = pgTable('permission', {
  idPermission: bigint('id_permission', { mode: 'number' }).primaryKey().default(sql`nextval('s_id_permission')`),
  name: text('name'),
  idParent: bigint('id_parent', { mode: 'number' }).references((): AnyPgColumn => permission.idPermission, { onDelete: 'cascade' }),
  orderPosition: integer('order_position').notNull().default(0),
  description: text('description'),
  itemTranslation: jsonb('item_translation'),
  isImmutable: smallint('is_immutable').notNull().default(0),
  kind: text('kind', { enum: ['CATEGORY', 'GRANT'] }).notNull(),
  code: varchar('code', { length: 80 }),
  origin: text('origin', { enum: ['SOURCE', 'CONSOLE'] }).notNull().default('CONSOLE'),
  deprecatedAt: timestamp('deprecated_at', { withTimezone: true, mode: 'string' }),
}, (t) => [
  index('permission_parent_order_idx').on(t.idParent, t.orderPosition),
  uniqueIndex('permission_code_unique').on(t.code).where(sql`${t.code} is not null`),
])

export const rolePermission = pgTable('role_permission', {
  idTenant: tenantIdColumn(),
  idRole: bigint('id_role', { mode: 'number' }).notNull(),
  idPermission: bigint('id_permission', { mode: 'number' }).notNull().references(() => permission.idPermission, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.idTenant, t.idRole, t.idPermission] }),
  foreignKey({ name: 'role_permission_role_fkey', columns: [t.idTenant, t.idRole], foreignColumns: [role.idTenant, role.idRole] }).onDelete('cascade'),
])

export const menuEntry = pgTable('menu_entry', {
  idMenuEntry: bigint('id_menu_entry', { mode: 'number' }).primaryKey().default(sql`nextval('s_id_menu_entry')`),
  idTenant: tenantIdColumn(),
  idParent: bigint('id_parent', { mode: 'number' }),
  name: text('name'),
  orderPosition: integer('order_position').notNull().default(0),
  navbarPosition: text('navbar_position', { enum: ['TOP', 'BOTTOM'] }),
  iconPath: text('icon_path'),
  idFunctionalityType: bigint('id_functionality_type', { mode: 'number' }).references(() => functionalityType.idFunctionalityType),
  functionalityLink: text('functionality_link'),
  openInNewTab: smallint('open_in_new_tab').notNull().default(1),
  itemTranslation: jsonb('item_translation'),
  isImmutable: smallint('is_immutable').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (t) => [
  unique('menu_entry_tenant_entry_key').on(t.idTenant, t.idMenuEntry),
  // DEFERRABLE INITIALLY DEFERRED nel database (0046): Drizzle non lo esprime, e il contratto
  // confronta solo colonne e azioni.
  foreignKey({ name: 'menu_entry_parent_fkey', columns: [t.idTenant, t.idParent], foreignColumns: [t.idTenant, t.idMenuEntry] }).onDelete('cascade'),
  index('menu_entry_parent_order_idx').on(t.idTenant, t.idParent, t.orderPosition),
])

export const menuEntryTag = pgTable('menu_entry_tag', {
  idTenant: tenantIdColumn(),
  idMenuEntry: bigint('id_menu_entry', { mode: 'number' }).notNull(),
  tagLan: varchar('tag_lan', { length: 5 }).notNull(),
  tag: varchar('tag', { length: 50 }).notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.idTenant, t.idMenuEntry, t.tagLan, t.tag] }),
  foreignKey({ name: 'menu_entry_tag_entry_fkey', columns: [t.idTenant, t.idMenuEntry], foreignColumns: [menuEntry.idTenant, menuEntry.idMenuEntry] }).onDelete('cascade'),
])

/** La concessione su una VOCE DI MENU. Una funzionalità è il proprio permesso (DEC-17), quindi
 *  la concessione punta alla voce e non a una riga gemella in `permission`. Presenza della riga
 *  = concessione (DEC-7): nessuna colonna `authorized`, revocare cancella la riga. */
export const roleFunctionality = pgTable('role_functionality', {
  idTenant: tenantIdColumn(),
  idRole: bigint('id_role', { mode: 'number' }).notNull(),
  idMenuEntry: bigint('id_menu_entry', { mode: 'number' }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.idTenant, t.idRole, t.idMenuEntry] }),
  foreignKey({ name: 'role_functionality_role_fkey', columns: [t.idTenant, t.idRole], foreignColumns: [role.idTenant, role.idRole] }).onDelete('cascade'),
  foreignKey({ name: 'role_functionality_entry_fkey', columns: [t.idTenant, t.idMenuEntry], foreignColumns: [menuEntry.idTenant, menuEntry.idMenuEntry] }).onDelete('cascade'),
])

// Read-only — created by schema.sql, never migrated by drizzle-kit (DEC-4).
export const roleListView = pgView('role_list_view', {
  id: bigint('id', { mode: 'number' }),
  description: text('description'),
  roleType: text('role_type'),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }),
  dateMod: timestamp('date_mod', { withTimezone: true, mode: 'string' }),
  associatedUsers: bigint('associated_users', { mode: 'number' }),
  hasPermissions: boolean('has_permissions'),
}).existing()

export const translationKey = pgTable('translation_key', {
  idTranslationKey: bigint('id_translation_key', { mode: 'number' }).primaryKey().default(sql`nextval('s_id_translation_key')`),
  key: varchar('key', { length: 200 }).notNull().unique(),
  description: text('description'),
  namespace: varchar('namespace', { length: 60 }).notNull(),
  module: varchar('module', { length: 60 }),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (t) => [index('translation_key_namespace_idx').on(t.namespace), index('translation_key_module_idx').on(t.module)])

export const translationValue = pgTable('translation_value', {
  idTranslationValue: bigint('id_translation_value', { mode: 'number' }).primaryKey().default(sql`nextval('s_id_translation_value')`),
  idTranslationKey: bigint('id_translation_key', { mode: 'number' }).notNull().references(() => translationKey.idTranslationKey, { onDelete: 'cascade' }),
  idLanguage: bigint('id_language', { mode: 'number' }).notNull().references(() => appLanguage.idLanguage, { onDelete: 'cascade' }),
  value: varchar('value', { length: 1000 }).notNull(),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
}, (t) => [
  unique('translation_value_key_language_unique').on(t.idTranslationKey, t.idLanguage),
  index('translation_value_language_idx').on(t.idLanguage),
])
