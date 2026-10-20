import type { ReactNode } from 'react'

// Small Markdown preview for 介绍 (description_md): headings, paragraphs, lists, **bold**, *italic*,
// `code` and http(s) links. Builds React elements (no innerHTML), so nothing in the text can inject
// markup. The public page renders the stored source with its own renderer.

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${i++}`
    if (m[2]) out.push(<strong key={k}>{m[2]}</strong>)
    else if (m[3]) out.push(<em key={k}>{m[3]}</em>)
    else if (m[4]) out.push(<code key={k}>{m[4]}</code>)
    else if (m[5] && m[6])
      out.push(
        <a key={k} href={m[6]} rel="nofollow ugc noopener" target="_blank">
          {m[5]}
        </a>,
      )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.replace(/\r\n?/g, '\n').split(/\n{2,}/)
  return (
    <div className="adm-md">
      {blocks.map((b, bi) => {
        const lines = b.split('\n').filter((l) => l.trim() !== '')
        if (!lines.length) return null
        const h = /^(#{1,6})\s+(.*)$/.exec(lines[0]!)
        if (h && lines.length === 1) return h[1]!.length <= 2 ? <h4 key={bi}>{inline(h[2]!, `h${bi}`)}</h4> : <h5 key={bi}>{inline(h[2]!, `h${bi}`)}</h5>
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.replace(/^\s*[-*]\s+/, ''), `l${bi}-${li}`)}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => (
              <span key={li}>
                {li > 0 ? <br /> : null}
                {inline(l, `p${bi}-${li}`)}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}
