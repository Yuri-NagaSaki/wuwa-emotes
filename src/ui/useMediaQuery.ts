import { useSyncExternalStore } from 'react'

/** matchMedia as state. `serverValue` is used on the server and during hydration. */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => matchMedia(query).matches,
    () => serverValue,
  )
}

export const PHONE_QUERY = '(max-width: 760px)'
