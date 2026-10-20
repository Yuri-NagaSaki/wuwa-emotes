import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm'
import { isEmojiId } from '#/shared/ids'
import { db, schema } from '../db/client'
import type { FavoriteTarget } from '../db/schema'
import { imgUrl } from '../media/keys'
import { HttpError } from '../perm/fn'

// 收藏夹. Every favorite lives in a folder: the unique key (user, folder, target) treats NULL folders as
// distinct, so a NULL folder would allow duplicates. Each user gets a 默认收藏夹 on first use.
// toggleFavorite is the one entry point for the heart buttons on tiles, cards and the emoji dialog.
// packs.favorite_count counts users (not folders) and is updated in plain SQL with updated_at pinned,
// so a favorite never looks like an edit to the pack (submissions compare packs.updated_at).

type Tx = Parameters<Parameters<ReturnType<typeof db>['transaction']>[0]>[0]
type Runner = ReturnType<typeof db> | Tx

export const DEFAULT_FOLDER_NAME = '默认收藏夹'
export const MAX_FOLDERS = 50
export const FOLDER_NAME_MAX = 20

export interface FavoriteRef {
  type: FavoriteTarget
  /** pack id (as text) or emoji id */
  id: string
}

function cleanName(name: string): string {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, FOLDER_NAME_MAX)
  if (!n) throw new HttpError(400, '请填写收藏夹名称')
  return n
}

export async function ensureDefaultFolder(userId: string, tx?: Tx): Promise<number> {
  if (!tx) return db().transaction((t) => ensureDefaultFolder(userId, t))
  const { favoriteFolders: f } = schema
  const find = async () =>
    (await tx.select({ id: f.id }).from(f).where(and(eq(f.userId, userId), eq(f.isDefault, true))).orderBy(asc(f.id)).limit(1))[0]?.id
  const hit = await find()
  if (hit) return hit
  // serialise the first creation per user (two hearts clicked at once)
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'fav:' + userId}))`)
  const again = await find()
  if (again) return again
  const [row] = await tx.insert(f).values({ userId, name: DEFAULT_FOLDER_NAME, isDefault: true }).returning({ id: f.id })
  return row!.id
}

async function ownFolder(runner: Runner, userId: string, folderId: number) {
  const { favoriteFolders: f } = schema
  const [row] = await runner.select().from(f).where(and(eq(f.id, folderId), eq(f.userId, userId)))
  if (!row) throw new HttpError(404, '收藏夹不存在')
  return row
}

/** Only published targets can be favorited. */
async function assertTarget(runner: Runner, t: FavoriteRef) {
  const { packs, emojis } = schema
  if (t.type === 'pack') {
    const packId = Number(t.id)
    if (!Number.isInteger(packId) || packId <= 0) throw new HttpError(400, '无效的表情包')
    const [p] = await runner.select({ status: packs.status }).from(packs).where(eq(packs.id, packId))
    if (p?.status !== 'published') throw new HttpError(404, '这个表情包不存在或已下架')
  } else {
    if (!isEmojiId(t.id)) throw new HttpError(400, '无效的表情')
    const [e] = await runner
      .select({ status: emojis.status, packStatus: packs.status })
      .from(emojis)
      .innerJoin(packs, eq(packs.id, emojis.packId))
      .where(eq(emojis.id, t.id))
    if (e?.status !== 'published' || e.packStatus !== 'published') throw new HttpError(404, '这个表情不存在或已下架')
  }
}

async function bumpPackCount(runner: Runner, t: FavoriteRef, delta: 1 | -1) {
  if (t.type !== 'pack') return
  await runner.execute(sql`UPDATE packs SET favorite_count = GREATEST(favorite_count + ${delta}, 0) WHERE id = ${Number(t.id)}`)
}

async function isFavorited(runner: Runner, userId: string, t: FavoriteRef): Promise<boolean> {
  const { favorites: fv } = schema
  const [row] = await runner
    .select({ id: fv.id })
    .from(fv)
    .where(and(eq(fv.userId, userId), eq(fv.targetType, t.type), eq(fv.targetId, t.id)))
    .limit(1)
  return Boolean(row)
}

/**
 * Heart button: favorited anywhere → removed from every folder; otherwise added to `folderId` (or the
 * default folder). Returns the new state.
 */
export async function toggleFavorite(userId: string, t: FavoriteRef, folderId?: number): Promise<{ favorited: boolean }> {
  const { favorites: fv } = schema
  return db().transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`fav:${userId}:${t.type}:${t.id}`}))`)
    if (await isFavorited(tx, userId, t)) {
      await tx.delete(fv).where(and(eq(fv.userId, userId), eq(fv.targetType, t.type), eq(fv.targetId, t.id)))
      await bumpPackCount(tx, t, -1)
      return { favorited: false }
    }
    await assertTarget(tx, t)
    const folder = folderId ? (await ownFolder(tx, userId, folderId)).id : await ensureDefaultFolder(userId, tx)
    await tx.insert(fv).values({ userId, folderId: folder, targetType: t.type, targetId: t.id }).onConflictDoNothing()
    await bumpPackCount(tx, t, 1)
    return { favorited: true }
  })
}

