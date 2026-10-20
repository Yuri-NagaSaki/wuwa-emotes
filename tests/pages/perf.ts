// Manual performance check (not a unit test) against a production build:
//
//   bun run build && PORT=3182 … bun .output/server/index.mjs
//   bun tests/pages/perf.ts [upstream=http://localhost:3182] [out=.work/perf-i] [path…]
//
// The app does not compress responses (Cloudflare does in production), so requests go through an
// in-process proxy that gzips text responses like the CDN would. Each page loads in a fresh browser
// context as a phone (390×844, DPR 3) with 4× CPU slowdown and DevTools "Slow 4G" (1.44 Mbit/s,
// 562 ms RTT). Reported per page: LCP (time, element), CLS, bytes transferred by type (JS, CSS,
// fonts, images, HTML), the TP Rounded shards, request count, and every request that would leave the
// site (aborted and counted). Budgets (docs/ARCHITECTURE.md §8): LCP ≤ 2.5 s, CLS ≤ 0.02,
// JS ≤ 110 KB gzip, fonts ≤ 150 KB, ≤ 40 requests.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import puppeteer, { PredefinedNetworkConditions } from 'puppeteer-core'

const upstream = process.argv[2] ?? 'http://localhost:3182'
const outDir = process.argv[3] ?? '.work/perf-i'
const paths = process.argv.slice(4)
mkdirSync(outDir, { recursive: true })

const TEXT = /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg\+xml)/
const proxy = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url)
    const res = await fetch(upstream + url.pathname + url.search, { method: req.method, headers: req.headers, redirect: 'manual' })
    const headers = new Headers(res.headers)
    const type = headers.get('content-type') ?? ''
    if (TEXT.test(type) && (req.headers.get('accept-encoding') ?? '').includes('gzip') && res.status === 200) {
      const body = gzipSync(new Uint8Array(await res.arrayBuffer()), { level: 6 })
      headers.set('content-encoding', 'gzip')
      headers.delete('content-length')
      headers.delete('transfer-encoding')
      return new Response(body, { status: res.status, headers })
    }
    return new Response(res.body, { status: res.status, headers })
  },
})
const base = `http://localhost:${proxy.port}`

async function pickPaths(): Promise<string[]> {
  if (paths.length) return paths
  // a real pack and one of its stickers from the catalog
  const html = await (await fetch(`${base}/packs?sort=new`)).text()
  const slug = /href="\/packs\/([^"?#]+)"/.exec(html)?.[1] ?? 'aimisi-01'
  const pack = await (await fetch(`${base}/packs/${slug}`)).text()
  const id = /\/img\/v1\/p240\/[^/]+\/(r-[0-9a-f]{20})\./.exec(pack)?.[1]
  return ['/', '/packs', `/packs/${slug}`, ...(id ? [`/e/${id}`] : [])]
}

