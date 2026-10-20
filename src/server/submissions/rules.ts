import { LICENSE_LABELS } from '../media/credits'
import type { SubmissionDeclaration, SubmissionKind, SubmissionPayload, SubmissionStatus, UploadStatus } from '../db/schema/submissions'

// Submission rules shared by the server and the 投稿 / 审核 pages. Pure: no database, env or node:
// imports, so the browser bundle can use the labels and limits too. docs/ARCHITECTURE.md §5.2.

/** §5.2 state machine, exactly. Every transition is checked again in SQL (UPDATE … WHERE status IN …). */
export const TRANSITIONS: Readonly<Record<SubmissionStatus, readonly SubmissionStatus[]>> = {
  draft: ['pending', 'withdrawn'],
  pending: ['approved', 'returned', 'withdrawn'],
  returned: ['pending'],
  approved: [],
  withdrawn: [],
}

export function canTransition(from: SubmissionStatus, to: SubmissionStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

/** States in which the submitter may edit the payload, upload or remove files. */
export const EDITABLE_STATUSES: readonly SubmissionStatus[] = ['draft', 'returned']

export function isEditable(status: SubmissionStatus): boolean {
  return EDITABLE_STATUSES.includes(status)
}

/** Statuses that came from `to` through a legal transition (used in the SQL guards). */
export function sourcesOf(to: SubmissionStatus): SubmissionStatus[] {
  return (Object.keys(TRANSITIONS) as SubmissionStatus[]).filter((from) => TRANSITIONS[from].includes(to))
}

export const UPLOAD_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  maxFiles: 200,
  /** files per presign request */
  maxPerRequest: 50,
  /** presigned PUT lifetime */
  expiresIn: 15 * 60,
  mimes: ['image/gif', 'image/png', 'image/webp', 'image/jpeg'] as readonly string[],
}

export const ACTIVE_UPLOAD: readonly UploadStatus[] = ['signed', 'uploaded', 'processing']

export const KIND_LABELS: Record<SubmissionKind, string> = { new_pack: '新包', add_emojis: '补充表情', edit_pack: '修改已发布' }
export const KIND_TONE: Record<SubmissionKind, 'info' | 'ok' | 'warn'> = { new_pack: 'info', add_emojis: 'ok', edit_pack: 'warn' }

export const STATUS_LABELS: Record<SubmissionStatus, string> = {
  draft: '草稿',
  pending: '审核中',
  approved: '已发布',
  returned: '已退回',
  withdrawn: '已撤回',
}
export const STATUS_TONE: Record<SubmissionStatus, 'mute' | 'info' | 'ok' | 'warn'> = {
  draft: 'mute',
  pending: 'info',
  approved: 'ok',
  returned: 'warn',
  withdrawn: 'mute',
}

export type Identity = SubmissionDeclaration['identity']
export const IDENTITIES: readonly { value: Identity; label: string }[] = [
  { value: 'artist', label: '画师本人' },
  { value: 'commissioner', label: '约稿人' },
  { value: 'granted', label: '已获授权' },
  { value: 'curator', label: '整理搬运' },
]
export const IDENTITY_LABELS = Object.fromEntries(IDENTITIES.map((i) => [i.value, i.label])) as Record<Identity, string>

/** License codes (packs.license); same list as CREDITS.txt. */
export const LICENSE_CODES = Object.keys(LICENSE_LABELS) as [string, ...string[]]
export const LICENSE_OPTIONS = LICENSE_CODES.map((code) => ({ value: code, label: LICENSE_LABELS[code]! }))

export const CONFLICT_MESSAGE = '这个包在你提交后被修改过，请重新提交'

/** 退回原因模板 (prototype a-review), plus the conflict case. */
export const RETURN_TEMPLATES: readonly string[] = ['缺少画师授权说明', '与已有包重复', '与鸣潮无关', '标题或角色不规范', CONFLICT_MESSAGE]

/**
 * What a submission proposes (SubmissionPayload, jsonb). artistNames and official are described there.
 * addEmojiIds is server-managed: the submission's own pending emojis in display order.
 */
export type ProposedPayload = SubmissionPayload

export const TEXT_LIMITS = { title: 60, excerpt: 140, description: 4000, artist: 40, commissioner: 40, note: 1000, proofUrl: 500, reason: 500 }

/** Missing pieces that block 提交审核, in form order. Empty = ready. */
export function submitProblems(input: {
  kind: SubmissionKind
  payload: ProposedPayload
  declaration: SubmissionDeclaration | null
  emojiCount: number
  activeUploads: number
}): string[] {
  const { kind, payload, declaration } = input
  const out: string[] = []
  if (kind !== 'add_emojis' && !payload.title?.trim()) out.push('请填写标题')
  if (kind !== 'edit_pack' && input.emojiCount === 0) out.push('请至少上传一张表情')
  if (input.activeUploads > 0) out.push('还有图片正在上传或处理，请稍候再提交')
  if (kind === 'new_pack' && !(payload.artistIds?.length || payload.artistNames?.length)) out.push('请填写画师')
  if (!declaration) out.push('请填写署名与授权')
  else if (!declaration.note?.trim()) out.push('请填写授权说明')
  return out
}
