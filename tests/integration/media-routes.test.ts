import { BUCKET, DATABASE_URL, mainDatabase, signUp, withClient } from './setup'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { BucketAlreadyOwnedByYou, CreateBucketCommand } from '@aws-sdk/client-s3'
import { getViewer } from '#/server/auth/session'
import { enqueueFull, getImgObject, imgDeps, lookupEmojiForFull } from '#/server/http/img-deps'
import { handleReviewImg, lookupReviewEmoji, type ReviewImgDeps } from '#/server/http/review-img'
import { jobSender } from '#/server/jobs/boss'
import { handleImg } from '#/server/media/img'
import { derivedKey, reviewKey } from '#/server/media/keys'
import { putObject, s3 } from '#/server/media/s3'

// The real /img and /review-img dependencies against PostgreSQL + RustFS (bucket from setup.ts).

const ORIGIN = 'http://localhost:3101'
const RUN = Date.now().toString(16).slice(-8)
const PACK = `it-pack-${RUN}`
const PENDING_PACK = `it-draft-${RUN}`
const hex = (n: number) => `r-${RUN}${n.toString(16).padStart(12, '0')}`
const STATIC_ID = hex(1)
const ANIM_ID = hex(2)
const PENDING_ID = hex(3)
const MISSING_ID = hex(99)
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3, 4])

let owner: Awaited<ReturnType<typeof signUp>>
let stranger: Awaited<ReturnType<typeof signUp>>
let reviewer: Awaited<ReturnType<typeof signUp>>

beforeAll(async () => {
  const run = await mainDatabase()
  if (run.exitCode !== 0) throw new Error(`migrate failed:\n${run.output}`)
  try {
    await s3().send(new CreateBucketCommand({ Bucket: BUCKET }))
  } catch (err) {
    if (!(err instanceof BucketAlreadyOwnedByYou) && (err as Error).name !== 'BucketAlreadyExists') throw err
  }

  owner = await signUp('pack-owner')
  stranger = await signUp('stranger')
  reviewer = await signUp('reviewer')
  await withClient(DATABASE_URL, async (c) => {
    await c.query(`update users set role = 'manager' where id = $1`, [reviewer.id])
    const pub = await c.query(`insert into packs (pack_key, slug, title, status, owner_id) values ($1, $1, 'IT', 'published', $2) returning id`, [PACK, owner.id])
    const draft = await c.query(`insert into packs (pack_key, slug, title, status, owner_id) values ($1, $1, 'IT draft', 'draft', $2) returning id`, [
      PENDING_PACK,
      owner.id,
    ])
    const insert = `insert into emojis (id, pack_id, storage_pack_key, status, original_key, format, mime, bytes, frames, variant_rev)
                    values ($1, $2, $3, $4, 'x', 'gif', 'image/gif', 1, $5, $6)`
    await c.query(insert, [STATIC_ID, pub.rows[0].id, PACK, 'published', 1, 1])
    await c.query(insert, [ANIM_ID, pub.rows[0].id, PACK, 'published', 12, 3])
    await c.query(insert, [PENDING_ID, draft.rows[0].id, PENDING_PACK, 'pending', 12, 1])
  })
  await putObject(derivedKey('p240', PACK, STATIC_ID, 1), WEBP, 'image/webp')
  await putObject(reviewKey('p240', PENDING_PACK, PENDING_ID), WEBP, 'image/webp')
}, 60_000)

afterAll(async () => {
  await (await jobSender()).stop({ graceful: false })
})

describe('getImgObject (S3)', () => {
  test('hit streams the object with its ETag', async () => {
    const obj = await getImgObject(derivedKey('p240', PACK, STATIC_ID, 1))
    expect(obj).not.toBeNull()
    expect(obj!.contentLength).toBe(WEBP.byteLength)
    expect(obj!.etag).toMatch(/^".+"$/)
    expect(new Uint8Array(await new Response(obj!.body).arrayBuffer())).toEqual(WEBP)
  })

  test('a matching If-None-Match maps the SDK 304 to notModified', async () => {
    const first = await getImgObject(derivedKey('p240', PACK, STATIC_ID, 1))
    await first!.body?.cancel()
    const again = await getImgObject(derivedKey('p240', PACK, STATIC_ID, 1), first!.etag)
    expect(again).toEqual({ body: null, notModified: true, etag: first!.etag })
  })

  test('a stale If-None-Match gets the object', async () => {
    const obj = await getImgObject(derivedKey('p240', PACK, STATIC_ID, 1), '"stale"')
    expect(obj?.notModified).toBeUndefined()
    await obj!.body?.cancel()
  })

  test('NoSuchKey maps to null', async () => {
    expect(await getImgObject(derivedKey('p240', PACK, MISSING_ID, 1))).toBeNull()
  })
})

