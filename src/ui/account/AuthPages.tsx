import { useNavigate, useRouter } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '../Button'
import { Check, Field, Input } from '../Field'
import { AppLink } from '../link'
import { useSiteConfig } from '../site-config'
import { AuthError, AuthLayout, PasswordMeter, SentPanel } from './AuthLayout'
import { authClient, authErrorText, EMAIL_RE, passwordStrength, safeNext, STRENGTH_TEXT, withCap, type AuthFailure } from './auth-client'
import { useCap } from './useCap'

// 登录 / 注册 / 忘记密码 / 重置密码 / 验证邮箱. Each Cap-protected call spends one token; after any
// failed attempt the widget solves a fresh one (useCap().renew).

interface Failure {
  text: string
  code?: string
}

function failure(err: AuthFailure): Failure {
  return { text: authErrorText(err), code: err.code }
}

function emailProblem(email: string): string | null {
  const e = email.trim()
  if (!e) return '请填写邮箱'
  if (!e.includes('@')) return '邮箱格式不完整，缺少 @'
  if (!EMAIL_RE.test(e)) return '邮箱格式不完整，缺少域名后缀（例如 .com）'
  return null
}

// ---------- 登录 ----------

export function LoginPage({ next }: { next?: string }) {
  const { site } = useSiteConfig()
  const router = useRouter()
  const navigate = useNavigate()
  const cap = useCap()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const [resent, setResent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const bad = emailProblem(email) ?? (password ? null : '请输入密码')
    if (bad) return setError({ text: bad })
    setBusy(true)
    setError(null)
    const token = await cap.ensure()
    if (!token) {
      setBusy(false)
      return setError({ text: '请先完成人机验证', code: 'CAPTCHA_MISSING' })
    }
    const res = await authClient().signIn.email({ email: email.trim(), password, rememberMe: remember }, withCap(token))
    if (res.error) {
      cap.renew()
      setBusy(false)
      setError(failure(res.error))
      return
    }
    await router.invalidate()
    await navigate({ to: safeNext(next) })
  }

  async function resend() {
    setBusy(true)
    const token = await cap.ensure()
    if (!token) {
      setBusy(false)
      return setError({ text: '请先完成人机验证', code: 'CAPTCHA_MISSING' })
    }
    const res = await authClient().sendVerificationEmail({ email: email.trim(), callbackURL: '/verify-email' }, withCap(token))
    cap.renew()
    setBusy(false)
    if (res.error) return setError(failure(res.error))
    setError(null)
    setResent(true)
  }

  return (
    <AuthLayout perks title={<>潮水退了，<br />表情都还在。</>} lead="下载不需要账号。登录后可以收藏、同步打包清单，也可以投稿自己的表情包。">
      <h1>欢迎回到{site.name}</h1>
      {resent ? (
        <SentPanel title="验证邮件已发出">请在 30 分钟内点击邮件里的链接完成验证，然后回来登录。</SentPanel>
      ) : null}
      <form className="auth-stack" onSubmit={submit} noValidate>
        <Field label="邮箱">
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
        <div className="row">
          <Check checked={remember} onChange={setRemember}>
            30 天内保持登录
          </Check>
        </div>
        {cap.node}
        {error ? (
          <AuthError
            action={
              error.code === 'EMAIL_NOT_VERIFIED' ? (
                <Button size="xs" onClick={resend} disabled={busy}>
                  重新发送
                </Button>
              ) : undefined
            }
          >
            {error.text}
          </AuthError>
        ) : null}
        <Button type="submit" variant="primary" size="lg" block disabled={busy}>
          {busy ? '正在登录…' : '登录'}
        </Button>
      </form>
      <p className="muted center">
        还没有账号？
        <AppLink to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'} className="link">
          注册
        </AppLink>
      </p>
    </AuthLayout>
  )
}

// ---------- 注册 ----------

export function RegisterPage({ next }: { next?: string }) {
  const { site } = useSiteConfig()
  const router = useRouter()
  const navigate = useNavigate()
  const cap = useCap()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agree, setAgree] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

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
    const token = await cap.ensure()
    if (!token) {
      setBusy(false)
      return setError({ text: '请先完成人机验证', code: 'CAPTCHA_MISSING' })
    }
    const res = await authClient().signUp.email({ name: name.trim(), email: email.trim(), password, callbackURL: '/verify-email' }, withCap(token))
    if (res.error) {
      cap.renew()
      setBusy(false)
      return setError(failure(res.error))
    }
    if (res.data && 'token' in res.data && res.data.token) {
      // signed in right away (no mail server configured, so no verification step)
      await router.invalidate()
      await navigate({ to: safeNext(next) })
      return
    }
    setBusy(false)
    setSentTo(email.trim())
  }

  async function resend() {
    if (!sentTo) return
    setBusy(true)
    const token = await cap.ensure()
    if (!token) {
      setBusy(false)
      return setError({ text: '请先完成人机验证', code: 'CAPTCHA_MISSING' })
    }
    const res = await authClient().sendVerificationEmail({ email: sentTo, callbackURL: '/verify-email' }, withCap(token))
    cap.renew()
    setBusy(false)
    setError(res.error ? failure(res.error) : { text: '已重新发送，请查收' })
  }

  return (
    <AuthLayout tone="purple" title={<>来{site.name}<br />安个家</>} lead="注册只需要邮箱。我们只用它发验证和提醒，不会公开。">
      <h1>注册</h1>
      {sentTo ? (
        <>
          <SentPanel title="验证邮件已发出">
            我们给 <b className="dyn">{sentTo}</b> 发了一封验证邮件。点击邮件里的链接即可完成注册。
          </SentPanel>
          {cap.node}
          {error ? <AuthError>{error.text}</AuthError> : null}
          <Button block onClick={resend} disabled={busy}>
            没收到？重新发送
          </Button>
          <AppLink to="/login" className="link" style={{ textAlign: 'center' }}>
            返回登录
          </AppLink>
        </>
      ) : (
        <form className="auth-stack" onSubmit={submit} noValidate>
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
          {cap.node}
          {error ? <AuthError>{error.text}</AuthError> : null}
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? '正在创建…' : '创建账号'}
          </Button>
          <p className="muted center">
            已有账号？
            <AppLink to="/login" className="link">
              登录
            </AppLink>
          </p>
        </form>
      )}
    </AuthLayout>
  )
}

