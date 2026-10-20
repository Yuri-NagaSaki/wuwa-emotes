// Manual browser check (not a unit test): Tile preview playback on /kit in headless Chromium.
//
//   bun tests/ui/kit-playback.ts [baseUrl=http://localhost:3111]
//
// The 表情方块 card has 9 tiles, 6 of them animated. With the whole card inside the middle band of a tall
// viewport, at most 4 may play and their <img> must show the animated preview; hovering a waiting
// tile makes it play while the count stays at 4; with prefers-reduced-motion nothing plays.
import puppeteer, { type Page } from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3111'
const ANIMATED = 'animateTransform'

async function state(page: Page) {
  return page.evaluate((marker) => {
    const card = [...document.querySelectorAll('.ds-card')].find((c) => c.querySelector('h4')?.textContent?.startsWith('表情方块'))!
    const tiles = [...card.querySelectorAll<HTMLElement>('.tile')]
    return tiles.map((t) => {
      const src = decodeURIComponent(t.querySelector('img')!.getAttribute('src') ?? '')
      return { playing: t.hasAttribute('data-playing'), animatedSrc: src.includes(marker) }
    })
  }, ANIMATED)
}

async function centerCard(page: Page) {
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('.ds-card')].find((c) => c.querySelector('h4')?.textContent?.startsWith('表情方块'))!
    card.scrollIntoView({ block: 'center' })
  })
  await new Promise((r) => setTimeout(r, 1500))
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] })
const result: Record<string, unknown> = {}
try {
  for (const reduced of [false, true]) {
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    await page.setViewport({ width: 1280, height: 2400 })
    if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
    await page.goto(`${base}/kit`, { waitUntil: 'networkidle0' })
    await centerCard(page)
    const inView = await state(page)
    let hover: unknown = null
    if (!reduced) {
      // hover an animated tile that is waiting (animated preview available, not playing)
      const idx = await page.evaluate(() => {
        const card = [...document.querySelectorAll('.ds-card')].find((c) => c.querySelector('h4')?.textContent?.startsWith('表情方块'))!
        const tiles = [...card.querySelectorAll<HTMLElement>('.tile')]
        return tiles.findIndex((t, i) => !t.hasAttribute('data-playing') && i % 3 !== 0)
      })
      if (idx >= 0) {
        const handles = await page.$$('.ds-card .grid-tiles .tile')
        await handles[idx]!.hover()
        await new Promise((r) => setTimeout(r, 1000))
        const s = await state(page)
        hover = { hoveredIndex: idx, hoveredPlaying: s[idx]!.playing, playing: s.filter((t) => t.playing).length }
      }
    }
    result[reduced ? 'reducedMotion' : 'default'] = {
      tiles: inView.length,
      animatedTiles: 6,
      playing: inView.filter((t) => t.playing).length,
      playingWithAnimatedSrc: inView.filter((t) => t.playing && t.animatedSrc).length,
      animatedSrcWithoutSlot: inView.filter((t) => !t.playing && t.animatedSrc).length,
      hover,
    }
    await ctx.close()
  }
} finally {
  await browser.close()
}
console.log(JSON.stringify(result, null, 2))
