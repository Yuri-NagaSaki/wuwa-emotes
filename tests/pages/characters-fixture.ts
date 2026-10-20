// Manual dev-data script (not a test): characters and packs with the shapes of the v1 data, for
// looking at 角色图鉴 / 角色详情 / 角色潮汐 (tests/pages/characters-shots.ts). Stickers are drawn from
// SVG (round faces in the character's colour with a caption); nothing here is real artwork.
//
//   DATABASE_URL=…/chaochi_lane_x S3_BUCKET=chaochi-lane-x bun src/migrate.ts
//   DATABASE_URL=…/chaochi_lane_x S3_BUCKET=chaochi-lane-x bun tests/pages/characters-fixture.ts
//   … bun src/cli.ts import-portraits <manifest.json>   (optional: official portraits)
//   … bun src/cli.ts derive-colors
//
// The group pack 全角色琵琶曲 is the most downloaded and every sticker in it carries all of its
// characters, like v1's all-characters-pipa: under the old rule every one of them got its cover as
// avatar and its whole count. 漂泊者 × 弗洛洛 copies two names onto every sticker; 洛可可 / 安可 /
// 卡卡罗 are tagged sticker by sticker. 丹瑾 and 忌炎 only appear in the group pack.
// Idempotent: packs "chx-…" and the characters below are replaced. Only local buckets, lane databases.
import { inArray, like, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { closeDb, db, schema } from '../../src/server/db/client'
import { env } from '../../src/server/env'
import { derivedKey, originalKey } from '../../src/server/media/keys'
import { putObject } from '../../src/server/media/s3'

const e = env()
if (e.S3_BUCKET === 'wuwa' || !['127.0.0.1', 'localhost'].includes(new URL(e.S3_ENDPOINT).hostname)) {
  throw new Error('characters fixture only goes to a local scratch bucket')
}
if (!/\/chaochi_lane_[a-z0-9_]+$/.test(e.DATABASE_URL)) throw new Error('characters fixture only goes to a chaochi_lane_* database')

const FILL: Record<string, string> = {
  aimisi: '#f8a6b2',
  daniya: '#b77dee',
  rover: '#9a835a',
  fuluoluo: '#fc736d',
  luokeke: '#e59266',
  anke: '#fc736d',
  xin: '#f7cd67',
  guguhetun: '#889df0',
  abu: '#f7cd67',
  kakaluo: '#19c8b9',
  danjin: '#fc736d',
  jiyan: '#19c8b9',
}

// slug, name, aliases
const CHARACTERS: [string, string, string[]][] = [
  ['aimisi', '爱弥斯', ['小爱']],
  ['daniya', '达妮娅', []],
  ['rover', '漂泊者', ['漂泊']],
  ['fuluoluo', '弗洛洛', []],
  ['luokeke', '洛可可', []],
  ['anke', '安可', []],
  ['xin', '心', []],
  ['guguhetun', '咕咕河豚', []],
  ['abu', '阿布', []],
  ['kakaluo', '卡卡罗', []],
  ['danjin', '丹瑾', []],
  ['jiyan', '忌炎', []],
]

const CAPTIONS = ['好耶', '收到', '晚安', '哭哭', '摸鱼', '冲！', '？？', '谢谢', '在吗', '贴贴', '无语', '加油', '睡了', '饿了', '早', 'OK']

interface Spec {
  key: string
  title: string
  downloads: number
  chars: string[]
  /** per sticker: its character tags and the colour it is drawn in */
  stickers: { tags: string[]; fill: string }[]
}

const solo = (slug: string, n: number, tagged = true) => Array.from({ length: n }, () => ({ tags: tagged ? [slug] : [], fill: FILL[slug]! }))
const PIPA = ['aimisi', 'daniya', 'rover', 'fuluoluo', 'luokeke', 'anke', 'danjin', 'jiyan']

const PACKS: Spec[] = [
  { key: 'chx-pipa', title: '全角色琵琶曲', downloads: 90000, chars: PIPA, stickers: PIPA.map((s) => ({ tags: PIPA, fill: FILL[s]! })) },
  { key: 'chx-aimisi-1', title: '爱弥斯 捏捏', downloads: 30000, chars: ['aimisi'], stickers: solo('aimisi', 14) },
  { key: 'chx-aimisi-2', title: '爱弥斯 日常', downloads: 12000, chars: ['aimisi'], stickers: solo('aimisi', 9, false) },
  { key: 'chx-daniya', title: '达妮娅 板牌', downloads: 20000, chars: ['daniya'], stickers: solo('daniya', 10) },
  {
    key: 'chx-rover-fuluoluo',
    title: '漂泊者和弗洛洛',
    downloads: 25000,
    chars: ['rover', 'fuluoluo'],
    stickers: Array.from({ length: 8 }, (_, i) => ({ tags: ['rover', 'fuluoluo'], fill: FILL[i % 2 ? 'rover' : 'fuluoluo']! })),
  },
  { key: 'chx-rover', title: '漂泊者 表情', downloads: 8000, chars: ['rover'], stickers: solo('rover', 6) },
  { key: 'chx-fuluoluo', title: '弗洛洛 小剧场', downloads: 9000, chars: ['fuluoluo'], stickers: solo('fuluoluo', 7) },
  {
    key: 'chx-varied',
    title: '洛可可与安可 逐张标注',
    downloads: 7000,
    chars: ['luokeke', 'anke', 'kakaluo'],
    stickers: [
      { tags: ['luokeke'], fill: FILL.luokeke! },
      { tags: ['luokeke'], fill: FILL.luokeke! },
      { tags: ['anke'], fill: FILL.anke! },
      { tags: ['anke', 'kakaluo'], fill: FILL.kakaluo! },
      { tags: ['luokeke'], fill: FILL.luokeke! },
    ],
  },
  { key: 'chx-luokeke', title: '洛可可 应援', downloads: 3000, chars: ['luokeke'], stickers: solo('luokeke', 5) },
  { key: 'chx-anke', title: '安可 Q版', downloads: 2500, chars: ['anke'], stickers: solo('anke', 4) },
  { key: 'chx-xin', title: '心 日常', downloads: 6000, chars: ['xin'], stickers: solo('xin', 6) },
  { key: 'chx-gugu', title: '咕咕河豚', downloads: 1500, chars: ['guguhetun'], stickers: solo('guguhetun', 3, false) },
  { key: 'chx-abu', title: '阿布', downloads: 1200, chars: ['abu'], stickers: solo('abu', 3) },
]

function stickerSvg(color: string, caption: string, seed: number): string {
  const w = 240
  const h = 240
  const r = w * 0.34
  const cx = w / 2
  const cy = h * 0.44
  const mouth = [
    `M ${cx - r * 0.25} ${cy + r * 0.25} Q ${cx} ${cy + r * 0.5} ${cx + r * 0.25} ${cy + r * 0.25}`,
    `M ${cx - r * 0.2} ${cy + r * 0.35} L ${cx + r * 0.2} ${cy + r * 0.35}`,
    `M ${cx - r * 0.2} ${cy + r * 0.4} Q ${cx} ${cy + r * 0.15} ${cx + r * 0.2} ${cy + r * 0.4}`,
  ][seed % 3]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="#794f27" stroke-width="5"/>
  <circle cx="${cx - r * 0.35}" cy="${cy - r * 0.1}" r="${r * 0.12}" fill="#5a3d22"/><circle cx="${cx + r * 0.35}" cy="${cy - r * 0.1}" r="${r * 0.12}" fill="#5a3d22"/>
  <path d="${mouth}" stroke="#5a3d22" stroke-width="5" fill="none" stroke-linecap="round"/>
  <text x="${cx}" y="${h * 0.95}" font-family="Noto Sans CJK SC" font-weight="900" font-size="38" text-anchor="middle" fill="#fff" stroke="#794f27" stroke-width="7" paint-order="stroke">${caption}</text>
</svg>`
}

const d = db()
const old = await d.select({ id: schema.packs.id }).from(schema.packs).where(like(schema.packs.packKey, 'chx-%'))
if (old.length) await d.delete(schema.packs).where(inArray(schema.packs.id, old.map((p) => p.id)))
await d.delete(schema.characters).where(inArray(schema.characters.slug, CHARACTERS.map((c) => c[0])))

const charId = new Map<string, number>()
for (const [i, [slug, name, aliases]] of CHARACTERS.entries()) {
  const [row] = await d.insert(schema.characters).values({ slug, name, sort: i + 1 }).returning({ id: schema.characters.id })
  charId.set(slug, row!.id)
  for (const alias of aliases) await d.insert(schema.characterAliases).values({ characterId: row!.id, alias })
}

let seq = 0
for (const [pi, p] of PACKS.entries()) {
  const [pack] = await d
    .insert(schema.packs)
    .values({
      packKey: p.key,
      slug: p.key,
      title: p.title,
      status: 'published',
      kind: 'static',
      downloadable: true,
      license: 'CC BY-NC-SA 4.0',
      downloadCount: p.downloads,
      favoriteCount: Math.round(p.downloads / 100),
      publishedAt: new Date(Date.UTC(2026, 8, 1 + pi)),
    })
    .returning({ id: schema.packs.id })
  for (const c of p.chars) await d.insert(schema.packCharacters).values({ packId: pack!.id, characterId: charId.get(c)! })
  for (const [i, s] of p.stickers.entries()) {
    seq++
    const id = `r-c${seq.toString(16).padStart(19, '0')}`
    const png = await sharp(Buffer.from(stickerSvg(s.fill, CAPTIONS[seq % CAPTIONS.length]!, seq))).png().toBuffer()
    const poster = await sharp(png).webp({ quality: 80 }).toBuffer()
    await putObject(originalKey(p.key, id, 'png'), png, 'image/png')
    await putObject(derivedKey('p240', p.key, id, 1), poster, 'image/webp', 'public, max-age=31536000, immutable')
    await d.insert(schema.emojis).values({
      id,
      packId: pack!.id,
      storagePackKey: p.key,
      status: 'published',
      sortOrder: i,
      originalKey: originalKey(p.key, id, 'png'),
      format: 'png',
      mime: 'image/png',
      bytes: png.length,
      width: 240,
      height: 240,
      frames: 1,
      derivedReady: true,
      p240Bytes: poster.length,
    })
    for (const t of s.tags) await d.insert(schema.emojiCharacters).values({ emojiId: id, characterId: charId.get(t)! })
  }
  await d.execute(sql`update packs set emoji_count = ${p.stickers.length}, cover_emoji_id = (select id from emojis where pack_id = ${pack!.id} order by sort_order limit 1) where id = ${pack!.id}`)
}
console.log(`characters fixture: ${CHARACTERS.length} characters, ${PACKS.length} packs, ${seq} stickers`)
await closeDb()
