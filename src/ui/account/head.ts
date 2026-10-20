import type { PublicConfig } from '#/server/ui/public-config'

/** Page title with the site name from the root loader: "登录 · 潮池". */
export function titled(matches: readonly { loaderData?: unknown }[], title: string): string {
  const root = matches[0]?.loaderData as PublicConfig | undefined
  return root?.site.name ? `${title} · ${root.site.name}` : title
}

/** head() for private pages: title, noindex and the page stylesheets. */
export function privateHead(matches: readonly { loaderData?: unknown }[], title: string, css: string[]) {
  return {
    meta: [{ title: titled(matches, title) }, { name: 'robots', content: 'noindex' }],
    links: css.map((href) => ({ rel: 'stylesheet', href })),
  }
}
