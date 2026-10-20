import { describe, expect, test } from 'bun:test'
import { downloadZip } from 'client-zip'
import { unzipSync } from 'fflate'
import { BATCH_MAX_IDS, type BatchSignResponse } from '#/server/downloads/handlers'
import { BATCH_ITEMS_MAX } from '#/server/catalog/inputs'
import type { BatchItem } from '#/server/catalog/types'
import { batchView, chunks, ITEMS_PAGE, SIGN_CHUNK, uniqueName, VOLUME_MAX, volumeCount, zipFileName } from '#/ui/batch/plan'
import { buildVolume, type RunnerDeps, type SignBody } from '#/ui/batch/runner'

// The browser-side batch ZIP against a stub of POST /api/batch/sign that follows the contract of
// src/server/downloads/handlers.ts (items, denied, credits per pack, site, retryAfter), stub storage,
// and the real client-zip; the ZIP is read back with fflate.

const id = (n: number) => `r-${n.toString(16).padStart(20, '0')}`

interface Fx {
  slug: string
  title: string
  name: string
  body: string
  downloadable?: boolean
}

/** ids 1–30 in pack "alpha", 31–60 in "beta"; 99 is preview only; 98 does not exist. */
function catalog(): Map<string, Fx> {
  const m = new Map<string, Fx>()
  for (let n = 1; n <= 60; n++) {
    const slug = n <= 30 ? 'alpha' : 'beta'
    const k = n <= 30 ? n : n - 30
    m.set(id(n), { slug, title: slug === 'alpha' ? '阿尔法表情' : '贝塔表情', name: `${slug}-${String(k).padStart(2, '0')}.gif`, body: `GIF89a-${n}` })
  }
  m.set(id(99), { slug: 'gamma', title: '官方', name: 'gamma-01.png', body: 'x', downloadable: false })
  return m
}

type Script = (body: SignBody, call: number) => Response | null

function harness(opts: { script?: Script; fetchStatus?: (url: string, attempt: number) => number } = {}) {
  const fx = catalog()
  const calls: { body: SignBody; cap: string | null }[] = []
  const fetched: string[] = []
  const slept: number[] = []
  let caps = 0
  let uuids = 0
  const attempts = new Map<string, number>()
  const deps: RunnerDeps = {
    async sign(body, { capToken }) {
      calls.push({ body, cap: capToken })
      const scripted = opts.script?.(body, calls.length)
      if (scripted) return scripted
      const items: BatchSignResponse['items'] = []
      const denied: BatchSignResponse['denied'] = []
      const credits = new Map<string, BatchSignResponse['credits'][number]>()
      for (const i of body.ids) {
        const f = fx.get(i)
        if (!f) denied.push({ id: i, reason: 'not_found' })
        else if (f.downloadable === false) denied.push({ id: i, reason: 'not_downloadable' })
        else {
          items.push({ id: i, url: `https://storage.test/${i}`, filename: f.name })
          const c = credits.get(f.slug) ?? { slug: f.slug, title: f.title, artists: ['画师甲'], license: 'cc-by-nc-sa-4.0', pageUrl: `https://site.test/packs/${f.slug}`, files: [] }
          c.files!.push(f.name)
          credits.set(f.slug, c)
        }
      }
      const res: BatchSignResponse = {
        volume: body.volume,
        newVolume: body.first,
        items,
        denied,
        credits: [...credits.values()],
        site: { siteName: '潮池', siteUrl: 'https://site.test/' },
        expiresIn: 120,
      }
      return Response.json(res)
    },
    async fetchFile(url) {
      const n = (attempts.get(url) ?? 0) + 1
      attempts.set(url, n)
      fetched.push(url)
      const status = opts.fetchStatus?.(url, n) ?? 200
      if (status !== 200) return new Response('no', { status })
      const i = url.split('/').pop()!
      return new Response(fx.get(i)!.body)
    },
    zip: (entries) => downloadZip(entries).blob(),
    sleep: async (ms, signal) => {
      signal?.throwIfAborted()
      slept.push(ms)
    },
    solveCap: async () => `cap-${++caps}`,
    uuid: () => `00000000-0000-4000-8000-${String(++uuids).padStart(12, '0')}`,
    now: () => new Date('2026-10-20T04:00:00Z'),
  }
  return { deps, calls, fetched, slept, attempts }
}

