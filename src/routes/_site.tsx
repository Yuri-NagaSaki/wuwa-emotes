import { createFileRoute, Outlet } from '@tanstack/react-router'
import { NotFound } from '#/ui/pages/NotFound'
import pagesCss from '#/ui/pages/pages.css?url'
import { SiteShell } from '#/ui/pages/SiteShell'
import siteCss from '#/ui/styles/site.css?url'

// Public layout (pathless): the site chrome (src/ui/pages/SiteShell.tsx) around every public page.
// The tray drawer itself (Header onTrayClick) is the 打包清单 lane's.
export const Route = createFileRoute('/_site')({
  head: () => ({
    links: [
      { rel: 'stylesheet', href: siteCss },
      { rel: 'stylesheet', href: pagesCss },
    ],
  }),
  component: () => (
    <SiteShell>
      <Outlet />
    </SiteShell>
  ),
  notFoundComponent: () => <NotFound />,
})
