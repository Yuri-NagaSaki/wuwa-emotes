import type { BatchSignResponse } from '#/server/downloads/handlers'
import { buildCreditsText, type CreditsPack, formatCreditsDate } from '#/server/media/credits'
import { FALLBACK_MESSAGES } from '../pages/download'
import { reasonText, SIGN_CHUNK, uniqueName, VOLUME_MAX } from './plan'

// Builds one batch ZIP (a "volume", ≤ 200 stickers) in the browser (docs/ARCHITECTURE.md §6.1):
//   sign a chunk of ≤ 20 ids (POST /api/batch/sign) → fetch those originals straight from storage
//   (presigned GETs, plain CORS requests) → stream them into the ZIP → sign the next chunk … → CREDITS.txt.
// Links live 2 minutes and every signing is counted, so a chunk is signed only when its turn comes.
// Server answers:
//   200 items      fetched; denied ids: not_found / not_downloadable → failed, rate_limited → retried
//                  after retryAfter, volume_full → the next volume, originals_daily_limit → stop
//   428            solve Cap invisibly once, repeat with the x-cap-token header
//   429 rate       wait retryAfter (a few times), then give up
//   403/429 other  stop (paused, blocked, login_required, daily limits) with the server's message
// A stop still finishes the ZIP with what was fetched. Pure: network, Cap, timers and the ZIP writer are
// injected (tests drive it against a stub server; the page passes fetch and client-zip).

export interface SignBody {
  volume: string
  first: boolean
  ids: string[]
}

export interface ZipEntry {
  name: string
  input: Blob | string
  lastModified?: Date
}

export interface RunnerDeps {
  /** POST /api/batch/sign (same origin, JSON); `capToken` goes into the x-cap-token header */
  sign(body: SignBody, opts: { capToken: string | null; signal?: AbortSignal }): Promise<Response>
  /** GET a presigned original. No custom headers: it must stay a simple CORS request (no preflight). */
  fetchFile(url: string, signal?: AbortSignal): Promise<Response>
  /** consume the entries into a ZIP (client-zip) */
  zip(entries: AsyncIterable<ZipEntry>): Promise<Blob>
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  /** Cap invisible solve; a single-use token */
  solveCap(): Promise<string>
  /** a fresh volume id (crypto.randomUUID) */
  uuid(): string
  now?(): Date
}

export type Phase = 'sign' | 'fetch' | 'wait' | 'captcha'

export interface Progress {
  phase: Phase
  /** ids of this volume handled so far (packed or failed) */
  done: number
  /** ids this volume tries */
  total: number
  /** original bytes packed so far */
  bytes: number
  /** phase 'wait': seconds until the next try */
  waitSeconds?: number
}

export interface Stop {
  reason: string
  message: string
  retryAfter: number | null
  loginRaisesLimit: boolean
}

export interface VolumeOptions {
  signal?: AbortSignal
  onProgress?: (p: Progress) => void
  /** originals fetched at once (default 4) */
  concurrency?: number
  /** rate-limit waits before giving up (default 6) */
  maxRateWaits?: number
}

export interface VolumeResult {
  /** the ZIP, or null when nothing could be packed */
  blob: Blob | null
  files: { id: string; name: string; bytes: number }[]
  failed: { id: string; reason: string; message: string }[]
  /** ids not tried, in order: the next volume's (or, after a stop, never packed) */
  rest: string[]
  stop: Stop | null
  /** CREDITS.txt as written into the ZIP ('' when there is no ZIP) */
  credits: string
}

const MAX_WAIT_S = 65

