import { beforeEach, describe, expect, test } from 'bun:test'
import type { CapResult } from '#/server/auth/cap'
import type { CounterKind } from '#/server/db/schema/downloads'
import {
  BURST_DISTINCT,
  checkBatch,
  checkSingle,
  checkZip,
  type DownloadSettings,
  emojiAccess,
  type Feature,
  MESSAGES,
  type PolicyDeps,
  type PolicyItem,
  type PolicyPack,
  type RequestCtx,
  secondsUntilNextDay,
  shanghaiDay,
  type SourceEntry,
  type VolumeState,
} from '#/server/downloads/policy'

// Decision table for src/server/downloads/policy.ts with in-memory dependencies (no database).

const SITE = 'http://localhost:3101'
const NOW = new Date('2026-10-20T04:00:00Z') // 12:00 in Asia/Shanghai
const DAY = '2026-10-20'
const IP = 'ip:00000000000000000000000000000001'

const BASE: DownloadSettings = {
  perIpOriginalsPerDay: null,
  perUserOriginalsPerDay: null,
  perIpPacksPerDay: null,
  maxBatchItems: null,
  singleSignsPerMinute: null,
  batchItemsPerMinute: null,
  challengeSuspicious: false,
  originalsRequireLogin: false,
  pauseZipAndBatch: false,
  r2ReadAlertMonthly: null,
}
const settings = (over: Partial<DownloadSettings> = {}): DownloadSettings => ({ ...BASE, ...over })

class Fake implements PolicyDeps {
  clock = NOW
  entries: SourceEntry[] = []
  windows = new Map<string, number>()
  counters = new Map<string, number>()
  seen = new Map<string, Set<string>>()
  cleared = new Set<string>()
  vols = new Map<string, VolumeState>()
  flags: { subjects: string[]; feature: Feature; day: string }[] = []
  capCalls: string[] = []
  calls: string[] = []

  now = () => this.clock
  async sources(subjects: string[]) {
    this.calls.push('sources')
    return this.entries.filter((e) => subjects.includes(e.subject))
  }
  async hitRate(subject: string, bucket: string, _w: number, amount: number) {
    this.calls.push(`hitRate:${bucket}`)
    const k = `${subject}|${bucket}`
    const n = (this.windows.get(k) ?? 0) + amount
    this.windows.set(k, n)
    return { n, retryAfter: 42 }
  }
  async counts(subject: string, day: string) {
    this.calls.push('counts')
    const out: Partial<Record<CounterKind, number>> = {}
    for (const kind of ['orig', 'batch_item', 'batch', 'zip'] as CounterKind[]) {
      const n = this.counters.get(`${subject}|${day}|${kind}`)
      if (n) out[kind] = n
    }
    return out
  }
  async addCount(subject: string, day: string, kind: CounterKind, n: number) {
    const k = `${subject}|${day}|${kind}`
    this.counters.set(k, (this.counters.get(k) ?? 0) + n)
  }
  async observeEmoji(ip: string, emojiId: string) {
    const s = this.seen.get(ip) ?? new Set<string>()
    s.add(emojiId)
    this.seen.set(ip, s)
    return s.size
  }
  async isCleared(ip: string) {
    return this.cleared.has(ip)
  }
  async markCleared(ip: string) {
    this.cleared.add(ip)
  }
  async verifyCap(token: string): Promise<CapResult> {
    this.capCalls.push(token)
    if (token === 'good') return { ok: true }
    if (token === 'down') return { ok: false, reason: 'unavailable' }
    return { ok: false, reason: 'invalid' }
  }
  async volume(ip: string, id: string) {
    return this.vols.get(`${ip}|${id}`) ?? null
  }
  async addVolume(ip: string, id: string, n: number, prev: VolumeState | null) {
    this.vols.set(`${ip}|${id}`, { signed: (prev?.signed ?? 0) + n, since: prev?.since ?? this.clock })
  }
  async flag(subjects: string[], feature: Feature, day: string) {
    this.flags.push({ subjects, feature, day })
  }
  count(subject: string, kind: CounterKind, day = DAY) {
    return this.counters.get(`${subject}|${day}|${kind}`) ?? 0
  }
  get totalCounted() {
    return [...this.counters.values()].reduce((a, b) => a + b, 0)
  }
}

