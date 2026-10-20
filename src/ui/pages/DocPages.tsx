import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { CatalogStats } from '#/server/catalog/types'
import { buttonClass } from '../Button'
import { EmptyState } from '../EmptyState'
import { fmtN, fmtW } from '../format'
import { Icon } from '../Icon'
import { AppLink } from '../link'
import { LEGAL_DOCS, type LegalDoc } from './legal-docs'

// 关于, 友链 and the legal pages. Plain server-rendered text. Wording sticks to what the site actually
// does (docs/ARCHITECTURE.md); anything the operator still has to decide is marked 〔待站长填写〕.

interface Section {
  id: string
  title: string
  body: ReactNode
}

/** The section whose heading was passed last while scrolling (the first one at the top). */
function useActiveSection(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState(ids[0])
  const key = ids.join(' ')
  useEffect(() => {
    let frame = 0
    const read = () => {
      frame = 0
      const line = innerHeight * 0.3
      let current = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) current = id
      }
      setActive(current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read)
    }
    read()
    addEventListener('scroll', schedule, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      removeEventListener('scroll', schedule)
    }
  }, [key]) // ids only change with key
  return active
}

function Doc({ sections }: { sections: Section[] }) {
  const active = useActiveSection(sections.map((s) => s.id))
  return (
    <div className="doc">
      <nav className="toc" aria-label="目录">
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className={s.id === active ? 'is-on' : undefined}>
            {s.title}
          </a>
        ))}
      </nav>
      <div className="prose">
        {sections.map((s) => (
          <section key={s.id} aria-labelledby={s.id} style={{ display: 'grid', gap: 12 }}>
            <h2 id={s.id}>{s.title}</h2>
            {s.body}
          </section>
        ))}
      </div>
    </div>
  )
}

export function AboutPage({ siteName, stats }: { siteName: string; stats: CatalogStats | null }) {
  const sections: Section[] = [
    {
      id: 'what',
      title: '本站是什么',
      body: (
        <p>
          {siteName}是一个整理《鸣潮》表情包的粉丝站：按角色、画师和分组浏览，单张复制或保存，跨包加入打包清单，整包下载。浏览和下载都不需要账号；登录后可以收藏、投稿。本站不做商用，与库洛游戏无关。
        </p>
      ),
    },
    {
      id: 'source',
      title: '内容从哪里来',
      body: (
        <ul>
          <li>社区画师与约稿人的作品，由投稿者提交，管理员审核后发布。</li>
          <li>官方公开发布的表情，标注「官转」，只提供预览，不提供原图下载。</li>
          <li>每个表情包页面都写明画师、约稿人与许可。</li>
        </ul>
      ),
    },
    {
      id: 'license',
      title: '署名与授权',
      body: (
        <>
          <p>
            社区作品多数采用 CC BY-NC-SA 4.0（署名、非商业、相同方式共享），具体以每个包标注的许可为准。整包与打包下载的压缩包里附带 CREDITS.txt，写有包名、画师、约稿人与许可。
          </p>
          <p>是否开放原图下载由每个包单独决定。作者未同意公开下载的包只提供预览。</p>
        </>
      ),
    },
    {
      id: 'download',
      title: '下载',
      body: (
        <ul>
          <li>网页里显示的是 WebP 预览；原图（GIF、PNG）只在「查看原图」「保存原图」和打包时下载。</li>
          <li>站长可以设置下载频率与每日数量的上限；触发时页面会说明原因和恢复时间。</li>
          <li>微信、QQ 内置浏览器无法保存压缩包，请在系统浏览器中打开。</li>
        </ul>
      ),
    },
    {
      id: 'takedown',
      title: '下架与申诉',
      body: (
        <p>
          作者或权利人希望下架作品、修改署名或调整许可，请看<AppLink to="/legal/takedown">版权与下架申诉</AppLink>。
        </p>
      ),
    },
    {
      id: 'numbers',
      title: '数字',
      body: stats ? (
        <div className="stats">
          <div className="stat">
            <b>{fmtN(stats.emojis)}</b>
            <span>张表情</span>
          </div>
          <div className="stat">
            <b>{fmtN(stats.packs)}</b>
            <span>个表情包</span>
          </div>
          <div className="stat">
            <b>{fmtN(stats.characters)}</b>
            <span>位角色</span>
          </div>
          <div className="stat">
            <b>{fmtW(stats.downloads)}</b>
            <span>次下载</span>
          </div>
        </div>
      ) : (
        <p className="muted">暂时无法读取统计。</p>
      ),
    },
  ]
  return (
    <div className="wrap narrow">
      <div className="page-h">
        <h1>关于{siteName}</h1>
        <span className="sub">一个由潮友维护的鸣潮表情仓库</span>
      </div>
      <Doc sections={sections} />
    </div>
  )
}

