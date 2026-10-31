//! 御驿 Yuyi Desk — Tauri 桌面壳
//!
//! M2a：纯壳（WebView2 装载 web-dist 的 Expo web 构建，用户在应用内添加 daemon 主机）。
//! 后续：初始 daemon 连接注入（sync-web 已在 index.html 预置全局提示）、
//! daemon sidecar 生命周期管理。

#[tauri::command]
fn app_identity() -> &'static str {
    "yuyi-desk/0.1.0"
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_identity])
        .run(tauri::generate_context!())
        .expect("error while running yuyi desk");
}
