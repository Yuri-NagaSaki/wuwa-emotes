// Search-param parsers for the admin routes' validateSearch. Hand-written rather than zod: validateSearch
// stays in the route tree, which is part of the entry chunk every page loads, so a zod schema here
// shipped zod (~24 KB gzip) to every public visitor. The router has already JSON-parsed the query
// (`?page=2` arrives as the number 2, `?banned=true` as true). A bad value becomes undefined, as with
// zod's `.optional().catch(undefined)`; undefined keys are left out of the result.

export type Parser<T> = (v: unknown) => T | undefined

/** A string of at most `max` characters (a number is taken as its decimal text). */
export const text =
  (max: number): Parser<string> =>
  (v) => {
    const s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined
    return s !== undefined && s.length <= max ? s : undefined
  }

export const oneOf =
  <const T extends string>(values: readonly T[]): Parser<T> =>
  (v) =>
    typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : undefined

/** An integer in [min, max], from a number or a numeric string. */
export const int =
  (min: number, max = Number.MAX_SAFE_INTEGER): Parser<number> =>
  (v) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
    return Number.isInteger(n) && n >= min && n <= max ? n : undefined
  }

export const bool: Parser<boolean> = (v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : undefined)

/** YYYY-MM-DD */
export const day: Parser<string> = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined)

export type Parsed<S extends Record<string, Parser<unknown>>> = { [K in keyof S]?: S[K] extends Parser<infer T> ? T : never }

/** validateSearch for a route: every key optional, unknown keys dropped. */
export function searchParser<S extends Record<string, Parser<unknown>>>(shape: S): (raw: Record<string, unknown>) => Parsed<S> {
  return (raw) => {
    const out: Record<string, unknown> = {}
    for (const [k, parse] of Object.entries(shape)) {
      const v = parse(raw?.[k])
      if (v !== undefined) out[k] = v
    }
    return out as Parsed<S>
  }
}
