// Manual check (not a unit test): screenshots of /kit at desktop and phone sizes, plus a request audit.
//
//   bun tests/ui/kit-shots.ts [baseUrl=http://localhost:3111] [outDir=.work/shots-kit]
//
// Needs a running dev server and Chromium (CHROMIUM_PATH, default /usr/bin/chromium). Every request
// that would leave the page's origin is aborted and counted; data:/blob: URLs never touch the network
// and are counted separately. Writes PNGs and report.json into outDir.
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3111'
const outDir = process.argv[3] ?? '.work/shots-kit'
const origin = new URL(base).origin
mkdirSync(outDir, { recursive: true })

interface Audit {
  external: string[]
  sameOrigin: number
  inline: number
  fonts: Set<string>
  consoleErrors: string[]
}

/** Bytes on disk of the TP Rounded shards a page requested (cache-proof). */
function shardBytes(files: Set<string>) {
  let n = 0
  for (const f of files) n += statSync(join('public/fonts/tp-rounded', f)).size
  return n
}

async function audit(page: Page): Promise<Audit> {
  const a: Audit = { external: [], sameOrigin: 0, inline: 0, fonts: new Set(), consoleErrors: [] }
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const url = req.url()
    if (url.startsWith('data:') || url.startsWith('blob:')) {
      a.inline++
      return void req.continue()
    }
    if (new URL(url).origin !== origin) {
      a.external.push(url)
      return void req.abort('blockedbyclient')
    }
    a.sameOrigin++
    void req.continue()
  })
  page.on('request', (req) => {
    const m = /\/fonts\/tp-rounded\/([^/?]+\.woff2)$/.exec(req.url())
    if (m) a.fonts.add(m[1]!)
  })
  page.on('console', (m) => {
    if (m.type() === 'error') a.consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => a.consoleErrors.push(String(e)))
  return a
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await new Promise((r) => setTimeout(r, 600))
}

/** Scroll through the page so lazy images and virtualized rows load, then back to the top. */
async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const step = Math.round(innerHeight * 0.8)
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 120))
    }
    window.scrollTo(0, 0)
  })
  await settle(page)
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
})
const report: Record<string, unknown> = { base }
try {
  for (const v of [
    { name: 'desktop', width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ]) {
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    await page.setViewport(v)
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    const a = await audit(page)
    const res = await page.goto(`${base}/kit`, { waitUntil: 'networkidle0', timeout: 60_000 })
    await settle(page)
    const firstScreenFonts = new Set(a.fonts)
    await page.screenshot({ path: join(outDir, `kit-${v.name}.png`) })
    await scrollThrough(page)
    await page.screenshot({ path: join(outDir, `kit-${v.name}-full.png`), fullPage: true })
    const sections = await page.$$('section.sec')
    for (const [i, el] of sections.entries()) await el.screenshot({ path: join(outDir, `sec-${v.name}-${i + 1}.png`) })

    const probe = await page.$('[data-probe="heavy"]')
    await probe?.scrollIntoView()
    await settle(page)
    await page.screenshot({ path: join(outDir, `kit-${v.name}-fonts.png`) })
    const fontsInUse = await page.evaluate(() => {
      const count: Record<string, number> = {}
      for (const f of document.fonts) if (f.status === 'loaded') count[`${f.family} ${f.weight}`] = (count[`${f.family} ${f.weight}`] ?? 0) + 1
      return count
    })

    // overlays
    await page.evaluate(() => window.scrollTo(0, 0))
    const click = async (text: string) => {
      const ok = await page.evaluate((t) => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === t)
        b?.click()
        return Boolean(b)
      }, text)
      await new Promise((r) => setTimeout(r, 700))
      return ok
    }
    if (await click('确认弹窗')) await page.screenshot({ path: join(outDir, `kit-${v.name}-modal.png`) })
    await page.keyboard.press('Escape')
    await new Promise((r) => setTimeout(r, 500))
    if (await click('打包清单')) await page.screenshot({ path: join(outDir, `kit-${v.name}-sheet.png`) })
    await page.keyboard.press('Escape')
    await new Promise((r) => setTimeout(r, 500))

    report[v.name] = {
      status: res?.status(),
      externalRequests: a.external.length,
      externalUrls: a.external,
      sameOriginRequests: a.sameOrigin,
      inlineDataUrls: a.inline,
      tpRoundedFirstScreen: { shards: firstScreenFonts.size, bytes: shardBytes(firstScreenFonts) },
      tpRoundedWholePage: { shards: a.fonts.size, bytes: shardBytes(a.fonts) },
      fontsInUse,
      consoleErrors: a.consoleErrors,
    }
    await ctx.close()
  }

  // anonymous /admin: the sign-in empty state inside the shell
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const a = await audit(page)
  const res = await page.goto(`${base}/admin`, { waitUntil: 'networkidle0', timeout: 60_000 })
  await settle(page)
  await page.screenshot({ path: join(outDir, 'admin-anonymous-desktop.png') })
  report.adminAnonymous = { status: res?.status(), externalRequests: a.external.length, text: await page.$eval('.adm-body', (el) => el.textContent) }
  await page.close()
} finally {
  await browser.close()
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
