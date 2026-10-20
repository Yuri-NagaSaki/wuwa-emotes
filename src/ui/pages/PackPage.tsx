import { useMemo, useState, type CSSProperties } from 'react'
import type { PackDetail } from '#/server/catalog/types'
import { Button } from '../Button'
import { Chips, Flag, Tag } from '../Chip'
import { cx } from '../cx'
import { fmtB, fmtN } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { setAutoplayPref, useAutoplayPref } from '../motion'
import { Tile, TileGrid } from '../Tile'
import { copyImage, copyLink } from './clipboard'
import { CommentsSlot } from './CommentsSlot'
import { EmojiDialog } from './EmojiDialog'
import { artistHref, characterHref, dialogPack, fromPackEmoji, KIND_LABEL, licenseLabel, longDate, packHref, themeColor } from './model'
import { Toggle } from './Toggle'
import { useAddToBatch } from './useBatch'
import { useDownload } from './useDownload'
import { favoriteKey, toggleFavorite, useFavorite, useFavoriteKeys, useFavoriteStatus } from './useFavorite'

// 包详情 /packs/:slug (and /e/:emojiId with the dialog open). The route owns the dialog's history
// (route masking: the address bar shows /e/<id>); this component only reports open/switch/close.

export interface PackPageProps {
  pack: PackDetail
  /** index of the open emoji, or null */
  open: number | null
  onOpen: (index: number) => void
  onIndex: (index: number) => void
  onClose: () => void
  /** /e deep link: the dialog image is the LCP element */
  deepLink?: boolean
}

function PackFlags({ pack }: { pack: PackDetail }) {
  if (pack.sourceKind === 'official') return <Flag kind="official" />
  if (pack.pinLevel > 0) return <Flag kind="pin" />
  if (pack.memorial) return <Flag kind="memorial" />
  return null
}

