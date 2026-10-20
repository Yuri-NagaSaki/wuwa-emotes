import type { AuditEntry, Json } from '#/server/admin/types'
import { ROLES, isRole } from '#/shared/roles'
import type { IconName } from '../Icon'

// Human labels for audit actions (src/server/admin and other lanes); unknown actions show as they are.

export const ACTION_LABELS: Record<string, string> = {
  'pack.create': '新建表情包',
  'pack.update': '编辑表情包',
  'pack.status': '修改发布状态',
  'pack.hide': '隐藏表情包',
  'pack.delete': '彻底删除表情包',
  'pack.delete.purge': '清除 CDN 缓存（删除表情包）',
  'pack.reorder': '调整表情顺序',
  'pack.zip.rebuild': '重建 ZIP',
  'emoji.hide': '隐藏表情',
  'emoji.unhide': '恢复表情',
  'emoji.publish': '发布表情',
  'emoji.delete': '删除表情（下架）',
  'emoji.regenerate': '重新生成衍生图',
  'emoji.move': '移动表情',
  'upload.sign': '开始上传',
  'upload.complete': '上传完成',
  'character.create': '新建角色',
  'character.update': '编辑角色',
  'character.delete': '删除角色',
  'character.merge': '合并角色',
  'artist.create': '新建画师',
  'artist.update': '编辑画师',
  'artist.delete': '删除画师',
  'artist.merge': '合并画师',
  'tag.create': '新建标签',
  'tag.update': '编辑标签',
  'tag.delete': '删除标签',
  'tag.merge': '合并标签',
  'user.role': '修改角色',
  'user.submit_mode': '修改投稿模式',
  'user.ban': '封禁用户',
  'user.unban': '解除封禁',
  'user.revoke_sessions': '强制下线',
  'user.impersonate': '模拟登录',
  'user.impersonate_stop': '结束模拟',
  'job.retry': '重试任务',
  'job.cancel': '取消任务',
  'settings.site': '修改站点设置',
  'cli.set-role': '命令行设置角色',
}

export const TARGET_LABELS: Record<string, string> = {
  pack: '表情包',
  emoji: '表情',
  character: '角色',
  artist: '画师',
  tag: '标签',
  user: '用户',
  job: '任务',
  setting: '设置',
  submission: '投稿',
  comment: '评论',
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

export function auditIcon(action: string): IconName {
  if (action.startsWith('comment')) return 'chat'
  if (action.startsWith('user.ban') || action === 'user.revoke_sessions') return 'ban'
  if (action.startsWith('user')) return 'user'
  if (action.endsWith('.merge')) return 'merge'
  if (action.includes('delete')) return 'trash'
  if (action.startsWith('upload')) return 'upload'
  if (action.startsWith('job')) return 'layers'
  if (action.startsWith('settings')) return 'sliders'
  if (action.startsWith('submission') || action.startsWith('review')) return 'inbox'
  return 'edit'
}

function pick(diff: Json, keys: string[]): string | null {
  if (!diff || typeof diff !== 'object' || Array.isArray(diff)) return null
  for (const k of keys) {
    const v = (diff as Record<string, Json>)[k]
    if (typeof v === 'string' && v) return v
    if (Array.isArray(v) && typeof v[1] === 'string') return v[1]
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof (v as Record<string, Json>).name === 'string') return (v as Record<string, Json>).name as string
  }
  return null
}

export function targetText(a: Pick<AuditEntry, 'targetType' | 'targetId' | 'targetName' | 'diff'>): string {
  const kind = a.targetType ? (TARGET_LABELS[a.targetType] ?? a.targetType) : ''
  const name = a.targetName ?? pick(a.diff, ['title', 'name', 'to'])
  if (name) return `${kind}「${name}」`
  return [kind, a.targetId ? `#${a.targetId.length > 14 ? a.targetId.slice(0, 12) + '…' : a.targetId}` : ''].filter(Boolean).join(' ')
}

export function roleName(role: string | null): string {
  return role && isRole(role) ? ROLES[role].name : (role ?? '')
}

export function AuditLine({ entry }: { entry: AuditEntry }) {
  return (
    <div>
      <b>{entry.actorName ?? (entry.actorId ? '已删除的用户' : '系统')}</b> {actionLabel(entry.action)} <span className="muted">{targetText(entry)}</span>
      {entry.impersonatedBy ? <span className="hint"> · 由 {entry.impersonatorName ?? '站长'} 模拟登录操作</span> : null}
    </div>
  )
}
