# 变更记录

## 未发布

### 功能

- **补齐生产部署编排（Linux + Docker Compose）**：仓库此前只有两份 Dockerfile 和文字版部署说明，实际上线要手工拼装。新增 [`deploy/`](deploy)：`docker-compose.yml`（sub2api / companion / 两个独立 PostgreSQL / redis / caddy 六服务，命名卷持久化、`restart: unless-stopped`、逐服务 healthcheck 与 `depends_on: service_healthy`）、`Caddyfile`（无域名时按 IP 进管理台，配置 `SUB2API_DOMAIN`/`COMPANION_DOMAIN` 后按域名分流，TLS 上线只需去掉 `auto_https off`）、`.env.example`（全部密钥占位 + 生成命令，实际 `.env` 被 gitignore 覆盖）、`catalog.prod.json`（DeepSeek V4 两个模型的能力条目，挂载进 companion 容器）。
  - 新增 [`tools/prod/bootstrap-sub2api-prod.mjs`](tools/prod/bootstrap-sub2api-prod.mjs)：幂等完成合规确认、Admin Key 生成、分组、上游账号（`model_mapping` 恒等映射＝模型白名单）、渠道定价（`POST /api/v1/admin/channels`，两个模型 id 同时列入）、escrow 支付并发配置（`max_pending_orders=500`、`daily_limit=0`）；密钥只写入 `--out` 指定的 0600 文件，stdout 全程掩码。
  - 新增 [`tools/prod/verify-prod.mjs`](tools/prod/verify-prod.mjs)：纯 HTTP 的生产验收（健康检查 → 设备注册 → 兑换激活 → 目录/网关模型数一致 → 真实上游对话 → 余额差额与用量统计 8 位小数核对）。
  - 文档：deployment.md 增「单机 Docker Compose 生产部署」全流程（含 companion 生产镜像无 tsx、CLI 走 `node dist/cli/index.js` 这一实操要点），并修正桌面端发布章节——生产地址由 `WB_COMPANION_URL_PROD` 构建期注入，不再需要改源码。

- **本地 Sub2API 补丁版启用网页管理台**：此前本地二进制按 `docs/local-dev.md` 用 `go build`（不带 `-tags embed`）编译，上游 `embed_off.go` 的 stub 使根路径 404「Frontend not embedded」。现按上游机制补齐：`pnpm build` 前端（Vite 产物直接输出到 `backend/internal/web/dist`）后以 `-tags embed` 重编译（二进制 145.6MB → 151.1MB），管理员可在 `http://127.0.0.1:18080/` 用邮箱+密码登录管理台查看计费（用户余额 / 支付概览 / 订单列表——含补丁 `PAID_PENDING_REDEEM` 状态 / 使用记录）。未改动任何 backend 源码（嵌入走上游自带 build tag），`workbuddy-patch.diff` 无需再生成。
  - 实测验证：登录页与 4 个计费页面无头浏览器截图渲染正常；JWT 登录、`/api/v1/admin/{users,usage/stats,payment/dashboard,payment/orders}` 数据正常；Admin Key（`x-api-key`）与补丁服务间路由（`x-service-key`）不受影响；companion `/healthz` 正常。
  - 文档：local-dev.md 增「构建带管理台的 Sub2API」（含低内存参数）；deployment.md 说明官方 Dockerfile 镜像默认自带前端；operations.md 增「网页管理台（管理员查看计费）」章节（入口、登录方式、各页面菜单与路由）。

### 修复

