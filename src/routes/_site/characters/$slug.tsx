import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { characterDetailFn } from '#/server/catalog/fns'
import { CharacterPage, type CharacterTab, type EmojiTypeFilter } from '#/ui/pages/CharacterPage'
import { emojiParam } from '#/ui/pages/search-params'
import { characterCountText } from '#/shared/characters'
import { pageHead } from '#/ui/pages/seo'

// 角色详情. Old slugs (legacy_slug, the redirects table) answer 301; unknown ones are 404. A character
// that only appears in group packs opens on its 合集包 (the server picks that tab when it has no 包).

interface CharacterSearch {
  tab?: Exclude<CharacterTab, 'packs'>
  type?: Exclude<EmojiTypeFilter, undefined>
  e?: string
}

export const Route = createFileRoute('/_site/characters/$slug')({
  validateSearch: (s: Record<string, unknown>): CharacterSearch => ({
    ...(s.tab === 'emojis' || s.tab === 'artists' || s.tab === 'groups' ? { tab: s.tab } : {}),
    ...(s.tab === 'emojis' && (s.type === 'animated' || s.type === 'static') ? { type: s.type } : {}),
    ...emojiParam(s),
  }),
  loaderDeps: ({ search }) => ({ tab: search.tab, type: search.type }),
  loader: async ({ params, deps }) => {
    const emojis = deps.tab === 'emojis'
    const tab = emojis ? 'emojis' : deps.tab === 'groups' ? 'groups' : 'packs'
    const r = await characterDetailFn({ data: { slug: params.slug, tab, type: deps.type, limit: emojis ? 60 : 24 } })
    if (r.kind === 'redirect') throw redirect({ href: r.redirectTo, statusCode: 301, headers: { 'cache-control': 'public, max-age=86400' } })
    if (r.kind === 'missing') throw notFound()
    return r
  },
  head: ({ matches, loaderData: d }) => {
    if (!d) return {}
    const c = d.character
    return pageHead(matches, {
      title: `${c.name}的表情包`,
      description: `${c.name}：${characterCountText(c)}${c.aliases.length ? `（别名 ${c.aliases.join('、')}）` : ''}。`,
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
