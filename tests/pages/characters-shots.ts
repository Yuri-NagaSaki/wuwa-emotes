// Manual check (not a unit test): 角色图鉴, two character pages and the home 角色潮汐 strip at 390 and
// 1440 px, plus checks that no two cards share an avatar or a portrait and that every rounded frame
// clips its media. Writes PNGs and checks.json into the output directory.
//
//   bun tests/pages/characters-shots.ts [baseUrl=http://localhost:3197] [outDir=.work/shots-ch] [popular=aimisi] [shared=luokeke] [group=danjin]
//
// `shared` is a character whose avatar used to be a group pack's cover, `group` one that only appears
// in group packs (see characters-fixture.ts). No two atlas rows may read the same (art + count line),
// and no count line may say 0 张.
// The strip is also shot with portraits cropped into the circles instead of stickers, for comparison.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import puppeteer, { type Page } from 'puppeteer-core'

const base = process.argv[2] ?? 'http://localhost:3197'
const outDir = process.argv[3] ?? '.work/shots-ch'
const popular = process.argv[4] ?? 'aimisi'
const shared = process.argv[5] ?? 'luokeke'
const groupOnly = process.argv[6] ?? 'danjin'
const groupOnlyName = process.argv[7] ?? '丹瑾'
mkdirSync(outDir, { recursive: true })
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SIZES = [
  { name: '390', width: 390, height: 844, mobile: true },
  { name: '1440', width: 1440, height: 900, mobile: false },
]

async function settle(page: Page) {
  await page.evaluate(async () => {
    const step = Math.round(innerHeight * 0.8)
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 100))
    }
    window.scrollTo(0, 0)
  })
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        [...document.images].map((i) =>
          i.complete ? null : new Promise((r) => (i.addEventListener('load', r, { once: true }), i.addEventListener('error', r, { once: true }))),
        ),
      ),
      new Promise((r) => setTimeout(r, 5000)),
    ]),
  )
  await wait(400)
}

/** Images inside rounded frames: is every one clipped (a circle itself, or inside overflow:hidden)? */
async function clipping(page: Page) {
  return page.evaluate(() => {
    const out: { selector: string; ok: boolean; why: string }[] = []
    const frames = document.querySelectorAll<HTMLElement>(
      '.acard-art, .acard-pool, .acard-badge, .char-portrait, .char-portrait .badge, .char-hero .pool, .cchip .pool, .ccard .pool, .top-hit .pool, .ring-crop',
    )
    for (const f of frames) {
      const cs = getComputedStyle(f)
      const rounded = parseFloat(cs.borderTopLeftRadius) > 0 || f.classList.contains('acard-art')
      const clips = cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.overflow === 'clip'
      const img = f.querySelector(':scope > img')
      const imgRound = img ? getComputedStyle(img).borderTopLeftRadius === '50%' : false
      out.push({ selector: f.className, ok: !img || clips || imgRound, why: `${rounded ? 'rounded' : 'square'} frame, overflow ${cs.overflow}${img ? `, img radius ${getComputedStyle(img).borderTopLeftRadius}` : ', no img'}` })
    }
    return out
  })
}

