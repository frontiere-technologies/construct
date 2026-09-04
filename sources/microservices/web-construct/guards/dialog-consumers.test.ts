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
 *
 * Non e' un tokenizzatore e non finge di esserlo. La seconda ri-revisione ha
 * fatto notare che una `//` dentro una stringa veniva mangiata insieme al resto
 * della riga — `xmlns="http://..."` troncava Login.tsx a meta' — e che
 * l'effetto e' SEMPRE nascondere, mai inventare. La terza ha fatto notare che il
 * lookbehind sui soli due punti non bastava: un URL senza schema
 * (`"//cdn.example.com/x"`) e qualunque stringa che contenga `//` restavano
 * troncati. Ora il lookbehind esclude anche apice, virgoletta e backtick, che
 * coprono l'inizio di un letterale di stringa.
 *
 * RESTA FUORI, dichiarato invece di essere inseguito: un `//` in mezzo a una
 * stringa preceduto da un carattere qualunque (`"a//b"`), e un letterale di
 * espressione regolare che contenga `//`. In entrambi i casi si perde il resto
 * di QUELLA riga, quindi al massimo sfugge una chiamata scritta dopo, sulla
 * stessa riga. Risolverlo per davvero vuole un parser, sproporzionato per una
 * guardia di questo peso.
 */
export function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<![:"'`])\/\/.*$/gm, '')
}

/**
 * Le tre finestre del browser che questo progetto non usa piu'. Fino al
 * 2026-09-02 la conferma di eliminazione passava da `confirm()` nativo: non
 * esercitabile da un test end-to-end senza aggiramenti, fuori dal tema, e senza
 * la trappola del focus che `AccessibleDialog` garantisce. Sostituirla non
 * bastava a impedirne il ritorno — la guardia sui consumatori di dialog
 * verifica chi *promette* un modale, e un `confirm()` nativo non promette
 * niente, quindi le passava sotto il naso.
 *
 * Tre forme, non una, perche' la ri-revisione ha provato a batterla e ci e'
 * riuscita:
 *  - la chiamata, nuda o preceduta da `window.` / `globalThis.` / `self.` /
 *    `top.` / `parent.` / `frames.`, con o senza `?.` davanti al nome E con o
 *    senza `?.` davanti alla parentesi — la terza ri-revisione ha fatto notare
 *    che `window?.confirm(x)` era fissato come preso mentre `confirm?.(x)`
 *    nudo sfuggiva, un'incoerenza fra cio' che il test dichiarava e cio' che la
 *    regex faceva;
 *  - l'accesso a parentesi quadre, `window["confirm"](...)`;
 *  - il solo RIFERIMENTO al membro, `const ask = window.confirm`, che e' la
 *    sorgente di ogni alias e si prende senza inseguire la variabile.
 * RESTA FUORI, dichiarato: una destrutturazione RINOMINATA
 * (`const { confirm: ask } = window`), `Reflect.get(window, 'confirm')`,
 * `document.defaultView.confirm`, e un nome COMPOSTO a runtime
 * (`window['con' + 'firm']`). Nessuna di queste e' una scrittura che capita per
 * distrazione, ed e' quello che questa guardia serve a impedire: il ritorno
 * involontario di un `confirm()` nativo, non l'aggiramento deliberato di chi ha
 * letto la guardia e ha deciso di girarci intorno.
 */
export function callsNativeDialog(source: string): boolean {
  const clean = withoutComments(source)
  const native = 'alert|confirm|prompt'
  const host = 'window|globalThis|self|top|parent|frames'
  return (
    // chiamata nuda o su un alias della finestra, con `?.` ammesso su entrambi i lati
    new RegExp(`(?:^|[^.\\w]|(?:${host})\\??\\.)(?:${native})\\s*(?:\\?\\.)?\\s*\\(`).test(clean)
    // accesso a parentesi quadre, poi chiamato
    || new RegExp(`\\[\\s*['"](?:${native})['"]\\s*\\]\\s*(?:\\?\\.)?\\s*\\(`).test(clean)
    // riferimento al membro senza chiamarlo: la sorgente degli alias, anche a parentesi quadre
    || new RegExp(`(?:${host})\\??\\.\\s*(?:${native})\\b`).test(clean)
    || new RegExp(`(?:${host})\\s*\\[\\s*['"](?:${native})['"]\\s*\\]`).test(clean)
  )
}

export function importsAccessibleDialog(source: string): boolean {
  return /import \{ AccessibleDialog \} from ['"]@\/components\/shared\/AccessibleDialog['"]/.test(source)
}

/** Un consumatore che gestisce uno stato occupato deve marcare i suoi controlli di chiusura. */
export function passesBusyState(source: string): boolean {
  return /busy=/.test(source)
}

function sourceFiles(root: string, extensions: string[] = ['.tsx']): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFiles(path, extensions)
    if (!entry.isFile()) return []
    return extensions.some(extension => path.endsWith(extension)) ? [path] : []
  })
}

/**
 * I file di test sono esclusi: un test che verifica il markup del componente
 * condiviso deve necessariamente citare `[role="dialog"]` in un selettore, e
 * quella citazione non e' un modale scritto a mano.
 */
