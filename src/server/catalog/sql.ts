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

// ---- visibility: the only places that spell out what "public" means ----
//
// A public emoji is published AND has its web derivatives (p240/a160) in derived/v1/, so every image
// URL a page renders exists. A public pack is published AND holds at least one public emoji; a pack
// whose derivatives are still being generated is hidden everywhere (lists, search, facets, detail).

/** Emoji `alias` is public: published with derivatives ready. */
export function emojiVisibleText(alias: string): string {
  return `(${alias}.status = 'published' and ${alias}.derived_ready)`
}

/** Pack `alias` is public: published with at least one public emoji. */
export function packVisibleText(alias: string): string {
  const e = `vr_${alias}`
  return `(${alias}.status = 'published' and exists (select 1 from emojis ${e} where ${e}.pack_id = ${alias}.id and ${emojiVisibleText(e)}))`
}

/**
 * Pack `alias` is published. Only valid joined to a public emoji of that pack (which makes the pack
 * public too); it spares the per-row exists() of packVisible on emoji-level scans.
 */
export function packPublishedText(alias: string): string {
  return `${alias}.status = 'published'`
}

export const emojiVisible = (alias = 'e'): SQL => sql.raw(emojiVisibleText(alias))
export const packVisible = (alias = 'p'): SQL => sql.raw(packVisibleText(alias))
export const packPublished = (alias = 'p'): SQL => sql.raw(packPublishedText(alias))

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

/** Cover of pack `pa`: its cover_emoji_id when that is a public emoji of the pack, else the first. */
export function coverJson(pa = 'p'): SQL {
  return sql.raw(
    `(select ${emojiJsonText('ce')} from emojis ce ` +
      `where ce.pack_id = ${pa}.id and ${emojiVisibleText('ce')} ` +
      `order by (ce.id = ${pa}.cover_emoji_id) is true desc, ce.sort_order, ce.created_at, ce.id limit 1)`,
  )
}

/** A character has public content: a public pack, or a public emoji (in a published pack). */
export function characterVisible(alias = 'c'): SQL {
  return sql.raw(
    `(exists (select 1 from pack_characters vx join packs vp on vp.id = vx.pack_id ` +
      `where vx.character_id = ${alias}.id and ${packVisibleText('vp')}) ` +
      `or exists (select 1 from emoji_characters vy join emojis ve on ve.id = vy.emoji_id join packs vq on vq.id = ve.pack_id ` +
      `where vy.character_id = ${alias}.id and ${emojiVisibleText('ve')} and ${packPublishedText('vq')}))`,
  )
}

export function artistVisible(alias = 'a'): SQL {
  return sql.raw(
    `exists (select 1 from pack_artists vx join packs vp on vp.id = vx.pack_id ` +
      `where vx.artist_id = ${alias}.id and ${packVisibleText('vp')})`,
  )
}

export function tagVisible(alias = 't'): SQL {
  return sql.raw(
    `exists (select 1 from pack_tags vx join packs vp on vp.id = vx.pack_id ` +
      `where vx.tag_id = ${alias}.id and ${packVisibleText('vp')})`,
  )
}

/**
 * Seeded pseudo-random sort key (bigint) for a text expression: the same seed gives the same order.
 * hashtextextended is ~3× cheaper than md5 over the 15k-emoji table.
 */
export function seededHash(text: SQL, seed: string): SQL {
  return sql`hashtextextended(${text}, hashtext(${seed}::text)::bigint)`
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
