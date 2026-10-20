// Manual check (not a unit test): screenshots of every public page and overlay at desktop (1280×800)
// and phone (390×844) sizes, plus a request audit, into .work/shots-i/ with an index.md.
//
//   bun tests/pages/page-shots.ts [baseUrl=http://localhost:3182] [outDir=.work/shots-i]
//
// Requests leaving the site are aborted and counted (the pages must not make any). Each page gets a
// first-screen shot and a full-page shot taken after scrolling through (lazy images loaded).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3182'
const outDir = process.argv[3] ?? '.work/shots-i'
const origin = new URL(base).origin
mkdirSync(outDir, { recursive: true })

async function discover() {
  const html = await (await fetch(`${base}/packs?sort=new`)).text()
  const slugs = [...html.matchAll(/href="\/packs\/([^"?#]+)"/g)].map((m) => decodeURIComponent(m[1]!))
  const slug = slugs.find((s) => s.startsWith('vol-')) ?? slugs[0] ?? 'aimisi-01'
  const pack = await (await fetch(`${base}/packs/${slug}`)).text()
  const id = /\/img\/v1\/p240\/[^/]+\/(r-[0-9a-f]{20})\./.exec(pack)?.[1] ?? ''
  // a preview-only (official) pack
  const official = await (await fetch(`${base}/packs?source=official`)).text()
  const pv = /href="\/packs\/([^"?#]+)"/.exec(official)?.[1] ?? slug
  const chars = await (await fetch(`${base}/characters`)).text()
  const char = /href="\/characters\/([^"?#]+)"/.exec(chars)?.[1] ?? 'aimisi'
  const artists = await (await fetch(`${base}/artists`)).text()
  const artist = /href="\/artists\/([^"?#]+)"/.exec(artists)?.[1] ?? 'wuxue'
  return { slug, id, pv, char, artist }
}

interface Shot {
  name: string
  path: string
  note: string
  /** prototype page id in design/prototype/src/pages-public.js */
  proto: string
  action?: (page: Page, phone: boolean) => Promise<void>
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    const step = Math.round(innerHeight * 0.8)
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 120))
    }
    window.scrollTo(0, 0)
  })
  await wait(500)
}

