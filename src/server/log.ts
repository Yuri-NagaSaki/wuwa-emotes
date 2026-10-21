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

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g

/** "s***@gmail.com": enough to tell addresses apart in a log without keeping them. */
export function maskEmails(text: string): string {
  return text.replace(EMAIL, '$1***$2')
}
