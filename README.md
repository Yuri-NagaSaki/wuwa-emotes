# 潮池

潮池是一个鸣潮表情图鉴：按瀑布流浏览表情包，注册用户投稿、管理员审核后发布，评论里可以插入表情贴纸，原图下载与打包受一组可在后台配置的风控规则约束。

本仓库是网站的全部源码：公开站、后台、API、后台任务和部署脚本。架构说明见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 技术栈

| 层 | 选型与版本 |
|---|---|
| 运行时 | Bun 1.4.3（镜像 `oven/bun:1.4.3-slim`） |
| 框架 | TanStack Start 1.169.3、TanStack Router 1.170.45、React 19.3.1、Vite 8.3.4、Nitro 3.0.260903-beta（`bun` 预设） |
| 数据 | PostgreSQL 18、Drizzle ORM 0.45.4（drizzle-kit 0.31.11）、pg-boss 12.38.0 |
| 认证与人机验证 | Better Auth 1.7.11、自托管 Cap Standalone（`@cap.js/widget` 0.1.58） |
| 图片与存储 | sharp 0.35.5、Cloudflare R2（`@aws-sdk/client-s3` 3.1153.0） |
| 界面 | Base UI 1.9.0、TanStack Query 5.104.5、TanStack Virtual 3.14.21 |
| 其他 | zod 4.6.7、markdown-it 15.0.3、pino 10.4.0、TypeScript 6.0.3 |
| 入口 | Cloudflare 代理、Caddy 2.11.7、Docker Compose |

## 本地开发

前置条件：Bun 1.4.3、Docker（含 Compose 插件）。本机的 5432 和 9000 端口空闲。

1. 安装依赖：

   ```bash
   bun install
   ```

2. 启动本地服务：PostgreSQL 18 和 RustFS（S3 兼容存储），并创建桶 `chaochi-dev`。服务定义在 `compose.dev.yaml`。

   ```bash
   bun run dev:services
   ```

3. 执行数据库迁移（同时安装 pg-boss 的表）：

   ```bash
   bun run migrate
   ```

4. 启动开发服务器，打开 <http://localhost:3000>：

   ```bash
   bun run dev
   ```

5. 需要生成衍生图或 ZIP 时，在另一个终端启动 worker：

   ```bash
   bun run worker
   ```

本地开发不需要 `.env` 文件：开发环境的默认值（数据库、RustFS 地址与密钥、站点地址）写在 `src/server/env.ts`。

- 本地注册与登录：注册、登录等接口要求人机验证令牌，服务端没有 `CAP_SECRET_KEY` 时拒绝所有令牌。账号页面的表单先从 `CAP_API_ENDPOINT` 指向的 Cap Standalone 服务器取得令牌；默认端点是生产的 Cap 服务器，按 `deploy/README.md` 它只允许站点源跨域，本地页面取不到令牌。两种做法：
  - 在浏览器里使用账号页面：把 `CAP_API_ENDPOINT`、`CAP_SITE_KEY`、`CAP_SECRET_KEY` 指向一台允许 `http://localhost:3000` 的 Cap Standalone 服务器。组件的 WASM 由 `bun run build` 复制到 `public/cap/`，`bun run dev` 不复制，先执行一次 `bun scripts/copy-cap-assets.ts`。
  - 只需要账号时：用 `CAP_DISABLED=1 bun run dev` 启动，服务端接受任意非空令牌（生产环境拒绝这个设置）；再直接调用 Better Auth 接口注册，`x-cap-token` 头填任意值，做法见 `tests/admin/dev-accounts.ts`。
- 邮件：没有配置 `SMTP_URL` 和 `MAIL_FROM` 时，邮件内容写进日志，注册也不要求验证邮箱。
- 设为站长：先用上一条的方法注册账号，再执行 `bun run cli promote-admin <邮箱>`。
- 端口冲突：用 `CHAOCHI_DEV_PG_PORT`、`CHAOCHI_DEV_S3_PORT` 改端口，并相应设置 `DATABASE_URL`、`S3_ENDPOINT`。
- 停止本地服务：`bun run dev:services:down`。

## 测试

```bash
bun run test
```