let deps: Fake
beforeEach(() => {
  deps = new Fake()
})

const guest = null
const user = { id: 'u-1', role: 'user' }
const owner = { id: 'u-owner', role: 'user' }
const manager = { id: 'u-mgr', role: 'manager' }
const admin = { id: 'u-admin', role: 'admin' }

function ctx(over: Partial<RequestCtx> = {}): RequestCtx {
  return { viewer: null, ip: IP, referer: `${SITE}/packs/p`, siteOrigin: SITE, capToken: null, ...over }
}

const pack = (over: Partial<PolicyPack> = {}): PolicyPack => ({ id: 1, status: 'published', downloadable: true, ownerId: 'u-owner', ...over })
let idSeq = 0
const nextId = () => `r-${(++idSeq).toString(16).padStart(20, '0')}`
function item(emojiStatus = 'published', p: Partial<PolicyPack> = {}): PolicyItem {
  return { emoji: { id: nextId(), status: emojiStatus }, pack: pack(p) }
}

async function single(c: RequestCtx, s: DownloadSettings, it: PolicyItem | null = item()) {
  const r = await checkSingle(c, s, it, deps)
  if (r.ok) await r.commit()
  return r
}

describe('time: Asia/Shanghai days', () => {
  test('the counter day turns at 16:00 UTC (00:00 Asia/Shanghai)', () => {
    expect(shanghaiDay(new Date('2026-10-20T15:59:59Z'))).toBe('2026-10-20')
    expect(shanghaiDay(new Date('2026-10-20T16:00:00Z'))).toBe('2026-10-21')
    expect(shanghaiDay(new Date('2026-10-19T16:00:00Z'))).toBe('2026-10-20')
  })

  test('retryAfter for daily limits counts down to the next 00:00 Asia/Shanghai', () => {
    expect(secondsUntilNextDay(new Date('2026-10-20T15:59:30Z'))).toBe(30)
    expect(secondsUntilNextDay(new Date('2026-10-20T16:00:00Z'))).toBe(86_400)
    expect(secondsUntilNextDay(new Date('2026-10-20T04:00:00Z'))).toBe(12 * 3600)
  })
})

describe('rule 1: downloadable', () => {
  const cases: [string, PolicyItem | null, { id: string; role: string } | null, string][] = [
    ['published, downloadable', item(), guest, 'allow'],
    ['published, not downloadable', item('published', { downloadable: false }), guest, 'not_downloadable'],
    ['published, not downloadable, even for a reviewer', item('published', { downloadable: false }), manager, 'not_downloadable'],
    ['missing emoji', null, guest, 'not_found'],
    ['hidden emoji', item('hidden'), admin, 'not_found'],
    ['hidden pack', item('published', { status: 'hidden' }), admin, 'not_found'],
    ['pending, guest', item('pending'), guest, 'not_found'],
    ['pending, another user', item('pending'), user, 'not_found'],
    ['pending, pack owner, pack not downloadable', item('pending', { status: 'draft', downloadable: false }), owner, 'review'],
    ['pending in a published pack, owner', item('pending', { downloadable: false }), owner, 'review'],
    ['pending, manager (review)', item('pending', { status: 'draft', downloadable: false }), manager, 'review'],
    ['pending, admin', item('pending', { status: 'draft', ownerId: null }), admin, 'review'],
    ['pending, ownerless pack, user', item('pending', { ownerId: null }), user, 'not_found'],
  ]
  test.each(cases)('%s', async (_label, it, viewer, expected) => {
    const access = emojiAccess(viewer, it)
    if (expected === 'allow') expect(access).toEqual({ ok: true, review: false })
    else if (expected === 'review') expect(access).toEqual({ ok: true, review: true })
    else expect(access).toEqual({ ok: false, reason: expected as 'not_found' })

    const r = await single(ctx({ viewer }), settings(), it)
    if (expected === 'allow' || expected === 'review') expect(r.ok).toBe(true)
    else {
      expect(r).toMatchObject({ ok: false, denial: { status: expected === 'not_found' ? 404 : 403, body: { reason: expected } } })
      expect(deps.totalCounted).toBe(0)
    }
  })

  test('zip: only published, downloadable packs', async () => {
    expect(await checkZip(ctx(), settings(), pack({ downloadable: false }), deps)).toMatchObject({ ok: false, denial: { status: 403, body: { reason: 'not_downloadable' } } })
    expect(await checkZip(ctx(), settings(), pack({ status: 'draft' }), deps)).toMatchObject({ ok: false, denial: { status: 404 } })
    expect(await checkZip(ctx(), settings(), null, deps)).toMatchObject({ ok: false, denial: { status: 404, body: { error: MESSAGES.pack_not_found } } })
    expect((await checkZip(ctx(), settings(), pack(), deps)).ok).toBe(true)
  })
})

