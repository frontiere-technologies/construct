import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Input, inputBaseClasses } from './input'
import { Textarea } from './textarea'
import { Select } from './select'

describe('Input', () => {
  it('renders a native input carrying its type and value through', () => {
    const html = renderToStaticMarkup(<Input type="email" defaultValue="a@b.it" />)
    expect(html).toMatch(/^<input /)
    expect(html).toContain('type="email"')
    expect(html).toContain('value="a@b.it"')
  })

  it('paints itself with theme tokens, never with a fixed colour', () => {
    const html = renderToStaticMarkup(<Input />)
    expect(html).toContain('bg-popover')
    expect(html).toContain('border-border')
    expect(html).toContain('text-foreground')
    expect(html).not.toMatch(/bg-(gray|slate|zinc)-\d+/)
    expect(inputBaseClasses).toContain('disabled:bg-accent')
  })

  it('shows a visible focus ring, which most call sites had and some did not', () => {
    const html = renderToStaticMarkup(<Input />)
    expect(html).toContain('focus:ring-2')
  })

  it('lets a call site override a base utility instead of stacking against it', () => {
    const html = renderToStaticMarkup(<Input className="px-1" />)
    expect(html).toContain('px-1')
    expect(html).not.toMatch(/class="[^"]*px-3/)
  })

  it('forwards the disabled attribute to the underlying input', () => {
    // Il vestito dello stato disabilitato vive nella stringa di classi, quindi
    // compare nel markup anche senza la prop: asserirlo qui non proverebbe
    // nulla. Cio' che varia davvero e' l'attributo nativo, ed e' anche l'unica
    // cosa che si romperebbe se lo spread delle props sparisse.
    const enabled = renderToStaticMarkup(<Input />)
    const disabled = renderToStaticMarkup(<Input disabled />)
    expect(disabled).toMatch(/<input[^>]*\sdisabled(=""|[\s>])/)
    expect(enabled).not.toMatch(/<input[^>]*\sdisabled(=""|[\s>])/)
  })
})

describe('Textarea', () => {
  it('renders a native textarea wearing the same clothes as Input', () => {
    const html = renderToStaticMarkup(<Textarea rows={3} />)
    expect(html).toMatch(/^<textarea /)
    expect(html).toContain('bg-popover')
    expect(html).toContain('border-border')
  })
})

describe('Select', () => {
  it('renders a native select wearing the same clothes as Input', () => {
    const html = renderToStaticMarkup(<Select><option value="a">A</option></Select>)
    expect(html).toMatch(/^<select /)
    expect(html).toContain('bg-popover')
    expect(html).toContain('<option value="a">A</option>')
  })
})
