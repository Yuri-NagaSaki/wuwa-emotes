// Manual dev-data script (not a test): adds ~40 synthetic packs (~700 stickers) on top of Lane D's v1
// fixture so the public pages have realistic volume. Stickers are drawn from SVG (round faces in the
// character's color with a caption), GIFs get a few bouncing frames. Nothing here is real artwork.
// Like the real catalog, many stickers are opaque squares: every third pack paints a white card, every
// third a tinted one (the rounded-frame checks need them). Every fourth character has no theme color,
// as on the live site, so the palette fallback is exercised.
//
//   S3_BUCKET=chaochi-lane-i bun tests/import/fixture.ts && bun src/cli.ts import-v1   (Lane D fixture)
//   DATABASE_URL=… S3_BUCKET=chaochi-lane-i bun tests/pages/volume-fixture.ts
//   bun src/cli.ts backfill-derived && bun src/worker.ts                             (p240/a160)
//
// Idempotent: packs with pack_key "vol-…" are deleted first. Only local buckets and lane databases.
import { createHash } from 'node:crypto'
import { inArray, like, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { closeDb, db, schema } from '../../src/server/db/client'
import { env } from '../../src/server/env'
import { putObject } from '../../src/server/media/s3'

const e = env()
if (e.S3_BUCKET === 'wuwa' || !['127.0.0.1', 'localhost'].includes(new URL(e.S3_ENDPOINT).hostname)) {
  throw new Error('volume fixture only goes to a local scratch bucket')
}
if (!/\/chaochi_lane_[a-z0-9_]+$/.test(e.DATABASE_URL)) throw new Error('volume fixture only goes to a chaochi_lane_* database')

// ---- deterministic randomness ----
let state = 20261020
function rand(): number {
  state = (state * 1664525 + 1013904223) >>> 0
  return state / 2 ** 32
}
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
const hex = (s: string, n: number) => createHash('sha256').update(s).digest('hex').slice(0, n)

const PALETTE: Record<string, string> = {
  pink: '#f8a6b2',
  purple: '#b77dee',
  blue: '#889df0',
  yellow: '#f7cd67',
  orange: '#e59266',
  mint: '#82d5bb',
  green: '#8ac68a',
  red: '#fc736d',
  lime: '#d1da49',
  yg: '#ecdf52',
  brown: '#9a835a',
  peach: '#e18c6f',
  teal: '#19c8b9',
}

// slug, name, palette color, aliases
const CHARACTERS: [string, string, string, string[]][] = [
  ['aimisi', '爱弥斯', 'pink', ['小爱']],
  ['changli', '长离', 'orange', []],
  ['jinhsi', '今汐', 'yellow', ['今汐令尹']],
  ['chun', '椿', 'red', []],
  ['shouanren', '守岸人', 'blue', []],
  ['abu', '阿布', 'brown', []],
  ['piaobozhe', '漂泊者', 'teal', ['漂泊']],
  ['yangyang-xuanling', '秧秧·玄翎', 'mint', []],
  ['feibi', '菲比', 'yellow', ['Phoebe']],
  ['katixiya', '卡提希娅', 'blue', ['卡提']],
  ['kelaita', '珂莱塔', 'red', []],
  ['luokeke', '洛可可', 'purple', []],
  ['kanteleila', '坎特蕾拉', 'purple', []],
  ['zanni', '赞妮', 'peach', []],
  ['fuluoluo', '弗洛洛', 'pink', []],
  ['daniya', '达妮娅', 'lime', []],
  ['yangyang', '秧秧', 'green', []],
  ['baizhi', '白芷', 'mint', []],
  ['sanhua', '散华', 'blue', []],
  ['weilinai', '维里奈', 'green', []],
  ['yinlin', '吟霖', 'purple', []],
  ['jiyan', '忌炎', 'teal', []],
  ['kakaluo', '卡卡罗', 'brown', []],
  ['anke', '安可', 'red', []],
  ['taoqi', '桃祈', 'pink', []],
  ['qiushui', '秋水', 'lime', []],
  ['chixia', '炽霞', 'orange', []],
  ['zhezhi', '折枝', 'blue', []],
  ['xiangliyao', '相里要', 'purple', []],
  ['dengdeng', '灯灯', 'yellow', []],
  ['bulante', '布兰特', 'red', []],
  ['lupa', '露帕', 'orange', []],
  ['jiabeilina', '嘉贝莉娜', 'pink', []],
  ['qianxiao', '千咲', 'teal', []],
  ['younuo', '尤诺', 'yg', []],
  ['aogusita', '奥古斯塔', 'yellow', []],
]

const ARTISTS: [string, string][] = [
  ['wuxue', '雾雪'],
  ['mianhuatang', '棉花糖工作室'],
  ['xiaoyu', '小雨点'],
  ['tidepool', '潮汐画社'],
  ['lanmao', '懒猫阿橘'],
  ['qingfeng', '清风徐来'],
  ['mochi', 'Mochi'],
  ['yeqiu', '叶秋'],
]

const CAPTIONS = ['好耶', '收到', '晚安', '哭哭', '摸鱼', '冲！', '？？', '谢谢', '在吗', '贴贴', '无语', '加油', '睡了', '饿了', '早', 'OK', '嗯嗯', '溜了', '啊这', '好的']
const STYLES = ['板牌', '捏捏', 'Q版', '贴贴', '日常', '小剧场', '应援', '新年', '猫耳', '睡衣']
const EXCERPTS = [
  '感谢群友约稿，欢迎在聊天里使用。',
  '一组日常可用的小表情，复制即用。',
  '画师授权本站以 CC BY-NC-SA 4.0 分享，转载请保留署名。',
  '活动限定的应援表情，含若干动态版本。',
  null,
  null,
]

function stickerSvg(w: number, h: number, color: string, caption: string, seed: number, frame = 0, frames = 1, bg: string | null = null): string {
  const t = frames > 1 ? frame / frames : 0
  const bounce = Math.sin(t * Math.PI * 2) * Math.min(w, h) * 0.04
  const r = Math.min(w, h) * 0.34
  const cx = w / 2
  const cy = h * 0.44 + bounce
  const blink = frames > 1 && frame === Math.floor(frames / 2)
  const eye = r * 0.12
  const mouth = seed % 3
  const mouthPath =
    mouth === 0
      ? `M ${cx - r * 0.25} ${cy + r * 0.25} Q ${cx} ${cy + r * 0.5} ${cx + r * 0.25} ${cy + r * 0.25}`
      : mouth === 1
        ? `M ${cx - r * 0.2} ${cy + r * 0.35} L ${cx + r * 0.2} ${cy + r * 0.35}`
        : `M ${cx - r * 0.2} ${cy + r * 0.4} Q ${cx} ${cy + r * 0.15} ${cx + r * 0.2} ${cy + r * 0.4}`
  const eyes = blink
    ? `<path d="M ${cx - r * 0.45} ${cy - r * 0.1} h ${eye * 2} M ${cx + r * 0.25} ${cy - r * 0.1} h ${eye * 2}" stroke="#5a3d22" stroke-width="${eye * 0.6}" stroke-linecap="round"/>`
    : `<circle cx="${cx - r * 0.35}" cy="${cy - r * 0.1}" r="${eye}" fill="#5a3d22"/><circle cx="${cx + r * 0.35}" cy="${cy - r * 0.1}" r="${eye}" fill="#5a3d22"/>`
  const fontSize = Math.round(Math.min(w, h) * 0.16)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ''}
  <ellipse cx="${cx}" cy="${h * 0.86}" rx="${r * 0.8}" ry="${r * 0.12}" fill="rgba(90,61,34,0.15)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#794f27" stroke-width="${Math.max(3, r * 0.06)}"/>
  <circle cx="${cx - r * 0.55}" cy="${cy + r * 0.2}" r="${r * 0.12}" fill="rgba(255,120,120,0.45)"/>
  <circle cx="${cx + r * 0.55}" cy="${cy + r * 0.2}" r="${r * 0.12}" fill="rgba(255,120,120,0.45)"/>
  ${eyes}
  <path d="${mouthPath}" stroke="#5a3d22" stroke-width="${Math.max(2, r * 0.06)}" fill="none" stroke-linecap="round"/>
  <text x="${cx}" y="${h * 0.95}" font-family="Noto Sans CJK SC" font-weight="900" font-size="${fontSize}" text-anchor="middle" fill="#fff" stroke="#794f27" stroke-width="${fontSize * 0.18}" paint-order="stroke">${caption}</text>
</svg>`
}

/** `hex` mixed into warm paper (#fff8ec) at `p` (librsvg has no color-mix). */
function tint(hex: string, p: number): string {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const b = [0xff, 0xf8, 0xec]
  return '#' + a.map((v, i) => Math.round(v * p + b[i]! * (1 - p)).toString(16).padStart(2, '0')).join('')
}

async function rgbaOf(svg: string): Promise<Buffer> {
  return sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer()
}

async function makeSticker(format: 'gif' | 'png', w: number, h: number, color: string, caption: string, seed: number, frames: number, bg: string | null) {
  if (format === 'png') return sharp(Buffer.from(stickerSvg(w, h, color, caption, seed, 0, 1, bg))).png().toBuffer()
  const strips = await Promise.all(Array.from({ length: frames }, (_, f) => rgbaOf(stickerSvg(w, h, color, caption, seed, f, frames, bg))))
  return sharp(Buffer.concat(strips), { raw: { width: w, height: h * frames, channels: 4, pageHeight: h } })
    .gif({ delay: Array(frames).fill(120), loop: 0 })
    .toBuffer()
}

async function main() {
  const d = db()
  const { packs, emojis, characters, characterAliases, artists, tags, packTags, packCharacters, emojiCharacters, packArtists, collections, collectionPacks } = schema

  // reset previous runs
  await d.delete(packs).where(like(packs.packKey, 'vol-%'))
  await d.delete(collections).where(like(collections.slug, 'vol-%'))

  // characters (upsert; theme colors for the fixture's characters too)
  const charId = new Map<string, number>()
  for (const [i, [slug, name, color, aliases]] of CHARACTERS.entries()) {
    const themeColor = i % 4 === 3 ? null : color
    const [row] = await d
      .insert(characters)
      .values({ slug, name, themeColor, sort: i })
      .onConflictDoUpdate({ target: characters.slug, set: { themeColor, sort: i, name } })
      .returning({ id: characters.id })
    charId.set(slug, row!.id)
    for (const alias of aliases) await d.insert(characterAliases).values({ characterId: row!.id, alias }).onConflictDoNothing()
  }
  const artistId = new Map<string, number>()
  for (const [slug, name] of ARTISTS) {
    const [row] = await d
      .insert(artists)
      .values({ slug, name, links: slug === 'wuxue' ? [{ label: 'B 站主页', url: 'https://space.bilibili.com/0' }] : [] })
      .onConflictDoUpdate({ target: artists.slug, set: { name } })
      .returning({ id: artists.id })
    artistId.set(slug, row!.id)
  }
  const tagRows: [string, string, string][] = [
    ['group', 'zhanzhangtuijian', '站长推荐'],
    ['group', 'biaoqingtujian', '表情图鉴'],
    ['group', 'emotelab', 'EmoteLab'],
    ['tool', 'emotelab', 'EmoteLab'],
    ['project', 'solar5', 'Solar5'],
    ['origin', 'zhexiawanle', '这下晚了'],
  ]
  const tagId = new Map<string, number>()
  for (const [dimension, slug, name] of tagRows) {
    const [row] = await d
      .insert(tags)
      .values({ dimension: dimension as 'group', slug, name })
      .onConflictDoUpdate({ target: [tags.dimension, tags.slug], set: { name } })
      .returning({ id: tags.id })
    tagId.set(`${dimension}:${slug}`, row!.id)
  }

  // Lane D's packs: make a few downloadable so the download buttons can be exercised
  await d
    .update(packs)
    .set({ downloadable: true, license: 'CC BY-NC-SA 4.0' })
    .where(inArray(packs.packKey, ['aimisi-01', 'jinhsi-taoyao-zhuozhuo']))

  const PACK_COUNT = 42
  const now = Date.now()
  const created: number[] = []
  let emojiTotal = 0
  for (let p = 0; p < PACK_COUNT; p++) {
    const main = CHARACTERS[p % CHARACTERS.length]!
    const others = rand() < 0.3 ? [pick(CHARACTERS), pick(CHARACTERS)].filter((c) => c[0] !== main[0]) : []
    const chars = [main, ...others.slice(0, rand() < 0.5 ? 1 : 2)]
    const official = p % 9 === 4
    const kindRoll = rand()
    const kind: 'animated' | 'static' | 'mixed' = kindRoll < 0.55 ? 'animated' : kindRoll < 0.85 ? 'static' : 'mixed'
    const style = pick(STYLES)
    const key = `vol-${main[0]}-${String(p + 1).padStart(2, '0')}`
    const title = official ? `【官转】${main[1]}表情包·第 ${(p % 5) + 1} 弹` : `${chars.map((c) => c[1]).join('、')}${style}表情包${rand() < 0.3 ? '（动态）' : ''}`
    const downloadable = !official && rand() < 0.7
    const daysAgo = p < 3 ? 0 : Math.floor(rand() * 150)
    const publishedAt = new Date(now - daysAgo * 86_400_000 - int(0, 80_000) * 1000)
    const count = p === 1 ? 64 : int(6, 26)
    const [packRow] = await d
      .insert(packs)
      .values({
        packKey: key,
        slug: key,
        title,
        excerpt: official ? '转载自鸣潮官方，本站仅做收集整理。' : pick(EXCERPTS),
        status: 'published',
        sourceKind: official ? 'official' : 'community',
        license: downloadable ? 'CC BY-NC-SA 4.0' : official ? 'official' : 'unknown',
        downloadable,
        kind,
        pinLevel: p === 0 ? 3 : p === 7 ? 2 : p === 13 ? 1 : 0,
        memorial: p === 11,
        commissioner: !official && rand() < 0.3 ? `群聊「${main[1]}一生一世」` : null,
        creditsText: !official ? `画师授权本站发布，转载请注明出处。` : null,
        emojiCount: count,
        downloadCount: Math.floor(rand() ** 3 * 30_000),
        favoriteCount: Math.floor(rand() ** 2 * 900),
        publishedAt,
      })
      .returning({ id: packs.id })
    const packId = packRow!.id
    created.push(packId)
    for (const c of chars) await d.insert(packCharacters).values({ packId, characterId: charId.get(c[0])! }).onConflictDoNothing()
    if (!official) {
      const a = ARTISTS[p % ARTISTS.length]!
      await d.insert(packArtists).values({ packId, artistId: artistId.get(a[0])!, role: 'artist' })
      if (rand() < 0.2) await d.insert(packArtists).values({ packId, artistId: artistId.get(pick(ARTISTS)[0])!, role: 'commissioner' }).onConflictDoNothing()
    }
    if (p % 4 === 0) await d.insert(packTags).values({ packId, tagId: tagId.get('group:zhanzhangtuijian')! })
    if (p % 6 === 1) await d.insert(packTags).values({ packId, tagId: tagId.get('group:biaoqingtujian')! })
    if (p % 7 === 2) await d.insert(packTags).values({ packId, tagId: tagId.get('project:solar5')! })
    if (p % 5 === 3) await d.insert(packTags).values({ packId, tagId: tagId.get('tool:emotelab')! })

    const color = PALETTE[main[2]] ?? '#82d5bb'
    // opaque square stickers, like most of the real catalog: a white card or a tinted one
    const bg = p % 3 === 1 ? '#ffffff' : p % 3 === 2 ? tint(color, 0.3) : null
    for (let i = 0; i < count; i++) {
      const animated = kind === 'animated' || (kind === 'mixed' && i % 2 === 0)
      const format = animated ? 'gif' : 'png'
      const shape = rand()
      const [w, h] = shape < 0.9 ? [300, 300] : shape < 0.95 ? [300, 225] : [240, 300]
      const frames = animated ? int(4, 8) : 1
      const id = `r-${hex(`volume:${key}:${i}`, 20)}`
      const caption = CAPTIONS[(p * 7 + i) % CAPTIONS.length]!
      const body = await makeSticker(format, w, h, color, caption, p * 31 + i, frames, bg)
      const originalKey = `assets/v1/packs/${key}/emojis/${id}.${format}`
      await putObject(originalKey, body, `image/${format}`)
      await d.insert(emojis).values({
        id,
        packId,
        storagePackKey: key,
        status: 'published',
        sortOrder: i,
        originalKey,
        format,
        mime: `image/${format}`,
        bytes: body.byteLength,
        width: w,
        height: h,
        frames,
        durationMs: animated ? frames * 120 : null,
        sha256: createHash('sha256').update(body).digest('hex'),
        derivedReady: false,
      })
      const tagChar = chars[i % chars.length]!
      await d.insert(emojiCharacters).values({ emojiId: id, characterId: charId.get(tagChar[0])! }).onConflictDoNothing()
      emojiTotal++
    }
  }

  const [col] = await d
    .insert(collections)
    .values({ slug: 'vol-zhanzhang-jingxuan', title: '站长精选', description: '站长挑的常用表情包', published: true, sort: -1 })
    .returning({ id: collections.id })
  for (const [i, packId] of [created[5], created[0], created[9], created[14], created[21], created[2]].entries()) {
    await d.insert(collectionPacks).values({ collectionId: col!.id, packId: packId!, sort: i })
  }
  await d.execute(sql`analyze`)
  console.log(`volume fixture: ${PACK_COUNT} packs, ${emojiTotal} emojis (derived_ready = false until the worker runs)`)
  await closeDb()
}

await main()
