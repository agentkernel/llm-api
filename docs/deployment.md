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

## 1. 构建 Sub2API 私有分支镜像

```bash
cd sub2api                  # workbuddy-patch 分支
docker build -t sub2api:wb-v0.1.175 -f Dockerfile .
```

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
# 修改 src/main/companionClient.ts 中 PRODUCTION_COMPANION_URL 为真实地址
npm run pack:win
Get-FileHash release\*.exe -Algorithm SHA256   # 连同哈希一起内部分发
```

未签名安装包首次运行会触发 SmartScreen 提示，内测阶段选择“仍要运行”；
正式推广前接入代码签名。macOS 构建保留架构支持，但必须先实机验证
`~/.workbuddy/models.json` 路径与热加载行为后才能发布。
