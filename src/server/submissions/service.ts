import { and, asc, count, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { can } from '#/shared/roles'
import { newPackKey } from '#/shared/ids'
import { notify } from '../account/notifications'
import { audit } from '../audit'
import type { Viewer } from '../auth/session'
import { db, schema } from '../db/client'
import type { SubmissionDeclaration, SubmissionKind, SubmissionStatus, UploadStatus } from '../db/schema'
import { claimSlug, slugify } from '../import/slug'
import { sendJob } from '../jobs/boss'
import { Q } from '../jobs/queues'
import { log } from '../log'
import { licenseLabel } from '../media/credits'
import { findCrossPackDuplicates } from '../media/ingest'
import { uploadTmpKey } from '../media/keys'
import { deleteEmojiFiles, publishEmojiDerivatives } from '../media/publish'
import { deleteObjects, presignPut } from '../media/s3'
import { enqueuePackZip } from '../media/zip'
import { HttpError } from '../perm/fn'
import { emojiView, submissionEmojis, type EmojiView, type SubmissionEmojiRow } from './emojis'
import {
  ACTIVE_UPLOAD,
  CONFLICT_MESSAGE,
  isEditable,
  sourcesOf,
  submitProblems,
  TEXT_LIMITS,
  UPLOAD_LIMITS,
  type ProposedPayload,
} from './rules'

// Submissions (docs/ARCHITECTURE.md §5): drafts, direct-to-storage uploads, submit / withdraw, review.
// Every function takes the acting user and checks ownership or the 'review' permission itself, on top
// of the server function middleware (src/server/submissions/fn.ts). Transitions are single UPDATEs
// guarded by the allowed source statuses, so two racing actions cannot both succeed.
//
// The live pack is never written before approval: order, cover, removals and metadata live in the
// payload and are applied in one transaction by approveSubmission. Only the draft pack of a new_pack
// submission exists beforehand, and it is invisible (status draft).

export type Actor = Pick<Viewer, 'id' | 'role' | 'impersonatedBy'>
type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0]
type Runner = ReturnType<typeof db> | Tx
type SubmissionRow = typeof schema.submissions.$inferSelect

export interface SubmissionDeps {
  presignPut(key: string, contentType: string, expiresIn: number): Promise<string>
  enqueueIngest(uploadItemId: string): Promise<void>
  /** after approval, per newly published emoji */
  publishDerivatives(emojiId: string): Promise<unknown>
  enqueueZip(packId: number): Promise<void>
}

export const defaultDeps: SubmissionDeps = {
  presignPut: (key, contentType, expiresIn) => presignPut(key, contentType, expiresIn),
  async enqueueIngest(uploadItemId) {
    await sendJob(Q.ingest, { uploadItemId })
  },
  publishDerivatives: (emojiId) => publishEmojiDerivatives(emojiId),
  enqueueZip: (packId) => enqueuePackZip(packId),
}

const NOT_FOUND = '投稿不存在或已被删除'
const MAX_OPEN_DRAFTS = 30

// ---------- access ----------

async function loadSubmission(runner: Runner, id: string, lock = false): Promise<SubmissionRow> {
  const q = runner.select().from(schema.submissions).where(eq(schema.submissions.id, id))
  const [row] = lock ? await q.for('update') : await q
  if (!row) throw new HttpError(404, NOT_FOUND)
  return row
}

/** Submitter or reviewer. Others get the same 404 as a missing row. */
function assertCanSee(actor: Actor, sub: SubmissionRow) {
  if (sub.submitterId !== actor.id && !can(actor.role, 'review')) throw new HttpError(404, NOT_FOUND)
}

/** Only the submitter edits, submits or withdraws. */
function assertOwner(actor: Actor, sub: SubmissionRow) {
  if (sub.submitterId === actor.id) return
  if (can(actor.role, 'review')) throw new HttpError(403, '只有投稿者本人可以修改这条投稿')
  throw new HttpError(404, NOT_FOUND)
}

function assertEditable(sub: SubmissionRow) {
  if (!isEditable(sub.status)) throw new HttpError(409, sub.status === 'pending' ? '投稿正在审核中，撤回后才能修改' : '这条投稿已经结束，不能再修改')
}

function assertReviewer(actor: Actor) {
  if (!can(actor.role, 'review')) throw new HttpError(403, '没有权限执行这个操作')
}

/** submit_mode and ban come from the users row, never from a cached session. */
async function readSubmitMode(userId: string): Promise<'review' | 'trusted' | 'blocked'> {
  const [u] = await db().select({ mode: schema.users.submitMode, banned: schema.users.banned }).from(schema.users).where(eq(schema.users.id, userId))
  if (!u || u.banned) return 'blocked'
  return u.mode
}

const BLOCKED_MESSAGE = '你的账号暂时不能投稿，如有疑问请联系站长'

async function assertMaySubmit(userId: string) {
  if ((await readSubmitMode(userId)) === 'blocked') throw new HttpError(403, BLOCKED_MESSAGE)
}

async function touch(runner: Runner, id: string) {
  await runner.update(schema.submissions).set({ updatedAt: new Date() }).where(eq(schema.submissions.id, id))
}

// ---------- payload ----------

export interface PayloadPatch {
  title?: string
  excerpt?: string | null
  descriptionMd?: string | null
  characterIds?: number[]
  artistIds?: number[]
  artistNames?: string[]
  commissioner?: string | null
  coverEmojiId?: string | null
  removeEmojiIds?: string[]
  official?: boolean
}

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? '').trim()
  return t ? t.slice(0, n) : null
}

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)]
}

async function existingIds(runner: Runner, table: typeof schema.characters | typeof schema.artists, ids: number[]): Promise<number[]> {
  if (!ids.length) return []
  const rows = await runner.select({ id: table.id }).from(table).where(inArray(table.id, ids))
  const ok = new Set(rows.map((r) => r.id))
  return ids.filter((id) => ok.has(id))
}

/** Published emojis of the pack among `ids` (edit_pack removals, cover). */
async function publishedInPack(runner: Runner, packId: number, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const { emojis } = schema
  const rows = await runner
    .select({ id: emojis.id })
    .from(emojis)
    .where(and(eq(emojis.packId, packId), eq(emojis.status, 'published'), inArray(emojis.id, ids)))
  return new Set(rows.map((r) => r.id))
}

