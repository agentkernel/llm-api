# Sub2API 契约基线（v0.1.175）

本文档固定 WorkBuddy 模型配置助手所依赖的 Sub2API 版本与接口契约。所有服务端对接代码以本文档为准；升级上游前必须先跑契约回归测试并更新本文档。

## 版本基线

- 仓库：`https://github.com/Wei-Shaw/sub2api`
- 固定标签：`v0.1.175`（tag 对象 `b898c60c`，对应 commit `93c32fa1a2450351561abc46156d2e28cb5f74ca`）
- 本地源码：`sub2api/`（私有补丁在其分支 `workbuddy-patch` 上，见 `docs/payment-fork-design.md`）
- Go 工具链：`go 1.26.5`（与 `backend/go.mod` 一致）

## 通用约定

- 面板 API 前缀 `/api/v1`；成功响应包装 `{ code: 0, message: "success", data: ... }`
- 分页数据：`data.items / total / page / page_size / pages`
- 网关接口（`/v1/models`、`/v1/usage`）不使用面板包装，直接返回 OpenAI 风格 JSON
- 认证方式：
  - 用户 API：`Authorization: Bearer <用户 JWT>`
  - Admin API：`x-api-key: <全局 Admin Key>`（仅业务服务持有）
  - 推理网关：用户 API Key（`Authorization: Bearer` 或 `x-api-key`）
  - 支付回调：无应用认证，靠支付宝 RSA / 微信 APIv3 验签

## 业务服务依赖的官方接口

### 用户与认证（仅业务服务调用）

| 接口 | 用途 | 关键字段 |
| --- | --- | --- |
| `POST /api/v1/admin/users` | 创建设备隐藏用户 | 请求 `email, password`（随机内部值）；响应 `id, balance, status` |
| `GET /api/v1/admin/users/:id` | 查询用户与余额 | `balance, frozen_balance, total_recharged` |
| `POST /api/v1/auth/login` | 取得隐藏用户 JWT | `access_token, refresh_token, expires_in` |
| `POST /api/v1/auth/refresh` | 刷新 JWT | 同上 |

### API Key（实际路径是 `/keys`，非注释中的 `/api-keys`）

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/keys` | 列出设备用户的 Key（响应含完整 `key` 值） |
| `POST /api/v1/keys` | 创建唯一设备 Key（`name` 必填，可选 `group_id`） |
| `PUT /api/v1/keys/:id` | 切换 `group_id` / 停用（`status`）；不能替换密钥值 |
| `DELETE /api/v1/keys/:id` | 删除旧 Key |

注意：无 Admin 创建用户 Key 的接口；无原子轮换。轮换 = 新建 + 停用旧。

### 兑换码

| 接口 | 用途 |
| --- | --- |
| `POST /api/v1/redeem`（用户 JWT） | 消费公司码 / 履约用兑换码，成功直接入账 |
| `GET /api/v1/redeem/history`（用户 JWT） | 最近 25 条，不分页 |
| `POST /api/v1/admin/redeem-codes/generate` | CLI 生成公司码（`count` 1–100，`type=balance`，`value`） |
| `POST /api/v1/admin/redeem-codes/create-and-redeem` | 异常修复用（`code, value, user_id` + `Idempotency-Key`） |

约束：
- 兑换码长度真实上限 32 字符（DB schema 限制；handler 虽收 128 但会被 DB 拒绝）
- 无"只校验不消费"的 dry-run 接口 → 公司码校验由业务服务自己的 `code_mappings` 表完成
- create-and-redeem 非单事务原子：先建码后兑换，崩溃窗口可重试收敛；必须带 `Idempotency-Key`

### 积分与统计（隐藏用户 JWT）

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/user/profile` | 当前积分（`balance`）、累计充值（`total_recharged`） |
| `GET /api/v1/usage/stats` | 时段聚合（`total_requests, total_cost, total_actual_cost` 等） |
| `GET /api/v1/usage/dashboard/trend` | 按日趋势（`granularity=day`，支持时区与日期过滤） |
| `GET /api/v1/usage/dashboard/models` | 按模型聚合（`requests, tokens, cost, actual_cost`） |

口径：1 balance = 1 积分。不展示"总额 = 已用 + 剩余"固定等式（退款/返利/冻结会破坏等式）。

### 网关（设备 API Key）

| 接口 | 用途 |
| --- | --- |
| `GET /v1/models` | 拉取该 Key 可用模型（按分组动态生成，非全局目录） |
| `POST /v1/chat/completions` | 仅员工主动连通测试时调用 |

### 分组

| 接口 | 用途 |
| --- | --- |
| `GET /api/v1/admin/groups` | CLI 启动校验套餐映射的目标分组存在且 `status=active` |

## 明确禁止依赖的接口

- `GET /api/v1/admin/users/:id/usage` — 当前为硬编码零值 mock
- `GET /api/v1/admin/redeem-codes/stats` — 同为 mock
- `GET /api/v1/model-plaza` — 2026-07 新增，口径未稳定
- 源码注释中的 `/api/v1/api-keys`、`/users/me` 路径 — 已过期，真实路径为 `/keys`、`/user/profile`

## 支付内部机制（补丁依据，源码已核对）

余额订单履约链（`backend/internal/service/payment_fulfillment.go`）：

```
webhook → HandlePaymentNotification → confirmPayment（验 provider/金额）
  → toPaid（CAS: PENDING/CANCELLED/宽限期 EXPIRED → PAID）
  → executeFulfillment → ExecuteBalanceFulfillment
  → acquirePaymentFulfillmentLease（CAS: PAID/FAILED → RECHARGING，5 分钟租约）
  → doBalance：
      1. 按 order.RechargeCode 建兑换码（幂等，格式 PAY-<orderID>-<5位随机>，≤32 字符）
      2. redeemService.Redeem(userID, code) 立即兑换
  → markCompleted（CAS: RECHARGING → COMPLETED）
```

关键事实：

- **余额履约本身就是"建码 + 兑码"两步**，这使"支付后暂缓兑换"可以自然插入：建码后不兑换、停在新状态，确认时再对目标用户兑码。
- 订单状态常量集中在 `backend/internal/payment/types.go`（PENDING/PAID/RECHARGING/COMPLETED/EXPIRED/CANCELLED/FAILED + 退款族）。
- `provider_snapshot`（jsonb）在下单时写入，可携带业务扩展元数据而无需改 ent schema。
- 订单过期轮询（`payment_order_expiry_service.go`，60s）只处理 `PENDING`，不会误伤已支付订单。
- `alreadyProcessed` 对 PAID/RECHARGING/FAILED 会重入履约 —— 补丁必须让新状态在此处安全返回。

## 上游升级流程

1. 在 `sub2api/` fork 中 `git fetch upstream` 并检查 `v0.1.175...<新版本>` 中 `backend/internal/server/routes/`、`handler/`、`service/payment*` 的 diff。
2. rebase `workbuddy-patch` 分支，解决冲突。
3. 运行补丁自带的 Go 测试 + companion 服务的契约回归测试。
4. 更新本文档版本基线后才允许部署。
