import { getRequest } from '@tanstack/react-start/server'
import { z } from 'zod'
import type { Viewer } from '../auth/session'
import { CAP_HEADER } from '../auth/cap'
import { clientIp } from '../http/client'
import { HttpError } from '../perm/fn'
import type { RequestCtx } from './common'
import { CommentError } from './moderation'

// Glue between the server functions and the plain service functions: the request context (client IP,
// Cap header) and error mapping (CommentError / zod → HttpError with the status and a readable message).

export function requestCtx(viewer: Viewer | null): RequestCtx {
  const request = getRequest()
  return { viewer, ip: clientIp(request), capToken: request.headers.get(CAP_HEADER) }
}

export async function guard<T>(run: () => Promise<T> | T): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof CommentError) throw new HttpError(err.status, err.message)
    if (err instanceof z.ZodError) throw new HttpError(400, err.issues[0]?.message ?? '参数无效')
    throw err
  }
}
