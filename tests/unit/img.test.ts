import { describe, expect, test } from 'bun:test'
import { type EmojiForFull, handleImg, IMMUTABLE, type ImgDeps, type ImgObject } from '#/server/media/img'
import { derivedKey } from '#/server/media/keys'

const PACK = 'shorekeeper-daily'
const EMOJI = 'r-0a7bf47f0ec26d3843bf'
const ORIGIN = 'https://chaochi.example'

function url(variant: string, rev = 1, pack = PACK) {
  return `${ORIGIN}/img/v1/${variant}/${pack}/${EMOJI}.r${rev}.webp`
}

function stream(bytes: Uint8Array): ReadableStream {
  return new ReadableStream({
    start(c) {
      c.enqueue(bytes)
      c.close()
    },
  })
}

interface Fake extends ImgDeps {
  gets: { key: string; ifNoneMatch?: string }[]
  lookups: string[]
  enqueued: string[]
}

function fakeDeps(opts: { objects?: Record<string, ImgObject | (() => ImgObject)>; emoji?: EmojiForFull | null } = {}): Fake {
  const fake: Fake = {
    gets: [],
    lookups: [],
    enqueued: [],
    async getObject(key, ifNoneMatch) {
      fake.gets.push({ key, ifNoneMatch })
      const o = opts.objects?.[key]
      return o === undefined ? null : typeof o === 'function' ? o() : o
    },
    async lookupEmoji(id) {
      fake.lookups.push(id)
      return opts.emoji ?? null
    },
    async enqueueFull(id) {
      fake.enqueued.push(id)
    },
  }
  return fake
}

const published: EmojiForFull = { status: 'published', packStatus: 'published', storagePackKey: PACK, variantRev: 1, frames: 28 }

describe('handleImg: hits', () => {
  test('streams the derived object with immutable caching', async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3])
    const deps = fakeDeps({ objects: { [derivedKey('p240', PACK, EMOJI, 1)]: { body: stream(bytes), contentLength: 7, etag: '"abc"' } } })
    const res = await handleImg(new Request(url('p240')), deps)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('etag')).toBe('"abc"')
    expect(res.headers.get('content-length')).toBe('7')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
    expect(deps.gets).toEqual([{ key: `derived/v1/p240/${PACK}/${EMOJI}.r1.webp`, ifNoneMatch: undefined }])
    expect(deps.lookups).toEqual([])
  })

  test('only ever reads derived/v1 keys', async () => {
    const deps = fakeDeps()
    for (const v of ['p240', 'a160', 'full']) await handleImg(new Request(url(v, 7)), deps)
    for (const g of deps.gets) expect(g.key.startsWith('derived/v1/')).toBe(true)
  })

  test('If-None-Match is passed through; a match answers 304 without a body', async () => {
    const deps = fakeDeps({ objects: { [derivedKey('a160', PACK, EMOJI, 1)]: { body: null, notModified: true, etag: '"abc"' } } })
    const res = await handleImg(new Request(url('a160'), { headers: { 'if-none-match': '"abc"' } }), deps)
    expect(res.status).toBe(304)
    expect(res.body).toBeNull()
    expect(res.headers.get('etag')).toBe('"abc"')
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE)
    expect(deps.gets[0]!.ifNoneMatch).toBe('"abc"')
  })

  test('HEAD has no body', async () => {
    const deps = fakeDeps({ objects: { [derivedKey('p240', PACK, EMOJI, 1)]: { body: stream(new Uint8Array([1])), contentLength: 1, etag: '"e"' } } })
    const res = await handleImg(new Request(url('p240'), { method: 'HEAD' }), deps)
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
    expect(res.headers.get('content-length')).toBe('1')
  })
})

describe('handleImg: misses', () => {
  test.each(['p240', 'a160'])('missing %s is a short-lived 404 and never touches the database', async (variant) => {
    const deps = fakeDeps({ emoji: published })
    const res = await handleImg(new Request(url(variant)), deps)
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(deps.lookups).toEqual([])
    expect(deps.enqueued).toEqual([])
  })

  test('missing full for a published animated emoji: queue once, 302 to a160, no-store', async () => {
    const deps = fakeDeps({ emoji: published })
    const res = await handleImg(new Request(url('full')), deps)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`/img/v1/a160/${PACK}/${EMOJI}.r1.webp`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(deps.lookups).toEqual([EMOJI])
    expect(deps.enqueued).toEqual([EMOJI])
  })

  test('missing full for a published static emoji falls back to p240', async () => {
    const deps = fakeDeps({ emoji: { ...published, frames: 1, variantRev: 4 } })
    const res = await handleImg(new Request(url('full', 4)), deps)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`/img/v1/p240/${PACK}/${EMOJI}.r4.webp`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(deps.enqueued).toEqual([EMOJI])
  })

  test.each<[string, EmojiForFull | null, string]>([
    ['unknown emoji', null, url('full')],
    ['pending emoji', { ...published, status: 'pending' }, url('full')],
    ['hidden emoji', { ...published, status: 'hidden' }, url('full')],
    ['draft (pending) pack', { ...published, packStatus: 'draft' }, url('full')],
    ['hidden pack', { ...published, packStatus: 'hidden' }, url('full')],
    ['URL pack key is not storage_pack_key', published, url('full', 1, 'some-other-pack')],
    ['URL rev is older than variant_rev', { ...published, variantRev: 2 }, url('full', 1)],
    ['URL rev is newer than variant_rev', published, url('full', 2)],
  ])('missing full for %s: 404, nothing queued', async (_name, emoji, u) => {
    const deps = fakeDeps({ emoji })
    const res = await handleImg(new Request(u), deps)
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(res.headers.get('location')).toBeNull()
    expect(deps.enqueued).toEqual([])
  })

  test('HEAD on a full miss still answers 302 without a body', async () => {
    const deps = fakeDeps({ emoji: published })
    const res = await handleImg(new Request(url('full'), { method: 'HEAD' }), deps)
    expect(res.status).toBe(302)
    expect(res.body).toBeNull()
  })
})

