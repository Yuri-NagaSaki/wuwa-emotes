import { useState, type ReactNode } from 'react'
import { adminDeleteTaxonomyFn, adminMergeTaxonomyFn, adminSaveArtistFn, adminSaveCharacterFn, adminSaveTagFn } from '#/server/admin/fns/taxonomy'
import { PALETTE } from '#/server/admin/inputs'
import type { ArtistRow, CharacterRow, TagDimension, TagRow } from '#/server/admin/types'
import { Button } from '../Button'
import { Check, Field, Input } from '../Field'
import { fmtN } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { Modal, ModalClose } from '../Modal'
import { Seg } from '../Seg'
import { Sheet } from '../Sheet'
import { Kpi, PageHead, Panel, SelectField, useAction } from './bits'
import { swatch } from './swatch'

// 角色 · 画师 · 标签: lists with counts, an edit drawer, and the merge tool (A → B: links, aliases and
// old URLs move to B; A is deleted).

type Kind = 'character' | 'artist' | 'tag'
const KIND_NAME: Record<Kind, string> = { character: '角色', artist: '画师', tag: '标签' }

export const DIMENSIONS: Record<TagDimension, string> = { group: '分组', tool: '工具', project: '企划', origin: '原设', custom: '自定义' }

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="filters">
      <Input size="sm" icon="search" wrapClassName="adm-search" placeholder={placeholder} aria-label={placeholder} value={value} onChange={(e) => onChange(e.currentTarget.value)} />
    </div>
  )
}

function matches(q: string, ...texts: (string | null | undefined)[]): boolean {
  const n = q.trim().toLowerCase()
  return !n || texts.some((t) => t?.toLowerCase().includes(n))
}

// ---------- merge ----------

interface MergeOption {
  id: number
  name: string
  slug: string
  count: number
  avatar?: string | null
}

function MergePanel({ kind, options, from, to, setFrom, setTo, onClose }: { kind: Kind; options: MergeOption[]; from: number | null; to: number | null; setFrom: (v: number | null) => void; setTo: (v: number | null) => void; onClose: () => void }) {
  const { run, busy } = useAction()
  const [keepName, setKeepName] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const a = options.find((o) => o.id === from)
  const b = options.find((o) => o.id === to)
  const opts = [{ value: '', label: `选择${KIND_NAME[kind]}` }, ...options.map((o) => ({ value: String(o.id), label: `${o.name}（${o.count}）` }))]
  const card = (o: MergeOption | undefined, value: number | null, set: (v: number | null) => void, label: string, note: ReactNode) => (
    <div className="card">
      {o && kind === 'character' ? (
        <span className="avatar lg">{o.avatar ? <img src={o.avatar} alt="" /> : [...o.name][0]}</span>
      ) : null}
      <SelectField plain label={label} value={value == null ? '' : String(value)} onChange={(v) => set(v ? Number(v) : null)} options={opts} />
      {o ? (
        <>
          <b>
            {o.name} <span className="slug-ok">{o.slug}</span>
          </b>
          <span className="hint">{note}</span>
        </>
      ) : null}
    </div>
  )
  return (
    <Panel title={`合并${KIND_NAME[kind]}`} acts={<Button size="xs" variant="ghost" onClick={onClose}>收起</Button>}>
      <div className="merge-flow">
        {card(a, from, setFrom, '被合并（删除）', a ? `${a.count} 个包 · ${keepName ? '名称保留为别名' : '名称不保留'}${kind !== 'tag' ? ' · 旧链接 301' : ''}` : null)}
        <span className="merge-arrow">
          <Icon name="arrow" />
        </span>
        {card(b, to, setTo, '合并到（保留）', b ? `合并后约 ${(a?.count ?? 0) + b.count} 个包（重复的只算一次）` : null)}
      </div>
      <div className="adm-merge-acts">
        {kind !== 'tag' ? (
          <Check checked={keepName} onChange={setKeepName}>
            把被合并的名称保留为别名（搜索仍能找到）
          </Check>
        ) : null}
        <Button size="sm" variant="primary" icon="merge" disabled={!a || !b || a.id === b.id || busy != null} onClick={() => setConfirm(true)}>
          确认合并
        </Button>
      </div>
      <Modal
        open={confirm}
        onOpenChange={setConfirm}
        icon="merge"
        title={`确认合并${KIND_NAME[kind]}？`}
        actions={
          <>
            <ModalClose render={<Button size="sm" variant="ghost" />}>取消</ModalClose>
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                const r = await run('merge', () => adminMergeTaxonomyFn({ data: { kind, fromId: a!.id, toId: b!.id, keepName } }), (x) => `已合并：移动 ${x.packsMoved} 个包${x.emojisMoved ? `、${x.emojisMoved} 张表情` : ''}、${x.aliasesMoved} 个别名`)
                setConfirm(false)
                if (r) {
                  setFrom(null)
                  onClose()
                }
              }}
            >
              合并
            </Button>
          </>
        }
      >
        「{a?.name}」→「{b?.name}」。
        {kind === 'tag'
          ? '包的标签关联移到保留的标签上，然后删除被合并的标签。'
          : '包和表情的关联、别名移到保留的一方，旧地址 301 到新地址，然后删除被合并的条目。这个操作不能撤销。'}
      </Modal>
    </Panel>
  )
}

