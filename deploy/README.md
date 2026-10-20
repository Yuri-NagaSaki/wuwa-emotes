# 潮池部署与运维

单机 Docker Compose。访客经 Cloudflare（DNS 橙云代理）连到源站 443 端口；源站的 Caddy 只接受 Cloudflare 的连接，把请求分给两个 web 副本。发布用 `deploy/rollout.sh` 逐个替换副本，访客不会遇到中断。入口不使用 Cloudflare Tunnel。

```text
访客 ──HTTPS──▶ Cloudflare ──:443──▶ proxy（Caddy，主机网络；nftables 只放行 Cloudflare）
                                      ├──▶ web-a 172.30.47.11:3000 ┐ 桥接网络 app，
                                      └──▶ web-b 172.30.47.12:3000 ┘ 不映射到主机
web-a、web-b、worker、migrate ──▶ db（PostgreSQL 18）      web、worker ──▶ R2 桶 wuwa
```

| 服务 | 作用 | 要点 |
|---|---|---|
| `proxy` | Caddy 2，终止 TLS | 只服务 `sparxie.moe`；`www` 301 到主域；其他 Host、未知 SNI、直接用 IP 访问一律断开连接，不返回内容 |
| `web-a`、`web-b` | 网站（`bun .output/server/index.mjs`） | 固定 IP，不映射端口；健康检查 `/api/health` |
| `worker` | 图片衍生、打包、备份、汇总 | 限制 2 GB 内存、1 个 CPU；停止时先完成进行中的任务（最多 60 秒） |
| `migrate` | 一次性迁移 | 每次发布先于副本切换执行 |
| `db` | PostgreSQL 18 | 数据卷 `chaochi_pgdata` |

## 服务器准备

- Debian 13，Docker Engine 25 或更高版本（健康检查用到 `start_interval`），Docker Compose 插件。
- 主机工具：`curl`、`nftables`（`nft`）、`util-linux`（`nsenter`、`flock`）、`iproute2`（`ss`）。Debian 13 标准安装通常已包含；缺少时用 `apt install` 补齐。
- 以 root 执行本文命令。`rollout.sh` 需要 root：它进入副本的网络命名空间排空连接。
- 不要启用带 `flush ruleset` 的 `nftables.service`：它会清掉 Docker 的规则。`firewall.sh install` 检测到时会提示。

目录布局：

```text
/opt/chaochi/
├── src/          源码（compose.yaml、deploy/），由开发机的 deploy/push-src.sh 原地更新；docker compose 命令在这里执行
├── app-env       应用配置与密钥，root 所有，权限 600
├── certs/        Cloudflare Origin CA 证书：origin.pem、origin-key.pem，权限 600
├── deploy.conf   可选：compose 层面的覆盖项，不含密钥
├── backups/      手动备份
└── state/        rollout.sh 的锁和发布记录 releases.log
```

`compose.yaml` 的默认值就是生产值，通常不需要 `deploy.conf`。只有子网 `172.30.47.0/24` 与主机上已有网络冲突时，才在 `deploy.conf` 里写 `CHAOCHI_SUBNET`、`CHAOCHI_WEB_A_IP`、`CHAOCHI_WEB_B_IP`。`rollout.sh` 会读取 `deploy.conf`；手动执行 `docker compose` 前，先执行 `set -a; . /opt/chaochi/deploy.conf; set +a`，否则 compose 会认为配置变了而重建容器。

## 填写 app-env

```bash
install -m 600 /opt/chaochi/src/deploy/env.template /opt/chaochi/app-env
```