interface Result {
  path: string
  lcpMs: number | null
  lcpElement: string | null
  cls: number
  /** layout-shift sources (value, time, element, rect before → after) */
  shifts: string[]
  bytes: Record<string, number>
  fontFiles: string[]
  /** every same-site response: path, kind, bytes on the wire */
  files: { url: string; kind: string; bytes: number }[]
  requests: number
  external: string[]
  consoleErrors: string[]
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const results: Result[] = []
try {
  for (const path of await pickPaths()) {
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    )
    await page.emulateCPUThrottling(4)
    await page.emulateNetworkConditions(PredefinedNetworkConditions['Slow 4G'])
    await page.evaluateOnNewDocument(() => {
      const w = window as unknown as { __lcp: { t: number; el: string } | null; __cls: number; __shifts: string[] }
      w.__lcp = null
      w.__cls = 0
      w.__shifts = []
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { element?: Element; url?: string })[]) {
          const el = e.element
          w.__lcp = { t: e.startTime, el: el ? `${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''} ${e.url ?? ''}`.trim() : (e.url ?? '') }
        }
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: { node?: Node; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] })[]) {
          if (e.hadRecentInput) continue
          w.__cls += e.value
          for (const s of e.sources ?? []) {
            const el = s.node instanceof Element ? s.node : s.node?.parentElement
            w.__shifts.push(`${e.value.toFixed(4)} @${Math.round(e.startTime)}ms ${el ? el.tagName.toLowerCase() + '.' + [...el.classList].join('.') : '?'} ${JSON.stringify([s.previousRect.x, s.previousRect.y, s.previousRect.width, s.previousRect.height].map(Math.round))} → ${JSON.stringify([s.currentRect.x, s.currentRect.y, s.currentRect.width, s.currentRect.height].map(Math.round))}`)
          }
        }
      }).observe({ type: 'layout-shift', buffered: true })
    })

    const r: Result = { path, lcpMs: null, lcpElement: null, cls: 0, shifts: [], bytes: {}, fontFiles: [], files: [], requests: 0, external: [], consoleErrors: [] }
    const cdp = await page.createCDPSession()
    await cdp.send('Network.enable')
    const types = new Map<string, { type: string; url: string }>()
    cdp.on('Network.responseReceived', (e) => types.set(e.requestId, { type: e.type, url: e.response.url }))
    cdp.on('Network.loadingFinished', (e) => {
      const t = types.get(e.requestId)
      if (!t || t.url.startsWith('data:')) return
      const kind = /\.woff2(\?|$)/.test(t.url) ? 'font' : t.type.toLowerCase()
      r.bytes[kind] = (r.bytes[kind] ?? 0) + e.encodedDataLength
      if (kind === 'font') r.fontFiles.push(t.url.replace(base, ''))
      r.files.push({ url: t.url.replace(base, ''), kind, bytes: e.encodedDataLength })
    })
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const url = req.url()
      if (url.startsWith('data:') || url.startsWith('blob:')) return void req.continue()
      if (new URL(url).origin !== base) {
        r.external.push(url)
        return void req.abort('blockedbyclient')
      }
      r.requests++
      void req.continue()
    })
    page.on('console', (m) => m.type() === 'error' && r.consoleErrors.push(m.text()))
    page.on('pageerror', (e) => r.consoleErrors.push(String(e)))

    await page.goto(base + path, { waitUntil: 'networkidle0', timeout: 120_000 })
    await new Promise((res) => setTimeout(res, 3000))
    // LCP is final once the user interacts; read it before anything else happens
    const m = await page.evaluate(() => {
      const w = window as unknown as { __lcp: { t: number; el: string } | null; __cls: number; __shifts: string[] }
      return { lcp: w.__lcp, cls: w.__cls, shifts: w.__shifts }
    })
    r.lcpMs = m.lcp ? Math.round(m.lcp.t) : null
    r.lcpElement = m.lcp?.el ?? null
    r.cls = Math.round(m.cls * 10000) / 10000
    r.shifts = m.shifts
    await page.screenshot({ path: join(outDir, `${path.replace(/[^a-z0-9]+/gi, '_') || 'home'}.png`) })
    results.push(r)
    await ctx.close()
  }
} finally {
  await browser.close()
  proxy.stop(true)
}

const kb = (n: number | undefined) => ((n ?? 0) / 1024).toFixed(1)
console.log('page'.padEnd(34), 'LCP ms'.padStart(7), 'CLS'.padStart(7), 'JS KB'.padStart(7), 'CSS KB'.padStart(7), 'font KB'.padStart(8), 'img KB'.padStart(7), 'req'.padStart(4), 'ext'.padStart(4))
for (const r of results) {
  console.log(
    r.path.slice(0, 34).padEnd(34),
    String(r.lcpMs ?? '-').padStart(7),
    String(r.cls).padStart(7),
    kb(r.bytes.script).padStart(7),
    kb(r.bytes.stylesheet).padStart(7),
    kb(r.bytes.font).padStart(8),
    kb(r.bytes.image).padStart(7),
    String(r.requests).padStart(4),
    String(r.external.length).padStart(4),
  )
  console.log('   LCP element:', r.lcpElement)
  for (const sh of r.shifts) console.log('   shift:', sh)
  if (r.consoleErrors.length) console.log('   console errors:', r.consoleErrors.slice(0, 3).join(' | '))
}
writeFileSync(join(outDir, 'perf.json'), JSON.stringify({ upstream, conditions: 'phone 390×844 DPR3, CPU 4×, Slow 4G, gzip proxy', results }, null, 2))
