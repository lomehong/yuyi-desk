# CLAUDE.md

御驿 Yuyi Desk —— 御驿（Yuyi）体系的设备端桌面应用：编排本地 AI Coding Agent
（opencode 等），并通过御符（Yufu）身份接入御驿 Hub 跨设备消息体系。

本仓库 fork 自 [getpaseo/paseo](https://github.com/getpaseo/paseo)（Apache-2.0，
基线 `fd65985e`）。溯源、改造准则与上游同步策略见 [FORK.md](FORK.md)。

## 仓库结构（npm workspace monorepo）

- `packages/server` — daemon 内核：Agent 生命周期、WebSocket API、yuyi 链路（设备主体连 Hub）
- `packages/app` — 客户端界面（Expo / React Native Web，桌面壳与移动共用）
- `packages/client` — daemon 客户端协议实现
- `packages/protocol` — 通信协议与类型
- `packages/relay` — 远程接入中继（手机配对）
- `apps/desktop` — Tauri 2 桌面壳（Rust）+ 打包脚本（`scripts/bundle-runtime.mjs`）

## 硬性约束（违反即返工）

1. **禁止依赖 `@getpaseo/*` npm 发布包**——内部互引一律指向本仓库 workspace 源码。
2. 桌面壳用 **Tauri**，不用 Electron（`packages/desktop` 已废弃）。
3. 数据目录是 **`~/.yuyi-desk`**（`YUYI_DESK_HOME` 优先，`PASEO_HOME` 兼容回退，
   单点收口在 `packages/server/src/server/paseo-env.ts` 的 resolvePaseoHome）。
4. 品牌名：用户可见文案一律「御驿 / Yuyi Desk」；内部标识符改名按 FORK.md 排期。

## 御驿链路要点（复发成本高）

- daemon 以 **设备主体**（principal=device）单连接接入 Hub；每个 Agent 身份经
  `agent/register` 逐个验证（御符），不在 hello 里背书。
- 连接 token 按主体分派：device 主体用**设备凭证**；agent 主体用 agents[0] 身份
  token——device hello 对 agent token 会被御符拒绝。
- 出站消息 from 必须带 agentId（Hub resolveActor 校验）；expectReply 必须带
  taskId 才经 Envelope 往返存活；发送方 sessionID 须先在连接上 updateRoster 登记。
- 管理台闸门（block/release/terminate）落地在
  `packages/server/src/server/yuyi/service.ts`（gate.json + jsonl 审计）。

## 桌面壳要点

- Tauri invoke 在 `__TAURI__.core.invoke`；壳的命令面见
  `apps/desktop/src-tauri/src/lib.rs`（daemon 生命周期/本地凭证/日志尾部）。
- web 侧垫片 `packages/app/src/yuyi/tauri-bridge.ts` 把 `__TAURI__` 适配成
  `window.paseoDesktop`（Electron 桥形态）——app 内桌面判定都走它。
- 无边框「容器+卡片」帧在 `packages/app/src/yuyi/shell-frame.tsx`。
- 打包：`apps/desktop/scripts/bundle-runtime.mjs`（daemon 运行时树，含全部防坑）
  → `apps/desktop` 下 `npm run build`（NSIS）。

## Windows 打包/运行坑（复发成本高）

- yuyi-daemon.json 的 {{INSTALL_DIR}}/{{DATA_DIR}} 占位符必须解析为**正斜杠**路径
  （原始反斜杠是非法 JSON 转义，解析会静默失败）。
- NSIS 升级安装可能不覆盖已有资源文件/运行中的 exe——升级验证必须查落盘内容，
  重装前先全杀进程树（含 supervisor/worker）。
- WebView2 数据真身在 `%LOCALAPPDATA%\io.qianji.yuyi.desk`；图标缓存陈旧时清
  IconCache。
- expo 导出的 web-ui 资产含超长文件名会破坏 makensis——运行时树中已剔除。

## 测试

- `npm test`（workspace 级）；浏览器 UI 调试可给 WebView2 开
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`。
- UI 自动化注意：RN-web 受控组件不吃合成 value-setter，必须走 CDP
  `Input.insertText` / 真实按键通道。
