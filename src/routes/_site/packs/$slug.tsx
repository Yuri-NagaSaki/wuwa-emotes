import { createFileRoute, notFound, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect } from 'react'
import { packDetailFn } from '#/server/catalog/fns'
import { cachedPack, rememberPack } from '#/ui/pages/pack-cache'
import { PackPage } from '#/ui/pages/PackPage'
import { emojiParam } from '#/ui/pages/search-params'
import { pageHead } from '#/ui/pages/seo'

// 包详情. The single-emoji dialog lives in the search (?e=<id>) and is masked as /e/<id> in the
// address bar, so opening it pushes one history entry (Back closes it), ←/→ replace that entry, and
// the page component stays mounted throughout. A reload of a masked entry loads /e/<id> itself.

export const Route = createFileRoute('/_site/packs/$slug')({
  validateSearch: emojiParam,
  loader: async ({ params }) => {
    const hit = cachedPack(params.slug)
    if (hit) return hit
    const r = await packDetailFn({ data: { slug: params.slug } })
    if (r.kind === 'redirect') throw redirect({ href: r.redirectTo, statusCode: 301 })
    if (r.kind === 'missing') throw notFound()
    rememberPack(r.pack)
    return r.pack
  },
  // opening the dialog only changes the search; don't refetch the pack for it
  staleTime: 60_000,
  head: ({ loaderData: pack, matches }) => {
    if (!pack) return {}
    const who = pack.artists.map((a) => a.name).join('、')
    const chars = pack.characters.map((c) => c.name).join('、')
    const description = pack.excerpt || `${chars ? chars + '的' : ''}${pack.count} 张表情${who ? `，画师 ${who}` : ''}。`
    const head = pageHead(matches, { title: pack.title, description, path: `/packs/${encodeURIComponent(pack.slug)}`, image: pack.cover?.poster, type: 'article' })
    // the cover is the LCP element: start it with the HTML
    if (pack.cover) head.links.push({ rel: 'preload', as: 'image', href: pack.cover.poster, fetchPriority: 'high' } as never)
    return head
  },
  component: PackRoute,
})

function PackRoute() {
  const pack = Route.useLoaderData()
  const { e } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const router = useRouter()
  const found = e ? pack.emojis.findIndex((x) => x.id === e) : -1
  const open = found >= 0 ? found : null

  useEffect(() => rememberPack(pack), [pack])

  const show = useCallback(
    (index: number, replace: boolean) => {
      const id = pack.emojis[index]?.id
      if (!id) return
      void navigate({
        search: { e: id },
        mask: { to: '/e/$emojiId', params: { emojiId: id }, search: {}, unmaskOnReload: true },
        replace,
        resetScroll: false,
        state: (prev) => ({ tpDialog: replace ? prev.tpDialog : true }),
      })
    },
    [navigate, pack.emojis],
  )
  const close = useCallback(() => {
    if (router.state.location.state.tpDialog) router.history.back()
    else void navigate({ search: {}, resetScroll: false })
  }, [navigate, router])

  return <PackPage pack={pack} open={open} onOpen={(i) => show(i, false)} onIndex={(i) => show(i, true)} onClose={close} />
}
