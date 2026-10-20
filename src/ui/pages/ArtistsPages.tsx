import type { CSSProperties } from 'react'
import { packsFn } from '#/server/catalog/fns'
import type { ArtistCard, ArtistDetail } from '#/server/catalog/types'
import { fmtN } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { WaveEdge } from './CharacterPage'
import { characterHref, themeColor } from './model'
import { PackMasonry } from './PackMasonry'
import { ArtistTile } from './people'
import { useCursorList } from './useCursorList'

// 画师名录 /artists and 画师主页 /artists/:slug. Every pack credits its artists and links here (the
// attribution CC BY asks for); the header links are maintained in the admin (http/https only).

export function ArtistsPage({ list }: { list: ArtistCard[] }) {
  const drawn = list.filter((a) => a.drawnCount > 0).length
  return (
    <div className="wrap">
      <div className="page-h">
        <h1>画师名录</h1>
        <span className="sub">
          {drawn} 位画师{list.length > drawn ? `、${list.length - drawn} 位约稿人` : ''}。每个表情包都署名，并链接到这里。
        </span>
      </div>
      <div className="links-grid" style={{ marginTop: 18 }}>
        {list.map((a, i) => (
          <ArtistTile key={a.slug} a={a} index={i} />
        ))}
      </div>
      <div className="note-box" style={{ marginTop: 20 }}>
        <Icon name="info" size="sm" />
        <span>同一位画师的不同写法会在后台合并，旧名保留为别名，搜索旧名也能找到。</span>
      </div>
    </div>
  )
}

export function ArtistPage({ detail }: { detail: ArtistDetail }) {
  const a = detail.artist
  const list = useCursorList(detail.page, (cursor) => packsFn({ data: { artist: a.slug, sort: 'new', cursor } }))
  const role = a.drawnCount && a.commissionedCount ? '画师 · 约稿人' : a.drawnCount ? '画师' : '约稿人'
  return (
    <>
      <section className="char-hero" style={{ '--cc': 'var(--c-purple)' } as CSSProperties}>
        <div className="wrap">
          <span className="pool">
            <span className="initial">{Array.from(a.name.trim())[0] ?? '?'}</span>
          </span>
          <div style={{ minWidth: 0 }}>
            <nav className="crumbs" aria-label="位置">
              <AppLink to="/artists">画师名录</AppLink>
              <Icon name="right" />
              <span aria-current="page">{a.name}</span>
            </nav>
            <h1>{a.name}</h1>
            <div className="alias">
              {role}
              {a.aliases.length ? ` · 别名：${a.aliases.join(' · ')}` : ''}
            </div>
            <div className="stats">
              <div className="stat">
                <b>{fmtN(a.packCount)}</b>
                <span>个表情包</span>
              </div>
              <div className="stat">
                <b>{fmtN(a.emojiCount)}</b>
                <span>张表情</span>
              </div>
            </div>
          </div>
          {a.links.length ? (
            <div className="acts">
              {a.links.map((l) => (
                <a key={l.url} className="btn sm" href={l.url} target="_blank" rel="noopener nofollow noreferrer">
                  <Icon name="external" size="sm" />
                  {l.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </section>
      <WaveEdge />
      <div className="wrap">
        {detail.characters.length ? (
          <div className="chips" style={{ marginTop: 22 }}>
            {detail.characters.map((c) => (
              <AppLink key={c.slug} to={characterHref(c.slug)} className="chip sm" style={{ borderColor: themeColor(c.color) }}>
                {c.name}
                <span className="n">{c.packCount}</span>
              </AppLink>
            ))}
          </div>
        ) : null}
        <div style={{ marginTop: 22 }}>
          <PackMasonry cards={list.items} label={`${a.name}的表情包`} priority={2} onEndReached={list.loadMore} loading={list.loading} done={list.done} error={list.error} onRetry={list.loadMore} />
        </div>
      </div>
    </>
  )
}
