import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { audit } from '../audit'
import { db, schema } from '../db/client'
import { claimSlug, isHashSlug, slugify } from '../import/slug'
import { type Actor, badRequest, conflict, likePattern, many, notFound, thumbFromRow, toNum, type Tx } from './common'
import type { TaxonomyKind } from './inputs'
import { moveRedirect, refreshCounts } from './maintain'
import type { ArtistRow, CharacterRow, MergeResult, TagRow, TagDimension } from './types'

// 角色 / 画师 / 标签: CRUD, aliases, theme color, avatar, merge (docs/ARCHITECTURE.md §7: aliases and
// merged-away names stay searchable; renamed or merged slugs get 301s in redirects).

const PATH: Record<'character' | 'artist', string> = { character: '/characters', artist: '/artists' }

/** Slugs to clean up: Lane D's hash rules plus Halo submission terms (`submission-term-<hex>`). */
export function needsCleanSlug(slug: string): boolean {
  return isHashSlug(slug) || /(?:^|-)[0-9a-f]{12,}$/.test(slug)
}

function isUnique(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } }
  const code = e.code ?? e.cause?.code
  const name = e.constraint ?? e.cause?.constraint
  return code === '23505' && (!constraint || name === constraint)
}

async function uniqueSlug(tx: Tx, table: 'characters' | 'artists', base: string, selfId?: number): Promise<string> {
  const t = table === 'characters' ? schema.characters : schema.artists
  const rows = await tx
    .select({ slug: t.slug })
    .from(t)
    .where(and(sql`(${t.slug} = ${base} OR ${t.slug} LIKE ${base.replace(/[\\%_]/g, (c) => `\\${c}`) + '-%'})`, selfId ? ne(t.id, selfId) : sql`true`))
  return claimSlug(base, new Set(rows.map((r) => r.slug)))
}

function cleanAliases(list: string[] | undefined, name: string): string[] | undefined {
  if (!list) return undefined
  return [...new Set(list.map((a) => a.trim()).filter((a) => a && a !== name))]
}

// ---------- lists ----------

export async function listCharacters(q?: string): Promise<CharacterRow[]> {
  const where = q ? sql`(c.name ILIKE ${likePattern(q)} OR c.slug ILIKE ${likePattern(q)} OR EXISTS (SELECT 1 FROM character_aliases x WHERE x.character_id = c.id AND x.alias ILIKE ${likePattern(q)}))` : sql`true`
  const rows = await many<{
    id: number
    slug: string
    name: string
    theme_color: string | null
    avatar_emoji_id: string | null
    aliases: string[] | null
    packs: number
    published_packs: number
    emojis: number
    avatar: Parameters<typeof thumbFromRow>[0] | null
  }>(sql`
    SELECT c.id, c.slug, c.name, c.theme_color, c.avatar_emoji_id,
      (SELECT array_agg(a.alias ORDER BY a.alias) FROM character_aliases a WHERE a.character_id = c.id) AS aliases,
      (SELECT count(*) FROM pack_characters pc WHERE pc.character_id = c.id)::int AS packs,
      (SELECT count(*) FROM pack_characters pc JOIN packs p ON p.id = pc.pack_id AND p.status = 'published' WHERE pc.character_id = c.id)::int AS published_packs,
      (SELECT count(*) FROM emoji_characters ec WHERE ec.character_id = c.id)::int AS emojis,
      (SELECT row_to_json(x) FROM (SELECT e.id, e.storage_pack_key, e.variant_rev, e.status, e.derived_ready, e.p240_bytes
         FROM emojis e WHERE e.id = c.avatar_emoji_id) x) AS avatar
    FROM characters c WHERE ${where}
    ORDER BY c.sort, c.name`)
  return rows.map((r) => {
    const hash = needsCleanSlug(r.slug)
    return {
      id: toNum(r.id),
      slug: r.slug,
      name: r.name,
      themeColor: r.theme_color,
      avatarEmojiId: r.avatar_emoji_id,
      avatar: r.avatar ? thumbFromRow(r.avatar) : null,
      aliases: r.aliases ?? [],
      packCount: toNum(r.packs),
      publishedPackCount: toNum(r.published_packs),
      emojiCount: toNum(r.emojis),
      hashSlug: hash,
      suggestedSlug: hash ? slugify(r.name) : null,
    }
  })
}

