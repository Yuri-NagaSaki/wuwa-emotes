// Manual browser check (not a unit test) of the single-emoji dialog's history behaviour:
//   bun tests/pages/dialog-flow.ts [baseUrl=http://localhost:3181] [packSlug]
// open from the grid → the address bar shows /e/<id> (masked), one history entry is pushed;
// ←/→ replace that entry; Back closes; the page is not remounted (scroll kept, no refetch);
// deep link /e/<id> has the dialog in the server HTML; closing goes to /packs/<slug>; Back reopens.
import puppeteer from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3181'
const slug = process.argv[3] ?? 'vol-changli-02'
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const failures: string[] = []
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const serverFnCalls: string[] = []
  // catalog reads only: the comments section (loaded when it nears the viewport) has its own calls
  page.on('request', (r) => r.url().includes('/_serverFn/') && !decodeURIComponent(r.url()).includes('threadType') && serverFnCalls.push(r.url()))
  await page.goto(`${base}/packs/${slug}`, { waitUntil: 'networkidle0' })
  const before = await page.evaluate(() => document.querySelector('.sticky-tools .count')!.getBoundingClientRect().left)
  const historyLen = await page.evaluate(() => history.length)
  await page.evaluate(() => window.scrollTo(0, 400))
  await wait(200)
  await page.evaluate(() => (document.querySelectorAll('.tile .tile-hit')[2] as HTMLButtonElement).click())
  await wait(500)
  const url1 = page.url()
  check(/\/e\/r-[0-9a-f]{20}$/.test(url1), `open: address bar is /e/<id> (${url1})`)
  check((await page.$('.em-card[role="dialog"]')) !== null, 'open: dialog rendered')
  check(await page.evaluate(() => document.activeElement?.classList.contains('em-card') ?? false), 'open: focus moved into the dialog')
  check((await page.evaluate(() => history.length)) === historyLen + 1, 'open: pushed exactly one history entry')
  const after = await page.evaluate(() => document.querySelector('.sticky-tools .count')!.getBoundingClientRect().left)
  check(Math.abs(after - before) < 0.5, `open: page behind did not move sideways (${before} → ${after})`)
  check((await page.evaluate(() => window.scrollY)) === 400, 'open: scroll position kept')

  await page.keyboard.press('ArrowRight')
  await wait(400)
  const url2 = page.url()
  check(url2 !== url1 && /\/e\/r-/.test(url2), `→: switched sticker, address updated (${url2})`)
  check((await page.evaluate(() => history.length)) === historyLen + 1, '→: replaced, no new history entry')
  check((await page.$eval('.em-top h3', (h) => h.textContent ?? '')).includes('第 4 张'), '→: shows the 4th sticker')

  await page.keyboard.press('Tab')
  await page.keyboard.down('Shift')
  for (let i = 0; i < 20; i++) await page.keyboard.press('Tab')
  await page.keyboard.up('Shift')
  check(await page.evaluate(() => !!document.activeElement?.closest('.em-wrap')), 'focus trap: Shift+Tab stays inside the dialog')

  await page.goBack()
  await wait(500)
  check(page.url().endsWith(`/packs/${slug}`), `Back: address is the pack again (${page.url()})`)
  check((await page.$('.em-card')) === null, 'Back: dialog closed')
  check((await page.evaluate(() => window.scrollY)) === 400, 'Back: scroll position kept')

  await page.evaluate(() => (document.querySelectorAll('.tile .tile-hit')[0] as HTMLButtonElement).click())
  await wait(400)
  await page.keyboard.press('Escape')
  await wait(400)
  check(page.url().endsWith(`/packs/${slug}`) && (await page.$('.em-card')) === null, 'Esc closes and returns to the pack address')
  check(serverFnCalls.length === 0, `no data refetch while opening/switching/closing (${serverFnCalls.length} server fn calls)`)

  // deep link
  const id = url2.split('/e/')[1]!
  const html = await (await fetch(`${base}/e/${id}`)).text()
  check(html.includes('class="em-card') && html.includes('role="dialog"'), 'deep link: dialog is in the server HTML')
  check(/<link[^>]+rel="canonical"[^>]+\/e\/r-/.test(html), 'deep link: canonical is /e/<id>')
  check(/property="og:image" content="https?:\/\/[^"]+\/img\/v1\/p240\//.test(html), 'deep link: og:image is an absolute p240 URL')
  const deep = await browser.newPage()
  await deep.setViewport({ width: 1280, height: 800 })
  await deep.goto(`${base}/e/${id}`, { waitUntil: 'networkidle0' })
  check((await deep.$('.em-card')) !== null, 'deep link: dialog open after hydration')
  await deep.keyboard.press('ArrowLeft')
  await wait(400)
  check(deep.url() !== `${base}/e/${id}` && /\/e\/r-/.test(deep.url()), `deep link ←: address updated (${deep.url()})`)
  await deep.click('.em-top .icon-btn')
  await wait(600)
  check(deep.url().endsWith(`/packs/${slug}`) && (await deep.$('.em-card')) === null, `deep link close → /packs/<slug> (${deep.url()})`)
  await deep.goBack()
  await wait(600)
  check(/\/e\/r-/.test(deep.url()) && (await deep.$('.em-card')) !== null, 'deep link: Back reopens the sticker')
} finally {
  await browser.close()
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