// ---------- 忘记密码 ----------

export function ForgotPasswordPage() {
  const cap = useCap()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Failure | null>(null)
  const [sent, setSent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const bad = emailProblem(email)
    if (bad) return setError({ text: bad })
    setBusy(true)
    setError(null)
    const token = await cap.ensure()
    if (!token) {
      setBusy(false)
      return setError({ text: '请先完成人机验证', code: 'CAPTCHA_MISSING' })
    }
    const res = await authClient().requestPasswordReset({ email: email.trim(), redirectTo: '/reset-password' }, withCap(token))
    setBusy(false)
    if (res.error) {
      cap.renew()
      return setError(failure(res.error))
    }
    setSent(true)
  }

  return (
    <AuthLayout title={<>找回密码</>} lead="输入注册邮箱，我们会发一封重置链接。链接 1 小时内有效。">
      <h1>找回密码</h1>
      {sent ? (
        <>
          <SentPanel title="邮件已发出">如果这个邮箱注册过，几分钟内会收到重置链接。没收到可以检查垃圾邮件，或稍后重试。</SentPanel>
          <AppLink to="/login" className="btn block">
            返回登录
          </AppLink>
        </>
      ) : (
        <form className="auth-stack" onSubmit={submit} noValidate>
          <Field label="邮箱">
            <Input icon="mail" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.currentTarget.value)} />
          </Field>
          {cap.node}
          {error ? <AuthError>{error.text}</AuthError> : null}
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            {busy ? '正在发送…' : '发送重置邮件'}
          </Button>
          <AppLink to="/login" className="link" style={{ textAlign: 'center' }}>
            返回登录
          </AppLink>
        </form>
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
    if (password !== confirm) return setError({ text: '两次输入的密码不一样' })
    setBusy(true)
    const res = await authClient().resetPassword({ newPassword: password, token: token! })
    setBusy(false)
    if (res.error) return setError(failure(res.error))
    setDone(true)
  }

  const invalid = linkError || !token
  return (
    <AuthLayout title={<>设置新密码</>} lead="重置后，其他设备上的登录会失效。">
      <h1>重置密码</h1>
      {invalid ? (
        <>
          <SentPanel icon="warn" bad title="链接无效或已过期">
            重置链接只能用一次，并且 1 小时后失效。请重新申请一封。
          </SentPanel>
          <AppLink to="/forgot-password" className="btn primary block">
            重新申请
          </AppLink>
        </>
      ) : done ? (
        <>
          <SentPanel icon="check" title="密码已更新">
            现在可以用新密码登录了。
          </SentPanel>
          <AppLink to="/login" className="btn primary block">
            去登录
          </AppLink>
        </>
      ) : (
        <form className="auth-stack" onSubmit={submit} noValidate>
          <Field label="新密码" hint={password ? STRENGTH_TEXT[score] : '至少 8 位'}>
            <Input icon="lock" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} />
            <PasswordMeter score={score} />
          </Field>
          <Field label="再输入一次">
            <Input icon="lock" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.currentTarget.value)} />
          </Field>
          {error ? <AuthError>{error.text}</AuthError> : null}
          <Button type="submit" variant="primary" size="lg" block disabled={busy}>
            保存新密码
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

// ---------- 验证邮箱 ----------

const VERIFY_ERRORS: Record<string, string> = {
  TOKEN_EXPIRED: '验证链接已过期。登录时可以重新发送一封。',
  INVALID_TOKEN: '验证链接无效，可能已经用过了。登录时可以重新发送一封。',
  USER_NOT_FOUND: '找不到这个账号，可能已经注销。',
  INVALID_USER: '这个链接属于另一个账号。请先退出当前账号再打开链接。',
}

export function VerifyEmailPage({ error }: { error?: string }) {
  const router = useRouter()
  useEffect(() => {
    // the verification signs the visitor in; refresh the cached viewer
    if (!error) void router.invalidate()
  }, [error, router])
  return (
    <AuthLayout title={<>验证邮箱</>} lead="验证后就可以收藏、评论和投稿了。">
      <h1>验证邮箱</h1>
      {error ? (
        <>
          <SentPanel icon="warn" bad title="没有验证成功">
            {VERIFY_ERRORS[error] ?? '验证没有完成，请重新发送验证邮件。'}
          </SentPanel>
          <AppLink to="/login" className="btn primary block">
            去登录
          </AppLink>
        </>
      ) : (
        <>
          <SentPanel icon="check" title="邮箱已验证">
            欢迎加入。现在可以收藏喜欢的表情，也可以投稿自己的表情包。
          </SentPanel>
          <div className="row">
            <AppLink to="/me" className="btn primary grow">
              去个人中心
            </AppLink>
            <AppLink to="/submit" className="btn grow">
              投稿表情包
            </AppLink>
          </div>
        </>
      )}
    </AuthLayout>
  )
}
