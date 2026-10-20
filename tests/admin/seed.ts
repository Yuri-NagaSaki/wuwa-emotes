// Rows and objects for tests/admin (after harness.ts has fixed the environment).
import { newEmojiId, newPackKey } from '#/shared/ids'
import { db, schema } from '#/server/db/client'
import { derivedKey, originalKey, reviewKey, zipKey } from '#/server/media/keys'
import { headObject, putObject } from '#/server/media/s3'

const BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2, 3, 4])

export async function seedPack(opts: Partial<typeof schema.packs.$inferInsert> = {}) {
  const packKey = opts.packKey ?? newPackKey('t')
  const [row] = await db()
    .insert(schema.packs)
    .values({ slug: packKey, title: `测试包 ${packKey}`, status: 'published', ...opts, packKey })
    .returning()
  return row!
}

/**
 * An emoji row; with `objects` also its original, derived p240/a160/full for every revision (or the
 * review previews when pending) in the bucket.
 */
export async function seedEmoji(
  pack: { id: number; packKey: string },
  opts: Partial<typeof schema.emojis.$inferInsert> & { objects?: boolean } = {},
) {
  const id = opts.id ?? newEmojiId()
  const storage = opts.storagePackKey ?? pack.packKey
  const status = opts.status ?? 'published'
  const rev = opts.variantRev ?? 1
  const frames = opts.frames ?? 4
  const values: typeof schema.emojis.$inferInsert = {
    packId: pack.id,
    storagePackKey: storage,
    status,
    originalKey: originalKey(storage, id, 'gif'),
    format: 'gif',
    mime: 'image/gif',
    bytes: BYTES.byteLength,
    width: 240,
    height: 240,
    frames,
    variantRev: rev,
    derivedReady: status !== 'pending',
    p240Bytes: 100,
    a160Bytes: frames > 1 ? 200 : null,
    sha256: crypto.randomUUID().replace(/-/g, '').padEnd(64, '0'),
    ...opts,
    id,
  }
  delete (values as { objects?: boolean }).objects
  const [row] = await db().insert(schema.emojis).values(values).returning()
  if (opts.objects) {
    await putObject(row!.originalKey, BYTES, 'image/gif')
    if (status === 'pending') {
      await putObject(reviewKey('p240', storage, id), BYTES, 'image/webp')
      if (frames > 1) await putObject(reviewKey('a160', storage, id), BYTES, 'image/webp')
    } else {
      for (let r = 1; r <= rev; r++) {
        await putObject(derivedKey('p240', storage, id, r), BYTES, 'image/webp')
        if (frames > 1) await putObject(derivedKey('a160', storage, id, r), BYTES, 'image/webp')
        await putObject(derivedKey('full', storage, id, r), BYTES, 'image/webp')
      }
    }
  }
  return row!
}

export async function seedZip(pack: { id: number; packKey: string }) {
  const key = zipKey(pack.packKey, 'abcd1234')
  await putObject(key, BYTES, 'application/zip')
  await db().insert(schema.zipArtifacts).values({ packId: pack.id, contentHash: 'abcd1234'.padEnd(64, '0'), objectKey: key, bytes: BYTES.byteLength })
  return key
}

export async function exists(key: string): Promise<boolean> {
  return (await headObject(key)) != null
}

export async function seedCharacter(name: string, opts: Partial<typeof schema.characters.$inferInsert> = {}) {
  const [row] = await db()
    .insert(schema.characters)
    .values({ name, slug: opts.slug ?? `c-${crypto.randomUUID().slice(0, 8)}`, ...opts })
    .returning()
  return row!
}

export async function seedArtist(name: string, opts: Partial<typeof schema.artists.$inferInsert> = {}) {
  const [row] = await db()
    .insert(schema.artists)
    .values({ name, slug: opts.slug ?? `a-${crypto.randomUUID().slice(0, 8)}`, ...opts })
    .returning()
  return row!
}
