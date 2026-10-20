// ---- catalog helpers on top of DATA (real counts from R2 meta/v1) ----
const IMG = (f) => 'img/' + f;
const CHAR_META = {
  '爱弥斯': ['aimisi', 'pink'], '达妮娅': ['daniya', 'purple'], '卡提希娅': ['katixiya', 'mint'], '漂泊者': ['piaobozhe', 'brown'],
  '菲比': ['feibi', 'blue'], '千咲': ['qianxiao', 'red'], '守岸人': ['shouanren', 'blue'], '莫宁': ['moning', 'lime'],
  '今汐': ['jinxi', 'yellow'], '琳奈': ['linnai', 'orange'], '弗洛洛': ['fuluoluo', 'purple'], '尤诺': ['younuo', 'yg'],
  '长离': ['changli', 'red'], '椿': ['chun', 'peach'], '秧秧': ['yangyang', 'green'], '心': ['xin', 'pink'],
  '珂莱塔': ['kelaita', 'blue'], '西格莉卡': ['xigelika', 'mint'], '阿布': ['abu', 'yellow'], '坎特蕾拉': ['kanteleila', 'purple'],
  '清宵': ['qingxiao', 'mint'], '仇远': ['qiuyuan', 'brown'], '嘉贝莉娜': ['jiabeilina', 'red'], '洛可可': ['luokeke', 'orange'],
  '赞妮': ['zanni', 'yellow'], '安可': ['anke', 'pink'], '炽霞': ['chixia', 'orange'], '维里奈': ['weilinai', 'green'],
  '穗穗': ['suisui', 'peach'], '绯雪': ['feixue', 'red'], '奥古斯塔': ['aogusita', 'yellow'], '忌炎': ['jiyan', 'teal'],
  '布兰特': ['bulante', 'orange'], '洛瑟菈': ['luosela', 'purple'], '锁暝': ['suoming', 'blue'], '夏空': ['xiakong', 'blue'],
  '露帕': ['lupa', 'red'], '莉莉': ['lili', 'pink'], '秧秧·玄翎': ['yangyang-xuanling', 'green'], '豚仔': ['tunzai', 'blue'],
  '陆赫斯': ['luhesi', 'brown'], '心月狐': ['xinyuehu', 'pink'], '男漂泊者': ['nan-piaobozhe', 'brown'], '女漂泊者': ['nv-piaobozhe', 'brown']
};
const PALETTE = ['pink', 'purple', 'blue', 'yellow', 'orange', 'mint', 'green', 'red', 'lime', 'yg', 'brown', 'peach', 'teal'];
function charOf(name) {
  const m = CHAR_META[name];
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { name, slug: m ? m[0] : 'c-' + h.toString(36), color: 'var(--c-' + (m ? m[1] : PALETTE[h % PALETTE.length]) + ')' };
}
const CHARS = DATA.characters.map((c) => Object.assign({}, c, charOf(c.name)));
const CHAR_BY = Object.fromEntries(CHARS.map((c) => [c.name, c]));
const PACKS = DATA.packs.map((p, i) => Object.assign({}, p, { acc: (CHAR_BY[p.chars[0]] || charOf(p.chars[0] || p.title)).color, i }));
const PACK_BY = Object.fromEntries(PACKS.map((p) => [p.key, p]));
const DETAIL = DATA.detail;
const AV = (name) => (CHAR_BY[name] && CHAR_BY[name].avatar) || DETAIL.emojis[0].img;
const EMO = DETAIL.emojis;
// every poster we ship, for streams/pickers
const POOL = [].concat(EMO.map((e) => ({ img: e.img, anim: e.anim, pack: 'aimisi-01', t: '爱弥斯动态表情包（板牌）' })),
  PACKS.flatMap((p) => [{ img: p.cover, anim: p.coverAnim, pack: p.key, t: p.title }].concat(p.minis.map((m) => ({ img: m, pack: p.key, t: p.title })))));
