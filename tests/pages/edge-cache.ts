// Manual check (not a unit test) of the shared-cache rule for public catalog server functions:
//
//   bun tests/pages/edge-cache.ts [baseUrl=http://localhost:3181]
//
// Captures the GET server-function requests a client-side navigation makes (home → /packs → a pack),
// then repeats each one without cookies and with a (fake) session cookie. Anonymous: the pages' catalog
// data answers `public, s-maxage=30, stale-while-revalidate=300` (viewer-specific functions such as the
// comment thread stay `no-store`); with a session cookie every one answers `private, no-store`.
// Against production it also prints cf-cache-status, which shows whether Cloudflare stores them.
import puppeteer from 'puppeteer-core'

const base = (process.argv[2] ?? 'http://localhost:3181').replace(/\/$/, '')
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const failures: string[] = []
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  // every GET server function seen; the first one after each click is that page's catalog data
  const urls = new Set<string>()
  const pageData = new Set<string>()
  let awaiting = false
  page.on('request', (r) => {
    if (r.method() !== 'GET' || !r.url().includes('/_serverFn/')) return
    urls.add(r.url())
    if (awaiting) {
      pageData.add(r.url())
      awaiting = false
    }
  })
  await page.goto(`${base}/`, { waitUntil: 'networkidle0' })
  awaiting = true
  await page.evaluate(() => (document.querySelector('header a[href="/packs"]') as HTMLAnchorElement).click())
  await page.waitForFunction(() => location.pathname === '/packs' && !!document.querySelector('main .pcard'))
  const card = await page.$eval('main a.pcard-cover', (a) => (a as HTMLAnchorElement).pathname)
  awaiting = true
  await page.evaluate((href) => (document.querySelector(`main a.pcard-cover[href="${href}"]`) as HTMLAnchorElement).click(), card)
  await page.waitForFunction(() => !!document.querySelector('.pack-page h1'))
  await new Promise((r) => setTimeout(r, 1000))
  if (pageData.size < 2) failures.push(`expected the /packs and pack data requests, saw ${pageData.size}`)
  for (const url of urls) {
    const name = decodeURIComponent(new URL(url).pathname).slice(0, 40)
    // the headers the app's own fetch sends (the CSRF check wants a same-origin request)
    const headers = { accept: 'application/x-tss-framed, application/x-ndjson, application/json', 'x-tsr-serverfn': 'true', 'sec-fetch-site': 'same-origin', referer: `${base}/packs` }
    const anon = await fetch(url, { headers })
    const signed = await fetch(url, { headers: { ...headers, cookie: '__Secure-better-auth.session_token=check; better-auth.session_token=check' } })
    if (anon.status !== 200 || signed.status !== 200) failures.push(`${name}: status ${anon.status} / ${signed.status}`)
    const a = anon.headers.get('cache-control')
    const s = signed.headers.get('cache-control')
    const data = pageData.has(url)
    console.log(`${name}… ${data ? '(page data)' : '(other)    '} anonymous: ${a} [${anon.headers.get('cf-cache-status') ?? '-'}]  with session cookie: ${s}`)
    if (data && a !== 'public, s-maxage=30, stale-while-revalidate=300') failures.push(`${name}: anonymous page data got ${a}`)
    if (s !== 'private, no-store') failures.push(`${name}: session cookie got ${s}`)
    await anon.body?.cancel()
    await signed.body?.cancel()
  }
} finally {
  await browser.close()
}
if (failures.length) {
  console.log(`\n${failures.length} failure(s):\n  ${failures.join('\n  ')}`)
  process.exit(1)
}
console.log('\nok')
