import { BUCKET, DATABASE_URL, goodToken, signUp, SITE_URL, type TestUser, withClient } from '../integration/setup'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import type { CapResult } from '#/server/auth/cap'
import { db, schema } from '#/server/db/client'
import { handleBatchSign, handleEmojiDownload, handlePackZip, type BatchSignResponse } from '#/server/downloads/handlers'
import { jobSender } from '#/server/jobs/boss'
import { buildPackZip, zipEntryNames } from '#/server/media/zip'
import { body, Client, counter, countersOf, deps, type Emoji, freshMinute, insertEmoji, insertPack, packRow, ready, RUN, useSettings } from './fixture'

// /dl/e, /dl/p and POST /api/batch/sign end to end: real PostgreSQL, RustFS and Better Auth sessions;
// only the Cap verifier and (for the day-boundary test) the clock are injected.

const NO_STORE = 'private, no-store'
const S3_ORIGIN = 'http://127.0.0.1:9000'

let owner: TestUser
let reviewer: TestUser
let stranger: TestUser
let pub: Awaited<ReturnType<typeof insertPack>>
let off: Awaited<ReturnType<typeof insertPack>>
let draft: Awaited<ReturnType<typeof insertPack>>
let pubEmojis: Emoji[] = []
let pending: Emoji
let hidden: Emoji
let offEmoji: Emoji
let draftEmoji: Emoji

beforeAll(async () => {
  await ready()
  owner = await signUp('dl-owner')
  reviewer = await signUp('dl-reviewer')
  stranger = await signUp('dl-stranger')
  await withClient(DATABASE_URL, (c) => c.query(`update users set role = 'manager' where id = $1`, [reviewer.id]))

  pub = await insertPack({
    packKey: `dl-pub-${RUN}`,
    slug: `dl-pub-${RUN}`,
    title: '下载测试包',
    status: 'published',
    downloadable: true,
    ownerId: owner.id,
    license: 'cc-by-nc-sa-4.0',
    commissioner: '群友甲',
    sourceUrl: 'https://emoji.wuwa.games/archives/dl-pub',
  })
  const [artist] = await db().insert(schema.artists).values({ slug: `dl-artist-${RUN}`, name: '测试画师' }).returning()
  await db().insert(schema.packArtists).values({ packId: pub.id, artistId: artist!.id, role: 'artist' })
  // sort order differs from insertion order on purpose
  pubEmojis = []
  for (const [i, sortOrder] of [2, 0, 1].entries()) pubEmojis.push(await insertEmoji(pub, { sortOrder, ext: i === 1 ? 'png' : 'gif' }))
  pending = await insertEmoji(pub, { sortOrder: 3, status: 'pending', ext: 'png' })
  hidden = await insertEmoji(pub, { sortOrder: 4, status: 'hidden' })

  off = await insertPack({ packKey: `dl-off-${RUN}`, status: 'published', downloadable: false })
  offEmoji = await insertEmoji(off, { sortOrder: 0 })
  draft = await insertPack({ packKey: `dl-draft-${RUN}`, status: 'draft', downloadable: false, ownerId: owner.id })
  draftEmoji = await insertEmoji(draft, { sortOrder: 0, status: 'pending', ext: 'png' })
}, 120_000)

afterAll(async () => {
  await (await jobSender()).stop({ graceful: false })
})

const sorted = () => [...pubEmojis].sort((a, b) => a.sortOrder - b.sortOrder)
const expectedName = (e: Emoji) => {
  const order = sorted()
  return zipEntryNames(pub.slug, order.map((x) => ({ originalKey: x.key, format: x.ext })))[order.findIndex((x) => x.id === e.id)]!
}

function dl(client: Client, id: string, mode = 'save', opts: Parameters<Client['request']>[1] = {}, d = deps()) {
  return handleEmojiDownload(client.request(`/dl/e/${id}?mode=${mode}`, opts), id, d)
}