export function PackPage({ pack, open, onOpen, onIndex, onClose, deepLink }: PackPageProps) {
  const dpack = useMemo(() => dialogPack(pack), [pack])
  const items = useMemo(() => pack.emojis.map((e) => fromPackEmoji(e, dpack)), [pack.emojis, dpack])
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<ReadonlySet<string>>(() => new Set())
  const autoplay = useAutoplayPref()
  const dl = useDownload()
  const fav = useFavorite({ type: 'pack', id: pack.id })
  const favKeys = useFavoriteKeys()
  useFavoriteStatus(useMemo(() => [{ type: 'pack' as const, id: pack.id }, ...pack.emojis.map((e) => ({ type: 'emoji' as const, id: e.id }))], [pack]))
  const addToBatch = useAddToBatch()
  const pv = !pack.downloadable
  const lic = licenseLabel(pack.license)
  const animated = pack.emojis.filter((e) => e.frames > 1).length
  const bytes = pack.emojis.reduce((s, e) => s + e.bytes, 0)
  const acc = themeColor(pack.accent, 'var(--c-pink)')
  const firstChar = pack.characters[0]
  const zipBusy = dl.busy === `zip:${pack.slug}`

  const toggle = (id: string) =>
    setSel((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const endSelect = () => {
    setSelecting(false)
    setSel(new Set())
  }
  const zip = () => void dl.run({ kind: 'zip', slug: pack.slug })

  const zipLabel = zipBusy ? (dl.building ? '正在生成 ZIP…' : '准备下载…') : '整包下载'
  const groups = pack.tags.group

  return (
    <div className="pack-page">
      <div className="wrap">
        <nav className="crumbs" aria-label="位置">
          <AppLink to="/packs">表情包</AppLink>
          <Icon name="right" />
          {firstChar ? (
            <>
              <AppLink to={characterHref(firstChar.slug)}>{firstChar.name}</AppLink>
              <Icon name="right" />
            </>
          ) : null}
          <span aria-current="page">{pack.title}</span>
        </nav>

        <div className="pack-h" style={{ '--acc': acc } as CSSProperties}>
          <div className="pack-cover">
            {pack.cover ? (
              <img src={pack.cover.poster} width={240} height={240} alt={`${pack.title} 封面`} fetchPriority="high" decoding="async" />
            ) : null}
            <PackFlags pack={pack} />
          </div>
          <div className="pack-info">
            <h1>{pack.title}</h1>
            <div className="pack-meta">
              <span className="pill-stat">
                <Icon name="image" size="sm" />
                {pack.count} 张{animated === pack.count ? '动态' : animated === 0 ? '静态' : `（动态 ${animated}）`}
              </span>
              <span className="pill-stat" title="原图合计">
                <Icon name="box" size="sm" />
                {fmtB(bytes)}
              </span>
              <span className="pill-stat" title="发布">
                <Icon name="clock" size="sm" />
                {longDate(pack.publishedAt)}
              </span>
              <span className="pill-stat" title="下载">
                <Icon name="download" size="sm" />
                {fmtN(pack.downloads)}
              </span>
              <span className="pill-stat" title="收藏">
                <Icon name="heart" size="sm" />
                {fmtN(pack.favorites)}
              </span>
            </div>
            {pack.excerpt ? <p className="pack-ex">{pack.excerpt}</p> : null}
            <Chips className="pack-chips">
              {pack.characters.map((c) => (
                <AppLink key={c.slug} to={characterHref(c.slug)}>
                  <Tag color={themeColor(c.color)}>角色 · {c.name}</Tag>
                </AppLink>
              ))}
              {pack.artists.map((a) => (
                <AppLink key={a.slug} to={artistHref(a.slug)}>
                  <Tag color="var(--c-purple)">画师 · {a.name}</Tag>
                </AppLink>
              ))}
              {groups.map((g) => (
                <AppLink key={g.slug} to={`/packs?group=${encodeURIComponent(g.slug)}`}>
                  <Tag color="var(--c-yellow)">分组 · {g.name}</Tag>
                </AppLink>
              ))}
              <Tag color="var(--c-mint)">{KIND_LABEL[pack.kind] ?? pack.kind}表情</Tag>
            </Chips>
            {pv ? (
              <div className="note-box warn" style={{ maxWidth: 640 }}>
                <Icon name="lock" size="sm" />
                <span>
                  这个包<b>只提供预览</b>
                  {pack.sourceKind === 'official' ? '（官方转载）' : '（作者暂未开放下载）'}：可以浏览、收藏和复制链接，不提供原图与打包。
                </span>
              </div>
            ) : null}
            <div className="pack-acts">
              {pv ? (
                <Button icon="lock" disabled>
                  只提供预览
                </Button>
              ) : (
                <>
                  <Button variant="primary" icon="box" onClick={zip} disabled={zipBusy} aria-busy={zipBusy || undefined}>
                    {zipLabel}
                  </Button>
                  <Button variant="sun" icon="bottle" className="hide-sm" onClick={() => addToBatch(pack.emojis.map((e) => e.id))}>
                    全部加入打包
                  </Button>
                </>
              )}
              <Button icon="heart" className={fav.favorited ? 'is-fav' : undefined} onClick={fav.toggle}>
                {fav.favorited ? '已收藏' : '收藏'}
              </Button>
              <Button icon="share" aria-label="复制分享链接" onClick={() => void copyLink(packHref(pack.slug))} />
              {dl.error && !open ? (
                <div className="note-box warn zip-note" role="alert">
                  <Icon name="warn" size="sm" />
                  <span>
                    {dl.error.message}
                    {dl.error.loginRaisesLimit || dl.error.reason === 'login_required' ? (
                      <>
                        {' '}
                        <AppLink to="/login">登录</AppLink>
                      </>
                    ) : null}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          <dl className="credit-card">
            <dt>许可</dt>
            <dd className="lic">
              {lic.badge ? <span className="cc-badge">{lic.badge}</span> : null}
              {pv && pack.sourceKind === 'official' ? '版权方未开放再分发' : lic.text}
            </dd>
            {pack.artists.length ? (
              <>
                <dt>画师</dt>
                <dd>
                  {pack.artists.map((a, i) => (
                    <span key={a.slug}>
                      {i ? '、' : ''}
                      <AppLink to={artistHref(a.slug)}>{a.name}</AppLink>
                    </span>
                  ))}
                </dd>
              </>
            ) : null}
            {pack.commissioners.length || pack.commissionerText ? (
              <>
                <dt>约稿</dt>
                <dd>
                  {pack.commissioners.map((a, i) => (
                    <span key={a.slug}>
                      {i ? '、' : ''}
                      <AppLink to={artistHref(a.slug)}>{a.name}</AppLink>
                    </span>
                  ))}
                  {pack.commissionerText && !pack.commissioners.some((c) => c.name === pack.commissionerText)
                    ? `${pack.commissioners.length ? '、' : ''}${pack.commissionerText}`
                    : null}
                </dd>
              </>
            ) : null}
            {pack.creditsText ? (
              <>
                <dt>署名</dt>
                <dd>{pack.creditsText}</dd>
              </>
            ) : null}
            <dt>下载</dt>
            <dd>{pv ? <><span className="flag static">仅预览</span> 不提供原图与打包</> : '无需登录，单张或整包都可直接下载'}</dd>
            {!pv ? (
              <>
                <dt>下载包含</dt>
                <dd>原图 {pack.count} 张 + CREDITS.txt（署名与许可原文）</dd>
              </>
            ) : null}
          </dl>
        </div>
      </div>

      <div className="sticky-tools">
        <div className="wrap">
          <span className="count">
            {pack.count} 张<small>{selecting ? `已选 ${sel.size}` : '点按查看大图'}</small>
          </span>
          <span className="grow" />
          <Toggle checked={autoplay} onChange={setAutoplayPref}>
            自动播放
          </Toggle>
          {!pv ? (
            <Button size="sm" icon={selecting ? 'check' : 'grid'} on={selecting} onClick={() => (selecting ? endSelect() : setSelecting(true))}>
              {selecting ? '完成' : '多选'}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="wrap">
        <TileGrid size={150} selecting={selecting} className={cx(pv && 'is-preview')}>
          {items.map((e, i) => (
            <Tile
              key={e.id}
              poster={e.poster}
              preview={e.preview}
              alt={`${pack.title} 第 ${i + 1} 张`}
              format={e.format}
              selecting={selecting}
              selected={sel.has(e.id)}
              previewOnly={pv}
              onOpen={() => (selecting ? toggle(e.id) : onOpen(i))}
              onCopy={pv ? undefined : () => void copyImage(e)}
              onDownload={pv ? undefined : () => void dl.run({ kind: 'emoji', id: e.id, mode: 'save' })}
              onAdd={pv ? undefined : () => addToBatch(e.id)}
              favorite={favKeys.has(favoriteKey({ type: 'emoji', id: e.id }))}
              onFavorite={() => void toggleFavorite({ type: 'emoji', id: e.id })}
            />
          ))}
        </TileGrid>

        <div className="split" style={{ marginTop: 36 }}>
          <CommentsSlot packId={pack.id} stickers={pack.emojis} />
          <aside className="side-stack" aria-label="更多表情包">
            <div className="pn">
              {pack.prev ? (
                <AppLink to={packHref(pack.prev.slug)} className="prev">
                  <small>
                    <Icon name="left" size="sm" />
                    上一组
                  </small>
                  <b>{pack.prev.title}</b>
                </AppLink>
              ) : (
                <span className="none" />
              )}
              {pack.next ? (
                <AppLink to={packHref(pack.next.slug)} className="next">
                  <small>
                    下一组
                    <Icon name="right" size="sm" />
                  </small>
                  <b>{pack.next.title}</b>
                </AppLink>
              ) : (
                <span className="none" />
              )}
            </div>
          </aside>
        </div>
      </div>

      {selecting && sel.size ? (
        <div className="sel-bar" role="region" aria-label="多选操作">
          <span>
            已选 <b>{sel.size}</b> 张
          </span>
          <Button variant="sun" size="sm" icon="bottle" onClick={() => (addToBatch([...sel]), endSelect())}>
            加入打包
          </Button>
          <Button variant="ghost" size="sm" onClick={endSelect} style={{ color: '#cfe9e4' }}>
            取消
          </Button>
        </div>
      ) : null}

      <div className="mob-actbar">
        {pv ? (
          <Button block icon="lock" disabled>
            只提供预览
          </Button>
        ) : (
          <>
            <Button variant="primary" icon="box" onClick={zip} disabled={zipBusy}>
              {zipBusy ? zipLabel : `打包下载 ${pack.count} 张`}
            </Button>
            <Button icon="bottle" aria-label="全部加入打包" onClick={() => addToBatch(pack.emojis.map((e) => e.id))} />
          </>
        )}
        <Button icon="heart" aria-label="收藏" className={fav.favorited ? 'is-fav' : undefined} onClick={fav.toggle} />
      </div>

      {open != null && items[open] ? <EmojiDialog items={items} index={open} onIndex={onIndex} onClose={onClose} priority={deepLink} /> : null}
    </div>
  )
}

