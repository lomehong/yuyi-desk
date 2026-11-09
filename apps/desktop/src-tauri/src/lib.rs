//! 御驿 Yuyi Desk — Tauri 桌面壳
//!
//! M2d：daemon 随包自启（Rust 管理子进程生命周期）。
//! - 启动时读 exe 旁的 `yuyi-daemon.json`：端口不可达且配置了命令则拉起 daemon
//!   （继承环境 + 配置 env 覆盖，stdout/stderr 落盘日志）；
//! - 应用退出时终止由本壳拉起的 daemon（Exit 事件）；
//! - 真正自包含的 sidecar 二进制（externalBin）在 M3 分发阶段补齐。

use std::collections::HashMap;
use std::fs;
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

mod desktop_commands;mod tray;

type DaemonSlot = Arc<Mutex<Option<Child>>>;

/// 已解析的 daemon 配置快照（ensure_daemon 时填入；invoke 面用）
#[derive(Clone, Default)]
pub struct DaemonConfigSlot(Arc<Mutex<Option<DaemonConfig>>>);

#[tauri::command]
fn app_identity() -> &'static str {
    "yuyi-desk/0.2.0"
}

#[tauri::command]
fn daemon_status(state: tauri::State<DaemonChild>) -> bool {
    state.0.lock().map(|g| g.is_some()).unwrap_or(false)
}

/// web 垫片用：daemon 连接信息（host/port/日志路径/数据目录）
#[tauri::command]
fn yuyi_daemon_info(state: tauri::State<DaemonConfigSlot>) -> Result<serde_json::Value, String> {
    let guard = state.0.lock().map_err(|_| "config slot poisoned")?;
    let cfg = guard
        .as_ref()
        .ok_or_else(|| "daemon config not loaded".to_string())?;
    let log_path = exe_dir()
        .map(|d| d.join("yuyi-daemon.log").display().to_string())
        .unwrap_or_default();
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(|h| format!("{}/.yuyi-desk", h.replace('\\', "/")))
        .unwrap_or_default();
    Ok(serde_json::json!({
        "host": cfg.host(),
        "port": cfg.port(),
        "logPath": log_path,
        "home": home,
    }))
}

/// web 垫片用：本地 daemon 凭证（desktop_local_credential 的 Tauri 对应）。
/// Electron 版校验 pid-lock listen 后返回 <home>/local-credential；这里以壳自己的
/// daemon 配置端口做同等校验——只有监听端口匹配的请求才回凭证。
#[tauri::command]
fn yuyi_local_credential(
    state: tauri::State<DaemonConfigSlot>,
    listen: String,
) -> Result<Option<String>, String> {
    let guard = state.0.lock().map_err(|_| "config slot poisoned")?;
    let cfg = guard
        .as_ref()
        .ok_or_else(|| "daemon config not loaded".to_string())?;
    let requested = listen.rsplit(':').next().unwrap_or("");
    let requested: u16 = match requested.parse() {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    if requested != cfg.port() {
        return Ok(None);
    }
    let home = daemon_home();
    match fs::read_to_string(home.join("local-credential")) {
        Ok(text) => {
            let token = text.trim().to_string();
            if token.is_empty() {
                Ok(None)
            } else {
                Ok(Some(token))
            }
        }
        Err(_) => Ok(None),
    }
}

/// 数据目录（与分发模板 {{DATA_DIR}} 的解析规则一致：~/.yuyi-desk）
fn daemon_home() -> PathBuf {
    let base = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base).join(".yuyi-desk")
}

/// web 垫片用：读 daemon 日志尾部
#[tauri::command]
fn yuyi_daemon_log_tail(max_bytes: Option<u32>) -> Result<serde_json::Value, String> {
    let dir = exe_dir().ok_or_else(|| "no exe dir".to_string())?;
    let path = dir.join("yuyi-daemon.log");
    if !path.exists() {
        return Ok(serde_json::json!({ "logPath": path.display().to_string(), "contents": "" }));
    }
    let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let max = max_bytes.unwrap_or(64 * 1024) as u64;
    let start = meta.len().saturating_sub(max);
    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    use std::io::{Read, Seek, SeekFrom};
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "logPath": path.display().to_string(),
        "contents": String::from_utf8_lossy(&buf),
    }))
}

