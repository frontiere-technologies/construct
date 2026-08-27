import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

test('i18n events are documented as best-effort diagnostics, not a durable audit system', () => {
  const contract = [
    read('sources/microservices/web-construct/lib/i18n/audit.ts'),
    read('docs/superpowers/specs/2026-07-28-i18n-system-design.md'),
  ].join('\n')
  assert.doesNotMatch(contract, /audit trail|durable audit trail|append-only audit/i)
  assert.match(contract, /best-effort diagnostic/i)
  assert.match(contract, /retention/i)
  assert.match(contract, /redact/i)
})

test('operations documentation assigns backup, restore, and log retention responsibilities', () => {
  const deployment = read('docs/runbooks/production-deployment.md')
  const recovery = read('docs/runbooks/legacy-rbac-recovery.md')
  for (const phrase of ['backup', 'restore', 'retention', 'rollback']) {
    assert.match(`${deployment}\n${recovery}`, new RegExp(phrase, 'i'))
  }
  assert.match(recovery, /pg_dump/)
  assert.match(recovery, /user_role/)
})

test('local Docker Compose runs only the web app against external Supabase', () => {
  const compose = read('compose.yaml')
  const gitignore = read('.gitignore')
  const readme = read('README.md')

  assert.match(compose, /^services:\n  web:/m)
  assert.doesNotMatch(compose, /^  (db|postgres|supabase):/m)
  assert.match(compose, /sources\/microservices\/web-construct\/\.env\.docker\.local/)
  assert.match(compose, /3000:3000/)
  assert.match(compose, /api\/health\/ready/)
  assert.doesNotMatch(compose, /MIGRATION_DATABASE_URL/)
  assert.match(gitignore, /sources\/microservices\/web-construct\/\.env\.docker\.local/)
  assert.match(readme, /Local Docker with Supabase/)
  assert.match(readme, /docker compose up --build -d/)
  assert.match(readme, /Supavisor/)
  assert.match(readme, /MIGRATION_DATABASE_URL/)
})

/**
 * Che AGENTS.md sia vero.
 *
 * `sources/microservices/web-construct/AGENTS.md` si apre dicendo che una
 * convenzione vale solo se e' scritta **e** difesa da un cricchetto. A sé stesso
 * non applicava la regola, e si vedeva: la revisione del 2026-08-27 ci ha
 * trovato cinque affermazioni false, fra cui un `UserContext` citato come
 * esempio che in tutto il repository esisteva solo in quella riga. Era gia' la
 * seconda revisione di fila a trovarne (vedi GAP-8 in
 * docs/reviews/2026-08-26-convention-enforcement-gaps.md).
 *
 * Le due asserzioni qui sotto chiudono una *categoria* invece di un caso: ogni
 * percorso e ogni simbolo che il documento cita fra backtick deve esistere.
 * Non provano che il documento dica il vero su tutto — nessun controllo
 * meccanico puo' — ma tolgono di mezzo la specie di errore che si accumula da
 * sola, cioe' il riferimento che sopravvive a un rinomino.
 */

const AGENTS_MD = 'sources/microservices/web-construct/AGENTS.md'
const MICROSERVICE = 'sources/microservices/web-construct'

/** I nomi che il documento usa come *forma* o come contro-esempio, non come riferimento. */
const NOT_REFERENCES = new Set([
  // Segnaposto di convenzione: `onX`, `handleX`, il casing per nome.
  'PascalCase', 'camelCase', 'usePascalCase', 'UPPER_SNAKE_CASE', 'handleX', 'onX',
  // Esempi di forma per le regole su booleani, callback e setter.
  'isLoading', 'hasPermission', 'canSubmit', 'shouldRefresh',
  'onChange', 'onOpenChange', 'handleSubmit', 'setOpen',
  // Citati per dire di NON usarli: `Dto` e non `DTO`, `Url` e non `URL`.
  'DTO', 'URL',
  // L'API del Select di Radix, citata per spiegare cosa significa il nome
  // `Select` in una cartella shadcn. Qui non c'e' apposta: e' il motivo per cui
  // il segnaposto omonimo e' stato rimosso.
  'SelectTrigger', 'SelectContent', 'SelectItem',
  // Il nome che *andrebbe* usato per un `<select>` nativo vestito, se servisse.
  // Una proposta, non un riferimento.
  'NativeSelect',
])

function backtickTokens() {
  return [...new Set(read(AGENTS_MD).match(/`[^`\n]+`/g).map(token => token.slice(1, -1)))]
}

test('every path AGENTS.md cites in backticks exists on disk', () => {
  const missing = backtickTokens()
    .filter(token => token.includes('/') && !token.includes('*') && !token.includes(' '))
    // `@/`, `./` e `../` da soli sono frammenti di sintassi, non percorsi.
    .filter(token => !['@/', './', '../'].includes(token))
    .map(token => token.replace(/:\d+$/, ''))
    .filter(token => /\.\w+$/.test(token) || token.endsWith('/'))
    .filter(token => {
      // Un percorso `./` o `../` parte dal microservizio. Gli altri possono
      // stare nel microservizio, sotto `components/` (il documento cita `ui/` e
      // `shared/` col nome corto) o alla radice del repository — che e' il caso
      // di `.github/workflows/quality.yml` e `sources/devops/`, entrambi con un
      // punto o una cartella iniziale che non li rende relativi.
      const candidates = token.startsWith('./') || token.startsWith('../')
        ? [resolve(root, MICROSERVICE, token)]
        : [
            resolve(root, MICROSERVICE, token),
            resolve(root, MICROSERVICE, 'components', token),
            resolve(root, token),
          ]
      return !candidates.some(path => existsSync(path))
    })

  assert.deepEqual(missing, [], 'AGENTS.md cita percorsi che non esistono: sono stati rinominati o cancellati.')
})

test('every symbol AGENTS.md cites in backticks resolves in the source', () => {
  const isSymbol = token =>
    /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(token)
    || (/^[A-Za-z][A-Za-z0-9]*$/.test(token) && (/[a-z][A-Z0-9]/.test(token) || /^[A-Z].*[A-Z]/.test(token)))

  const sources = ['app', 'components', 'context', 'guards', 'lib', 'types']
    .flatMap(dir => sourceFilesUnder(resolve(root, MICROSERVICE, dir)))
    .map(path => readFileSync(path, 'utf8'))
    .join('\n')
  const declared = new Set(sources.match(/[A-Za-z_][A-Za-z0-9_]*/g))

  const dangling = backtickTokens()
    .filter(isSymbol)
    .filter(token => !NOT_REFERENCES.has(token))
    .filter(token => !declared.has(token))

  assert.deepEqual(dangling, [], [
    'AGENTS.md cita simboli che non esistono nel sorgente.',
    'Se il nome e\' un esempio di forma e non un riferimento, aggiungilo a NOT_REFERENCES qui sopra.',
  ].join('\n'))
})

function sourceFilesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFilesUnder(path)
    return entry.isFile() && /\.tsx?$/.test(path) ? [path] : []
  })
}
