import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { durationText, RESET_PASSWORD_EXPIRES_IN, VERIFY_EMAIL_EXPIRES_IN } from '#/server/auth/policy'
import { Button, buttonClass } from '../Button'
import { useInvisibleCap, type InvisibleCap } from '../cap/useInvisibleCap'
import { Check, Field, Input } from '../Field'
import { AppLink } from '../link'
import { useSiteConfig } from '../site-config'
import { AuthAlt, AuthLayout, AuthNotice, PasswordMeter, SentPanel } from './AuthLayout'
import { authClient, authErrorText, EMAIL_RE, passwordStrength, safeNext, STRENGTH_TEXT, withCap, type AuthFailure } from './auth-client'

// 登录 / 注册 / 忘记密码 / 重置密码 / 验证邮箱. Sign-in, sign-up and the reset mail need a Cap token;
// it is solved invisibly in the background while the form is on screen (useInvisibleCap), so there
// is no widget: the button says 验证中… only when the proof of work is not done yet, and one line with
// 重试 appears only if it fails twice. Resending the verification mail needs no token.

const VERIFY_TTL = durationText(VERIFY_EMAIL_EXPIRES_IN)
const RESET_TTL = durationText(RESET_PASSWORD_EXPIRES_IN)
/** Seconds before 重新发送 can be pressed again (the server allows 3 per 10 minutes per IP). */
const RESEND_COOLDOWN = 60

interface Failure {
  text: string
  code?: string
}

function failure(err: AuthFailure): Failure {
  return { text: authErrorText(err), code: err.code }
}

const NETWORK: Failure = { text: '网络连接失败，请稍后再试' }

function emailProblem(email: string): string | null {
  const e = email.trim()
  if (!e) return '请填写邮箱'
  if (!e.includes('@')) return '邮箱格式不完整，缺少 @'
  if (!EMAIL_RE.test(e)) return '邮箱格式不完整，缺少域名后缀（例如 .com）'
  return null
}

/** Label of a Cap-protected submit button. */
function submitLabel(cap: InvisibleCap, busy: boolean, idle: string, working: string): string {
  if (cap.waiting) return '验证中…'
  return busy ? working : idle
}

/** The line shown after the invisible check failed twice; 重试 submits the form again. */
function CapFailed() {
  return (
    <AuthNotice
      action={
        <Button type="submit" size="xs">
          重试
        </Button>
      }
    >
      人机验证没有完成，请检查网络后重试。
    </AuthNotice>
  )
}

/** Seconds left of a cooldown that starts now (`start()`) or on mount. */
function useCooldown(seconds: number, startNow: boolean): [number, () => void] {
  const [until, setUntil] = useState(() => (startNow ? Date.now() + seconds * 1000 : 0))
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (until <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [until])
  const left = Math.max(0, Math.ceil((until - now) / 1000))
  return [left, () => {
    setNow(Date.now())
    setUntil(Date.now() + seconds * 1000)
  }]
}

/** Resend the verification mail. No Cap token: the endpoint is rate limited per IP instead. */
async function resendVerification(email: string): Promise<Failure | null> {
  try {
    const res = await authClient().sendVerificationEmail({ email, callbackURL: '/verify-email' })
    if (!res.error) return null
    if (res.error.status === 429) return { text: '发送太频繁了，请过几分钟再试' }
    return failure(res.error)
  } catch {
    return NETWORK
  }
}

