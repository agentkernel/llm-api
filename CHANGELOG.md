# 变更记录

## 未发布

### 修复

- **高 DPI / 小分辨率下主窗口远大于屏幕且无法缩小**：主窗口写死 `1080x720`、最小 `920x600`（DIP)。屏幕逻辑工作区小于该值时（如 2880x1800 物理分辨率配 250%+ 缩放、或远程控制切换到低分辨率虚拟屏），窗口初始即超出屏幕，且最小尺寸限制导致手动也无法缩小回屏内。
  - 修复：新增 `windowBounds.computeWindowBounds`，app ready 后取 `screen.getPrimaryDisplay().workAreaSize`，初始宽高与最小宽高一律取「默认值与工作区的较小者」，并显式 `center: true` 居中；任何分辨率/缩放下窗口完整落屏。补 5 条单元测试（大屏不变、200% 小屏全夹取、单轴溢出、当前主屏 1440x860 情形、退化工作区兜底）。
- **本地 miniredis TTL 永不过期，登录限流累计后永久 429**：miniredis 的逻辑时钟不会自己走，`EXPIRE`/`SET EX` 设下的 TTL 从不衰减，Sub2API 登录限流计数器（`rate_limit:auth-login:<ip>`）只增不减，超过上限后本机所有登录被永久 429（fail-close）。仅影响本地自测环境，生产用真实 Redis 不受影响。
  - 修复：`tools/miniredis-server` 启动一个后台 goroutine，每秒按真实流逝时间 `FastForward` 推进逻辑时钟（该方法内部持 miniredis 全局锁，与命令处理互斥，并发安全）。实测 `SET ... EX 2` 的键 3 秒后过期消失、TTL 随时间递减。
- **积分页按日/按模型统计恒为空**：companion `userUsageTrend`/`userUsageModels` 解包 Sub2API 仪表板响应时只处理「裸数组 / `{items:[...]}`」两种形态，而 Sub2API v0.1.175 实际把数据包在 panel envelope `data` 下的具名字段里（`data.trend` / `data.models`），解包得 `undefined` 后被 `?? []` 吞掉，导致 `/api/client/points/summary` 的 `daily`、`models` 恒为空数组（`currentPoints`/`periodUsage`/`periodRequests` 不受影响）。
  - 修复：新增 `unwrapDashboardList` 按具名字段解包（兼容直接返回数组的形态），并补单元测试锁定 `data.trend`/`data.models` 形态防回归。
  - e2e：主流程对 points summary 的断言由「是数组」加强为「连通测试之后 models/daily 非空」；目录相关断言放宽为「包含 6 个 e2e 基准模型」，以容忍验收环境额外适配的真实模型（如 `deepseek-*`）。

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

### 持续集成 / 发布

- 同步至 GitHub 仓库 `agentkernel/llm-api`（默认分支 main）。
- CI（`.github/workflows/ci.yml`）：companion / desktop / sub2api-patch 三 job，全绿。
- 发布（`.github/workflows/release.yml`）：打 `v*` 标签自动出未签名 Windows 安装包 + SHA-256 并挂 Release；`v0.1.0` 已验证产出 `WorkBuddy.Setup.0.1.0.exe`。
- 修复 `.gitignore` 根目录级 `sub2api/`、`data/` 未锚定导致误忽略 `companion/src/sub2api/` 业务客户端（Linux CI 全新检出报模块缺失）。
- 桌面端生产地址改由构建期 `WB_COMPANION_URL_PROD` 注入，发布无需改源码。

### 桌面端真机冒烟

- 复检发现缺口：桌面端 Electron 主进程栈（机器码读取、DPAPI 令牌存储、companionClient、ipc 编排、真实写 models.json）此前只被 JS 镜像覆盖、未真机执行。
- 补齐：`ipc.ts` 抽出可复用核心函数（`ensureRegistered/assembleState/redeemCore/fetchModelsCore/applyModelsCore/testModelCore`）；新增 `smoke.ts`（`WB_SMOKE=1` 门控），用真实模块对在线 companion 跑通「注册→兑换→拉模型→写配置→备份/恢复→连通测试」10 步全过。
- `modelsFile.ts` 增加 `WB_MODELS_PATH` 测试覆盖，冒烟写临时文件，绝不触碰员工真实 `~/.workbuddy/models.json`。
- 顺带修正 `applyModelsCore` 的 `ApplyResult.backupId` 类型（null → ""）。

### 本地自测基础设施（tools/）

- `miniredis-server`：进程内 Redis 兼容服务。
- `fake-openai`、`fake-easypay`：本地假上游，免付费凭证跑通网关与支付回调。
- `tools/e2e`：Sub2API 引导、网关验证、主流程（32 断言）、边界（8 断言）编排脚本。

### 已知限制

见 [验证报告](docs/verification-report.md) 第 5 节。
