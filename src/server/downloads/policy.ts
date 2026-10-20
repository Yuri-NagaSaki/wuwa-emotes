import { can } from '#/shared/roles'
import { type CapResult, capErrorMessage } from '../auth/cap'
import type { CounterKind } from '../db/schema/downloads'
import { formatCreditsDate } from '../media/credits'
import type { SettingValue } from '../settings'

// Download policy (docs/ARCHITECTURE.md §6.1–6.2). No database, network or env access here: every
// fact comes in through PolicyDeps, so the decision table is unit-tested with in-memory fakes and the
// routes pass the PostgreSQL-backed deps from ./store.
//
// Order for every signing:
//   1. downloadable    emoji and pack published and the pack's 「允许下载」 on. Originals still under
//                      review (emoji status pending) only for the pack owner or a reviewer (perm review),
//                      and pack.downloadable is not required for them (new packs start with it off).
//   2. switches        originalsRequireLogin (guests get nothing), pauseZipAndBatch (no ZIP, no batch).
//   3. sources         blocked_sources: block → 403, watch → challenge (rows past `until` are ignored).
//      suspicious      only with challengeSuspicious on: a missing or foreign Referer on /dl, or a burst
//                      of BURST_DISTINCT distinct emoji ids from one IP within a BURST_WINDOW_S fixed
//                      window on /dl/e → challenge. A challenge needs a Cap token (x-cap-token header or
//                      ?cap=), verified once; a valid token clears challenges for that IP for
//                      CLEAR_SECONDS (stored in PostgreSQL so both web replicas see it).
//   4. rates           per IP and minute, separate buckets: singleSignsPerMinute for /dl/e,
//                      batchItemsPerMinute (amount = items) for /api/batch/sign. /dl/p has no minute rate.
//   5. daily limits    Asia/Shanghai days. Originals (orig + batch_item) count per account for signed-in
//                      users (perUserOriginalsPerDay) and per IP for guests (perIpOriginalsPerDay). Packs
//                      (zip + batch, one per batch volume) always count per IP (perIpPacksPerDay).
//                      maxBatchItems caps one batch volume.
// A null setting means unlimited: the check is skipped and nothing is read or written for it.
// Counting happens only when a signing is allowed (Check.commit), never for refused requests.

export type DownloadSettings = SettingValue<'downloads'>

export const BURST_DISTINCT = 30
export const BURST_WINDOW_S = 300
export const CLEAR_SECONDS = 600
export const RATE_WINDOW_S = 60
export const SINGLE_BUCKET = 'dl:single'
export const BATCH_BUCKET = 'dl:batch'

export interface PolicyViewer {
  id: string
  role: string
}

export interface PolicyEmoji {
  id: string
  status: string
}

export interface PolicyPack {
  id: number
  status: string
  downloadable: boolean
  ownerId: string | null
}

export interface PolicyItem {
  emoji: PolicyEmoji
  pack: PolicyPack
}

export interface SourceEntry {
  subject: string
  mode: 'block' | 'watch'
  until: Date | null
}

export type Feature = 'burst' | 'noref' | 'throttled'

export interface VolumeState {
  /** items already signed for this volume */
  signed: number
  /** opaque storage handle passed back to addVolume */
  since: Date
}

export interface PolicyDeps {
  now(): Date
  /** blocked_sources rows for these subjects (expired ones included; the policy checks `until`) */
  sources(subjects: string[]): Promise<SourceEntry[]>
  /** add `amount` to a fixed window and return the total after the hit plus seconds until the window ends */
  hitRate(subject: string, bucket: string, windowSeconds: number, amount: number): Promise<{ n: number; retryAfter: number }>
  /** today's counters of one subject */
  counts(subject: string, day: string): Promise<Partial<Record<CounterKind, number>>>
  addCount(subject: string, day: string, kind: CounterKind, n: number): Promise<void>
  /** record that `ip` signed `emojiId`; returns the number of distinct ids in the current window */
  observeEmoji(ip: string, emojiId: string, windowSeconds: number): Promise<number>
  isCleared(ip: string): Promise<boolean>
  markCleared(ip: string, seconds: number): Promise<void>
  verifyCap(token: string): Promise<CapResult>
  volume(ip: string, volume: string): Promise<VolumeState | null>
  addVolume(ip: string, volume: string, n: number, prev: VolumeState | null): Promise<void>
  /** remember a suspicious feature for the 可疑来源 list (best effort) */
  flag(subjects: string[], feature: Feature, day: string): Promise<void>
}

