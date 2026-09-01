import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'
import importX from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Intentional SSR hydration pattern: read localStorage only after mount
      // (documented in AGENTS.md — UIContext and Sidebar use this deliberately)
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
]

export default config
