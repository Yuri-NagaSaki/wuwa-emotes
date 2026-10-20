import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'drizzle-orm'
import sharp from 'sharp'
import { clearCatalogCache } from '../../src/server/catalog/cache'
import { db } from '../../src/server/db/client'
import { imgDeps } from '../../src/server/http/img-deps'
import { handleImg } from '../../src/server/media/img'
import { derivedKey, PORTRAIT_PREFIX } from '../../src/server/media/keys'
import { deleteObjects, headObject, listKeys, putObject } from '../../src/server/media/s3'
import { formatPortraitSummary, importPortraits, matchCharacter, normName, parsePortraitManifest, renderPortrait } from '../../src/server/import/portraits'
import { deriveThemeColors } from '../../src/server/import/theme-colors'
import { emptyBucket, resetDb, setupTestEnv } from '../media/helpers'

// import-portraits and derive-colors against a local fixture HTTP server and the local bucket.
// Fixture art is drawn here (SVG through sharp): a figure in one strong colour on a transparent
// background, with a skin-coloured face and black outlines, like the official portraits.

function figure(w: number, h: number, color: string, opts: { background?: string } = {}): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 240 320">
    ${opts.background ? `<rect width="240" height="320" fill="${opts.background}"/>` : ''}
    <path d="M60 300 C60 180 80 120 120 120 C160 120 180 180 180 300 Z" fill="${color}" stroke="#111" stroke-width="4"/>
    <circle cx="120" cy="80" r="44" fill="#f6d7c3" stroke="#111" stroke-width="4"/>
    <path d="M74 70 C80 20 160 20 166 70 C150 50 90 50 74 70 Z" fill="${color}" stroke="#111" stroke-width="3"/>
  </svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

const requests: { path: string; referer: string | null; ua: string | null }[] = []
const files = new Map<string, { body: Buffer; type: string }>()
let server: ReturnType<typeof Bun.serve>
let base = ''

const CHARACTERS: [slug: string, name: string, theme: string | null, aliases: string[]][] = [
  ['aimisi', '爱弥斯', null, []],
  ['lupa', '露帕', 'teal', []],
  ['luhesi', '陆赫斯', '', []],
  ['nanzhu', '男漂泊者', null, ['男主']],
  ['feibi', '菲比', null, []],
  ['lili', '莉莉', null, []],
  ['nobody', '无图', null, []],
  ['broken', '坏图', null, []],
]

async function character(slug: string) {
  const r = await db().execute<{ portrait_key: string | null; theme_color: string | null }>(sql`select portrait_key, theme_color from characters where slug = ${slug}`)
  return r.rows[0]!
}

function manifest() {
  return [
    { name: '爱弥斯', url: `${base}/aimisi.png`, width: 240, height: 320 },
    { name: '露帕', url: `${base}/redirect-lupa`, width: 240, height: 320 },
    { name: '陆·赫斯', url: `${base}/luhesi.png` },
    { name: '男主', url: `${base}/big.png`, width: 600, height: 800 },
    { name: '莉莉', url: `${base}/wide.png`, crop: { left: 1000, top: 0, width: 810, height: 1080 } },
    { name: '菲比', url: `${base}/aimisi.png` },
    { name: '坏图', url: `${base}/missing.png` },
    { name: '丽贝卡', url: `${base}/nobody.png` },
    { name: 'bad entry', url: 'ftp://example.invalid/x.png' },
  ]
}

beforeAll(async () => {
  await setupTestEnv()
  await resetDb()
  await emptyBucket()
  files.set('/aimisi.png', { body: await figure(240, 320, '#f06aa0'), type: 'image/png' })
  files.set('/lupa.png', { body: await figure(240, 320, '#e03030'), type: 'image/png' })
  files.set('/luhesi.png', { body: await figure(240, 320, '#2a9d8f'), type: 'image/png' })
  files.set('/big.png', { body: await figure(600, 800, '#4060e0'), type: 'image/png' })
  // a wide banner: the portrait is the crop on its right
  const banner = await sharp({ create: { width: 1920, height: 1080, channels: 4, background: '#ffffff' } })
    .composite([{ input: await figure(810, 1080, '#9050e0'), left: 1000, top: 0 }])
    .png()
    .toBuffer()
  files.set('/wide.png', { body: banner, type: 'image/png' })
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname
      requests.push({ path, referer: req.headers.get('referer'), ua: req.headers.get('user-agent') })
      if (path === '/redirect-lupa') return new Response(null, { status: 302, headers: { location: '/lupa.png' } })
      if (path === '/page.html') return new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
      const f = files.get(path)
      return f ? new Response(f.body, { headers: { 'content-type': f.type } }) : new Response('not found', { status: 404 })
    },
  })
  base = `http://127.0.0.1:${server.port}`
  for (const [slug, name, theme, aliases] of CHARACTERS) {
    const r = await db().execute<{ id: number }>(sql`insert into characters (slug, name, theme_color) values (${slug}, ${name}, ${theme}) returning id`)
    for (const a of aliases) await db().execute(sql`insert into character_aliases (character_id, alias) values (${r.rows[0]!.id}, ${a})`)
  }
})

