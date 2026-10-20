import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ROLES, type Role } from '#/shared/roles'
import { AdminShell } from '../admin/AdminShell'
import { navForRole } from '../admin/nav'
import { Button, IconButton } from '../Button'
import { CapWidget } from '../cap/CapWidget'
import { Chip, Chips, Flag, Tag } from '../Chip'
import { EmptyState } from '../EmptyState'
import { Check, Field, Input, Textarea } from '../Field'
import { FilterPopover } from '../FilterPopover'
import { fmtB } from '../format'
import { Icon } from '../Icon'
import { ICON_NAMES } from '../icons'
import { itemHeight } from '../masonry-layout'
import { Masonry } from '../Masonry'
import { Menu } from '../Menu'
import { Modal, ModalClose } from '../Modal'
import { setAutoplayPref, useAutoplayPref } from '../motion'
import { COVER_VARIANTS, PackCard } from '../PackCard'
import { Ribbon, SectionHead, WaveLoader } from '../Section'
import { Seg } from '../Seg'
import { Sheet } from '../Sheet'
import { AnnouncementBar } from '../shell/AnnouncementBar'
import { Footer } from '../shell/Footer'
import { Header, TrayFab } from '../shell/Header'
import { Tabbar } from '../shell/Tabbar'
import { useSiteConfig } from '../site-config'
import { Switch } from '../Switch'
import { TabPanel, Tabs } from '../Tabs'
import { Tile, TileGrid } from '../Tile'
import { toast } from '../Toast'
import { PALETTE, sampleItems, sticker } from './samples'

const SURFACES: [string, string, string][] = [
  ['页面底 bg', 'var(--tp-bg)', '#f8f8f0'],
  ['内容区 sand', 'var(--tp-sand)', '#f7f3df'],
  ['卡片 card', 'var(--tp-card)', '#fffdf4'],
  ['输入 input', 'var(--tp-input)', '#fffbe7'],
  ['标题墨 ink', 'var(--tp-ink)', '#794f27'],
  ['正文 body', 'var(--tp-body)', '#725d42'],
  ['次要 muted', 'var(--tp-muted)', '#7b6c56'],
  ['线 line', 'var(--tp-line-2)', '#d9cdb2'],
]
const TIDE: [string, string, string][] = [
  ['潮汐青 teal', 'var(--tp-teal)', '#19c8b9'],
  ['青上文字 on-teal', 'var(--tp-on-teal)', '#06403a'],
  ['深潮 deep', 'var(--tp-deep)', '#134a55'],
  ['泡沫 foam', 'var(--tp-foam)', '#eafaf6'],
  ['日光 sun', 'var(--tp-sun)', '#f7cd67'],
  ['珊瑚 coral', 'var(--tp-coral)', '#f2857a'],
  ['3D 投影', 'var(--tp-shadow-3d)', '#bdaea0'],
  ['焦点 focus', 'var(--tp-focus)', '#ffcc00'],
]

const TILES = sampleItems(8)
const MASONRY = sampleItems(120, 20)
const CHARS = [
  { name: '爱弥斯', color: 'var(--c-pink)' },
  { name: '守岸人', color: 'var(--c-blue)' },
  { name: '菲比', color: 'var(--c-yellow)' },
  { name: '千咲', color: 'var(--c-purple)' },
  { name: '椿', color: 'var(--c-red)' },
]

function Swatch({ name, value, code }: { name: string; value: string; code: string }) {
  return (
    <div className="sw">
      <i style={{ background: value }} />
      <div>
        <b>{name}</b>
        <code>{code}</code>
      </div>
    </div>
  )
}

function Card({ title, code, children }: { title: string; code: string; children: ReactNode }) {
  return (
    <div className="card ds-card">
      <h4>
        {title}
        <small>{code}</small>
      </h4>
      {children}
    </div>
  )
}

/** Fake 0→100% progress for the 打包 demo; calls onDone at 100. */
function useFakeProgress(on: boolean, onDone: () => void) {
  const [p, setP] = useState(0)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    if (!on) return
    let v = 0
    setP(0)
    const t = setInterval(() => {
      v = Math.min(100, v + 4)
      setP(v)
      if (v === 100) {
        clearInterval(t)
        setTimeout(() => done.current(), 500)
      }
    }, 90)
    return () => clearInterval(t)
  }, [on])
  return p
}

