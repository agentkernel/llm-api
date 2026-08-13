# 部署说明

## 组件拓扑（同一台受控服务器）

```
[HTTPS 反向代理 (Caddy/Nginx)]
   ├── api.ziyouxie.online        → Sub2API（workbuddy-patch 分支镜像）
   └── assistant.ziyouxie.online  → companion (Fastify, :8720)

[sub2api-postgres]   Sub2API 专用数据库
[companion-postgres] companion 专用数据库（独立实例/库）
```

桌面端只访问 `assistant.*`（业务服务）与 `api.*/v1`（推理网关）。
Admin Key、WB service key 只存在于服务器端环境。

## 0. 单机 Docker Compose 生产部署（推荐路径）

[`deploy/`](../deploy) 下是一套可直接使用的单机编排：`sub2api`、`companion`、两个独立
PostgreSQL、`redis`、`caddy` 反代，数据卷持久化，`restart: unless-stopped`。
下述命令在一台干净的 Ubuntu 24.04（4 vCPU / 6GB 内存起）上执行。

### 0.1 准备主机

```bash
# Docker CE 官方源
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
```

6GB 内存机器建议加 4GB swap（`fallocate -l 4G /swapfile && mkswap /swapfile && swapon /swapfile`，并写入
`/etc/fstab`），Sub2API 前端构建（pnpm + vue-tsc）峰值内存较高。

### 0.2 取源码并应用补丁

```bash
git clone https://github.com/agentkernel/llm-api.git /opt/wb/repo
# Sub2API：官方 v0.1.175 + workbuddy-patch
/opt/wb/repo/sub2api-patch/apply.sh /opt/wb/build/sub2api
```

### 0.3 生成生产密钥并写 .env

```bash
cd /opt/wb/repo/deploy
cp .env.example .env && chmod 600 .env
# 逐项填入 openssl rand 生成的值；GATEWAY_URL 必须是桌面端可达的地址且以 /v1 结尾
```

`SUB2API_ADMIN_KEY` 与 `ESCROW_USER_ID` 在初始化阶段产出后回填。

### 0.4 分阶段启动

companion 启动时强校验 `SUB2API_ADMIN_KEY`，因此先起网关侧，拿到 Admin Key 后再起业务侧：

```bash
docker compose up -d --build postgres-sub2api postgres-companion redis sub2api
docker compose ps        # 等 sub2api 健康
```

### 0.5 初始化 Sub2API

```bash
SUB2API_BASE_URL=http://127.0.0.1:18080 \
ADMIN_EMAIL=... ADMIN_PASSWORD=... DEEPSEEK_API_KEY=... \
node /opt/wb/repo/tools/prod/bootstrap-sub2api-prod.mjs --out /opt/wb/.sub2api-bootstrap.json
```

脚本幂等，完成：合规确认 → 生成全局 Admin Key → 分组 `workbuddy-standard`（`rate_multiplier=1.0`）
→ 上游账号（`model_mapping` 恒等映射即模型白名单）→ 渠道定价（两个模型 id 都要列入）
→ 支付并发配置（`max_pending_orders=500`、`daily_limit=0`）。
把输出的 Admin Key 写进 `.env` 的 `SUB2API_ADMIN_KEY`，然后起 companion 与反代：

```bash
docker compose up -d --build companion caddy
```

### 0.6 初始化 companion

```bash
cd /opt/wb/repo/deploy
dc() { docker compose exec -T companion node dist/cli/index.js "$@"; }   # 生产镜像无 tsx，直接跑编译产物
dc doctor
dc escrow:init                      # 输出 ESCROW_USER_ID → 写回 .env → docker compose up -d companion
dc catalog:import --file /app/catalog.json
dc packages:add --name "标准套餐" --price 100 --group <分组 id>
dc codes:generate --points 100 --count 3 --package <套餐 id> --label "首批"
```

`deploy/catalog.prod.json` 已按 compose 挂载到容器内 `/app/catalog.json`；新增模型时同步修改该文件、
Sub2API 账号 `model_mapping`、渠道 `model_pricing.models` 三处（见 [运维手册](operations.md)）。

### 0.7 端到端验收

```bash
WB_COMPANION=http://<服务器地址>:8720 WB_SUB2API=http://<服务器地址>:18080 \
WB_REDEEM_CODE=<兑换码> node /opt/wb/repo/tools/prod/verify-prod.mjs
```

覆盖：健康检查 → 设备注册 → 兑换激活 → 目录/网关模型数一致 → 真实上游对话 → 扣费与用量统计逐笔核对。

### 0.8 端口与访问

| 端口 | 用途 |
| --- | --- |
| `18080` | Sub2API：网页管理台 `/`、面板 API `/api/v1`、推理网关 `/v1` |
| `8720` | companion：`/healthz` 与 `/api/client/*` |
| `80`/`443` | Caddy 反代；配好 `SUB2API_DOMAIN`/`COMPANION_DOMAIN` 后按域名分流，接 TLS 时删除 Caddyfile 的 `auto_https off` |

支付回调要求公网可达（Sub2API 的 `/api/v1/payment/webhook/*`），仅局域网部署时购买功能不可用，
需在上线支付前完成域名解析、TLS 与回调地址配置。

