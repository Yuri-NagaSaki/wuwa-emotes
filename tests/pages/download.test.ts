import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { type DownloadDeps, downloadUrl, isInAppBrowser, requestDownload } from '#/ui/pages/download'

// The download helper against a stub of the /dl endpoints that follows the contract of
// src/server/downloads/handlers.ts: JSON for Accept: application/json, error bodies
// { error, reason, retryAfter?, loginRaisesLimit?, needCaptcha? } with a Retry-After header.

type Handler = (url: URL, req: Request) => Response | Promise<Response>
let handler: Handler = () => new Response('unset', { status: 500 })
const seen: { path: string; accept: string | null }[] = []

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url)
    seen.push({ path: url.pathname + url.search, accept: req.headers.get('accept') })
    return handler(url, req)
  },
})
afterAll(() => server.stop(true))

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'private, no-store', ...headers } })

function deps(over: Partial<DownloadDeps> = {}) {
  const navigated: string[] = []
  const slept: number[] = []
  let caps = 0
  let clock = 0
  const d: DownloadDeps = {
    fetch: (url, init) => fetch(`http://localhost:${server.port}${url}`, init),
    sleep: async (ms) => {
      slept.push(ms)
      clock += ms
    },
    solveCap: async () => `tok-${++caps}`,
    navigate: (url) => navigated.push(url),
    now: () => clock,
    ...over,
  }
  return { d, navigated, slept, caps: () => caps }
}

beforeEach(() => {
  seen.length = 0
})

describe('URLs', () => {
  test('emoji and zip endpoints', () => {
    expect(downloadUrl({ kind: 'emoji', id: 'r-0123456789abcdef0123', mode: 'save' })).toBe('/dl/e/r-0123456789abcdef0123?mode=save')
    expect(downloadUrl({ kind: 'zip', slug: '爱秧斯坦-01' })).toBe('/dl/p/%E7%88%B1%E7%A7%A7%E6%96%AF%E5%9D%A6-01.zip')
    expect(downloadUrl({ kind: 'zip', slug: 'a' }, { poll: '1' })).toBe('/dl/p/a.zip?poll=1')
  })
})

