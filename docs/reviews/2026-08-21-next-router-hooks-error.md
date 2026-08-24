# Diagnosi — `Rendered more hooks than during the previous render` su `/embedded/[itemId]` (2026-08-21)

Scope: individuare l'origine di un errore React che compariva nel log del server durante la suite
E2E, senza far fallire alcun test. Nessuna modifica applicata al codice dell'applicazione.

Versioni al momento dell'indagine: **Next 16.2.12**, **React e React-DOM 19.2.7**.

## Sommario

L'errore **non è nel codice di questo progetto.** Lo stack lo attribuisce al primo `useMemo` del
componente `Router` di Next, cioè al client dell'App Router (`next/dist/client/…/app-router`).
Sopra quel frame non compare nessun componente dell'applicazione.

È un difetto noto a monte, con più segnalazioni aperte, e gli inneschi documentati sono
`redirect()` di `next/navigation`, `router.replace()` e `router.refresh()`. Nel nostro caso è il
primo: la guardia RBAC in `app/(protected)/embedded/[itemId]/page.tsx`, che fa `redirect('/')`
quando l'utente non ha accesso alla voce di menu.

**Impatto oggi: nessuno visibile.** React si riprende, il reindirizzamento arriva a destinazione e
il test che lo verifica passa. La guardia RBAC funziona correttamente.

**Raccomandazione: non intervenire.** Non c'è nulla da correggere nel nostro codice, e l'unico
aggiramento noto — sostituire `redirect()` con `notFound()` o spostare la guardia nel middleware —
scambierebbe un difetto altrui con una semantica peggiore per l'utente.

## Task

- [ ] ID=NEXT-1, Severity=Info, Complexity=Low, Priority=P3, Title=Riverificare a ogni aggiornamento di Next, Fix description=Dopo un aggiornamento di Next, rieseguire `uv run pytest sources/tests/e2e/test_embedded.py` e cercare `more hooks` nel log del server. Se non compare più, il difetto a monte è risolto e questo documento si può chiudere. Il metodo di cattura è descritto sotto.
- [ ] ID=NEXT-2, Severity=Info, Complexity=Medium, Priority=P3, Title=Aggirare solo se diventa visibile all'utente, Fix description=**Condizionale, da non fare in via preventiva.** Se l'errore dovesse manifestarsi come pagina di errore invece di essere assorbito, sostituire il `redirect('/')` del server component con `notFound()`, oppure spostare il controllo di autorizzazione nel middleware. Entrambe le strade attraversano codice diverso di Next, ma peggiorano il messaggio che l'utente riceve, quindi vanno adottate solo a fronte di un danno reale.

---

## L'evidenza

### Lo stack

Catturato durante un'esecuzione reale di `test_embedded.py`:

```
window.error @ /embedded/275 :: Uncaught Error: Rendered more hooks than during the previous render.
Error: Rendered more hooks than during the previous render.
    at updateWorkInProgressHook  (react-dom)
    at updateMemo                (react-dom)
    at Object.useMemo            (react-dom)
    at exports.useMemo           (react)
    at Router                    (next/dist/client/…)
    at react_stack_bottom_frame  (react-dom)
    at renderWithHooks           (react-dom)
    …
```

Il frame più alto che non appartenga a React o a Next è **assente**: fra `renderWithHooks` e
l'errore c'è solo `Router`, il componente client dell'App Router.

### Quale dei tre test lo scatena

Il probe ha registrato l'errore su `/embedded/275` in un contesto browser **terminato su `/`**.
Fra i tre test del file, uno solo percorre quella coppia di URL:

| Test | URL finale del contesto | Messaggi catturati |
|---|---|---|
| `renders_iframe_when_allowed` | `/embedded/274` | 0 |
| `redirects_when_not_authorized` | `/` (dopo `/embedded/275`) | **1, l'errore** |
| `shows_fallback_when_private_target_is_blocked` | `/embedded/276` | 0 |

`redirects_when_not_authorized` apre la pagina con un utente privo del ruolo, e il server component
risponde con `redirect('/')`. È esattamente l'innesco che le segnalazioni a monte descrivono.

### Perché il codice dell'applicazione è escluso

Due verifiche indipendenti:

1. **Statica.** Una ricerca su tutto `app/`, `components/` e `context/` non trova **nessun** hook
   indentato oltre il livello del corpo del componente: non esistono hook dentro `if`, cicli o
   funzioni annidate. La causa più comune di questo errore è quindi esclusa per costruzione.
