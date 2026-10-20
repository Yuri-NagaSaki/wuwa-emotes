import { createMiddleware } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { can, type Perm } from '#/shared/roles'
import { getViewer, type Viewer } from '../auth/session'

// Every server function declares one of these middlewares; tests/unit/server-fn-guard.test.ts
// fails the build if a createServerFn() chain has none. Menus only mirror these checks.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Marker for intentionally public server functions (still runs through CSRF protection). */
export const publicFn = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const viewer = await getViewer(getRequest().headers)
  return next({ context: { viewer } })
})

export const requireUser = createMiddleware({ type: 'function' }).server(async ({ next }) => {
  const viewer = await getViewer(getRequest().headers)
  if (!viewer) throw new HttpError(401, '请先登录')
  return next({ context: { viewer: viewer as Viewer } })
})

export function requirePerm(perm: Perm) {
  return createMiddleware({ type: 'function' }).server(async ({ next }) => {
    const viewer = await getViewer(getRequest().headers)
    if (!viewer) throw new HttpError(401, '请先登录')
    if (!can(viewer.role, perm)) throw new HttpError(403, '没有权限执行这个操作')
    return next({ context: { viewer: viewer as Viewer } })
  })
}
