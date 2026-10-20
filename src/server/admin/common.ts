import { type SQL, sql } from 'drizzle-orm'
import { isRole, type Role } from '#/shared/roles'
import type { Viewer } from '../auth/session'
import { clearCatalogCache } from '../catalog/cache'
import { db } from '../db/client'
import { reviewImgUrl, imgUrl } from '../media/keys'
import { HttpError } from '../perm/fn'

// Shared pieces of the admin implementations (src/server/admin/*.ts). The implementations take the
// acting viewer and their dependencies as arguments; the server functions in ./fns only add the
// permission middleware, input validation and the default dependencies.

/** Who performs an admin write: enough of the session viewer for permission checks and audit rows. */
export type Actor = Pick<Viewer, 'id' | 'name' | 'role' | 'impersonatedBy'>

export type Db = ReturnType<typeof db>
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
export type Runner = Db | Tx

/** 站长-only actions inside a permission shared with 管理员 (e.g. hard-deleting a pack). */
export function assertOwner(actor: Actor) {
  if (actor.role !== 'admin') throw new HttpError(403, '只有站长可以执行这个操作')
}

export function notFound(what: string): HttpError {
  return new HttpError(404, `${what}不存在或已被删除`)
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, message)
}

export function conflict(message: string): HttpError {
  return new HttpError(409, message)
}

export async function many<T>(query: SQL, runner: Runner = db()): Promise<T[]> {
  const res = await runner.execute(query)
  return res.rows as T[]
}

export async function one<T>(query: SQL, runner: Runner = db()): Promise<T | undefined> {
  return (await many<T>(query, runner))[0]
}

export function toNum(v: unknown): number {
  if (v == null) return 0
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

export function toIso(v: unknown): string | null {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function roleOf(value: unknown): Role {
  return isRole(value) ? value : 'user'
}

/** Admin writes should show up on the public site at once, not after the 30 s list cache. */
export function afterCatalogWrite() {
  clearCatalogCache()
}

export interface ThumbSource {
  id: string
  storagePackKey: string
  variantRev: number
  status: string
  derivedReady: boolean
  p240Bytes: number | null
}

/**
 * Poster for admin lists. Published and hidden emojis with derivatives use /img (hidden images stay
 * reachable there until a takedown deletes them); pending ones use the authenticated /review-img
 * preview once the worker has rendered it. Null when nothing has been rendered yet.
 */
export function thumbUrl(e: ThumbSource): string | null {
  if (e.status === 'pending') return e.p240Bytes != null ? reviewImgUrl('p240', e.storagePackKey, e.id) : null
  if (!e.derivedReady) return null
  return imgUrl({ variant: 'p240', packKey: e.storagePackKey, emojiId: e.id, rev: e.variantRev })
}

/** Same as thumbUrl, from a raw SQL row (snake_case columns). */
export function thumbFromRow(r: {
  id: string
  storage_pack_key: string
  variant_rev: number
  status: string
  derived_ready: boolean
  p240_bytes: number | null
}): string | null {
  return thumbUrl({
    id: r.id,
    storagePackKey: r.storage_pack_key,
    variantRev: toNum(r.variant_rev),
    status: r.status,
    derivedReady: Boolean(r.derived_ready),
    p240Bytes: r.p240_bytes == null ? null : toNum(r.p240_bytes),
  })
}

export const PAGE_SIZE = 20

export function pageOf(page: number | undefined, total: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(total / size))
  const p = Math.min(Math.max(1, page ?? 1), pages)
  return { page: p, pages, offset: (p - 1) * size, size }
}

/** ILIKE pattern for a user query (escapes % and _). */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

export { sql }
