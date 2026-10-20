import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { audit } from '../audit'
import { db, schema } from '../db/client'
import { findCrossPackDuplicates } from '../media/ingest'
import { derivedKey, reviewKey } from '../media/keys'
import { deleteEmojiFiles, publishEmojiDerivatives } from '../media/publish'
import { type Actor, badRequest, conflict, likePattern, many, notFound, pageOf, thumbFromRow, toIso, toNum } from './common'
import type { EmojiListInput } from './inputs'
import { busyJobs, dropZips, fixCovers, type MediaDeps, nextSortOrder, refreshCounts, refreshZip } from './maintain'
import type { EmojiDetail, EmojiListRow, EmojiStatus, Paged } from './types'

// 表情库 and the per-emoji actions of the pack editor: order, hide, publish, takedown, regenerate, move.

type EmojiRow = typeof schema.emojis.$inferSelect

async function loadEmojis(ids: string[]): Promise<EmojiRow[]> {
  if (!ids.length) return []
  return db().select().from(schema.emojis).where(inArray(schema.emojis.id, [...new Set(ids)]))
}

function byPack(rows: Pick<EmojiRow, 'id' | 'packId'>[]): Map<number, string[]> {
  const m = new Map<number, string[]>()
  for (const r of rows) m.set(r.packId, [...(m.get(r.packId) ?? []), r.id])
  return m
}

// ---------- list / detail ----------

interface EmojiListSql {
  id: string
  status: EmojiStatus
  sort_order: number
  format: string
  bytes: number
  width: number | null
  height: number | null
  frames: number
  variant_rev: number
  derived_ready: boolean
  full_ready: boolean
  p240_bytes: number | null
  a160_bytes: number | null
  storage_pack_key: string
  created_at: Date | string
  pack_id: number
  pack_title: string
  pack_key: string
}

function emojiFilters(input: EmojiListInput): SQL {
  const parts: SQL[] = [sql`true`]
  if (input.packId) parts.push(sql`e.pack_id = ${input.packId}`)
  if (input.status) parts.push(sql`e.status = ${input.status}`)
  if (input.format) parts.push(sql`e.format = ${input.format}`)
  if (input.derived === 'missing') parts.push(sql`e.status = 'published' AND NOT e.derived_ready`)
  if (input.derived === 'ready') parts.push(sql`e.derived_ready`)
  const q = input.q?.trim()
  if (q) {
    if (/^r-[0-9a-f]{1,20}$/.test(q)) parts.push(sql`e.id LIKE ${q + '%'}`)
    else if (/^[0-9a-f]{64}$/.test(q)) parts.push(sql`e.sha256 = ${q}`)
    else {
      const pat = likePattern(q)
      parts.push(sql`(p.title ILIKE ${pat} OR p.pack_key ILIKE ${pat} OR p.slug ILIKE ${pat} OR e.storage_pack_key ILIKE ${pat})`)
    }
  }
  return sql.join(parts, sql` AND `)
}

function toListRow(r: EmojiListSql): EmojiListRow {
  return {
    id: r.id,
    status: r.status,
    sortOrder: toNum(r.sort_order),
    format: r.format,
    bytes: toNum(r.bytes),
    width: r.width == null ? null : toNum(r.width),
    height: r.height == null ? null : toNum(r.height),
    frames: toNum(r.frames),
    variantRev: toNum(r.variant_rev),
    derivedReady: Boolean(r.derived_ready),
    fullReady: Boolean(r.full_ready),
    p240Bytes: r.p240_bytes == null ? null : toNum(r.p240_bytes),
    a160Bytes: r.a160_bytes == null ? null : toNum(r.a160_bytes),
    thumb: thumbFromRow(r),
    storagePackKey: r.storage_pack_key,
    packId: toNum(r.pack_id),
    packTitle: r.pack_title,
    packKey: r.pack_key,
    createdAt: toIso(r.created_at) ?? '',
  }
}