#[derive(serde::Deserialize, Default, Clone)]
#[serde(default)]
struct DaemonConfig {
    /// daemon TCP 地址（存活探测 + 自动拉起判定）
    host: String,
    port: u16,
    /// 拉起命令（空 = 不自动拉起，仅连接已有 daemon）
    command: String,
    args: Vec<String>,
    /// 附加/覆盖环境变量（如 YUYI_DESK_HOME / PASEO_HOME）
    env: HashMap<String, String>,
    /// 拉起后等待端口就绪的探测窗口（ms）
    ready_timeout_ms: u64,
}

impl DaemonConfig {
    fn host(&self) -> String {
        if self.host.is_empty() {
            "127.0.0.1".to_string()
        } else {
            self.host.clone()
        }
    }
    fn port(&self) -> u16 {
        if self.port == 0 {
            6767
        } else {
            self.port
        }
    }
    fn ready_timeout_ms(&self) -> u64 {
        if self.ready_timeout_ms == 0 {
            15_000
        } else {
            self.ready_timeout_ms
        }
    }
}

/// 由本壳拉起的 daemon 子进程槽位（None = 未拉起/已退出）
#[derive(Clone, Default)]
pub struct DaemonChild(pub DaemonSlot);

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Into::into))
}

fn read_daemon_config() -> Option<DaemonConfig> {
    let dir = exe_dir()?;
    let path = dir.join("yuyi-daemon.json");
    let text = fs::read_to_string(&path).ok()?;
    // 分发模板占位符：安装后首启解析并写回（用户可直接改端口/路径）。
    // 路径统一正斜杠——原始反斜杠（\U、\Y…）是非法 JSON 转义会让解析失败。
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(|h| format!("{}/.yuyi-desk", h.replace('\\', "/")))
        .unwrap_or_else(|_| ".yuyi-desk".to_string());
    let install = dir.display().to_string().replace('\\', "/");
    let resolved = text
        .replace("{{INSTALL_DIR}}", &install)
        .replace("{{DATA_DIR}}", &home);
    if resolved != text {
        let _ = fs::write(&path, &resolved);
    }
    serde_json::from_str(&resolved).ok()
}

fn port_alive(cfg: &DaemonConfig) -> bool {
    let addr = format!("{}:{}", cfg.host(), cfg.port());
    let Ok(addr) = addr.parse() else {
        return false;
    };
    TcpStream::connect_timeout(&addr, Duration::from_millis(700)).is_ok()
}

fn spawn_daemon(cfg: &DaemonConfig) -> Option<Child> {
    if cfg.command.is_empty() {
        return None;
    }
    let dir = exe_dir()?;
    let log_path = dir.join("yuyi-daemon.log");
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .ok();
    let mut cmd = Command::new(&cfg.command);
    cmd.args(&cfg.args)
        .envs(&cfg.env)
        .current_dir(&dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(l) = log.as_ref() {
        cmd.stdout(Stdio::from(l.try_clone().ok()?));
        cmd.stderr(Stdio::from(l.try_clone().ok()?));
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW：daemon 是后台进程，不弹控制台
        cmd.creation_flags(0x0800_0000);
    }
    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) => {
            let msg = format!(
                "[yuyi-desk] daemon spawn FAILED: {err} (command={} args={:?})\n",
                cfg.command, cfg.args
            );
            eprintln!("{msg}");
            if let Some(mut l) = log {
                use std::io::Write;
                let _ = l.write_all(msg.as_bytes());
            }
            return None;
        }
    };
    eprintln!(
        "[yuyi-desk] daemon spawned (pid={}), waiting port {}",
        child.id(),
        cfg.port()
    );
    Some(child)
}