describe('rule 2: emergency switches', () => {
  test('originalsRequireLogin: guests get 403 login_required, signed-in users pass', async () => {
    const s = settings({ originalsRequireLogin: true })
    expect(await single(ctx(), s)).toMatchObject({ ok: false, denial: { status: 403, body: { reason: 'login_required', error: MESSAGES.login_required } } })
    expect(await checkZip(ctx(), s, pack(), deps)).toMatchObject({ ok: false, denial: { body: { reason: 'login_required' } } })
    expect(await checkBatch(ctx(), s, [{ id: 'a', item: item() }], 'v', deps)).toMatchObject({ ok: false, denial: { body: { reason: 'login_required' } } })
    expect((await single(ctx({ viewer: user }), s)).ok).toBe(true)
  })

  test('pauseZipAndBatch: ZIP and batch get 403 paused, single downloads still work', async () => {
    const s = settings({ pauseZipAndBatch: true })
    expect(await checkZip(ctx(), s, pack(), deps)).toMatchObject({ ok: false, denial: { status: 403, body: { reason: 'paused' } } })
    expect(await checkBatch(ctx(), s, [{ id: 'a', item: item() }], 'v', deps)).toMatchObject({ ok: false, denial: { status: 403, body: { reason: 'paused' } } })
    expect((await single(ctx(), s)).ok).toBe(true)
  })

  test('switches off: nothing is refused', async () => {
    expect((await single(ctx(), settings())).ok).toBe(true)
    expect((await checkZip(ctx(), settings(), pack(), deps)).ok).toBe(true)
  })
})

describe('rule 3: blocked_sources', () => {
  test('block → 403 for the IP or the account', async () => {
    deps.entries = [{ subject: IP, mode: 'block', until: null }]
    expect(await single(ctx(), settings())).toMatchObject({ ok: false, denial: { status: 403, body: { reason: 'blocked' } } })
    deps.entries = [{ subject: 'user:u-1', mode: 'block', until: null }]
    expect(await single(ctx({ viewer: user, ip: 'ip:other' }), settings())).toMatchObject({ ok: false, denial: { status: 403, body: { reason: 'blocked' } } })
    expect(deps.totalCounted).toBe(0)
  })

  test('an expired entry is ignored; a future `until` is in force', async () => {
    deps.entries = [{ subject: IP, mode: 'block', until: new Date(NOW.getTime() - 1000) }]
    expect((await single(ctx(), settings())).ok).toBe(true)
    deps.entries = [{ subject: IP, mode: 'block', until: new Date(NOW.getTime() + 60_000) }]
    expect((await single(ctx(), settings())).ok).toBe(false)
  })

  test('watch → 428 challenge, even with challengeSuspicious off; block beats watch', async () => {
    deps.entries = [{ subject: IP, mode: 'watch', until: null }]
    expect(await single(ctx(), settings())).toMatchObject({ ok: false, denial: { status: 428, body: { needCaptcha: true, reason: 'captcha_required' } } })
    expect(await checkBatch(ctx(), settings(), [{ id: 'a', item: item() }], 'v', deps)).toMatchObject({ ok: false, denial: { status: 428 } })
    deps.entries.push({ subject: 'user:u-1', mode: 'block', until: null })
    expect(await single(ctx({ viewer: user }), settings())).toMatchObject({ ok: false, denial: { status: 403 } })
  })
})

