# 变更记录

## v0.1.0（2026-08）

首个内部可用版本。桌面端（Windows）+ companion 业务服务 + Sub2API 私有支付补丁。

### 功能

- 设备即账户：机器码 HMAC 身份、隐藏 Sub2API 用户与唯一 apiKey、应用重装恢复、管理员换机迁移。
- 公司兑换码激活与积分入账，套餐驱动模型分组切换。
- 应用内购买：原生套餐、微信/支付宝二维码、严格延迟入账（支付成功→待兑换→确认才入账）。
- 模型配置：网关 `/v1/models` ∩ 服务端目录，全量替换 `models.json`，写前加密备份（保留 5 份）+ 原子替换 + 外部修改检测 + 一键恢复。
- 积分总览与按日/按模型统计。
- 管理 CLI：doctor、escrow:init、catalog、packages、codes、devices（list/find/disable/migrate）、orders:repair。
- Sub2API `workbuddy-patch`：新增 `PAID_PENDING_REDEEM` 状态与服务间下单/查询/履约接口（`x-service-key`，未配置则不注册）。

### 无人值守自主验证中发现并修复的缺陷

- **BIGINT-as-string**：`pg` 驱动把 BIGINT 列（分组 id、`sub2api_user_id`）读成字符串。
  - 症状 1：`codes:generate` 校验分组 `g.id === "2"` 恒为 false → 报「分组不存在」。
  - 症状 2：购买确认调用 Sub2API 补丁 `fulfill` 时 `user_id` 传成字符串 → `cannot unmarshal string into Go struct field ... user_id of type int64`。
  - 修复：CLI 与 domain 层分组比较统一 `Number()`；新增 `normalizeDeviceRow` 归一化设备行数值外键；服务间客户端对 `user_id` 强制 `Number()`。新增单元测试锁定。
- **购买入账语义错误**：购买订单曾以 CNY 价格作为 Sub2API 订单 `amount`，而 Sub2API 入账额度 = `amount`，导致「¥99 买 100 积分」只到账 99。
  - 修复：下单 `amount` 改为套餐积分数；CLI 强制 `points == price_cny`（1 积分 = 1 元，fee=0）。

### 本地自测基础设施（tools/）

- `miniredis-server`：进程内 Redis 兼容服务。
- `fake-openai`、`fake-easypay`：本地假上游，免付费凭证跑通网关与支付回调。
- `tools/e2e`：Sub2API 引导、网关验证、主流程（32 断言）、边界（8 断言）编排脚本。

### 已知限制

见 [验证报告](docs/verification-report.md) 第 5 节。
