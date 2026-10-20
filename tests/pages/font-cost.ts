// Manual check (not a unit test) of what the display font (TP Rounded) costs per page, against a
// production build:
//
//   bun run build && PORT=3182 … bun .output/server/index.mjs
//   bun tests/pages/font-cost.ts [base=http://localhost:3182] [out=.work/font-cost] [options] [path…]
//
//   --width <px>       viewport width (default 390: a phone, 390×844 DPR 3; 760 and up: 900 px high)
//   --css <dir>        price the pages under another shard plan: a tp-rounded/ directory (tp-rounded.css
//                      and its .woff2 files), e.g. the previous build or a scripts/fonts/build.ts output
//                      copied aside; repeatable
//   --chars <json>     skip the browser: reuse the characters of earlier runs' font-cost.json (repeatable;
//                      a page's characters are merged across runs, e.g. a phone and a desktop run)
//   --skip-text <file> one string per line (catalog text: titles, names); text nodes equal to one of
//                      them, and name initials, are left out of the site vocabulary
//   --vocab <file>     write the site vocabulary: the characters the pages set in TP Rounded outside
//                      the skipped text, without ASCII, in the order the pages (most important first)
//                      first use them; line 1 holds those of the first --vocab-lead pages (default 4),
//                      line 2 the rest (scripts/fonts/site-chars.txt)
//
// Default pages: /, /packs, the first pack on /packs, /characters. No throttling: only which files
// load matters here. Passes:
//   1. first visit: each page in a fresh browser context; font files and bytes on the wire (TP Rounded
//      shards and Nunito), all requests;
//   2. browsing: one context opens the pages in order (full loads, warm HTTP cache); the font files each
//      page adds;
//   3. estimate: the characters each page sets in TP Rounded, per face (Bold answers 600–850 and
//      anything lighter, Heavy 900), from the DOM of pass 1, and the shards they need under every --css
//      plan, first visit and in browsing order.
// Writes <out>/font-cost.json (files per page, characters per page and face, estimates).
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'

