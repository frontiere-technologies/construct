# Design: rendering in iframe per i link "embedded" (EMBEDDED_PAGE)

## Contesto

Il tipo di funzionalità `EMBEDDED_PAGE` (`id_functionality_type = 1`) esiste già nel form di creazione (`FunctionalityForm.tsx`, opzione "Link esterno embedded (iframe)"), ma oggi non ha alcun comportamento distinto a runtime: sia `EMBEDDED_PAGE` che `EXTERNAL_LINK` producono lo stesso `<Link href={functionality_link}>` senza `target`, quindi cliccando un item di questo tipo il browser naviga via dalla webapp nella stessa scheda. La label "(iframe)" nel form è puramente descrittiva, non c'è nessun `<iframe>` renderizzato da nessuna parte nel codebase.

Questo lavoro implementa il comportamento mancante: un item `EMBEDDED_PAGE` deve aprire il proprio URL **dentro un iframe, nell'area principale dei contenuti dell'app** (il riquadro accanto alla sidebar), senza navigare fuori dalla webapp.

`EXTERNAL_LINK` e `INTERNAL_FUNCTIONALITY` restano invariati: fuori scope.

## Scope

1. Nuova route interna `/embedded/[id]` che risolve un `id_item` di tipo `EMBEDDED_PAGE`, verifica l'autorizzazione RBAC dell'utente su quell'item, e renderizza l'iframe oppure un messaggio di fallback.
2. Modifica di `sidebar-adapter.ts` perché gli item `EMBEDDED_PAGE` puntino a `/embedded/{id_item}` invece che direttamente all'URL esterno.
3. Verifica server-side (via header HTTP) se il sito target può essere incorporato in iframe, con fallback a un messaggio + link "Apri in nuova scheda" quando non lo è (o quando la verifica stessa fallisce).
4. Test unitari sulla funzione di verifica e test e2e sul flusso completo.

Fuori scope: modifiche al comportamento di `EXTERNAL_LINK`/`INTERNAL_FUNCTIONALITY`, nuovi campi nel form di creazione (il tipo `EMBEDDED_PAGE` esiste già ed è sufficiente a determinare il comportamento), caching del risultato della verifica tra richieste diverse.

## 1. Route `/embedded/[id]`

**Nuovo file:** `app/(protected)/embedded/[id]/page.tsx` (server component, dentro il route group `(protected)` per ereditare sidebar/layout esistenti via `app/(protected)/layout.tsx`).

Flusso:

1. Legge la sessione (`auth()`) e i `roleIds` correnti, come già fa `app/(protected)/layout.tsx:6-7`.
2. Recupera l'item (`navigation_item` con quell'`id_item`) e verifica che `id_functionality_type === FUNCTYPE_EMBEDDED_PAGE` (nuova costante, vedi sezione 2) — se non trovato o tipo diverso, `notFound()`.
3. Verifica l'autorizzazione dell'utente sull'item riusando `resolveAuthorizedItemIds` (già esistente in `lib/rbac/sidebar-adapter.ts:7-21`) — se l'`id_item` non è nel set autorizzato per i `roleIds` correnti, redirect a `/`. Questo impedisce di raggiungere un item non autorizzato semplicemente indovinando l'id nell'URL.
4. Chiama `checkEmbeddable(functionality_link)` (nuova funzione, sezione 3).
5. Passa `{ url: functionality_link, embeddable }` a un client component che decide il rendering (sezione 4).

Query DB e logica di autorizzazione riusano gli stessi helper già usati da `getSidebarMenu` (`lib/rbac/navigation-service.ts`), aggiungendo una funzione sorella `getAuthorizedNavigationItem(id: number, roleIds: number[])` nello stesso file, per non duplicare la logica di fetch/join.

## 2. Costante `FUNCTYPE_EMBEDDED_PAGE`

**File:** `lib/rbac/types.ts:14-16`.

Oggi è definito solo `FUNCTYPE_PERMISSION = 5`. Viene aggiunta `export const FUNCTYPE_EMBEDDED_PAGE = 1`, usata sia dalla nuova route (punto 1.2) sia da `sidebar-adapter.ts` (sezione 5).

## 3. Verifica "è embeddabile?" — `checkEmbeddable`

**Nuovo file:** `lib/rbac/embedded-check.ts`.

```
export async function checkEmbeddable(url: string): Promise<boolean>
```

Non è possibile rilevare in modo affidabile via JavaScript **lato client** se un sito ha bloccato l'embedding in iframe: le policy cross-origin impediscono di ispezionare il contenuto del frame, e l'evento `onload` si attiva comunque anche quando il browser mostra la propria pagina di errore al posto del contenuto. Per questo la verifica avviene **server-side**, dove non ci sono queste restrizioni:

