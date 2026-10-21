import { authCall, DATABASE_URL, goodToken, mainDatabase, withClient } from '../integration/setup'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

// Sign-up with mail configured (requireEmailVerification on), against a local SMTP sink. Its own
// directory and process: auth() and env() are process-wide, and every file in tests/integration
// expects the opposite (no SMTP, sign-up signs in right away).
//
//   CHAOCHI_TEST_DB=chaochi_test_authmail CHAOCHI_TEST_BUCKET=chaochi-test-authmail bun test ./tests/auth-mail
//
// Better Auth answers a sign-up with an address that already has an account exactly like a new one
// (no session, token null) and sends nothing by itself; onExistingUserSignUp (src/server/auth/auth.ts)
// mails the owner one notice per address per 10 minutes. Signing in to an unverified account sends
// nothing either (emailVerification.sendOnSignIn is off): the login page offers 重新发送.

// ---------- SMTP sink: every message, decoded enough to read subject and text ----------

interface Mail {
  to: string
  subject: string
  text: string
}
const mails: Mail[] = []
/** reject the next message at the end of DATA (a failed send) */
let rejectNext = false

function decodeBody(headers: string, body: string): string {
  const enc = /content-transfer-encoding:\s*([\w-]+)/i.exec(headers)?.[1]?.toLowerCase()
  if (enc === 'base64') return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8')
  if (enc === 'quoted-printable') {
    const soft = body.replace(/=\r?\n/g, '')
    const bytes: number[] = []
    for (let i = 0; i < soft.length; i++) {
      const m = soft[i] === '=' ? /^[0-9A-F]{2}/i.exec(soft.slice(i + 1, i + 3)) : null
      if (m) {
        bytes.push(parseInt(m[0], 16))
        i += 2
      } else bytes.push(...Buffer.from(soft[i]!, 'utf8'))
    }
    return Buffer.from(bytes).toString('utf8')
  }
  return body
}

function decodeSubject(raw: string): string {
  return raw
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_, kind: string, text: string) =>
      kind.toLowerCase() === 'b' ? Buffer.from(text, 'base64').toString('utf8') : decodeBody('content-transfer-encoding: quoted-printable', text.replace(/_/g, ' ')),
    )
}

function storeMail(raw: string, rcpt: string[]) {
  const split = raw.indexOf('\r\n\r\n')
  const headers = raw.slice(0, split)
  const unfolded = headers.replace(/\r\n[ \t]+/g, ' ')
  mails.push({ to: rcpt[0] ?? '', subject: decodeSubject(/^subject:\s*(.*)$/im.exec(unfolded)?.[1] ?? ''), text: decodeBody(headers, raw.slice(split + 4)) })
}

interface SmtpState {
  buf: string
  inData: boolean
  lines: string[]
  rcpt: string[]
}
const smtp = Bun.listen<SmtpState>({
  hostname: '127.0.0.1',
  port: 0,
  socket: {
    open(s) {
      s.data = { buf: '', inData: false, lines: [], rcpt: [] }
      s.write('220 sink ESMTP\r\n')
    },
    data(s, chunk) {
      s.data.buf += Buffer.from(chunk).toString('latin1')
      for (let i = s.data.buf.indexOf('\r\n'); i >= 0; i = s.data.buf.indexOf('\r\n')) {
        const line = s.data.buf.slice(0, i)
        s.data.buf = s.data.buf.slice(i + 2)
        if (s.data.inData) {
          if (line === '.') {
            s.data.inData = false
            if (rejectNext) {
              rejectNext = false
              s.write('554 rejected by the test\r\n')
            } else {
              storeMail(s.data.lines.join('\r\n'), s.data.rcpt)
              s.write('250 queued\r\n')
            }
            s.data.lines = []
            s.data.rcpt = []
          } else s.data.lines.push(line.startsWith('..') ? line.slice(1) : line)
          continue
        }
        const cmd = line.slice(0, 4).toUpperCase()
        if (cmd === 'EHLO' || cmd === 'HELO') s.write('250 sink\r\n')
        else if (cmd === 'RCPT') {
          s.data.rcpt.push(/<([^>]*)>/.exec(line)?.[1] ?? '')
          s.write('250 ok\r\n')
        } else if (cmd === 'DATA') {
          s.data.inData = true
          s.write('354 go ahead\r\n')
        } else if (cmd === 'QUIT') {
          s.write('221 bye\r\n')
          s.end()
        } else s.write('250 ok\r\n')
      }
    },
  },
})

// mail on: before anything builds auth() (requireEmailVerification) or the mail transport
process.env.SMTP_URL = `smtp://127.0.0.1:${smtp.port}`
process.env.MAIL_FROM = 'chaochi-test@example.test'
const { env, parseEnv } = await import('#/server/env')
Object.assign(env(), parseEnv(process.env))
const { mailConfigured } = await import('#/server/mail')
const { existingSignUpText } = await import('#/server/auth/auth')

const NOTICE = '这个邮箱已经注册过'
const VERIFY = '验证邮箱'
const PASSWORD = 'correct horse battery staple'

