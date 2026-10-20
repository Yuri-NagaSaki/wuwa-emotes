import { z } from 'zod'
import { SEED_RE } from './inputs'
import type { KeyCol, KeyType } from './sql'

// Opaque cursors: base64url(JSON { s: scope, k: key values as text, seed? }). The key values are the
// exact sort keys of the last row (timestamps keep microseconds) and only ever reach SQL as bind
// parameters with an explicit cast. Anything malformed is a CatalogInputError (400), never a 500.

export class CatalogInputError extends Error {}

const payload = z.object({
  s: z.string().max(40),
  k: z.array(z.string().max(80)).min(1).max(8),
  seed: z.string().regex(SEED_RE).optional(),
})

export interface Cursor {
  scope: string
  keys: string[]
  seed?: string
}

const TYPE_RE: Record<KeyType, RegExp> = {
  int: /^-?\d{1,10}$/,
  bigint: /^-?\d{1,19}$/,
  timestamptz: /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2}){0,2})?$/,
  text: /^[\s\S]{0,80}$/,
}

export function encodeCursor(c: Cursor): string {
  const body: z.infer<typeof payload> = { s: c.scope, k: c.keys, ...(c.seed ? { seed: c.seed } : {}) }
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64url')
}

/** Decode and check a cursor against the list it is used for (scope) and its key columns. */
export function decodeCursor(raw: string, scope: string, cols: KeyCol[]): Cursor {
  let parsed: z.infer<typeof payload>
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('charset')
    parsed = payload.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
  } catch {
    throw new CatalogInputError('invalid cursor')
  }
  if (parsed.s !== scope || parsed.k.length !== cols.length) throw new CatalogInputError('cursor does not belong to this list')
  parsed.k.forEach((v, i) => {
    if (!TYPE_RE[cols[i]!.type].test(v)) throw new CatalogInputError('invalid cursor')
  })
  return { scope: parsed.s, keys: parsed.k, seed: parsed.seed }
}

/** A fresh random-order seed (8 base-36 chars). */
export function newSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('')
}