/** Which of `targets` the user has favorited (for the hearts on a page of tiles or cards). */
export async function favoriteStatus(userId: string | null, targets: FavoriteRef[]): Promise<string[]> {
  if (!userId || !targets.length) return []
  const { favorites: fv } = schema
  const packs = targets.filter((t) => t.type === 'pack').map((t) => t.id)
  const emojis = targets.filter((t) => t.type === 'emoji').map((t) => t.id)
  const rows = await db()
    .selectDistinct({ type: fv.targetType, id: fv.targetId })
    .from(fv)
    .where(
      and(
        eq(fv.userId, userId),
        sql`(${packs.length ? sql`(${fv.targetType} = 'pack' AND ${inArray(fv.targetId, packs)})` : sql`false`} OR ${
          emojis.length ? sql`(${fv.targetType} = 'emoji' AND ${inArray(fv.targetId, emojis)})` : sql`false`
        })`,
      ),
    )
  return rows.map((r) => `${r.type}:${r.id}`)
}

// ---------- folders ----------

export interface FolderView {
  id: number
  name: string
  isDefault: boolean
  count: number
  /** up to three p240 posters */
  previews: string[]
}

export async function listFolders(userId: string): Promise<FolderView[]> {
  await ensureDefaultFolder(userId)
  const d = db()
  const { favoriteFolders: f, favorites: fv } = schema
  const folders = await d.select().from(f).where(eq(f.userId, userId)).orderBy(desc(f.isDefault), asc(f.id))
  const counts = await d.select({ folderId: fv.folderId, n: count() }).from(fv).where(eq(fv.userId, userId)).groupBy(fv.folderId)
  const byFolder = new Map(counts.map((c) => [c.folderId, c.n]))
  const previews = await folderPreviews(userId)
  return folders.map((x) => ({ id: x.id, name: x.name, isDefault: x.isDefault, count: byFolder.get(x.id) ?? 0, previews: previews.get(x.id) ?? [] }))
}

