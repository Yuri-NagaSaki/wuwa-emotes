import { eq } from 'drizzle-orm'
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
}

export interface ReviewImgDeps {
  getViewer(headers: Headers): Promise<Pick<Viewer, 'id' | 'role'> | null>
  lookupEmoji(emojiId: string): Promise<ReviewEmoji | null>
  getObject(key: string): Promise<ImgObject | null>
}

/** Reviewers see any preview; a pack owner sees previews of their own emojis until they are published. */
export function canViewReviewImage(viewer: Pick<Viewer, 'id' | 'role'> | null, packKey: string, row: ReviewEmoji | null): boolean {
  if (!viewer || !row) return false
  if (row.storagePackKey !== packKey) return false
  if (can(viewer.role, 'review')) return true
  return row.ownerId !== null && row.ownerId === viewer.id && row.status !== 'published'
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
  const rows = await db()
    .select({ status: schema.emojis.status, storagePackKey: schema.emojis.storagePackKey, ownerId: schema.packs.ownerId })
    .from(schema.emojis)
    .innerJoin(schema.packs, eq(schema.packs.id, schema.emojis.packId))
    .where(eq(schema.emojis.id, emojiId))
    .limit(1)
  return rows[0] ?? null
}