describe('rule 3: suspicious traffic and Cap', () => {
  const on = settings({ challengeSuspicious: true })

  test('missing or foreign Referer → 428 when challengeSuspicious is on', async () => {
    expect(await single(ctx({ referer: null }), on)).toMatchObject({ ok: false, denial: { status: 428, body: { needCaptcha: true, reason: 'captcha_required', error: '请先完成人机验证' } } })
    expect(await single(ctx({ referer: 'https://evil.test/page' }), on)).toMatchObject({ ok: false, denial: { status: 428 } })
    expect(await checkZip(ctx({ referer: null }), on, pack(), deps)).toMatchObject({ ok: false, denial: { status: 428 } })
    expect((await single(ctx(), on)).ok).toBe(true)
    expect(deps.flags.filter((f) => f.feature === 'noref')).toHaveLength(3)
  })

  test('challengeSuspicious off: no challenge, but the feature is still recorded', async () => {
    expect((await single(ctx({ referer: null }), settings())).ok).toBe(true)
    expect(deps.flags).toEqual([{ subjects: [IP], feature: 'noref', day: DAY }])
  })

  test('a valid token clears the challenge for that IP; it is verified exactly once', async () => {
    const r = await single(ctx({ referer: null, capToken: 'good' }), on)
    expect(r.ok).toBe(true)
    expect(deps.capCalls).toEqual(['good'])
    expect(deps.cleared.has(IP)).toBe(true)
    // cleared: no token needed, and none is verified
    expect((await single(ctx({ referer: null }), on)).ok).toBe(true)
    expect((await single(ctx({ referer: null, capToken: 'another' }), on)).ok).toBe(true)
    expect(deps.capCalls).toEqual(['good'])
    // another IP is still challenged
    expect((await single(ctx({ referer: null, ip: 'ip:2' }), on)).ok).toBe(false)
  })

  test('invalid or unverifiable tokens → 428 with the Cap reason', async () => {
    expect(await single(ctx({ referer: null, capToken: 'forged' }), on)).toMatchObject({ ok: false, denial: { status: 428, body: { reason: 'captcha_invalid', needCaptcha: true } } })
    expect(await single(ctx({ referer: null, capToken: 'down' }), on)).toMatchObject({ ok: false, denial: { status: 428, body: { reason: 'captcha_unavailable' } } })
    expect(deps.cleared.size).toBe(0)
    expect(deps.totalCounted).toBe(0)
  })

  test('a token on an unsuspicious request is not spent', async () => {
    expect((await single(ctx({ capToken: 'good' }), on)).ok).toBe(true)
    expect(deps.capCalls).toEqual([])
  })

  test(`a burst of ${BURST_DISTINCT} distinct emoji ids from one IP → challenge; repeats do not count`, async () => {
    for (let i = 0; i < BURST_DISTINCT - 1; i++) expect((await single(ctx(), on)).ok).toBe(true)
    const repeat = item()
    expect((await single(ctx(), on, repeat)).ok).toBe(false) // the 30th distinct id
    expect(deps.flags.some((f) => f.feature === 'burst')).toBe(true)
    // the same id again is not a new one, but the IP is still over the threshold until it passes Cap
    expect((await single(ctx(), on, repeat)).ok).toBe(false)
    expect((await single(ctx({ capToken: 'good' }), on, repeat)).ok).toBe(true)
    expect((await single(ctx(), on)).ok).toBe(true)
  })

  test('burst detection is off with challengeSuspicious off, and never applies to batch', async () => {
    for (let i = 0; i < BURST_DISTINCT + 5; i++) expect((await single(ctx(), settings())).ok).toBe(true)
    expect(deps.seen.size).toBe(0)
    const many = Array.from({ length: 20 }, () => ({ id: nextId(), item: item() }))
    for (let i = 0; i < 3; i++) expect((await checkBatch(ctx({ referer: null }), on, many, `v${i}`, deps)).ok).toBe(true)
  })

  test('batch: one Cap verification for the whole chunk', async () => {
    deps.entries = [{ subject: IP, mode: 'watch', until: null }]
    const chunk = Array.from({ length: 5 }, () => ({ id: nextId(), item: item() }))
    const r = await checkBatch(ctx({ capToken: 'good' }), settings(), chunk, 'v', deps)
    expect(r).toMatchObject({ ok: true })
    expect(deps.capCalls).toEqual(['good'])
  })
})

