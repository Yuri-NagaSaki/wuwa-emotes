import { auditRows, fakeDeps, setupAdminTests, uniq, userWithRole, type RoleUser } from './harness'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { PACK_KEY_RE } from '#/shared/ids'
import { reorderEmojis } from '#/server/admin/emojis'
import { createPack, deletePack, getPackEditor, listPacks, setPacksStatus, updatePack } from '#/server/admin/packs'
import { resolveLegacyPath } from '#/server/catalog/legacy'
import { db, schema } from '#/server/db/client'
import { exists, seedArtist, seedCharacter, seedEmoji, seedPack, seedZip } from './seed'

let owner: RoleUser
let manager: RoleUser

beforeAll(async () => {
  await setupAdminTests()
  owner = await userWithRole('admin', 'packs-owner')
  manager = await userWithRole('manager', 'packs-manager')
}, 60_000)

async function packRow(id: number) {
  const [p] = await db().select().from(schema.packs).where(eq(schema.packs.id, id))
  return p!
}

async function redirectsTo(path: string) {
  return (await db().select().from(schema.redirects).where(eq(schema.redirects.toPath, path))).map((r) => r.fromPath).sort()
}

describe('create and list', () => {
  test('新建: draft pack with a pinyin slug, a valid pack key and an audit row', async () => {
    const { id, slug } = await createPack(manager.actor, { title: '爱弥斯 新年' })
    const p = await packRow(id)
    expect(slug).toBe('aimisi-xinnian')
    expect(p.status).toBe('draft')
    expect(p.ownerId).toBe(manager.id)
    expect(PACK_KEY_RE.test(p.packKey)).toBe(true)
    const again = await createPack(manager.actor, { title: '爱弥斯 新年' })
    expect(again.slug).toBe('aimisi-xinnian-2')
    const rows = await auditRows('pack.create', id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.actorId).toBe(manager.id)
    expect(rows[0]!.actorRole).toBe('manager')
  })

  test('list filters by search, status and source', async () => {
    const key = uniq('listme')
    await seedPack({ packKey: key, title: '列表测试包', status: 'hidden', sourceKind: 'official' })
    const hit = await listPacks({ q: key })
    expect(hit.rows.map((r) => r.packKey)).toEqual([key])
    expect((await listPacks({ q: key, status: 'published' })).rows).toHaveLength(0)
    expect((await listPacks({ q: key, source: 'official' })).rows).toHaveLength(1)
    expect(hit.counts.hidden).toBe(1)
  })
})