// ---------- aliases ----------

function AliasEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState('')
  const add = () => {
    const t = text.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setText('')
  }
  return (
    <div className="adm-section">
      <div className="chips">
        {value.map((a) => (
          <button key={a} type="button" className="chip sm" onClick={() => onChange(value.filter((x) => x !== a))} aria-label={`移除别名 ${a}`}>
            {a}
            <span className="x" aria-hidden="true">
              <Icon name="close" size="sm" />
            </span>
          </button>
        ))}
        {!value.length ? <span className="hint">还没有别名</span> : null}
      </div>
      <div className="adm-alias-input">
        <Input
          size="sm"
          placeholder="输入别名后回车"
          aria-label="新别名"
          value={text}
          maxLength={40}
          onChange={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button size="sm" onClick={add} disabled={!text.trim()}>
          添加
        </Button>
      </div>
    </div>
  )
}

function SlugField({ value, onChange, suggested, base }: { value: string; onChange: (v: string) => void; suggested: string | null; base: string }) {
  return (
    <Field
      label="slug"
      hint={
        <>
          地址 {base}/{value || '…'}；修改后旧地址自动 301
          {suggested && suggested !== value ? (
            <>
              {' '}
              · 建议{' '}
              <button type="button" className="slug-ok" onClick={() => onChange(suggested)}>
                {suggested}
              </button>
            </>
          ) : null}
        </>
      }
    >
      <Input value={value} maxLength={100} placeholder="留空则按名称生成拼音" onChange={(e) => onChange(e.currentTarget.value.toLowerCase())} />
    </Field>
  )
}

function SlugCell({ slug, bad, suggested }: { slug: string; bad: boolean; suggested: string | null }) {
  if (!bad) return <span className="slug-ok">{slug}</span>
  return (
    <>
      <span className="slug-bad">{slug.length > 26 ? slug.slice(0, 24) + '…' : slug}</span>
      {suggested ? <span className="hint"> 建议 {suggested}</span> : null}
    </>
  )
}

// ---------- 角色 ----------

interface CharForm {
  id?: number
  name: string
  slug: string
  themeColor: string | null
  avatarEmojiId: string
  aliases: string[]
  suggested: string | null
  removable: boolean
}