/** Three newest posters per folder (emoji favorites use the emoji, pack favorites the cover). */
async function folderPreviews(userId: string): Promise<Map<number, string[]>> {
  const rows = await db().execute<{ folder_id: number; id: string; pack_key: string; rev: number }>(sql`
    SELECT folder_id, id, pack_key, rev FROM (
      SELECT fv.folder_id, e.id, e.storage_pack_key AS pack_key, e.variant_rev AS rev,
             row_number() OVER (PARTITION BY fv.folder_id ORDER BY fv.id DESC) AS n
      FROM favorites fv
      LEFT JOIN packs p ON fv.target_type = 'pack' AND p.id = (CASE WHEN fv.target_type = 'pack' THEN fv.target_id::int END)
      JOIN emojis e ON e.id = (CASE WHEN fv.target_type = 'emoji' THEN fv.target_id ELSE p.cover_emoji_id END)
      WHERE fv.user_id = ${userId} AND e.status = 'published' AND e.derived_ready
    ) t WHERE n <= 3`)
  const out = new Map<number, string[]>()
  for (const r of rows.rows) {
    const list = out.get(r.folder_id) ?? []
    list.push(imgUrl({ variant: 'p240', packKey: r.pack_key, emojiId: r.id, rev: r.rev }))
    out.set(r.folder_id, list)
  }
  return out
}

export async function createFolder(userId: string, name: string): Promise<{ id: number }> {
  const d = db()
  const { favoriteFolders: f } = schema
  await ensureDefaultFolder(userId)
  const [n] = await d.select({ n: count() }).from(f).where(eq(f.userId, userId))
  if ((n?.n ?? 0) >= MAX_FOLDERS) throw new HttpError(400, `最多 ${MAX_FOLDERS} 个收藏夹`)
  const [row] = await d.insert(f).values({ userId, name: cleanName(name) }).returning({ id: f.id })
  return { id: row!.id }
}

export async function renameFolder(userId: string, folderId: number, name: string): Promise<void> {
  await ownFolder(db(), userId, folderId)
  await db().update(schema.favoriteFolders).set({ name: cleanName(name) }).where(eq(schema.favoriteFolders.id, folderId))
}

/** Delete a folder; its favorites move to the default folder (the default folder itself stays). */
export async function deleteFolder(userId: string, folderId: number): Promise<{ moved: number }> {
  return db().transaction(async (tx) => {
    const folder = await ownFolder(tx, userId, folderId)
    if (folder.isDefault) throw new HttpError(400, '默认收藏夹不能删除')
    const target = await ensureDefaultFolder(userId, tx)
    const moved = await moveAll(tx, userId, folderId, target)
    await tx.delete(schema.favoriteFolders).where(eq(schema.favoriteFolders.id, folderId))
    return { moved }
  })
}

/** Move a folder's favorites into another folder, merging targets that are already there. */
async function moveAll(tx: Tx, userId: string, from: number, to: number): Promise<number> {
  const res = await tx.execute(sql`
    UPDATE favorites fv SET folder_id = ${to}
    WHERE fv.user_id = ${userId} AND fv.folder_id = ${from}
      AND NOT EXISTS (SELECT 1 FROM favorites o WHERE o.user_id = fv.user_id AND o.folder_id = ${to}
                      AND o.target_type = fv.target_type AND o.target_id = fv.target_id)`)
  await tx.execute(sql`DELETE FROM favorites WHERE user_id = ${userId} AND folder_id = ${from}`)
  return res.rowCount ?? 0
}

// ---------- items ----------

export interface FavoriteItem {
  id: number
  type: FavoriteTarget
  targetId: string
  folderId: number
  createdAt: string
  /** p240 poster (emoji, or the pack cover) */
  poster: string | null
  preview: string | null
  title: string
  /** /packs/<slug> or /e/<emojiId> */
  href: string
  packSlug: string
  emojiCount: number | null
  format: string | null
}

const ITEMS_PAGE = 60

