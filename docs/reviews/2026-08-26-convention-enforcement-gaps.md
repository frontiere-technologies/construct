# Dove le convenzioni non hanno una guardia

Data: 2026-08-26
Origine: revisione finale del ramo `feature/react-naming-conventions*`

## Sommario

Il lavoro del 2026-08-26 ha scritto le convenzioni in
[sources/microservices/web-construct/AGENTS.md](../../sources/microservices/web-construct/AGENTS.md)
e ne ha messe sotto guardia automatica **tre**: nessun nome di file in `camelCase`,
`components/ui/` tutto in `kebab-case`, e `.tsx` solo per file che contengono JSX
(`guards/file-naming.test.ts`), più l'ordine degli import e gli export nominati in
`components/**` (`import-x/order`, `import-x/no-default-export`).

Tutto il resto di `AGENTS.md` è oggi affidato alla revisione umana. Questo documento elenca
quelle regole in ordine di probabilità di erosione, con la prova che la lacuna esiste dove è
stata verificata per iniezione. `AGENTS.md` dice che una convenzione vale solo se è scritta **e**
difesa: questo è l'elenco della metà mancante.

Nessuna delle voci è un difetto del codice attuale, tranne dove indicato. Sono lacune di
difesa, non violazioni.

## Voci

- [ ] ID=GAP-1, Priority=P1, Complexity=Medium, Title=La seconda metà della regola sui nomi non è difesa, Fix description=La guardia rifiuta il `camelCase` ma non pretende il `kebab-case`: un file `lib/ScratchProbe.ts` iniettato passa. È la regola principale del lavoro, ha già avuto una violazione reale (`context/AuthContext.ts`, corretta in questo ramo) e il `PascalCase` è la forma che un contributore sceglie per istinto. Aggiungere un quarto controllo a `guards/file-naming.test.ts`: un gambo in `PascalCase` deve avere un export omonimo che ritorni JSX o chiami `createContext`. Il macchinario AST di `containsJsx` è già lì.
- [ ] ID=GAP-2, Priority=P1, Complexity=Low, Title=Il confine fra `lib/` e `components/` non è difeso, Fix description=La regola «`lib/` non importa da `components/`» non ha guardia, e ha avuto una violazione reale (`lib/rbac/genitore-lock.ts`, corretta in questo ramo) che l'autofix degli import ha perfino spostato in prima posizione senza che nulla se ne accorgesse. Era un import di solo tipo, la specie meno visibile in revisione. `import-x/no-restricted-paths` o cinque righe di guardia.
- [ ] ID=GAP-3, Priority=P2, Complexity=Low, Title=`export default` è controllato solo sotto `components/`, Fix description=`AGENTS.md` chiede export nominati per «componenti, hook, utility e tipi», quindi anche `lib/`, `types/`, `context/` e `guards/`. La regola ESLint copre solo `components/**`. Oggi zero violazioni fuori da lì: allargare il glob (escludendo `app/**` e i file di configurazione alla radice) costa nulla adesso e costerà dopo.
- [ ] ID=GAP-4, Priority=P2, Complexity=Low, Title=`console.*` non è difeso, Fix description=Due usi legittimi esistono ai confini client (`app/(protected)/error.tsx`, `context/I18nContext.tsx`) e `AGENTS.md` ora li ammette esplicitamente. Accendere `no-console` con `allow: ['warn','error']`, contando sulla disciplina già in uso del disable di riga con motivo, chiuderebbe la deriva senza toccare i due casi.
- [ ] ID=GAP-5, Priority=P2, Complexity=Low, Title=Gli acronimi negli identificatori non sono difesi, Fix description=La regola `Dto`/`Id`/`Url`/`Api`/`Svg` è banalmente verificabile con una scansione, ed è appena costata una rinomina su 27 occorrenze (`UserDTO` → `UserDto`) che una guardia avrebbe impedito di accumulare. Serve una lista di eccezioni breve: `useUI`, `toJSON`.
- [ ] ID=GAP-6, Priority=P3, Complexity=Low, Title=Le regole sui nomi dei simboli non sono difese, Fix description=Booleani con predicato, `onX` per le prop di callback, `handleX` per gli handler locali, ambito di `UPPER_SNAKE_CASE`, nessun prefisso `A`/`I`. `@typescript-eslint/naming-convention` copre le classi di casing ma non la semantica; il valore sta nella semantica, quindi la difesa automatica qui è parziale per natura.
- [ ] ID=GAP-7, Priority=P3, Complexity=Low, Title=Import relativi profondi e barrel non sono difesi, Fix description=Erosione bassa: un barrel o un `../..` si vede in revisione. `import-x` spedisce `no-relative-parent-imports` se lo si vuole gratis.
- [ ] ID=GAP-8, Priority=P1, Complexity=Low, Title=Nessuno verifica che `AGENTS.md` sia vero, Fix description=La revisione finale ha trovato cinque punti in cui il documento si era già scollato dal codice **dentro il ramo che lo ha scritto** — la deriva più rapida che quel file vedrà mai. `devops/docs-contract.test.mjs` esiste già e asserisce affermazioni in prosa su altri documenti: puntargli tre asserzioni su `AGENTS.md` (i meccanismi che nomina esistono, i nomi di regola che cita risolvono, le cartelle che descrive sono quelle che esistono) è la guardia più economica dell'elenco e l'unica che chiude una *categoria* invece di un caso.

