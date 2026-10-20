import { and, asc, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/client'
import type { EmojiStatus } from '../db/schema'
import { imgUrl, reviewImgUrl } from '../media/keys'

// Which emojis belong to a submission. upload_items.emoji_id alone is not enough: a same-pack
// duplicate row points at the emoji it duplicated, which may be published or someone else's. A
// submission owns exactly the emojis of its own 'done' uploads that live in its pack.

type Runner = ReturnType<typeof db> | Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0]

export interface SubmissionEmojiRow {
  id: string
  uploadId: string
  status: EmojiStatus
  storagePackKey: string
  originalKey: string
  variantRev: number
  format: string
  bytes: number
  width: number | null
  height: number | null
  frames: number
  p240Bytes: number | null
  a160Bytes: number | null
  derivedReady: boolean
  sha256: string | null
}

/**
 * The submission's emojis with the given statuses (default: still pending), in display order:
 * `order` first (payload.addEmojiIds), then upload order.
 */
export async function submissionEmojis(
  runner: Runner,
  sub: { id: string; packId: number },
  opts: { statuses?: EmojiStatus[]; order?: readonly string[] } = {},
): Promise<SubmissionEmojiRow[]> {
  const { uploadItems: u, emojis: e } = schema
  const rows = await runner
    .select({
      id: e.id,
      uploadId: u.id,
      status: e.status,
      storagePackKey: e.storagePackKey,
      originalKey: e.originalKey,
      variantRev: e.variantRev,
      format: e.format,
      bytes: e.bytes,
      width: e.width,
      height: e.height,
      frames: e.frames,
      p240Bytes: e.p240Bytes,
      a160Bytes: e.a160Bytes,
      derivedReady: e.derivedReady,
      sha256: e.sha256,
    })
    .from(u)
    .innerJoin(e, eq(e.id, u.emojiId))
    .where(and(eq(u.submissionId, sub.id), eq(u.status, 'done'), eq(e.packId, sub.packId), inArray(e.status, opts.statuses ?? ['pending'])))
    .orderBy(asc(u.createdAt), asc(u.id))
  return sortByOrder(rows, opts.order)
}

export function sortByOrder<T extends { id: string }>(rows: T[], order: readonly string[] | undefined): T[] {
  if (!order?.length) return rows
  const pos = new Map(order.map((id, i) => [id, i]))
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (pos.get(a.r.id) ?? order.length + a.i) - (pos.get(b.r.id) ?? order.length + b.i))
    .map((x) => x.r)
}

export interface EmojiView {
  id: string
  /** upload row, for remove */
  uploadId?: string
  format: string
  frames: number
  width: number | null
  height: number | null
  bytes: number
  /** static poster (p240) or null while it is being generated */
  poster: string | null
  /** animated preview (a160) for animated emojis */
  preview: string | null
}

/** Preview URLs: pending emojis through /review-img (private), published ones through /img. */
export function emojiView(r: Pick<SubmissionEmojiRow, 'id' | 'status' | 'storagePackKey' | 'variantRev' | 'format' | 'frames' | 'width' | 'height' | 'bytes' | 'p240Bytes' | 'a160Bytes' | 'derivedReady'> & { uploadId?: string }): EmojiView {
  let poster: string | null = null
  let preview: string | null = null
  if (r.status === 'published') {
    if (r.derivedReady) {
      poster = imgUrl({ variant: 'p240', packKey: r.storagePackKey, emojiId: r.id, rev: r.variantRev })
      if (r.frames > 1) preview = imgUrl({ variant: 'a160', packKey: r.storagePackKey, emojiId: r.id, rev: r.variantRev })
    }
  } else if (r.p240Bytes != null) {
    poster = reviewImgUrl('p240', r.storagePackKey, r.id)
    if (r.frames > 1 && r.a160Bytes != null) preview = reviewImgUrl('a160', r.storagePackKey, r.id)
  }
  return {
    id: r.id,
    uploadId: r.uploadId,
    format: r.format,
    frames: r.frames,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    poster,
    preview,
  }
}
