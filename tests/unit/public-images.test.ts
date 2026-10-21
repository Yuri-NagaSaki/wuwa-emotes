import { describe, expect, test } from 'bun:test'
import { assertPublicImagePrefix, imageContentType } from '#/server/media/cache-control'
import { checkPublic } from '#/server/media/check-public'
import { IMMUTABLE } from '#/server/media/keys'

// The operator commands around the bucket's public image domain (src/cli.ts `media …`).

describe('media set-cache-control', () => {
  test.each(['derived/v1/', 'derived/v1/p240/', 'characters/v1/portraits/', 'avatars/', 'avatars/v1/'])('accepts %s', (p) => {
    expect(() => assertPublicImagePrefix(p)).not.toThrow()
  })

  test.each(['assets/', 'assets/v1/packs/', 'meta/', 'meta/v1/', 'sync/', 'backups/', 'uploads/', 'review/', 'zips/', '', 'derived/', 'derived/v2/', 'characters/'])(
    'refuses %p',
    (p) => {
      expect(() => assertPublicImagePrefix(p)).toThrow()
    },
  )

  test('needs a trailing slash (a prefix, not a key)', () => {
    expect(() => assertPublicImagePrefix('derived/v1')).toThrow(/end with/)
  })

  test('content type by extension', () => {
    expect(imageContentType('derived/v1/p240/a/r-0a7bf47f0ec26d3843bf.r1.webp')).toBe('image/webp')
    expect(imageContentType('avatars/v1/u.PNG')).toBe('image/png')
    expect(imageContentType('avatars/v1/u')).toBeNull()
  })
})

describe('media check-public', () => {
  const KEYS: Record<string, string> = {
    'derived/v1/p240/': 'derived/v1/p240/pk/r-0a7bf47f0ec26d3843bf.r1.webp',
    'characters/v1/portraits/': 'characters/v1/portraits/aimisi.0a1b2c3d-480.webp',
    'backups/': 'backups/postgres/2026/10/21/2026-10-21T19-00-00-000Z.dump.enc',
    'assets/': 'assets/v1/packs/pk/emojis/r-0a7bf47f0ec26d3843bf.gif',
    'meta/': 'meta/v1/packs.json',
    'review/v1/': 'review/v1/p240/pk/r-1a7bf47f0ec26d3843bf.webp',
    'zips/': 'zips/v1/packs/pk/pk.deadbeef.zip',
    'uploads/tmp/': 'uploads/tmp/2026/10/21/u1/a.gif',
  }
  const firstKey = async (prefix: string) => KEYS[prefix] ?? null
  const imageHeaders = { 'content-type': 'image/webp', 'cache-control': IMMUTABLE }
  const isImage = (path: string) => path.startsWith('/derived/v1/') || path.startsWith('/characters/v1/portraits/')

  function fakeFetch(answer: (path: string, method: string) => Response) {
    const calls: string[] = []
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url))
      calls.push(`${init?.method ?? 'GET'} ${u.pathname}`)
      return answer(u.pathname, init?.method ?? 'GET')
    }) as typeof fetch
    return { f, calls }
  }

  test('PASS: images public and cacheable, every other prefix refused; each probe is a real key', async () => {
    const { f, calls } = fakeFetch((path) => (isImage(path) ? new Response(null, { status: 200, headers: imageHeaders }) : new Response('no', { status: 403 })))
    const r = await checkPublic('https://i.example/', { fetch: f, firstKey })
    expect(r.ok).toBe(true)
    expect(calls).toContain(`HEAD /${KEYS['derived/v1/p240/']}`)
    expect(calls).toContain(`HEAD /${KEYS['characters/v1/portraits/']}`)
    for (const p of ['backups/', 'assets/', 'meta/', 'review/v1/', 'zips/', 'uploads/tmp/']) expect(calls).toContain(`GET /${KEYS[p]}`)
    expect(r.lines.filter((l) => l.line.startsWith('PASS')).length).toBe(9)
    // prefixes and statuses only: no key appears in the output
    for (const l of r.lines) for (const k of Object.values(KEYS)) expect(l.line).not.toContain(k)
  })

  test.each(['backups/', 'assets/', 'meta/', 'review/v1/', 'zips/', 'uploads/tmp/'])('FAIL when %s is readable', async (prefix) => {
    const { f } = fakeFetch((path) =>
      isImage(path) ? new Response(null, { status: 200, headers: imageHeaders }) : new Response(null, { status: path.startsWith(`/${prefix}`) ? 200 : 404 }),
    )
    const r = await checkPublic('https://i.example', { fetch: f, firstKey })
    expect(r.ok).toBe(false)
    expect(r.lines.filter((l) => l.line.startsWith('FAIL')).map((l) => l.line)).toEqual([expect.stringContaining(`${prefix}… → 200`)])
  })

  test('FAIL when images are not cacheable for a year', async () => {
    const { f } = fakeFetch((path) =>
      path.startsWith('/derived/') ? new Response(null, { status: 200, headers: { 'content-type': 'image/webp', 'cache-control': 'max-age=14400' } }) : new Response(null, { status: 404 }),
    )
    const r = await checkPublic('https://i.example', { fetch: f, firstKey })
    expect(r.ok).toBe(false)
    expect(r.lines.find((l) => l.line.includes('poster'))?.line).toStartWith('FAIL')
  })

  test('a required prefix without objects cannot be verified (FAIL); optional ones are skipped', async () => {
    const { f, calls } = fakeFetch((path) => (isImage(path) ? new Response(null, { status: 200, headers: imageHeaders }) : new Response(null, { status: 404 })))
    const only = ['derived/v1/p240/', 'characters/v1/portraits/', 'assets/', 'meta/']
    const r = await checkPublic('https://i.example', { fetch: f, firstKey: async (p) => (only.includes(p) ? KEYS[p]! : null) })
    expect(r.ok).toBe(false)
    expect(r.lines.find((l) => l.line.includes('backups/'))?.line).toMatch(/^FAIL .*no object in the bucket/)
    expect(r.lines.find((l) => l.line.includes('zips/'))?.line).toStartWith('skip')
    expect(calls.some((c) => c.includes('backups'))).toBe(false)
  })
})
