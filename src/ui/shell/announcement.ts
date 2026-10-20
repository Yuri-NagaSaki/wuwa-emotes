/** localStorage key holding the id of the last dismissed announcement. */
export const ANNOUNCEMENT_KEY = 'tp-ann'

/** Stable short id for an announcement text (djb2), so a new text shows again after a dismissal. */
export function announcementId(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Inline script run before first paint: hide a dismissed announcement without a flash or shift. */
export function announcementGateScript(id: string): string {
  return `try{if(localStorage.getItem(${JSON.stringify(ANNOUNCEMENT_KEY)})===${JSON.stringify(id)})document.documentElement.classList.add("ann-off")}catch(e){}`
}