2. **Puntuale.** I due componenti sospettabili a colpo d'occhio sono puliti. `EmbeddedFrame` ha due
   hook, entrambi incondizionati e prima di qualunque `return`. La `Sidebar` ne ha molti ma tutti in
   testa al corpo, nessuno in un `.map()`.

---

## Come è stato catturato, e perché ci sono voluti diversi tentativi

Questa sezione esiste perché tre approcci ragionevoli hanno fallito, e il prossimo che indaga un
errore transitorio del browser in questa suite può risparmiarseli.

### Cosa non ha funzionato

**Il log del server non basta.** Next in sviluppo inoltra la console del browser al proprio stdout,
ed è così che l'errore era stato notato — ma inoltra **solo la prima riga**, quindi il messaggio
senza lo stack. Sapere che l'errore esiste non dice dove.

**Riprodurlo a mano non riesce.** Uno script che rifà passo per passo ciò che fa la fixture — crea
ruolo e voce, concede, assegna, apre un contesto nuovo, autentica, espande la sidebar, apre la voce
— non ha prodotto l'errore in **cinque** tentativi consecutivi. Il caso che lo scatena non è quello
"buono" ma quello del reindirizzamento, che quello script non percorreva.

**Cercare hook condizionali con una regex è inutile.** Un primo scanner che segnalava "hook dopo un
`return`" ha prodotto solo falsi positivi: riconosceva la fine di una funzione e l'inizio della
successiva. La versione utile è stata la seconda, che cerca hook con indentazione maggiore di quella
del corpo del componente — e restituisce zero risultati, che è l'informazione che serviva.

### Cosa ha funzionato

Un intercettatore installato con `add_init_script` su ogni contesto creato dalla suite, agganciato
temporaneamente in `conftest.py` avvolgendo `browser.new_context`.

**Il dettaglio che decide, e che al primo tentativo mi è costato un'esecuzione a vuoto:** uno script
di init **viene rieseguito in un contesto JavaScript nuovo a ogni navigazione**. Accumulare i
messaggi in `window.__caught` significa azzerarli esattamente quando la pagina interessante finisce
di caricare — il primo tentativo ha riportato "0 messaggi" per tutti e nove i contesti, comprese
pagine che avevano sicuramente prodotto degli avvisi. La versione che funziona accumula in
`sessionStorage`, che sopravvive alle navigazioni sulla stessa origine:

```js
const KEY = '__caught';
const push = entry => {
  const all = JSON.parse(sessionStorage.getItem(KEY) || '[]');
  all.push(entry.slice(0, 4000));
  sessionStorage.setItem(KEY, JSON.stringify(all));
};
for (const level of ['error', 'warn']) {
  const orig = console[level];
  console[level] = (...args) => { push(level + ' @ ' + location.pathname + ' :: ' + args.join(' | ')); return orig(...args) };
}
window.addEventListener('error', e => push(
  'window.error @ ' + location.pathname + ' :: ' + e.message + '\n' + ((e.error && e.error.stack) || '')));
```

I messaggi vanno letti **prima della chiusura del contesto**, agganciandosi a `context.close()`, e
scritti su file: a contesto chiuso non c'è più niente da interrogare.

La strumentazione era temporanea e `conftest.py` è stato ripristinato: `git diff` sul file è vuoto.

### Un depistaggio da conoscere

Nella stessa console compare un avviso giallo su `/logo.svg` — *"was preloaded using link preload
but not used…"* e *"detected as the Largest Contentful Paint"*. Non c'entra nulla: lo stack porta a
`warn-once.ts` e `get-img-props.ts`, cioè agli helper di avviso di Next, non al percorso degli
errori di React. Quello da cercare è **rosso** e dice testualmente `Rendered more hooks than during
the previous render`.

---

## Segnalazioni a monte

Tutte descrivono lo stesso punto — il primo `useMemo` di `app-router` — con inneschi diversi:

- [vercel/next.js#63121](https://github.com/vercel/next.js/issues/63121)
- [vercel/next.js#78396](https://github.com/vercel/next.js/issues/78396)
- [vercel/next.js discussion #59493](https://github.com/vercel/next.js/discussions/59493)
- [react/react#33556](https://github.com/react/react/issues/33556) — il caso React sottostante: due
  sospensioni distinte nello stesso percorso di render fanno divergere il conteggio degli hook fra
  il tentativo interrotto e quello ripreso. Spiega perché l'errore è intermittente e perché
  l'applicazione si riprende.