describe('rule 4: minute rates', () => {
  test('singleSignsPerMinute: the next sign over the limit → 429 rate_limited with retryAfter', async () => {
    const s = settings({ singleSignsPerMinute: 2 })
    expect((await single(ctx(), s)).ok).toBe(true)
    expect((await single(ctx(), s)).ok).toBe(true)
    expect(await single(ctx(), s)).toMatchObject({ ok: false, denial: { status: 429, body: { reason: 'rate_limited', retryAfter: 42, error: MESSAGES.rate_limited } } })
    expect(deps.count(IP, 'orig')).toBe(2)
    expect(deps.flags.some((f) => f.feature === 'throttled')).toBe(true)
  })

  test('a blank rate skips the check entirely', async () => {
    for (let i = 0; i < 100; i++) await single(ctx(), settings())
    expect(deps.calls.filter((c) => c.startsWith('hitRate'))).toEqual([])
  })

  test('single and batch rates are separate buckets: a 200-item batch never touches the single limit', async () => {
    const s = settings({ singleSignsPerMinute: 5, batchItemsPerMinute: 1000 })
    for (let chunk = 0; chunk < 10; chunk++) {
      const ids = Array.from({ length: 20 }, () => ({ id: nextId(), item: item() }))
      const r = await checkBatch(ctx(), s, ids, 'vol-200', deps)
      expect(r).toMatchObject({ ok: true, denied: [] })
      if (r.ok) await r.commit()
    }
    expect(deps.windows.get(`${IP}|dl:batch`)).toBe(200)
    expect(deps.windows.get(`${IP}|dl:single`)).toBeUndefined()
    for (let i = 0; i < 5; i++) expect((await single(ctx(), s)).ok).toBe(true)
    expect((await single(ctx(), s)).ok).toBe(false)
  })

  test('batchItemsPerMinute below the chunk size: partial allowance, then 429', async () => {
    const s = settings({ batchItemsPerMinute: 15 })
    const chunk = () => Array.from({ length: 10 }, () => ({ id: nextId(), item: item() }))
    const a = await checkBatch(ctx(), s, chunk(), 'v', deps)
    expect(a).toMatchObject({ ok: true })
    if (a.ok) await a.commit()
    const b = await checkBatch(ctx(), s, chunk(), 'v', deps)
    if (!b.ok) throw new Error('expected a partial allowance')
    expect(b.allowed).toHaveLength(5)
    expect(b.denied.map((d) => d.reason)).toEqual(Array(5).fill('rate_limited'))
    expect(b.retryAfter).toBe(42)
    await b.commit()
    expect(deps.count(IP, 'batch_item')).toBe(15)
    expect(await checkBatch(ctx(), s, chunk(), 'v', deps)).toMatchObject({ ok: false, denial: { status: 429, body: { reason: 'rate_limited', retryAfter: 42 } } })
    expect(deps.count(IP, 'batch_item')).toBe(15)
  })
})

