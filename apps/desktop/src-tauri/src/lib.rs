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

#[tauri::command]
fn app_identity() -> &'static str {
    "yuyi-desk/0.2.0"
}

#[tauri::command]
fn daemon_status(state: tauri::State<DaemonChild>) -> bool {
    state.0.lock().map(|g| g.is_some()).unwrap_or(false)
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
    /// 附加/覆盖环境变量（如 PASEO_HOME）
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
    let path = exe_dir()?.join("yuyi-daemon.json");
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
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
    let Ok(log) = fs::OpenOptions::new().create(true).append(true).open(&log_path) else {
        return None;
    };
    let mut cmd = Command::new(&cfg.command);
    cmd.args(&cfg.args)
        .envs(&cfg.env)
        .current_dir(&dir)
        .stdout(Stdio::from(log.try_clone().ok()?))
        .stderr(Stdio::from(log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW：daemon 是后台进程，不弹控制台
        cmd.creation_flags(0x0800_0000);
    }
    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(err) => {
            eprintln!("[yuyi-desk] daemon spawn failed: {err}");
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
        return;
    };
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
        .manage(DaemonChild(slot))
        .invoke_handler(tauri::generate_handler![app_identity, daemon_status])
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
        }
    });
}