- **验收报告"DeepSeek 回复来自 ChatGPT 风格上游"排查：误路由不成立；真问题是 V4 模型计费未走渠道定价**：取证（`usage_logs` 全量 + Sub2API 访问日志 + 假上游留痕）显示所有 `deepseek-*` 请求（含旧别名）自始至终都落在真实 DeepSeek 账号（account 2，`upstream_response_model=deepseek-v4-*`），假上游从未收到过 deepseek 请求。源码级确认：账号 `model_mapping` 非空即白名单（`Account.IsModelSupported`，粘性/负载均衡/failover 全路径生效），两账号白名单键集互斥（gpt-* 6 个 vs deepseek 4 个），deepseek→账号 2、gpt→账号 1 本就是确定性的；"ChatGPT 风格"系 DeepSeek 模型自身回答风格/自述倾向所致。
  - 真问题（配置修复，不在代码库内，记录备查）：渠道 1（workbuddy-deepseek-pricing）`model_pricing.models` 只含退役别名 `deepseek-chat`/`deepseek-reasoner`，新目录 id `deepseek-v4-flash`/`deepseek-v4-pro` 计费回退到全局价格表（flash 输入 1.4e-7 vs 渠道价 2.8e-7），同一上游模型因请求别名不同计价不一致。已经管理 API 把两个 V4 id 加入该渠道定价条目（价格不变：输入 2.8e-7 / 输出 4.2e-7 / cache read 2.8e-8 / cache write 0），更新后热生效。
  - 代码侧：`tools/fake-openai` 此前不记录收到的请求，`fake-openai.log` 无法作为误路由取证依据；现每个请求落一行 `时间 方法 路径 model=<id> status=<code>`，出现 `model=deepseek-*` 即误路由铁证。
  - 验证（12 次调用，max_tokens≤30）：5x `deepseek-v4-flash` + 5x `deepseek-v4-pro` 全部命中账号 2（响应含 `reasoning_content`，DeepSeek 前缀缓存自第 2 次起命中 128 token 并按 cache_read 价计费），2x `gpt-5.6` 命中账号 1 且假上游日志留痕；12 笔扣费与用户余额差额按 8 位小数精确一致，仪表板按模型统计与调用次数吻合。
  - 运维手册（docs/operations.md）补充：上线新模型须同步渠道定价覆盖；多上游账号 `model_mapping` 必须全部非空且互斥（openai 平台唯一模型级隔离手段）。
- **高 DPI / 小分辨率下主窗口远大于屏幕且无法缩小**：主窗口写死 `1080x720`、最小 `920x600`（DIP）。屏幕逻辑工作区小于该值时（如 2880x1800 物理分辨率配 250%+ 缩放、或远程控制切换到低分辨率虚拟屏），窗口初始即超出屏幕，且最小尺寸限制导致手动也无法缩小回屏内。
  - 修复：新增 `windowBounds.computeWindowBounds`，app ready 后取 `screen.getPrimaryDisplay().workAreaSize`，初始宽高与最小宽高一律取「默认值与工作区的较小者」，并显式 `center: true` 居中；任何分辨率/缩放下窗口完整落屏。补 5 条单元测试（大屏不变、200% 小屏全夹取、单轴溢出、当前主屏 1440x860 情形、退化工作区兜底）。
- **DeepSeek 模型清单不对、在 WorkBuddy 中不可用**：服务端目录（`model_profiles`）此前导入的是 DeepSeek 已宣布退役的旧模型 id（`deepseek-chat`/`deepseek-reasoner`，官方公告 2026-07-24 起退役、现仅作兼容路由到 V4-Flash），且能力字段与现行模型不符（上下文 131072 vs 实际 1M、`deepseek-reasoner` 标注不支持工具调用导致 WorkBuddy 在 agent 会话中剥除 `tools`、缺 `reasoning` 配置导致思考档位交互异常）。官方 `GET /models` 实测现仅返回 `deepseek-v4-flash` 与 `deepseek-v4-pro`。
  - 数据/配置修复（不在代码库内，记录备查）：companion 目录经 CLI 重导入——新增 `deepseek-v4-flash`/`deepseek-v4-pro`（1M 上下文、384K 输出、支持工具调用与思维链、`reasoning: {defaultEffort: high, supportedEfforts: [high, xhigh], canDisableThinking: true}`，与官方文档及实测一致），旧 id 条目 `enabled=false` 下架；Sub2API 账号 2 `model_mapping` 增加 V4 恒等映射（保留旧别名做存量 models.json 的过渡兼容），分组 2 `models_list_config` 仅暴露 6 个基准模型 + 2 个 V4（旧 id 从网关 `/v1/models` 消失）。定价目录本就含 V4 条目，无需变更。
  - 代码侧：补单元测试锁定「V4 目录条目经 `toModelEntry` 写出的形状通过 `modelsFile.validateEntries` 校验」（含 `reasoning.canDisableThinking` 字段），防止目录 schema 回归。
  - 验证：网关 `/v1/models` 返回 8 个模型（V4 在列、旧 id 不在）；与桌面连通测试完全同形的请求（`max_tokens: 4, stream: false`）打真实 DeepSeek 上游，`deepseek-v4-flash` 200 / 755ms、`deepseek-v4-pro` 200 / 989ms，计费正常扣减。
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