/** Merge a patch into the stored payload, keeping only references that exist and belong here. */
async function mergePayload(runner: Runner, sub: Pick<SubmissionRow, 'id' | 'kind' | 'packId'>, prev: ProposedPayload, patch: PayloadPatch): Promise<ProposedPayload> {
  const next: ProposedPayload = { ...prev }
  if (sub.kind !== 'add_emojis') {
    if (patch.title !== undefined) next.title = clip(patch.title, TEXT_LIMITS.title) ?? ''
    if (patch.excerpt !== undefined) next.excerpt = clip(patch.excerpt, TEXT_LIMITS.excerpt)
    if (patch.descriptionMd !== undefined) next.descriptionMd = clip(patch.descriptionMd, TEXT_LIMITS.description)
    if (patch.commissioner !== undefined) next.commissioner = clip(patch.commissioner, TEXT_LIMITS.commissioner)
    if (patch.characterIds !== undefined) next.characterIds = await existingIds(runner, schema.characters, uniq(patch.characterIds).slice(0, 20))
    if (patch.artistIds !== undefined) next.artistIds = await existingIds(runner, schema.artists, uniq(patch.artistIds).slice(0, 10))
    if (patch.artistNames !== undefined) {
      const names = uniq(patch.artistNames.map((n) => clip(n, TEXT_LIMITS.artist)).filter((n): n is string => Boolean(n)))
      next.artistNames = names.slice(0, 10)
    }
  }
  if (sub.kind === 'new_pack' && patch.official !== undefined) next.official = patch.official
  if (sub.kind === 'edit_pack' && patch.removeEmojiIds !== undefined) {
    const ok = await publishedInPack(runner, sub.packId, uniq(patch.removeEmojiIds).slice(0, 500))
    next.removeEmojiIds = [...ok]
  }
  if (patch.coverEmojiId !== undefined) {
    next.coverEmojiId = patch.coverEmojiId ? await validCover(runner, sub, patch.coverEmojiId, next.removeEmojiIds ?? []) : null
  }
  if (next.coverEmojiId && next.removeEmojiIds?.includes(next.coverEmojiId)) next.coverEmojiId = null
  return next
}

async function validCover(runner: Runner, sub: Pick<SubmissionRow, 'id' | 'kind' | 'packId'>, emojiId: string, removed: string[]): Promise<string | null> {
  const own = await submissionEmojis(runner, sub)
  if (own.some((e) => e.id === emojiId)) return emojiId
  if (sub.kind !== 'new_pack' && !removed.includes(emojiId) && (await publishedInPack(runner, sub.packId, [emojiId])).size) return emojiId
  return null
}

function cleanDeclaration(d: SubmissionDeclaration | null | undefined): SubmissionDeclaration | null {
  if (!d) return null
  return {
    identity: d.identity,
    license: d.license,
    proofUrl: clip(d.proofUrl, TEXT_LIMITS.proofUrl),
    note: clip(d.note, TEXT_LIMITS.note),
    downloadable: Boolean(d.downloadable),
  }
}

// ---------- create / update ----------

export interface CreateInput {
  kind: SubmissionKind
  /** add_emojis / edit_pack: the published pack */
  packSlug?: string
  payload?: PayloadPatch
  declaration?: SubmissionDeclaration | null
}

export async function createSubmission(actor: Actor, input: CreateInput): Promise<{ id: string; packId: number }> {
  await assertMaySubmit(actor.id)
  const d = db()
  const { submissions, packs } = schema
  const [open] = await d
    .select({ n: count() })
    .from(submissions)
    .where(and(eq(submissions.submitterId, actor.id), eq(submissions.status, 'draft')))
  if ((open?.n ?? 0) >= MAX_OPEN_DRAFTS) throw new HttpError(429, `草稿太多了（最多 ${MAX_OPEN_DRAFTS} 个），请先提交或撤回一些`)

  if (input.kind === 'new_pack') {
    return d.transaction(async (tx) => {
      const title = clip(input.payload?.title, TEXT_LIMITS.title)
      const hint = title ? slugify(title) : ''
      const packKey = newPackKey(hint.startsWith('x-') ? '' : hint)
      const [pack] = await tx
        .insert(packs)
        .values({ packKey, slug: packKey, title: title ?? '未命名投稿', status: 'draft', ownerId: actor.id })
        .returning({ id: packs.id })
      const [sub] = await tx
        .insert(submissions)
        .values({ kind: 'new_pack', packId: pack!.id, submitterId: actor.id, payload: {}, declaration: cleanDeclaration(input.declaration) })
        .returning()
      const payload = await mergePayload(tx, sub!, {}, input.payload ?? {})
      await tx.update(submissions).set({ payload }).where(eq(submissions.id, sub!.id))
      await audit(actor, 'submission.create', { type: 'submission', id: sub!.id }, { kind: 'new_pack', packId: pack!.id, packKey }, tx)
      return { id: sub!.id, packId: pack!.id }
    })
  }

  const slug = input.packSlug?.trim()
  if (!slug) throw new HttpError(400, '请选择要修改的表情包')
  const [pack] = await d.select().from(packs).where(eq(packs.slug, slug))
  if (!pack || pack.status !== 'published') throw new HttpError(404, '这个表情包不存在或还没有发布')
  if (input.kind === 'edit_pack' && pack.ownerId !== actor.id && !can(actor.role, 'packs')) {
    throw new HttpError(403, '只有包的投稿者可以修改已发布的包；想补充表情可以选择「补充表情」')
  }
  return d.transaction(async (tx) => {
    let base: ProposedPayload = {}
    if (input.kind === 'edit_pack') {
      const chars = await tx.select({ id: schema.packCharacters.characterId }).from(schema.packCharacters).where(eq(schema.packCharacters.packId, pack.id))
      const arts = await tx
        .select({ id: schema.packArtists.artistId })
        .from(schema.packArtists)
        .where(and(eq(schema.packArtists.packId, pack.id), eq(schema.packArtists.role, 'artist')))
      base = {
        title: pack.title,
        excerpt: pack.excerpt,
        descriptionMd: pack.descriptionMd,
        commissioner: pack.commissioner,
        characterIds: chars.map((c) => c.id),
        artistIds: arts.map((a) => a.id),
        coverEmojiId: pack.coverEmojiId,
      }
    }
    const [sub] = await tx
      .insert(submissions)
      .values({
        kind: input.kind,
        packId: pack.id,
        submitterId: actor.id,
        payload: {},
        declaration: cleanDeclaration(input.declaration),
        // compared in SQL on approval: timestamptz keeps microseconds, a JS Date would not
        baseUpdatedAt: sql`(SELECT updated_at FROM packs WHERE id = ${pack.id})`,
      })
      .returning()
    const payload = await mergePayload(tx, sub!, base, input.payload ?? {})
    await tx.update(submissions).set({ payload }).where(eq(submissions.id, sub!.id))
    await audit(actor, 'submission.create', { type: 'submission', id: sub!.id }, { kind: input.kind, packId: pack.id }, tx)
    return { id: sub!.id, packId: pack.id }
  })
}

