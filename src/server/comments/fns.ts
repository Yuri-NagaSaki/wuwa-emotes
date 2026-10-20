import { createServerFn } from '@tanstack/react-start'
import { publicFn, requireUser } from '../perm/fn'
import { guard, requestCtx } from './guard'
import { createInput, editInput, idInput, listRepliesInput, listThreadInput, myCommentsInput, previewInput, reactInput, reportInput, stickerSourceInput } from './inputs'
import { formToken, listReplies, listThread, myComments, preview, stickerSource } from './read'
import { createComment, deleteOwnComment, editComment, reportComment, toggleReaction } from './write'

// Public comment server functions. Thin wrappers: the logic lives in read.ts / write.ts (what the
// tests call). Guests may read, preview and post (Cap token in the x-cap-token header); reactions,
// reports, edits and deletes need an account.

/** One page of roots with their first replies, plus viewer state, config and a form token. */
export const listCommentsFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(listThreadInput)
  .handler(({ data, context }) => guard(() => listThread(requestCtx(context.viewer), data)))

/** More replies of one root (楼中楼), oldest first. */
export const listRepliesFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(listRepliesInput)
  .handler(({ data, context }) => guard(() => listReplies(requestCtx(context.viewer), data)))

/** A fresh signed form timestamp (the one from listCommentsFn expires after a day). */
export const commentFormTokenFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .handler(() => formToken())

/** Post a comment or a reply. Guests send a Cap token in the x-cap-token header. */
export const createCommentFn = createServerFn({ method: 'POST' })
  .middleware([publicFn])
  .validator(createInput)
  .handler(({ data, context }) => guard(() => createComment(requestCtx(context.viewer), data)))

/** Render a draft with the same pipeline as stored comments. */
export const previewCommentFn = createServerFn({ method: 'POST' })
  .middleware([publicFn])
  .validator(previewInput)
  .handler(({ data, context }) => guard(() => preview(requestCtx(context.viewer), data)))

/** Stickers for the picker: a pack (本包 / a search hit), a character, or re-validated recent ids. */
export const stickerSourceFn = createServerFn({ method: 'GET' })
  .middleware([publicFn])
  .validator(stickerSourceInput)
  .handler(({ data }) => guard(() => stickerSource(data)))

export const editCommentFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(editInput)
  .handler(({ data, context }) => guard(() => editComment(requestCtx(context.viewer), data)))

/** The author's own delete (tombstone). Moderators delete through moderateCommentsFn. */
export const deleteCommentFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(idInput)
  .handler(({ data, context }) => guard(() => deleteOwnComment(requestCtx(context.viewer), data)))

export const reactCommentFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(reactInput)
  .handler(({ data, context }) => guard(() => toggleReaction(requestCtx(context.viewer), data)))

export const reportCommentFn = createServerFn({ method: 'POST' })
  .middleware([requireUser])
  .validator(reportInput)
  .handler(({ data, context }) => guard(() => reportComment(requestCtx(context.viewer), data)))

/** 我的评论 (the /me page). */
export const myCommentsFn = createServerFn({ method: 'GET' })
  .middleware([requireUser])
  .validator(myCommentsInput)
  .handler(({ data, context }) => guard(() => myComments(context.viewer, data)))
