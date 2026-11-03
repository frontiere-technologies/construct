import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTenantExportScope } from '@/lib/db/tenant-export-scope'
import { EXPORT_MAX_BYTES, EXPORT_DEADLINE_MS } from './tenant-archive-types'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('tenant exporter resource limits', () => {
  it('accepts exactly fifty MiB and rejects the next byte in the actual archive writer', async () => {
    const { TenantArchiveWriter } = await import('./tenant-export-service')
    expect(EXPORT_MAX_BYTES).toBe(52_428_800)
    await withTenantExportScope(new AbortController().signal, async () => {
      const writer = new TenantArchiveWriter()
      writer.append('a'.repeat(52_428_800))
      expect(writer.finish()).toHaveLength(52_428_800)
      expect(() => writer.append('x')).toThrow('tenant_export_size_limit')
    })
  })

  it('measures UTF-8 bytes rather than JavaScript characters', async () => {
    const { TenantArchiveWriter } = await import('./tenant-export-service')
    await withTenantExportScope(new AbortController().signal, async () => {
      const writer = new TenantArchiveWriter()
      writer.append('é'.repeat(26_214_400))
      expect(writer.finish()).toHaveLength(52_428_800)
      expect(() => writer.append('é')).toThrow('tenant_export_size_limit')
    })
  })

  it('rejects at the real total deadline and for an already aborted request', async () => {
    const { TenantArchiveWriter } = await import('./tenant-export-service')
    expect(EXPORT_DEADLINE_MS).toBe(60_000)
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    await expect(withTenantExportScope(new AbortController().signal, async () => {
      const writer = new TenantArchiveWriter()
      clock = 59_999
      writer.append('{}')
      clock = 60_000
      return writer.finish()
    })).rejects.toThrow('tenant_export_deadline')
    const abort = new AbortController()
    abort.abort(new Error('request aborted'))
    await expect(withTenantExportScope(abort.signal, async () => new TenantArchiveWriter().finish())).rejects.toThrow('request aborted')
  })
})
