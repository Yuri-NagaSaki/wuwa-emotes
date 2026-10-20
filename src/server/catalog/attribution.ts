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

/** Each tagged sticker's character set. */
const TAGSETS = `select cx.emoji_id, array_agg(cx.character_id order by cx.character_id) as s from emoji_characters cx group by cx.emoji_id`

/** Packs whose sticker tags are a copy of one character list (rule 1). Needs `tagsets`. */
const COPIED_PACKS =
  `select ce.pack_id from tagsets ct join emojis ce on ce.id = ct.emoji_id ` +
  `group by ce.pack_id having count(*) >= 2 and min(ct.s) = max(ct.s) and min(cardinality(ct.s)) >= 2`

/** Packs with exactly one character, and that character (rule 2). */
const SOLO_PACKS = `select pack_id, min(character_id) as character_id from pack_characters group by pack_id having count(*) = 1`

const WITH = `with tagsets as (${TAGSETS}), copied as (${COPIED_PACKS}), solo as (${SOLO_PACKS})`

/**
 * Every attribution as a derived table `(emoji_id, character_id, shared)`, unique per pair, for all
 * emojis whatever their status; `shared` is how many characters the sticker belongs to (1 = this
 * character alone). Use as `(${attributionTable()}) alias`.
 */
export function attributionTable(): SQL {
  return sql.raw(
    `${WITH} ` +
      // rule 1: own tags, outside copied packs (every tag of such a sticker counts)
      `select t.emoji_id, unnest(t.s) as character_id, cardinality(t.s) as shared ` +
      `from tagsets t join emojis ae on ae.id = t.emoji_id ` +
      `where ae.pack_id not in (select pack_id from copied) ` +
      `union all ` +
      // rule 2: untagged, or tags that are a copy, in a single-character pack (two disjoint branches;
      // `not in` over the tagged ids is one hashed lookup instead of an index probe per sticker)
      `select ae.id, sp.character_id, 1 from emojis ae join solo sp on sp.pack_id = ae.pack_id ` +
      `where ae.id not in (select emoji_id from tagsets) ` +
      `union all ` +
      `select ae.id, sp.character_id, 1 from emojis ae join solo sp on sp.pack_id = ae.pack_id ` +
      `where ae.pack_id in (select pack_id from copied)`,
  )
}

/**
 * Ids of the emojis attributed to the character with this slug (any status): `e.id in (${…})`.
 * The same rules as attributionTable(), evaluated only over the packs that can matter (those with a
 * sticker tagged with the character, and its single-character packs): a pack's tags are a copy or
 * not on their own, so this keeps per-request filters cheap.
 */
export function attributedEmojiIds(slug: string): SQL {
  return sql`with
    mine as (
      select ax.emoji_id, ae.pack_id from emoji_characters ax
        join characters ac on ac.id = ax.character_id and ac.slug = ${slug}
        join emojis ae on ae.id = ax.emoji_id
    ),
    solo as (
      select pc.pack_id from pack_characters pc join characters ac on ac.id = pc.character_id and ac.slug = ${slug}
      where not exists (select 1 from pack_characters po where po.pack_id = pc.pack_id and po.character_id <> pc.character_id)
    ),
    tagsets as (
      -- ids are ASCII: group them bytewise, not by the database's locale
      select cx.emoji_id collate "C" as emoji_id, array_agg(cx.character_id order by cx.character_id) as s
      from emoji_characters cx join emojis ce on ce.id = cx.emoji_id
      where ce.pack_id in (select pack_id from mine union select pack_id from solo)
      group by 1
    ),
    copied as (${sql.raw(COPIED_PACKS)})
    select emoji_id from mine where pack_id not in (select pack_id from copied)
    union all
    select ae.id from emojis ae
    where ae.pack_id in (select pack_id from solo)
      and (ae.id not in (select emoji_id from tagsets) or ae.pack_id in (select pack_id from copied))`
}