const LIST_COLS = sql`e.id, e.status, e.sort_order, e.format, e.bytes, e.width, e.height, e.frames, e.variant_rev, e.derived_ready,
  e.full_ready, e.p240_bytes, e.a160_bytes, e.storage_pack_key, e.created_at, p.id AS pack_id, p.title AS pack_title, p.pack_key`

export async function listEmojis(input: EmojiListInput): Promise<Paged<EmojiListRow> & { formats: { format: string; n: number }[] }> {
  const where = emojiFilters(input)
  const [{ n } = { n: 0 }] = await many<{ n: number }>(sql`SELECT count(*)::int AS n FROM emojis e JOIN packs p ON p.id = e.pack_id WHERE ${where}`)
  const pg = pageOf(input.page, toNum(n), 48)
  const rows = await many<EmojiListSql>(sql`
    SELECT ${LIST_COLS} FROM emojis e JOIN packs p ON p.id = e.pack_id WHERE ${where}
    ORDER BY ${input.packId ? sql`e.sort_order, e.created_at, e.id` : sql`e.created_at DESC, e.id`}
    LIMIT ${pg.size} OFFSET ${pg.offset}`)
  const formats = await many<{ format: string; n: number }>(sql`SELECT format, count(*)::int AS n FROM emojis GROUP BY format ORDER BY n DESC`)
  return { rows: rows.map(toListRow), total: toNum(n), page: pg.page, pages: pg.pages, pageSize: pg.size, formats: formats.map((f) => ({ format: f.format, n: toNum(f.n) })) }
}

export async function getEmojiDetail(id: string): Promise<EmojiDetail> {
  const [r] = await many<EmojiListSql & { sha256: string | null; poster_frame: number; duration_ms: number | null; original_key: string }>(sql`
    SELECT ${LIST_COLS}, e.sha256, e.poster_frame, e.duration_ms, e.original_key
    FROM emojis e JOIN packs p ON p.id = e.pack_id WHERE e.id = ${id}`)
  if (!r) throw notFound('这张表情')
  const row = toListRow(r)
  const keys: EmojiDetail['keys'] = [{ label: '原图', key: r.original_key }]
  if (row.status === 'pending') {
    keys.push({ label: '预览 p240（待审核）', key: reviewKey('p240', row.storagePackKey, row.id) })
    if (row.frames > 1) keys.push({ label: '预览 a160（待审核）', key: reviewKey('a160', row.storagePackKey, row.id) })
  } else {
    keys.push({ label: `海报 p240 · r${row.variantRev}`, key: derivedKey('p240', row.storagePackKey, row.id, row.variantRev) })
    if (row.frames > 1) keys.push({ label: `预览 a160 · r${row.variantRev}`, key: derivedKey('a160', row.storagePackKey, row.id, row.variantRev) })
    keys.push({ label: `完整 full · r${row.variantRev}`, key: derivedKey('full', row.storagePackKey, row.id, row.variantRev) })
  }
  const dups = await findCrossPackDuplicates(id)
  const chars = await db()
    .select({ id: schema.characters.id, name: schema.characters.name })
    .from(schema.emojiCharacters)
    .innerJoin(schema.characters, eq(schema.characters.id, schema.emojiCharacters.characterId))
    .where(eq(schema.emojiCharacters.emojiId, id))
    .orderBy(asc(schema.characters.name))
  return {
    emoji: { ...row, sha256: r.sha256, posterFrame: toNum(r.poster_frame), durationMs: r.duration_ms == null ? null : toNum(r.duration_ms), originalKey: r.original_key },
    keys,
    duplicates: dups.map((d) => ({ emojiId: d.emojiId, status: d.status, packId: d.packId, packTitle: d.title, packKey: d.packKey })),
    characters: chars,
  }
}

// ---------- order ----------

