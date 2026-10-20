// Manual check in headless Chromium (not part of `bun test`): 模拟登录 → the 结束模拟 bar on site and
// admin pages → 结束模拟 lands on /admin/users as the 站长 again; the 通知 tab with every notice kind;
// the admin top-bar search; a real browser upload through the size-locked presigned PUT.
//
//   bun tests/admin/impersonation-shots.ts [port=3247] [outDir=.work/shots-l]
//
// It owns everything it touches: database chaochi_lane_l_shots (dropped and migrated), bucket
// chaochi-lane-l-shots (created, CORS for the dev origin, emptied) and a Vite dev server started here
// with NODE_ENV=development and CAP_DISABLED=1. Screenshots at 1280 and 390 px go to outDir.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CreateBucketCommand, DeleteObjectsCommand, HeadBucketCommand, ListObjectsV2Command, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3'
import pg from 'pg'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { makeGif, makePng } from '../media/helpers'

const PORT = Number(process.argv[2] ?? 3247)
const OUT = process.argv[3] ?? '.work/shots-l'
const ROOT = join(import.meta.dir, '..', '..')
const BASE = `http://localhost:${PORT}`
const DB = 'chaochi_lane_l_shots'
const BUCKET = 'chaochi-lane-l-shots'
const PG = 'postgres://chaochi:chaochi@127.0.0.1:5432'
const PASSWORD = 'lane-l-password-123'

const ENV: Record<string, string> = {
  NODE_ENV: 'development',
  SITE_URL: BASE,
  DATABASE_URL: `${PG}/${DB}`,
  AUTH_SECRET: 'lane-l-shots-auth-secret-0123456789abcdef',
  IP_HASH_SALT: 'lane-l-shots-salt',
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_PUBLIC_ENDPOINT: '',
  S3_REGION: 'auto',
  S3_BUCKET: BUCKET,
  S3_ACCESS_KEY_ID: 'devaccess',
  S3_SECRET_ACCESS_KEY: 'devsecret123',
  S3_FORCE_PATH_STYLE: 'true',
  ALLOW_PROD_BUCKET: '',
  CAP_SECRET_KEY: '',
  CAP_DISABLED: '1',
  SMTP_URL: '',
  MAIL_FROM: '',
  CF_ZONE_ID: '',
  CF_PURGE_TOKEN: '',
  LOG_LEVEL: 'warn',
}

const ACCOUNTS = {
  owner: { email: 'owner@lane-l.test', name: '潮池站长', role: 'admin' },
  manager: { email: 'manager@lane-l.test', name: '海风', role: 'manager' },
  user: { email: 'fan@lane-l.test', name: '今州打工人', role: 'user' },
} as const

mkdirSync(OUT, { recursive: true })
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const failures: string[] = []
function check(ok: boolean, what: string) {
  console.log(ok ? 'ok  ' : 'FAIL', what)
  if (!ok) failures.push(what)
}

async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: ENV.DATABASE_URL })
  await c.connect()
  try {
    return (await c.query(text, params)).rows as T[]
  } finally {
    await c.end()
  }
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

const s3 = new S3Client({ region: 'auto', endpoint: ENV.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: ENV.S3_ACCESS_KEY_ID!, secretAccessKey: ENV.S3_SECRET_ACCESS_KEY! } })

async function listKeys(prefix: string) {
  const out: { key: string; size: number }[] = []
  let token: string | undefined
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }))
    for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0 })
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return out
}

async function freshBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }))
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
  }
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: BUCKET,
      CORSConfiguration: { CORSRules: [{ AllowedOrigins: [BASE], AllowedMethods: ['PUT', 'GET', 'HEAD'], AllowedHeaders: ['*'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 600 }] },
    }),
  )
  const keys = await listKeys('')
  if (keys.length) await s3.send(new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys.map((k) => ({ Key: k.key })) } }))
}

async function waitFor(url: string, ms = 120_000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // not up yet
    }
    await sleep(500)
  }
  throw new Error(`timed out waiting for ${url}`)
}

type Cookie = { name: string; value: string; url: string }
function cookiesOf(res: Response): Cookie[] {
  return res.headers.getSetCookie().map((c) => {
    const pair = c.split(';')[0]!
    const i = pair.indexOf('=')
    return { name: pair.slice(0, i), value: pair.slice(i + 1), url: BASE }
  })
}

