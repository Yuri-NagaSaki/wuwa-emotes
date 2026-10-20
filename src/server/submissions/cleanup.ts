import { and, eq, inArray, lt, ne, or, sql } from 'drizzle-orm'
import { audit } from '../audit'
import { db, schema } from '../db/client'
import { log } from '../log'
import { deleteEmojiFiles } from '../media/publish'
import { deleteObjects } from '../media/s3'
import { ACTIVE_UPLOAD } from './rules'
import { submissionEmojis } from './emojis'

// Daily cleanup (docs/ARCHITECTURE.md §5.2): submissions returned or withdrawn more than 30 days ago
// and drafts untouched for 90 days are deleted together with their files. Only the submission's own
// pending emojis are removed (see submissionEmojis); published emojis are never touched here.

export const RETURNED_TTL_DAYS = 30
export const DRAFT_TTL_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

export interface PurgeResult {
  emojis: number
  tmpObjects: number
  packDeleted: boolean
}

/**
 * Delete one unapproved submission: its pending emojis (original + review previews, then the rows),
 * leftover tmp uploads, the submission row (upload_items cascade) and, for new_pack, the draft pack
 * when nothing else refers to it. Object deletes run before the row deletes, so a crash leaves rows
 * that the next run retries rather than rows pointing at nothing.
 */
export async function purgeSubmission(sub: { id: string; packId: number; kind: string; status: string }): Promise<PurgeResult> {
  if (sub.status === 'approved') throw new Error(`purgeSubmission: ${sub.id} is approved`)
  const d = db()
  const { emojis, packs, submissions, uploadItems } = schema
  const own = await submissionEmojis(d, sub)
  for (const e of own) await deleteEmojiFiles({ id: e.id, storagePackKey: e.storagePackKey, originalKey: e.originalKey, variantRev: e.variantRev })
  const tmp = await d
    .select({ key: uploadItems.tmpKey })
    .from(uploadItems)
    .where(and(eq(uploadItems.submissionId, sub.id), inArray(uploadItems.status, [...ACTIVE_UPLOAD, 'failed'])))
  await deleteObjects(tmp.map((t) => t.key))

  let packDeleted = false
  await d.transaction(async (tx) => {
    if (own.length) {
      await tx.delete(emojis).where(and(inArray(emojis.id, own.map((e) => e.id)), eq(emojis.status, 'pending'), eq(emojis.packId, sub.packId)))
    }
    await tx.delete(submissions).where(and(eq(submissions.id, sub.id), ne(submissions.status, 'approved')))
    if (sub.kind === 'new_pack') {
      // the draft pack exists only for this submission; keep it if anything else points at it
      const rows = await tx
        .delete(packs)
        .where(
          and(
            eq(packs.id, sub.packId),
            eq(packs.status, 'draft'),
            sql`NOT EXISTS (SELECT 1 FROM ${submissions} s WHERE s.pack_id = ${packs.id})`,
            sql`NOT EXISTS (SELECT 1 FROM ${emojis} e WHERE e.pack_id = ${packs.id})`,
          ),
        )
        .returning({ id: packs.id })
      packDeleted = rows.length > 0
    }
  })
  return { emojis: own.length, tmpObjects: tmp.length, packDeleted }
}

export interface CleanupSummary {
  submissions: number
  emojis: number
  packs: number
  failed: number
}

/** The daily job (cleanup.daily). `now` is injectable for tests. */
export async function cleanupSubmissions(now = new Date()): Promise<CleanupSummary> {
  const { submissions } = schema
  const returnedBefore = new Date(now.getTime() - RETURNED_TTL_DAYS * DAY_MS)
  const draftBefore = new Date(now.getTime() - DRAFT_TTL_DAYS * DAY_MS)
  const due = await db()
    .select({ id: submissions.id, packId: submissions.packId, kind: submissions.kind, status: submissions.status, submitterId: submissions.submitterId })
    .from(submissions)
    .where(
      or(
        and(inArray(submissions.status, ['returned', 'withdrawn']), lt(submissions.updatedAt, returnedBefore)),
        and(eq(submissions.status, 'draft'), lt(submissions.updatedAt, draftBefore)),
      ),
    )
    .limit(500)
  const summary: CleanupSummary = { submissions: 0, emojis: 0, packs: 0, failed: 0 }
  for (const sub of due) {
    try {
      const r = await purgeSubmission(sub)
      summary.submissions++
      summary.emojis += r.emojis
      if (r.packDeleted) summary.packs++
      await audit(null, 'submission.cleanup', { type: 'submission', id: sub.id }, { status: sub.status, kind: sub.kind, submitterId: sub.submitterId, ...r })
    } catch (err) {
      summary.failed++
      log().error({ err: (err as Error).message, submissionId: sub.id }, 'cleanup: submission purge failed')
    }
  }
  if (due.length) log().info(summary, 'cleanup: submissions purged')
  return summary
}
