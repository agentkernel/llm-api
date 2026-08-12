# WorkBuddy 模型配置助手 — 文档中心

面向维护者的完整文档索引。按角色查阅：

## 快速开始

- 想在本机把整套系统跑起来自测：先读 [本地开发与自测手册](local-dev.md)
- 想部署到生产：先读 [部署说明](deployment.md)，再读 [运维手册](operations.md)

## 设计与契约

| 文档 | 内容 |
| --- | --- |
| [架构总览](architecture.md) | 组件、进程边界、数据流、身份模型、状态机 |
| [Sub2API 契约基线 v0.1.175](sub2api-contract-v0.1.175.md) | 依赖的上游接口、认证、禁用接口、升级流程 |
| [支付补丁设计](payment-fork-design.md) | workbuddy-patch 分支的延迟入账状态机与服务间接口 |
| [companion API 参考](api-companion.md) | 桌面端↔业务服务、业务服务↔Sub2API 的接口清单 |

## 运行与维护

| 文档 | 内容 |
| --- | --- |
| [本地开发与自测手册](local-dev.md) | 便携 PG/Redis、Sub2API、companion、假上游、端到端脚本 |
| [部署说明](deployment.md) | 生产拓扑、镜像构建、环境变量、初始化流程 |
| [运维手册](operations.md) | 发码、设备迁移、订单修复、备份、监控、常见运营任务 |
| [端到端测试指南](e2e-testing.md) | e2e 编排脚本用途、如何复跑、断言含义 |
| [排障手册](troubleshooting.md) | 典型故障与定位方法 |

## 质量与变更

| 文档 | 内容 |
| --- | --- |
| [验证报告](verification-report.md) | 单元测试 + 真机端到端结果、发布前待办 |
| [变更记录](../CHANGELOG.md) | 版本演进、自测中发现并修复的缺陷 |

## 目录结构

```
workbuddy-model-assistant/
├─ desktop/     Electron + React + TS 桌面客户端（Windows 首发）
├─ companion/   Fastify + PostgreSQL 业务服务 + 管理 CLI
├─ sub2api/     Sub2API 私有分支 workbuddy-patch（基于 v0.1.175）
├─ tools/       本地自测工具（假上游、miniredis、e2e 编排）
├─ docs/        本文档体系
└─ .local/      本地自测运行时数据（不提交）
```

## 安全红线（所有改动必须遵守）

- 员工真实 apiKey、管理密钥、服务间密钥不得写入任何提交或分发文件。
- 替换 `models.json` 前必须自动加密备份（保留 5 份）。
- 桌面端永不展示/复制 apiKey；管理密钥只存在于服务器端。
