import { useRouterState } from '@tanstack/react-router'
import { lazy, Suspense, useSyncExternalStore, type ReactNode } from 'react'
import { AnnouncementBar } from '../shell/AnnouncementBar'
import { Footer } from '../shell/Footer'
import { Header, TrayFab } from '../shell/Header'
import { Tabbar } from '../shell/Tabbar'
import { useSiteConfig } from '../site-config'
import { palette, paletteServerSnapshot } from './palette'
import { useBatchCount } from './useBatch'

// The public chrome (announcement, header, footer, phone tab bar, 打包 button, Ctrl K palette) around
// a page. Used by the _site layout and by routes outside it that still show a site page (the 404 of
// legacy addresses). The 打包 count comes from the client-side store (0 in the shared HTML).

const CommandPalette = lazy(() => import('./CommandPalette'))

export function SiteShell({ children }: { children: ReactNode }) {
  const { site, announcement, viewer } = useSiteConfig()
  const tray = useBatchCount()
  const pal = useSyncExternalStore(palette.subscribe, palette.get, paletteServerSnapshot)
  // a deep link renders the single-emoji dialog in the HTML: no entrance animation under it
  const deepLink = useRouterState({ select: (s) => s.matches.some((m) => m.routeId === '/_site/e/$emojiId') })
  return (
    <>
      <a className="skip-link" href="#main">
        跳到正文
      </a>
      <AnnouncementBar text={announcement} />
      <Header siteName={site.name} subtitle={site.subtitle} trayCount={tray} onSearch={() => palette.open()} user={viewer ? { name: viewer.name } : null} />
      <main id="main" className={deepLink ? 'page no-enter' : 'page'}>
        {children}
      </main>
      <Footer siteName={site.name} subtitle={site.subtitle} />
      <Tabbar />
      <TrayFab count={tray} />
      {pal.open ? (
        <Suspense fallback={null}>
          <CommandPalette initialQuery={pal.q} onClose={() => palette.close()} />
        </Suspense>
      ) : null}
    </>
  )
}
