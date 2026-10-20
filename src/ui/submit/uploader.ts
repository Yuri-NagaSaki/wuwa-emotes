import { UPLOAD_LIMITS } from '#/server/submissions/rules'

// Direct-to-storage uploads for 投稿: the browser PUTs each file to its presigned URL (the bytes never
// pass through the site), with progress, a few at a time. Browser only.

export const PARALLEL_PUTS = 4

export class PutError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

/** PUT one file; resolves on 2xx. The Content-Type must be the one that was signed. */
export function putFile(url: string, file: Blob, contentType: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('content-type', contentType)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new PutError(`上传失败（${xhr.status}）`, xhr.status)))
    xhr.onerror = () => reject(new PutError('网络中断，上传失败', 0))
    xhr.onabort = () => reject(new PutError('已取消', 0))
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}

/** Run `task` over `items`, at most `limit` at a time. */
export async function runLimited<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items]
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let it = queue.shift(); it !== undefined; it = queue.shift()) await task(it)
    }),
  )
}

/** Why a picked file cannot be uploaded, or null. Mirrors the server checks. */
export function rejectReason(file: { type: string; size: number }): string | null {
  if (!UPLOAD_LIMITS.mimes.includes(file.type)) return '格式不支持'
  if (file.size <= 0) return '空文件'
  if (file.size > UPLOAD_LIMITS.maxBytes) return '超过 20 MB'
  return null
}

export function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}
