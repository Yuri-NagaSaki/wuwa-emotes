// Manual check (not a unit test): no sticker keeps sharp corners inside a rounded frame. Stickers are
// square and often opaque (white or tinted cards), so an image inside a rounded frame must take the
// concentric radius or be clipped by the frame (components.css, "rounded frames").
//
//   bun tests/pages/corner-audit.ts [baseUrl=http://localhost:3182] [cookies.json]
//
// Needs opaque stickers in the data (tests/pages/volume-fixture.ts paints them). With a 站长 session
// cookie file (puppeteer cookie list) the admin library and pack editor are checked too. For every
// opaque painted box (an image after object-fit, or a filled box holding an image) the nearest rounded
// ancestor that contains it is found and the box's corners are checked against the frame's inner curve:
//   protrudes        a square corner reaches past the curve and nothing clips it
//   clipped          it reaches past the curve and the frame cuts the image (not an edge-to-edge area)
//   square-in-curve  it stays inside but sits in the curve with a much smaller radius than concentric
// Edge-to-edge areas the frame rounds (a card cover, a chip avatar) are by design and not reported.
// Exits 1 when anything is reported outside the characters pages' avatars (lane CH).
import { readFileSync } from 'node:fs'
import puppeteer, { type Page } from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3182'
const cookies = process.argv[3] ? JSON.parse(readFileSync(process.argv[3], 'utf8')) : null
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const html = await (await fetch(`${base}/packs?sort=new`)).text()
const slug = [...html.matchAll(/href="\/packs\/([^"?#]+)"/g)].map((m) => decodeURIComponent(m[1]!)).find((s) => s.startsWith('vol-')) ?? 'aimisi-01'
const packHtml = await (await fetch(`${base}/packs/${slug}`)).text()
const emoji = /\/img\/v1\/p240\/[^/]+\/(r-[0-9a-f]{20})\./.exec(packHtml)?.[1] ?? ''
const ids = [...new Set([...packHtml.matchAll(/\/img\/v1\/p240\/[^/]+\/(r-[0-9a-f]{20})\./g)].map((m) => m[1]!))].slice(0, 6)

interface Item {
  name: string
  path: string
  act?: (p: Page, phone: boolean) => Promise<void>
  tray?: boolean
  admin?: boolean
}
const items: Item[] = [
  { name: 'home', path: '/' },
  { name: 'packs', path: '/packs' },
  { name: 'pack', path: `/packs/${slug}` },
  { name: 'dialog', path: `/e/${emoji}` },
  { name: 'gallery', path: '/gallery' },
  { name: 'explore', path: '/explore' },
  { name: 'search', path: `/search?q=${encodeURIComponent('爱弥斯')}` },
  { name: 'artist', path: '/artists/wuxue' },
  { name: '404', path: '/no-such-page-corners' },
  { name: 'batch', path: '/batch', tray: true },
  {
    name: 'tray',
    path: '/',
    tray: true,
    act: async (p, phone) => {
      await p.evaluate((s: string) => (document.querySelector(s) as HTMLElement | null)?.click(), phone ? '.fab-bottle' : '.bottle-btn')
      await wait(2000)
    },
  },
  {
    name: 'palette',
    path: '/',
    act: async (p, phone) => {
      if (phone) await p.evaluate(() => (document.querySelector('.m-search') as HTMLElement | null)?.click())
      else (await p.keyboard.down('Control'), await p.keyboard.press('k'), await p.keyboard.up('Control'))
      await wait(800)
      await p.keyboard.type('爱')
      await wait(1500)
    },
  },
  ...(cookies ? [{ name: 'admin-emojis', path: '/admin/emojis', admin: true }] : []),
]

// runs in the page
const AUDIT = () => {
  const px = (v: string) => parseFloat(v) || 0
  const rad = (v: string, w: number, h: number) => (v.trim().endsWith('%') ? (parseFloat(v) / 100) * Math.min(w, h) : px(v))
  const alpha = (c: string) => {
    const m = /rgba?\(([^)]+)\)/.exec(c)
    if (!m) return 1
    const p = m[1]!.split(/[ ,/]+/).filter(Boolean)
    return p.length > 3 ? parseFloat(p[3]!) : 1
  }
  const desc = (e: Element) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
  const out: { kind: string; frame: string; media: string }[] = []
  for (const m of [...document.body.querySelectorAll('*')] as HTMLElement[]) {
    const isMedia = /^(IMG|VIDEO|CANVAS)$/.test(m.tagName)
    const cs = getComputedStyle(m)
    const filled = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && alpha(cs.backgroundColor) > 0.5) || /url\(|gradient/.test(cs.backgroundImage)
    if (!isMedia && !(filled && m.querySelector('img'))) continue
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue
    const mr = m.getBoundingClientRect()
    if (mr.width < 8 || mr.height < 8) continue
    let L = mr.left, T = mr.top, W = mr.width, H = mr.height
    let opaque = filled
    if (isMedia && !filled) {
      L += px(cs.borderLeftWidth) + px(cs.paddingLeft)
      T += px(cs.borderTopWidth) + px(cs.paddingTop)
      W -= px(cs.borderLeftWidth) + px(cs.borderRightWidth) + px(cs.paddingLeft) + px(cs.paddingRight)
      H -= px(cs.borderTopWidth) + px(cs.borderBottomWidth) + px(cs.paddingTop) + px(cs.paddingBottom)
      const im = m as HTMLImageElement
      const nw = im.naturalWidth || W, nh = im.naturalHeight || H
      if ((cs.objectFit === 'contain' || cs.objectFit === 'scale-down') && nw && nh) {
        const sc = Math.min(W / nw, H / nh, cs.objectFit === 'scale-down' ? 1 : Infinity)
        L += (W - nw * sc) / 2; T += (H - nh * sc) / 2; W = nw * sc; H = nh * sc
      }
      opaque = false
      if (m.tagName === 'IMG' && im.complete && im.naturalWidth > 4) {
        try {
          const c = document.createElement('canvas')
          c.width = nw
          c.height = nh
          const g = c.getContext('2d')!
          g.drawImage(im, 0, 0)
          opaque = [[1, 1], [nw - 2, 1], [1, nh - 2], [nw - 2, nh - 2]].filter(([x, y]) => g.getImageData(x!, y!, 1, 1).data[3]! > 200).length >= 2
        } catch {
          opaque = false
        }
      }
    }
    if (!opaque) continue
    const ownR = Math.min(rad(cs.borderTopLeftRadius, mr.width, mr.height), mr.width / 2, mr.height / 2)
    for (let a = m.parentElement; a && a !== document.body; a = a.parentElement) {
      const as = getComputedStyle(a)
      const ar = a.getBoundingClientRect()
      if (!(L >= ar.left - 1 && T >= ar.top - 1 && L + W <= ar.right + 1 && T + H <= ar.bottom + 1)) break
      const half = Math.min(ar.width, ar.height) / 2
      const radii = [as.borderTopLeftRadius, as.borderTopRightRadius, as.borderBottomLeftRadius, as.borderBottomRightRadius].map((v) => Math.min(rad(v, ar.width, ar.height), half))
      const clips = /hidden|clip/.test(as.overflow) || /hidden|clip/.test(as.overflowX)
      if (clips && Math.max(...radii) <= 0) break
      if (Math.max(...radii) <= 0) continue
      const bw = px(as.borderTopWidth)
      if (radii.every((x) => x >= half - 1) && ownR >= Math.min(mr.width, mr.height) / 2 - 1) break
      const left = ar.left + bw, top = ar.top + bw, right = ar.right - bw, bottom = ar.bottom - bw
      const ins = [[L - left, T - top], [right - (L + W), T - top], [L - left, bottom - (T + H)], [right - (L + W), bottom - (T + H)]]
      const k = ownR * (1 - Math.SQRT1_2)
      let over = 0, need = 0, maxInset = 0
      for (const [n, [ix, iy]] of ins.entries()) {
        const ri = Math.max(0, radii[n]! - bw)
        if (ri > 0 && ix! < ri && iy! < ri) {
          over = Math.max(over, Math.hypot(ri - ix! - k, ri - iy! - k) - ri)
          need = Math.max(need, ri - Math.min(ix!, iy!))
          maxInset = Math.max(maxInset, Math.min(ix!, iy!))
        }
      }
      const sameBox = Math.abs(W - ar.width) < 2 && Math.abs(H - ar.height) < 2 && ownR >= Math.max(...radii) - 1
      if (need > 0 && !sameBox) {
        const kind = over > 0.75 ? (clips ? (maxInset <= 1 ? '' : 'clipped') : 'protrudes') : need - ownR > 4 ? 'square-in-curve' : ''
        if (kind) out.push({ kind, frame: `${a.parentElement ? desc(a.parentElement) + ' > ' : ''}${desc(a)}`, media: desc(m) })
      }
      break
    }
  }
  return out
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const found: string[] = []
try {
  for (const w of [1280, 390]) {
    for (const it of items) {
      const ctx = await browser.createBrowserContext()
      const page = await ctx.newPage()
      const phone = w < 761
      const vp = { width: w, height: phone ? 844 : 900, isMobile: phone, hasTouch: phone }
      await page.setViewport(vp)
      if (it.tray) await page.evaluateOnNewDocument((v: string) => localStorage.setItem('tp-batch-v1', v), JSON.stringify(ids))
      if (it.admin && cookies) await page.setCookie(...cookies)
      await page.goto(base + it.path, { waitUntil: 'networkidle0', timeout: 60_000 })
      if (it.act) await it.act(page, phone)
      else {
        const h = await page.evaluate(() => document.documentElement.scrollHeight)
        await page.setViewport({ ...vp, height: Math.min(h, 6000) })
        try {
          await page.waitForNetworkIdle({ idleTime: 700, timeout: 15_000 })
        } catch {
          // keep going: a slow image only means fewer boxes to check
        }
      }
      for (const r of await page.evaluate(AUDIT)) found.push(`${it.name}@${w}  ${r.kind}  ${r.frame} → ${r.media}`)
      await ctx.close()
    }
  }
} finally {
  await browser.close()
}
// lane CH owns the characters pages' avatars (home 角色潮汐 strip, the character hero)
const ch = found.filter((f) => /cchip|char-hero/.test(f))
const mine = found.filter((f) => !ch.includes(f))
console.log(mine.length ? mine.join('\n') : 'no sticker with sharp corners in a rounded frame')
if (ch.length) console.log(`(${ch.length} on the characters pages' avatars, lane CH)`)
process.exit(mine.length ? 1 : 0)
