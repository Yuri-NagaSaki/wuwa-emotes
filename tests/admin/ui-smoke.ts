// Manual end-to-end check (not a unit test): drives the admin UI in headless Chromium against a running
// server + worker with the dev data, and screenshots the interactive states.
//
//   bun tests/admin/ui-smoke.ts [baseUrl=http://localhost:3191] [outDir=.work/shots-h]
//
// Steps (as 站长 unless noted): edit a pack and save; reorder with the keyboard; upload two images and
// wait until the worker has published them; create a character; open the merge tool; set the site
// announcement and see it on the public page; open an emoji in the library; as 管理员 hide and publish a
// pack in bulk. Every step must end with its success toast; failures exit 1.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { makeGif, makePng } from '../media/helpers'
import { ACCOUNTS, PASSWORD } from './dev-accounts'

const base = process.argv[2] ?? 'http://localhost:3191'
const outDir = process.argv[3] ?? '.work/shots-h'
mkdirSync(outDir, { recursive: true })

async function cookiesFor(email: string) {
  const res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, 'x-cap-token': 'dev-cap-disabled' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  if (res.status !== 200) throw new Error(`sign-in ${email}: ${res.status}`)
  return res.headers.getSetCookie().map((c) => {
    const pair = c.split(';')[0]!
    const i = pair.indexOf('=')
    return { name: pair.slice(0, i), value: pair.slice(i + 1), url: base }
  })
}

const failures: string[] = []
function check(ok: boolean, what: string) {
  console.log(ok ? 'ok  ' : 'FAIL', what)
  if (!ok) failures.push(what)
}

async function toast(page: Page, text: string, timeout = 10_000): Promise<boolean> {
  try {
    await page.waitForFunction((t) => [...document.querySelectorAll('.toast')].some((el) => el.textContent?.includes(t)), { timeout }, text)
    return true
  } catch {
    const seen = await page.$$eval('.toast', (els) => els.map((e) => e.textContent))
    console.log('     toasts seen:', seen)
    return false
  }
}

async function clickText(page: Page, selector: string, text: string) {
  const handles = await page.$$(selector)
  for (const h of handles) {
    const t = await h.evaluate((el) => el.textContent?.trim() ?? '')
    if (t.includes(text)) {
      await h.click()
      return true
    }
  }
  throw new Error(`no ${selector} with text ${text}`)
}