describe('edit', () => {
  test('slug change writes a 301, follows earlier redirects, and renaming back does not loop', async () => {
    const pack = await seedPack({ packKey: uniq('slug'), status: 'published' })
    const deps = fakeDeps()
    const a = pack.slug
    const b = `${a}-b`
    const c = `${a}-c`
    await updatePack(owner.actor, { id: pack.id, patch: { slug: b } }, deps.deps)
    expect(await redirectsTo(`/packs/${b}`)).toEqual([`/packs/${a}`])
    expect((await resolveLegacyPath(`/packs/${a}`))?.location).toBe(`/packs/${b}`)
    await updatePack(owner.actor, { id: pack.id, patch: { slug: c } }, deps.deps)
    expect(await redirectsTo(`/packs/${c}`)).toEqual([`/packs/${a}`, `/packs/${b}`])
    await updatePack(owner.actor, { id: pack.id, patch: { slug: a } }, deps.deps)
    expect(await redirectsTo(`/packs/${a}`)).toEqual([`/packs/${b}`, `/packs/${c}`])
    const loop = await db().select().from(schema.redirects).where(eq(schema.redirects.fromPath, `/packs/${a}`))
    expect(loop).toHaveLength(0)
    const audits = await auditRows('pack.update', pack.id)
    expect(audits).toHaveLength(3)
    expect(audits[0]!.diff).toEqual({ slug: [a, b] })
    // the editor lists the old slugs
    expect((await getPackEditor(pack.id)).oldSlugs.sort()).toEqual([b, c].sort())
  })

  test('a slug used by another pack is refused (409)', async () => {
    const one = await seedPack({ packKey: uniq('taken-a') })
    const two = await seedPack({ packKey: uniq('taken-b') })
    const err = await updatePack(owner.actor, { id: two.id, patch: { slug: one.slug } }, fakeDeps().deps).catch((e) => e)
    expect(err.status).toBe(409)
  })

  test('official packs stay preview-only', async () => {
    const pack = await seedPack({ packKey: uniq('official'), sourceKind: 'official' })
    const res = await updatePack(manager.actor, { id: pack.id, patch: { downloadable: true } }, fakeDeps().deps)
    expect((await packRow(pack.id)).downloadable).toBe(false)
    expect(res.notes.join()).toContain('官方')
    const community = await seedPack({ packKey: uniq('community'), downloadable: true })
    await updatePack(manager.actor, { id: community.id, patch: { sourceKind: 'official' } }, fakeDeps().deps)
    const after = await packRow(community.id)
    expect(after.sourceKind).toBe('official')
    expect(after.downloadable).toBe(false)
  })

  test('a stale form is refused (409)', async () => {
    const pack = await seedPack({ packKey: uniq('stale') })
    const err = await updatePack(owner.actor, { id: pack.id, expectedUpdatedAt: '2020-01-01T00:00:00.000Z', patch: { title: '新标题' } }, fakeDeps().deps).catch((e) => e)
    expect(err.status).toBe(409)
    const ok = await updatePack(owner.actor, { id: pack.id, expectedUpdatedAt: pack.updatedAt.toISOString(), patch: { title: '新标题' } }, fakeDeps().deps)
    expect(ok.changed).toEqual(['title'])
  })

  test('relations are replaced, counters refreshed, and a credits change marks the ZIP stale', async () => {
    const pack = await seedPack({ packKey: uniq('rel'), downloadable: true })
    await seedEmoji(pack)
    await seedZip(pack)
    const ch = await seedCharacter('测试角色甲')
    const ar = await seedArtist('测试画师甲')
    const co = await seedArtist('测试约稿人')
    const deps = fakeDeps()
    await updatePack(manager.actor, { id: pack.id, patch: { characterIds: [ch.id], artistIds: [ar.id], commissionerIds: [co.id] } }, deps.deps)
    const ed = await getPackEditor(pack.id)
    expect(ed.pack.characterIds).toEqual([ch.id])
    expect(ed.pack.artistIds).toEqual([ar.id])
    expect(ed.pack.commissionerIds).toEqual([co.id])
    const [c] = await db().select().from(schema.characters).where(eq(schema.characters.id, ch.id))
    expect(c!.packCount).toBe(1)
    expect(ed.zip.stale).toBe(true)
    expect(deps.calls.zip).toEqual([pack.id])
  })

  test('cover must be a published emoji of the pack', async () => {
    const pack = await seedPack({ packKey: uniq('cover') })
    const other = await seedPack({ packKey: uniq('cover-other') })
    const own = await seedEmoji(pack)
    const foreign = await seedEmoji(other)
    const err = await updatePack(owner.actor, { id: pack.id, patch: { coverEmojiId: foreign.id } }, fakeDeps().deps).catch((e) => e)
    expect(err.status).toBe(400)
    await updatePack(owner.actor, { id: pack.id, patch: { coverEmojiId: own.id } }, fakeDeps().deps)
    expect((await packRow(pack.id)).coverEmojiId).toBe(own.id)
  })

  test('reorder sets sort_order in the given order; a stale list is refused', async () => {
    const pack = await seedPack({ packKey: uniq('order') })
    const a = await seedEmoji(pack, { sortOrder: 0 })
    const b = await seedEmoji(pack, { sortOrder: 1 })
    const c = await seedEmoji(pack, { sortOrder: 2 })
    await reorderEmojis(manager.actor, { packId: pack.id, emojiIds: [c.id, a.id, b.id] }, fakeDeps().deps)
    const ed = await getPackEditor(pack.id)
    expect(ed.emojis.map((e) => e.id)).toEqual([c.id, a.id, b.id])
    const err = await reorderEmojis(manager.actor, { packId: pack.id, emojiIds: [c.id, a.id] }, fakeDeps().deps).catch((e) => e)
    expect(err.status).toBe(409)
    expect(await auditRows('pack.reorder', pack.id)).toHaveLength(1)
  })
})