/** Friend links. There is no links table yet: entries live in this list (src/ui/pages/DocPages.tsx). */
export interface FriendLink {
  name: string
  url: string
  note: string
}
export const FRIEND_LINKS: { group: string; links: FriendLink[] }[] = []

const PALETTE = ['mint', 'pink', 'blue', 'yellow', 'purple', 'orange', 'green', 'peach']

export function LinksPage() {
  return (
    <div className="wrap narrow">
      <div className="page-h">
        <h1>友情链接</h1>
        <span className="sub">海内存知己。外站链接一律不带本站的统计参数，也不加载对方的图标。</span>
      </div>
      {FRIEND_LINKS.length ? (
        FRIEND_LINKS.map((g, k) => (
          <section key={g.group} className="sec" style={{ marginTop: 28 }}>
            <h2 className="h-plain" style={{ fontSize: 20, marginBottom: 12 }}>
              {g.group} <span className="muted num" style={{ fontSize: 14 }}>{g.links.length}</span>
            </h2>
            <div className="links-grid">
              {g.links.map((l, i) => (
                <a key={l.url} className="lcard" href={l.url} target="_blank" rel="noopener nofollow noreferrer" style={{ '--acc': `var(--c-${PALETTE[(k * 3 + i) % PALETTE.length]})` } as CSSProperties}>
                  <span className="ico" aria-hidden="true">
                    {Array.from(l.name)[0]}
                  </span>
                  <div>
                    <b>{l.name}</b>
                    <small>{l.note}</small>
                  </div>
                  <Icon name="external" size="sm" />
                </a>
              ))}
            </div>
          </section>
        ))
      ) : (
        <EmptyState
          icon="link"
          title="友链还在整理中"
          actions={
            <AppLink to="/about" className={buttonClass({ size: 'sm' })}>
              关于本站
            </AppLink>
          }
        >
          站长整理好之后会出现在这里。申请友链的方式：〔待站长填写〕
        </EmptyState>
      )}
    </div>
  )
}