describe('handleImg: bad requests', () => {
  test.each([
    `${ORIGIN}/img/v1/p240/${PACK}/${EMOJI}.r0.webp`,
    `${ORIGIN}/img/v1/p240/Pack/${EMOJI}.r1.webp`,
    `${ORIGIN}/img/v1/p240/${PACK}/${EMOJI}.r1.png`,
    `${ORIGIN}/img/v1/p240/${PACK}/x/${EMOJI}.r1.webp`,
    `${ORIGIN}/img/anything`,
  ])('non-canonical %s is a 404 without any lookup', async (u) => {
    const deps = fakeDeps({ emoji: published })
    const res = await handleImg(new Request(u), deps)
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(deps.gets).toEqual([])
    expect(deps.lookups).toEqual([])
  })

  test('other methods are 405', async () => {
    const deps = fakeDeps()
    const res = await handleImg(new Request(url('p240'), { method: 'POST' }), deps)
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, HEAD')
    expect(deps.gets).toEqual([])
  })
})

describe('handleImg: character portraits', () => {
  const KEY = 'characters/v1/portraits/aimisi.0a1b2c3d-480.webp'
  const purl = (file: string) => `${ORIGIN}/img/v1/portrait/${file}`

  test('streams characters/v1/portraits/ objects with immutable caching and no database lookup', async () => {
    const bytes = new Uint8Array([82, 73, 70, 70, 9])
    const deps = fakeDeps({ objects: { [KEY]: { body: stream(bytes), contentLength: 5, etag: '"p"' } }, emoji: published })
    const res = await handleImg(new Request(purl('aimisi.0a1b2c3d-480.webp')), deps)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('etag')).toBe('"p"')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
    expect(deps.gets).toEqual([{ key: KEY, ifNoneMatch: undefined }])
    expect(deps.lookups).toEqual([])
    expect(deps.enqueued).toEqual([])
  })

  test('If-None-Match answers 304; HEAD has no body', async () => {
    const deps = fakeDeps({ objects: { [KEY]: { body: null, notModified: true, etag: '"p"' } } })
    const res = await handleImg(new Request(purl('aimisi.0a1b2c3d-480.webp'), { headers: { 'if-none-match': '"p"' } }), deps)
    expect(res.status).toBe(304)
    expect(res.body).toBeNull()
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE)
    expect(deps.gets[0]!.ifNoneMatch).toBe('"p"')
    const head = fakeDeps({ objects: { [KEY]: { body: stream(new Uint8Array([1])), contentLength: 1 } } })
    const hr = await handleImg(new Request(purl('aimisi.0a1b2c3d-480.webp'), { method: 'HEAD' }), head)
    expect(hr.status).toBe(200)
    expect(hr.body).toBeNull()
    expect(hr.headers.get('content-length')).toBe('1')
  })

  test('a missing portrait is a short-lived 404 that never touches the database', async () => {
    const deps = fakeDeps({ emoji: published })
    const res = await handleImg(new Request(purl('aimisi.0a1b2c3d-240.webp')), deps)
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(deps.gets).toEqual([{ key: 'characters/v1/portraits/aimisi.0a1b2c3d-240.webp', ifNoneMatch: undefined }])
    expect(deps.lookups).toEqual([])
    expect(deps.enqueued).toEqual([])
  })

  test.each([
    'aimisi.0a1b2c3d-300.webp',
    'aimisi.0a1b2c3d-48.webp',
    'aimisi.0a1b2c3d-0480.webp',
    'aimisi.0A1B2C3D-240.webp',
    'aimisi.0a1b2c3-240.webp',
    'Aimisi.0a1b2c3d-240.webp',
    'aimisi.0a1b2c3d-240.png',
    'aimisi.0a1b2c3d-240.webp.webp',
    '..%2Fderived.0a1b2c3d-240.webp',
    '%2E%2E.0a1b2c3d-240.webp',
    'a%2Fb.0a1b2c3d-240.webp',
    'x/aimisi.0a1b2c3d-240.webp',
    '../aimisi.0a1b2c3d-240.webp',
    '-aimisi.0a1b2c3d-240.webp',
    'ai--misi.0a1b2c3d-240.webp',
    `${'a'.repeat(61)}.0a1b2c3d-240.webp`,
  ])('non-canonical portrait %s is a 404 without any read', async (file) => {
    const deps = fakeDeps({ emoji: published })
    const res = await handleImg(new Request(purl(file)), deps)
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    expect(deps.gets).toEqual([])
    expect(deps.lookups).toEqual([])
  })

  test('only ever reads characters/v1/portraits/ for portrait paths', async () => {
    const deps = fakeDeps()
    for (const f of ['lupa.ffffffff-240.webp', 'yangyang-xuanling.12345678-480.webp']) await handleImg(new Request(purl(f)), deps)
    expect(deps.gets.map((g) => g.key)).toEqual([
      'characters/v1/portraits/lupa.ffffffff-240.webp',
      'characters/v1/portraits/yangyang-xuanling.12345678-480.webp',
    ])
  })
})
