import { ScriptOnce } from '@tanstack/react-router'
import { useState } from 'react'
import { Icon } from '../Icon'
import { ANNOUNCEMENT_KEY, announcementGateScript, announcementId } from './announcement'

/**
 * Site announcement (系统设置 → 公告), dismissible. A dismissed text stays hidden on later visits: an
 * inline script marks <html class="ann-off"> before first paint, so the bar never flashes or shifts.
 */
export function AnnouncementBar({ text }: { text: string | null | undefined }) {
  const [closed, setClosed] = useState(false)
  if (!text || closed) return null
  const id = announcementId(text)
  function close() {
    try {
      localStorage.setItem(ANNOUNCEMENT_KEY, id)
    } catch {
      /* storage blocked: hidden until reload */
    }
    document.documentElement.classList.add('ann-off')
    setClosed(true)
  }
  return (
    <>
      <ScriptOnce>{announcementGateScript(id)}</ScriptOnce>
      <div className="announce" role="region" aria-label="公告">
        <div className="wrap">
          <Icon name="wave" className="wave-ico" />
          <span className="txt">{text}</span>
          <button type="button" className="x" onClick={close} aria-label="关闭公告">
            <Icon name="close" size="sm" />
          </button>
        </div>
      </div>
    </>
  )
}
