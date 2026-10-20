// Synthetic v1 snapshot in the R2 layout of DEVELOPMENT.md §3–4 (no real data): five packs, 20 emojis
// (12 GIF, 8 PNG), readable and hash character slugs, artist names with stray spaces, facet tags,
// one official (官转) pack and one pack that has metadata but no assets.
//
// Upload it to a local bucket for manual runs:
//   S3_BUCKET=chaochi-lane-d bun tests/import/fixture.ts
//   DATABASE_URL=… S3_BUCKET=chaochi-lane-d bun src/cli.ts import-v1
import { createHash } from 'node:crypto'
import { env } from '../../src/server/env'
import { putObject } from '../../src/server/media/s3'
import { makeGif, makePng } from '../media/helpers'

export interface FixtureEmoji {
  id: string
  packKey: string
  format: 'gif' | 'png'
  width: number
  height: number
  frames: number
  characters: string[]
  key: string
  bytes: number
}

export interface FixtureObject {
  key: string
  body: Uint8Array
  contentType: string
}

export const HASH = {
  chun: 'c7d3e9a1f2b84c56a0e1', // 椿
  xuanling: '5e0f2a9c83d14b7e6f20', // 秧秧·玄翎
  shouanren: '9b1c4e7a2d5f8036c1ab', // 守岸人
  abu: 'f04a8c2e6b1d93e75a4c', // 阿布
} as const

export const PACK = {
  aimisi: 'aimisi-01',
  changli: 'changli-cats-png',
  jinhsi: 'jinhsi-taoyao-zhuozhuo',
  official: 'official-abby-friends',
  noAssets: 'linglanhuajiang-charging-20261009',
} as const

function emojiId(pk: string, i: number): string {
  return 'r-' + createHash('sha256').update(`fixture:${pk}:${i}`).digest('hex').slice(0, 20)
}

const char = (slug: string, displayName: string) => ({
  name: 'character-' + createHash('sha256').update(slug).digest('hex').slice(0, 24),
  kind: 'CHARACTER',
  slug,
  displayName,
})

const CHARACTERS = [
  char('aimisi', '爱弥斯'),
  char('changli', '长离'),
  char('jinhsi', '今汐'),
  char(HASH.chun, '椿'),
  char(HASH.xuanling, '秧秧·玄翎'),
  char(HASH.shouanren, '守岸人'),
  char(HASH.abu, '阿布'),
]
const C = Object.fromEntries(CHARACTERS.map((c) => [c.slug, c]))

const ARTISTS = [
  { name: 'artist-3c1d9e0a7b5f2e4d6c8a1b0f', kind: 'ARTIST', slug: 'wuxue', displayName: '雾雪' },
  { name: 'artist-8e2f4a6c0d1b3e5f7a9c2d4e', kind: 'ARTIST', slug: '爱秧斯坦', displayName: '爱秧斯坦' },
]

// format, width, height, frames, character slugs per emoji
type Spec = ['gif' | 'png', number, number, number, string[]]
const g = (w: number, h: number, chars: string[]): Spec => ['gif', w, h, 3, chars]
const p = (w: number, h: number, chars: string[]): Spec => ['png', w, h, 1, chars]

const PACK_SPECS: Record<string, Spec[]> = {
  [PACK.aimisi]: [g(64, 64, ['aimisi']), g(64, 64, ['aimisi']), g(80, 64, ['aimisi']), g(64, 64, ['aimisi']), g(64, 72, ['aimisi']), g(64, 64, ['aimisi'])],
  [PACK.changli]: [
    p(48, 48, ['changli']),
    p(48, 48, ['changli']),
    p(60, 40, [HASH.chun]),
    p(48, 48, ['changli', HASH.chun]),
    p(40, 60, ['changli']),
    p(48, 48, [HASH.chun]),
  ],
  [PACK.jinhsi]: [g(56, 56, ['jinhsi']), p(56, 56, ['jinhsi']), g(56, 56, [HASH.xuanling]), p(70, 50, ['jinhsi', HASH.shouanren]), g(56, 56, ['nobody'])],
  [PACK.official]: [g(50, 50, [HASH.abu]), g(50, 50, [HASH.abu]), g(50, 50, [HASH.abu])],
}

