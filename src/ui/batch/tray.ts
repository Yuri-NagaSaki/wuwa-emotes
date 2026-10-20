// Open state of the 打包清单 tray (the header 打包 button, the phone button, the command palette).
// The tray itself is loaded on first open (src/ui/pages/SiteShell.tsx).

type Listener = () => void

let state = { open: false, mounted: false }
const listeners = new Set<Listener>()
const emit = () => listeners.forEach((l) => l())

export const tray = {
  get: () => state,
  subscribe(l: Listener) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  open() {
    state = { open: true, mounted: true }
    emit()
  },
  close() {
    if (!state.open) return
    state = { ...state, open: false }
    emit()
  },
}

const CLOSED = { open: false, mounted: false }
export const trayServerSnapshot = () => CLOSED