afterAll(() => server?.stop(true))

describe('manifest and matching', () => {
  test('entries need a name and an http(s) url; bad ones are reported', () => {
    const { entries, warnings } = parsePortraitManifest(manifest())
    expect(entries.length).toBe(8)
    expect(warnings).toEqual([expect.stringContaining('entry 8')])
    expect(() => parsePortraitManifest({ nope: 1 })).toThrow(/array/)
  })

  test('slug, then name, alias, and the name without separators', () => {
    const chars = [
      { id: 1, slug: 'luhesi', name: '陆赫斯', themeColor: null, portraitKey: null, aliases: [] },
      { id: 2, slug: 'rover', name: '漂泊者', themeColor: null, portraitKey: null, aliases: ['男漂'] },
    ]
    expect(matchCharacter({ name: '陆·赫斯' }, chars)?.by).toBe('normalized')
    expect(matchCharacter({ name: '漂泊者' }, chars)?.by).toBe('name')
    expect(matchCharacter({ name: '男漂' }, chars)?.by).toBe('alias')
    expect(matchCharacter({ name: 'x', slug: 'rover' }, chars)?.character.id).toBe(2)
    expect(matchCharacter({ name: '陆赫斯', slug: 'nope' }, chars)).toBeNull()
    expect(normName(' 秧秧・玄翎 ')).toBe('秧秧玄翎')
  })
})

describe('import-portraits', () => {
  test('--dry-run matches without downloading or writing', async () => {
    const s = await importPortraits(manifest(), { dryRun: true, delayMs: 0 })
    expect(requests).toEqual([])
    expect(await listKeys(PORTRAIT_PREFIX)).toEqual([])
    expect(s.results.map((r) => [r.entry, r.slug, r.by])).toEqual([
      ['爱弥斯', 'aimisi', 'name'],
      ['露帕', 'lupa', 'name'],
      ['陆·赫斯', 'luhesi', 'normalized'],
      ['男主', 'nanzhu', 'alias'],
      ['莉莉', 'lili', 'name'],
      ['菲比', 'feibi', 'name'],
      ['坏图', 'broken', 'name'],
    ])
    expect(s.unmatchedEntries).toEqual(['丽贝卡'])
    expect(s.withoutPortrait.map((c) => c.slug)).toEqual(['nobody'])
    expect(formatPortraitSummary(s)).toContain('dry run')
  })

  test('first run: WebP variants with immutable caching, portrait_key, theme colours only where empty', async () => {
    const s = await importPortraits(manifest(), { delayMs: 0 })
    const by = Object.fromEntries(s.results.map((r) => [r.slug, r]))
    expect(by.aimisi!.outcome).toBe('new')
    expect(by.lupa!.outcome).toBe('new')
    expect(by.nanzhu!.outcome).toBe('new')
    expect(by.lili!.outcome).toBe('new')
    // 菲比 points at 爱弥斯's file: one source never becomes two characters' portrait
    expect(by.feibi).toMatchObject({ outcome: 'skipped', note: 'same source as aimisi' })
    expect(by.broken).toMatchObject({ outcome: 'failed', note: 'HTTP 404' })

    // each URL once (爱弥斯 and 菲比 share one), no referrer, our user agent; the redirect was followed
    const paths = requests.map((r) => r.path)
    expect(paths.sort()).toEqual(['/aimisi.png', '/big.png', '/luhesi.png', '/lupa.png', '/missing.png', '/redirect-lupa', '/wide.png'].sort())
    expect(requests.every((r) => r.referer === null && r.ua === 'chaochi-import-portraits/1')).toBe(true)

    const aimisi = await character('aimisi')
    expect(aimisi.portrait_key).toMatch(/^characters\/v1\/portraits\/aimisi\.[0-9a-f]{8}-240\.webp$/)
    const head = await headObject(aimisi.portrait_key!)
    expect(head?.ContentType).toBe('image/webp')
    expect(head?.CacheControl).toBe('public, max-age=31536000, immutable')

    // a 600×800 source also gets the 480 variant; the key names the largest
    const big = await character('nanzhu')
    expect(big.portrait_key).toMatch(/^characters\/v1\/portraits\/nanzhu\.[0-9a-f]{8}-480\.webp$/)
    const small = big.portrait_key!.replace(/-480\.webp$/, '-240.webp')
    const keys = await listKeys(PORTRAIT_PREFIX)
    expect(keys).toContain(small)
    expect(keys.length).toBe(7) // aimisi, lupa, luhesi at 240; nanzhu and lili at 240 + 480

    // the crop: 莉莉's portrait comes out 3:4 from the banner's right side (810 wide: 480 too), in her colour
    const lili = await character('lili')
    expect(lili.portrait_key).toMatch(/^characters\/v1\/portraits\/lili\.[0-9a-f]{8}-480\.webp$/)
    expect(lili.theme_color).toBe('purple')

    // theme colours: set where empty (null or blank), an admin's colour stays
    expect(aimisi.theme_color).toBe('pink')
    expect((await character('luhesi')).theme_color).toBe('teal')
    expect(big.theme_color).toBe('blue')
    expect((await character('lupa')).theme_color).toBe('teal')
    expect(by.lupa).toMatchObject({ color: 'red', colorSet: false })
    expect(s.withoutPortrait.map((c) => c.slug).sort()).toEqual(['broken', 'feibi', 'nobody'])
  })

  test('the images are 3:4 WebP at their width and /img serves them', async () => {
    const big = await character('nanzhu')
    for (const w of [240, 480]) {
      const file = big.portrait_key!.replace(/-480\.webp$/, `-${w}.webp`).slice(PORTRAIT_PREFIX.length)
      const res = await handleImg(new Request(`http://localhost/img/v1/portrait/${file}`), imgDeps)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', w, (w * 4) / 3])
    }
  })

  test('a second run changes nothing; a new source replaces; a lost object is written again', async () => {
    const before = await character('aimisi')
    requests.length = 0
    const again = await importPortraits(manifest(), { delayMs: 0 })
    expect(Object.fromEntries(again.results.map((r) => [r.slug, r.outcome]))).toMatchObject({
      aimisi: 'unchanged',
      lupa: 'unchanged',
      luhesi: 'unchanged',
      nanzhu: 'unchanged',
      lili: 'unchanged',
    })
    expect((await character('aimisi')).portrait_key).toBe(before.portrait_key)
    expect((await listKeys(PORTRAIT_PREFIX)).length).toBe(7)

    files.set('/aimisi.png', { body: await figure(240, 320, '#ff4f9a'), type: 'image/png' })
    const lostKey = (await character('luhesi')).portrait_key!
    await deleteObjects([lostKey])
    const third = await importPortraits(manifest(), { delayMs: 0 })
    const by = Object.fromEntries(third.results.map((r) => [r.slug, r]))
    expect(by.aimisi!.outcome).toBe('replaced')
    expect(by.luhesi!.outcome).toBe('repaired')
    const after = await character('aimisi')
    expect(after.portrait_key).not.toBe(before.portrait_key)
    expect(await headObject(before.portrait_key!)).not.toBeNull() // old keys stay (immutable URLs)
    expect(await headObject(lostKey)).not.toBeNull()
  })

  test('renderPortrait refuses a crop outside the image and never upscales past 240', async () => {
    await expect(renderPortrait(await figure(240, 320, '#f00'), { left: 100, top: 0, width: 240, height: 320 })).rejects.toThrow(/outside/)
    const tiny = await renderPortrait(await figure(90, 120, '#f00'))
    expect(tiny.variants.map((v) => v.width)).toEqual([240])
  })

  test('a non-image answer fails that entry only', async () => {
    const s = await importPortraits([{ name: '无图', url: `${base}/page.html` }], { delayMs: 0 })
    expect(s.results[0]).toMatchObject({ outcome: 'failed', note: 'not an image (text/html)' })
    expect((await character('nobody')).portrait_key).toBeNull()
  })
})

