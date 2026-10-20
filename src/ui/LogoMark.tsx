import { cx } from './cx'

/** Brand mark: a tidepool with a starfish and a ripple. Decorative; pair it with the site name. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={cx('logo-mark', className)} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path d="M24 4c11.6 0 20 6.9 20 18.6C44 35.3 35.6 44 23.4 44 11.5 44 4 36.6 4 25.4 4 12.2 12.5 4 24 4z" fill="#19c8b9" />
      <path
        d="M24 4c11.6 0 20 6.9 20 18.6C44 35.3 35.6 44 23.4 44 11.5 44 4 36.6 4 25.4 4 12.2 12.5 4 24 4z"
        fill="none"
        stroke="#794f27"
        strokeWidth="2.6"
      />
      <path d="M10 28c3-2.6 6-2.6 9 0s6 2.6 9 0 6-2.6 9 0" fill="none" stroke="#e9fbf7" strokeWidth="2.6" strokeLinecap="round" />
      <path
        d="M27.5 10.5l2 4.6 5 .5-3.8 3.3 1.1 4.9-4.3-2.6-4.3 2.6 1.1-4.9-3.8-3.3 5-.5z"
        fill="#f7cd67"
        stroke="#794f27"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="15" cy="17" r="2.2" fill="#fffdf4" />
      <circle cx="34" cy="33" r="1.6" fill="#fffdf4" />
    </svg>
  )
}

/** Logo mark + site name + subtitle, as in the header, footer and admin sidebar. */
export function LogoWord({ name, subtitle }: { name: string; subtitle?: string }) {
  return (
    <span className="logo-word">
      <b>{name}</b>
      {subtitle ? <small>{subtitle}</small> : null}
    </span>
  )
}
