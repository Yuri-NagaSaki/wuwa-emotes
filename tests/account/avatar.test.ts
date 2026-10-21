import { makePng, person, rejects, setup, sqlRows, type Person } from '../submissions/helpers'
import { authCall, goodToken, SITE_URL } from '../integration/setup'
import { runServerFn } from '../admin/harness'
import { beforeAll, describe, expect, test } from 'bun:test'
import sharp, { type OutputInfo } from 'sharp'
import { AVATAR_CHANGES_PER_HOUR, AVATAR_MAX_BYTES, removeAvatar, setAvatar } from '#/server/account/avatar'
import { deleteAccount, meSummary } from '#/server/account/service'
import { imgDeps } from '#/server/http/img-deps'
import { handleImg, IMMUTABLE } from '#/server/media/img'
import { avatarKey, avatarUrl } from '#/server/media/keys'
import { getObjectBytes, headObject } from '#/server/media/s3'

// 头像: upload → two content-addressed WebPs + users.image = hash; replace / remove / 注销 delete the
// files; Better Auth cannot set users.image; the /img avatar route; EXIF orientation; the hourly limit.
//
//   CHAOCHI_TEST_DB=chaochi_test_submissions_lc CHAOCHI_TEST_BUCKET=chaochi-test-submissions-lc bun test ./tests/account/avatar.test.ts

beforeAll(async () => {
  await setup()
}, 120_000)

async function imageOf(id: string): Promise<string | null> {
  const [r] = await sqlRows<{ image: string | null }>(`select image from users where id = $1`, [id])
  return r!.image
}

async function exists(key: string) {
  return (await headObject(key)) != null
}

/** JPEG stored sideways: stored rows are red on top, blue below; EXIF orientation 6 (rotate 90° CW). */
async function sidewaysJpeg(): Promise<Buffer> {
  const w = 300
  const h = 200
  const px = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 3
      if (y < h / 2) px.set([230, 30, 30], o)
      else px.set([30, 30, 230], o)
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).withMetadata({ orientation: 6 }).toBuffer()
}

function rgbAt(raw: { data: Buffer; info: OutputInfo }, x: number, y: number) {
  const o = (y * raw.info.width + x) * raw.info.channels
  return [raw.data[o]!, raw.data[o + 1]!, raw.data[o + 2]!]
}

