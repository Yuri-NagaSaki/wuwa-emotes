import { HttpError } from '../perm/fn'

// Input checks for the 头像 upload (setAvatarFn), before anything decodes the file: one `file` field,
// at most 2 MB, and bytes that start like PNG, JPEG, GIF or WebP (the declared type is not trusted).
// TanStack Start has already read the multipart body when these run; the 2 MB rule bounds what reaches
// sharp, not what the server buffers (that needs a limit in front of the app).

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

export type AvatarFormat = 'png' | 'jpeg' | 'gif' | 'webp'

const ascii = (b: Uint8Array, at: number, text: string) => [...text].every((ch, i) => b[at + i] === ch.charCodeAt(0))

/** Image format from the first bytes, or null. */
export function sniffImage(b: Uint8Array): AvatarFormat | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 6 && (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'))) return 'gif'
  if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'webp'
  return null
}

/**
 * The `file` of the upload form (FormData with that one field), at most 2 MB; throws 400 / 413.
 * The format check needs the bytes and runs in setAvatar.
 */
export function avatarFormFile(data: unknown): Blob {
  if (!(data instanceof FormData)) throw new HttpError(400, '请选择一张图片')
  const keys = new Set(data.keys())
  const file = data.get('file')
  if (keys.size !== 1 || data.getAll('file').length !== 1 || !(file instanceof Blob) || file.size === 0) throw new HttpError(400, '请选择一张图片')
  if (file.size > AVATAR_MAX_BYTES) throw new HttpError(413, '图片不能超过 2 MB')
  return file
}
