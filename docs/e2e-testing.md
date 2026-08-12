# 端到端测试指南

端到端脚本位于 `tools/e2e/`，用真实的 Sub2API（补丁版）+ PostgreSQL + Redis + 签名支付回调 + 假上游，验证整个产品链路。前置环境见 [本地开发手册](local-dev.md)。

## 脚本一览

| 脚本 | 作用 |
| --- | --- |
| `bootstrap-sub2api.mjs` | 幂等配置 Sub2API：确认合规、生成 Admin Key、建分组（含 models_list_config）、建假上游账号（model_mapping）、建 EasyPay provider、更新支付配置。产物写入 `.local/e2e-state.json` |
| `verify-gateway.mjs` | 建临时用户+key，充值后直接验证网关 `/v1/models` 返回 6 个模型、`/v1/chat/completions` 返回内容 |
| `drive-companion.mjs` | 主流程（32 断言）：模拟桌面 main 全链路 |
| `drive-edges.mjs` | 边界（8 断言）：无效码、重复回调、未支付确认、跨设备 |
| `lib.mjs` | 公共库：面板响应拆包、断言、状态读写、轮询 |

`.local/run-e2e-driver.ps1` 封装了确定性复跑：统一测试套餐为 1:1、生成新码、以全新机器码运行 `drive-companion.mjs`。

## 主流程覆盖点（drive-companion）

1. 设备注册返回令牌；全新设备未激活。
2. 兑换公司码 → 100 积分、切到目标分组；同设备重复兑换幂等。
3. 兑换后 `state.activated=true`、积分=100。
4. 目录 6 个模型；配置材料返回 apiKey（renderer 永不可见，仅 e2e 直连网关模拟 main）。
5. 网关 `/v1/models` 返回全部 6 个；目录∩网关=6；生成合法 `models.json`（写 `.local/generated-models.json` 供人工核对）。
6. 连通测试 `/v1/chat/completions` 返回内容。
7. 购买下单返回 `out_trade_no` + 二维码；订单金额=套餐积分（1:1）。
8. 签名 EasyPay 回调 → 轮询到 `paid_pending_redeem`；**确认前不入账**（严格延迟入账）。
9. 确认 → 恰好入账套餐积分；订单 `redeemed`；重复确认不重复入账。
10. 最终积分≈200；积分统计页 `totalRecharged=200`。

## 边界覆盖点（drive-edges）

- 无效兑换码返回 404/409。
- 同一订单连发 3 次回调 → 仅一次 `paid_pending_redeem`、确认后只入账一次、重复确认不翻倍。
- 未支付订单确认被拒。
- 跨设备查询/确认他人订单返回 404。

## 复跑

```powershell
# 确保服务已起（见本地开发手册），然后：
powershell -File "D:\workbuddy-model-assistant\.local\run-e2e-driver.ps1"   # 主流程
node "D:\workbuddy-model-assistant\tools\e2e\drive-edges.mjs"               # 边界
```

期望输出末尾 `passed=32 failed=0` / `passed=8 failed=0`。

## 桌面端真机冒烟（跑真实 Electron 主进程栈）

`drive-companion.mjs` 用 JS 镜像了桌面逻辑；要验证**真实的桌面 main 进程代码**（机器码读取、DPAPI 令牌存储、companionClient、ipc 编排、真实写 models.json、备份/恢复、连通测试），用 `WB_SMOKE=1` 启动构建产物：

```powershell
cd D:\workbuddy-model-assistant\desktop
npm run build
$env:WB_SMOKE="1"
$env:WB_COMPANION_URL="http://127.0.0.1:8720"
$env:WB_MODELS_PATH="D:\workbuddy-model-assistant\.local\smoke-models.json"   # 临时路径，绝不碰真实配置
$env:WB_SMOKE_CODE="<一枚未用的公司兑换码>"
$env:WB_SMOKE_OUT="D:\workbuddy-model-assistant\.local\smoke-result.json"
npm run smoke
```

期望每步 `PASS`、`overall: PASS`、退出码 0。冒烟逻辑见 `desktop/src/main/smoke.ts`，仅在 `WB_SMOKE=1` 时执行（不建窗口，跑完退出）。它依赖在线的 companion + Sub2API + 网关，因此不纳入 CI（CI 无这些服务），属本地真机验收项。

## 注意事项

- `drive-companion.mjs` 每次用唯一机器码 → 全新设备，断言可重复；公司码是一次性的，`run-e2e-driver.ps1` 每次生成新码并经 `E2E_COMPANY_CODE` 注入。
- 连通测试会消耗极小额度（约 0.00003 积分），故「确认前积分」断言用 `>99.9 && <=100` 容差而非严格等于。
- Windows PowerShell 写 JSON/conf 默认带 UTF-8 BOM：`e2e-state.json` 读取时已剥离 BOM；PostgreSQL 的 `pg_hba.conf` 必须用无 BOM 写入，否则报 `could not load pg_hba.conf`。