export async function listArtists(q?: string): Promise<ArtistRow[]> {
  const where = q ? sql`(a.name ILIKE ${likePattern(q)} OR a.slug ILIKE ${likePattern(q)} OR EXISTS (SELECT 1 FROM artist_aliases x WHERE x.artist_id = a.id AND x.alias ILIKE ${likePattern(q)}))` : sql`true`
  const rows = await many<{ id: number; slug: string; name: string; links: ArtistRow['links'] | null; aliases: string[] | null; packs: number; commissions: number }>(sql`
    SELECT a.id, a.slug, a.name, a.links,
      (SELECT array_agg(x.alias ORDER BY x.alias) FROM artist_aliases x WHERE x.artist_id = a.id) AS aliases,
      (SELECT count(DISTINCT pa.pack_id) FROM pack_artists pa WHERE pa.artist_id = a.id AND pa.role = 'artist')::int AS packs,
      (SELECT count(DISTINCT pa.pack_id) FROM pack_artists pa WHERE pa.artist_id = a.id AND pa.role = 'commissioner')::int AS commissions
    FROM artists a WHERE ${where}
    ORDER BY lower(trim(a.name)), a.id`)
  return rows.map((r) => {
    const hash = needsCleanSlug(r.slug)
    return {
      id: toNum(r.id),
      slug: r.slug,
      name: r.name,
      links: r.links ?? [],
      aliases: r.aliases ?? [],
      packCount: toNum(r.packs),
      commissionCount: toNum(r.commissions),
      hashSlug: hash,
      suggestedSlug: hash ? slugify(r.name) : null,
      untrimmed: r.name !== r.name.trim() || /\s{2,}/.test(r.name),
    }
  })
}

export async function listTags(q?: string): Promise<TagRow[]> {
  const where = q ? sql`(t.name ILIKE ${likePattern(q)} OR t.slug ILIKE ${likePattern(q)})` : sql`true`
  const rows = await many<{ id: number; dimension: TagDimension; slug: string; name: string; packs: number }>(sql`
    SELECT t.id, t.dimension, t.slug, t.name, (SELECT count(*) FROM pack_tags pt WHERE pt.tag_id = t.id)::int AS packs
    FROM tags t WHERE ${where} ORDER BY t.dimension, t.name`)
  return rows.map((r) => ({ id: toNum(r.id), dimension: r.dimension, slug: r.slug, name: r.name, packCount: toNum(r.packs) }))
}

// ---------- save ----------

async function setAliases(tx: Tx, kind: 'character' | 'artist', ownerId: number, aliases: string[]) {
  const table = kind === 'character' ? schema.characterAliases : schema.artistAliases
  const col = kind === 'character' ? schema.characterAliases.characterId : schema.artistAliases.artistId
  await tx.delete(table).where(eq(col, ownerId))
  if (!aliases.length) return
  try {
    if (kind === 'character') await tx.insert(schema.characterAliases).values(aliases.map((alias) => ({ characterId: ownerId, alias })))
    else await tx.insert(schema.artistAliases).values(aliases.map((alias) => ({ artistId: ownerId, alias })))
  } catch (err) {
    if (isUnique(err)) throw conflict('有别名已被其他条目使用；同一个别名只能属于一个角色或画师')
    throw err
  }
}

