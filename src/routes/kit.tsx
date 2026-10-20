import { createFileRoute, notFound } from '@tanstack/react-router'
import { KitPage } from '#/ui/kit/KitPage'
import adminCss from '#/ui/styles/admin.css?url'
import kitCss from '#/ui/styles/kit.css?url'
import siteCss from '#/ui/styles/site.css?url'

// Component showcase. Development only: production builds answer 404 and drop the page code.
export const Route = createFileRoute('/kit')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  head: () =>
    import.meta.env.DEV
      ? {
          meta: [{ title: '组件样张 · kit' }, { name: 'robots', content: 'noindex' }],
          links: [
            { rel: 'stylesheet', href: siteCss },
            { rel: 'stylesheet', href: adminCss },
            { rel: 'stylesheet', href: kitCss },
          ],
        }
      : {},
  component: import.meta.env.DEV ? KitPage : () => null,
})
