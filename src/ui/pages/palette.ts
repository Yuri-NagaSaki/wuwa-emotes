// Open the Ctrl K command palette from anywhere (header, the home hero search, 404). The palette module
// itself is loaded on first open (src/routes/_site.tsx).

type Listener = () => void

let state: { open: boolean; q: string } = { open: false, q: '' }
const listeners = new Set<Listener>()
const emit = () => listeners.forEach((l) => l())

export const palette = {
  get: () => state,
  subscribe(l: Listener) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  open(q = '') {
    state = { open: true, q }
    emit()
  },
  close() {
    if (!state.open) return
    state = { open: false, q: state.q }
    emit()
  },
}

const CLOSED = { open: false, q: '' }
export const paletteServerSnapshot = () => CLOSED
