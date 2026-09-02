import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Che ogni finestra modale passi da `AccessibleDialog`.
 *
 * Fino al 2026-08-27 questa guardia elencava otto file per nome e verificava
 * quegli otto. Proteggeva i casi che c'erano il giorno in cui e' stata scritta,
 * non l'invariante: un dialog nuovo non entra in un elenco da solo, quindi la
 * guardia non lo vedeva e non lo diceva. L'elenco e' rovesciato: l'insieme dei
 * consumatori si ricava dal sorgente, e chi si costruisce un modale a mano
 * viene trovato invece di essere aspettato.
 *
 * Il confine, che era la parte da decidere: **si giudica dal contratto di
 * accessibilita', non dall'aspetto.** Un elemento che dichiara `role="dialog"`
 * o `aria-modal` promette a chi usa uno screen reader la trappola del focus,
 * la chiusura con Escape e un nome accessibile — cioe' esattamente quello che
 * `AccessibleDialog` implementa e che i suoi test coprono. Chi fa quella
 * promessa e la mantiene a mano la mantiene a meta'. I pannelli a comparsa non
 * c'entrano e non vengono toccati: `CustomSelect` e `LanguageSwitcher` sono
 * `role="listbox"`, non promettono nulla di tutto questo e stanno bene come
 * sono.
 */

const SOURCE_ROOTS = ['app', 'components']
const DIALOG_COMPONENT = 'components/shared/AccessibleDialog.tsx'

/**
 * Deroghe al controllo sul backdrop, con il motivo accanto. Nasce vuoto, e
 * questo e' il punto: `fixed inset-0` e' il segnale piu' debole dei due —
 * un overlay di caricamento o un fondale a tutto schermo lo usano
 * legittimamente senza essere modali. Quando ne arriva uno, va qui con la sua
 * riga di motivo, non spegnendo il controllo.
 */
const BACKDROP_EXEMPT: { file: string; why: string }[] = []

/** Marcatori che *promettono* un modale, e vanno mantenuti da `AccessibleDialog`. */
export function claimsToBeAModal(source: string): boolean {
  return /role="(dialog|alertdialog)"|aria-modal/.test(source)
}

/** Il fondale a tutto schermo: segnale piu' debole, controllato a parte. */
export function hasFullScreenBackdrop(source: string): boolean {
  return /fixed inset-0/.test(source)
}

/**
 * Il commento va via prima del controllo sui dialoghi nativi. Questa guardia
 * stessa, e i due file che raccontano perche' l'`alert` nativo e' stato tolto,
 * citano `alert(` nel testo: un divieto che scatta su una spiegazione invece
 * che su una chiamata insegna soltanto a non spiegare.
 */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/**
 * Le tre finestre del browser che questo progetto non usa piu'. Fino al
 * 2026-09-02 la conferma di eliminazione passava da `confirm()` nativo: non
 * esercitabile da un test end-to-end senza aggiramenti, fuori dal tema, e senza
 * la trappola del focus che `AccessibleDialog` garantisce. Sostituirla non
 * bastava a impedirne il ritorno — la guardia sui consumatori di dialog
 * verifica chi *promette* un modale, e un `confirm()` nativo non promette
 * niente, quindi le passava sotto il naso. `window.confirm(...)` e' incluso di
 * proposito: e' la stessa chiamata scritta per esteso.
 */
export function callsNativeDialog(source: string): boolean {
  return /(?:^|[^.\w]|window\.)(?:alert|confirm|prompt)\s*\(/.test(withoutComments(source))
}

export function importsAccessibleDialog(source: string): boolean {
  return /import \{ AccessibleDialog \} from ['"]@\/components\/shared\/AccessibleDialog['"]/.test(source)
}

/** Un consumatore che gestisce uno stato occupato deve marcare i suoi controlli di chiusura. */
export function passesBusyState(source: string): boolean {
  return /busy=/.test(source)
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!entry.isFile()) return []
    return path.endsWith('.tsx') ? [path] : []
  })
}

/**
 * I file di test sono esclusi: un test che verifica il markup del componente
 * condiviso deve necessariamente citare `[role="dialog"]` in un selettore, e
 * quella citazione non e' un modale scritto a mano.
 */
function allComponents(): string[] {
  return SOURCE_ROOTS
    .flatMap(sourceFiles)
    .map(path => relative(process.cwd(), path))
    .filter(path => !path.includes('.test.'))
    .sort()
}