const checks: Record<string, unknown> = {}
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] })
try {
  for (const size of SIZES) {
    const page = await browser.newPage()
    await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: size.mobile ? 2 : 1, isMobile: size.mobile, hasTouch: size.mobile })

    await page.goto(`${base}/characters`, { waitUntil: 'networkidle0' })
    await settle(page)
    await page.screenshot({ path: join(outDir, `characters-${size.name}.png`), fullPage: true })
    await page.screenshot({ path: join(outDir, `characters-${size.name}-top.png`) })
    const cards = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLAnchorElement>('a.acard')].map((a) => ({
        slug: decodeURIComponent(a.pathname.split('/').pop() ?? ''),
        avatar: a.querySelector<HTMLImageElement>('.acard-badge img, .acard-pool img')?.currentSrc || null,
        portrait: a.querySelector<HTMLImageElement>('img.portrait')?.currentSrc || null,
        placeholder: a.querySelector('.ring-initial')?.textContent ?? null,
        label: a.querySelector('.acard-meta span')?.textContent ?? '',
        color: getComputedStyle(a).getPropertyValue('--cc').trim(),
      })),
    )
    const avatars = cards.flatMap((c) => (c.avatar ? [new URL(c.avatar).pathname] : []))
    const portraits = cards.flatMap((c) => (c.portrait ? [new URL(c.portrait).pathname.replace(/-\d+\.webp$/, '')] : []))
    // a row as a reader sees it: the art (portrait, else sticker, else initial) and the count line
    const rows = cards.map((c) => `${c.portrait ? new URL(c.portrait).pathname.replace(/-\d+\.webp$/, '') : c.avatar ? new URL(c.avatar).pathname : `initial:${c.placeholder}`}|${c.label}`)
    checks[`characters-${size.name}`] = {
      cards: cards.length,
      avatarsUnique: new Set(avatars).size === avatars.length,
      avatars: avatars.length,
      portraitsUnique: new Set(portraits).size === portraits.length,
      portraits: portraits.length,
      placeholders: cards.filter((c) => c.placeholder).map((c) => `${c.slug}:${c.placeholder}`),
      rowsUnique: new Set(rows).size === rows.length,
      zeroCounts: cards.filter((c) => /^0 张/.test(c.label)).map((c) => c.slug),
      labels: cards.map((c) => `${c.slug}: ${c.label}`),
      clipping: (await clipping(page)).filter((x) => !x.ok),
      cardsDetail: cards,
    }

    for (const slug of [popular, shared, groupOnly]) {
      await page.goto(`${base}/characters/${slug}`, { waitUntil: 'networkidle0' })
      await settle(page)
      await page.screenshot({ path: join(outDir, `character-${slug}-${size.name}.png`), fullPage: true })
      checks[`character-${slug}-${size.name}`] = {
        title: await page.title(),
        stats: await page.$$eval('.char-hero .stat', (s) => s.map((x) => x.textContent)),
        tabs: await page.$$eval('.tabs-row [role=tab]', (s) => s.map((x) => `${x.textContent}${x.getAttribute('aria-selected') === 'true' ? ' (open)' : ''}`)),
        packCards: await page.$$eval('.pcard', (s) => s.length),
        portrait: await page.$eval('.char-portrait img.portrait', (i) => (i as HTMLImageElement).currentSrc).catch(() => null),
        clipping: (await clipping(page)).filter((x) => !x.ok),
      }
    }

    // search: character tiles and the best match (portrait face, else sticker, else initial)
    for (const [name, q] of [
      ['search-group', groupOnlyName],
      ['search-a', '阿'],
    ] as const) {
      await page.goto(`${base}/search?q=${encodeURIComponent(q)}`, { waitUntil: 'networkidle0' })
      await settle(page)
      await page.screenshot({ path: join(outDir, `${name}-${size.name}.png`), fullPage: true })
      checks[`${name}-${size.name}`] = {
        tiles: await page.$$eval('.ccard', (t) =>
          t.map((x) => `${x.querySelector('b')?.textContent}: ${x.querySelector('.ring-portrait') ? 'portrait' : x.querySelector('.ring-img') ? 'sticker' : x.querySelector('.ring-initial') ? 'initial' : 'EMPTY'} · ${x.querySelector('b + span')?.textContent}`),
        ),
        best: await page.$eval('.top-hit', (x) => `${x.querySelector('h3')?.textContent}: ${x.querySelector('.ring-portrait') ? 'portrait' : x.querySelector('.ring-img') ? 'sticker' : x.querySelector('.ring-initial') ? 'initial' : 'EMPTY'}`).catch(() => null),
        clipping: (await clipping(page)).filter((x) => !x.ok),
      }
    }

    await page.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await settle(page)
    const strip = await page.$('.cstrip')
    if (strip) {
      await strip.evaluate((el) => {
        const top = el.closest('section')!.getBoundingClientRect().top + window.scrollY
        const head = document.querySelector('header')?.getBoundingClientRect().height ?? 0
        window.scrollTo(0, top - head - 8)
      })
      await wait(300)
      const section = await strip.evaluateHandle((el) => el.closest('section')!)
      await section.asElement()!.screenshot({ path: join(outDir, `home-strip-${size.name}.png`) })
      checks[`home-strip-${size.name}`] = { clipping: (await clipping(page)).filter((x) => !x.ok) }
      // the same strip with each character's portrait cropped into the circle, where it has one
      const bySlug = Object.fromEntries((checks[`characters-${size.name}`] as { cardsDetail: { slug: string; portrait: string | null }[] }).cardsDetail.map((c) => [c.slug, c.portrait]))
      await page.evaluate((map: Record<string, string | null>) => {
        for (const a of document.querySelectorAll<HTMLAnchorElement>('.cstrip a.cchip')) {
          const src = map[decodeURIComponent(a.pathname.split('/').pop() ?? '')]
          const img = a.querySelector<HTMLImageElement>('img')
          if (src && img) {
            // a face crop: the top of the portrait, enlarged inside the circle
            img.srcset = ''
            img.src = src
            img.style.objectPosition = '50% 0'
            img.style.transform = 'scale(1.9)'
            img.style.transformOrigin = '50% 14%'
          }
        }
      }, bySlug)
      await wait(800)
      await section.asElement()!.screenshot({ path: join(outDir, `home-strip-portraits-${size.name}.png`) })
    }
    await page.close()
  }

  // a character that only appears in group packs has a normal page on its 合集包
  const res = await fetch(`${base}/characters/${groupOnly}`, { redirect: 'manual' })
  const html = await res.text()
  checks.groupOnly = { status: res.status, location: res.headers.get('location'), mentions合集包: html.includes('合集包') }
} finally {
  await browser.close()
}
writeFileSync(join(outDir, 'checks.json'), JSON.stringify(checks, null, 1))
const summary = Object.fromEntries(
  Object.entries(checks).map(([k, v]) => {
    const { cardsDetail: _drop, ...rest } = v as Record<string, unknown>
    return [k, rest]
  }),
)
console.log(JSON.stringify(summary, null, 1))