describe('GET /dl/e/:emojiId', () => {
  beforeAll(() => useSettings())

  test('save: 302 to the S3 endpoint with an attachment named like the ZIP entry; counts orig and bumps the pack', async () => {
    const c = new Client()
    const e = pubEmojis[0]! // sort order 2 → third entry
    const before = await packRow(pub.id)
    const res = await dl(c, e.id, 'save')
    expect(res.status).toBe(302)
    expect(res.headers.get('cache-control')).toBe(NO_STORE)
    const location = new URL(res.headers.get('location')!)
    expect(location.origin).toBe(S3_ORIGIN)
    expect(location.pathname).toBe(`/${BUCKET}/${e.key}`)
    expect(location.searchParams.get('X-Amz-Expires')).toBe('120')
    const filename = expectedName(e)
    expect(filename).toBe(`${pub.slug}-03.gif`)
    expect(location.searchParams.get('response-content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)

    const file = await fetch(location)
    expect(file.status).toBe(200)
    expect(file.headers.get('content-disposition')).toContain('attachment')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(e.body)

    expect(await counter(c.subject, 'orig')).toBe(1)
    const after = await packRow(pub.id)
    expect(after.downloadCount).toBe(before.downloadCount + 1)
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime())
  })

  test('view: inline disposition; Accept: application/json returns the link instead of a redirect', async () => {
    const c = new Client()
    const e = pubEmojis[1]!
    const res = await dl(c, e.id, 'view')
    expect(res.status).toBe(302)
    expect(new URL(res.headers.get('location')!).searchParams.get('response-content-disposition')).toStartWith('inline;')
    const asJson = await dl(c, e.id, 'view', { accept: 'application/json' })
    expect(asJson.status).toBe(200)
    expect(asJson.headers.get('cache-control')).toBe(NO_STORE)
    const j = await body<{ url: string; filename: string; expiresIn: number }>(asJson)
    expect(j.filename).toBe(`${pub.slug}-01.png`)
    expect(j.expiresIn).toBe(120)
    expect(new URL(j.url).origin).toBe(S3_ORIGIN)
    expect(await counter(c.subject, 'orig')).toBe(2)
  })

  test('refusals: not downloadable 403, hidden/unknown/malformed 404, bad mode 400, POST 405; nothing counted', async () => {
    const c = new Client()
    const cases: [string, string, number, string?][] = [
      [offEmoji.id, 'save', 403, 'not_downloadable'],
      [hidden.id, 'save', 404, 'not_found'],
      [`r-${'f'.repeat(20)}`, 'save', 404, 'not_found'],
      ['../etc/passwd', 'save', 404, 'not_found'],
      [pubEmojis[0]!.id, 'steal', 400, 'bad_request'],
    ]
    for (const [id, mode, status, reason] of cases) {
      const res = await dl(c, id, mode)
      expect(res.status).toBe(status)
      expect(res.headers.get('cache-control')).toBe(NO_STORE)
      expect((await body(res)).reason).toBe(reason!)
    }
    const post = await handleEmojiDownload(c.request(`/dl/e/${pubEmojis[0]!.id}`, { method: 'POST' }), pubEmojis[0]!.id, deps())
    expect(post.status).toBe(405)
    expect(await countersOf(c.subject)).toBe(0)
  })

  test('originals under review: owner and reviewer only, named by id, pack download count untouched', async () => {
    const before = await packRow(draft.id)
    expect((await dl(new Client(), draftEmoji.id)).status).toBe(404)
    expect((await dl(new Client(stranger.cookie), draftEmoji.id)).status).toBe(404)
    const asOwner = await dl(new Client(owner.cookie), draftEmoji.id)
    expect(asOwner.status).toBe(302)
    expect(new URL(asOwner.headers.get('location')!).searchParams.get('response-content-disposition')).toContain(encodeURIComponent(`${draft.slug}-${draftEmoji.id}.png`))
    expect((await dl(new Client(reviewer.cookie), pending.id)).status).toBe(302)
    expect((await dl(new Client(stranger.cookie), pending.id)).status).toBe(404)
    expect((await packRow(draft.id)).downloadCount).toBe(before.downloadCount)
    // counted per account for signed-in users
    expect(await counter(`user:${owner.id}`, 'orig')).toBeGreaterThanOrEqual(1)
  })

  test('originalsRequireLogin: guests 403, signed-in users pass', async () => {
    await useSettings({ originalsRequireLogin: true })
    try {
      const res = await dl(new Client(), pubEmojis[0]!.id)
      expect(res.status).toBe(403)
      expect(await body(res)).toMatchObject({ reason: 'login_required', error: '原图暂时只对登录用户开放，请先登录' })
      expect((await dl(new Client(stranger.cookie), pubEmojis[0]!.id)).status).toBe(302)
    } finally {
      await useSettings()
    }
  })
})

describe('daily limits', () => {
  test('perIpOriginalsPerDay: 429 with the 明天 0 点 message and Retry-After; signing in gets an own budget', async () => {
    await useSettings({ perIpOriginalsPerDay: 2 })
    try {
      const c = new Client()
      expect((await dl(c, pubEmojis[0]!.id)).status).toBe(302)
      expect((await dl(c, pubEmojis[1]!.id)).status).toBe(302)
      const res = await dl(c, pubEmojis[2]!.id)
      expect(res.status).toBe(429)
      const j = await body(res)
      expect(j).toMatchObject({ reason: 'originals_daily_limit', error: '今天下载得有点多，明天 0 点恢复', loginRaisesLimit: true })
      expect(Number(res.headers.get('retry-after'))).toBe(j.retryAfter as number)
      expect(j.retryAfter as number).toBeGreaterThan(0)
      expect(j.retryAfter as number).toBeLessThanOrEqual(86_400)
      expect(await counter(c.subject, 'orig')).toBe(2)
      // the same IP, signed in: counted per account
      expect((await dl(new Client(stranger.cookie, c.ip), pubEmojis[2]!.id)).status).toBe(302)
    } finally {
      await useSettings()
    }
  })

  test('Asia/Shanghai day boundary: the budget resets at 16:00 UTC and counters land on the right day', async () => {
    await useSettings({ perIpOriginalsPerDay: 1 })
    try {
      const c = new Client()
      const at = (iso: string) => deps({ now: () => new Date(iso) })
      expect((await dl(c, pubEmojis[0]!.id, 'save', {}, at('2026-10-20T15:59:30Z'))).status).toBe(302)
      const late = await dl(c, pubEmojis[1]!.id, 'save', {}, at('2026-10-20T15:59:50Z'))
      expect(late.status).toBe(429)
      expect((await body(late)).retryAfter).toBe(10)
      expect((await dl(c, pubEmojis[1]!.id, 'save', {}, at('2026-10-20T16:00:05Z'))).status).toBe(302)
      expect(await counter(c.subject, 'orig', '2026-10-20')).toBe(1)
      expect(await counter(c.subject, 'orig', '2026-10-21')).toBe(1)
    } finally {
      await useSettings()
    }
  })
})

describe('Cap challenge', () => {
  test('no Referer → 428 needCaptcha; a bad token stays 428; a valid one passes and clears the IP for later requests', async () => {
    await useSettings({ challengeSuspicious: true })
    const calls: string[] = []
    const verifyCap = async (token: string): Promise<CapResult> => {
      calls.push(token)
      return token === 'fake-good' ? { ok: true } : { ok: false, reason: 'invalid' }
    }
    const d = deps({ verifyCap })
    const c = new Client()
    const id = pubEmojis[0]!.id

    const first = await dl(c, id, 'view', { referer: null }, d)
    expect(first.status).toBe(428)
    expect(first.headers.get('cache-control')).toBe(NO_STORE)
    expect(await body(first)).toEqual({ needCaptcha: true, error: '请先完成人机验证', reason: 'captcha_required' })

    const bad = await dl(c, id, 'view', { referer: null, cap: 'forged' }, d)
    expect(bad.status).toBe(428)
    expect((await body(bad)).reason).toBe('captcha_invalid')

    const foreign = await dl(c, id, 'view', { referer: 'https://elsewhere.test/hotlink' }, d)
    expect(foreign.status).toBe(428)
    expect(await countersOf(c.subject)).toBe(0)

    // the ?cap= query parameter works like the x-cap-token header
    const ok = await handleEmojiDownload(c.request(`/dl/e/${id}?mode=view&cap=fake-good`, { referer: null }), id, d)
    expect(ok.status).toBe(302)
    expect(calls).toEqual(['forged', 'fake-good'])

    // cleared for this IP (stored in rate_windows, so the other replica sees it too)
    expect((await dl(c, id, 'view', { referer: null }, d)).status).toBe(302)
    expect(calls).toHaveLength(2)
    expect(await counter(c.subject, 'orig')).toBe(2)
    const [row] = await db()
      .select()
      .from(schema.rateWindows)
      .where(eq(schema.rateWindows.subject, c.subject))
      .then((rows) => rows.filter((r) => r.bucket === 'cap-ok'))
    expect(row!.windowStart.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000)
  })

  test('with the real verifier against the fake Cap server: single-use tokens', async () => {
    const c = new Client()
    const id = pubEmojis[1]!.id
    const token = goodToken()
    expect((await dl(c, id, 'view', { referer: null, cap: token })).status).toBe(302)
    const other = new Client()
    expect((await dl(other, id, 'view', { referer: null, cap: token })).status).toBe(428)
  })
})

describe('minute rates', () => {
  test('singleSignsPerMinute → 429; a 200-item batch in chunks of 20 never touches it', async () => {
    await freshMinute()
    await useSettings({ singleSignsPerMinute: 3, batchItemsPerMinute: null })
    try {
      const c = new Client()
      for (let i = 0; i < 3; i++) expect((await dl(c, pubEmojis[i % 3]!.id)).status).toBe(302)
      const limited = await dl(c, pubEmojis[0]!.id)
      expect(limited.status).toBe(429)
      expect(await body(limited)).toMatchObject({ reason: 'rate_limited' })
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)

      const b = new Client()
      const volume = crypto.randomUUID()
      const ids = pubEmojis.map((e) => e.id)
      for (let chunk = 0; chunk < 10; chunk++) {
        const res = await sign(b, { volume, first: chunk === 0, ids: Array.from({ length: 20 }, (_, i) => ids[i % ids.length]!) })
        expect(res.status).toBe(200)
      }
      // ids repeat inside a chunk and are signed once each: 3 per chunk
      expect(await counter(b.subject, 'batch_item')).toBe(30)
      for (let i = 0; i < 3; i++) expect((await dl(b, pubEmojis[i]!.id)).status).toBe(302)
    } finally {
      await useSettings()
    }
  })
})