const fmtN = (n) => n.toLocaleString('en-US');
const fmtW = (n) => (n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + ' 万' : fmtN(n));
const fmtB = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GiB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// ---- example content (clearly marked as examples in the UI notes) ----
const EX_USERS = [
  { n: '今州打工人', c: 'pink' }, { n: '回音小鱼', c: 'mint' }, { n: '黎那汐塔观光团', c: 'purple' }, { n: '海岸线漫步', c: 'blue' },
  { n: '声骸收集者', c: 'yellow' }, { n: '潮汐观测员', c: 'teal' }, { n: '不会凹分', c: 'orange' }, { n: '小爱同学的同学', c: 'peach' }
];
const REACTIONS = [
  { k: 'like', img: EMO[3].img, t: '好耶' }, { k: 'lol', img: EMO[9].img, t: '笑死' }, { k: 'cry', img: EMO[14].img, t: '哭哭' },
  { k: 'hug', img: EMO[6].img, t: '贴贴' }, { k: 'q', img: EMO[18].img, t: '问号' }, { k: 'wow', img: EMO[21].img, t: '震撼' }
];
const COMMENTS = [
  { id: 1, u: SITE.name + '站长', role: 'staff', c: 'teal', t: '置顶', pinned: true, time: '10-14 21:06', body: '本包由画师授权发布，许可为 CC BY-NC-SA 4.0。二次使用请保留署名，不要商用。打包下载的 ZIP 里已经附带 CREDITS.txt。', re: { like: 58, hug: 12 } },
  { id: 2, u: '今州打工人', c: 'pink', time: '2 小时前', body: '第 7 张拿去当工作群回复神器，老板看了都说好', stk: [EMO[6].img], re: { lol: 31, like: 9, hug: 4 }, mine: { lol: 1 },
    replies: [
      { id: 21, u: '本包画师（示例）', role: 'artist', c: 'pink', time: '1 小时前', body: '谢谢喜欢！下一组在画了', stk: [EMO[12].img], re: { like: 40, hug: 18 } },
      { id: 22, u: '回音小鱼', c: 'mint', time: '50 分钟前', body: '<blockquote>下一组在画了</blockquote>蹲一个新年版', re: { like: 6 } }
    ], more: 3 },
  { id: 3, u: '黎那汐塔观光团', c: 'purple', time: '昨天 23:41', body: '有没有办法只下载静态版？微信里发 GIF 太大了会被压。', re: { q: 5 },
    replies: [ { id: 31, u: SITE.name + '站长', role: 'staff', c: 'teal', time: '昨天 23:58', body: '页面上显示的都是 WebP 预览，所以加载快；单张弹窗里点「保存原图」拿到的才是原始 GIF。', re: { like: 14 } } ] },
  { id: 4, u: '已删除', gone: true, c: 'brown', time: '10-15', body: '该评论已删除' },
  { id: 5, u: '声骸收集者', c: 'yellow', time: '10-12', body: '已经全部加入打包，配合捏捏包一起打包了', stk: [EMO[20].img, EMO[2].img], re: { like: 21, wow: 3 } }
];
const CROWD = ['示例·潮友 A', '示例·潮友 B', '示例·潮友 C', '示例·潮友 D', '示例·潮友 E', '示例·潮友 F', '示例·潮友 G', '示例·潮友 H', '示例·潮友 I', '示例·潮友 J', '示例·潮友 K', '示例·潮友 L'];
const COLLECTIONS = [
  { t: '站长推荐', n: 104, d: '站长逐个挑过的表情包，画质、署名和授权都已核对。', acc: 'var(--c-mint)', imgs: [PACKS[0].cover, PACKS[1].cover, PACKS[2].cover] },
  { t: '官方转载', n: DATA.stats.official, d: '鸣潮官方在 B 站、LINE 等平台发布的表情，本站只做整理。', acc: 'var(--c-purple)', imgs: PACKS.filter((p) => p.official).slice(0, 3).map((p) => p.cover) },
  { t: '捏捏系列', n: 40, d: '用 EmoteLab 制作的捏脸动态表情，下载量最高的一类。', acc: 'var(--c-pink)', imgs: [PACKS[0].cover, PACKS[3].minis[0] || PACKS[3].cover, PACKS[5].cover] },
  { t: '琵琶曲回眸', n: 3, d: '全角色琵琶曲系列，含单人回眸与多人组合。', acc: 'var(--c-yellow)', imgs: (PACK_BY['all-characters-pipa-recrop-20261014'] || PACKS[4]).minis.concat([PACKS[6].cover]).slice(0, 3) },
  { t: 'Solar5 纪念', n: 5, d: 'Solar5 企划的纪念合集。', acc: 'var(--c-blue)', imgs: [(PACK_BY['solar5-younuo'] || PACKS[7]).cover, PACKS[8].cover, PACKS[9].cover] },
  { t: '板牌表情', n: 26, d: '角色举牌、书牌、鸭牌，聊天里最好用的一类。', acc: 'var(--c-orange)', imgs: [EMO[0].img, EMO[5].img, EMO[11].img] }
];
// admin examples
const ADM_USERS = [
  { n: SITE.name + '站长', e: 'ow***@example.com', r: '管理员', s: 'ok', j: '2026-07-16', a: '刚刚', d: 312 },
  { n: '审核员小鱼', e: 'fi***@example.com', r: '审核员', s: 'ok', j: '2026-08-02', a: '12 分钟前', d: 88 },
  { n: '编辑·海风', e: 'se***@example.com', r: '编辑', s: 'ok', j: '2026-08-11', a: '1 小时前', d: 1204 },
  { n: '今州打工人', e: 'jz***@example.com', r: '用户', s: 'ok', j: '2026-09-03', a: '2 小时前', d: 563 },
  { n: '回音小鱼', e: 'hy***@example.com', r: '用户', s: 'ok', j: '2026-09-20', a: '昨天', d: 97 },
  { n: 'scraper_0x1f', e: 'sc***@example.net', r: '用户', s: 'err', j: '2026-10-18', a: '10-19', d: 9120 },
  { n: '黎那汐塔观光团', e: 'ln***@example.com', r: '用户', s: 'ok', j: '2026-10-01', a: '3 天前', d: 45 }
];
const JOBS = [
  { q: 'variants.generate', t: 'xin-new-20261013 · 163 张', s: 'run', p: 62, at: '04:41', dur: '1 分 12 秒' },
  { q: 'zip.build', t: 'aimisi-same-pack-merged-20261005', s: 'run', p: 35, at: '04:42', dur: '18 秒' },
  { q: 'variants.generate', t: 'lili-new-20261013 · 160 张', s: 'wait', p: 0, at: '04:42', dur: '—' },
  { q: 'comments.notify', t: '站内回复通知 · 3 条', s: 'ok', p: 100, at: '04:38', dur: '1 秒' },
  { q: 'catalog.reindex', t: '搜索索引重建', s: 'ok', p: 100, at: '04:30', dur: '6 秒' },
  { q: 'variants.generate', t: 'r-010d856269a1f011513c · 199 帧', s: 'err', p: 0, at: '04:12', dur: '超时 120 秒' },
  { q: 'backup.postgres', t: '每日备份 → backups/postgres/2026/10/20/', s: 'ok', p: 100, at: '03:00', dur: '41 秒' }
];
const AUDIT = [
  { t: '04:39', who: '编辑·海风', act: 'pack.update', obj: 'aimisi-01', diff: ['title', '爱弥斯动态表情包', '爱弥斯动态表情包（板牌）'] },
  { t: '04:21', who: '审核员小鱼', act: 'comment.approve', obj: '#c_18392', diff: null },
  { t: '04:02', who: SITE.name + '站长', act: 'character.merge', obj: '男漂泊者 → 漂泊者', diff: ['packs', '5', '0（并入 piaobozhe）'] },
  { t: '03:58', who: SITE.name + '站长', act: 'user.ban', obj: 'scraper_0x1f', diff: ['banned', 'false', 'true · 批量盗刷'] },
  { t: '03:00', who: '系统', act: 'backup.done', obj: 'backups/postgres/2026/10/20/', diff: null },
  { t: '昨天 22:14', who: '编辑·海风', act: 'emoji.move', obj: '6 张 → cartethyia-shishi', diff: null }
];
const QUEUE = [
  { u: '新访客_8271', g: true, c: 'orange', pack: '达妮娅捏捏表情包', time: '3 分钟前', body: '求求出个表情包合集下载链接 http://example.cn/xx', why: ['首次评论', '含外链'] },
  { u: '今州打工人', c: 'pink', pack: '爱弥斯动态表情包（板牌）', time: '9 分钟前', body: '第 11 张的字是不是错了？', stk: [EMO[10].img], why: ['被举报 1 次'] },
  { u: '新访客_1129', g: true, c: 'blue', pack: '神 · 心 · 捏捏动态表情包（樽）', time: '22 分钟前', body: '收 V 号私聊，低价出号', why: ['屏蔽词：出号', '首次评论'] },
  { u: '回音小鱼', c: 'mint', pack: '守岸人 · KFC联动表情包', time: '1 小时前', body: '这个联动太可爱了', stk: [PACKS[2].cover], why: ['新用户首评'] }
];