describe('status and delete', () => {
  test('bulk publish / hide: one audit row per changed pack, published_at set once', async () => {
    const a = await seedPack({ packKey: uniq('bulk-a'), status: 'draft' })
    const b = await seedPack({ packKey: uniq('bulk-b'), status: 'published', publishedAt: new Date('2026-01-01T00:00:00Z') })
    const res = await setPacksStatus(manager.actor, { ids: [a.id, b.id], status: 'published' }, fakeDeps().deps)
    expect(res.changed).toBe(1)
    expect((await packRow(a.id)).publishedAt).not.toBeNull()
    expect(await auditRows('pack.status', a.id)).toHaveLength(1)
    expect(await auditRows('pack.status', b.id)).toHaveLength(0)
    await setPacksStatus(manager.actor, { ids: [a.id, b.id], status: 'hidden' }, fakeDeps().deps)
    expect((await packRow(b.id)).status).toBe('hidden')
  })

  test('delete is a soft hide by default (管理员 allowed)', async () => {
    const pack = await seedPack({ packKey: uniq('soft') })
    const res = await deletePack(manager.actor, { id: pack.id, hard: false }, fakeDeps().deps)
    expect(res.mode).toBe('hidden')
    expect((await packRow(pack.id)).status).toBe('hidden')
    expect(await auditRows('pack.hide', pack.id)).toHaveLength(1)
  })

  test('hard delete: 管理员 403; 站长 removes every file of the pack and purges, leaving other packs alone', async () => {
    const pack = await seedPack({ packKey: uniq('hard') })
    const other = await seedPack({ packKey: uniq('hard-other') })
    const e1 = await seedEmoji(pack, { objects: true, variantRev: 2 })
    const e2 = await seedEmoji(pack, { objects: true, status: 'pending' })
    // an emoji that moved to another pack keeps its storage key under this pack's prefix
    const moved = await seedEmoji(other, { objects: true, storagePackKey: pack.packKey })
    const zip = await seedZip(pack)
    const denied = await deletePack(manager.actor, { id: pack.id, hard: true }, fakeDeps().deps).catch((e) => e)
    expect(denied.status).toBe(403)
    expect(await exists(e1.originalKey)).toBe(true)

    const deps = fakeDeps()
    const res = await deletePack(owner.actor, { id: pack.id, hard: true }, deps.deps)
    expect(res.mode).toBe('deleted')
    expect(await exists(e1.originalKey)).toBe(false)
    expect(await exists(e2.originalKey)).toBe(false)
    expect(await exists(zip)).toBe(false)
    expect(await exists(moved.originalKey)).toBe(true)
    expect(await db().select().from(schema.packs).where(eq(schema.packs.id, pack.id))).toHaveLength(0)
    const urls = deps.calls.purge.flat()
    // e1: 3 variants × 2 revisions; e2 (pending): its rev 1 URLs are purged as well, harmlessly
    expect(urls.filter((u) => u.includes(e1.id))).toHaveLength(6)
    expect(urls.every((u) => u.startsWith('http://localhost:3101/img/v1/'))).toBe(true)
    expect(await auditRows('pack.delete', pack.id)).toHaveLength(1)
    const purgeAudit = await auditRows('pack.delete.purge', pack.id)
    expect((purgeAudit[0]!.diff as { purged: number }).purged).toBe(urls.length)
  })
})
