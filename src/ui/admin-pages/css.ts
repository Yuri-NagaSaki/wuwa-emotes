import pagesCss from './admin-pages.css?url'

/** `head` of every admin page route: the page widget styles (the layout already links admin.css). */
export function pageCss() {
  return { links: [{ rel: 'stylesheet', href: pagesCss }] }
}
