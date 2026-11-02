import { z } from 'zod'
import { FEATURE_CATALOG, FEATURE_KEYS, featureKeySchema, tenantAreasSchema, tenantFeatureOverridesSchema } from '@/lib/tenancy/feature-catalog'
import type { FeatureKey } from '@/lib/tenancy/feature-catalog'

export type PolicyActionResult = { ok: true; revision: number } | { ok: false; reason: 'invalid' | 'conflict' | 'disabled' }

export interface PurgePreview {
  revision: number
  keys: FeatureKey[]
  roleCount: number
  permissionGrantCount: number
  menuGrantCount: number
  fingerprint: string
}

const countSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1)
const quotaSchema = z.number().int().min(0).max(2_147_483_647).nullable()

export const tenantPolicyDraftSchema = z.strictObject({
  expectedRevision: revisionSchema,
  areas: tenantAreasSchema,
  overrides: tenantFeatureOverridesSchema.refine(overrides => FEATURE_CATALOG.every(feature => feature.area !== null || overrides[feature.key] === undefined)),
  limits: z.strictObject({
    queryTimeoutMs: z.number().int().positive().max(2_147_483_647).nullable(),
    maxMembers: quotaSchema,
    maxRoles: quotaSchema,
    maxMenuEntries: quotaSchema,
  }),
})

export const purgeKeysSchema = z.array(featureKeySchema).min(1).max(FEATURE_KEYS.length)
  .refine(keys => new Set(keys).size === keys.length)

export const purgePreviewSchema = z.strictObject({
  revision: revisionSchema,
  keys: purgeKeysSchema,
  roleCount: countSchema,
  permissionGrantCount: countSchema,
  menuGrantCount: countSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
})
