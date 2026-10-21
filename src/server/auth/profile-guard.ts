import { APIError } from 'better-auth/api'

// users.image is the 头像 hash written by the avatar upload (src/server/account/avatar.ts) and nothing
// else. Better Auth would accept `image` from the browser on these endpoints and store any string, so
// the global before hook (src/server/auth/auth.ts) rejects every request that carries one, even null.
// Name changes through /update-user keep working.

/** Endpoints whose body may carry `image` directly. */
const TOP_LEVEL = new Set(['/update-user', '/sign-up/email'])
/** Admin endpoints that take user fields under `data`. */
const UNDER_DATA = new Set(['/admin/update-user', '/admin/create-user'])

const has = (v: unknown, key: string) => !!v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, key)

export function carriesImage(path: string, body: unknown): boolean {
  if (TOP_LEVEL.has(path)) return has(body, 'image')
  if (UNDER_DATA.has(path)) return has(body, 'data') && has((body as { data: unknown }).data, 'image')
  return false
}

/** Throws 400 when a Better Auth request tries to set users.image. */
export function guardProfileUpdate(ctx: { path?: string; body?: unknown }): void {
  if (ctx.path && carriesImage(ctx.path, ctx.body)) {
    throw new APIError('BAD_REQUEST', { code: 'IMAGE_NOT_ALLOWED', message: '头像请在「设置」里上传' })
  }
}
