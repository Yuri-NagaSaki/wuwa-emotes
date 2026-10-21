import { beforeAll, describe, expect, test } from 'bun:test'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { setCacheControl } from '../../src/server/media/cache-control'
import { derivedKey, IMMUTABLE, originalKey, portraitKey } from '../../src/server/media/keys'
import { bucket, getObjectBytes, headObject, putObject, s3 } from '../../src/server/media/s3'
import { emptyBucket, makeWebp, setupTestEnv } from './helpers'

// Headers of public web images in the bucket: the bucket's public domain (PUBLIC_IMG_BASE) serves
// objects with the headers they were stored with.

const PACK = 'cachectl-pack'
const ID = 'r-0a7bf47f0ec26d3843bf'

beforeAll(async () => {
  await setupTestEnv()
  await emptyBucket('derived/v1/p240/cachectl-pack/')
  await emptyBucket('assets/v1/packs/cachectl-pack/')
})

/** An object as an older writer left it: no Cache-Control, generic type, some user metadata. */
async function rawPut(key: string, body: Uint8Array, contentType: string, cacheControl?: string) {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl, Metadata: { source: 'v1' } }))
}

describe('new public images', () => {
  test('putObject gives derived images, portraits and avatars the immutable header by default', async () => {
    const body = await makeWebp(8, 8, 1)
    for (const key of [derivedKey('p240', 'cachectl-new', ID, 9), portraitKey({ name: 'cachectl', hash8: '0a1b2c3d', width: 240 }), 'avatars/v1/cachectl-test.webp']) {
      await putObject(key, body, 'image/webp')
      const h = await headObject(key)
      expect(h?.CacheControl).toBe(IMMUTABLE)
      expect(h?.ContentType).toBe('image/webp')
    }
    // other prefixes keep the storage default
    await putObject(originalKey(PACK, ID, 'png'), body, 'image/png')
    expect((await headObject(originalKey(PACK, ID, 'png')))?.CacheControl).toBeUndefined()
  })
})

describe('media set-cache-control', () => {
  test('rewrites only what is missing, keeps the bytes and user metadata; dry run changes nothing', async () => {
    const body = await makeWebp(16, 16, 2)
    const stale = derivedKey('p240', PACK, ID, 1)
    const typeless = derivedKey('p240', PACK, ID, 2)
    const fine = derivedKey('p240', PACK, ID, 3)
    await rawPut(stale, body, 'image/webp')
    await rawPut(typeless, body, 'application/octet-stream', 'max-age=60')
    await rawPut(fine, body, 'image/webp', IMMUTABLE)
    const original = originalKey(PACK, ID, 'gif')
    await rawPut(original, body, 'image/gif')

    const dry = await setCacheControl(`derived/v1/p240/${PACK}/`, { dryRun: true })
    expect(dry).toEqual({ scanned: 3, unchanged: 1, updated: 2, failed: [] })
    expect((await headObject(stale))?.CacheControl).toBeUndefined()

    const lines: string[] = []
    const r = await setCacheControl(`derived/v1/p240/${PACK}/`, { concurrency: 2, log: (l) => lines.push(l) })
    expect(r).toEqual({ scanned: 3, unchanged: 1, updated: 2, failed: [] })
    for (const key of [stale, typeless, fine]) {
      const h = await headObject(key)
      expect(h?.CacheControl).toBe(IMMUTABLE)
      expect(h?.ContentType).toBe('image/webp')
      expect(h?.Metadata?.source).toBe('v1')
      expect(Buffer.from(await getObjectBytes(key)).equals(body)).toBe(true)
    }
    expect(lines.some((l) => l.includes(stale))).toBe(true)
    // nothing left to do
    expect(await setCacheControl(`derived/v1/p240/${PACK}/`)).toEqual({ scanned: 3, unchanged: 3, updated: 0, failed: [] })
    // never outside the public image prefixes
    await expect(setCacheControl('assets/')).rejects.toThrow(/refusing prefix/)
    expect((await headObject(original))?.CacheControl).toBeUndefined()
  })
})
