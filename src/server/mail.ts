import nodemailer, { type Transporter } from 'nodemailer'
import { env } from './env'
import { log } from './log'

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
    else log().error({ to, subject }, 'mail: SMTP not configured; message dropped')
    return
  }
  await t.sendMail({ from: env().MAIL_FROM, to, subject, text })
}
