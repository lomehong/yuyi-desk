/**
 * 同步 Expo web 构建到 Tauri 壳（apps/desktop/web-dist），并做三件事：
 *   1. 注入初始 daemon 连接提示（window.__PASEO_INITIAL_DAEMON_CONNECTION__，
 *      形如 { listen, useTls }）——壳内首启即自动连本机 daemon；
 *   2. 标题改写为「御驿 Yuyi Desk」（品牌改动收敛在 web-dist，不动上游标识）；
 *   3. 注入无边框窗口自绘标题栏（拖动 + 最小化/最大化/关闭，__TAURI__ 全局 API）。
 *
 * 环境变量：
 *   YUYI_DESK_DAEMON   缺省 127.0.0.1:6767（paseo daemon 默认端口）
 *   YUYI_DESK_USE_TLS  缺省 false
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../..", "packages", "app", "dist");
const dest = resolve(here, "..", "web-dist");
const listen = process.env.YUYI_DESK_DAEMON ?? "127.0.0.1:6767";
const useTls = process.env.YUYI_DESK_USE_TLS === "true";

if (!existsSync(resolve(src, "index.html"))) {
  console.error(`[sync-web] 缺少 ${src}/index.html —— 先在 packages/app 跑 npm run build:web`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

const indexPath = resolve(dest, "index.html");
const injected = `<script>window.__PASEO_INITIAL_DAEMON_CONNECTION__=${JSON.stringify({
  listen,
  useTls,
})};</script>`;
let html = readFileSync(indexPath, "utf8");
if (!html.includes("__PASEO_INITIAL_DAEMON_CONNECTION__")) {
  html = html.replace(/<head([^>]*)>/i, `<head$1>${injected}`);
}
html = html.replace(/<title>[^<]*<\/title>/i, "<title>御驿 Yuyi Desk</title>");
// 容器底色兜底：WebView 根默认白底会在圆角缝隙和启动瞬间透白——注入深色背景
// （默认深色主题 surfaceSidebar；运行时主题由应用自身绘制）
if (!html.includes("yuyi-root-bg")) {
  html = html.replace(
    /<head([^>]*)>/i,
    `<head$1><style id="yuyi-root-bg">html,body{background:#141716;}</style>`,
  );
}
// M2e：无边框窗口的自绘标题栏已由 app 内建（yuyi/shell-frame 顶栏 + 桥垫片），
// 不再注入旧标题栏——保留 daemon 提示与标题改写。
writeFileSync(indexPath, html);
console.log(`[sync-web] web-dist 就绪（daemon: ${listen}, tls: ${useTls}, 帧模式: app 内建）`);