describe('single sticker (/dl/e)', () => {
  const id = 'r-0123456789abcdef0123'

  test('save: asks for JSON, navigates to the signed URL', async () => {
    handler = () => json({ url: 'https://r2.example/obj?sig=1', filename: 'a-01.gif', expiresIn: 120 })
    const { d, navigated } = deps()
    const r = await requestDownload({ kind: 'emoji', id, mode: 'save' }, d)
    expect(r).toEqual({ ok: true, url: 'https://r2.example/obj?sig=1', filename: 'a-01.gif', bytes: null })
    expect(navigated).toEqual(['https://r2.example/obj?sig=1'])
    expect(seen).toEqual([{ path: `/dl/e/${id}?mode=save`, accept: 'application/json' }])
  })

  test('view: returns the URL for an <img>, does not navigate', async () => {
    handler = () => json({ url: 'https://r2.example/view', filename: 'a.gif', expiresIn: 120 })
    const { d, navigated } = deps()
    const r = await requestDownload({ kind: 'emoji', id, mode: 'view' }, d)
    expect(r.ok && r.url).toBe('https://r2.example/view')
    expect(navigated).toEqual([])
  })

  test('428 needCaptcha: solves Cap once and repeats with &cap=', async () => {
    handler = (url) =>
      url.searchParams.get('cap') === 'tok-1'
        ? json({ url: 'https://r2.example/ok', filename: 'x.gif', expiresIn: 120 })
        : json({ error: '需要人机验证', reason: 'captcha_required', needCaptcha: true }, 428)
    const events: string[] = []
    const { d, navigated, caps } = deps()
    const r = await requestDownload({ kind: 'emoji', id, mode: 'save' }, d, { onEvent: (e) => events.push(e.type) })
    expect(r.ok).toBe(true)
    expect(caps()).toBe(1)
    expect(events).toEqual(['captcha'])
    expect(seen.map((s) => s.path)).toEqual([`/dl/e/${id}?mode=save`, `/dl/e/${id}?mode=save&cap=tok-1`])
    expect(navigated).toEqual(['https://r2.example/ok'])
  })

  test('a second 428 after solving fails instead of looping', async () => {
    handler = () => json({ error: '人机验证没有通过', reason: 'captcha_invalid', needCaptcha: true }, 428)
    const { d, caps } = deps()
    const r = await requestDownload({ kind: 'emoji', id, mode: 'save' }, d)
    expect(r).toMatchObject({ ok: false, status: 428, reason: 'captcha_invalid', message: '人机验证没有通过' })
    expect(caps()).toBe(1)
    expect(seen.length).toBe(2)
  })

  test('captcha_unavailable is not retried (a token cannot help)', async () => {
    handler = () => json({ error: '人机验证暂时不可用', reason: 'captcha_unavailable', needCaptcha: true }, 428)
    const { d, caps } = deps()
    const r = await requestDownload({ kind: 'emoji', id, mode: 'save' }, d)
    expect(r).toMatchObject({ ok: false, reason: 'captcha_unavailable' })
    expect(caps()).toBe(0)
  })

  test('a Cap failure becomes a readable error', async () => {
    handler = () => json({ error: 'x', reason: 'captcha_required', needCaptcha: true }, 428)
    const { d } = deps({ solveCap: async () => Promise.reject(new Error('wasm blocked')) })
    const r = await requestDownload({ kind: 'emoji', id, mode: 'save' }, d)
    expect(r).toMatchObject({ ok: false, status: 428, message: '人机验证没有通过，请稍后再试' })
  })

  test('429 daily limit: message, retryAfter and loginRaisesLimit come through', async () => {
    handler = () =>
      json({ error: '今天下载得有点多，明天 0 点恢复', reason: 'originals_daily_limit', retryAfter: 3600, loginRaisesLimit: true }, 429, { 'retry-after': '3600' })
    const { d, navigated } = deps()
    const r = await requestDownload({ kind: 'emoji', id, mode: 'save' }, d)
    expect(r).toEqual({ ok: false, status: 429, reason: 'originals_daily_limit', message: '今天下载得有点多，明天 0 点恢复', retryAfter: 3600, loginRaisesLimit: true })
    expect(navigated).toEqual([])
  })

  test('403 and 404 reasons', async () => {
    for (const [status, reason, error] of [
      [403, 'not_downloadable', '这个表情包只提供预览，不提供原图下载'],
      [403, 'login_required', '原图暂时只对登录用户开放，请先登录'],
      [403, 'blocked', '这个来源的下载已被暂停'],
      [404, 'not_found', '找不到这张表情'],
    ] as const) {
      handler = () => json({ error, reason }, status)
      const r = await requestDownload({ kind: 'emoji', id, mode: 'view' }, deps().d)
      expect(r).toMatchObject({ ok: false, status, reason, message: error, loginRaisesLimit: false })
    }
  })

  test('network errors and non-JSON answers', async () => {
    const down = deps({ fetch: () => Promise.reject(new TypeError('Failed to fetch')) })
    expect(await requestDownload({ kind: 'emoji', id, mode: 'save' }, down.d)).toMatchObject({ ok: false, status: 0, reason: 'network', message: '网络连接失败，请稍后再试' })
    handler = () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } })
    expect(await requestDownload({ kind: 'emoji', id, mode: 'save' }, deps().d)).toMatchObject({ ok: false, status: 502, reason: 'bad_response' })
    handler = () => json({ filename: 'no url' })
    expect(await requestDownload({ kind: 'emoji', id, mode: 'save' }, deps().d)).toMatchObject({ ok: false, status: 200, reason: 'bad_response' })
  })
})