describe('lookupEmojiForFull (SQL)', () => {
  test('one join returns status, pack status, key, rev and frames', async () => {
    expect(await lookupEmojiForFull(ANIM_ID)).toEqual({ status: 'published', packStatus: 'published', storagePackKey: PACK, variantRev: 3, frames: 12 })
    expect(await lookupEmojiForFull(PENDING_ID)).toEqual({ status: 'pending', packStatus: 'draft', storagePackKey: PENDING_PACK, variantRev: 1, frames: 12 })
    expect(await lookupEmojiForFull(MISSING_ID)).toBeNull()
  })
})

describe('/img with real dependencies', () => {
  test('hit, then 304', async () => {
    const res = await handleImg(new Request(`${ORIGIN}/img/v1/p240/${PACK}/${STATIC_ID}.r1.webp`), imgDeps)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(WEBP)
    const etag = res.headers.get('etag')!
    const cached = await handleImg(new Request(`${ORIGIN}/img/v1/p240/${PACK}/${STATIC_ID}.r1.webp`, { headers: { 'if-none-match': etag } }), imgDeps)
    expect(cached.status).toBe(304)
  })

  test('full miss for a published emoji queues one media.full job per emoji', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await handleImg(new Request(`${ORIGIN}/img/v1/full/${PACK}/${ANIM_ID}.r3.webp`), imgDeps)
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe(`/img/v1/a160/${PACK}/${ANIM_ID}.r3.webp`)
    }
    await enqueueFull(ANIM_ID)
    const jobs = await withClient(DATABASE_URL, (c) =>
      c.query(`select data from pgboss.job where name = 'media.full' and singleton_key = $1 and state in ('created', 'retry', 'active')`, [ANIM_ID]),
    )
    expect(jobs.rowCount).toBe(1)
    expect(jobs.rows[0].data).toEqual({ emojiId: ANIM_ID })
  })

  test('full miss for a pending emoji queues nothing', async () => {
    const res = await handleImg(new Request(`${ORIGIN}/img/v1/full/${PENDING_PACK}/${PENDING_ID}.r1.webp`), imgDeps)
    expect(res.status).toBe(404)
    const jobs = await withClient(DATABASE_URL, (c) => c.query(`select 1 from pgboss.job where singleton_key = $1`, [PENDING_ID]))
    expect(jobs.rowCount).toBe(0)
  })
})

describe('/review-img with real dependencies', () => {
  const deps: ReviewImgDeps = { getViewer, lookupEmoji: lookupReviewEmoji, getObject: (k) => getImgObject(k) }
  const path = () => `${ORIGIN}/review-img/v1/p240/${PENDING_PACK}/${PENDING_ID}.webp`
  const get = (cookie?: string, url = path()) => handleReviewImg(new Request(url, { headers: cookie ? { cookie } : {} }), deps)

  test('the pack owner sees their pending preview', async () => {
    const res = await get(owner.cookie)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(WEBP)
  })

  test('a reviewer (manager) sees it', async () => {
    expect((await get(reviewer.cookie)).status).toBe(200)
  })

  test('another user and anonymous visitors get 404', async () => {
    for (const res of [await get(stranger.cookie), await get(undefined), await get('better-auth.session_token=forged.value')]) {
      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).toBe('private, no-store')
    }
  })

  test('the wrong pack key is 404 even for a reviewer', async () => {
    expect((await get(reviewer.cookie, `${ORIGIN}/review-img/v1/p240/${PACK}/${PENDING_ID}.webp`)).status).toBe(404)
  })

  test('once published, the owner no longer sees the review copy', async () => {
    await withClient(DATABASE_URL, (c) => c.query(`update emojis set status = 'published' where id = $1`, [PENDING_ID]))
    try {
      expect((await get(owner.cookie)).status).toBe(404)
      expect((await get(reviewer.cookie)).status).toBe(200)
    } finally {
      await withClient(DATABASE_URL, (c) => c.query(`update emojis set status = 'pending' where id = $1`, [PENDING_ID]))
    }
  })
})