export async function listFavorites(userId: string, folderId: number, before?: number): Promise<{ items: FavoriteItem[]; more: boolean }> {
  await ownFolder(db(), userId, folderId)
  const rows = await db().execute<{
    id: number
    target_type: FavoriteTarget
    target_id: string
    folder_id: number
    created_at: Date
    e_id: string | null
    pack_key: string | null
    rev: number | null
    frames: number | null
    format: string | null
    ready: boolean | null
    title: string
    slug: string
    emoji_count: number
  }>(sql`
    SELECT fv.id, fv.target_type, fv.target_id, fv.folder_id, fv.created_at,
           e.id AS e_id, e.storage_pack_key AS pack_key, e.variant_rev AS rev, e.frames, e.format, e.derived_ready AS ready,
           p.title, p.slug, p.emoji_count
    FROM favorites fv
    JOIN packs p ON p.id = (CASE WHEN fv.target_type = 'pack' THEN fv.target_id::int
                                 ELSE (SELECT pack_id FROM emojis WHERE id = fv.target_id) END)
    LEFT JOIN emojis e ON e.id = (CASE WHEN fv.target_type = 'emoji' THEN fv.target_id ELSE p.cover_emoji_id END)
    WHERE fv.user_id = ${userId} AND fv.folder_id = ${folderId} ${before ? sql`AND fv.id < ${before}` : sql``}
      AND p.status = 'published' AND (fv.target_type = 'pack' OR e.status = 'published')
    ORDER BY fv.id DESC
    LIMIT ${ITEMS_PAGE + 1}`)
  const items = rows.rows.slice(0, ITEMS_PAGE).map((r): FavoriteItem => {
    const ref = r.e_id && r.pack_key && r.rev && r.ready ? { packKey: r.pack_key, emojiId: r.e_id, rev: r.rev } : null
    return {
      id: r.id,
      type: r.target_type,
      targetId: r.target_id,
      folderId: r.folder_id,
      createdAt: new Date(r.created_at).toISOString(),
      poster: ref ? imgUrl({ variant: 'p240', ...ref }) : null,
      preview: ref && (r.frames ?? 1) > 1 ? imgUrl({ variant: 'a160', ...ref }) : null,
      title: r.title,
      href: r.target_type === 'pack' ? `/packs/${r.slug}` : `/e/${r.target_id}`,
      packSlug: r.slug,
      emojiCount: r.target_type === 'pack' ? r.emoji_count : null,
      format: r.target_type === 'emoji' ? r.format : null,
    }
  })
  return { items, more: rows.rows.length > ITEMS_PAGE }
}

async function ownFavorite(runner: Runner, userId: string, favoriteId: number) {
  const { favorites: fv } = schema
  const [row] = await runner.select().from(fv).where(and(eq(fv.id, favoriteId), eq(fv.userId, userId)))
  if (!row) throw new HttpError(404, '收藏不存在')
  return row
}

export async function moveFavorite(userId: string, favoriteId: number, folderId: number): Promise<void> {
  const { favorites: fv } = schema
  await db().transaction(async (tx) => {
    const item = await ownFavorite(tx, userId, favoriteId)
    await ownFolder(tx, userId, folderId)
    if (item.folderId === folderId) return
    const [dupe] = await tx
      .select({ id: fv.id })
      .from(fv)
      .where(and(eq(fv.userId, userId), eq(fv.folderId, folderId), eq(fv.targetType, item.targetType), eq(fv.targetId, item.targetId)))
    if (dupe) await tx.delete(fv).where(eq(fv.id, item.id))
    else await tx.update(fv).set({ folderId }).where(eq(fv.id, item.id))
  })
}

/** Remove one favorite row; the pack counter drops only when no other folder still holds the target. */
export async function removeFavorite(userId: string, favoriteId: number): Promise<void> {
  const { favorites: fv } = schema
  await db().transaction(async (tx) => {
    const item = await ownFavorite(tx, userId, favoriteId)
    await tx.delete(fv).where(eq(fv.id, item.id))
    const ref = { type: item.targetType, id: item.targetId }
    if (!(await isFavorited(tx, userId, ref))) await bumpPackCount(tx, ref, -1)
  })
}

export async function favoriteTotal(userId: string): Promise<number> {
  const [row] = await db().select({ n: count() }).from(schema.favorites).where(eq(schema.favorites.userId, userId))
  return row?.n ?? 0
}
