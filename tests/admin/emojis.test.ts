import { auditRows, fakeDeps, setupAdminTests, uniq, userWithRole, type RoleUser } from './harness'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { deleteEmojis, getEmojiDetail, listEmojis, moveEmojis, regenerateEmojis, setEmojisStatus } from '#/server/admin/emojis'
import { db, schema } from '#/server/db/client'
import { derivedKey, reviewKey } from '#/server/media/keys'
import { exists, seedEmoji, seedPack, seedZip } from './seed'

let manager: RoleUser

beforeAll(async () => {
  await setupAdminTests()
  manager = await userWithRole('manager', 'emoji-manager')
}, 60_000)

async function emojiRow(id: string) {
  const [e] = await db().select().from(schema.emojis).where(eq(schema.emojis.id, id))
  return e
}

async function packRow(id: number) {
  const [p] = await db().select().from(schema.packs).where(eq(schema.packs.id, id))
  return p!
}

describe('takedown (删除表情, docs/ARCHITECTURE.md §6.3)', () => {
  test('deletes the original, every derived revision and preview, the ZIP, the row; purges /img URLs; audits', async () => {
    const pack = await seedPack({ packKey: uniq('takedown'), downloadable: true })
    const gone = await seedEmoji(pack, { objects: true, variantRev: 3, sortOrder: 0 })
    const keep = await seedEmoji(pack, { objects: true, sortOrder: 1 })
    await db().update(schema.packs).set({ coverEmojiId: gone.id, emojiCount: 2 }).where(eq(schema.packs.id, pack.id))
    const zip = await seedZip(pack)
    const deps = fakeDeps()

    const res = await deleteEmojis(manager.actor, [gone.id], deps.deps)

    expect(res.deleted).toBe(1)
    expect(await exists(gone.originalKey)).toBe(false)
    for (let rev = 1; rev <= 3; rev++) {
      for (const v of ['p240', 'a160', 'full'] as const) expect(await exists(derivedKey(v, pack.packKey, gone.id, rev))).toBe(false)
    }
    expect(await exists(keep.originalKey)).toBe(true)
    expect(await exists(derivedKey('p240', pack.packKey, keep.id, 1))).toBe(true)
    expect(await emojiRow(gone.id)).toBeUndefined()

    // the old ZIP contains the image: deleted now, rebuild queued
    expect(await exists(zip)).toBe(false)
    expect(await db().select().from(schema.zipArtifacts).where(eq(schema.zipArtifacts.packId, pack.id))).toHaveLength(0)
    expect(deps.calls.zip).toEqual([pack.id])

    // cover and counters follow
    const p = await packRow(pack.id)
    expect(p.coverEmojiId).toBe(keep.id)
    expect(p.emojiCount).toBe(1)

    // CDN purge of every variant of every revision, as absolute URLs
    const urls = deps.calls.purge.flat()
    expect(urls).toHaveLength(9)
    expect(urls).toContain(`http://localhost:3101/img/v1/p240/${pack.packKey}/${gone.id}.r1.webp`)
    expect(urls).toContain(`http://localhost:3101/img/v1/full/${pack.packKey}/${gone.id}.r3.webp`)

    const [a] = await auditRows('emoji.delete', pack.id)
    expect(a!.actorId).toBe(manager.id)
    expect(a!.diff).toMatchObject({ emojis: [gone.id], purge: { urls: 9, purged: 9, skipped: false, error: null } })
  })

  test('pending emojis lose their review previews too', async () => {
    const pack = await seedPack({ packKey: uniq('takedown-pending'), status: 'draft' })
    const e = await seedEmoji(pack, { objects: true, status: 'pending' })
    expect(await exists(reviewKey('p240', pack.packKey, e.id))).toBe(true)
    await deleteEmojis(manager.actor, [e.id], fakeDeps().deps)
    expect(await exists(reviewKey('p240', pack.packKey, e.id))).toBe(false)
    expect(await exists(reviewKey('a160', pack.packKey, e.id))).toBe(false)
  })

  test('a failing purge is reported and audited; the files are still gone', async () => {
    const pack = await seedPack({ packKey: uniq('purge-fail') })
    const e = await seedEmoji(pack, { objects: true })
    const deps = fakeDeps({
      purge: async () => {
        throw new Error('Cloudflare purge failed (HTTP 500)')
      },
    })
    const res = await deleteEmojis(manager.actor, [e.id], deps.deps)
    expect(res.purgeError).toContain('HTTP 500')
    expect(await exists(e.originalKey)).toBe(false)
    const [a] = await auditRows('emoji.delete', pack.id)
    expect((a!.diff as { purge: { error: string } }).purge.error).toContain('HTTP 500')
  })
})

