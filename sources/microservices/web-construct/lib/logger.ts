import pino from 'pino'

const base = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['email', 'to', 'password', 'password_hash', 'token', 'err.details', 'err.hint'],
  base: { service: 'web-construct' },
})

export function createLogger(module: string) {
  return base.child({ module })
}