const ORIGIN = 'https://emoji.wuwa.games'

function packItems(emojis: Record<string, FixtureEmoji[]>) {
  const refs = (slugs: string[]) => slugs.map((s) => C[s]!)
  const base = (pk: string) => ({
    name: pk,
    imageCount: emojis[pk]?.length ?? 4,
    hasArchive: true,
    featured: false,
    lastModifyTime: '2026-10-01T00:00:00Z',
    readCount: 10,
    previewAssets: [],
    previewAssetCount: 0,
  })
  return [
    {
      ...base(PACK.aimisi),
      postName: 'emoji-post-aimisi01',
      title: '爱弥斯动态表情包（板牌）',
      excerpt: '感谢来自群聊的约稿',
      permalink: `/archives/${PACK.aimisi}`,
      url: `${ORIGIN}/archives/${PACK.aimisi}`,
      publishTime: '2026-08-06T16:12:47.699334566Z',
      pinLevel: 1,
      memorial: false,
      characters: refs(['aimisi']),
      characterNames: ['爱弥斯'],
      artists: [],
      artistNames: [],
      facets: { 角色: ['爱弥斯', '漂泊者'], 画师: [' 猫屋敷梨梨&春也Haruya '], 分组: ['站长推荐'] },
      favoriteCount: 4,
      downloadCount: 2225,
      // cover points at the second emoji; the importer should honour it
      cover: { resourceId: emojis[PACK.aimisi]![1]!.id, mediaType: 'image/gif', previewUrl: 'https://media.wuwa.games/tmp/x' },
    },
    {
      ...base(PACK.changli),
      postName: 'emoji-post-changli-cats',
      title: '长离猫猫 PNG',
      excerpt: '  静态表情  ',
      url: `${ORIGIN}/archives/${PACK.changli}`,
      publishTime: '2026-09-02T08:00:00Z',
      characters: refs(['changli', HASH.chun]),
      characterNames: ['长离', '椿'],
      artists: [],
      artistNames: ['0糖红茶 '],
      facets: { 角色: ['长离', '椿'], 画师: ['0糖红茶'], 工具: ['EmoteLab'] },
      favoriteCount: 1,
      downloadCount: 500,
      cover: { resourceId: 'r-ffffffffffffffffffff' },
    },
    {
      ...base(PACK.jinhsi),
      postName: 'emoji-post-jinhsi-taoyao',
      title: '今汐 桃夭灼灼',
      excerpt: null,
      permalink: `${ORIGIN}/archives/${PACK.jinhsi}/`,
      url: `${ORIGIN}/archives/${PACK.jinhsi}`,
      publishTime: '2026-09-26T19:32:56.981658814Z',
      memorial: true,
      characters: refs(['jinhsi', HASH.xuanling, HASH.shouanren]),
      characterNames: ['今汐', '秧秧·玄翎', '守岸人'],
      artists: [{ name: ARTISTS[0]!.name, kind: 'ARTIST', slug: 'wuxue', displayName: ' 雾雪 ' }],
      artistNames: ['雾雪'],
      facets: { 角色: ['今汐', '秧秧·玄翎', '守岸人'], 画师: [' 雾雪', '爱秧斯坦'], 企划: ['Solar5'], 原设: ['这下晚了'] },
      favoriteCount: 30,
      downloadCount: 9000,
    },
    {
      ...base(PACK.official),
      postName: 'emoji-post-official-abby',
      title: '【官转】阿布表情包·阿布和小伙伴们表情包',
      excerpt: '转载自鸣潮官方，本站仅做收集整理。共3张动态表情。',
      permalink: `/archives/${PACK.official}`,
      url: `${ORIGIN}/archives/${PACK.official}`,
      publishTime: '2026-10-05T10:00:00Z',
      pinLevel: -1,
      characters: refs([HASH.abu]),
      characterNames: ['阿布'],
      artists: [],
      artistNames: [],
      facets: { 角色: ['阿布'], 分组: ['站长推荐'] },
      favoriteCount: 1,
      downloadCount: 296,
    },
    {
      ...base(PACK.noAssets),
      postName: 'emoji-post-linglan-charging',
      title: '铃兰花酱 充电表情',
      excerpt: '只有元数据',
      permalink: `/archives/${PACK.noAssets}`,
      url: `${ORIGIN}/archives/${PACK.noAssets}`,
      publishTime: '2026-10-09T12:00:00Z',
      characters: refs(['aimisi']),
      characterNames: ['爱弥斯'],
      artists: [],
      artistNames: [],
      facets: { 角色: ['爱弥斯'], 画师: ['猫屋敷梨梨_春也Haruya'], 分组: ['表情图鉴'] },
      favoriteCount: 0,
      downloadCount: 0,
    },
  ]
}

