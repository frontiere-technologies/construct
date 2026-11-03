'use client'

import { useId, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/context/I18nContext'
import { previewTenantGrantPurge, saveTenantPolicy } from '@/lib/platform/tenant-policy-actions'
import { tenantPolicyDraftSchema, type PurgePreview } from '@/lib/platform/tenant-policy-schemas'
import { AREA_KEYS, FEATURE_CATALOG, type FeatureKey } from '@/lib/tenancy/feature-catalog'
import type { TenantUsage } from '@/lib/tenancy/tenant-limits'
import { evaluateTenantFeatures, findMissingDependencies } from '@/lib/tenancy/tenant-policy'
import type { TenantLimits, TenantPolicyDraft, TenantPolicySnapshot } from '@/lib/tenancy/tenant-policy-types'
import { TenantGrantPurgeDialog } from './TenantGrantPurgeDialog'

const QUOTAS = [
  { key: 'maxMembers', usage: 'members' }, { key: 'maxRoles', usage: 'roles' }, { key: 'maxMenuEntries', usage: 'menuEntries' },
] as const

export function TenantPolicyEditor({ tenantId, initialPolicy, usage }: { tenantId: number; initialPolicy: TenantPolicySnapshot; usage: TenantUsage }) {
  const { t } = useI18n()
  const router = useRouter()
  const headingId = useId()
  const [saved, setSaved] = useState(initialPolicy)
  const [draft, setDraft] = useState<TenantPolicyDraft>({ expectedRevision: initialPolicy.revision, areas: initialPolicy.areas, overrides: initialPolicy.overrides, limits: initialPolicy.limits })
  const [busy, setBusy] = useState(false)
  const [isStale, setIsStale] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [hasError, setHasError] = useState(false)
  const [selected, setSelected] = useState<FeatureKey[]>([])
  const [preview, setPreview] = useState<PurgePreview | null>(null)
  // Il valutatore condiviso descrive il draft; il server mantiene ogni controllo di autorità.
  const enabled = evaluateTenantFeatures(draft.areas, draft.overrides)
  const missing = findMissingDependencies(enabled)
  const suspended = FEATURE_CATALOG.filter(feature => feature.area !== null && !saved.enabledFeatures.includes(feature.key))
  const isDirty = JSON.stringify({ areas: saved.areas, overrides: saved.overrides, limits: saved.limits }) !== JSON.stringify({ areas: draft.areas, overrides: draft.overrides, limits: draft.limits })
  const handleSave = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || isStale || missing.length) return
    setPreview(null)
    setBusy(true)
    setMessage(null)
    try {
      const parsed = tenantPolicyDraftSchema.safeParse(draft)
      if (!parsed.success) { setHasError(true); setMessage(t('platform.policy.invalid')); return }
      const result = await saveTenantPolicy(tenantId, parsed.data)
      setHasError(!result.ok)
      if (!result.ok) { setIsStale(result.reason === 'conflict'); setMessage(t(`platform.policy.${result.reason}`)); return }
      setSaved({ ...draft, revision: result.revision, enabledFeatures: [...enabled] })
      setDraft(previous => ({ ...previous, expectedRevision: result.revision }))
      setSelected([])
      setMessage(t('platform.policy.saved'))
    } catch { setHasError(true); setMessage(t('platform.policy.error')) }
    finally { setBusy(false) }
  }
  const handlePreview = async () => {
    if (busy || isDirty || isStale || !selected.length) return
    setBusy(true)
    setPreview(null)
    try { setPreview(await previewTenantGrantPurge(tenantId, selected)) }
    catch { setHasError(true); setMessage(t('platform.policy.purge.refresh_error')) }
    finally { setBusy(false) }
  }
  const handleLimit = (key: keyof TenantLimits, value: string) => {
    setPreview(null)
    setDraft(previous => ({ ...previous, limits: { ...previous.limits, [key]: value === '' ? null : Number(value) } }))
  }
  return <section aria-labelledby={headingId} className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5">
    <h2 id={headingId} className="text-lg font-semibold">{t('platform.policy.title')}</h2>
    <p className="text-sm text-muted-foreground">{t('platform.policy.suspended_preserved')}</p>
    <form onSubmit={handleSave} className="space-y-4">
      {AREA_KEYS.map(area => <fieldset key={area} className="space-y-3 rounded-lg border border-border p-3" disabled={busy || isStale}>
        <legend className="px-1 font-medium">{t(`platform.policy.area.${area.replaceAll('-', '_')}`)}</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" data-area={area} checked={draft.areas[area]} onChange={event => { setPreview(null); setDraft(previous => ({ ...previous, areas: { ...previous.areas, [area]: event.target.checked } })) }} />{t('platform.policy.area_enabled')}</label>
        {FEATURE_CATALOG.filter(feature => feature.area === area).map(feature => <div key={feature.key} className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`${headingId}-${feature.key.replaceAll('-', '_')}`} className="text-sm">{t(`platform.policy.feature.${feature.key.replaceAll('-', '_')}`)}</label>
          <div className="flex flex-wrap items-center gap-2">
            <select id={`${headingId}-${feature.key.replaceAll('-', '_')}`} data-feature={feature.key} className="rounded-md border border-input bg-background px-3 py-2 text-sm" value={draft.overrides[feature.key] === undefined ? 'inherit' : draft.overrides[feature.key] ? 'allow' : 'deny'} onChange={event => {
              const value = event.target.value
              setPreview(null)
              setDraft(previous => { const overrides = { ...previous.overrides }; if (value === 'inherit') delete overrides[feature.key]; else overrides[feature.key] = value === 'allow'; return { ...previous, overrides } })
            }}>
              <option value="inherit">{t('platform.policy.inherit')}</option><option value="allow">{t('platform.policy.allow')}</option><option value="deny">{t('platform.policy.deny')}</option>
            </select>
            <span className="text-xs text-muted-foreground">{t(enabled.has(feature.key) ? 'platform.policy.effective.allowed' : 'platform.policy.effective.denied')} · {t(draft.overrides[feature.key] === undefined ? 'platform.policy.source.area' : 'platform.policy.source.override')}</span>
          </div>
        </div>)}
      </fieldset>)}
      <fieldset className="space-y-3" disabled={busy || isStale}>
        <legend className="font-medium">{t('platform.policy.limits')}</legend>
        <p className="text-sm text-muted-foreground">{t('platform.policy.limit_inherit')}</p>
        {[...QUOTAS.map(quota => quota.key), 'queryTimeoutMs' as const].map(key => <div key={key}>
          <label htmlFor={`${headingId}-${key.replaceAll('-', '_')}`} className="text-sm">{t(`platform.policy.limit.${key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase())}`)}</label>
          <Input id={`${headingId}-${key.replaceAll('-', '_')}`} type="number" min={key === 'queryTimeoutMs' ? 1 : 0} max={2147483647} step={1} value={draft.limits[key] ?? ''} onChange={event => handleLimit(key, event.target.value)} />
          {QUOTAS.filter(quota => quota.key === key).map(quota => <p key={quota.key} className="text-sm text-muted-foreground">{t('platform.policy.usage', { count: usage[quota.usage] })}{draft.limits[quota.key] !== null && draft.limits[quota.key]! < usage[quota.usage] && <span role="status" className="ml-2 text-warning-muted-foreground">{t('platform.policy.quota_below_usage')}</span>}</p>)}
        </div>)}
      </fieldset>
      {missing.length > 0 && <p role="alert" className="text-sm text-destructive-muted-foreground">{t('platform.policy.dependencies', { features: missing.map(key => t(`platform.policy.feature.${key.replaceAll('-', '_')}`)).join(', ') })}</p>}
      {message && <p role={hasError ? 'alert' : 'status'} className="text-sm">{message}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={busy || isStale || missing.length > 0}>{t('common.actions.save')}</Button>{isStale && <Button type="button" variant="outline" onClick={() => router.refresh()}>{t('platform.policy.reload')}</Button>}</div>
    </form>
    {suspended.length > 0 && <fieldset className="space-y-3 border-t border-border pt-4" disabled={busy || isDirty || isStale}>
      <legend className="font-medium">{t('platform.policy.purge.selection')}</legend>
      {AREA_KEYS.filter(area => suspended.some(feature => feature.area === area)).map(area => {
        const keys = suspended.filter(feature => feature.area === area).map(feature => feature.key)
        return <div key={area} className="space-y-2">
          <label className="flex gap-2 text-sm font-medium"><input type="checkbox" data-purge-area={area} checked={keys.every(key => selected.includes(key))} onChange={event => { setPreview(null); setSelected(previous => event.target.checked ? FEATURE_CATALOG.filter(feature => previous.includes(feature.key) || keys.includes(feature.key)).map(feature => feature.key) : previous.filter(key => !keys.includes(key))) }} />{t(`platform.policy.area.${area.replaceAll('-', '_')}`)}</label>
          {keys.map(key => <label key={key} className="ml-5 flex gap-2 text-sm"><input type="checkbox" checked={selected.includes(key)} onChange={event => { setPreview(null); setSelected(previous => event.target.checked ? [...previous, key] : previous.filter(value => value !== key)) }} />{t(`platform.policy.feature.${key.replaceAll('-', '_')}`)}</label>)}
        </div>
      })}
      <Button type="button" variant="outline" disabled={busy || isDirty || isStale || !selected.length} onClick={handlePreview}>{t('platform.policy.purge.preview')}</Button>
    </fieldset>}
    {preview && !isDirty && <TenantGrantPurgeDialog key={preview.fingerprint} tenantId={tenantId} preview={preview} onComplete={() => { setPreview(null); setIsStale(true); setMessage(t('platform.policy.purge.done')); setHasError(false); router.refresh() }} />}
  </section>
}
