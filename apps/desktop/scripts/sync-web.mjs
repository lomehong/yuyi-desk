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

const TITLEBAR_HEIGHT = "34px";

const TITLEBAR_SNIPPET = `
<style id="yuyi-titlebar-style">
  #yuyi-titlebar{position:fixed;top:0;left:0;right:0;height:${TITLEBAR_HEIGHT};z-index:2147483000;
    display:flex;align-items:center;justify-content:space-between;
    background:#14213b;color:#cfd8e3;font:12px/1 "Segoe UI","Microsoft YaHei",sans-serif;
    user-select:none;-webkit-user-select:none;cursor:default;}
  #yuyi-titlebar .yuyi-brand{display:flex;align-items:center;gap:8px;padding:0 12px;height:100%;}
  #yuyi-titlebar .yuyi-dot{width:10px;height:10px;border-radius:5px;background:#5a94cd;flex:none;}
  #yuyi-titlebar .yuyi-wbtns{display:flex;height:100%;flex:none;}
  #yuyi-titlebar button{width:46px;height:100%;border:0;background:transparent;color:#cfd8e3;
    font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}
  #yuyi-titlebar button:hover{background:#26456f;color:#fff;}
  #yuyi-titlebar #yuyi-close:hover{background:#c42b1c;color:#fff;}
</style>
<div id="yuyi-titlebar" data-tauri-drag-region>
  <span class="yuyi-brand" data-tauri-drag-region><span class="yuyi-dot"></span>御驿 Yuyi Desk</span>
  <span class="yuyi-wbtns">
    <button id="yuyi-min" title="最小化" aria-label="最小化">&#x2500;</button>
    <button id="yuyi-max" title="最大化 / 还原" aria-label="最大化或还原">&#x25A1;</button>
    <button id="yuyi-close" title="关闭" aria-label="关闭">&#x2715;</button>
  </span>
</div>
<script>
(function () {
  function boot() {
    var root = document.getElementById("root");
    if (root) {
      root.style.setProperty("margin-top", "${TITLEBAR_HEIGHT}", "important");
      root.style.setProperty("height", "calc(100% - ${TITLEBAR_HEIGHT})", "important");
    }
    var api = window.__TAURI__ && window.__TAURI__.window;
    var bar = document.getElementById("yuyi-titlebar");
    if (!api || !bar) return;
    var win = api.getCurrentWindow();
    document.getElementById("yuyi-min").addEventListener("click", function () { win.minimize(); });
    document.getElementById("yuyi-max").addEventListener("click", function () { win.toggleMaximize(); });
    document.getElementById("yuyi-close").addEventListener("click", function () { win.close(); });
    // 双击标题栏 = 最大化/还原（与拖动区同元素）
    bar.addEventListener("dblclick", function (e) {
      if (e.target.closest("button")) return;
      win.toggleMaximize();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
</script>
`;

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
if (!html.includes('id="yuyi-titlebar"')) {
  html = html.replace(/<\/body>/i, `${TITLEBAR_SNIPPET}\n</body>`);
}
writeFileSync(indexPath, html);
console.log(`[sync-web] web-dist 就绪（daemon: ${listen}, tls: ${useTls}, 标题栏: 已注入）`);
