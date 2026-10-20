// Manual end-to-end check in headless Chromium (not part of `bun test`):
//   sign-up → sign-out → sign-in → /submit (draft) → upload 2 images straight to storage → 提交审核
//   → an admin approves in /admin/review → the pack is published with derivatives in derived/.
//
//   bun tests/account/e2e-flow.ts [port=3171] [outDir=.work/shots-g]
//
// It owns everything it touches: database chaochi_lane_g_e2e (dropped and migrated), bucket
// chaochi-lane-g-e2e (created, CORS for the dev origin, emptied), a Vite dev server and a worker, both
// started here with NODE_ENV=development and CAP_DISABLED=1 (no Cap secret, so the server does not verify
// tokens). The widget still runs its whole proof of work, against a small local Cap Standalone stand-in:
// the real instance (cap.anibt.net) answers headless Chromium with "Instrumentation timeout" and then
// rate-limits /redeem (429), so it cannot drive an automated run. Screenshots of /submit, /me and
// /admin/review at 1280 and 390 px wide go to outDir.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CreateBucketCommand, DeleteObjectsCommand, HeadBucketCommand, HeadObjectCommand, ListObjectsV2Command, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'
import pg from 'pg'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import sharp from 'sharp'

const PORT = Number(process.argv[2] ?? 3171)
const OUT = process.argv[3] ?? '.work/shots-g'
const ROOT = join(import.meta.dir, '..', '..')
const BASE = `http://localhost:${PORT}`
const DB = 'chaochi_lane_g_e2e'
const BUCKET = 'chaochi-lane-g-e2e'
const PG = 'postgres://chaochi:chaochi@127.0.0.1:5432'

// Cap Standalone stand-in: real challenges for the widget to solve, no instrumentation, any solution redeems.
const capCalls = { challenge: 0, redeem: 0 }
const cap = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch(req) {
    const cors = { 'access-control-allow-origin': BASE, 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    const path = new URL(req.url).pathname
    const random = () => crypto.randomUUID().replace(/-/g, '')
    if (path === '/e2e/challenge') {
      capCalls.challenge++
      return Response.json({ challenge: { c: 8, s: 32, d: 3 }, token: random(), expires: Date.now() + 10 * 60_000 }, { headers: cors })
    }
    if (path === '/e2e/redeem') {
      capCalls.redeem++
      return Response.json({ success: true, token: `e2e-${random()}`, expires: Date.now() + 10 * 60_000 }, { headers: cors })
    }
    return new Response('not found', { status: 404, headers: cors })
  },
})

const ENV: Record<string, string> = {
  NODE_ENV: 'development',
  CAP_API_ENDPOINT: `http://127.0.0.1:${cap.port}/e2e/`,
  SITE_URL: BASE,
  DATABASE_URL: `${PG}/${DB}`,
  AUTH_SECRET: 'lane-g-e2e-auth-secret-0123456789abcdef',
  IP_HASH_SALT: 'lane-g-e2e-salt',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_PUBLIC_ENDPOINT: '',
  S3_BUCKET: BUCKET,
  S3_ACCESS_KEY_ID: 'devaccess',
  S3_SECRET_ACCESS_KEY: 'devsecret123',
  S3_FORCE_PATH_STYLE: 'true',
  CAP_SECRET_KEY: '',
  CAP_DISABLED: '1',
  SMTP_URL: '',
  MAIL_FROM: '',
  LOG_LEVEL: 'warn',
}

mkdirSync(OUT, { recursive: true })
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- environment ----------

