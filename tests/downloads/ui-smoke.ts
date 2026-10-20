// Manual end-to-end check (not a unit test): drives 后台 › 下载与风控 in headless Chromium against a
// running dev server (CAP_DISABLED=1) and its lane database, and screenshots the page.
//
//   DATABASE_URL=<the server's chaochi_lane_* database> bun tests/downloads/ui-smoke.ts [baseUrl=http://localhost:3197] [outDir=.work/shots-j1]
//
// Seeds a 站长, a 管理员, a 用户 and two suspicious sources (an IP without Referer, an account with
// burst and throttled flags), then as 站长: saves a limit and clears it back to 不限, sees 0 rejected,
// turns 暂停整包与打包下载 on through its confirmation and off again, turns 可疑时要求人机验证 off and
// on, blocks the IP source and releases it. Every write must end with its toast and the database must
// follow. 管理员 and 用户 get the 403 states. Console errors fail the run.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import puppeteer, { type Page } from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3197'
const outDir = process.argv[3] ?? '.work/shots-j1'
mkdirSync(outDir, { recursive: true })

const url = process.env.DATABASE_URL ?? ''
if (!/\/chaochi_lane_[a-z0-9]+(_[a-z0-9_]+)?$/.test(url)) throw new Error('DATABASE_URL must point at a chaochi_lane_* dev database')

const ACCOUNTS = [
  { email: 'owner@lane-j1.test', name: '潮池站长', role: 'admin' },
  { email: 'manager@lane-j1.test', name: '海风', role: 'manager' },
  { email: 'scraper@lane-j1.test', name: 'scraper_0x1f', role: 'user' },
] as const
const PASSWORD = 'lane-j1-password-123'
const IP_SUBJECT = `ip:a91c${'0'.repeat(26)}2f`

const db = new pg.Client({ connectionString: url })
await db.connect()