async function shot(page: Page, name: string) {
  await new Promise((r) => setTimeout(r, 400))
  await page.screenshot({ path: join(outDir, `interact-${name}.png`) })
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.setCookie(...(await cookiesFor(ACCOUNTS[0].email)))

  // ---- pack editor: edit + save, keyboard reorder ----
  await page.goto(`${base}/admin/packs?q=aimisi-01`, { waitUntil: 'networkidle0' })
  const href = await page.$eval('a[href^="/admin/packs/"]', (a) => a.getAttribute('href'))
  await page.goto(base + href!, { waitUntil: 'networkidle0' })
  const excerpt = await page.$('textarea')
  await excerpt!.click({ count: 3 })
  await page.keyboard.type(`后台冒烟测试 ${new Date().toISOString().slice(11, 19)}`)
  await page.waitForSelector('.savebar')
  await shot(page, 'pack-savebar')
  await clickText(page, '.savebar button', '保存')
  check(await toast(page, '已保存'), 'pack editor: save excerpt')
  await page.waitForNetworkIdle()
  const first = await page.$('.sort-it')
  await first!.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Space')
  check((await page.$('.savebar')) != null, 'pack editor: keyboard reorder marks the form dirty')
  await shot(page, 'pack-reorder')
  await clickText(page, '.savebar button', '保存')
  check(await toast(page, '已保存'), 'pack editor: save order')
  const packId = Number(href!.split('/').pop())

  // ---- upload two images into the pack; the worker publishes them ----
  const dir = join(outDir, '..', 'upload-h')
  mkdirSync(dir, { recursive: true })
  const stamp = Date.now() % 997
  await Bun.write(join(dir, 'smoke.gif'), await makeGif(64, 64, 4, stamp))
  await Bun.write(join(dir, 'smoke.png'), await makePng(64, 64, stamp + 1))
  await page.goto(`${base}/admin/upload?pack=${packId}`, { waitUntil: 'networkidle0' })
  const input = await page.$('input[type=file]')
  await input!.uploadFile(join(dir, 'smoke.gif'), join(dir, 'smoke.png'))
  await page.waitForSelector('.pipe')
  await shot(page, 'upload-running')
  let published = false
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('.tbl tbody .st')].filter((e) => e.textContent?.includes('已发布')).length >= 2, { timeout: 60_000 })
    published = true
  } catch {
    // reported below
  }
  check(published, 'upload: two files uploaded, ingested, previews rendered and published')
  await shot(page, 'upload-done')

  // ---- characters: create, open the merge tool ----
  await page.goto(`${base}/admin/characters`, { waitUntil: 'networkidle0' })
  await clickText(page, '.adm-h button', '新建角色')
  await page.waitForSelector('.drawer input')
  await page.type('.drawer input', `冒烟角色${stamp}`)
  await shot(page, 'character-sheet')
  await clickText(page, '.drawer button', '保存')
  check(await toast(page, '已新建'), 'characters: create')
  await page.waitForFunction(() => !document.querySelector('.drawer'), { timeout: 5000 })
  await clickText(page, '.adm-h button', '合并角色')
  await page.waitForSelector('.merge-flow')
  const selects = await page.$$('.merge-flow select')
  const values = await selects[0]!.$$eval('option', (os) => os.map((o) => o.value).filter(Boolean))
  await selects[0]!.select(values.at(-1)!)
  await selects[1]!.select(values[0]!)
  await shot(page, 'character-merge')

  // ---- settings: announcement shows on the public site ----
  await page.goto(`${base}/admin/settings`, { waitUntil: 'networkidle0' })
  const ann = `后台冒烟公告 ${stamp}`
  const area = await page.$('textarea')
  await area!.click({ count: 3 })
  await page.keyboard.press('Backspace')
  await area!.type(ann)
  await clickText(page, '.panel-h button', '保存')
  check(await toast(page, '已保存'), 'settings: save announcement')
  await page.goto(`${base}/`, { waitUntil: 'networkidle0' })
  check((await page.content()).includes(ann), 'settings: announcement visible on the public page')

  // ---- library: open an emoji ----
  await page.goto(`${base}/admin/emojis?packId=${packId}`, { waitUntil: 'networkidle0' })
  await page.click('.tile-hit')
  await page.waitForFunction(() => document.querySelector('.drawer .adm-keys') != null, { timeout: 10_000 })
  await shot(page, 'emoji-drawer')
  check(true, 'library: emoji detail drawer')

  // ---- as 管理员: bulk hide + publish ----
  // separate cookie jar: both accounts use the same host
  const m = await (await browser.createBrowserContext()).newPage()
  await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await m.setCookie(...(await cookiesFor(ACCOUNTS[1].email)))
  await m.goto(`${base}/admin/packs?q=aimisi-01`, { waitUntil: 'networkidle0' })
  await m.click('tbody .check')
  await m.waitForSelector('.bulk')
  await shot(m, 'manager-bulk')
  await clickText(m, '.bulk button', '隐藏')
  check(await toast(m, '已隐藏 1 个包'), 'manager: bulk hide')
  await m.waitForNetworkIdle()
  await m.click('tbody .check')
  await m.waitForSelector('.bulk')
  await clickText(m, '.bulk button', '发布')
  check(await toast(m, '已发布 1 个包'), 'manager: bulk publish')

  // ---- audit trail ----
  await page.goto(`${base}/admin/audit`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.adm-audit', { timeout: 10_000 }).catch(async () => console.log('     audit page h1:', await page.$eval('h1, h3', (e) => e.textContent).catch(() => '?')))
  const rows = await page.$$eval('.adm-audit .it', (els) => els.length)
  check(rows >= 6, `audit: ${rows} entries recorded`)
  await clickText(page, '.adm-audit button', '查看改动')
  await page.screenshot({ path: join(outDir, 'interact-audit-diff.png'), fullPage: true })
  check(errors.length === 0, `no page errors (${errors.join(' | ')})`)
} finally {
  await browser.close()
}
if (failures.length) {
  console.log(`\n${failures.length} failure(s)`)
  process.exit(1)
}
