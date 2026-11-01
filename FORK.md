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
- **M3 收束**（进行中）：
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

判断：非网络整机问题（agent verify 同主机不同端点正常）；最可能是**部署 Hub 与御符的
版本错位**——部署实例的 verifyDevice 实现（请求体/端点）与当前御符不匹配（如旧实现触发
yufu 400 → 被归为 unavailable），或部署实例到御符走了不同内网路径。

处理清单（需部署侧）：
1. 部署机 `curl -s -X POST -H 'Content-Type: application/json' -d '{"token":"<dev-*>"}'`
   `https://yufu.qianji.io/api/v1/auth/device/verify` 复测出站；
2. 查 Hub 日志 `[hub] 身份服务无法验证设备连接` 行（verifyDevice 的 reason 已随行输出）；
3. 核对部署 Hub 版本 vs 本仓库 hub/yufu-client.ts 的 verifyDevice，升级到一致版本；
4. 修复后 fork 侧把 `config.json` 的 `yuyi.principal` 从 "agent" 切回 "device"（缺省），
   并推进 yuyi-agent 吸收合并。

御驿主仓库：`E:\Development\Code\nodejs\Yuyi`（Hub / 御符对接 / 协议层不动）。
