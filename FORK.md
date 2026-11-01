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

- **M1 daemon 内核** ✅（已验收，生产 Hub 双向）：设备主体/兼容连接、notify→注入→自动回信、
  yuyi_* MCP 出站（/mcp/yuyi）、roster、per-agent env。commit 7066079f1 起。
- **M2 客户端** ✅：Tauri 2 壳（无边框、「容器+卡片」帧、顶栏开关/三键、daemon 随包自启）、
  读 API（/api/yuyi/status|peers|inbox|ack）、原生御驿界面（状态/收件箱/同伴，9 语言）。
  - **桌面托管 host 连接凭证通道（2026-11-01 补齐，8f0ac18c8）**：paseo web 层连接
    桌面托管 host 前经 invoke `desktop_local_credential` 向壳要 `<home>/local-credential`
    （WS hello 凭证）。Electron 版由 main 实现；Tauri 垫片缺这条 → daemon-client 在
    发起 WS 前失败 → daemon 日志只有 local_ipc 插件连接，web UI 的 loopback hello
    从不出现，Host 永远"未连接"。已在壳加 `yuyi_local_credential`（端口校验后返回
    凭证文件）+ 垫片接线。**验收锚点：daemon 日志出现 `peer:"loopback"` 的 hello
    即 web UI 已连**（`activeConnections` +1 且稳定）。
- **M3 收束**（进行中）：
  - **桌面端系统性测试（2026-11-01，WebView2 CDP 驱动）**：窗口三键/拖动区、顶栏开关、
    explorer/终端 tab（含 xterm+node-pty）、新建工作区、agent 全链路（composer 发送→
    daemon 注入→run→回复流）、设置页（Host/Agents/Providers/诊断）、四侧栏页
    （搜索浮层/会话/计划/御驿原生界面）、yuyi 链路（连接/主体/绑定/收件箱）、
    单实例、退出清理——全部通过。**过程中修复**：Hub peers 设备主体缺口
    （Yuyi 0b7c486，部署后生效）；壳单实例锁 + 退出孤儿 daemon 树清理
    （cda8faec0）。**已知环境问题（非缺陷）**：opencode API key 过期（回信为
    报错文本）、Antigravity/Muse CLI 未装（Providers 显示错误属正常状态）。
  - 分发链路：**已打通**——NSIS 自包含安装包（129.7MiB：壳 + node.exe + 完整生产依赖树 +
    yuyi-daemon.json 模板），静默安装→壳拉起捆绑 daemon→invoke 桥→首启引导界面，端到端验证通过。
    `apps/desktop/scripts/bundle-runtime.mjs` 一键复现（含 --ignore-scripts / qianji 实体化 /
    web-ui 剔除 / cmd glob 全部防坑）。**待办**：安装包代码签名；自更新（updater 签名密钥+服务器）。
  - 去 paseo 化（rebrand）：数据目录已归御驿——**`~/.yuyi-desk`**（env `YUYI_DESK_HOME` 优先，
    `PASEO_HOME` 兼容回退；配置文件即 `~/.yuyi-desk/config.json`）。安装版已在新目录上线验证。
    **残余 paseo 痕迹**（批次 1/2 已清：进程名、`yuyi-desk.pid`、env 别名层
    `YUYI_DESK_*` 优先于 `PASEO_*`（config-environment 单点收口）、用户可见日志文案、
    UI 字样、品牌图标、数据目录）。**剩**：内部标识符（createPaseoDaemon 等函数/类型名）、
    `@getpaseo/*` 包名（发布时定御驿包名 + publish 流程）、低频内部日志。
  - yuyi-agent 吸收合并：**前置 = Hub 部署 device-verify 修复**。合并内容：设备凭证代领
    （读 ~/.yuyi/yuyi-agent/device-credential → allowed_agents 自动生成 yuyi.agents 映射）、
    device/control 落地（YuyiLink 已留回绝桩，接实现：terminate→archive、block→暂停注入）、
    状态闸门对齐 yuyi-agent state.json。落点：YuyiService 扩展。
  - relay 取舍：**保留**上游 relay（packages/relay + daemon.relay 配置）。它是手机/远程客户端
    连 daemon 的 E2E 传输层，与御驿 Hub（Agent 消息面）无概念冲突；移动端接入时直接用，
    后续若换御驿自有通道再评估。

## Hub 部署 device-verify 诊断（M1 发现，待部署侧处理）

现象：部署 Hub（wss://hub.qianji.io）设备主体 hello 报 `identity service unavailable`
（4503）；同机 agent 主体路径正常；本机直连御符 `POST /api/v1/auth/device/verify` 返回
200 `{valid:true, device_id, owner_user_id, allowed_agents...}`（数据完整）。

**已实锤（本地对照实验，2026-11-01）**：用本仓库源码直接起 Hub（bun run hub/server.ts
--port 17377 --yufu-url https://yufu.qianji.io），同一设备凭证发 device hello——
welcome 正常回带 `connectionPrincipal:"device"`，连接建立。即 **Hub 代码没问题，
部署实例版本落后**（其 verifyDevice 路径与当前御符不匹配）。

**处理：更新部署 Hub**（在部署机/仓库根）：
```bash
bash deploy/smart-deploy.sh --force-restart   # hub 是后端变更，需强制重启
```
（会先过 check-deploy.sh 他证门禁；systemd 服务 yuyi-hub.service 自动拉起）

升级后验证（任一端一条探针即证）：fork 侧把 config.json 的 `yuyi.principal`
从 "agent" 切回 "device"（缺省）重启——`/api/yuyi/status` 的 principal 应为
"device"，且 `~/.yuyi-desk` 凭证代领的 token 走 agent/register 独立验证。
随后推进 yuyi-agent 吸收合并。

**追加发现与修复（2026-11-01，本地对照实验第二轮）**：hello/welcome 通了之后
deliver 寻址仍是 `no session matching`——根因是 **Hub v1 功能缺口**：
`findOnlineTargets` 只让 `conn.identity`（agent 身份连接）参与在线匹配，
设备主体连接（身份在 agentSet）一律 no-route（peers 不可见同根源）。
**已在 Yuyi 仓库修复并推送**（plan.ts agentView 扩展 + router.ts
forwardDeliver 兜底，commit 5ad72ba；本地源码 Hub 双连接闭环验证通过：
设备连接 register 会话被 sender deliver 精确命中）。部署后追验发现**第二处同根因缺口**并已修复（commit 863ca9c，本地双连接
闭环实证 8ms 即时回执）：设备连接的 deliver **回执校验**同样只认
conn.identity——accepted_async 回执被 "agent" mismatch 丢弃 → 10s 误降级
mail（AckSource 加 agentSetIds；verifyAndTake 命中 agentSet 即匹配）。

**生产部署 863ca9c 后即完整可用**（fork 侧 principal 已是 device 缺省，
无需再动）：
- 凭证代领 + agent/register + deliver 寻址 + 回执认领全链路生效；
- deliver 快速受理（5s race）不再被 10s 超时吞掉；
- yuyi-agent 吸收合并的前置全部解除（control/state/闸门已交付）。

御驿主仓库：`E:\Development\Code\nodejs\Yuyi`（Hub / 御符对接 / 协议层不动）。
