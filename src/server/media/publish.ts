import { eq } from 'drizzle-orm'
import { db, schema } from '../db/client'
import { env } from '../env'
import { sendJob } from '../jobs/boss'
import { Q } from '../jobs/queues'
import { log } from '../log'
import { IMMUTABLE } from './img'
import { derivedKey, imgUrl, reviewKey, VARIANTS } from './keys'
import { copyObject, deleteObjects, headObject } from './s3'

// Review → publish and takedown (docs/ARCHITECTURE.md §3 rule 5, §5.2, §6.3).
// Pending emojis only have previews under review/v1/ (private). Approval copies them to
// derived/v1/<variant>/<storagePackKey>/<id>.r<rev>.webp, which /img serves with a one-year immutable
// cache, then deletes the review copies. Takedown deletes the original and every derived revision and
// returns the /img URLs so the caller can purge them from Cloudflare (purgeImgUrls).

export interface PublishDeps {
  /** render derived/ directly when there is no review copy to promote */
  enqueueDerived(emojiId: string): Promise<void>
}

export const defaultPublishDeps: PublishDeps = {
  async enqueueDerived(emojiId) {
    await sendJob(Q.derive, { emojiId, target: 'derived' }, { singletonKey: emojiId })
  },
}

export type PublishResult = 'copied' | 'queued'

/**
 * Promote review previews of a published emoji to derived/ (p240, plus a160 for animated emojis) and
 * mark it derived_ready. When the review copies are missing (derive never ran, or an animated emoji
 * lacks its a160), queue a derive job with target 'derived' instead; it sets derived_ready itself.
 * Refuses unpublished emojis: pending images must never reach derived/.
 */
export async function publishEmojiDerivatives(emojiId: string, deps: PublishDeps = defaultPublishDeps): Promise<PublishResult> {
  const { emojis } = schema
  const [e] = await db()
    .select({ id: emojis.id, status: emojis.status, packKey: emojis.storagePackKey, rev: emojis.variantRev, frames: emojis.frames })
    .from(emojis)
    .where(eq(emojis.id, emojiId))
  if (!e) throw new Error(`publish: emoji ${emojiId} not found`)
  if (e.status !== 'published') throw new Error(`publish: emoji ${emojiId} is ${e.status}; only published emojis go to derived/`)

  const review = { p240: reviewKey('p240', e.packKey, e.id), a160: reviewKey('a160', e.packKey, e.id) }
  const [p240, a160] = await Promise.all([headObject(review.p240), headObject(review.a160)])
  if (!p240 || (e.frames > 1 && !a160)) {
    await deps.enqueueDerived(e.id)
    await deleteObjects([review.p240, review.a160])
    log().info({ emojiId }, 'publish: no review previews; derive queued')
    return 'queued'
  }
  await copyObject(review.p240, derivedKey('p240', e.packKey, e.id, e.rev), 'image/webp', IMMUTABLE)
  if (a160) await copyObject(review.a160, derivedKey('a160', e.packKey, e.id, e.rev), 'image/webp', IMMUTABLE)
  await db().update(emojis).set({ derivedReady: true }).where(eq(emojis.id, e.id))
  await deleteObjects([review.p240, review.a160])
  return 'copied'
}

export interface EmojiFiles {
  id: string
  storagePackKey: string
  originalKey: string
  variantRev: number
}

/** Absolute URL on the public site for an /img path (Cloudflare purges by full URL). */
export function siteUrl(path: string): string {
  return env().SITE_URL.replace(/\/+$/, '') + path
}

/**
 * Delete every object of one emoji: the original, all derived variants of revisions 1..variant_rev and
 * the review previews. Pass the row (or its id while the row still exists). Returns the deleted keys and
 * the absolute /img URLs that may still sit in the CDN cache.
 */
export async function deleteEmojiFiles(emoji: string | EmojiFiles): Promise<{ deletedKeys: string[]; imgUrls: string[] }> {
  let e: EmojiFiles | undefined
  if (typeof emoji === 'string') {
    const { emojis } = schema
    ;[e] = await db()
      .select({ id: emojis.id, storagePackKey: emojis.storagePackKey, originalKey: emojis.originalKey, variantRev: emojis.variantRev })
      .from(emojis)
      .where(eq(emojis.id, emoji))
    if (!e) throw new Error(`deleteEmojiFiles: emoji ${emoji} not found`)
  } else e = emoji

  const keys = [e.originalKey]
  const imgUrls: string[] = []
  for (let rev = 1; rev <= e.variantRev; rev++) {
    for (const variant of VARIANTS) {
      keys.push(derivedKey(variant, e.storagePackKey, e.id, rev))
      imgUrls.push(siteUrl(imgUrl({ variant, packKey: e.storagePackKey, emojiId: e.id, rev })))
    }
  }
  keys.push(reviewKey('p240', e.storagePackKey, e.id), reviewKey('a160', e.storagePackKey, e.id))
  await deleteObjects(keys)
  return { deletedKeys: keys, imgUrls }
}
