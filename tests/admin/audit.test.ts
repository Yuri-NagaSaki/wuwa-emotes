import { auditRows, fakeDeps, setupAdminTests, uniq, userWithRole, type RoleUser } from './harness'
import { beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { publishPendingEmojis, setEmojisStatus } from '#/server/admin/emojis'
import { rebuildPackZip } from '#/server/admin/packs'
import { deleteTaxonomy, mergeTaxonomy, saveArtist, saveTag } from '#/server/admin/taxonomy'
import { db, schema } from '#/server/db/client'
import { seedArtist, seedEmoji, seedPack } from './seed'

// Every admin write leaves an audit row with the actor and their role at the time. The other files
// assert most actions next to their behaviour; this table covers the remaining writes, and the rule
// that 发布 in the pack editor never bypasses 投稿审核.

let manager: RoleUser

beforeAll(async () => {
  await setupAdminTests()
  manager = await userWithRole('manager', 'audit-manager')
}, 60_000)

type Case = [name: string, run: () => Promise<{ action: string; target: string | number }>]

const CASES: Case[] = [
  [
    'rebuild ZIP',
    async () => {
      const p = await seedPack({ packKey: uniq('audit-zip'), downloadable: true })
      await seedEmoji(p)
      await rebuildPackZip(manager.actor, p.id, fakeDeps().deps)
      return { action: 'pack.zip.rebuild', target: p.id }
    },
  ],
  [
    'un-hide emojis',
    async () => {
      const p = await seedPack({ packKey: uniq('audit-unhide') })
      const e = await seedEmoji(p, { status: 'hidden' })
      await setEmojisStatus(manager.actor, { ids: [e.id], status: 'published' }, fakeDeps().deps)
      return { action: 'emoji.unhide', target: p.id }
    },
  ],
  [
    'create artist',
    async () => {
      const r = await saveArtist(manager.actor, { name: uniq('审计画师') })
      return { action: 'artist.create', target: r.id }
    },
  ],
  [
    'update artist',
    async () => {
      const a = await seedArtist(uniq('审计画师乙'))
      await saveArtist(manager.actor, { id: a.id, name: `${a.name}改`, links: [{ label: 'B 站', url: 'https://example.test/x' }] })
      return { action: 'artist.update', target: a.id }
    },
  ],
  [
    'delete artist',
    async () => {
      const a = await seedArtist(uniq('审计画师丙'))
      await deleteTaxonomy(manager.actor, { kind: 'artist', id: a.id })
      return { action: 'artist.delete', target: a.id }
    },
  ],
  [
    'merge artists',
    async () => {
      const a = await seedArtist(uniq('审计合并甲'))
      const b = await seedArtist(uniq('审计合并乙'))
      await mergeTaxonomy(manager.actor, { kind: 'artist', fromId: a.id, toId: b.id, keepName: true })
      return { action: 'artist.merge', target: b.id }
    },
  ],
  [
    'update tag',
    async () => {
      const t = await saveTag(manager.actor, { dimension: 'custom', name: uniq('审计标签'), slug: uniq('audit-tag') })
      await saveTag(manager.actor, { id: t.id, dimension: 'group', name: '改名后的标签', slug: t.slug })
      return { action: 'tag.update', target: t.id }
    },
  ],
  [
    'delete tag',
    async () => {
      const t = await saveTag(manager.actor, { dimension: 'custom', name: uniq('审计标签乙'), slug: uniq('audit-tag-b') })
      await deleteTaxonomy(manager.actor, { kind: 'tag', id: t.id })
      return { action: 'tag.delete', target: t.id }
    },
  ],
]

describe('audit rows for the remaining writes', () => {
  for (const [name, run] of CASES) {
    test(name, async () => {
      const { action, target } = await run()
      const rows = await auditRows(action, target)
      expect(rows.length).toBe(1)
      expect(rows[0]!.actorId).toBe(manager.id)
      expect(rows[0]!.actorRole).toBe('manager')
      expect(rows[0]!.impersonatedBy).toBeNull()
    })
  }
})

describe('publishing pending emojis', () => {
  test('emojis from a user submission are refused; staff uploads are published', async () => {
    const pack = await seedPack({ packKey: uniq('audit-sub'), status: 'draft' })
    const submitter = await userWithRole('user', 'audit-submitter')
    const [sub] = await db()
      .insert(schema.submissions)
      .values({ kind: 'new_pack', packId: pack.id, submitterId: submitter.id, status: 'pending' })
      .returning()
    const fromSubmission = await seedEmoji(pack, { status: 'pending', objects: true })
    await db().insert(schema.uploadItems).values({
      submissionId: sub!.id,
      packId: pack.id,
      uploaderId: submitter.id,
      tmpKey: `uploads/tmp/test/${uniq('sub')}`,
      filename: 'a.gif',
      bytes: 10,
      mime: 'image/gif',
      status: 'done',
      emojiId: fromSubmission.id,
    })
    // listed in an open submission's payload without an upload row (e.g. moved in by the submitter)
    const listed = await seedEmoji(pack, { status: 'pending', objects: true })
    await db().insert(schema.submissions).values({ kind: 'add_emojis', packId: pack.id, submitterId: submitter.id, status: 'pending', payload: { addEmojiIds: [listed.id] } })
    const staff = await seedEmoji(pack, { status: 'pending', objects: true })

    const out = await publishPendingEmojis(manager.actor, [fromSubmission.id, listed.id, staff.id], fakeDeps().deps)

    expect(out.published).toEqual([staff.id])
    expect(out.failed.map((f) => f.id).sort()).toEqual([fromSubmission.id, listed.id].sort())
    const [still] = await db().select().from(schema.emojis).where(eq(schema.emojis.id, fromSubmission.id))
    expect(still!.status).toBe('pending')
    const rows = await auditRows('emoji.publish', pack.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.diff).toEqual({ emojis: [staff.id] })
  })
})
