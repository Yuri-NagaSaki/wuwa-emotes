import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Sharp } from 'sharp'
import { audit } from '../audit'
import type { Viewer } from '../auth/session'
import { db } from '../db/client'
import { log } from '../log'
import { IMMUTABLE } from '../media/img'
import { avatarKey, avatarKeys, avatarUrl, isAvatarHash } from '../media/keys'
import { deleteObjects, putObject } from '../media/s3'
import { HttpError } from '../perm/fn'
import { hitWindow } from '../ratelimit'
import { AVATAR_MAX_BYTES, sniffImage } from './avatar-input'

// 头像 (docs/ARCHITECTURE.md §7.2): the browser sends a square crop it already resized; the server
// re-encodes it with sharp to two content-addressed WebPs and keeps only the hash in users.image.
//
//   avatars/v1/<userId>/<hash>-256.webp and -64.webp, <hash> = first 16 hex of SHA-256(256 px output)
//
// Order on change: write both objects, swap users.image (row-locked, so concurrent changes each see the
// true previous value), then delete the previous pair. A failure before the swap leaves at most an
// unreferenced pair under the user's own prefix; the old avatar keeps working until the swap.
// This is the only sharp work in the web process: imported on first use, one image at a time.

export { AVATAR_MAX_BYTES } from './avatar-input'
/** sharp's limitInputPixels for the decoded input (a 2 MB PNG can still declare 100 MP). */
export const AVATAR_MAX_PIXELS = 25_000_000
/** Uploads per user per clock hour. Counted before decoding, so failed decodes count too. */
export const AVATAR_CHANGES_PER_HOUR = 10
const WEBP = { quality: 82, effort: 4 } as const

export type AvatarActor = Pick<Viewer, 'id' | 'role' | 'impersonatedBy'>

export interface AvatarDeps {
  /** Fixed-window counter (src/server/ratelimit.ts); returns the count after this hit. */
  hit(subject: string, bucket: string, windowSeconds: number): Promise<number>
  put(key: string, body: Buffer): Promise<void>
  remove(keys: string[]): Promise<void>
}

export const defaultAvatarDeps: AvatarDeps = {
  hit: (subject, bucket, windowSeconds) => hitWindow(subject, bucket, windowSeconds),
  put: (key, body) => putObject(key, body, 'image/webp', IMMUTABLE),
  remove: (keys) => deleteObjects(keys),
}

// ---- encoding ----

let sharpModule: Promise<typeof import('sharp')> | undefined
let queue: Promise<unknown> = Promise.resolve()

function loadSharp() {
  sharpModule ??= import('sharp').then((m) => {
    // the web process decodes at most one avatar at a time (see `serial`); keep libvips lean
    m.default.cache(false)
    m.default.concurrency(1)
    return m
  })
  return sharpModule
}

/** One avatar decode at a time per process: memory stays at one decoded image whatever the traffic. */
function serial<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work)
  queue = run.catch(() => {})
  return run
}

export interface AvatarRender {
  hash: string
  s256: Buffer
  s64: Buffer
}

/**
 * Decode the first frame (animations are flattened), apply EXIF orientation, cut a centred square and
 * write 256 and 64 px WebPs without metadata. Errors are user-facing 4xx.
 */
export async function renderAvatar(bytes: Uint8Array): Promise<AvatarRender> {
  const { default: sharp } = await loadSharp()
  return serial(async () => {
    let pipeline: Sharp
    try {
      pipeline = sharp(bytes, { limitInputPixels: AVATAR_MAX_PIXELS, animated: false, failOn: 'error' })
      const { data, info } = await pipeline.rotate().resize(256, 256, { fit: 'cover', position: 'centre' }).raw().toBuffer({ resolveWithObject: true })
      const raw = { raw: { width: info.width, height: info.height, channels: info.channels } }
      const s256 = await sharp(data, raw).webp(WEBP).toBuffer()
      const s64 = await sharp(data, raw).resize(64, 64).webp(WEBP).toBuffer()
      return { hash: createHash('sha256').update(s256).digest('hex').slice(0, 16), s256, s64 }
    } catch (err) {
      const message = (err as Error).message ?? ''
      if (/pixel limit/i.test(message)) throw new HttpError(413, '图片尺寸太大，请换一张小一些的图片')
      log().info({ err: message.slice(0, 200) }, 'avatar: decode failed')
      throw new HttpError(415, '无法读取这张图片，请换一张试试')
    }
  })
}

