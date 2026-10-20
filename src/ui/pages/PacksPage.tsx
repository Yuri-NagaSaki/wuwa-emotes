import { useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useMemo, useRef, useState, type FormEvent } from 'react'
import { packsFn } from '#/server/catalog/fns'
import type { PacksPageData } from '#/server/catalog/types'
import { Chip } from '../Chip'
import { cx } from '../cx'
import { Input } from '../Field'
import { fmtN } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { Seg } from '../Seg'
import { PHONE_QUERY, useMediaQuery } from '../useMediaQuery'
import {
  activeFilters,
  clearFilters,
  type FilterKey,
  hasFilters,
  listInputFor,
  type PackFilterState,
  setFilter,
  setSort,
  SORTS,
  toPackSearch,
} from './filters'
import { LazyFilterPopover as FilterPopover } from './LazyFilterPopover'
import { KIND_LABEL, SOURCE_LABEL, characterColor } from './model'
import { PackMasonry } from './PackMasonry'
import { useCursorList } from './useCursorList'

// 表情包目录 /packs: top filter bar (search, five facet chips with content-sized panels; on phones every
// chip opens one combined 筛选 sheet), active-filter chips, sort, and an infinitely loading masonry.
// The URL holds the state.

const COMMON_CHARACTERS = 30
const PackFiltersSheet = lazy(() => import('./PackFiltersSheet'))