fn ensure_daemon(app: &AppHandle) {
    let Some(cfg) = read_daemon_config() else {
        // GUI 进程无 stderr：解析失败也落盘，便于远程排查
        if let Some(dir) = exe_dir() {
            if let Ok(mut l) = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("yuyi-daemon.log"))
            {
                use std::io::Write;
                let _ = l.write_all(b"[yuyi-desk] yuyi-daemon.json missing or unparsable\n");
            }
        }
        return;
    };
    let config_slot: tauri::State<DaemonConfigSlot> = app.state();
    if let Ok(mut guard) = config_slot.0.lock() {
        *guard = Some(cfg.clone());
    }
    if port_alive(&cfg) {
        return;
    }
    let Some(child) = spawn_daemon(&cfg) else {
        return;
    };
    let state: tauri::State<DaemonChild> = app.state();
    if let Ok(mut guard) = state.0.lock() {
        *guard = Some(child);
    }
    // 等端口就绪（前端自身也有重连，这里是把「拉起→可用」的窗口吃掉）
    let deadline = std::time::Instant::now() + Duration::from_millis(cfg.ready_timeout_ms());
    while std::time::Instant::now() < deadline {
        if port_alive(&cfg) {
            eprintln!("[yuyi-desk] daemon ready on port {}", cfg.port());
            return;
        }
        std::thread::sleep(Duration::from_millis(400));
    }
    eprintln!(
        "[yuyi-desk] daemon not ready within {}ms",
        cfg.ready_timeout_ms()
    );
}

