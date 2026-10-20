import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Sticker } from '#/server/comments/types'
import { Tag } from '../Chip'
import { cx } from '../cx'
import { fmtB } from '../format'
import { Icon, type IconName } from '../Icon'
import { lockScroll } from '../scroll-lock'
import { AppLink } from '../link'
import { CharacterTags } from './CharacterTags'
import { copyImage, copyLink } from './clipboard'
import { artistHref, type DialogEmoji, emojiHref, licenseLabel, packHref } from './model'
import { useAddToBatch, useInBatch } from './useBatch'
import { useDownload } from './useDownload'
import { useFavorite } from './useFavorite'

// The single-emoji dialog (docs/ARCHITECTURE.md §8): a card sized to the sticker (300 px), not a
// full-screen viewer; a bottom sheet (≤ 72% high) on phones. It renders inline rather than through a
// portal, so a deep link (/e/:id) has it in the server HTML with the image already requested; it is
// still modal: focus is trapped inside, Esc closes, ←/→ switch, the page behind cannot scroll.

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const STRIP = 9

// the sticker's own comment thread (thread "emoji", id = the emoji id): collapsed under the card, loaded
// when opened (or right away for a #comments / #c-123 link, e.g. from a notification)
const CommentsSection = lazy(() => import('../comments').then((m) => ({ default: m.CommentsSection })))
const wantsComments = () => typeof location !== 'undefined' && /^#(comments|c-\d+)$/.test(location.hash)

export interface EmojiDialogProps {
  items: readonly DialogEmoji[]
  index: number
  onIndex: (index: number) => void
  onClose: () => void
  /** Deep link: the image is the page's LCP element and the card skips its entrance animation. */
  priority?: boolean
  /** Show the pack title as a link (cross-pack streams). */
  linkPack?: boolean
  /** The pack page's id and stickers, for the 本包 tab of the comment sticker picker. */
  packId?: number | null
  packStickers?: readonly Sticker[] | null
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(
    (el) => !el.hasAttribute('hidden') && el.getClientRects().length > 0,
  )
}

