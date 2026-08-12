# Sub2API 最小支付补丁设计（workbuddy-patch 分支）

目标：在不破坏官方升级路径的前提下，为"支付成功后暂缓入账、员工确认兑换才入账"提供服务间能力。补丁只新增文件与少量插入点，不重写官方逻辑。

## 状态机

复用官方状态并新增一个：

```
PENDING ──webhook──> PAID ──executeFulfillment(deferred)──> PAID_PENDING_REDEEM
                                                              │  服务间 fulfill(user_id)
                                                              ▼
                                              RECHARGING ──> COMPLETED
PENDING ──超时轮询──> EXPIRED（官方原样，只处理 PENDING）
PENDING ──用户/管理员──> CANCELLED（官方原样）
履约失败 ──> FAILED（官方原样，可重试）
```

- 新常量：`OrderStatusPaidPendingRedeem = "PAID_PENDING_REDEEM"`（`internal/payment/types.go` + service 层别名）。
- 与设计文档状态对照：`pending_payment=PENDING`、`paid_pending_redeem=PAID_PENDING_REDEEM`、`redeeming=RECHARGING`、`redeemed=COMPLETED`。

## 延迟履约标记

- 不改 ent schema。下单时在 `provider_snapshot` 写入：
  - `wb_deferred: true` — 延迟履约标记
  - `wb_device: "<设备绑定摘要，HMAC 十六进制>"` — 绑定购买设备
- `executeFulfillment` 入口检查：`order_type=balance` 且 snapshot 含 `wb_deferred=true` 时走延迟路径：
  1. 取履约租约（复用 `acquirePaymentFulfillmentLease`）
  2. 幂等确保兑换码已创建（复用 `doBalance` 的 create 分支，不调用 `Redeem`）
  3. CAS `RECHARGING → PAID_PENDING_REDEEM`，写审计 `WB_HELD_PENDING_REDEEM`
- `alreadyProcessed` 对 `PAID_PENDING_REDEEM` 直接返回 nil（webhook 重复通知安全）。

## 服务间接口（新文件，独立认证）

路由组 `/api/v1/service/payment`，认证中间件校验 `x-service-key`（配置 `WB_SERVICE_API_KEY`，仅 companion 持有；未配置时路由组整体不注册）。

### POST /api/v1/service/payment/orders

创建延迟履约余额订单。

请求：

```json
{
  "amount": 100.0,
  "payment_type": "alipay | wxpay",
  "user_id": 123,
  "device_binding": "hmac-hex",
  "client_ip": "1.2.3.4"
}
```

- `user_id`：托管订单归属的 Sub2API 用户。购买时设备可能尚未激活，companion 传入专用 escrow 用户 id；订单余额永远不会入账到该用户（履约被延迟拦截）。
- 内部复用官方 `PaymentService.CreateOrder`，随后在 snapshot 补写 `wb_deferred/wb_device`。

响应：官方 `CreateOrderResponse` 透传（`order_id, out_trade_no, qr_code, pay_url, expires_at, ...`）。桌面端只用 `qr_code`（微信/支付宝均页内二维码）。

### GET /api/v1/service/payment/orders/:out_trade_no

最小状态查询（轮询用）：

```json
{
  "out_trade_no": "...",
  "status": "PENDING | PAID | PAID_PENDING_REDEEM | RECHARGING | COMPLETED | EXPIRED | CANCELLED | FAILED",
  "amount": 100.0,
  "device_binding": "hmac-hex",
  "paid_at": "...",
  "completed_at": "..."
}
```

### POST /api/v1/service/payment/orders/:out_trade_no/fulfill

确认兑换，把订单积分入账给目标用户。

请求头：`Idempotency-Key: <订单号>`（强制）
请求体：

```json
{ "user_id": 456, "device_binding": "hmac-hex" }
```

行为：

1. 校验 `device_binding` 与订单 snapshot 一致，不一致返回 409（拒绝跨设备领取）。
2. 仅接受 `PAID_PENDING_REDEEM / FAILED`（重试）状态；`COMPLETED` 时若历史兑换目标一致返回 200（幂等），否则 409。
3. CAS 进入 `RECHARGING`，调用 `redeemService.Redeem(user_id, order.RechargeCode)`，成功后 `markCompleted`。
4. 全程写官方审计日志（`WB_FULFILL_REQUESTED / RECHARGE_SUCCESS / FULFILLMENT_FAILED`）。

注意：`Redeem` 将码兑给 `user_id`，与订单 `user_id`（escrow）不同是预期行为；兑换记录的 `used_by` 即真实设备用户，可审计。

## 触点清单（相对 backend/）

| 文件 | 改动 |
| --- | --- |
| `internal/payment/types.go` | +1 常量 `OrderStatusPaidPendingRedeem` |
| `internal/service/payment_service.go` | +1 别名常量 |
| `internal/service/payment_fulfillment.go` | `executeFulfillment` 前置延迟分支（约 10 行插入）+ `alreadyProcessed` 增加 case |
| `internal/service/payment_wb_deferred.go`（新增） | 延迟履约 + fulfill 核心逻辑 |
| `internal/handler/wb_service_payment_handler.go`（新增） | 服务间 handler |
| `internal/server/middleware/wb_service_auth.go`（新增） | `x-service-key` 认证 |
| `internal/server/routes/wb_service.go`（新增） | 路由注册 |
| 路由装配处 | +1 行调用 `RegisterWBServiceRoutes` |
| `internal/service/payment_wb_deferred_test.go`（新增） | 状态机与幂等测试 |

## 测试基线备注

- `go test -tags unit -run TestWB ./internal/service/` 7 项全部通过；`go vet -tags unit` 通过。
- 上游 `TestContentModerationRuntimeSnapshotRefreshFailureKeepsStaleConfig` 在同进程连跑/重复执行（`-count>1` 或整包顺序执行）时不稳定，已验证在**无补丁基线上同样失败**，与本补丁无关；升级回归时按单测精确匹配运行或忽略该用例。

## 明确不做

- 不改动订阅、退款、EasyPay/Stripe 路径；`PAID_PENDING_REDEEM` 订单的退款首版由管理员在 Sub2API 后台按 FAILED/人工流程处理。
- 不改 ent schema、不新增数据库迁移。
- 不把 Admin Key 或 service key 暴露给桌面端。
