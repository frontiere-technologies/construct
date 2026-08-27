import { describe, expect, it } from 'vitest'
import { resolveSidebarPresentation } from './sidebar-presentation'

describe('resolveSidebarPresentation', () => {
  it('forces only the column into icon mode on a narrow viewport', () => {
    expect(resolveSidebarPresentation(true, false, false)).toEqual({
      masterCollapsed: false, columnCollapsed: true, showColumnToggle: false,
    })
  })

  it('restores saved preferences on a wide viewport', () => {
    expect(resolveSidebarPresentation(false, true, false)).toEqual({
      masterCollapsed: true, columnCollapsed: false, showColumnToggle: true,
    })
  })
})