function legalSections(doc: LegalDoc, siteName: string): Section[] {
  if (doc === 'privacy') {
    return [
      {
        id: 'collect',
        title: '我们收集什么',
        body: (
          <ul>
            <li>注册账号时：用户名、邮箱和密码。密码只保存哈希值；邮箱用于验证与找回密码，不会公开。</li>
            <li>投稿、评论与收藏：你提交的内容，以及提交时间。</li>
            <li>IP 地址只以加盐哈希的形式保存，用于下载限额、频率限制与反垃圾，不保存原始 IP。</li>
            <li>下载计数：按日记录每个 IP 哈希或账号下载了多少张原图与压缩包，用于限额与统计。</li>
          </ul>
        ),
      },
      {
        id: 'use',
        title: '怎么使用',
        body: (
          <ul>
            <li>只用于提供本站功能：登录、投稿与审核、收藏、下载风控与站点统计。</li>
            <li>不出售、不出租个人信息，不接入第三方广告或行为追踪。</li>
            <li>人机验证使用自托管的 Cap（工作量证明），不把你的访问交给第三方验证服务。</li>
          </ul>
        ),
      },
      {
        id: 'cookie',
        title: 'Cookie 与本地存储',
        body: (
          <ul>
            <li>Cookie 只用于登录会话，不使用广告或追踪 Cookie。</li>
            <li>打包清单与「自动播放」开关存在你的浏览器本地存储里，清除浏览器数据即可删除。</li>
          </ul>
        ),
      },
      {
        id: 'infra',
        title: '服务商',
        body: <p>网站经 Cloudflare 提供访问与缓存，图片与压缩包存放在 Cloudflare R2。这些服务会按其自身政策处理访问请求。</p>,
      },
      {
        id: 'rights',
        title: '你的权利',
        body: <p>可以在「个人中心」管理账号资料与收藏。需要删除账号及相关数据，请通过〔待站长填写〕联系站长。</p>,
      },
    ]
  }
  if (doc === 'terms') {
    return [
      {
        id: 'site',
        title: '关于本站',
        body: <p>{siteName}是非官方的粉丝站，与库洛游戏无关，不做商用。表情的版权归原作者与官方所有。</p>,
      },
      {
        id: 'use',
        title: '使用表情',
        body: (
          <ul>
            <li>遵守每个表情包标注的许可。CC BY-NC-SA 4.0 的作品：转载请署名，不得商用，改编后以相同许可分享。</li>
            <li>标注「只提供预览」的包不提供原图，请勿以其他方式批量抓取。</li>
            <li>本站可以设置下载频率与每日数量上限，异常抓取会被要求通过人机验证或暂停下载。</li>
          </ul>
        ),
      },
      {
        id: 'submit',
        title: '投稿',
        body: (
          <ul>
            <li>只投稿你有权分享的内容：本人作品、你约稿并取得画师同意的作品，或已获授权的作品，并如实填写署名与许可。</li>
            <li>投稿经管理员审核后公开；审核人可以退回、修改分类或关闭「允许下载」。</li>
            <li>收到有效的版权申诉时，相关内容会被下架。</li>
          </ul>
        ),
      },
      {
        id: 'account',
        title: '账号与行为',
        body: <p>请勿发布违法、侵权、骚扰或广告内容。违反约定的账号可能被限制投稿、评论或封禁。</p>,
      },
      {
        id: 'warranty',
        title: '免责',
        body: <p>本站按现状提供，不保证服务不中断，也不对第三方转载的使用方式负责。</p>,
      },
    ]
  }
  return [
    {
      id: 'who',
      title: '谁可以申诉',
      body: <p>作品的作者、约稿人或其他权利人，以及他们的代理人，可以申请下架作品、修改署名或调整许可（例如关闭原图下载）。</p>,
    },
    {
      id: 'what',
      title: '申诉需要哪些信息',
      body: (
        <ul>
          <li>涉及的表情包或表情链接（例如 /packs/… 或 /e/…）。</li>
          <li>你与作品的关系，以及能说明身份的材料（作品首发链接、创作过程截图等）。</li>
          <li>希望的处理方式：下架、修改署名，或改为只提供预览。</li>
          <li>联系方式，用于确认与回复。</li>
        </ul>
      ),
    },
    {
      id: 'how',
      title: '提交方式',
      body: <p>请发送至：〔待站长填写〕。处理时限：〔待站长确认〕。</p>,
    },
    {
      id: 'process',
      title: '处理方式',
      body: (
        <ul>
          <li>确认后，相关表情从站内撤下，存储中的原图与所有预览图会被删除，相关压缩包重建或删除，并清除 CDN 上的图片缓存。</li>
          <li>已经被访客下载到本地的副本，本站无法收回。</li>
          <li>只修改署名或许可时，页面与之后生成的压缩包会使用新的信息。</li>
        </ul>
      ),
    },
  ]
}

export function LegalPage({ doc, siteName }: { doc: LegalDoc; siteName: string }) {
  const meta = LEGAL_DOCS.find((d) => d.id === doc)!
  return (
    <div className="wrap narrow">
      <div className="page-h">
        <nav className="crumbs" aria-label="位置">
          <AppLink to="/">首页</AppLink>
          <Icon name="right" />
          <span aria-current="page">{meta.title}</span>
        </nav>
        <h1>{meta.title}</h1>
        <span className="sub">{meta.description}</span>
        <div className="chips" style={{ marginTop: 4 }}>
          {LEGAL_DOCS.map((d) => (
            <AppLink key={d.id} to={`/legal/${d.id}`} className={d.id === doc ? 'chip sm is-on' : 'chip sm'}>
              {d.title}
            </AppLink>
          ))}
        </div>
      </div>
      <Doc sections={legalSections(doc, siteName)} />
    </div>
  )
}