export async function saveCharacter(
  actor: Actor,
  input: { id?: number; name: string; slug?: string; themeColor?: string | null; avatarEmojiId?: string | null; aliases?: string[]; sort?: number },
) {
  const { characters, emojis } = schema
  const res = await db().transaction(async (tx) => {
    if (input.avatarEmojiId) {
      const [e] = await tx.select({ id: emojis.id }).from(emojis).where(eq(emojis.id, input.avatarEmojiId))
      if (!e) throw badRequest('头像表情不存在')
    }
    const aliases = cleanAliases(input.aliases, input.name)
    if (!input.id) {
      const slug = input.slug ?? (await uniqueSlug(tx, 'characters', slugify(input.name)))
      const [taken] = await tx.select({ id: characters.id }).from(characters).where(eq(characters.slug, slug))
      if (taken) throw conflict(`slug「${slug}」已被使用`)
      const [row] = await tx
        .insert(characters)
        .values({ name: input.name, slug, themeColor: input.themeColor ?? null, avatarEmojiId: input.avatarEmojiId ?? null, sort: input.sort ?? 0 })
        .returning()
      if (aliases?.length) await setAliases(tx, 'character', row!.id, aliases)
      await audit(actor, 'character.create', { type: 'character', id: row!.id }, { name: row!.name, slug: row!.slug, aliases }, tx)
      return { id: row!.id, slug: row!.slug }
    }
    const [cur] = await tx.select().from(characters).where(eq(characters.id, input.id)).for('update')
    if (!cur) throw notFound('这个角色')
    const diff: Record<string, [unknown, unknown]> = {}
    const set: Partial<typeof characters.$inferInsert> = {}
    if (input.name !== cur.name) (diff.name = [cur.name, input.name]), (set.name = input.name)
    if (input.themeColor !== undefined && input.themeColor !== cur.themeColor) (diff.themeColor = [cur.themeColor, input.themeColor]), (set.themeColor = input.themeColor)
    if (input.avatarEmojiId !== undefined && input.avatarEmojiId !== cur.avatarEmojiId) (diff.avatarEmojiId = [cur.avatarEmojiId, input.avatarEmojiId]), (set.avatarEmojiId = input.avatarEmojiId)
    if (input.sort !== undefined && input.sort !== cur.sort) (diff.sort = [cur.sort, input.sort]), (set.sort = input.sort)
    if (input.slug && input.slug !== cur.slug) {
      const [taken] = await tx.select({ id: characters.id }).from(characters).where(and(eq(characters.slug, input.slug), ne(characters.id, cur.id)))
      if (taken) throw conflict(`slug「${input.slug}」已被其他角色使用`)
      diff.slug = [cur.slug, input.slug]
      set.slug = input.slug
      await moveRedirect(`${PATH.character}/${cur.slug}`, `${PATH.character}/${input.slug}`, tx)
    }
    if (aliases) {
      const before = (await tx.select({ a: schema.characterAliases.alias }).from(schema.characterAliases).where(eq(schema.characterAliases.characterId, cur.id))).map((r) => r.a).sort()
      if (before.join('\n') !== [...aliases].sort().join('\n')) {
        diff.aliases = [before, aliases]
        await setAliases(tx, 'character', cur.id, aliases)
      }
    }
    if (Object.keys(set).length) await tx.update(characters).set(set).where(eq(characters.id, cur.id))
    if (Object.keys(diff).length) await audit(actor, 'character.update', { type: 'character', id: cur.id }, diff, tx)
    return { id: cur.id, slug: set.slug ?? cur.slug }
  })
  await refreshCounts()
  return res
}

