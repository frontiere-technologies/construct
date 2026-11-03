import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { interpolate } from '@/lib/i18n/interpolate'
import { isValidTranslationKey } from '@/lib/i18n/key-format'
import { AREA_KEYS, FEATURE_CATALOG } from '@/lib/tenancy/feature-catalog'

interface Seed { key: string; it: string; en: string }
const sql = readFileSync('../../devops/db/migrations/0068_tenant_policy_ui.sql', 'utf8')
const seed = JSON.parse(sql.match(/\$seed\$([\s\S]*?)\$seed\$/)![1]) as Seed[]
const value = (key: string) => seed.find(row => row.key === key)!.en

it('interpolates the real purge confirmation counts from the migration seed', () => {
  expect(interpolate(value('platform.policy.purge.counts'), { roles: 2, permissions: 5, menus: 4 }, 'en-US'))
    .toBe('Affected roles: 2. Permission assignments: 5. Menu assignments: 4.')
})
it('interpolates current usage and missing dependency names', () => {
  expect(interpolate(value('platform.policy.usage'), { count: 5 }, 'en-US')).toBe('Current usage: 5')
  expect(interpolate(value('platform.policy.dependencies'), { features: 'Read people' }, 'en-US')).toContain('Missing dependencies: Read people.')
})
it('seeds valid labels for every selectable area and optional feature in both base languages', () => {
  expect(seed.every(row => isValidTranslationKey(row.key) && row.it.length > 0 && row.en.length > 0)).toBe(true)
  for (const area of AREA_KEYS) expect(value(`platform.policy.area.${area.replaceAll('-', '_')}`)).toBeTruthy()
  for (const feature of FEATURE_CATALOG.filter(row => row.area !== null)) expect(value(`platform.policy.feature.${feature.key.replaceAll('-', '_')}`)).toBeTruthy()
})
it('seeds both audit operation labels shown by the policy screen', () => {
  expect(value('audit.operation.tenant.policy.save')).toBe('Tenant feature policy and limits saved')
  expect(value('audit.operation.tenant.grants.purge')).toBe('Suspended tenant assignments deleted')
})