// ---- users.image ----

/** Set users.image and return the value it had (row-locked). Null when the user does not exist. */
export async function swapAvatarHash(userId: string, next: string | null): Promise<{ previous: string | null } | null> {
  const res = await db().execute(sql`
    with prev as (select id, image from users where id = ${userId} for update)
    update users u set image = ${next}, updated_at = now() from prev where u.id = prev.id
    returning prev.image as previous`)
  const row = res.rows[0] as { previous: string | null } | undefined
  return row ? { previous: row.previous ?? null } : null
}

/** Delete one avatar pair; a storage error is logged, never thrown (the row no longer points at it). */
export async function deleteAvatarFiles(userId: string, hash: string | null | undefined, deps: Pick<AvatarDeps, 'remove'> = defaultAvatarDeps): Promise<boolean> {
  if (!isAvatarHash(hash)) return false
  try {
    await deps.remove(avatarKeys(userId, hash))
    return true
  } catch (err) {
    log().warn({ err: (err as Error).message, userId }, 'avatar: could not delete the previous files')
    return false
  }
}

// ---- actions ----

export interface SetAvatarResult {
  avatarUrl: string
}

/** 更换头像 for the signed-in user. `bytes` is the uploaded file as received (≤ 2 MB, checked again here). */
export async function setAvatar(actor: AvatarActor, bytes: Uint8Array, deps: AvatarDeps = defaultAvatarDeps): Promise<SetAvatarResult> {
  if (bytes.byteLength > AVATAR_MAX_BYTES) throw new HttpError(413, '图片不能超过 2 MB')
  if (!sniffImage(bytes)) throw new HttpError(415, '只支持 PNG、JPG、WebP、GIF')
  if ((await deps.hit(`user:${actor.id}`, 'avatar', 3600)) > AVATAR_CHANGES_PER_HOUR) {
    throw new HttpError(429, `头像每小时最多更换 ${AVATAR_CHANGES_PER_HOUR} 次，请稍后再试`)
  }
  const out = await renderAvatar(bytes)
  await deps.put(avatarKey(actor.id, out.hash, 256), out.s256)
  await deps.put(avatarKey(actor.id, out.hash, 64), out.s64)
  const swapped = await swapAvatarHash(actor.id, out.hash)
  if (!swapped) {
    // the account was deleted meanwhile
    await deleteAvatarFiles(actor.id, out.hash, deps)
    throw new HttpError(401, '请先登录')
  }
  // re-uploading the same crop gives the same hash: the "previous" pair is the one just written
  if (swapped.previous !== out.hash) await deleteAvatarFiles(actor.id, swapped.previous, deps)
  await audit(actor, 'user.avatar', { type: 'user', id: actor.id }, { from: swapped.previous, to: out.hash })
  return { avatarUrl: avatarUrl(actor.id, out.hash, 256)! }
}

/** 移除头像: back to the letter. Not rate limited (always allowed). */
export async function removeAvatar(actor: AvatarActor, deps: Pick<AvatarDeps, 'remove'> = defaultAvatarDeps): Promise<{ removed: boolean }> {
  const swapped = await swapAvatarHash(actor.id, null)
  if (!swapped) throw new HttpError(401, '请先登录')
  if (swapped.previous == null) return { removed: false }
  await deleteAvatarFiles(actor.id, swapped.previous, deps)
  await audit(actor, 'user.avatar_remove', { type: 'user', id: actor.id }, { from: swapped.previous })
  return { removed: true }
}
