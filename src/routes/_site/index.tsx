import { createFileRoute } from '@tanstack/react-router'
import { useSiteConfig } from '#/ui/site-config'

// Placeholder home inside the public layout; the pages lane builds the real one.
export const Route = createFileRoute('/_site/')({ component: Home })

function Home() {
  const { site } = useSiteConfig()
  return (
    <div className="wrap">
      <div className="page-h">
        <h1>{site.name}</h1>
        <span className="sub">{site.subtitle}</span>
      </div>
    </div>
  )
}
