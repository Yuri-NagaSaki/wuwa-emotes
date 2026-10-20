import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../src/server/db/client'
import { IMMUTABLE } from '../../src/server/media/img'
import { derivedKey, originalKey, reviewKey, VARIANTS } from '../../src/server/media/keys'
import { deleteEmojiFiles, publishEmojiDerivatives, type PublishDeps } from '../../src/server/media/publish'
import { PURGE_BATCH, purgeImgUrls } from '../../src/server/media/purge'
import { headObject, listKeys, putObject } from '../../src/server/media/s3'
import { newEmojiId } from '../../src/shared/ids'
import { emptyBucket, insertPack, makeWebp, resetDb, setupTestEnv } from './helpers'

const PK = 'publish-a'
let packId = 0
const queued: string[] = []
const deps: PublishDeps = {
  async enqueueDerived(id) {
    queued.push(id)
  },
}

async function addEmoji(opts: { frames?: number; status?: 'pending' | 'published'; variantRev?: number; review?: ('p240' | 'a160')[] }) {
  const id = newEmojiId()
  await db()
    .insert(schema.emojis)
    .values({
      id,
      packId,
      storagePackKey: PK,
      status: opts.status ?? 'published',
      originalKey: originalKey(PK, id, 'gif'),
      format: 'gif',
      mime: 'image/gif',
      bytes: 10,
      frames: opts.frames ?? 1,
      variantRev: opts.variantRev ?? 1,
    })
  for (const v of opts.review ?? []) await putObject(reviewKey(v, PK, id), await makeWebp(16, 16, v.length), 'image/webp', 'private, no-store')
  return id
}

const derivedReady = async (id: string) => (await db().select().from(schema.emojis).where(eq(schema.emojis.id, id)))[0]!.derivedReady

beforeAll(async () => {
  await setupTestEnv()
  await resetDb()
  await emptyBucket()
  packId = (await insertPack({ packKey: PK, status: 'published' })).id
})

describe('publishEmojiDerivatives', () => {
  test('animated: p240 and a160 copied to derived/ with immutable caching, review copies removed', async () => {
    const id = await addEmoji({ frames: 12, review: ['p240', 'a160'] })
    expect(await publishEmojiDerivatives(id, deps)).toBe('copied')
    for (const v of ['p240', 'a160'] as const) {
      const h = await headObject(derivedKey(v, PK, id, 1))
      expect(h?.ContentType).toBe('image/webp')
      expect(h?.CacheControl).toBe(IMMUTABLE)
      expect(await headObject(reviewKey(v, PK, id))).toBeNull()
    }
    expect(await derivedReady(id)).toBe(true)
  })

  test('static: only the poster is copied', async () => {
    const id = await addEmoji({ frames: 1, variantRev: 3, review: ['p240'] })
    expect(await publishEmojiDerivatives(id, deps)).toBe('copied')
    expect(await headObject(derivedKey('p240', PK, id, 3))).not.toBeNull()
    expect(await headObject(derivedKey('a160', PK, id, 3))).toBeNull()
    expect(await listKeys(`review/v1/p240/${PK}/${id}`)).toEqual([])
  })

  test('missing review copies queue a derive job instead', async () => {
    const none = await addEmoji({ frames: 1 })
    expect(await publishEmojiDerivatives(none, deps)).toBe('queued')
    const noA160 = await addEmoji({ frames: 5, review: ['p240'] })
    expect(await publishEmojiDerivatives(noA160, deps)).toBe('queued')
    expect(queued).toEqual([none, noA160])
    expect(await derivedReady(none)).toBe(false)
    expect(await listKeys(`derived/v1/p240/${PK}/${noA160}`)).toEqual([])
    expect(await headObject(reviewKey('p240', PK, noA160))).toBeNull()
  })

  test('queues the full render for the dialog on both paths; a failing queue does not fail the publish', async () => {
    const full: string[] = []
    const withFull: PublishDeps = { ...deps, enqueueFull: async (id) => void full.push(id) }
    const copied = await addEmoji({ frames: 1, review: ['p240'] })
    expect(await publishEmojiDerivatives(copied, withFull)).toBe('copied')
    const derive = await addEmoji({ frames: 1 })
    expect(await publishEmojiDerivatives(derive, withFull)).toBe('queued')
    expect(full).toEqual([copied, derive])

    const broken: PublishDeps = { ...deps, enqueueFull: async () => Promise.reject(new Error('queue down')) }
    const third = await addEmoji({ frames: 1, review: ['p240'] })
    expect(await publishEmojiDerivatives(third, broken)).toBe('copied')
    expect(await derivedReady(third)).toBe(true)
  })

  test('refuses emojis that are not published', async () => {
    const id = await addEmoji({ status: 'pending', review: ['p240'] })
    await expect(publishEmojiDerivatives(id, deps)).rejects.toThrow('only published emojis')
    expect(await headObject(reviewKey('p240', PK, id))).not.toBeNull()
    expect(await listKeys(`derived/v1/p240/${PK}/${id}`)).toEqual([])
  })
})

