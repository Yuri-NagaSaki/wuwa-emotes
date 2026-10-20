import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect } from 'react'
import { emojiPageFn } from '#/server/catalog/fns'
import { EMOJI_ID_RE } from '#/shared/ids'
import { cachedPackOf, rememberPack } from '#/ui/pages/pack-cache'
import { PackPage } from '#/ui/pages/PackPage'
import { pageHead } from '#/ui/pages/seo'

// /e/<emojiId>: the share link of one sticker. The server renders its pack page with the dialog
// already open (in the HTML, image requested with high priority); ←/→ replace this entry, closing goes
// to /packs/<slug> (Back reopens the sticker). Inside a pack page the same address is only a mask.

export const Route = createFileRoute('/_site/e/$emojiId')({
  loader: async ({ params }) => {
    if (!EMOJI_ID_RE.test(params.emojiId)) throw notFound()
    const hit = cachedPackOf(params.emojiId)
    if (hit) return hit
    const r = await emojiPageFn({ data: { emojiId: params.emojiId } })
    if (!r) throw notFound()
    rememberPack(r.pack)
    return { pack: r.pack, index: r.link.index }
  },
  head: ({ loaderData, matches }) => {
    if (!loaderData) return {}
    const { pack, index } = loaderData
    const e = pack.emojis[index]!
    const who = pack.artists.map((a) => a.name).join('、')
    const head = pageHead(matches, {
      title: `${pack.title} · 第 ${index + 1} 张`,
      description: `来自「${pack.title}」的第 ${index + 1} 张表情${who ? `，画师 ${who}` : ''}。`,
      path: `/e/${e.id}`,
      image: e.poster,
      type: 'article',
    })
    // the dialog's full WebP is the LCP element on this page: start it with the HTML
    head.links.push({ rel: 'preload', as: 'image', href: e.full, fetchPriority: 'high' } as never)
    return head
  },
  component: EmojiRoute,
})

function EmojiRoute() {
  const { pack, index } = Route.useLoaderData()
  const navigate = useNavigate()
  useEffect(() => rememberPack(pack), [pack])

  const go = useCallback(
    (i: number, replace: boolean) => {
      const id = pack.emojis[i]?.id
      if (id) void navigate({ to: '/e/$emojiId', params: { emojiId: id }, replace, resetScroll: false })
    },
    [navigate, pack.emojis],
  )
  const close = useCallback(() => void navigate({ to: '/packs/$slug', params: { slug: pack.slug }, resetScroll: false }), [navigate, pack.slug])

  return <PackPage pack={pack} open={index} onOpen={(i) => go(i, false)} onIndex={(i) => go(i, true)} onClose={close} deepLink />
}
