# Difetti rinviati dalla revisione dell'editor delle traduzioni a pagina

Data: 2026-09-01
Origine: revisioni per compito e revisione finale dell'intero ramo `feature/adjustments`,
che ha portato la modifica delle traduzioni da pannello laterale a pagina
([PR #75](https://github.com/frontiere-technologies/construct/pull/75)).
Progetto: [2026-09-01-translations-editor-page-design.md](../superpowers/specs/2026-09-01-translations-editor-page-design.md).
Piano: [2026-09-01-translations-editor-page.md](../superpowers/plans/2026-09-01-translations-editor-page.md).

## Sommario

Il ramo è stato consegnato con la revisione finale pulita: nessun difetto Critical o Important
aperto. Le voci qui sotto sono quelle che i revisori hanno segnalato e che si è deciso di **non**
correggere lì, ognuna con la motivazione. Non sono un elenco di cose dimenticate: sono decisioni,
e questo documento esiste perché la motivazione sopravviva alla cartella di lavoro
`.superpowers/sdd/` che le conteneva, ignorata da Git e destinata a sparire al primo
`git clean -fdx`.

Le voci sono nove. Due appartengono a una coppia che **non si separa**, e questa è
l'informazione che vale più di tutte le altre: MED-1 (il messaggio d'errore promette un ricarico
che l'interfaccia non offre) e MED-2 (`values` è inizializzato una sola volta dallo stato) vanno
affrontate insieme. Aggiungere il ricarico da solo rileggerebbe la riga dal server lasciando le
caselle di testo con i valori vecchi — chi prendesse una sola delle due introdurrebbe un difetto
peggiore di quello che chiude.

Una terza, MED-4, è **volutamente più larga di questo modulo**: il doppio invio non si corregge
solo qui. `FunctionalityForm` ha la forma identica, e la specifica chiedeva a queste due form di
convergere; sistemarne una sola le farebbe divergere sull'asse su cui si era chiesto il contrario.

Tre voci del registro originale non compaiono qui perché già risolte: la spaziatura di sezione
persa dal wrapper dell'editor (corretta in `430feca`), l'ampiezza del `data-testid`
(corretta nella stessa ondata), e un commento fuorviante in un report di lavoro, che non è codice.

## Voci

- [ ] ID=MED-1, Severity=Medium, Complexity=Low, Priority=P2, Estimate=hours, Title=Il ramo d'errore di `TranslationKeyForm` non offre il ricarico che il suo testo promette, Fix description=Quando `saveTranslations` risponde `__KEY_CONFLICT__`, il messaggio del server recita «La chiave è stata modificata da un altro amministratore. Ricarica i dati e riprova», ma il ramo `error` della form è un semplice paragrafo: né `row.version` né il `keyVersion: 1` della creazione possono essere aggiornati sul posto, quindi quello stato non è più salvabile e l'unica uscita è Annulla. Il riquadro dei conflitti, accanto, ha il suo pulsante «Ricarica». Su una pagina la correzione ovvia è un `router.refresh()`, e **va fatta insieme a MED-2**, mai da sola.
- [ ] ID=MED-2, Severity=Medium, Complexity=Medium, Priority=P2, Estimate=hours, Title=`values` è inizializzato una sola volta e divergerebbe da `row` se la riga cambiasse identità, Fix description=In `components/i18n/translations/TranslationKeyForm.tsx` `initialValues` è un memo sulle props mentre `values` è stato inizializzato una volta sola. Oggi è irraggiungibile: nulla chiama `router.refresh()` su questa pagina (l'unico è in `TranslationsTableClient` e riguarda la lista). Diventa un difetto vero nel momento in cui qualcuno lo aggiunge — `dirty` e le versioni del payload si ricalcolerebbero dalla riga fresca mentre le caselle di testo mostrano ancora lo stato vecchio, e Ripristina salterebbe a valori che l'utente non ha mai visto. **Accoppiata a MED-1.**
- [ ] ID=MED-3, Severity=Medium, Complexity=Low, Priority=P2, Estimate=hours, Title=Nessun `maxLength` su chiave, namespace e modulo: oltre il limite Salva si spegne senza spiegazione, Fix description=`isValidTranslationKey` e `isValidNamespace` in `lib/i18n/key-format.ts` fanno rispettare anche `MAX_KEY_LENGTH` e `MAX_NAMESPACE_LENGTH`, e la form disabilita Salva su quella base. Le caselle dei valori hanno `maxLength={MAX_VALUE_LENGTH}`; chiave, namespace e modulo no, quindi una chiave di 201 caratteri spegne il pulsante senza un motivo visibile. La finestra modale precedente lasciava premere Salva e leggere l'errore del server. Il costo non è una riga: `EditableCombobox` non ha una prop `maxLength`, quindi namespace e modulo richiedono di toccare il componente condiviso.
- [ ] ID=MED-4, Severity=Medium, Complexity=Low, Priority=P3, Estimate=hours, Title=Il doppio invio è chiuso solo dal DOM, in questa form e in `FunctionalityForm`, Fix description=`save()` imposta `saving` prima del primo `await` e React svuota gli aggiornamenti degli eventi discreti in modo sincrono, quindi il secondo clic trova il pulsante disabilitato e i browser non emettono `click` su un pulsante disabilitato; non c'è nemmeno un elemento `<form>`, quindi non esiste invio implicito. Resta raggiungibile solo da due `click()` nello stesso blocco sincrono, che rientrerebbero in `save()` con `createdId` ancora nullo e creerebbero la chiave due volte, riportando un «Esiste già una chiave con questo nome» fuorviante su una chiave che *era* stata creata. Serve una bandiera in volo su `useRef`; una variabile di stato non basta perché la chiusura legge il valore vecchio. **Da applicare anche a `components/rbac/functionalities/FunctionalityForm.tsx`**, che ha la forma identica: correggere solo questa farebbe divergere le due form sull'asse su cui la specifica chiedeva di convergere.
- [ ] ID=LOW-1, Severity=Low, Complexity=Low, Priority=P3, Estimate=minutes, Title=Il restringimento di `from` è duplicato fra le due pagine e non ha un test proprio, Fix description=`app/(protected)/(admin)/admin/translations/create/page.tsx` e `.../[keyId]/edit/page.tsx` contengono entrambi, identico commento compreso, `const from = typeof sp.from === 'string' ? sp.from : ''`. Serve perché Next consegna un array per un parametro ripetuto (`?from=a&from=b`) e quell'array farebbe lanciare `new URLSearchParams`. Nessuna delle due pagine ha un test. Estrarre il restringimento in un piccolo aiutante nominato sotto `lib/` lo renderebbe verificabile contro un vero `['a','b']` senza toccare `lib/i18n/translations-return-url.ts`, il cui parametro è tipizzato `string` e per cui un array è fuori contratto. Il caso `{}` aggiunto durante l'ondata di correzioni non è una guardia: non attraversa codice difensivo, perché codice difensivo non ce n'è.
- [ ] ID=LOW-2, Severity=Low, Complexity=Low, Priority=P3, Estimate=minutes, Title=`getTranslationKeyRow` fa due letture non transazionali dove `listTranslations` usa una transazione, Fix description=`lib/i18n/translation-service.ts` legge prima la riga della chiave e poi le righe dei valori, con due `await` separati, mentre `listTranslations` racchiude la propria lettura in una transazione `repeatable read` / `read only`. Verificato che fallisce in sicurezza in entrambe le direzioni: una `keyVersion` obsoleta viene rifiutata senza condizioni in testa a `saveTranslations`, e versioni di valore obsolete producono conflitti per lingua. L'unica anomalia è mostrare nella casella di testo il valore appena scritto da un altro amministratore, che è ciò che significa una lettura fresca, non una perdita. Da rivedere solo se la pagina di modifica avrà bisogno di una lettura a un istante preciso.
- [ ] ID=LOW-3, Severity=Low, Complexity=Low, Priority=P3, Estimate=minutes, Title=Sulla chiave bloccata dopo la creazione c'è `disabled` invece di `readOnly`, Fix description=In modalità creazione, una volta che la chiave esiste (`createdId != null`) il campo `#tk-key` viene disabilitato per impedire che la form mostri una chiave diversa da quella salvata. `disabled` toglie però anche il fuoco, la selezione e la copia, così un amministratore non può rileggere o copiare la chiave appena creata. `readOnly` otterrebbe lo stesso blocco conservandoli. Non è un difetto funzionale: la form non invia mai tramite `FormData`, quindi l'esclusione dall'invio che `disabled` comporta è irrilevante qui.
- [ ] ID=LOW-4, Severity=Low, Complexity=Low, Priority=P3, Estimate=minutes, Title=`createdMetadata.module` conserva `''` dove il payload verso il server manda `null`, Fix description=In `TranslationKeyForm.tsx` la linea di base usata da Ripristina in modalità creazione conserva la stringa vuota per un modulo non compilato, mentre `metadata` manda `null` allo stesso server per lo stesso caso. È internamente coerente — la linea di base viene confrontata solo con lo stato `moduleName`, anch'esso stringa — e già commentata. Vale un commento in più se qualcuno tocca di nuovo quella logica.
- [ ] ID=LOW-5, Severity=Low, Complexity=Low, Priority=P3, Estimate=minutes, Title=Un segnaposto a forma di chiave viene raccolto dall'inventario i18n come se fosse un riferimento, Fix description=`placeholder="common.actions.save"` in `TranslationKeyForm.tsx` è un esempio, non una chiamata a `t()`, ma `sources/devops/i18n-key-inventory.test.mjs` raccoglie **ogni** letterale a forma di chiave. Qui è innocuo perché quella chiave è davvero usata altrove nel file, ma un futuro segnaposto d'esempio non altrimenti riferito marcherebbe in silenzio una chiave seminata come «riferita», togliendola dall'inventario degli orfani. La direzione «seminata e mai riferita» è comunque solo un report, non un errore.

## Verificato e chiuso, non rinviato

Tre voci del registro di esecuzione sono state corrette prima della consegna e non compaiono
sopra:

- La spaziatura di sezione persa quando il `data-testid="translation-editor"` è stato spostato su
  un wrapper senza `className`, che ha sottratto i tre blocchi allo `space-y-8` di
  `PageContainer` (`space-y-*` di Tailwind agisce solo sui figli diretti). Corretta in `430feca`.
- L'ampiezza dello stesso `data-testid`, che in Task 4 aveva smesso di comprendere i pulsanti e
  il riquadro dei conflitti. Corretta nella stessa ondata; il gruppo end-to-end i18n è tornato
  verde dopo il cambio.
- Un'affermazione sbagliata in un report di lavoro sulla stabilità referenziale di un mock. Il
  test che quel report descriveva è comunque una guardia valida contro la regressione storica.
