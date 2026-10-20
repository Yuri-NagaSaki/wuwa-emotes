// Manual check (not a unit test) of the page container at several widths: first-screen screenshots of
// home, a pack page, search and a legal page at 390, 1280, 1440 and 1920 px, plus the measured
// container edges (header, main content, footer) so misaligned edges show up as numbers.
//
//   bun tests/pages/width-shots.ts [baseUrl=http://localhost:3182] [outDir=.work/shots-i/widths]
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3182'
const outDir = process.argv[3] ?? '.work/shots-i/widths'
mkdirSync(outDir, { recursive: true })

const html = await (await fetch(`${base}/packs?sort=new`)).text()
const slug = [...html.matchAll(/href="\/packs\/([^"?#]+)"/g)].map((m) => m[1]!).find((s) => s.startsWith('vol-')) ?? 'aimisi-01'
const pages: [string, string][] = [
  ['home', '/'],
  ['pack', `/packs/${slug}`],
  ['search', `/search?q=${encodeURIComponent('长离')}`],
  ['legal', '/legal/privacy'],
]
const widths = [390, 1280, 1440, 1920]

const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const rows: string[] = []
try {
  for (const [name, path] of pages) {
    for (const w of widths) {
      const page = await browser.newPage()
      const phone = w < 760
      await page.setViewport({ width: w, height: phone ? 844 : 900, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone })
      await page.goto(base + path, { waitUntil: 'networkidle0', timeout: 60_000 })
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      const file = `${name}-${w}.png`
      await page.screenshot({ path: join(outDir, file) })
      const m = await page.evaluate(() => {
        const box = (sel: string) => {
          const el = document.querySelector(sel)
          if (!el) return null
          const r = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          return [Math.round(r.left + parseFloat(cs.paddingLeft)), Math.round(r.right - parseFloat(cs.paddingRight))]
        }
        const main = document.querySelector('main .wrap.narrow') ? 'main .wrap.narrow' : 'main .wrap'
        return {
          header: box('.head .wrap'),
          main: box(main),
          footer: box('.foot .wrap'),
          viewport: document.documentElement.clientWidth,
          lanes: getComputedStyle(document.querySelector('.vm-inner') ?? document.body).getPropertyValue('--n').trim() || null,
        }
      })
      rows.push(
        `| ${name} | ${w} | ${m.viewport} | ${m.header?.join('–')} | ${m.main?.join('–')} | ${m.footer?.join('–')} | ${m.lanes ?? '—'} | [${file}](${file}) |`,
      )
      await page.close()
    }
  }
} finally {
  await browser.close()
}
const index = [
  '# 页面容器：390 / 1280 / 1440 / 1920 px',
  '',
  '内容区左右边（去掉 padding 后）：页头、正文、页脚。阅读页（法律、关于、友链）用 1200 px 窄容器，所以正文比页头窄。',
  '',
  '| 页面 | 宽度 | 视口 | 页头内容 | 正文内容 | 页脚内容 | 瀑布流列数 | 截图 |',
  '|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
].join('\n')
writeFileSync(join(outDir, 'index.md'), index)
console.log(index)