| 变量 | 由谁提供 | 说明 |
|---|---|---|
| `AUTH_SECRET` | 运维生成：`openssl rand -hex 32` | 更换后所有登录会话失效 |
| `IP_HASH_SALT` | 运维生成：`openssl rand -hex 16` | 更换后已有的 IP 哈希无法再对比 |
| `POSTGRES_PASSWORD`、`DATABASE_URL` | 运维生成 | 两处密码相同。`POSTGRES_PASSWORD` 只在数据目录首次初始化时生效，之后改密码要在数据库里 `ALTER USER` |
| `S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_ENDPOINT` | 站长在 Cloudflare 控制台创建 R2 API 令牌 | 令牌只授权桶 `wuwa`，权限为对象读写 |
| `CAP_SECRET_KEY` | Cap 服务器管理员 | 以 `sk-` 开头，只放在服务器上 |
| `SMTP_URL`、`MAIL_FROM` | 邮件服务商 | 注册验证与找回密码使用 |
| `CF_ZONE_ID`、`CF_PURGE_TOKEN` | 站长在 Cloudflare 控制台创建 | 令牌只给 Zone.Cache Purge 权限 |

不要在 `app-env` 里设置 `CI` 或 `TEST`：任何一个都会关闭 web 服务的平滑停止。

## Cloudflare 设置（站长操作）

1. 在 DNS 中把 `sparxie.moe`（以及 `www`）的 A 记录指向服务器，保持代理开启（橙云）。不要建任何指向这台服务器的灰云记录，否则源站 IP 会暴露。
2. 在 SSL/TLS →「源服务器」中创建 Origin CA 证书：主机名填 `sparxie.moe` 和 `*.sparxie.moe`，格式选 PEM。把证书保存为 `/opt/chaochi/certs/origin.pem`，把私钥保存为 `/opt/chaochi/certs/origin-key.pem`，两者权限都设为 600。
3. 证书文件放好并重载 proxy（见「证书与 TLS 模式」）之后，再把 SSL/TLS 加密模式设为「完全（严格）」。证书文件放好之前，proxy 使用 Caddy 内部 CA，只能配合「完全」模式；此时设为「完全（严格）」会出现 526 错误。
4. 开启「始终使用 HTTPS」。源站不监听 80 端口，`http://` 请求需要 Cloudflare 在边缘重定向。
5. 缓存规则：`/img/*` 设为符合缓存条件，边缘 TTL 选「如果存在 Cache-Control 标头则使用，否则绕过缓存」（Use cache-control header if present, bypass cache if not）；开启 Smart Tiered Cache。其余规则见 `docs/ARCHITECTURE.md` 第 12.4 节。

## 首次部署

前置条件：已完成「服务器准备」，`app-env` 已填写。证书文件可以稍后再放。

1. 上传代码：服务器先安装 rsync（`apt-get install -y rsync`），再在开发机的仓库里执行 `deploy/push-src.sh`。之后在服务器上 `cd /opt/chaochi/src`。
2. 安装防火墙，必须在首次启动容器之前执行：`deploy/firewall.sh install`。脚本安装开机加载的服务和每周刷新 Cloudflare 网段的定时器，并关闭 systemd-resolved 的 LLMNR（5355 端口）。如果 SSH 不在 22 端口，执行 `CHAOCHI_SSH_PORT=<端口> deploy/firewall.sh install`；否则脚本会拒绝执行，避免锁死 SSH。安装时的 SSH 端口和 HTTPS 端口保存在 `/etc/default/chaochi-firewall`，开机加载和每周刷新都读取这个文件。
3. 检查防火墙：`deploy/firewall.sh status`。从另一台机器用 `curl -k --resolve sparxie.moe:443:<服务器IP> https://sparxie.moe/` 访问应当超时。
4. 构建并启动：`deploy/rollout.sh --build "$(cat REVISION)"`。首次执行会依次启动 db、执行迁移、启动 web-a 和 web-b、启动 proxy 和 worker。
5. 打开 `https://sparxie.moe/` 注册账号并完成邮箱验证。
6. 把这个账号设为站长：`docker compose exec web-a bun src/cli.ts promote-admin <邮箱>`。
7. 导入 v1 数据（首次上线时执行）。命令在一次性的 worker 容器里运行，内存与 CPU 限制与 worker 相同：
   1. 先预演：`docker compose run --rm --no-deps worker bun src/cli.ts import-v1 --dry-run`。
   2. 导入：`docker compose run --rm --no-deps worker bun src/cli.ts import-v1`。导入可以重复执行。
   3. 补齐原图尺寸：`docker compose run --rm --no-deps worker bun src/cli.ts backfill-dims`。
   4. 为已发布表情排队生成 `p240`、`a160`：`docker compose run --rm --no-deps worker bun src/cli.ts backfill-derived`。生成由 worker 完成。

