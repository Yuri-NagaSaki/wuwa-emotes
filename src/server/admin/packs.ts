import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'
import { newPackKey } from '#/shared/ids'
import { audit } from '../audit'
import { db, schema } from '../db/client'
import { claimSlug, slugify } from '../import/slug'
import { LICENSE_LABELS } from '../media/credits'
import { deleteEmojiFiles } from '../media/publish'
import { deleteObjects, listKeys } from '../media/s3'
import {
  type Actor,
  assertOwner,
  badRequest,
  conflict,
  likePattern,
  many,
  notFound,
  pageOf,
  thumbFromRow,
  thumbUrl,
  toIso,
  toNum,
} from './common'
import type { PackListInput, PackPatch } from './inputs'
import { busyJobs, type MediaDeps, moveRedirect, refreshCounts, refreshZip } from './maintain'
import type { PackEditorData, PackListData, PackListRow, PackStatus } from './types'

// 表情包: list, create, edit, status, delete (docs/ARCHITECTURE.md §3, §6.3, §6.4).

const STATUSES: PackStatus[] = ['draft', 'published', 'hidden']

function packFilters(input: PackListInput, withStatus: boolean): SQL {
  const parts: SQL[] = [sql`true`]
  if (withStatus && input.status) parts.push(sql`p.status = ${input.status}`)
  if (input.kind) parts.push(sql`p.kind = ${input.kind}`)
  if (input.source) parts.push(sql`p.source_kind = ${input.source}`)
  const q = input.q?.trim()
  if (q) {
    const pat = likePattern(q)
    const byId = /^\d{1,9}$/.test(q) ? sql` OR p.id = ${Number(q)}` : sql``
    parts.push(sql`(p.title ILIKE ${pat} OR p.pack_key ILIKE ${pat} OR p.slug ILIKE ${pat}${byId}
      OR EXISTS (SELECT 1 FROM pack_characters pc JOIN characters c ON c.id = pc.character_id
                 LEFT JOIN character_aliases ca ON ca.character_id = c.id
                 WHERE pc.pack_id = p.id AND (c.name ILIKE ${pat} OR ca.alias ILIKE ${pat}))
      OR EXISTS (SELECT 1 FROM pack_artists pa JOIN artists a ON a.id = pa.artist_id
                 WHERE pa.pack_id = p.id AND a.name ILIKE ${pat}))`)
  }
  return sql.join(parts, sql` AND `)
}

const SORTS: Record<NonNullable<PackListInput['sort']>, SQL> = {
  updated: sql`p.updated_at DESC, p.id DESC`,
  created: sql`p.created_at DESC, p.id DESC`,
  title: sql`p.title, p.id`,
  downloads: sql`p.download_count DESC, p.id`,
}

interface PackRowSql {
  id: number
  pack_key: string
  slug: string
  title: string
  status: PackStatus
  source_kind: PackListRow['sourceKind']
  kind: PackListRow['kind']
  downloadable: boolean
  pin_level: number
  emoji_count: number
  download_count: string | number
  updated_at: Date | string
  total_emojis: number
  pending_emojis: number
  cover: Parameters<typeof thumbFromRow>[0] | null
  characters: { name: string; color: string | null }[] | null
}

