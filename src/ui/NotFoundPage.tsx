import { buttonClass } from './Button'
import { AppLink } from './link'

/** 404 body (works with or without the site chrome around it). */
export function NotFoundPage() {
  return (
    <div className="wrap">
      <div className="nf">
        <span className="code" aria-hidden="true">
          404
        </span>
        <h1>这里没有你要找的页面</h1>
        <p className="muted">链接可能已经失效，或者表情包被下架了。</p>
        <AppLink to="/" className={buttonClass({ variant: 'primary' })}>
          回到首页
        </AppLink>
      </div>
    </div>
  )
}
