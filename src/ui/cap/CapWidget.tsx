import { useEffect, useRef, useState, type DetailedHTMLProps, type HTMLAttributes } from 'react'
import type { CapErrorEvent, CapSolveEvent } from '@cap.js/widget'
import { cx } from '../cx'
import { useOptionalSiteConfig } from '../site-config'
import { loadCap } from './load'

type CapWidgetAttrs = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  'data-cap-api-endpoint'?: string
  'data-cap-hidden-field-name'?: string
  [key: `data-cap-i18n-${string}`]: string | undefined
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'cap-widget': CapWidgetAttrs
    }
  }
}

const I18N = {
  'data-cap-i18n-initial-state': '我是人类',
  'data-cap-i18n-verifying-label': '验证中…',
  'data-cap-i18n-solved-label': '已通过验证',
  'data-cap-i18n-error-label': '验证失败，请重试',
  'data-cap-i18n-required-label': '请先完成人机验证',
  'data-cap-i18n-verify-aria-label': '点击进行人机验证',
  'data-cap-i18n-verifying-aria-label': '正在验证，请稍候',
  'data-cap-i18n-verified-aria-label': '人机验证已通过，可以继续',
  'data-cap-i18n-error-aria-label': '验证出错，请重试',
  'data-cap-i18n-wasm-disabled': '开启 WebAssembly 可以更快完成验证',
  'data-cap-i18n-troubleshooting-label': '排查问题',
} as const

export interface CapError {
  code?: string
  message: string
}

export interface CapWidgetProps {
  /** Called with a fresh single-use token after the visitor passes. */
  onToken: (token: string) => void
  onError?: (error: CapError) => void
  /** The token expired or the widget was reset: discard the old token. */
  onReset?: () => void
  /** Overrides the endpoint from the server config. */
  endpoint?: string
  /** Name of the hidden form field that carries the token (default cap-token). */
  fieldName?: string
  className?: string
}

/**
 * The <cap-widget> custom element. Rendered on the server as an empty placeholder of the same size;
 * the script is loaded in the browser after mount. Keep the "Cap" label: it is the widget's credit.
 */
export function CapWidget({ onToken, onError, onReset, endpoint, fieldName = 'cap-token', className }: CapWidgetProps) {
  const config = useOptionalSiteConfig()
  const apiEndpoint = endpoint ?? config?.cap.endpoint
  const ref = useRef<HTMLElement>(null)
  const handlers = useRef({ onToken, onError, onReset })
  handlers.current = { onToken, onError, onReset }
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    loadCap().catch((err: Error) => {
      if (!alive) return
      setFailed(true)
      handlers.current.onError?.({ code: 'load_failed', message: err.message })
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const solve = (e: Event) => handlers.current.onToken((e as CapSolveEvent).detail.token)
    const error = (e: Event) => {
      const d = (e as CapErrorEvent).detail
      handlers.current.onError?.({ code: d?.code, message: d?.message ?? 'Cap error' })
    }
    const reset = () => handlers.current.onReset?.()
    el.addEventListener('solve', solve)
    el.addEventListener('error', error)
    el.addEventListener('reset', reset)
    return () => {
      el.removeEventListener('solve', solve)
      el.removeEventListener('error', error)
      el.removeEventListener('reset', reset)
    }
  }, [])

  if (!apiEndpoint) return null
  return (
    <div className={cx('cap-box', failed && 'is-failed', className)}>
      <cap-widget ref={ref} data-cap-api-endpoint={apiEndpoint} data-cap-hidden-field-name={fieldName} {...I18N} />
      {failed ? <span className="hint err">人机验证组件加载失败，请刷新重试</span> : null}
    </div>
  )
}
