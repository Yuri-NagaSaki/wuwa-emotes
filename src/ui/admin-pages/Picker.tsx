import { useState } from 'react'
import type { Option } from '#/server/admin/types'
import { Button } from '../Button'
import { Chip } from '../Chip'
import { Input } from '../Field'
import { FilterPopover } from '../FilterPopover'

// Multi-select for characters, artists and tags: the chosen ones as removable chips, the rest in the
// kit's filter panel (a popover sized to its content; a bottom sheet on phones) with a search field.

export function Picker({
  label,
  options,
  value,
  onChange,
  addLabel = '添加',
  emptyHint,
}: {
  label: string
  options: readonly Option[]
  value: number[]
  onChange: (ids: number[]) => void
  addLabel?: string
  emptyHint?: string
}) {
  const [q, setQ] = useState('')
  const byId = new Map(options.map((o) => [o.id, o]))
  const chosen = value.map((id) => byId.get(id)).filter((o): o is Option => Boolean(o))
  const needle = q.trim().toLowerCase()
  const shown = options.filter((o) => !needle || o.name.toLowerCase().includes(needle) || o.slug?.includes(needle) || o.hint?.includes(needle)).slice(0, 80)
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  return (
    <div className="adm-picker">
      <div className="chips">
        {chosen.map((o) => (
          <Chip key={o.id} size="sm" on removable aria-label={`移除 ${o.name}`} onClick={() => toggle(o.id)}>
            {o.color ? <span className="adm-swatch" style={{ background: o.color, width: 12, height: 12, borderRadius: 4 }} aria-hidden="true" /> : null}
            {o.name}
          </Chip>
        ))}
        <FilterPopover
          label={addLabel}
          panelClassName="fpop-pick"
          header={<Input size="sm" icon="search" placeholder={`找${label}`} aria-label={`找${label}`} value={q} onChange={(e) => setQ(e.currentTarget.value)} />}
          footer={
            <>
              <span>已选 {value.length} 个</span>
              <Button size="xs" variant="ghost" onClick={() => onChange([])} disabled={!value.length}>
                清除
              </Button>
            </>
          }
        >
          <div className="adm-pick-list">
            {shown.map((o) => (
              <Chip key={o.id} size="sm" on={value.includes(o.id)} onClick={() => toggle(o.id)}>
                {o.name}
                {o.hint ? <span className="n">{o.hint}</span> : null}
              </Chip>
            ))}
            {!shown.length ? <span className="hint">没有匹配的{label}</span> : null}
          </div>
        </FilterPopover>
      </div>
      {!chosen.length && emptyHint ? <span className="hint">{emptyHint}</span> : null}
    </div>
  )
}