function isAbort(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError'
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const v = (await res.json()) as unknown
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function stopFrom(status: number, body: Record<string, unknown> | null, fallback = 'bad_response'): Stop {
  const reason = typeof body?.reason === 'string' ? body.reason : fallback
  const message = typeof body?.error === 'string' && body.error ? body.error : (FALLBACK_MESSAGES[reason] ?? FALLBACK_MESSAGES.bad_response!)
  return {
    reason: status === 0 ? fallback : reason,
    message,
    retryAfter: typeof body?.retryAfter === 'number' ? body.retryAfter : null,
    loginRaisesLimit: body?.loginRaisesLimit === true,
  }
}

function waitSeconds(res: Response | null, body: Record<string, unknown> | null): number {
  const header = Number(res?.headers.get('retry-after'))
  const fromBody = typeof body?.retryAfter === 'number' ? body.retryAfter : NaN
  const s = Number.isFinite(fromBody) && fromBody > 0 ? fromBody : Number.isFinite(header) && header > 0 ? header : 5
  return Math.min(MAX_WAIT_S, Math.max(1, Math.ceil(s)))
}

/** Build one volume from the front of `ids` (at most VOLUME_MAX of them). Rejects only with AbortError. */
export async function buildVolume(ids: readonly string[], deps: RunnerDeps, opts: VolumeOptions = {}): Promise<VolumeResult> {
  const { signal } = opts
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  const maxRateWaits = opts.maxRateWaits ?? 6
  const now = deps.now ?? (() => new Date())
  const volume = deps.uuid()
  const work = [...new Set(ids)]
  const queue = work.splice(0, VOLUME_MAX)
  const total = queue.length

  const files: VolumeResult['files'] = []
  const failed: VolumeResult['failed'] = []
  const taken = new Set<string>(['CREDITS.txt'])
  const packOrder: string[] = []
  const blocks = new Map<string, CreditsPack>()
  const filesBySlug = new Map<string, string[]>()
  // mutable run state in one object (closures below update it)
  const st = {
    rest: work,
    stop: null as Stop | null,
    site: null as BatchSignResponse['site'] | null,
    first: true,
    rateWaits: 0,
    bytes: 0,
    credits: '',
  }
  const progress = (phase: Phase, extra: Partial<Progress> = {}) =>
    opts.onProgress?.({ phase, done: files.length + failed.length, total, bytes: st.bytes, ...extra })
  const fail = (id: string, reason: string) => failed.push({ id, reason, message: reasonText(reason) })

  async function wait(seconds: number) {
    for (let s = seconds; s > 0; s--) {
      progress('wait', { waitSeconds: s })
      await deps.sleep(1000, signal)
    }
  }

  /** One sign request with its retries; the parsed body, or a stop. */
  async function sign(chunk: string[]): Promise<{ body: BatchSignResponse } | { stop: Stop }> {
    let cap: string | null = null
    let capUsed = false
    let netTries = 0
    for (;;) {
      signal?.throwIfAborted()
      progress('sign')
      let res: Response
      try {
        res = await deps.sign({ volume, first: st.first, ids: chunk }, { capToken: cap, signal })
      } catch (err) {
        if (isAbort(err)) throw err
        if (netTries++ < 1) {
          await deps.sleep(2000, signal)
          continue
        }
        return { stop: stopFrom(0, null, 'network') }
      }
      cap = null
      const body = await readJson(res)
      if (res.status === 200 && body && Array.isArray(body.items) && Array.isArray(body.denied)) return { body: body as unknown as BatchSignResponse }
      if (res.status === 428 && body?.needCaptcha) {
        if (body.reason === 'captcha_unavailable' || capUsed) return { stop: { ...stopFrom(428, body), reason: 'captcha_failed' } }
        capUsed = true
        progress('captcha')
        try {
          cap = await deps.solveCap()
        } catch (err) {
          if (isAbort(err)) throw err
          return { stop: { reason: 'captcha_failed', message: FALLBACK_MESSAGES.captcha_failed!, retryAfter: null, loginRaisesLimit: false } }
        }
        continue
      }
      if (res.status === 429 && body?.reason === 'rate_limited' && st.rateWaits < maxRateWaits) {
        st.rateWaits++
        await wait(waitSeconds(res, body))
        continue
      }
      return { stop: stopFrom(res.status, body) }
    }
  }

  type Fetched = { id: string; filename: string; ok: true; blob: Blob } | { id: string; filename: string; ok: false }

  async function fetchOne(item: { id: string; url: string; filename: string }): Promise<Fetched> {
    for (let attempt = 0; attempt < 2; attempt++) {
      signal?.throwIfAborted()
      try {
        const res = await deps.fetchFile(item.url, signal)
        if (res.ok) return { id: item.id, filename: item.filename, ok: true, blob: await res.blob() }
        // 403 from storage: the link expired or was refused; a retry of the same link will not help
        if (res.status === 403) break
      } catch (err) {
        if (isAbort(err)) throw err
      }
    }
    return { id: item.id, filename: item.filename, ok: false }
  }

  async function* entries(): AsyncGenerator<ZipEntry> {
    const pending = [...queue]
    while (pending.length && !st.stop) {
      const chunk = pending.splice(0, SIGN_CHUNK)
      const r = await sign(chunk)
      if ('stop' in r) {
        st.stop = r.stop
        st.rest = [...chunk, ...pending, ...st.rest]
        pending.length = 0
        break
      }
      st.first = false
      const body = r.body
      st.site = body.site
      const slugOf = new Map<string, string>()
      for (const c of body.credits ?? []) {
        const { files: names, slug, ...block } = c
        if (!blocks.has(slug)) {
          blocks.set(slug, block)
          packOrder.push(slug)
        }
        for (const n of names ?? []) slugOf.set(n, slug)
      }

      const retry: string[] = []
      const deferred: string[] = []
      const heldByDay: string[] = []
      for (const d of body.denied) {
        if (d.reason === 'rate_limited') retry.push(d.id)
        else if (d.reason === 'volume_full') deferred.push(d.id)
        else if (d.reason === 'originals_daily_limit') heldByDay.push(d.id)
        else fail(d.id, d.reason)
      }

      // fetch the signed originals a few at a time; hand them to the ZIP in order
      const items = body.items
      const running: Promise<Fetched>[] = []
      let next = 0
      const launch = () => {
        while (running.length < concurrency && next < items.length) {
          const p = fetchOne(items[next++]!)
          p.catch(() => {}) // an abort rejects every running fetch; the first one is rethrown below
          running.push(p)
        }
      }
      launch()
      progress('fetch')
      while (running.length) {
        const got = await running.shift()!
        launch()
        if (got.ok) {
          const name = uniqueName(got.filename, taken)
          files.push({ id: got.id, name, bytes: got.blob.size })
          st.bytes += got.blob.size
          const slug = slugOf.get(got.filename)
          if (slug) filesBySlug.set(slug, [...(filesBySlug.get(slug) ?? []), name])
          progress('fetch')
          yield { name, input: got.blob, lastModified: now() }
        } else {
          fail(got.id, 'fetch_failed')
          progress('fetch')
        }
      }

      if (heldByDay.length) {
        st.stop = { reason: 'originals_daily_limit', message: '今天下载得有点多，明天 0 点恢复', retryAfter: null, loginRaisesLimit: false }
        st.rest = [...heldByDay, ...retry, ...deferred, ...pending, ...st.rest]
        pending.length = 0
        break
      }
      if (deferred.length) {
        // the site's 单次打包张数上限 is reached: close this ZIP, the rest goes into the next one.
        // Nothing packed at all means the limit leaves no room (0): stop rather than loop.
        if (!files.length) st.stop = { reason: 'volume_full', message: '已达到单次打包张数上限，暂时无法打包', retryAfter: null, loginRaisesLimit: false }
        st.rest = [...deferred, ...retry, ...pending, ...st.rest]
        pending.length = 0
        break
      }
      if (retry.length) {
        if (st.rateWaits >= maxRateWaits) {
          st.stop = { reason: 'rate_limited', message: '操作太频繁，请稍后再试', retryAfter: body.retryAfter ?? null, loginRaisesLimit: false }
          st.rest = [...retry, ...pending, ...st.rest]
          pending.length = 0
          break
        }
        st.rateWaits++
        await wait(waitSeconds(null, { retryAfter: body.retryAfter }))
        pending.unshift(...retry)
      }
    }
    st.credits = creditsText()
    yield { name: 'CREDITS.txt', input: st.credits, lastModified: now() }
  }

  function creditsText(): string {
    const packs = packOrder.filter((s) => filesBySlug.has(s)).map((s) => ({ ...blocks.get(s)!, files: filesBySlug.get(s)! }))
    return buildCreditsText({
      siteName: st.site?.siteName ?? '',
      siteUrl: st.site?.siteUrl ?? '',
      date: formatCreditsDate(now()),
      packs,
    })
  }

  const blob = await deps.zip(entries())
  const packed = files.length > 0
  return { blob: packed ? blob : null, files, failed, rest: st.rest, stop: st.stop, credits: packed ? st.credits : '' }
}
