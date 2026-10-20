import { useSyncExternalStore } from 'react'

// Components that render less on a client-side mount than the server did (the long pack grid, a long
// masonry) must still render everything while hydrating, so the markup matches the HTML. Route
// components hydrate in their own (lazy) boundaries, possibly after the root has committed, so a
// module flag set by the root is not enough: React's hydration render reads the server snapshot.

const noSubscribe = () => () => {}

/**
 * True while this component renders as part of hydrating server HTML (and on the server), false for a
 * component mounted by client navigation. Read it once at mount (useState initializer): after
 * hydration React renders the component again with `false`.
 */
export function useHydrating(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => false,
    () => true,
  )
}