export async function saveArtist(actor: Actor, input: { id?: number; name: string; slug?: string; aliases?: string[]; links?: { label: string; url: string }[] }) {
  const { artists } = schema
  const res = await db().transaction(async (tx) => {
    const aliases = cleanAliases(input.aliases, input.name)
    if (!input.id) {
      const slug = input.slug ?? (await uniqueSlug(tx, 'artists', slugify(input.name)))
      const [taken] = await tx.select({ id: artists.id }).from(artists).where(eq(artists.slug, slug))
      if (taken) throw conflict(`slug「${slug}」已被使用`)
      const [row] = await tx.insert(artists).values({ name: input.name, slug, links: input.links ?? [] }).returning()
      if (aliases?.length) await setAliases(tx, 'artist', row!.id, aliases)
      await audit(actor, 'artist.create', { type: 'artist', id: row!.id }, { name: row!.name, slug: row!.slug, aliases }, tx)
      return { id: row!.id, slug: row!.slug }
    }
    const [cur] = await tx.select().from(artists).where(eq(artists.id, input.id)).for('update')
    if (!cur) throw notFound('这位画师')
    const diff: Record<string, [unknown, unknown]> = {}
    const set: Partial<typeof artists.$inferInsert> = {}
    if (input.name !== cur.name) (diff.name = [cur.name, input.name]), (set.name = input.name)
    if (input.links && JSON.stringify(input.links) !== JSON.stringify(cur.links)) (diff.links = [cur.links, input.links]), (set.links = input.links)
    if (input.slug && input.slug !== cur.slug) {
      const [taken] = await tx.select({ id: artists.id }).from(artists).where(and(eq(artists.slug, input.slug), ne(artists.id, cur.id)))
      if (taken) throw conflict(`slug「${input.slug}」已被其他画师使用`)
      diff.slug = [cur.slug, input.slug]
      set.slug = input.slug
      await moveRedirect(`${PATH.artist}/${cur.slug}`, `${PATH.artist}/${input.slug}`, tx)
    }
    if (aliases) {
      const before = (await tx.select({ a: schema.artistAliases.alias }).from(schema.artistAliases).where(eq(schema.artistAliases.artistId, cur.id))).map((r) => r.a).sort()
      if (before.join('\n') !== [...aliases].sort().join('\n')) {
        diff.aliases = [before, aliases]
        await setAliases(tx, 'artist', cur.id, aliases)
      }
    }
    if (Object.keys(set).length) await tx.update(artists).set(set).where(eq(artists.id, cur.id))
    if (Object.keys(diff).length) await audit(actor, 'artist.update', { type: 'artist', id: cur.id }, diff, tx)
    return { id: cur.id, slug: set.slug ?? cur.slug }
  })
  await refreshCounts()
  return res
}

export async function saveTag(actor: Actor, input: { id?: number; dimension: TagDimension; name: string; slug?: string }) {
  const { tags } = schema
  const slug = input.slug ?? slugify(input.name)
  try {
    const res = await db().transaction(async (tx) => {
      if (!input.id) {
        const [row] = await tx.insert(tags).values({ dimension: input.dimension, name: input.name, slug }).returning()
        await audit(actor, 'tag.create', { type: 'tag', id: row!.id }, { dimension: row!.dimension, name: row!.name, slug: row!.slug }, tx)
        return { id: row!.id, slug: row!.slug }
      }
      const [cur] = await tx.select().from(tags).where(eq(tags.id, input.id)).for('update')
      if (!cur) throw notFound('这个标签')
      const diff: Record<string, [unknown, unknown]> = {}
      if (cur.name !== input.name) diff.name = [cur.name, input.name]
      if (cur.dimension !== input.dimension) diff.dimension = [cur.dimension, input.dimension]
      if (input.slug && cur.slug !== input.slug) diff.slug = [cur.slug, input.slug]
      if (Object.keys(diff).length) {
        await tx
          .update(tags)
          .set({ name: input.name, dimension: input.dimension, ...(input.slug ? { slug: input.slug } : {}) })
          .where(eq(tags.id, cur.id))
        await audit(actor, 'tag.update', { type: 'tag', id: cur.id }, diff, tx)
      }
      return { id: cur.id, slug: input.slug ?? cur.slug }
    })
    await refreshCounts()
    return res
  } catch (err) {
    if (isUnique(err)) throw conflict(`这个维度下已有 slug「${slug}」的标签`)
    throw err
  }
}

// ---------- delete ----------