export function CharactersPage({ rows }: { rows: CharacterRow[] }) {
  const { run, busy } = useAction()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<CharForm | null>(null)
  const [merging, setMerging] = useState(false)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const shown = rows.filter((r) => matches(q, r.name, r.slug, ...r.aliases))
  const hash = rows.filter((r) => r.hashSlug).length

  const openEdit = (r?: CharacterRow) =>
    setEdit(
      r
        ? { id: r.id, name: r.name, slug: r.slug, themeColor: r.themeColor, avatarEmojiId: r.avatarEmojiId ?? '', aliases: r.aliases, suggested: r.suggestedSlug, removable: r.packCount + r.emojiCount === 0 }
        : { name: '', slug: '', themeColor: null, avatarEmojiId: '', aliases: [], suggested: null, removable: false },
    )

  async function save() {
    if (!edit) return
    const r = await run(
      'save',
      () =>
        adminSaveCharacterFn({
          data: {
            id: edit.id,
            name: edit.name.trim(),
            slug: edit.slug.trim() || undefined,
            themeColor: edit.themeColor,
            avatarEmojiId: edit.avatarEmojiId.trim() || null,
            aliases: edit.aliases,
          },
        }),
      edit.id ? '已保存' : '已新建',
    )
    if (r) setEdit(null)
  }

  return (
    <>
      <PageHead
        title="角色"
        sub={`${fmtN(rows.length)} 个角色 · ${fmtN(hash)} 个哈希 slug 待清洗`}
        actions={
          <>
            <Button size="sm" icon="merge" on={merging} onClick={() => setMerging((m) => !m)}>
              合并角色
            </Button>
            <Button size="sm" variant="primary" icon="plus" onClick={() => openEdit()}>
              新建角色
            </Button>
          </>
        }
      />
      {merging ? (
        <MergePanel
          kind="character"
          options={rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, count: r.packCount, avatar: r.avatar }))}
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          onClose={() => setMerging(false)}
        />
      ) : null}
      <SearchBox value={q} onChange={setQ} placeholder="名称、slug 或别名" />
      <Panel title="角色列表" flush acts={<span className="hint">按标注计数，含未发布的包；前台按逐张归属计数</span>}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>角色</th>
                <th>slug</th>
                <th className="col-opt">别名</th>
                <th className="col-opt">主题色</th>
                <th className="n">标注包</th>
                <th className="n col-opt">标注表情</th>
                <th>
                  <span className="sr">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!shown.length ? (
                <tr className="adm-empty-row">
                  <td colSpan={7}>没有符合条件的角色</td>
                </tr>
              ) : null}
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="cell">
                      <span className="avatar sm" style={{ borderColor: r.themeColor ?? undefined }}>
                        {r.avatar ? <img src={r.avatar} alt="" /> : [...r.name][0]}
                      </span>
                      <b>{r.name}</b>
                    </div>
                  </td>
                  <td>
                    <SlugCell slug={r.slug} bad={r.hashSlug} suggested={r.suggestedSlug} />
                  </td>
                  <td className="col-opt muted">{r.aliases.length ? r.aliases.slice(0, 3).join('、') + (r.aliases.length > 3 ? ` 等 ${r.aliases.length} 个` : '') : '—'}</td>
                  <td className="col-opt">{r.themeColor ? <i className="adm-swatch" style={{ background: swatch(r.themeColor) }} aria-label="主题色" title={r.themeColor} /> : <span className="muted">—</span>}</td>
                  <td className="n">
                    {fmtN(r.packCount)}
                    {r.publishedPackCount !== r.packCount ? <span className="sub">已发布 {r.publishedPackCount}</span> : null}
                  </td>
                  <td className="n col-opt">{r.emojiCount ? fmtN(r.emojiCount) : '—'}</td>
                  <td>
                    <div className="row-acts">
                      <button type="button" className="ibtn" aria-label={`编辑 ${r.name}`} title="编辑" onClick={() => openEdit(r)}>
                        <Icon name="edit" />
                      </button>
                      <button
                        type="button"
                        className="ibtn"
                        aria-label={`合并 ${r.name}`}
                        title="合并到其他角色"
                        onClick={() => {
                          setFrom(r.id)
                          setMerging(true)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                      >
                        <Icon name="merge" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Sheet
        open={edit != null}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit?.id ? '编辑角色' : '新建角色'}
        footer={
          <div className="adm-inline">
            {edit?.id && edit.removable ? (
              <Button size="sm" variant="ghost" icon="trash" disabled={busy != null} onClick={() => run('del', () => adminDeleteTaxonomyFn({ data: { kind: 'character', id: edit.id! } }), '已删除').then((r) => r && setEdit(null))}>
                删除
              </Button>
            ) : null}
            <Button size="sm" variant="primary" icon="check" block disabled={!edit?.name.trim() || busy != null} onClick={save}>
              保存
            </Button>
          </div>
        }
      >
        {edit ? (
          <>
            <Field label="名称">
              <Input value={edit.name} maxLength={40} onChange={(e) => setEdit({ ...edit, name: e.currentTarget.value })} />
            </Field>
            <SlugField value={edit.slug} onChange={(slug) => setEdit({ ...edit, slug })} suggested={edit.suggested} base="/characters" />
            <div className="field">
              <span className="lab">别名</span>
              <AliasEditor value={edit.aliases} onChange={(aliases) => setEdit({ ...edit, aliases })} />
            </div>
            <div className="field">
              <span className="lab">主题色</span>
              <div className="swatches" role="group" aria-label="主题色">
                <button type="button" className="none" aria-pressed={edit.themeColor == null} aria-label="不设置" onClick={() => setEdit({ ...edit, themeColor: null })} />
                {PALETTE.map((c) => {
                  const v = `var(--c-${c})`
                  return <button key={c} type="button" aria-pressed={edit.themeColor === v} aria-label={c} style={{ background: v }} onClick={() => setEdit({ ...edit, themeColor: v })} />
                })}
              </div>
              <span className="hint">驱动前台角色页与标签的配色</span>
            </div>
            <Field label="头像表情" hint="填表情 ID（r-…），可在表情库的详情里找到；留空则自动选用">
              <Input value={edit.avatarEmojiId} maxLength={22} placeholder="r-0123456789abcdef0123" onChange={(e) => setEdit({ ...edit, avatarEmojiId: e.currentTarget.value.trim() })} />
            </Field>
          </>
        ) : null}
      </Sheet>
    </>
  )
}

