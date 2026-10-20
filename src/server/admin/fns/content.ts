import { createServerFn } from '@tanstack/react-start'
import { requirePerm } from '../../perm/fn'
import { getDashboard } from '../dash'
import { deleteEmojis, getEmojiDetail, listEmojis, moveEmojis, publishPendingEmojis, regenerateEmojis, reorderEmojis, setEmojisStatus } from '../emojis'
import {
  emojiDetailInput,
  emojiIdsInput,
  emojiListInput,
  emojiStatusInput,
  moveInput,
  packBulkStatusInput,
  packCreateInput,
  packDeleteInput,
  packIdInput,
  packListInput,
  packUpdateInput,
  regenerateInput,
  reorderInput,
  signUploadsInput,
  uploadIdsInput,
} from '../inputs'
import { defaultMediaDeps } from '../maintain'
import { createPack, deletePack, getPackEditor, listPacks, rebuildPackZip, setPacksStatus, updatePack } from '../packs'
import { advanceUploads, completeUploads, signUploads } from '../upload'

// Server functions of 仪表盘, 表情包, 表情库 and 上传中心. Permissions per docs/ARCHITECTURE.md §5.1:
// dash / packs / upload are shared by 站长 and 管理员; hard-deleting a pack is 站长-only (checked in
// deletePack). Handlers stay one-liners; the logic lives in ../*.ts with explicit dependencies.

// ---------- 仪表盘 (dash) ----------

export const adminDashboardFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('dash')])
  .handler(({ context }) => getDashboard(context.viewer))

// ---------- 表情包 (packs) ----------

export const adminPacksFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('packs')])
  .validator(packListInput)
  .handler(({ data }) => listPacks(data))

export const adminPackEditorFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('packs')])
  .validator(packIdInput)
  .handler(({ data }) => getPackEditor(data.id))

export const adminCreatePackFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('packs')])
  .validator(packCreateInput)
  .handler(({ data, context }) => createPack(context.viewer, data))

export const adminUpdatePackFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('packs')])
  .validator(packUpdateInput)
  .handler(({ data, context }) => updatePack(context.viewer, data, defaultMediaDeps))

export const adminPacksStatusFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('packs')])
  .validator(packBulkStatusInput)
  .handler(({ data, context }) => setPacksStatus(context.viewer, data, defaultMediaDeps))

export const adminRebuildZipFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('packs')])
  .validator(packIdInput)
  .handler(({ data, context }) => rebuildPackZip(context.viewer, data.id, defaultMediaDeps))

export const adminDeletePackFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('packs')])
  .validator(packDeleteInput)
  .handler(({ data, context }) => deletePack(context.viewer, data, defaultMediaDeps))

// ---------- 表情 (packs) ----------

export const adminEmojisFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('packs')])
  .validator(emojiListInput)
  .handler(({ data }) => listEmojis(data))

export const adminEmojiDetailFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('packs')])
  .validator(emojiDetailInput)
  .handler(({ data }) => getEmojiDetail(data.id))

export const adminReorderFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('packs')])
  .validator(reorderInput)
  .handler(({ data, context }) => reorderEmojis(context.viewer, data, defaultMediaDeps))

export const adminEmojiStatusFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('packs')])
  .validator(emojiStatusInput)
  .handler(({ data, context }) => setEmojisStatus(context.viewer, data, defaultMediaDeps))

export const adminPublishEmojisFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('packs')])
  .validator(emojiIdsInput)
  .handler(({ data, context }) => publishPendingEmojis(context.viewer, data.ids, defaultMediaDeps))

export const adminDeleteEmojisFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('packs')])
  .validator(emojiIdsInput)
  .handler(({ data, context }) => deleteEmojis(context.viewer, data.ids, defaultMediaDeps))

export const adminRegenerateFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('packs')])
  .validator(regenerateInput)
  .handler(({ data, context }) => regenerateEmojis(context.viewer, data, defaultMediaDeps))

export const adminMoveEmojisFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('packs')])
  .validator(moveInput)
  .handler(({ data, context }) => moveEmojis(context.viewer, data, defaultMediaDeps))

// ---------- 上传中心 (upload) ----------

export const adminSignUploadsFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('upload')])
  .validator(signUploadsInput)
  .handler(({ data, context }) => signUploads(context.viewer, data))

export const adminCompleteUploadsFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('upload')])
  .validator(uploadIdsInput)
  .handler(({ data, context }) => completeUploads(context.viewer, data.ids, defaultMediaDeps))

export const adminAdvanceUploadsFn = createServerFn({ method: 'POST' })
  .middleware([requirePerm('upload')])
  .validator(uploadIdsInput)
  .handler(({ data, context }) => advanceUploads(context.viewer, data.ids, defaultMediaDeps))

/** Upload targets (id + title) for the 上传中心 picker; packs perm is not required to upload. */
export const adminUploadTargetsFn = createServerFn({ method: 'GET' })
  .middleware([requirePerm('upload')])
  .validator(packListInput)
  .handler(({ data }) => listPacks(data))
