/**
 * 同步 Expo web 构建到 Tauri 壳（apps/desktop/web-dist），并注入初始 daemon
 * 连接提示（host-runtime.ts 读取 window.__PASEO_INITIAL_DAEMON_CONNECTION__，
 * 形如 { listen, useTls }）——壳内首启即自动连本机 daemon，无需手动添加主机。
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
// 御驿品牌：壳内标题改写（不动 packages/app 的上游标识，改动收敛在 web-dist）
html = html.replace(/<title>[^<]*<\/title>/i, "<title>御驿 Yuyi Desk</title>");
writeFileSync(indexPath, html);
console.log(`[sync-web] web-dist 就绪（初始 daemon: ${listen}, tls: ${useTls}）`);