describe('hide, regenerate, move', () => {
  test('hide keeps the files, moves the cover, recounts; un-hide publishes again', async () => {
    const pack = await seedPack({ packKey: uniq('hide') })
    const a = await seedEmoji(pack, { objects: true, sortOrder: 0 })
    const b = await seedEmoji(pack, { sortOrder: 1 })
    await db().update(schema.packs).set({ coverEmojiId: a.id }).where(eq(schema.packs.id, pack.id))
    const deps = fakeDeps()
    await setEmojisStatus(manager.actor, { ids: [a.id], status: 'hidden' }, deps.deps)
    expect((await emojiRow(a.id))!.status).toBe('hidden')
    expect(await exists(a.originalKey)).toBe(true)
    expect((await packRow(pack.id)).coverEmojiId).toBe(b.id)
    expect((await packRow(pack.id)).emojiCount).toBe(1)
    expect(await auditRows('emoji.hide', pack.id)).toHaveLength(1)
    await setEmojisStatus(manager.actor, { ids: [a.id], status: 'published' }, deps.deps)
    expect((await emojiRow(a.id))!.status).toBe('published')
    expect((await packRow(pack.id)).emojiCount).toBe(2)
  })

  test('regenerate bumps variant_rev and queues derive; pending skipped; a dropped job rolls back', async () => {
    const pack = await seedPack({ packKey: uniq('regen') })
    const pub = await seedEmoji(pack, { variantRev: 2, fullReady: true })
    const pend = await seedEmoji(pack, { status: 'pending' })
    const deps = fakeDeps()
    const res = await regenerateEmojis(manager.actor, { packId: pack.id }, deps.deps)
    expect(res.queued).toEqual([pub.id])
    expect(res.skipped.map((s) => s.id)).toEqual([pend.id])
    const after = (await emojiRow(pub.id))!
    expect(after.variantRev).toBe(3)
    expect(after.derivedReady).toBe(false)
    expect(after.fullReady).toBe(false)
    expect(deps.calls.derive).toEqual([{ id: pub.id, target: 'derived' }])
    expect(await auditRows('emoji.regenerate', pack.id)).toHaveLength(1)

    const busy = fakeDeps({ enqueueDerive: async () => false })
    const res2 = await regenerateEmojis(manager.actor, { ids: [pub.id] }, busy.deps)
    expect(res2.queued).toEqual([])
    expect((await emojiRow(pub.id))!.variantRev).toBe(3)
  })

  test('move keeps storage_pack_key, recounts both packs, skips same-pack duplicates', async () => {
    const from = await seedPack({ packKey: uniq('move-from') })
    const to = await seedPack({ packKey: uniq('move-to') })
    const a = await seedEmoji(from)
    const dupSha = 'f'.repeat(64)
    const b = await seedEmoji(from, { sha256: dupSha })
    await seedEmoji(to, { sha256: dupSha })
    const res = await moveEmojis(manager.actor, { ids: [a.id, b.id], toPackId: to.id }, fakeDeps().deps)
    expect(res.moved).toBe(1)
    expect(res.duplicates).toEqual([b.id])
    const moved = (await emojiRow(a.id))!
    expect(moved.packId).toBe(to.id)
    expect(moved.storagePackKey).toBe(from.packKey)
    expect((await packRow(from.id)).emojiCount).toBe(1)
    expect((await packRow(to.id)).emojiCount).toBe(2)
    expect(await auditRows('emoji.move', from.id)).toHaveLength(1)
  })

  test('library list and detail: keys, duplicates across packs', async () => {
    const p1 = await seedPack({ packKey: uniq('lib-a') })
    const p2 = await seedPack({ packKey: uniq('lib-b') })
    const sha = 'e'.repeat(64)
    const a = await seedEmoji(p1, { sha256: sha, variantRev: 2 })
    const b = await seedEmoji(p2, { sha256: sha })
    const list = await listEmojis({ packId: p1.id })
    expect(list.rows.map((r) => r.id)).toEqual([a.id])
    expect(list.rows[0]!.thumb).toBe(`/img/v1/p240/${p1.packKey}/${a.id}.r2.webp`)
    const d = await getEmojiDetail(a.id)
    expect(d.keys.map((k) => k.key)).toContain(derivedKey('p240', p1.packKey, a.id, 2))
    expect(d.duplicates.map((x) => x.emojiId)).toEqual([b.id])
    const bySha = await listEmojis({ q: sha })
    expect(bySha.rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort())
    await db().delete(schema.emojis).where(inArray(schema.emojis.id, [a.id, b.id]))
  })
})
