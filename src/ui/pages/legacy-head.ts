import siteCss from '../styles/site.css?url'
import pagesCss from './pages.css?url'

// <head> of the legacy-address 404 (/archives/*, /tags/*): the site styles and noindex.
export const legacyHead = () => ({
  meta: [{ title: '页面不存在' }, { name: 'robots', content: 'noindex' }],
  links: [
    { rel: 'stylesheet', href: siteCss },
    { rel: 'stylesheet', href: pagesCss },
  ],
})
