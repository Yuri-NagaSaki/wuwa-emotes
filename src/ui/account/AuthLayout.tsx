import type { ReactNode } from 'react'
import { cx } from '../cx'
import { Icon, type IconName } from '../Icon'
import { AppLink } from '../link'
import { LogoMark } from '../LogoMark'

// The auth split from the prototype (登录 / 注册): an art panel on the left, the form on the right.
// Phones stack them, with the art panel reduced to the title and one sentence.

const PERKS: [IconName, string][] = [
  ['heart', '收藏夹多端同步'],
  ['box', '打包清单跟着账号走'],
  ['chat', '评论区发贴纸'],
  ['upload', '投稿自己的表情包'],
]

export function AuthLayout({ title, lead, perks, tone, children }: { title: ReactNode; lead: ReactNode; perks?: boolean; tone?: 'purple'; children: ReactNode }) {
  return (
    <div className="wrap narrow">
      <div className="auth">
        <div className={cx('auth-art', tone)}>
          <div>
            <LogoMark />
            <h2>{title}</h2>
            <p>{lead}</p>
            {perks ? (
              <div className="perks">
                {PERKS.map(([icon, text]) => (
                  <div key={text}>
                    <Icon name={icon} />
                    {text}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <span className="ring" aria-hidden="true" />
          <AppLink to="/" className="back">
            <Icon name="back" size="sm" />
            回到首页
          </AppLink>
        </div>
        <div className="auth-form">
          <div className="auth-card">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** Inline error box with an optional action (e.g. 重新发送验证邮件). */
export function AuthError({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="auth-err" role="alert">
      <Icon name="warn" />
      <span>{children}</span>
      {action}
    </div>
  )
}

/** The prototype's 「邮件已发出」 / result panel. */
export function SentPanel({ icon = 'mail', title, bad, children }: { icon?: IconName; title: ReactNode; bad?: boolean; children?: ReactNode }) {
  return (
    <div className={cx('sent', bad && 'bad')} role="status">
      <Icon name={icon} size="lg" />
      <h3>{title}</h3>
      {children ? <p className="muted">{children}</p> : null}
    </div>
  )
}

/** Four-segment password strength meter. */
export function PasswordMeter({ score }: { score: number }) {
  return (
    <div className={cx('pw-meter', score > 0 && score < 3 && 'weak')} aria-hidden="true">
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= score ? 'on' : undefined} />
      ))}
    </div>
  )
}
