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
    'uploads/': 'uploads/tmp/2026/10/21/u1/a.gif',
    'assets/': 'assets/v1/packs/pk/emojis/r-0a7bf47f0ec26d3843bf.gif',
  }
  const firstKey = async (prefix: string) => KEYS[prefix] ?? null
  const imageHeaders = { 'content-type': 'image/webp', 'cache-control': IMMUTABLE }

  function fakeFetch(answer: (path: string, method: string) => Response) {
    const calls: string[] = []
    const f = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = new URL(String(url))
      calls.push(`${init?.method ?? 'GET'} ${u.pathname}`)
      return answer(u.pathname, init?.method ?? 'GET')
    }) as typeof fetch
    return { f, calls }
  }

  test('PASS: images public and cacheable, everything else refused; every probe is a key that exists', async () => {
    const { f, calls } = fakeFetch((path) =>
      path.startsWith('/derived/v1/') || path.startsWith('/characters/v1/portraits/') ? new Response(null, { status: 200, headers: imageHeaders }) : new Response('no', { status: 403 }),
    )
    const r = await checkPublic('https://i.example/', { fetch: f, firstKey })
    expect(r.ok).toBe(true)
    expect(calls).toContain(`HEAD /${KEYS['derived/v1/p240/']}`)
    expect(calls).toContain(`GET /${KEYS['backups/']}`)
    expect(calls).toContain(`GET /${KEYS['uploads/']}`)
    expect(calls).toContain(`GET /${KEYS['assets/']}`)
    expect(r.lines.filter((l) => l.line.startsWith('PASS')).length).toBe(6)
  })

  test('FAIL when a backup is readable', async () => {
    const { f } = fakeFetch((path) => new Response(null, { status: 200, headers: path.startsWith('/backups/') ? {} : imageHeaders }))
    const r = await checkPublic('https://i.example', { fetch: f, firstKey })
    expect(r.ok).toBe(false)
    expect(r.lines.find((l) => l.line.includes('database backup'))?.line).toStartWith('FAIL')
  })

  test('FAIL when images are not cacheable for a year', async () => {
    const { f } = fakeFetch((path) =>
      path.startsWith('/derived/') ? new Response(null, { status: 200, headers: { 'content-type': 'image/webp', 'cache-control': 'max-age=14400' } }) : new Response(null, { status: 404 }),
    )
    const r = await checkPublic('https://i.example', { fetch: f, firstKey })
    expect(r.ok).toBe(false)
    expect(r.lines.find((l) => l.line.includes('derived p240'))?.line).toStartWith('FAIL')
  })

  test('FAIL when there is no image to probe; private prefixes without objects are skipped', async () => {
    const { f } = fakeFetch(() => new Response(null, { status: 404 }))
    const r = await checkPublic('https://i.example', { fetch: f, firstKey: async () => null })
    expect(r.ok).toBe(false)
    expect(r.lines.some((l) => l.line.startsWith('skip') && l.line.includes('backups/'))).toBe(true)
  })
})