export function EmojiDialog({ items, index, onIndex, onClose, priority, linkPack, packId, packStickers }: EmojiDialogProps) {
  const e = items[index]!
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [orig, setOrig] = useState<{ id: string; url: string } | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [comments, setComments] = useState(false)
  useEffect(() => {
    if (wantsComments()) setComments(true)
  }, [])
  const imgRef = useRef<HTMLImageElement>(null)
  const dl = useDownload()
  const fav = useFavorite({ type: 'emoji', id: e.id })
  const inBatch = useInBatch(e.id)
  const addToBatch = useAddToBatch()
  const showingOrig = orig?.id === e.id
  const src = showingOrig ? orig!.url : e.full
  const pv = !e.pack.downloadable
  const n = items.length

  // modal plumbing: scroll lock (event-based: the root keeps its overflow, so nothing repaints), focus
  // in, focus back out
  useIsoLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const unlock = lockScroll()
    cardRef.current?.focus({ preventScroll: true })
    return () => {
      unlock()
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true })
    }
  }, [])

  const go = (i: number) => {
    if (i < 0 || i >= n || i === index) return
    onIndex(i)
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.altKey || ev.ctrlKey || ev.metaKey) return
      // keys inside the comment thread's own overlays (sticker picker, report / delete dialogs) and its
      // controls belong to them, not to the sticker dialog
      const t = ev.target as Element | null
      if (t?.closest?.('.drawer, .modal-wrap, .picker, .menu') || wrapRef.current?.querySelector('.picker')) return
      if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && t?.closest?.('.em-cm')) return
      if (ev.key === 'Escape') {
        ev.preventDefault()
        onClose()
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        const t = ev.target as HTMLElement | null
        if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
        ev.preventDefault()
        const next = index + (ev.key === 'ArrowLeft' ? -1 : 1)
        if (next >= 0 && next < n) onIndex(next)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [index, n, onIndex, onClose])

  // an image that finished before hydration fires no load event: check once mounted
  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth > 0) setLoaded(src)
  }, [src])

  // keep the current thumbnail in view inside the strip
  useEffect(() => {
    wrapRef.current?.querySelector('.em-th.is-on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [index])

  const trap = (ev: ReactKeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== 'Tab' || !wrapRef.current) return
    const list = focusables(wrapRef.current)
    if (!list.length) return
    const first = list[0]!
    const last = list[list.length - 1]!
    const active = document.activeElement
    if (ev.shiftKey && (active === first || active === cardRef.current)) {
      ev.preventDefault()
      last.focus()
    } else if (!ev.shiftKey && active === last) {
      ev.preventDefault()
      first.focus()
    }
  }

  const viewOriginal = async () => {
    if (showingOrig) return setOrig(null)
    const r = await dl.run({ kind: 'emoji', id: e.id, mode: 'view' })
    if (r?.ok) setOrig({ id: e.id, url: r.url })
  }

  const s0 = Math.max(0, Math.min(index - Math.floor(STRIP / 2), n - STRIP))
  const strip = items.slice(s0, s0 + STRIP)
  const lic = licenseLabel(e.pack.license)
  const artists = e.pack.artists.map((a) => a.name).join('、')
  const fmt = e.format.toUpperCase()

  const act = (icon: IconName, label: string, onClick: () => void, cls?: string, busy?: boolean) => (
    <button type="button" className={cx('em-act', cls)} onClick={onClick} disabled={busy} aria-busy={busy || undefined}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  )

  return (
    <div className="em-layer">
      <div className="scrim em-scrim" aria-hidden="true" onClick={onClose} />
      <div className={cx('em-wrap', comments && 'has-cm')} ref={wrapRef} onKeyDown={trap}>
        <button type="button" className="icon-btn em-nav" onClick={() => go(index - 1)} disabled={index === 0} aria-label="上一张">
          <Icon name="left" />
        </button>
        <div
          ref={cardRef}
          className={cx('em-card', priority && 'no-anim', comments && 'has-cm')}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
        >
          <span className="grab" aria-hidden="true" />
          <div className="em-media">
            {/* the poster shows until the full WebP (or the original) has loaded on top of it */}
            {loaded !== src ? (
              <img key={`p-${e.id}`} className="em-ph" src={e.poster} width={300} height={300} alt="" aria-hidden="true" decoding="async" />
            ) : null}
            <img
              key={src}
              ref={imgRef}
              src={src}
              width={300}
              height={300}
              alt={`${e.pack.title} 第 ${index + 1} 张`}
              decoding="async"
              // deep link: this image is the page's LCP element (it is larger than the poster, so it
              // replaces the poster as the LCP candidate when it paints): fetch it first
              fetchPriority={priority ? 'high' : 'auto'}
              onLoad={() => setLoaded(src)}
              className={loaded === src ? undefined : 'is-loading'}
            />
            <span className={cx('em-badge', showingOrig && 'is-orig')}>{showingOrig ? `原图 ${fmt} · ${fmtB(e.bytes)}` : 'WebP 预览'}</span>
          </div>
          <div className="em-info">
            <div className="em-top">
              <div style={{ minWidth: 0 }}>
                {linkPack ? (
                  <AppLink to={packHref(e.pack.slug)} className="eyebrow">
                    {e.pack.title}
                  </AppLink>
                ) : (
                  <span className="eyebrow">{e.pack.title}</span>
                )}
                <h3 id={titleId}>
                  第 {index + 1} 张<small> / {n}</small>
                </h3>
              </div>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
                <Icon name="close" />
              </button>
            </div>
            {e.characters.length || e.pack.artists.length || linkPack ? (
              <div className="chips">
                <CharacterTags key={e.id} chars={e.characters} />
                {e.pack.artists.slice(0, 2).map((a) => (
                  <AppLink key={a.slug} to={artistHref(a.slug)}>
                    <Tag color="var(--c-purple)">画师 · {a.name}</Tag>
                  </AppLink>
                ))}
                {linkPack ? (
                  <AppLink to={packHref(e.pack.slug)}>
                    <Tag color="var(--c-yellow)">来自 · {e.pack.title}</Tag>
                  </AppLink>
                ) : null}
              </div>
            ) : null}
            <div className="em-meta">
              <span>
                {e.width} × {e.height}
              </span>
              <span>{e.frames > 1 ? `${e.frames} 帧` : '静态'}</span>
              <span>
                原图 {fmt} {fmtB(e.bytes)}
              </span>
            </div>
            {pv ? (
              <>
                <div className="note-box warn">
                  <Icon name="lock" size="sm" />
                  <span>这个包只提供预览：不提供原图下载，也不能加入打包，可以浏览、收藏和复制链接。</span>
                </div>
                <div className="em-acts">
                  {act('heart', fav.favorited ? '已收藏' : '收藏', fav.toggle, fav.favorited ? 'is-fav' : undefined)}
                  {act('link', '复制链接', () => void copyLink(emojiHref(e.id)))}
                </div>
              </>
            ) : (
              <div className="em-acts">
                {act('copy', '复制图片', () => void copyImage(e))}
                {act('download', '保存原图', () => void dl.run({ kind: 'emoji', id: e.id, mode: 'save' }), undefined, dl.busy === `save:${e.id}`)}
                {act(showingOrig ? 'image' : 'eye', showingOrig ? '回到 WebP' : '查看原图', () => void viewOriginal(), showingOrig ? 'is-on' : undefined, dl.busy === `view:${e.id}`)}
                {act('heart', fav.favorited ? '已收藏' : '收藏', fav.toggle, fav.favorited ? 'is-fav' : undefined)}
                {act('box', inBatch ? '已在打包' : '加入打包', () => void addToBatch(e.id), inBatch ? 'is-on' : 'sun')}
                {act('link', '复制链接', () => void copyLink(emojiHref(e.id)))}
              </div>
            )}
            {dl.error ? (
              <p className="note-box warn em-err" role="alert">
                <Icon name="warn" size="sm" />
                <span>
                  {dl.error.message}
                  {dl.error.loginRaisesLimit || dl.error.reason === 'login_required' ? (
                    <>
                      {' '}
                      <AppLink to="/login" className="zip-note">
                        登录
                      </AppLink>
                    </>
                  ) : null}
                </span>
              </p>
            ) : null}
            <p className="em-lic">
              <Icon name="shield" size="sm" />
              <span>
                页面里显示的是 WebP，原图只在「查看原图」「保存原图」时加载。
                {lic.badge ? `${lic.badge} · ` : ''}
                {artists ? `画师 ${artists}。` : lic.badge ? '' : lic.text + '。'}
              </span>
            </p>
          </div>
          <div className="em-strip">
            {strip.map((x, k) => (
              <button
                key={x.id}
                type="button"
                className={cx('em-th', s0 + k === index && 'is-on')}
                onClick={() => go(s0 + k)}
                aria-label={`第 ${s0 + k + 1} 张`}
                aria-current={s0 + k === index || undefined}
              >
                <img src={x.poster} width={240} height={240} alt="" loading="lazy" decoding="async" />
              </button>
            ))}
            <span className="em-keys">
              <span className="kbd">←</span>
              <span className="kbd">→</span> 切换 · <span className="kbd">Esc</span> 关闭
            </span>
          </div>
          <div className="em-cm">
            <button type="button" className="em-cm-toggle" aria-expanded={comments} onClick={() => setComments((v) => !v)}>
              <Icon name="chat" size="sm" />
              <span>这张表情的评论</span>
              <Icon name={comments ? 'up' : 'down'} size="sm" />
            </button>
            {comments ? (
              <Suspense fallback={<p className="em-cm-wait">评论加载中…</p>}>
                <CommentsSection key={e.id} threadType="emoji" threadId={e.id} packId={packId ?? null} packStickers={packStickers ?? null} eager className="em-thread" id="emoji-comments" />
              </Suspense>
            ) : null}
          </div>
        </div>
        <button type="button" className="icon-btn em-nav" onClick={() => go(index + 1)} disabled={index >= n - 1} aria-label="下一张">
          <Icon name="right" />
        </button>
      </div>
    </div>
  )
}