async function unzip(blob: Blob | null) {
  expect(blob).not.toBeNull()
  const files = unzipSync(new Uint8Array(await blob!.arrayBuffer()))
  const text = (name: string) => new TextDecoder().decode(files[name])
  return { names: Object.keys(files), text }
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => id(a + k))
const json = (body: unknown, status = 200) => Response.json(body, { status })

describe('batch plan', () => {
  test('chunk sizes agree with the server', () => {
    expect(SIGN_CHUNK).toBe(BATCH_MAX_IDS)
    expect(ITEMS_PAGE).toBe(BATCH_ITEMS_MAX)
    expect(VOLUME_MAX).toBe(200)
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(volumeCount(0)).toBe(1)
    expect(volumeCount(200)).toBe(1)
    expect(volumeCount(201)).toBe(2)
  })

  test('names', () => {
    const taken = new Set<string>()
    expect(uniqueName('a-01.gif', taken)).toBe('a-01.gif')
    expect(uniqueName('a-01.gif', taken)).toBe('a-01-2.gif')
    expect(uniqueName('a-01.gif', taken)).toBe('a-01-3.gif')
    expect(uniqueName('README', taken)).toBe('README')
    expect(uniqueName('README', taken)).toBe('README-2')
    expect(zipFileName('chaochi.example', 32, 1, 1)).toBe('chaochi-32-stickers.zip')
    expect(zipFileName('www.example.com', 200, 2, 3)).toBe('example-200-stickers-part2.zip')
    expect(zipFileName('localhost', 5, 1, 1)).toBe('localhost-5-stickers.zip')
    expect(zipFileName('', 5, 1, 1)).toBe('stickers-5-stickers.zip')
  })

  test('the list grouped for the page: packable, preview only, missing, loading', () => {
    const item = (n: number, slug: string, downloadable = true): BatchItem => ({
      id: id(n),
      poster: `/p/${n}`,
      preview: null,
      full: `/f/${n}`,
      width: 300,
      height: 300,
      frames: 1,
      format: 'png',
      bytes: 1000 + n,
      index: n,
      pack: { slug, title: slug.toUpperCase(), downloadable },
    })
    const known = new Map<string, BatchItem | null>([
      [id(1), item(1, 'a')],
      [id(2), item(2, 'b')],
      [id(3), item(3, 'a')],
      [id(4), item(4, 'off', false)],
      [id(5), null],
    ])
    const v = batchView([id(1), id(2), id(3), id(4), id(5), id(6)], known)
    expect(v.packable).toEqual([id(1), id(2), id(3)])
    expect(v.groups.map((g) => [g.slug, g.items.map((i) => i.id)])).toEqual([
      ['a', [id(1), id(3)]],
      ['b', [id(2)]],
    ])
    expect(v.previewOnly.map((g) => g.slug)).toEqual(['off'])
    expect(v.missing).toEqual([id(5)])
    expect(v.loading).toEqual([id(6)])
    expect(v.bytes).toBe(1001 + 1002 + 1003)
  })
})

