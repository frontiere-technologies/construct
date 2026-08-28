import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // Una riga sola, e le radici sorgente al completo. La forma precedente era
    // un elenco di cinque glob per cartella ed estensione, che lasciava fuori
    // `app/`, `context/` e ogni `*.test.tsx` non sotto `components/`: un test
    // scritto li' non falliva, semplicemente non veniva raccolto, e la suite
    // restava verde. Un cancello che tace e' peggio di nessun cancello.
    //
    // Le radici sono le stesse di guards/file-naming.test.ts, e
    // guards/test-collection.test.ts verifica che questo glob copra davvero
    // ogni file *.test.* presente su disco: quando nasce una radice nuova, e'
    // quella guardia a dirlo invece di lasciarla scoperta in silenzio.
    include: ['{app,components,context,guards,lib,types}/**/*.test.{ts,tsx}'],
    // Integration specs hit a real database and are opted into explicitly
    // (npm run test:integration), so a plain `npm test` needs no DATABASE_URL.
    exclude: ['**/node_modules/**', '**/*.integration.test.ts'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
})