export async function updateSubmission(actor: Actor, id: string, patch: { payload?: PayloadPatch; declaration?: SubmissionDeclaration | null }): Promise<{ payload: ProposedPayload }> {
  return db().transaction(async (tx) => {
    const sub = await loadSubmission(tx, id, true)
    assertOwner(actor, sub)
    assertEditable(sub)
    const payload = await mergePayload(tx, sub, sub.payload as ProposedPayload, patch.payload ?? {})
    const set: Partial<typeof schema.submissions.$inferInsert> = { payload }
    if (patch.declaration !== undefined) set.declaration = cleanDeclaration(patch.declaration)
    await tx.update(schema.submissions).set(set).where(eq(schema.submissions.id, id))
    return { payload }
  })
}

// ---------- uploads ----------

export interface UploadRequest {
  name: string
  size: number
  type: string
}

export interface SignedUpload {
  id: string
  name: string
  url: string
  /** must be sent as Content-Type: it is part of the signature */
  contentType: string
}

export async function presignUploads(actor: Actor, id: string, files: UploadRequest[], deps: SubmissionDeps = defaultDeps): Promise<SignedUpload[]> {
  if (!files.length) return []
  if (files.length > UPLOAD_LIMITS.maxPerRequest) throw new HttpError(400, `一次最多 ${UPLOAD_LIMITS.maxPerRequest} 个文件`)
  for (const f of files) {
    if (!UPLOAD_LIMITS.mimes.includes(f.type)) throw new HttpError(400, `「${f.name}」不是支持的格式（GIF、PNG、WebP、JPEG）`)
    if (!(f.size > 0)) throw new HttpError(400, `「${f.name}」是空文件`)
    if (f.size > UPLOAD_LIMITS.maxBytes) throw new HttpError(400, `「${f.name}」超过 20 MB`)
  }
  const { uploadItems } = schema
  const rows = await db().transaction(async (tx) => {
    const sub = await loadSubmission(tx, id, true)
    assertCanSee(actor, sub)
    assertEditable(sub)
    if (sub.submitterId === actor.id) await assertMaySubmit(actor.id)
    const [used] = await tx
      .select({ n: count() })
      .from(uploadItems)
      .where(and(eq(uploadItems.submissionId, id), inArray(uploadItems.status, [...ACTIVE_UPLOAD, 'done'])))
    const left = UPLOAD_LIMITS.maxFiles - (used?.n ?? 0)
    if (files.length > left) throw new HttpError(400, left > 0 ? `每个投稿最多 ${UPLOAD_LIMITS.maxFiles} 张，还能再传 ${left} 张` : `每个投稿最多 ${UPLOAD_LIMITS.maxFiles} 张`)
    const now = new Date()
    const values = files.map((f) => {
      const uploadId = crypto.randomUUID()
      return {
        id: uploadId,
        submissionId: id,
        packId: sub.packId,
        uploaderId: actor.id,
        tmpKey: uploadTmpKey(uploadId, f.name, now),
        filename: f.name.slice(0, 200) || 'file',
        bytes: f.size,
        mime: f.type,
        status: 'signed' as const,
      }
    })
    await tx.insert(uploadItems).values(values)
    await touch(tx, id)
    await audit(actor, 'submission.upload', { type: 'submission', id }, { files: values.length }, tx)
    return values
  })
  return Promise.all(
    rows.map(async (r) => ({ id: r.id, name: r.filename, url: await deps.presignPut(r.tmpKey, r.mime, UPLOAD_LIMITS.expiresIn), contentType: r.mime })),
  )
}

/** The browser finished PUTs: mark them uploaded and queue media.ingest for each. */
export async function completeUploads(actor: Actor, id: string, uploadIds: string[], deps: SubmissionDeps = defaultDeps): Promise<{ queued: number }> {
  if (!uploadIds.length) return { queued: 0 }
  const sub = await loadSubmission(db(), id)
  assertCanSee(actor, sub)
  assertEditable(sub)
  const { uploadItems } = schema
  const rows = await db()
    .update(uploadItems)
    .set({ status: 'uploaded' })
    .where(and(eq(uploadItems.submissionId, id), inArray(uploadItems.id, uploadIds), eq(uploadItems.status, 'signed')))
    .returning({ id: uploadItems.id })
  for (const r of rows) await deps.enqueueIngest(r.id)
  await touch(db(), id)
  return { queued: rows.length }
}

export interface UploadView {
  id: string
  filename: string
  bytes: number
  status: UploadStatus
  error: string | null
  /** set when status is done and the emoji is still this submission's */
  emoji: EmojiView | null
}

export async function listUploads(actor: Actor, id: string): Promise<UploadView[]> {
  const sub = await loadSubmission(db(), id)
  assertCanSee(actor, sub)
  return uploadsOf(db(), sub)
}

async function uploadsOf(runner: Runner, sub: SubmissionRow): Promise<UploadView[]> {
  const { uploadItems } = schema
  const rows = await runner.select().from(uploadItems).where(eq(uploadItems.submissionId, sub.id)).orderBy(asc(uploadItems.createdAt), asc(uploadItems.id))
  const own = new Map(
    (await submissionEmojis(runner, sub, { statuses: sub.status === 'approved' ? ['published'] : ['pending'] })).map((e) => [e.uploadId, e]),
  )
  return rows.map((r) => {
    const e = r.status === 'done' ? own.get(r.id) : undefined
    return { id: r.id, filename: r.filename, bytes: r.bytes, status: r.status, error: r.error, emoji: e ? emojiView(e) : null }
  })
}

