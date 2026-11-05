<p align="center">
  <img src="apps/desktop/src-tauri/icons/icon.png" width="96" height="96" alt="御驿 Yuyi Desk">
</p>

<h1 align="center">御驿 Yuyi Desk</h1>

<p align="center">
  御驿设备端 —— 把本地 AI Coding Agent 接入御驿通信体系
</p>

---

## 这是什么

**御驿 Yuyi Desk** 是御驿（Yuyi）体系的设备端桌面应用：在一台开发机上编排、驱动并观测本地 AI Coding Agent（opencode 等.provider），并通过御符（Yufu）身份与御驿 Hub（Yuyi）接入跨设备消息体系——手机、管理台、其它 Agent 都能寻址到这台机器上的 Agent。

它 fork 自 [getpaseo/paseo](https://github.com/getpaseo/paseo)（Apache-2.0），在保留其 daemon 编排与全端客户端骨架的基础上，将御驿协议作为一等公民原生植入（溯源与改造准则见 [FORK.md](FORK.md)）。

## 核心能力

- **Agent 编排**：创建/管理多个本地 Agent（provider/model/思考级别/权限模式可选），对话式驱动，回复流实时渲染
- **御驿链路**：设备主体单连接接入 Hub；消息注入 → Agent 执行 → 自动回信闭环；收件箱兜底不丢消息
- **管理台闸门**：远程 block / release / terminate 任意 Agent，带时效（until）、原因与审计留痕
- **桌面体验**：无边框「容器 + 卡片」窗口、顶栏侧栏开关、深浅主题、9 语言界面（简体中文 / English / 日本語 / 한국어 等）
- **工作区工具**：终端（PTY）、文件树、git 更改与差异、计划任务（定时驱动 Agent）、命令与 @文件 提及

## 架构

```
┌─ 御驿 Yuyi Desk（Tauri 2 壳，Windows）────────────┐
│  WebView：React Native Web 客户端界面              │
│  Rust 侧：守护进程生命周期 / 单实例 / 本地凭证      │
└──────────────┬───────────────────────────────────┘
               │ 随包拉起（node + 完整依赖树）
┌──────────────┴───────────────────────────────────┐
│  Daemon：Agent 进程编排 / 会话 / 终端 / 定时计划    │
│  yuyi 链路：设备凭证 → Hub(WebSocket) → 注入/回信   │
└──────────────┬───────────────────────────────────┘
               │ 御符身份验证 · 御驿 Hub 消息面
        御驿 Hub（跨设备）· 管理台 · 手机端
```

## 目录结构

```
packages/
  app/        客户端界面（Expo/React Native Web，9 语言）
  server/     daemon 内核（Agent 编排、会话、终端、yuyi 链路）
  client/     daemon 客户端协议实现
  protocol/   通信协议与类型
  relay/      远程接入中继（手机配对）
apps/
  desktop/    Tauri 2 桌面壳（Rust）+ 打包脚本 + 发布流程
```

> 本仓库以 git submodule 形式挂载于御驿主仓库 `Yuyi/packages/yuyi-desk`，布局与克隆说明见 [FORK.md](FORK.md)。

## 构建与安装

依赖：Node.js 24+、Rust（Tauri）、Windows（当前分发目标）。

```bash
# 1) 安装依赖并构建工作区
npm install

# 2) 打包 daemon 运行时（一键，含全部防坑处理）
node apps/desktop/scripts/bundle-runtime.mjs

# 3) 构建桌面壳（产物：apps/desktop/src-tauri/target/release/bundle/nsis/）
cd apps/desktop && npm run build
```

发布、代码签名与自更新流程见 [apps/desktop/RELEASE.md](apps/desktop/RELEASE.md)。

## Fork 溯源与许可

- 上游：[getpaseo/paseo](https://github.com/getpaseo/paseo)，基线 commit `fd65985e`，Apache-2.0
- 本仓库按 Apache-2.0 保留原 LICENSE 与版权声明；改造明细与 upstream 同步策略见 [FORK.md](FORK.md)
- 禁止依赖 `@getpaseo/*` npm 发布包——所有内部互引指向本仓库 workspace 源码
