import { describe, expect, test } from 'bun:test'
import { canViewReviewImage, handleReviewImg, type ReviewEmoji, type ReviewImgDeps } from '#/server/http/review-img'
import type { ImgObject } from '#/server/media/img'

const PACK = 'new-pack-1a2b3c4d'
const EMOJI = 'r-0a7bf47f0ec26d3843bf'
const URL_P240 = `https://chaochi.example/review-img/v1/p240/${PACK}/${EMOJI}.webp`

const owner = { id: 'u-owner', role: 'user' as const }
const stranger = { id: 'u-other', role: 'user' as const }
const manager = { id: 'u-manager', role: 'manager' as const }
const admin = { id: 'u-admin', role: 'admin' as const }
const pending: ReviewEmoji = { status: 'pending', storagePackKey: PACK, ownerId: owner.id }

describe('canViewReviewImage', () => {
  test.each<[string, Parameters<typeof canViewReviewImage>[0], ReviewEmoji | null, boolean]>([
    ['owner, pending', owner, pending, true],
    ['owner, hidden', owner, { ...pending, status: 'hidden' }, true],
    ['owner, published', owner, { ...pending, status: 'published' }, false],
    ['stranger', stranger, pending, false],
    ['manager (review perm)', manager, pending, true],
    ['admin', admin, { ...pending, status: 'published' }, true],
    ['anonymous', null, pending, false],
    ['unknown emoji', admin, null, false],
    ['ownerless pack', stranger, { ...pending, ownerId: null }, false],
  ])('%s → %p', (_name, viewer, row, expected) => {
    expect(canViewReviewImage(viewer, PACK, row)).toBe(expected)
  })

  test('URL pack key must be the storage pack key, even for reviewers', () => {
    expect(canViewReviewImage(admin, 'some-other-pack', pending)).toBe(false)
  })
})

function deps(viewer: Parameters<typeof canViewReviewImage>[0], row: ReviewEmoji | null, obj: ImgObject | null = { body: new Response('webp').body, contentLength: 4 }) {
  const calls = { viewer: 0, lookup: [] as string[], get: [] as string[] }
  const d: ReviewImgDeps = {
    async getViewer() {
      calls.viewer++
      return viewer
    },
    async lookupEmoji(id) {
      calls.lookup.push(id)
      return row
    },
    async getObject(key) {
      calls.get.push(key)
      return obj
    },
  }
  return { d, calls }
}

describe('handleReviewImg', () => {
  test('allowed: streams review/v1 with private, no-store', async () => {
    const { d, calls } = deps(owner, pending)
    const res = await handleReviewImg(new Request(URL_P240), d)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(await res.text()).toBe('webp')
    expect(calls.get).toEqual([`review/v1/p240/${PACK}/${EMOJI}.webp`])
  })

  test('every refusal is the same private 404', async () => {
    const cases: [Parameters<typeof canViewReviewImage>[0], ReviewEmoji | null, ImgObject | null][] = [
      [null, pending, null],
      [stranger, pending, null],
      [owner, { ...pending, status: 'published' }, null],
      [admin, null, null],
      [admin, pending, null], // allowed but the object is gone
    ]
    for (const [viewer, row, obj] of cases) {
      const { d } = deps(viewer, row, obj)
      const res = await handleReviewImg(new Request(URL_P240), d)
      expect(res.status).toBe(404)
      expect(res.headers.get('cache-control')).toBe('private, no-store')
      expect(await res.text()).toBe('Not found')
    }
  })

  test('anonymous requests never reach the database', async () => {
    const { d, calls } = deps(null, pending)
    await handleReviewImg(new Request(URL_P240), d)
    expect(calls.lookup).toEqual([])
    expect(calls.get).toEqual([])
  })

  test('malformed paths are 404 before the session is read', async () => {
    const { d, calls } = deps(admin, pending)
    for (const p of [`/review-img/v1/full/${PACK}/${EMOJI}.webp`, `/review-img/v1/p240/${PACK}/${EMOJI}.r1.webp`, '/review-img/x']) {
      expect((await handleReviewImg(new Request('https://chaochi.example' + p), d)).status).toBe(404)
    }
    expect(calls.viewer).toBe(0)
  })

  test('HEAD has no body; other methods are 405', async () => {
    const head = await handleReviewImg(new Request(URL_P240, { method: 'HEAD' }), deps(manager, pending).d)
    expect(head.status).toBe(200)
    expect(head.body).toBeNull()
    const post = await handleReviewImg(new Request(URL_P240, { method: 'POST' }), deps(manager, pending).d)
    expect(post.status).toBe(405)
  })
})