async function authCall(path: string, body: object) {
  return fetch(`${base}/api/auth${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, 'x-cap-token': 'dev-cap-disabled' },
    body: JSON.stringify(body),
  })
}

async function cookiesFor(email: string) {
  const res = await authCall('/sign-in/email', { email, password: PASSWORD })
  if (res.status !== 200) throw new Error(`sign-in ${email}: ${res.status}`)
  return res.headers.getSetCookie().map((c) => {
    const pair = c.split(';')[0]!
    const i = pair.indexOf('=')
    return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base }
  })
}

// ---- seed ----

for (const a of ACCOUNTS) {
  const known = (await db.query('select 1 from users where email = $1', [a.email])).rowCount
  if (!known) {
    const res = await authCall('/sign-up/email', { email: a.email, password: PASSWORD, name: a.name })
    if (res.status !== 200) throw new Error(`sign-up ${a.email}: ${res.status} ${await res.text()}`)
  }
  await db.query('update users set role = $2 where email = $1', [a.email, a.role])
}
const scraperId = (await db.query<{ id: string }>('select id from users where email = $1', [ACCOUNTS[2].email])).rows[0]!.id
const USER_SUBJECT = `user:${scraperId}`
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
// flag rows of a day expire at the end of the following day (src/server/downloads/store.ts flagExpiry)
const flagUntil = new Date(new Date(`${today}T00:00:00+08:00`).getTime() + 2 * 86_400_000)

await db.query(`delete from site_settings where key = 'downloads'`)
await db.query('delete from blocked_sources where subject = any($1)', [[IP_SUBJECT, USER_SUBJECT]])
for (const [subject, kind, n] of [
  [IP_SUBJECT, 'orig', 1840],
  [IP_SUBJECT, 'zip', 6],
  [USER_SUBJECT, 'orig', 9120],
] as const) {
  await db.query(
    `insert into download_counters (subject, day, kind, n) values ($1, $2, $3, $4)
     on conflict (subject, day, kind) do update set n = excluded.n`,
    [subject, today, kind, n],
  )
}
for (const [subject, feature, n] of [
  [IP_SUBJECT, 'noref', 37],
  [IP_SUBJECT, 'throttled', 3],
  [USER_SUBJECT, 'burst', 12],
  [USER_SUBJECT, 'throttled', 40],
] as const) {
  await db.query(
    `insert into rate_windows (subject, bucket, window_start, n) values ($1, $2, $3, $4)
     on conflict (subject, bucket, window_start) do update set n = excluded.n`,
    [subject, `flag:${feature}`, flagUntil, n],
  )
}

const settings = async (): Promise<Record<string, unknown>> =>
  (await db.query<{ value: Record<string, unknown> }>(`select value from site_settings where key = 'downloads'`)).rows[0]?.value ?? {}
const source = async (subject: string) =>
  (await db.query<{ mode: string; until: Date | null }>('select mode, until from blocked_sources where subject = $1', [subject])).rows[0] ?? null

// ---- helpers ----

const failures: string[] = []
function check(ok: boolean, what: string) {
  console.log(ok ? 'ok  ' : 'FAIL', what)
  if (!ok) failures.push(what)
}

/** Run `action` once no toast with `text` is on screen, then wait for that toast. */
async function withToast(page: Page, text: string, action: () => Promise<unknown>): Promise<boolean> {
  await page.waitForFunction((t) => ![...document.querySelectorAll('.toast')].some((el) => el.textContent?.includes(t)), { timeout: 8000 }, text)
  await action()
  try {
    await page.waitForFunction((t) => [...document.querySelectorAll('.toast')].some((el) => el.textContent?.includes(t)), { timeout: 10_000 }, text)
    await page.waitForNetworkIdle({ idleTime: 300 })
    return true
  } catch {
    console.log('     toasts seen:', await page.$$eval('.toast', (els) => els.map((e) => e.textContent)))
    return false
  }
}

async function clickText(page: Page, selector: string, text: string) {
  for (const h of await page.$$(selector)) {
    if ((await h.evaluate((el) => el.textContent?.trim() ?? '')).includes(text)) {
      await h.click()
      return
    }
  }
  throw new Error(`no ${selector} with text ${text}`)
}

/** The switch in the row (.rule-row / .set-row) whose title contains `title`. */
async function switchIn(page: Page, title: string) {
  for (const row of await page.$$('.rule-row, .set-row')) {
    if ((await row.evaluate((el) => el.querySelector('b')?.textContent ?? '')).includes(title)) {
      const sw = await row.$('[role="switch"]')
      if (sw) return sw
    }
  }
  throw new Error(`no switch for ${title}`)
}

async function fill(page: Page, name: string, value: string) {
  const input = (await page.$(`input[name="${name}"]`))!
  await input.click({ count: 3 })
  await page.keyboard.press('Backspace')
  if (value) await input.type(value)
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  // the shell's sidebar and top bar are sticky: full-page shots start at the top
  if (fullPage) await page.evaluate(() => window.scrollTo(0, 0))
  await new Promise((r) => setTimeout(r, 400))
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage })
}

/** No horizontal overflow: neither the page nor the table scrolls sideways. */
const noOverflow = (page: Page) =>
  page.evaluate(() => {
    const wrap = document.querySelector('.adm-src')?.closest('.tbl-wrap')
    return document.documentElement.scrollWidth <= innerWidth && (!wrap || wrap.scrollWidth <= wrap.clientWidth)
  })

const errors: string[] = []
function watch(page: Page, who: string) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${who}: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`${who}: ${String(e)}`))
}

const PAGE = `${base}/admin/downloads`
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'] })
try {
  const page = await browser.newPage()
  watch(page, 'owner')
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
  await page.setCookie(...(await cookiesFor(ACCOUNTS[0].email)))
  const res = await page.goto(PAGE, { waitUntil: 'networkidle0' })
  check(res?.status() === 200 && (await page.$eval('.adm-h h1', (e) => e.textContent)) === '下载与风控', 'owner: page loads')
  check((await page.$(`tr[data-subject="${IP_SUBJECT}"]`)) != null && (await page.$(`tr[data-subject="${USER_SUBJECT}"]`)) != null, 'sources: both seeded subjects listed')
  const ipRow = await page.$eval(`tr[data-subject="${IP_SUBJECT}"]`, (e) => e.textContent ?? '')
  check(ipRow.includes('IP 哈希 a91c…2f') && ipRow.includes('无 Referer 37') && ipRow.includes('1,840'), 'sources: IP row shows label, count and the no-Referer feature')
  const userRow = await page.$eval(`tr[data-subject="${USER_SUBJECT}"]`, (e) => e.textContent ?? '')
  check(userRow.includes('scraper_0x1f') && userRow.includes('连续抓取 12') && userRow.includes('被限流 40'), 'sources: account row shows name and features')
  check((await page.$eval('.kpis', (e) => e.textContent ?? '')).includes('今日触发限流3'), 'kpi: throttled events of today')
  check(await noOverflow(page), 'desktop: no horizontal overflow')
  await shot(page, 'dl-owner-desktop-seeded', true)

  // ---- a limit: save 500, then clear it back to 不限 ----
  await fill(page, 'perIpOriginalsPerDay', '500')
  await page.waitForSelector('.savebar')
  await shot(page, 'dl-savebar')
  check(await withToast(page, '已保存', () => clickText(page, '.savebar button', '保存')), 'limit: save 500 shows a toast')
  check((await settings()).perIpOriginalsPerDay === 500, 'limit: stored as 500')
  check((await page.$('.savebar')) == null && (await page.$eval('input[name="perIpOriginalsPerDay"]', (e) => (e as HTMLInputElement).value)) === '500', 'limit: form shows the saved value')

  await fill(page, 'maxBatchItems', '0')
  await page.waitForSelector('.adm-num-err')
  const err = await page.$eval('.adm-num-err', (e) => e.textContent ?? '')
  const saveDisabled = await page.$$eval('.savebar button', (bs) => bs.find((b) => b.textContent?.includes('保存'))?.hasAttribute('disabled') ?? false)
  check(err.includes('至少为 1') && saveDisabled, 'limit: 0 is rejected in the form and save is disabled')
  await shot(page, 'dl-invalid')
  await clickText(page, '.savebar button', '放弃')
  check((await page.$('.savebar')) == null, 'limit: 放弃 restores the form')

  await fill(page, 'perIpOriginalsPerDay', '')
  await page.waitForSelector('.savebar')
  check(await withToast(page, '已保存', () => clickText(page, '.savebar button', '保存')), 'limit: clear shows a toast')
  check((await settings()).perIpOriginalsPerDay === null, 'limit: cleared to null (不限)')
  check((await page.$eval('input[name="perIpOriginalsPerDay"]', (e) => [(e as HTMLInputElement).value, (e as HTMLInputElement).placeholder].join('|'))) === '|不限', 'limit: field is blank with placeholder 不限')

  // ---- emergency switch: confirm on, then off ----
  await (await switchIn(page, '暂停整包与打包下载')).click()
  await page.waitForSelector('.modal')
  await shot(page, 'dl-emergency-confirm')
  check((await settings()).pauseZipAndBatch !== true, 'emergency: nothing saved before the confirmation')
  check(await withToast(page, '已打开「暂停整包与打包下载」', () => clickText(page, '.modal button', '打开')), 'emergency: turning on shows a toast')
  check((await settings()).pauseZipAndBatch === true, 'emergency: stored as on')
  await page.waitForFunction(() => document.querySelector('.alert-box')?.textContent?.includes('暂停整包与打包下载') ?? false, { timeout: 5000 })
  check((await page.$('.modal')) == null, 'emergency: confirmation closed')
  await shot(page, 'dl-emergency-on', true)
  check(await withToast(page, '已关闭「暂停整包与打包下载」', async () => (await switchIn(page, '暂停整包与打包下载')).click()), 'emergency: turning off shows a toast')
  check((await settings()).pauseZipAndBatch === false, 'emergency: stored as off')
  check((await page.$('.alert-box')) == null, 'emergency: banner gone')

  // cancelling the confirmation keeps the switch off
  await (await switchIn(page, '原图仅限登录用户')).click()
  await page.waitForSelector('.modal')
  await clickText(page, '.modal button', '取消')
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 5000 })
  const offAfterCancel = await (await switchIn(page, '原图仅限登录用户')).evaluate((e) => e.getAttribute('aria-checked'))
  check(offAfterCancel === 'false' && (await settings()).originalsRequireLogin !== true, 'emergency: cancel leaves the switch off')

  // ---- challenge switch: off, then on again ----
  check(await withToast(page, '已关闭「可疑时要求人机验证」', async () => (await switchIn(page, '可疑时要求人机验证')).click()), 'challenge: turning off shows a toast')
  check((await settings()).challengeSuspicious === false, 'challenge: stored as off')
  check(await withToast(page, '已打开「可疑时要求人机验证」', async () => (await switchIn(page, '可疑时要求人机验证')).click()), 'challenge: turning on shows a toast')
  check((await settings()).challengeSuspicious === true, 'challenge: stored as on')

  // ---- block the IP source, then release it ----
  await clickText(page, `tr[data-subject="${IP_SUBJECT}"] button`, '封禁')
  await page.waitForSelector('.modal')
  await shot(page, 'dl-block-confirm')
  check(await withToast(page, '已封禁', () => clickText(page, '.modal button', '封禁到手动解除')), 'source: block shows a toast')
  const blocked = await source(IP_SUBJECT)
  check(blocked?.mode === 'block' && blocked.until === null, 'source: stored as block until lifted')
  check((await page.$eval(`tr[data-subject="${IP_SUBJECT}"]`, (e) => e.textContent ?? '')).includes('已封禁'), 'source: row shows 已封禁')
  check((await page.$eval('.kpis', (e) => e.textContent ?? '')).includes('封禁中的来源1'), 'kpi: one blocked source')
  await shot(page, 'dl-blocked', true)
  check(await withToast(page, '已解除', () => clickText(page, `tr[data-subject="${IP_SUBJECT}"] button`, '解除')), 'source: release shows a toast')
  check((await source(IP_SUBJECT)) == null, 'source: entry removed')
  check(!(await page.$eval(`tr[data-subject="${IP_SUBJECT}"]`, (e) => e.textContent ?? '')).includes('已封禁'), 'source: row no longer blocked')

  await page.reload({ waitUntil: 'networkidle0' })
  await shot(page, 'dl-owner-desktop', true)

  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
  await page.reload({ waitUntil: 'networkidle0' })
  check(await noOverflow(page), 'phone: no horizontal overflow')
  await shot(page, 'dl-owner-phone', true)

  const final = await settings()
  check(final.perIpOriginalsPerDay === null && final.pauseZipAndBatch === false && final.originalsRequireLogin !== true && final.challengeSuspicious === true, 'settings back to defaults')

  // ---- 管理员 and 用户: 403 states (own cookie jars) ----
  for (const [who, account, text] of [
    ['manager', ACCOUNTS[1], '管理员没有「下载与风控」的权限'],
    ['user', ACCOUNTS[2], '用户没有管理台的权限'],
  ] as const) {
    const p = await (await browser.createBrowserContext()).newPage()
    watch(p, who)
    await p.setCookie(...(await cookiesFor(account.email)))
    for (const vp of [
      { name: 'desktop', width: 1280, height: 800, isMobile: false },
      { name: 'phone', width: 390, height: 844, isMobile: true },
    ]) {
      await p.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile, hasTouch: vp.isMobile, deviceScaleFactor: 1 })
      await p.goto(PAGE, { waitUntil: 'networkidle0' })
      const body = await p.$eval('body', (e) => e.textContent ?? '')
      check(body.includes(text) && !(await p.$('.adm-src')), `${who} ${vp.name}: 403 state, no data`)
      await shot(p, `dl-${who}-${vp.name}`, true)
    }
  }
  check(errors.length === 0, `no console errors${errors.length ? ` (${errors.join(' | ')})` : ''}`)
} finally {
  await browser.close()
  await db.end()
}
if (failures.length) {
  console.log(`\n${failures.length} failure(s)`)
  process.exit(1)
}
console.log(`\nall checks passed; screenshots in ${outDir}`)
