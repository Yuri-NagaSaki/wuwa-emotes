import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { MeSummary } from '#/server/account/service'
import { deleteAccountFn } from '#/server/account/fn'
import { Button } from '../Button'
import { cx } from '../cx'
import { Check, Field, Input } from '../Field'
import { Icon } from '../Icon'
import { Modal, ModalClose } from '../Modal'
import { Seg } from '../Seg'
import { Sheet } from '../Sheet'
import { readPref, setPref, subscribeTheme, type ThemePref } from '../shell/theme'
import { toast } from '../Toast'
import { PasswordMeter } from './AuthLayout'
import { authClient, authErrorText, passwordStrength, STRENGTH_TEXT } from './auth-client'
import { ago, errorText, fullDate } from './text'

// 设置: display name, 夜潮 theme, password, signed-in devices, sign out, 注销账号. Name, password and
// sessions use Better Auth's endpoints; sessions store only hashes of IP and user agent, so devices are
// listed by time, with the current one marked. The theme is this browser's choice (tp-theme, the same
// preference the header's moon / sun button sets).

interface SessionRow {
  id: string
  token: string
  createdAt: string
  updatedAt: string
  expiresAt: string
}

export function SettingsPanel({ summary }: { summary: MeSummary }) {
  const router = useRouter()
  const navigate = useNavigate()

  async function signedOut(message: string) {
    toast(message)
    await router.invalidate()
    await navigate({ to: '/login' })
  }

  return (
    <div className="settings-grid">
      <NameRow summary={summary} onSaved={() => router.invalidate()} />
      <div className="set-row">
        <div>
          <b>邮箱</b>
          <small className="dyn">
            {summary.email} · {summary.emailVerified ? '已验证' : '未验证'}
          </small>
        </div>
      </div>
      <ThemeRow />
      <PasswordRow />
      <SessionsRow onAllRevoked={() => signedOut('已退出所有设备')} />
      <div className="set-row">
        <div>
          <b>退出登录</b>
          <small>只退出这台设备</small>
        </div>
        <Button
          size="sm"
          icon="logout"
          onClick={async () => {
            await authClient().signOut()
            await signedOut('已退出登录')
          }}
        >
          退出
        </Button>
      </div>
      <DeleteRow onDeleted={() => signedOut('账号已注销')} isAdmin={summary.role === 'admin'} />
    </div>
  )
}

function NameRow({ summary, onSaved }: { summary: MeSummary; onSaved: () => void }) {
  const [name, setName] = useState(summary.name)
  const [busy, setBusy] = useState(false)
  const len = [...name.trim()].length
  const bad = len < 2 || len > 16
  async function save(e: FormEvent) {
    e.preventDefault()
    if (bad) return
    setBusy(true)
    const res = await authClient().updateUser({ name: name.trim() })
    setBusy(false)
    if (res.error) return toast({ message: authErrorText(res.error), icon: 'warn' })
    toast('已保存')
    onSaved()
  }
  return (
    <form className="set-row" onSubmit={save}>
      <div>
        <b>显示名称</b>
        <small>评论和投稿里显示的名字，2–16 个字符</small>
      </div>
      <Input size="sm" value={name} maxLength={16} aria-label="显示名称" invalid={bad} onChange={(e) => setName(e.currentTarget.value)} />
      <Button type="submit" size="sm" disabled={busy || bad || name.trim() === summary.name}>
        保存
      </Button>
    </form>
  )
}

const THEME_OPTIONS = [
  { value: 'system', label: '跟随系统', icon: 'monitor' },
  { value: 'light', label: '白昼', icon: 'sun' },
  { value: 'night', label: '夜潮', icon: 'moon' },
] as const

function ThemeRow() {
  // the server cannot know the choice: it renders 跟随系统 and the browser corrects it after hydration
  const pref = useSyncExternalStore(subscribeTheme, readPref, (): ThemePref => 'system')
  return (
    <div className="set-row">
      <div>
        <b>夜潮主题</b>
        <small>深色界面；跟随系统，或在这台设备上固定白昼或夜潮</small>
      </div>
      <Seg size="sm" label="夜潮主题" value={pref} onChange={setPref} options={THEME_OPTIONS} />
    </div>
  )
}