## 发布

```bash
deploy/push-src.sh                                                   # 开发机，上传当前提交
cd /opt/chaochi/src && deploy/rollout.sh --build "$(cat REVISION)"   # 服务器
```

`/opt/chaochi/src` 只能原地更新，`push-src.sh` 用 `rsync --delete` 同步。不要用 `mv` 或 `rm -rf` 整体替换这个目录：proxy 通过绑定挂载读取 `src/deploy`，目录被替换后它仍然读取已删除的旧目录，平滑重载会失败，只能重建 proxy（秒级中断）。`rollout.sh` 在改动任何服务之前先让 proxy 校验配置，发现这种情况时停止。

`rollout.sh` 按以下顺序执行，任何一步失败都会停止：

1. 把 `chaochi/app:latest` 指向新镜像，执行迁移。迁移期间旧版本继续服务。
2. 排空 web-a：在 web-a 的网络命名空间里拒绝新连接，Caddy 把新请求改发给 web-b（任何请求方法都会重试），进行中的请求继续完成。
3. 用新镜像重建 web-a，等待 Docker 健康检查通过，并确认 Caddy 已把请求路由到 web-a。
4. 对 web-b 重复第 2、3 步。
5. 重建 worker（先完成进行中的任务），最后平滑重载 Caddy 配置（配置未变时不做任何事）。

本地实测（2026-10-20）：每个副本约 6 秒，整次发布约 20 秒。两次连续发布期间以约 1,470 req/s 持续发送 90,377 个请求（`GET /`、`GET /api/health`、`POST`），失败 0 个，所有旧容器退出码为 0。

发布期间只有一个副本在服务，所以负载必须在单个副本的能力之内。测试机上负载提高到约 1,900 req/s 时，访客路径（`GET /`、`POST`）仍然没有失败，但 `/api/health` 的数据库检查因事件循环排队超过 2 秒，返回了 503。

- 同一标签再执行一次不做任何事；加 `--force` 可以滚动重启全部副本，这也是零中断重启副本的方式。
- 镜像也可以 `--load <镜像.tar>` 导入，或预先 `docker pull`。
- 镜像变化后，不要直接执行 `docker compose up -d`：它会同时重建 web-a 和 web-b，网站会中断。只用 `rollout.sh` 切换镜像。

### 迁移的兼容规则

迁移在副本切换前执行，旧版本会和新数据库结构一起运行一段时间。因此每个发布只做「扩展」，「收缩」放到下一个发布：

- 可以在同一发布中执行：新增表、新增可空列或带默认值的列、新增索引。
- 必须推迟到下一个发布：删除或重命名列和表、把列改为 `NOT NULL`、收紧约束。前提是上一个发布的代码已不再读写这些对象。
- 重命名分三步：新增列并双写 → 回填数据 → 下一个发布删除旧列。

迁移失败时 `rollout.sh` 在重启任何副本之前停止，线上不受影响。

## 回滚

```bash
deploy/rollout.sh <上一个标签>
```

回滚同样是逐个替换，不中断访问。上一个标签打印在每次发布的结尾，也记录在 `/opt/chaochi/state/releases.log`。回滚不撤销迁移；遵守上面的兼容规则时，上一个版本可以在新结构上运行。

发布中途失败时，脚本把 `chaochi/app:latest` 指回原镜像，打印各副本状态和回滚命令。Caddy 只把请求路由给 `/api/health` 返回 2xx 的副本，所以仍然健康的副本会继续服务。

web-a、web-b 和 worker 都已切换、只有最后的 Caddy 重载失败时，发布已经生效：`chaochi/app:latest` 留在新镜像，发布记录照常写入，脚本以退出码 2 结束并打印校验和重载命令。Caddy 继续使用原来的配置服务。

## 证书与 TLS 模式

