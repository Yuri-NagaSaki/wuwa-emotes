import { createRootRoute, HeadContent, Outlet, ScriptOnce, Scripts } from '@tanstack/react-router'
import { useEffect, type ReactNode } from 'react'
import { getPublicConfig } from '#/server/ui/public-config'
import { VIEWER_BOOT } from '#/shared/signed-in-hint'
import { BlobDefs } from '#/ui/BlobDefs'
import { setCapEndpoint } from '#/ui/cap/load'
import { NotFoundPage } from '#/ui/NotFoundPage'
import { ImpersonationBar } from '#/ui/shell/ImpersonationBar'
import { THEME_BOOT } from '#/ui/shell/theme'
import { useViewerRefresh } from '#/ui/shell/viewer-refresh'
import { SiteConfigProvider } from '#/ui/site-config'
import appCss from '#/ui/styles/app.css?url'
import { Toaster } from '#/ui/Toast'

// Display font (TP Rounded): preloaded, then applied by a script-inserted <link>, which is not
// render-blocking. Its @font-face list is large (two weights × 7.6k code points of unicode-range),
// so text paints with the fallback stack first; the shards themselves load per character.
const DISPLAY_CSS = '/fonts/tp-rounded/tp-rounded.css'
const NUNITO_LATIN = '/fonts/nunito/nunito-latin-wght-normal.woff2'
const FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M24 4c11.6 0 20 6.9 20 18.6C44 35.3 35.6 44 23.4 44 11.5 44 4 36.6 4 25.4 4 12.2 12.5 4 24 4z" fill="#19c8b9" stroke="#794f27" stroke-width="2.6"/><path d="M10 28c3-2.6 6-2.6 9 0s6 2.6 9 0 6-2.6 9 0" fill="none" stroke="#e9fbf7" stroke-width="2.6" stroke-linecap="round"/><path d="M27.5 10.5l2 4.6 5 .5-3.8 3.3 1.1 4.9-4.3-2.6-4.3 2.6 1.1-4.9-3.8-3.3 5-.5z" fill="#f7cd67" stroke="#794f27" stroke-width="2" stroke-linejoin="round"/></svg>',
  )

export const Route = createRootRoute({
  loader: () => getPublicConfig(),
  // The chrome config changes rarely; don't refetch it on every navigation or hover preload.
  staleTime: Infinity,
  preloadStaleTime: Infinity,
  head: ({ loaderData }) => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { title: loaderData?.site.name ?? '' },
      ...(loaderData?.site.subtitle ? [{ name: 'description', content: loaderData.site.subtitle }] : []),
    ],
    links: [
      // posters, previews and portraits come from the bucket's public domain when PUBLIC_IMG_BASE is set;
      // no crossorigin: <img> loads use the credentialed connection pool
      ...(loaderData?.imgOrigin ? [{ rel: 'preconnect', href: loaderData.imgOrigin }] : []),
      { rel: 'preload', href: DISPLAY_CSS, as: 'style' },
      { rel: 'preload', href: NUNITO_LATIN, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: FAVICON, type: 'image/svg+xml' },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
  notFoundComponent: () => <NotFoundPage />,
})

function RootComponent() {
  const config = Route.useLoaderData()
  useEffect(() => setCapEndpoint(config.cap.endpoint), [config.cap.endpoint])
  // the HTML may be the edge cache's anonymous copy: re-check a signed-in browser's viewer
  useViewerRefresh(config.viewer)
  return (
    <SiteConfigProvider value={config}>
      {config.viewer?.impersonated ? <ImpersonationBar name={config.viewer.name} /> : null}
      <Outlet />
      <Toaster />
    </SiteConfigProvider>
  )
}

const loadDisplayCss = `(function(){var l=document.createElement("link");l.rel="stylesheet";l.href=${JSON.stringify(DISPLAY_CSS)};document.head.appendChild(l)})()`

function RootDocument({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: inline scripts mark <html> before hydration (ann-off, data-theme,
    // data-viewer-pending)
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* data-theme and the theme-color meta (src/ui/shell/theme.ts), before first paint */}
        <ScriptOnce>{THEME_BOOT}</ScriptOnce>
        {/* signed-in hint present: no 登录 in the header until the viewer is re-checked (src/shared/signed-in-hint.ts) */}
        <ScriptOnce>{VIEWER_BOOT}</ScriptOnce>
        <ScriptOnce>{loadDisplayCss}</ScriptOnce>
        <noscript>
          <link rel="stylesheet" href={DISPLAY_CSS} />
        </noscript>
      </head>
      <body>
        <BlobDefs />
        {children}
        <Scripts />
      </body>
    </html>
  )
}
