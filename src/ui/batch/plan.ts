import type { BatchItem } from '#/server/catalog/types'

// Pure helpers of the 打包清单 (tray, /batch and the ZIP runner). No React, DOM or network.

/** Ids per POST /api/batch/sign. Mirrors BATCH_MAX_IDS in src/server/downloads/handlers.ts (that module
 *  pulls in zod, so it is not imported here; tests/pages/batch-plan.test.ts checks they agree). */
export const SIGN_CHUNK = 20
/** Stickers per ZIP (docs/ARCHITECTURE.md §6.1: 每 200 张一个压缩包). The site's 单次打包张数上限 may cut a
 *  volume shorter; the server then answers volume_full and the rest goes into the next ZIP. */
export const VOLUME_MAX = 200
/** Ids per batchItemsFn call (BATCH_ITEMS_MAX in src/server/catalog/inputs.ts). */
export const ITEMS_PAGE = 500

export function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** How many ZIPs a selection needs at most (fewer volumes only if nothing cuts them short). */
export function volumeCount(n: number): number {
  return Math.max(1, Math.ceil(n / VOLUME_MAX))
}

/** A name not in `taken` (adds it): a-01.gif, then a-01-2.gif, a-01-3.gif … */
export function uniqueName(name: string, taken: Set<string>): string {
  let out = name
  if (taken.has(out)) {
    const dot = name.lastIndexOf('.')
    const stem = dot > 0 ? name.slice(0, dot) : name
    const ext = dot > 0 ? name.slice(dot) : ''
    for (let k = 2; taken.has((out = `${stem}-${k}${ext}`)); k++);
  }
  taken.add(out)
  return out
}

/** File name of a batch ZIP: <site>-<n>-stickers.zip, with -part<k> when the selection needs several. */
export function zipFileName(host: string, count: number, part: number, parts: number): string {
  const label = (host.split('.').find((x) => x && x !== 'www') ?? '').replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'stickers'
  return `${label}-${count}-stickers${parts > 1 ? `-part${part}` : ''}.zip`
}

/** What the page says about an id it cannot pack. */
export const REASON_TEXT: Record<string, string> = {
  not_found: '已下架或暂不可见',
  not_downloadable: '这个包只提供预览，不提供原图与打包',
  fetch_failed: '原图没有下载成功',
  rate_limited: '签发太频繁，没有来得及打包',
  originals_daily_limit: '今天的原图额度已用完',
  packs_daily_limit: '今天的打包次数已用完',
  volume_full: '超出单次打包张数上限',
}

export function reasonText(reason: string): string {
  return REASON_TEXT[reason] ?? '没有打包成功'
}

// ---------- the list as the page shows it ----------

export interface BatchGroup {
  slug: string
  title: string
  items: BatchItem[]
}

export interface BatchView {
  /** ids that can go into a ZIP, in list order */
  packable: string[]
  /** grouped by pack, packs in order of first appearance */
  groups: BatchGroup[]
  /** packs that only offer previews (packs.downloadable off): shown apart, never signed */
  previewOnly: BatchGroup[]
  /** ids that are not public any more (or unknown) */
  missing: string[]
  /** ids whose details are still loading */
  loading: string[]
  /** original bytes of the packable ones */
  bytes: number
}

/**
 * Sort the stored ids by what is known about them. `known` maps an id to its item, or to null when the
 * server did not return it (not public); ids absent from `known` are still loading.
 */
export function batchView(ids: readonly string[], known: ReadonlyMap<string, BatchItem | null>): BatchView {
  const groups = new Map<string, BatchGroup>()
  const preview = new Map<string, BatchGroup>()
  const view: BatchView = { packable: [], groups: [], previewOnly: [], missing: [], loading: [], bytes: 0 }
  for (const id of ids) {
    if (!known.has(id)) {
      view.loading.push(id)
      continue
    }
    const item = known.get(id)
    if (!item) {
      view.missing.push(id)
      continue
    }
    const into = item.pack.downloadable ? groups : preview
    let g = into.get(item.pack.slug)
    if (!g) into.set(item.pack.slug, (g = { slug: item.pack.slug, title: item.pack.title, items: [] }))
    g.items.push(item)
    if (item.pack.downloadable) {
      view.packable.push(id)
      view.bytes += item.bytes
    }
  }
  view.groups = [...groups.values()]
  view.previewOnly = [...preview.values()]
  return view
}
