import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { characterDetailFn } from '#/server/catalog/fns'
import { CharacterPage, type CharacterTab, type EmojiTypeFilter } from '#/ui/pages/CharacterPage'
import { emojiParam } from '#/ui/pages/search-params'
import { pageHead } from '#/ui/pages/seo'

// 角色详情. Old slugs (legacy_slug, the redirects table) answer 301; a character that only appears in
// group packs (no stickers of its own, so not listed) answers 302 to a search for its name; unknown
// ones are 404.

interface CharacterSearch {
  tab?: Exclude<CharacterTab, 'packs'>
  type?: Exclude<EmojiTypeFilter, undefined>
  e?: string
}

export const Route = createFileRoute('/_site/characters/$slug')({
  validateSearch: (s: Record<string, unknown>): CharacterSearch => ({
    ...(s.tab === 'emojis' || s.tab === 'artists' ? { tab: s.tab } : {}),
    ...(s.tab === 'emojis' && (s.type === 'animated' || s.type === 'static') ? { type: s.type } : {}),
    ...emojiParam(s),
  }),
  loaderDeps: ({ search }) => ({ tab: search.tab, type: search.type }),
  loader: async ({ params, deps }) => {
    const emojis = deps.tab === 'emojis'
    const r = await characterDetailFn({ data: { slug: params.slug, tab: emojis ? 'emojis' : 'packs', type: deps.type, limit: emojis ? 60 : 24 } })
    if (r.kind === 'redirect') {
      // old slugs move for good; a character without stickers of its own goes to a search for now
      if (r.temporary) throw redirect({ href: r.redirectTo, statusCode: 302, headers: { 'cache-control': 'public, max-age=300' } })
      throw redirect({ href: r.redirectTo, statusCode: 301, headers: { 'cache-control': 'public, max-age=86400' } })
    }
    if (r.kind === 'missing') throw notFound()
    return r
  },
  head: ({ matches, loaderData: d }) => {
    if (!d) return {}
    const c = d.character
    return pageHead(matches, {
      title: `${c.name}的表情包`,
      description: `${c.name}的 ${c.emojiCount} 张表情、${c.packCount} 个表情包${c.aliases.length ? `（别名 ${c.aliases.join('、')}）` : ''}。`,
      path: `/characters/${encodeURIComponent(c.slug)}`,
      image: c.portrait?.src ?? c.avatar?.poster,
    })
  },
  component: CharacterRoute,
})

function CharacterRoute() {
  const detail = Route.useLoaderData()
  const { tab, type, e } = Route.useSearch()
  return <CharacterPage detail={detail} tab={tab ?? 'packs'} type={type} current={e} />
}