`CHAOCHI_TLS_MODE` 默认为 `auto`：`/opt/chaochi/certs/` 下 `origin.pem` 和 `origin-key.pem` 都存在时使用 Origin CA 证书，否则使用 Caddy 内部 CA。不会申请 ACME 证书。放入、更换或删除证书文件后，执行平滑重载：

```bash
docker compose exec proxy /bin/sh /etc/chaochi/caddy/caddy.sh reload
```

日志中的 `caddy.sh: reload tls=origin` 表示已经切换到 Origin CA 证书。需要强制某种模式时，在 `deploy.conf` 里设置 `CHAOCHI_TLS_MODE=origin` 或 `internal`；这项设置属于 proxy 容器的配置，修改后要重建 proxy（见「已知限制」）。

## 日志

```bash
docker compose ps
docker compose logs -f --tail 100 web-a web-b
docker compose logs -f --tail 100 proxy     # Caddy JSON 日志，包括副本上下线
docker compose logs -f --tail 100 worker
```

容器日志按 20 MB × 5 个文件轮转。发布记录在 `/opt/chaochi/state/releases.log`。

## 备份与恢复

worker 的 `db.backup` 定时任务每天 03:00（Asia/Shanghai）执行 `pg_dump -Fc`，写到 R2 的 `backups/postgres/<年>/<月>/<日>/<时间戳>.dump`，R2 生命周期保留 30 天。成功时 worker 日志出现 `backup: database dumped`：

```bash
docker compose logs worker | grep 'backup:'
```

发布有风险的迁移前或维护前，另做一份本机备份：

```bash
mkdir -p /opt/chaochi/backups
docker compose exec -T db pg_dump -U chaochi -d chaochi -Fc > /opt/chaochi/backups/chaochi-$(date +%Y%m%d-%H%M).dump
```

从 R2 恢复时，先用 Cloudflare 控制台或任意 S3 客户端把 `.dump` 文件下载到 `/opt/chaochi/backups/`，再按下面的步骤恢复。

恢复会清空当前数据库并让网站停止服务。执行前确认备份文件完整，并先另做一份当前数据库的备份。

1. 停止写入数据库的服务：`docker compose stop worker web-a web-b`。此时网站不可用。
2. 删除并重建数据库：`docker compose exec -T db dropdb -U chaochi --force chaochi`，然后 `docker compose exec -T db createdb -U chaochi chaochi`。
3. 恢复数据：`docker compose exec -T db pg_restore -U chaochi -d chaochi --no-owner --exit-on-error --single-transaction < <备份文件>`。不要对现有数据库用 `--clean`：pg-boss 的分区表会让它失败。
4. 启动服务：`docker compose up -d --no-deps web-a web-b worker`。`docker compose start` 在这里不可用，它要求一次性服务 `migrate` 的容器存在。
5. 用 `docker compose ps` 确认 web-a、web-b 为 healthy。

在新服务器上恢复时，先 `docker compose up -d db`，对新建的空数据库执行第 3 步，再执行 `deploy/rollout.sh --build <标签>`。

## 防火墙维护

- 规则只放行：本机回环、已建立的连接、IPv6 邻居发现、DHCP 回复、SSH，以及来自 Cloudflare 网段的 443。其余入站一律丢弃（IPv4 与 IPv6）。
- `chaochi-firewall-refresh.timer` 每周获取 Cloudflare 网段。获取失败时保留上次的列表。
- 刷新日志出现 `the live list differs` 时，更新 `deploy/cloudflare-ips.txt` 并提交。Caddy 只信任这些网段发来的 `CF-Connecting-IP`。
- 紧急情况下 `deploy/firewall.sh remove` 删除规则表，此后入站不再过滤。

## R2 检查清单

- [ ] API 令牌只授权桶 `wuwa`，权限为对象读写。
- [ ] CORS：允许站点源的 GET（浏览器端打包）和 PUT（上传）：

