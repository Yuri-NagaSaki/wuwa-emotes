import { useMemo, useState, type KeyboardEvent } from 'react'
import { Button } from '../Button'
import { Chip, Chips } from '../Chip'
import { Input } from '../Field'
import { Sheet } from '../Sheet'

// Pickers of the 投稿 form: characters from the catalog, and artists as tokens (catalog names become
// ids, anything else is kept as a name for the reviewer and created on approval).

export interface CharacterOption {
  id: number
  name: string
  color: string | null
}

export function CharacterPicker({ options, value, onChange, disabled }: { options: CharacterOption[]; value: number[]; onChange: (ids: number[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options])
  const shown = q.trim() ? options.filter((o) => o.name.includes(q.trim())) : options
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id].slice(0, 20))
  return (
    <>
      <Chips>
        {value.map((id) => {
          const c = byId.get(id)
          if (!c) return null
          return (
            <Chip key={id} size="sm" on removable={!disabled} disabled={disabled} onClick={() => toggle(id)} aria-label={`移除角色 ${c.name}`} style={c.color ? { background: c.color, borderColor: c.color, color: 'var(--tp-ink)' } : undefined}>
              {c.name}
            </Chip>
          )
        })}
        {disabled ? null : (
          <Chip size="sm" icon="plus" onClick={() => setOpen(true)}>
            {value.length ? '修改角色' : '添加角色'}
          </Chip>
        )}
      </Chips>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="选择角色"
        subtitle={`已选 ${value.length} 个`}
        icon="users"
        footer={
          <Button variant="primary" block onClick={() => setOpen(false)}>
            完成
          </Button>
        }
      >
        <Input icon="search" size="sm" placeholder="找角色" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
        <Chips>
          {shown.map((o) => (
            <Chip key={o.id} size="sm" on={value.includes(o.id)} onClick={() => toggle(o.id)}>
              {o.name}
            </Chip>
          ))}
          {shown.length ? null : <span className="hint">没有找到这个角色。可以先不选，在简介里写明。</span>}
        </Chips>
      </Sheet>
    </>
  )
}

export interface ArtistValue {
  ids: number[]
  names: string[]
}

export function ArtistTokens({ options, value, onChange, disabled }: { options: { id: number; name: string }[]; value: ArtistValue; onChange: (v: ArtistValue) => void; disabled?: boolean }) {
  const [text, setText] = useState('')
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options])
  const total = value.ids.length + value.names.length
  const suggestions = text.trim() ? options.filter((o) => o.name.toLowerCase().includes(text.trim().toLowerCase()) && !value.ids.includes(o.id)).slice(0, 6) : []

  function add(raw: string) {
    const name = raw.trim().slice(0, 40)
    if (!name || total >= 10) return
    const hit = options.find((o) => o.name.toLowerCase() === name.toLowerCase())
    if (hit) {
      if (!value.ids.includes(hit.id)) onChange({ ...value, ids: [...value.ids, hit.id] })
    } else if (!value.names.some((n) => n.toLowerCase() === name.toLowerCase())) {
      onChange({ ...value, names: [...value.names, name] })
    }
    setText('')
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
      e.preventDefault()
      add(text)
    } else if (e.key === 'Backspace' && !text && total) {
      if (value.names.length) onChange({ ...value, names: value.names.slice(0, -1) })
      else onChange({ ...value, ids: value.ids.slice(0, -1) })
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {total ? (
        <Chips>
          {value.ids.map((id) => (
            <Chip key={`a${id}`} size="sm" on removable={!disabled} disabled={disabled} onClick={() => onChange({ ...value, ids: value.ids.filter((x) => x !== id) })}>
              {byId.get(id)?.name ?? `#${id}`}
            </Chip>
          ))}
          {value.names.map((n) => (
            <Chip key={`n${n}`} size="sm" removable={!disabled} disabled={disabled} onClick={() => onChange({ ...value, names: value.names.filter((x) => x !== n) })} title="新画师：审核通过时加入画师名录">
              {n}
            </Chip>
          ))}
        </Chips>
      ) : null}
      {disabled ? null : (
        <Input
          icon="edit"
          placeholder={total ? '再加一位（回车确认）' : '画师名，回车确认'}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={onKey}
          onBlur={() => text.trim() && add(text)}
          aria-label="画师"
        />
      )}
      {suggestions.length ? (
        <Chips>
          {suggestions.map((s) => (
            <Chip key={s.id} size="sm" icon="plus" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s.name)}>
              {s.name}
            </Chip>
          ))}
        </Chips>
      ) : null}
    </div>
  )
}
