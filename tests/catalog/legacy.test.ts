import '../integration/setup'
import { beforeAll, describe, expect, test } from 'bun:test'
import { normalizeLegacyPath, resolveLegacyPath } from '#/server/catalog/legacy'
import { seedCatalog } from './seed'

beforeAll(async () => {
  await seedCatalog()
}, 120_000)

const to = async (path: string) => (await resolveLegacyPath(path))?.location ?? null

describe('normalizeLegacyPath', () => {
  test('strips query, hash, origin, duplicate and trailing slashes; decodes', () => {
    expect(normalizeLegacyPath('/archives/a/?x=1#y')).toEqual(['/archives/a'])
    expect(normalizeLegacyPath('https://emoji.wuwa.games//archives/a')).toEqual(['/archives/a'])
    expect(normalizeLegacyPath('archives/a')).toEqual(['/archives/a'])
    expect(normalizeLegacyPath('/tags/%E4%B8%AD')).toEqual(['/tags/中', '/tags/%E4%B8%AD'])
    expect(normalizeLegacyPath('/tags/%E4%B8')).toEqual(['/tags/%E4%B8'])
    expect(normalizeLegacyPath('/')).toEqual(['/'])
  })
})

describe('resolveLegacyPath', () => {
  test('/archives/:postName → pack (legacy_post_name, pack_key, slug, redirects)', async () => {
    expect(await resolveLegacyPath('/archives/aimisi-01')).toEqual({ location: '/packs/aimisi-01', status: 301 })
    expect(await to('/archives/emoji-post-yy')).toBe('/packs/yangyang-01')
    expect(await to('/archives/yangyang-old')).toBe('/packs/yangyang-01')
    expect(await to('/archives/yangyang-01')).toBe('/packs/yangyang-01')
    expect(await to('/archives/old-feibi-post')).toBe('/packs/feibi-01')
    expect(await to('/archives/aimisi-01/')).toBe('/packs/aimisi-01')
    expect(await to('https://emoji.wuwa.games/archives/aimisi-01?from=old')).toBe('/packs/aimisi-01')
    expect(await to('/archives/draft-01')).toBeNull()
    expect(await to('/archives/hidden-01')).toBeNull()
    expect(await to('/archives/nothing')).toBeNull()
  })

  test('/tags/:slug → character, then artist, then tag lists', async () => {
    expect(await to('/tags/character-1e2ca573335a00cc88b0a81f')).toBe('/characters/aimisi')
    expect(await to('/tags/character-abc123hash')).toBe('/characters/xin')
    expect(await to('/tags/aimisi')).toBe('/characters/aimisi')
    expect(await resolveLegacyPath('/tags/character-zzz')).toEqual({ location: '/characters/xin', status: 302 })
    expect(await to('/tags/maowushi-old')).toBe('/artists/maowushi')
    expect(await to('/tags/zhanzhang-tuijian')).toBe('/packs?group=zhanzhang-tuijian')
    expect(await to('/tags/solar5')).toBe('/packs?tag=project%3Asolar5')
    expect(await resolveLegacyPath('/tags/%E4%B8%AD%E6%96%87%E6%A0%87%E7%AD%BE')).toEqual({ location: '/packs/xin-01', status: 308 })
    expect(await to('/tags/draft-only')).toBeNull()
    expect(await to('/tags/shouanren-old')).toBeNull()
    expect(await to('/tags/shouanren')).toBeNull()
    expect(await to('/tags/ghost-old')).toBeNull()
  })

  test('old character, artist and pack slugs', async () => {
    expect(await to('/characters/old-chun')).toBe('/characters/chun')
    expect(await to('/characters/old-chun-2')).toBe('/characters/chun')
    expect(await to('/characters/yangyang-legacy')).toBe('/characters/yangyang')
    expect(await to('/characters/chun')).toBeNull()
    expect(await to('/characters/to-hidden')).toBeNull()
    expect(await to('/characters/shouanren-old')).toBeNull()
    expect(await to('/artists/maowushi-old')).toBe('/artists/maowushi')
    expect(await to('/artists/ghost-old')).toBeNull()
    expect(await to('/packs/yangyang-old')).toBe('/packs/yangyang-01')
    expect(await to('/packs/yangyang-legacy-slug')).toBe('/packs/yangyang-01')
    expect(await to('/packs/aimisi-01')).toBeNull()
  })

  test('chains are followed; loops, external targets and unpublished targets are ignored', async () => {
    expect(await to('/old/a')).toBe('/packs/aimisi-01')
    expect(await to('/old/b')).toBe('/packs/aimisi-01')
    expect(await to('/loop/a')).toBeNull()
    expect(await to('/ext')).toBeNull()
    expect(await to('/packs/to-draft')).toBeNull()
    expect(await to('/')).toBeNull()
    expect(await to('/about')).toBeNull()
    expect(await to('/a/b/c/d')).toBeNull()
  })
})
