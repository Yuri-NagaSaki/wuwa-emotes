import { sql } from 'drizzle-orm'
import { characterEntries } from '../catalog/characters'
import { db } from '../db/client'
import { derivedKey, parseImgPath } from '../media/keys'
import { getObjectBytes } from '../media/s3'
import { type PaletteColor, paletteColorOf } from './colors'

// derive-colors: a theme colour for every character whose characters.theme_color is empty, from its
// portrait (import-portraits) or else its avatar sticker (the unique one 角色图鉴 shows), snapped to
// the design palette (colors.ts). A non-empty theme_color is never touched: admin edits win.

/** Set theme_color when it is still empty; true when this call wrote it. */
export async function setThemeColor(characterId: number, color: string): Promise<boolean> {
  const res = await db().execute(sql`
    update characters set theme_color = ${color}, updated_at = now()
    where id = ${characterId} and (theme_color is null or btrim(theme_color) = '')`)
  return (res.rowCount ?? 0) > 0
}

export interface ThemeColorResult {
  slug: string
  name: string
  source: 'portrait' | 'avatar' | null
  color: PaletteColor | null
  written: boolean
  note: string | null
}

export async function deriveThemeColors(opts: { dryRun?: boolean } = {}): Promise<ThemeColorResult[]> {
  const res = await db().execute<{ id: number; slug: string; name: string; portrait_key: string | null }>(sql`
    select id, slug, name, portrait_key from characters
    where theme_color is null or btrim(theme_color) = '' order by sort, id`)
  const avatars = new Map((await characterEntries()).map((e) => [e.id, e.card.avatar]))
  const out: ThemeColorResult[] = []
  for (const c of res.rows) {
    const id = Number(c.id)
    const avatar = avatars.get(id) ?? null
    const ref = avatar ? parseImgPath(avatar.poster) : null
    const key = c.portrait_key ?? (ref ? derivedKey(ref.variant, ref.packKey, ref.emojiId, ref.rev) : null)
    const source: ThemeColorResult['source'] = c.portrait_key ? 'portrait' : ref ? 'avatar' : null
    if (!key) {
      out.push({ slug: c.slug, name: c.name, source, color: null, written: false, note: 'no portrait and no avatar sticker' })
      continue
    }
    try {
      const color = await paletteColorOf(await getObjectBytes(key))
      const written = color && !opts.dryRun ? await setThemeColor(id, color.name) : false
      out.push({ slug: c.slug, name: c.name, source, color, written, note: color ? null : 'nothing opaque in the image' })
    } catch (err) {
      out.push({ slug: c.slug, name: c.name, source, color: null, written: false, note: `${key}: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
  return out
}

export function formatThemeColors(rows: ThemeColorResult[], dryRun: boolean): string {
  const lines = [`derive-colors${dryRun ? ' (dry run, nothing written)' : ''}: ${rows.length} character(s) without a theme colour`]
  for (const r of rows) {
    const c = r.color ? `${r.color.name.padEnd(6)} ${r.color.confidence ? `(${Math.round(r.color.confidence * 100)}% of the colour)` : '(muted art)'}` : '-'
    lines.push(`  ${r.written ? 'set ' : dryRun && r.color ? 'would' : 'skip'} ${r.slug.padEnd(22)} ${r.name.padEnd(8)} ${(r.source ?? '').padEnd(8)} ${c}${r.note ? `  ${r.note}` : ''}`)
  }
  lines.push(`  written ${rows.filter((r) => r.written).length}`)
  return lines.join('\n')
}
