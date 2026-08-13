# 运维手册

面向管理员的日常运营任务。所有命令在部署了 companion 的服务器上执行（容器内或已配置环境变量的主机）。CLI 用法：`npm run cli -- <命令>`。

## 环境自检

```bash
npm run cli -- doctor
```
检查配置、Sub2API 连通性、Admin Key 有效性、分组列表、ESCROW_USER_ID、数据库迁移状态。

## 模型目录管理

模型能力目录是「网关返回模型 ∩ 目录」的权威来源，未在目录中的模型对员工隐藏。

```bash
npm run cli -- catalog:import --file catalog.json   # 新增/更新（同 id 覆盖，catalog_version 自增）
npm run cli -- catalog:list
```

`catalog.json` 每项字段与 WorkBuddy `models.json` 对齐，但**不含 apiKey/url**（由客户端注入）。effort 合法值 `minimal/low/medium/high/xhigh/max`，summary `auto/always/never`，非法值会被拒绝。

上线新模型流程：

1. 在 Sub2API 给目标上游账号的 `model_mapping` 加该模型 id（使 `/v1/models` 返回）。
2. 若分组配了渠道（channel）自定义定价：同步把新模型 id 加进该渠道 `model_pricing.models`，否则该模型计费回退全局价格表，会出现同一上游模型因别名不同而计价不一致。
3. `catalog:import` 补该模型能力；三者齐备后员工端才可勾选、计费口径才正确。

**多上游账号的模型隔离（重要）**：`model_mapping` 非空时即该账号的模型白名单（`Account.IsModelSupported`，粘性会话/负载均衡/failover 全部调度路径生效）；映射留空的 openai 平台 API Key 账号会"允许所有模型"。因此同一分组挂多个上游账号（如 GPT 与 DeepSeek 各一）时，各账号的 `model_mapping` 键集必须**全部非空且互斥**，这是该版本 openai 平台唯一的模型级路由隔离手段（分组级 `model_routing` 仅接入 anthropic 平台，对 openai 分组无效）。排查误路由时以 `usage_logs.account_id`、`upstream_response_model` 与假上游请求日志为准。

## 套餐管理

```bash
npm run cli -- packages:add --name "标准套餐" --price 100 --group 2 [--desc 描述] [--sort 0]
npm run cli -- packages:list
npm run cli -- packages:set-enabled --id 1 --enabled false
```

计费约束：当前模型 **1 积分 = 1 元**，`points` 省略时默认等于 `price`，若显式指定必须与 `price` 相等（CLI 强制）。目标分组必须在 Sub2API 中存在且 active。

## 兑换码发放

```bash
npm run cli -- codes:generate --points 100 --count 20 --package 1 --label "2026Q1首批" [--expires-days 90]
npm run cli -- codes:void --code <32位hex码>
```

- 兑换码即 Sub2API 生成的 32 位十六进制码；业务库只存 HMAC + 套餐/分组映射。
- **码仅在生成时输出一次**，请立即安全分发，不要记录到普通日志。
- `codes:void` 只作废本地映射；如需同步作废 Sub2API 侧，还需在 Sub2API 管理台操作。

## 设备与售后

```bash
npm run cli -- devices:list [--limit 50]
npm run cli -- devices:find --uuid <device_uuid>       # 不输出任何密文字段
npm run cli -- devices:disable --uuid <device_uuid>    # 停用并吊销全部令牌
npm run cli -- devices:migrate --from <device_uuid> --machine-id <新机器原始机器码>
npm run cli -- orders:repair --out-trade-no <编号>      # 已支付未兑换订单重试履约
```

换机流程：`devices:migrate` 把原设备重绑到新机器码并吊销旧令牌；员工在新机打开应用即自动恢复并重签令牌，无需重新购买。

订单卡在 `paid_pending_redeem`（员工迟迟未确认或确认时报错）：先让员工在应用内点「确认兑换」；仍失败用 `orders:repair` 幂等重试。

## Sub2API 侧必须配置

- 支付：按官方文档配置支付宝/微信（或复用 EasyPay 聚合）provider；桌面端只用二维码（`qr_code`），已在支付配置里将 `payment_visible_method_*_source` 指向对应 provider。
- **托管订单并发**：所有购买订单挂在同一 escrow 用户名下，务必调大 `max_pending_orders`（如 500）、`daily_limit=0`（不限），否则并发购买会被误限流。
- `WB_SERVICE_API_KEY` 必须与 companion 一致；未配置时补丁的服务间路由不注册，购买功能不可用。

## 监控与巡检建议

- Sub2API `/api/v1/admin/payment/dashboard` 看支付概况；`payment_audit_logs` 表含 `WB_HELD_PENDING_REDEEM`/`WB_FULFILLED` 审计。
- companion `audit_events` 表记录设备注册/恢复、兑换、购买入账、迁移、CLI 操作。
- 关注长期停留在 `paid_pending_redeem` 的订单（员工已付款未确认），必要时提醒或 `orders:repair`。

## 备份

- companion 数据库：常规 PostgreSQL 备份（`pg_dump`）。关键表 `devices`（含信封密文）、`code_mappings`、`purchase_links`。
- `DEVICE_HMAC_SECRET` 与 `ENVELOPE_MASTER_KEY_HEX` 一旦丢失或变更，将无法解密设备凭据、无法凭机器码找回设备，务必随库一起纳入密钥管理与备份。