pub fn run() {
    let slot: DaemonSlot = Arc::default();
    let exit_slot = Arc::clone(&slot);
    let app = tauri::Builder::default()
        // P0-1 桌面通知：系统弹屏（抑制逻辑在 notify_loop 内）
        .plugin(tauri_plugin_notification::init())
        // 单实例：二次启动把已有窗口带到前台（防双开撞 daemon/数据目录）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }))
        .manage(DaemonChild(Arc::clone(&slot)))
        .manage(DaemonConfigSlot::default())
        .invoke_handler(tauri::generate_handler![
            app_identity,
            daemon_status,
            yuyi_daemon_info,
            yuyi_local_credential,
            yuyi_daemon_log_tail,
            desktop_commands::desktop_get_system_idle_time,
            desktop_commands::garbage_collect_attachment_files
        ])
        .setup(move |app| {
            tray::install(app.handle())?;
            {
                use tauri::Emitter;
                use tauri_plugin_notification::NotificationExt;
                let action_app = app.handle().clone();
                app.notification().on_action(move |action| {
                    if action.action_id() != "tap" {
                        return;
                    }
                    let Some(peer_key) = action
                        .notification()
                        .and_then(|notification| notification.extra().get("route").cloned())
                        .and_then(|route| {
                            route.get("peerKey")?.as_str().map(str::to_owned)
                        })
                    else {
                        return;
                    };
                    tray::show_main_window(&action_app);
                    let _ = action_app.emit("yuyi:notification-open", notification_route(&peer_key));
                })?;
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || ensure_daemon(&handle));
            // P0-1 通知轮询线程：独立于 daemon 拉起，daemon 未就绪时静默重试
            let notify_handle = app.handle().clone();
            std::thread::spawn(move || notify_loop(notify_handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running yuyi desk");

    app.run(move |app_handle, event| {
        match event {
            RunEvent::WindowEvent {
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                api.prevent_close();
                tray::hide_main_window(app_handle);
            }
            RunEvent::Exit => {
                if let Ok(mut guard) = exit_slot.lock() {
                    if let Some(mut child) = guard.take() {
                        eprintln!("[yuyi-desk] stopping daemon pid={}", child.id());
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                // 兜底：daemon 可能由上一个壳实例拉起（本壳 DaemonChild 槽位为空）——
                // 退出时按安装目录匹配本产品线的 node 进程树清理，保证「退出即停」语义
                kill_orphan_daemon_tree();
            }
            _ => {}
        }
    });
}

/// 杀掉命令行指向本安装目录 runtime 的 node 进程树（daemon supervisor/worker）。
/// 只匹配本产品目录，不会误伤系统其它 node 进程。
fn kill_orphan_daemon_tree() {
    let Some(dir) = exe_dir() else { return };
    let install = dir.display().to_string().replace('\\', "/");
    let script = format!(
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | \
         Where-Object {{ ($_.CommandLine -replace '\\\\','/') -like '*{}*' }} | \
         ForEach-Object {{ taskkill /F /T /PID $($_.ProcessId) 2>$null }}",
        install.replace('\'', "''"),
    );
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let _ = cmd.output();
    eprintln!(
        "[yuyi-desk] orphan daemon tree cleanup issued (install={})",
        install
    );
}

// ---------------------------------------------------------------------------
// P0-1 桌面通知弹屏桥（借鉴 Reason Network notify）
//
// 数据流：Rust 轮询 daemon GET /api/yuyi/chat/unread（notify 直投与 mail 降级
// 都覆盖）→ 计数上涨时用 chat/list 定位会话，再以只读 chat/preview 取新增文本。
// 弹屏携带 canonical peerKey，点击后回到对应会话；聚焦会话由 daemon 抑制。
//
// 端侧抑制（刻意不放 Hub 层——Hub 已有 notify 限速与 wake 冷却，再节流会违反
// 「消息不丢」）：
//   1. 每发送人合并窗口 SENDER_DEDUPE_MS：窗口内新消息累计为一条汇总通知；
//   2. 过期不弹 STALE_MS：入箱超过该时长的消息只入箱不弹（避免恢复在线后弹风暴）；
//   3. 每轮最多弹 MAX_TOASTS_PER_POLL 条，其余保留到下一轮（消息不丢，弹屏节流）。
// ---------------------------------------------------------------------------

/// 轮询间隔（本地未读计数探针无副作用，3s）
const NOTIFY_POLL_MS: u64 = 3_000;
/// 每发送人合并窗口：窗口内消息合并为一条通知，保留最后一条正文
const SENDER_DEDUPE_MS: u64 = 10 * 60_000;
/// 过期不弹：入箱超过该时长的消息恢复在线后不再弹（避免弹风暴）
const STALE_MS: u64 = 10 * 60_000;
/// 单轮最多弹屏数
const MAX_TOASTS_PER_POLL: usize = 3;

#[derive(serde::Deserialize, Default)]
struct InboxFrom {
    #[serde(default)]
    name: String,
    #[serde(default)]
    device: String,
}

fn http_get_json(url: &str) -> Option<serde_json::Value> {
    ureq::get(url)
        .timeout(std::time::Duration::from_secs(5))
        .call()
        .ok()?
        .into_json()
        .ok()
}

#[derive(serde::Deserialize, Default)]
struct ChatUnreadSnapshot {
    #[serde(default)]
    unread: i64,
}

#[derive(serde::Deserialize, Default)]
struct ChatListPeer {
    #[serde(default)]
    key: String,
    #[serde(default)]
    kind: String,
}

#[derive(serde::Deserialize, Default)]
struct ChatListEntry {
    #[serde(default)]
    peer: ChatListPeer,
    #[serde(default)]
    unread: i64,
}

#[derive(serde::Deserialize, Default)]
struct ChatListSnapshot {
    #[serde(default)]
    conversations: Vec<ChatListEntry>,
}

#[derive(serde::Deserialize, Default)]
struct PreviewMessage {
    #[serde(default)]
    id: String,
    #[serde(default)]
    at: u64,
    #[serde(default)]
    dir: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    from: Option<InboxFrom>,
}

#[derive(serde::Deserialize, Default)]
struct ApprovalListSnapshot {
    #[serde(default)]
    approvals: Vec<ApprovalRecord>,
}

#[derive(serde::Deserialize, Default)]
struct ApprovalRecord {
    #[serde(default, rename = "approvalId")]
    approval_id: String,
    #[serde(default, rename = "agentId")]
    agent_id: String,
    #[serde(default)]
    summary: String,
    #[serde(default, rename = "expiresAt")]
    expires_at: u64,
    #[serde(default)]
    state: String,
}

#[derive(serde::Deserialize, Default)]
struct ChatPreviewSnapshot {
    #[serde(default)]
    messages: Vec<PreviewMessage>,
}

fn preview_since(last_notified_at: Option<u64>) -> u64 {
    last_notified_at.unwrap_or(0)
}

fn notification_is_muted(suppressed: bool, muted: bool) -> bool {
    suppressed || muted
}

fn merged_notification_body(count: usize, last_text: &str) -> String {
    if count > 1 {
        format!("{count} 条新消息（最后一条：{last_text}）")
    } else {
        last_text.to_owned()
    }
}

fn notification_route(peer_key: &str) -> serde_json::Value {
    serde_json::json!({ "peerKey": peer_key })
}

fn approval_notification_route(peer_key: &str, approval_id: &str) -> serde_json::Value {
    serde_json::json!({ "peerKey": peer_key, "approvalId": approval_id })
}

/// 通知桥主循环（UI v2 批次1 数据源切换）：
/// 旧实现轮询 Hub `/api/yuyi/unread`（inbox 计数）——Owner 在线时回信走 notify
/// 直投不进 inbox，桌面通知永不弹（F1 反转）。新实现轮询 daemon 本地
/// `/api/yuyi/chat/unread`（notify 直投与 mail 降级两条路径全覆盖），差集用
/// `/api/yuyi/chat/preview`（只读、不 markRead，修 G6 副作用冲突）。
fn notify_loop(app: tauri::AppHandle) {
    let mut baseline_total: i64 = -1;
    let mut last_notified_at: HashMap<String, u64> = HashMap::new();
    let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut approval_states: HashMap<String, String> = HashMap::new();
    let mut last_toast_at: HashMap<String, u64> = HashMap::new();
    let mut pending: std::collections::BTreeMap<String, (String, usize, String)> =
        std::collections::BTreeMap::new();

    loop {
        std::thread::sleep(Duration::from_millis(NOTIFY_POLL_MS));
        let Some(base) = daemon_base_url() else {
            continue;
        };
        let Some(value) = http_get_json(&format!("{base}/api/yuyi/chat/unread")) else {
            continue;
        };
        let Ok(snapshot) = serde_json::from_value::<ChatUnreadSnapshot>(value) else {
            continue;
        };
        if baseline_total < 0 {
            baseline_total = snapshot.unread;
            continue;
        }
        let increased = snapshot.unread > baseline_total;
        baseline_total = snapshot.unread;
        let now_ms = now_millis();

        if let Some(value) = http_get_json(&format!("{base}/api/yuyi/approvals")) {
            if let Ok(list) = serde_json::from_value::<ApprovalListSnapshot>(value) {
                for approval in list.approvals {
                    if approval.approval_id.is_empty() || approval.expires_at <= now_ms {
                        continue;
                    }
                    let previous = approval_states.insert(
                        approval.approval_id.clone(),
                        approval.state.clone(),
                    );
                    if previous.as_deref() == Some("pending") || approval.state != "pending" {
                        continue;
                    }
                    let peer_key = format!("approval:{}", approval.approval_id);
                    let pending = pending
                        .entry(format!("审批 · {} · {}", approval.agent_id, approval.approval_id))
                        .or_insert_with(|| (peer_key.clone(), 0, String::new()));
                    pending.1 += 1;
                    pending.2 = approval.summary.chars().take(60).collect();
                }
            }
        }

        if increased {
            let Some(value) = http_get_json(&format!("{base}/api/yuyi/chat/list")) else {
                continue;
            };
            let Ok(list) = serde_json::from_value::<ChatListSnapshot>(value) else {
                continue;
            };
            for conversation in &list.conversations {
                if conversation.unread <= 0 || conversation.peer.kind == "observe" {
                    continue;
                }
                let peer_key = conversation.peer.key.clone();
                if peer_key.is_empty() {
                    continue;
                }
                if let Some(suppressed) = http_get_json(&format!(
                    "{base}/api/yuyi/chat/notify-suppressed?peer={}",
                    urlencode(&peer_key)
                )) {
                    let focused = suppressed
                        .get("suppressed")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false);
                    let muted = suppressed
                        .get("muted")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false);
                    if notification_is_muted(focused, muted) {
                        continue;
                    }
                }
                let since = preview_since(last_notified_at.get(&peer_key).copied());
                let Some(value) = http_get_json(&format!(
                    "{base}/api/yuyi/chat/preview?peer={}&since={since}",
                    urlencode(&peer_key)
                )) else {
                    continue;
                };
                let Ok(preview) = serde_json::from_value::<ChatPreviewSnapshot>(value) else {
                    continue;
                };
                for message in &preview.messages {
                    if message.dir != "in"
                        || message.id.is_empty()
                        || seen_ids.contains(&message.id)
                    {
                        continue;
                    }
                    seen_ids.insert(message.id.clone());
                    let current = last_notified_at.get(&peer_key).copied().unwrap_or(0);
                    if message.at > current {
                        last_notified_at.insert(peer_key.clone(), message.at);
                    }
                    if now_ms.saturating_sub(message.at) > STALE_MS {
                        continue;
                    }
                    let sender = message
                        .from
                        .as_ref()
                        .map(|from| {
                            if from.name.is_empty() {
                                from.device.clone()
                            } else {
                                from.name.clone()
                            }
                        })
                        .unwrap_or_else(|| peer_key.clone());
                    let last_text = if message.text.chars().count() > 60 {
                        let cut: String = message.text.chars().take(60).collect();
                        format!("{cut}…")
                    } else {
                        message.text.clone()
                    };
                    let pending = pending
                        .entry(sender)
                        .or_insert_with(|| (peer_key.clone(), 0, String::new()));
                    pending.0 = peer_key.clone();
                    pending.1 += 1;
                    pending.2 = last_text;
                }
            }
        }

        if seen_ids.len() > 4096 {
            seen_ids = seen_ids.into_iter().take(2048).collect();
        }
        let ready: Vec<String> = pending
            .keys()
            .filter(|sender| {
                last_toast_at
                    .get(*sender)
                    .map(|at| now_ms.saturating_sub(*at) >= SENDER_DEDUPE_MS)
                    .unwrap_or(true)
            })
            .take(MAX_TOASTS_PER_POLL)
            .cloned()
            .collect();
        for sender in ready {
            let Some((peer_key, count, last_text)) = pending.remove(&sender) else {
                continue;
            };
            use tauri_plugin_notification::NotificationExt;
            let shown = app
                .notification()
                .builder()
                .title(format!("御驿 · {sender}"))
                .body(merged_notification_body(count, &last_text))
                .extra("route", peer_key.strip_prefix("approval:").map(|approval_id| approval_notification_route(&peer_key, approval_id)).unwrap_or_else(|| notification_route(&peer_key)))
                .show();
            if shown.is_ok() {
                last_toast_at.insert(sender, now_ms);
            }
        }
    }
}

/// 最小 percent-encoding（query 值里的保留字符；peer 键为受限字符集，够用）
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'@' | b':' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// daemon 基地址（复用壳配置的 host:port）
fn daemon_base_url() -> Option<String> {
    let cfg = read_daemon_config()?;
    Some(format!("http://{}:{}", cfg.host(), cfg.port()))
}


#[cfg(test)]
mod notification_tests {
    use super::{approval_notification_route, merged_notification_body, notification_route, preview_since};

    #[test]
    fn a_new_peer_previews_from_the_beginning_so_its_first_recent_message_is_visible() {
        assert_eq!(preview_since(None), 0);
        assert_eq!(preview_since(Some(42)), 42);
    }

    #[test]
    fn repeated_messages_from_one_sender_are_merged_with_the_latest_text() {
        assert_eq!(merged_notification_body(1, "已完成"), "已完成");
        assert_eq!(
            merged_notification_body(3, "最后一条"),
            "3 条新消息（最后一条：最后一条）"
        );
    }

    #[test]
    fn the_notification_route_preserves_the_canonical_peer_key() {
        let route = notification_route("agent-1:workspace-a");
        assert_eq!(route["peerKey"], "agent-1:workspace-a");

        let task_route = notification_route("task:task_root");
        assert_eq!(task_route["peerKey"], "task:task_root");

        let approval_route = approval_notification_route("approval:approval-1", "approval-1");
        assert_eq!(approval_route["approvalId"], "approval-1");
    }
}


#[cfg(test)]
mod mute_tests {
    use super::notification_is_muted;

    #[test]
    fn muted_peers_do_not_toast_even_when_the_conversation_is_not_focused() {
        assert!(notification_is_muted(false, true));
        assert!(notification_is_muted(true, false));
        assert!(!notification_is_muted(false, false));
    }
}
