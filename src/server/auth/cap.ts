import { env } from '../env'
import { log } from '../log'

// Cap Standalone (self-hosted CAPTCHA). Tokens are single-use: the server deletes them on siteverify,
// so verify exactly once per protected action, before any side effect. Fail closed on any error.

export type CapResult = { ok: true } | { ok: false; reason: 'missing' | 'invalid' | 'unavailable' }

export interface CapVerifyDeps {
  fetch: typeof fetch
  endpoint: string
  secret: string
  timeoutMs: number
}

function defaultDeps(): CapVerifyDeps {
  const e = env()
  return { fetch: globalThis.fetch, endpoint: e.CAP_API_ENDPOINT, secret: e.CAP_SECRET_KEY, timeoutMs: 5000 }
}

export async function verifyCapToken(token: string | null | undefined, deps: CapVerifyDeps = defaultDeps()): Promise<CapResult> {
  if (!token || token.length > 512) return { ok: false, reason: 'missing' }
  const e = env()
  if (!deps.secret) {
    if (e.NODE_ENV !== 'production' && e.CAP_DISABLED) return { ok: true }
    log().error('cap: CAP_SECRET_KEY is not configured; rejecting')
    return { ok: false, reason: 'unavailable' }
  }
  const url = new URL('siteverify', deps.endpoint.endsWith('/') ? deps.endpoint : deps.endpoint + '/')
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: deps.secret, response: token }),
      signal: AbortSignal.timeout(deps.timeoutMs),
    })
    if (!res.ok && res.status >= 500) {
      log().warn({ status: res.status }, 'cap: siteverify server error')
      return { ok: false, reason: 'unavailable' }
    }
    const body = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
    if (body?.success === true) return { ok: true }
    return { ok: false, reason: 'invalid' }
  } catch (err) {
    log().warn({ err: (err as Error).message }, 'cap: siteverify unreachable')
    return { ok: false, reason: 'unavailable' }
  }
}

export const CAP_HEADER = 'x-cap-token'

export function capErrorMessage(reason: Exclude<CapResult, { ok: true }>['reason']): string {
  switch (reason) {
    case 'missing':
      return '请先完成人机验证'
    case 'invalid':
      return '人机验证已过期或无效，请重新验证'
    case 'unavailable':
      return '人机验证服务暂时不可用，请稍后再试'
  }
}
