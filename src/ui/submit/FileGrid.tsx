import type { CSSProperties } from 'react'
import type { UploadView } from '#/server/submissions/service'
import { cx } from '../cx'
import { fmtB } from '../format'
import { Icon, type IconName } from '../Icon'

// The 上传表情 grid: one tile per upload with its processing chip (完成 / 处理中 / 重复，已跳过 / 失败),
// plus cover, order and remove controls for finished ones.

export interface LocalState {
  /** 0–1 while the PUT runs */
  progress?: number
  /** object URL of the picked file, shown until the review preview exists */
  localUrl?: string
  /** the PUT failed */
  failed?: string
}

export interface Tile {
  key: string
  upload?: UploadView
  /** a file refused before upload (format, size) */
  rejected?: { name: string; reason: string }
  local?: LocalState
}

type Chip = { tone: 'ok' | 'warn' | 'err' | 'info' | 'mute'; text: string; run?: boolean; title?: string }

export function tileChip(t: Tile): Chip {
  if (t.rejected) return { tone: 'err', text: t.rejected.reason, title: t.rejected.name }
  if (t.local?.failed) return { tone: 'err', text: '上传失败', title: t.local.failed }
  const u = t.upload
  if (!u) return { tone: 'info', text: '排队中', run: true }
  if (u.status === 'signed') {
    if (t.local?.progress != null) return { tone: 'info', text: `上传 ${Math.round(t.local.progress * 100)}%`, run: true }
    return { tone: 'err', text: '未传完', title: '上传没有完成，请移除后重新上传' }
  }
  if (u.status === 'uploaded' || u.status === 'processing') return { tone: 'info', text: '处理中', run: true }
  if (u.status === 'duplicate') return { tone: 'warn', text: '重复，已跳过', title: u.error ?? undefined }
  if (u.status === 'failed') return { tone: 'err', text: '失败', title: u.error ?? undefined }
  if (u.status === 'done' && !u.emoji) return { tone: 'mute', text: '已移除' }
  if (u.status === 'done' && !u.emoji?.poster) return { tone: 'info', text: '处理中', run: true }
  return { tone: 'ok', text: '完成' }
}

export interface FileGridProps {
  tiles: Tile[]
  coverId: string | null
  editable: boolean
  onCover(emojiId: string): void
  onMove(emojiId: string, delta: -1 | 1): void
  onRemove(t: Tile): void
}

export function FileGrid({ tiles, coverId, editable, onCover, onMove, onRemove }: FileGridProps) {
  const doneIds = tiles.flatMap((t) => (t.upload?.emoji ? [t.upload.emoji.id] : []))
  return (
    <div className="sub-files">
      {tiles.map((t, i) => {
        const chip = tileChip(t)
        const emoji = t.upload?.emoji ?? null
        const src = emoji?.poster ?? t.local?.localUrl ?? null
        const isCover = emoji != null && emoji.id === coverId
        const pos = emoji ? doneIds.indexOf(emoji.id) : -1
        const name = t.rejected?.name ?? t.upload?.filename ?? ''
        const removable = editable && t.upload?.status !== 'processing' && t.upload?.status !== 'uploaded'
        const acts: [IconName, string, () => void, boolean][] = emoji
          ? [
              ['star', isCover ? '封面' : '设为封面', () => onCover(emoji.id), !isCover],
              ['left', '往前移', () => onMove(emoji.id, -1), pos > 0],
              ['right', '往后移', () => onMove(emoji.id, 1), pos >= 0 && pos < doneIds.length - 1],
            ]
          : []
        return (
          <div
            key={t.key}
            className={cx('sub-file', isCover && 'is-cover', 'is-in')}
            style={{ '--d': i % 24 } as CSSProperties}
            title={[name, t.upload ? fmtB(t.upload.bytes) : '', chip.title ?? ''].filter(Boolean).join(' · ')}
          >
            {src ? <img src={src} alt={name} width={96} height={96} loading="lazy" decoding="async" /> : <span className="ph"><Icon name="image" /></span>}
            {isCover ? <span className="cv-tag">封面</span> : null}
            <span className={cx('st', chip.tone, chip.run && 'run')}>{chip.text}</span>
            {editable && (acts.length || removable) ? (
              <span className="sf-acts">
                {acts.map(([icon, label, fn, enabled]) =>
                  enabled ? (
                    <button key={icon} type="button" className="tip" data-tip={label} aria-label={`${label}：${name}`} onClick={fn}>
                      <Icon name={icon} size="sm" />
                    </button>
                  ) : null,
                )}
                {removable ? (
                  <button type="button" className="tip" data-tip="移除" aria-label={`移除：${name}`} onClick={() => onRemove(t)}>
                    <Icon name="trash" size="sm" />
                  </button>
                ) : null}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