function AdminFrame({ role, pathname, name }: { role: Role; pathname: string; name: string }) {
  const { site } = useSiteConfig()
  return (
    <div className="kit-frame">
      <AdminShell siteName={site.name} viewer={{ name, role }} pathname={pathname} badges={{ review: 5, comments: 12, jobs: 3 }} onSearch={() => toast('后台搜索（演示）')}>
        <div className="adm-h">
          <div>
            <h1>仪表盘</h1>
            <p>{ROLES[role].name}视角 · 菜单按权限过滤</p>
          </div>
        </div>
        <div className="kpis">
          {[
            ['今日下载', '2,184'],
            ['待审投稿', '5'],
            ['评论待审', '12'],
          ].map(([k, v]) => (
            <div className="kpi" key={k}>
              <span className="k">{k}</span>
              <span className="v">{v}</span>
            </div>
          ))}
        </div>
      </AdminShell>
    </div>
  )
}

export function KitPage() {
  const { site, announcement } = useSiteConfig()
  const [tray, setTray] = useState(3)
  const [favs, setFavs] = useState<Set<string>>(() => new Set(['s1']))
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<Set<string>>(() => new Set())
  const [sort, setSort] = useState<'hot' | 'new' | 'fav'>('hot')
  const [credits, setCredits] = useState(true)
  const [modal, setModal] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [zipping, setZipping] = useState(false)
  const autoplay = useAutoplayPref()
  const progress = useFakeProgress(zipping, () => {
    setZipping(false)
    toast({ message: '打包完成（演示，不会真的下载）', icon: 'check' })
  })
  const [roleChars, setRoleChars] = useState<Set<string>>(() => new Set(['爱弥斯']))
  const filterBar = useRef<HTMLDivElement>(null)
  const [cmdk, setCmdk] = useState(false)

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  return (
    <>
      <AnnouncementBar text={announcement ?? '新上架：全角色琵琶曲 v2.0，27 张动态回眸（/kit 演示公告）'} />
      <Header siteName={site.name} subtitle={site.subtitle} trayCount={tray} onTrayClick={() => setSheet(true)} onSearch={() => setCmdk(true)} user={null} />
      <main id="main" className="page">
        <div className="wrap">
          <div className="page-h">
            <span className="eyebrow">Design System · kit</span>
            <h1>{site.name}设计系统</h1>
            <span className="sub" style={{ maxWidth: '60ch' }}>
              组件库的现场样张：每个组件都来自 src/ui，样式来自 src/ui/styles。站名来自 siteIdentity()（当前为「{site.name}」）。本页只在开发环境可见，图片是本地生成的占位贴纸。
            </span>
          </div>

          <section className="sec">
            <SectionHead plain title="色彩" sub="暖色中性 + 潮汐青；正文对比度均 ≥ 4.5:1" />
            <div className="ds-sw">
              {SURFACES.map(([n, v, c]) => (
                <Swatch key={n} name={n} value={v} code={c} />
              ))}
            </div>
            <div className="ds-sw" style={{ marginTop: 12 }}>
              {TIDE.map(([n, v, c]) => (
                <Swatch key={n} name={n} value={v} code={c} />
              ))}
            </div>
            <h3 style={{ fontSize: 15, margin: '18px 0 10px' }}>岛屿色板 · 用于角色主题色与标签</h3>
            <div className="ds-sw isl">
              {PALETTE.map((c) => (
                <Swatch key={c} name={c} value={`var(--c-${c})`} code={`--c-${c}`} />
              ))}
            </div>
          </section>

          <section className="sec">
            <SectionHead plain title="字体" sub="标题 TP Rounded（寒蝉圆黑体，按 unicode-range 分片）；正文系统字体；数字 Nunito" />
            <div className="card">
              <div className="type-row">
                <small>
                  Display · TP Rounded Heavy 900
                </small>
                <div style={{ fontFamily: 'var(--tp-font-display)', fontWeight: 900, fontSize: 44, color: 'var(--tp-ink)', lineHeight: 1.15 }}>退潮后，捡一枚表情</div>
              </div>
              <div className="type-row">
                <small>H2 · TP Rounded Bold 800</small>
                <div style={{ fontFamily: 'var(--tp-font-display)', fontWeight: 800, fontSize: 26, color: 'var(--tp-ink)' }}>爱弥斯动态表情包（板牌）</div>
              </div>
              <div className="type-row">
                <small>locl 检查 · 户 令 与数字应为中文字形</small>
                <div>
                  <div className="kit-probe" data-probe="heavy">
                    户令0123456789 门户 命令
                  </div>
                  <div className="kit-probe b" data-probe="bold">
                    户令0123456789 门户 命令
                  </div>
                </div>
              </div>
              <div className="type-row">
                <small>正文 · 系统黑体 15/1.6 · 500</small>
                <div>感谢来自群聊的约稿。共 25 张动态表情，许可为 CC BY-NC-SA 4.0，下载的压缩包附带署名文件。</div>
              </div>
              <div className="type-row">
                <small>数字 · Nunito 900 等宽</small>
                <div className="num" style={{ fontSize: 34, color: 'var(--tp-ink)' }}>
                  15,272 · 309 · 186 万
                </div>
              </div>
              <div className="type-row">
                <small>标签 · 12/16 · 900 字距 0.16em</small>
                <div className="eyebrow">Wuthering Waves Stickers</div>
              </div>
            </div>
          </section>

          <section className="sec">
            <SectionHead plain title="组件" sub="形状和投影沿用 animal-island-ui，颜色走本站令牌；交互基于 Base UI" />
            <div className="ds-grid">
              <Card title="按钮" code="Button">
                <div className="ds-row">
                  <Button variant="primary" icon="box">
                    打包下载
                  </Button>
                  <Button variant="sun" icon="bottle">
                    加入打包
                  </Button>
                  <Button icon="heart">收藏</Button>
                  <Button variant="danger" size="sm">
                    删除
                  </Button>
                  <Button variant="ghost" size="sm">
                    取消
                  </Button>
                </div>
                <div className="ds-row">
                  <Button size="xs">xs</Button>
                  <Button size="sm">sm</Button>
                  <Button>md</Button>
                  <Button size="lg">lg</Button>
                  <Button disabled>禁用</Button>
                </div>
                <div className="ds-row">
                  <Button variant="primary" block icon="box" progress={zipping ? progress : null} onClick={() => setZipping(true)}>
                    {zipping ? `正在打包 ${progress}%` : '打包下载原图（点我看进度）'}
                  </Button>
                </div>
                <div className="ds-row">
                  <IconButton icon="search" label="搜索" />
                  <IconButton icon="bell" label="通知" badge={3} />
                  <IconButton icon="close" label="关闭" tip />
                  <IconButton icon="more" label="更多" look="plain" />
                </div>
                <span className="hint">主按钮：5px 实色投影，悬停抬高 1px，按下下沉 4px，按下处有潮汐涟漪。</span>
              </Card>

              <Card title="输入与选择" code="Input · Field · Switch · Seg">
                <Input icon="search" placeholder="搜索表情包、角色、画师" aria-label="搜索" />
                <Field label="昵称" aside="必填" error="昵称已被占用">
                  <Input defaultValue="今州打工人" />
                </Field>
                <Field label="简介" hint="最多 200 字">
                  <Textarea placeholder="说点什么，或者直接甩一张贴纸" rows={3} />
                </Field>
                <div className="ds-row">
                  <Switch checked={autoplay} onCheckedChange={setAutoplayPref}>
                    自动播放
                  </Switch>
                  <Switch defaultChecked={false}>减少动效</Switch>
                  <Check checked={credits} onChange={setCredits}>
                    附带 CREDITS.txt
                  </Check>
                </div>
                <Seg
                  label="排序"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: 'hot', label: '最热' },
                    { value: 'new', label: '最新' },
                    { value: 'fav', label: '收藏最多' },
                  ]}
                />
              </Card>

              <Card title="标签与旗标" code="Chip · Tag · Flag">
                <Chips>
                  <Chip on size="sm">
                    全部
                  </Chip>
                  <Chip size="sm" avatar={{ src: sticker(1), color: 'var(--c-pink)' }} count={40}>
                    爱弥斯
                  </Chip>
                  <Chip size="sm" count={85}>
                    静态
                  </Chip>
                  <Chip size="sm" removable>
                    画师 · 雾雪
                  </Chip>
                </Chips>
                <div className="ds-row">
                  <Tag color="var(--c-pink)">角色 · 爱弥斯</Tag>
                  <Tag color="var(--c-purple)">画师 · 雾雪</Tag>
                  <Tag>动态表情</Tag>
                </div>
                <div className="ds-row">
                  <Flag kind="official" />
                  <Flag kind="pin" />
                  <Flag kind="memorial" />
                  <Flag kind="new" />
                  <Flag kind="static" />
                </div>
              </Card>

              <Card title="缎带标题" code="Ribbon">
                <div className="ds-row" style={{ gap: 18 }}>
                  <Ribbon tone="sun">站长精选</Ribbon>
                  <Ribbon tone="pink">新上架</Ribbon>
                  <Ribbon tone="mint">潮汐流</Ribbon>
                  <Ribbon tone="deep">官方表情</Ribbon>
                </div>
                <span className="hint">燕尾裁切 + 3° 透视，只用于首页区块标题，每屏最多两条。</span>
              </Card>

              <Card title="表情方块" code="Tile">
                <TileGrid size={96} selecting={selecting}>
                  {TILES.slice(0, 6).map((t, i) => (
                    <Tile
                      key={t.id}
                      poster={t.poster}
                      preview={t.preview}
                      alt={`表情 ${i + 1}`}
                      format={t.preview ? 'gif' : 'png'}
                      favorite={favs.has(t.id)}
                      selecting={selecting}
                      selected={sel.has(t.id)}
                      enterIndex={i}
                      onOpen={() => (selecting ? setSel((s) => toggle(s, t.id)) : toast({ message: `打开表情 ${i + 1}`, icon: 'eye' }))}
                      onCopy={() => toast('已复制图片')}
                      onDownload={() => toast({ message: '开始下载原图', icon: 'download' })}
                      onAdd={() => {
                        setTray((n) => n + 1)
                        toast({ message: '已加入打包', icon: 'box' })
                      }}
                      onFavorite={() => setFavs((s) => toggle(s, t.id))}
                    />
                  ))}
                </TileGrid>
                <div className="ds-row">
                  <Switch checked={selecting} onCheckedChange={setSelecting}>
                    多选模式
                  </Switch>
                  <span className="hint">已选 {sel.size} 张</span>
                </div>
                <span className="hint">默认显示 p240 海报；悬停或滚到视口中部时换成 a160 预览，全页同时最多 4 张。</span>
              </Card>

              <Card title="标签页" code="Tabs">
                <Tabs
                  items={[
                    { value: 'packs', label: '表情包', count: 309 },
                    { value: 'emojis', label: '全部表情', count: '1.5 万' },
                    { value: 'comments', label: '评论' },
                  ]}
                  label="内容类型"
                >
                  <TabPanel value="packs">
                    <p className="hint" style={{ paddingTop: 10 }}>
                      表情包面板
                    </p>
                  </TabPanel>
                  <TabPanel value="emojis">
                    <p className="hint" style={{ paddingTop: 10 }}>
                      全部表情面板
                    </p>
                  </TabPanel>
                  <TabPanel value="comments">
                    <p className="hint" style={{ paddingTop: 10 }}>
                      评论面板
                    </p>
                  </TabPanel>
                </Tabs>
                <span className="hint">叶片摆动：下划线切换时轻微摆动。</span>
              </Card>

              <Card title="弹层" code="Modal · Sheet · Toast · Menu">
                <div className="ds-row">
                  <Button onClick={() => setModal(true)}>确认弹窗</Button>
                  <Button onClick={() => setSheet(true)} icon="box">
                    打包清单
                  </Button>
                  <Button onClick={() => toast({ message: '已加入打包', detail: '共 4 张', icon: 'box' })}>提示条</Button>
                  <Menu
                    trigger={
                      <button type="button" className="btn">
                        <Icon name="more" />
                        菜单
                      </button>
                    }
                    items={[
                      { label: '个人中心', icon: 'user', to: '/me', kind: 'link' },
                      { label: '复制链接', icon: 'link', onSelect: () => toast('已复制链接') },
                      { kind: 'separator' },
                      { label: '退出登录', icon: 'logout', danger: true, onSelect: () => toast('已退出（演示）') },
                    ]}
                  />
                </div>
                <span className="hint">弹窗用沙色波浪轮廓；手机上抽屉变成底部面板，高度不超过屏幕的 88%。</span>
              </Card>

              <Card title="筛选面板" code="FilterPopover">
                <div className="filterbar" ref={filterBar} style={{ margin: 0 }}>
                  <div className="fb-facets">
                    <FilterPopover
                      label="角色"
                      value={roleChars.size ? [...roleChars].join('、') : undefined}
                      anchor={filterBar}
                      header={<Input size="sm" icon="search" placeholder="找角色" aria-label="找角色" />}
                      footer={
                        <>
                          <span>已选 {roleChars.size} 个</span>
                          <Button size="xs" variant="ghost" onClick={() => setRoleChars(new Set())}>
                            清除
                          </Button>
                        </>
                      }
                    >
                      <div className="fpop-grid c3">
                        {CHARS.map((c, i) => (
                          <Chip key={c.name} size="sm" on={roleChars.has(c.name)} count={40 - i * 7} avatar={{ src: sticker(i + 2), color: c.color }} onClick={() => setRoleChars((s) => toggle(s, c.name))}>
                            {c.name}
                          </Chip>
                        ))}
                      </div>
                    </FilterPopover>
                    <FilterPopover label="类型" panelClassName="fpop-type">
                      <div className="fpop-grid">
                        <Chip size="sm" on>
                          动态
                        </Chip>
                        <Chip size="sm">静态</Chip>
                      </div>
                    </FilterPopover>
                  </div>
                </div>
                <span className="hint">面板按内容定高：没有边框，没有内部滚动条。手机上改为底部面板。</span>
              </Card>

              <Card title="空状态" code="EmptyState">
                <EmptyState icon="box" title="还没有选中的表情" actions={<Button size="sm">去逛逛</Button>}>
                  在任意表情上点「打包」加入，可以跨包收集，最后一次下载。
                </EmptyState>
              </Card>

              <Card title="人机验证" code="CapWidget">
                <CapWidget onToken={() => toast({ message: '人机验证已通过', icon: 'shield' })} onError={(e) => toast({ message: `人机验证出错：${e.message}`, icon: 'warn' })} />
                <span className="hint">自托管 Cap（工作量证明）。脚本按需加载，WASM 来自本站 /cap/；令牌放在 x-cap-token 请求头里，一次有效。</span>
              </Card>

              <Card title="加载与进度" code="WaveLoader · progress">
                <div className="loadmore">
                  <WaveLoader />
                  <span>正在加载更多</span>
                </div>
                <div className="progress" style={{ '--p': '62%' } as CSSProperties}>
                  <i />
                </div>
                <span className="hint">声纹加载代替转圈，用于无限加载。</span>
              </Card>
            </div>
          </section>

          <section className="sec">
            <SectionHead plain title="表情包卡片" sub="封面四种排法：四宫格、主图 + 侧栏、单图、横条" />
            <div className="masonry" style={{ '--mcol': '240px' } as CSSProperties}>
              {COVER_VARIANTS.map((v, i) => (
                <PackCard
                  key={v}
                  href={`/packs/sample-${v}`}
                  title={['爱弥斯动态表情包（板牌）', '守岸人日常 · 第二弹', '菲比的祈祷时间', '千咲与椿的放学路'][i]!}
                  excerpt={i === 2 ? null : '感谢来自群聊的约稿。共 25 张动态表情，许可为 CC BY-NC-SA 4.0，下载的压缩包附带署名文件。'}
                  count={[25, 18, 9, 32][i]!}
                  accent={CHARS[i]!.color}
                  images={TILES.slice(i, i + 4).map((t) => t.poster)}
                  coverPreview={TILES[i]!.preview}
                  variant={v}
                  flags={i === 0 ? ['pin'] : i === 1 ? ['official'] : i === 3 ? ['new', 'memorial'] : ['static']}
                  characters={CHARS.slice(0, 2 + i)}
                  downloads={[186_000, 9_400, 31_250, 1_200][i]}
                  favorites={[1520, 88, 431, 9][i]}
                  date={['10-09', '09-28', '08-15', '10-18'][i]}
                  artists={i === 1 ? undefined : ['雾雪', '阿七']}
                  official={i === 1}
                  enterIndex={i}
                />
              ))}
            </div>
          </section>

          <section className="sec">
            <SectionHead plain title="管理台外壳" sub="侧栏按 can(role, perm) 过滤；没有权限的页面显示 403 空状态" />
            <div className="kit-admin">
              <AdminFrame role="admin" pathname="/admin" name={`${site.name}站长`} />
              <AdminFrame role="manager" pathname="/admin/users" name="海风" />
            </div>
            <div className="kit-roles">
              {(['admin', 'manager', 'user'] as const).map((r) => (
                <div className="card" key={r}>
                  <b>{ROLES[r].name}</b>
                  <ul className="rules">
                    {navForRole(r).flatMap((g) => g.items).map((it) => (
                      <li key={it.id}>{it.label}</li>
                    ))}
                    {navForRole(r).length === 0 ? <li>（无后台菜单，进入后台显示 403）</li> : null}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          <section className="sec">
            <SectionHead plain title="图标" sub="2px 圆角描边，24 网格，内联 SVG" />
            <div className="card kit-icons">
              {ICON_NAMES.map((k) => (
                <div key={k}>
                  <Icon name={k} size="lg" />
                  <small className="mono">{k}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="sec">
            <SectionHead plain title="瀑布流" sub={`TanStack Virtual 窗口虚拟列表 + lanes；高度来自库里存的宽高，不测量 DOM（${MASONRY.length} 项）`} />
            <Masonry
              label="瀑布流示例"
              items={MASONRY}
              getKey={(it) => it.id}
              getHeight={(it, lw) => itemHeight(it.w, it.h, lw)}
              minColumnWidth={180}
              minColumnWidthPhone={140}
              gap={14}
              gapPhone={10}
              renderItem={(it, i) => (
                <div className="kit-mcell">
                  <img src={it.poster} width={it.w} height={it.h} alt={`占位贴纸 ${i + 1}`} loading="lazy" decoding="async" />
                  <span className="num">
                    {it.w}×{it.h}
                  </span>
                </div>
              )}
            />
          </section>
        </div>
      </main>
      <Footer siteName={site.name} subtitle={site.subtitle} stats={{ emojis: 15272, packs: 309 }} />
      <Tabbar />
      <TrayFab count={tray} onClick={() => setSheet(true)} />

      <Modal
        open={modal}
        onOpenChange={setModal}
        icon="trash"
        title="移出打包清单？"
        actions={
          <>
            <ModalClose render={<Button variant="ghost" />}>取消</ModalClose>
            <Button
              variant="danger"
              onClick={() => {
                setModal(false)
                setTray(0)
                toast({ message: '已清空打包清单', icon: 'trash' })
              }}
            >
              清空
            </Button>
          </>
        }
      >
        清单里的 {tray} 张表情会被移出，已经下载的文件不受影响。
      </Modal>

      <Sheet
        open={sheet}
        onOpenChange={setSheet}
        icon="box"
        title="打包清单"
        subtitle="跨包挑选，一次下载原图"
        footer={
          <>
            <Button variant="primary" block icon="download" progress={zipping ? progress : null} onClick={() => setZipping(true)} disabled={!tray}>
              {zipping ? `正在打包 ${progress}%` : `打包下载原图（${tray} 张）`}
            </Button>
            <span className="hint">在浏览器里打包，默认不需要登录；每 200 张一个压缩包。</span>
          </>
        }
      >
        {tray ? (
          <>
            <div className="pk-sum">
              <div>
                <b className="num">{tray}</b> 张<span>来自 2 个包</span>
              </div>
              <div>
                <b className="num">{fmtB(tray * 0.66 * 1_048_576)}</b>
                <span>原图合计 · 附 CREDITS.txt</span>
              </div>
            </div>
            <div className="bgroup">
              <h4>
                爱弥斯动态表情包<small>{tray} 张</small>
              </h4>
              <div className="bthumbs">
                {TILES.slice(0, Math.min(tray, 8)).map((t) => (
                  <span className="bthumb" key={t.id}>
                    <img src={t.poster} alt="" />
                    <button type="button" aria-label="移出" onClick={() => setTray((n) => Math.max(0, n - 1))}>
                      <Icon name="close" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : (
          <EmptyState icon="box" title="还没有选中的表情">
            在任意表情上点「打包」加入，可以跨包收集，最后一次下载。
          </EmptyState>
        )}
      </Sheet>

      <Sheet open={cmdk} onOpenChange={setCmdk} icon="search" title="搜索" subtitle="指令面板由页面实现；这里只演示入口（Ctrl K）">
        <Input icon="search" placeholder="搜索表情包、角色、画师" aria-label="搜索" autoFocus />
      </Sheet>
    </>
  )
}