function PasswordRow() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [others, setOthers] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const score = passwordStrength(next)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (next.length < 8) return setError('新密码至少 8 位')
    if (next !== confirm) return setError('两次输入的新密码不一样')
    setBusy(true)
    const res = await authClient().changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: others })
    setBusy(false)
    if (res.error) return setError(res.error.code === 'INVALID_PASSWORD' ? '当前密码不正确' : authErrorText(res.error))
    toast(others ? '密码已修改，其他设备已退出' : '密码已修改')
    setOpen(false)
    setCurrent('')
    setNext('')
    setConfirm('')
    setError(null)
  }

  return (
    <div className={cx('set-row', open && 'is-open')}>
      <div>
        <b>修改密码</b>
        <small>至少 8 位；修改后可以顺便退出其他设备</small>
      </div>
      {open ? (
        <form className="set-form" onSubmit={save}>
          <Field label="当前密码">
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} />
          </Field>
          <Field label="新密码" hint={next ? STRENGTH_TEXT[score] : undefined}>
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.currentTarget.value)} />
            <PasswordMeter score={score} />
          </Field>
          <Field label="再输入一次新密码" error={error}>
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
          </Field>
          <Check checked={others} onChange={setOthers}>
            同时退出其他设备
          </Check>
          <div className="acts">
            <Button type="submit" variant="primary" size="sm" disabled={busy || !current}>
              保存新密码
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" icon="key" onClick={() => setOpen(true)}>
          修改
        </Button>
      )}
    </div>
  )
}

function SessionsRow({ onAllRevoked }: { onAllRevoked: () => void }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [confirmAll, setConfirmAll] = useState(false)

  async function load() {
    const [list, me] = await Promise.all([authClient().listSessions(), authClient().getSession()])
    setCurrentId(me.data?.session.id ?? null)
    const data = (list.data ?? []) as unknown as SessionRow[]
    setRows([...data].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))
  }

  useEffect(() => {
    void load()
  }, [])

  async function revoke(s: SessionRow) {
    const res = await authClient().revokeSession({ token: s.token })
    if (res.error) return toast({ message: authErrorText(res.error), icon: 'warn' })
    toast('已退出那台设备')
    await load()
  }

  async function revokeOthers() {
    const res = await authClient().revokeOtherSessions()
    if (res.error) return toast({ message: authErrorText(res.error), icon: 'warn' })
    toast('已退出其他设备')
    await load()
  }

  async function revokeAll() {
    const res = await authClient().revokeSessions()
    setConfirmAll(false)
    if (res.error) return toast({ message: authErrorText(res.error), icon: 'warn' })
    onAllRevoked()
  }

  const others = rows?.filter((s) => s.id !== currentId).length ?? 0
  return (
    <div className="set-row">
      <div>
        <b>登录设备</b>
        <small>{rows ? `${rows.length} 台设备已登录` : '读取中…'}</small>
      </div>
      <Button size="sm" disabled={!others} onClick={revokeOthers}>
        退出其他设备
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirmAll(true)}>
        退出所有设备
      </Button>
      {rows?.length ? (
        <div className="sessions">
          {rows.map((s) => (
            <div key={s.id} className="s">
              <Icon name={s.id === currentId ? 'monitor' : 'phone'} size="sm" />
              <span className="grow" suppressHydrationWarning>
                <b>{s.id === currentId ? '当前设备' : '其他设备'}</b> · 登录于 {fullDate(s.createdAt)} · 最近活动 {ago(s.updatedAt)}
              </span>
              {s.id === currentId ? (
                <span className="st ok">当前</span>
              ) : (
                <Button size="xs" onClick={() => revoke(s)}>
                  退出
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : null}
      <Modal
        open={confirmAll}
        onOpenChange={setConfirmAll}
        icon="logout"
        title="退出所有设备？"
        actions={
          <>
            <ModalClose render={<Button>取消</Button>} />
            <Button variant="danger" onClick={revokeAll}>
              全部退出
            </Button>
          </>
        }
      >
        包括这台设备在内，所有登录都会失效，需要重新登录。
      </Modal>
    </div>
  )
}

function DeleteRow({ onDeleted, isAdmin }: { onDeleted: () => void; isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await deleteAccountFn({ data: { password } })
      setOpen(false)
      onDeleted()
    } catch (err) {
      setError(errorText(err, '注销失败，请稍后再试'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="set-row danger">
      <div>
        <b>注销账号</b>
        <small>删除账号、收藏、通知和未通过的投稿；已发布的表情包会保留。不能恢复。</small>
      </div>
      <Button size="sm" style={{ color: 'var(--tp-err)' }} onClick={() => setOpen(true)}>
        注销
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="注销账号"
        icon="warn"
        subtitle="这个操作不能撤销"
        footer={
          <Button variant="danger" block disabled={busy || !sure || !password} onClick={remove}>
            {busy ? '正在注销…' : '确认注销'}
          </Button>
        }
      >
        <div className="sheet-form">
          <div className="note-box warn">
            <Icon name="warn" size="sm" />
            <span>注销后，账号、收藏夹、通知、草稿和审核中的投稿会立即删除。已经发布的表情包会保留在站内，但不再显示投稿者。{isAdmin ? '站长需要先任命另一位站长。' : ''}</span>
          </div>
          <Field label="输入密码确认" error={error}>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
          </Field>
          <Check checked={sure} onChange={setSure}>
            我明白注销后不能恢复
          </Check>
        </div>
      </Sheet>
    </div>
  )
}
