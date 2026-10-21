import { useRouter } from '@tanstack/react-router'
import { useCallback, useState, type ReactNode } from 'react'
import { cx } from '../cx'
import { fmtN } from '../format'
import { Icon, type IconName } from '../Icon'
import { Select } from '../Select'
import { toast } from '../Toast'

// Building blocks of the admin pages, on top of the kit and src/ui/styles/admin.css (.adm-h, .panel,
// .kpi, .tbl, .pager, .bulk, .st). Static UI text may use the display font (h1/h3); anything that comes
// from data (pack titles, names) is rendered in body-font elements.

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="adm-h">
      <div>
        <h1>{title}</h1>
        {sub ? <p>{sub}</p> : null}
      </div>
      {actions ? <div className="acts">{actions}</div> : null}
    </div>
  )
}

export function Panel({
  title,
  acts,
  flush,
  className,
  children,
  id,
}: {
  title: ReactNode
  acts?: ReactNode
  flush?: boolean
  className?: string
  children: ReactNode
  id?: string
}) {
  return (
    <section className={cx('panel', className)} id={id}>
      <div className="panel-h">
        <h3>{title}</h3>
        {acts ? <div className="acts">{acts}</div> : null}
      </div>
      <div className={cx('panel-b', flush && 'flush')}>{children}</div>
    </section>
  )
}

export function Kpi({ label, value, unit, note, icon, alert }: { label: string; value: ReactNode; unit?: string; note?: ReactNode; icon?: IconName; alert?: boolean }) {
  return (
    <div className={cx('kpi', alert && 'alert')}>
      <span className="k">
        {icon ? <Icon name={icon} size="sm" /> : null}
        {label}
      </span>
      <span className="v">
        {value}
        {unit ? <small>{unit}</small> : null}
      </span>
      {note ? <span className="hint">{note}</span> : null}
    </div>
  )
}

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'mute'

export function Pill({ tone, children, run }: { tone: Tone; children: ReactNode; run?: boolean }) {
  return <span className={cx('st', tone, run && 'run')}>{children}</span>
}

const PACK_STATUS: Record<string, [Tone, string]> = {
  published: ['ok', '已发布'],
  draft: ['mute', '草稿'],
  hidden: ['err', '已隐藏'],
}
const EMOJI_STATUS: Record<string, [Tone, string]> = {
  published: ['ok', '已发布'],
  pending: ['warn', '待审核'],
  hidden: ['err', '已隐藏'],
}

export function PackStatusPill({ status }: { status: string }) {
  const [tone, label] = PACK_STATUS[status] ?? ['mute', status]
  return <Pill tone={tone}>{label}</Pill>
}

export function EmojiStatusPill({ status }: { status: string }) {
  const [tone, label] = EMOJI_STATUS[status] ?? ['mute', status]
  return <Pill tone={tone}>{label}</Pill>
}

/** Poster or a neutral placeholder when the worker has not rendered one yet. */
export function Thumb({ src, alt = '', className, size = 44 }: { src: string | null; alt?: string; className?: string; size?: number }) {
  if (!src) {
    return (
      <span className={cx('adm-thumb-empty', className)} style={{ width: size, height: size }} aria-hidden={alt ? undefined : true} title={alt || undefined}>
        <Icon name="image" size="sm" />
      </span>
    )
  }
  return <img className={className} src={src} alt={alt} width={size} height={size} loading="lazy" decoding="async" />
}

export function Pager({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  const nums = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))
  const list = [...nums].sort((a, b) => a - b)
  return (
    <nav className="pager" aria-label="分页">
      <span>
        第 {fmtN(from)}–{fmtN(to)} 条，共 {fmtN(total)} 条
      </span>
      {list.map((n, i) => (
        <span key={n} style={{ display: 'contents' }}>
          {i > 0 && n - list[i - 1]! > 1 ? <span>…</span> : null}
          <button type="button" className={cx(n === page && 'is-on')} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>
            {n}
          </button>
        </span>
      ))}
    </nav>
  )
}

export function BulkBar({ count, unit, children, onClear }: { count: number; unit: string; children: ReactNode; onClear: () => void }) {
  if (!count) return null
  return (
    <div className="bulk" role="toolbar" aria-label="批量操作">
      <span>
        <b>{count}</b> {unit}已选
      </span>
      {children}
      <button type="button" className="btn sm ghost adm-bulk-clear" onClick={onClear}>
        取消选择
      </button>
    </div>
  )
}

/** The kit's Select as an admin filter (compact pill with its label, teal once set) or form control. */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  id,
  plain,
}: {
  label: string
  value: T | ''
  options: readonly { value: T | ''; label: string }[]
  onChange: (v: T | '') => void
  className?: string
  id?: string
  /** Form control: no inline label, no "filter is set" highlight. */
  plain?: boolean
}) {
  return (
    <Select<T | ''>
      id={id}
      label={label}
      prefix={plain ? undefined : label}
      size={plain ? 'md' : 'sm'}
      value={value}
      options={options}
      onChange={onChange}
      className={cx('adm-select', !plain && value !== '' && 'is-set', plain && 'is-plain', className)}
    />
  )
}

// ---------- errors and actions ----------

/** Message of a server-function error (HttpError over RPC keeps its message). */
export function errorText(err: unknown): string {
  const e = err as { message?: unknown } | null
  const msg = typeof e?.message === 'string' ? e.message : ''
  if (!msg) return '操作失败，请稍后再试'
  // validator errors arrive as JSON-encoded zod issues
  if (msg.startsWith('[')) {
    try {
      const issues = JSON.parse(msg) as { message?: string; path?: unknown[] }[]
      if (issues[0]?.message) return issues[0].message
    } catch {
      // not JSON
    }
  }
  return msg
}

export function isDenied(err: unknown): boolean {
  const e = err as { status?: unknown; message?: unknown } | null
  if (e?.status === 401 || e?.status === 403) return true
  return typeof e?.message === 'string' && (e.message.includes('请先登录') || e.message.includes('没有权限'))
}

/** Loader helper: the admin layout shows the sign-in / 403 state itself, so a denied child load is null. */
export async function guarded<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (err) {
    if (isDenied(err)) return null
    throw err
  }
}

/** Run a mutation: toast the outcome, reload the route data, report busy state. */
export function useAction() {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, ok?: string | ((r: T) => string | null)): Promise<T | undefined> => {
      setBusy(key)
      try {
        const r = await fn()
        const msg = typeof ok === 'function' ? ok(r) : ok
        if (msg) toast({ message: msg, icon: 'check' })
        await router.invalidate()
        return r
      } catch (err) {
        toast({ message: errorText(err), icon: 'warn', duration: 4500 })
        return undefined
      } finally {
        setBusy(null)
      }
    },
    [router],
  )
  return { run, busy }
}

// ---------- formats ----------

const TZ = 'Asia/Shanghai'

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(d)
    .replace(/\//g, '-')
}

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: '2-digit', day: '2-digit' }).format(new Date(iso)).replace(/\//g, '-')
}

/** "3 分钟前", "14 小时前", "2 天前", then the date. */
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86_400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 86_400 * 7) return `${Math.floor(s / 86_400)} 天前`
  return fmtDay(iso)
}

export function maskEmail(email: string): string {
  const [user = '', host = ''] = email.split('@')
  return `${user.slice(0, 2)}***@${host}`
}

/** Toggle a value in a Set (returns a new Set). */
export function toggled<T>(s: Set<T>, v: T): Set<T> {
  const n = new Set(s)
  if (n.has(v)) n.delete(v)
  else n.add(v)
  return n
}
