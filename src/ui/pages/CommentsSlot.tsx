import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { PackEmoji } from '#/server/catalog/types'
import { Icon } from '../Icon'

// The comment thread of a pack (src/ui/comments, docs/ARCHITECTURE.md §9). Threads are per viewer,
// so nothing of them is in the shared HTML: the server renders this placeholder, and the comments
// code (with its own stylesheet) loads once the section comes within ~1.5 screens of the viewport.

const CommentsSection = lazy(() => import('../comments').then((m) => ({ default: m.CommentsSection })))

function Placeholder({ text }: { text: string }) {
  return (
    <section className="sec cm cm-slot" id="comments" aria-labelledby="comments-h">
      <div className="cm-head">
        <h2 id="comments-h">评论</h2>
      </div>
      <div className="card dashed">
        <Icon name="chat" /> {text}
      </div>
    </section>
  )
}

export function CommentsSlot({ packId, stickers }: { packId: number; stickers: readonly PackEmoji[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '150% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [near])
  return (
    <div ref={ref} style={{ minWidth: 0 }}>
      {near ? (
        <Suspense fallback={<Placeholder text="评论加载中…" />}>
          <CommentsSection threadType="pack" threadId={String(packId)} packId={packId} packStickers={stickers} eager />
        </Suspense>
      ) : (
        <Placeholder text="评论在滚动到这里时加载。" />
      )}
    </div>
  )
}