describe('deleteEmojiFiles', () => {
  test('removes the original, every variant of every revision and the review copies', async () => {
    const id = await addEmoji({ frames: 4, variantRev: 2, review: ['p240', 'a160'] })
    await putObject(originalKey(PK, id, 'gif'), new Uint8Array([1, 2, 3]), 'image/gif')
    for (const rev of [1, 2]) for (const v of VARIANTS) await putObject(derivedKey(v, PK, id, rev), new Uint8Array([rev]), 'image/webp')
    const other = await addEmoji({ review: ['p240'] })
    await putObject(originalKey(PK, other, 'gif'), new Uint8Array([9]), 'image/gif')

    const r = await deleteEmojiFiles(id)
    expect(r.deletedKeys.length).toBe(1 + 2 * VARIANTS.length + 2)
    const left = await listKeys('')
    expect(left.filter((k) => k.includes(id))).toEqual([])
    expect(left).toContain(originalKey(PK, other, 'gif'))
    expect(r.imgUrls).toEqual([
      `http://localhost:3000/img/v1/p240/${PK}/${id}.r1.webp`,
      `http://localhost:3000/img/v1/a160/${PK}/${id}.r1.webp`,
      `http://localhost:3000/img/v1/full/${PK}/${id}.r1.webp`,
      `http://localhost:3000/img/v1/p240/${PK}/${id}.r2.webp`,
      `http://localhost:3000/img/v1/a160/${PK}/${id}.r2.webp`,
      `http://localhost:3000/img/v1/full/${PK}/${id}.r2.webp`,
    ])
  })

  test('accepts the row itself once it has been deleted from the database', async () => {
    const id = newEmojiId()
    const key = originalKey(PK, id, 'png')
    await putObject(key, new Uint8Array([1]), 'image/png')
    const r = await deleteEmojiFiles({ id, storagePackKey: PK, originalKey: key, variantRev: 1 })
    expect(r.imgUrls.length).toBe(3)
    expect(await headObject(key)).toBeNull()
  })
})

describe('purgeImgUrls', () => {
  function recorder(ok = true) {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! })
      return new Response(JSON.stringify(ok ? { success: true, errors: [] } : { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }), {
        status: ok ? 200 : 403,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof fetch
    return { calls, fetchMock }
  }

  test('posts batches of 30 absolute URLs with the purge token', async () => {
    const { calls, fetchMock } = recorder()
    const urls = Array.from({ length: 65 }, (_, i) => `/img/v1/p240/${PK}/r-${String(i).padStart(20, '0')}.r1.webp`)
    const r = await purgeImgUrls([...urls, urls[0]!], { zoneId: 'zone123', token: 'tok-secret', fetch: fetchMock, origin: 'https://chaochi.example' })
    expect(r).toEqual({ purged: 65, skipped: false })
    expect(calls.length).toBe(3)
    expect(PURGE_BATCH).toBe(30)
    for (const c of calls) {
      expect(c.url).toBe('https://api.cloudflare.com/client/v4/zones/zone123/purge_cache')
      expect(c.init.method).toBe('POST')
      expect((c.init.headers as Record<string, string>).authorization).toBe('Bearer tok-secret')
    }
    const files = calls.map((c) => (JSON.parse(String(c.init.body)) as { files: string[] }).files)
    expect(files.map((f) => f.length)).toEqual([30, 30, 5])
    expect(files[0]![0]).toBe(`https://chaochi.example${urls[0]}`)
  })

  test('a Cloudflare error is raised', async () => {
    const { fetchMock } = recorder(false)
    await expect(purgeImgUrls(['https://x.example/img/a'], { zoneId: 'z', token: 't', fetch: fetchMock })).rejects.toThrow('Cloudflare purge failed (HTTP 403)')
  })

  test('without CF_ZONE_ID / CF_PURGE_TOKEN it is a no-op', async () => {
    const { calls, fetchMock } = recorder()
    expect(await purgeImgUrls(['/img/v1/p240/a/b.r1.webp'], { zoneId: '', token: '', fetch: fetchMock })).toEqual({ purged: 0, skipped: true })
    expect(calls.length).toBe(0)
  })
})