async function auth(path: string, body: unknown, cookie?: Cookie[]) {
  const headers: Record<string, string> = { 'content-type': 'application/json', origin: BASE, 'x-cap-token': 'dev-cap-disabled' }
  if (cookie) headers.cookie = cookie.filter((c) => c.value).map((c) => `${c.name}=${c.value}`).join('; ')
  const res = await fetch(`${BASE}/api/auth${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (res.status !== 200) throw new Error(`${path}: ${res.status} ${await res.text()}`)
  return res
}

const signIn = async (email: string) => cookiesOf(await auth('/sign-in/email', { email, password: PASSWORD }))

/** The cookie jar after 模拟登录 through Better Auth's endpoint (the same Set-Cookie the admin page gets). */
async function impersonationJar(owner: Cookie[], userId: string): Promise<Cookie[]> {
  const set = cookiesOf(await auth('/admin/impersonate-user', { userId }, owner))
  const jar = new Map(owner.map((c) => [c.name, c]))
  for (const c of set) jar.set(c.name, c)
  return [...jar.values()].filter((c) => c.value)
}

const VIEWPORTS = [
  { tag: '1280', width: 1280, height: 860, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { tag: '390', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
] as const

async function settle(page: Page, ms = 500) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await sleep(ms)
}

async function pageWith(browser: Browser, cookies: Cookie[], vp: (typeof VIEWPORTS)[number]) {
  const page = await (await browser.createBrowserContext()).newPage()
  await page.setViewport(vp)
  if (cookies.length) await page.setCookie(...cookies)
  page.on('pageerror', (e) => failures.push(`page error: ${String(e)}`))
  return page
}

async function shot(page: Page, name: string, opts: { scroll?: number } = {}) {
  if (opts.scroll) await page.evaluate((y) => window.scrollTo(0, y), opts.scroll)
  await settle(page)
  await page.screenshot({ path: join(OUT, `${name}.png`) })
}

async function clickText(page: Page, selector: string, text: string) {
  for (const h of await page.$$(selector)) {
    if (((await h.evaluate((el) => el.textContent?.trim())) ?? '').includes(text)) {
      await h.click()
      return
    }
  }
  throw new Error(`no ${selector} with text ${text}`)
}

const barText = (page: Page) => page.$eval('.imp-bar .txt', (el) => el.textContent?.replace(/\s+/g, ' ').trim() ?? '').catch(() => null)

/** The bar does not hide the sticky header: its bottom edge is at or above the header's top. */
async function barClearsHeader(page: Page, header: string) {
  return page.evaluate((sel) => {
    const bar = document.querySelector('.imp-bar')?.getBoundingClientRect()
    const head = document.querySelector(sel)?.getBoundingClientRect()
    return !!bar && !!head && bar.bottom <= head.top + 0.5
  }, header)
}

// ---------- run ----------

log('preparing database and bucket')
await freshDb()
await freshBucket()
await new Promise<void>((resolve, reject) => {
  const p = Bun.spawn(['bun', 'scripts/copy-cap-assets.ts'], { cwd: ROOT })
  p.exited.then((c) => (c === 0 ? resolve() : reject(new Error('copy-cap-assets failed'))))
})

log('starting dev server')
const web = Bun.spawn(['bun', '--bun', 'vite', 'dev', '--port', String(PORT), '--strictPort'], { cwd: ROOT, env: { ...process.env, ...ENV }, stdout: 'pipe', stderr: 'pipe' })
const webLog: string[] = []
for (const s of [web.stdout, web.stderr]) {
  void (async () => {
    for await (const c of s) {
      webLog.push(new TextDecoder().decode(c))
      writeFileSync(join(ROOT, '.work', 'shots-l-web.log'), webLog.join(''))
    }
  })()
}
let browser: Browser | undefined
try {
  await waitFor(`${BASE}/api/health`)
  for (const a of Object.values(ACCOUNTS)) await auth('/sign-up/email', { email: a.email, password: PASSWORD, name: a.name })
  for (const a of Object.values(ACCOUNTS)) await sql('update users set role = $2 where email = $1', [a.email, a.role])
  const ids = Object.fromEntries((await sql<{ email: string; id: string }>('select email, id from users')).map((r) => [r.email, r.id]))
  const userId = ids[ACCOUNTS.user.email]!
  const managerId = ids[ACCOUNTS.manager.email]!
  const [pack] = await sql<{ id: number }>(
    `insert into packs (pack_key, slug, title, status, owner_id) values ('aimisi-01', 'aimisi-01', '爱弥斯动态表情包', 'published', $1) returning id`,
    [ids[ACCOUNTS.owner.email]],
  )
  const notices: [string, Record<string, unknown>][] = [
    ['submission.returned', { submissionId: '00000000-0000-4000-8000-000000000001', packId: pack!.id, slug: 'aimisi-01', title: '爱弥斯动态表情包', reason: '缺少画师授权说明' }],
    ['submission.approved', { submissionId: '00000000-0000-4000-8000-000000000002', packId: pack!.id, slug: 'aimisi-01', title: '爱弥斯动态表情包' }],
    ['comment.reply', { commentId: 7, parentId: 6, rootId: 6, threadType: 'emoji', threadId: 'r-0a7bf47f0ec26d3843bf', by: '路人', excerpt: '原图已经找不到了吗', title: '已删除的表情', href: null }],
    ['comment.reply', { commentId: 12, parentId: 11, rootId: 11, threadType: 'pack', threadId: String(pack!.id), by: '海风', excerpt: '同感，这张太可爱了 [贴纸]', title: '爱弥斯动态表情包', href: '/packs/aimisi-01#c-12' }],
  ]
  for (const [i, [kind, payload]] of notices.entries()) {
    await sql(`insert into notifications (user_id, kind, payload, read_at, created_at) values ($1, $2, $3, $4, now() - ($5 || ' minutes')::interval)`, [
      userId,
      kind,
      payload,
      i === 0 ? new Date() : null,
      String((notices.length - i) * 37),
    ])
  }
  const owner = await signIn(ACCOUNTS.owner.email)
  browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })

  // ---- L3: 通知 tab, as the user ----
  const fan = await signIn(ACCOUNTS.user.email)
  for (const vp of VIEWPORTS) {
    const p = await pageWith(browser, fan, vp)
    await p.goto(`${BASE}/me/notifications`, { waitUntil: 'networkidle0' })
    const lines = await p.$$eval('.list .li b', (els) => els.map((e) => e.textContent ?? ''))
    if (vp.tag === '1280') {
      check(lines[0] === '海风 回复了你' && lines[1] === '路人 回复了你', `notifications: reply lines (${lines.join(' / ')})`)
      check(!lines.includes('新通知'), 'notifications: no generic 新通知 line')
      const tabs = await p.$$eval('.me-tabs a', (els) => els.map((e) => e.textContent?.trim()))
      check(tabs.some((t) => t === '我的评论0'), `me tabs: 我的评论 shows a count (${tabs.join(' | ')})`)
    }
    await shot(p, `notifications-${vp.tag}`)
    if (vp.tag === '1280') {
      await Promise.all([p.waitForFunction(() => location.pathname === '/packs/aimisi-01', { timeout: 10_000 }), clickText(p, '.list .li button', '查看')])
      const at = await p.evaluate(() => location.pathname + location.hash)
      check(at === '/packs/aimisi-01#c-12', `notifications: 查看 opens the reply anchor (${at})`)
      await p.goto(`${BASE}/me/notifications`, { waitUntil: 'networkidle0' })
      await Promise.all([p.waitForFunction(() => location.pathname.startsWith('/me/submissions/'), { timeout: 10_000 }), clickText(p, '.list .li button', '去修改')])
      const back = await p.evaluate(() => location.pathname)
      check(back === '/me/submissions/00000000-0000-4000-8000-000000000001', `notifications: 去修改 opens the submission (${back})`)
    }
  }

  // ---- L2: impersonating a 用户 (site pages) ----
  for (const vp of VIEWPORTS) {
    const p = await pageWith(browser, await impersonationJar(owner, userId), vp)
    await p.goto(`${BASE}/`, { waitUntil: 'networkidle0' })
    check((await barText(p)) === `正在以 ${ACCOUNTS.user.name} 的身份浏览`, `bar on the site at ${vp.tag} (${await barText(p)})`)
    check(await barClearsHeader(p, '.head'), `bar clears the site header at ${vp.tag}`)
    await shot(p, `impersonating-site-${vp.tag}`)
    await p.goto(`${BASE}/me/notifications`, { waitUntil: 'networkidle0' })
    await shot(p, `impersonating-me-${vp.tag}`, { scroll: 400 })
    check(await barClearsHeader(p, '.head'), `bar clears the sticky site header after scrolling at ${vp.tag}`)
  }

  // ---- L2: impersonating a 管理员 (admin pages), then 结束模拟 ----
  for (const vp of VIEWPORTS) {
    const p = await pageWith(browser, await impersonationJar(owner, managerId), vp)
    await p.goto(`${BASE}/admin/packs`, { waitUntil: 'networkidle0' })
    check((await barText(p))?.startsWith(`正在以 ${ACCOUNTS.manager.name} 的身份浏览`) === true, `bar on the admin at ${vp.tag}`)
    check(await barClearsHeader(p, '.adm-top'), `bar clears the admin top bar at ${vp.tag}`)
    await shot(p, `impersonating-admin-${vp.tag}`)
    await Promise.all([p.waitForNavigation({ waitUntil: 'networkidle0' }), clickText(p, '.imp-bar button', '结束模拟')])
    const me = await p.$eval('.adm-me b', (e) => e.textContent).catch(() => null)
    const path = new URL(p.url()).pathname
    check(path === '/admin/users' && (await p.$('.imp-bar')) == null, `结束模拟 at ${vp.tag}: on ${path}, bar gone`)
    if (vp.tag === '1280') check(me === ACCOUNTS.owner.name, `结束模拟: signed in as ${me} again`)
    await shot(p, `stopped-${vp.tag}`)
  }
  const stops = await sql<{ actor_id: string; target_id: string }>(`select actor_id, target_id from audit_logs where action = 'user.impersonate_stop'`)
  check(stops.length === 2 && stops.every((s) => s.actor_id === ids[ACCOUNTS.owner.email] && s.target_id === managerId), `audit: ${stops.length} 结束模拟 rows by the 站长`)

  // ---- L4: admin top-bar search ----
  {
    const p = await pageWith(browser, owner, VIEWPORTS[0])
    const search = async (q: string) => {
      await p.click('.adm-top input[name=q]', { count: 3 })
      await p.type('.adm-top input[name=q]', q)
      await Promise.all([p.waitForNetworkIdle(), p.keyboard.press('Enter')])
      await sleep(300)
      return p.evaluate(() => location.pathname + location.search)
    }
    await p.goto(`${BASE}/admin`, { waitUntil: 'networkidle0' })
    check((await search('爱弥斯')) === `/admin/packs?q=${encodeURIComponent('爱弥斯')}`, 'search: text opens 表情包')
    check((await p.$$eval('tbody tr', (rs) => rs.map((r) => r.textContent ?? ''))).some((t) => t.includes('爱弥斯动态表情包')), 'search: the pack is listed')
    check((await search('r-0A7BF47F')) === '/admin/emojis?q=r-0a7bf47f', 'search: an emoji id opens 表情库')
    check((await search(ACCOUNTS.user.email)) === `/admin/users?q=${encodeURIComponent(ACCOUNTS.user.email)}`, 'search: an e-mail opens 用户与权限')
    await shot(p, 'search-users-1280')
    await p.goto(`${BASE}/admin/audit`, { waitUntil: 'networkidle0' })
    check((await p.content()).includes('结束模拟'), 'audit page labels user.impersonate_stop as 结束模拟')
  }

  // ---- L1: the real uploader against the size-locked presigned PUT ----
  {
    const p = await pageWith(browser, owner, VIEWPORTS[0])
    const dir = join(ROOT, '.work', 'shots-l-files')
    mkdirSync(dir, { recursive: true })
    const files = [
      { path: join(dir, 'lock.gif'), body: await makeGif(48, 48, 3, 5) },
      { path: join(dir, 'lock.png'), body: await makePng(40, 40, 6) },
    ]
    for (const f of files) writeFileSync(f.path, f.body)
    await p.goto(`${BASE}/admin/upload?pack=${pack!.id}`, { waitUntil: 'networkidle0' })
    await (await p.$('input[type=file]'))!.uploadFile(...files.map((f) => f.path))
    const end = Date.now() + 20_000
    let rows: { status: string; bytes: number; tmp_key: string }[] = []
    while (Date.now() < end) {
      rows = await sql(`select status, bytes, tmp_key from upload_items order by created_at`)
      if (rows.length === 2 && rows.every((r) => r.status !== 'signed')) break
      await sleep(300)
    }
    check(rows.length === 2 && rows.every((r) => r.status === 'uploaded'), `upload: both PUTs accepted (${rows.map((r) => r.status).join(', ')})`)
    const stored = await listKeys('uploads/tmp/')
    check(
      rows.every((r) => stored.some((s) => s.key === r.tmp_key && s.size === Number(r.bytes))),
      `upload: stored objects have the declared sizes (${stored.map((s) => s.size).join(', ')} vs ${rows.map((r) => r.bytes).join(', ')})`,
    )
  }
} catch (err) {
  failures.push(`crashed: ${err instanceof Error ? err.stack : String(err)}`)
} finally {
  await browser?.close()
  web.kill()
  await web.exited
}
for (const f of failures) console.log('FAIL', f)
log(failures.length ? `${failures.length} failure(s)` : 'all checks passed', `· screenshots in ${OUT}`)
process.exit(failures.length ? 1 : 0)
