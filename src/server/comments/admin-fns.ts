import { createServerFn } from '@tanstack/react-start'
import { requirePerm } from '../perm/fn'
import { banCommenter, commentQueue, commentSettingsPatch, moderateComments, readCommentSettings, saveCommentSettings, setBadge, setPinned } from './admin'
import { guard } from './guard'
import { badgeInput, banInput, moderateInput, pinInput, queueInput } from './inputs'

// 评论审核 server functions: requirePerm('comments') (站长 and 管理员). The service functions check the
// permission again and write audit rows.

/** One queue tab (50 per page) with the counts of every tab. */
export const commentQueueFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('comments')])
  .validator(queueInput)
  .handler(({ data, context }) => guard(() => commentQueue(context.viewer, data)))

/** approve / spam / delete / restore, for one or many (≤ 100) comments. */
export const moderateCommentsFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('comments')])
  .validator(moderateInput)
  .handler(({ data, context }) => guard(() => moderateComments(context.viewer, data)))

export const pinCommentFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('comments')])
  .validator(pinInput)
  .handler(({ data, context }) => guard(() => setPinned(context.viewer, data)))

/** Set or clear the badge (站长 / 管理员 / 画师) shown on a comment. */
export const badgeCommentFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('comments')])
  .validator(badgeInput)
  .handler(({ data, context }) => guard(() => setBadge(context.viewer, data)))

/** 审核规则: toggles, edit window, report threshold, 屏蔽词, 回应贴纸, and the 禁止评论 list. */
export const commentSettingsFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('comments')])
  .handler(({ context }) => guard(() => readCommentSettings(context.viewer)))

export const saveCommentSettingsFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('comments')])
  .validator(commentSettingsPatch)
  .handler(({ data, context }) => guard(() => saveCommentSettings(context.viewer, data)))

/** 禁止评论 / 解除 for one account. */
export const banCommenterFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('comments')])
  .validator(banInput)
  .handler(({ data, context }) => guard(() => banCommenter(context.viewer, data)))
