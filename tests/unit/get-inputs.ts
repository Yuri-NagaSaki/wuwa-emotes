// Helpers for get-input-size.test.ts: what a server function validator accepts, and how long the URL of a
// GET server function call gets. A GET puts its input into the query string; Cloudflare answered 520
// once that passed roughly 20 KB (favoriteStatusFn with ~100 targets), so GET inputs must stay small.
import { encode } from '@tanstack/router-core'
import { createDefaultSerovalPlugins } from '@tanstack/router-core/ssr/client'
import { toJSONAsync } from 'seroval'

/** Longest URL a GET server function may need (the edge rejected far longer ones, 5–14 KB worked). */
export const GET_URL_LIMIT = 8 * 1024
/** Room for `/_serverFn/<function id>` before the query string (ids are ~150–250 characters). */
export const FN_PATH_ALLOWANCE = 320

export interface InputFinding {
  /** where in the input, e.g. `.targets[]` */
  path: string
  /** a collection (unbounded length unless `max`) or a validator the scan cannot read */
  kind: 'array' | 'set' | 'record' | 'map' | 'tuple-rest' | 'unknown'
  max?: number
}

interface ZodLike {
  _zod: { def: { type: string; [k: string]: unknown } }
}

const isZod = (v: unknown): v is ZodLike => !!v && typeof v === 'object' && '_zod' in v && !!(v as ZodLike)._zod?.def

function maxLength(def: ZodLike['_zod']['def']): number | undefined {
  const checks = (def.checks as ZodLike[] | undefined) ?? []
  let max: number | undefined
  for (const c of checks) {
    const d = c._zod.def as { check?: string; maximum?: number; length?: number }
    if (d.check === 'max_length' && typeof d.maximum === 'number') max = Math.min(max ?? Infinity, d.maximum)
    if (d.check === 'length_equals' && typeof d.length === 'number') max = Math.min(max ?? Infinity, d.length)
  }
  return max
}

/** Collections (and unreadable parts) in the input a validator accepts. Scalars are not reported. */
export function inputFindings(validator: unknown): InputFinding[] {
  const out: InputFinding[] = []
  const seen = new Set<unknown>()
  const walk = (s: unknown, path: string) => {
    if (s === undefined) return
    if (!isZod(s)) {
      out.push({ path, kind: 'unknown' })
      return
    }
    if (seen.has(s)) return
    seen.add(s)
    const def = s._zod.def
    switch (def.type) {
      case 'array':
        out.push({ path: path || '.', kind: 'array', max: maxLength(def) })
        walk(def.element, `${path}[]`)
        return
      case 'set':
        out.push({ path: path || '.', kind: 'set', max: maxLength(def) })
        walk(def.valueType, `${path}{}`)
        return
      case 'record':
      case 'map':
        out.push({ path: path || '.', kind: def.type })
        walk(def.valueType, `${path}{}`)
        return
      case 'object':
        for (const [k, v] of Object.entries(def.shape as Record<string, unknown>)) walk(v, `${path}.${k}`)
        if (def.catchall && (def.catchall as ZodLike)._zod.def.type !== 'never') out.push({ path: `${path}.*`, kind: 'record' })
        return
      case 'tuple':
        ;(def.items as unknown[]).forEach((it, i) => walk(it, `${path}[${i}]`))
        if (def.rest) out.push({ path: `${path}[…]`, kind: 'tuple-rest' })
        return
      case 'optional':
      case 'nullable':
      case 'default':
      case 'prefault':
      case 'catch':
      case 'readonly':
      case 'nonoptional':
      case 'success':
        walk(def.innerType, path)
        return
      case 'pipe':
        // the client sends what the input side accepts
        walk(def.in, path)
        return
      case 'union':
      case 'xor':
        ;(def.options as unknown[]).forEach((o) => walk(o, path))
        return
      case 'intersection':
        walk(def.left, path)
        walk(def.right, path)
        return
      case 'lazy':
        walk((def.getter as () => unknown)(), path)
        return
      case 'any':
      case 'unknown':
      case 'transform':
      case 'custom':
        out.push({ path: path || '.', kind: 'unknown' })
        return
      default:
        // string, number, boolean, enum, literal, date, bigint, null, undefined, int, template_literal, …
        return
    }
  }
  walk(validator, '')
  return out
}

/**
 * Bytes of the URL the browser requests for a GET server function call with `data` as input: the same
 * steps as Start's client fetcher (serverFnFetcher: seroval toJSONAsync with the default plugins →
 * JSON.stringify → router-core encode({ payload })), plus FN_PATH_ALLOWANCE for the path. The app
 * registers no serialization adapters, so the default plugins are the whole list
 * (getDefaultSerovalPlugins needs a running Start context to read that).
 */
export async function getCallUrlBytes(data: unknown): Promise<number> {
  const payload = JSON.stringify(await toJSONAsync({ data }, { plugins: createDefaultSerovalPlugins() }))
  return FN_PATH_ALLOWANCE + 1 + encode({ payload }).length
}
