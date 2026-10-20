import type { ReactNode } from 'react'

// A plain switch button in the kit's .switch look. Pages use it instead of the Base UI Switch where
// nothing else from Base UI is loaded (it saves ~9 KB of script on the pack page).

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}>
      <span className="track" aria-hidden="true" />
      {children}
    </button>
  )
}
