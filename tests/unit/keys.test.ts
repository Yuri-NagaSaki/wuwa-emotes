import { describe, expect, test } from 'bun:test'
import {
  backupKey,
  derivedKey,
  imgUrl,
  originalKey,
  parseImgPath,
  parseReviewImgPath,
  reviewImgUrl,
  reviewKey,
  uploadTmpKey,
  VARIANTS,
  zipKey,
} from '#/server/media/keys'

const PACK = 'shorekeeper-daily'
const EMOJI = 'r-0a7bf47f0ec26d3843bf'

describe('object keys', () => {
  test('layout matches docs/ARCHITECTURE.md §3', () => {
    expect(originalKey(PACK, EMOJI, 'gif')).toBe(`assets/v1/packs/${PACK}/emojis/${EMOJI}.gif`)
    expect(derivedKey('a160', PACK, EMOJI, 3)).toBe(`derived/v1/a160/${PACK}/${EMOJI}.r3.webp`)
    expect(reviewKey('p240', PACK, EMOJI)).toBe(`review/v1/p240/${PACK}/${EMOJI}.webp`)
    expect(zipKey(PACK, 'deadbeef')).toBe(`zips/v1/packs/${PACK}/${PACK}.deadbeef.zip`)
  })

  test('upload keys are dated and sanitised', () => {
    const at = new Date(Date.UTC(2026, 0, 5, 23, 59))
    expect(uploadTmpKey('up1', 'my file (1).gif', at)).toBe('uploads/tmp/2026/01/05/up1/my_file_1_.gif')
    expect(uploadTmpKey('up1', '../../etc/passwd', at)).toBe('uploads/tmp/2026/01/05/up1/.._.._etc_passwd')
    expect(uploadTmpKey('up1', '表情.gif', at)).toBe('uploads/tmp/2026/01/05/up1/_.gif')
    expect(uploadTmpKey('up1', '', at)).toBe('uploads/tmp/2026/01/05/up1/file')
  })

  test('backup keys are dated', () => {
    expect(backupKey(new Date('2026-10-20T03:00:00.123Z'))).toBe('backups/postgres/2026/10/20/2026-10-20T03-00-00-123Z.dump')
  })
})

describe('/img paths', () => {
  test('round trip for every variant', () => {
    for (const variant of VARIANTS) {
      for (const rev of [1, 2, 10, 999999999]) {
        const ref = { variant, packKey: PACK, emojiId: EMOJI, rev }
        expect(parseImgPath(imgUrl(ref))).toEqual(ref)
      }
    }
  })

  test.each([
    ['traversal', `/img/v1/p240/../${EMOJI}.r1.webp`],
    ['traversal in pack key', `/img/v1/p240/../../assets/${EMOJI}.r1.webp`],
    ['dot pack key', `/img/v1/p240/./${EMOJI}.r1.webp`],
    ['uppercase pack key', `/img/v1/p240/Shorekeeper/${EMOJI}.r1.webp`],
    ['uppercase emoji id', `/img/v1/p240/${PACK}/r-0A7BF47F0EC26D3843BF.r1.webp`],
    ['uppercase variant', `/img/v1/P240/${PACK}/${EMOJI}.r1.webp`],
    ['unknown variant', `/img/v1/p480/${PACK}/${EMOJI}.r1.webp`],
    ['extra segment', `/img/v1/p240/${PACK}/extra/${EMOJI}.r1.webp`],
    ['missing segment', `/img/v1/p240/${EMOJI}.r1.webp`],
    ['trailing slash', `/img/v1/p240/${PACK}/${EMOJI}.r1.webp/`],
    ['rev 0', `/img/v1/p240/${PACK}/${EMOJI}.r0.webp`],
    ['rev leading zero', `/img/v1/p240/${PACK}/${EMOJI}.r01.webp`],
    ['negative rev', `/img/v1/p240/${PACK}/${EMOJI}.r-1.webp`],
    ['missing rev', `/img/v1/p240/${PACK}/${EMOJI}.webp`],
    ['huge rev', `/img/v1/p240/${PACK}/${EMOJI}.r1234567890.webp`],
    ['wrong extension', `/img/v1/p240/${PACK}/${EMOJI}.r1.gif`],
    ['uppercase extension', `/img/v1/p240/${PACK}/${EMOJI}.r1.WEBP`],
    ['double extension', `/img/v1/p240/${PACK}/${EMOJI}.r1.webp.webp`],
    ['other version', `/img/v2/p240/${PACK}/${EMOJI}.r1.webp`],
    ['other prefix', `/assets/v1/p240/${PACK}/${EMOJI}.r1.webp`],
    ['encoded slash', `/img/v1/p240/${PACK}%2F${EMOJI}.r1.webp`],
    ['bad emoji id', `/img/v1/p240/${PACK}/r-123.r1.webp`],
    ['query in path', `/img/v1/p240/${PACK}/${EMOJI}.r1.webp?x=1`],
  ])('rejects %s', (_name, path) => {
    expect(parseImgPath(path)).toBeNull()
  })
})

describe('/review-img paths', () => {
  test('round trip', () => {
    for (const variant of ['p240', 'a160'] as const) {
      expect(parseReviewImgPath(reviewImgUrl(variant, PACK, EMOJI))).toEqual({ variant, packKey: PACK, emojiId: EMOJI })
    }
  })

  test.each([
    ['full has no review variant', `/review-img/v1/full/${PACK}/${EMOJI}.webp`],
    ['traversal', `/review-img/v1/p240/../${EMOJI}.webp`],
    ['uppercase pack key', `/review-img/v1/p240/Pack/${EMOJI}.webp`],
    ['extra segment', `/review-img/v1/p240/${PACK}/x/${EMOJI}.webp`],
    ['revisioned name', `/review-img/v1/p240/${PACK}/${EMOJI}.r1.webp`],
    ['wrong extension', `/review-img/v1/p240/${PACK}/${EMOJI}.png`],
    ['img prefix', `/img/v1/p240/${PACK}/${EMOJI}.webp`],
  ])('rejects %s', (_name, path) => {
    expect(parseReviewImgPath(path)).toBeNull()
  })
})