function allComponents(): string[] {
  return SOURCE_ROOTS
    // `flatMap(sourceFiles)` passerebbe anche l'indice, che da quando sourceFiles
    // accetta un elenco di estensioni finirebbe la' dentro come numero.
    .flatMap(root => sourceFiles(root))
    .map(path => relative(process.cwd(), path))
    .filter(path => !path.includes('.test.'))
    .sort()
}

const components = allComponents().map(file => ({ file, source: readFileSync(file, 'utf8') }))

/**
 * Il divieto sui dialoghi nativi guarda PIU' LARGO dei controlli sui modali.
 *
 * Quelli si limitano a `app/` e `components/` in `.tsx` a ragione: un modale
 * scritto a mano vive nel JSX. Un `confirm()` no — sta bene in un `.ts` di
 * supporto lato client (`components/grid/grid-reset.ts`,
 * `components/rbac/users/users-datasource.ts`) o in un modulo di `lib/`, e la
 * ri-revisione ha fatto notare che quei file passavano indenni proprio davanti
 * alla guardia scritta per impedire un ritorno. Una guardia che copre solo dove
 * il difetto e' stato la volta scorsa non e' una guardia, e' un ricordo.
 */
const NATIVE_DIALOG_ROOTS = ['app', 'components', 'context', 'lib']

function everyModule(): string[] {
  return NATIVE_DIALOG_ROOTS
    .flatMap(root => sourceFiles(root, ['.ts', '.tsx']))
    .map(path => relative(process.cwd(), path))
    .filter(path => !path.includes('.test.'))
    .sort()
}

const modules = everyModule().map(file => ({ file, source: readFileSync(file, 'utf8') }))
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

  it('catches the forms the third re-review used to defeat it', () => {
    expect(callsNativeDialog('confirm?.("x")')).toBe(true)
    expect(callsNativeDialog('top.confirm(message)')).toBe(true)
    expect(callsNativeDialog('parent.alert("x")')).toBe(true)
    expect(callsNativeDialog('frames.prompt("who?")')).toBe(true)
    expect(callsNativeDialog("const ask = window['confirm']")).toBe(true)
    expect(callsNativeDialog('window["confirm"]?.("x")')).toBe(true)
  })

  it('does not lose a call written after a schemeless URL or any string holding //', () => {
    // Il lookbehind sui soli due punti non copriva questi: una stringa che
    // comincia con `//` non ha lo schema davanti.
    expect(callsNativeDialog('const cdn = "//cdn.example.com/x"; confirm("x")')).toBe(true)
    expect(callsNativeDialog("const cdn = '//cdn/x'; alert(cdn)")).toBe(true)
  })

  it('catches the forms the second re-review used to defeat it', () => {
    expect(callsNativeDialog('globalThis.confirm(message)')).toBe(true)
    expect(callsNativeDialog('self.alert("x")')).toBe(true)
    expect(callsNativeDialog('window?.confirm(message)')).toBe(true)
    expect(callsNativeDialog('window["confirm"](message)')).toBe(true)
    expect(callsNativeDialog("window['prompt']('who?')")).toBe(true)
    // L'alias si prende alla SORGENTE: il riferimento al membro, non la chiamata.
    expect(callsNativeDialog('const ask = window.confirm')).toBe(true)
    expect(callsNativeDialog('const { confirm } = window; if (confirm(x)) go()')).toBe(true)
  })

  it('does not lose a call written after a URL on the same line', () => {
    // La sottrazione dei commenti mangiava dalla prima `//` a fine riga, URL
    // compresi: `xmlns="http://..."` troncava il resto e con esso una chiamata.
    expect(callsNativeDialog('const u = "http://x/y"; alert(u)')).toBe(true)
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
  it('sweeps every root and both extensions, not one aggregate count', () => {
    // Stessa ragione della riga gemella sui consumatori di dialog: se la
    // camminata si rompesse, il controllo sotto riuscirebbe sull'insieme vuoto.
    //
    // Per RADICE e per ESTENSIONE, non con una disuguaglianza sola: la terza
    // ri-revisione ha fatto notare che `modules.length > components.length`
    // restava vera anche se `.tsx` fosse sparito dall'elenco delle estensioni
    // (102 > 75), e che una radice piccola come `context/` (3 file) poteva
    // cadere senza che nessuno se ne accorgesse. Un'asserzione che regge
    // mentre metà del perimetro svanisce e' un falso verde travestito.
    for (const root of NATIVE_DIALOG_ROOTS) {
      expect(modules.some(({ file }) => file.startsWith(`${root}/`)), `nessun file sotto ${root}/`).toBe(true)
    }
    expect(modules.some(({ file }) => file.endsWith('.ts') && !file.endsWith('.tsx'))).toBe(true)
    expect(modules.some(({ file }) => file.endsWith('.tsx'))).toBe(true)
    expect(modules.length).toBeGreaterThan(components.length)
  })

  it('has no module calling confirm, alert or prompt', () => {
    const offenders = modules
      .filter(({ source }) => callsNativeDialog(source))
      .map(({ file }) => file)

    expect(offenders).toEqual([])
  })
})