export interface RequestCtx {
  viewer: PolicyViewer | null
  /** ipSubject(request): ip:<salted hash> */
  ip: string
  referer: string | null
  /** origin of SITE_URL */
  siteOrigin: string
  capToken: string | null
}

export type ItemDenyReason = 'not_found' | 'not_downloadable'
export type DenyReason =
  | ItemDenyReason
  | 'login_required'
  | 'paused'
  | 'blocked'
  | 'rate_limited'
  | 'originals_daily_limit'
  | 'packs_daily_limit'
  | 'volume_full'
export type CaptchaReason = 'captcha_required' | 'captcha_invalid' | 'captcha_unavailable'

export interface DenialBody {
  error: string
  reason: DenyReason | CaptchaReason
  retryAfter?: number
  /** daily limits only: would signing in give this visitor a (larger) budget of their own? */
  loginRaisesLimit?: boolean
  needCaptcha?: true
}

export interface Denial {
  status: 403 | 404 | 428 | 429
  body: DenialBody
}

export const MESSAGES = {
  not_found: '找不到这张表情',
  pack_not_found: '找不到这个表情包',
  not_downloadable: '这个表情包只提供预览，不提供原图下载',
  login_required: '原图暂时只对登录用户开放，请先登录',
  paused: '整包与打包下载暂停中，单张下载不受影响',
  blocked: '这个来源的下载已被暂停',
  rate_limited: '操作太频繁，请稍后再试',
  daily_limit: '今天下载得有点多，明天 0 点恢复',
  volume_full: '这个压缩包已达到单次打包张数上限，请分成多个压缩包',
} as const

// ---------- time ----------

/** Counter day (YYYY-MM-DD in Asia/Shanghai), the same boundary as the hourly rollup and the R2 alert. */
export function shanghaiDay(now: Date): string {
  return formatCreditsDate(now)
}

const SHANGHAI_OFFSET_MS = 8 * 3600_000 // Asia/Shanghai has no DST

/** Seconds until the next 00:00 Asia/Shanghai, at least 1. */
export function secondsUntilNextDay(now: Date): number {
  const local = now.getTime() + SHANGHAI_OFFSET_MS
  const next = (Math.floor(local / 86_400_000) + 1) * 86_400_000
  return Math.max(1, Math.ceil((next - local) / 1000))
}

// ---------- rule 1: downloadable ----------

export type ItemAccess = { ok: true; review: boolean } | { ok: false; reason: ItemDenyReason }

/**
 * Published emoji in a published pack: allowed when the pack is downloadable. An emoji still under
 * review (pending) — the original of a draft, pending or returned submission — only for the pack owner
 * or a reviewer, whether or not the pack is downloadable (`review: true`). Hidden emojis and hidden packs
 * are refused for everyone. Anything a visitor may not know about reads as not_found.
 */
export function emojiAccess(viewer: PolicyViewer | null, item: PolicyItem | null): ItemAccess {
  if (!item) return { ok: false, reason: 'not_found' }
  const { emoji, pack } = item
  if (emoji.status === 'hidden' || pack.status === 'hidden') return { ok: false, reason: 'not_found' }
  if (emoji.status === 'published' && pack.status === 'published') {
    return pack.downloadable ? { ok: true, review: false } : { ok: false, reason: 'not_downloadable' }
  }
  if (emoji.status === 'pending' || pack.status === 'draft') {
    const allowed = !!viewer && (can(viewer.role, 'review') || (pack.ownerId !== null && pack.ownerId === viewer.id))
    return allowed ? { ok: true, review: true } : { ok: false, reason: 'not_found' }
  }
  return { ok: false, reason: 'not_found' }
}

export function packAccess(pack: PolicyPack | null): { ok: true } | { ok: false; reason: ItemDenyReason } {
  if (!pack || pack.status !== 'published') return { ok: false, reason: 'not_found' }
  return pack.downloadable ? { ok: true } : { ok: false, reason: 'not_downloadable' }
}

function itemDenial(reason: ItemDenyReason, what: 'emoji' | 'pack' = 'emoji'): Denial {
  if (reason === 'not_downloadable') return { status: 403, body: { error: MESSAGES.not_downloadable, reason } }
  return { status: 404, body: { error: what === 'pack' ? MESSAGES.pack_not_found : MESSAGES.not_found, reason } }
}

// ---------- rule 2: emergency switches ----------

