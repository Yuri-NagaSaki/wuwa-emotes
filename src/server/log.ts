import pino from 'pino'

let instance: pino.Logger | undefined

export function log(): pino.Logger {
  instance ??= pino({
    level: process.env.LOG_LEVEL ?? 'info',
    base: { svc: process.env.CHAOCHI_SERVICE ?? 'web' },
    redact: {
      paths: ['secret', '*.secret', 'password', '*.password', 'token', '*.token', 'authorization', '*.authorization'],
      censor: '[redacted]',
    },
  })
  return instance
}
