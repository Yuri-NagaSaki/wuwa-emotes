import { type SQL, sql } from 'drizzle-orm'
import { type CardRow, cardSelect, toPackCard } from './cards'
import { decodeCursor, encodeCursor, newSeed } from './cursor'
import { listPacksInput, type ListPacksInput, TAG_FILTER_RE } from './inputs'
import { type KeyCol, keysetAfter, keyTextSql, keyValues, orderBySql, packVisible, PUB_AT, rows, seededHash } from './sql'
import type { PackCard, PackKind, PackSort, Page, SourceKind, TagDimension } from './types'

// /packs 目录: keyset pagination over public packs (sql.ts). Every order ends in the pack id, so it is
// total and stable; random orders by a seeded hash of the id, and the seed travels in the cursor so
// pages never repeat.

export interface PackFilters {
  character?: string
  artist?: string
  kind?: PackKind
  source?: SourceKind
  group?: string
  tag?: string
}

const ID_DESC: KeyCol = { expr: sql.raw('p.id'), desc: true, type: 'int' }

export function packKeyCols(sort: PackSort, seed: string): KeyCol[] {
  switch (sort) {
    case 'new':
      return [{ expr: PUB_AT, desc: true, type: 'timestamptz' }, ID_DESC]
    case 'hot':
      return [{ expr: sql.raw('p.download_count'), desc: true, type: 'bigint' }, ID_DESC]
    case 'fav':
      return [{ expr: sql.raw('p.favorite_count'), desc: true, type: 'int' }, ID_DESC]
    case 'random':
      return [
        { expr: seededHash(sql.raw('p.id::text'), seed), desc: false, type: 'bigint' },
        { expr: sql.raw('p.id'), desc: false, type: 'int' },
      ]
  }
}

function filterSql(f: PackFilters): SQL[] {
  const out: SQL[] = []
  if (f.character) {
    out.push(sql`exists (select 1 from pack_characters fc join characters c on c.id = fc.character_id
                         where fc.pack_id = p.id and c.slug = ${f.character})`)
  }
  if (f.artist) {
    out.push(sql`exists (select 1 from pack_artists fa join artists a on a.id = fa.artist_id
                         where fa.pack_id = p.id and a.slug = ${f.artist})`)
  }
  if (f.kind) out.push(sql`p.kind = ${f.kind}`)
  if (f.source) out.push(sql`p.source_kind = ${f.source}`)
  const tags: [TagDimension, string][] = []
  if (f.group) tags.push(['group', f.group])
  if (f.tag) {
    const m = TAG_FILTER_RE.exec(f.tag)
    if (m) tags.push([m[1] as TagDimension, m[2]!])
  }
  for (const [dimension, slug] of tags) {
    out.push(sql`exists (select 1 from pack_tags ft join tags t on t.id = ft.tag_id
                         where ft.pack_id = p.id and t.dimension = ${dimension} and t.slug = ${slug})`)
  }
  return out
}

export interface PackPageOptions {
  sort: PackSort
  seed?: string
  cursor?: string
  limit: number
}

/** One page of public pack cards: a single statement (keyset page + card aggregation). */
export async function packPage(filters: PackFilters, opts: PackPageOptions): Promise<Page<PackCard>> {
  const scope = `packs:${opts.sort}`
  // the key column layout does not depend on the seed value, so decode first, then build with the seed
  const shape = packKeyCols(opts.sort, '0')
  const cur = opts.cursor ? decodeCursor(opts.cursor, scope, shape) : null
  const seed = opts.sort === 'random' ? (cur?.seed ?? opts.seed ?? newSeed()) : ''
  const cols = packKeyCols(opts.sort, seed)

  const where = [packVisible('p'), ...filterSql(filters)]
  if (cur) where.push(keysetAfter(cols, cur.keys))
  const order = orderBySql(cols)
  const source = sql`
    select p.id, ${keyTextSql(cols)}, row_number() over (order by ${order}) as ord
    from packs p
    where ${sql.join(where, sql` and `)}
    order by ${order}
    limit ${opts.limit + 1}`
  const list = await rows<CardRow>(sql`${cardSelect(source)} order by src.ord`)

  const more = list.length > opts.limit
  const items = more ? list.slice(0, opts.limit) : list
  const last = items[items.length - 1]
  return {
    items: items.map(toPackCard),
    nextCursor: more && last ? encodeCursor({ scope, keys: keyValues(last, cols.length), seed: seed || undefined }) : null,
    seed: opts.sort === 'random' ? seed : null,
  }
}

export async function listPacks(input: ListPacksInput = {}): Promise<Page<PackCard>> {
  const i = listPacksInput.parse(input)
  return packPage(
    { character: i.character, artist: i.artist, kind: i.kind, source: i.source, group: i.group, tag: i.tag },
    { sort: i.sort, seed: i.seed, cursor: i.cursor, limit: i.limit },
  )
}