describe('whole pack (/dl/p/:slug.zip)', () => {
  test('ready: navigates to the signed ZIP', async () => {
    handler = () => json({ status: 'ready', url: 'https://r2.example/p.zip', filename: 'p.zip', bytes: 1234, expiresIn: 120 })
    const { d, navigated } = deps()
    const r = await requestDownload({ kind: 'zip', slug: 'p' }, d)
    expect(r).toEqual({ ok: true, url: 'https://r2.example/p.zip', filename: 'p.zip', bytes: 1234 })
    expect(navigated).toEqual(['https://r2.example/p.zip'])
  })

  test('202 building: polls with ?poll=1 honouring Retry-After, then signs without poll', async () => {
    let polls = 0
    handler = (url) => {
      if (url.searchParams.get('poll') === '1') {
        polls++
        return polls < 3 ? json({ status: 'building' }, 202, { 'retry-after': '5' }) : json({ status: 'ready', bytes: 99 })
      }
      return seen.length === 1 ? json({ status: 'building' }, 202, { 'retry-after': '5' }) : json({ status: 'ready', url: 'https://r2.example/z', filename: 'p.zip', bytes: 99, expiresIn: 120 })
    }
    const events: { type: string; waitedMs?: number }[] = []
    const { d, navigated, slept } = deps()
    const r = await requestDownload({ kind: 'zip', slug: 'p' }, d, { onEvent: (e) => events.push(e) })
    expect(r.ok).toBe(true)
    expect(seen.map((s) => s.path)).toEqual(['/dl/p/p.zip', '/dl/p/p.zip?poll=1', '/dl/p/p.zip?poll=1', '/dl/p/p.zip?poll=1', '/dl/p/p.zip'])
    expect(slept).toEqual([5000, 5000, 5000])
    expect(events.map((e) => e.type)).toEqual(['building', 'building', 'building'])
    expect(navigated).toEqual(['https://r2.example/z'])
  })

  test('polls at least every 2 s apart even without Retry-After, and give up after maxWaitMs', async () => {
    handler = () => json({ status: 'building' }, 202)
    const { d, slept, navigated } = deps()
    const r = await requestDownload({ kind: 'zip', slug: 'p' }, d, { maxWaitMs: 7000 })
    expect(slept.every((ms) => ms === 2000)).toBe(true)
    expect(r).toMatchObject({ ok: false, reason: 'timeout', message: '整包还在生成中，请过一会儿再点一次' })
    expect(navigated).toEqual([])
  })

  test('a poll answering 428 solves Cap and keeps polling', async () => {
    handler = (url) => {
      const poll = url.searchParams.get('poll') === '1'
      if (!poll && seen.length === 1) return json({ status: 'building' }, 202, { 'retry-after': '2' })
      if (poll && !url.searchParams.get('cap') && seen.length === 2) return json({ error: '需要验证', reason: 'captcha_required', needCaptcha: true }, 428)
      if (poll) return json({ status: 'ready', bytes: 1 })
      return json({ status: 'ready', url: 'https://r2.example/z', filename: 'p.zip', bytes: 1, expiresIn: 120 })
    }
    const { d, caps } = deps()
    const r = await requestDownload({ kind: 'zip', slug: 'p' }, d)
    expect(r.ok).toBe(true)
    expect(caps()).toBe(1)
    expect(seen.map((s) => s.path)).toEqual(['/dl/p/p.zip', '/dl/p/p.zip?poll=1', '/dl/p/p.zip?poll=1&cap=tok-1', '/dl/p/p.zip'])
  })

  test('429 packs_daily_limit and 403 paused while polling', async () => {
    handler = () => json({ error: '今天下载得有点多，明天 0 点恢复', reason: 'packs_daily_limit', retryAfter: 60, loginRaisesLimit: false }, 429, { 'retry-after': '60' })
    expect(await requestDownload({ kind: 'zip', slug: 'p' }, deps().d)).toMatchObject({ ok: false, status: 429, reason: 'packs_daily_limit', retryAfter: 60 })
    handler = (url) =>
      url.searchParams.get('poll') ? json({ error: '整包与打包下载暂停中，单张下载不受影响', reason: 'paused' }, 403) : json({ status: 'building' }, 202)
    expect(await requestDownload({ kind: 'zip', slug: 'p' }, deps().d)).toMatchObject({ ok: false, status: 403, reason: 'paused' })
  })

  test('abort stops polling and rejects with AbortError', async () => {
    handler = () => json({ status: 'building' }, 202)
    const ctl = new AbortController()
    const { d } = deps({
      sleep: async () => {
        ctl.abort()
      },
    })
    let err: unknown
    try {
      await requestDownload({ kind: 'zip', slug: 'p' }, d, { signal: ctl.signal })
    } catch (e) {
      err = e
    }
    expect((err as Error)?.name).toBe('AbortError')
  })
})

describe('in-app browsers (WeChat / QQ) cannot save ZIP files', () => {
  test('detection', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) AppleWebKit/605 Mobile/15E148 MicroMessenger/8.0.47(0x18002f2f) NetType/WIFI Language/zh_CN')).toBe(true)
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/117 Mobile Safari/537.36 V1_AND_SQ_9.0.0_4330_YYB_D QQ/9.0.0.14110 NetType/WIFI')).toBe(true)
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/117 MQQBrowser/14.7 Mobile Safari/537.36')).toBe(false)
    expect(isInAppBrowser('Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36')).toBe(false)
  })
})
