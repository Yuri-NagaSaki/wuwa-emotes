import nodemailer, { type Transporter } from 'nodemailer'
import { env } from './env'
import { log, maskEmails } from './log'

let transport: Transporter | null | undefined

export function mailConfigured(): boolean {
  return Boolean(env().SMTP_URL && env().MAIL_FROM)
}

function getTransport(): Transporter | null {
  if (transport === undefined) transport = mailConfigured() ? nodemailer.createTransport(env().SMTP_URL) : null
  return transport
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const t = getTransport()
  if (!t) {
    // Development without SMTP: print the message so links can be followed by hand.
    if (env().NODE_ENV !== 'production') log().info({ to, subject, text }, 'mail (not sent: SMTP not configured)')
    else log().error({ to: maskEmails(to), subject }, 'mail: SMTP not configured; message dropped')
    return
  }
  const started = Date.now()
  try {
    const info = await t.sendMail({ from: env().MAIL_FROM, to, subject, text })
    // the SMTP reply ("250 2.0.0 Ok: queued as …") is what to quote when asking the provider about a message
    log().info({ to: maskEmails(to), subject, messageId: info.messageId, reply: String(info.response ?? '').slice(0, 160), ms: Date.now() - started }, 'mail: sent')
  } catch (err) {
    log().error({ to: maskEmails(to), subject, err: (err as Error).message, ms: Date.now() - started }, 'mail: send failed')
    throw err
  }
}
