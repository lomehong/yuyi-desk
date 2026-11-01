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

use tauri::{AppHandle, Manager, RunEvent};

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
    let cfg = guard.as_ref().ok_or_else(|| "daemon config not loaded".to_string())?;
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
    let cfg = guard.as_ref().ok_or_else(|| "daemon config not loaded".to_string())?;
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
    file.seek(SeekFrom::Start(start)).map_err(|e| e.to_string())?;
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
    std::env::current_exe().ok().and_then(|p| p.parent().map(Into::into))
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
    let mut log = fs::OpenOptions::new().create(true).append(true).open(&log_path).ok();
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
            if let Ok(mut l) = fs::OpenOptions::new().create(true).append(true)
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
    eprintln!("[yuyi-desk] daemon not ready within {}ms", cfg.ready_timeout_ms());
}

pub fn run() {
    let slot: DaemonSlot = Arc::default();
    let exit_slot = Arc::clone(&slot);
    let app = tauri::Builder::default()
        // 单实例：二次启动把已有窗口带到前台（防双开撞 daemon/数据目录）
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .manage(DaemonChild(Arc::clone(&slot)))
        .manage(DaemonConfigSlot::default())
        .invoke_handler(tauri::generate_handler![
            app_identity,
            daemon_status,
            yuyi_daemon_info,
            yuyi_local_credential,
            yuyi_daemon_log_tail
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || ensure_daemon(&handle));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running yuyi desk");

    app.run(move |_app_handle, event| {
        if let RunEvent::Exit = event {
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
    eprintln!("[yuyi-desk] orphan daemon tree cleanup issued (install={})", install);
}
