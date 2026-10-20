import type { AnimationEvent, CSSProperties, PointerEvent, ReactNode } from 'react'
import { cx } from './cx'
import { Icon, type IconName } from './Icon'
import { useAnimatedPreview } from './usePreview'

export interface TileProps {
  /** Static WebP poster (p240). Shown by default and on the server. */
  poster: string
  /** Animated WebP preview (a160). Omit for static stickers: they never swap. */
  preview?: string | null
  alt: string
  /** Original format badge shown on hover ("GIF", "PNG"). */
  format?: string
  selected?: boolean
  /** Selection mode: shows the check box instead of the hover actions. */
  selecting?: boolean
  favorite?: boolean
  /** Download disabled for this pack: only the 收藏 action is offered. */
  previewOnly?: boolean
  big?: boolean
  /** Entrance animation stagger (0–23); omit for no entrance animation. */
  enterIndex?: number
  onOpen?: () => void
  onCopy?: () => void
  onDownload?: () => void
  onAdd?: () => void
  onFavorite?: () => void
  className?: string
}

/**
 * Emoji tile. Shows the p240 poster; swaps to the a160 preview on hover/focus or when centered in the
 * viewport (≤ 4 at once page-wide; off for reduced motion, Save-Data, or the 自动播放 switch).
 */
export function Tile(props: TileProps) {
  const { poster, preview, alt, format, selected, selecting, favorite, previewOnly, big, enterIndex, className } = props
  const pv = useAnimatedPreview<HTMLElement>(poster, preview)

  function squish(e: PointerEvent<HTMLElement>) {
    if ((e.target as Element).closest('.tile-acts')) return
    const el = e.currentTarget
    el.classList.remove('is-squish')
    void el.offsetWidth
    el.classList.add('is-squish')
  }
  function unsquish(e: AnimationEvent<HTMLElement>) {
    if (e.animationName === 'tp-squish') e.currentTarget.classList.remove('is-squish')
  }

  const acts: [IconName, string, (() => void) | undefined, string?][] = previewOnly
    ? [['heart', '收藏', props.onFavorite, favorite ? 'is-fav' : undefined]]
    : [
        ['copy', '复制', props.onCopy],
        ['download', '保存原图', props.onDownload],
        ['box', '加入打包', props.onAdd],
        ['heart', '收藏', props.onFavorite, favorite ? 'is-fav' : undefined],
      ]
  const shown = acts.filter((a) => a[2])

  return (
    <figure
      ref={pv.ref}
      className={cx('tile', enterIndex != null && 'is-in', selected && 'is-sel', selecting && 'is-selecting', big && 'big', className)}
      style={enterIndex != null ? ({ '--d': enterIndex % 24 } as CSSProperties) : undefined}
      data-playing={pv.playing || undefined}
      onPointerDown={squish}
      onAnimationEnd={unsquish}
      {...pv.handlers}
    >
      <button type="button" className="tile-hit" onClick={props.onOpen} aria-label={`查看 ${alt}`} aria-pressed={selecting ? Boolean(selected) : undefined}>
        <img src={pv.src} width={240} height={240} loading="lazy" decoding="async" alt={alt} draggable={false} />
      </button>
      {format ? <span className="tile-fmt">{format.toUpperCase()}</span> : null}
      {selecting ? (
        <span className="tile-check" aria-hidden="true">
          <Icon name="check" />
        </span>
      ) : null}
      {!selecting && shown.length ? (
        <div className="tile-acts">
          {shown.map(([icon, label, fn, extra]) => (
            <button key={icon} type="button" className={cx('tip', extra)} data-tip={label} aria-label={label} onClick={fn}>
              <Icon name={icon} />
            </button>
          ))}
        </div>
      ) : null}
    </figure>
  )
}

/** Auto-fill grid of square tiles (`--tile` is the minimum column width). */
export function TileGrid({ size = 132, children, selecting, className }: { size?: 96 | 110 | 120 | 132 | 150; children: ReactNode; selecting?: boolean; className?: string }) {
  return <div className={cx('grid-tiles', size !== 132 && `t${size}`, selecting && 'is-selecting', className)}>{children}</div>
}