## 1. 构建 Sub2API 私有分支镜像

```bash
cd sub2api                  # workbuddy-patch 分支
docker build -t sub2api:wb-v0.1.175 -f Dockerfile .
```

生产镜像**自带网页管理台**：上游 `Dockerfile` 本身就是多阶段构建——stage 1 用 pnpm 构建前端（Vite 产物直接输出到 `backend/internal/web/dist`），stage 2 以 `go build -tags embed` 把 dist 嵌入二进制。因此 `docker build` 出的镜像访问根路径 `/` 即管理台，无需额外步骤。只有绕过 Dockerfile 手工 `go build`（不加 `-tags embed`）时才会得到无前端的纯 API 二进制（本地自测曾如此，见 [local-dev.md](local-dev.md) 的「构建带管理台的 Sub2API」）。

新增环境变量：

| 变量 | 说明 |
| --- | --- |
| `WB_SERVICE_API_KEY` | 服务间支付接口密钥；未设置时补丁路由不注册，行为与官方版一致 |

其余配置与官方版相同（数据库、Redis、`PAYMENT_RESUME_SIGNING_KEY`、支付 provider 等）。

## 2. 部署 companion

```bash
cd companion
docker build -t wb-companion:0.1.0 .
```

环境变量（全部经 Docker secret / 受控环境注入，禁止写入镜像）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | ✔ | companion 专用 PostgreSQL 连接串 |
| `SUB2API_BASE_URL` | ✔ | 如 `https://api.ziyouxie.online` |
| `GATEWAY_URL` | ✔ | 写入 models.json 的网关地址，必须以 `/v1` 结尾 |
| `SUB2API_ADMIN_KEY` | ✔ | Sub2API 全局 Admin Key |
| `WB_SERVICE_API_KEY` | ✔ | 与 Sub2API 侧相同的服务间密钥 |
| `DEVICE_HMAC_SECRET` | ✔ | ≥32 字符随机串；变更会导致所有设备无法恢复 |
| `ENVELOPE_MASTER_KEY_HEX` | ✔ | 64 位 hex（32 字节）；信封加密主密钥 |
| `ESCROW_USER_ID` | 购买功能必填 | 由 `escrow:init` 输出 |
| `HIDDEN_USER_EMAIL_DOMAIN` | 可选 | 默认 `wb-device.internal` |
| `RATE_LIMIT_PER_MINUTE` | 可选 | 默认 10 |

启动后自动执行数据库迁移。

## 3. 初始化流程（一次性）

```bash
# 进入 companion 容器或本机 dev 环境
npm run cli -- doctor                 # 连通性与分组检查
npm run cli -- escrow:init            # 创建支付托管用户 → 回填 ESCROW_USER_ID 后重启
npm run cli -- catalog:import --file catalog.json   # 导入首批 6 个模型能力条目
npm run cli -- packages:add --name "标准套餐" --price 99 --points 100 --group 2
npm run cli -- codes:generate --points 100 --count 20 --package 1 --label "首批发放"
```

`catalog.json` 模板（与本机已验证的 6 条目一致，注意不含 apiKey/url）：

```json
[
  {
    "id": "gpt-5.6",
    "name": "GPT-5.6",
    "vendor": "Custom",
    "maxInputTokens": 262144,
    "supportsToolCall": true,
    "supportsImages": false,
    "supportsReasoning": true,
    "useCustomProtocol": false,
    "reasoning": { "defaultEffort": "medium", "supportedEfforts": ["low", "medium", "high", "xhigh"] }
  }
]
```

## 4. Sub2API 侧必要配置

- 支付：按官方文档配置支付宝/微信 provider；桌面端只使用二维码（qr_code）。
- **重要**：所有购买订单都挂在同一个 escrow 用户下，请调大支付配置中的
  `MaxPendingOrders`（如 200）并将 `DailyLimit` 设为 0（不限制）或足够大，
  否则并发购买会被误限流。
- 建议为设备隐藏用户关闭邮件通知（escrow/隐藏用户邮箱均为内部占位域名）。

## 5. 上游升级流程

1. `git fetch upstream && git log v0.1.175..<new-tag> -- backend/internal/server/routes backend/internal/service`
2. rebase `workbuddy-patch`（补丁触点清单见 [payment-fork-design.md](payment-fork-design.md)）
3. `go build ./... && go vet -tags unit ./internal/service/ && go test -tags unit -run TestWB ./internal/service/`
4. 更新 [sub2api-contract-v0.1.175.md](sub2api-contract-v0.1.175.md) 的版本基线后部署。

## 6. 桌面端发布（Windows 内测）

```powershell
cd desktop
$env:WB_COMPANION_URL_PROD = "http://<服务器地址>:8720"   # 构建期注入，无需改源码
npm run pack:win
Get-FileHash release\*.exe -Algorithm SHA256   # 连同哈希一起内部分发
```

未签名安装包首次运行会触发 SmartScreen 提示，内测阶段选择“仍要运行”；
正式推广前接入代码签名。macOS 构建保留架构支持，但必须先实机验证
`~/.workbuddy/models.json` 路径与热加载行为后才能发布。
