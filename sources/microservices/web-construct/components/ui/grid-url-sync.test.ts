import { describe, expect, it } from 'vitest'
import { createGridUrlSync } from './grid-url-sync'

describe('createGridUrlSync', () => {
  it('coalesces interleaved filter and sort updates from the latest URL state', () => {
    const queued: (() => void)[] = []
    const navigations: string[] = []
    const sync = createGridUrlSync({
      pathname: '/admin/translations', initialSearch: 'page=2&status=missing',
      replace: url => navigations.push(url), queue: run => queued.push(run),
    })

    sync.update({ search: 'save' })
    sync.update({ sort: 'updatedAt', direction: 'DESC' })
    queued.shift()!()

    expect(navigations).toEqual(['/admin/translations?status=missing&search=save&sort=updatedAt&direction=DESC'])
  })

  it('performs one replace when reset synchronously emits a filter event', () => {
    const queued: (() => void)[] = []
    const navigations: string[] = []
    const sync = createGridUrlSync({
      pathname: '/admin/translations', initialSearch: 'search=save&sort=key&direction=ASC',
      replace: url => navigations.push(url), queue: run => queued.push(run),
    })

    // Mirrors `resetGridFilters`: AG Grid emits first, then the toolbar URL callback runs.
    sync.update({ search: null })
    sync.update({ search: null })
    queued.shift()!()

    expect(navigations).toEqual(['/admin/translations?sort=key&direction=ASC'])
  })
})
