import { and, eq, sql } from 'drizzle-orm'
import { can } from '#/shared/roles'
import type { Viewer } from '../auth/session'
import { db, schema } from '../db/client'
import type { ImgObject } from '../media/img'
import { parseReviewImgPath, reviewKey } from '../media/keys'

// /review-img: previews of pending emojis (review/v1/), for the submitter and reviewers only.
// Never cached; every refusal is the same 404 so the route does not reveal what exists.

const NO_STORE = 'private, no-store'
const baseHeaders = { 'x-content-type-options': 'nosniff', 'cache-control': NO_STORE }

export interface ReviewEmoji {
  status: string
  storagePackKey: string
  ownerId: string | null
  /** who uploaded it (a 'done' upload_items row of the same pack); may differ from the pack owner */
  uploaderId?: string | null
}

export interface ReviewImgDeps {
  getViewer(headers: Headers): Promise<Pick<Viewer, 'id' | 'role'> | null>
  lookupEmoji(emojiId: string): Promise<ReviewEmoji | null>
  getObject(key: string): Promise<ImgObject | null>
}

/**
 * Reviewers see any preview; the pack owner and the uploader (e.g. a 补充表情 submission to someone
 * else's pack) see previews of the emoji until it is published.
 */
export function canViewReviewImage(viewer: Pick<Viewer, 'id' | 'role'> | null, packKey: string, row: ReviewEmoji | null): boolean {
  if (!viewer || !row) return false
  if (row.storagePackKey !== packKey) return false
  if (can(viewer.role, 'review')) return true
  if (row.status === 'published') return false
  return (row.ownerId != null && row.ownerId === viewer.id) || (row.uploaderId != null && row.uploaderId === viewer.id)
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { ...baseHeaders, 'content-type': 'text/plain' } })
}

export async function handleReviewImg(request: Request, deps: ReviewImgDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { ...baseHeaders, allow: 'GET, HEAD' } })
  }
  const ref = parseReviewImgPath(new URL(request.url).pathname)
  if (!ref) return notFound()
  const viewer = await deps.getViewer(request.headers)
  if (!viewer) return notFound()
  const row = await deps.lookupEmoji(ref.emojiId)
  if (!canViewReviewImage(viewer, ref.packKey, row)) return notFound()

  const obj = await deps.getObject(reviewKey(ref.variant, ref.packKey, ref.emojiId))
  if (!obj || obj.notModified) return notFound()
  const headers: Record<string, string> = { ...baseHeaders, 'content-type': 'image/webp' }
  if (obj.contentLength != null) headers['content-length'] = String(obj.contentLength)
  if (request.method === 'HEAD') {
    await obj.body?.cancel().catch(() => {})
    return new Response(null, { status: 200, headers })
  }
  return new Response(obj.body, { status: 200, headers })
}

export async function lookupReviewEmoji(emojiId: string): Promise<ReviewEmoji | null> {
  const { emojis, packs, uploadItems } = schema
  const rows = await db()
    .select({
      status: emojis.status,
      storagePackKey: emojis.storagePackKey,
      ownerId: packs.ownerId,
      // only the upload that created this emoji: duplicate rows also carry an emoji_id (the one they matched)
      uploaderId: sql<string | null>`(SELECT ${uploadItems.uploaderId} FROM ${uploadItems}
        WHERE ${and(eq(uploadItems.emojiId, emojis.id), eq(uploadItems.status, 'done'), eq(uploadItems.packId, emojis.packId))} LIMIT 1)`,
    })
    .from(emojis)
    .innerJoin(packs, eq(packs.id, emojis.packId))
    .where(eq(emojis.id, emojiId))
    .limit(1)
  return rows[0] ?? null
}
