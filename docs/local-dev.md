# 本地开发与自测手册

在一台 Windows 开发机上，不依赖任何付费云服务，即可把「Sub2API 补丁版 + companion + 桌面端」整套系统跑起来并做端到端自测。本手册记录已验证过的完整步骤。

## 依赖清单（本机已用版本）

| 组件 | 版本 | 获取方式 |
| --- | --- | --- |
| Node.js | 22.x | 已装 |
| Go | 1.26.5 | 便携版解压到 `D:\toolchains\go1.26.5`（`go.dev/dl`） |
| PostgreSQL | 17.7 | 便携 zip 解压到 `D:\toolchains\pg17`（EnterpriseDB binaries） |
| Redis | miniredis | `tools/miniredis-server`（Go 编译，纯进程内，免安装；每秒按真实时间推进逻辑时钟，TTL 正常过期） |
| 假 OpenAI 上游 | - | `tools/fake-openai/server.mjs` |
| 假 EasyPay 上游 | - | `tools/fake-easypay/server.mjs` |

> 生产不使用 miniredis / 假上游；它们只为本机免凭证自测存在。

## 一次性准备

```powershell
# 1) 初始化便携 PostgreSQL 数据目录（trust 本地回环）
& "D:\toolchains\pg17\bin\initdb.exe" -D "D:\workbuddy-model-assistant\.local\pgdata" -U postgres -E UTF8

# pg_hba.conf 用无 BOM UTF-8 写入以下三行（Windows PowerShell 的 Set-Content 会加 BOM，务必用 UTF8Encoding($false)）：
#   local   all all            trust
#   host    all all 127.0.0.1/32 trust
#   host    all all ::1/128      trust

# 2) 启动 PG（端口 15432，避免与系统实例冲突）
& "D:\toolchains\pg17\bin\pg_ctl.exe" -D "D:\workbuddy-model-assistant\.local\pgdata" -o "-p 15432" -l "D:\workbuddy-model-assistant\.local\pg.log" start
& "D:\toolchains\pg17\bin\psql.exe" -h 127.0.0.1 -p 15432 -U postgres -c "ALTER USER postgres PASSWORD 'wblocal';" -c "CREATE DATABASE companion;" -c "CREATE DATABASE sub2api;"

# 3) 编译本地工具与服务端
$env:PATH = "D:\toolchains\go1.26.5\bin;" + $env:PATH
cd D:\workbuddy-model-assistant\tools\miniredis-server; go build -o miniredis-server.exe .
cd D:\workbuddy-model-assistant\sub2api\backend; $env:GOFLAGS="-mod=mod"; go build -p 2 -o wb-sub2api-server.exe ./cmd/server
```

> Windows 便携 Go 首次编译若报「paging file is too small」，用 `-p 2` 或 `GOMAXPROCS=1 GOGC=40` 降并发即可。

## 启动顺序

```powershell
# Redis（miniredis）
Start-Process "D:\workbuddy-model-assistant\tools\miniredis-server\miniredis-server.exe" -ArgumentList "127.0.0.1:16379" -WindowStyle Hidden

# 假上游
Start-Process node -ArgumentList "D:\workbuddy-model-assistant\tools\fake-openai\server.mjs","4790" -WindowStyle Hidden
Start-Process node -ArgumentList "D:\workbuddy-model-assistant\tools\fake-easypay\server.mjs","4780" -WindowStyle Hidden

# Sub2API（补丁版，AUTO_SETUP 首次建库建管理员）
powershell -File "D:\workbuddy-model-assistant\.local\start-sub2api.ps1"   # 监听 127.0.0.1:18080

# 配置 Sub2API（分组 + 假上游账号 + EasyPay + 支付配置）
node "D:\workbuddy-model-assistant\tools\e2e\bootstrap-sub2api.mjs"

# companion：迁移 + 初始化 + 启动
cd D:\workbuddy-model-assistant\companion
. "D:\workbuddy-model-assistant\.local\companion-env.ps1"
npm run migrate
npm run cli -- doctor
npm run cli -- escrow:init          # 输出 ESCROW_USER_ID，写回 .local/e2e-state.json 后重启
npm run cli -- catalog:import --file "D:\workbuddy-model-assistant\.local\catalog.json"
npm run cli -- packages:add --name "标准套餐" --price 100 --group 2
powershell -File "D:\workbuddy-model-assistant\.local\start-companion.ps1"   # 监听 127.0.0.1:8720
```

`.local/` 下的辅助脚本（`start-sub2api.ps1`、`companion-env.ps1`、`start-companion.ps1`、`run-e2e-driver.ps1`）封装了上述环境变量，日常复跑直接调用它们即可。所有密钥均为本地固定测试值，不得用于生产。

## 端到端自测

```powershell
# 主流程（32 项断言）：设备激活→兑换→网关模型→购买→模拟支付→延迟入账→确认→积分
powershell -File "D:\workbuddy-model-assistant\.local\run-e2e-driver.ps1"

# 边界（8 项）：无效码 / 重复回调不重复入账 / 未支付确认拒绝 / 跨设备拒绝
node "D:\workbuddy-model-assistant\tools\e2e\drive-edges.mjs"

# 仅验证网关：/v1/models 与 /v1/chat/completions 真跑通
node "D:\workbuddy-model-assistant\tools\e2e\verify-gateway.mjs"
```

细节见 [端到端测试指南](e2e-testing.md)。

## 桌面端本地联调

```powershell
cd D:\workbuddy-model-assistant\desktop
$env:WB_COMPANION_URL = "http://127.0.0.1:8720"   # 开发模式允许覆盖服务地址
npm run dev
```

生产构建里服务地址固定在 `src/main/companionClient.ts` 的 `PRODUCTION_COMPANION_URL`，员工不可见/不可改。

## 停止与清理

```powershell
Get-Process wb-sub2api-server,miniredis-server,node -ErrorAction SilentlyContinue | Stop-Process -Force
& "D:\toolchains\pg17\bin\pg_ctl.exe" -D "D:\workbuddy-model-assistant\.local\pgdata" stop
# 需要全新环境时删除 .local/pgdata、.local/sub2api-data 后重来
```
