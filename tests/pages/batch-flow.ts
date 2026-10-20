// Manual end-to-end check in headless Chromium (not part of `bun test`) of the 打包清单 and comments:
//
//   DATABASE_URL=postgres://…/chaochi_lane_<x> bun tests/pages/batch-flow.ts [base=http://localhost:3291] [outDir=.work/shots-j2]
//
// Needs a running server (dev or production build) on a lane database with derivatives built and some
// downloadable packs (tests/import/fixture.ts + import-v1 + tests/pages/volume-fixture.ts + the worker),
// started with CAP_DISABLED=1 and CAP_API_ENDPOINT at a Cap Standalone stand-in (tests/account/e2e-flow.ts
// has one), and storage CORS allowing GET from the server's origin (the browser fetches the originals).
//
// Steps: add stickers from two packs (多选, tile action, dialog) → tray (list, remove) → a preview-only
// pack offers no 打包 and explains why; a stale preview-only id in the list is shown apart → /batch builds
// the ZIP in the browser; the downloaded ZIP's entries and CREDITS.txt are checked → comments post and
// render on a pack page (signed in, with a sticker), on a sticker (dialog thread) and as a guest
// (invisible Cap) → the 模拟登录 bar does not cover sticky headers → screenshots of the pack header
// at 390/1280/1440/1920, the tray and /batch. Any console error fails the run.
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import pg from 'pg'
import puppeteer, { type Browser, type BrowserContext, type Page } from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3291'
const out = resolve(process.argv[3] ?? '.work/shots-j2')
const DB = process.env.DATABASE_URL ?? ''
if (!/\/chaochi_lane_[a-z0-9_]+$/.test(DB)) throw new Error('DATABASE_URL must point at a chaochi_lane_* database')
mkdirSync(out, { recursive: true })
const downloads = join(out, 'downloads')
rmSync(downloads, { recursive: true, force: true })
mkdirSync(downloads, { recursive: true })

const OWNER = { email: 'owner@batch-flow.test', name: '潮池站长', password: 'batch-flow-password-123' }
const USER = { email: 'user@batch-flow.test', name: '今州打工人', password: 'batch-flow-password-123' }

const failures: string[] = []
const consoleErrors: string[] = []
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function sql<T>(text: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: DB })
  await c.connect()
  try {
    return (await c.query(text, params)).rows as T[]
  } finally {
    await c.end()
  }
}

// ---------- data ----------

interface PackRow {
  slug: string
  title: string
  n: number
}
const ready = `select p.slug, p.title, count(*)::int as n from packs p join emojis e on e.pack_id = p.id
  where p.status = 'published' and e.status = 'published' and e.derived_ready group by p.id`
const downloadable = await sql<PackRow>(`select * from (${ready} having bool_and(p.downloadable)) x where n >= 4 order by slug limit 2`)
const preview = await sql<PackRow>(`select * from (${ready} having not bool_or(p.downloadable)) x order by slug limit 1`)
if (downloadable.length < 2 || !preview.length) throw new Error('need two downloadable packs and a preview-only pack with derivatives')
const [A, B] = downloadable as [PackRow, PackRow]
const P = preview[0]!
console.log(`packs: ${A.slug}, ${B.slug}; preview only: ${P.slug}`)

async function ensureAccount(a: typeof OWNER, role: string) {
  const res = await fetch(`${base}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, 'x-cap-token': 'dev-cap-disabled' },
    body: JSON.stringify({ email: a.email, password: a.password, name: a.name }),
  })
  if (res.status !== 200 && res.status !== 422) throw new Error(`sign-up ${a.email}: ${res.status} ${await res.text()}`)
  await sql('update users set role = $2, email_verified = true where email = $1', [a.email, role])
}

async function cookiesFor(a: typeof OWNER) {
  const res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, 'x-cap-token': 'dev-cap-disabled' },
    body: JSON.stringify({ email: a.email, password: a.password }),
  })
  if (res.status !== 200) throw new Error(`sign-in ${a.email}: ${res.status}`)
  const host = new URL(base).hostname
  return res.headers.getSetCookie().map((c) => {
    const pair = c.split(';')[0]!
    const i = pair.indexOf('=')
    return { name: pair.slice(0, i), value: pair.slice(i + 1), domain: host, path: '/' }
  })
}

// ---------- browser helpers ----------

async function open(ctx: Browser | BrowserContext, width: number, name: string): Promise<Page> {
  const page = await ctx.newPage()
  const phone = width < 700
  await page.setViewport({ width, height: phone ? 844 : 900, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone })
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${name}: ${m.text()}`)
  })
  page.on('pageerror', (e) => consoleErrors.push(`${name}: ${String(e)}`))
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? ''
    if (!/ERR_ABORTED/.test(f)) consoleErrors.push(`${name}: request failed ${r.url()} ${f}`)
  })
  return page
}

