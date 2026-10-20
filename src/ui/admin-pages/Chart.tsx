import { useState } from 'react'
import { fmtN } from '../format'

// Single-series daily area chart (近 30 天下载). One series: the panel title names it, so no legend.
// Hover or focus a day for its value; the same numbers are listed in a visually hidden table.

const W = 640
const H = 220
const PAD = { l: 40, r: 12, t: 14, b: 26 }

function niceMax(v: number): number {
  if (v <= 4) return 4
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

export function DailyChart({ points, label }: { points: { day: string; n: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = niceMax(Math.max(0, ...points.map((p) => p.n)))
  const iw = W - PAD.l - PAD.r
  const ih = H - PAD.t - PAD.b
  const x = (i: number) => PAD.l + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw)
  const y = (n: number) => PAD.t + ih - (n / max) * ih
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.n).toFixed(1)}`).join('')
  const area = points.length ? `${line}L${x(points.length - 1).toFixed(1)},${PAD.t + ih}L${x(0).toFixed(1)},${PAD.t + ih}Z` : ''
  const ticks = [0, max / 2, max]
  const step = Math.max(1, Math.ceil(points.length / 6))
  const h = hover == null ? null : points[hover]
  const tipX = hover == null ? 0 : Math.min(Math.max(x(hover), PAD.l + 60), W - PAD.r - 60)

  return (
    <div className="adm-chart">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="ax" x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end">
              {fmtN(Math.round(t))}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % step === 0 || i === points.length - 1 ? (
            <text key={p.day} className="ax" x={x(i)} y={H - 8} textAnchor={i === points.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>
              {p.day.slice(5).replace('-', '/')}
            </text>
          ) : null,
        )}
        <path className="area" d={area} />
        <path className="line" d={line} />
        {h && hover != null ? (
          <g>
            <line className="grid" x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} strokeDasharray="3 3" />
            <circle className="dot" cx={x(hover)} cy={y(h.n)} r={5} />
            <g transform={`translate(${tipX},${Math.max(PAD.t + 4, y(h.n) - 40)})`}>
              <rect className="adm-chart-tip" x={-58} y={0} width={116} height={30} rx={9} />
              <text className="adm-chart-tip-t" x={0} y={19} textAnchor="middle">
                {`${h.day.slice(5).replace('-', '/')} · ${fmtN(h.n)} 次`}
              </text>
            </g>
          </g>
        ) : null}
        {points.map((p, i) => (
          <rect
            key={p.day}
            x={x(i) - iw / Math.max(1, points.length - 1) / 2}
            y={PAD.t}
            width={iw / Math.max(1, points.length - 1)}
            height={ih}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      <div className="sr">
        <table>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th>日期</th>
            <th>次数</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <td>{p.day}</td>
              <td>{p.n}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  )
}
