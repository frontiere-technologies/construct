import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(new URL('../../microservices/web-construct/package.json', import.meta.url))
const ts = require('typescript')
const source = new URL('../../microservices/web-construct/lib/rbac/menu-target-url.ts', import.meta.url)
const target = new URL('./menu-target-url.generated.mjs', import.meta.url)
const output = '// GENERATED from lib/rbac/menu-target-url.ts; run node sources/devops/db/generate-menu-target-url.mjs\n'
  + ts.transpileModule(readFileSync(source, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, newLine: ts.NewLineKind.LineFeed },
  }).outputText
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('menu target URL artifact differs: regenerate it from TypeScript')
  console.log('menu target URL artifact matches TypeScript')
} else {
  writeFileSync(target, output)
  console.log(`wrote ${fileURLToPath(target)}`)
}
