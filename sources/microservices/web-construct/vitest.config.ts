import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'lib/**/*.test.ts',
      'components/**/*.test.ts',
      'components/**/*.test.tsx',
      'guards/**/*.test.ts',
      'types/**/*.test.ts',
    ],
    // Integration specs hit a real database and are opted into explicitly
    // (npm run test:integration), so a plain `npm test` needs no DATABASE_URL.
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
})
