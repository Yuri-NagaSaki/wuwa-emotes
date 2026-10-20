// Manual check in headless Chromium against a local production build (not part of `bun test`) of the
// signed-in hint (src/shared/signed-in-hint.ts). Cloudflare's cache key ignores cookies, so a signed-in
// browser can be served a public page's anonymous HTML from the edge cache. The CDN is simulated: the
// script fetches the pack page without cookies (its Cache-Control must be shareable) and serves
// those bytes to the browser for the document request (request interception, cf-cache-status HIT).
//
//   1. signed in (sign-in from the page, so the browser stores the real Set-Cookies): the header shows the
//      avatar instead of 登录 and the composer reads 以 <name> 的身份评论, both within 1 s of
//      DOMContentLoaded, and 登录 is never painted on the way; 1b. the same on an aged copy of /packs,
//      reporting which page loaders run again;
//   2. 模拟登录 (a 站长 browsing as that user): the same plus the 模拟登录 bar;
//   3. signed in, page from the origin (private HTML): avatar in the HTML, no getPublicConfig request;
//   4. anonymous browser: no getPublicConfig request, 登录 and the guest composer;
//   5. stale hint (hint cookie, no session): the HTML stays public, one getPublicConfig request, the hint
//      is dropped, 登录 shown;
//   6. after sign-out (scenario 1's browser): no hint, no request, 登录.
//
//   bun run build && bun tests/pages/cached-viewer.ts [port=3266] [outDir=.work/cached-viewer] [server=.output/server/index.mjs]
//
// It owns what it touches: database chaochi_lane_v_hint (dropped, migrated, filled by
// tests/pages/characters-fixture.ts), bucket chaochi-lane-v-hint, a Cap Standalone stand-in (siteverify
// only: the script mints the tokens it sends) and the server (NODE_ENV=production: cookies are
// __Secure- and Secure, which Chromium accepts on http://localhost). No SMTP, so sign-up signs in.
// getPublicConfig is recognised by its server-function id, read from the server build.
import { mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import pg from 'pg'
import puppeteer, { type Browser, type BrowserContext, type HTTPRequest, type Page } from 'puppeteer-core'
import { PRIVATE_NO_STORE } from '#/server/http/security'
import { SIGNED_IN_HINT, VIEWER_PENDING_ATTR } from '#/shared/signed-in-hint'

const ROOT = join(import.meta.dir, '..', '..')
const PORT = Number(process.argv[2] ?? 3266)
const OUT = resolve(process.argv[3] ?? join(ROOT, '.work', 'cached-viewer'))
const SERVER = resolve(ROOT, process.argv[4] ?? '.output/server/index.mjs')
const BASE = `http://localhost:${PORT}`
const DB = 'chaochi_lane_v_hint'
const BUCKET = 'chaochi-lane-v-hint'
const PG = 'postgres://chaochi:chaochi@127.0.0.1:5432'
const CAP_SECRET = 'lane-v-hint-cap-secret'
const PASSWORD = 'lane-v-hint-password-123'
/** Budget from DOMContentLoaded to the signed-in header and composer. */
const BUDGET_MS = 1000
/** A Cache-Control that lets Cloudflare store the response (security.ts decideCacheControl). */
const shared = (cc: string | null | undefined) => !!cc && /(^|[\s,])public([\s,]|$)/.test(cc) && /s-maxage=\d+/.test(cc) && !/private|no-store|no-cache/.test(cc)
mkdirSync(OUT, { recursive: true })

const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const failures: string[] = []
function check(ok: boolean, what: string) {
  console.log(ok ? 'ok  ' : 'FAIL', what)
  if (!ok) failures.push(what)
}

// ---------- Cap Standalone stand-in: siteverify accepts the tokens this script minted, once ----------

const minted = new Set<string>()
const capServer = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    if (new URL(req.url).pathname !== '/vh/siteverify') return new Response('not found', { status: 404 })
    const body = (await req.json().catch(() => ({}))) as { secret?: string; response?: string }
    if (body.secret !== CAP_SECRET) return Response.json({ success: false }, { status: 403 })
    return Response.json({ success: typeof body.response === 'string' && minted.delete(body.response) })
  },
})
function capToken(): string {
  const t = `vh-${crypto.randomUUID()}`
  minted.add(t)
  return t
}

// ---------- environment ----------