async function freshDb() {
  const c = new pg.Client({ connectionString: `${PG}/postgres` })
  await c.connect()
  await c.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`)
  await c.query(`CREATE DATABASE "${DB}"`)
  await c.end()
  const p = Bun.spawn(['bun', 'src/migrate.ts'], { cwd: ROOT, env: { ...process.env, ...ENV, LOG_LEVEL: 'info' }, stdout: 'pipe', stderr: 'pipe' })
  const code = await p.exited
  if (code !== 0) throw new Error(`migrate failed: ${await new Response(p.stderr).text()}`)
}

const s3 = new S3Client({ region: 'auto', endpoint: ENV.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'devaccess', secretAccessKey: 'devsecret123' } })

async function freshBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }))
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
  }
  // presigned PUTs come from the page's origin
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: { CORSRules: [{ AllowedOrigins: [BASE], AllowedMethods: ['PUT', 'GET', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 600 }] },
    }),
  )
  const keys = await listKeys('')
  for (let i = 0; i < keys.length; i += 1000) {
    await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })) } }))
  }
}

async function listKeys(prefix: string): Promise<string[]> {
  const out: string[] = []
  let token: string | undefined
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }))
    for (const o of r.Contents ?? []) if (o.Key) out.push(o.Key)
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return out
}

async function sql<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: ENV.DATABASE_URL })
  await c.connect()
  try {
    return (await c.query(text, params)).rows as T[]
  } finally {
    await c.end()
  }
}

async function images(): Promise<string[]> {
  const dir = join(ROOT, '.work', 'e2e-files')
  mkdirSync(dir, { recursive: true })
  const frame = (w: number, h: number, seed: number, f: number) => {
    const b = Buffer.alloc(w * h * 4)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        const dx = x - w / 2
        const dy = y - h / 2
        const inside = dx * dx + dy * dy < (w / 2.4) ** 2
        b[i] = inside ? (200 + seed * 20 + f * 10) & 255 : 250
        b[i + 1] = inside ? (120 + ((x * 3 + f * 40) & 63)) & 255 : 246
        b[i + 2] = inside ? (90 + ((y * 2 + seed * 30) & 127)) & 255 : 232
        b[i + 3] = 255
      }
    return b
  }
  const w = 160
  const gif = await sharp(Buffer.concat([0, 1, 2, 3, 4, 5].map((f) => frame(w, w, 1, f))), { raw: { width: w, height: w * 6, channels: 4, pageHeight: w } })
    .gif({ delay: Array(6).fill(120), loop: 0 })
    .toBuffer()
  const png = await sharp(frame(w, w, 3, 0), { raw: { width: w, height: w, channels: 4 } }).png().toBuffer()
  const a = join(dir, '招手.gif')
  const b = join(dir, '比心.png')
  writeFileSync(a, gif)
  writeFileSync(b, png)
  return [a, b]
}

function start(name: string, cmd: string[]) {
  const p = Bun.spawn(cmd, { cwd: ROOT, env: { ...process.env, ...ENV }, stdout: 'pipe', stderr: 'pipe' })
  const logFile = join(ROOT, '.work', `e2e-${name}.log`)
  const chunks: string[] = []
  const pump = async (s: ReadableStream<Uint8Array>) => {
    for await (const c of s) {
      chunks.push(new TextDecoder().decode(c))
      writeFileSync(logFile, chunks.join(''))
    }
  }
  void pump(p.stdout)
  void pump(p.stderr)
  return p
}

async function waitFor(url: string, ms = 120_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      // not up yet
    }
    await sleep(500)
  }
  throw new Error(`timed out waiting for ${url}`)
}

// ---------- browser helpers ----------

/** Click the first enabled element matching `selector` whose text is `text` (or contains it, for labels). */
async function clickText(page: Page, selector: string, text: string, exact = !selector.includes('label')) {
  const find = (sel: string, t: string, ex: boolean) =>
    [...document.querySelectorAll(sel)].find((el) => {
      const s = el.textContent?.trim() ?? ''
      return (ex ? s === t : s.includes(t)) && !(el as HTMLButtonElement).disabled
    }) as HTMLElement | undefined
  await page.waitForFunction(`(${find.toString()})(${JSON.stringify(selector)}, ${JSON.stringify(text)}, ${exact}) != null`, { timeout: 30_000 })
  await page.evaluate(`(${find.toString()})(${JSON.stringify(selector)}, ${JSON.stringify(text)}, ${exact}).click()`)
}

async function typeInto(page: Page, selector: string, value: string) {
  await page.waitForSelector(selector, { timeout: 30_000 })
  await page.click(selector, { count: 3 })
  await page.type(selector, value)
}

async function settle(page: Page, ms = 600) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await sleep(ms)
}

async function shoot(browser: Browser, cookies: { name: string; value: string; domain?: string; path?: string }[], path: string, name: string, prepare?: (p: Page) => Promise<void>) {
  for (const v of [
    { tag: '1280', width: 1280, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    { tag: '390', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ]) {
    const ctx = await browser.createBrowserContext()
    await ctx.setCookie(...cookies.map((c) => ({ ...c, domain: 'localhost', path: '/' })))
    const page = await ctx.newPage()
    await page.setViewport(v)
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle0', timeout: 90_000 })
    if (prepare) await prepare(page)
    await settle(page, 900)
    const file = join(OUT, `${name}-${v.tag}.png`)
    await page.screenshot({ path: file, fullPage: true })
    shots.push(file)
    await ctx.close()
  }
}

const shots: string[] = []
const report: Record<string, unknown> = {}

// ---------- run ----------

log('preparing database and bucket')
await freshDb()
await freshBucket()
await new Promise<void>((resolve, reject) => {
  const p = Bun.spawn(['bun', 'scripts/copy-cap-assets.ts'], { cwd: ROOT })
  p.exited.then((c) => (c === 0 ? resolve() : reject(new Error('copy-cap-assets failed'))))
})
const files = await images()

log('starting dev server and worker')
const web = start('web', ['bun', '--bun', 'vite', 'dev', '--port', String(PORT), '--strictPort'])
const worker = start('worker', ['bun', 'src/worker.ts'])
let browser: Browser | undefined
const consoleErrors: string[] = []
let exitCode = 0
try {
  await waitFor(`${BASE}/api/health`)
  browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] })
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  await page.setViewport({ width: 1280, height: 900 })

  // 1. sign up (signs in right away: no mail server, so no verification step)
  const email = `e2e-${Date.now()}@example.com`
  const password = 'tidepool-e2e-2026'
  log('register', email)
  await page.goto(`${BASE}/register`, { waitUntil: 'networkidle0', timeout: 120_000 })
  await typeInto(page, 'input[autocomplete="nickname"]', '今州打工人')
  await typeInto(page, 'input[type="email"]', email)
  await typeInto(page, 'input[autocomplete="new-password"]', password)
  await clickText(page, 'label.check', '我已阅读并同意')
  await clickText(page, 'button', '创建账号')
  await page.waitForFunction(() => location.pathname === '/me', { timeout: 60_000 })
  report.signUp = 'ok'

  // 2. sign out, then sign in again
  await page.goto(`${BASE}/me/settings`, { waitUntil: 'networkidle0' })
  await clickText(page, 'button', '退出')
  await page.waitForFunction(() => location.pathname === '/login', { timeout: 30_000 })
  await typeInto(page, 'input[type="email"]', email)
  await typeInto(page, 'input[type="password"]', password)
  await clickText(page, 'button', '登录')
  await page.waitForFunction(() => location.pathname === '/me', { timeout: 60_000 })
  report.signIn = 'ok'
  log('signed in')

  // 3. /submit: basic info, two uploads, 署名与授权, submit
  await page.goto(`${BASE}/submit`, { waitUntil: 'networkidle0' })
  await typeInto(page, 'input[placeholder^="例如：爱弥斯"]', '爱弥斯 · 新年板牌')
  await typeInto(page, 'textarea[placeholder^="一句话介绍"]', '新年限定板牌，测试用。')
  const input = await page.waitForSelector('input[type="file"]')
  await input!.uploadFile(...files)
  log('uploading')
  await page.waitForFunction(() => [...document.querySelectorAll('.sub-file .st')].filter((el) => el.textContent === '完成').length === 2, { timeout: 120_000 })
  report.uploads = await page.$$eval('.sub-file .st', (els) => els.map((e) => e.textContent))
  log('uploads done', report.uploads)
  await typeInto(page, 'input[aria-label="画师"]', '示例画师')
  await page.keyboard.press('Enter')
  await typeInto(page, 'textarea[placeholder^="例如：已获画师同意"]', '我画的，同意在本站以 CC BY-NC-SA 4.0 公开分享。')
  await clickText(page, '.sub-submit label.check', '我已阅读投稿规范')
  await clickText(page, 'button', '保存草稿')
  await sleep(800)
  const cookies = (await ctx.cookies()).map((c) => ({ name: c.name, value: c.value }))
  // the filled form, before it is sent
  await shoot(browser, cookies, `/me/submissions/${(await sql<{ id: string }>(`select id from submissions order by created_at desc limit 1`))[0]!.id}`, 'submit')
  await clickText(page, '.sub-submit button', '提交审核')
  await page.waitForFunction(() => location.pathname === '/me/submissions', { timeout: 60_000 })
  const [sub] = await sql<{ id: string; status: string; pack_id: number }>(`select id, status, pack_id from submissions order by created_at desc limit 1`)
  report.submitted = sub
  if (sub?.status !== 'pending') throw new Error(`expected a pending submission, got ${JSON.stringify(sub)}`)
  log('submitted', sub.id)
  await shoot(browser, cookies, '/me/submissions', 'me-submissions-pending')

  // 4. an admin approves it
  const adminCtx = await browser.createBrowserContext()
  const admin = await adminCtx.newPage()
  admin.on('pageerror', (e) => consoleErrors.push(String(e)))
  await admin.setViewport({ width: 1280, height: 900 })
  const adminEmail = `e2e-admin-${Date.now()}@example.com`
  await admin.goto(`${BASE}/register`, { waitUntil: 'networkidle0' })
  await typeInto(admin, 'input[autocomplete="nickname"]', '潮池站长')
  await typeInto(admin, 'input[type="email"]', adminEmail)
  await typeInto(admin, 'input[autocomplete="new-password"]', password)
  await clickText(admin, 'label.check', '我已阅读并同意')
  await clickText(admin, 'button', '创建账号')
  await admin.waitForFunction(() => location.pathname === '/me', { timeout: 60_000 })
  await sql(`update users set role = 'admin' where email = $1`, [adminEmail])
  const adminCookies = (await adminCtx.cookies()).map((c) => ({ name: c.name, value: c.value }))
  await shoot(browser, adminCookies, '/admin/review', 'admin-review')
  await admin.goto(`${BASE}/admin/review`, { waitUntil: 'networkidle0' })
  await clickText(admin, '.rv-acts button', '通过并发布')
  await admin.waitForSelector('.modal', { timeout: 15_000 })
  await settle(admin, 400)
  await admin.screenshot({ path: join(OUT, 'admin-review-approve-1280.png') })
  shots.push(join(OUT, 'admin-review-approve-1280.png'))
  await clickText(admin, '.modal button', '通过并发布')
  await admin.waitForFunction(() => document.querySelector('.rv.is-done') || !document.querySelector('.rv'), { timeout: 60_000 })
  log('approved')
  await sleep(1500)

  // 5. the pack is public: published rows, derivatives in derived/, no review copies left
  const [pack] = await sql<{ status: string; slug: string; emoji_count: number; downloadable: boolean }>(`select status, slug, emoji_count, downloadable from packs where id = $1`, [sub.pack_id])
  const emojis = await sql<{ id: string; status: string; storage_pack_key: string; variant_rev: number; frames: number; derived_ready: boolean }>(
    `select id, status, storage_pack_key, variant_rev, frames, derived_ready from emojis where pack_id = $1 order by sort_order`,
    [sub.pack_id],
  )
  const derived = await listKeys('derived/v1/')
  const review = await listKeys('review/v1/')
  const imgStatus = await Promise.all(
    emojis.map(async (e) => (await fetch(`${BASE}/img/v1/p240/${e.storage_pack_key}/${e.id}.r${e.variant_rev}.webp`)).status),
  )
  report.published = { pack, emojis, derived, review, imgStatus }
  const [after] = await sql<{ status: string }>(`select status from submissions where id = $1`, [sub.id])
  const notice = await sql<{ kind: string }>(`select n.kind from notifications n join submissions s on s.submitter_id = n.user_id where s.id = $1`, [sub.id])
  report.after = { submission: after?.status, notifications: notice.map((n) => n.kind) }
  const ok =
    pack?.status === 'published' &&
    emojis.length === 2 &&
    emojis.every((e) => e.status === 'published' && e.derived_ready) &&
    emojis.every((e) => derived.some((k) => k.includes(e.id))) &&
    review.length === 0 &&
    imgStatus.every((s) => s === 200) &&
    after?.status === 'approved'
  for (const e of emojis) {
    const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: `derived/v1/p240/${e.storage_pack_key}/${e.id}.r${e.variant_rev}.webp` })).catch(() => null)
    if (!h) throw new Error(`missing derived p240 for ${e.id}`)
  }
  await shoot(browser, adminCookies, '/admin/review?tab=approved', 'admin-review-approved')
  await shoot(browser, cookies, '/me/notifications', 'me-notifications')
  await shoot(browser, cookies, '/me/submissions', 'me-submissions')

  // 6. 收藏夹 with content: the heart buttons belong to the pack pages, so favorites are added in SQL
  const [user] = await sql<{ id: string }>(`select submitter_id as id from submissions where id = $1`, [sub.id])
  // the default folder was created when /me was first opened
  const [folder] = await sql<{ id: number }>(`select id from favorite_folders where user_id = $1 and is_default`, [user!.id])
  const [chat] = await sql<{ id: number }>(`insert into favorite_folders (user_id, name) values ($1, '聊天常用') returning id`, [user!.id])
  await sql(`insert into favorites (user_id, folder_id, target_type, target_id) values ($1, $2, 'pack', $3)`, [user!.id, folder!.id, String(sub.pack_id)])
  for (const e of emojis) await sql(`insert into favorites (user_id, folder_id, target_type, target_id) values ($1, $2, 'emoji', $3)`, [user!.id, folder!.id, e.id])
  await sql(`insert into favorites (user_id, folder_id, target_type, target_id) values ($1, $2, 'emoji', $3)`, [user!.id, chat!.id, emojis[0]!.id])
  await shoot(browser, cookies, '/me', 'me')
  await shoot(browser, cookies, '/me/settings', 'me-settings')
  await shoot(browser, [], '/login', 'login')
  report.result = ok ? 'PASS' : 'FAIL'
  if (!ok) exitCode = 1
} catch (err) {
  report.error = err instanceof Error ? err.stack : String(err)
  exitCode = 1
} finally {
  report.consoleErrors = consoleErrors
  report.capCalls = capCalls
  report.shots = shots
  await browser?.close()
  web.kill()
  worker.kill()
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
process.exit(exitCode)