describe('rule 5: daily limits', () => {
  test('perIpOriginalsPerDay for guests: 429 with the 明天 0 点 message; signing in raises the limit', async () => {
    const s = settings({ perIpOriginalsPerDay: 2 })
    expect((await single(ctx(), s)).ok).toBe(true)
    expect((await single(ctx(), s)).ok).toBe(true)
    const r = await single(ctx(), s)
    expect(r).toMatchObject({
      ok: false,
      denial: { status: 429, body: { reason: 'originals_daily_limit', error: '今天下载得有点多，明天 0 点恢复', retryAfter: 12 * 3600, loginRaisesLimit: true } },
    })
    // signed in, the account has its own budget (perUserOriginalsPerDay blank = unlimited)
    expect((await single(ctx({ viewer: user }), s)).ok).toBe(true)
    expect(deps.count('user:u-1', 'orig')).toBe(1)
    expect(deps.count(IP, 'orig')).toBe(2)
  })

  test('loginRaisesLimit is false when accounts get no more than the IP, true when they get more', async () => {
    const same = settings({ perIpOriginalsPerDay: 1, perUserOriginalsPerDay: 1 })
    await single(ctx(), same)
    expect(await single(ctx(), same)).toMatchObject({ ok: false, denial: { body: { loginRaisesLimit: false } } })
    deps = new Fake()
    const more = settings({ perIpOriginalsPerDay: 1, perUserOriginalsPerDay: 5 })
    await single(ctx(), more)
    expect(await single(ctx(), more)).toMatchObject({ ok: false, denial: { body: { loginRaisesLimit: true } } })
  })

  test('perUserOriginalsPerDay counts per account and reports loginRaisesLimit false', async () => {
    const s = settings({ perUserOriginalsPerDay: 1, perIpOriginalsPerDay: 1000 })
    expect((await single(ctx({ viewer: user }), s)).ok).toBe(true)
    expect(await single(ctx({ viewer: user, ip: 'ip:elsewhere' }), s)).toMatchObject({ ok: false, denial: { status: 429, body: { loginRaisesLimit: false } } })
  })

  test('orig and batch_item share the originals budget', async () => {
    const s = settings({ perIpOriginalsPerDay: 12 })
    const b = await checkBatch(ctx(), s, Array.from({ length: 10 }, () => ({ id: nextId(), item: item() })), 'v', deps)
    if (b.ok) await b.commit()
    expect((await single(ctx(), s)).ok).toBe(true)
    expect((await single(ctx(), s)).ok).toBe(true)
    expect((await single(ctx(), s)).ok).toBe(false)
    // a batch with 0 left → 429; with some left → cut to what is left
    expect(await checkBatch(ctx(), s, [{ id: nextId(), item: item() }], 'v', deps)).toMatchObject({ ok: false, denial: { status: 429, body: { reason: 'originals_daily_limit' } } })
  })

  test('a batch chunk is cut to the remaining originals', async () => {
    const s = settings({ perIpOriginalsPerDay: 7 })
    const r = await checkBatch(ctx(), s, Array.from({ length: 10 }, () => ({ id: nextId(), item: item() })), 'v', deps)
    if (!r.ok) throw new Error('expected ok')
    expect(r.allowed).toHaveLength(7)
    expect(r.denied.map((d) => d.reason)).toEqual(Array(3).fill('originals_daily_limit'))
    await r.commit()
    expect(deps.count(IP, 'batch_item')).toBe(7)
  })

  test('perIpPacksPerDay: zip and new batch volumes share it, per IP even when signed in', async () => {
    const s = settings({ perIpPacksPerDay: 2 })
    const z = await checkZip(ctx({ viewer: user }), s, pack(), deps)
    if (z.ok) await z.commit()
    const b = await checkBatch(ctx(), s, [{ id: nextId(), item: item() }], 'vol-1', deps)
    if (b.ok) await b.commit()
    expect(deps.count(IP, 'zip')).toBe(1)
    expect(deps.count(IP, 'batch')).toBe(1)
    // more chunks of the same volume are not new packs
    const more = await checkBatch(ctx(), s, [{ id: nextId(), item: item() }], 'vol-1', deps)
    expect(more).toMatchObject({ ok: true, newVolume: false })
    expect(await checkZip(ctx({ viewer: user }), s, pack(), deps)).toMatchObject({
      ok: false,
      denial: { status: 429, body: { reason: 'packs_daily_limit', error: MESSAGES.daily_limit, loginRaisesLimit: false } },
    })
    expect(await checkBatch(ctx(), s, [{ id: nextId(), item: item() }], 'vol-2', deps)).toMatchObject({ ok: false, denial: { status: 429, body: { reason: 'packs_daily_limit' } } })
  })

  test('blank limits are skipped entirely: no counter reads', async () => {
    for (let i = 0; i < 50; i++) await single(ctx(), settings())
    const z = await checkZip(ctx(), settings(), pack(), deps)
    if (z.ok) await z.commit()
    expect(deps.calls.filter((c) => c === 'counts')).toEqual([])
    expect(deps.count(IP, 'orig')).toBe(50)
  })

  test('a new Asia/Shanghai day starts a fresh budget', async () => {
    const s = settings({ perIpOriginalsPerDay: 1 })
    deps.clock = new Date('2026-10-20T15:59:30Z')
    expect((await single(ctx(), s)).ok).toBe(true)
    expect(await single(ctx(), s)).toMatchObject({ ok: false, denial: { body: { retryAfter: 30 } } })
    deps.clock = new Date('2026-10-20T16:00:05Z')
    expect((await single(ctx(), s)).ok).toBe(true)
    expect(deps.count(IP, 'orig', '2026-10-20')).toBe(1)
    expect(deps.count(IP, 'orig', '2026-10-21')).toBe(1)
  })
})