const ENV: Record<string, string> = {
  NODE_ENV: 'production',
  PORT: String(PORT),
  SITE_URL: BASE,
  DATABASE_URL: `${PG}/${DB}`,
  AUTH_SECRET: 'lane-v-hint-auth-secret-0123456789abcdef',
  IP_HASH_SALT: 'lane-v-hint-salt',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_PUBLIC_ENDPOINT: '',
  S3_REGION: 'auto',
  S3_BUCKET: BUCKET,
  S3_ACCESS_KEY_ID: 'devaccess',
  S3_SECRET_ACCESS_KEY: 'devsecret123',
  S3_FORCE_PATH_STYLE: 'true',
  ALLOW_PROD_BUCKET: '',
  CAP_API_ENDPOINT: `http://127.0.0.1:${capServer.port}/vh/`,
  CAP_SITE_KEY: 'vh',
  CAP_SECRET_KEY: CAP_SECRET,
  CAP_DISABLED: '',
  SMTP_URL: '',
  MAIL_FROM: '',
  CF_ZONE_ID: '',
  CF_PURGE_TOKEN: '',
  LOG_LEVEL: 'warn',
}

async function run(cmd: string[], env: Record<string, string>) {
  const p = Bun.spawn(cmd, { cwd: ROOT, env: { ...process.env, ...env }, stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (code !== 0) throw new Error(`${cmd.join(' ')} failed (${code}):\n${out}\n${err}`)
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

async function prepare() {
  const c = new pg.Client({ connectionString: `${PG}/postgres` })
  await c.connect()
  await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`)
  await c.query(`CREATE DATABASE "${DB}"`)
  await c.end()
  const s3 = new S3Client({ region: 'auto', endpoint: ENV.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'devaccess', secretAccessKey: 'devsecret123' } })
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }))
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
  }
  await run(['bun', 'src/migrate.ts'], { ...ENV, NODE_ENV: 'development', LOG_LEVEL: 'warn' })
  await run(['bun', 'tests/pages/characters-fixture.ts'], { ...ENV, NODE_ENV: 'development', LOG_LEVEL: 'warn' })
}

function startServer() {
  const p = Bun.spawn(['bun', SERVER], { cwd: ROOT, env: { ...process.env, ...ENV }, stdout: 'pipe', stderr: 'pipe' })
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

/** Server-function id → name in this server build (the SSR manifest), to label the requests seen. */
function serverFnNames(): Map<string, string> {
  const names = new Map<string, string>()
  const dir = join(dirname(SERVER), '_ssr')
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.mjs')) continue
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/"([0-9a-f]{64})":\s*\{\s*functionName:\s*"(\w+?)_createServerFn_handler"/g)) names.set(m[1]!, m[2]!)
  }
  if (![...names.values()].includes('getPublicConfig')) throw new Error(`getPublicConfig not found in the server build under ${dir}`)
  return names
}

// ---------- browser ----------

// Runs in the page before any of its scripts: per animation frame (before each paint) record when the
// header and composer states first appear, and whether 登录 is painted visibly at any point.
const PROBE = `(() => {
  const h = (window.__probe = { dcl: null, pendingAtDcl: null, pendingRemovedAt: null, loginVisibleAt: null, loginVisibleWhy: null, avatarAt: null, whoAt: null, guestAt: null, impAt: null })
  new MutationObserver(() => {
    if (h.pendingRemovedAt === null && h.pendingAtDcl && !document.documentElement.hasAttribute(${JSON.stringify(VIEWER_PENDING_ATTR)})) h.pendingRemovedAt = performance.now()
  }).observe(document, { attributes: true, subtree: true, attributeFilter: [${JSON.stringify(VIEWER_PENDING_ATTR)}] })
  document.addEventListener('DOMContentLoaded', () => {
    h.dcl = performance.now()
    h.pendingAtDcl = document.documentElement.hasAttribute(${JSON.stringify(VIEWER_PENDING_ATTR)})
  })
  const tick = () => {
    const t = performance.now()
    const login = document.querySelector('.head .user-slot[href="/login"]')
    if (login && h.loginVisibleAt === null) {
      const s = getComputedStyle(login)
      if (s.visibility !== 'hidden' && s.display !== 'none') {
        h.loginVisibleAt = t
        h.loginVisibleWhy = { pending: document.documentElement.hasAttribute(${JSON.stringify(VIEWER_PENDING_ATTR)}), sheets: document.styleSheets.length }
      }
    }
    if (h.avatarAt === null && document.querySelector('.head a.user-slot.avatar')) h.avatarAt = t
    if (h.whoAt === null && document.querySelector('.cmt-composer .who')) h.whoAt = t
    if (h.guestAt === null && document.querySelector('.cmt-composer .guest')) h.guestAt = t
    if (h.impAt === null && document.querySelector('.imp-bar')) h.impAt = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})()`

interface Probe {
  dcl: number | null
  pendingAtDcl: boolean | null
  pendingRemovedAt: number | null
  loginVisibleWhy: unknown
  loginVisibleAt: number | null
  avatarAt: number | null
  whoAt: number | null
  guestAt: number | null
  impAt: number | null
}

interface Lane {
  name: string
  ctx: BrowserContext
  page: Page
  /** server-function requests: name (or id) and ms since the lane's current navigation started */
  fns: { fn: string; method: string; at: number }[]
  navStart: number
  /** anonymous HTML to serve for this path, if any (the simulated CDN hit) */
  replay: { path: string; html: string; cacheControl: string } | null
  errors: string[]
}

let fnNames = new Map<string, string>()
let ipSeq = 0
/** `clockShiftMs`: the page's Date.now() runs ahead, so the HTML's loader data looks that much older. */
async function lane(browser: Browser, name: string, clockShiftMs = 0): Promise<Lane> {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: 1280, height: 860 })
  // a client address of its own, so Better Auth's per-IP limits count each lane separately
  await page.setExtraHTTPHeaders({ 'cf-connecting-ip': `10.86.0.${++ipSeq}` })
  await page.evaluateOnNewDocument(PROBE)
  if (clockShiftMs) await page.evaluateOnNewDocument(`(() => { const now = Date.now; Date.now = () => now() + ${clockShiftMs} })()`)
  const l: Lane = { name, ctx, page, fns: [], navStart: Date.now(), replay: null, errors: [] }
  page.on('pageerror', (e) => l.errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && l.errors.push(m.text()))
  await page.setRequestInterception(true)
  page.on('request', (r: HTTPRequest) => {
    const u = new URL(r.url())
    if (u.pathname.startsWith('/_serverFn/')) {
      const id = u.pathname.slice('/_serverFn/'.length)
      l.fns.push({ fn: fnNames.get(id) ?? id, method: r.method(), at: Date.now() - l.navStart })
    }
    if (l.replay && r.resourceType() === 'document' && u.origin === BASE && u.pathname === l.replay.path) {
      void r.respond({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'cache-control': l.replay.cacheControl, 'cf-cache-status': 'HIT' }, body: l.replay.html })
      return
    }
    void r.continue()
  })
  return l
}

async function visit(l: Lane, path: string, settleMs = 2500): Promise<{ probe: Probe; cacheControl: string | null }> {
  // a real navigation every time (goto to the same URL with a #hash would only scroll)
  await l.page.goto('about:blank')
  l.fns = []
  l.navStart = Date.now()
  const res = await l.page.goto(`${BASE}${path}`, { waitUntil: 'load' })
  await sleep(settleMs)
  const probe = (await l.page.evaluate('window.__probe')) as Probe
  return { probe, cacheControl: res?.headers()['cache-control'] ?? null }
}

async function signUp(l: Lane, label: string): Promise<{ id: string; email: string; name: string }> {
  await l.page.goto(`${BASE}/api/health`)
  const email = `${label}-${Date.now()}@lane-v.test`
  const name = label === 'owner' ? '潮池站长' : '漂泊者小号'
  const out = (await l.page.evaluate(
    async (token: string, body: string) => {
      const r = await fetch('/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cap-token': token }, body })
      return { status: r.status, json: await r.json().catch(() => null) }
    },
    capToken(),
    JSON.stringify({ email, password: PASSWORD, name }),
  )) as { status: number; json: { user?: { id: string } } | null }
  if (out.status !== 200 || !out.json?.user) throw new Error(`${l.name}: sign-up failed (${out.status})`)
  return { id: out.json.user.id, email, name }
}

/** Sign in from the page (the account was made from Node, so this browser holds no cookie until now). */
async function signIn(l: Lane, email: string) {
  await l.page.goto(`${BASE}/api/health`)
  const status = await l.page.evaluate(
    async (token: string, body: string) =>
      (await fetch('/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cap-token': token }, body })).status,
    capToken(),
    JSON.stringify({ email, password: PASSWORD, rememberMe: true }),
  )
  if (status !== 200) throw new Error(`${l.name}: sign-in failed (${status})`)
}

/** An account made outside any browser. */
async function createAccount(label: string): Promise<{ id: string; email: string; name: string }> {
  const email = `${label}-${Date.now()}@lane-v.test`
  const name = '漂泊者小号'
  const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE, 'x-cap-token': capToken(), 'cf-connecting-ip': '10.86.1.1' },
    body: JSON.stringify({ email, password: PASSWORD, name }),
  })
  const json = (await res.json().catch(() => null)) as { user?: { id: string } } | null
  if (res.status !== 200 || !json?.user) throw new Error(`sign-up failed (${res.status})`)
  return { id: json.user.id, email, name }
}

async function cookie(l: Lane, name: string) {
  return (await l.ctx.cookies()).find((c) => c.name === name)
}

async function shot(l: Lane, tag: string) {
  await l.page.screenshot({ path: join(OUT, `${tag}.png`) })
}

const fmt = (p: Probe, at: number | null) => (at === null || p.dcl === null ? null : Math.round(at - p.dcl))

// ---------- run ----------

const report: Record<string, unknown> = { server: SERVER }
let exitCode = 0
log('preparing database, bucket and catalog fixture')
await prepare()
const server = startServer()
let browser: Browser | undefined
try {
  await waitFor(`${BASE}/api/health`)
  fnNames = serverFnNames()
  const configCalls = (l: Lane) => l.fns.filter((f) => f.fn === 'getPublicConfig')

  const packsHtml = await (await fetch(`${BASE}/packs?sort=new`)).text()
  const slug = /href="\/packs\/([^"?#]+)"/.exec(packsHtml)?.[1]
  if (!slug) throw new Error('no pack on /packs')
  const path = `/packs/${slug}`

  // the edge cache's copy: what an anonymous request leaves in Cloudflare
  const anon = await fetch(`${BASE}${path}`)
  const anonHtml = await anon.text()
  const anonCache = anon.headers.get('cache-control') ?? ''
  check(shared(anonCache), `anonymous ${path}: ${anonCache} (shareable)`)
  check(anon.headers.getSetCookie().length === 0, 'anonymous HTML sets no cookie')
  check(anonHtml.includes('href="/login"') && !anonHtml.includes('个人中心（'), 'anonymous HTML has 登录 and no viewer')
  report.page = path

  browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })

  // 1. signed in, anonymous HTML from the "edge cache"
  const a = await lane(browser, 'signed-in')
  const user = await createAccount('fan')
  await signIn(a, user.email)
  const hint = await cookie(a, SIGNED_IN_HINT)
  const sessionName = (await a.ctx.cookies()).find((c) => /better-auth\.session_token$/.test(c.name))?.name ?? null
  report.cookiesAfterSignIn = (await a.ctx.cookies()).map((c) => ({ name: c.name, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite, days: c.expires > 0 ? Math.round((c.expires * 1000 - Date.now()) / 86_400_000) : 'session' }))
  check(sessionName === '__Secure-better-auth.session_token', `session cookie stored (${sessionName})`)
  check(hint?.value === '1' && hint.httpOnly === false && hint.secure === true && hint.sameSite === 'Lax' && hint.path === '/', `hint cookie stored: ${JSON.stringify(hint && { value: hint.value, httpOnly: hint.httpOnly, secure: hint.secure, sameSite: hint.sameSite, path: hint.path })}`)
  a.replay = { path, html: anonHtml, cacheControl: anonCache }
  const r1 = await visit(a, `${path}#comments`)
  report.signedInCached = { probe: r1.probe, fns: [...a.fns], headerMs: fmt(r1.probe, r1.probe.avatarAt), composerMs: fmt(r1.probe, r1.probe.whoAt) }
  await shot(a, '1-signed-in-cached-html')
  check(r1.cacheControl === anonCache, 'browser got the replayed public HTML')
  check(r1.probe.pendingAtDcl === true, `boot script marked <html ${VIEWER_PENDING_ATTR}> before hydration`)
  check(r1.probe.avatarAt !== null && fmt(r1.probe, r1.probe.avatarAt)! <= BUDGET_MS, `header shows the signed-in avatar ${fmt(r1.probe, r1.probe.avatarAt)} ms after DOMContentLoaded (≤ ${BUDGET_MS})`)
  check(r1.probe.whoAt !== null && fmt(r1.probe, r1.probe.whoAt)! <= BUDGET_MS && r1.probe.guestAt === null, `composer is the signed-in one ${fmt(r1.probe, r1.probe.whoAt)} ms after DOMContentLoaded, guest fields never shown`)
  check(r1.probe.loginVisibleAt === null, `登录 never painted (first visible at ${r1.probe.loginVisibleAt === null ? '-' : fmt(r1.probe, r1.probe.loginVisibleAt) + ' ms'})`)
  check(configCalls(a).length >= 1, `getPublicConfig re-checked the viewer (${configCalls(a).length} request(s))`)
  console.log('     server functions after load:', a.fns.map((f) => `${f.fn}@${f.at}`).join(' '))
  check(!(await a.page.evaluate((n) => document.documentElement.hasAttribute(n), VIEWER_PENDING_ATTR)), 'pending attribute removed')
  const whoText = await a.page.$eval('.cmt-composer .who', (el) => el.textContent ?? '').catch(() => '')
  check(whoText.includes(user.name), `composer: "${whoText.trim()}"`)
  // the same browser on a client-side navigation keeps the viewer (root loader data, staleTime Infinity)
  await a.page.evaluate(() => (document.querySelector('header a[href="/packs"]') as HTMLAnchorElement).click())
  await a.page.waitForFunction(() => location.pathname === '/packs', { timeout: 10_000 })
  await sleep(800)
  check(!!(await a.page.$('.head a.user-slot.avatar')), 'avatar still shown after a client-side navigation')

  // 1b. an aged copy of /packs (the page's clock 5 minutes ahead, past the loader's staleTime): does
  // invalidating the root match run the page's loader again too? (Reported; the pack page above keeps
  // its data in a client-side cache, so /packs is the page to look at.)
  const listAnon = await fetch(`${BASE}/packs`)
  const listHtml = await listAnon.text()
  const g = await lane(browser, 'signed-in-aged-copy', 5 * 60_000)
  await signUp(g, 'aged')
  g.replay = { path: '/packs', html: listHtml, cacheControl: listAnon.headers.get('cache-control') ?? '' }
  const r1b = await visit(g, '/packs')
  const aheadMs = (await g.page.evaluate('Date.now() - (performance.timeOrigin + performance.now())')) as number
  report.signedInAgedCopy = { clockAheadMs: Math.round(aheadMs), probe: r1b.probe, fns: [...g.fns], headerMs: fmt(r1b.probe, r1b.probe.avatarAt) }
  check(aheadMs > 4 * 60_000, `aged copy: page clock ${Math.round(aheadMs / 1000)} s ahead`)
  check(r1b.probe.avatarAt !== null && fmt(r1b.probe, r1b.probe.avatarAt)! <= BUDGET_MS && r1b.probe.loginVisibleAt === null, `aged copy: avatar ${fmt(r1b.probe, r1b.probe.avatarAt)} ms after DOMContentLoaded, 登录 never painted`)
  console.log('     aged copy of /packs, server functions after load:', g.fns.map((f) => `${f.fn}@${f.at}`).join(' '))

  // 3. signed in, private HTML straight from the origin: viewer in the HTML, nothing to re-check
  a.replay = null
  const r3 = await visit(a, '/packs', 1500)
  report.signedInPrivate = { cacheControl: r3.cacheControl, probe: r3.probe, fns: [...a.fns] }
  check(r3.cacheControl === PRIVATE_NO_STORE, `signed-in /packs from the origin: ${r3.cacheControl}`)
  check(r3.probe.avatarAt !== null && r3.probe.loginVisibleAt === null, 'avatar in the private HTML, 登录 never painted')
  check(configCalls(a).length === 0, `no getPublicConfig request when the HTML already has the viewer (${configCalls(a).length})`)

  // 2. 模拟登录: a 站长 browsing as the user gets the 模拟登录 bar on the cached page
  const o = await lane(browser, 'impersonating')
  const owner = await signUp(o, 'owner')
  await sql(`update users set role = 'admin' where id = $1`, [owner.id])
  const imp = await o.page.evaluate(async (userId: string) => {
    const r = await fetch('/api/auth/admin/impersonate-user', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) })
    return r.status
  }, user.id)
  check(imp === 200, `impersonate-user: ${imp}`)
  check((await cookie(o, SIGNED_IN_HINT))?.value === '1', 'hint cookie present while impersonating')
  o.replay = { path, html: anonHtml, cacheControl: anonCache }
  const r2 = await visit(o, `${path}#comments`)
  report.impersonatingCached = { probe: r2.probe, fns: [...o.fns], barMs: fmt(r2.probe, r2.probe.impAt) }
  await shot(o, '2-impersonating-cached-html')
  check(r2.probe.impAt !== null && fmt(r2.probe, r2.probe.impAt)! <= BUDGET_MS, `模拟登录 bar ${fmt(r2.probe, r2.probe.impAt)} ms after DOMContentLoaded`)
  check(r2.probe.avatarAt !== null && fmt(r2.probe, r2.probe.avatarAt)! <= BUDGET_MS && r2.probe.loginVisibleAt === null, `header avatar ${fmt(r2.probe, r2.probe.avatarAt)} ms after DOMContentLoaded, 登录 never painted`)

  // 4. anonymous browser: no hint, no extra request
  const n = await lane(browser, 'anonymous')
  const r4 = await visit(n, `${path}#comments`)
  report.anonymous = { cacheControl: r4.cacheControl, probe: r4.probe, fns: [...n.fns] }
  await shot(n, '4-anonymous')
  check(shared(r4.cacheControl), `anonymous browser gets the public HTML (${r4.cacheControl})`)
  check(r4.probe.pendingAtDcl === false, 'no pending attribute without the hint')
  check(configCalls(n).length === 0, `anonymous browser makes no getPublicConfig request (${configCalls(n).length}; server functions seen: ${n.fns.length})`)
  check(r4.probe.loginVisibleAt !== null && r4.probe.avatarAt === null, '登录 shown')
  check(r4.probe.guestAt !== null, 'guest composer shown')

  // 5. stale hint: the hint without a session
  const s = await lane(browser, 'stale-hint')
  await s.ctx.setCookie({ name: SIGNED_IN_HINT, value: '1', domain: 'localhost', path: '/', sameSite: 'Lax' })
  const r5 = await visit(s, `${path}#comments`)
  report.staleHint = { cacheControl: r5.cacheControl, probe: r5.probe, fns: [...s.fns] }
  check(shared(r5.cacheControl), `the hint alone keeps the HTML public (${r5.cacheControl})`)
  check(configCalls(s).length === 1, `stale hint: exactly one getPublicConfig request (${configCalls(s).length})`)
  check(!(await cookie(s, SIGNED_IN_HINT)), 'stale hint dropped by the browser')
  check(r5.probe.avatarAt === null && !!(await s.page.$('.head .user-slot[href="/login"]')), '登录 shown after the re-check')
  check(!(await s.page.evaluate((n) => document.documentElement.hasAttribute(n), VIEWER_PENDING_ATTR)), 'pending attribute removed')
  const r5b = await visit(s, `${path}#comments`, 1500)
  report.staleHintNextLoad = { probe: r5b.probe, fns: [...s.fns] }
  check(configCalls(s).length === 0 && r5b.probe.pendingAtDcl === false, 'next page load: no request, no pending attribute')

  // 6. sign-out clears the hint with the session
  a.replay = null
  await a.page.goto(`${BASE}/api/health`)
  const out = await a.page.evaluate(async () => (await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status)
  check(out === 200, `sign-out: ${out}`)
  check(!(await cookie(a, SIGNED_IN_HINT)), 'sign-out cleared the hint cookie')
  a.replay = { path, html: anonHtml, cacheControl: anonCache }
  const r6 = await visit(a, `${path}#comments`, 1500)
  report.signedOut = { probe: r6.probe, fns: [...a.fns] }
  check(configCalls(a).length === 0 && r6.probe.loginVisibleAt !== null && r6.probe.avatarAt === null, `after sign-out: 登录, no getPublicConfig request (${configCalls(a).length})`)

  report.pageErrors = Object.fromEntries([a, g, o, n, s].map((l) => [l.name, l.errors]))
} catch (err) {
  report.error = err instanceof Error ? err.stack : String(err)
  failures.push(`error: ${report.error}`)
} finally {
  await browser?.close()
  server.kill()
  await server.exited
  capServer.stop(true)
  report.failures = failures
  writeFileSync(join(OUT, 'cached-viewer.json'), JSON.stringify(report, null, 2))
}
if (failures.length) {
  console.log(`\n${failures.length} failure(s):\n  ${failures.join('\n  ')}`)
  exitCode = 1
} else console.log('\nok')
process.exit(exitCode)
