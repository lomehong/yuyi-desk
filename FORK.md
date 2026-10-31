# Fork 溯源与改造声明 / Fork Provenance

## 来源 / Upstream

- **Upstream**: https://github.com/getpaseo/paseo （Apache-2.0, Copyright (c) 2025-present Mohamed Boudra）
- **Baseline commit**: `fd65985e9d588109898fcf84298b6ecd1815462a` (2026-10-31, "fix(android): resize header fades after rotation (#8349)")
- **Clone scope**: `main` 单分支全历史（保留 `origin` remote 以便后续 cherry-pick 上游修复）
- 本仓库按 Apache-2.0 第 4 条保留原 LICENSE 与版权声明；上游对第三方程的许可 carve-out 见原 LICENSE 文件。

## 本 fork 的定位 / Purpose

本仓库是**御驿（Yuyi）设备端**产品线：吸收 Paseo 的 daemon（agent 进程编排）与全端客户端骨架，
将御符（Yufu）身份与御驿 Hub 通信协议作为一等公民原生植入。

## 改造准则 / Rules

1. **禁止依赖 `@getpaseo/*` npm 发布包**——所有 `@getpaseo/*` 互引必须指向本仓库 workspace 源码。
2. 御驿侧复用自有包 `@qianji/protocol`、`@qianji/core`（npm 发布版）。
3. 桌面壳：**Tauri**（新建 `apps/desktop`），Electron 版 `packages/desktop` 废弃不维护。
4. 上游 "Hub"（GitHub/Slack/Discord 触发编排）剥离/搁置；上游 E2E relay 暂用。
5. 保留原版权头；新增文件标注御驿改造。

## 里程碑 / Milestones

- **M1 daemon 内核**：设备主体连御驿 Hub（principal=device + agent/register，移植 Yuyi `packages/agent` 的 hub-link）；
  per-agent 御符凭证 env 注入 + yuyi_* MCP 工具注入；notify→会话注入+自动回信；roster 上行。
- **M2 客户端**：Tauri 壳 + 品牌化 + 原生御驿界面（inbox/peers/任务）；UI 复用 `packages/app` 的 Expo web 构建。
- **M3 收束**：yuyi-agent 吸收合并、relay 取舍、分发链路。

御驿主仓库：`E:\Development\Code\nodejs\Yuyi`（Hub / 御符对接 / 协议层不动）。
