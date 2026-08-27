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
      // (documented in CLAUDE.md — UIContext and Sidebar use this deliberately)
      'react-hooks/set-state-in-effect': 'off',
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
]

export default config