/** Remove one upload (and its pending emoji with all files) from an editable submission. */
export async function removeUpload(actor: Actor, id: string, uploadId: string): Promise<void> {
  const d = db()
  const sub = await loadSubmission(d, id)
  assertOwner(actor, sub)
  assertEditable(sub)
  const { uploadItems, emojis, submissions } = schema
  const [item] = await d.select().from(uploadItems).where(and(eq(uploadItems.id, uploadId), eq(uploadItems.submissionId, id)))
  if (!item) return
  if (item.status === 'processing') throw new HttpError(409, '这张图片还在处理中，请稍候再移除')
  const own = item.status === 'done' ? (await submissionEmojis(d, sub)).find((e) => e.uploadId === item.id) : undefined
  if (own) await deleteEmojiFiles({ id: own.id, storagePackKey: own.storagePackKey, originalKey: own.originalKey, variantRev: own.variantRev })
  else if (item.status !== 'duplicate') await deleteObjects([item.tmpKey])
  await d.transaction(async (tx) => {
    await tx.delete(uploadItems).where(eq(uploadItems.id, item.id))
    if (own) await tx.delete(emojis).where(and(eq(emojis.id, own.id), eq(emojis.status, 'pending'), eq(emojis.packId, sub.packId)))
    const p = sub.payload as ProposedPayload
    if (own && (p.addEmojiIds?.includes(own.id) || p.coverEmojiId === own.id)) {
      await tx
        .update(submissions)
        .set({ payload: { ...p, addEmojiIds: p.addEmojiIds?.filter((x) => x !== own.id), coverEmojiId: p.coverEmojiId === own.id ? null : p.coverEmojiId } })
        .where(eq(submissions.id, id))
    } else await touch(tx, id)
  })
}

/** New display order of the submission's own emojis (unknown ids are ignored, missing ones keep their place after). */
export async function reorderEmojis(actor: Actor, id: string, emojiIds: string[]): Promise<string[]> {
  return db().transaction(async (tx) => {
    const sub = await loadSubmission(tx, id, true)
    assertOwner(actor, sub)
    assertEditable(sub)
    const p = sub.payload as ProposedPayload
    const own = await submissionEmojis(tx, sub, { order: p.addEmojiIds })
    const ownIds = new Set(own.map((e) => e.id))
    const front = uniq(emojiIds).filter((x) => ownIds.has(x))
    const order = [...front, ...own.map((e) => e.id).filter((x) => !front.includes(x))]
    await tx.update(schema.submissions).set({ payload: { ...p, addEmojiIds: order } }).where(eq(schema.submissions.id, id))
    return order
  })
}

// ---------- detail ----------

export interface PackRef {
  id: number
  slug: string
  title: string
  status: string
  sourceKind: string
  license: string
  downloadable: boolean
  emojiCount: number
}

export interface SubmissionDetail {
  id: string
  kind: SubmissionKind
  status: SubmissionStatus
  payload: ProposedPayload
  declaration: SubmissionDeclaration | null
  reviewNote: string | null
  submittedAt: string | null
  decidedAt: string | null
  createdAt: string
  updatedAt: string
  pack: PackRef
  /** edit_pack / add_emojis: the pack changed after the base version was captured */
  conflict: boolean
  uploads: UploadView[]
  /** own emojis in display order */
  emojis: EmojiView[]
  /** edit_pack: published emojis of the pack (for cover and removals) */
  packEmojis: EmojiView[]
  characters: { id: number; name: string; color: string | null }[]
  artists: { id: number; name: string }[]
  mine: boolean
}

function packRef(p: typeof schema.packs.$inferSelect): PackRef {
  return { id: p.id, slug: p.slug, title: p.title, status: p.status, sourceKind: p.sourceKind, license: p.license, downloadable: p.downloadable, emojiCount: p.emojiCount }
}

async function isConflicted(runner: Runner, sub: SubmissionRow): Promise<boolean> {
  if (sub.kind === 'new_pack' || sub.status === 'approved' || sub.status === 'withdrawn') return false
  const rows = await runner.execute<{ same: boolean }>(
    sql`SELECT (p.updated_at IS NOT DISTINCT FROM s.base_updated_at) AS same FROM packs p JOIN submissions s ON s.pack_id = p.id WHERE s.id = ${sub.id}`,
  )
  return rows.rows[0]?.same === false
}

async function publishedEmojisOf(runner: Runner, packId: number, limit = 500): Promise<EmojiView[]> {
  const { emojis } = schema
  const rows = await runner
    .select()
    .from(emojis)
    .where(and(eq(emojis.packId, packId), eq(emojis.status, 'published')))
    .orderBy(asc(emojis.sortOrder), asc(emojis.id))
    .limit(limit)
  return rows.map((r) => emojiView(r))
}

export async function getSubmission(actor: Actor, id: string): Promise<SubmissionDetail> {
  const d = db()
  const sub = await loadSubmission(d, id)
  assertCanSee(actor, sub)
  const [pack] = await d.select().from(schema.packs).where(eq(schema.packs.id, sub.packId))
  if (!pack) throw new HttpError(404, NOT_FOUND)
  const p = sub.payload as ProposedPayload
  const statuses: ('pending' | 'published')[] = sub.status === 'approved' ? ['published'] : ['pending']
  const own = await submissionEmojis(d, sub, { statuses, order: p.addEmojiIds })
  const charIds = p.characterIds ?? []
  const artIds = p.artistIds ?? []
  const characters = charIds.length
    ? await d.select({ id: schema.characters.id, name: schema.characters.name, color: schema.characters.themeColor }).from(schema.characters).where(inArray(schema.characters.id, charIds))
    : []
  const artists = artIds.length ? await d.select({ id: schema.artists.id, name: schema.artists.name }).from(schema.artists).where(inArray(schema.artists.id, artIds)) : []
  return {
    id: sub.id,
    kind: sub.kind,
    status: sub.status,
    payload: p,
    declaration: sub.declaration ?? null,
    reviewNote: sub.reviewNote,
    submittedAt: sub.submittedAt?.toISOString() ?? null,
    decidedAt: sub.decidedAt?.toISOString() ?? null,
    createdAt: sub.createdAt.toISOString(),
    updatedAt: sub.updatedAt.toISOString(),
    pack: packRef(pack),
    conflict: await isConflicted(d, sub),
    uploads: await uploadsOf(d, sub),
    emojis: own.map((e) => emojiView(e)),
    packEmojis: sub.kind === 'edit_pack' ? await publishedEmojisOf(d, pack.id) : [],
    characters: charIds.map((cid) => characters.find((c) => c.id === cid)).filter((c): c is (typeof characters)[number] => Boolean(c)),
    artists: artIds.map((aid) => artists.find((a) => a.id === aid)).filter((a): a is (typeof artists)[number] => Boolean(a)),
    mine: sub.submitterId === actor.id,
  }
}

