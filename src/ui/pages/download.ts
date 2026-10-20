// Client side of the download endpoints (src/server/downloads/handlers.ts):
//   GET /dl/e/:id?mode=view|save   查看原图 / 保存原图
//   GET /dl/p/:slug.zip            整包 ZIP (202 while it is being built; ?poll=1 only reports state)
//
// Approach: always fetch with `Accept: application/json`. The endpoint then answers 200
// { url, filename, … } instead of a 302, so the page gets the presigned link without following a
// cross-origin redirect (an opaque redirect would hide both the URL and every error). Then:
//   save / zip → navigate to the url (the presigned GET has Content-Disposition: attachment, so the
//                browser downloads it and stays on the page);
//   view       → the caller shows the url in an <img> (CSP img-src allows the storage origins).
// Errors are JSON { error, reason, retryAfter?, loginRaisesLimit?, needCaptcha? }:
//   428 needCaptcha → solve Cap invisibly once and repeat the request with &cap=<token>
//                     (not for captcha_unavailable, which a token cannot fix);
//   202 building    → poll ?poll=1 (Retry-After, at least 2 s) until ready, then request again
//                     without poll to sign; polls can themselves answer 428/429/403;
//   403/404/429     → a failure carrying the server's message (429 daily limit: loginRaisesLimit).
// Pure: fetch, sleep, Cap and navigation are injected, so tests run it against a stub server.

export type DownloadTarget = { kind: 'emoji'; id: string; mode: 'view' | 'save' } | { kind: 'zip'; slug: string }

export interface DownloadDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Cap invisible solve; resolves with a single-use token. */
  solveCap: () => Promise<string>
  /** Start the browser download (location.href = url). */
  navigate: (url: string) => void
  now?: () => number
}

export type DownloadEvent = { type: 'captcha' } | { type: 'building'; waitedMs: number }

export interface DownloadOptions {
  signal?: AbortSignal
  onEvent?: (e: DownloadEvent) => void
  /** Give up waiting for a ZIP build after this long (default 3 min). */
  maxWaitMs?: number
}

export type DownloadResult =
  | { ok: true; url: string; filename: string | null; bytes: number | null }
  | {
      ok: false
      status: number
      /** server reason (not_found, not_downloadable, login_required, paused, blocked, rate_limited,
       *  originals_daily_limit, packs_daily_limit, captcha_*), or network / timeout / bad_response */
      reason: string
      message: string
      retryAfter: number | null
      loginRaisesLimit: boolean
    }

interface ErrorBody {
  error?: string
  reason?: string
  retryAfter?: number
  loginRaisesLimit?: boolean
  needCaptcha?: boolean
}

const MIN_POLL_MS = 2000
const MAX_POLL_MS = 10_000

export const FALLBACK_MESSAGES: Record<string, string> = {
  network: '网络连接失败，请稍后再试',
  timeout: '整包还在生成中，请过一会儿再点一次',
  bad_response: '下载服务暂时不可用，请稍后再试',
  captcha_failed: '人机验证没有通过，请稍后再试',
}

export function downloadUrl(target: DownloadTarget, extra: Record<string, string> = {}): string {
  const base = target.kind === 'emoji' ? `/dl/e/${encodeURIComponent(target.id)}` : `/dl/p/${encodeURIComponent(target.slug)}.zip`
  const q = new URLSearchParams(target.kind === 'emoji' ? { mode: target.mode, ...extra } : extra).toString()
  return q ? `${base}?${q}` : base
}

function fail(status: number, reason: string, body: ErrorBody = {}): DownloadResult {
  return {
    ok: false,
    status,
    reason: body.reason ?? reason,
    message: body.error || FALLBACK_MESSAGES[reason] || FALLBACK_MESSAGES.bad_response!,
    retryAfter: typeof body.retryAfter === 'number' ? body.retryAfter : null,
    loginRaisesLimit: body.loginRaisesLimit === true,
  }
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const v = (await res.json()) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function retryAfterMs(res: Response, body: Record<string, unknown> | null): number {
  const header = Number(res.headers.get('retry-after'))
  const fromBody = typeof body?.retryAfter === 'number' ? body.retryAfter : NaN
  const s = Number.isFinite(header) && header > 0 ? header : Number.isFinite(fromBody) && fromBody > 0 ? fromBody : 0
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, s * 1000))
}

function isAbort(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError'
}

/**
 * Run one download. Resolves with the signed url (already navigated to for save/zip) or a failure.
 * Rejects only with an AbortError when `signal` aborts.
 */
export async function requestDownload(target: DownloadTarget, deps: DownloadDeps, opts: DownloadOptions = {}): Promise<DownloadResult> {
  const now = deps.now ?? Date.now
  const started = now()
  const maxWait = opts.maxWaitMs ?? 180_000
  let cap: string | null = null
  let capUsed = false
  let poll = false

  for (let step = 0; step < 500; step++) {
    opts.signal?.throwIfAborted()
    const extra: Record<string, string> = {}
    if (poll) extra.poll = '1'
    if (cap) extra.cap = cap
    const url = downloadUrl(target, extra)
    cap = null // single use

    let res: Response
    try {
      res = await deps.fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin', signal: opts.signal })
    } catch (err) {
      if (isAbort(err)) throw err
      return fail(0, 'network')
    }
    const body = await readJson(res)

    if (res.status === 200) {
      if (poll) {
        // ready: ask again without poll to get a signed link (this one is counted)
        if (body?.status === 'ready') {
          poll = false
          continue
        }
        return fail(res.status, 'bad_response')
      }
      const signed = typeof body?.url === 'string' ? body.url : null
      if (!signed) return fail(res.status, 'bad_response')
      if (target.kind === 'zip' || target.mode === 'save') deps.navigate(signed)
      return {
        ok: true,
        url: signed,
        filename: typeof body?.filename === 'string' ? body.filename : null,
        bytes: typeof body?.bytes === 'number' ? body.bytes : null,
      }
    }

    if (res.status === 202 && target.kind === 'zip') {
      const waited = now() - started
      if (waited >= maxWait) return fail(202, 'timeout')
      opts.onEvent?.({ type: 'building', waitedMs: waited })
      await deps.sleep(retryAfterMs(res, body), opts.signal)
      poll = true
      continue
    }

    const err = (body ?? {}) as ErrorBody
    if (res.status === 428 && err.needCaptcha) {
      if (err.reason === 'captcha_unavailable' || capUsed) return fail(428, 'captcha_failed', err)
      capUsed = true
      opts.onEvent?.({ type: 'captcha' })
      try {
        cap = await deps.solveCap()
      } catch (e) {
        if (isAbort(e)) throw e
        return fail(428, 'captcha_failed', { ...err, error: FALLBACK_MESSAGES.captcha_failed })
      }
      continue
    }

    if (!body) return fail(res.status, 'bad_response')
    return fail(res.status, 'bad_response', err)
  }
  return fail(0, 'bad_response')
}

/** WeChat / QQ in-app browsers cannot save ZIP files (§6.1): ask the user to open a real browser. */
export function isInAppBrowser(userAgent: string): boolean {
  // WeChat: "MicroMessenger/8.0"; QQ's in-app view: " QQ/9.0" (the standalone QQ 浏览器 is "MQQBrowser/…")
  return /MicroMessenger\//i.test(userAgent) || /(^|\s)QQ\/\d/.test(userAgent)
}

/** Abortable setTimeout for DownloadDeps.sleep. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
