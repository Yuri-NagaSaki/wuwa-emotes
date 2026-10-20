import { auditRows, fakeDeps, setupAdminTests, uniq, userWithRole, type RoleUser } from './harness'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { advanceUploads, completeUploads, signUploads } from '#/server/admin/upload'
import { db, schema } from '#/server/db/client'
import { stopJobSender } from '#/server/jobs/boss'
import { deriveEmoji } from '#/server/jobs/handlers/media'
import { ingestUpload } from '#/server/media/ingest'
import { derivedKey, reviewKey } from '#/server/media/keys'
import { makeGif, makePng } from '../media/helpers'
import { exists, seedPack } from './seed'

// 上传中心 end to end against RustFS: presigned PUT → media.ingest → media.derive 'review' →
// advanceUploads publishes (review/ → derived/), the way the worker would run it.

let manager: RoleUser

beforeAll(async () => {
  await setupAdminTests()
  manager = await userWithRole('manager', 'upload-manager')
}, 60_000)

afterAll(async () => {
  await stopJobSender()
})

describe('staff upload', () => {
  test('sign → PUT → ingest → previews → published with derivatives; duplicates skipped', async () => {
    const pack = await seedPack({ packKey: uniq('upload'), downloadable: true })
    const gif = await makeGif(48, 48, 3, 7)
    const png = await makePng(40, 40, 9)
    const files = [
      { name: '新年_01.gif', size: gif.byteLength, type: 'image/gif', body: gif },
      { name: '新年_02.png', size: png.byteLength, type: 'image/png', body: png },
      { name: '新年_03.png', size: png.byteLength, type: 'image/png', body: png },
    ]
    const signed = await signUploads(manager.actor, { packId: pack.id, files: files.map(({ body: _b, ...f }) => f) })
    expect(signed).toHaveLength(3)
    for (const [i, s] of signed.entries()) {
      const res = await fetch(s.url, { method: 'PUT', headers: { 'content-type': s.contentType }, body: new Uint8Array(files[i]!.body) })
      expect(res.status).toBe(200)
    }
    const deps = fakeDeps()
    const ids = signed.map((s) => s.id)
    expect((await completeUploads(manager.actor, ids, deps.deps)).queued).toBe(3)
    expect(deps.calls.ingest).toEqual(ids)

    // the worker: ingest each upload (in order, so the third is a same-pack duplicate), then review previews
    for (const id of ids) await ingestUpload(id, { enqueueReview: async () => {} })
    let states = await advanceUploads(manager.actor, ids, deps.deps)
    expect(states.map((s) => s.stage)).toEqual(['done', 'done', 'duplicate'])
    const emojiIds = states.slice(0, 2).map((s) => s.emojiId!)
    for (const id of emojiIds) await deriveEmoji({ emojiId: id, target: 'review' })

    states = await advanceUploads(manager.actor, ids, deps.deps)
    expect(states.map((s) => s.stage)).toEqual(['published', 'published', 'duplicate'])
    for (const id of emojiIds) {
      const [e] = await db().select().from(schema.emojis).where(eq(schema.emojis.id, id))
      expect(e!.status).toBe('published')
      expect(e!.derivedReady).toBe(true)
      expect(await exists(derivedKey('p240', pack.packKey, id, 1))).toBe(true)
      expect(await exists(reviewKey('p240', pack.packKey, id))).toBe(false)
    }
    expect(await exists(derivedKey('a160', pack.packKey, emojiIds[0]!, 1))).toBe(true)
    expect(states[0]!.thumb).toBe(`/img/v1/p240/${pack.packKey}/${emojiIds[0]}.r1.webp`)
    const [p] = await db().select().from(schema.packs).where(eq(schema.packs.id, pack.id))
    expect(p!.emojiCount).toBe(2)
    expect(p!.coverEmojiId).toBe(emojiIds[0]!)
    expect(deps.calls.zip).toContain(pack.id)
    expect(await auditRows('upload.sign', pack.id)).toHaveLength(1)
    expect(await auditRows('upload.complete', pack.id)).toHaveLength(1)
    expect(await auditRows('emoji.publish', pack.id)).toHaveLength(1)
  }, 60_000)

  test('rejects wrong types and oversize files before signing; someone else’s uploads are invisible', async () => {
    const pack = await seedPack({ packKey: uniq('upload-bad') })
    const bad = await signUploads(manager.actor, { packId: pack.id, files: [{ name: 'a.zip', size: 10, type: 'application/zip' }] }).catch((e) => e)
    expect(bad.status).toBe(400)
    const big = await signUploads(manager.actor, { packId: pack.id, files: [{ name: 'a.gif', size: 30 * 1024 * 1024, type: 'image/gif' }] }).catch((e) => e)
    expect(big.status).toBe(400)
    const other = await userWithRole('manager', 'upload-other')
    const [s] = await signUploads(other.actor, { packId: pack.id, files: [{ name: 'b.gif', size: 10, type: 'image/gif' }] })
    expect(await advanceUploads(manager.actor, [s!.id], fakeDeps().deps)).toEqual([])
    expect((await completeUploads(manager.actor, [s!.id], fakeDeps().deps)).queued).toBe(0)
  })
})