export async function reorderEmojis(actor: Actor, input: { packId: number; emojiIds: string[] }, deps: MediaDeps) {
  const { emojis } = schema
  await db().transaction(async (tx) => {
    const current = await tx.select({ id: emojis.id }).from(emojis).where(eq(emojis.packId, input.packId)).for('update')
    const want = new Set(input.emojiIds)
    if (want.size !== input.emojiIds.length || current.length !== want.size || current.some((c) => !want.has(c.id))) {
      throw conflict('包里的表情已经变化，请刷新后再排序')
    }
    const arr = sql`ARRAY[${sql.join(input.emojiIds.map((i) => sql`${i}`), sql`, `)}]::text[]`
    await tx.execute(sql`
      UPDATE emojis e SET sort_order = (x.ord - 1)::int
      FROM unnest(${arr}) WITH ORDINALITY AS x(id, ord)
      WHERE e.id = x.id AND e.pack_id = ${input.packId}`)
    await audit(actor, 'pack.reorder', { type: 'pack', id: input.packId }, { order: input.emojiIds }, tx)
  })
  await refreshZip([input.packId], deps)
  return { ok: true }
}

// ---------- hide / unhide ----------

/**
 * 隐藏 takes emojis off the site but keeps their files: /img never consults the database, so a hidden
 * image stays reachable (and CDN-cached) at its old URL. Takedowns use deleteEmojis instead.
 * 恢复 publishes hidden emojis again (pending ones go through publishPendingEmojis).
 */
export async function setEmojisStatus(actor: Actor, input: { ids: string[]; status: 'published' | 'hidden' }, deps: MediaDeps) {
  const rows = await loadEmojis(input.ids)
  const eligible = rows.filter((r) => (input.status === 'hidden' ? r.status !== 'hidden' : r.status === 'hidden'))
  if (!eligible.length) return { changed: 0, skipped: rows.length }
  const { emojis } = schema
  const groups = byPack(eligible)
  await db().transaction(async (tx) => {
    await tx.update(emojis).set({ status: input.status }).where(inArray(emojis.id, eligible.map((r) => r.id)))
    for (const [packId, ids] of groups) {
      await audit(actor, input.status === 'hidden' ? 'emoji.hide' : 'emoji.unhide', { type: 'pack', id: packId }, { emojis: ids }, tx)
    }
    await fixCovers([...groups.keys()], tx)
  })
  // un-hidden emojis whose derivatives were never rendered (or were regenerated meanwhile)
  if (input.status === 'published') for (const r of eligible) if (!r.derivedReady) await deps.enqueueDerive(r.id, 'derived')
  await refreshCounts()
  await refreshZip([...groups.keys()], deps)
  return { changed: eligible.length, skipped: rows.length - eligible.length }
}

// ---------- publish pending (staff uploads) ----------

/**
 * Pending emojis that came in through a user submission (its upload row names the submission, or an
 * open submission lists it in payload.addEmojiIds). Those go live only through 投稿审核, which applies
 * the declaration and the 允许下载 decision; publishing them here would leave the submission pending
 * with its images already public.
 */
async function submissionEmojis(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const list = sql.join(ids.map((i) => sql`${i}`), sql`, `)
  const rows = await many<{ id: string }>(sql`
    SELECT e.id FROM emojis e WHERE e.id IN (${list}) AND (
      EXISTS (SELECT 1 FROM upload_items u WHERE u.emoji_id = e.id AND u.submission_id IS NOT NULL)
      OR EXISTS (SELECT 1 FROM submissions s WHERE s.status IN ('draft', 'pending', 'returned')
                 AND jsonb_exists(coalesce(s.payload->'addEmojiIds', '[]'::jsonb), e.id)))`)
  return new Set(rows.map((r) => r.id))
}

export interface PublishOutcome {
  published: string[]
  waiting: string[]
  failed: { id: string; error: string }[]
}

/**
 * Publish pending emojis (staff uploads skip review). Only once the worker has rendered the review
 * previews (p240_bytes set): media.derive is an exclusive singleton per emoji, so publishing while the
 * 'review' job is still queued would silently drop the 'derived' job and leave the emoji without
 * derivatives. If no preview can be promoted and the derive job cannot be queued, the emoji goes back
 * to pending and is retried later.
 */