async function go(page: Page, path: string) {
  await page.goto(base + path, { waitUntil: 'networkidle0' })
}

async function toast(page: Page, text: string, timeout = 15_000): Promise<boolean> {
  try {
    await page.waitForFunction((t) => [...document.querySelectorAll('.toast')].some((el) => el.textContent?.includes(t)), { timeout }, text)
    return true
  } catch {
    console.log('     toasts seen:', await page.$$eval('.toast', (els) => els.map((e) => e.textContent)))
    return false
  }
}

async function clickText(page: Page, selector: string, text: string) {
  const ok = await page.evaluate(
    (sel, t) => {
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.textContent?.trim().includes(t))
      el?.click()
      return !!el
    },
    selector,
    text,
  )
  if (!ok) throw new Error(`no ${selector} with text ${text}`)
}

const count = (page: Page, sel: string) => page.$$eval(sel, (els) => els.length)
const text = (page: Page, sel: string) => page.$eval(sel, (el) => el.textContent ?? '').catch(() => '')
async function shot(page: Page, name: string, full = false) {
  // full-page shots from the top, so sticky headers sit where they belong
  if (full) await page.evaluate(() => window.scrollTo(0, 0)).then(() => wait(300))
  await page.screenshot({ path: join(out, `${name}.png`) as `${string}.png`, fullPage: full })
}

async function trayCount(page: Page) {
  return Number(await text(page, '.head .bottle-btn .count'))
}

// ---------- run ----------

await ensureAccount(OWNER, 'admin')
await ensureAccount(USER, 'user')