// submissions (examples): any registered user can submit; 管理员 or 站长 review
const SUBMISSIONS = [
  { t: '爱弥斯 · 新年板牌', n: 24, by: '今州打工人', mine: true, st: '审核中', cls: 'info', time: '今天 09:12', img: EMO[11].img, imgs: EMO.slice(11, 15).map((e) => e.img), kind: '新包', who: '约稿人', lic: 'CC BY-NC-SA 4.0', proof: true, dl: true, past: 2 },
  { t: '达妮娅捏捏 · 第二弹', n: 36, by: '今州打工人', mine: true, st: '已退回', cls: 'warn', time: '10-18 22:40', img: PACKS[1].cover, kind: '新包', note: '缺少画师授权说明' },
  { t: '菲比 · 日常配字', n: 12, by: '今州打工人', mine: true, st: '已发布', cls: 'ok', time: '10-12 18:03', img: PACKS[3].cover, kind: '新包' },
  { t: '守岸人 · KFC 联动（补 8 张）', n: 8, by: '回音小鱼', st: '审核中', cls: 'info', time: '今天 08:30', img: (PACK_BY['shorekeeper-original-20261010'] || PACKS[6]).cover, imgs: [PACKS[6].cover, PACKS[7].cover, PACKS[8].cover], kind: '补充表情', who: '画师本人', lic: 'CC BY-NC-SA 4.0', proof: false, dl: true, past: 5 },
  { t: '心 · 捏捏表情包 2（圆）', n: 0, by: '黎那汐塔观光团', st: '审核中', cls: 'info', time: '昨天 23:55', img: PACKS[4].cover, kind: '修改已发布', diff: ['标题', '心 · 捏捏表情包 2（圆）', '心 · 捏捏表情包 2（圆圆版）'], who: '已获授权', lic: 'CC BY-NC-SA 4.0', proof: true, dl: true, past: 1 },
  { t: '【官转】共鸣者印象录 · 第十五章', n: 16, by: '声骸收集者', st: '审核中', cls: 'info', time: '昨天 20:10', img: (PACKS.find((p) => p.official) || PACKS[0]).cover, imgs: [(PACKS.find((p) => p.official) || PACKS[0]).cover], kind: '新包', who: '整理搬运', lic: '官方版权', proof: false, dl: false, past: 0 }
];
const PENDING_SUBS = SUBMISSIONS.filter((x) => x.st === '审核中').length;