describe('upload', () => {
  let u: Person

  beforeAll(async () => {
    u = await person('avatar')
  })

  test('sets users.image to the hash and writes 256 and 64 px WebPs with immutable caching', async () => {
    const res = await setAvatar(u.actor, await makePng(400, 300, 11))
    const hash = await imageOf(u.id)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(res.avatarUrl).toBe(`/img/v1/avatar/${u.id}/${hash}-256.webp`)
    for (const size of [256, 64] as const) {
      const head = await headObject(avatarKey(u.id, hash!, size))
      expect(head?.ContentType).toBe('image/webp')
      expect(head?.CacheControl).toBe(IMMUTABLE)
      const meta = await sharp(await getObjectBytes(avatarKey(u.id, hash!, size))).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(['webp', size, size])
      expect(meta.exif).toBeUndefined()
    }
    expect((await meSummary(u.actor)).avatarUrl).toBe(res.avatarUrl)
    const rows = await sqlRows<{ action: string; diff: { to: string } }>(`select action, diff from audit_logs where target_id = $1 and action = 'user.avatar'`, [u.id])
    expect(rows.at(-1)!.diff.to).toBe(hash!)
  })

  test('replacing deletes the previous pair; the same picture again keeps its files', async () => {
    const first = await imageOf(u.id)
    await setAvatar(u.actor, await makePng(200, 200, 12))
    const second = await imageOf(u.id)
    expect(second).not.toBe(first)
    expect(await exists(avatarKey(u.id, first!, 256))).toBe(false)
    expect(await exists(avatarKey(u.id, first!, 64))).toBe(false)
    expect(await exists(avatarKey(u.id, second!, 256))).toBe(true)
    // identical crop → identical hash: nothing may be deleted
    await setAvatar(u.actor, await makePng(200, 200, 12))
    expect(await imageOf(u.id)).toBe(second)
    expect(await exists(avatarKey(u.id, second!, 256))).toBe(true)
    expect(await exists(avatarKey(u.id, second!, 64))).toBe(true)
  })

  test('remove: files deleted, image null, audited; removing again is a no-op', async () => {
    const hash = await imageOf(u.id)
    expect(await removeAvatar(u.actor)).toEqual({ removed: true })
    expect(await imageOf(u.id)).toBeNull()
    expect(await exists(avatarKey(u.id, hash!, 256))).toBe(false)
    expect(await removeAvatar(u.actor)).toEqual({ removed: false })
    expect((await meSummary(u.actor)).avatarUrl).toBeNull()
    const rows = await sqlRows(`select 1 from audit_logs where target_id = $1 and action = 'user.avatar_remove'`, [u.id])
    expect(rows).toHaveLength(1)
  })

  test('an EXIF-rotated JPEG comes out upright and without EXIF', async () => {
    const v = await person('exif')
    await setAvatar(v.actor, await sidewaysJpeg())
    const bytes = await getObjectBytes(avatarKey(v.id, (await imageOf(v.id))!, 256))
    const meta = await sharp(bytes).metadata()
    expect(meta.exif).toBeUndefined()
    expect(meta.orientation).toBeUndefined()
    const raw = await sharp(bytes).raw().toBuffer({ resolveWithObject: true })
    // upright: the stored top (red) is on the right, the stored bottom (blue) on the left
    const [lr, , lb] = rgbAt(raw, 40, 128)
    const [rr, , rb] = rgbAt(raw, 216, 128)
    expect(lb).toBeGreaterThan(150)
    expect(lr).toBeLessThan(100)
    expect(rr).toBeGreaterThan(150)
    expect(rb).toBeLessThan(100)
  })

  test('an animated GIF keeps its first frame as a still WebP', async () => {
    const { makeGif } = await import('../media/helpers')
    const v = await person('gif')
    await setAvatar(v.actor, await makeGif(120, 120, 6, 5))
    const meta = await sharp(await getObjectBytes(avatarKey(v.id, (await imageOf(v.id))!, 256)), { animated: true }).metadata()
    expect([meta.format, meta.pages ?? 1, meta.width, meta.height]).toEqual(['webp', 1, 256, 256])
  })
})

describe('rejected uploads', () => {
  let u: Person

  beforeAll(async () => {
    u = await person('avatar-bad')
  })

  test('oversized, non-image and undecodable bodies, before anything is written', async () => {
    const big = new Uint8Array(AVATAR_MAX_BYTES + 1)
    big.set(await makePng(8, 8, 1))
    await rejects(setAvatar(u.actor, big), 413, '2 MB')
    await rejects(setAvatar(u.actor, new TextEncoder().encode('just some text, not a picture')), 415)
    await rejects(setAvatar(u.actor, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), 415)
    const broken = new Uint8Array(await makePng(64, 64, 2)).slice(0, 60)
    await rejects(setAvatar(u.actor, broken), 415)
    expect(await imageOf(u.id)).toBeNull()
  })

  test('setAvatarFn: anonymous 401; the form needs one file of at most 2 MB', async () => {
    const { setAvatarFn } = await import('#/server/account/fn')
    const form = (body: Uint8Array, extra = false) => {
      const f = new FormData()
      f.append('file', new Blob([body as Uint8Array<ArrayBuffer>], { type: 'image/png' }), 'a.png')
      if (extra) f.append('other', 'x')
      return f
    }
    const small = new Uint8Array(await makePng(16, 16, 3))
    expect((await runServerFn(setAvatarFn, form(small))).status).toBe(401)
    expect((await runServerFn(setAvatarFn, form(new Uint8Array(AVATAR_MAX_BYTES + 1)), u.cookie)).status).toBe(413)
    expect((await runServerFn(setAvatarFn, form(small, true), u.cookie)).status).toBe(400)
    expect((await runServerFn(setAvatarFn, { file: 'not a form' }, u.cookie)).status).toBe(400)
    // a valid form gets past the validator (the handler itself is not attached outside the Start build)
    expect((await runServerFn(setAvatarFn, form(small), u.cookie)).status).toBeNull()
  })

  test(`the ${AVATAR_CHANGES_PER_HOUR + 1}th change in an hour is refused`, async () => {
    const v = await person('avatar-limit')
    const png = await makePng(32, 32, 4)
    for (let i = 0; i < AVATAR_CHANGES_PER_HOUR; i++) await setAvatar(v.actor, png)
    const hash = await imageOf(v.id)
    await rejects(setAvatar(v.actor, await makePng(32, 32, 5)), 429, '每小时')
    expect(await imageOf(v.id)).toBe(hash)
    // removing is always possible
    expect(await removeAvatar(v.actor)).toEqual({ removed: true })
  })
})

