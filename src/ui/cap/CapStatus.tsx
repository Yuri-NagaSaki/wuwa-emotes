import type { CSSProperties } from 'react'
import { cx } from '../cx'
import { Icon } from '../Icon'
import type { InvisibleCap } from './useInvisibleCap'

// The account forms' Cap line (登录 / 注册 / 找回密码), directly above the submit button: a small
// shield and one short text in the muted ink, a 2 px track under the text while the proof of work
// runs, a teal check once the token is ready, and 重试 after a failure. No frame and no widget; the
// solve itself runs in the background (useInvisibleCap). The line has a fixed height in every state
// (styles: .cap-line in src/ui/account/account.css), so the button under it never moves.
//
// Before the first solve starts (server render, hydration) it reads like solving: the session starts
// right after mount, so the text does not change at hydration.

const TEXT = {
  solving: '正在进行人机验证…',
  ready: '已通过人机验证',
  failed: '人机验证没有完成',
} as const

/** Outline of the sprite's shield, without its check: the "working" state. */
function Shield() {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.5l7 2.8v5.2c0 4.6-3.2 8-7 9.5-3.8-1.5-7-4.9-7-9.5V6.3z" />
    </svg>
  )
}

export function CapStatus({ cap, className }: { cap: Pick<InvisibleCap, 'phase' | 'progress' | 'retry'>; className?: string }) {
  const state = cap.phase === 'idle' ? 'solving' : cap.phase
  // the solver's own progress drives the bar; before its first report the bar runs indeterminate
  const known = state === 'solving' && cap.progress != null
  return (
    <div className={cx('cap-line', `is-${state}`, known && 'is-known', className)} role="status" aria-live="polite" title="在后台自动完成，不需要点击">
      <span className="cap-ico">{state === 'ready' ? <Icon name="check" /> : <Shield />}</span>
      <span className="cap-txt">{TEXT[state]}</span>
      {state === 'failed' ? (
        <button type="button" className="cap-retry" onClick={cap.retry}>
          重试
        </button>
      ) : null}
      <span className="cap-bar" aria-hidden="true">
        <i style={known ? ({ '--cap-p': cap.progress! / 100 } as CSSProperties) : undefined} />
      </span>
    </div>
  )
}
