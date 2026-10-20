import { sql } from 'drizzle-orm'
import { toEmojiImage, type RawImage } from './images'
import { batchItemsInput, type BatchItemsInput } from './inputs'
import { emojiJson, emojiVisible, packPublished, rows } from './sql'
import type { BatchItem } from './types'

// What the 打包清单 tray and /batch show for the ids in the browser's list: thumbnail, size and the
// pack (for grouping and for 「只提供预览」). Public emojis only; ids that are not public any more
// (hidden, pending, unknown, derivatives missing) are simply absent, and the page shows them as
// unavailable. Viewer independent. Whether an original may be signed is still decided by
// POST /api/batch/sign; `downloadable` here only lets the page explain a refusal in advance.

interface Row {
  id: string
  img: RawImage
  format: string
  bytes: number
  pack_slug: string
  pack_title: string
  downloadable: boolean
  position: number
}

/** Items in request order (duplicates dropped). */
export async function getBatchItems(input: BatchItemsInput): Promise<BatchItem[]> {
  const { ids } = batchItemsInput.parse(input)
  const unique = [...new Set(ids)]
  if (!unique.length) return []
  const found = await rows<Row>(sql`
    select e.id, ${emojiJson('e')} as img, e.format, e.bytes, p.slug as pack_slug, p.title as pack_title,
      p.downloadable,
      (select count(*)::int from emojis x where x.pack_id = e.pack_id and x.status = 'published' and x.derived_ready
        and (x.sort_order, x.created_at, x.id) < (e.sort_order, e.created_at, e.id)) as position
    from emojis e join packs p on p.id = e.pack_id
    where e.id = any(${sql.param(unique)}::text[]) and ${emojiVisible('e')} and ${packPublished('p')}`)
  const byId = new Map(found.map((r) => [r.id, r]))
  return unique.flatMap((id) => {
    const r = byId.get(id)
    if (!r) return []
    return [
      {
        ...toEmojiImage(r.img),
        format: r.format,
        bytes: Number(r.bytes),
        index: Number(r.position),
        pack: { slug: r.pack_slug, title: r.pack_title, downloadable: r.downloadable },
      },
    ]
  })
}
