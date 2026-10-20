import { toast } from '../Toast'

// Clipboard actions shared by tiles and the single-emoji dialog. The clipboard only takes PNG, so a
// sticker is drawn onto a canvas first; animated stickers would lose their motion, so they get a hint
// to use 保存原图 instead (docs/ARCHITECTURE.md §8).

export interface CopyableEmoji {
  full: string
  poster: string
  frames: number
}

export async function copyImage(e: CopyableEmoji) {
  if (e.frames > 1) {
    toast({ message: '动图复制后只剩静态的一帧', detail: '想要会动的，请用「保存原图」', icon: 'info', duration: 3500 })
    return
  }
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw new Error('no clipboard')
    const png = (async () => {
      const img = new Image()
      img.src = e.full
      await img.decode().catch(async () => {
        img.src = e.poster
        await img.decode()
      })
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'))
    })()
    // a promise inside ClipboardItem keeps Safari's user-gesture requirement satisfied
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
    toast({ message: '图片已复制', detail: '可以直接粘贴到聊天里', icon: 'copy' })
  } catch {
    toast({ message: '这个浏览器不支持复制图片', detail: '可以长按或右键另存，或用「保存原图」', icon: 'warn', duration: 3500 })
  }
}

/** Copy an absolute link to a site path (e.g. /e/<id>, /packs/<slug>). */
export async function copyLink(path: string) {
  const url = `${window.location.origin}${path}`
  try {
    await navigator.clipboard.writeText(url)
    toast({ message: '链接已复制', detail: url, icon: 'link' })
  } catch {
    toast({ message: '复制失败，请手动复制地址栏', icon: 'warn' })
  }
}
