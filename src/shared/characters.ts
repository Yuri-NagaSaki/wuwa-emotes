// How a character's numbers read, everywhere (角色图鉴, search, the command palette, the character
// page). Shared by server and client.
//
// Stickers of its own (catalog/attribution.ts): 「1,640 张 · 40 包」. Only appearing in group packs that
// do not say who is on which sticker: 「出现在 3 个合集包」, never 「0 张」 and never the group pack's
// own sticker count. Neither: 「暂无表情」.

export interface CharacterCounts {
  /** 张: public stickers attributed to the character */
  emojiCount: number
  /** 包: public packs holding at least one of them */
  packCount: number
  /** 合集: public packs the character appears on without stickers of its own */
  groupCount: number
}

const n = (x: number) => x.toLocaleString('en-US')

export function characterCountText(c: CharacterCounts): string {
  if (c.emojiCount > 0) return `${n(c.emojiCount)} 张 · ${n(c.packCount)} 包`
  if (c.groupCount > 0) return `出现在 ${n(c.groupCount)} 个合集包`
  return '暂无表情'
}