function sign(client: Client, payload: unknown, opts: { origin?: string | null; referer?: string | null } = {}, d = deps()) {
  return handleBatchSign(
    client.request('/api/batch/sign', { body: payload, origin: opts.origin === undefined ? SITE_URL : opts.origin, referer: opts.referer === undefined ? null : opts.referer }),
    d,
  )
}

describe('POST /api/batch/sign', () => {
  beforeAll(() => useSettings())

  test('same-origin only: Origin must match SITE_URL, else Referer; neither → 403', async () => {
    const c = new Client()
    const payload = { volume: crypto.randomUUID(), first: true, ids: [pubEmojis[0]!.id] }
    const none = await sign(c, payload, { origin: null, referer: null })
    expect(none.status).toBe(403)
    expect(none.headers.get('cache-control')).toBe(NO_STORE)
    expect((await body(none)).reason).toBe('bad_origin')
    expect((await sign(c, payload, { origin: 'https://evil.test' })).status).toBe(403)
    expect((await sign(c, payload, { origin: 'https://evil.test', referer: `${SITE_URL}/batch` })).status).toBe(403)
    expect((await sign(c, payload, { origin: null, referer: 'https://evil.test/batch' })).status).toBe(403)
    expect(await countersOf(c.subject)).toBe(0)
    expect((await sign(c, payload, { origin: null, referer: `${SITE_URL}/batch` })).status).toBe(200)
  })

  test('bad bodies → 400, other methods → 405', async () => {
    const c = new Client()
    for (const bad of ['not json', { volume: 'x', first: true, ids: [pubEmojis[0]!.id] }, { volume: crypto.randomUUID(), first: true, ids: [] }, { volume: crypto.randomUUID(), first: true, ids: Array(21).fill(pubEmojis[0]!.id) }, { volume: crypto.randomUUID(), first: true, ids: ['nope'] }]) {
      const res = await sign(c, bad)
      expect(res.status).toBe(400)
    }
    const get = await handleBatchSign(c.request('/api/batch/sign', { origin: SITE_URL }), deps())
    expect(get.status).toBe(405)
  })

  test('signs allowed items with ZIP-style names and CREDITS blocks; denies the rest; counts per chunk and per volume', async () => {
    const c = new Client()
    const volume = crypto.randomUUID()
    const res = await sign(c, { volume, first: true, ids: [...pubEmojis.map((e) => e.id), offEmoji.id, pending.id, hidden.id, `r-${'e'.repeat(20)}`] })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe(NO_STORE)
    const j = await body<BatchSignResponse>(res)
    expect(j.volume).toBe(volume)
    expect(j.newVolume).toBe(true)
    expect(j.expiresIn).toBe(120)
    expect(j.items.map((i) => i.id)).toEqual(pubEmojis.map((e) => e.id))
    for (const item of j.items) {
      const e = pubEmojis.find((x) => x.id === item.id)!
      expect(item.filename).toBe(expectedName(e))
      const file = await fetch(item.url)
      expect(file.status).toBe(200)
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(e.body)
    }
    expect(j.denied).toEqual([
      { id: offEmoji.id, reason: 'not_downloadable' },
      { id: pending.id, reason: 'not_found' },
      { id: hidden.id, reason: 'not_found' },
      { id: `r-${'e'.repeat(20)}`, reason: 'not_found' },
    ])
    expect(j.credits).toHaveLength(1)
    expect(j.credits[0]).toMatchObject({
      slug: pub.slug,
      title: '下载测试包',
      artists: ['测试画师'],
      commissioner: '群友甲',
      license: 'cc-by-nc-sa-4.0',
      sourceUrl: 'https://emoji.wuwa.games/archives/dl-pub',
      pageUrl: `${SITE_URL}/packs/${pub.slug}`,
      files: j.items.map((i) => i.filename),
    })
    expect(j.site).toEqual({ siteName: '潮池', siteUrl: `${SITE_URL}/` })
    expect(await counter(c.subject, 'batch_item')).toBe(3)
    expect(await counter(c.subject, 'batch')).toBe(1)

    // later chunks of the same volume, and a retried first chunk, do not open another pack
    expect((await sign(c, { volume, first: false, ids: [pubEmojis[0]!.id] })).status).toBe(200)
    const retried = await body<BatchSignResponse>(await sign(c, { volume, first: true, ids: [pubEmojis[1]!.id] }))
    expect(retried.newVolume).toBe(false)
    expect(await counter(c.subject, 'batch_item')).toBe(5)
    expect(await counter(c.subject, 'batch')).toBe(1)

    // an unseen volume counts as a new pack even when the client claims first: false
    const sneaky = await body<BatchSignResponse>(await sign(c, { volume: crypto.randomUUID(), first: false, ids: [pubEmojis[2]!.id] }))
    expect(sneaky.newVolume).toBe(true)
    expect(await counter(c.subject, 'batch')).toBe(2)
  })

  test('signed in: originals count per account, packs per IP', async () => {
    const c = new Client(stranger.cookie)
    await sign(c, { volume: crypto.randomUUID(), first: true, ids: [pubEmojis[0]!.id, pubEmojis[1]!.id] })
    expect(await counter(`user:${stranger.id}`, 'batch_item')).toBeGreaterThanOrEqual(2)
    expect(await counter(c.subject, 'batch_item')).toBe(0)
    expect(await counter(c.subject, 'batch')).toBe(1)
  })

  test('pauseZipAndBatch → 403 paused; perIpPacksPerDay counts volumes and ZIPs together', async () => {
    await useSettings({ pauseZipAndBatch: true })
    try {
      const res = await sign(new Client(), { volume: crypto.randomUUID(), first: true, ids: [pubEmojis[0]!.id] })
      expect(res.status).toBe(403)
      expect((await body(res)).reason).toBe('paused')
    } finally {
      await useSettings()
    }
    await useSettings({ perIpPacksPerDay: 1 })
    try {
      const c = new Client()
      expect((await sign(c, { volume: crypto.randomUUID(), first: true, ids: [pubEmojis[0]!.id] })).status).toBe(200)
      const second = await sign(c, { volume: crypto.randomUUID(), first: true, ids: [pubEmojis[0]!.id] })
      expect(second.status).toBe(429)
      expect(await body(second)).toMatchObject({ reason: 'packs_daily_limit', error: '今天下载得有点多，明天 0 点恢复', loginRaisesLimit: false })
      expect((await handlePackZip(c.request(`/dl/p/${pub.slug}.zip`), pub.slug, deps())).status).toBe(429)
    } finally {
      await useSettings()
    }
  })
})