describe('counting happens only on allow', () => {
  test('a refused request writes no counter; commit counts one orig for the counting subject', async () => {
    const denied = await checkSingle(ctx(), settings(), item('published', { downloadable: false }), deps)
    expect(denied.ok).toBe(false)
    const ok = await checkSingle(ctx({ viewer: user }), settings(), item(), deps)
    expect(deps.totalCounted).toBe(0)
    if (!ok.ok) throw new Error('expected ok')
    await ok.commit()
    expect(deps.count('user:u-1', 'orig')).toBe(1)
    expect(deps.totalCounted).toBe(1)
  })

  test('zip counts one `zip` for the IP on commit only', async () => {
    const z = await checkZip(ctx({ viewer: user }), settings(), pack(), deps)
    expect(deps.totalCounted).toBe(0)
    if (z.ok) await z.commit()
    expect(deps.count(IP, 'zip')).toBe(1)
  })
})

describe('batch volumes', () => {
  test('items: downloadable ones are allowed in request order, the rest denied with a reason', async () => {
    const ids = [item(), item('published', { downloadable: false }), item('pending'), item()]
    const r = await checkBatch(ctx(), settings(), [...ids.map((it) => ({ id: it.emoji.id, item: it })), { id: 'r-missing', item: null }], 'v', deps)
    if (!r.ok) throw new Error('expected ok')
    expect(r.allowed).toEqual([ids[0]!.emoji.id, ids[3]!.emoji.id])
    expect(r.denied).toEqual([
      { id: ids[1]!.emoji.id, reason: 'not_downloadable' },
      { id: ids[2]!.emoji.id, reason: 'not_found' },
      { id: 'r-missing', reason: 'not_found' },
    ])
    expect(r.newVolume).toBe(true)
    await r.commit()
    expect(deps.count(IP, 'batch_item')).toBe(2)
    expect(deps.count(IP, 'batch')).toBe(1)
  })

  test('nothing downloadable: nothing is counted and the volume is not opened', async () => {
    const r = await checkBatch(ctx(), settings({ batchItemsPerMinute: 1 }), [{ id: 'x', item: item('hidden') }], 'v', deps)
    expect(r).toMatchObject({ ok: true, allowed: [], newVolume: false })
    if (r.ok) await r.commit()
    expect(deps.totalCounted).toBe(0)
    expect(deps.vols.size).toBe(0)
    expect(deps.windows.size).toBe(0)
  })

  test('maxBatchItems caps a volume across chunks', async () => {
    const s = settings({ maxBatchItems: 25 })
    const chunk = () => Array.from({ length: 20 }, () => ({ id: nextId(), item: item() }))
    const a = await checkBatch(ctx(), s, chunk(), 'v', deps)
    if (a.ok) await a.commit()
    const b = await checkBatch(ctx(), s, chunk(), 'v', deps)
    if (!b.ok) throw new Error('expected ok')
    expect(b.allowed).toHaveLength(5)
    expect(b.denied.map((d) => d.reason)).toEqual(Array(15).fill('volume_full'))
    await b.commit()
    const c = await checkBatch(ctx(), s, chunk(), 'v', deps)
    expect(c).toMatchObject({ ok: true, allowed: [] })
    // a new volume has room again (and counts as another pack)
    const d = await checkBatch(ctx(), s, chunk(), 'w', deps)
    expect(d).toMatchObject({ ok: true, newVolume: true })
    expect(d.ok && d.allowed.length).toBe(20)
  })

  test('cuts report the first limit each held-back id exceeds', async () => {
    const s = settings({ batchItemsPerMinute: 8, maxBatchItems: 5, perIpOriginalsPerDay: 3 })
    const r = await checkBatch(ctx(), s, Array.from({ length: 10 }, () => ({ id: nextId(), item: item() })), 'v', deps)
    if (!r.ok) throw new Error('expected ok')
    expect(r.allowed).toHaveLength(3)
    // positions 3–4 only exceed the daily budget (3), 5–7 also the volume cap (5), 8–9 also the rate (8)
    expect(r.denied.map((d) => d.reason)).toEqual([
      'originals_daily_limit',
      'originals_daily_limit',
      'volume_full',
      'volume_full',
      'volume_full',
      'rate_limited',
      'rate_limited',
    ])
    expect(r.retryAfter).toBe(42)
  })
})