export interface MySubmissionItem {
  id: string
  kind: SubmissionKind
  status: SubmissionStatus
  title: string
  pack: { slug: string; status: string }
  emojiCount: number
  thumb: string | null
  reviewNote: string | null
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  decidedAt: string | null
}

export async function listMySubmissions(actor: Actor): Promise<MySubmissionItem[]> {
  const d = db()
  const { submissions, packs } = schema
  const rows = await d
    .select({ sub: submissions, pack: packs })
    .from(submissions)
    .innerJoin(packs, eq(packs.id, submissions.packId))
    .where(eq(submissions.submitterId, actor.id))
    .orderBy(desc(submissions.updatedAt))
    .limit(200)
  return Promise.all(
    rows.map(async ({ sub, pack }) => {
      const p = sub.payload as ProposedPayload
      const own = await submissionEmojis(d, sub, { statuses: sub.status === 'approved' ? ['published'] : ['pending'], order: p.addEmojiIds })
      const cover = own.find((e) => e.id === p.coverEmojiId) ?? own[0]
      return {
        id: sub.id,
        kind: sub.kind,
        status: sub.status,
        title: (sub.kind === 'add_emojis' ? pack.title : p.title?.trim()) || pack.title,
        pack: { slug: pack.slug, status: pack.status },
        emojiCount: own.length,
        thumb: cover ? emojiView(cover).poster : null,
        reviewNote: sub.reviewNote,
        createdAt: sub.createdAt.toISOString(),
        updatedAt: sub.updatedAt.toISOString(),
        submittedAt: sub.submittedAt?.toISOString() ?? null,
        decidedAt: sub.decidedAt?.toISOString() ?? null,
      }
    }),
  )
}

// ---------- transitions ----------

export type SubmitResult = { status: 'pending' } | { status: 'approved'; packId: number; slug: string }

export async function submitSubmission(actor: Actor, id: string, deps: SubmissionDeps = defaultDeps): Promise<SubmitResult> {
  const mode = await readSubmitMode(actor.id)
  const declared = await db().transaction(async (tx) => {
    const sub = await loadSubmission(tx, id, true)
    assertOwner(actor, sub)
    if (!sourcesOf('pending').includes(sub.status)) throw new HttpError(409, sub.status === 'pending' ? '这条投稿已经在审核中了' : '这条投稿已经结束，不能再提交')
    if (mode === 'blocked') throw new HttpError(403, BLOCKED_MESSAGE)
    const p = sub.payload as ProposedPayload
    const own = await submissionEmojis(tx, sub, { order: p.addEmojiIds })
    const [active] = await tx
      .select({ n: count() })
      .from(schema.uploadItems)
      .where(and(eq(schema.uploadItems.submissionId, id), inArray(schema.uploadItems.status, [...ACTIVE_UPLOAD])))
    const problems = submitProblems({ kind: sub.kind, payload: p, declaration: sub.declaration ?? null, emojiCount: own.length, activeUploads: active?.n ?? 0 })
    if (problems.length) throw new HttpError(400, problems.join('；'))
    const fromReturned = sub.status === 'returned'
    const [row] = await tx
      .update(schema.submissions)
      .set({
        status: 'pending',
        submittedAt: new Date(),
        payload: { ...p, addEmojiIds: own.map((e) => e.id) },
        // a revised submission is based on the pack as it is now
        ...(fromReturned && sub.kind !== 'new_pack' ? { baseUpdatedAt: sql`(SELECT updated_at FROM packs WHERE id = ${sub.packId})` } : {}),
      })
      .where(and(eq(schema.submissions.id, id), inArray(schema.submissions.status, ['draft', 'returned'])))
      .returning({ id: schema.submissions.id })
    if (!row) throw new HttpError(409, '投稿状态已变化，请刷新后再试')
    await audit(actor, 'submission.submit', { type: 'submission', id }, { from: sub.status, emojis: own.length, mode }, tx)
    return sub.declaration
  })
  if (mode === 'trusted') {
    const r = await approveSubmission(actor, id, { downloadable: Boolean(declared?.downloadable) }, deps, { auto: true })
    return { status: 'approved', packId: r.packId, slug: r.slug }
  }
  return { status: 'pending' }
}

export async function withdrawSubmission(actor: Actor, id: string): Promise<void> {
  const sub = await loadSubmission(db(), id)
  assertOwner(actor, sub)
  const [row] = await db()
    .update(schema.submissions)
    .set({ status: 'withdrawn' })
    .where(and(eq(schema.submissions.id, id), eq(schema.submissions.submitterId, actor.id), inArray(schema.submissions.status, sourcesOf('withdrawn'))))
    .returning({ id: schema.submissions.id })
  if (!row) throw new HttpError(409, sub.status === 'returned' ? '已退回的投稿不能撤回，可以修改后重新提交' : '这条投稿已经结束，不能撤回')
  await audit(actor, 'submission.withdraw', { type: 'submission', id }, { from: sub.status })
}

export async function returnSubmission(actor: Actor, id: string, reason: string): Promise<void> {
  assertReviewer(actor)
  const note = clip(reason, TEXT_LIMITS.reason)
  if (!note) throw new HttpError(400, '请填写退回原因')
  await db().transaction(async (tx) => {
    const [row] = await tx
      .update(schema.submissions)
      .set({ status: 'returned', reviewerId: actor.id, reviewNote: note, decidedAt: new Date() })
      .where(and(eq(schema.submissions.id, id), inArray(schema.submissions.status, sourcesOf('returned'))))
      .returning()
    if (!row) throw new HttpError(409, '这条投稿不在待审核状态')
    const [pack] = await tx.select().from(schema.packs).where(eq(schema.packs.id, row.packId))
    const p = row.payload as ProposedPayload
    await notify(row.submitterId, 'submission.returned', { submissionId: id, packId: row.packId, slug: pack?.slug ?? '', title: (row.kind === 'add_emojis' ? pack?.title : p.title) || pack?.title || '', reason: note }, tx)
    await audit(actor, 'submission.return', { type: 'submission', id }, { reason: note }, tx)
  })
}