/** Delete an entry and its links. Characters and artists with packs must be merged instead. */
export async function deleteTaxonomy(actor: Actor, input: { kind: TaxonomyKind; id: number }) {
  const { characters, artists, tags, packCharacters, packArtists, emojiCharacters, packTags } = schema
  await db().transaction(async (tx) => {
    if (input.kind === 'character') {
      const [c] = await tx.select().from(characters).where(eq(characters.id, input.id))
      if (!c) throw notFound('这个角色')
      const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(packCharacters).where(eq(packCharacters.characterId, c.id))
      const [usedE] = await tx.select({ n: sql<number>`count(*)::int` }).from(emojiCharacters).where(eq(emojiCharacters.characterId, c.id))
      if (toNum(used?.n) || toNum(usedE?.n)) throw conflict('这个角色还关联着表情包或表情，请先合并到其他角色')
      await tx.delete(characters).where(eq(characters.id, c.id))
      await audit(actor, 'character.delete', { type: 'character', id: c.id }, { name: c.name, slug: c.slug }, tx)
    } else if (input.kind === 'artist') {
      const [a] = await tx.select().from(artists).where(eq(artists.id, input.id))
      if (!a) throw notFound('这位画师')
      const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(packArtists).where(eq(packArtists.artistId, a.id))
      if (toNum(used?.n)) throw conflict('这位画师还关联着表情包，请先合并到其他画师')
      await tx.delete(artists).where(eq(artists.id, a.id))
      await audit(actor, 'artist.delete', { type: 'artist', id: a.id }, { name: a.name, slug: a.slug }, tx)
    } else {
      const [t] = await tx.select().from(tags).where(eq(tags.id, input.id))
      if (!t) throw notFound('这个标签')
      const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(packTags).where(eq(packTags.tagId, t.id))
      await tx.delete(tags).where(eq(tags.id, t.id))
      await audit(actor, 'tag.delete', { type: 'tag', id: t.id }, { name: t.name, slug: t.slug, dimension: t.dimension, packs: toNum(used?.n) }, tx)
    }
  })
  await refreshCounts()
  return { ok: true }
}

// ---------- merge ----------

/**
 * Merge A into B: links move to B (composite keys, so insert-missing then delete), A's aliases move to B
 * and A's name becomes one (unless B already has it or it belongs elsewhere), A's public slugs 301 to
 * B, redirects that pointed at A follow, then A is deleted. Tags only move their pack links.
 */