const json = (key: string, value: unknown): FixtureObject => ({
  key,
  body: new TextEncoder().encode(JSON.stringify(value, null, 2)),
  contentType: 'application/json',
})

export async function buildV1Fixture(): Promise<{ objects: FixtureObject[]; emojis: FixtureEmoji[] }> {
  const objects: FixtureObject[] = []
  const emojis: FixtureEmoji[] = []
  const byPack: Record<string, FixtureEmoji[]> = {}
  let seed = 1
  for (const [pk, specs] of Object.entries(PACK_SPECS)) {
    byPack[pk] = []
    for (const [i, [format, width, height, frames, characters]] of specs.entries()) {
      const id = emojiId(pk, i)
      const body = format === 'gif' ? await makeGif(width, height, frames, seed++) : await makePng(width, height, seed++)
      const key = `assets/v1/packs/${pk}/emojis/${id}.${format}`
      objects.push({ key, body, contentType: `image/${format}` })
      const e: FixtureEmoji = { id, packKey: pk, format, width, height, frames, characters, key, bytes: body.byteLength }
      emojis.push(e)
      byPack[pk]!.push(e)
    }
  }

  const items = packItems(byPack)
  const entry = (e: FixtureEmoji) => ({
    id: e.id,
    objectKey: e.key,
    format: e.format,
    bytes: e.bytes,
    animated: e.format === 'gif',
    characters: e.characters,
    artists: e.packKey === PACK.aimisi ? ['猫屋敷梨梨_春也Haruya'] : [],
  })
  for (const item of items) {
    const list = byPack[item.name]
    if (!list) continue
    objects.push(json(`meta/v1/index/by-pack/${item.name}.json`, { packKey: item.name, title: item.title, count: list.length, emojis: list.map(entry) }))
    objects.push(
      json(`assets/v1/packs/${item.name}/pack.json`, {
        packKey: item.name,
        name: item.name,
        title: item.title,
        excerpt: item.excerpt,
        url: item.url,
        publishTime: item.publishTime,
        imageCountDeclared: list.length,
        imageCountLocal: list.length,
        characters: item.characters,
        artists: [],
        tags: [],
        assetPrefix: `assets/v1/packs/${item.name}/`,
        emojis: list.map(entry),
      }),
    )
  }

  const total = emojis.length
  objects.push(
    json('meta/v1/packs.json', {
      source: 'fixture',
      fetchedAt: '2026-10-20T08:20:00+08:00',
      total: items.length,
      sumImageCount: total + 4,
      note: 'synthetic test fixture',
      sources: {},
      items,
    }),
    json('meta/v1/characters.json', {
      source: 'derived from public packs.characters',
      note: 'fixture',
      total: CHARACTERS.length,
      items: CHARACTERS.map((c) => ({ ...c, packCount: 1 })),
    }),
    json('meta/v1/artists.json', { source: 'derived', total: ARTISTS.length, items: ARTISTS.map((a) => ({ ...a, packCount: 1 })) }),
    // Halo tags: facet tags, a 角色 and a 画师 tag, one without a facet, one whose value is not a facet
    // value, and one with only a slug (no permalink)
    json('meta/v1/tags.json', {
      source: 'fixture',
      total: 7,
      items: [
        { name: 'tag-0vsino9n', displayName: '企划/Solar5', slug: 'qi-hua-solar5', permalink: '/tags/qi-hua-solar5', postCount: 1 },
        { name: 'tag-1abcdefg', displayName: '分组/站长推荐', slug: 'fen-zu-zhan-zhang-tui-jian', permalink: '/tags/fen-zu-zhan-zhang-tui-jian', postCount: 2 },
        { name: 'tag-2bcdefgh', displayName: '角色/今汐', slug: 'jue-se-jin-xi', permalink: '/tags/jue-se-jin-xi', postCount: 1 },
        { name: 'tag-3cdefghi', displayName: '画师/雾雪', slug: 'hua-shi-wu-xue', permalink: `${ORIGIN}/tags/hua-shi-wu-xue`, postCount: 1 },
        { name: 'tag-4defghij', displayName: '同人', slug: 'tong-ren', permalink: '/tags/tong-ren', postCount: 3 },
        { name: 'tag-5efghijk', displayName: '原设/早就删了', slug: 'yuan-she-zao-jiu-shan-le', permalink: '/tags/yuan-she-zao-jiu-shan-le', postCount: 0 },
        { name: 'tag-6fghijkl', displayName: '工具/EmoteLab', slug: 'gong-ju-emotelab' },
      ],
    }),
    json('meta/v1/facets.json', {
      source: 'archive-index.facets',
      fetchedAt: '2026-10-20T08:20:59+08:00',
      dimensions: {
        角色: ['爱弥斯', '长离', '今汐', '椿', '秧秧·玄翎', '守岸人', '阿布', '漂泊者'].map((value) => ({ value, packCount: 1 })),
        画师: [' 猫屋敷梨梨&春也Haruya ', '0糖红茶 ', '雾雪', '爱秧斯坦', '猫屋敷梨梨_春也Haruya'].map((value) => ({ value, packCount: 1 })),
        分组: [
          { value: '站长推荐', packCount: 2 },
          { value: '表情图鉴', packCount: 1 },
        ],
        工具: [{ value: 'EmoteLab', packCount: 1 }],
        企划: [{ value: 'Solar5', packCount: 1 }],
        原设: [{ value: '这下晚了', packCount: 1 }],
      },
      dimensionCounts: { 角色: 8, 画师: 5, 分组: 2, 工具: 1, 企划: 1, 原设: 1 },
    }),
    {
      key: 'meta/v1/manifests/emojis.jsonl',
      body: new TextEncoder().encode(
        emojis
          .map((e) => JSON.stringify({ ...entry(e), packKey: e.packKey, contentType: `image/${e.format}` }))
          .sort()
          .join('\n') + '\n',
      ),
      contentType: 'application/x-ndjson',
    },
    json('sync/v1/state.json', {
      version: 'v1',
      builtAt: '2026-10-20T10:33:57+08:00',
      catalog: { emojiCount: total, packCount: 4, characterIndexCount: 7, tagIndexCount: 0, bytesTotal: emojis.reduce((a, e) => a + e.bytes, 0) },
      layout: { metaPrefix: 'meta/v1/', assetsPrefix: 'assets/v1/packs/', syncKey: 'sync/v1/state.json' },
    }),
  )
  return { objects, emojis }
}

export async function uploadV1Fixture() {
  const fixture = await buildV1Fixture()
  for (const o of fixture.objects) await putObject(o.key, o.body, o.contentType)
  return fixture
}

if (import.meta.main) {
  const e = env()
  if (e.S3_BUCKET === 'wuwa' || !['127.0.0.1', 'localhost'].includes(new URL(e.S3_ENDPOINT).hostname)) {
    throw new Error('the fixture only goes to a local scratch bucket')
  }
  const f = await uploadV1Fixture()
  console.log(`uploaded ${f.objects.length} objects (${f.emojis.length} emojis) to ${e.S3_BUCKET}`)
}
