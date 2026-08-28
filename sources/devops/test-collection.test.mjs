import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const REPO_ROOT = new URL('../../', import.meta.url).pathname
const ROOT = join(REPO_ROOT, 'sources/microservices/web-construct')

/**
 * Che `npm test` raccolga davvero ogni test che esiste.
 *
 * Prima del 2026-08-27 `vitest.config.ts` elencava cinque glob per cartella ed
 * estensione, e lasciava fuori `app/`, `context/` e ogni `*.test.tsx` non sotto
 * `components/`. Verificato per iniezione: due test scritti per fallire di
 * proposito, uno in `context/` e uno chiamato `.spec.ts`, non sono stati
 * raccolti da nessun runner e la suite e' rimasta verde su 80 file. Il modo in
 * cui quel cancello falliva era il peggiore possibile: in silenzio, e nella
 * direzione che fa sembrare tutto a posto.
 *
 * Perche' questo controllo sta qui e non in `guards/`, dove stanno le altre
 * guardie del microservizio: e' stato provato prima li', ed e' proprio il caso
 * in cui quella corsia non funziona. Una guardia scritta come test vitest viene
 * raccolta da `vitest.config.ts` come tutti gli altri test, quindi la stessa
 * modifica che restringe l'`include` esclude anche lei — verificato: con
 * l'`include` riportato alla forma vecchia, la guardia non gira e nessuno se ne
 * accorge. Una guardia non puo' vivere dentro la cosa che sorveglia. Da qui,
 * `node --test` la esegue comunque.
 *
 * E non legge la configurazione: chiede a vitest quali file raccoglie davvero
 * (`vitest list`) e lo confronta con quelli che ci sono su disco. Cosi' resta
 * vero comunque quel file sia scritto.
 */

const NOT_SOURCE = new Set(['node_modules', '.next', '.git', 'public', 'coverage'])

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return NOT_SOURCE.has(entry.name) ? [] : sourceFiles(path)
    if (!entry.isFile()) return []
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
  })
}

/** Le radici lette dal disco, non da un elenco scritto a mano: una cartella nuova si conta da sola. */
function sourceRoots() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !NOT_SOURCE.has(entry.name))
    .map(entry => join(ROOT, entry.name))
    .filter(dir => sourceFiles(dir).length > 0)
}

function allSourceFiles() {
  return sourceRoots().flatMap(sourceFiles).map(path => relative(ROOT, path)).sort()
}

/**
 * I file che vitest raccoglie davvero, chiesti a vitest.
 *
 * Memoizzato di proposito: far girare la raccolta costa ~2,4s, e la prima
 * stesura di questa guardia la invocava dentro un `filter`, una volta per file
 * — tre minuti per un controllo che ne vale due secondi.
 */
let collectedCache = null
function collectedFiles() {
  if (collectedCache === null) {
    const listed = execFileSync('npx', ['vitest', 'list', '--json'], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    })
    collectedCache = [...new Set(JSON.parse(listed).map(entry => relative(ROOT, entry.file)))].sort()
  }
  return collectedCache
}

test('every test file on disk is one that vitest actually collects', () => {
  const onDisk = allSourceFiles()
    .filter(path => /\.test\.tsx?$/.test(path))
    .filter(path => !path.endsWith('.integration.test.ts'))

  const collected = new Set(collectedFiles())
  const uncollected = onDisk.filter(path => !collected.has(path))

  assert.deepEqual(uncollected, [], [
    'Questi file di test esistono ma nessun runner li raccoglie: non falliscono, spariscono.',
    "Allarga l'`include` in sources/microservices/web-construct/vitest.config.ts.",
  ].join('\n'))
})

test('the unit suite is not empty, so a collection failure cannot pass as success', () => {
  // Se `vitest list` restituisse zero file — configurazione rotta, percorso
  // sbagliato — il confronto qui sopra riuscirebbe con l'insieme vuoto da
  // entrambe le parti solo se anche il disco fosse vuoto; ma un errore di
  // avvio che svuota solo il lato raccolto passerebbe inosservato. Questa
  // riga rende quel caso impossibile.
  assert.ok(collectedFiles().length > 50, 'vitest ha raccolto troppo pochi file: la raccolta e\' rotta')
})

test('no .spec file exists, because no config would collect one', () => {
  // AGENTS.md sceglie `.test` e respinge `.spec` con motivo. Il punto qui non
  // e' l'estetica: nessuno dei due config include `.spec`, quindi un file
  // scritto cosi' non fallirebbe — sparirebbe.
  const strays = allSourceFiles().filter(path => /\.spec\.tsx?$/.test(path))

  assert.deepEqual(strays, [], 'Rinominali in *.test.ts: un file .spec non viene eseguito da nessuno.')
})