1. Valida che `url` inizi con `http://` o `https://` — altrimenti ritorna `false` senza fare rete.
2. Fa una richiesta `HEAD` con timeout di 4s (`AbortController`). Se il server risponde con `405`/errore sul metodo `HEAD`, ritenta con `GET` (stesso timeout).
3. Legge gli header di risposta:
   - `X-Frame-Options`: se presente con valore `DENY` o `SAMEORIGIN` (case-insensitive) → non embeddabile.
   - `Content-Security-Policy`: se contiene una direttiva `frame-ancestors` che non include `*` o l'origine dell'app → non embeddabile. (Confronto semplice per token; non serve un parser CSP completo per questo caso d'uso.)
   - Nessuno dei due header presente, o valori che permettono l'embedding → embeddabile.
4. Qualsiasi eccezione (timeout, errore di rete, DNS, ecc.) → ritorna `false` (fail verso il fallback, mai verso un iframe "alla cieca").

Funzione pura, senza dipendenze da Next.js/React: testabile in isolamento con `fetch` mockato.

## 4. Componenti di rendering

**Nuovo file:** `components/EmbeddedFrame.tsx` (client component) — riceve `url`, renderizza:

```tsx
<iframe src={url} className="w-full h-full border-0" />
```

a piena altezza/larghezza dell'area main (stesso contenitore usato oggi dalle altre pagine protette), con uno spinner di caricamento mostrato finché l'evento `onload` dell'iframe non si attiva.

**Nuovo file:** `components/EmbeddedBlockedNotice.tsx` — componente semplice, riceve `url`, mostra:

```
⚠️ Questo sito non può essere visualizzato incorporato.
[Apri in una nuova scheda →]   (<a href={url} target="_blank" rel="noopener noreferrer">)
```

`page.tsx` sceglie quale dei due montare in base a `embeddable`.

## 5. Modifica a `sidebar-adapter.ts`

**File:** `lib/rbac/sidebar-adapter.ts:66`, dentro `mapNavigationToSidebar()`.

Oggi:
```ts
route: isCategory ? undefined : normalizeRoute(it.functionality_link),
```

Diventa (solo per gli item non-categoria di tipo `EMBEDDED_PAGE`):
```ts
route: isCategory
  ? undefined
  : it.id_functionality_type === FUNCTYPE_EMBEDDED_PAGE
    ? `/embedded/${it.id_item}`
    : normalizeRoute(it.functionality_link),
```

`EXTERNAL_LINK` e `INTERNAL_FUNCTIONALITY` continuano a usare `normalizeRoute(it.functionality_link)` esattamente come oggi — nessun altro cambiamento al comportamento esistente (nessun `target="_blank"` introdotto, dato non richiesto in questa iterazione).

## Data flow riassunto

1. Click sidebar → `Link href="/embedded/461"` (navigazione client-side interna, sidebar resta montata).
2. `page.tsx`: auth + RBAC check sull'`id_item` → 404/redirect se non valido/non autorizzato.
3. Fetch `functionality_link` dal DB.
4. `checkEmbeddable(functionality_link)` (sequenziale, max ~4s).
5. Render condizionale: `EmbeddedFrame` o `EmbeddedBlockedNotice`.

Nessuna cache del risultato tra richieste diverse: ogni click ripete il check (accettabile per il volume d'uso previsto; YAGNI per ora — se in futuro diventa un collo di bottiglia si può aggiungere una cache con TTL).

## Gestione errori

- Item non trovato o `id_functionality_type` diverso da `EMBEDDED_PAGE` → `notFound()` (404 standard Next.js).
- Utente non autorizzato per quell'`id_item` (in base ai `roleIds` correnti della sessione) → redirect a `/`.
- `checkEmbeddable` in timeout/errore → fallback (`EmbeddedBlockedNotice`), mai iframe silenzioso.
- `functionality_link` malformato/non-http(s) → trattato come "non embeddabile" da `checkEmbeddable`, nessuna eccezione non gestita.
- Iframe caricato ma contenuto interno rotto per altri motivi (es. redirect interno che rompe il layout) → fuori scope: non rilevabile in modo affidabile lato client per contenuto cross-origin.

## Test

- **Unit (Vitest)** su `checkEmbeddable`, con `fetch` mockato:
  - nessun header di blocco → `true`;
  - `X-Frame-Options: DENY` / `SAMEORIGIN` → `false`;
  - `Content-Security-Policy: frame-ancestors` che esclude l'origine dell'app → `false`;
  - timeout / errore di rete → `false`;
  - URL non-http(s) → `false` senza chiamare `fetch`.
- **E2E (pytest)**: nuovo test che clicca un item `EMBEDDED_PAGE` autorizzato e verifica:
  - caso embeddabile → compare un `<iframe>` con `src` atteso nell'area main, sidebar ancora visibile;
  - caso non embeddabile → compare il messaggio di fallback con il link "Apri in nuova scheda" corretto.
  - Per evitare dipendenza da siti esterni reali, si userà un piccolo server di test locale (o endpoint dedicato) che risponde con/senza `X-Frame-Options` a seconda del path, così entrambi i casi sono deterministici in CI.
- Nessun test aggiuntivo necessario oltre a un assert in più su `route` per item `EMBEDDED_PAGE` nei test esistenti di `sidebar-adapter.ts`, se presenti.

## Rischi/edge case

- Alcuni siti bloccano l'embedding con meccanismi diversi da `X-Frame-Options`/`frame-ancestors` (es. JS che rileva `window.top !== window.self` e si "rompe fuori" dal frame). `checkEmbeddable` non può rilevare questo caso dagli header: il sito passerebbe il check ma potrebbe comunque comportarsi in modo indesiderato dentro l'iframe. Accettato come limite noto — fuori scope risolverlo in questa iterazione.
- Siti lenti a rispondere anche solo per l'header check aggiungono fino a 4s di attesa prima che la pagina `/embedded/[id]` finisca di renderizzare lato server. Accettabile per il volume d'uso previsto.
- Se in futuro serve riabilitare "apri in nuova scheda" anche per `EMBEDDED_PAGE` (in aggiunta all'iframe), il campo `MenuItem.target` esiste già ma non viene toccato da questo design.