// ---------- 画师 ----------

interface ArtistForm {
  id?: number
  name: string
  slug: string
  aliases: string[]
  links: { label: string; url: string }[]
  suggested: string | null
  removable: boolean
}

export function ArtistsPage({ rows }: { rows: ArtistRow[] }) {
  const { run, busy } = useAction()
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<ArtistForm | null>(null)
  const [merging, setMerging] = useState(false)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const shown = rows.filter((r) => matches(q, r.name, r.slug, ...r.aliases))
  const untrimmed = rows.filter((r) => r.untrimmed)

  const openEdit = (r?: ArtistRow) =>
    setEdit(
      r
        ? { id: r.id, name: r.name.trim().replace(/\s{2,}/g, ' '), slug: r.slug, aliases: r.aliases, links: r.links, suggested: r.suggestedSlug, removable: r.packCount + r.commissionCount === 0 }
        : { name: '', slug: '', aliases: [], links: [], suggested: null, removable: false },
    )

  async function save() {
    if (!edit) return
    const links = edit.links.filter((l) => l.label.trim() && l.url.trim())
    const r = await run('save', () => adminSaveArtistFn({ data: { id: edit.id, name: edit.name.trim(), slug: edit.slug.trim() || undefined, aliases: edit.aliases, links } }), edit.id ? '已保存' : '已新建')
    if (r) setEdit(null)
  }

  return (
    <>
      <PageHead
        title="画师"
        sub={`${fmtN(rows.length)} 位画师 · 署名、CREDITS.txt 和画师页都以这里为准`}
        actions={
          <>
            <Button size="sm" icon="merge" on={merging} onClick={() => setMerging((m) => !m)}>
              合并画师
            </Button>
            <Button size="sm" variant="primary" icon="plus" onClick={() => openEdit()}>
              新建画师
            </Button>
          </>
        }
      />
      {untrimmed.length ? (
        <div className="alert-box">
          <Icon name="warn" />
          <div>
            <b>有 {untrimmed.length} 位画师的名称带多余空格</b>
            <span className="muted">打开编辑后直接保存即可去掉；拼写变体可以合并，旧名称会保留为别名。</span>
          </div>
        </div>
      ) : null}
      {merging ? (
        <MergePanel
          kind="artist"
          options={rows.map((r) => ({ id: r.id, name: r.name.trim(), slug: r.slug, count: r.packCount + r.commissionCount }))}
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          onClose={() => setMerging(false)}
        />
      ) : null}
      <SearchBox value={q} onChange={setQ} placeholder="名称、slug 或别名" />
      <Panel title="画师列表" flush>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>画师</th>
                <th>slug</th>
                <th className="col-opt">别名</th>
                <th className="n">包</th>
                <th className="n col-opt">约稿</th>
                <th className="col-opt">外链</th>
                <th>
                  <span className="sr">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!shown.length ? (
                <tr className="adm-empty-row">
                  <td colSpan={7}>没有符合条件的画师</td>
                </tr>
              ) : null}
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="cell">
                      <span className="avatar sm">{[...r.name.trim()][0] ?? '?'}</span>
                      <div style={{ minWidth: 0 }}>
                        <b>{r.name.trim()}</b>
                        {r.untrimmed ? <span className="slug-bad">名称含多余空格</span> : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <SlugCell slug={r.slug} bad={r.hashSlug} suggested={r.suggestedSlug} />
                  </td>
                  <td className="col-opt muted">{r.aliases.length ? r.aliases.join('、') : '—'}</td>
                  <td className="n">{fmtN(r.packCount)}</td>
                  <td className="n col-opt">{r.commissionCount ? fmtN(r.commissionCount) : '—'}</td>
                  <td className="col-opt">{r.links.length ? r.links.map((l) => l.label).join('、') : <span className="st mute">未填写</span>}</td>
                  <td>
                    <div className="row-acts">
                      <button type="button" className="ibtn" aria-label={`编辑 ${r.name.trim()}`} title="编辑" onClick={() => openEdit(r)}>
                        <Icon name="edit" />
                      </button>
                      <button
                        type="button"
                        className="ibtn"
                        aria-label={`合并 ${r.name.trim()}`}
                        title="合并到其他画师"
                        onClick={() => {
                          setFrom(r.id)
                          setMerging(true)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                      >
                        <Icon name="merge" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Sheet
        open={edit != null}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit?.id ? '编辑画师' : '新建画师'}
        footer={
          <div className="adm-inline">
            {edit?.id && edit.removable ? (
              <Button size="sm" variant="ghost" icon="trash" disabled={busy != null} onClick={() => run('del', () => adminDeleteTaxonomyFn({ data: { kind: 'artist', id: edit.id! } }), '已删除').then((r) => r && setEdit(null))}>
                删除
              </Button>
            ) : null}
            <Button size="sm" variant="primary" icon="check" block disabled={!edit?.name.trim() || busy != null} onClick={save}>
              保存
            </Button>
          </div>
        }
      >
        {edit ? (
          <>
            <Field label="正式名称" hint="署名统一显示这个名称">
              <Input value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.currentTarget.value })} />
            </Field>
            <SlugField value={edit.slug} onChange={(slug) => setEdit({ ...edit, slug })} suggested={edit.suggested} base="/artists" />
            <div className="field">
              <span className="lab">别名与拼写变体</span>
              <AliasEditor value={edit.aliases} onChange={(aliases) => setEdit({ ...edit, aliases })} />
            </div>
            <div className="field">
              <span className="lab">外链</span>
              <div className="adm-links">
                {edit.links.map((l, i) => (
                  <div key={i} className="row">
                    <Input size="sm" placeholder="名称（如 B 站）" aria-label="外链名称" value={l.label} maxLength={30} onChange={(e) => setEdit({ ...edit, links: edit.links.map((x, j) => (j === i ? { ...x, label: e.currentTarget.value } : x)) })} />
                    <Input size="sm" placeholder="https://" aria-label="外链地址" value={l.url} maxLength={500} onChange={(e) => setEdit({ ...edit, links: edit.links.map((x, j) => (j === i ? { ...x, url: e.currentTarget.value } : x)) })} />
                    <button type="button" className="ibtn" aria-label="移除这个外链" onClick={() => setEdit({ ...edit, links: edit.links.filter((_, j) => j !== i) })}>
                      <Icon name="close" />
                    </button>
                  </div>
                ))}
                <Button size="xs" icon="plus" onClick={() => setEdit({ ...edit, links: [...edit.links, { label: '', url: '' }] })} disabled={edit.links.length >= 10}>
                  添加外链
                </Button>
              </div>
            </div>
          </>
        ) : null}
      </Sheet>
    </>
  )
}

