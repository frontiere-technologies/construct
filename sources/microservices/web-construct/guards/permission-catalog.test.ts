import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PERMISSION_CODES } from '@/lib/rbac/permission-catalog'

/**
 * Il catalogo è il patto fra `requirePermission('x')` e il database (specifica 2026-09-01, §6.3).
 * Il verso «il sorgente chiede un codice che non esiste nel catalogo» lo chiude il tipo
 * `PermissionCode`: non compila. Questo test chiude l'altro verso: un codice nel catalogo che
 * nessuna migrazione inserisce, e che quindi nessuno potrà mai concedere — l'azione che protegge
 * resterebbe raggiungibile solo dall'Amministratore, senza un errore che lo dica.
 *
 * Il generatore di migrazioni previsto da DEC-9 non esiste (DEC-26 del piano 2026-10-12): è
 * questo test a ricordare di scrivere la migrazione a mano.
 */

const MIGRATIONS_DIR = join(process.cwd(), '..', '..', 'devops', 'db', 'migrations')

function allMigrationsText(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .map(name => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'))
    .join('\n')
}

describe('permission catalog', () => {
  it('uses flat, verb-first codes joined by dashes (DEC-3)', () => {
    const malformed = PERMISSION_CODES.filter(code => !/^[a-z]+(-[a-z]+)+$/.test(code))
    expect(malformed).toEqual([])
  })

  it('declares every code once', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length)
  })

  it('has every code inserted by some migration', () => {
    const text = allMigrationsText()
    const missing = PERMISSION_CODES.filter(code => !text.includes(`'${code}'`))
    expect(missing).toEqual([])
  })
})
