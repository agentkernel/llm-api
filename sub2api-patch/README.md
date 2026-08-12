# Sub2API workbuddy-patch

WorkBuddy 对 Sub2API 的最小支付补丁（延迟入账 + 服务间接口）。整份 Sub2API 克隆不纳入本仓库；这里只保存补丁本身，可应用到干净的官方 v0.1.175 检出。

- 基线：Sub2API tag `v0.1.175`（commit `93c32fa1a2450351561abc46156d2e28cb5f74ca`）
- 设计说明：见 [../docs/payment-fork-design.md](../docs/payment-fork-design.md)
- 契约基线：见 [../docs/sub2api-contract-v0.1.175.md](../docs/sub2api-contract-v0.1.175.md)

## 补丁内容

- 新增 `PAID_PENDING_REDEEM` 订单状态与延迟履约逻辑（`payment_wb_deferred.go`）。
- 新增服务间支付接口 `/api/v1/service/payment/*`（`x-service-key` 认证，未配置 `WB_SERVICE_API_KEY` 时不注册）。
- 对官方 `payment_fulfillment.go` / `payment_order.go` / `payment_service.go` / `payment_stats.go` / `payment/types.go` / `server/router.go` 的少量插入。

共 11 个文件（5 新增 + 6 修改），见 `workbuddy-patch.diff`。

## 应用方式

### Windows (PowerShell)

```powershell
./apply.ps1 -Dest D:\path\to\sub2api
```

### Linux/macOS

```bash
./apply.sh /path/to/sub2api
```

脚本会 clone `v0.1.175` 到目标目录（若为空）、创建 `workbuddy-patch` 分支并 `git apply` 本补丁。已存在检出时只应用补丁。

## 手动应用

```bash
git clone --branch v0.1.175 https://github.com/Wei-Shaw/sub2api.git
cd sub2api
git switch -c workbuddy-patch
git apply /path/to/sub2api-patch/workbuddy-patch.diff
```

## 验证

```bash
cd sub2api/backend
go build ./...
go vet -tags unit ./internal/service/
go test -tags unit -run TestWB ./internal/service/   # 7 项
```

## 升级上游

1. `git fetch upstream && git log v0.1.175..<新tag> -- backend/internal/server/routes backend/internal/service`
2. 在新 tag 上重建分支并 `git apply`（冲突时按 payment-fork-design.md 的触点清单手工合入）。
3. 跑上面的验证命令，更新契约基线文档后再部署。