describe('Better Auth cannot set users.image', () => {
  test('/update-user with image is rejected (even null); a name change still works', async () => {
    const u = await person('guarded')
    await setAvatar(u.actor, await makePng(50, 50, 21))
    const hash = await imageOf(u.id)
    for (const image of ['https://example.test/x.png', '0123456789abcdef', null]) {
      const res = await authCall('/update-user', { body: { image }, cookie: u.cookie })
      expect(res.status).toBe(400)
      expect(((await res.json()) as { code: string }).code).toBe('IMAGE_NOT_ALLOWED')
    }
    const both = await authCall('/update-user', { body: { name: '换个名字', image: 'https://example.test/y.png' }, cookie: u.cookie })
    expect(both.status).toBe(400)
    expect(await imageOf(u.id)).toBe(hash)
    const ok = await authCall('/update-user', { body: { name: '换个名字' }, cookie: u.cookie })
    expect(ok.status).toBe(200)
    expect((await meSummary(u.actor)).name).toBe('换个名字')
    expect(await imageOf(u.id)).toBe(hash)
  })

  test('sign-up with image is rejected before the Cap token is spent', async () => {
    const res = await authCall('/sign-up/email', {
      body: { email: `img-${Date.now()}@test.chaochi`, password: 'correct horse battery staple', name: 'img', image: 'https://example.test/z.png' },
      cap: goodToken(),
    })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('IMAGE_NOT_ALLOWED')
  })
})

describe('注销账号 and /img', () => {
  test('account deletion removes both files', async () => {
    const u = await person('avatar-leaver')
    await setAvatar(u.actor, await makePng(90, 90, 31))
    const hash = (await imageOf(u.id))!
    await deleteAccount(u.actor, u.password)
    expect(await exists(avatarKey(u.id, hash, 256))).toBe(false)
    expect(await exists(avatarKey(u.id, hash, 64))).toBe(false)
  })

  test('/img/v1/avatar/… serves exactly that object with immutable caching; malformed paths 404', async () => {
    const u = await person('avatar-img')
    await setAvatar(u.actor, await makePng(120, 120, 41))
    const hash = (await imageOf(u.id))!
    for (const size of [256, 64] as const) {
      const res = await handleImg(new Request(`${SITE_URL}${avatarUrl(u.id, hash, size)}`), imgDeps)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('image/webp')
      expect(res.headers.get('cache-control')).toBe(IMMUTABLE)
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('set-cookie')).toBeNull()
      const meta = await sharp(new Uint8Array(await res.arrayBuffer())).metadata()
      expect([meta.width, meta.height]).toEqual([size, size])
    }
    const bad = [
      `/img/v1/avatar/${u.id}/${hash.toUpperCase()}-256.webp`,
      `/img/v1/avatar/${u.id}/${hash}-128.webp`,
      `/img/v1/avatar/${u.id}/${hash.slice(1)}-256.webp`,
      `/img/v1/avatar/${u.id}/${hash}-256.png`,
      `/img/v1/avatar/${u.id}.x/${hash}-256.webp`,
      `/img/v1/avatar/${u.id}/../${hash}-256.webp`,
      `/img/v1/avatar/${u.id}/%2e%2e/${hash}-256.webp`,
      `/img/v1/avatar/${u.id}/0000000000000000-256.webp`,
      `/img/v1/avatar/${hash}-256.webp`,
    ]
    const statuses = []
    for (const path of bad) statuses.push([path, (await handleImg(new Request(`${SITE_URL}${path}`), imgDeps)).status])
    expect(statuses).toEqual(bad.map((p) => [p, 404]))
  })
})