// ---------- approve ----------

export interface ApproveInput {
  /** the reviewer's 允许下载 confirmation; official packs are forced off */
  downloadable: boolean
  note?: string | null
}

export interface ApproveResult {
  packId: number
  slug: string
  published: string[]
  hidden: number
  downloadable: boolean
  derivatives: { ok: number; failed: number }
}

/** Unique pack slug from the title (pinyin), falling back to the pack key. */
async function packSlugFor(tx: Tx, title: string, pack: typeof schema.packs.$inferSelect): Promise<string> {
  const s = slugify(title)
  const base = s.startsWith('x-') ? pack.packKey : s
  const like = `${base}%`
  const taken = await tx.execute<{ slug: string }>(
    sql`SELECT slug FROM packs WHERE id <> ${pack.id} AND slug LIKE ${like}
        UNION SELECT substr(from_path, 8) AS slug FROM redirects WHERE from_path LIKE ${'/packs/' + like}`,
  )
  return claimSlug(base, new Set(taken.rows.map((r) => r.slug)))
}

/** Artist ids for typed names: an existing artist by name or alias, else a new one. */
async function resolveArtists(tx: Tx, names: string[]): Promise<number[]> {
  const { artists, artistAliases } = schema
  const ids: number[] = []
  for (const name of names) {
    const [hit] = await tx
      .select({ id: artists.id })
      .from(artists)
      .where(or(sql`lower(${artists.name}) = lower(${name})`, sql`EXISTS (SELECT 1 FROM ${artistAliases} aa WHERE aa.artist_id = ${artists.id} AND lower(aa.alias) = lower(${name}))`))
      .limit(1)
    if (hit) {
      ids.push(hit.id)
      continue
    }
    const base = slugify(name)
    const taken = await tx.execute<{ slug: string }>(sql`SELECT slug FROM artists WHERE slug LIKE ${base + '%'}`)
    const [row] = await tx
      .insert(artists)
      .values({ slug: claimSlug(base, new Set(taken.rows.map((r) => r.slug))), name })
      .returning({ id: artists.id })
    ids.push(row!.id)
  }
  return ids
}

async function recountTaxonomy(tx: Tx, characterIds: number[], artistIds: number[]) {
  if (characterIds.length) {
    const ids = sql.join(
      characterIds.map((i) => sql`${i}`),
      sql`, `,
    )
    await tx.execute(sql`
      UPDATE characters c SET
        pack_count = (SELECT count(*) FROM pack_characters pc JOIN packs p ON p.id = pc.pack_id AND p.status = 'published' WHERE pc.character_id = c.id),
        emoji_count = (SELECT count(*) FROM emoji_characters ec JOIN emojis e ON e.id = ec.emoji_id AND e.status = 'published'
                       JOIN packs p ON p.id = e.pack_id AND p.status = 'published' WHERE ec.character_id = c.id)
      WHERE c.id IN (${ids})`)
  }
  if (artistIds.length) {
    const ids = sql.join(
      artistIds.map((i) => sql`${i}`),
      sql`, `,
    )
    await tx.execute(sql`
      UPDATE artists a SET pack_count = (SELECT count(DISTINCT pa.pack_id) FROM pack_artists pa JOIN packs p ON p.id = pa.pack_id AND p.status = 'published' WHERE pa.artist_id = a.id)
      WHERE a.id IN (${ids})`)
  }
}

/**
 * 通过并发布: apply the payload in one transaction, then promote the review previews to derived/ and
 * queue the ZIP. `auto` is the trusted-submitter path (submitSubmission); it skips only the 'review'
 * permission check and is recorded as such.
 */
