import { and, eq, inArray, sql } from 'drizzle-orm'
import { db, schema } from '../db/client'
import { recomputeCatalogCounts } from '../import/v1'
import { sendJob } from '../jobs/boss'
import { Q } from '../jobs/queues'
import { purgeImgUrls } from '../media/purge'
import { deleteObjects } from '../media/s3'
import { afterCatalogWrite, many, type Runner } from './common'

// Bookkeeping shared by the pack, emoji, upload and taxonomy writes: counters, covers, redirects,
// ZIP freshness, and the queue/CDN side effects (injected so tests can observe them).

export interface MediaDeps {
  /** Cloudflare purge by URL (src/server/media/purge.ts). */
  purge(urls: string[]): Promise<{ purged: number; skipped: boolean }>
  /** zip.build, one queued-or-active job per pack. */
  enqueueZip(packId: number): Promise<void>
  /** media.derive; false when the exclusive singleton dropped the job (one already queued or running). */
  enqueueDerive(emojiId: string, target: 'review' | 'derived'): Promise<boolean>
  /** media.ingest for a finished browser upload. */
  enqueueIngest(uploadItemId: string): Promise<void>
}

export const defaultMediaDeps: MediaDeps = {
  purge: (urls) => purgeImgUrls(urls),
  async enqueueZip(packId) {
    await sendJob(Q.zipBuild, { packId }, { singletonKey: String(packId) })
  },
  async enqueueDerive(emojiId, target) {
    const id = await sendJob(Q.derive, { emojiId, target }, { singletonKey: emojiId })
    return id != null
  },
  async enqueueIngest(uploadItemId) {
    await sendJob(Q.ingest, { uploadItemId })
  },
}

/** Counters (packs.emoji_count, character/artist pack counts), then drop the catalog list cache. */
export async function refreshCounts() {
  await recomputeCatalogCounts()
  afterCatalogWrite()
}

/**
 * Point a renamed public path at its new home: old → new, earlier redirects to the old path follow
 * along, and a redirect sitting on the new path (an earlier rename the other way) is removed so the
 * two never loop.
 */
export async function moveRedirect(oldPath: string, newPath: string, runner: Runner = db()) {
  if (oldPath === newPath) return
  const { redirects } = schema
  await runner.delete(redirects).where(eq(redirects.fromPath, newPath))
  await runner.update(redirects).set({ toPath: newPath }).where(eq(redirects.toPath, oldPath))
  await runner
    .insert(redirects)
    .values({ fromPath: oldPath, toPath: newPath, code: 301 })
    .onConflictDoUpdate({ target: redirects.fromPath, set: { toPath: newPath, code: 301 } })
}

/**
 * Covers that no longer point at a published emoji of their pack move to the first published one
 * (or null). Plain SQL so packs.updated_at, the edit-submission base version, does not move.
 */
export async function fixCovers(packIds: number[], runner: Runner = db()) {
  if (!packIds.length) return
  await runner.execute(sql`
    UPDATE packs p SET cover_emoji_id = (
      SELECT e.id FROM emojis e WHERE e.pack_id = p.id AND e.status = 'published'
      ORDER BY e.sort_order, e.created_at, e.id LIMIT 1)
    WHERE p.id IN (${sql.join(packIds.map((id) => sql`${id}`), sql`, `)})
      AND (p.cover_emoji_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM emojis c WHERE c.id = p.cover_emoji_id AND c.pack_id = p.id AND c.status = 'published'))`)
}

/** Next sort_order at the end of a pack. */
export async function nextSortOrder(packId: number, runner: Runner = db()): Promise<number> {
  const [r] = await many<{ n: number }>(sql`SELECT COALESCE(MAX(sort_order) + 1, 0)::int AS n FROM emojis WHERE pack_id = ${packId}`, runner)
  return Number(r?.n ?? 0)
}

/**
 * Keep the pack ZIP in step with the pack: queue zip.build for packs that are published and
 * downloadable. The content hash covers entry names, order, originals and the CREDITS.txt text
 * (src/server/media/zip.ts), so the build skips packs whose ZIP is still current and /dl/p stops
 * serving an artifact whose hash no longer matches. Packs that are not downloadable keep their
 * artifact (downloads are refused anyway) and are rebuilt when they come back.
 */
export async function refreshZip(packIds: number[], deps: MediaDeps) {
  if (!packIds.length) return
  const { packs } = schema
  const live = await db()
    .select({ id: packs.id })
    .from(packs)
    .where(and(inArray(packs.id, packIds), eq(packs.status, 'published'), eq(packs.downloadable, true)))
  for (const p of live) await deps.enqueueZip(p.id)
}

/**
 * Takedown: the existing ZIP still contains the removed images, so delete the object and the artifact
 * now (a rebuild is skipped for empty or non-downloadable packs and would leave it in place), then
 * queue a fresh build where one applies.
 */
export async function dropZips(packIds: number[], deps: MediaDeps): Promise<string[]> {
  if (!packIds.length) return []
  const { zipArtifacts } = schema
  const rows = await db().select().from(zipArtifacts).where(inArray(zipArtifacts.packId, packIds))
  const keys = rows.map((r) => r.objectKey)
  if (keys.length) await deleteObjects(keys)
  if (rows.length) await db().delete(zipArtifacts).where(inArray(zipArtifacts.packId, rows.map((r) => r.packId)))
  await refreshZip(packIds, deps)
  return keys
}

/** Queued or running jobs of a queue for these singleton keys (pgboss.job, read-only). */
export async function busyJobs(queue: string, keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set()
  const rows = await many<{ k: string }>(sql`
    SELECT DISTINCT singleton_key AS k FROM pgboss.job
    WHERE name = ${queue} AND state IN ('created', 'retry', 'active')
      AND singleton_key IN (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`)
  return new Set(rows.map((r) => r.k))
}