export type Op = 'single' | 'zip' | 'batch'

export function switchDenial(op: Op, viewer: PolicyViewer | null, s: DownloadSettings): Denial | null {
  if (s.originalsRequireLogin && !viewer) return { status: 403, body: { error: MESSAGES.login_required, reason: 'login_required' } }
  if (s.pauseZipAndBatch && op !== 'single') return { status: 403, body: { error: MESSAGES.paused, reason: 'paused' } }
  return null
}

// ---------- rule 3: sources and suspicious traffic ----------

/** The strongest active entry: block beats watch; rows whose `until` has passed are ignored. */
export function sourceMode(entries: SourceEntry[], now: Date): 'block' | 'watch' | null {
  const active = entries.filter((e) => e.until === null || e.until.getTime() > now.getTime())
  if (active.some((e) => e.mode === 'block')) return 'block'
  if (active.some((e) => e.mode === 'watch')) return 'watch'
  return null
}

/** Same-site Referer: present and with the site's origin. */
export function refererOk(referer: string | null, siteOrigin: string): boolean {
  if (!referer) return false
  try {
    return new URL(referer).origin === siteOrigin
  } catch {
    return false
  }
}

export function countSubject(viewer: PolicyViewer | null, ip: string): string {
  return viewer ? `user:${viewer.id}` : ip
}

function flagSubjects(ctx: RequestCtx): string[] {
  return ctx.viewer ? [ctx.ip, `user:${ctx.viewer.id}`] : [ctx.ip]
}

type Challenge = 'watch' | 'referer' | 'burst'

async function sourcesAndChallenge(op: Op, ctx: RequestCtx, s: DownloadSettings, deps: PolicyDeps, emojiId: string | null, day: string): Promise<Denial | null> {
  const subjects = flagSubjects(ctx)
  const mode = sourceMode(await deps.sources(subjects), deps.now())
  if (mode === 'block') return { status: 403, body: { error: MESSAGES.blocked, reason: 'blocked' } }

  const reasons: Challenge[] = []
  if (mode === 'watch') reasons.push('watch')
  if (op !== 'batch' && !refererOk(ctx.referer, ctx.siteOrigin)) {
    await deps.flag(subjects, 'noref', day)
    if (s.challengeSuspicious) reasons.push('referer')
  }
  if (op === 'single' && s.challengeSuspicious && emojiId) {
    const distinct = await deps.observeEmoji(ctx.ip, emojiId, BURST_WINDOW_S)
    if (distinct >= BURST_DISTINCT) {
      await deps.flag(subjects, 'burst', day)
      reasons.push('burst')
    }
  }
  if (!reasons.length) return null
  if (await deps.isCleared(ctx.ip)) return null
  if (!ctx.capToken) return captchaDenial('captcha_required', 'missing')
  // Cap tokens are single-use: this is the only verification for the request
  const result = await deps.verifyCap(ctx.capToken)
  if (!result.ok) return captchaDenial(result.reason === 'unavailable' ? 'captcha_unavailable' : 'captcha_invalid', result.reason)
  await deps.markCleared(ctx.ip, CLEAR_SECONDS)
  return null
}

function captchaDenial(reason: CaptchaReason, capReason: 'missing' | 'invalid' | 'unavailable'): Denial {
  return { status: 428, body: { needCaptcha: true, error: capErrorMessage(capReason), reason } }
}

// ---------- rules 4–5: rates and daily limits ----------

function rateDenial(retryAfter: number): Denial {
  return { status: 429, body: { error: MESSAGES.rate_limited, reason: 'rate_limited', retryAfter } }
}

/**
 * Originals budget of the counting subject: per account when signed in, per IP for guests.
 * Signing in helps a guest only if accounts get a budget of their own that is larger than the IP one.
 */
function originalsLimit(viewer: PolicyViewer | null, s: DownloadSettings): { limit: number | null; loginRaisesLimit: boolean } {
  if (viewer) return { limit: s.perUserOriginalsPerDay, loginRaisesLimit: false }
  const user = s.perUserOriginalsPerDay
  const ip = s.perIpOriginalsPerDay
  return { limit: ip, loginRaisesLimit: ip !== null && (user === null || user > ip) }
}

const originalsUsed = (c: Partial<Record<CounterKind, number>>) => (c.orig ?? 0) + (c.batch_item ?? 0)
const packsUsed = (c: Partial<Record<CounterKind, number>>) => (c.zip ?? 0) + (c.batch ?? 0)