export async function approveSubmission(actor: Actor, id: string, input: ApproveInput, deps: SubmissionDeps = defaultDeps, opts: { auto?: boolean } = {}): Promise<ApproveResult> {
  if (!opts.auto) assertReviewer(actor)
  const { submissions, packs, emojis, packCharacters, packArtists } = schema
  const result = await db().transaction(async (tx) => {
    const sub = await loadSubmission(tx, id, true)
    if (opts.auto && sub.submitterId !== actor.id) throw new HttpError(403, '没有权限执行这个操作')
    if (sub.status !== 'pending') throw new HttpError(409, '这条投稿不在待审核状态')
    const [pack] = await tx.select().from(packs).where(eq(packs.id, sub.packId)).for('update')
    if (!pack) throw new HttpError(404, NOT_FOUND)
    if (sub.kind === 'new_pack') {
      if (pack.status !== 'draft') throw new HttpError(409, '这个包已经发布过了')
    } else {
      if (pack.status === 'draft') throw new HttpError(409, '这个包还没有发布')
      if (await isConflicted(tx, sub)) throw new HttpError(409, CONFLICT_MESSAGE)
    }
    const p = sub.payload as ProposedPayload
    const decl = sub.declaration
    const now = new Date()
    const official = sub.kind === 'new_pack' ? Boolean(p.official) : pack.sourceKind === 'official'
    const downloadable = official ? false : Boolean(input.downloadable)

    // 1. emojis: the submission's own pending ones become published, after the existing ones
    const own = await submissionEmojis(tx, sub, { order: p.addEmojiIds })
    const [{ max } = { max: -1 }] = await tx
      .select({ max: sql<number>`COALESCE(MAX(${emojis.sortOrder}), -1)::int` })
      .from(emojis)
      .where(and(eq(emojis.packId, pack.id), eq(emojis.status, 'published')))
    for (const [i, e] of own.entries()) {
      await tx
        .update(emojis)
        .set({ status: 'published', sortOrder: max + 1 + i })
        .where(and(eq(emojis.id, e.id), eq(emojis.status, 'pending'), eq(emojis.packId, pack.id)))
    }
    let hidden = 0
    if (sub.kind === 'edit_pack' && p.removeEmojiIds?.length) {
      const rows = await tx
        .update(emojis)
        .set({ status: 'hidden' })
        .where(and(eq(emojis.packId, pack.id), eq(emojis.status, 'published'), inArray(emojis.id, p.removeEmojiIds)))
        .returning({ id: emojis.id })
      hidden = rows.length
    }

    // 2. pack metadata, characters, artists
    const set: Partial<typeof packs.$inferInsert> = { downloadable }
    const touchedChars = new Set<number>()
    const touchedArtists = new Set<number>()
    if (sub.kind !== 'add_emojis') {
      const title = p.title?.trim() || pack.title
      Object.assign(set, {
        title,
        excerpt: p.excerpt ?? null,
        descriptionMd: p.descriptionMd ?? null,
        commissioner: p.commissioner ?? null,
        ...(decl?.license ? { license: decl.license } : {}),
      })
      if (sub.kind === 'new_pack') {
        Object.assign(set, { status: 'published', publishedAt: now, sourceKind: official ? 'official' : 'community', slug: await packSlugFor(tx, title, pack) })
      }
      if (p.characterIds) {
        const old = await tx.delete(packCharacters).where(eq(packCharacters.packId, pack.id)).returning({ id: packCharacters.characterId })
        old.forEach((c) => touchedChars.add(c.id))
        if (p.characterIds.length) await tx.insert(packCharacters).values(p.characterIds.map((characterId) => ({ packId: pack.id, characterId }))).onConflictDoNothing()
        p.characterIds.forEach((c) => touchedChars.add(c))
      }
      if (p.artistIds || p.artistNames?.length) {
        const ids = uniq([...(p.artistIds ?? []), ...(await resolveArtists(tx, p.artistNames ?? []))])
        const old = await tx
          .delete(packArtists)
          .where(and(eq(packArtists.packId, pack.id), eq(packArtists.role, 'artist')))
          .returning({ id: packArtists.artistId })
        old.forEach((a) => touchedArtists.add(a.id))
        if (ids.length) await tx.insert(packArtists).values(ids.map((artistId) => ({ packId: pack.id, artistId, role: 'artist' as const }))).onConflictDoNothing()
        ids.forEach((a) => touchedArtists.add(a))
      }
    }

    // 3. counters, kind and cover from what is published now
    const [stats] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        animated: sql<number>`count(*) FILTER (WHERE ${emojis.frames} > 1)::int`,
        first: sql<string | null>`(array_agg(${emojis.id} ORDER BY ${emojis.sortOrder}, ${emojis.id}))[1]`,
      })
      .from(emojis)
      .where(and(eq(emojis.packId, pack.id), eq(emojis.status, 'published')))
    const n = stats?.n ?? 0
    if (n === 0) throw new HttpError(400, '这个包发布后没有任何表情')
    set.emojiCount = n
    set.kind = stats!.animated === 0 ? 'static' : stats!.animated === n ? 'animated' : 'mixed'
    const wanted = p.coverEmojiId ?? pack.coverEmojiId
    const coverOk = wanted ? (await publishedInPack(tx, pack.id, [wanted])).size > 0 : false
    set.coverEmojiId = coverOk ? wanted : stats!.first
    await tx.update(packs).set(set).where(eq(packs.id, pack.id))
    // a new pack going public changes its characters' and artists' counts even without new links
    await recountTaxonomy(tx, [...touchedChars], [...touchedArtists])

    // 4. the submission itself, the notice and the audit row
    const [done] = await tx
      .update(submissions)
      .set({
        status: 'approved',
        reviewerId: opts.auto ? null : actor.id,
        reviewNote: clip(input.note, TEXT_LIMITS.reason),
        decidedAt: now,
        payload: { ...p, addEmojiIds: own.map((e) => e.id) },
      })
      .where(and(eq(submissions.id, id), inArray(submissions.status, sourcesOf('approved'))))
      .returning({ id: submissions.id })
    if (!done) throw new HttpError(409, '投稿状态已变化，请刷新后再试')
    const slug = (set.slug as string | undefined) ?? pack.slug
    const title = (set.title as string | undefined) ?? pack.title
    await notify(sub.submitterId, 'submission.approved', { submissionId: id, packId: pack.id, slug, title, auto: Boolean(opts.auto) }, tx)
    await audit(
      actor,
      'submission.approve',
      { type: 'submission', id },
      { kind: sub.kind, packId: pack.id, published: own.length, hidden, downloadable, official, auto: Boolean(opts.auto), submitterId: sub.submitterId },
      tx,
    )
    return { packId: pack.id, slug, published: own.map((e) => e.id), hidden, downloadable }
  })

  // after commit: review previews → derived/ (the emojis are published now), then the ZIP
  const derivatives = { ok: 0, failed: 0 }
  const queue = [...result.published]
  await Promise.all(
    Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (let emojiId = queue.shift(); emojiId; emojiId = queue.shift()) {
        try {
          await deps.publishDerivatives(emojiId)
          derivatives.ok++
        } catch (err) {
          derivatives.failed++
          log().error({ err: (err as Error).message, emojiId }, 'approve: publishing derivatives failed')
        }
      }
    }),
  )
  if (result.downloadable) {
    try {
      await deps.enqueueZip(result.packId)
    } catch (err) {
      log().error({ err: (err as Error).message, packId: result.packId }, 'approve: zip enqueue failed')
    }
  }
  return { ...result, derivatives }
}

// ---------- review queue ----------

export type ReviewTab = 'pending' | 'approved' | 'returned'

export interface ReviewCheck {
  ok: boolean
  label: string
}

export interface ReviewItem {
  id: string
  kind: SubmissionKind
  status: SubmissionStatus
  title: string
  pack: PackRef
  submitter: { id: string; name: string; approved: number }
  submittedAt: string | null
  decidedAt: string | null
  reviewNote: string | null
  declaration: SubmissionDeclaration | null
  payload: ProposedPayload
  official: boolean
  emojiCount: number
  images: EmojiView[]
  /** same-pack duplicates skipped at upload */
  duplicatesSkipped: number
  crossPack: { slug: string; title: string; status: string; count: number }[]
  checks: ReviewCheck[]
  diff: { field: string; from: string; to: string }[]
  conflict: boolean
  characters: string[]
  artists: string[]
}

export interface ReviewQueue {
  counts: Record<ReviewTab, number>
  items: ReviewItem[]
  page: number
  pages: number
}

const REVIEW_PAGE = 10

