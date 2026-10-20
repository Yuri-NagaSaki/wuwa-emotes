import { z } from 'zod'
import { EMOJI_ID_RE } from '#/shared/ids'
import { BADGES, GUEST_NAME_MAX, HONEYPOT_FIELD, MAX_BODY, REACTION_KEYS } from './constants'

// Input schemas for the comment server functions. zod only: safe to import from client code. The
// service functions parse again, so direct callers (tests) get the same limits.

export const PACK_THREAD_RE = /^[1-9][0-9]{0,9}$/

export const threadTypeSchema = z.enum(['pack', 'emoji'])

/** pack threads are keyed by the pack id (as text; slugs can be renamed), emoji threads by the emoji id. */
export const threadInput = z
  .object({ threadType: threadTypeSchema, threadId: z.string().min(1).max(40) })
  .refine((t) => (t.threadType === 'pack' ? PACK_THREAD_RE.test(t.threadId) : EMOJI_ID_RE.test(t.threadId)), {
    message: '评论区不存在',
    path: ['threadId'],
  })

const cursor = z.string().max(512).regex(/^[A-Za-z0-9_-]+$/)
export const commentId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const listThreadInput = z.object({
  threadType: threadTypeSchema,
  threadId: z.string().min(1).max(40),
  sort: z.enum(['hot', 'new', 'old']).default('hot'),
  cursor: cursor.optional(),
})
export type ListThreadInput = z.input<typeof listThreadInput>

export const listRepliesInput = z.object({ rootId: commentId, cursor: cursor.optional() })

const body = z.string().max(MAX_BODY, `评论最多 ${MAX_BODY} 字`)

export const createInput = z.object({
  threadType: threadTypeSchema,
  threadId: z.string().min(1).max(40),
  /** reply to this comment (a root or a reply; replies to replies stay under the root) */
  parentId: commentId.optional(),
  body,
  /** guests only */
  guestName: z.string().max(80, '昵称太长了').optional(),
  /** guests only, optional; only its salted hash is stored */
  guestEmail: z.union([z.literal(''), z.email('邮箱格式不对').max(254, '邮箱格式不对')], { error: '邮箱格式不对' }).optional(),
  formToken: z.string().max(200),
  [HONEYPOT_FIELD]: z.string().max(500).optional(),
})
export type CreateInput = z.input<typeof createInput>

export const editInput = z.object({ id: commentId, body })
export const idInput = z.object({ id: commentId })
export const reactInput = z.object({ id: commentId, key: z.enum(REACTION_KEYS) })
export const reportInput = z.object({ id: commentId, reason: z.string().trim().max(200).optional() })
export const previewInput = z.object({ body })

export const stickerSourceInput = z.union([
  z.object({ kind: z.literal('pack'), packId: z.number().int().positive().max(2_147_483_647) }),
  z.object({ kind: z.literal('pack'), slug: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.literal('character'), slug: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.literal('ids'), ids: z.array(z.string().regex(EMOJI_ID_RE)).max(60) }),
])
export type StickerSourceInput = z.input<typeof stickerSourceInput>

export const myCommentsInput = z.object({ cursor: cursor.optional() }).default({})

// ---- moderation ----

export const queueTabSchema = z.enum(['pending', 'reported', 'spam', 'published', 'deleted'])

export const queueInput = z.object({
  tab: queueTabSchema.default('pending'),
  cursor: cursor.optional(),
})

export const moderateInput = z.object({
  ids: z.array(commentId).min(1).max(100),
  action: z.enum(['approve', 'spam', 'delete', 'restore']),
})

export const pinInput = z.object({ id: commentId, pinned: z.boolean() })
export const badgeInput = z.object({ id: commentId, badge: z.enum(BADGES).nullable() })
export const banInput = z.object({ userId: z.string().min(1).max(64), banned: z.boolean() })

export const guestNameSchema = z
  .string()
  .transform((s) => s.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, '请填写昵称').max(GUEST_NAME_MAX, `昵称最多 ${GUEST_NAME_MAX} 字`))