function dailyDenial(reason: 'originals_daily_limit' | 'packs_daily_limit', now: Date, loginRaisesLimit: boolean): Denial {
  return { status: 429, body: { error: MESSAGES.daily_limit, reason, retryAfter: secondsUntilNextDay(now), loginRaisesLimit } }
}

/** Remaining originals today for the counting subject; null = unlimited. */
async function originalsRemaining(ctx: RequestCtx, s: DownloadSettings, deps: PolicyDeps, day: string) {
  const { limit, loginRaisesLimit } = originalsLimit(ctx.viewer, s)
  if (limit === null) return { remaining: null, loginRaisesLimit }
  const used = originalsUsed(await deps.counts(countSubject(ctx.viewer, ctx.ip), day))
  return { remaining: Math.max(0, limit - used), loginRaisesLimit }
}

/** Packs left today for the IP; null = unlimited. */
async function packsRemaining(ctx: RequestCtx, s: DownloadSettings, deps: PolicyDeps, day: string): Promise<number | null> {
  if (s.perIpPacksPerDay === null) return null
  return Math.max(0, s.perIpPacksPerDay - packsUsed(await deps.counts(ctx.ip, day)))
}

// ---------- checks ----------

export type Check<T = object> = ({ ok: true; commit(): Promise<void> } & T) | { ok: false; denial: Denial }

/** GET /dl/e/:id — one original (查看原图 / 保存原图). Commit counts one `orig`. */
export async function checkSingle(ctx: RequestCtx, s: DownloadSettings, item: PolicyItem | null, deps: PolicyDeps): Promise<Check<{ review: boolean }>> {
  const now = deps.now()
  const day = shanghaiDay(now)
  const access = emojiAccess(ctx.viewer, item)
  if (!access.ok) return { ok: false, denial: itemDenial(access.reason) }
  const sw = switchDenial('single', ctx.viewer, s)
  if (sw) return { ok: false, denial: sw }
  const src = await sourcesAndChallenge('single', ctx, s, deps, item!.emoji.id, day)
  if (src) return { ok: false, denial: src }

  if (s.singleSignsPerMinute !== null) {
    const hit = await deps.hitRate(ctx.ip, SINGLE_BUCKET, RATE_WINDOW_S, 1)
    if (hit.n > s.singleSignsPerMinute) {
      await deps.flag(flagSubjects(ctx), 'throttled', day)
      return { ok: false, denial: rateDenial(hit.retryAfter) }
    }
  }
  const { remaining, loginRaisesLimit } = await originalsRemaining(ctx, s, deps, day)
  if (remaining !== null && remaining < 1) {
    await deps.flag(flagSubjects(ctx), 'throttled', day)
    return { ok: false, denial: dailyDenial('originals_daily_limit', now, loginRaisesLimit) }
  }
  const subject = countSubject(ctx.viewer, ctx.ip)
  return { ok: true, review: access.review, commit: () => deps.addCount(subject, day, 'orig', 1) }
}

/** GET /dl/p/:slug.zip — the whole-pack ZIP. Commit counts one `zip` for the IP. */
export async function checkZip(ctx: RequestCtx, s: DownloadSettings, pack: PolicyPack | null, deps: PolicyDeps): Promise<Check> {
  const now = deps.now()
  const day = shanghaiDay(now)
  const access = packAccess(pack)
  if (!access.ok) return { ok: false, denial: itemDenial(access.reason, 'pack') }
  const sw = switchDenial('zip', ctx.viewer, s)
  if (sw) return { ok: false, denial: sw }
  const src = await sourcesAndChallenge('zip', ctx, s, deps, null, day)
  if (src) return { ok: false, denial: src }
  const left = await packsRemaining(ctx, s, deps, day)
  if (left !== null && left < 1) {
    await deps.flag(flagSubjects(ctx), 'throttled', day)
    return { ok: false, denial: dailyDenial('packs_daily_limit', now, false) }
  }
  return { ok: true, commit: () => deps.addCount(ctx.ip, day, 'zip', 1) }
}

export type BatchItemDenyReason = ItemDenyReason | 'rate_limited' | 'volume_full' | 'originals_daily_limit'

export interface BatchCandidate {
  id: string
  item: PolicyItem | null
}

export interface BatchResult {
  allowed: string[]
  denied: { id: string; reason: BatchItemDenyReason }[]
  /** set when some items were held back by the minute rate */
  retryAfter?: number
  /** this request opened the volume (counted as one pack) */
  newVolume: boolean
}

