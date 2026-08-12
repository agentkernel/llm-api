# companion API 参考

## 桌面端 ↔ companion（`x-device-token` 认证，`/api/client/*`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/client/devices/register` | 无需令牌。body `{machineId, appVersion?}`；返回 `{deviceUuid, deviceToken, activated, recovered}`。同机重复注册恢复设备并轮换令牌 |
| GET | `/api/client/state` | 设备状态 `{deviceUuid, activated, points, currentGroupId, currentPackageId, companionReachable...}` |
| GET | `/api/client/catalog` | `{gatewayUrl, models[]}` 服务端模型能力目录（无密钥） |
| GET | `/api/client/config-material` | `{gatewayUrl, apiKey}`，仅 Electron main 使用 |
| POST | `/api/client/redeem` | body `{code}`；返回 `{points, groupId, packageId}` |
| GET | `/api/client/packages` | 在售套餐列表 |
| POST | `/api/client/purchase/orders` | body `{packageId, paymentType: alipay|wxpay}`；返回 `{outTradeNo, qrCode, payUrl, amountCny, points, expiresAt}` |
| GET | `/api/client/purchase/orders` | 本设备订单列表 |
| GET | `/api/client/purchase/orders/:outTradeNo` | 单订单状态（仅本设备） |
| POST | `/api/client/purchase/orders/:outTradeNo/confirm` | 确认兑换（延迟入账），返回 `{points, groupId}` |
| GET | `/api/client/points/summary?days=7\|30\|90` | 积分总览 + 按日/按模型统计 |
| GET | `/healthz` | 健康检查 |

限速：注册按 IP、兑换/购买按设备，进程内滑动窗口（`RATE_LIMIT_PER_MINUTE`）。

## companion ↔ Sub2API（官方接口）

见 [契约基线](sub2api-contract-v0.1.175.md)。companion 使用：
- Admin（`x-api-key`）：建隐藏用户、生成兑换码、查分组、（异常修复）create-and-redeem、balance 调整。
- 用户（隐藏用户 JWT）：`/redeem`、`/keys` CRUD、`/user/profile`、`/usage/*`。
- 网关（设备 apiKey）：`/v1/models`、`/v1/chat/completions`（员工主动测试）。

## companion ↔ Sub2API 补丁（服务间，`x-service-key` 认证，`/api/v1/service/payment/*`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/orders` | body `{user_id(escrow), amount, payment_type, device_binding, client_ip}`；创建延迟履约余额订单，返回官方下单响应（qr_code 等） |
| GET | `/orders/:out_trade_no` | 最小状态 `{status, amount, device_binding, redeemed_to_user_id, ...}` |
| POST | `/orders/:out_trade_no/fulfill` | 需 `Idempotency-Key`；body `{user_id(设备用户), device_binding}`；把 hold 的兑换码兑给设备用户 |

状态机与实现见 [支付补丁设计](payment-fork-design.md)。未配置 `WB_SERVICE_API_KEY` 时该路由组整体不注册。

## 错误约定

companion 错误返回 `{code, message}`，HTTP 状态：400 参数、401 令牌、403 设备停用、404 不存在、409 冲突（含跨设备/已使用）、429 限速、502 上游错误（不透传上游细节）。
