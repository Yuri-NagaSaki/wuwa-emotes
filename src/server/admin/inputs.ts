import { z } from 'zod'

// Input schemas of the admin server functions. Pure (zod only), so forms may import the constants.

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/
export const EMOJI_ID = z.string().regex(/^r-[0-9a-f]{20}$/, '表情 ID 格式不对')
export const PALETTE = ['pink', 'purple', 'blue', 'yellow', 'orange', 'mint', 'green', 'red', 'lime', 'yg', 'brown', 'peach', 'teal'] as const
export const THEME_COLOR_RE = /^(?:var\(--c-(?:pink|purple|blue|yellow|orange|mint|green|red|lime|yg|brown|peach|teal)\)|#[0-9a-f]{6})$/i

const id = z.number().int().positive()
const slug = z.string().trim().toLowerCase().regex(SLUG_RE, 'slug 只能用小写字母、数字和连字符，不能以连字符开头或结尾')
const optText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => (v == null || v.trim() === '' ? null : v))

export const packStatus = z.enum(['draft', 'published', 'hidden'])
export const page = z.number().int().min(1).max(10_000).optional()

export const packListInput = z.object({
  q: z.string().trim().max(100).optional(),
  status: packStatus.optional(),
  kind: z.enum(['animated', 'static', 'mixed']).optional(),
  source: z.enum(['community', 'official']).optional(),
  sort: z.enum(['updated', 'created', 'title', 'downloads']).optional(),
  page,
})
export type PackListInput = z.infer<typeof packListInput>

export const packIdInput = z.object({ id })
export const packBulkStatusInput = z.object({ ids: z.array(id).min(1).max(200), status: packStatus })
export const packCreateInput = z.object({ title: z.string().trim().min(1, '请填写标题').max(80) })

export const packUpdateInput = z.object({
  id,
  /** packs.updated_at the form was loaded with; a newer row means someone else saved first */
  expectedUpdatedAt: z.string().optional(),
  patch: z
    .object({
      title: z.string().trim().min(1, '标题不能为空').max(80),
      slug,
      excerpt: optText(300),
      descriptionMd: optText(20_000),
      status: packStatus,
      sourceKind: z.enum(['community', 'official']),
      license: z.string().trim().min(1).max(60),
      downloadable: z.boolean(),
      pinLevel: z.number().int().min(0).max(3),
      memorial: z.boolean(),
      commissioner: optText(200),
      creditsText: optText(4000),
      sourceUrl: z
        .string()
        .trim()
        .max(500)
        .nullable()
        .transform((v) => (v ? v : null))
        .refine((v) => v == null || /^https?:\/\//i.test(v), '来源链接需以 http:// 或 https:// 开头'),
      coverEmojiId: EMOJI_ID.nullable(),
      characterIds: z.array(id).max(50),
      artistIds: z.array(id).max(30),
      commissionerIds: z.array(id).max(30),
      tagIds: z.array(id).max(50),
    })
    .partial(),
})
export type PackPatch = z.infer<typeof packUpdateInput>['patch']

export const packDeleteInput = z.object({ id, hard: z.boolean().default(false), confirmKey: z.string().optional() })
export const reorderInput = z.object({ packId: id, emojiIds: z.array(EMOJI_ID).min(1).max(5000) })
export const emojiIdsInput = z.object({ ids: z.array(EMOJI_ID).min(1).max(500) })
export const emojiStatusInput = z.object({ ids: z.array(EMOJI_ID).min(1).max(500), status: z.enum(['published', 'hidden']) })
export const regenerateInput = z.object({ ids: z.array(EMOJI_ID).min(1).max(5000).optional(), packId: id.optional() })
export const moveInput = z.object({ ids: z.array(EMOJI_ID).min(1).max(500), toPackId: id })

export const emojiListInput = z.object({
  q: z.string().trim().max(100).optional(),
  packId: id.optional(),
  status: z.enum(['pending', 'published', 'hidden']).optional(),
  format: z.enum(['gif', 'png', 'webp', 'jpeg']).optional(),
  derived: z.enum(['ready', 'missing']).optional(),
  page,
})
export type EmojiListInput = z.infer<typeof emojiListInput>
export const emojiDetailInput = z.object({ id: EMOJI_ID })

export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024
export const UPLOAD_TYPES = ['image/gif', 'image/png', 'image/webp', 'image/jpeg'] as const
export const signUploadsInput = z.object({
  packId: id,
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        size: z.number().int().positive(),
        type: z.string().max(100),
      }),
    )
    .min(1)
    .max(100),
})
export const uploadIdsInput = z.object({ ids: z.array(z.uuid()).min(1).max(200) })

export const taxonomyKind = z.enum(['character', 'artist', 'tag'])
export type TaxonomyKind = z.infer<typeof taxonomyKind>
export const tagDimension = z.enum(['group', 'tool', 'project', 'origin', 'custom'])
const alias = z.string().trim().min(1).max(40)

export const characterSaveInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, '请填写名称').max(40),
  slug: slug.optional(),
  themeColor: z.string().regex(THEME_COLOR_RE, '主题色只能从色板里选').nullable().optional(),
  avatarEmojiId: EMOJI_ID.nullable().optional(),
  aliases: z.array(alias).max(30).optional(),
  sort: z.number().int().min(-1000).max(100_000).optional(),
})
export const artistSaveInput = z.object({
  id: id.optional(),
  name: z.string().trim().min(1, '请填写名称').max(60),
  slug: slug.optional(),
  aliases: z.array(alias).max(30).optional(),
  links: z
    .array(z.object({ label: z.string().trim().min(1).max(30), url: z.string().trim().regex(/^https?:\/\//i, '链接需以 http(s):// 开头').max(500) }))
    .max(10)
    .optional(),
})
export const tagSaveInput = z.object({
  id: id.optional(),
  dimension: tagDimension,
  name: z.string().trim().min(1, '请填写名称').max(40),
  slug: slug.optional(),
})
export const taxonomyDeleteInput = z.object({ kind: taxonomyKind, id })
export const mergeInput = z.object({ kind: taxonomyKind, fromId: id, toId: id, keepName: z.boolean().default(true) })
export const taxonomyListInput = z.object({ q: z.string().trim().max(60).optional() })

export const userListInput = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(['admin', 'manager', 'user']).optional(),
  submitMode: z.enum(['review', 'trusted', 'blocked']).optional(),
  banned: z.boolean().optional(),
  page,
})
export const setRoleInput = z.object({ userId: z.string().min(1).max(100), role: z.enum(['admin', 'manager', 'user']) })
export const submitModeInput = z.object({ userId: z.string().min(1).max(100), mode: z.enum(['review', 'trusted', 'blocked']) })
export const banInput = z.object({
  userId: z.string().min(1).max(100),
  reason: z.string().trim().max(200).optional(),
  days: z.number().int().min(1).max(3650).optional(),
})
export const userIdInput = z.object({ userId: z.string().min(1).max(100) })

export const jobActionInput = z.object({ name: z.string().min(1).max(100), id: z.uuid() })

export const auditListInput = z.object({
  actor: z.string().trim().max(100).optional(),
  action: z.string().trim().max(60).optional(),
  targetType: z.string().trim().max(40).optional(),
  targetId: z.string().trim().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page,
})
export type AuditListInput = z.infer<typeof auditListInput>

export const siteSettingsInput = z.object({
  name: z.string().trim().max(20).nullable(),
  subtitle: z.string().trim().max(40).nullable(),
  announcement: z.string().trim().max(200).nullable(),
})