const components = allComponents().map(file => ({ file, source: readFileSync(file, 'utf8') }))
const consumers = components.filter(({ file, source }) => file !== DIALOG_COMPONENT && importsAccessibleDialog(source))

describe('claimsToBeAModal', () => {
  it('finds the accessibility promise in any of its forms', () => {
    expect(claimsToBeAModal('<div role="dialog">')).toBe(true)
    expect(claimsToBeAModal('<div role="alertdialog">')).toBe(true)
    expect(claimsToBeAModal('<div aria-modal="true">')).toBe(true)
  })

  it('leaves a dropdown panel alone', () => {
    expect(claimsToBeAModal('<ul role="listbox"><li role="option" /></ul>')).toBe(false)
    expect(claimsToBeAModal('<div role="menu">')).toBe(false)
  })
})

describe('dialog consumers', () => {
  it('finds the consumers by reading the source, not from a list', () => {
    // Se la camminata si rompesse, ogni controllo qui sotto riuscirebbe
    // sull'insieme vuoto. Questa riga rende impossibile quel falso verde — la
    // stessa lezione della guardia sulla raccolta dei test.
    expect(components.length).toBeGreaterThan(40)
    expect(consumers.length).toBeGreaterThan(5)
  })

  it('has every consumer name its dialog with titleId', () => {
    const offenders = consumers
      .filter(({ source }) => !/<AccessibleDialog[\s\S]*?titleId=/.test(source))
      .map(({ file }) => file)

    expect(offenders).toEqual([])
  })

  it('has every consumer with a busy state mark its internal close controls', () => {
    const offenders = consumers
      .filter(({ source }) => passesBusyState(source))
      .filter(({ source }) => !source.includes('data-dialog-close'))
      .map(({ file }) => file)

    expect(offenders).toEqual([])
  })

  it('gives the Manage Roles icon-only close control an accessible name', () => {
    const source = readFileSync('components/rbac/users/ManageRolesModal.tsx', 'utf8')

    expect(source).toContain("aria-label={t('common.actions.close')}")
  })
})

describe('nobody hand-rolls a modal', () => {
  it('has no component claiming to be a dialog outside AccessibleDialog', () => {
    const offenders = components
      .filter(({ file }) => file !== DIALOG_COMPONENT)
      .filter(({ source }) => claimsToBeAModal(source))
      .map(({ file }) => file)

    expect(offenders).toEqual([])
  })

  it('has no full-screen backdrop outside AccessibleDialog, exemptions aside', () => {
    const exempt = new Set(BACKDROP_EXEMPT.map(entry => entry.file))
    const offenders = components
      .filter(({ file }) => file !== DIALOG_COMPONENT && !exempt.has(file))
      .filter(({ source }) => hasFullScreenBackdrop(source))
      .map(({ file }) => file)

    expect(offenders).toEqual([])
  })
})

describe('callsNativeDialog', () => {
  it('finds the three native dialogs, spelled bare or on window', () => {
    expect(callsNativeDialog('if (confirm(message)) remove()')).toBe(true)
    expect(callsNativeDialog('alert(e.message)')).toBe(true)
    expect(callsNativeDialog('const name = prompt("who?")')).toBe(true)
    expect(callsNativeDialog('if (window.confirm(message)) remove()')).toBe(true)
    expect(callsNativeDialog('window.alert("x")')).toBe(true)
  })

  it('does not fire on a comment that merely mentions one', () => {
    expect(callsNativeDialog('// prima era alert() nativo')).toBe(false)
    expect(callsNativeDialog('/* sostituisce confirm() con ConfirmModal */')).toBe(false)
  })

  it('leaves this project\'s own confirm vocabulary alone', () => {
    expect(callsNativeDialog('<ConfirmModal onConfirm={() => remove()} />')).toBe(false)
    expect(callsNativeDialog('confirmToggleStatus(user)')).toBe(false)
    expect(callsNativeDialog('const [confirming, setConfirming] = useState(null)')).toBe(false)
  })
})

describe('nobody reaches for a native browser dialog', () => {
  it('has no component calling confirm, alert or prompt', () => {
    const offenders = components
      .filter(({ source }) => callsNativeDialog(source))
      .map(({ file }) => file)

    expect(offenders).toEqual([])
  })
})
