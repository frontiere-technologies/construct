import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button, buttonVariants } from './button'

describe('Button', () => {
  it('renders a real button element by default', () => {
    const html = renderToStaticMarkup(<Button>Salva</Button>)
    expect(html).toMatch(/^<button /)
    expect(html).toContain('Salva')
  })

  it('paints the primary action with the theme token, not a fixed grey', () => {
    // Sedici dei diciannove bottoni di conferma usavano bg-gray-900, che il
    // pannello Admin -> Tema non puo' cambiare. E' la ragione per cui UI-1
    // esiste: non era incoerenza estetica, era una funzione di prodotto rotta.
    const html = renderToStaticMarkup(<Button>Salva</Button>)
    expect(html).toContain('bg-primary')
    expect(html).toContain('text-primary-foreground')
    expect(html).not.toContain('bg-gray-900')
  })

  it('gives the secondary action the same horizontal padding as the primary', () => {
    // BTN-3: tredici secondari usavano px-3 e tre px-4, quindi accanto a un
    // primario px-4 il secondario era piu' stretto e nessuno l'aveva deciso.
    const primary = renderToStaticMarkup(<Button>Salva</Button>)
    const secondary = renderToStaticMarkup(<Button variant="outline">Annulla</Button>)
    expect(primary).toContain('px-4')
    expect(secondary).toContain('px-4')
  })

  it('guards every hover with the enabled state', () => {
    // Un bottone disabilitato non deve reagire al passaggio del mouse. Qui
    // l'invariante e' garantito per costruzione, una volta, invece che
    // ricontrollato su ogni punto d'uso.
    for (const variant of ['default', 'outline', 'ghost', 'destructive', 'link'] as const) {
      const classes = buttonVariants({ variant })
      const unguarded = classes.match(/(?<!enabled:)hover:[\w-]+/g) ?? []
      expect(unguarded, `variante ${variant}`).toEqual([])
    }
  })

  it('leaves the disabled treatment to the global rule instead of stacking on it', () => {
    // globals.css applica gia' filter: opacity(0.6) e cursor: not-allowed a ogni
    // button:disabled. Una disabled:opacity-40 qui si moltiplicherebbe con
    // quella, rendendo 0.24 — che non e' nessuno dei valori scritti nei call
    // site, ed e' esattamente l'osservazione di BTN-4.
    const html = renderToStaticMarkup(<Button disabled>Salva</Button>)
    expect(html).not.toMatch(/disabled:opacity-\d+/)
    expect(html).not.toContain('disabled:cursor-not-allowed')
  })

  it('keeps a disabled button hit-testable so the not-allowed cursor is visible', () => {
    // La classe che shadcn spedisce di serie e' disabled:pointer-events-none, e
    // contraddice l'asserzione che buttonInteractionStyles.test.ts fa gia' su
    // globals.css: senza hit-testing il cursore not-allowed non si vede mai.
    const html = renderToStaticMarkup(<Button disabled>Salva</Button>)
    expect(html).not.toContain('pointer-events-none')
  })

  it('lets a call site override a variant utility instead of stacking against it', () => {
    const html = renderToStaticMarkup(<Button className="px-2">Salva</Button>)
    expect(html).toContain('px-2')
    expect(html).not.toMatch(/class="[^"]*px-4/)
  })

  it('renders the child element when asChild is set, keeping the variant classes', () => {
    // Verifica la composizione asChild/Slot, non una vera rotta: <Link> non
    // c'entra qui, il child e' un <a> qualsiasi passato dal chiamante.
    const html = renderToStaticMarkup(
      // eslint-disable-next-line @next/next/no-html-link-for-pages
      <Button asChild variant="link"><a href="/roles">Ruoli</a></Button>
    )
    expect(html).toMatch(/^<a /)
    expect(html).toContain('href="/roles"')
    expect(html).toContain('text-primary')
  })

  it('carries the accessible name through on an icon-only button', () => {
    const html = renderToStaticMarkup(
      <Button size="icon" aria-label="Rinomina ruolo"><span aria-hidden="true">x</span></Button>
    )
    expect(html).toContain('aria-label="Rinomina ruolo"')
  })
})
