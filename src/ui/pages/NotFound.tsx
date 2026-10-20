import { Button, buttonClass } from '../Button'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { palette } from './palette'

// 404 inside the public layout: no dead end, three ways out (search, home, browse).

export function NotFound({ what = '页面' }: { what?: string }) {
  return (
    <div className="wrap">
      <div className="nf">
        <span className="code" aria-hidden="true">
          404
        </span>
        <h1>这里没有你要找的{what}</h1>
        <p className="muted">链接可能已经失效，或者表情包被作者下架了。可以搜一下，或者随便看看。</p>
        <div className="nf-acts">
          <Button variant="primary" icon="search" onClick={() => palette.open()}>
            搜索表情
          </Button>
          <AppLink to="/" className={buttonClass()}>
            <Icon name="home" />
            回到首页
          </AppLink>
          <AppLink to="/packs" className={buttonClass({ variant: 'ghost' })}>
            看看全部表情包
          </AppLink>
        </div>
      </div>
    </div>
  )
}
