import { useNavigate } from '@tanstack/react-router'
import { useCallback } from 'react'
import { galleryFn } from '#/server/catalog/fns'
import type { CharacterCard, EmojiTile, Page } from '#/server/catalog/types'
import { Button } from '../Button'
import { Chip } from '../Chip'
import { fmtN } from '../format'
import { setAutoplayPref, useAutoplayPref } from '../motion'
import { WaveLoader } from '../Section'
import { Seg } from '../Seg'
import { themeColor } from './model'
import { StreamTiles } from './StreamTiles'
import { Toggle } from './Toggle'
import { useCursorList } from './useCursorList'
import { WindowedGrid } from './WindowedGrid'

// 潮汐画廊 /gallery: an endless grid of stickers from every pack, newest or in a seeded random order
// (洗牌 = a new seed, shareable in the URL), filtered by character and animated/static. Only the
// rows near the viewport are mounted.

export interface GallerySearch {
  sort?: 'new'
  character?: string
  type?: 'animated' | 'static'
  seed?: string
  e?: string
}

const newSeed = () => Math.random().toString(36).slice(2, 10)

export function GalleryPage({ page, characters, search, total }: { page: Page<EmojiTile>; characters: CharacterCard[]; search: GallerySearch; total: number }) {
  const navigate = useNavigate()
  const autoplay = useAutoplayPref()
  const sort = search.sort ?? 'random'
  const list = useCursorList(page, (cursor) =>
    galleryFn({ data: { sort, character: search.character, type: search.type, cursor, limit: 60 } }),
  )
  const go = useCallback(
    (next: Partial<GallerySearch>) => void navigate({ to: '/gallery', search: { ...search, ...next, e: undefined }, resetScroll: false }),
    [navigate, search],
  )
  const top = characters.filter((c) => c.avatar).slice(0, 8)

  return (
    <div className="wrap">
      <div className="page-h">
        <h1>潮汐画廊</h1>
        <span className="sub">{fmtN(total)} 张表情，一直往下滑。悬停播放，点按看大图和来源。</span>
      </div>
      <div className="gal-tools">
        <div className="chips">
          <Chip size="sm" on={!search.character} onClick={() => go({ character: undefined })}>
            全部角色
          </Chip>
          {top.map((c) => (
            <Chip
              key={c.slug}
              size="sm"
              on={search.character === c.slug}
              avatar={c.avatar ? { src: c.avatar.poster, color: themeColor(c.color) } : null}
              onClick={() => go({ character: search.character === c.slug ? undefined : c.slug })}
            >
              {c.name}
            </Chip>
          ))}
        </div>
        <Seg
          size="sm"
          label="类型"
          options={[
            { value: 'all', label: '全部' },
            { value: 'animated', label: '动态' },
            { value: 'static', label: '静态' },
          ]}
          value={search.type ?? 'all'}
          onChange={(v) => go({ type: v === 'all' ? undefined : v })}
        />
        <Seg
          size="sm"
          label="排序"
          options={[
            { value: 'random', label: '随机' },
            { value: 'new', label: '最新' },
          ]}
          value={sort}
          onChange={(v) => go({ sort: v === 'new' ? 'new' : undefined, seed: undefined })}
        />
        <Button size="sm" variant="sun" icon="refresh" onClick={() => go({ sort: undefined, seed: newSeed() })}>
          洗牌
        </Button>
        <Toggle checked={autoplay} onChange={setAutoplayPref}>
          自动播放
        </Toggle>
      </div>
      {list.items.length ? (
        <StreamTiles
          tiles={list.items}
          current={search.e}
          layout={(tiles) => <WindowedGrid items={tiles} className="t120" label="表情" onEndReached={list.loadMore} />}
        />
      ) : (
        <p className="muted list-end">没有符合条件的表情。</p>
      )}
      <div className="loadmore" aria-live="polite">
        {list.loading ? (
          <>
            <WaveLoader />
            潮水正在涌上来…
          </>
        ) : list.error ? (
          <Button size="sm" onClick={list.loadMore}>
            加载失败，点此重试
          </Button>
        ) : list.done ? (
          <span className="list-end">到底了，一共 {fmtN(list.items.length)} 张</span>
        ) : null}
      </div>
    </div>
  )
}