let seq = 0
const address = (label: string) => `${label}-${++seq}-${Date.now()}@test.chaochi`

interface SignUpAnswer {
  status: number
  body: { token: string | null; user: Record<string, unknown> }
  sessionCookie: boolean
}

async function signUpWith(email: string, password = PASSWORD, name = 'tester'): Promise<SignUpAnswer> {
  const res = await authCall('/sign-up/email', { body: { email, password, name, callbackURL: '/verify-email' }, cap: goodToken() })
  return {
    status: res.status,
    body: (await res.json()) as SignUpAnswer['body'],
    sessionCookie: res.headers.getSetCookie().some((c) => /better-auth\.session_token=[^;]/.test(c)),
  }
}

const mailsTo = (email: string) => mails.filter((m) => m.to === email)
const subjects = (email: string) => mailsTo(email).map((m) => m.subject.replace(/^.* · /, ''))

beforeAll(async () => {
  const run = await mainDatabase()
  if (run.exitCode !== 0) throw new Error(`migrate failed:\n${run.output}`)
}, 60_000)

afterAll(() => smtp.stop(true))

describe('sign-up with an address that already has an account', () => {
  test('mail is configured for this file', () => {
    expect(mailConfigured()).toBe(true)
  })

  test('the generic answer both times; one verification mail, then exactly one notice in the window', async () => {
    const email = address('twice')
    const first = await signUpWith(email)
    const second = await signUpWith(email, 'a different password 42', 'someone else')
    for (const a of [first, second]) {
      expect(a.status).toBe(200)
      expect(a.body.token).toBeNull()
      expect(a.sessionCookie).toBe(false)
      expect(a.body.user.email).toBe(email)
      expect(a.body.user.emailVerified).toBe(false)
    }
    // the same shape: nothing tells the two answers apart but the generated id
    expect(Object.keys(second.body.user).sort()).toEqual(Object.keys(first.body.user).sort())
    expect(second.body.user.id).not.toBe(first.body.user.id)
    expect(subjects(email)).toEqual([VERIFY, NOTICE])

    // a third try inside the 10-minute window: same answer, no second notice
    const third = await signUpWith(email)
    expect(third.status).toBe(200)
    expect(third.body.token).toBeNull()
    expect(subjects(email)).toEqual([VERIFY, NOTICE])
  })

  test('the notice to an unverified account says to verify first; a verified one says 直接登录', async () => {
    const unverified = address('unverified')
    await signUpWith(unverified)
    await signUpWith(unverified)
    const n1 = mailsTo(unverified).find((m) => m.subject.endsWith(NOTICE))!
    expect(n1.text).toContain('还没有验证')
    expect(n1.text).toContain('/login')
    expect(n1.text).toContain('/forgot-password')

    const verified = address('verified')
    await signUpWith(verified)
    await withClient(DATABASE_URL, (c) => c.query('update users set email_verified = true where email = $1', [verified]))
    await signUpWith(verified)
    const n2 = mailsTo(verified).find((m) => m.subject.endsWith(NOTICE))!
    expect(n2.text.replace(/\r\n/g, '\n').trim()).toBe(existingSignUpText(env().SITE_NAME, env().SITE_URL, true))
    expect(n2.text).toContain('直接登录')
  })

  test('a notice that could not be sent does not use up the window', async () => {
    const email = address('smtp-down')
    await signUpWith(email)
    rejectNext = true
    const failed = await signUpWith(email)
    // the answer does not change when the mail fails
    expect(failed.status).toBe(200)
    expect(failed.body.token).toBeNull()
    expect(subjects(email)).toEqual([VERIFY])
    await signUpWith(email)
    expect(subjects(email)).toEqual([VERIFY, NOTICE])
  })
})

describe('signing in before the address is verified', () => {
  test('403 EMAIL_NOT_VERIFIED and no mail (the login page offers 重新发送)', async () => {
    const email = address('signin')
    await signUpWith(email)
    const before = mailsTo(email).length
    const res = await authCall('/sign-in/email', { body: { email, password: PASSWORD }, cap: goodToken() })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { code?: string }).code).toBe('EMAIL_NOT_VERIFIED')
    expect(mailsTo(email).length).toBe(before)
  })

  test('重新发送 sends a verification mail to an unverified address and nothing to a verified one', async () => {
    const pending = address('resend-pending')
    await signUpWith(pending)
    const res1 = await authCall('/send-verification-email', { body: { email: pending, callbackURL: '/verify-email' } })
    expect(res1.status).toBe(200)
    expect(subjects(pending)).toEqual([VERIFY, VERIFY])

    const done = address('resend-done')
    await signUpWith(done)
    await withClient(DATABASE_URL, (c) => c.query('update users set email_verified = true where email = $1', [done]))
    const res2 = await authCall('/send-verification-email', { body: { email: done, callbackURL: '/verify-email' } })
    // the same answer either way, which is why the page says a verified address gets nothing
    expect(res2.status).toBe(200)
    expect(subjects(done)).toEqual([VERIFY])
  })
})
