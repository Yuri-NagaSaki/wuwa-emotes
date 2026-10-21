import { useState, type CSSProperties } from 'react'
import avatarCss from './avatar.css?url'
import { cx } from './cx'

// The one avatar: the user's 头像 when `src` is set (a round box that clips the image, object-fit:
// cover, explicit size), otherwise the first letter, on a palette colour when `color` is given (comments)
// or on sand (header, settings). Box sizes come from the .avatar classes in components.css (sm 30, md 40,
// lg 72) or a number in px; context rules such as `.cmt .avatar` still resize it. `src` is a URL from the
// server (avatarUrl in src/server/media/keys.ts); a picture that fails to load falls back to the letter.
//
//   <Avatar name={user.name} src={user.avatarUrl} />                  header (40 px)
//   <Avatar name={a.name} src={a.avatarUrl} color={a.color} size="sm" />  comments

export type AvatarSize = 'sm' | 'md' | 'lg' | number

export interface AvatarProps {
  /** Display name: its first character is the fallback letter. */
  name: string
  src?: string | null
  /** --c-* palette name for the letter look (comment authors). */
  color?: string | null
  size?: AvatarSize
  /** Tombstone of a deleted comment: an empty dashed circle. */
  gone?: boolean
  /** Accessible name; without it the avatar is decorative (aria-hidden). */
  label?: string
  /** 'eager' for avatars above the fold that are the page's subject (settings). */
  loading?: 'lazy' | 'eager'
  className?: string
}

const PX: Record<'sm' | 'md' | 'lg', number> = { sm: 30, md: 40, lg: 72 }

export function Avatar({ name, src, color, size = 'md', gone, label, loading = 'lazy', className }: AvatarProps) {
  const [failed, setFailed] = useState<string | null>(null)
  const px = typeof size === 'number' ? size : PX[size]
  const picture = !gone && src && failed !== src ? src : null
  const style: CSSProperties = {}
  if (typeof size === 'number') Object.assign(style, { width: size, height: size, fontSize: Math.round(size * 0.4) })
  if (color && !gone) {
    const c = `var(--c-${color})`
    style.borderColor = c
    if (!picture) style.background = `color-mix(in srgb, ${c} 30%, var(--tp-card))`
  }
  return (
    <>
      <link rel="stylesheet" href={avatarCss} precedence="default" />
      <span
        className={cx('avatar', typeof size === 'string' && size !== 'md' && size, picture && 'has-img', gone && 'gone', className)}
        style={style}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      >
        {picture ? (
          <img src={picture} alt="" width={px} height={px} loading={loading} decoding="async" draggable={false} onError={() => setFailed(picture)} />
        ) : gone ? null : (
          ([...name][0] ?? '?')
        )}
      </span>
    </>
  )
}
