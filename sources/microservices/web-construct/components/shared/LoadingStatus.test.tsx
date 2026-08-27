import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LoadingStatus } from './LoadingStatus'

describe('LoadingStatus', () => {
  it('announces loading while keeping the spinner decorative', () => {
    const html = renderToStaticMarkup(<LoadingStatus label="Loading…" />)

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-label="Loading…"')
    expect(html).toContain('aria-hidden="true"')
  })
})
