# WorkBuddy 模型配置助手

[![CI](https://github.com/agentkernel/llm-api/actions/workflows/ci.yml/badge.svg)](https://github.com/agentkernel/llm-api/actions/workflows/ci.yml)

公司内部桌面工具：员工用兑换码/购买激活设备 → 自动生成 WorkBuddy `models.json` → 查看积分与用量。

完整文档见 [docs/README.md](docs/README.md)（架构、本地开发、部署、运维、端到端测试、排障）。发布流程见 [.github/workflows/release.yml](.github/workflows/release.yml)：给提交打 `v*` 标签即自动产出未签名 Windows 安装包与 SHA-256 校验并挂到 Release。

## 仓库结构

| 目录 | 内容 |
| --- | --- |
| `desktop/` | Electron + React + TypeScript 桌面客户端（Windows 首发） |
| `companion/` | TypeScript + Fastify + PostgreSQL 业务服务与管理 CLI |
| `sub2api/` | Sub2API 私有分支（`workbuddy-patch`，基于 v0.1.175，嵌套 git 仓库，不纳入本仓库版本管理） |
| `docs/` | 契约基线、补丁设计、部署说明 |

## 关键文档

- [Sub2API 契约基线](docs/sub2api-contract-v0.1.175.md)
- [支付补丁设计](docs/payment-fork-design.md)
- [部署说明](docs/deployment.md)

## 安全红线

- 员工真实 apiKey、管理密钥不得写入任何提交或分发文件。
- 替换 `models.json` 前必须自动加密备份（保留 5 份）。
- 桌面端永不展示/复制 apiKey；管理密钥只存在于服务器端。