```json
[
  {
    "AllowedOrigins": ["https://sparxie.moe"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

- [ ] 生命周期规则：前缀 `uploads/tmp/` 7 天后删除；前缀 `backups/` 30 天后删除。
- [ ] Cloudflare 缓存规则 `/img/*` 遵从源站缓存头，开启 Smart Tiered Cache（见「Cloudflare 设置」第 5 步）。

## Cap

Cap Standalone 服务器上的 `CORS_ORIGIN` 只设为站点源 `https://sparxie.moe`，不要用 `*`。

## 本地验证

在工作站上可以起一套独立的测试栈，验证发布不中断。测试栈使用独立的项目名和子网，proxy 只监听 127.0.0.1，存储使用 `local` 配置组里的 RustFS。

1. 准备测试用环境文件（例如 `.work/test-app-env`，不要用 `.env` 开头的文件名）：`NODE_ENV=production`、`DATABASE_URL` 指向 `db`、`S3_ENDPOINT=http://s3:9000`、`S3_BUCKET=chaochi-lane-c`、`S3_FORCE_PATH_STYLE=true`、与 S3 密钥相同的 `RUSTFS_ACCESS_KEY` 和 `RUSTFS_SECRET_KEY`，以及一个假的 `CAP_SECRET_KEY`。保留 `NODE_ENV=production` 是为了走生产环境的配置校验。
2. 导出测试栈设置：

```bash
export COMPOSE_PROJECT_NAME=chaochi-test CHAOCHI_DEPLOY_CONF=/nonexistent \
  CHAOCHI_ENV_FILE=$PWD/.work/test-app-env CHAOCHI_IMAGE=chaochi-test/app:current \
  CHAOCHI_STATE_DIR=$PWD/.work/state CHAOCHI_CERT_DIR=$PWD/.work/certs \
  CHAOCHI_SUBNET=172.30.99.0/24 CHAOCHI_WEB_A_IP=172.30.99.11 CHAOCHI_WEB_B_IP=172.30.99.12 \
  CHAOCHI_BIND=127.0.0.1
```

3. 启动存储并首次部署：`docker compose --profile local up -d s3`，然后 `deploy/rollout.sh --build t1`，再 `docker compose --profile local run --rm s3-init` 创建桶。
4. 在另一个终端持续发请求（`--expect-upstream` 确认请求确实到了本机 proxy，而不是线上站点）：

```bash
docker run --rm --init --network host --add-host sparxie.moe:127.0.0.1 \
  -v "$PWD/deploy/loadcheck.ts:/loadcheck.ts:ro" oven/bun:1.4.3-slim \
  bun /loadcheck.ts --insecure --expect-upstream --post --concurrency 8 --pause 5
```

5. 发布两次：`deploy/rollout.sh --build t2`，然后 `deploy/rollout.sh --build t3`。
6. 按 Ctrl-C 停止发请求，确认输出中 `failed` 为 0。

`--pause 0` 会让副本满载，此时测到的是容量而不是发布过程：单个副本承担全部负载时，`/api/health` 的数据库检查可能超过 2 秒并返回 503。

## 已知限制

- 以下操作会短暂中断访问（秒级），安排在低峰期：重建 proxy（升级 Caddy 镜像、修改 compose 中 proxy 的定义）、重启 db、重启主机。只改 `deploy/caddy/Caddyfile` 时用平滑重载，不需要重建。
- 平滑重载 Caddy 时，Cloudflare 到源站的空闲长连接会被关闭。正在复用这些连接的请求有极小概率失败。
- 用 `docker compose restart` 或 `docker stop` 直接停止副本时没有排空步骤：GET 请求由 Caddy 重试，非 GET 请求有极小概率失败。本地测试中不排空地重启 4 次副本，约 29,000 个 POST 中失败 1 个（502）。需要零中断时用 `rollout.sh --force`。
- 直接向 443 发送明文 HTTP 会收到 Go 内置的 400 响应（不含 IP）。防火墙生效后只有 Cloudflare 能连到 443。
- 防火墙允许所有 Cloudflare 网段。其他 Cloudflare 账号理论上也能把流量导向这台服务器；如需排除，可另行启用 Cloudflare 的 Authenticated Origin Pulls（当前未配置）。
- IPv6 规则只经过 `nft` 语法检查，测试环境没有 IPv6，未做连通性验证。
