// Display names of catalog enums. Tiny on purpose: route modules (loaders, validateSearch) import it,
// and those stay in the entry chunk.

export const KIND_LABEL: Record<string, string> = { animated: '动态', static: '静态', mixed: '动静混合' }
export const SOURCE_LABEL: Record<string, string> = { community: '社区投稿', official: '官方转载' }