/**
 * POST /api/batch/sign — one chunk (≤ 20 ids) of a batch volume (one browser-built ZIP).
 * Request-level checks run once (switches, sources and the challenge with at most one Cap verification,
 * the minute rate, the pack limit when the volume is new); item-level ones per id (downloadable), then
 * the allowed ids are cut down, in request order, to what the minute rate, maxBatchItems and the daily
 * originals budget leave. A volume is new when this IP has not signed anything for it yet, whatever the
 * client's `first` flag says, so a client cannot skip the pack count by never sending first: true, and a
 * retried first chunk is not counted twice. Commit counts `batch_item` × allowed and, for a new volume
 * with at least one allowed item, one `batch` for the IP.
 */
export async function checkBatch(
  ctx: RequestCtx,
  s: DownloadSettings,
  candidates: BatchCandidate[],
  volumeId: string,
  deps: PolicyDeps,
): Promise<Check<BatchResult>> {
  const now = deps.now()
  const day = shanghaiDay(now)
  const sw = switchDenial('batch', ctx.viewer, s)
  if (sw) return { ok: false, denial: sw }
  const src = await sourcesAndChallenge('batch', ctx, s, deps, null, day)
  if (src) return { ok: false, denial: src }

  const denied: BatchResult['denied'] = []
  const eligible: string[] = []
  for (const c of candidates) {
    const access = emojiAccess(ctx.viewer, c.item)
    if (access.ok) eligible.push(c.id)
    else denied.push({ id: c.id, reason: access.reason })
  }
  const noop = async () => {}
  if (!eligible.length) return { ok: true, allowed: [], denied, newVolume: false, commit: noop }

  const throttled = () => deps.flag(flagSubjects(ctx), 'throttled', day)
  // caps on how many of the eligible ids (a prefix, in request order) may be signed, in check order
  const caps: { n: number; reason: BatchItemDenyReason }[] = []

  let retryAfter: number | undefined
  if (s.batchItemsPerMinute !== null) {
    const hit = await deps.hitRate(ctx.ip, BATCH_BUCKET, RATE_WINDOW_S, eligible.length)
    const allowedByRate = Math.max(0, s.batchItemsPerMinute - (hit.n - eligible.length))
    if (allowedByRate === 0) {
      await throttled()
      return { ok: false, denial: rateDenial(hit.retryAfter) }
    }
    if (allowedByRate < eligible.length) {
      retryAfter = hit.retryAfter
      caps.push({ n: allowedByRate, reason: 'rate_limited' })
    }
  }

  const volume = await deps.volume(ctx.ip, volumeId)
  if (!volume) {
    const left = await packsRemaining(ctx, s, deps, day)
    if (left !== null && left < 1) {
      await throttled()
      return { ok: false, denial: dailyDenial('packs_daily_limit', now, false) }
    }
  }
  if (s.maxBatchItems !== null) caps.push({ n: Math.max(0, s.maxBatchItems - (volume?.signed ?? 0)), reason: 'volume_full' })

  const { remaining, loginRaisesLimit } = await originalsRemaining(ctx, s, deps, day)
  if (remaining !== null) {
    if (remaining < 1) {
      await throttled()
      return { ok: false, denial: dailyDenial('originals_daily_limit', now, loginRaisesLimit) }
    }
    caps.push({ n: remaining, reason: 'originals_daily_limit' })
  }

  const room = Math.min(eligible.length, ...caps.map((c) => c.n))
  const allowed = eligible.slice(0, room)
  const held = eligible.slice(room).map((id, k) => {
    const index = room + k
    // held back by the first cap (in check order) that this position exceeds
    return { id, reason: caps.find((c) => index >= c.n)!.reason }
  })
  denied.push(...held)
  if (held.some((h) => h.reason !== 'volume_full')) await throttled()
  const subject = countSubject(ctx.viewer, ctx.ip)
  const newVolume = !volume && allowed.length > 0
  return {
    ok: true,
    allowed,
    denied,
    newVolume,
    ...(retryAfter !== undefined && held.some((h) => h.reason === 'rate_limited') ? { retryAfter } : {}),
    async commit() {
      if (!allowed.length) return
      await deps.addCount(subject, day, 'batch_item', allowed.length)
      if (newVolume) await deps.addCount(ctx.ip, day, 'batch', 1)
      await deps.addVolume(ctx.ip, volumeId, allowed.length, volume)
    },
  }
}
