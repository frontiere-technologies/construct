import { describe, it, expect } from 'vitest'
import { FolderTree, Code, Globe, Link as LinkIcon, Circle } from 'lucide-react'
import { typeIcon } from './NavigationTree'

describe('typeIcon', () => {
  it('returns FolderTree for categories regardless of functionalityType', () => {
    expect(typeIcon({ type: 'CATEGORY', functionalityType: null })).toBe(FolderTree)
  })
  it('returns Code for embedded-page functionalities', () => {
    expect(typeIcon({ type: 'FUNCTIONALITY', functionalityType: 'EMBEDDED_PAGE' })).toBe(Code)
  })
  it('returns Globe for external-link functionalities', () => {
    expect(typeIcon({ type: 'FUNCTIONALITY', functionalityType: 'EXTERNAL_LINK' })).toBe(Globe)
  })
  it('returns LinkIcon for internal-link functionalities', () => {
    expect(typeIcon({ type: 'FUNCTIONALITY', functionalityType: 'INTERNAL_FUNCTIONALITY' })).toBe(LinkIcon)
  })
  it('falls back to Circle for types not creatable from the form', () => {
    expect(typeIcon({ type: 'FUNCTIONALITY', functionalityType: 'REMOTE_DESKTOP' })).toBe(Circle)
    expect(typeIcon({ type: 'FUNCTIONALITY', functionalityType: 'PERMISSION' })).toBe(Circle)
    expect(typeIcon({ type: 'FUNCTIONALITY', functionalityType: null })).toBe(Circle)
  })
})