export function PacksPage({ data, state }: { data: PacksPageData; state: PackFilterState }) {
  const navigate = useNavigate()
  const barRef = useRef<HTMLDivElement>(null)
  const [openFacet, setOpenFacet] = useState<FilterKey | null>(null)
  const [charQuery, setCharQuery] = useState('')
  const phone = useMediaQuery(PHONE_QUERY)
  // phones: the combined sheet (mounted on first open, kept for its closing animation)
  const [sheet, setSheet] = useState<'closed' | 'open' | 'mounted'>('closed')
  const f = data.facets
  const list = useCursorList(data.page, (cursor) => packsFn({ data: listInputFor(state, cursor) }))

  const apply = (next: PackFilterState) => {
    setOpenFacet(null)
    void navigate({ to: '/packs', search: toPackSearch(next), resetScroll: false })
  }
  const pick = <K extends FilterKey>(key: K, value: PackFilterState[K]) => apply(setFilter(state, key, value))
  const active = activeFilters(state, f)
  const official = f.sources.find((s) => s.sourceKind === 'official')?.packCount ?? 0

  const chars = useMemo(() => {
    const q = charQuery.trim().toLowerCase()
    const all = [...f.characters].sort((a, b) => b.packCount - a.packCount)
    if (!q) return all.slice(0, COMMON_CHARACTERS)
    return all.filter((c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().startsWith(q))
  }, [f.characters, charQuery])

  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const q = String(new FormData(e.currentTarget).get('q') ?? '').trim()
    if (q) void navigate({ to: '/search', search: { q } })
  }

  const facetProps = (key: FilterKey, label: string, value: string | undefined) => ({
    label,
    value,
    open: openFacet === key,
    onOpenChange: (o: boolean) => setOpenFacet(o ? key : null),
    anchor: barRef,
  })
  const done = (
    <button type="button" className="btn xs" onClick={() => setOpenFacet(null)}>
      完成
    </button>
  )
  const nameOf = (key: FilterKey) => active.find((a) => a.key === key)?.label

  return (
    <div className="wrap">
      <div className="page-h">
        <nav className="crumbs" aria-label="位置">
          <AppLink to="/">首页</AppLink>
          <Icon name="right" />
          <span aria-current="page">表情包</span>
        </nav>
        <h1>表情包</h1>
        <div className="row">
          <span className="sub">
            共 {fmtN(f.total)} 个{official ? ` · 官方转载 ${official} 个` : ''}
          </span>
        </div>
      </div>

      <div className="filterbar" ref={barRef}>
        <div className="fb-row">
          <form className="fb-search" role="search" onSubmit={search}>
            <Input name="q" size="sm" icon="search" placeholder="搜索包名、角色或画师" aria-label="搜索包名、角色或画师" enterKeyHint="search" />
          </form>
          <div className="fb-facets">
            {phone ? (
              <>
                {(
                  [
                    ['character', '角色'],
                    ['artist', '画师'],
                    ['kind', '类型'],
                    ['source', '来源'],
                    ...(f.tags.group.length ? [['group', '分组'] as const] : []),
                  ] as const
                ).map(([key, label]) => (
                  <button key={key} type="button" className={cx('fchip', nameOf(key) ? 'is-set' : null)} aria-haspopup="dialog" onClick={() => setSheet('open')}>
                    {label}
                    {nameOf(key) ? <b>{nameOf(key)}</b> : null}
                    <Icon name="down" size="sm" />
                  </button>
                ))}
              </>
            ) : (
              <>
            <FilterPopover
              {...facetProps('character', '角色', nameOf('character'))}
              header={
                <Input
                  size="sm"
                  icon="search"
                  placeholder="输入角色名或拼音"
                  aria-label="筛选角色"
                  value={charQuery}
                  onChange={(e) => setCharQuery(e.currentTarget.value)}
                />
              }
              footer={
                <>
                  <span>{charQuery ? `找到 ${chars.length} 位` : `常用 ${Math.min(COMMON_CHARACTERS, f.characters.length)} 位 · 共 ${f.characters.length} 位，输入可搜索全部`}</span>
                  {done}
                </>
              }
            >
              <div className="fpop-grid c5">
                {chars.map((c) => (
                  <Chip
                    key={c.slug}
                    size="sm"
                    on={state.character === c.slug}
                    count={c.packCount}
                    avatar={c.avatar ? { src: c.avatar, color: characterColor(c) } : null}
                    onClick={() => pick('character', c.slug)}
                  >
                    {c.name}
                  </Chip>
                ))}
                {!chars.length ? <span className="fpop-more">没有叫「{charQuery}」的角色</span> : null}
              </div>
            </FilterPopover>
            <FilterPopover {...facetProps('artist', '画师', nameOf('artist'))} footer={<><span>{f.artists.length} 位画师与约稿人，按包数排序</span>{done}</>}>
              <div className="fpop-grid c3">
                {f.artists.map((a) => (
                  <Chip key={a.slug} size="sm" on={state.artist === a.slug} count={a.packCount} onClick={() => pick('artist', a.slug)}>
                    {a.name}
                  </Chip>
                ))}
              </div>
            </FilterPopover>
            <FilterPopover {...facetProps('kind', '类型', nameOf('kind'))} panelClassName="fpop-type" anchor={undefined}>
              <div className="fpop-grid c3">
                <Chip size="sm" on={!state.kind} onClick={() => apply({ ...state, kind: null })}>
                  全部
                </Chip>
                {f.kinds.map((k) => (
                  <Chip key={k.kind} size="sm" on={state.kind === k.kind} count={k.packCount} onClick={() => pick('kind', k.kind)}>
                    {KIND_LABEL[k.kind] ?? k.kind}
                  </Chip>
                ))}
              </div>
            </FilterPopover>
            <FilterPopover {...facetProps('source', '来源', nameOf('source'))} panelClassName="fpop-source" anchor={undefined}>
              <div className="fpop-grid c3">
                <Chip size="sm" on={!state.source} onClick={() => apply({ ...state, source: null })}>
                  全部
                </Chip>
                {f.sources.map((s) => (
                  <Chip key={s.sourceKind} size="sm" on={state.source === s.sourceKind} count={s.packCount} onClick={() => pick('source', s.sourceKind)}>
                    {SOURCE_LABEL[s.sourceKind] ?? s.sourceKind}
                  </Chip>
                ))}
              </div>
            </FilterPopover>
            {f.tags.group.length ? (
              <FilterPopover {...facetProps('group', '分组', nameOf('group'))} panelClassName="fpop-group" anchor={undefined}>
                <div className="fpop-grid c3">
                  {f.tags.group.map((g) => (
                    <Chip key={g.slug} size="sm" on={state.group === g.slug} count={g.packCount} onClick={() => pick('group', g.slug)}>
                      {g.name}
                    </Chip>
                  ))}
                </div>
              </FilterPopover>
            ) : null}
              </>
            )}
          </div>
          <Seg size="sm" label="排序" options={SORTS} value={state.sort} onChange={(v) => apply(setSort(state, v))} />
        </div>
        <div className="active-filters">
          {active.length ? (
            <>
              <span>筛选中：</span>
              {active.map((a) => (
                <Chip key={a.key} size="sm" on removable aria-label={`移除筛选 ${a.facet} ${a.label}`} onClick={() => apply({ ...state, [a.key]: null })}>
                  {a.facet} · {a.label}
                </Chip>
              ))}
              {hasFilters(state) ? (
                <button type="button" className="clear" onClick={() => apply(clearFilters(state))}>
                  清除全部
                </button>
              ) : null}
            </>
          ) : (
            <span>全部 {fmtN(f.total)} 个表情包</span>
          )}
        </div>
      </div>

      {sheet !== 'closed' ? (
        <Suspense fallback={null}>
          <PackFiltersSheet
            open={sheet === 'open'}
            onOpenChange={(o) => setSheet(o ? 'open' : 'mounted')}
            state={state}
            facets={f}
            onPick={(key, value) => void navigate({ to: '/packs', search: toPackSearch(setFilter(state, key, value)), resetScroll: false })}
            onClear={() => void navigate({ to: '/packs', search: toPackSearch(clearFilters(state)), resetScroll: false })}
          />
        </Suspense>
      ) : null}

      {list.items.length ? (
        <PackMasonry
          cards={list.items}
          label="表情包"
          priority={4}
          onEndReached={list.loadMore}
          loading={list.loading}
          done={list.done}
          error={list.error}
          onRetry={list.loadMore}
          endText={`已显示全部 ${list.items.length} 个表情包`}
        />
      ) : (
        <EmptyFilters onClear={() => apply(clearFilters(state))} />
      )}
    </div>
  )
}

function EmptyFilters({ onClear }: { onClear: () => void }) {
  return (
    <div className="empty">
      <span className="empty-ico">
        <Icon name="filter" size="lg" />
      </span>
      <h3>没有符合条件的表情包</h3>
      <p>换个角色或类型试试，或者清除筛选看看全部。</p>
      <button type="button" className="btn sm" onClick={onClear}>
        清除筛选
      </button>
    </div>
  )
}

