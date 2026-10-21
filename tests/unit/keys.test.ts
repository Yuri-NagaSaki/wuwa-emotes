import { describe, expect, test } from 'bun:test'
import {
  backupKey,
  derivedKey,
  IMMUTABLE,
  imgPath,
  imgUrl,
  isPortraitName,
  isPublicImageKey,
  objectCacheControl,
  originalKey,
  parseImgPath,
  parsePortraitKey,
  parsePortraitPath,
  parseReviewImgPath,
  portraitKey,
  portraitPath,
  portraitUrl,
  publicObjectUrl,
  reviewImgUrl,
  reviewKey,
  uploadTmpKey,
  VARIANTS,
  webImageUrl,
  zipKey,
} from '#/server/media/keys'
import { cdnUrls } from '#/server/media/purge'
import { originImagePath } from '#/shared/web-image'

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

  test('backup keys are dated and name the encrypted format', () => {
    expect(backupKey(new Date('2026-10-20T03:00:00.123Z'))).toBe('backups/postgres/2026/10/20/2026-10-20T03-00-00-123Z.dump.enc')
  })
})

describe('/img paths', () => {
  test('round trip for every variant', () => {
    for (const variant of VARIANTS) {
      for (const rev of [1, 2, 10, 999999999]) {
        const ref = { variant, packKey: PACK, emojiId: EMOJI, rev }
        expect(parseImgPath(imgPath(ref))).toEqual(ref)
        expect(imgUrl(ref, '')).toBe(imgPath(ref))
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

describe('portrait keys and /img/v1/portrait paths', () => {
  test('round trip', () => {
    for (const width of [240, 480] as const) {
      const ref = { name: 'yangyang-xuanling', hash8: '0a1b2c3d', width }
      expect(portraitKey(ref)).toBe(`characters/v1/portraits/yangyang-xuanling.0a1b2c3d-${width}.webp`)
      expect(portraitPath(ref)).toBe(`/img/v1/portrait/yangyang-xuanling.0a1b2c3d-${width}.webp`)
      expect(portraitUrl(ref, '')).toBe(portraitPath(ref))
      expect(parsePortraitKey(portraitKey(ref))).toEqual(ref)
      expect(parsePortraitPath(portraitPath(ref))).toEqual(ref)
    }
  })

  test.each([
    ['other width', '/img/v1/portrait/a.0a1b2c3d-320.webp'],
    ['uppercase hex', '/img/v1/portrait/a.0A1B2C3D-240.webp'],
    ['short hash', '/img/v1/portrait/a.0a1b2c3-240.webp'],
    ['uppercase name', '/img/v1/portrait/Aimisi.0a1b2c3d-240.webp'],
    ['traversal', '/img/v1/portrait/../a.0a1b2c3d-240.webp'],
    ['dot name', '/img/v1/portrait/..0a1b2c3d-240.webp'],
    ['extra segment', '/img/v1/portrait/x/a.0a1b2c3d-240.webp'],
    ['encoded slash', '/img/v1/portrait/x%2Fa.0a1b2c3d-240.webp'],
    ['wrong extension', '/img/v1/portrait/a.0a1b2c3d-240.png'],
    ['other prefix', '/img/v1/portraits/a.0a1b2c3d-240.webp'],
    ['trailing slash', '/img/v1/portrait/a.0a1b2c3d-240.webp/'],
  ])('rejects %s', (_name, path) => {
    expect(parsePortraitPath(path)).toBeNull()
  })

  test('stored keys outside characters/v1/portraits/ are not portraits', () => {
    expect(parsePortraitKey('derived/v1/portraits/a.0a1b2c3d-240.webp')).toBeNull()
    expect(parsePortraitKey('characters/v1/portraits/a.0a1b2c3d-240.png')).toBeNull()
    expect(parsePortraitKey('characters/v1/portraits/sub/a.0a1b2c3d-240.webp')).toBeNull()
  })

  test('names are readable slugs of at most 60 characters', () => {
    expect(isPortraitName('x-1a2b3c4d')).toBe(true)
    expect(isPortraitName('a'.repeat(60))).toBe(true)
    expect(isPortraitName('a'.repeat(61))).toBe(false)
    expect(isPortraitName('a--b')).toBe(false)
    expect(isPortraitName('-a')).toBe(false)
    expect(isPortraitName('')).toBe(false)
  })
})

describe('web image URLs (PUBLIC_IMG_BASE)', () => {
  const BASE = 'https://i.example'
  const ref = (variant: 'p240' | 'a160' | 'full', rev = 2) => ({ variant, packKey: PACK, emojiId: EMOJI, rev })
  const portrait = { name: 'aimisi', hash8: '0a1b2c3d', width: 240 as const }

  test('unset: every URL is the /img path, exactly as before', () => {
    for (const v of VARIANTS) expect(imgUrl(ref(v), '')).toBe(`/img/v1/${v}/${PACK}/${EMOJI}.r2.webp`)
    expect(portraitUrl(portrait, '')).toBe('/img/v1/portrait/aimisi.0a1b2c3d-240.webp')
    expect(webImageUrl('avatars/v1/u.webp', '/img/v1/avatar/u.webp', '')).toBe('/img/v1/avatar/u.webp')
    expect(publicObjectUrl('derived/v1/p240/x', '')).toBeNull()
  })

  test('set: p240, a160 and portraits are bucket keys on the base; full stays on /img', () => {
    expect(imgUrl(ref('p240'), BASE)).toBe(`${BASE}/derived/v1/p240/${PACK}/${EMOJI}.r2.webp`)
    expect(imgUrl(ref('a160'), BASE)).toBe(`${BASE}/derived/v1/a160/${PACK}/${EMOJI}.r2.webp`)
    expect(imgUrl(ref('full'), BASE)).toBe(`/img/v1/full/${PACK}/${EMOJI}.r2.webp`)
    expect(portraitUrl(portrait, BASE)).toBe(`${BASE}/characters/v1/portraits/aimisi.0a1b2c3d-240.webp`)
    expect(webImageUrl('avatars/v1/u.webp', '/img/v1/avatar/u.webp', BASE)).toBe(`${BASE}/avatars/v1/u.webp`)
    // a path-style stand-in (RustFS: http://host/<bucket>) works the same way
    expect(imgUrl(ref('p240'), 'http://127.0.0.1:9000/chaochi-x')).toBe(`http://127.0.0.1:9000/chaochi-x/derived/v1/p240/${PACK}/${EMOJI}.r2.webp`)
  })

  test('the browser maps any web image URL back to its /img path (canvas reads stay same-origin)', () => {
    for (const v of VARIANTS) expect(originImagePath(imgUrl(ref(v), BASE))).toBe(imgPath(ref(v)))
    expect(originImagePath(imgUrl(ref('p240'), 'http://127.0.0.1:9000/chaochi-x'))).toBe(imgPath(ref('p240')))
    expect(originImagePath(portraitUrl(portrait, BASE))).toBe(portraitPath(portrait))
    expect(originImagePath(imgPath(ref('a160')))).toBe(imgPath(ref('a160')))
    expect(originImagePath('/review-img/v1/p240/a/r-0a7bf47f0ec26d3843bf.webp')).toBeNull()
    expect(originImagePath('https://evil.example/whatever.webp')).toBeNull()
    expect(originImagePath('javascript:alert(1)')).toBeNull()
  })

  test('new public image objects are cached for a year; other prefixes keep the default', () => {
    expect(objectCacheControl(derivedKey('p240', PACK, EMOJI, 1))).toBe(IMMUTABLE)
    expect(objectCacheControl(portraitKey(portrait))).toBe(IMMUTABLE)
    expect(objectCacheControl('avatars/v1/u-1.webp')).toBe(IMMUTABLE)
    for (const k of [originalKey(PACK, EMOJI, 'gif'), reviewKey('p240', PACK, EMOJI), zipKey(PACK, 'deadbeef'), backupKey(), uploadTmpKey('u', 'a.gif'), 'meta/v1/packs.json']) {
      expect(isPublicImageKey(k)).toBe(false)
      expect(objectCacheControl(k)).toBeUndefined()
    }
  })

  test('purges cover the /img URL and the public URL of every deleted image', () => {
    const paths = [imgPath(ref('p240')), imgPath(ref('full')), portraitPath(portrait)]
    expect(cdnUrls(paths, 'https://site.example/', '')).toEqual(paths.map((p) => `https://site.example${p}`))
    expect(cdnUrls([...paths, `https://site.example${paths[0]}`, 'https://other.example/x'], 'https://site.example', BASE)).toEqual([
      `https://site.example${paths[0]}`,
      `${BASE}/derived/v1/p240/${PACK}/${EMOJI}.r2.webp`,
      `https://site.example${paths[1]}`,
      `${BASE}/derived/v1/full/${PACK}/${EMOJI}.r2.webp`,
      `https://site.example${paths[2]}`,
      `${BASE}/characters/v1/portraits/aimisi.0a1b2c3d-240.webp`,
      'https://other.example/x',
    ])
  })
})
