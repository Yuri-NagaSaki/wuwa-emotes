import { type SQL, sql } from 'drizzle-orm'

// Which stickers belong to which character: the one place that decides it. 角色图鉴, the character
// page (counts, 「全部表情」, 随机来一张, its packs tab and artists), /packs?character=, the home strip,
// search and the facets all go through here, so 张 and 包 agree everywhere.
//
// v1 tagged stickers with characters (emoji_characters), but in packs with several characters it put
// the same list on every sticker (all-characters-pipa: 31 stickers × 24 characters; frolova-…-gift:
// 159 stickers × {漂泊者, 弗洛洛}). Such tags say nothing about who is on which sticker. So:
//   1. A sticker's own tags attribute it, unless its pack's tags are a copy: at least two stickers of
//      the pack are tagged, and all of them carry the same set of two or more characters.
//   2. A sticker without usable tags, in a pack with exactly one character (pack_characters), belongs
//      to that character.
//   3. Otherwise (a multi-character pack without per-sticker tags) the sticker is not attributed.
// A sticker can belong to several characters (rule 1 with a set that varies inside the pack).
//
//   张 = public stickers attributed to the character
//   包 = public packs holding at least one of them
// A character is listed only when 张 > 0. The rules ignore visibility; callers filter for public
// emojis (sql.ts).

/** Packs whose sticker tags are a copy of one character list (rule 1). */
const COPIED_PACKS =
  `select ce.pack_id from (select cx.emoji_id, array_agg(cx.character_id order by cx.character_id) as s ` +
  `from emoji_characters cx group by cx.emoji_id) ct join emojis ce on ce.id = ct.emoji_id ` +
  `group by ce.pack_id having count(*) >= 2 and count(distinct ct.s) = 1 and min(cardinality(ct.s)) >= 2`

/** Packs with exactly one character, and that character (rule 2). */
const SOLO_PACKS = `select pack_id, min(character_id) as character_id from pack_characters group by pack_id having count(*) = 1`

/** Rule 2's condition for emoji alias `e`: its tags are a copy, or it has none. */
function untaggedText(e: string): string {
  return `(${e}.pack_id in (select pack_id from copied) or not exists (select 1 from emoji_characters ux where ux.emoji_id = ${e}.id))`
}

/**
 * Every attribution as a derived table `(emoji_id, character_id)`, unique per pair, for all emojis
 * whatever their status. Use as `(${attributionTable()}) alias`.
 */
export function attributionTable(): SQL {
  return sql.raw(
    `with copied as (${COPIED_PACKS}), solo as (${SOLO_PACKS}) ` +
      `select ax.emoji_id, ax.character_id from emoji_characters ax join emojis ae on ae.id = ax.emoji_id ` +
      `where ae.pack_id not in (select pack_id from copied) ` +
      `union all ` +
      `select ae.id, sp.character_id from emojis ae join solo sp on sp.pack_id = ae.pack_id where ${untaggedText('ae')}`,
  )
}

/** Ids of the emojis attributed to the character with this slug (any status): `e.id in (${…})`. */
export function attributedEmojiIds(slug: string): SQL {
  return sql`with copied as (${sql.raw(COPIED_PACKS)}), solo as (${sql.raw(SOLO_PACKS)})
    select ax.emoji_id from emoji_characters ax
      join characters ac on ac.id = ax.character_id and ac.slug = ${slug}
      join emojis ae on ae.id = ax.emoji_id
    where ae.pack_id not in (select pack_id from copied)
    union all
    select ae.id from emojis ae
      join solo sp on sp.pack_id = ae.pack_id
      join characters ac on ac.id = sp.character_id and ac.slug = ${slug}
    where ${sql.raw(untaggedText('ae'))}`
}
