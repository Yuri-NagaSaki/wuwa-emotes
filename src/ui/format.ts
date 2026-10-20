// Number formats used across cards and stats (same rules as the prototype).

// One formatter for every call: toLocaleString('en-US') builds a new ICU formatter each time, which
// showed up at 20–40 ms per masonry page render on a 4× slowed CPU.
const EN = new Intl.NumberFormat('en-US')

/** 15272 -> "15,272" */
export function fmtN(n: number): string {
  return EN.format(n)
}

/** Counts in 万 from 10,000 up: 18600 -> "1.9 万", 1860771 -> "186 万". */
export function fmtW(n: number): string {
  if (n < 10_000) return fmtN(n)
  return (n / 10_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '') + ' 万'
}

/** Bytes: KB below 1 MiB, then MB, then GiB. */
export function fmtB(b: number): string {
  if (b >= 1_073_741_824) return (b / 1_073_741_824).toFixed(1) + ' GiB'
  if (b >= 1_048_576) return (b / 1_048_576).toFixed(1) + ' MB'
  return Math.round(b / 1024) + ' KB'
}
