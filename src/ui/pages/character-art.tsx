import type { CharacterCard, CharacterPortrait } from '#/server/catalog/types'
import charactersCss from './characters.css?url'

// Pieces shared by 角色图鉴, 角色详情 and 角色潮汐: the stylesheet, the round avatar (the character's
// own sticker clipped to a circle, or its initial on the character colour) and the portrait (立绘).

/** characters.css; React hoists and dedupes it. */
export function CharacterCss() {
  return <link rel="stylesheet" href={charactersCss} precedence="default" />
}

/** First character of a name (a whole code point, so 𠮷 stays whole). */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0] ?? '?'
}

/**
 * Inside a round frame: the avatar sticker as a circle, else the initial; never other art. With
 * `portraitFirst`, the portrait's face (its top, enlarged in a clipped circle) comes before the sticker
 * (search results; the home strip keeps stickers).
 */
export function RingAvatar({
  c,
  eager,
  priority,
  portraitFirst,
}: {
  c: Pick<CharacterCard, 'name' | 'avatar'> & Partial<Pick<CharacterCard, 'portrait'>>
  eager?: boolean
  priority?: boolean
  portraitFirst?: boolean
}) {
  const loading = eager || priority ? 'eager' : 'lazy'
  if (portraitFirst && c.portrait) {
    return (
      <span className="ring-crop">
        <img className="ring-portrait" src={c.portrait.src} width={c.portrait.width} height={c.portrait.height} alt="" loading={loading} decoding="async" />
      </span>
    )
  }
  if (!c.avatar) {
    return (
      <span className="ring-initial" aria-hidden="true">
        {initialOf(c.name)}
      </span>
    )
  }
  return (
    <img
      className="ring-img"
      src={c.avatar.poster}
      width={160}
      height={160}
      alt=""
      loading={loading}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
    />
  )
}

/** The 3:4 portrait; `sizes` is its rendered width. */
export function PortraitImg({ p, sizes, alt, eager, priority }: { p: CharacterPortrait; sizes: string; alt: string; eager?: boolean; priority?: boolean }) {
  return (
    <img
      className="portrait"
      src={p.src}
      srcSet={p.srcSet}
      sizes={sizes}
      width={p.width}
      height={p.height}
      alt={alt}
      loading={eager || priority ? 'eager' : 'lazy'}
      fetchPriority={priority ? 'high' : undefined}
      decoding="async"
    />
  )
}
