import { type SQL, sql } from 'drizzle-orm'
import { db } from '../db/client'

// Small helpers shared by the catalog queries. The queries are hand-written SQL (sql`` keeps every
// value a bind parameter) because they aggregate cards in one statement with LATERAL/json_agg.
//
// Aliases used throughout: p = packs, e = emojis, c = characters, a = artists, t = tags.

export async function rows<T>(query: SQL): Promise<T[]> {
  const res = await db().execute(query)
  return res.rows as T[]
}

/** Published-at used for ordering and display; imported packs may lack published_at. */
export const PUB_AT = sql.raw('coalesce(p.published_at, p.created_at)')

/** Pack order of emojis everywhere (detail page, permalink index, covers). */
export function emojiOrder(alias = 'e'): SQL {
  return sql.raw(`${alias}.sort_order, ${alias}.created_at, ${alias}.id`)
}

/** Raw image fields of one emoji as JSON, mapped by toEmojiImage(). */
function emojiJsonText(alias: string): string {
  return (
    `json_build_object('id', ${alias}.id, 'k', ${alias}.storage_pack_key, 'r', ${alias}.variant_rev, ` +
    `'w', ${alias}.width, 'h', ${alias}.height, 'f', ${alias}.frames)`
  )
}

export function emojiJson(alias = 'e'): SQL {
  return sql.raw(emojiJsonText(alias))
}

/** Cover of pack `pa`: its cover_emoji_id when that is a published emoji of the pack, else the first. */
export function coverJson(pa = 'p'): SQL {
  return sql.raw(
    `(select ${emojiJsonText('ce')} from emojis ce ` +
      `where ce.pack_id = ${pa}.id and ce.status = 'published' ` +
      `order by (ce.id = ${pa}.cover_emoji_id) is true desc, ce.sort_order, ce.created_at, ce.id limit 1)`,
  )
}

/** A character has published content: a published pack, or a published emoji in a published pack. */
export function characterVisible(alias = 'c'): SQL {
  return sql.raw(
    `(exists (select 1 from pack_characters vx join packs vp on vp.id = vx.pack_id ` +
      `where vx.character_id = ${alias}.id and vp.status = 'published') ` +
      `or exists (select 1 from emoji_characters vy join emojis ve on ve.id = vy.emoji_id join packs vq on vq.id = ve.pack_id ` +
      `where vy.character_id = ${alias}.id and ve.status = 'published' and vq.status = 'published'))`,
  )
}

export function artistVisible(alias = 'a'): SQL {
  return sql.raw(
    `exists (select 1 from pack_artists vx join packs vp on vp.id = vx.pack_id ` +
      `where vx.artist_id = ${alias}.id and vp.status = 'published')`,
  )
}

export function tagVisible(alias = 't'): SQL {
  return sql.raw(
    `exists (select 1 from pack_tags vx join packs vp on vp.id = vx.pack_id ` +
      `where vx.tag_id = ${alias}.id and vp.status = 'published')`,
  )
}

/** Escape LIKE/ILIKE metacharacters (default escape character is backslash). */
export function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m)
}

// ---- keyset pagination ----

export type KeyType = 'int' | 'bigint' | 'timestamptz' | 'text'

export interface KeyCol {
  /** SQL expression; must be non-null for every row */
  expr: SQL
  desc: boolean
  type: KeyType
}

export function orderBySql(cols: KeyCol[]): SQL {
  return sql.join(
    cols.map((c) => sql`${c.expr} ${sql.raw(c.desc ? 'desc' : 'asc')}`),
    sql`, `,
  )
}

/** Select list of the key columns as text (k0, k1, …): exact values for the next cursor (µs timestamps). */
export function keyTextSql(cols: KeyCol[]): SQL {
  return sql.join(
    cols.map((c, i) => sql`(${c.expr})::text as ${sql.raw(`k${i}`)}`),
    sql`, `,
  )
}

/** Rows strictly after `values` in the order given by `cols` (mixed directions allowed). */
export function keysetAfter(cols: KeyCol[], values: string[]): SQL {
  const val = (i: number) => sql`${values[i]}::${sql.raw(cols[i]!.type)}`
  const ors = cols.map((c, i) => {
    const parts: SQL[] = cols.slice(0, i).map((p, j) => sql`${p.expr} = ${val(j)}`)
    parts.push(sql`${c.expr} ${sql.raw(c.desc ? '<' : '>')} ${val(i)}`)
    return sql`(${sql.join(parts, sql` and `)})`
  })
  return sql`(${sql.join(ors, sql` or `)})`
}

export function keyValues(row: Record<string, unknown>, n: number): string[] {
  return Array.from({ length: n }, (_, i) => String(row[`k${i}`]))
}

/** pg returns int8/numeric as strings; everything numeric goes through here. */
export function num(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v !== '') return Number(v)
  return 0
}

/** Date or pg/JSON timestamp text → ISO-8601. */
export function iso(v: unknown): string {
  return (v instanceof Date ? v : new Date(String(v))).toISOString()
}

export function isoOrNull(v: unknown): string | null {
  return v === null || v === undefined ? null : iso(v)
}

/** The Asia/Shanghai calendar day (YYYY-MM-DD) for "today" features. */
export function shanghaiDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
