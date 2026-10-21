// Manual end-to-end check of the account pages in headless Chromium against a local production build
// (not part of `bun test`). Once at 1440 px and once at 390 px:
//   注册 → 「验证邮件已发出」 → 重新发送 (no Cap token) → the link from the mail → 邮箱已验证 → /me tabs
//   and /submit → 退出 → 登录 → 退出 → 找回密码 → the link from the mail → 新密码 → 登录 with it
// then, in contexts of their own (their 4xx/5xx responses are logged by the browser): a wrong password,
// an unverified account with 重新发送 from the login page, and a Cap server that fails until 重试.
//
//   bun run build && bun tests/account/auth-flow.ts [outDir=.work/shots-ua] [port=3182]
//
// It owns what it touches: database chaochi_lane_ua_e2e (dropped and migrated), bucket
// chaochi-lane-ua-e2e, a Cap Standalone stand-in (challenge / redeem / siteverify; a token verifies
// once), an SMTP sink that appends every message to <outDir>/mail.log, and the server
// (NODE_ENV=production: Cap tokens are verified for real and sign-up needs the mailed link).
// After every step it checks that no Cap widget takes up space or shows its labels and that every
// child of the auth card spans the card; /me and /submit get the same check for their columns.
// Screenshots: <outDir>/app-<state>-<1440|390>.png; results: <outDir>/auth-flow.json.
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import pg from 'pg'
import puppeteer, { type Browser, type BrowserContext, type HTTPRequest, type Page } from 'puppeteer-core'

const ROOT = join(import.meta.dir, '..', '..')
const OUT = process.argv[2] ?? join(ROOT, '.work', 'shots-ua')
const PORT = Number(process.argv[3] ?? 3182)
const BASE = `http://localhost:${PORT}`
const DB = 'chaochi_lane_ua_e2e'
const BUCKET = 'chaochi-lane-ua-e2e'
const PG = 'postgres://chaochi:chaochi@127.0.0.1:5432'
const CAP_SECRET = 'lane-ua-e2e-cap-secret'
mkdirSync(OUT, { recursive: true })
const MAIL_LOG = join(OUT, 'mail.log')
writeFileSync(MAIL_LOG, '')

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- Cap Standalone stand-in ----------

const cap = { challenge: 0, redeem: 0, siteverify: 0, verified: 0, fail: false, delayMs: 0 }
const issued = new Set<string>()
const capServer = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const cors = {
      'access-control-allow-origin': BASE,
      'access-control-allow-headers': 'content-type, cf-connecting-ip',
      'access-control-allow-methods': 'POST, OPTIONS',
    }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    const path = new URL(req.url).pathname
    const random = () => crypto.randomUUID().replace(/-/g, '')
    if (path === '/ua/challenge') {
      cap.challenge++
      if (cap.delayMs) await sleep(cap.delayMs)
      if (cap.fail) return new Response('unavailable', { status: 503, headers: cors })
      return Response.json({ challenge: { c: 8, s: 32, d: 3 }, token: random(), expires: Date.now() + 10 * 60_000 }, { headers: cors })
    }
    if (path === '/ua/redeem') {
      cap.redeem++
      const token = `ua-${random()}`
      issued.add(token)
      return Response.json({ success: true, token, expires: Date.now() + 10 * 60_000 }, { headers: cors })
    }
    if (path === '/ua/siteverify') {
      cap.siteverify++
      const body = (await req.json().catch(() => ({}))) as { secret?: string; response?: string }
      if (body.secret !== CAP_SECRET) return Response.json({ success: false }, { status: 403 })
      const ok = typeof body.response === 'string' && issued.delete(body.response)
      if (ok) cap.verified++
      return Response.json({ success: ok })
    }
    return new Response('not found', { status: 404, headers: cors })
  },
})

// ---------- SMTP sink ----------

interface Mail {
  to: string
  subject: string
  text: string
}
const mails: Mail[] = []

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
  return raw.replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_, kind: string, text: string) =>
    kind.toLowerCase() === 'b' ? Buffer.from(text, 'base64').toString('utf8') : decodeBody('content-transfer-encoding: quoted-printable', text.replace(/_/g, ' ')),
  )
}