describe('buildVolume', () => {
  test('signs in chunks of 20 for one volume, fetches every original, writes CREDITS.txt', async () => {
    const h = harness()
    const ids = [...range(1, 25), ...range(31, 50)]
    const progress: number[] = []
    const r = await buildVolume(ids, h.deps, { onProgress: (p) => progress.push(p.done) })
    expect(h.calls.map((c) => c.body.ids.length)).toEqual([20, 20, 5])
    expect(h.calls.map((c) => c.body.first)).toEqual([true, false, false])
    expect(new Set(h.calls.map((c) => c.body.volume)).size).toBe(1)
    expect(h.calls.every((c) => c.cap === null)).toBe(true)
    expect(r.stop).toBeNull()
    expect(r.rest).toEqual([])
    expect(r.failed).toEqual([])
    expect(r.files.map((f) => f.id)).toEqual(ids)
    expect(progress.at(-1)).toBe(45)

    const z = await unzip(r.blob)
    expect(z.names).toEqual([...r.files.map((f) => f.name), 'CREDITS.txt'])
    expect(z.text('alpha-03.gif')).toBe(`GIF89a-3`)
    const credits = z.text('CREDITS.txt')
    expect(credits).toBe(r.credits)
    expect(credits).toContain('潮池 · CREDITS')
    expect(credits).toContain('表情包：阿尔法表情')
    expect(credits).toContain('表情包：贝塔表情')
    expect(credits).toContain('本站页面：https://site.test/packs/alpha')
    expect(credits).toContain(`文件：${range(1, 25).map((_, k) => `alpha-${String(k + 1).padStart(2, '0')}.gif`).join('、')}`)
    expect(credits).toContain('许可：CC BY-NC-SA 4.0')
    expect(credits).toContain('打包自 潮池（https://site.test） · 2026-10-20')
    expect(credits.indexOf('阿尔法表情')).toBeLessThan(credits.indexOf('贝塔表情'))
  })

  test('at most 200 per volume; the rest is returned for the next one', async () => {
    const h = harness()
    const ids = Array.from({ length: 230 }, (_, k) => id(1 + (k % 60))).map((x, k) => (k < 60 ? x : id(1000 + k)))
    const r = await buildVolume(ids, h.deps)
    expect(h.calls.reduce((s, c) => s + c.body.ids.length, 0)).toBe(200)
    expect(r.rest).toEqual(ids.slice(200))
    // ids the server does not know are failures, not stops
    expect(r.failed.every((f) => f.reason === 'not_found')).toBe(true)
    expect(r.files.length).toBe(60)
  })

  test('denied, preview-only and failed fetches are reported; CREDITS lists only what is inside', async () => {
    const h = harness({ fetchStatus: (url, attempt) => (url.endsWith(id(2)) ? 500 : url.endsWith(id(3)) ? 403 : url.endsWith(id(4)) && attempt === 1 ? 500 : 200) })
    const r = await buildVolume([id(1), id(2), id(3), id(4), id(99), id(98)], h.deps)
    expect(r.files.map((f) => f.id)).toEqual([id(1), id(4)])
    expect(r.failed).toEqual([
      { id: id(99), reason: 'not_downloadable', message: '这个包只提供预览，不提供原图与打包' },
      { id: id(98), reason: 'not_found', message: '已下架或暂不可见' },
      { id: id(2), reason: 'fetch_failed', message: '原图没有下载成功' },
      { id: id(3), reason: 'fetch_failed', message: '原图没有下载成功' },
    ])
    // 500 is retried once, 403 (expired or refused link) is not
    expect(h.attempts.get(`https://storage.test/${id(2)}`)).toBe(2)
    expect(h.attempts.get(`https://storage.test/${id(3)}`)).toBe(1)
    expect(h.attempts.get(`https://storage.test/${id(4)}`)).toBe(2)
    const z = await unzip(r.blob)
    expect(z.names).toEqual(['alpha-01.gif', 'alpha-04.gif', 'CREDITS.txt'])
    expect(z.text('CREDITS.txt')).toContain('文件：alpha-01.gif、alpha-04.gif')
    expect(z.text('CREDITS.txt')).not.toContain('官方')
  })

  test('rate-limited ids wait for retryAfter and are signed again in the same volume', async () => {
    const h = harness({
      script: (body, call) => {
        if (call !== 1) return null
        // the first 3 pass, the rest are held back by the minute rate
        const items = body.ids.slice(0, 3).map((i) => ({ id: i, url: `https://storage.test/${i}`, filename: `alpha-${i.slice(-2)}.gif` }))
        return json({
          volume: body.volume,
          newVolume: true,
          items,
          denied: body.ids.slice(3).map((i) => ({ id: i, reason: 'rate_limited' })),
          credits: [{ slug: 'alpha', title: '阿尔法表情', files: items.map((x) => x.filename) }],
          site: { siteName: '潮池', siteUrl: 'https://site.test/' },
          expiresIn: 120,
          retryAfter: 3,
        })
      },
    })
    const waits: number[] = []
    const r = await buildVolume(range(1, 10), h.deps, { onProgress: (p) => p.phase === 'wait' && waits.push(p.waitSeconds!) })
    expect(waits).toEqual([3, 2, 1])
    expect(h.slept).toEqual([1000, 1000, 1000])
    expect(h.calls.map((c) => c.body.ids)).toEqual([range(1, 10), range(4, 10)])
    expect(h.calls[1]!.body.first).toBe(false)
    expect(r.files.length).toBe(10)
    expect(r.stop).toBeNull()
  })

  test('a 429 for the whole request waits, then gives up after a few tries', async () => {
    const h = harness({ script: () => json({ error: '操作太频繁，请稍后再试', reason: 'rate_limited', retryAfter: 1 }, 429) })
    const r = await buildVolume(range(1, 5), h.deps, { maxRateWaits: 2 })
    expect(h.calls.length).toBe(3)
    expect(r.stop).toMatchObject({ reason: 'rate_limited', message: '操作太频繁，请稍后再试' })
    expect(r.blob).toBeNull()
    expect(r.rest).toEqual(range(1, 5))
  })

  test('428: one invisible Cap solve, the token goes with the retry; a second 428 stops', async () => {
    let n = 0
    const h = harness({ script: () => (++n === 1 ? json({ error: '请先完成人机验证', reason: 'captcha_required', needCaptcha: true }, 428) : null) })
    const r = await buildVolume(range(1, 3), h.deps)
    expect(h.calls.map((c) => c.cap)).toEqual([null, 'cap-1'])
    expect(h.calls[1]!.body.first).toBe(true)
    expect(r.files.length).toBe(3)

    const h2 = harness({ script: () => json({ error: '人机验证没有通过', reason: 'captcha_invalid', needCaptcha: true }, 428) })
    const r2 = await buildVolume(range(1, 3), h2.deps)
    expect(h2.calls.length).toBe(2)
    expect(r2.stop?.reason).toBe('captcha_failed')
    expect(r2.blob).toBeNull()

    const h3 = harness({ script: () => json({ error: '人机验证暂时不可用', reason: 'captcha_unavailable', needCaptcha: true }, 428) })
    const r3 = await buildVolume(range(1, 3), h3.deps)
    expect(h3.calls.length).toBe(1)
    expect(r3.stop?.reason).toBe('captcha_failed')
  })

  test('volume_full closes the ZIP; the deferred ids start the next volume', async () => {
    // the site's 单次打包张数上限 is 7
    let signed = new Map<string, number>()
    const limit = 7
    const h = harness({
      script: (body) => {
        const used = signed.get(body.volume) ?? 0
        const room = Math.max(0, limit - used)
        const ok = body.ids.slice(0, room)
        signed.set(body.volume, used + ok.length)
        const items = ok.map((i) => ({ id: i, url: `https://storage.test/${i}`, filename: `alpha-${i.slice(-2)}.gif` }))
        return json({
          volume: body.volume,
          newVolume: used === 0,
          items,
          denied: body.ids.slice(room).map((i) => ({ id: i, reason: 'volume_full' })),
          credits: items.length ? [{ slug: 'alpha', title: '阿尔法表情', files: items.map((x) => x.filename) }] : [],
          site: { siteName: '潮池', siteUrl: 'https://site.test/' },
          expiresIn: 120,
        })
      },
    })
    const ids = range(1, 30)
    const first = await buildVolume(ids, h.deps)
    expect(first.files.map((f) => f.id)).toEqual(range(1, 7))
    expect(first.rest).toEqual(range(8, 30))
    expect(first.stop).toBeNull()
    const second = await buildVolume(first.rest, h.deps)
    expect(second.files.map((f) => f.id)).toEqual(range(8, 14))
    expect(new Set(h.calls.map((c) => c.body.volume)).size).toBe(2)

    // a limit of 0 would loop forever: stop instead
    signed = new Map()
    const h0 = harness({
      script: (body) =>
        json({ volume: body.volume, newVolume: false, items: [], denied: body.ids.map((i) => ({ id: i, reason: 'volume_full' })), credits: [], site: { siteName: '潮池', siteUrl: '' }, expiresIn: 120 }),
    })
    const none = await buildVolume(range(1, 3), h0.deps)
    expect(none.stop?.reason).toBe('volume_full')
    expect(none.blob).toBeNull()
  })

  test('daily limits stop the run; what was fetched is still zipped', async () => {
    // whole request refused: nothing packed
    const h = harness({
      script: () => json({ error: '今天下载得有点多，明天 0 点恢复', reason: 'packs_daily_limit', retryAfter: 3600, loginRaisesLimit: false }, 429),
    })
    const r = await buildVolume(range(1, 5), h.deps)
    expect(r.stop).toEqual({ reason: 'packs_daily_limit', message: '今天下载得有点多，明天 0 点恢复', retryAfter: 3600, loginRaisesLimit: false })
    expect(r.blob).toBeNull()
    expect(r.rest).toEqual(range(1, 5))

    // partial: the originals budget runs out in the second chunk
    const h2 = harness({
      script: (body, call) => {
        if (call === 1) return null
        if (call === 2) {
          const items = body.ids.slice(0, 2).map((i) => ({ id: i, url: `https://storage.test/${i}`, filename: `alpha-${i.slice(-2)}.gif` }))
          return json({
            volume: body.volume,
            newVolume: false,
            items,
            denied: body.ids.slice(2).map((i) => ({ id: i, reason: 'originals_daily_limit' })),
            credits: [{ slug: 'alpha', title: '阿尔法表情', files: items.map((x) => x.filename) }],
            site: { siteName: '潮池', siteUrl: 'https://site.test/' },
            expiresIn: 120,
          })
        }
        return json({ error: '今天下载得有点多，明天 0 点恢复', reason: 'originals_daily_limit', retryAfter: 60, loginRaisesLimit: true }, 429)
      },
    })
    const r2 = await buildVolume(range(1, 50), h2.deps)
    expect(h2.calls.length).toBe(2)
    expect(r2.files.length).toBe(22)
    expect(r2.stop?.reason).toBe('originals_daily_limit')
    expect(r2.rest).toEqual([...range(23, 40), ...range(41, 50)])
    expect((await unzip(r2.blob)).names.length).toBe(23)

    // login raises the limit: passed through for the page's 登录 link
    const h3 = harness({ script: () => json({ error: '今天下载得有点多，明天 0 点恢复', reason: 'originals_daily_limit', retryAfter: 60, loginRaisesLimit: true }, 429) })
    expect((await buildVolume(range(1, 2), h3.deps)).stop?.loginRaisesLimit).toBe(true)
  })

  test('paused and blocked stop with the server message; network errors retry once', async () => {
    const h = harness({ script: () => json({ error: '整包与打包下载暂停中，单张下载不受影响', reason: 'paused' }, 403) })
    const r = await buildVolume(range(1, 2), h.deps)
    expect(r.stop).toMatchObject({ reason: 'paused', message: '整包与打包下载暂停中，单张下载不受影响' })

    let n = 0
    const h2 = harness()
    const sign = h2.deps.sign
    h2.deps.sign = async (b, o) => {
      if (++n === 1) throw new TypeError('Failed to fetch')
      return sign(b, o)
    }
    const r2 = await buildVolume(range(1, 2), h2.deps)
    expect(r2.files.length).toBe(2)
    expect(h2.slept).toEqual([2000])

    const h3 = harness()
    h3.deps.sign = async () => {
      throw new TypeError('Failed to fetch')
    }
    const r3 = await buildVolume(range(1, 2), h3.deps)
    expect(r3.stop).toMatchObject({ reason: 'network', message: '网络连接失败，请稍后再试' })
  })

  test('cancel rejects with AbortError and stops signing', async () => {
    const h = harness()
    const ctl = new AbortController()
    let fetches = 0
    const fetchFile = h.deps.fetchFile
    h.deps.fetchFile = async (url, signal) => {
      if (++fetches === 5) ctl.abort()
      signal?.throwIfAborted()
      return fetchFile(url, signal)
    }
    await expect(buildVolume(range(1, 60), h.deps, { signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(h.calls.length).toBe(1)
  })

  test('the same file name twice gets a suffix, in the ZIP and in CREDITS', async () => {
    const h = harness({
      script: (body) => {
        const items = body.ids.map((i) => ({ id: i, url: `https://storage.test/${i}`, filename: 'same.gif' }))
        return json({
          volume: body.volume,
          newVolume: true,
          items,
          denied: [],
          credits: [{ slug: 'alpha', title: '阿尔法表情', files: ['same.gif'] }],
          site: { siteName: '潮池', siteUrl: 'https://site.test/' },
          expiresIn: 120,
        })
      },
    })
    const r = await buildVolume(range(1, 3), h.deps)
    const z = await unzip(r.blob)
    expect(z.names).toEqual(['same.gif', 'same-2.gif', 'same-3.gif', 'CREDITS.txt'])
    expect(z.text('CREDITS.txt')).toContain('文件：same.gif、same-2.gif、same-3.gif')
  })
})
