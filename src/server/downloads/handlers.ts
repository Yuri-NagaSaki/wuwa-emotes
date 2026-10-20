import { z } from 'zod'
import { EMOJI_ID_RE, isEmojiId } from '#/shared/ids'
import { CAP_HEADER } from '../auth/cap'
import type { CreditsPack } from '../media/credits'
import { downloadFilename, type EmojiInfo, type PackInfo, type ZipState } from './lookup'
import { checkBatch, checkSingle, checkZip, type Denial, type DownloadSettings, MESSAGES, type PolicyDeps, type PolicyViewer, type RequestCtx } from './policy'

// /dl/e/:emojiId, /dl/p/:slug.zip and POST /api/batch/sign (docs/ARCHITECTURE.md §6.1). Each handler
// runs the policy, signs a 2-minute presigned GET and counts only what it signed. Every response is
// `Cache-Control: private, no-store`. Plain functions over a Request so tests can call them directly;
// src/routes/** passes the real dependencies (./deps).

export const NO_STORE = 'private, no-store'
export const LINK_SECONDS = 120
export const BATCH_MAX_IDS = 20
const MAX_BODY_BYTES = 8 * 1024

export interface DownloadDeps {
  policy: PolicyDeps
  /** origin of SITE_URL */
  siteOrigin(): string
  getViewer(headers: Headers): Promise<PolicyViewer | null>
  settings(): Promise<DownloadSettings>
  ipSubject(request: Request): string
  lookupEmojis(ids: string[]): Promise<Map<string, EmojiInfo>>
  lookupPackBySlug(slug: string): Promise<PackInfo | null>
  presign(key: string, opts: { filename?: string; inline?: boolean; expiresIn: number }): Promise<string>
  bumpPackDownloads(packId: number, n: number): Promise<void>
  zipState(packId: number): Promise<ZipState>
  enqueueZip(packId: number): Promise<void>
  credits(packs: PackInfo[]): Promise<Map<number, CreditsPack>>
  site(): Promise<{ siteName: string; siteUrl: string }>
}

// ---------- responses ----------

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': NO_STORE, 'x-content-type-options': 'nosniff', ...headers },
  })
}

function deny(d: Denial): Response {
  return json(d.body, d.status, d.body.retryAfter ? { 'retry-after': String(d.body.retryAfter) } : {})
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location, 'cache-control': NO_STORE } })
}

function methodNotAllowed(allow: string): Response {
  return json({ error: 'Method not allowed', reason: 'method_not_allowed' }, 405, { allow })
}

function badRequest(error = '请求参数不正确'): Response {
  return json({ error, reason: 'bad_request' }, 400)
}

/** fetch(…, { headers: { accept: 'application/json' } }) gets the signed URL as JSON instead of a 302. */
function wantsJson(request: Request): boolean {
  return (request.headers.get('accept') ?? '').toLowerCase().includes('application/json')
}

function requestCtx(request: Request, viewer: PolicyViewer | null, deps: DownloadDeps): RequestCtx {
  const url = new URL(request.url)
  return {
    viewer,
    ip: deps.ipSubject(request),
    referer: request.headers.get('referer'),
    siteOrigin: deps.siteOrigin(),
    capToken: request.headers.get(CAP_HEADER) || url.searchParams.get('cap') || null,
  }
}

// ---------- GET /dl/e/:emojiId?mode=view|save ----------

/**
 * 查看原图 (mode=view, inline) / 保存原图 (mode=save, attachment named like the ZIP entry).
 * 302 to a presigned GET, or 200 `{ url, filename, expiresIn }` for Accept: application/json.
 */
export async function handleEmojiDownload(request: Request, emojiId: string, deps: DownloadDeps): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const mode = new URL(request.url).searchParams.get('mode') ?? 'view'
  if (mode !== 'view' && mode !== 'save') return badRequest()
  if (!isEmojiId(emojiId)) return json({ error: MESSAGES.not_found, reason: 'not_found' }, 404)

  const [viewer, settings, infos] = await Promise.all([deps.getViewer(request.headers), deps.settings(), deps.lookupEmojis([emojiId])])
  const info = infos.get(emojiId) ?? null
  const check = await checkSingle(requestCtx(request, viewer, deps), settings, info, deps.policy)
  if (!check.ok) return deny(check.denial)

  const filename = downloadFilename(info!)
  const url = await deps.presign(info!.emoji.originalKey, { filename, inline: mode === 'view', expiresIn: LINK_SECONDS })
  await check.commit()
  // originals still under review are not public downloads
  if (!check.review) await deps.bumpPackDownloads(info!.pack.id, 1)
  return wantsJson(request) ? json({ url, filename, expiresIn: LINK_SECONDS }) : redirect(url)
}

// ---------- GET /dl/p/:slug.zip[?poll=1] ----------

/**
 * Whole-pack ZIP. Ready (zip_artifacts matches the pack's current content hash): count `zip`, then 302
 * (or 200 `{ status: 'ready', url, filename, bytes, expiresIn }` for Accept: application/json). Not built
 * or outdated: queue zip.build and answer 202 `{ status: 'building' }` without counting.
 * `?poll=1` only reports the state: 200 `{ status: 'ready' }` or 202, never signs and never counts.
 */
