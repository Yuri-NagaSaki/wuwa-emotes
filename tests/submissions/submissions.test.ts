import { auditRows, deps, makeGif, makePng, person, rejects, sent, setSubmitMode, setup, sqlRows, upload, type Person } from './helpers'
import { beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { listNotifications } from '#/server/account/notifications'
import { db, schema } from '#/server/db/client'
import { toggleFavorite } from '#/server/favorites/service'
import { canViewReviewImage, lookupReviewEmoji } from '#/server/http/review-img'
import { derivedKey, originalKey, reviewKey } from '#/server/media/keys'
import { headObject, listKeys } from '#/server/media/s3'
import { cleanupSubmissions } from '#/server/submissions/cleanup'
import { CONFLICT_MESSAGE, UPLOAD_LIMITS, canTransition, TRANSITIONS } from '#/server/submissions/rules'
import {
  approveSubmission,
  completeUploads,
  createSubmission,
  getSubmission,
  listMySubmissions,
  listReviewQueue,
  listUploads,
  presignUploads,
  removeUpload,
  reorderEmojis,
  returnSubmission,
  submitSubmission,
  updateSubmission,
  withdrawSubmission,
} from '#/server/submissions/service'
import { PACK_KEY_RE } from '#/shared/ids'

// Submissions end to end against PostgreSQL + RustFS: the §5.2 state machine, ownership and
// permissions, direct uploads (real presigned PUTs), media.ingest + review previews (sharp, inline),
// approval publishing derivatives, base-version conflicts, cleanup and the review-img uploader rule.

let owner: Person
let other: Person
let manager: Person
let gifA: Uint8Array
let gifB: Uint8Array
let pngA: Uint8Array
let charId = 0
let artistId = 0

const declaration = {
  identity: 'artist' as const,
  license: 'cc-by-nc-sa-4.0',
  proofUrl: 'https://example.com/proof',
  note: '我画的，同意在本站公开下载。',
  downloadable: true,
}

beforeAll(async () => {
  await setup()
  owner = await person('owner')
  other = await person('other')
  manager = await person('manager', 'manager')
  gifA = await makeGif(96, 96, 4, 101)
  gifB = await makeGif(80, 64, 3, 102)
  pngA = await makePng(72, 72, 103)
  const [c] = await db().insert(schema.characters).values({ slug: 'aimisi', name: '爱弥斯', themeColor: 'var(--c-pink)' }).returning()
  const [a] = await db().insert(schema.artists).values({ slug: 'wuxue', name: '雾雪' }).returning()
  charId = c!.id
  artistId = a!.id
}, 120_000)

describe('state machine table', () => {
  test('is exactly docs/ARCHITECTURE.md §5.2', () => {
    expect(TRANSITIONS).toEqual({
      draft: ['pending', 'withdrawn'],
      pending: ['approved', 'returned', 'withdrawn'],
      returned: ['pending'],
      approved: [],
      withdrawn: [],
    })
    expect(canTransition('returned', 'withdrawn')).toBe(false)
    expect(canTransition('approved', 'pending')).toBe(false)
  })
})

describe('new pack: draft → upload → submit → approve', () => {
  let subId = ''
  let packId = 0
  let packKey = ''

  test('create: a draft pack owned by the submitter, with a server-generated pack key', async () => {
    const r = await createSubmission(owner.actor, { kind: 'new_pack', payload: { title: '爱弥斯 · 新年板牌' }, declaration })
    subId = r.id
    packId = r.packId
    const [pack] = await db().select().from(schema.packs).where(eq(schema.packs.id, packId))
    expect(pack).toMatchObject({ status: 'draft', ownerId: owner.id, downloadable: false })
    packKey = pack!.packKey
    expect(packKey).toMatch(PACK_KEY_RE)
    expect(packKey).toStartWith('aimisi-xinnianbanpai-')
    expect((await auditRows(subId)).map((a) => a.action)).toContain('submission.create')
  })

  test('only the submitter edits: strangers get 404, reviewers 403', async () => {
    await rejects(updateSubmission(other.actor, subId, { payload: { title: 'x' } }), 404)
    await rejects(updateSubmission(manager.actor, subId, { payload: { title: 'x' } }), 403)
    await rejects(getSubmission(other.actor, subId), 404)
    const r = await updateSubmission(owner.actor, subId, {
      payload: { excerpt: '新年限定板牌', characterIds: [charId, 999_999], artistIds: [artistId], artistNames: ['新画师', '新画师', ' '] },
    })
    expect(r.payload.characterIds).toEqual([charId])
    expect(r.payload.artistNames).toEqual(['新画师'])
    expect(r.payload.title).toBe('爱弥斯 · 新年板牌')
    // reviewers may read it
    expect((await getSubmission(manager.actor, subId)).mine).toBe(false)
  })

  test('presign: ownership, MIME allowlist, size limit', async () => {
    const file = { name: 'a.gif', size: 1000, type: 'image/gif' }
    await rejects(presignUploads(other.actor, subId, [file], deps), 404)
    await rejects(presignUploads(owner.actor, subId, [{ ...file, type: 'image/svg+xml' }], deps), 400, '不是支持的格式')
    await rejects(presignUploads(owner.actor, subId, [{ ...file, size: UPLOAD_LIMITS.maxBytes + 1 }], deps), 400, '20 MB')
    await rejects(presignUploads(owner.actor, subId, [{ ...file, size: 0 }], deps), 400, '空文件')
  })

  test('presigned PUT → ingest → pending emojis with review previews', async () => {
    const { signed, outcomes } = await upload(owner.actor, subId, [
      { name: 'dance.gif', body: gifA, type: 'image/gif' },
      { name: 'smile.png', body: pngA, type: 'image/png' },
    ])
    expect(signed.every((s) => s.url.includes('uploads/tmp/'))).toBe(true)
    expect(outcomes.map((o) => o.status)).toEqual(['done', 'done'])
    const uploads = await listUploads(owner.actor, subId)
    expect(uploads.map((u) => u.status)).toEqual(['done', 'done'])
    for (const u of uploads) {
      expect(u.emoji?.poster).toBe(`/review-img/v1/p240/${packKey}/${u.emoji!.id}.webp`)
      expect(await headObject(reviewKey('p240', packKey, u.emoji!.id))).not.toBeNull()
    }
    expect(uploads[0]!.emoji!.preview).toBe(`/review-img/v1/a160/${packKey}/${uploads[0]!.emoji!.id}.webp`)
    // nothing went to the CDN prefix while pending
    expect(await listKeys(`derived/v1/p240/${packKey}/`)).toEqual([])
  })

  test('same-pack duplicates are skipped; reorder and cover live in the payload', async () => {
    const { outcomes } = await upload(owner.actor, subId, [{ name: 'again.gif', body: gifA, type: 'image/gif' }])
    expect(outcomes[0]!.status).toBe('duplicate')
    const detail = await getSubmission(owner.actor, subId)
    expect(detail.emojis.length).toBe(2)
    const [first, second] = detail.emojis.map((e) => e.id)
    expect(await reorderEmojis(owner.actor, subId, [second!, 'r-00000000000000000000'])).toEqual([second!, first!])
    await updateSubmission(owner.actor, subId, { payload: { coverEmojiId: first! } })
    const again = await getSubmission(owner.actor, subId)
    expect(again.emojis.map((e) => e.id)).toEqual([second!, first!])
    expect(again.payload.coverEmojiId).toBe(first!)
    // a cover that is not this submission's emoji is dropped
    await updateSubmission(owner.actor, subId, { payload: { coverEmojiId: 'r-11111111111111111111' } })
    expect((await getSubmission(owner.actor, subId)).payload.coverEmojiId).toBeNull()
    await updateSubmission(owner.actor, subId, { payload: { coverEmojiId: first! } })
  })

  test('submit is refused while an upload is unfinished', async () => {
    const [s] = await presignUploads(owner.actor, subId, [{ name: 'late.png', size: 10, type: 'image/png' }], deps)
    await rejects(submitSubmission(owner.actor, subId, deps), 400, '正在上传或处理')
    await removeUpload(owner.actor, subId, s!.id)
  })

  test('submit: draft → pending; edits are locked while pending', async () => {
    await rejects(submitSubmission(other.actor, subId, deps), 404)
    expect(await submitSubmission(owner.actor, subId, deps)).toEqual({ status: 'pending' })
    await rejects(updateSubmission(owner.actor, subId, { payload: { title: 'late' } }), 409)
    await rejects(presignUploads(owner.actor, subId, [{ name: 'x.png', size: 10, type: 'image/png' }], deps), 409)
    await rejects(submitSubmission(owner.actor, subId, deps), 409)
    const mine = await listMySubmissions(owner.actor)
    expect(mine.find((m) => m.id === subId)).toMatchObject({ status: 'pending', emojiCount: 2, title: '爱弥斯 · 新年板牌' })
  })

  test('users cannot review: queue, approve and return answer 403', async () => {
    await rejects(listReviewQueue(owner.actor, 'pending'), 403)
    await rejects(approveSubmission(owner.actor, subId, { downloadable: true }, deps), 403)
    await rejects(returnSubmission(other.actor, subId, '不行'), 403)
  })

  test('the review queue shows the card with its checks', async () => {
    const q = await listReviewQueue(manager.actor, 'pending')
    expect(q.counts.pending).toBeGreaterThanOrEqual(1)
    const card = q.items.find((i) => i.id === subId)!
    expect(card).toMatchObject({ kind: 'new_pack', title: '爱弥斯 · 新年板牌', emojiCount: 2, duplicatesSkipped: 1, official: false })
    expect(card.submitter.name).toBe('owner')
    expect(card.characters).toEqual(['爱弥斯'])
    expect(card.artists).toEqual(['雾雪', '新画师'])
    expect(card.images.every((i) => i.poster?.startsWith('/review-img/'))).toBe(true)
    expect(card.checks.find((c) => c.label.includes('本包内重复'))?.ok).toBe(false)
    expect(card.checks.find((c) => c.label.includes('授权凭证'))?.ok).toBe(true)
  })

  test('approve: one transaction publishes the pack, then derivatives and the ZIP', async () => {
    const before = sent.zip.length
    const r = await approveSubmission(manager.actor, subId, { downloadable: true }, deps)
    expect(r.derivatives).toEqual({ ok: 2, failed: 0 })
    expect(r.slug).toBe('aimisi-xinnianbanpai')
    const [pack] = await db().select().from(schema.packs).where(eq(schema.packs.id, packId))
    expect(pack).toMatchObject({ status: 'published', title: '爱弥斯 · 新年板牌', excerpt: '新年限定板牌', downloadable: true, emojiCount: 2, kind: 'mixed', license: 'cc-by-nc-sa-4.0', sourceKind: 'community' })
    expect(pack!.publishedAt).toBeInstanceOf(Date)
    const emojis = await db().select().from(schema.emojis).where(eq(schema.emojis.packId, packId)).orderBy(schema.emojis.sortOrder)
    expect(emojis.map((e) => e.status)).toEqual(['published', 'published'])
    expect(pack!.coverEmojiId).toBe(emojis[1]!.id) // the chosen cover, which is second in the new order
    for (const e of emojis) {
      expect(e.derivedReady).toBe(true)
      expect(await headObject(derivedKey('p240', packKey, e.id, 1))).not.toBeNull()
      expect(await headObject(reviewKey('p240', packKey, e.id))).toBeNull()
      expect(await headObject(originalKey(packKey, e.id, e.format === 'jpeg' ? 'jpg' : e.format))).not.toBeNull()
    }
    expect(await headObject(derivedKey('a160', packKey, emojis.find((e) => e.frames > 1)!.id, 1))).not.toBeNull()
    expect(sent.zip.slice(before)).toEqual([packId])
    // taxonomy: links and counters
    const links = await db().select().from(schema.packArtists).where(eq(schema.packArtists.packId, packId))
    expect(links.length).toBe(2)
    const [c] = await db().select().from(schema.characters).where(eq(schema.characters.id, charId))
    expect(c!.packCount).toBe(1)
    const [created] = await db().select().from(schema.artists).where(eq(schema.artists.name, '新画师'))
    expect(created).toMatchObject({ packCount: 1 })
    // submission, notice, audit
    const [sub] = await db().select().from(schema.submissions).where(eq(schema.submissions.id, subId))
    expect(sub).toMatchObject({ status: 'approved', reviewerId: manager.id })
    const notes = await listNotifications(owner.id)
    expect(notes.items[0]).toMatchObject({ kind: 'submission.approved', read: false, payload: { submissionId: subId, slug: 'aimisi-xinnianbanpai' } })
    const approve = (await auditRows(subId)).find((a) => a.action === 'submission.approve')!
    expect(approve).toMatchObject({ actorId: manager.id, actorRole: 'manager', impersonatedBy: null })
    expect(approve.diff).toMatchObject({ kind: 'new_pack', published: 2, downloadable: true, auto: false })
    // a decided submission cannot be decided again
    await rejects(approveSubmission(manager.actor, subId, { downloadable: true }, deps), 409)
    await rejects(withdrawSubmission(owner.actor, subId), 409)
    // the review-img route no longer serves it to the submitter
    expect(canViewReviewImage(owner.actor, packKey, await lookupReviewEmoji(emojis[0]!.id))).toBe(false)
  })

  describe('补充表情 to the published pack', () => {
    let addId = ''
    let addEmoji = ''

    test('anyone may propose; the live pack is untouched until approval', async () => {
      addId = (await createSubmission(other.actor, { kind: 'add_emojis', packSlug: 'aimisi-xinnianbanpai', declaration })).id
      const { outcomes } = await upload(other.actor, addId, [{ name: 'more.gif', body: gifB, type: 'image/gif' }])
      addEmoji = (outcomes[0] as { emojiId: string }).emojiId
      const [pack] = await db().select().from(schema.packs).where(eq(schema.packs.id, packId))
      expect(pack!.emojiCount).toBe(2)
      const [e] = await db().select().from(schema.emojis).where(eq(schema.emojis.id, addEmoji))
      expect(e).toMatchObject({ status: 'pending', packId })
    })

    test('review-img: the uploader (not the pack owner) can see the pending preview', async () => {
      const row = await lookupReviewEmoji(addEmoji)
      expect(row).toMatchObject({ ownerId: owner.id, uploaderId: other.id, status: 'pending' })
      expect(canViewReviewImage(other.actor, packKey, row)).toBe(true)
      expect(canViewReviewImage(owner.actor, packKey, row)).toBe(true)
      const stranger = await person('stranger')
      expect(canViewReviewImage(stranger.actor, packKey, row)).toBe(false)
      expect(canViewReviewImage(manager.actor, packKey, row)).toBe(true)
    })

    test('review-img: a duplicate upload row does not grant access to the emoji it matched', async () => {
      const sneaky = await person('sneaky')
      const dupSub = (await createSubmission(sneaky.actor, { kind: 'add_emojis', packSlug: 'aimisi-xinnianbanpai', declaration })).id
      // the same bytes as `addEmoji`: ingest records a duplicate row pointing at that emoji
      const { outcomes } = await upload(sneaky.actor, dupSub, [{ name: 'same.gif', body: gifB, type: 'image/gif' }])
      expect(outcomes[0]).toEqual({ status: 'duplicate', emojiId: addEmoji })
      const row = await lookupReviewEmoji(addEmoji)
      expect(row!.uploaderId).toBe(other.id)
      expect(canViewReviewImage(sneaky.actor, packKey, row)).toBe(false)
      expect((await listUploads(sneaky.actor, dupSub))[0]).toMatchObject({ status: 'duplicate', emoji: null })
      await withdrawSubmission(sneaky.actor, dupSub)
    })

    test('favorites on the pack do not count as an edit (no conflict)', async () => {
      await toggleFavorite(manager.id, { type: 'pack', id: String(packId) })
      await submitSubmission(other.actor, addId, deps)
      const q = await listReviewQueue(manager.actor, 'pending')
      expect(q.items.find((i) => i.id === addId)?.conflict).toBe(false)
    })

    test('a pack edited after the base version cannot be approved; return → revise → resubmit recaptures it', async () => {
      await db().update(schema.packs).set({ excerpt: '站长改过简介' }).where(eq(schema.packs.id, packId))
      await rejects(approveSubmission(manager.actor, addId, { downloadable: true }, deps), 409, CONFLICT_MESSAGE)
      // nothing was applied
      const [e] = await db().select().from(schema.emojis).where(eq(schema.emojis.id, addEmoji))
      expect(e!.status).toBe('pending')
      await rejects(returnSubmission(manager.actor, addId, '   '), 400)
      await returnSubmission(manager.actor, addId, CONFLICT_MESSAGE)
      const notes = await listNotifications(other.id)
      expect(notes.items[0]).toMatchObject({ kind: 'submission.returned', payload: { reason: CONFLICT_MESSAGE } })
      // §5.2: 已退回 cannot be withdrawn
      await rejects(withdrawSubmission(other.actor, addId), 409)
      expect(await submitSubmission(other.actor, addId, deps)).toEqual({ status: 'pending' })
      const r = await approveSubmission(manager.actor, addId, { downloadable: true }, deps)
      expect(r.published).toEqual([addEmoji])
      const [pack] = await db().select().from(schema.packs).where(eq(schema.packs.id, packId))
      expect(pack).toMatchObject({ emojiCount: 3, excerpt: '站长改过简介', title: '爱弥斯 · 新年板牌' })
      const [published] = await db().select().from(schema.emojis).where(eq(schema.emojis.id, addEmoji))
      expect(published).toMatchObject({ status: 'published', sortOrder: 2, derivedReady: true })
    })
  })

  describe('修改已发布 (edit_pack)', () => {
    test('only the pack owner (or staff with packs) may open one', async () => {
      await rejects(createSubmission(other.actor, { kind: 'edit_pack', packSlug: 'aimisi-xinnianbanpai' }), 403)
    })

    test('changes and removals apply on approval only', async () => {
      const editId = (await createSubmission(owner.actor, { kind: 'edit_pack', packSlug: 'aimisi-xinnianbanpai', declaration })).id
      const detail = await getSubmission(owner.actor, editId)
      expect(detail.payload.title).toBe('爱弥斯 · 新年板牌') // prefilled from the live pack
      const victim = detail.packEmojis[0]!.id
      await updateSubmission(owner.actor, editId, { payload: { title: '爱弥斯 · 新春板牌', removeEmojiIds: [victim, 'r-22222222222222222222'] } })
      await submitSubmission(owner.actor, editId, deps)
      const [live] = await db().select().from(schema.packs).where(eq(schema.packs.id, packId))
      expect(live!.title).toBe('爱弥斯 · 新年板牌')
      const card = (await listReviewQueue(manager.actor, 'pending')).items.find((i) => i.id === editId)!
      expect(card.diff).toContainEqual({ field: '标题', from: '爱弥斯 · 新年板牌', to: '爱弥斯 · 新春板牌' })
      expect(card.diff).toContainEqual({ field: '移除表情', from: '', to: '1 张' })
      const r = await approveSubmission(manager.actor, editId, { downloadable: false }, deps)
      expect(r.hidden).toBe(1)
      const [pack] = await db().select().from(schema.packs).where(eq(schema.packs.id, packId))
      expect(pack).toMatchObject({ title: '爱弥斯 · 新春板牌', emojiCount: 2, downloadable: false, slug: 'aimisi-xinnianbanpai' })
      const [hidden] = await db().select().from(schema.emojis).where(eq(schema.emojis.id, victim))
      expect(hidden!.status).toBe('hidden')
    })
  })
})

describe('withdraw', () => {
  test('draft → withdrawn and pending → withdrawn, by the submitter only', async () => {
    const a = (await createSubmission(owner.actor, { kind: 'new_pack', payload: { title: '撤回测试' } })).id
    await rejects(withdrawSubmission(other.actor, a), 404)
    await withdrawSubmission(owner.actor, a)
    await rejects(submitSubmission(owner.actor, a, deps), 409)
    await rejects(updateSubmission(owner.actor, a, { payload: { title: 'x' } }), 409)

    const b = (await createSubmission(owner.actor, { kind: 'new_pack', payload: { title: '待审撤回', artistNames: ['某画师'] }, declaration })).id
    await upload(owner.actor, b, [{ name: 'w.png', body: await makePng(40, 40, 7), type: 'image/png' }])
    await submitSubmission(owner.actor, b, deps)
    await withdrawSubmission(owner.actor, b)
    await rejects(approveSubmission(manager.actor, b, { downloadable: true }, deps), 409)
    expect((await auditRows(b)).map((r) => r.action)).toEqual(expect.arrayContaining(['submission.create', 'submission.upload', 'submission.submit', 'submission.withdraw']))
  })
})

describe('submit modes', () => {
  test("'blocked' users cannot create drafts, upload or submit", async () => {
    const u = await person('blocked')
    const id = (await createSubmission(u.actor, { kind: 'new_pack', payload: { title: '被禁止' }, declaration })).id
    await setSubmitMode(u.id, 'blocked')
    await rejects(createSubmission(u.actor, { kind: 'new_pack' }), 403)
    await rejects(presignUploads(u.actor, id, [{ name: 'a.png', size: 10, type: 'image/png' }], deps), 403)
    await rejects(submitSubmission(u.actor, id, deps), 403)
  })

  test("'trusted' submissions go through the same approve path, audited as auto", async () => {
    const u = await person('trusted', 'user', 'trusted')
    const id = (await createSubmission(u.actor, { kind: 'new_pack', payload: { title: '免审包', artistNames: ['免审画师'], official: true }, declaration })).id
    await upload(u.actor, id, [{ name: 't.png', body: await makePng(50, 50, 9), type: 'image/png' }])
    const r = await submitSubmission(u.actor, id, deps)
    expect(r).toMatchObject({ status: 'approved' })
    const [sub] = await db().select().from(schema.submissions).where(eq(schema.submissions.id, id))
    expect(sub).toMatchObject({ status: 'approved', reviewerId: null })
    const [pack] = await db().select().from(schema.packs).where(eq(schema.packs.id, sub!.packId))
    // official: 允许下载 forced off even though the declaration asked for it
    expect(pack).toMatchObject({ status: 'published', sourceKind: 'official', downloadable: false })
    const rows = await auditRows(id)
    expect(rows.map((a) => a.action)).toEqual(expect.arrayContaining(['submission.submit', 'submission.approve']))
    expect(rows.find((a) => a.action === 'submission.approve')).toMatchObject({ actorId: u.id, actorRole: 'user' })
    expect(rows.find((a) => a.action === 'submission.approve')!.diff).toMatchObject({ auto: true, official: true, downloadable: false })
  })
})

describe('upload limits', () => {
  test(`at most ${UPLOAD_LIMITS.maxFiles} files per submission, ${UPLOAD_LIMITS.maxPerRequest} per request`, async () => {
    const id = (await createSubmission(other.actor, { kind: 'new_pack', payload: { title: '很多文件' } })).id
    const batch = Array.from({ length: UPLOAD_LIMITS.maxPerRequest }, (_, i) => ({ name: `f${i}.png`, size: 100, type: 'image/png' }))
    await rejects(presignUploads(other.actor, id, [...batch, batch[0]!], deps), 400, '一次最多')
    for (let i = 0; i < UPLOAD_LIMITS.maxFiles / UPLOAD_LIMITS.maxPerRequest; i++) await presignUploads(other.actor, id, batch, deps)
    await rejects(presignUploads(other.actor, id, [batch[0]!], deps), 400, `最多 ${UPLOAD_LIMITS.maxFiles} 张`)
    // a reviewer may upload into someone else's submission (the presign rule); still counted
    await rejects(presignUploads(manager.actor, id, [batch[0]!], deps), 400)
    // completing someone else's upload ids does nothing
    const signed = await db().select().from(schema.uploadItems).where(eq(schema.uploadItems.submissionId, id)).limit(2)
    const stranger = (await createSubmission(owner.actor, { kind: 'new_pack' })).id
    expect(await completeUploads(owner.actor, stranger, signed.map((s) => s.id), deps)).toEqual({ queued: 0 })
  })
})

describe('cleanupSubmissions', () => {
  test('purges returned/withdrawn after 30 days and drafts after 90, with their files', async () => {
    const draft = await createSubmission(owner.actor, { kind: 'new_pack', payload: { title: '旧草稿' } })
    const { outcomes } = await upload(owner.actor, draft.id, [{ name: 'old.gif', body: await makeGif(40, 40, 2, 55), type: 'image/gif' }])
    const emojiId = (outcomes[0] as { emojiId: string }).emojiId
    const [e] = await db().select().from(schema.emojis).where(eq(schema.emojis.id, emojiId))
    const fresh = await createSubmission(owner.actor, { kind: 'new_pack', payload: { title: '新草稿' } })
    const withdrawn = await createSubmission(owner.actor, { kind: 'new_pack', payload: { title: '撤回很久' } })
    await withdrawSubmission(owner.actor, withdrawn.id)
    await sqlRows(`update submissions set updated_at = now() - interval '91 days' where id = $1`, [draft.id])
    await sqlRows(`update submissions set updated_at = now() - interval '31 days' where id = $1`, [withdrawn.id])

    const r = await cleanupSubmissions()
    expect(r.failed).toBe(0)
    const left = await sqlRows<{ id: string }>(`select id from submissions where id = any($1::uuid[])`, [[draft.id, fresh.id, withdrawn.id]])
    expect(left.map((x) => x.id)).toEqual([fresh.id])
    expect(await sqlRows(`select 1 from emojis where id = $1`, [emojiId])).toEqual([])
    expect(await sqlRows(`select 1 from packs where id = any($1::int[])`, [[draft.packId, withdrawn.packId]])).toEqual([])
    expect(await headObject(e!.originalKey)).toBeNull()
    expect(await headObject(reviewKey('p240', e!.storagePackKey, emojiId))).toBeNull()
    expect((await auditRows(draft.id)).map((a) => a.action)).toContain('submission.cleanup')
    // approved submissions and published packs are never touched
    const approved = await sqlRows<{ n: number }>(`select count(*)::int as n from submissions where status = 'approved'`)
    expect(approved[0]!.n).toBeGreaterThanOrEqual(3)
  })

  test('is wired into the daily cleanup job', async () => {
    const src = await Bun.file(join(import.meta.dir, '../../src/server/jobs/handlers/maintenance.ts')).text()
    expect(src).toContain("import('../../submissions/cleanup')).cleanupSubmissions()")
  })
})

describe('server functions declare the right middleware', () => {
  test('review actions need requirePerm(review); the rest requireUser', async () => {
    const src = await Bun.file(join(import.meta.dir, '../../src/server/submissions/fn.ts')).text()
    const middlewareOf = (name: string) => new RegExp(`export const ${name} = createServerFn\\([^)]*\\)\\s*\\.middleware\\(\\[([^\\]]+)\\]\\)`).exec(src)?.[1]
    for (const fn of ['listReviewQueueFn', 'approveSubmissionFn', 'returnSubmissionFn']) expect(middlewareOf(fn)).toBe("requirePerm('review')")
    for (const fn of ['createSubmissionFn', 'updateSubmissionFn', 'presignUploadsFn', 'completeUploadsFn', 'submitSubmissionFn', 'withdrawSubmissionFn', 'removeUploadFn', 'reorderEmojisFn']) {
      expect(middlewareOf(fn)).toBe('requireUser')
    }
  })
})

describe('integrity', () => {
  test('published emojis keep no copies under review/', async () => {
    const review = await listKeys('review/v1/')
    const published = await db().select({ id: schema.emojis.id }).from(schema.emojis).where(eq(schema.emojis.status, 'published'))
    for (const p of published) expect(review.some((k) => k.includes(p.id))).toBe(false)
  })
})