const args = process.argv.slice(2)
const cssDirs: string[] = []
const positional: string[] = []
let width = 390
const charsFrom: string[] = []
let skipFile: string | null = null
let vocabOut: string | null = null
let vocabLead = 4
for (let i = 0; i < args.length; i++) {
  const a = args[i]!
  if (a === '--css') cssDirs.push(args[++i]!)
  else if (a === '--width') width = Number(args[++i])
  else if (a === '--chars') charsFrom.push(args[++i]!)
  else if (a === '--skip-text') skipFile = args[++i]!
  else if (a === '--vocab') vocabOut = args[++i]!
  else if (a === '--vocab-lead') vocabLead = Number(args[++i])
  else positional.push(a)
}
const viewport = width < 760 ? { width, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { width, height: 900 }
const base = (positional[0] ?? 'http://localhost:3182').replace(/\/+$/, '')
const outDir = positional[1] ?? '.work/font-cost'
mkdirSync(outDir, { recursive: true })
const skip = skipFile ? readFileSync(skipFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : []

async function pickPaths(): Promise<string[]> {
  if (positional.length > 2) return positional.slice(2)
  const html = await (await fetch(`${base}/packs`)).text()
  const slug = /href="\/packs\/([^"?#]+)"/.exec(html)?.[1]
  return ['/', '/packs', ...(slug ? [`/packs/${slug}`] : []), '/characters']
}

type Face = 'bold' | 'heavy'
type FaceChars = Record<Face, string>
interface Visit {
  path: string
  /** same-origin font files: path, bytes on the wire */
  fonts: { url: string; bytes: number }[]
  requests: number
}

const isShard = (url: string) => /\/fonts\/tp-rounded\/[^/]+\.woff2$/.test(url)

async function open(page: Page, path: string): Promise<Visit> {
  const v: Visit = { path, fonts: [], requests: 0 }
  const cdp = await page.createCDPSession()
  await cdp.send('Network.enable')
  const urls = new Map<string, string>()
  const cached = new Set<string>()
  cdp.on('Network.requestWillBeSent', (e) => {
    urls.set(e.requestId, e.request.url)
    if (!e.request.url.startsWith('data:')) v.requests++
  })
  cdp.on('Network.requestServedFromCache', (e) => cached.add(e.requestId))
  cdp.on('Network.responseReceived', (e) => {
    if (e.response.fromDiskCache || e.response.fromServiceWorker) cached.add(e.requestId)
  })
  cdp.on('Network.loadingFinished', (e) => {
    const url = urls.get(e.requestId)
    if (!url || cached.has(e.requestId) || !/\.woff2(\?|$)/.test(url)) return
    v.fonts.push({ url: url.replace(base, ''), bytes: e.encodedDataLength })
  })
  await page.goto(base + path, { waitUntil: 'networkidle0', timeout: 120_000 })
  // the display CSS is inserted by a script; shards follow once text is laid out with it
  await page.evaluate(() => document.fonts.ready)
  await new Promise((r) => setTimeout(r, 1500))
  await cdp.detach()
  // cache hits are not transfers
  v.requests -= cached.size
  return v
}

/** Characters set in TP Rounded on the page, by face: all of them, and those outside the skipped text. */
async function displayChars(page: Page): Promise<{ all: FaceChars; site: FaceChars }> {
  return page.evaluate((skipList: string[]) => {
    const skipped = new Set(skipList)
    const all = { bold: new Set<string>(), heavy: new Set<string>() }
    const site = { bold: new Set<string>(), heavy: new Set<string>() }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      const text = n.textContent ?? ''
      if (!el || !text.trim() || !el.getClientRects().length) continue
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden') continue
      const first = st.fontFamily.split(',')[0]!.trim().replace(/^["']|["']$/g, '')
      if (first !== 'TP Rounded') continue
      const face = Number(st.fontWeight) > 850 ? 'heavy' : 'bold'
      // catalog text: a whole title or name, or a name's initial in an avatar
      const fromCatalog = skipped.has(text.trim()) || !!el.closest('[class*="initial"], .lcard .ico')
      for (const ch of text) {
        if (/\s/.test(ch)) continue
        all[face].add(ch)
        if (!fromCatalog) site[face].add(ch)
      }
    }
    const out = (s: { bold: Set<string>; heavy: Set<string> }) => ({ bold: [...s.bold].sort().join(''), heavy: [...s.heavy].sort().join('') })
    return { all: out(all), site: out(site) }
  }, skip)
}

interface Rule {
  file: string
  face: Face
  ranges: [number, number][]
  bytes: number
}

function loadPlan(dir: string): Rule[] {
  const css = readFileSync(join(dir, 'tp-rounded.css'), 'utf8')
  const rules: Rule[] = []
  for (const m of css.matchAll(/@font-face\{[^}]*?url\("\.\/([^"]+)"\)[^}]*?font-weight:([^;}]+)[^}]*?unicode-range:([^;}]+)/g)) {
    const ranges = m[3]!.split(',').map((part): [number, number] => {
      const [a, b] = part.trim().replace(/^U\+/i, '').split('-')
      return [parseInt(a!, 16), parseInt(b ?? a!, 16)]
    })
    rules.push({ file: m[1]!, face: m[2]!.trim() === '900' ? 'heavy' : 'bold', ranges, bytes: statSync(join(dir, m[1]!)).size })
  }
  return rules
}

function shardsFor(plan: Rule[], chars: FaceChars): Rule[] {
  const need = new Set<Rule>()
  for (const face of ['bold', 'heavy'] as const) {
    for (const ch of chars[face]) {
      const cp = ch.codePointAt(0)!
      // overlapping ranges: the last rule defined is checked first (CSS Fonts 4, unicode-range)
      const r = plan.findLast((x) => x.face === face && x.ranges.some(([a, b]) => cp >= a && cp <= b))
      if (r) need.add(r)
    }
  }
  return [...need]
}

const kb = (n: number) => (n / 1024).toFixed(1)
const sum = (xs: { bytes: number }[]) => xs.reduce((s, x) => s + x.bytes, 0)
const shardsOf = (v: Visit) => v.fonts.filter((f) => isShard(f.url))
const row = (v: Visit) =>
  [v.path.slice(0, 40).padEnd(40), String(shardsOf(v).length).padStart(7), kb(sum(shardsOf(v))).padStart(8), kb(sum(v.fonts)).padStart(9), String(v.requests).padStart(5)].join(' ')

let paths: string[]
let first: Visit[] = []
let browsing: Visit[] = []
let chars: Record<string, FaceChars> = {}
let site: Record<string, FaceChars> = {}
if (charsFrom.length) {
  const merge = (into: Record<string, FaceChars>, from: Record<string, FaceChars>) => {
    for (const [p, c] of Object.entries(from)) {
      const cur = into[p] ?? { bold: '', heavy: '' }
      into[p] = { bold: [...new Set([...cur.bold, ...c.bold])].sort().join(''), heavy: [...new Set([...cur.heavy, ...c.heavy])].sort().join('') }
    }
  }
  for (const f of charsFrom) {
    const prev = JSON.parse(readFileSync(f, 'utf8'))
    merge(chars, prev.chars)
    merge(site, prev.site ?? {})
  }
  paths = positional.length > 2 ? positional.slice(2) : Object.keys(chars)
} else {
  paths = await pickPaths()
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  try {
    for (const path of paths) {
      const ctx = await browser.createBrowserContext()
      const page = await ctx.newPage()
      await page.setViewport(viewport)
      first.push(await open(page, path))
      const c = await displayChars(page)
      chars[path] = c.all
      site[path] = c.site
      await ctx.close()
    }
    const ctx = await browser.createBrowserContext()
    const page = await ctx.newPage()
    await page.setViewport(viewport)
    for (const path of paths) browsing.push(await open(page, path))
    await ctx.close()
  } finally {
    await browser.close()
  }
  const head = ['page'.padEnd(40), 'shards'.padStart(7), 'TP KB'.padStart(8), 'fonts KB'.padStart(9), 'req'.padStart(5)].join(' ')
  console.log(`first visit (fresh context per page), ${base}, ${width} px wide\n${head}`)
  for (const v of first) console.log(row(v))
  console.log(`\nbrowsing (one context, pages in order): what each page adds\n${head}`)
  for (const v of browsing) console.log(row(v))
  console.log(`all pages: ${kb(browsing.reduce((s, v) => s + sum(v.fonts), 0))} KB of fonts`)
}

const estimates: Record<string, Record<string, { shards: number; bytes: number; newShards: number; newBytes: number }>> = {}
for (const dir of cssDirs) {
  const plan = loadPlan(dir)
  const est: (typeof estimates)[string] = (estimates[dir] = {})
  console.log(`\nestimate: ${dir} (${plan.length} rules)`)
  const seen = new Set<Rule>()
  let fresh = 0
  for (const path of paths) {
    const need = shardsFor(plan, chars[path]!)
    const added = need.filter((r) => !seen.has(r))
    for (const r of need) seen.add(r)
    est[path] = { shards: need.length, bytes: sum(need), newShards: added.length, newBytes: sum(added) }
    fresh += sum(need)
    console.log(
      path.slice(0, 40).padEnd(40),
      `first visit ${String(need.length).padStart(3)} shards ${kb(sum(need)).padStart(7)} KB`,
      `· after the pages above +${String(added.length).padStart(3)} shards ${kb(sum(added)).padStart(7)} KB`,
    )
  }
  console.log(`first visits summed: ${kb(fresh)} KB; all pages in order: ${seen.size} shards, ${kb(sum([...seen]))} KB`)
}

if (vocabOut) {
  // by the first page that uses them (list the pages most important first), so the first characters
  // cover the main pages; on one page, the ones more pages share first (the footer before the hero)
  const pages = new Map<string, number>()
  const firstPage = new Map<string, number>()
  for (const [i, p] of paths.entries()) {
    for (const ch of new Set([...(site[p]?.bold ?? ''), ...(site[p]?.heavy ?? '')])) {
      if (ch.codePointAt(0)! <= 0x7e) continue
      pages.set(ch, (pages.get(ch) ?? 0) + 1)
      if (!firstPage.has(ch)) firstPage.set(ch, i)
    }
  }
  const vocab = [...pages.keys()].sort(
    (a, b) => firstPage.get(a)! - firstPage.get(b)! || pages.get(b)! - pages.get(a)! || a.codePointAt(0)! - b.codePointAt(0)!,
  )
  const lead = vocab.filter((ch) => firstPage.get(ch)! < vocabLead)
  writeFileSync(vocabOut, `${lead.join('')}\n${vocab.slice(lead.length).join('')}\n`)
  console.log(`\nsite vocabulary: ${vocab.length} characters, ${lead.length} on the first ${vocabLead} pages -> ${vocabOut}`)
}
writeFileSync(join(outDir, 'font-cost.json'), JSON.stringify({ base, width, first, browsing, chars, site, estimates }, null, 2))
