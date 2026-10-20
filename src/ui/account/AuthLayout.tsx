import type { ReactNode } from 'react'
import { cx } from '../cx'
import { Icon, type IconName } from '../Icon'
import { AppLink } from '../link'
import { LogoMark } from '../LogoMark'

// The auth split from the prototype (登录 / 注册 / 找回密码): an art panel on the left, the form card on
// the right. Phones stack them edge to edge, the art panel reduced to the title, one sentence and the
// way back. Everything in the card is one column: each child spans the card's full width (titles,
// text, fields, notices, buttons and link rows alike), so no element ends short of the others.

const PERKS: [IconName, string][] = [
  ['heart', '收藏夹多端同步'],
  ['chat', '评论区发贴纸'],
  ['upload', '投稿自己的表情包'],
  ['bell', '审核结果和回复提醒'],
]

/**
 * `perks`: the login panel of the prototype (perks, the decoration and 回到首页), used by 登录, 找回密码
 * and 重置密码. Without it the panel is the register one: title and one sentence.
 */
export function AuthLayout({ title, lead, perks, tone, children }: { title: ReactNode; lead: ReactNode; perks?: boolean; tone?: 'purple'; children: ReactNode }) {
  return (
    <div className="wrap">
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
          {perks ? (
            <>
              <span className="ring" aria-hidden="true" />
              <AppLink to="/" className="back">
                <Icon name="back" size="sm" />
                回到首页
              </AppLink>
            </>
          ) : null}
        </div>
        <div className="auth-form">
          <div className="auth-card">{children}</div>
        </div>
      </div>
    </div>
  )
}

/** One full-width line: an error (with an optional action such as 重新发送 or 重试) or a confirmation. */
export function AuthNotice({ tone = 'err', children, action }: { tone?: 'err' | 'ok'; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={cx('auth-note', tone)} role={tone === 'err' ? 'alert' : 'status'}>
      <Icon name={tone === 'err' ? 'warn' : 'check'} />
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

/** A centred prompt under the form: 「还没有账号？注册」. Spans the card like everything else. */
export function AuthAlt({ children }: { children: ReactNode }) {
  return <p className="auth-alt">{children}</p>
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
