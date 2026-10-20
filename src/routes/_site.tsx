import { createFileRoute, Outlet } from '@tanstack/react-router'
import { NotFoundPage } from '#/ui/NotFoundPage'
import { AnnouncementBar } from '#/ui/shell/AnnouncementBar'
import { Footer } from '#/ui/shell/Footer'
import { Header, TrayFab } from '#/ui/shell/Header'
import { Tabbar } from '#/ui/shell/Tabbar'
import { useSiteConfig } from '#/ui/site-config'
import siteCss from '#/ui/styles/site.css?url'

// Public layout (pathless): announcement, header, page, footer, and the phone tab bar.
// The 打包 tray count and the search palette are wired by the pages lane (Header props).
export const Route = createFileRoute('/_site')({
  head: () => ({ links: [{ rel: 'stylesheet', href: siteCss }] }),
  component: SiteLayout,
  notFoundComponent: () => <NotFoundPage />,
})

function SiteLayout() {
  const { site, announcement, viewer } = useSiteConfig()
  return (
    <>
      <a className="skip-link" href="#main">
        跳到正文
      </a>
      <AnnouncementBar text={announcement} />
      <Header siteName={site.name} subtitle={site.subtitle} trayCount={0} user={viewer ? { name: viewer.name } : null} />
      <main id="main" className="page">
        <Outlet />
      </main>
      <Footer siteName={site.name} subtitle={site.subtitle} />
      <Tabbar />
      <TrayFab count={0} />
    </>
  )
}