describe('GET /dl/p/:slug.zip', () => {
  beforeAll(() => useSettings())
  const zip = (c: Client, slug: string, query = '', opts: Parameters<Client['request']>[1] = {}) =>
    handlePackZip(c.request(`/dl/p/${encodeURIComponent(slug)}.zip${query}`, opts), slug, deps())

  test('202 building (job queued, nothing counted), then 302 to the built ZIP once zip_artifacts matches', async () => {
    const c = new Client()
    const first = await zip(c, pub.slug)
    expect(first.status).toBe(202)
    expect(first.headers.get('cache-control')).toBe(NO_STORE)
    expect(await body(first)).toEqual({ status: 'building' })
    const jobs = await withClient(DATABASE_URL, (cl) =>
      cl.query(`select data from pgboss.job where name = 'zip.build' and singleton_key = $1 and state in ('created', 'retry', 'active')`, [String(pub.id)]),
    )
    expect(jobs.rowCount).toBe(1)
    expect(await countersOf(c.subject)).toBe(0)

    const polled = await zip(c, pub.slug, '?poll=1')
    expect(polled.status).toBe(202)

    const built = await buildPackZip(pub.id)
    expect(built.status).toBe('built')
    const ready = await zip(c, pub.slug, '?poll=1')
    expect(ready.status).toBe(200)
    expect(await body(ready)).toMatchObject({ status: 'ready' })
    expect(await countersOf(c.subject)).toBe(0)

    const before = await packRow(pub.id)
    const res = await zip(c, pub.slug)
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location')!)
    expect(location.origin).toBe(S3_ORIGIN)
    expect(location.pathname).toEndWith((built as { key: string }).key)
    expect(location.searchParams.get('response-content-disposition')).toBe(`attachment; filename*=UTF-8''${encodeURIComponent(`${pub.slug}.zip`)}`)
    const file = await fetch(location)
    expect(file.status).toBe(200)
    expect((await file.arrayBuffer()).byteLength).toBe((built as { bytes: number }).bytes)
    expect(await counter(c.subject, 'zip')).toBe(1)
    expect((await packRow(pub.id)).downloadCount).toBe(before.downloadCount + 1)

    const asJson = await zip(c, pub.slug, '', { accept: 'application/json' })
    expect(asJson.status).toBe(200)
    expect(await body(asJson)).toMatchObject({ status: 'ready', filename: `${pub.slug}.zip`, expiresIn: 120 })
    expect(await counter(c.subject, 'zip')).toBe(2)
  })

  test('a content change (pack title) makes the recorded ZIP stale: 202 again', async () => {
    await db().update(schema.packs).set({ title: '下载测试包（改名）' }).where(eq(schema.packs.id, pub.id))
    const res = await zip(new Client(), pub.slug)
    expect(res.status).toBe(202)
    expect((await buildPackZip(pub.id)).status).toBe('built')
    expect((await zip(new Client(), pub.slug)).status).toBe(302)
  })

  test('not downloadable 403, unknown or unpublished 404, paused 403, no Referer 428', async () => {
    const c = new Client()
    expect((await zip(c, off.slug)).status).toBe(403)
    expect((await zip(c, draft.slug)).status).toBe(404)
    expect((await zip(c, 'no-such-pack')).status).toBe(404)
    expect((await zip(c, pub.slug, '', { referer: null })).status).toBe(428)
    await useSettings({ pauseZipAndBatch: true })
    try {
      expect((await zip(c, pub.slug)).status).toBe(403)
    } finally {
      await useSettings()
    }
    expect(await countersOf(c.subject)).toBe(0)
  })
})

describe('blocked_sources in force', () => {
  test('block → 403, watch → 428, an expired entry is ignored', async () => {
    const c = new Client()
    const id = pubEmojis[0]!.id
    const put = (mode: 'block' | 'watch', until: Date | null) =>
      db()
        .insert(schema.blockedSources)
        .values({ subject: c.subject, mode, until })
        .onConflictDoUpdate({ target: schema.blockedSources.subject, set: { mode, until } })
    await put('block', null)
    expect((await dl(c, id)).status).toBe(403)
    await put('watch', null)
    expect((await dl(c, id)).status).toBe(428)
    await put('block', new Date(Date.now() - 1000))
    expect((await dl(c, id)).status).toBe(302)
  })
})