const d = await discover()
const shots: Shot[] = [
  { name: 'home', path: '/', proto: 'home', note: '首页：潮池主视觉、角色潮汐、站长精选、新上架、潮汐流、去探索' },
  { name: 'packs', path: '/packs', proto: 'packs', note: '表情包目录：筛选条、排序、瀑布流' },
  { name: 'packs-filtered', path: `/packs?character=${d.char}&sort=new`, proto: 'packs', note: '目录：已选角色筛选与排序' },
  {
    name: 'packs-popover',
    path: '/packs',
    proto: 'packs',
    note: '目录：角色面板（桌面是按内容定高的下拉面板，手机是底部面板）',
    action: async (page) => {
      await page.evaluate(() => ([...document.querySelectorAll('.fb-facets .fchip')][0] as HTMLButtonElement).click())
      await wait(1200)
    },
  },
  { name: 'pack', path: `/packs/${d.slug}`, proto: 'pack', note: '包详情：封面、署名卡、整包下载、方格、评论区、上一组/下一组' },
  {
    name: 'pack-select',
    path: `/packs/${d.slug}`,
    proto: 'pack',
    note: '包详情：多选模式，已选 3 张，底部操作条',
    action: async (page) => {
      await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.sticky-tools .btn')].find((b) => b.textContent?.includes('多选'))?.click())
      await wait(300)
      await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('.tile .tile-hit')].slice(0, 3).forEach((b) => b.click()))
      await page.evaluate(() => window.scrollTo(0, 420))
      await wait(500)
    },
  },
  { name: 'pack-preview-only', path: `/packs/${d.pv}`, proto: 'pack', note: '只提供预览的包（官方转载）' },
  {
    name: 'dialog',
    path: `/packs/${d.slug}`,
    proto: 'emoji',
    note: '单张弹窗：从方格打开（地址栏变成 /e/<id>）',
    action: async (page) => {
      await page.evaluate(() => (document.querySelectorAll<HTMLButtonElement>('.tile .tile-hit')[2]!).click())
      await wait(1000)
    },
  },
  { name: 'emoji-deeplink', path: `/e/${d.id}`, proto: 'emoji', note: '单张深链 /e/<id>：服务端渲染包页面并打开弹窗' },
  {
    name: 'dialog-preview-only',
    path: `/packs/${d.pv}`,
    proto: 'emoji',
    note: '只提供预览的包的单张弹窗：只有收藏与复制链接',
    action: async (page) => {
      await page.evaluate(() => (document.querySelectorAll<HTMLButtonElement>('.tile .tile-hit')[0]!).click())
      await wait(1000)
    },
  },
  { name: 'gallery', path: '/gallery', proto: 'gallery', note: '潮汐画廊：虚拟化方格、角色筛选、类型、排序、洗牌、自动播放' },
  { name: 'characters', path: '/characters', proto: 'characters', note: '角色图鉴' },
  { name: 'characters-pinyin', path: '/characters?sort=pinyin', proto: 'characters', note: '角色图鉴：拼音排序与字母分组' },
  { name: 'character', path: `/characters/${d.char}`, proto: 'char', note: '角色详情：主题色页头、波浪下沿、表情包标签页' },
  { name: 'character-emojis', path: `/characters/${d.char}?tab=emojis`, proto: 'char', note: '角色详情：全部表情' },
  { name: 'artists', path: '/artists', proto: 'artists', note: '画师名录' },
  { name: 'artist', path: `/artists/${d.artist}`, proto: 'artist', note: '画师主页' },
  { name: 'explore', path: '/explore', proto: 'explore', note: '探索：随机一包、今日推荐、标签云' },
  { name: 'search', path: `/search?q=${encodeURIComponent('长离')}`, proto: 'search', note: '搜索结果：最佳匹配与分组' },
  {
    name: 'palette',
    path: '/',
    proto: 'search',
    note: 'Ctrl K 指令面板（输入「长」）',
    action: async (page, phone) => {
      if (phone) await page.evaluate(() => (document.querySelector('.m-search') as HTMLButtonElement).click())
      else await page.keyboard.down('Control'), await page.keyboard.press('k'), await page.keyboard.up('Control')
      await wait(900)
      await page.keyboard.type('长')
      await wait(1200)
    },
  },
  { name: 'about', path: '/about', proto: 'about', note: '关于' },
  { name: 'links', path: '/links', proto: 'links', note: '友情链接（尚无数据：空状态）' },
  { name: 'legal-privacy', path: '/legal/privacy', proto: 'legal', note: '隐私政策' },
  { name: 'legal-terms', path: '/legal/terms', proto: 'legal', note: '服务条款' },
  { name: 'legal-takedown', path: '/legal/takedown', proto: 'legal', note: '版权与下架申诉' },
  { name: '404', path: '/packs/no-such-pack', proto: 'notfound', note: '404（不存在的包）' },
  { name: 'legacy-404', path: '/archives/no-such-post', proto: 'notfound', note: '旧地址无对应时的 404（站点外壳内）' },
]

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
})
const rows: string[] = []
let externalTotal = 0
const external: string[] = []
const errors: string[] = []
try {
  for (const v of [
    { name: 'desktop', width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    { name: 'phone', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ]) {
    for (const s of shots) {
      const ctx = await browser.createBrowserContext()
      const page = await ctx.newPage()
      await page.setViewport(v)
      await page.setRequestInterception(true)
      page.on('request', (req) => {
        const url = req.url()
        if (url.startsWith('data:') || url.startsWith('blob:')) return void req.continue()
        if (new URL(url).origin !== origin) {
          externalTotal++
          external.push(`${s.name}/${v.name}: ${url}`)
          return void req.abort('blockedbyclient')
        }
        void req.continue()
      })
      page.on('pageerror', (e) => errors.push(`${s.name}/${v.name}: ${e}`))
      // the document itself answering 404 is expected on the 404 shots
      page.on('console', (m) => m.type() === 'error' && !(s.name.includes('404') && m.text().includes('status of 404')) && errors.push(`${s.name}/${v.name}: ${m.text()}`))
      const res = await page.goto(base + s.path, { waitUntil: 'networkidle0', timeout: 60_000 })
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      const top = `${s.name}-${v.name}.png`
      const full = `${s.name}-${v.name}-full.png`
      if (s.action) {
        await s.action(page, v.name === 'phone')
        await page.screenshot({ path: join(outDir, top) })
        rows.push(`| ${s.name} | ${v.name} | ${res?.status()} | \`${page.url().replace(origin, '')}\` | [${top}](${top}) | — | ${s.proto} | ${s.note} |`)
      } else {
        await wait(400)
        await page.screenshot({ path: join(outDir, top) })
        await scrollThrough(page)
        await page.screenshot({ path: join(outDir, full), fullPage: true })
        rows.push(`| ${s.name} | ${v.name} | ${res?.status()} | \`${s.path}\` | [${top}](${top}) | [full](${full}) | ${s.proto} | ${s.note} |`)
      }
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}

const index = [
  '# Lane I 页面截图',
  '',
  `生成：${new Date().toISOString()} · 来源：${base}（生产构建）· 桌面 1280×800，手机 390×844（DPR 2）`,
  '',
  `站外请求：${externalTotal} 个（全部拦截并计数）${external.length ? '\n\n' + external.map((e) => `- ${e}`).join('\n') : ''}`,
  '',
  `页面错误：${errors.length ? '\n\n' + errors.map((e) => `- ${e}`).join('\n') : '无'}`,
  '',
  '| 名称 | 尺寸 | 状态 | 地址 | 首屏 | 整页 | 设计稿页面 | 说明 |',
  '|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
].join('\n')
writeFileSync(join(outDir, 'index.md'), index)
console.log(`${rows.length} shots, ${externalTotal} external requests, ${errors.length} page errors → ${join(outDir, 'index.md')}`)
if (errors.length) console.log(errors.slice(0, 10).join('\n'))