export async function listPacks(input: PackListInput): Promise<PackListData> {
  const where = packFilters(input, true)
  const [{ n } = { n: 0 }] = await many<{ n: number }>(sql`SELECT count(*)::int AS n FROM packs p WHERE ${where}`)
  const counted = await many<{ status: PackStatus; n: number }>(
    sql`SELECT p.status, count(*)::int AS n FROM packs p WHERE ${packFilters(input, false)} GROUP BY p.status`,
  )
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<PackStatus, number>
  for (const c of counted) counts[c.status] = toNum(c.n)
  const pg = pageOf(input.page, toNum(n))
  const rows = await many<PackRowSql>(sql`
    SELECT p.id, p.pack_key, p.slug, p.title, p.status, p.source_kind, p.kind, p.downloadable, p.pin_level,
      p.emoji_count, p.download_count, p.updated_at,
      (SELECT count(*) FROM emojis e WHERE e.pack_id = p.id)::int AS total_emojis,
      (SELECT count(*) FROM emojis e WHERE e.pack_id = p.id AND e.status = 'pending')::int AS pending_emojis,
      (SELECT row_to_json(x) FROM (
         SELECT e.id, e.storage_pack_key, e.variant_rev, e.status, e.derived_ready, e.p240_bytes FROM emojis e
         WHERE e.pack_id = p.id
         ORDER BY (e.id = p.cover_emoji_id) IS TRUE DESC, (e.status = 'published') DESC, e.sort_order, e.id LIMIT 1) x) AS cover,
      (SELECT json_agg(json_build_object('name', c.name, 'color', c.theme_color) ORDER BY c.sort, c.name)
         FROM pack_characters pc JOIN characters c ON c.id = pc.character_id WHERE pc.pack_id = p.id) AS characters
    FROM packs p WHERE ${where}
    ORDER BY ${SORTS[input.sort ?? 'updated']}
    LIMIT ${pg.size} OFFSET ${pg.offset}`)
  return {
    rows: rows.map((r) => ({
      id: toNum(r.id),
      packKey: r.pack_key,
      slug: r.slug,
      title: r.title,
      status: r.status,
      sourceKind: r.source_kind,
      kind: r.kind,
      downloadable: r.downloadable,
      pinLevel: toNum(r.pin_level),
      emojiCount: toNum(r.emoji_count),
      totalEmojis: toNum(r.total_emojis),
      pendingEmojis: toNum(r.pending_emojis),
      downloadCount: toNum(r.download_count),
      updatedAt: toIso(r.updated_at) ?? '',
      thumb: r.cover ? thumbFromRow(r.cover) : null,
      characters: r.characters ?? [],
    })),
    total: toNum(n),
    page: pg.page,
    pages: pg.pages,
    pageSize: pg.size,
    counts,
  }
}

export async function createPack(actor: Actor, input: { title: string }): Promise<{ id: number; slug: string }> {
  const base = slugify(input.title)
  const { packs } = schema
  return db().transaction(async (tx) => {
    const taken = await tx
      .select({ slug: packs.slug })
      .from(packs)
      .where(sql`${packs.slug} = ${base} OR ${packs.slug} LIKE ${base.replace(/[\\%_]/g, (c) => `\\${c}`) + '-%'}`)
    const slug = claimSlug(base.startsWith('x-') ? newPackKey('') : base, new Set(taken.map((t) => t.slug)))
    const [row] = await tx
      .insert(packs)
      .values({ packKey: newPackKey(base.startsWith('x-') ? '' : base), slug, title: input.title, status: 'draft', ownerId: actor.id })
      .returning({ id: packs.id, slug: packs.slug, packKey: packs.packKey })
    await audit(actor, 'pack.create', { type: 'pack', id: row!.id }, { title: input.title, slug: row!.slug, packKey: row!.packKey }, tx)
    return { id: row!.id, slug: row!.slug }
  })
}

