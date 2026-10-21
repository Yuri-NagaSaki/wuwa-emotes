import { describe, expect, test } from 'bun:test'
import { AVATAR_MAX_BYTES, avatarFormFile, sniffImage } from '#/server/account/avatar-input'
import { carriesImage, guardProfileUpdate } from '#/server/auth/profile-guard'
import { handleImg, IMMUTABLE, type ImgDeps } from '#/server/media/img'
import { avatarKey, avatarKeys, avatarUrl, isAvatarHash, parseAvatarPath } from '#/server/media/keys'

const USER = 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z'
const HASH = '0a1b2c3d4e5f6a7b'

describe('avatar keys and URLs', () => {
  test('content-addressed keys under avatars/v1/<userId>/', () => {
    expect(avatarKey(USER, HASH, 256)).toBe(`avatars/v1/${USER}/${HASH}-256.webp`)
    expect(avatarKeys(USER, HASH)).toEqual([`avatars/v1/${USER}/${HASH}-256.webp`, `avatars/v1/${USER}/${HASH}-64.webp`])
  })

  test('avatarUrl accepts only a 16-hex hash and a plain user id', () => {
    expect(avatarUrl(USER, HASH, 64)).toBe(`/img/v1/avatar/${USER}/${HASH}-64.webp`)
    for (const bad of [null, undefined, '', 'https://example.test/a.png', HASH.toUpperCase(), HASH.slice(1), `${HASH}0`, '../../etc/passwd', 'javascript:alert(1)']) {
      expect(avatarUrl(USER, bad, 256)).toBeNull()
    }
    for (const id of ['', 'a/b', 'a.b', '..', 'x'.repeat(65), 'a b']) expect(avatarUrl(id, HASH, 256)).toBeNull()
    expect(isAvatarHash(HASH)).toBe(true)
    expect(isAvatarHash(123)).toBe(false)
  })

  test('parseAvatarPath round-trips and rejects anything else', () => {
    expect(parseAvatarPath(avatarUrl(USER, HASH, 256)!)).toEqual({ userId: USER, hash: HASH, size: 256 })
    expect(parseAvatarPath(avatarUrl(USER, HASH, 64)!)).toEqual({ userId: USER, hash: HASH, size: 64 })
    for (const p of [
      `/img/v1/avatar/${USER}/${HASH}-128.webp`,
      `/img/v1/avatar/${USER}/${HASH}-256.png`,
      `/img/v1/avatar/${USER}/${HASH.toUpperCase()}-256.webp`,
      `/img/v1/avatar/${USER}/x/${HASH}-256.webp`,
      `/img/v1/avatar/a.b/${HASH}-256.webp`,
      `/img/v1/avatar/${HASH}-256.webp`,
      `/img/v1/avatars/${USER}/${HASH}-256.webp`,
      `/img/v2/avatar/${USER}/${HASH}-256.webp`,
    ]) {
      expect(parseAvatarPath(p)).toBeNull()
    }
  })
})

describe('/img avatar route', () => {
  function deps(objects: Record<string, Uint8Array>) {
    const seen = { gets: [] as string[], lookups: 0 }
    const d: ImgDeps = {
      async getObject(key) {
        seen.gets.push(key)
        const o = objects[key]
        return o ? { body: new Blob([o as Uint8Array<ArrayBuffer>]).stream(), contentLength: o.byteLength, etag: '"e"' } : null
      },
      async lookupEmoji() {
        seen.lookups++
        return null
      },
      async enqueueFull() {},
    }
    return { d, seen }
  }

  test('a hit streams the object, immutable, without touching the database', async () => {
    const { d, seen } = deps({ [avatarKey(USER, HASH, 64)]: new Uint8Array([82, 73, 70, 70]) })
    const res = await handleImg(new Request(`https://x.test${avatarUrl(USER, HASH, 64)}`), d)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(IMMUTABLE)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(seen).toEqual({ gets: [avatarKey(USER, HASH, 64)], lookups: 0 })
  })

  test('missing objects and malformed paths 404 with the short miss cache', async () => {
    const { d, seen } = deps({})
    for (const p of [avatarUrl(USER, HASH, 256)!, `/img/v1/avatar/${USER}/${HASH}-128.webp`, `/img/v1/avatar/${USER}/ZZ-256.webp`]) {
      const res = await handleImg(new Request(`https://x.test${p}`), d)
      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    }
    // only the well-formed path reached storage
    expect(seen).toEqual({ gets: [avatarKey(USER, HASH, 256)], lookups: 0 })
  })
})

describe('upload input', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
  const ascii = (s: string) => new TextEncoder().encode(s)

  test('sniffImage', () => {
    expect(sniffImage(png)).toBe('png')
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(sniffImage(ascii('GIF89a......'))).toBe('gif')
    expect(sniffImage(ascii('GIF87a......'))).toBe('gif')
    expect(sniffImage(ascii('RIFF\x10\x00\x00\x00WEBPVP8 '))).toBe('webp')
    expect(sniffImage(ascii('RIFF\x10\x00\x00\x00WAVEfmt '))).toBeNull()
    expect(sniffImage(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffImage(ascii('BM....'))).toBeNull()
    expect(sniffImage(new Uint8Array())).toBeNull()
  })

  test('avatarFormFile: one file field, not empty, at most 2 MB', () => {
    const form = (...entries: [string, Blob | string][]) => {
      const f = new FormData()
      for (const [k, v] of entries) f.append(k, v)
      return f
    }
    const ok = new Blob([png])
    expect(avatarFormFile(form(['file', ok]))).toBeInstanceOf(Blob)
    const status = (fn: () => unknown) => {
      try {
        fn()
        return 0
      } catch (e) {
        return (e as { status: number }).status
      }
    }
    expect(status(() => avatarFormFile({ file: ok }))).toBe(400)
    expect(status(() => avatarFormFile(form()))).toBe(400)
    expect(status(() => avatarFormFile(form(['file', 'text'])))).toBe(400)
    expect(status(() => avatarFormFile(form(['file', new Blob([])])))).toBe(400)
    expect(status(() => avatarFormFile(form(['file', ok], ['file', ok])))).toBe(400)
    expect(status(() => avatarFormFile(form(['file', ok], ['x', '1'])))).toBe(400)
    expect(status(() => avatarFormFile(form(['file', new Blob([new Uint8Array(AVATAR_MAX_BYTES + 1)])])))).toBe(413)
  })
})

describe('profile guard', () => {
  test('image on the user endpoints is refused, even null; other fields and paths pass', () => {
    expect(carriesImage('/update-user', { image: 'x' })).toBe(true)
    expect(carriesImage('/update-user', { image: null })).toBe(true)
    expect(carriesImage('/update-user', { name: 'a' })).toBe(false)
    expect(carriesImage('/sign-up/email', { email: 'a', image: 'x' })).toBe(true)
    expect(carriesImage('/admin/update-user', { userId: 'u', data: { image: 'x' } })).toBe(true)
    expect(carriesImage('/admin/create-user', { email: 'a', data: { image: 'x' } })).toBe(true)
    expect(carriesImage('/admin/update-user', { userId: 'u', data: { name: 'x' } })).toBe(false)
    expect(carriesImage('/sign-in/email', { image: 'x' })).toBe(false)
    expect(carriesImage('/update-user', undefined)).toBe(false)
    expect(() => guardProfileUpdate({ path: '/update-user', body: { image: 'x' } })).toThrow()
    expect(() => guardProfileUpdate({ path: '/update-user', body: { name: 'x' } })).not.toThrow()
    expect(() => guardProfileUpdate({})).not.toThrow()
  })
})
