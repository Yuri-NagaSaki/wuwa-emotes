import { isRole, type Role, type SubmitMode } from '#/shared/roles'
import { auth } from './auth'

export interface Viewer {
  id: string
  name: string
  email: string
  role: Role
  submitMode: SubmitMode
  banned: boolean
  impersonatedBy: string | null
}

/** Resolve the signed-in user from request headers, or null. Banned users count as signed out. */
export async function getViewer(headers: Headers): Promise<Viewer | null> {
  const session = await auth().api.getSession({ headers })
  if (!session) return null
  const u = session.user as typeof session.user & { role?: string; banned?: boolean | null; submitMode?: string }
  if (u.banned) return null
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: isRole(u.role) ? u.role : 'user',
    submitMode: u.submitMode === 'trusted' || u.submitMode === 'blocked' ? u.submitMode : 'review',
    banned: Boolean(u.banned),
    impersonatedBy: (session.session as { impersonatedBy?: string | null }).impersonatedBy ?? null,
  }
}