export async function listReviewQueue(actor: Actor, tab: ReviewTab, page = 0): Promise<ReviewQueue> {
  assertReviewer(actor)
  const d = db()
  const { submissions, packs, users } = schema
  const grouped = await d
    .select({ status: submissions.status, n: count() })
    .from(submissions)
    .where(inArray(submissions.status, ['pending', 'approved', 'returned']))
    .groupBy(submissions.status)
  const counts: Record<ReviewTab, number> = { pending: 0, approved: 0, returned: 0 }
  for (const g of grouped) counts[g.status as ReviewTab] = g.n
  const pages = Math.max(1, Math.ceil(counts[tab] / REVIEW_PAGE))
  const rows = await d
    .select({ sub: submissions, pack: packs, submitterName: users.name })
    .from(submissions)
    .innerJoin(packs, eq(packs.id, submissions.packId))
    .innerJoin(users, eq(users.id, submissions.submitterId))
    .where(eq(submissions.status, tab))
    .orderBy(tab === 'pending' ? asc(submissions.submittedAt) : desc(submissions.decidedAt), asc(submissions.id))
    .limit(REVIEW_PAGE)
    .offset(Math.max(0, page) * REVIEW_PAGE)
  const items = await Promise.all(rows.map((r) => reviewItem(d, r.sub, r.pack, r.submitterName, tab)))
  return { counts, items, page, pages }
}

async function reviewItem(d: ReturnType<typeof db>, sub: SubmissionRow, pack: typeof schema.packs.$inferSelect, submitterName: string, tab: ReviewTab): Promise<ReviewItem> {
  const p = sub.payload as ProposedPayload
  const own = await submissionEmojis(d, sub, { statuses: sub.status === 'approved' ? ['published'] : ['pending'], order: p.addEmojiIds })
  const [approved] = await d
    .select({ n: count() })
    .from(schema.submissions)
    .where(and(eq(schema.submissions.submitterId, sub.submitterId), eq(schema.submissions.status, 'approved')))
  const [dups] = await d
    .select({ n: count() })
    .from(schema.uploadItems)
    .where(and(eq(schema.uploadItems.submissionId, sub.id), eq(schema.uploadItems.status, 'duplicate')))
  const crossPack = tab === 'pending' ? await crossPackSummary(own) : []
  const official = sub.kind === 'new_pack' ? Boolean(p.official) : pack.sourceKind === 'official'
  const decl = sub.declaration ?? null
  const hasArtist = sub.kind === 'add_emojis' || Boolean(p.artistIds?.length || p.artistNames?.length)
  const checks: ReviewCheck[] = [
    { ok: (dups?.n ?? 0) === 0, label: dups?.n ? `本包内重复 ${dups.n} 张，已跳过` : '本包内无重复图片（SHA-256）' },
    { ok: crossPack.length === 0, label: crossPack.length ? `与其他包重复 ${crossPack.reduce((a, c) => a + c.count, 0)} 张` : '与其他包无重复' },
    { ok: hasArtist && Boolean(decl?.note?.trim()), label: '画师与授权已填写' },
    { ok: Boolean(decl?.proofUrl), label: decl?.proofUrl ? '已附授权凭证' : '未提供授权凭证' },
    official
      ? { ok: true, label: '官方表情：「允许下载」固定关闭' }
      : { ok: Boolean(decl?.license && decl.license !== 'unknown'), label: `许可：${licenseLabel(decl?.license)}` },
  ]
  const [charNames, artistNames] = await Promise.all([
    p.characterIds?.length
      ? d.select({ name: schema.characters.name }).from(schema.characters).where(inArray(schema.characters.id, p.characterIds))
      : Promise.resolve([]),
    p.artistIds?.length ? d.select({ name: schema.artists.name }).from(schema.artists).where(inArray(schema.artists.id, p.artistIds)) : Promise.resolve([]),
  ])
  return {
    id: sub.id,
    kind: sub.kind,
    status: sub.status,
    title: (sub.kind === 'add_emojis' ? pack.title : p.title?.trim()) || pack.title,
    pack: packRef(pack),
    submitter: { id: sub.submitterId, name: submitterName, approved: approved?.n ?? 0 },
    submittedAt: sub.submittedAt?.toISOString() ?? null,
    decidedAt: sub.decidedAt?.toISOString() ?? null,
    reviewNote: sub.reviewNote,
    declaration: decl,
    payload: p,
    official,
    emojiCount: own.length,
    images: own.map((e) => emojiView(e)),
    duplicatesSkipped: dups?.n ?? 0,
    crossPack,
    checks,
    diff: sub.kind === 'edit_pack' ? editDiff(pack, p) : [],
    conflict: tab === 'pending' ? await isConflicted(d, sub) : false,
    characters: charNames.map((c) => c.name),
    artists: [...artistNames.map((a) => a.name), ...(p.artistNames ?? [])],
  }
}

async function crossPackSummary(own: SubmissionEmojiRow[]): Promise<ReviewItem['crossPack']> {
  const byPack = new Map<string, { slug: string; title: string; status: string; count: number }>()
  const queue = own.filter((e) => e.sha256).map((e) => e.id)
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const hits = await findCrossPackDuplicates(id)
        const seen = new Set<number>()
        for (const h of hits) {
          if (seen.has(h.packId)) continue
          seen.add(h.packId)
          const prev = byPack.get(h.slug) ?? { slug: h.slug, title: h.title, status: h.packStatus, count: 0 }
          prev.count++
          byPack.set(h.slug, prev)
        }
      }
    }),
  )
  return [...byPack.values()].sort((a, b) => b.count - a.count)
}

function editDiff(pack: typeof schema.packs.$inferSelect, p: ProposedPayload): ReviewItem['diff'] {
  const out: ReviewItem['diff'] = []
  const cmp = (field: string, from: string | null | undefined, to: string | null | undefined) => {
    if (to === undefined) return
    if ((from ?? '') !== (to ?? '')) out.push({ field, from: from ?? '', to: to ?? '' })
  }
  cmp('标题', pack.title, p.title)
  cmp('简介', pack.excerpt, p.excerpt)
  cmp('约稿人', pack.commissioner, p.commissioner)
  if (p.descriptionMd !== undefined && (p.descriptionMd ?? '') !== (pack.descriptionMd ?? '')) out.push({ field: '详细介绍', from: '（旧版）', to: '（已修改）' })
  if (p.removeEmojiIds?.length) out.push({ field: '移除表情', from: '', to: `${p.removeEmojiIds.length} 张` })
  return out
}

/** Pending submissions for the admin badge and dashboard. */
export async function pendingCount(): Promise<number> {
  const [row] = await db().select({ n: count() }).from(schema.submissions).where(eq(schema.submissions.status, 'pending'))
  return row?.n ?? 0
}