export async function publishPendingEmojis(actor: Actor, ids: string[], deps: MediaDeps): Promise<PublishOutcome> {
  const { emojis } = schema
  const rows = (await loadEmojis(ids)).filter((r) => r.status === 'pending')
  const out: PublishOutcome = { published: [], waiting: [], failed: [] }
  const busy = await busyJobs('media.derive', rows.map((r) => r.id))
  const submitted = await submissionEmojis(rows.map((r) => r.id))
  for (const r of rows) {
    if (submitted.has(r.id)) {
      out.failed.push({ id: r.id, error: '属于用户投稿，请在投稿审核里处理' })
      continue
    }
    if (r.p240Bytes == null || busy.has(r.id)) {
      out.waiting.push(r.id)
      continue
    }
    const [claimed] = await db()
      .update(emojis)
      .set({ status: 'published' })
      .where(and(eq(emojis.id, r.id), eq(emojis.status, 'pending')))
      .returning({ id: emojis.id })
    if (!claimed) continue
    try {
      await publishEmojiDerivatives(r.id, {
        async enqueueDerived(emojiId) {
          if (!(await deps.enqueueDerive(emojiId, 'derived'))) throw new Error('derive job busy')
        },
      })
      out.published.push(r.id)
    } catch (err) {
      await db().update(emojis).set({ status: 'pending' }).where(eq(emojis.id, r.id))
      if ((err as Error).message === 'derive job busy') out.waiting.push(r.id)
      else out.failed.push({ id: r.id, error: (err as Error).message })
    }
  }
  if (out.published.length) {
    const groups = byPack(rows.filter((r) => out.published.includes(r.id)))
    for (const [packId, list] of groups) await audit(actor, 'emoji.publish', { type: 'pack', id: packId }, { emojis: list })
    await fixCovers([...groups.keys()])
    await refreshCounts()
    await refreshZip([...groups.keys()], deps)
  }
  return out
}

// ---------- takedown ----------

export interface TakedownResult {
  deleted: number
  deletedObjects: number
  zipsDeleted: number
  purgedUrls: number
  purgeSkipped: boolean
  purgeError: string | null
}

/**
 * 删除 / 版权下架 (docs/ARCHITECTURE.md §6.3): delete the original, every derived revision and the
 * review previews; delete the rows; fix covers and counters; delete the affected ZIPs now (they still
 * contain the images) and queue rebuilds; purge the /img URLs from Cloudflare last. The audit row
 * records what was deleted and how the purge went.
 */
export async function deleteEmojis(actor: Actor, ids: string[], deps: MediaDeps): Promise<TakedownResult> {
  const rows = await loadEmojis(ids)
  if (!rows.length) throw notFound('这些表情')
  const urls: string[] = []
  const keys: string[] = []
  for (const r of rows) {
    const res = await deleteEmojiFiles(r)
    urls.push(...res.imgUrls)
    keys.push(...res.deletedKeys)
  }
  const groups = byPack(rows)
  const { emojis } = schema
  await db().transaction(async (tx) => {
    await tx.delete(emojis).where(inArray(emojis.id, rows.map((r) => r.id)))
    await fixCovers([...groups.keys()], tx)
  })
  await refreshCounts()
  const zipKeys = await dropZips([...groups.keys()], deps)

  let purgedUrls = 0
  let purgeSkipped = false
  let purgeError: string | null = null
  try {
    const r = await deps.purge(urls)
    purgedUrls = r.purged
    purgeSkipped = r.skipped
  } catch (err) {
    purgeError = (err as Error).message
  }
  for (const [packId, list] of groups) {
    await audit(actor, 'emoji.delete', { type: 'pack', id: packId }, {
      emojis: list,
      objects: keys.length,
      zips: zipKeys,
      purge: { urls: urls.length, purged: purgedUrls, skipped: purgeSkipped, error: purgeError },
    })
  }
  return { deleted: rows.length, deletedObjects: keys.length, zipsDeleted: zipKeys.length, purgedUrls, purgeSkipped, purgeError }
}

// ---------- regenerate ----------

export interface RegenerateResult {
  queued: string[]
  skipped: { id: string; reason: string }[]
}

/**
 * 重新生成衍生图: bump variant_rev (every /img URL changes, so stale CDN copies are never referenced
 * again) and queue media.derive 'derived'. Published emojis only; an emoji whose derive job is already
 * queued or running is skipped, and the bump is undone if the queue drops the new job.
 */
