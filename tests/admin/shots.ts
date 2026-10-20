// Manual check (not a unit test): screenshots of every admin page as 站长 and as 管理员, at 1280×800 and
// 390×844 (full page), plus console errors per page.
//
//   bun tests/admin/shots.ts [baseUrl=http://localhost:3191] [outDir=.work/shots-h] [--only /admin/packs]
//
// Needs a dev server with CAP_DISABLED=1 and the accounts from tests/admin/dev-accounts.ts.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'
import { ACCOUNTS, PASSWORD } from './dev-accounts'

const args = process.argv.slice(2)
const onlyAt = args.indexOf('--only')
const only = onlyAt >= 0 ? args.splice(onlyAt, 2)[1] : undefined
const base = args[0] ?? 'http://localhost:3191'
const outDir = args[1] ?? '.work/shots-h'
mkdirSync(outDir, { recursive: true })

const PAGES: { name: string; path: string }[] = [
  { name: 'dash', path: '/admin' },
  { name: 'packs', path: '/admin/packs' },
  { name: 'pack-edit', path: '/admin/packs/:first' },
  { name: 'upload', path: '/admin/upload' },
  { name: 'emojis', path: '/admin/emojis' },
  { name: 'characters', path: '/admin/characters' },
  { name: 'artists', path: '/admin/artists' },
  { name: 'tags', path: '/admin/taxonomy' },
  { name: 'users', path: '/admin/users' },
  { name: 'downloads', path: '/admin/downloads' },
  { name: 'storage', path: '/admin/storage' },
  { name: 'jobs', path: '/admin/jobs' },
  { name: 'audit', path: '/admin/audit' },
  { name: 'settings', path: '/admin/settings' },
]
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800, isMobile: false },
  { name: 'phone', width: 390, height: 844, isMobile: true },
]

async function signIn(email: string): Promise<{ name: string; value: string }[]> {
  const res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base, 'x-cap-token': 'dev-cap-disabled' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  if (res.status !== 200) throw new Error(`sign-in ${email}: ${res.status} ${await res.text()}`)
  return res.headers.getSetCookie().map((c) => {
    const [pair] = c.split(';')
    const i = pair!.indexOf('=')
    return { name: pair!.slice(0, i), value: pair!.slice(i + 1) }
  })
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  // scroll through so lazy images load, then back to the top
  await page.evaluate(async () => {
    const step = Math.round(innerHeight * 0.8)
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 80))
    }
    window.scrollTo(0, 0)
  })
  await new Promise((r) => setTimeout(r, 500))
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
})
const report: Record<string, { status: number | null; errors: string[] }> = {}
try {
  for (const account of ACCOUNTS) {
    const cookies = await signIn(account.email)
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage()
      await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.isMobile, hasTouch: vp.isMobile, deviceScaleFactor: 1 })
      await page.setCookie(...cookies.map((c) => ({ ...c, url: base })))
      const errors: string[] = []
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text())
      })
      page.on('pageerror', (e) => errors.push(String(e)))
      let first: string | null = null
      for (const p of PAGES) {
        if (only && p.path !== only && !(only === '/admin/packs/:first' && p.name === 'pack-edit')) continue
        let path = p.path
        if (path.includes(':first')) {
          if (!first) {
            await page.goto(`${base}/admin/packs?sort=downloads`, { waitUntil: 'networkidle0' })
            first = await page.$eval('a[href^="/admin/packs/"]', (a) => a.getAttribute('href')).catch(() => null)
          }
          if (!first) continue
          path = first
        }
        errors.length = 0
        const res = await page.goto(base + path, { waitUntil: 'networkidle0' })
        await settle(page)
        const file = join(outDir, `${p.name}-${account.role === 'admin' ? 'owner' : 'manager'}-${vp.name}.png`)
        await page.screenshot({ path: file, fullPage: true })
        report[file] = { status: res?.status() ?? null, errors: [...errors] }
        console.log(file, res?.status(), errors.length ? `errors: ${errors.join(' | ').slice(0, 300)}` : '')
      }
      await page.close()
    }
  }
} finally {
  await browser.close()
}
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
