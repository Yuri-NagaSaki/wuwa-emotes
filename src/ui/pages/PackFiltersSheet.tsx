import { useMemo, useState } from 'react'
import type { PackFacets } from '#/server/catalog/types'
import { Button } from '../Button'
import { Chip } from '../Chip'
import { Input } from '../Field'
import { Sheet } from '../Sheet'
import type { FilterKey, PackFilterState } from './filters'
import { characterColor, KIND_LABEL, SOURCE_LABEL } from './model'

// 表情包目录 on phones: every facet in one bottom sheet (the prototype's 筛选 drawer: 类型, 角色, 来源,
// then 画师 and 分组). A chip applies at once (the list behind updates); 重置 clears, 查看结果 closes.
// Loaded on first open.

const PHONE_CHARACTERS = 12

export interface PackFiltersSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: PackFilterState
  facets: PackFacets
  /** set one facet (null clears it) */
  onPick: <K extends FilterKey>(key: K, value: PackFilterState[K]) => void
  onClear: () => void
}

export default function PackFiltersSheet({ open, onOpenChange, state, facets: f, onPick, onClear }: PackFiltersSheetProps) {
  const [q, setQ] = useState('')
  const chars = useMemo(() => {
    const t = q.trim().toLowerCase()
    const all = [...f.characters].sort((a, b) => b.packCount - a.packCount)
    if (!t) return all.slice(0, PHONE_CHARACTERS)
    return all.filter((c) => c.name.toLowerCase().includes(t) || c.slug.toLowerCase().startsWith(t))
  }, [f.characters, q])
  const toggle = <K extends FilterKey>(key: K, value: NonNullable<PackFilterState[K]>) => onPick(key, (state[key] === value ? null : value) as PackFilterState[K])

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="筛选"
      className="filters-sheet"
      footer={
        <div className="fs-acts">
          <Button onClick={onClear}>重置</Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            查看结果
          </Button>
        </div>
      }
    >
      <section className="fs-sec">
        <h4>类型</h4>
        <div className="chips">
          <Chip size="sm" on={!state.kind} onClick={() => onPick('kind', null)}>
            全部
          </Chip>
          {f.kinds.map((k) => (
            <Chip key={k.kind} size="sm" on={state.kind === k.kind} count={k.packCount} onClick={() => toggle('kind', k.kind)}>
              {KIND_LABEL[k.kind] ?? k.kind}
            </Chip>
          ))}
        </div>
      </section>
      <section className="fs-sec">
        <h4>角色</h4>
        <Input size="sm" icon="search" placeholder="输入角色名或拼音" aria-label="筛选角色" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <div className="chips">
          {chars.map((c) => (
            <Chip key={c.slug} size="sm" on={state.character === c.slug} avatar={c.avatar ? { src: c.avatar, color: characterColor(c) } : null} onClick={() => toggle('character', c.slug)}>
              {c.name}
            </Chip>
          ))}
          {!chars.length ? <span className="muted">没有叫「{q}」的角色</span> : null}
        </div>
      </section>
      <section className="fs-sec">
        <h4>来源</h4>
        <div className="chips">
          {f.sources.map((s) => (
            <Chip key={s.sourceKind} size="sm" on={state.source === s.sourceKind} count={s.packCount} onClick={() => toggle('source', s.sourceKind)}>
              {SOURCE_LABEL[s.sourceKind] ?? s.sourceKind}
            </Chip>
          ))}
        </div>
      </section>
      {f.artists.length ? (
        <section className="fs-sec">
          <h4>画师</h4>
          <div className="chips">
            {f.artists.map((a) => (
              <Chip key={a.slug} size="sm" on={state.artist === a.slug} count={a.packCount} onClick={() => toggle('artist', a.slug)}>
                {a.name}
              </Chip>
            ))}
          </div>
        </section>
      ) : null}
      {f.tags.group.length ? (
        <section className="fs-sec">
          <h4>分组</h4>
          <div className="chips">
            {f.tags.group.map((g) => (
              <Chip key={g.slug} size="sm" on={state.group === g.slug} count={g.packCount} onClick={() => toggle('group', g.slug)}>
                {g.name}
              </Chip>
            ))}
          </div>
        </section>
      ) : null}
    </Sheet>
  )
}