describe('derive-colors', () => {
  test('from the avatar sticker when there is no portrait; never over a set colour; dry run writes nothing', async () => {
    // 无图 gets a public single-character pack with one sticker and its p240 in the bucket
    const pk = await db().execute<{ id: number }>(
      sql`insert into packs (pack_key, slug, title, status, published_at) values ('nobody-01', 'nobody-01', '无图', 'published', now()) returning id`,
    )
    const packId = pk.rows[0]!.id
    const emojiId = 'r-00000000000000000abc'
    await db().execute(sql`insert into emojis (id, pack_id, storage_pack_key, status, original_key, format, mime, bytes, derived_ready)
      values (${emojiId}, ${packId}, 'nobody-01', 'published', 'assets/v1/packs/nobody-01/emojis/x.png', 'png', 'image/png', 10, true)`)
    await db().execute(sql`insert into pack_characters (pack_id, character_id) select ${packId}, id from characters where slug = 'nobody'`)
    await putObject(derivedKey('p240', 'nobody-01', emojiId, 1), await sharp(await figure(240, 240, '#2fb64a')).webp().toBuffer(), 'image/webp')
    clearCatalogCache()

    const dry = await deriveThemeColors({ dryRun: true })
    const row = dry.find((r) => r.slug === 'nobody')!
    expect(row).toMatchObject({ source: 'avatar', written: false })
    expect(row.color?.name).toBe('green')
    expect((await character('nobody')).theme_color).toBeNull()

    const real = await deriveThemeColors()
    expect(real.find((r) => r.slug === 'nobody')).toMatchObject({ written: true })
    expect((await character('nobody')).theme_color).toBe('green')
    // characters that already have a colour are not even considered
    expect(real.map((r) => r.slug)).not.toContain('lupa')
    expect(real.map((r) => r.slug)).not.toContain('aimisi')
    // no portrait and no sticker: reported, untouched
    expect(real.find((r) => r.slug === 'feibi')).toMatchObject({ source: null, written: false })
  })
})
