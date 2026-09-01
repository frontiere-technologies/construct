import { sql } from 'drizzle-orm'
import {
  pgTable, pgView, uuid, text, jsonb, timestamp, bigint, integer, smallint,
  boolean, varchar, primaryKey, unique, index, uniqueIndex, type AnyPgColumn,
} from 'drizzle-orm/pg-core'

export const userStatus = pgTable('user_status', {
  idUserStatus: bigint('id_user_status', { mode: 'number' }).primaryKey(),
  description: text('description').notNull(),
})

export const roleType = pgTable('role_type', {
  idRoleType: bigint('id_role_type', { mode: 'number' }).primaryKey(),
  description: text('description').notNull(),
})

export const navigationItemType = pgTable('navigation_item_type', {
  idItemType: bigint('id_item_type', { mode: 'number' }).primaryKey(),
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
  themeConfig: jsonb('theme_config'),
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
  idRoleType: bigint('id_role_type', { mode: 'number' }).references(() => roleType.idRoleType),
  description: text('description').notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).defaultNow(),
  dateMod: timestamp('date_mod', { withTimezone: true, mode: 'string' }),
})

export const roleHistory = pgTable('role_history', {
  idRole: bigint('id_role', { mode: 'number' }).notNull(),
  hDateIns: timestamp('h_date_ins', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  description: text('description').notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }),
  dateMod: timestamp('date_mod', { withTimezone: true, mode: 'string' }),
}, (t) => [primaryKey({ columns: [t.idRole, t.hDateIns] })])

export const userRole = pgTable('user_role', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  idRole: bigint('id_role', { mode: 'number' }).notNull().references(() => role.idRole, { onDelete: 'cascade' }),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.idRole] }),
  index('user_role_id_role_user_id_idx').on(t.idRole, t.userId),
])

export const permission = pgTable('permission', {
  idPermission: bigint('id_permission', { mode: 'number' }).primaryKey().default(sql`nextval('s_id_permission')`),
  name: text('name'),
  idItemType: bigint('id_item_type', { mode: 'number' }).notNull().references(() => navigationItemType.idItemType),
  idFunctionalityType: bigint('id_functionality_type', { mode: 'number' }).references(() => functionalityType.idFunctionalityType),
  functionalityLink: text('functionality_link'),
  iconPath: text('icon_path'),
  idParent: bigint('id_parent', { mode: 'number' }).references((): AnyPgColumn => permission.idPermission, { onDelete: 'cascade' }),
  orderPosition: integer('order_position').notNull().default(0),
  description: text('description'),
  navbarPosition: text('navbar_position', { enum: ['TOP', 'BOTTOM'] }),
  itemTranslation: jsonb('item_translation'),
  isImmutable: smallint('is_immutable').notNull().default(0),
  configVisibility: smallint('config_visibility').notNull().default(0),
  noPermissionNeedForNavigation: smallint('no_permission_need_for_navigation').notNull().default(0),
  openInNewTab: smallint('open_in_new_tab').notNull().default(1),
  externalId: text('external_id'),
  clickCount: bigint('click_count', { mode: 'number' }).default(0),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).defaultNow(),
  kind: text('kind', { enum: ['CATEGORY', 'GRANT'] }).notNull(),
  code: varchar('code', { length: 80 }),
  origin: text('origin', { enum: ['SOURCE', 'CONSOLE'] }).notNull().default('CONSOLE'),
  deprecatedAt: timestamp('deprecated_at', { withTimezone: true, mode: 'string' }),
}, (t) => [
  index('permission_parent_order_idx').on(t.idParent, t.orderPosition),
  uniqueIndex('permission_code_unique').on(t.code).where(sql`${t.code} is not null`),
])

export const navigationItemTag = pgTable('navigation_item_tag', {
  idItem: bigint('id_item', { mode: 'number' }).notNull().references(() => permission.idPermission, { onDelete: 'cascade' }),
  tagLan: varchar('tag_lan', { length: 5 }).notNull(),
  tag: varchar('tag', { length: 50 }).notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.idItem, t.tagLan, t.tag] })])

export const rolePermission = pgTable('role_permission', {
  idRole: bigint('id_role', { mode: 'number' }).notNull().references(() => role.idRole, { onDelete: 'cascade' }),
  idPermission: bigint('id_permission', { mode: 'number' }).notNull().references(() => permission.idPermission, { onDelete: 'cascade' }),
  authorized: boolean('authorized').notNull().default(false),
}, (t) => [primaryKey({ columns: [t.idRole, t.idPermission] })])

export const menuEntry = pgTable('menu_entry', {
  idMenuEntry: bigint('id_menu_entry', { mode: 'number' }).primaryKey().default(sql`nextval('s_id_menu_entry')`),
  idPermission: bigint('id_permission', { mode: 'number' }).references(() => permission.idPermission, { onDelete: 'restrict' }),
  idParent: bigint('id_parent', { mode: 'number' }).references((): AnyPgColumn => menuEntry.idMenuEntry, { onDelete: 'cascade' }),
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
  index('menu_entry_parent_order_idx').on(t.idParent, t.orderPosition),
  index('menu_entry_permission_idx').on(t.idPermission),
])

export const menuEntryTag = pgTable('menu_entry_tag', {
  idMenuEntry: bigint('id_menu_entry', { mode: 'number' }).notNull().references(() => menuEntry.idMenuEntry, { onDelete: 'cascade' }),
  tagLan: varchar('tag_lan', { length: 5 }).notNull(),
  tag: varchar('tag', { length: 50 }).notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.idMenuEntry, t.tagLan, t.tag] })])

export const userInfo = pgTable('user_info', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  attributeType: varchar('attribute_type', { length: 30 }).notNull(),
  attributeValue: text('attribute_value').notNull(),
  dateIns: timestamp('date_ins', { withTimezone: true, mode: 'string' }).defaultNow(),
  dateMod: timestamp('date_mod', { withTimezone: true, mode: 'string' }),
}, (t) => [primaryKey({ columns: [t.userId, t.attributeType] })])

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