// ---------- 标签 ----------

interface TagForm {
  id?: number
  dimension: TagDimension
  name: string
  slug: string
  packs: number
}

export function TagsPage({ rows }: { rows: TagRow[] }) {
  const { run, busy } = useAction()
  const [dim, setDim] = useState<TagDimension | 'all'>('all')
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState<TagForm | null>(null)
  const [merging, setMerging] = useState(false)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [del, setDel] = useState<TagRow | null>(null)
  const shown = rows.filter((r) => (dim === 'all' || r.dimension === dim) && matches(q, r.name, r.slug))
  const count = (d: TagDimension) => rows.filter((r) => r.dimension === d).length

  async function save() {
    if (!edit) return
    const r = await run('save', () => adminSaveTagFn({ data: { id: edit.id, dimension: edit.dimension, name: edit.name.trim(), slug: edit.slug.trim() || undefined } }), edit.id ? '已保存' : '已新建')
    if (r) setEdit(null)
  }

  return (
    <>
      <PageHead
        title="标签"
        sub="源站的 Halo 标签按维度拆分；角色和画师由各自的表驱动"
        actions={
          <>
            <Button size="sm" icon="merge" on={merging} onClick={() => setMerging((m) => !m)}>
              合并标签
            </Button>
            <Button size="sm" variant="primary" icon="plus" onClick={() => setEdit({ dimension: dim === 'all' ? 'custom' : dim, name: '', slug: '', packs: 0 })}>
              新建标签
            </Button>
          </>
        }
      />
      <div className="kpis">
        {(Object.keys(DIMENSIONS) as TagDimension[]).map((d) => (
          <Kpi key={d} icon="hash" label={DIMENSIONS[d]} value={fmtN(count(d))} note={`${fmtN(rows.filter((r) => r.dimension === d).reduce((a, r) => a + r.packCount, 0))} 个包次`} />
        ))}
      </div>
      {merging ? (
        <MergePanel kind="tag" options={rows.map((r) => ({ id: r.id, name: `${DIMENSIONS[r.dimension]} · ${r.name}`, slug: r.slug, count: r.packCount }))} from={from} to={to} setFrom={setFrom} setTo={setTo} onClose={() => setMerging(false)} />
      ) : null}
      <div className="filters">
        <Seg
          size="sm"
          label="维度"
          value={dim}
          onChange={setDim}
          options={[{ value: 'all', label: '全部' }, ...(Object.keys(DIMENSIONS) as TagDimension[]).map((d) => ({ value: d, label: DIMENSIONS[d] }))]}
        />
        <Input size="sm" icon="search" wrapClassName="adm-search" placeholder="名称或 slug" aria-label="搜索标签" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      </div>
      <Panel title="标签列表" flush>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>名称</th>
                <th>维度</th>
                <th className="col-opt">slug</th>
                <th className="n">包</th>
                <th>
                  <span className="sr">操作</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {!shown.length ? (
                <tr className="adm-empty-row">
                  <td colSpan={5}>没有符合条件的标签</td>
                </tr>
              ) : null}
              {shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <b>{r.name}</b>
                  </td>
                  <td>
                    <span className="st mute">{DIMENSIONS[r.dimension]}</span>
                  </td>
                  <td className="col-opt">
                    <span className="slug-ok">{r.slug}</span>
                  </td>
                  <td className="n">
                    {r.packCount ? (
                      <AppLink to={`/admin/packs?q=${encodeURIComponent(r.name)}`} className="muted">
                        {fmtN(r.packCount)}
                      </AppLink>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <div className="row-acts">
                      <button type="button" className="ibtn" aria-label={`编辑 ${r.name}`} title="编辑" onClick={() => setEdit({ id: r.id, dimension: r.dimension, name: r.name, slug: r.slug, packs: r.packCount })}>
                        <Icon name="edit" />
                      </button>
                      <button
                        type="button"
                        className="ibtn"
                        aria-label={`合并 ${r.name}`}
                        title="合并到其他标签"
                        onClick={() => {
                          setFrom(r.id)
                          setMerging(true)
                          window.scrollTo({ top: 0, behavior: 'smooth' })
                        }}
                      >
                        <Icon name="merge" />
                      </button>
                      <button type="button" className="ibtn" aria-label={`删除 ${r.name}`} title="删除" onClick={() => setDel(r)}>
                        <Icon name="trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Sheet
        open={edit != null}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit?.id ? '编辑标签' : '新建标签'}
        footer={
          <Button size="sm" variant="primary" icon="check" block disabled={!edit?.name.trim() || busy != null} onClick={save}>
            保存
          </Button>
        }
      >
        {edit ? (
          <>
            <div className="field">
              <span className="lab">维度</span>
              <Seg size="sm" label="维度" value={edit.dimension} onChange={(dimension) => setEdit({ ...edit, dimension })} options={(Object.keys(DIMENSIONS) as TagDimension[]).map((d) => ({ value: d, label: DIMENSIONS[d] }))} />
            </div>
            <Field label="名称">
              <Input value={edit.name} maxLength={40} onChange={(e) => setEdit({ ...edit, name: e.currentTarget.value })} />
            </Field>
            <Field label="slug" hint="同一维度内唯一；留空则按名称生成拼音">
              <Input value={edit.slug} maxLength={100} onChange={(e) => setEdit({ ...edit, slug: e.currentTarget.value.toLowerCase() })} />
            </Field>
          </>
        ) : null}
      </Sheet>

      <Modal
        open={del != null}
        onOpenChange={(o) => !o && setDel(null)}
        icon="trash"
        title="删除这个标签？"
        actions={
          <>
            <ModalClose render={<Button size="sm" variant="ghost" />}>取消</ModalClose>
            <Button
              size="sm"
              variant="danger"
              onClick={async () => {
                await run('del', () => adminDeleteTaxonomyFn({ data: { kind: 'tag', id: del!.id } }), '已删除')
                setDel(null)
              }}
            >
              删除
            </Button>
          </>
        }
      >
        「{del?.name}」：{del?.packCount ? `${del.packCount} 个包会失去这个标签。想保留关联的话，用「合并」并到另一个标签。` : '没有包使用这个标签。'}
      </Modal>
    </>
  )
}
