import type { Cap as CapClass } from '@cap.js/widget'

// Self-hosted Cap (proof-of-work CAPTCHA). The widget script is bundled and loaded on demand in the
// browser; its WASM and the pako fallback come from this site (public/cap/, copied at build by
// scripts/copy-cap-assets.ts), never from jsDelivr. Tokens are single-use: send each one once, in the
// x-cap-token header, with the request it protects.

export const CAP_TOKEN_HEADER = 'x-cap-token'

type CapCtor = typeof CapClass
type CapWindow = Window & { CAP_DISABLE_WIDGET_REF?: boolean }

let loading: Promise<CapCtor> | null = null
let configuredEndpoint: string | null = null

/** Set by the root layout from the server config, so solveInvisible() needs no arguments. */
export function setCapEndpoint(endpoint: string) {
  configuredEndpoint = endpoint
}

/** Load the widget once (defines <cap-widget> and window.Cap). Browser only. */
export function loadCap(): Promise<CapCtor> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Cap loads in the browser only'))
  loading ??= (async () => {
    const w = window as CapWindow
    w.CAP_CUSTOM_WASM_URL = '/cap/cap_wasm_bg.wasm'
    w.CAP_CUSTOM_HASHWX_URL = '/cap/hashwx.wasm'
    w.CAP_PAKO_URL = '/cap/pako_inflate.min.js'
    // The "Cap" label stays; its link just doesn't report our hostname/URL to trycap.dev.
    w.CAP_DISABLE_WIDGET_REF = true
    w.CAP_SILENT = import.meta.env.PROD
    const mod = (await import('@cap.js/widget')) as unknown as { default?: CapCtor }
    const Cap = mod.default ?? window.Cap
    if (!Cap) throw new Error('Cap widget failed to load')
    return Cap
  })()
  loading.catch(() => {
    loading = null
  })
  return loading
}

/**
 * Solve a challenge without showing a widget: Cap's own invisible mode, a hidden <cap-widget> on the
 * document element, removed again afterwards. Used by background actions (a batch download) and by the
 * account forms (useInvisibleCap). Resolves with a single-use token for the x-cap-token header; rejects
 * when the proof of work fails, or with the signal's reason when it aborts.
 */
export async function solveInvisible(endpoint: string | null = configuredEndpoint, signal?: AbortSignal): Promise<string> {
  if (!endpoint) throw new Error('Cap endpoint is not configured')
  signal?.throwIfAborted()
  const Cap = await loadCap()
  signal?.throwIfAborted()
  const cap = new Cap({ apiEndpoint: endpoint })
  // removing the widget aborts its solve (disconnectedCallback), which then resolves with nothing
  const stop = () => cap.widget.remove()
  signal?.addEventListener('abort', stop, { once: true })
  try {
    // solve() resolves undefined instead of rejecting when it is aborted or the instrumentation check fails
    const res = (await cap.solve()) as { success?: boolean; token?: string } | undefined
    signal?.throwIfAborted()
    if (!res?.success || !res.token) throw new Error('Cap verification failed')
    return res.token
  } finally {
    signal?.removeEventListener('abort', stop)
    cap.widget.remove()
  }
}

/** Header object for fetch(): `{ headers: capHeaders(token) }`. */
export function capHeaders(token: string): Record<string, string> {
  return { [CAP_TOKEN_HEADER]: token }
}
