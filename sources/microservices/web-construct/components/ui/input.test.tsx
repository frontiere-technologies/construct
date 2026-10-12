import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Input, inputBaseClasses } from './input'
import { Textarea } from './textarea'

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

// Quasi tutti i campi dell'app sono dati di amministrazione (nomi di ruoli, funzionalità, chiavi
// di traduzione): un gestore di password che ci propone il riempimento è solo d'intralcio. Il
// riempimento è spento per default e si riaccende dichiarando che cosa contiene il campo — che è
// anche ciò che chiede WCAG 1.3.5 per i dati personali dell'utente.
describe('Input and password managers', () => {
  const markers = ['data-bwignore', 'data-1p-ignore', 'data-lpignore']

  it('keeps an undeclared field out of autofill', () => {
    const html = renderToStaticMarkup(<Input placeholder="Nome ruolo" />)
    expect(html).toMatch(/autocomplete="off"/i)
    for (const marker of markers) expect(html, `manca ${marker}`).toContain(marker)
  })

  it('lets a field that declares its purpose be filled', () => {
    const html = renderToStaticMarkup(<Input type="password" autoComplete="current-password" />)
    expect(html).toMatch(/autocomplete="current-password"/i)
    for (const marker of markers) expect(html, `${marker} su un campo di accesso`).not.toContain(marker)
  })

  it('treats an explicit off like an undeclared field', () => {
    const html = renderToStaticMarkup(<Input autoComplete="off" />)
    expect(html).toMatch(/autocomplete="off"/i)
    for (const marker of markers) expect(html, `manca ${marker}`).toContain(marker)
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