export async function getPackEditor(id: number): Promise<PackEditorData> {
  const { packs, users, emojis, packCharacters, packArtists, packTags, zipArtifacts, characters, artists, tags, redirects } = schema
  const [row] = await db()
    .select({ pack: packs, ownerName: users.name })
    .from(packs)
    .leftJoin(users, eq(users.id, packs.ownerId))
    .where(eq(packs.id, id))
  if (!row) throw notFound('这个表情包')
  const p = row.pack
  const [chars, arts, tg, ems, zip, busy, old, cOpts, aOpts, tOpts] = await Promise.all([
    db().select({ id: packCharacters.characterId }).from(packCharacters).where(eq(packCharacters.packId, id)),
    db().select({ id: packArtists.artistId, role: packArtists.role }).from(packArtists).where(eq(packArtists.packId, id)),
    db().select({ id: packTags.tagId }).from(packTags).where(eq(packTags.packId, id)),
    db().select().from(emojis).where(eq(emojis.packId, id)).orderBy(asc(emojis.sortOrder), asc(emojis.createdAt), asc(emojis.id)),
    db().select().from(zipArtifacts).where(eq(zipArtifacts.packId, id)),
    busyJobs('zip.build', [String(id)]),
    db().select({ from: redirects.fromPath }).from(redirects).where(eq(redirects.toPath, `/packs/${p.slug}`)),
    db().select({ id: characters.id, name: characters.name, slug: characters.slug, color: characters.themeColor }).from(characters).orderBy(asc(characters.sort), asc(characters.name)),
    db().select({ id: artists.id, name: artists.name, slug: artists.slug }).from(artists).orderBy(asc(artists.name)),
    db().select({ id: tags.id, name: tags.name, slug: tags.slug, dimension: tags.dimension }).from(tags).orderBy(asc(tags.dimension), asc(tags.name)),
  ])
  const z = zip[0]
  const published = ems.filter((e) => e.status === 'published').length
  return {
    pack: {
      id: p.id,
      packKey: p.packKey,
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      descriptionMd: p.descriptionMd,
      status: p.status,
      sourceKind: p.sourceKind,
      kind: p.kind,
      license: p.license,
      downloadable: p.downloadable,
      pinLevel: p.pinLevel,
      memorial: p.memorial,
      commissioner: p.commissioner,
      creditsText: p.creditsText,
      sourceUrl: p.sourceUrl,
      coverEmojiId: p.coverEmojiId,
      downloadCount: p.downloadCount,
      favoriteCount: p.favoriteCount,
      publishedAt: toIso(p.publishedAt),
      createdAt: toIso(p.createdAt) ?? '',
      updatedAt: toIso(p.updatedAt) ?? '',
      ownerName: row.ownerName,
      characterIds: chars.map((c) => c.id),
      artistIds: arts.filter((a) => a.role === 'artist').map((a) => a.id),
      commissionerIds: arts.filter((a) => a.role === 'commissioner').map((a) => a.id),
      tagIds: tg.map((t) => t.id),
    },
    emojis: ems.map((e) => ({
      id: e.id,
      status: e.status,
      sortOrder: e.sortOrder,
      format: e.format,
      bytes: e.bytes,
      width: e.width,
      height: e.height,
      frames: e.frames,
      variantRev: e.variantRev,
      derivedReady: e.derivedReady,
      fullReady: e.fullReady,
      p240Bytes: e.p240Bytes,
      a160Bytes: e.a160Bytes,
      thumb: thumbUrl(e),
      storagePackKey: e.storagePackKey,
    })),
    zip: {
      objectKey: z?.objectKey ?? null,
      bytes: z ? z.bytes : null,
      builtAt: toIso(z?.builtAt),
      stale: Boolean(z?.contentHash.startsWith('stale:')),
      queued: busy.has(String(id)),
      eligible: p.status === 'published' && p.downloadable && published > 0,
    },
    oldSlugs: old.map((o) => o.from.replace(/^\/packs\//, '')).filter((s) => s && !s.includes('/')),
    options: {
      characters: cOpts.map((c) => ({ id: c.id, name: c.name, slug: c.slug, color: c.color })),
      artists: aOpts.map((a) => ({ id: a.id, name: a.name, slug: a.slug })),
      tags: tOpts.map((t) => ({ id: t.id, name: t.name, slug: t.slug, hint: t.dimension })),
    },
  }
}

const CREDIT_FIELDS = new Set(['title', 'slug', 'license', 'commissioner', 'creditsText', 'sourceUrl', 'artistIds', 'commissionerIds'])

function sameIds(a: number[], b: number[]) {
  const x = [...new Set(a)].sort((m, n) => m - n)
  const y = [...new Set(b)].sort((m, n) => m - n)
  return x.length === y.length && x.every((v, i) => v === y[i])
}

export interface PackUpdateResult {
  updatedAt: string
  slug: string
  changed: string[]
  notes: string[]
}

/** Save the editor form. Official packs never become downloadable; a slug change writes a 301. */
export async function updatePack(
  actor: Actor,
  input: { id: number; expectedUpdatedAt?: string; patch: PackPatch },
  deps: MediaDeps,
): Promise<PackUpdateResult> {
  const { packs, packCharacters, packArtists, packTags, emojis } = schema
  const notes: string[] = []
  const result = await db().transaction(async (tx) => {
    const [p] = await tx.select().from(packs).where(eq(packs.id, input.id)).for('update')
    if (!p) throw notFound('这个表情包')
    if (input.expectedUpdatedAt && p.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt).toISOString()) {
      throw conflict('这个表情包刚被别人改过，请刷新后再改')
    }
    const patch = { ...input.patch }
    const diff: Record<string, [unknown, unknown]> = {}
    const set: Partial<typeof packs.$inferInsert> = {}

    const sourceKind = patch.sourceKind ?? p.sourceKind
    if (sourceKind === 'official') {
      if (patch.downloadable === true) notes.push('官方表情固定只提供预览，「允许下载」保持关闭')
      if (patch.downloadable === true || p.downloadable) patch.downloadable = false
    }
    if (patch.license !== undefined && !LICENSE_LABELS[patch.license]) throw badRequest('未知的许可协议')

    const scalar = ['title', 'excerpt', 'descriptionMd', 'status', 'sourceKind', 'license', 'downloadable', 'pinLevel', 'memorial', 'commissioner', 'creditsText', 'sourceUrl', 'coverEmojiId'] as const
    for (const k of scalar) {
      const v = patch[k]
      if (v === undefined || v === p[k]) continue
      diff[k] = [p[k], v]
      ;(set as Record<string, unknown>)[k] = v
    }

    if (patch.slug !== undefined && patch.slug !== p.slug) {
      const [taken] = await tx.select({ id: packs.id }).from(packs).where(and(eq(packs.slug, patch.slug), ne(packs.id, p.id)))
      if (taken) throw conflict(`slug「${patch.slug}」已被其他表情包使用`)
      diff.slug = [p.slug, patch.slug]
      set.slug = patch.slug
      await moveRedirect(`/packs/${p.slug}`, `/packs/${patch.slug}`, tx)
    }

    if (set.coverEmojiId) {
      const [cover] = await tx.select({ id: emojis.id, status: emojis.status }).from(emojis).where(and(eq(emojis.id, set.coverEmojiId), eq(emojis.packId, p.id)))
      if (!cover) throw badRequest('封面必须是这个包里的表情')
      if (cover.status !== 'published') throw badRequest('封面必须是已发布的表情')
    }
    if (set.status === 'published' && !p.publishedAt) set.publishedAt = new Date()

    const rel = async <T extends { id: number }>(
      key: 'characterIds' | 'artistIds' | 'commissionerIds' | 'tagIds',
      current: number[],
      replace: (ids: number[]) => Promise<T[] | void>,
    ) => {
      const next = patch[key]
      if (next === undefined || sameIds(current, next)) return
      diff[key] = [current, [...new Set(next)]]
      await replace([...new Set(next)])
    }
    const curChars = (await tx.select({ id: packCharacters.characterId }).from(packCharacters).where(eq(packCharacters.packId, p.id))).map((r) => r.id)
    const curArts = await tx.select({ id: packArtists.artistId, role: packArtists.role }).from(packArtists).where(eq(packArtists.packId, p.id))
    const curTags = (await tx.select({ id: packTags.tagId }).from(packTags).where(eq(packTags.packId, p.id))).map((r) => r.id)
    try {
      await rel('characterIds', curChars, async (ids) => {
        await tx.delete(packCharacters).where(eq(packCharacters.packId, p.id))
        if (ids.length) await tx.insert(packCharacters).values(ids.map((characterId) => ({ packId: p.id, characterId })))
      })
      for (const role of ['artist', 'commissioner'] as const) {
        await rel(role === 'artist' ? 'artistIds' : 'commissionerIds', curArts.filter((a) => a.role === role).map((a) => a.id), async (ids) => {
          await tx.delete(packArtists).where(and(eq(packArtists.packId, p.id), eq(packArtists.role, role)))
          if (ids.length) await tx.insert(packArtists).values(ids.map((artistId) => ({ packId: p.id, artistId, role })))
        })
      }
      await rel('tagIds', curTags, async (ids) => {
        await tx.delete(packTags).where(eq(packTags.packId, p.id))
        if (ids.length) await tx.insert(packTags).values(ids.map((tagId) => ({ packId: p.id, tagId })))
      })
    } catch (err) {
      if ((err as { code?: string }).code === '23503' || (err as { cause?: { code?: string } }).cause?.code === '23503') {
        throw badRequest('选择的角色、画师或标签已被删除，请刷新后再选')
      }
      throw err
    }

    const changed = Object.keys(diff)
    let updatedAt = p.updatedAt
    if (changed.length) {
      // drizzle's $onUpdate bumps updated_at: the edit-submission base version moves with every save
      const [u] = await tx
        .update(packs)
        .set({ ...set, updatedAt: new Date() })
        .where(eq(packs.id, p.id))
        .returning({ updatedAt: packs.updatedAt })
      updatedAt = u!.updatedAt
      await audit(actor, 'pack.update', { type: 'pack', id: p.id }, diff, tx)
    }
    return { changed, updatedAt, slug: set.slug ?? p.slug, packId: p.id }
  })

  if (result.changed.length) {
    await refreshCounts()
    const credits = result.changed.some((k) => CREDIT_FIELDS.has(k))
    const content = result.changed.some((k) => k === 'status' || k === 'downloadable' || k === 'sourceKind')
    if (credits || content) await refreshZip([result.packId], credits ? 'credits' : 'content', deps)
  }
  return { updatedAt: result.updatedAt.toISOString(), slug: result.slug, changed: result.changed, notes }
}

/** 发布 / 隐藏 / 转为草稿 for several packs at once; one audit row per pack. */
export async function setPacksStatus(actor: Actor, input: { ids: number[]; status: PackStatus }, deps: MediaDeps) {
  const { packs } = schema
  const changed = await db().transaction(async (tx) => {
    const rows = await tx.select({ id: packs.id, status: packs.status, publishedAt: packs.publishedAt }).from(packs).where(inArray(packs.id, input.ids)).for('update')
    const out: number[] = []
    for (const r of rows) {
      if (r.status === input.status) continue
      await tx
        .update(packs)
        .set({ status: input.status, ...(input.status === 'published' && !r.publishedAt ? { publishedAt: new Date() } : {}) })
        .where(eq(packs.id, r.id))
      await audit(actor, 'pack.status', { type: 'pack', id: r.id }, { status: [r.status, input.status] }, tx)
      out.push(r.id)
    }
    return out
  })
  if (changed.length) {
    await refreshCounts()
    await refreshZip(changed, 'content', deps)
  }
  return { changed: changed.length }
}

export async function rebuildPackZip(actor: Actor, id: number, deps: MediaDeps) {
  const ed = await getPackEditor(id)
  if (!ed.zip.eligible) throw badRequest('只有已发布、允许下载且有已发布表情的包才会生成 ZIP')
  await refreshZip([id], 'credits', deps)
  await audit(actor, 'pack.zip.rebuild', { type: 'pack', id })
  return { queued: true }
}

export interface DeletePackResult {
  mode: 'hidden' | 'deleted'
  deletedObjects: number
  purged: number
  purgeSkipped: boolean
  purgeError: string | null
}

/**
 * 删除表情包. By default a soft delete (status hidden, files kept). `hard` is 站长-only: every emoji's
 * files (original, all derived revisions, review previews) and the pack's ZIPs are deleted, the row
 * goes (cascading to emojis, links and submissions), and the /img URLs are purged from the CDN.
 * Files are deleted per emoji, never by prefix: emojis moved out of this pack still live under its
 * storage key, and assets/v1/packs/<packKey>/pack.json is the read-only v1 snapshot.
 */
export async function deletePack(actor: Actor, input: { id: number; hard: boolean }, deps: MediaDeps): Promise<DeletePackResult> {
  const { packs, emojis, zipArtifacts } = schema
  const [p] = await db().select().from(packs).where(eq(packs.id, input.id))
  if (!p) throw notFound('这个表情包')
  if (!input.hard) {
    if (p.status !== 'hidden') {
      await db().update(packs).set({ status: 'hidden' }).where(eq(packs.id, p.id))
      await audit(actor, 'pack.hide', { type: 'pack', id: p.id }, { status: [p.status, 'hidden'] })
      await refreshCounts()
    }
    return { mode: 'hidden', deletedObjects: 0, purged: 0, purgeSkipped: false, purgeError: null }
  }
  assertOwner(actor)

  const rows = await db()
    .select({ id: emojis.id, storagePackKey: emojis.storagePackKey, originalKey: emojis.originalKey, variantRev: emojis.variantRev })
    .from(emojis)
    .where(eq(emojis.packId, p.id))
  const urls: string[] = []
  let deletedObjects = 0
  for (const e of rows) {
    const r = await deleteEmojiFiles(e)
    urls.push(...r.imgUrls)
    deletedObjects += r.deletedKeys.length
  }
  const zips = [
    ...(await db().select({ key: zipArtifacts.objectKey }).from(zipArtifacts).where(eq(zipArtifacts.packId, p.id))).map((z) => z.key),
    ...(await listKeys(`zips/v1/packs/${p.packKey}/`)),
  ]
  if (zips.length) await deleteObjects([...new Set(zips)])
  deletedObjects += new Set(zips).size

  await db().transaction(async (tx) => {
    await tx.delete(packs).where(eq(packs.id, p.id))
    await audit(
      actor,
      'pack.delete',
      { type: 'pack', id: p.id },
      { title: p.title, slug: p.slug, packKey: p.packKey, emojis: rows.map((r) => r.id), deletedObjects },
      tx,
    )
  })
  await refreshCounts()

  let purged = 0
  let purgeSkipped = false
  let purgeError: string | null = null
  try {
    const r = await deps.purge(urls)
    purged = r.purged
    purgeSkipped = r.skipped
  } catch (err) {
    purgeError = (err as Error).message
  }
  await audit(actor, 'pack.delete.purge', { type: 'pack', id: p.id }, { urls: urls.length, purged, skipped: purgeSkipped, error: purgeError })
  return { mode: 'deleted', deletedObjects, purged, purgeSkipped, purgeError }
}