export async function regenerateEmojis(actor: Actor, input: { ids?: string[]; packId?: number }, deps: MediaDeps): Promise<RegenerateResult> {
  const { emojis } = schema
  let rows: EmojiRow[]
  if (input.ids?.length) rows = await loadEmojis(input.ids)
  else if (input.packId) rows = await db().select().from(emojis).where(eq(emojis.packId, input.packId))
  else throw badRequest('请选择要重新生成的表情')
  const out: RegenerateResult = { queued: [], skipped: [] }
  const busy = await busyJobs('media.derive', rows.map((r) => r.id))
  for (const r of rows) {
    if (r.status !== 'published') {
      out.skipped.push({ id: r.id, reason: r.status === 'pending' ? '待审核的表情只生成预览图' : '已隐藏的表情不生成' })
      continue
    }
    if (busy.has(r.id)) {
      out.skipped.push({ id: r.id, reason: '已有生成任务在排队或运行' })
      continue
    }
    await db()
      .update(emojis)
      .set({ variantRev: sql`${emojis.variantRev} + 1`, derivedReady: false, fullReady: false, fullBytes: null })
      .where(eq(emojis.id, r.id))
    if (await deps.enqueueDerive(r.id, 'derived')) out.queued.push(r.id)
    else {
      await db().update(emojis).set({ variantRev: r.variantRev, derivedReady: r.derivedReady, fullReady: r.fullReady, fullBytes: r.fullBytes }).where(eq(emojis.id, r.id))
      out.skipped.push({ id: r.id, reason: '已有生成任务在排队或运行' })
    }
  }
  const queuedRows = rows.filter((r) => out.queued.includes(r.id))
  for (const [packId, list] of byPack(queuedRows)) await audit(actor, 'emoji.regenerate', { type: 'pack', id: packId }, { emojis: list })
  return out
}

// ---------- move ----------

/**
 * 移动到另一个包. Objects stay where they are: storage_pack_key keeps naming the pack the emoji was
 * ingested into, so /img URLs do not change. Files already in the target pack (same SHA-256) are skipped.
 */
export async function moveEmojis(actor: Actor, input: { ids: string[]; toPackId: number }, deps: MediaDeps) {
  const { emojis, packs } = schema
  const [target] = await db().select({ id: packs.id, title: packs.title }).from(packs).where(eq(packs.id, input.toPackId))
  if (!target) throw notFound('目标表情包')
  const rows = (await loadEmojis(input.ids)).filter((r) => r.packId !== target.id)
  if (!rows.length) return { moved: 0, duplicates: [] as string[] }
  const hashes = rows.map((r) => r.sha256).filter((h): h is string => Boolean(h))
  const existing = hashes.length
    ? new Set(
        (await db().select({ sha: emojis.sha256 }).from(emojis).where(and(eq(emojis.packId, target.id), inArray(emojis.sha256, hashes)))).map((r) => r.sha),
      )
    : new Set<string | null>()
  const moving = rows.filter((r) => !r.sha256 || !existing.has(r.sha256))
  const duplicates = rows.filter((r) => r.sha256 && existing.has(r.sha256)).map((r) => r.id)
  const sources = [...new Set(moving.map((r) => r.packId))]
  if (moving.length) {
    await db().transaction(async (tx) => {
      let order = await nextSortOrder(target.id, tx)
      for (const r of moving) await tx.update(emojis).set({ packId: target.id, sortOrder: order++ }).where(eq(emojis.id, r.id))
      await fixCovers([...sources, target.id], tx)
      for (const [packId, list] of byPack(moving)) {
        await audit(actor, 'emoji.move', { type: 'pack', id: packId }, { emojis: list, to: target.id }, tx)
      }
    })
    await refreshCounts()
    // the source packs' ZIPs still hold the moved files under the wrong credits: rebuild or drop them
    await dropZips(sources, deps)
    await refreshZip([target.id], deps)
  }
  return { moved: moving.length, duplicates }
}
