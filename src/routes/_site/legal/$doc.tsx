import { createFileRoute, notFound } from '@tanstack/react-router'
import { LegalPage } from '#/ui/pages/DocPages'
import { LEGAL_DOCS, type LegalDoc } from '#/ui/pages/legal-docs'
import { pageHead } from '#/ui/pages/seo'
import { useSiteConfig } from '#/ui/site-config'

// /legal/privacy, /legal/terms, /legal/takedown (linked from the footer).

export const Route = createFileRoute('/_site/legal/$doc')({
  beforeLoad: ({ params }) => {
    if (!LEGAL_DOCS.some((d) => d.id === params.doc)) throw notFound()
  },
  head: ({ matches, params }) => {
    const d = LEGAL_DOCS.find((x) => x.id === params.doc)
    return d ? pageHead(matches, { title: d.title, description: d.description, path: `/legal/${d.id}` }) : {}
  },
  component: LegalRoute,
})

function LegalRoute() {
  const { doc } = Route.useParams()
  const { site } = useSiteConfig()
  return <LegalPage doc={doc as LegalDoc} siteName={site.name} />
}
