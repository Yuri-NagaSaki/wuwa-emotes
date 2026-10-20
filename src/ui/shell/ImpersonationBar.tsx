import { useState } from 'react'
import { stopImpersonatingFn } from '#/server/account/fn'
import { errorText } from '../account/text'
import { Button } from '../Button'
import { Icon } from '../Icon'
import { toast } from '../Toast'
import barCss from './impersonation.css?url'

/**
 * 模拟登录 bar: fixed above every page (site and admin) while a 站长 browses as someone else.
 * 结束模拟 restores the 站长's own session, then reloads on 用户与权限 so every loader sees it.
 */
export function ImpersonationBar({ name }: { name: string }) {
  const [busy, setBusy] = useState(false)

  async function stop() {
    setBusy(true)
    try {
      await stopImpersonatingFn()
      window.location.assign('/admin/users')
    } catch (err) {
      toast({ message: errorText(err, '结束模拟失败，请稍后再试'), icon: 'warn' })
      setBusy(false)
    }
  }

  return (
    <div className="imp-bar" role="region" aria-label="模拟登录">
      <link rel="stylesheet" href={barCss} precedence="default" />
      <Icon name="user" className="ico" />
      <span className="txt">
        正在以 <b>{name}</b> 的身份浏览
      </span>
      <Button size="xs" onClick={stop} disabled={busy}>
        结束模拟
      </Button>
    </div>
  )
}