export async function mergeTaxonomy(actor: Actor, input: { kind: TaxonomyKind; fromId: number; toId: number; keepName: boolean }): Promise<MergeResult> {
  if (input.fromId === input.toId) throw badRequest('不能合并到自己')
  const result = await db().transaction(async (tx) => {
    if (input.kind === 'tag') return mergeTags(tx, actor, input.fromId, input.toId)
    const isChar = input.kind === 'character'
    const table = isChar ? schema.characters : schema.artists
    const rows = await tx.select().from(table).where(inArray(table.id, [input.fromId, input.toId])).for('update')
    const from = rows.find((r) => r.id === input.fromId)
    const to = rows.find((r) => r.id === input.toId)
    if (!from || !to) throw notFound(isChar ? '要合并的角色' : '要合并的画师')

    let packsMoved = 0
    let emojisMoved = 0
    if (isChar) {
      const moved = await tx.execute(sql`
        INSERT INTO pack_characters (pack_id, character_id)
        SELECT pack_id, ${to.id} FROM pack_characters WHERE character_id = ${from.id}
        ON CONFLICT DO NOTHING`)
      packsMoved = moved.rowCount ?? 0
      const movedE = await tx.execute(sql`
        INSERT INTO emoji_characters (emoji_id, character_id)
        SELECT emoji_id, ${to.id} FROM emoji_characters WHERE character_id = ${from.id}
        ON CONFLICT DO NOTHING`)
      emojisMoved = movedE.rowCount ?? 0
      await tx.execute(sql`DELETE FROM pack_characters WHERE character_id = ${from.id}`)
      await tx.execute(sql`DELETE FROM emoji_characters WHERE character_id = ${from.id}`)
    } else {
      const moved = await tx.execute(sql`
        INSERT INTO pack_artists (pack_id, artist_id, role)
        SELECT pack_id, ${to.id}, role FROM pack_artists WHERE artist_id = ${from.id}
        ON CONFLICT DO NOTHING`)
      packsMoved = moved.rowCount ?? 0
      await tx.execute(sql`DELETE FROM pack_artists WHERE artist_id = ${from.id}`)
    }

    // aliases: A's own aliases, then A's name; skip ones B already has or that equal B's name
    const aliasTable = isChar ? 'character_aliases' : 'artist_aliases'
    const ownerCol = isChar ? 'character_id' : 'artist_id'
    const fromAliases = await many<{ alias: string }>(sql`SELECT alias FROM ${sql.raw(aliasTable)} WHERE ${sql.raw(ownerCol)} = ${from.id}`, tx)
    await tx.execute(sql`DELETE FROM ${sql.raw(aliasTable)} WHERE ${sql.raw(ownerCol)} = ${from.id}`)
    const candidates = [...fromAliases.map((a) => a.alias), ...(input.keepName ? [from.name.trim()] : [])].filter((a) => a && a !== to.name.trim())
    let aliasesMoved = 0
    for (const alias of [...new Set(candidates)]) {
      const r = await tx.execute(sql`
        INSERT INTO ${sql.raw(aliasTable)} (${sql.raw(ownerCol)}, alias) VALUES (${to.id}, ${alias})
        ON CONFLICT DO NOTHING`)
      aliasesMoved += r.rowCount ?? 0
    }

    // public URLs of A now 301 to B (its legacy slug too: the legacy fallback goes with the row)
    const base = isChar ? PATH.character : PATH.artist
    const target = `${base}/${to.slug}`
    const redirects: string[] = []
    for (const s of [from.slug, from.legacySlug]) {
      if (!s || s === to.slug) continue
      await moveRedirect(`${base}/${s}`, target, tx)
      redirects.push(`${base}/${s}`)
    }

    if (isChar) {
      const f = from as typeof schema.characters.$inferSelect
      const t = to as typeof schema.characters.$inferSelect
      const set: Partial<typeof schema.characters.$inferInsert> = {}
      if (!t.avatarEmojiId && f.avatarEmojiId) set.avatarEmojiId = f.avatarEmojiId
      if (!t.themeColor && f.themeColor) set.themeColor = f.themeColor
      if (Object.keys(set).length) await tx.update(schema.characters).set(set).where(eq(schema.characters.id, t.id))
      await tx.delete(schema.characters).where(eq(schema.characters.id, f.id))
    } else {
      const f = from as typeof schema.artists.$inferSelect
      const t = to as typeof schema.artists.$inferSelect
      const links = [...t.links, ...f.links.filter((l) => !t.links.some((x) => x.url === l.url))]
      if (links.length !== t.links.length) await tx.update(schema.artists).set({ links }).where(eq(schema.artists.id, t.id))
      await tx.delete(schema.artists).where(eq(schema.artists.id, f.id))
    }

    const res: MergeResult = {
      from: { id: from.id, name: from.name, slug: from.slug },
      to: { id: to.id, name: to.name, slug: to.slug },
      packsMoved,
      emojisMoved,
      aliasesMoved,
      redirects,
    }
    await audit(actor, `${input.kind}.merge`, { type: input.kind, id: to.id }, res, tx)
    return res
  })
  await refreshCounts()
  return result
}

async function mergeTags(tx: Tx, actor: Actor, fromId: number, toId: number): Promise<MergeResult> {
  const { tags } = schema
  const rows = await tx.select().from(tags).where(inArray(tags.id, [fromId, toId])).for('update')
  const from = rows.find((r) => r.id === fromId)
  const to = rows.find((r) => r.id === toId)
  if (!from || !to) throw notFound('要合并的标签')
  const moved = await tx.execute(sql`
    INSERT INTO pack_tags (pack_id, tag_id) SELECT pack_id, ${to.id} FROM pack_tags WHERE tag_id = ${from.id}
    ON CONFLICT DO NOTHING`)
  await tx.delete(tags).where(eq(tags.id, from.id))
  const res: MergeResult = {
    from: { id: from.id, name: from.name, slug: from.slug },
    to: { id: to.id, name: to.name, slug: to.slug },
    packsMoved: moved.rowCount ?? 0,
    emojisMoved: 0,
    aliasesMoved: 0,
    redirects: [],
  }
  await audit(actor, 'tag.merge', { type: 'tag', id: to.id }, res, tx)
  return res
}
