import type { ReactNode } from 'react'
import { cx } from '../cx'
import { fmtN } from '../format'
import { Icon, type IconName } from '../Icon'
import { AppLink } from '../link'
import { LogoMark } from '../LogoMark'
import { useOptionalSiteConfig } from '../site-config'
import type { ArtSticker } from './art'

// The auth split from the prototype (登录 / 注册 / 找回密码): an art panel on the left, the form card on
// the right. Phones stack them edge to edge, the art panel reduced to the logo, the title and one
// sentence (at most 220 px; 首页 is in the tab bar). Everything in the card is one column: each child
// spans the card's full width (titles, text, fields, notices, buttons and link rows alike), so no
// element ends short of the others.
//
// The art panel: a wall of real stickers (loaded by the route from the home data, art.ts) drifting
// slowly in columns, under a scrim in the panel's tone that is solid behind the text. The wall is
// decoration only (aria-hidden, absolutely placed, fixed-size wells), so it never moves the layout and
// the form does not wait for it. Phones keep two short rows beside the logo and title.

const PERKS: [IconName, string][] = [
  ['heart', '收藏夹多端同步'],
  ['chat', '评论区发贴纸'],
  ['upload', '投稿自己的表情包'],
  ['bell', '审核结果和回复提醒'],
]

/** Columns on a wide desktop (two on a narrow one); phones show the first two as rows. */
const STRIPS = 3
/** Copies of each strip in its track: one strip of stickers is shorter than the panel. */
const COPIES = 3

/**
 * The drifting wall. Strip k holds stickers k, k+3, …; each track repeats its strip COPIES times and
 * moves by one copy per loop (CSS: .art-track). The first copy of the first two strips is eager (on
 * screen on every size), everything else lazy: the duplicates reuse the same URLs, and strip 3 is not
 * rendered on phones and narrow desktops (display: none), so its stickers are never fetched there.
 */
function ArtWall({ stickers }: { stickers: ArtSticker[] }) {
  const strips = Array.from({ length: STRIPS }, (_, s) => stickers.filter((_, i) => i % STRIPS === s))
  return (
    <div className="art-wall" aria-hidden="true">
      {strips.map((list, s) => (
        <div key={s} className="art-strip">
          <div className="art-track">
            {Array.from({ length: COPIES }, (_, copy) =>
              list.map((st) => (
                <span key={`${copy}-${st.id}`} className="art-well">
                  <img src={st.src} width={st.w} height={st.h} alt="" decoding="async" loading={copy === 0 && s < 2 ? 'eager' : 'lazy'} fetchPriority="low" draggable={false} />
                </span>
              )),
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * `perks`: the login panel of the prototype (perks and 回到首页), used by 登录, 找回密码 and 重置密码.
 * Without it the panel is the register one: title and one sentence. `tone`: purple for 注册 and
 * 验证邮箱, the deep tide otherwise. `art`: the wall's stickers (none: the plain panel).
 */
export function AuthLayout({ title, lead, perks, tone, art, children }: { title: ReactNode; lead: ReactNode; perks?: boolean; tone?: 'purple'; art?: ArtSticker[]; children: ReactNode }) {
  const stats = useOptionalSiteConfig()?.stats
  return (
    <div className="wrap">
      <div className="auth">
        <div className={cx('auth-art', tone, art?.length ? 'has-wall' : null)}>
          {art?.length ? <ArtWall stickers={art} /> : null}
          <div className="art-copy">
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
            {stats && stats.emojis > 0 ? (
              <p className="art-stats">
                表情 {fmtN(stats.emojis)} 张 · 表情包 {fmtN(stats.packs)} 个
              </p>
            ) : null}
          </div>
          {perks ? (
            <AppLink to="/" className="back">
              <Icon name="back" size="sm" />
              回到首页
            </AppLink>
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
