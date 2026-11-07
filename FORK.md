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
  yuyi\_\* MCP 出站（/mcp/yuyi）、roster、per-agent env。commit 7066079f1 起。
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
    （cda8faec0）；**turn 失败可见性**——agent 回合失败（如 provider API 401）
    原本聊天区无任何反馈（上游只在 timeline 收尾流），现弹错误 toast 明示原因
    （a72f648aa，9 语言）。**第二轮功能级实测（CDP 真实输入）**：新建工作区→agent
    创建（daemon 实证）→模型真实回复、终端命令执行（PTY 回显+输出）、文件树同步/
    文件打开、git 更改面板（分支/±行数统计）、/命令与 @提及浮层、会话历史找回、
    御驿页签（状态/收件箱/同伴）、搜索、计划创建/编辑、语言切换（中↔英↔俄即时
    生效+持久化）——全部通过。**测试方法教训**：合成 value-setter 输入不被 RN-web
    受控 composer 登记，会走「空提交」路径建出无 agent 工作区——UI 测试必须用
    CDP Input.insertText 等真实输入通道。**本地化审查（2026-11-01 第三轮）**：用户指出切中文后仍夹英文。两类缺口——
    ① schedules 簇四文件完全硬编码、② zh-CN 里 4 处整块引用 en.settings.layout 等
    （213 条值漏翻）。已修：schedules 全部接入 i18n（schedules.\* 命名空间 9 语言、
    describeCron 参数化）+ zh-CN settings.layout 内联中文（d06004e74）。
    **第三轮批量清理（9e386a6f8）**：170 条逐条翻译 + plugin-settings 共享 logs
    zh 覆盖 + browser-tools-config 硬编码接入 i18n + skills/lifecycle/chooseHostTitle
    内联。**清理后残留仅专有名词**（Hub/Agents/Agent ID/Enter/主题名/Discord/ACP/
    Markdown/HTML 等约 24 条，按惯例保留英文）。**已知环境问题（非缺陷）**：opencode API key 过期（回信为
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

## Reason 互补研究落地（2026-11-07，Yuyi 主仓 00e4da7/7f88d11 + 本仓 7640e31/2d65f4f7b）

17 项可借鉴方向系统性落地（研究报告四方向深研+独立评审+修订）：

- **P0 全实现**：桌面通知弹屏桥（Tauri notification+轮询 /api/yuyi/unread 计数
  探针+端侧三重抑制：每发送人 10min 去重/10min 过期不弹/单轮≤3）；敏感凭证
  出站剥除三面（Hub 形态/设备端值/本地短路，fail-closed，单测 8 例）。
- **P1 代码 8 项**：授权失败分级（seen-actions 曾持有集）/send 管线审计+
  行为锁定+重注册提示/收件箱一天遗忘（24h，豁免三类+墓碑审计）/outbox
  查询限速+task 索引/peers 会话目录（activity 字段级 opt-in，busy/doing/repo）/
  链接即邀请（hub/invite.ts 一次性+防爆破三件套+管理台端点）/一键安装脚本
  （install-agent.sh/.ps1）。
- **P1 文档 2 项 + P2 五项**：docs/roadmap/ 七篇（定位立场/A2A 路线/iroh/
  凭证离线可验 spec/MCP 拆包 spec/自更新安全/投递词汇统一）。
- **P1-5 审批签批**：方案 B 设计 spec 已定案（服务端见证+进程白名单+文本清洗+
  审计链），**代码实现列下一批**（协议帧+hub/approval.ts+设备浮窗+adapters 等待层）。

## 「Agent 微信」M1 落地（2026-11-07，御驿-Agent微信-设计.md §7 M1 范围）

Owner 直发通道全链路实现（设计三轮定稿：Owner 本人是发送主体，设备凭证即验证）：

- **Hub（Yuyi 8060f5b + 5fdde7e）**：
  - `hub/owner-direct.ts`：`synthesizeOwnerIdentity`（agentId=`owner:<ownerUserId>`
    前缀、role=owner、permissions=[]）、`isOwnerDirectIdentity`（role+前缀双判，
    御符 App 直连 owner 不误判）、广播拒绝（M1 限 1:1，OWNER_BROADCAST_DENIED）
  - `router.resolveActor`：设备连接 send 无 from.agentId → 合成 Owner 主体
    （不写 agentSet，每次发送合成）；roster/perm 表豁免（§2.2-2 Owner 凭证即授权）；
    wake 权限检查豁免（permissions=[] 不降级 mail）；投递补合成会话
    `sessionID=owner@<device>`（接收端零适配——wire 形态完整）
  - `frame-schema`（5fdde7e E2E 修复）：message.from.sessionID 可选（Owner 无会话
    概念）；send 帧顶层 from 显式声明——**P1-8 zod 层曾把设备连接的行动 Agent
    声明剥掉**（回归，owner-direct-wire.test.ts 锚定）
  - forgetInactive 列错位修复（from_device 在 payload JSON 不在 messages 表）
- **daemon（yuyi-desk dc13c3229）**：`sendFromOwner`（hub.send 无 from.agentId）、
  ConversationStore（conversations.json 索引+peer .jsonl 流水）、15s inbox 轮询
  归组会话+ack、/api/yuyi/chat/{send,list,history,unread}
- **app（yuyi-desk f2da2d1c5）**：Agents 页签（最近会话/在线目录/本机侧区）、
  会话页（owner=BadgeCheck 琥珀最高优先级渲染，agent=Bot 灰）、侧栏 Agents 行、
  i18n 9 语言；设计系统合规（withUnistyles 方案3/PressHighlight/ToolbarButton/
  EditingTextInput handle 清稿）
