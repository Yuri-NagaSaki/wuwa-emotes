import { asc, desc, eq } from 'drizzle-orm'
import { can } from '#/shared/roles'
import type { Viewer } from '../auth/session'
import { db, schema } from '../db/client'
import { imgUrl } from '../media/keys'

// Data for the 投稿 form: character and artist pickers, and the target pack for 补充 / 修改.

export interface SubmitContext {
  characters: { id: number; name: string; color: string | null }[]
  artists: { id: number; name: string }[]
  submitMode: 'review' | 'trusted' | 'blocked'
  pack: {
    slug: string
    title: string
    sourceKind: string
    emojiCount: number
    /** the pack's current 允许下载 (补充表情 keeps it; the reviewer decides) */
    downloadable: boolean
    cover: string | null
    /** may open an edit_pack submission */
    canEdit: boolean
  } | null
}

export async function submitContext(viewer: Pick<Viewer, 'id' | 'role'>, packSlug?: string): Promise<SubmitContext> {
  const d = db()
  const { characters, artists, packs, emojis, users } = schema
  const [chars, arts, me] = await Promise.all([
    d.select({ id: characters.id, name: characters.name, color: characters.themeColor }).from(characters).orderBy(desc(characters.packCount), asc(characters.sort), asc(characters.id)),
    d.select({ id: artists.id, name: artists.name }).from(artists).orderBy(desc(artists.packCount), asc(artists.id)).limit(500),
    d.select({ mode: users.submitMode, banned: users.banned }).from(users).where(eq(users.id, viewer.id)),
  ])
  let pack: SubmitContext['pack'] = null
  if (packSlug) {
    const [p] = await d.select().from(packs).where(eq(packs.slug, packSlug))
    if (p && p.status === 'published') {
      const [cover] = p.coverEmojiId
        ? await d
            .select({ id: emojis.id, packKey: emojis.storagePackKey, rev: emojis.variantRev, ready: emojis.derivedReady })
            .from(emojis)
            .where(eq(emojis.id, p.coverEmojiId))
        : []
      pack = {
        slug: p.slug,
        title: p.title,
        sourceKind: p.sourceKind,
        emojiCount: p.emojiCount,
        downloadable: p.downloadable,
        cover: cover?.ready ? imgUrl({ variant: 'p240', packKey: cover.packKey, emojiId: cover.id, rev: cover.rev }) : null,
        canEdit: p.ownerId === viewer.id || can(viewer.role, 'packs'),
      }
    }
  }
  const u = me[0]
  return { characters: chars, artists: arts, submitMode: !u || u.banned ? 'blocked' : u.mode, pack }
}
