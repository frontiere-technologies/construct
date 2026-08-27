#!/usr/bin/env node
/**
 * Quanto le primitive di `components/ui/` si sono allontanate dallo stock shadcn.
 *
 * **Non e' un cricchetto, e non va agganciato a `quality.yml`.** shadcn non e'
 * una libreria: e' un registry di codice che copi e possiedi, senza versione e
 * senza percorso di aggiornamento, per scelta di progettazione. Pretendere
 * fedelta' allo stock in CI vorrebbe dire disfare divergenze che questo
 * progetto ha deciso e che due guardie AST sorvegliano — vedi il commento in
 * testa a `components/ui/button.tsx`.
 *
 * Serve in un momento preciso: **quando stai per aggiornare React, Radix o
 * Tailwind**, o prima di rilanciare `npx shadcn add` su una primitiva che hai
 * gia' adattato. La domanda a cui risponde non e' «sono uguale?» ma «cosa ha
 * cambiato il fornitore da quando ho copiato?», che e' l'unica cosa che il
 * modello copia-e-possiedi non ti dice da solo.
 *
 *   node sources/devops/shadcn-drift.mjs            # riepilogo
 *   node sources/devops/shadcn-drift.mjs --diff     # anche il diff riga per riga
 *
 * Richiede rete: legge il registry pubblico su ui.shadcn.com. Se sei offline
 * lo dice e si ferma, senza fallire nulla d'altro.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const MICROSERVICE = join(ROOT, 'sources/microservices/web-construct')
const WANT_DIFF = process.argv.includes('--diff')

/** Lo stile e l'indirizzo delle primitive vengono da components.json, non da qui. */
function shadcnConfig() {
  const config = JSON.parse(readFileSync(join(MICROSERVICE, 'components.json'), 'utf8'))
  const alias = config.aliases?.ui ?? '@/components/ui'
  return { style: config.style ?? 'new-york', uiDir: join(MICROSERVICE, alias.replace(/^@\//, '')) }
}

/**
 * Le primitive, non la loro coda: un `.test.tsx` e un `.types.tsx` appartengono
 * alla primitiva ma non hanno una controparte nel registry.
 */
function localPrimitives(uiDir) {
  return readdirSync(uiDir)
    .filter(name => name.endsWith('.tsx') || name.endsWith('.ts'))
    .filter(name => !/\.(test|types)\./.test(name))
    .map(name => ({ name: name.replace(/\.tsx?$/, ''), path: join(uiDir, name) }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchStock(style, name) {
  const url = `https://ui.shadcn.com/r/styles/${style}/${name}.json`
  const response = await fetch(url)
  if (response.status === 404) return { absent: true }
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`)
  const entry = await response.json()
  const file = entry.files?.[0]
  const content = typeof file === 'string' ? file : file?.content
  if (!content) throw new Error(`${url} -> nessun contenuto nella voce del registry`)
  return { content }
}

/**
 * Righe di codice in comune, ignorando spazi e commenti.
 *
 * E' la misura che conta piu' del conteggio dei byte: due file possono
 * differire su ogni riga di prosa e restare lo stesso componente, oppure
 * condividere solo le graffe — che e' il caso di `button.tsx`, dove le 12
 * righe in comune sono tutte punteggiatura.
 */
function codeLines(source) {
  return source
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/*'))
}

function overlap(stock, local) {
  // Righe *distinte*: contare `}` e `)` una volta per occorrenza gonfierebbe la
  // sovrapposizione con pura punteggiatura. Su button.tsx la differenza fra le
  // due misure e' 19 contro 12, e la seconda e' quella vera.
  const stockLines = new Set(codeLines(stock))
  const localLines = new Set(codeLines(local))
  const shared = [...stockLines].filter(line => localLines.has(line))
  return { stock: stockLines.size, local: localLines.size, shared: shared.length }
}

function unifiedDiff(stock, local, name) {
  const dir = mkdtempSync(join(tmpdir(), 'shadcn-drift-'))
  try {
    const stockPath = join(dir, `${name}.stock.tsx`)
    writeFileSync(stockPath, stock)
    // `git diff --no-index` esce con 1 quando i file differiscono: qui e' il
    // caso normale, non un errore, quindi l'uscita non va trattata come tale.
    return execFileSync('git', ['diff', '--no-index', '--', stockPath, local], { encoding: 'utf8' })
  } catch (error) {
    return error.stdout ?? `(diff non disponibile: ${error.message})`
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const { style, uiDir } = shadcnConfig()
const primitives = localPrimitives(uiDir)

console.log(`stile: ${style}   primitive locali: ${primitives.length}   registry: ui.shadcn.com\n`)

let reachable = true
for (const { name, path } of primitives) {
  const local = readFileSync(path, 'utf8')
  let stock
  try {
    stock = await fetchStock(style, name)
  } catch (error) {
    if (/fetch failed|ENOTFOUND|ETIMEDOUT/.test(String(error))) { reachable = false; break }
    console.log(`${name.padEnd(12)} errore: ${error.message}`)
    continue
  }

  if (stock.absent) {
    console.log(`${name.padEnd(12)} nessuno stock con questo nome — scritta a mano, niente da confrontare`)
    continue
  }

  const { stock: stockCount, local: localCount, shared } = overlap(stock.content, local)
  const percent = stockCount === 0 ? 0 : Math.round((shared / stockCount) * 100)
  console.log(`${name.padEnd(12)} stock ${String(stockCount).padStart(3)} righe, locale ${String(localCount).padStart(3)}, in comune ${String(shared).padStart(3)} (${percent}%)`)

  if (WANT_DIFF) console.log(unifiedDiff(stock.content, path, name))
}

if (!reachable) {
  console.log('registry non raggiungibile: serve rete per leggere ui.shadcn.com. Niente da concludere.')
  process.exit(0)
}

console.log([
  '',
  'Una percentuale bassa non e\' un difetto: e\' il modello copia-e-possiedi che',
  'funziona. Serve per sapere COSA il fornitore ha cambiato prima di riprendere',
  'una primitiva, non per tornare uguali allo stock.',
].join('\n'))