`bun run test` 依次运行 unit、ui、pages、integration、catalog、downloads、submissions 与 account、comments、admin、media 与 import 十组测试。除 unit、ui、pages 外，各组都需要上一节的本地服务（127.0.0.1:5432 的 PostgreSQL，127.0.0.1:9000 的 S3）。不需要浏览器：`tests/` 下的 `*-shots.ts`、`e2e-flow.ts`、`ui-smoke.ts` 是手动执行的脚本，不在测试集中。

- 用 `bun run test` 或 `bun run test:<组名>`，不要直接运行 `bun test`：各组的库名、桶名和环境变量由 `package.json` 的脚本设置，直接运行时所有组挤在一个进程里且缺少这些设置，测试会拒绝运行或报错。
- 测试会删除并重建自己的数据库。库名必须匹配 `tests/integration/setup.ts` 中的规则 `^chaochi_(lane_[a-z0-9]+|test)(_[a-z0-9_]+)?$`，例如 `chaochi_test`、`chaochi_test_catalog`。media 与 import 组另有检查：库名必须含 `test`，S3 必须是本机地址。
- 测试拒绝使用生产桶 `wuwa`。各组的库名和桶名写在 `package.json` 的 `test:*` 脚本里，可用 `CHAOCHI_TEST_DB`、`CHAOCHI_TEST_BUCKET`、`CHAOCHI_TEST_PG`、`CHAOCHI_TEST_S3` 覆盖。

类型检查：`bun run typecheck`。

## 构建与部署

推送到 `develop` 或 `main` 后，GitHub Actions 运行类型检查、全部测试、构建（最后由 `scripts/check-client-bundle.ts` 确认浏览器包里没有服务端代码）和全历史密钥扫描，全部通过后把镜像推送到 `ghcr.io/yuri-nagasaki/wuwa-emotes:<提交前 7 位>`；本地用 `bun run build` 构建，`bun run docker:build` 构建镜像。发布在开发机上执行 `deploy/release.sh`：它等 CI 镜像就绪，再让服务器检出该提交，由 `deploy/rollout.sh` 逐个替换两个 web 副本，发布不中断访问，详见 [`deploy/README.md`](deploy/README.md)。

## 目录结构

| 目录 | 内容 |
|---|---|
| `src/` | 应用源码：路由（`routes/`）、服务端模块（`server/`）、界面组件（`ui/`）、共享常量（`shared/`），以及 worker、迁移和命令行入口 |
| `drizzle/` | SQL 迁移文件与 drizzle-kit 快照 |
| `tests/` | 测试，按 `package.json` 中的测试组分目录 |
| `scripts/` | 构建脚本：客户端包检查、Cap 资源复制、字体子集化 |
| `public/` | 静态文件：自托管字体（Nunito、TP Rounded） |
| `deploy/` | 部署脚本与配置：Caddy、nftables 防火墙、发布与零中断滚动替换、环境变量模板 |
| `design/` | 交互式 UI 设计稿源码与设计令牌 |
| `docs/` | 架构文档 |
| `.github/` | GitHub Actions 工作流：检查、密钥扫描、构建镜像 |

根目录另有 `Dockerfile`、`compose.yaml`（生产）、`compose.dev.yaml`（本地服务）和 `.gitleaks.toml`（密钥扫描规则）。

## 文档

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)：架构与实现说明
- [`deploy/README.md`](deploy/README.md)：部署与运维
- [`DEVELOPMENT.md`](DEVELOPMENT.md)：v1 数据集说明（R2 桶中的只读快照）

## 安全

- 密钥只放在服务器的环境文件（`/opt/chaochi/app-env`）和开发机本地的 `.env.local` 中，两者都不进仓库。`.gitignore` 与 `.dockerignore` 排除 `.env*`。
- 仓库里没有服务器地址：部署脚本从不进仓库的 `deploy/.deploy-host` 或环境变量 `CHAOCHI_DEPLOY_HOST` 读取。
- 仓库已开启 GitHub secret scanning 与 push protection；CI 每次运行都用 gitleaks 扫描全部历史，另有一条拒绝公网 IPv4 地址的规则。
- 发现安全问题时，请在 GitHub 仓库的 Security 页面提交私密安全通告（Report a vulnerability），不要公开提 issue。

## 许可证

待定。
