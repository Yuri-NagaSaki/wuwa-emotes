import { and, asc, gt, isNull, sql } from 'drizzle-orm'
import { db, schema } from '../db/client'
import { log } from '../log'
import { getObjectBytes, getObjectRange } from '../media/s3'
import { mapLimit } from './pool'

// Width and height for emojis that have none (v1 imports). GIF and PNG sizes sit in the first 32 bytes,
// so one ranged GET per object is enough; WebP and JPEG fall back to sharp on the whole object.
// Resumable: only rows with a null width are read, in id order, and each batch is saved before the next.

export const HEADER_BYTES = 32

/** Size from a GIF or PNG header; null for anything else (or a truncated header). */
export function parseHeaderDims(b: Uint8Array): { format: 'gif' | 'png'; width: number; height: number } | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to))
  if (b.length >= 10 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) {
    // logical screen descriptor: little-endian uint16 width and height at offsets 6 and 8
    return { format: 'gif', width: b[6]! | (b[7]! << 8), height: b[8]! | (b[9]! << 8) }
  }
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (b.length >= 24 && PNG.every((v, i) => b[i] === v) && ascii(12, 16) === 'IHDR') {
    // IHDR is always the first chunk: big-endian uint32 width and height at offsets 16 and 20
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { format: 'png', width: dv.getUint32(16), height: dv.getUint32(20) }
  }
  return null
}

async function dimsWithSharp(key: string): Promise<{ width: number; height: number }> {
  // loaded lazily: only WebP/JPEG originals need libvips here
  const { default: sharp } = await import('sharp')
  const m = await sharp(await getObjectBytes(key), { animated: true, limitInputPixels: false }).metadata()
  return { width: m.width ?? 0, height: m.pageHeight ?? m.height ?? 0 }
}

export async function readDims(key: string): Promise<{ width: number; height: number; via: 'header' | 'sharp' }> {
  const head = parseHeaderDims(await getObjectRange(key, 0, HEADER_BYTES - 1))
  if (head) return { width: head.width, height: head.height, via: 'header' }
  return { ...(await dimsWithSharp(key)), via: 'sharp' }
}

export interface DimsBackfillResult {
  scanned: number
  updated: number
  viaSharp: number
  failed: { id: string; error: string }[]
}

export async function backfillDims(
  opts: { concurrency?: number; limit?: number; batchSize?: number; onBatch?: (r: DimsBackfillResult) => void } = {},
): Promise<DimsBackfillResult> {
  const concurrency = opts.concurrency ?? 16
  const batchSize = opts.batchSize ?? 500
  const result: DimsBackfillResult = { scanned: 0, updated: 0, viaSharp: 0, failed: [] }
  const { emojis } = schema
  let after = ''
  for (;;) {
    const remaining = opts.limit == null ? batchSize : Math.min(batchSize, opts.limit - result.scanned)
    if (remaining <= 0) break
    const rows = await db()
      .select({ id: emojis.id, originalKey: emojis.originalKey })
      .from(emojis)
      .where(and(isNull(emojis.width), gt(emojis.id, after)))
      .orderBy(asc(emojis.id))
      .limit(remaining)
    if (!rows.length) break
    after = rows[rows.length - 1]!.id
    result.scanned += rows.length

    const found = await mapLimit(rows, concurrency, async (r) => {
      try {
        const d = await readDims(r.originalKey)
        if (!(d.width > 0 && d.height > 0 && d.width <= 65535 && d.height <= 65535)) throw new Error(`implausible size ${d.width}×${d.height}`)
        return { id: r.id, ...d }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        result.failed.push({ id: r.id, error })
        log().warn({ emojiId: r.id, key: r.originalKey, error }, 'backfill-dims: could not read size')
        return null
      }
    })
    const ok = found.filter((x): x is NonNullable<typeof x> => x != null)
    if (ok.length) {
      const values = sql.join(
        ok.map((x) => sql`(${x.id}::text, ${x.width}::int, ${x.height}::int)`),
        sql`, `,
      )
      // one statement per batch; `width IS NULL` keeps a concurrent writer's (e.g. derive) values
      await db().execute(sql`
        UPDATE emojis AS e SET width = v.w, height = v.h
        FROM (VALUES ${values}) AS v(id, w, h)
        WHERE e.id = v.id AND e.width IS NULL`)
      result.updated += ok.length
      result.viaSharp += ok.filter((x) => x.via === 'sharp').length
    }
    opts.onBatch?.(result)
  }
  return result
}
