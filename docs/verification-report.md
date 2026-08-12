# 验证报告

最近更新：2026-08-13（Windows 开发机，无人值守自主验证）

## 1. 自动化单元测试

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| Sub2API 基线编译 | `go build ./...`（go1.26.5） | 通过 |
| 补丁静态检查 | `go vet -tags unit ./internal/service/` | 通过 |
| 补丁单元测试 | `go test -tags unit -run TestWB ./internal/service/` | 7/7 通过 |
| companion 类型检查 | `tsc --noEmit` | 通过 |
| companion 单元测试 | `vitest run`（crypto/HMAC/信封加密、设备行 BIGINT 归一化） | 7/7 通过 |
| 桌面端类型检查 | `tsc`（node + web） | 通过 |
| 桌面端单元测试 | `vitest run`（schema 校验、外部修改检测、备份轮转、恢复往返、缺失备份处理） | 9/9 通过 |
| 桌面端生产构建 | `electron-vite build` | 通过 |
| Windows 安装包 | `electron-builder --win --x64`（未签名 NSIS） | 通过 |

安装包：`desktop/release/WorkBuddy 模型配置助手 Setup 0.1.0.exe`（约 87.9 MB）。

## 2. 真机端到端（本机实测，非模拟）

用真实的 Sub2API（workbuddy-patch）+ 便携 PostgreSQL 17 + miniredis + 签名 EasyPay 回调 + 假 OpenAI 上游，完整跑通产品链路。

### 主流程 `drive-companion.mjs`：passed=32 failed=0

覆盖：设备注册/恢复、公司码兑换（+分组切换、幂等）、网关 `/v1/models` 真实返回 6 个模型、目录∩网关交集、`models.json` 生成、连通测试 `/v1/chat/completions`、购买下单、**签名支付回调**、`PAID_PENDING_REDEEM` 延迟入账（确认前不入账）、确认恰好入账、确认幂等、积分统计。

### 边界 `drive-edges.mjs`：passed=8 failed=0

覆盖：无效码拒绝、重复回调仅入账一次、重复确认不翻倍、未支付确认拒绝、跨设备订单查询拒绝。

### 网关 `verify-gateway.mjs`：passed=3 failed=0

`/v1/models` 返回全部 6 个模型；`/v1/chat/completions` 返回内容。

生成的样例配置：`.local/generated-models.json`（6 条，字段含 id/url(/v1)/apiKey，schema 合法）。

## 3. 自测中发现并修复的缺陷

见 [变更记录](../CHANGELOG.md)。要点：

1. **BIGINT 作为字符串**：pg 把 BIGINT 外键（分组 id、user_id）读成字符串，导致分组比较失败、`fulfill` 时 `user_id` 类型不符（Sub2API 期望 int64）。已在 CLI、domain 层、服务间客户端统一转数字，并新增 `normalizeDeviceRow` 单测锁定。
2. **购买入账语义**：购买订单原以 CNY 价格作为 Sub2API 订单 amount，而 Sub2API 入账额度=amount，导致买「100 积分」只到账 99。已改为下单 amount=套餐积分数，并在 CLI 强制 `points==price_cny`（1 积分=1 元）。

## 3b. 持续集成 / 发布（GitHub Actions，仓库 agentkernel/llm-api）

- CI（`.github/workflows/ci.yml`）在 push/PR 触发，三 job 全绿：
  - companion：`npm ci` + typecheck + vitest + build（ubuntu）
  - desktop：typecheck + vitest + electron-vite build（ubuntu）
  - sub2api-patch：克隆官方 v0.1.175 → `git apply` 本仓库补丁 → `go build` + `go vet` + `TestWB` 测试（ubuntu）。**独立证明补丁在全新 Linux 环境可干净应用并通过。**
- 发布（`.github/workflows/release.yml`）：打 `v*` 标签在 windows-latest 打包未签名 NSIS 安装包、计算 SHA-256、挂到 GitHub Release。
- 已验证：`v0.1.0` Release 自动产出 `WorkBuddy.Setup.0.1.0.exe` 与 `SHA256SUMS.txt`。
- 生产地址由构建期 `WB_COMPANION_URL_PROD`（仓库变量或发布输入）注入，发布无需改源码。

## 4. 发布前待办（生产环境相关，本机无法覆盖）

1. 用真实微信/支付宝（或 EasyPay）商户跑一遍真实支付回调（本机用签名假回调验证了状态机与入账逻辑）。
2. WorkBuddy 实机验收：6 个基线模型 id 原样透传、热加载、首条 `ECONNRESET` 提示、可选连通测试。
3. 把 `desktop/src/main/companionClient.ts` 的 `PRODUCTION_COMPANION_URL` 换成真实业务服务地址后再打包。
4. 员工机安全抽查：renderer/日志/剪贴板/崩溃报告无 key；备份恢复流程。
5. macOS：实机验证 `~/.workbuddy/models.json` 路径与热加载后再发布。

## 5. 已知限制（首版接受）

- 计费为 1 积分=1 元（fee=0）；折扣需借助 Sub2API `balance_recharge_multiplier` 扩展。
- 购买依赖 escrow 用户共享 `MaxPendingOrders`/`DailyLimit`，需调大（见运维手册）。
- `codes:void` 只作废本地映射，Sub2API 侧需管理台同步。
- 上游 `TestContentModerationRuntimeSnapshotRefreshFailureKeepsStaleConfig` 顺序执行不稳定，与本项目无关（无补丁基线同样失败）。