export async function handlePackZip(request: Request, slug: string, deps: DownloadDeps): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed('GET')
  const poll = new URL(request.url).searchParams.get('poll') === '1'
  if (!slug || slug.length > 200) return json({ error: MESSAGES.pack_not_found, reason: 'not_found' }, 404)
  const [viewer, settings, pack] = await Promise.all([deps.getViewer(request.headers), deps.settings(), deps.lookupPackBySlug(slug)])
  const check = await checkZip(requestCtx(request, viewer, deps), settings, pack, deps.policy)
  if (!check.ok) return deny(check.denial)

  const state = await deps.zipState(pack!.id)
  if (state.status === 'unavailable') {
    if (state.code === 'not_downloadable') return json({ error: MESSAGES.not_downloadable, reason: 'not_downloadable' }, 403)
    return json({ error: MESSAGES.pack_not_found, reason: 'not_found' }, 404)
  }
  if (state.status === 'stale') {
    // exclusive queue + singletonKey: repeated polls keep at most one build queued or running
    await deps.enqueueZip(pack!.id)
    return json({ status: 'building' }, 202, { 'retry-after': '5' })
  }
  if (poll) return json({ status: 'ready', bytes: state.bytes })

  const filename = `${pack!.slug}.zip`
  const url = await deps.presign(state.key, { filename, inline: false, expiresIn: LINK_SECONDS })
  await check.commit()
  await deps.bumpPackDownloads(pack!.id, 1)
  return wantsJson(request) ? json({ status: 'ready', url, filename, bytes: state.bytes, expiresIn: LINK_SECONDS }) : redirect(url)
}

// ---------- POST /api/batch/sign ----------

export const batchSignBody = z.object({
  volume: z.uuid(),
  first: z.boolean(),
  ids: z.array(z.string().regex(EMOJI_ID_RE)).min(1).max(BATCH_MAX_IDS),
})

export type BatchSignBody = z.infer<typeof batchSignBody>

/**
 * Server routes are not covered by Start's CSRF middleware (it only guards server functions), so the
 * route checks the origin itself: Origin when the browser sends one, else Referer; both missing fails.
 */
export function sameOrigin(request: Request, siteOrigin: string): boolean {
  const origin = request.headers.get('origin')
  if (origin) return origin === siteOrigin
  const referer = request.headers.get('referer')
  if (!referer) return false
  try {
    return new URL(referer).origin === siteOrigin
  } catch {
    return false
  }
}

export interface BatchSignResponse {
  volume: string
  /** this chunk opened the volume (counted as one pack for the IP) */
  newVolume: boolean
  items: { id: string; url: string; filename: string }[]
  denied: { id: string; reason: string }[]
  /** CREDITS.txt blocks for the packs in `items`; merge them by `slug` across chunks */
  credits: (CreditsPack & { slug: string })[]
  site: { siteName: string; siteUrl: string }
  expiresIn: number
  /** present when ids were held back by the minute rate: retry them after this many seconds */
  retryAfter?: number
}

/** One chunk (1–20 ids) of a batch volume; see checkBatch for what is counted. */
export async function handleBatchSign(request: Request, deps: DownloadDeps): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed('POST')
  if (!sameOrigin(request, deps.siteOrigin())) return json({ error: '请求来源不正确', reason: 'bad_origin' }, 403)
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) return badRequest()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return badRequest()
  }
  const parsed = batchSignBody.safeParse(raw)
  if (!parsed.success) return badRequest()
  const body = parsed.data
  const ids = [...new Set(body.ids)]

  const [viewer, settings, infos] = await Promise.all([deps.getViewer(request.headers), deps.settings(), deps.lookupEmojis(ids)])
  const candidates = ids.map((id) => ({ id, item: infos.get(id) ?? null }))
  const check = await checkBatch(requestCtx(request, viewer, deps), settings, candidates, body.volume, deps.policy)
  if (!check.ok) return deny(check.denial)

  const items = await Promise.all(
    check.allowed.map(async (id) => {
      const info = infos.get(id)!
      return { id, url: await deps.presign(info.emoji.originalKey, { expiresIn: LINK_SECONDS }), filename: downloadFilename(info) }
    }),
  )
  await check.commit()

  const packs = new Map<number, { pack: PackInfo; files: string[] }>()
  for (const item of items) {
    const pack = infos.get(item.id)!.pack
    const entry = packs.get(pack.id) ?? { pack, files: [] }
    entry.files.push(item.filename)
    packs.set(pack.id, entry)
  }
  const [blocks, site] = await Promise.all([deps.credits([...packs.values()].map((p) => p.pack)), deps.site()])
  const credits = [...packs.values()].map(({ pack, files }) => ({ ...blocks.get(pack.id)!, slug: pack.slug, files }))

  const res: BatchSignResponse = {
    volume: body.volume,
    newVolume: check.newVolume,
    items,
    denied: check.denied,
    credits,
    site,
    expiresIn: LINK_SECONDS,
    ...(check.retryAfter !== undefined ? { retryAfter: check.retryAfter } : {}),
  }
  return json(res)
}