/** 「验证邮件已发出」: where it went, how long the link lasts, the spam folder, 重新发送 and the way back. */
function VerificationSent({ email, back }: { email: string; back: ReactNode }) {
  const [left, restart] = useCooldown(RESEND_COOLDOWN, true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  async function resend() {
    setBusy(true)
    setNote(null)
    const err = await resendVerification(email)
    setBusy(false)
    if (err) return setNote({ tone: 'err', text: err.text })
    restart()
    setNote({ tone: 'ok', text: '已重新发送，请查收' })
  }

  return (
    <>
      <SentPanel title="验证邮件已发出">
        我们给 <b className="dyn">{email}</b> 发了一封验证邮件，请在 {VERIFY_TTL}内点击邮件里的链接完成验证。没收到的话，先看看垃圾邮件文件夹。
      </SentPanel>
      {note ? <AuthNotice tone={note.tone}>{note.text}</AuthNotice> : null}
      <Button block onClick={resend} disabled={busy || left > 0}>
        {busy ? '正在发送…' : left > 0 ? `没收到？${left} 秒后可以重新发送` : '没收到？重新发送'}
      </Button>
      {back}
    </>
  )
}

// ---------- 登录 ----------

const LOGIN_ART = { title: <>潮水退了，<br />表情都还在。</>, lead: '下载不需要账号。登录后可以收藏、评论，也可以投稿自己的表情包。' }

export function LoginPage({ next }: { next?: string }) {
  const { site } = useSiteConfig()
  const router = useRouter()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [emailErr, setEmailErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const cap = useInvisibleCap(!sentTo)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const bad = emailProblem(email)
    setEmailErr(bad)
    if (bad) return setError(null)
    if (!password) return setError({ text: '请输入密码' })
    setBusy(true)
    setError(null)
    try {
      const res = await cap.run((token) => authClient().signIn.email({ email: email.trim(), password, rememberMe: remember }, withCap(token)))
      if (!res) return setBusy(false)
      if (res.error) {
        setBusy(false)
        return setError(failure(res.error))
      }
    } catch {
      setBusy(false)
      return setError(NETWORK)
    }
    await router.invalidate()
    await navigate({ to: safeNext(next) })
  }

  async function resend() {
    setBusy(true)
    const err = await resendVerification(email.trim())
    setBusy(false)
    if (err) return setError(err)
    setError(null)
    setSentTo(email.trim())
  }

  return (
    <AuthLayout perks title={LOGIN_ART.title} lead={LOGIN_ART.lead}>
      {sentTo ? (
        <VerificationSent
          email={sentTo}
          back={
            <Button block onClick={() => setSentTo(null)}>
              返回登录
            </Button>
          }
        />
      ) : (
        <>
          <h1>欢迎回到{site.name}</h1>
          <form className="auth-stack" onSubmit={submit} onFocus={cap.warm} noValidate>
            <Field label="邮箱" error={emailErr}>
              <Input icon="mail" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            </Field>
            <Field
              label="密码"
              aside={
                <AppLink to="/forgot-password" className="link">
                  忘记密码？
                </AppLink>
              }
            >
              <Input icon="lock" type="password" autoComplete="current-password" placeholder="至少 8 位" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            </Field>
            <Check checked={remember} onChange={setRemember}>
              30 天内保持登录
            </Check>
            {cap.failed ? <CapFailed /> : null}
            {error ? (
              <AuthNotice
                action={
                  error.code === 'EMAIL_NOT_VERIFIED' ? (
                    <Button size="xs" onClick={resend} disabled={busy}>
                      重新发送
                    </Button>
                  ) : undefined
                }
              >
                {error.text}
              </AuthNotice>
            ) : null}
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              {submitLabel(cap, busy, '登录', '正在登录…')}
            </Button>
          </form>
          <AuthAlt>
            还没有账号？
            <AppLink to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'} className="link">
              注册
            </AppLink>
          </AuthAlt>
        </>
      )}
    </AuthLayout>
  )
}

// ---------- 注册 ----------

export function RegisterPage({ next }: { next?: string }) {
  const { site } = useSiteConfig()
  const router = useRouter()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agree, setAgree] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const cap = useInvisibleCap(!sentTo)

  const nameLen = [...name.trim()].length
  const nameErr = nameLen < 2 || nameLen > 16 ? '用户名需要 2–16 个字符' : null
  const emailErr = emailProblem(email)
  const pwErr = password.length < 8 ? '密码至少 8 位' : password.length > 128 ? '密码最多 128 位' : null
  const score = passwordStrength(password)
  const show = (k: string, err: string | null) => (touched[k] ? err : null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched({ name: true, email: true, password: true })
    if (nameErr || emailErr || pwErr) return setError(null)
    if (!agree) return setError({ text: '请先阅读并同意服务条款与隐私政策' })
    setBusy(true)
    setError(null)
    try {
      const res = await cap.run((token) => authClient().signUp.email({ name: name.trim(), email: email.trim(), password, callbackURL: '/verify-email' }, withCap(token)))
      if (!res) return setBusy(false)
      if (res.error) {
        setBusy(false)
        return setError(failure(res.error))
      }
      if (res.data && 'token' in res.data && res.data.token) {
        // signed in right away (no mail server configured, so no verification step)
        await router.invalidate()
        await navigate({ to: safeNext(next) })
        return
      }
    } catch {
      setBusy(false)
      return setError(NETWORK)
    }
    setBusy(false)
    setSentTo(email.trim())
  }

  return (
    <AuthLayout tone="purple" title={<>来{site.name}<br />安个家</>} lead="注册只需要邮箱。邮箱只用来验证和找回密码，不会公开。">
      {sentTo ? (
        <VerificationSent
          email={sentTo}
          back={
            <AppLink to="/login" className={buttonClass({ block: true })}>
              返回登录
            </AppLink>
          }
        />
      ) : (
        <>
          <h1>注册</h1>
          <form className="auth-stack" onSubmit={submit} onFocus={cap.warm} noValidate>
            <Field label="用户名" hint="可以使用中文" error={show('name', nameErr)}>
              <Input icon="user" autoComplete="nickname" placeholder="2–16 个字符" value={name} onChange={(e) => setName(e.currentTarget.value)} onBlur={() => setTouched((t) => ({ ...t, name: true }))} />
            </Field>
            <Field label="邮箱" error={show('email', emailErr)}>
              <Input icon="mail" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.currentTarget.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))} />
            </Field>
            <Field label="密码" hint={password ? STRENGTH_TEXT[score] + (score < 4 ? '。加入符号会更安全' : '') : '至少 8 位'} error={show('password', pwErr)}>
              <Input icon="lock" type="password" autoComplete="new-password" placeholder="至少 8 位" value={password} onChange={(e) => setPassword(e.currentTarget.value)} onBlur={() => setTouched((t) => ({ ...t, password: true }))} />
              <PasswordMeter score={score} />
            </Field>
            <Check checked={agree} onChange={setAgree}>
              <span>
                我已阅读并同意{' '}
                <AppLink to="/legal/terms" className="link">
                  服务条款
                </AppLink>{' '}
                与{' '}
                <AppLink to="/legal/privacy" className="link">
                  隐私政策
                </AppLink>
              </span>
            </Check>
            {cap.failed ? <CapFailed /> : null}
            {error ? <AuthNotice>{error.text}</AuthNotice> : null}
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              {submitLabel(cap, busy, '创建账号', '正在创建…')}
            </Button>
          </form>
          <AuthAlt>
            已有账号？
            <AppLink to={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className="link">
              登录
            </AppLink>
          </AuthAlt>
        </>
      )}
    </AuthLayout>
  )
}