const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  // ===== 打包清单 =====
  const page = await open(browser, 1440, 'batch')
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
  const done = new Map<string, string>()
  cdp.on('Browser.downloadWillBegin', (e: { guid: string; suggestedFilename: string }) => done.set(e.guid, `pending:${e.suggestedFilename}`))
  cdp.on('Browser.downloadProgress', (e: { guid: string; state: string }) => {
    if (e.state === 'completed') done.set(e.guid, 'completed')
  })

  await go(page, `/packs/${A.slug}`)
  await page.evaluate(() => localStorage.removeItem('tp-batch-v1'))
  await go(page, `/packs/${A.slug}`)
  check((await trayCount(page)) === 0, 'tray starts empty')

  // 多选: three stickers of pack A
  await clickText(page, '.sticky-tools button', '多选')
  for (let i = 0; i < 3; i++) await page.evaluate((k) => (document.querySelectorAll('.tile .tile-hit')[k] as HTMLButtonElement).click(), i)
  await clickText(page, '.sel-bar button', '加入打包')
  check(await toast(page, '已加入打包 3 张'), '多选 → 加入打包: 3 added')

  // pack B: two by the tile action, one from the dialog
  await go(page, `/packs/${B.slug}`)
  for (const k of [0, 1]) await page.evaluate((i) => (document.querySelectorAll('.tile')[i]!.querySelector('button[aria-label="加入打包"]') as HTMLButtonElement).click(), k)
  await page.evaluate(() => (document.querySelectorAll('.tile .tile-hit')[2] as HTMLButtonElement).click())
  await page.waitForSelector('.em-card')
  await clickText(page, '.em-act', '加入打包')
  await wait(300)
  check((await text(page, '.em-acts')).includes('已在打包'), 'dialog: 加入打包 → 已在打包')
  await page.keyboard.press('Escape')
  await wait(400)
  check((await trayCount(page)) === 6, `header 打包 count is 6 (${await trayCount(page)})`)

  // tray: grouped by pack, remove one
  await page.click('.head .bottle-btn')
  await page.waitForSelector('.tray-drawer .bthumb')
  await wait(800)
  check((await count(page, '.tray-drawer .bgroup:not(.is-off)')) === 2, 'tray: two pack groups')
  check((await count(page, '.tray-drawer .bthumb')) === 6, 'tray: six stickers')
  const trayBox = await page.$eval('.tray-drawer', (el) => el.getBoundingClientRect().toJSON())
  check(trayBox.bottom < 900 - 40, `tray is content-height (bottom ${Math.round(trayBox.bottom)} of 900)`)
  await shot(page, 'tray-1440')
  await page.evaluate(() => (document.querySelector('.tray-drawer .bthumb button') as HTMLButtonElement).click())
  await wait(300)
  check((await count(page, '.tray-drawer .bthumb')) === 5, 'tray: remove one → five')
  check((await trayCount(page)) === 5, 'header count follows (5)')
  await page.keyboard.press('Escape')
  await wait(400)

  // a preview-only pack offers no 打包 and says why
  await go(page, `/packs/${P.slug}`)
  const pv = await page.evaluate(() => ({
    note: document.querySelector('.pack-info .note-box')?.textContent ?? '',
    select: [...document.querySelectorAll('.sticky-tools button')].some((b) => b.textContent?.includes('多选')),
    addAll: [...document.querySelectorAll('.pack-acts button')].some((b) => b.textContent?.includes('全部加入打包')),
    tileAdd: document.querySelectorAll('.tile button[aria-label="加入打包"]').length,
  }))
  check(pv.note.includes('只提供预览') && pv.note.includes('不提供原图与打包'), `preview-only pack explains itself (${pv.note.trim()})`)
  check(!pv.select && !pv.addAll && pv.tileAdd === 0, 'preview-only pack: no 多选, no 全部加入打包, no tile 加入打包')
  await page.evaluate(() => (document.querySelector('.tile .tile-hit') as HTMLButtonElement).click())
  await page.waitForSelector('.em-card')
  const dlgNote = await text(page, '.em-info .note-box')
  check(dlgNote.includes('不能加入打包'), `preview-only dialog: ${dlgNote.trim()}`)
  check(!(await text(page, '.em-info')).includes('加入打包') || dlgNote.includes('加入打包'), 'preview-only dialog has no 加入打包 action')
  await shot(page, 'preview-only-dialog-1440')
  // a stale id of that pack in the list (e.g. the pack was switched to preview only later)
  const staleId = await page.evaluate(() => /\/(r-[0-9a-f]{20})\./.exec((document.querySelector('.tile img') as HTMLImageElement).src)?.[1] ?? '')
  await page.evaluate((id) => localStorage.setItem('tp-batch-v1', JSON.stringify([...JSON.parse(localStorage.getItem('tp-batch-v1') ?? '[]'), id])), staleId)

  // /batch: the stale one is shown apart, the ZIP holds the five
  await go(page, '/batch')
  await page.waitForFunction(() => !document.querySelector('.bg-loading'))
  const off = await text(page, '.bgroup.is-off')
  check(off.includes('只提供预览') && off.includes('不会放进压缩包'), 'batch: preview-only sticker listed apart with the reason')
  check((await text(page, '.pk-sum b.num')) === '5', 'batch: five packable stickers')
  await shot(page, 'batch-1440', true)
  await clickText(page, '.pk-side button', '打包下载原图')
  await page.waitForSelector('.batch-saved li', { timeout: 60_000 })
  for (let i = 0; i < 100 && ![...done.values()].includes('completed'); i++) await wait(200)
  const files = readdirSync(downloads).filter((f) => f.endsWith('.zip'))
  check(files.length === 1, `one ZIP downloaded (${files.join(', ')})`)
  if (files[0]) {
    const zip = unzipSync(new Uint8Array(readFileSync(join(downloads, files[0]))))
    const names = Object.keys(zip)
    const credits = new TextDecoder().decode(zip['CREDITS.txt'])
    check(names.length === 6 && names.at(-1) === 'CREDITS.txt', `ZIP: 5 originals + CREDITS.txt (${names.join(', ')})`)
    // the tray removed A's first: two of A, three of B
    check(names.slice(0, 2).every((n) => n.startsWith(`${A.slug}-`)) && names.slice(2, 5).every((n) => n.startsWith(`${B.slug}-`)), 'ZIP: entries named <pack>-NN.<ext>, in list order')
    const sizes = await sql<{ bytes: number }>(`select bytes from emojis where id = any($1::text[])`, [JSON.parse(await page.evaluate(() => localStorage.getItem('tp-batch-v1') ?? '[]'))])
    const total = sizes.reduce((s, r) => s + Number(r.bytes), 0)
    const got = names.slice(0, 5).reduce((s, n) => s + zip[n]!.length, 0)
    check(got > 0 && got <= total, `ZIP: original bytes (${got} of the list's ${total})`)
    check(credits.includes(`表情包：${A.title}`) && credits.includes(`表情包：${B.title}`), 'CREDITS.txt: both packs')
    check(credits.includes(`文件：${names.slice(0, 2).join('、')}`) && credits.includes(`文件：${names.slice(2, 5).join('、')}`), 'CREDITS.txt: the files of each pack')
    check(!credits.includes('来源') && !credits.includes(P.title), 'CREDITS.txt: no source address, nothing of the preview-only pack')
    check(/本站页面：http/.test(credits), 'CREDITS.txt: this site’s pack pages')
  }
  await shot(page, 'batch-done-1440', true)
  await clickText(page, '.batch-act button', '从清单移出已打包的 5 张')
  await wait(300)
  check((await trayCount(page)) === 1, 'packed stickers removed from the list; the preview-only one stays')
  await page.evaluate(() => localStorage.removeItem('tp-batch-v1'))

  // ===== comments =====
  const owner = await browser.createBrowserContext()
  await owner.setCookie(...(await cookiesFor(OWNER)))
  const cp = await open(owner, 1440, 'comments')
  await go(cp, `/packs/${A.slug}`)
  await cp.evaluate(() => document.querySelector('#comments')?.scrollIntoView())
  await cp.waitForSelector('#comments .composer textarea', { timeout: 20_000 })
  const body = `打包测试评论 ${Date.now().toString(36)}`
  await cp.type('#comments .composer textarea', body)
  await cp.click('#comments .composer button[aria-label="插入贴纸"]')
  await cp.waitForSelector('#comments .picker')
  await clickText(cp, '#comments .picker-tabs button', '本包')
  await cp.waitForSelector('#comments .picker-grid button')
  await cp.click('#comments .picker-grid button')
  await wait(3500) // the form token's minimum fill time
  await clickText(cp, '#comments .composer button[type="submit"]', '发布')
  check(await toast(cp, '评论已发布'), 'pack comment (站长, with a sticker): published')
  await cp.waitForFunction((t) => [...document.querySelectorAll('#comments .cmt .cmt-b')].some((b) => b.textContent?.includes(t) && b.querySelector('img.cmt-stk')), {}, body)
  check(true, 'pack comment renders with its sticker')
  await cp.evaluate(() => document.querySelector('#comments')?.scrollIntoView())
  await shot(cp, 'comments-pack-1440')

  // the sticker's own thread in the dialog
  await cp.evaluate(() => window.scrollTo(0, 0))
  await cp.evaluate(() => (document.querySelectorAll('.tile .tile-hit')[1] as HTMLButtonElement).click())
  await cp.waitForSelector('.em-card')
  const emojiUrl = cp.url()
  await cp.click('.em-cm-toggle')
  await cp.waitForSelector('#emoji-comments .composer textarea', { timeout: 20_000 })
  const body2 = `单张评论 ${Date.now().toString(36)}`
  await cp.type('#emoji-comments .composer textarea', body2)
  await wait(3500)
  await clickText(cp, '#emoji-comments .composer button[type="submit"]', '发布')
  check(await toast(cp, '评论已发布'), 'sticker comment (dialog thread): published')
  await cp.waitForFunction((t) => [...document.querySelectorAll('#emoji-comments .cmt .cmt-b')].some((b) => b.textContent?.includes(t)), {}, body2)
  const thread = await sql<{ n: number }>(`select count(*)::int as n from comments where thread_type = 'emoji' and thread_id = $1 and body_src like $2`, [emojiUrl.split('/e/')[1], `%${body2}%`])
  check(thread[0]!.n === 1, `sticker comment stored in the emoji thread (${emojiUrl.split('/e/')[1]})`)
  await shot(cp, 'comments-dialog-1440')
  // Esc closes the thread's sticker picker first, then the dialog
  await cp.click('#emoji-comments .composer button[aria-label="插入贴纸"]')
  await cp.waitForSelector('#emoji-comments .picker')
  await cp.keyboard.press('Escape')
  await wait(400)
  check(!(await cp.$('#emoji-comments .picker')) && !!(await cp.$('.em-card')), 'Esc closes the sticker picker, not the dialog')
  await cp.keyboard.press('Escape')
  await wait(500)
  check(!(await cp.$('.em-card')), 'a second Esc closes the dialog')
  // the deep link with #comments opens the thread
  const deep = await open(owner, 1440, 'deep')
  await go(deep, `${new URL(emojiUrl).pathname}#comments`)
  await deep.waitForFunction((t) => [...document.querySelectorAll('#emoji-comments .cmt .cmt-b')].some((b) => b.textContent?.includes(t)), { timeout: 20_000 }, body2)
  check(true, '/e/<id>#comments opens the sticker thread')
  await deep.close()

  // a guest: invisible Cap, held for review (first comment)
  const guest = await browser.createBrowserContext()
  const gp = await open(guest, 1440, 'guest')
  await go(gp, `/packs/${A.slug}`)
  await gp.evaluate(() => document.querySelector('#comments')?.scrollIntoView())
  await gp.waitForSelector('#comments .composer textarea', { timeout: 20_000 })
  check((await count(gp, '#comments cap-widget')) === 0, 'guest composer: no Cap widget box')
  await gp.type('#comments .composer input[aria-label="昵称"]', '路过的潮友')
  await gp.type('#comments .composer textarea', '游客评论测试')
  const seen = await gp.waitForFunction(() => document.querySelector('#comments .captcha')?.textContent ?? '', { timeout: 5000 }).then((h) => h.jsonValue()).catch(() => '')
  check(/正在验证|人机验证已通过/.test(String(seen)), `guest: invisible Cap status next to 发布 (${seen})`)
  await gp.waitForFunction(() => document.querySelector('#comments .captcha')?.textContent?.includes('人机验证已通过'), { timeout: 30_000 }).catch(() => {})
  await gp.evaluate(() => document.querySelector('#comments .composer')?.scrollIntoView({ block: 'center' }))
  await shot(gp, 'comments-guest-cap-1440')
  await wait(3500)
  await clickText(gp, '#comments .composer button[type="submit"]', '发布')
  check(await toast(gp, '已提交，审核通过后公开'), 'guest comment sent with an invisible Cap token (held for review)')

  // ===== 模拟登录 bar vs sticky headers =====
  const imp = await browser.createBrowserContext()
  await imp.setCookie(...(await cookiesFor(OWNER)))
  const ip = await open(imp, 1280, 'impersonate')
  await go(ip, '/admin/users')
  await ip.click(`button[aria-label="管理 ${USER.name}"]`)
  await wait(600)
  await clickText(ip, '.drawer button', '模拟登录')
  await wait(400)
  await clickText(ip, '.modal button', '模拟登录')
  await ip.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {})
  await go(ip, `/packs/${A.slug}`)
  await ip.evaluate(() => window.scrollTo(0, 700))
  await wait(400)
  const boxes = await ip.evaluate(() => {
    const r = (s: string) => document.querySelector(s)?.getBoundingClientRect().toJSON() ?? null
    return { bar: r('.imp-bar'), head: r('.head'), tools: r('.sticky-tools') }
  })
  check(!!boxes.bar && !!boxes.head && !!boxes.tools, 'impersonation bar shown')
  if (boxes.bar && boxes.head && boxes.tools) {
    check(Math.round(boxes.head.top) >= Math.round(boxes.bar.bottom) - 1, `bar above the header (bar ${Math.round(boxes.bar.bottom)}, head ${Math.round(boxes.head.top)})`)
    check(Math.round(boxes.tools.top) >= Math.round(boxes.head.bottom) - 1, `sticky tools under the header (head ${Math.round(boxes.head.bottom)}, tools ${Math.round(boxes.tools.top)})`)
  }
  await shot(ip, 'impersonation-sticky-1280')
  await go(ip, '/batch')
  await shot(ip, 'impersonation-batch-1280')
  await clickText(ip, '.imp-bar button', '结束模拟').catch(() => {})
  await wait(1500)

  // ===== pack header widths =====
  for (const w of [390, 1280, 1440, 1920]) {
    const p = await open(browser, w, `header-${w}`)
    await go(p, `/packs/${A.slug}`)
    await shot(p, `pack-header-${w}`)
    if (w === 1440 || w === 390) {
      await p.evaluate(() => document.querySelector('#comments')?.scrollIntoView())
      await p.waitForSelector('#comments .composer', { timeout: 20_000 })
      await wait(800)
      await shot(p, `pack-full-${w}`, true)
    }
    await p.close()
  }
  // phone tray and /batch
  const ph = await open(browser, 390, 'phone')
  await go(ph, `/packs/${B.slug}`)
  await ph.evaluate(() => localStorage.setItem('tp-batch-v1', JSON.stringify([...document.querySelectorAll('.tile img')].slice(0, 8).map((i) => /\/(r-[0-9a-f]{20})\./.exec((i as HTMLImageElement).src)?.[1]))))
  await go(ph, `/packs/${B.slug}`)
  await ph.click('.fab-bottle')
  await ph.waitForSelector('.tray-drawer .bthumb')
  await wait(900)
  await shot(ph, 'tray-390')
  await go(ph, '/batch')
  await ph.waitForFunction(() => !document.querySelector('.bg-loading'))
  await shot(ph, 'batch-390', true)
  await ph.evaluate(() => localStorage.removeItem('tp-batch-v1'))
} finally {
  await browser.close()
}

if (consoleErrors.length) {
  console.log('console errors:\n  ' + consoleErrors.join('\n  '))
  failures.push(`${consoleErrors.length} console error(s)`)
} else console.log('console errors: none')
console.log(failures.length ? `\n${failures.length} failure(s)` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
