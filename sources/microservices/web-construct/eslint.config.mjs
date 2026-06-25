import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

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
]

export default config
