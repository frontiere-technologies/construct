import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'
import importX from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'

// Gli helper di fixture costruiscono un TenantId da un numero (lib/tenancy/testing) o scrivono come
// proprietario (lib/db/testing): chi li importa da codice dell'app riapre la porta che il confine
// del tenant chiude. Solo i file di test possono usarli.
const TESTING_PATHS = [
  { name: '@/lib/tenancy/testing', message: 'Gli helper di lib/tenancy/testing costruiscono un TenantId da un numero: si importano solo nei file di test.' },
  { name: '@/lib/db/testing', message: 'Gli helper di lib/db/testing scrivono come proprietario, fuori dal confine del tenant: si importano solo nei file di test.' },
]

// L'identità di piattaforma (specifica 2026-10-26, §2.2, MT5-RISK-1): membro di construct_owner, la
// apre solo lib/platform/db.ts. La guardia vera è guards/platform-boundary.test.ts; questa regola
// la segnala mentre si scrive.
const PLATFORM_PATHS = [
  { name: '@/lib/platform/db', message: 'L\'identità di piattaforma (withPlatform) si importa solo da lib/platform/: ogni porta della console controlla prima l\'amministratore di piattaforma.' },
  { name: '@/lib/db/platform-database', message: 'Il client dell\'identità di piattaforma lo importa solo lib/platform/db.ts.' },
]

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Intentional SSR hydration pattern: read localStorage only after mount
      // (documented in AGENTS.md — Sidebar uses this deliberately)
      'react-hooks/set-state-in-effect': 'off',

      // Il logging passa da lib/logger.ts (pino). Nessuna eccezione qui: la
      // deroga per i due confini client che pino non raggiunge e' dichiarata
      // sotto, file per file. Un allow globale di warn/error renderebbe falsa
      // la frase di AGENTS.md — «fuori da questi confini console.* non esiste»
      // — perche' un terzo confine passerebbe senza che nessuno lo dichiari.
      'no-console': 'error',
    },
  },
  {
    // Il plugin `import` che eslint-config-next spedisce e' la 2.32 e vuole un
    // resolver a interfaccia v2, mentre eslint-import-resolver-typescript e' la
    // 3.10 a interfaccia v3: insieme producono un "Resolve error" per file.
    // import-x parla la v3, quindi le regole sugli import passano da qui. Il
    // plugin `import` di next resta registrato ma senza regole accese.
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [createTypeScriptImportResolver({ alwaysTryTypes: true })],
    },
    rules: {
      // Livelli: lib/ non importa da components/. La violazione reale che ha
      // motivato la regola (lib/rbac/genitore-lock.ts) era un import di solo
      // tipo, la specie che una revisione non vede: l'autofix degli import l'ha
      // perfino spostato in prima posizione senza che nulla se ne accorgesse.
      'import-x/no-restricted-paths': ['error', {
        zones: [{
          target: './lib',
          from: './components',
          message: 'lib/ non importa da components/. Se un helper in lib/ ha bisogno di una costante di presentazione, quella costante sta nel posto sbagliato.',
        }],
      }],

      // Alias @/ fra feature, relativi solo dentro lo stesso modulo locale.
      //
      // Non si usa import-x/no-relative-parent-imports: quella regola guarda il
      // percorso *risolto*, quindi considera «relativo al genitore» anche ogni
      // import via alias @/ — 427 errori, cioe' l'opposto della convenzione.
      // no-restricted-imports guarda invece la stringa scritta nel file, che e'
      // esattamente cio' che la regola vuole vincolare.
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'postgres', message: 'Il driver si usa solo in lib/db/: passa da withTenant o withGlobal (@/lib/db/tenant-db).' },
          { name: 'drizzle-orm/postgres-js', message: 'Il driver si usa solo in lib/db/: passa da withTenant o withGlobal (@/lib/db/tenant-db).' },
          { name: '@/lib/db/client', message: 'Il client si usa solo in lib/db/: passa da withTenant o withGlobal (@/lib/db/tenant-db).' },
          ...TESTING_PATHS,
          ...PLATFORM_PATHS,
        ],
        patterns: [{
          group: ['../*', '../**'],
          message: 'Niente risalita nei percorsi relativi: usa l\'alias @/ fra feature, e i relativi (./) solo dentro lo stesso modulo locale.',
        }],
      }],

      'import-x/order': ['error', {
        groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
        pathGroups: [
          { pattern: 'react', group: 'builtin', position: 'before' },
          { pattern: 'next', group: 'builtin' },
          { pattern: 'next/**', group: 'builtin' },
          { pattern: 'next-auth', group: 'builtin' },
          { pattern: 'next-auth/**', group: 'builtin' },
          { pattern: '@/**', group: 'internal' },
        ],
        pathGroupsExcludedImportTypes: ['react', 'next', 'next-auth'],
        // Nessuna riga vuota fra i gruppi: il progetto non le usa e imporle
        // riformatterebbe 250 file per una convenzione che nessuno ha chiesto.
        'newlines-between': 'never',
      }],
    },
  },
  {
    // Export nominati per componenti, hook, utility e tipi. Il motivo non e'
    // l'ordine: le porte di qualita' di questo progetto — raw-color-ratchet,
    // token-vocabulary, icon-only-button-accessible-name — leggono il sorgente
    // per nome di simbolo, e l'export default permette a ogni import di
    // rinominare il simbolo a piacere. La regola non si applica ad app/**,
    // dove Next impone export default per page, layout, route, error e loading.
    // Le cartelle sono quelle che AGENTS.md nomina: «componenti, hook, utility e
    // tipi». app/** resta fuori, dove Next impone export default per page,
    // layout, route, error e loading, e cosi' i file di configurazione alla
    // radice, che non stanno in nessuna di queste cartelle.
    files: ['{components,context,guards,lib,types}/**/*.{ts,tsx}'],
    rules: { 'import-x/no-default-export': 'error' },
  },
  {
    // Lista fatta per accorciarsi, non per restare.
    //
    // Questi 24 file avevano un export default prima che la regola esistesse, e
    // convertirli tutti in una volta avrebbe gonfiato un diff che sposta gia' 36
    // file. I sei che si sono spostati in components/grid/ e components/shared/
    // sono gia' convertiti, perche' i loro import si toccavano comunque.
    //
    // Quando ne converti uno, cancella la sua riga. E se ne rinomini uno senza
    // convertirlo, la riga non combacia piu' ed ESLint inizia a pretendere
    // l'export nominato: e' voluto — quel file lo hai toccato.
    files: [
      'components/LanguageSwitcher.tsx',
      'components/ProfileForm.tsx',
      'components/i18n/languages/LanguageFormModal.tsx',
      'components/i18n/languages/LanguagesTableClient.tsx',
      'components/i18n/translations/TranslationValueCell.tsx',
      'components/rbac/CustomSelect.tsx',
      'components/rbac/FilterDrawer.tsx',
      'components/rbac/GridRowActionsMenu.tsx',
      'components/rbac/NavigationTree.tsx',
      'components/rbac/PermissionsTree.tsx',
      'components/rbac/filters/EnumSelectFilter.tsx',
      'components/rbac/functionalities/FunctionalitiesTreeClient.tsx',
      'components/rbac/functionalities/FunctionalityForm.tsx',
      'components/rbac/functionalities/IconPicker.tsx',
      'components/rbac/functionalities/TagInput.tsx',
      'components/rbac/functionalities/TranslationsAccordion.tsx',
      'components/rbac/roles/CreateRoleModal.tsx',
      'components/rbac/roles/RenameRoleModal.tsx',
      'components/rbac/roles/RoleDetailClient.tsx',
      'components/rbac/roles/RolesTableClient.tsx',
      'components/rbac/users/ManageRolesModal.tsx',
      'components/rbac/users/RoleMultiSelect.tsx',
      'components/rbac/users/StatusBadge.tsx',
      'components/rbac/users/UsersTableClient.tsx',
    ],
    rules: { 'import-x/no-default-export': 'off' },
  },
  {
    // I due confini lato client che pino non puo' raggiungere. Sono un elenco,
    // non un allow globale: aggiungere un terzo confine e' una modifica a
    // questo file, cioe' una decisione visibile in un diff.
    //
    // - app/(protected)/error.tsx: l'error boundary deve loggare anche quando
    //   il resto della pagina, i18n compreso, e' quello che si e' rotto.
    // - context/I18nContext.tsx: avviso dev-only per una traduzione mancante.
    files: ['app/(protected)/error.tsx', 'context/I18nContext.tsx'],
    rules: { 'no-console': ['error', { allow: ['warn', 'error'] }] },
  },
  {
    // Le eccezioni al divieto sul driver (specifica 2026-10-13, §3.5): lo strato dati stesso, e i
    // file di test (connessioni proprie per lock e fixture, Drizzle finti). La regola sui percorsi
    // relativi resta accesa anche qui, e anche lo strato dati non importa gli helper di test: solo
    // i file di test, nel blocco sotto, possono farlo.
    files: ['lib/db/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [...TESTING_PATHS, ...PLATFORM_PATHS.filter(path => path.name !== '@/lib/db/platform-database')],
        patterns: [{
          group: ['../*', '../**'],
          message: 'Niente risalita nei percorsi relativi: usa l\'alias @/ fra feature, e i relativi (./) solo dentro lo stesso modulo locale.',
        }],
      }],
    },
  },
  {
    // Il modulo della piattaforma: importa il client dell'identità e se stesso (nei sottomoduli), ma
    // né il driver né gli helper di test.
    files: ['lib/platform/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'postgres', message: 'Il driver si usa solo in lib/db/: passa da withPlatform (@/lib/platform/db).' },
          { name: 'drizzle-orm/postgres-js', message: 'Il driver si usa solo in lib/db/: passa da withPlatform (@/lib/platform/db).' },
          { name: '@/lib/db/client', message: 'Il client si usa solo in lib/db/: passa da withPlatform (@/lib/platform/db).' },
          ...TESTING_PATHS,
        ],
        patterns: [{
          group: ['../*', '../**'],
          message: 'Niente risalita nei percorsi relativi: usa l\'alias @/ fra feature, e i relativi (./) solo dentro lo stesso modulo locale.',
        }],
      }],
    },
  },
  {
    // I file di test: il driver e gli helper di test sono permessi. Viene dopo il blocco di lib/db/,
    // cosi' i test in lib/db/ ereditano questa regola e non quella.
    // L'identità di piattaforma resta vietata anche ai test fuori da lib/platform/ (e da lib/db/ per il
    // suo client): il blocco dopo questo la riapre dove serve.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: PLATFORM_PATHS,
        patterns: [{
          group: ['../*', '../**'],
          message: 'Niente risalita nei percorsi relativi: usa l\'alias @/ fra feature, e i relativi (./) solo dentro lo stesso modulo locale.',
        }],
      }],
    },
  },
  {
    // I test dentro lib/platform/ importano withPlatform, e quelli in lib/db/ il client della piattaforma.
    files: ['lib/platform/**/*.test.ts', 'lib/db/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [],
        patterns: [{
          group: ['../*', '../**'],
          message: 'Niente risalita nei percorsi relativi: usa l\'alias @/ fra feature, e i relativi (./) solo dentro lo stesso modulo locale.',
        }],
      }],
    },
  },
]

export default config
