// Preparazione comune dei test unitari (setupFiles di vitest.config.ts), eseguita prima di ogni file.
//
// Node 26 espone un `localStorage` (e un `sessionStorage`) globale che, senza l'opzione
// --localstorage-file, vale `undefined`. L'ambiente jsdom di Vitest non sovrascrive un globale già
// presente, quindi quello di jsdom resta nascosto e `localStorage.clear()` lancia un TypeError.
// Qui si mette un archivio in memoria al suo posto, ma solo nei file jsdom e solo quando quello
// dell'ambiente non è utilizzabile: su Node 22 (la CI) resta il `localStorage` vero di jsdom.
//
// Ogni file di test parte con un archivio vuoto, come con jsdom: il setup gira una volta per file.

class MemoryStorage implements Storage {
  readonly #items = new Map<string, string>()

  get length(): number {
    return this.#items.size
  }

  key(index: number): string | null {
    return [...this.#items.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.#items.get(String(key)) ?? null
  }

  setItem(key: string, value: string): void {
    this.#items.set(String(key), String(value))
  }

  removeItem(key: string): void {
    this.#items.delete(String(key))
  }

  clear(): void {
    this.#items.clear()
  }
}

// Leggere il globale rotto fa stampare a Node un ExperimentalWarning per file: è proprio il caso che
// qui si gestisce, quindi durante la sola lettura quell'avviso si tace. Gli altri passano.
function readQuietly(name: 'localStorage' | 'sessionStorage'): unknown {
  const emitWarning = process.emitWarning
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
    const message = typeof warning === 'string' ? warning : warning.message
    if (message.includes('--localstorage-file')) return
    Reflect.apply(emitWarning, process, [warning, ...rest])
  }) as typeof process.emitWarning
  try {
    return (globalThis as Record<string, unknown>)[name]
  } finally {
    process.emitWarning = emitWarning
  }
}

function isUsable(name: 'localStorage' | 'sessionStorage'): boolean {
  try {
    const storage = readQuietly(name) as Storage | undefined
    return typeof storage?.getItem === 'function' && typeof storage.clear === 'function'
  } catch {
    return false
  }
}

if (typeof document !== 'undefined') {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (!isUsable(name)) {
      Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value: new MemoryStorage(),
      })
    }
  }
}
