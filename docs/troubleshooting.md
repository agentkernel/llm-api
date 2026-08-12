# 排障手册

## 员工端

### 配置模型后 WorkBuddy 首条消息报 `ACP transport ECONNRESET`
预期行为。WorkBuddy 热加载 `models.json` 时会回收内部 CLI 进程，替换配置后第一条消息可能报一次，重发即可。应用成功页与弹窗均已提示。

### 「请先刷新模型列表」/ 模型列表为空
- 该设备积分为 0：网关 `/v1/models` 在余额为 0 时返回 `INSUFFICIENT_BALANCE`。先兑换/购买积分。
- 目录未适配：网关返回的模型不在服务端目录中会被隐藏。管理员 `catalog:import` 补齐。

### 无法连接服务
- 检查 companion 是否可达（生产地址固定在 `desktop/src/main/companionClient.ts`）。
- 设备令牌失效（被吊销/迁移）：应用会自动重新注册；若设备被 `devices:disable`，会返回 403。

### 应用不显示 apiKey
设计如此。桌面端永不展示/复制 apiKey；`models.json` 内因 WorkBuddy 协议必须含明文 key，本机同一用户可手工打开该文件，这一边界已接受。

## 购买/支付

### 订单卡在 `paid_pending_redeem`
员工已付款但未点「确认兑换」，或确认时上游短暂失败。让员工在应用内点「确认兑换」；仍失败用 `npm run cli -- orders:repair --out-trade-no <编号>` 幂等重试。

### 购买后到账积分与承诺不符
确认 Sub2API 支付配置 `recharge_fee_rate=0`、`balance_recharge_multiplier=1`，且套餐 `points==price_cny`（CLI 已强制）。补丁下单的 `amount` 取套餐积分数，Sub2API 据此入账。

### 并发购买报 `TOO_MANY_PENDING`
所有购买挂在同一 escrow 用户名下。调大 Sub2API 支付配置 `max_pending_orders`、把 `daily_limit` 设为 0。

### 回调不生效
- EasyPay 用 GET query + MD5 验签（`sign=md5(sorted k=v& + pkey)`，排除 `sign/sign_type/空值`）。
- 回调 `pid` 必须与 provider 配置一致（补丁会核对 snapshot 的 `merchant_id`）。
- 官方支付宝/微信回调靠 RSA/APIv3 验签，配置见 Sub2API 文档。

## 服务端启动

### Sub2API 启动进入 setup 向导而非直接运行
`AUTO_SETUP=true` 且提供 DATABASE_*/REDIS_*/ADMIN_*/JWT_SECRET 环境变量即可自动初始化；否则会起 setup 向导。已 `.installed` 的数据目录不会重复初始化。

### Admin API 返回 `ADMIN_COMPLIANCE_ACK_REQUIRED`（HTTP 423）
首次使用 Admin 能力前需确认合规：`POST /api/v1/admin/compliance/accept`，body `{language:"zh", phrase:"我已阅读、理解并同意 Sub2API 部署与运营合规承诺"}`（用管理员 JWT）。`bootstrap-sub2api.mjs` 已自动处理。

### companion 启动报配置校验失败
逐项检查 [部署说明](deployment.md) 的必填环境变量。`GATEWAY_URL` 必须以 `/v1` 结尾；`ENVELOPE_MASTER_KEY_HEX` 必须是 64 位 hex；`DEVICE_HMAC_SECRET` ≥32 字符。

## 本地自测（Windows 便携环境）

### `could not load pg_hba.conf` / `无效连接类型"\ufeff"`
`pg_hba.conf` 被写入了 UTF-8 BOM。用无 BOM 的 UTF-8 重写（PowerShell：`[System.IO.File]::WriteAllText(path, content, (New-Object System.Text.UTF8Encoding($false)))`）。

### `Unexpected token '\ufeff'` 解析 e2e-state.json
PowerShell `Set-Content` 写入了 BOM。`lib.mjs` 读取时已 `replace(/^\uFEFF/, "")`。

### Go 编译 `The paging file is too small`
便携 Go + 大项目并行编译内存不足。降低并发：`go build -p 2` 或设 `GOMAXPROCS=1 GOGC=40`。

### `pg_ctl start` 命令挂起不返回
`pg_ctl -w` 会占住管道等待子进程；用 `pg_isready` 在另一会话确认服务其实已起，或后台化启动。

## 已知的 Sub2API 上游注意点

- 单元测试 `TestContentModerationRuntimeSnapshotRefreshFailureKeepsStaleConfig` 在整包顺序执行/`-count>1` 时不稳定，**无补丁基线同样失败**，与本项目无关；回归时按精确用例名单独运行。
- 处于 `0.1.x` 高频发布期，升级前务必按 [契约基线](sub2api-contract-v0.1.175.md) 的流程校验路由/字段。
