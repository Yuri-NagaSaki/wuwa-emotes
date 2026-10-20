import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { EMOJI_ID_RE } from '#/shared/ids'
import { REACTION_KEYS, type ReactionKey } from './comments/constants'
import { db, schema } from './db/client'
import { env } from './env'

// Runtime settings edited in 系统设置 / 下载与风控. Values are validated on read; a blank limit means
// "no limit". Cached briefly per process so hot paths (download signing) don't hit the table each time.

const limit = z.number().int().positive().nullable().default(null)

export const settingSchemas = {
  site: z
    .object({
      name: z.string().min(1).max(20).nullable().default(null),
      subtitle: z.string().max(40).nullable().default(null),
      announcement: z.string().max(200).nullable().default(null),
    })
    .default({ name: null, subtitle: null, announcement: null }),
  downloads: z
    .object({
      perIpOriginalsPerDay: limit,
      perUserOriginalsPerDay: limit,
      perIpPacksPerDay: limit,
      maxBatchItems: limit,
      singleSignsPerMinute: z.number().int().positive().nullable().default(60),
      batchItemsPerMinute: limit,
      challengeSuspicious: z.boolean().default(true),
      originalsRequireLogin: z.boolean().default(false),
      pauseZipAndBatch: z.boolean().default(false),
      r2ReadAlertMonthly: z.number().int().positive().nullable().default(9_000_000),
    })
    .default({
      perIpOriginalsPerDay: null,
      perUserOriginalsPerDay: null,
      perIpPacksPerDay: null,
      maxBatchItems: null,
      singleSignsPerMinute: 60,
      batchItemsPerMinute: null,
      challengeSuspicious: true,
      originalsRequireLogin: false,
      pauseZipAndBatch: false,
      r2ReadAlertMonthly: 9_000_000,
    }),
  // 评论审核 › 审核规则 (src/server/comments/admin.ts). Editable with the `comments` permission.
  comments: z
    .object({
      guestsAllowed: z.boolean().default(true),
      stickersAllowed: z.boolean().default(true),
      /** hold an author's first comment for review */
      firstCommentReview: z.boolean().default(true),
      editWindowMinutes: z.number().int().min(0).max(1440).default(10),
      /** case-insensitive substrings; `*` matches anything */
      blocklist: z.array(z.string().trim().min(1).max(40)).max(500).default([]),
      /** 禁止评论 (comment ban only; full account bans stay with Better Auth) */
      bannedUserIds: z.array(z.string().min(1).max(64)).max(5000).default([]),
      /** open reports that move a published comment back to pending */
      reportThreshold: z.number().int().min(1).max(100).default(3),
      /** 回应贴纸: emoji id per reaction key, null = text label */
      reactionStickers: z.object(reactionStickerShape()).default(reactionStickerDefaults()),
    })
    .default({
      guestsAllowed: true,
      stickersAllowed: true,
      firstCommentReview: true,
      editWindowMinutes: 10,
      blocklist: [],
      bannedUserIds: [],
      reportThreshold: 3,
      reactionStickers: reactionStickerDefaults(),
    }),
} as const

function reactionStickerShape() {
  const id = z.string().regex(EMOJI_ID_RE).nullable().default(null)
  return Object.fromEntries(REACTION_KEYS.map((k) => [k, id])) as Record<ReactionKey, typeof id>
}

function reactionStickerDefaults(): Record<ReactionKey, string | null> {
  return Object.fromEntries(REACTION_KEYS.map((k) => [k, null])) as Record<ReactionKey, string | null>
}

export type SettingKey = keyof typeof settingSchemas
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>

const TTL_MS = 10_000
const cache = new Map<SettingKey, { at: number; value: unknown }>()

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as SettingValue<K>
  const rows = await db().select().from(schema.siteSettings).where(eq(schema.siteSettings.key, key)).limit(1)
  const parsed = settingSchemas[key].safeParse(rows[0]?.value ?? undefined)
  const value = (parsed.success ? parsed.data : settingSchemas[key].parse(undefined)) as SettingValue<K>
  cache.set(key, { at: Date.now(), value })
  return value
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>, updatedBy: string | null) {
  const parsed = settingSchemas[key].parse(value)
  await db()
    .insert(schema.siteSettings)
    .values({ key, value: parsed, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.siteSettings.key, set: { value: parsed, updatedBy, updatedAt: new Date() } })
  cache.delete(key)
}

/** Site name: 系统设置 override first, then SITE_NAME from the environment (default 潮池). */
export async function siteIdentity(): Promise<{ name: string; subtitle: string }> {
  const s = await getSetting('site')
  return { name: s.name ?? env().SITE_NAME, subtitle: s.subtitle ?? env().SITE_SUBTITLE }
}