function storeMail(raw: string, rcpt: string[]) {
  const split = raw.indexOf('\r\n\r\n')
  const headers = raw.slice(0, split)
  const unfolded = headers.replace(/\r\n[ \t]+/g, ' ')
  const subject = decodeSubject(/^subject:\s*(.*)$/im.exec(unfolded)?.[1] ?? '')
  const text = decodeBody(headers, raw.slice(split + 4))
  const mail = { to: rcpt[0] ?? '', subject, text }
  mails.push(mail)
  appendFileSync(MAIL_LOG, `--- ${new Date().toISOString()} to ${mail.to}\nSubject: ${subject}\n\n${text}\n\n`)
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
      // headers and bodies are 7-bit (no 8BITMIME advertised), so per-chunk decoding is safe
      s.data.buf += Buffer.from(chunk).toString('latin1')
      for (let i = s.data.buf.indexOf('\r\n'); i >= 0; i = s.data.buf.indexOf('\r\n')) {
        const line = s.data.buf.slice(0, i)
        s.data.buf = s.data.buf.slice(i + 2)
        if (s.data.inData) {
          if (line === '.') {
            s.data.inData = false
            storeMail(s.data.lines.join('\r\n'), s.data.rcpt)
            s.data.lines = []
            s.data.rcpt = []
            s.write('250 queued\r\n')
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

async function mailLink(to: string, count: number, pattern: RegExp): Promise<string> {
  const end = Date.now() + 30_000
  while (Date.now() < end) {
    const mine = mails.filter((m) => m.to === to)
    if (mine.length >= count) {
      const url = /https?:\/\/\S+/.exec(mine[count - 1]!.text)?.[0]
      if (url && pattern.test(url)) return url
      throw new Error(`mail ${count} to ${to} has no matching link: ${mine[count - 1]!.text}`)
    }
    await sleep(200)
  }
  throw new Error(`no mail ${count} to ${to} (got ${mails.filter((m) => m.to === to).length})`)
}

// ---------- environment ----------

const ENV: Record<string, string> = {
  NODE_ENV: 'production',
  PORT: String(PORT),
  SITE_URL: BASE,
  DATABASE_URL: `${PG}/${DB}`,
  AUTH_SECRET: 'lane-ua-e2e-auth-secret-0123456789abcdef',
  IP_HASH_SALT: 'lane-ua-e2e-salt',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_PUBLIC_ENDPOINT: '',
  S3_BUCKET: BUCKET,
  S3_ACCESS_KEY_ID: 'devaccess',
  S3_SECRET_ACCESS_KEY: 'devsecret123',
  S3_FORCE_PATH_STYLE: 'true',
  CAP_API_ENDPOINT: `http://127.0.0.1:${capServer.port}/ua/`,
  CAP_SITE_KEY: 'ua',
  CAP_SECRET_KEY: CAP_SECRET,
  CAP_DISABLED: '',
  SMTP_URL: `smtp://127.0.0.1:${smtp.port}`,
  MAIL_FROM: 'chaochi-e2e@example.test',
  LOG_LEVEL: 'warn',
}

async function freshDb() {
  const c = new pg.Client({ connectionString: `${PG}/postgres` })
  await c.connect()
  await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`)
  await c.query(`CREATE DATABASE "${DB}"`)
  await c.end()
  const p = Bun.spawn(['bun', 'src/migrate.ts'], { cwd: ROOT, env: { ...process.env, ...ENV, LOG_LEVEL: 'info' }, stdout: 'pipe', stderr: 'pipe' })
  if ((await p.exited) !== 0) throw new Error(`migrate failed: ${await new Response(p.stderr).text()}`)
}

async function sql(text: string, params: unknown[] = []) {
  const c = new pg.Client({ connectionString: ENV.DATABASE_URL })
  await c.connect()
  try {
    return (await c.query(text, params)).rows
  } finally {
    await c.end()
  }
}

async function bucket() {
  const s3 = new S3Client({ region: 'auto', endpoint: ENV.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'devaccess', secretAccessKey: 'devsecret123' } })
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }))
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
  }
}

function startServer() {
  const p = Bun.spawn(['bun', '.output/server/index.mjs'], { cwd: ROOT, env: { ...process.env, ...ENV }, stdout: 'pipe', stderr: 'pipe' })
  const file = join(OUT, 'server.log')
  writeFileSync(file, '')
  const pump = async (s: ReadableStream<Uint8Array>) => {
    for await (const c of s) appendFileSync(file, c)
  }
  void pump(p.stdout)
  void pump(p.stderr)
  return p
}

async function waitFor(url: string, ms = 60_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not up yet
    }
    await sleep(300)
  }
  throw new Error(`timed out waiting for ${url}`)
}

// ---------- browser helpers ----------

interface Viewport {
  tag: '1440' | '390'
  width: number
  height: number
  deviceScaleFactor: number
  isMobile: boolean
  hasTouch: boolean
}
const DESKTOP: Viewport = { tag: '1440', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false }
const PHONE: Viewport = { tag: '390', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

interface AuthRequest {
  path: string
  capHeader: boolean
}

interface Lane {
  name: string
  ctx: BrowserContext
  page: Page
  vw: Viewport
  consoleErrors: string[]
  authRequests: AuthRequest[]
  issues: string[]
}

let ipSeq = 0
async function lane(browser: Browser, name: string, vw: Viewport): Promise<Lane> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport(vw)
  // a client address of its own, so Better Auth's per-IP limits count each lane separately
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': `10.77.0.${++ipSeq}` })
  const l: Lane = { name, ctx, page, vw, consoleErrors: [], authRequests: [], issues: [] }
  page.on('console', (m) => m.type() === 'error' && l.consoleErrors.push(`${m.text()} @ ${m.location()?.url ?? ''}`))
  page.on('pageerror', (e) => l.consoleErrors.push(String(e)))
  page.on('request', (r: HTTPRequest) => {
    const u = new URL(r.url())
    if (u.origin === BASE && u.pathname.startsWith('/api/auth/') && r.method() === 'POST') {
      l.authRequests.push({ path: u.pathname.slice('/api/auth'.length), capHeader: 'x-cap-token' in r.headers() })
    }
  })
  return l
}

/** Click the first enabled element matching `selector` whose text is `text` (or contains it, for labels). */
async function clickText(page: Page, selector: string, text: string, exact = !selector.includes('label')) {
  const find = (sel: string, t: string, ex: boolean) =>
    [...document.querySelectorAll(sel)].find((el) => {
      const s = el.textContent?.trim() ?? ''
      return (ex ? s === t : s.includes(t)) && !(el as HTMLButtonElement).disabled
    }) as HTMLElement | undefined
  const call = `(${find.toString()})(${JSON.stringify(selector)}, ${JSON.stringify(text)}, ${exact})`
  await page.waitForFunction(`${call} != null`, { timeout: 30_000 })
  await page.evaluate(`${call}.click()`)
}

async function typeInto(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 30_000 })
  await page.click(selector, { count: 3 })
  await page.type(selector, value)
}

async function waitText(page: Page, text: string, timeout = 30_000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text)
}

async function waitPath(page: Page, path: string, timeout = 30_000) {
  await page.waitForFunction((p) => location.pathname === p, { timeout }, path)
}

/** Cap stays invisible; columns line up. Returns the problems found. */
async function inspect(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const issues: string[] = []
    const name = (el: Element) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') + ` "${(el.textContent ?? '').trim().slice(0, 18)}"`
    for (const el of document.querySelectorAll('cap-widget')) {
      const r = el.getBoundingClientRect()
      if (getComputedStyle(el).display !== 'none' && (r.width > 0 || r.height > 0)) issues.push('a cap-widget takes up space')
    }
    if (/我是人类|人机验证已通过|排查问题/.test(document.body.innerText)) issues.push('Cap widget text on the page')
    const same = (box: DOMRect, el: Element, what: string) => {
      const r = el.getBoundingClientRect()
      if (!r.width && !r.height) return
      if (Math.abs(r.left - box.left) > 0.5 || Math.abs(r.width - box.width) > 0.5) {
        issues.push(`${what}: ${name(el)} left ${(r.left - box.left).toFixed(1)} width ${r.width.toFixed(1)} of ${box.width.toFixed(1)}`)
      }
    }
    const card = document.querySelector('.auth-card')
    if (card) {
      const box = card.getBoundingClientRect()
      for (const el of card.querySelectorAll(':scope > *, .auth-stack > *, .field > *')) same(box, el, 'auth card')
    }
    // 个人中心: header, tabs and the tab page share one column; so do the rows of a panel
    const meBody = document.querySelector('.me-body')
    if (meBody) {
      const box = meBody.getBoundingClientRect()
      for (const sel of ['.me-h', '.me-tabs']) {
        const el = document.querySelector(sel)
        if (el) same(box, el, '/me column')
      }
      for (const el of meBody.querySelectorAll(':scope > *, .settings-grid > *')) same(box, el, '/me panel')
    }
    const form = document.querySelector('.sub-layout > :first-child')
    if (form) {
      const box = form.getBoundingClientRect()
      for (const el of form.querySelectorAll(':scope > *')) same(box, el, '/submit column')
    }
    // opened settings forms (修改密码) and the 注销 sheet: one column each
    for (const f of document.querySelectorAll('.set-form, .sheet-form')) {
      const box = f.getBoundingClientRect()
      for (const el of f.querySelectorAll(':scope > *, :scope > .field > *')) same(box, el, 'settings form')
    }
    return issues
  })
}

const shots: string[] = []
async function shot(l: Lane, state: string) {
  await l.page.evaluate(() => document.fonts.ready.then(() => undefined))
  await sleep(450)
  // toasts (已退出登录 …) would cover the form
  await l.page.addStyleTag({ content: '.toast-zone { display: none !important; }' })
  const problems = await inspect(l.page)
  for (const p of problems) l.issues.push(`${state}: ${p}`)
  const file = join(OUT, `app-${state}-${l.vw.tag}.png`)
  if (l.vw.isMobile) {
    // the first screen as the visitor sees it (fixed tab bar included); then the whole page with the
    // fixed bars hidden, since a full-page shot would paint them over the middle of the page
    const screen = join(OUT, `app-${state}-${l.vw.tag}-screen.png`)
    await l.page.screenshot({ path: screen as `${string}.png` })
    shots.push(screen)
    const style = await l.page.addStyleTag({ content: '.tabbar, .fab-bottle, .mob-actbar { visibility: hidden !important; }' })
    await l.page.screenshot({ path: file as `${string}.png`, fullPage: true })
    await style.evaluate((el) => el.remove())
  } else {
    await l.page.screenshot({ path: file as `${string}.png`, fullPage: true })
  }
  shots.push(file)
}

function expectCap(l: Lane, path: string, withToken: boolean) {
  const r = [...l.authRequests].reverse().find((x) => x.path === path)
  if (!r) throw new Error(`${l.name}: no request to ${path}`)
  if (r.capHeader !== withToken) throw new Error(`${l.name}: ${path} ${withToken ? 'without' : 'with'} x-cap-token`)
}

// The two main flows run side by side; steps that reach siteverify run one at a time, so its counter
// tells which request caused a call.
let chain: Promise<unknown> = Promise.resolve()
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

/** Run a step and return how many tokens siteverify accepted and how often it was called meanwhile. */
async function counted(fn: () => Promise<void>): Promise<{ verified: number; calls: number }> {
  return exclusive(async () => {
    const v = cap.verified
    const c = cap.siteverify
    await fn()
    return { verified: cap.verified - v, calls: cap.siteverify - c }
  })
}

/** Record every label the form's submit button shows from now on (it is replaced on navigation). */
async function watchSubmitLabels(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __labels: string[] }
    w.__labels = []
    const btn = document.querySelector('form button[type="submit"]')!
    w.__labels.push(btn.textContent ?? '')
    new MutationObserver(() => w.__labels.push(btn.textContent ?? '')).observe(btn, { childList: true, characterData: true, subtree: true })
  })
}
const submitLabels = (page: Page) => page.evaluate(() => (window as unknown as { __labels: string[] }).__labels)

async function logout(l: Lane) {
  await l.page.goto(`${BASE}/me/settings`, { waitUntil: 'networkidle0' })
  await clickText(l.page, '.set-row button', '退出')
  await waitPath(l.page, '/login')
}

// ---------- flows ----------

const PASSWORD = 'tidepool-ua-2026'
const NEW_PASSWORD = 'tidepool-ua-2026-new!'

async function mainFlow(browser: Browser, vw: Viewport, report: Record<string, unknown>) {
  const l = await lane(browser, `main-${vw.tag}`, vw)
  const { page } = l
  const email = `ua-${vw.tag}-${Date.now()}@example.test`
  const steps: string[] = []
  const step = (s: string) => {
    steps.push(s)
    log(l.name, s)
  }
  try {
    // 注册
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle0' })
    await shot(l, 'register')
    await clickText(page, 'button', '创建账号')
    await waitText(page, '用户名需要 2–16 个字符')
    await shot(l, 'register-invalid')
    await typeInto(page, 'input[autocomplete="nickname"]', '今州打工人')
    await typeInto(page, 'input[type="email"]', email)
    await typeInto(page, 'input[autocomplete="new-password"]', PASSWORD)
    await clickText(page, 'label.check', '我已阅读并同意')
    const signUp = await counted(async () => {
      await clickText(page, 'button', '创建账号')
      await waitText(page, '验证邮件已发出')
    })
    expectCap(l, '/sign-up/email', true)
    if (signUp.verified !== 1 || signUp.calls !== 1) throw new Error(`sign-up: siteverify ${JSON.stringify(signUp)}`)
    step('signed up; verification mail sent')
    await shot(l, 'register-sent')

    // 重新发送: no token, no siteverify
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent === '没收到？重新发送' && !b.disabled), { timeout: 75_000 })
    const resend = await counted(async () => {
      await clickText(page, 'button', '没收到？重新发送')
      await waitText(page, '已重新发送')
    })
    expectCap(l, '/send-verification-email', false)
    if (resend.calls !== 0) throw new Error('resend called siteverify')
    step('resent without Cap')
    await shot(l, 'register-resent')

    // the link in the second mail
    const verifyUrl = await mailLink(email, 2, /\/api\/auth\/verify-email\?/)
    await page.goto(verifyUrl, { waitUntil: 'networkidle0' })
    await waitPath(page, '/verify-email')
    await waitText(page, '邮箱已验证')
    step('verified by the mailed link')
    await shot(l, 'verify-ok')

    // 投稿 (the empty form), then a saved draft and two notices so the /me lists have rows
    await page.goto(`${BASE}/submit`, { waitUntil: 'networkidle0' })
    await shot(l, 'submit')
    await typeInto(page, 'input[placeholder^="例如：爱弥斯"]', '爱弥斯 · 新年板牌')
    await clickText(page, '.sub-submit button', '保存草稿')
    for (let i = 0; ; i++) {
      const rows = await sql(`select 1 from submissions s join users u on u.id = s.submitter_id where u.email = $1`, [email])
      if (rows.length) break
      if (i > 60) throw new Error('the draft was not saved')
      await sleep(250)
    }
    await sql(
      `insert into notifications (user_id, kind, payload) select id, 'submission.returned', $2::jsonb from users where email = $1`,
      [email, JSON.stringify({ submissionId: 'none', packId: 0, slug: 'none', title: '达妮娅捏捏 · 第二弹', reason: '缺少画师授权说明' })],
    )
    await sql(
      `insert into notifications (user_id, kind, payload) select id, 'comment.reply', $2::jsonb from users where email = $1`,
      [email, JSON.stringify({ commentId: 1, parentId: 1, rootId: null, threadType: 'pack', threadId: '1', by: '漂泊者', excerpt: '这张也太可爱了吧', title: '爱弥斯动态表情包', href: null })],
    )

    // 个人中心 while signed in
    for (const [path, state] of [
      ['/me', 'me-fav'],
      ['/me/submissions', 'me-sub'],
      ['/me/comments', 'me-cm'],
      ['/me/notifications', 'me-nt'],
      ['/me/settings', 'me-set'],
    ] as const) {
      await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0' })
      await shot(l, state)
    }
    // the settings forms, opened
    await clickText(page, '.set-row button', '修改')
    await page.waitForSelector('.set-form')
    await shot(l, 'me-set-password')
    await clickText(page, '.set-row button', '注销')
    await page.waitForSelector('.sheet-form')
    await shot(l, 'me-set-delete')
    await page.keyboard.press('Escape')
    // the saved draft in the 投稿 editor
    const [draft] = await sql(`select s.id from submissions s join users u on u.id = s.submitter_id where u.email = $1`, [email])
    await page.goto(`${BASE}/me/submissions/${draft.id}`, { waitUntil: 'networkidle0' })
    await shot(l, 'me-sub-edit')

    // 退出 → 登录
    await logout(l)
    await shot(l, 'login')
    await typeInto(page, 'input[type="email"]', email)
    await typeInto(page, 'input[type="password"]', PASSWORD)
    await watchSubmitLabels(page)
    const signIn = await counted(async () => {
      await clickText(page, 'form button[type="submit"]', '登录')
      await waitPath(page, '/me')
    })
    expectCap(l, '/sign-in/email', true)
    if (signIn.verified !== 1) throw new Error(`sign-in: siteverify ${JSON.stringify(signIn)}`)
    // the token was solved in the background while the form was filled in
    const labels = await submitLabels(page)
    if (labels.includes('验证中…')) throw new Error(`sign-in waited for Cap: ${labels.join(' → ')}`)
    report[`${l.name}-signin-labels`] = labels
    step('signed in')
    await logout(l)

    // 找回密码 → reset link → 新密码 → 登录
    await page.goto(`${BASE}/forgot-password`, { waitUntil: 'networkidle0' })
    await shot(l, 'forgot')
    await clickText(page, 'button', '发送重置邮件')
    await waitText(page, '请填写邮箱')
    await shot(l, 'forgot-invalid')
    await typeInto(page, 'input[type="email"]', email)
    const reset = await counted(async () => {
      await clickText(page, 'button', '发送重置邮件')
      await waitText(page, '邮件已发出')
    })
    expectCap(l, '/request-password-reset', true)
    if (reset.verified !== 1) throw new Error(`reset mail: siteverify ${JSON.stringify(reset)}`)
    await shot(l, 'forgot-sent')
    const resetUrl = await mailLink(email, 3, /\/api\/auth\/reset-password\//)
    await page.goto(resetUrl, { waitUntil: 'networkidle0' })
    await waitPath(page, '/reset-password')
    await shot(l, 'reset')
    const [pw1, pw2] = await page.$$('input[type="password"]')
    await pw1!.type(NEW_PASSWORD)
    await pw2!.type(`${NEW_PASSWORD}x`)
    await clickText(page, 'button', '保存新密码')
    await waitText(page, '两次输入的密码不一样')
    await shot(l, 'reset-mismatch')
    await pw2!.click({ count: 3 })
    await pw2!.type(NEW_PASSWORD)
    await clickText(page, 'button', '保存新密码')
    await waitText(page, '密码已更新')
    step('password reset')
    await shot(l, 'reset-done')
    await clickText(page, 'a', '去登录')
    await waitPath(page, '/login')
    await typeInto(page, 'input[type="email"]', email)
    await typeInto(page, 'input[type="password"]', NEW_PASSWORD)
    await counted(async () => {
      await clickText(page, 'form button[type="submit"]', '登录')
      await waitPath(page, '/me')
    })
    step('signed in with the new password')

    // link failures (no requests)
    await page.goto(`${BASE}/verify-email?error=INVALID_TOKEN`, { waitUntil: 'networkidle0' })
    await shot(l, 'verify-error')
    await page.goto(`${BASE}/reset-password?error=INVALID_TOKEN`, { waitUntil: 'networkidle0' })
    await shot(l, 'reset-invalid')
    report[l.name] = { result: 'PASS', email, steps, issues: l.issues, consoleErrors: l.consoleErrors, authRequests: l.authRequests }
    return { email, lane: l }
  } catch (err) {
    await page.screenshot({ path: join(OUT, `fail-${l.name}.png`) as `${string}.png`, fullPage: true }).catch(() => {})
    report[l.name] = { result: 'FAIL', error: err instanceof Error ? err.stack : String(err), steps, issues: l.issues, consoleErrors: l.consoleErrors, authRequests: l.authRequests }
    throw err
  } finally {
    await l.ctx.close()
  }
}

/** Error states: their 4xx/5xx responses are logged by the browser, so they get contexts of their own. */
async function errorFlow(browser: Browser, vw: Viewport, verifiedEmail: string, report: Record<string, unknown>) {
  const l = await lane(browser, `errors-${vw.tag}`, vw)
  const { page } = l
  const notes: string[] = []
  try {
    // wrong password
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
    await typeInto(page, 'input[type="email"]', verifiedEmail)
    await typeInto(page, 'input[type="password"]', 'not-the-password')
    await clickText(page, 'form button[type="submit"]', '登录')
    await waitText(page, '邮箱或密码不正确')
    await shot(l, 'login-error')

    // an unverified account: 重新发送 from the login page, without Cap
    const email = `ua-unverified-${vw.tag}-${Date.now()}@example.test`
    await page.goto(`${BASE}/register`, { waitUntil: 'networkidle0' })
    await typeInto(page, 'input[autocomplete="nickname"]', '未验证')
    await typeInto(page, 'input[type="email"]', email)
    await typeInto(page, 'input[autocomplete="new-password"]', PASSWORD)
    await clickText(page, 'label.check', '我已阅读并同意')
    await clickText(page, 'button', '创建账号')
    await waitText(page, '验证邮件已发出')
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
    await typeInto(page, 'input[type="email"]', email)
    await typeInto(page, 'input[type="password"]', PASSWORD)
    await clickText(page, 'form button[type="submit"]', '登录')
    await waitText(page, '邮箱还没有验证')
    await shot(l, 'login-unverified')
    const before = cap.siteverify
    await clickText(page, '.auth-note button', '重新发送')
    await waitText(page, '验证邮件已发出')
    expectCap(l, '/send-verification-email', false)
    if (cap.siteverify !== before) throw new Error('resend from login called siteverify')
    await mailLink(email, 2, /\/api\/auth\/verify-email\?/)
    notes.push('login 重新发送 without Cap: second mail received')
    await shot(l, 'login-resent')
    report[l.name] = { result: 'PASS', notes, issues: l.issues, consoleErrors: l.consoleErrors, authRequests: l.authRequests }
  } catch (err) {
    await page.screenshot({ path: join(OUT, `fail-${l.name}.png`) as `${string}.png`, fullPage: true }).catch(() => {})
    report[l.name] = { result: 'FAIL', error: err instanceof Error ? err.stack : String(err), notes, issues: l.issues, consoleErrors: l.consoleErrors }
    throw err
  } finally {
    await l.ctx.close()
  }
}

/** A slow Cap server: submitting before the proof of work is done shows 验证中…, then signs in. */
async function slowCapFlow(browser: Browser, vw: Viewport, email: string, report: Record<string, unknown>) {
  const l = await lane(browser, `slowcap-${vw.tag}`, vw)
  const { page } = l
  try {
    cap.delayMs = 4000
    const before = cap.challenge
    await page.goto(`${BASE}/login`, { waitUntil: 'load' })
    // hydrated: the background solve has asked for its challenge (answered 4 s later)
    for (let i = 0; cap.challenge === before; i++) {
      if (i > 100) throw new Error('no background challenge')
      await sleep(50)
    }
    await typeInto(page, 'input[type="email"]', email)
    await typeInto(page, 'input[type="password"]', NEW_PASSWORD)
    await watchSubmitLabels(page)
    await clickText(page, 'form button[type="submit"]', '登录')
    await page.waitForFunction(() => document.querySelector('form button[type="submit"]')?.textContent === '验证中…', { timeout: 3000 })
    await shot(l, 'login-verifying')
    await waitPath(page, '/me', 30_000)
    const labels = await submitLabels(page)
    expectCap(l, '/sign-in/email', true)
    report[l.name] = { result: 'PASS', labels, issues: l.issues, consoleErrors: l.consoleErrors }
  } catch (err) {
    await page.screenshot({ path: join(OUT, `fail-${l.name}.png`) as `${string}.png`, fullPage: true }).catch(() => {})
    report[l.name] = { result: 'FAIL', error: err instanceof Error ? err.stack : String(err), issues: l.issues, consoleErrors: l.consoleErrors }
    throw err
  } finally {
    cap.delayMs = 0
    await l.ctx.close()
  }
}

/**
 * The Cap server fails: the status line above the button says 人机验证没有完成 with 重试; once the
 * server is back, 重试 solves again (已通过人机验证) and 登录 signs in.
 */
async function capFailFlow(browser: Browser, vw: Viewport, email: string, report: Record<string, unknown>) {
  const l = await lane(browser, `capfail-${vw.tag}`, vw)
  const { page } = l
  try {
    cap.fail = true
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0' })
    await typeInto(page, 'input[type="email"]', email)
    await typeInto(page, 'input[type="password"]', NEW_PASSWORD)
    const challengesBefore = cap.challenge
    await clickText(page, 'form button[type="submit"]', '登录')
    await waitText(page, '人机验证没有完成')
    const tries = cap.challenge - challengesBefore
    await shot(l, 'login-capfail')
    cap.fail = false
    await clickText(page, '.cap-line button', '重试')
    await waitText(page, '已通过人机验证')
    await clickText(page, 'form button[type="submit"]', '登录')
    await waitPath(page, '/me')
    expectCap(l, '/sign-in/email', true)
    report[l.name] = { result: 'PASS', challengesOnSubmit: tries, issues: l.issues, consoleErrors: l.consoleErrors }
  } catch (err) {
    await page.screenshot({ path: join(OUT, `fail-${l.name}.png`) as `${string}.png`, fullPage: true }).catch(() => {})
    report[l.name] = { result: 'FAIL', error: err instanceof Error ? err.stack : String(err), issues: l.issues, consoleErrors: l.consoleErrors }
    throw err
  } finally {
    cap.fail = false
    await l.ctx.close()
  }
}

// ---------- run ----------

const report: Record<string, unknown> = {}
let exitCode = 0
log('preparing database and bucket')
await freshDb()
await bucket()
const server = startServer()
let browser: Browser | undefined
try {
  await waitFor(`${BASE}/api/health`)
  browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] })
  const [desk, phone] = await Promise.all([mainFlow(browser, DESKTOP, report), mainFlow(browser, PHONE, report)])
  await errorFlow(browser, DESKTOP, desk.email, report)
  await errorFlow(browser, PHONE, phone.email, report)
  await slowCapFlow(browser, DESKTOP, desk.email, report)
  await slowCapFlow(browser, PHONE, phone.email, report)
  await capFailFlow(browser, DESKTOP, desk.email, report)
  await capFailFlow(browser, PHONE, phone.email, report)
  // contexts whose every response is a success: no console errors allowed
  const clean = ['main-1440', 'main-390', 'slowcap-1440', 'slowcap-390'].map((k) => report[k]) as { consoleErrors: string[]; issues: string[] }[]
  const others = Object.entries(report)
    .filter(([, v]) => !clean.includes(v as never) && typeof v === 'object' && v !== null && 'issues' in v)
    .map(([, v]) => v as { issues: string[] })
  const main = clean
  const consoleErrors = main.flatMap((r) => r.consoleErrors)
  const issues = [...main, ...others].flatMap((r) => r.issues)
  report.summary = { consoleErrorsInCleanFlows: consoleErrors.length, layoutAndCapIssues: issues.length, cap, mails: mails.length }
  if (consoleErrors.length || issues.length) exitCode = 1
} catch (err) {
  report.error = err instanceof Error ? err.stack : String(err)
  exitCode = 1
} finally {
  report.shots = shots
  await browser?.close()
  server.kill()
  await server.exited
  capServer.stop(true)
  smtp.stop(true)
  writeFileSync(join(OUT, 'auth-flow.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ summary: report.summary, error: report.error }, null, 2))
}
process.exit(exitCode)
