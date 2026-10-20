import { fmtN } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { LogoMark, LogoWord } from '../LogoMark'
import { FOOTER_NAV } from './nav'

export interface FooterProps {
  siteName: string
  subtitle?: string
  /** Catalog totals for the base line; omitted when unknown. */
  stats?: { emojis: number; packs: number } | null
  year?: number
}

/** Deep-teal footer with the tide line. */
export function Footer({ siteName, subtitle, stats, year = new Date().getFullYear() }: FooterProps) {
  return (
    <footer className="foot">
      <div className="foot-wave" aria-hidden="true">
        <svg viewBox="0 0 1200 40" preserveAspectRatio="none">
          <path className="back" d="M0 22 Q75 4 150 22 T300 22 T450 22 T600 22 T750 22 T900 22 T1050 22 T1200 22 V40 H0z" />
          <path d="M0 26 Q75 12 150 26 T300 26 T450 26 T600 26 T750 26 T900 26 T1050 26 T1200 26 V40 H0z" />
        </svg>
      </div>
      <div className="wrap">
        <div className="about">
          <AppLink to="/" className="logo" aria-label={`${siteName}首页`}>
            <LogoMark />
            <LogoWord name={siteName} subtitle={subtitle} />
          </AppLink>
          <p>潮友共建的鸣潮表情仓库。表情版权归原画师与官方所有，本站按 CC BY-NC-SA 4.0 等原始许可整理发布，不做商用。</p>
        </div>
        {FOOTER_NAV.map((g) => (
          <div key={g.title}>
            <h4>{g.title}</h4>
            <ul>
              {g.links.map((l) => (
                <li key={l.to}>
                  <AppLink to={l.to}>{l.label.replace('{site}', siteName)}</AppLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="foot-base">
          <span>
            © {year} {siteName} · 非官方粉丝站，与库洛游戏无关
          </span>
          <span className="lic">
            <Icon name="shield" size="sm" />
            画师署名随包附带 CREDITS.txt
          </span>
          {stats ? (
            <span>
              表情 {fmtN(stats.emojis)} 张 · 表情包 {fmtN(stats.packs)} 个
            </span>
          ) : null}
        </div>
      </div>
    </footer>
  )
}