// ---------- 忘记密码 ----------

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [emailErr, setEmailErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const cap = useInvisibleCap(!sentTo)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const bad = emailProblem(email)
    setEmailErr(bad)
    if (bad) return setError(null)
    setBusy(true)
    setError(null)
    try {
      const res = await cap.run((token) => authClient().requestPasswordReset({ email: email.trim(), redirectTo: '/reset-password' }, withCap(token)))
      setBusy(false)
      if (!res) return
      if (res.error) return setError(res.error.status === 429 ? { text: '申请太频繁了，请过一会儿再试' } : failure(res.error))
    } catch {
      setBusy(false)
      return setError(NETWORK)
    }
    setSentTo(email.trim())
  }

  return (
    <AuthLayout perks title={LOGIN_ART.title} lead={LOGIN_ART.lead}>
      {sentTo ? (
        <>
          <SentPanel title="邮件已发出">
            如果 <b className="dyn">{sentTo}</b> 注册过，几分钟内会收到一封重置邮件，链接 {RESET_TTL}内有效。没收到的话，先看看垃圾邮件文件夹。
          </SentPanel>
          <AppLink to="/login" className={buttonClass({ block: true })}>
            返回登录
          </AppLink>
        </>
      ) : (
        <>
          <h1>找回密码</h1>
          <p className="muted">输入注册邮箱，我们会发一封重置链接，{RESET_TTL}内有效。</p>
          <form className="auth-stack" onSubmit={submit} onFocus={cap.warm} noValidate>
            <Field label="邮箱" error={emailErr}>
              <Input icon="mail" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
            </Field>
            {cap.failed ? <CapFailed /> : null}
            {error ? <AuthNotice>{error.text}</AuthNotice> : null}
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              {submitLabel(cap, busy, '发送重置邮件', '正在发送…')}
            </Button>
          </form>
          <AuthAlt>
            想起来了？
            <AppLink to="/login" className="link">
              返回登录
            </AppLink>
          </AuthAlt>
        </>
      )}
    </AuthLayout>
  )
}

