import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { EMOJI_ID_RE } from '#/shared/ids'
import { requirePerm, requireUser } from '../perm/fn'
import { LICENSE_CODES, TEXT_LIMITS, UPLOAD_LIMITS } from './rules'

// Server functions for 投稿 (/submit, /me/submissions) and 投稿审核 (/admin/review). Thin wrappers:
// validation here, rules and permission checks in service.ts (imported inside the handlers so the
// browser bundle only gets the RPC stubs). Approve, return and the queue need the 'review' permission.

const id = z.uuid()
const emojiId = z.string().regex(EMOJI_ID_RE)

const payload = z
  .object({
    title: z.string().max(200).optional(),
    excerpt: z.string().max(1000).nullable().optional(),
    descriptionMd: z.string().max(10_000).nullable().optional(),
    characterIds: z.array(z.number().int().positive()).max(50).optional(),
    artistIds: z.array(z.number().int().positive()).max(50).optional(),
    artistNames: z.array(z.string().max(100)).max(20).optional(),
    commissioner: z.string().max(200).nullable().optional(),
    coverEmojiId: emojiId.nullable().optional(),
    removeEmojiIds: z.array(emojiId).max(500).optional(),
    official: z.boolean().optional(),
  })
  .strict()

const declaration = z.object({
  identity: z.enum(['artist', 'commissioner', 'granted', 'curator']),
  license: z.enum(LICENSE_CODES),
  proofUrl: z
    .union([z.literal(''), z.url({ protocol: /^https?$/ }).max(TEXT_LIMITS.proofUrl)])
    .nullable()
    .optional(),
  note: z.string().max(TEXT_LIMITS.note * 2).nullable().optional(),
  downloadable: z.boolean(),
})

export const createSubmissionFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      kind: z.enum(['new_pack', 'add_emojis', 'edit_pack']),
      packSlug: z.string().max(120).optional(),
      payload: payload.optional(),
      declaration: declaration.nullable().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { createSubmission } = await import('./service')
    return createSubmission(context.viewer, data)
  })

export const updateSubmissionFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ id, payload: payload.optional(), declaration: declaration.nullable().optional() }))
  .handler(async ({ data, context }) => {
    const { updateSubmission } = await import('./service')
    return updateSubmission(context.viewer, data.id, { payload: data.payload, declaration: data.declaration })
  })

export const getSubmissionFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ id }))
  .handler(async ({ data, context }) => {
    const { getSubmission } = await import('./service')
    return getSubmission(context.viewer, data.id)
  })

export const listMySubmissionsFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const { listMySubmissions } = await import('./service')
    return listMySubmissions(context.viewer)
  })

export const presignUploadsFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(
    z.object({
      id,
      files: z
        .array(z.object({ name: z.string().min(1).max(300), size: z.number().int().nonnegative(), type: z.string().max(100) }))
        .min(1)
        .max(UPLOAD_LIMITS.maxPerRequest),
    }),
  )
  .handler(async ({ data, context }) => {
    const { presignUploads } = await import('./service')
    return presignUploads(context.viewer, data.id, data.files)
  })

export const completeUploadsFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ id, uploadIds: z.array(z.uuid()).min(1).max(UPLOAD_LIMITS.maxPerRequest) }))
  .handler(async ({ data, context }) => {
    const { completeUploads } = await import('./service')
    return completeUploads(context.viewer, data.id, data.uploadIds)
  })

export const listUploadsFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ id }))
  .handler(async ({ data, context }) => {
    const { listUploads } = await import('./service')
    return listUploads(context.viewer, data.id)
  })

export const removeUploadFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ id, uploadId: z.uuid() }))
  .handler(async ({ data, context }) => {
    const { removeUpload } = await import('./service')
    await removeUpload(context.viewer, data.id, data.uploadId)
    return { ok: true as const }
  })

export const reorderEmojisFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ id, emojiIds: z.array(emojiId).max(UPLOAD_LIMITS.maxFiles) }))
  .handler(async ({ data, context }) => {
    const { reorderEmojis } = await import('./service')
    return reorderEmojis(context.viewer, data.id, data.emojiIds)
  })

export const submitSubmissionFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ id }))
  .handler(async ({ data, context }) => {
    const { submitSubmission } = await import('./service')
    return submitSubmission(context.viewer, data.id)
  })

export const withdrawSubmissionFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(z.object({ id }))
  .handler(async ({ data, context }) => {
    const { withdrawSubmission } = await import('./service')
    await withdrawSubmission(context.viewer, data.id)
    return { ok: true as const }
  })

/** Form pickers: characters and structured artists; for add/edit, the target pack. */
export const getSubmitContextFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(z.object({ packSlug: z.string().max(120).optional() }))
  .handler(async ({ data, context }) => {
    const { submitContext } = await import('./context')
    return submitContext(context.viewer, data.packSlug)
  })

// ---------- 投稿审核 (perm 'review') ----------

export const listReviewQueueFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('review')])
  .validator(z.object({ tab: z.enum(['pending', 'approved', 'returned']), page: z.number().int().min(0).max(10_000).default(0) }))
  .handler(async ({ data, context }) => {
    const { listReviewQueue } = await import('./service')
    return listReviewQueue(context.viewer, data.tab, data.page)
  })

export const approveSubmissionFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('review')])
  .validator(z.object({ id, downloadable: z.boolean(), note: z.string().max(TEXT_LIMITS.reason).nullable().optional() }))
  .handler(async ({ data, context }) => {
    const { approveSubmission } = await import('./service')
    return approveSubmission(context.viewer, data.id, { downloadable: data.downloadable, note: data.note })
  })

export const returnSubmissionFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('review')])
  .validator(z.object({ id, reason: z.string().min(1).max(TEXT_LIMITS.reason) }))
  .handler(async ({ data, context }) => {
    const { returnSubmission } = await import('./service')
    await returnSubmission(context.viewer, data.id, data.reason)
    return { ok: true as const }
  })