- [ ] ID=GAP-9, Priority=P1, Complexity=Low, Title=La soglia di contrasto e' garantita solo sui valori predefiniti, non su quelli salvati, Fix description=`lib/theme-vars.test.ts` asserisce che `foreground`, `foreground-secondary`, `foreground-muted` e `foreground-faint` superino 4,5:1 su ogni superficie dei due temi — ma su `defaultThemeConfig`, cioe' sui valori spediti. Il pannello Admin → Tema scrive quei colori nel database e **nessuna validazione di contrasto esiste sul percorso di salvataggio** (verificato: ne' `lib/theme-actions.ts`, ne' `lib/validations.ts`, ne' `components/AdminTheme.tsx` contengono un calcolo di rapporto). Misurato in browser il 2026-08-27 sulla configurazione salvata in questo ambiente: `foreground-faint` da' **2,54:1** in chiaro (`#9ca3af` su card bianca) e **3,04:1** in scuro (`#6b7280` su `#1f2937`), su ogni superficie. Non e' cosmetico: `text-foreground-faint` veste testo piccolo — `text-xs` in `app/(protected)/error.tsx`, `text-[10px]` in `components/AdminTheme.tsx`, e il testo degli input disabilitati in `components/ui/input.tsx` — dove 4,5:1 e' la soglia, non 3:1. Da chiudere validando al salvataggio con la stessa funzione `contrast()` che il test usa gia', e rifiutando o correggendo un valore sotto soglia. Nota: il test usa `contrast('#9ca3af', '#ffffff')` ≈ 2,54 come *esempio di contrasto basso* per validare la propria matematica, ed e' esattamente il colore che questo database serve.
- [ ] ID=GAP-10, Priority=P2, Complexity=Low, Title=Il catalogo i18n vivo puo' restare indietro rispetto ai semi senza che nulla lo segnali, Fix description=`sources/devops/i18n-key-inventory.test.mjs` confronta le chiavi seminate dalle migrazioni SQL con i letterali nel sorgente, e **deliberatamente non** interroga il database — il suo commento spiega perche', ed e' una ragione sana: gli amministratori creano chiavi a runtime da Admin → Traduzioni, e un controllo sul catalogo vivo segnalerebbe ogni chiave utente come anomalia. Il prezzo di quella scelta e' che un ambiente indietro sulle migrazioni non viene notato. Trovato in browser il 2026-08-27: nella tabella dei ruoli i sedici bottoni di azione riga espongono come nome accessibile la stringa `[missing: common.actions.row_actions]`. La chiave e' usata in `components/rbac/GridRowActionsMenu.tsx:76` ed **e'** seminata, da `sources/devops/db/migrations/0009_rbac_button_migration_labels.sql`: codice e semi concordano, e' questo database a non averla. La guardia sui bottoni a sola icona passa perche' controlla che un nome ci sia, non che sia utile. Da chiudere applicando le migrazioni a questo ambiente (`node sources/devops/db/db.mjs apply`); e, se si vuole una rete, un controllo d'avvio che confronti il conteggio delle chiavi seminate con quelle presenti e avvisi, senza fallire, quando l'ambiente e' indietro.

## Non in elenco, di proposito

Virgolette e punti e virgola restano senza automazione per scelta: Prettier è stato respinto con
motivo, e i punti e virgola non si sono erosi (zero righe di codice terminate da `;`). Le
virgolette doppie sopravvissute sono tutte forzate da un apostrofo o da una fixture SQL, e
`AGENTS.md` ora dichiara quella deroga invece di far finta che la regola sia assoluta.
