import { useCallback } from 'react'
import type { PackCard as Card } from '#/server/catalog/types'
import { Masonry } from '../Masonry'
import { PackCard } from '../PackCard'
import { WaveLoader } from '../Section'
import { type CardOptions, cardProps, cardShape } from './model'

// Masonry of pack cards (目录, 首页最新, 角色页, 画师页, 搜索). Heights are exact (packCardShape), so the
// server layout is the final layout. `priority` makes the first covers eager: they are the LCP.

export interface PackMasonryProps {
  cards: readonly Card[]
  options?: (card: Card, index: number) => CardOptions
  /** eager-load the covers of the first N cards */
  priority?: number
  label?: string
  onEndReached?: () => void
  loading?: boolean
  done?: boolean
  error?: boolean
  onRetry?: () => void
  /** shown when the list ended (only for paginated lists) */
  endText?: string
}

export function PackMasonry({ cards, options, priority = 0, label, onEndReached, loading, done, error, onRetry, endText }: PackMasonryProps) {
  const opts = useCallback((c: Card, i: number) => options?.(c, i) ?? {}, [options])
  const getShape = useCallback((c: Card, i: number) => cardShape(c, i, opts(c, i)), [opts])
  return (
    <>
      <Masonry
        items={cards}
        label={label}
        getKey={(c) => c.id}
        getShape={getShape}
        onEndReached={onEndReached}
        renderItem={(c, i) => <PackCard {...cardProps(c, i, opts(c, i))} priority={i < priority} />}
      />
      {onEndReached ? (
        <div className="loadmore" aria-live="polite">
          {error ? (
            <button type="button" className="btn sm" onClick={onRetry}>
              加载失败，点此重试
            </button>
          ) : loading ? (
            <>
              <WaveLoader />
              潮水正在涌上来…
            </>
          ) : done ? (
            <span className="list-end">{endText ?? `已显示全部 ${cards.length} 个`}</span>
          ) : (
            <span className="list-end">继续下滑加载</span>
          )}
        </div>
      ) : null}
    </>
  )
}
