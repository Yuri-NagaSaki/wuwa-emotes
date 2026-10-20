import { NotFound } from './NotFound'
import { SiteShell } from './SiteShell'

// The legacy-address routes (/archives/*, /tags/*): when the server handler finds no redirect, the
// page router renders this 404 inside the normal site chrome (styles in ./legacy-head).

export function LegacyNotFound() {
  return (
    <SiteShell>
      <NotFound />
    </SiteShell>
  )
}