- **E2E（本地源 Hub 17377）**：ownerSend ok / 广播拒 / 接收端 wire
  role=owner、agentId=owner:yufu:lisi、sessionID=owner@OWNER-E2E、name=我 透传。
  ⚠ 生产 Hub（hub.qianji.io）需部署 5fdde7e 后 daemon 真实回路可用——
  部署命令：`git pull && sudo bash deploy/smart-deploy.sh --force-restart`。

### M1 批次4 续 + M1.5（同日，03976bf→a44c0d4 对应提交）

- **回程链路三件套（§2.4 回信去向落地，Hub 03976bf）**：E2E 实测发现
  Owner 直发的回信被拒（「无该收件人的收件箱记录」）——① Owner 直发时
  register owner 收件人（owner:<uid>:owner@<device>，幂等 upsert）；
  ② parseAgentScopedTarget 加 owner: 分支（uid 含冒号按最后一个冒号切分）；
  ③ 设备连接 inbox/fetch 放行 owner recipient（归属=ownerUserId 匹配设备
  凭证，先于 agentSet 空集检查——纯 Owner 设备也收得到自己的信）。
- **daemon（cdb1962a6）**：owner 收件人纳入 15s 收件箱轮询（welcome
  hubOwnerUserId 门控）；peerKeyOfFrom 合成 canonical owner:<uid>:owner@<device>
  （peerKey 可直接复发）；会话页投递状态三态明示（✗ / ✓·已转收件箱 / ✓）；
  i18n 修复（sidebar.sections.agents 曾误插进另一个 sections 块，实机走查发现）。
- **M1.5 Agent 会话旁观（02856c46f，设计 §4/§5）**：本机 Agent 经手的
  agent↔agent 流量（deliver 入向 + sendFromBinding 出向挂点）按对端归组
  observe:<agent>:<peer> 会话（best-effort）；App「Agent 会话（旁观）」
  独立分组 + 只读会话页（隐藏 composer，旁观徽标）；i18n 9 语言。
- **验证**：本地源 Hub 全链 E2E（Owner send→远端收 wire role=owner→回信
  mail 降级→daemon 归组→会话渲染 loopClosed=true）+ Tauri 实机走查
  （Agents 页签/会话页/composer 发送/降级提示/旁观区块/未读徽标/i18n）。

### UI/UX 二轮重构：顶层模式化（2026-11-07，737ac1b38）

用户定稿三点（命名「工作台/微信」；在线目录只在发起会话时弹出；旁观会话
默认折叠）：sidebar 的 Agents 页签整个移除，改为**顶层模式**：

- 顶栏（YuyiShellTopbar 御驿 logo 后）ModeSwitch 分段切换（复用项目
  SegmentedControl，符合设计系统 no-raw-pressable 规范）；
- 顶层模式持久化（wechat-mode-store + localStorage），启动重定向回上次模式；
- 微信模式：LeftSidebar 整体替换为 WeChatSidebar（搜索/＋发起/最近会话/
  旁观折叠分组），工作台菜单完全消失；主区 /h/:serverId/wechat 渲染
  WeChatMain（选中会话复用 AgentChatScreen 或品牌欢迎页）；selectedPeer
  进 store，左栏↔主区共享、切模式保留；
- AgentChatScreen 改 props 化；agents-screen 三段式页签与 agents 路由删除。

实机走查（CDP）：切换器位置/微信模式工作台菜单消失/左栏列表/会话点开/
切回工作台全部通过；release exe 需 touch lib.rs 强制重嵌（web-dist 不在
cargo 增量指纹内——以后每次前端改动都要 touch 再 cargo build --release）。

### Agent 微信 UI v2 P0 全量落地（2026-11-08，15b588f23）

按 docs/御驿-Agent微信-UI设计-v2/ 四批次路线图系统实现（44 文件 +4911/-739）：

- **状态可见性**：daemon sendAsOwner 结构化 ack（messageId+delivery）+3s inbox
  探针（回信感知 30s→≤3s）+preview/turns/notify-suppress 端点+replyTo/taskId
  落盘+activity 透传；Tauri notify_loop 数据源切 chat/unread（修通知反转）；
  app S0~S5′ 状态机（乐观插入/重试/聚焦轮询/滚动治理/草稿持久化）
- **侧栏与目录**：共享数据层单例；agentId 聚合行+子会话；DirectoryOverlay
  三段分组+键导航；分段器未读徽标；快捷键注册；「联系 Agent」改名
- **Agent 原生**：身份卡/结果卡（引用+代码+折叠）/旁观 taskId 回合+转介入
- **视觉清偿**：AgentAvatar tint 体系；yuyi-screen 剥 useUnistyles；令牌刻度
- 验证：46+ 新测试全绿、两端 typecheck 0、oxlint 0/0、全量套件零回归、
  release 实机走查（身份卡/状态词/离线提示渲染确认）

## 目录布局（2026-11-05 起）

本仓库以 **git submodule** 挂入主仓库：`Yuyi/packages/yuyi-desk`（原
`E:\Development\Code\nodejs\yuyi-desk` 已归档为 `yuyi-desk.bak`）。

- 主仓库 workspaces 已排除 `!packages/yuyi-desk`，两套 workspace 互不干扰；
- submodule URL 暂为本机路径；建立远端后切换：
  `git submodule set-url packages/yuyi-desk <remote-url>`；
- 新机器克隆主仓库后拉取设备端：
  `git submodule update --init packages/yuyi-desk`（需
  `git config --global protocol.file.allow always` 或换远程 URL）；
- 上游 paseo 同步通道不变：本仓库 origin 仍指上游，cherry-pick 照旧。