// ---------- 重置密码 ----------

export function ResetPasswordPage({ token, error: linkError }: { token?: string; error?: string }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const [done, setDone] = useState(false)
  const score = passwordStrength(password)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) return setError({ text: '密码至少 8 位' })
    if (password.length > 128) return setError({ text: '密码最多 128 位' })
    if (password !== confirm) return setError({ text: '两次输入的密码不一样' })
    setBusy(true)
    setError(null)
    try {
      const res = await authClient().resetPassword({ newPassword: password, token: token! })
      setBusy(false)
      if (res.error) return setError(failure(res.error))
    } catch {
      setBusy(false)
      return setError(NETWORK)
    }
    setDone(true)
  }

  const invalid = linkError || !token
  return (
    <AuthLayout perks title={LOGIN_ART.title} lead={LOGIN_ART.lead}>
      {invalid ? (
        <>
          <SentPanel icon="warn" bad title="链接无效或已过期">
            重置链接只能用一次，{RESET_TTL}后失效。请重新申请一封。
          </SentPanel>
          <AppLink to="/forgot-password" className={buttonClass({ variant: 'primary', size: 'lg', block: true })}>
            重新申请
          </AppLink>
        </>
      ) : done ? (
        <>
          <SentPanel icon="check" title="密码已更新">
            所有设备上的登录都已退出。现在可以用新密码登录了。
          </SentPanel>
          <AppLink to="/login" className={buttonClass({ variant: 'primary', size: 'lg', block: true })}>
            去登录
          </AppLink>
        </>
      ) : (
        <>
          <h1>设置新密码</h1>
          <p className="muted">新密码至少 8 位。保存后，所有设备上的登录都会退出。</p>
          <form className="auth-stack" onSubmit={submit} noValidate>
            <Field label="新密码" hint={password ? STRENGTH_TEXT[score] : '至少 8 位'}>
              <Input icon="lock" type="password" autoComplete="new-password" placeholder="至少 8 位" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
              <PasswordMeter score={score} />
            </Field>
            <Field label="再输入一次">
              <Input icon="lock" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
            </Field>
            {error ? <AuthNotice>{error.text}</AuthNotice> : null}
            <Button type="submit" variant="primary" size="lg" block disabled={busy}>
              {busy ? '正在保存…' : '保存新密码'}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  )
}

// ---------- 验证邮箱 ----------

const VERIFY_ERRORS: Record<string, string> = {
  TOKEN_EXPIRED: '验证链接已过期。登录后可以重新发送一封。',
  INVALID_TOKEN: '验证链接无效，可能已经用过了。登录后可以重新发送一封。',
  USER_NOT_FOUND: '找不到这个账号，可能已经注销。',
  INVALID_USER: '这个链接属于另一个账号。请先退出当前账号再打开链接。',
}

export function VerifyEmailPage({ error }: { error?: string }) {
  const { site } = useSiteConfig()
  const router = useRouter()
  useEffect(() => {
    // the verification signs the visitor in; refresh the cached viewer
    if (!error) void router.invalidate()
  }, [error, router])
  return (
    <AuthLayout tone="purple" title={<>欢迎来到<br />{site.name}</>} lead="验证后就可以收藏、评论和投稿了。">
      {error ? (
        <>
          <SentPanel icon="warn" bad title="没有验证成功">
            {VERIFY_ERRORS[error] ?? '验证没有完成。登录后可以重新发送验证邮件。'}
          </SentPanel>
          <AppLink to="/login" className={buttonClass({ variant: 'primary', size: 'lg', block: true })}>
            去登录
          </AppLink>
        </>
      ) : (
        <>
          <SentPanel icon="check" title="邮箱已验证">
            欢迎加入。现在可以收藏喜欢的表情，也可以投稿自己的表情包。
          </SentPanel>
          <AppLink to="/me" className={buttonClass({ variant: 'primary', size: 'lg', block: true })}>
            去个人中心
          </AppLink>
          <AppLink to="/submit" className={buttonClass({ block: true })}>
            投稿表情包
          </AppLink>
        </>
      )}
    </AuthLayout>
  )
}
