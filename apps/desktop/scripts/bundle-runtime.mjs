/**
 * M3 分发：组装 Tauri 打包资源（src-tauri/resources/）。
 *
 * 方案照抄上游 docker/base/Dockerfile：npm pack 各 workspace 成 tgz（--ignore-scripts，
 * 跳过 prepack——server 的 build:daemon-web-ui 依赖 expo export 且被 nvm shim 绊倒），
 * 再一次性安装到独立目录（--prefix，不污染全局）——得到完整生产依赖树。
 *
 * 已知坑（本轮打包实证，勿删对应处理）：
 *   1. @qianji/core、@qianji/protocol 在 server 的 dependencies 里是 file: 本地路径，
 *      npm install 会装成 junction 指向打包机本地目录——用户机器上不存在、Tauri 也拒绝
 *      打包外部链接 → 安装后从 Yuyi 工作区拷实体包替换，并删除树内的 Yuyi/ 副本目录。
 *   2. server dist 里的 web-ui 资产含 expo 超长文件名（__node_modules/...hash.png），
 *      超 Windows MAX_PATH，makensis 打不开 → 从树中剔除 web-ui（daemon 的浏览器 UI
 *      为可选项；桌面壳用本地 web-dist，手机走 WS/API，均不受影响）。
 *   3. 原始反斜杠路径是非法 JSON 转义——yuyi-daemon.json 模板统一用正斜杠，
 *      壳首启解析 {{INSTALL_DIR}}/{{DATA_DIR}} 时也产正斜杠。
 *
 * 布局（NSIS 安装后位于 <installdir>）：
 *   runtime/node.exe
 *   runtime/server-runtime/node_modules/…（含 @getpaseo/server/dist、@qianji/* 实体）
 *   yuyi-daemon.json
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const yuyiRepo = resolve(repo, "..", "Yuyi");
const nodeExe = "C:/Program Files/nodejs/node.exe";
const out = resolve(here, "../src-tauri/resources");
const packs = resolve(here, "../.packs");
const treeNm = join(out, "runtime", "server-runtime", "node_modules");
const serverEntryInTree = join(
  treeNm,
  "@getpaseo",
  "server",
  "dist",
  "scripts",
  "supervisor-entrypoint.js",
);

const WORKSPACES = [
  "@getpaseo/highlight",
  "@getpaseo/relay",
  "@getpaseo/protocol",
  "@getpaseo/client",
  "@getpaseo/plugin",
  "@getpaseo/server",
];

const entry = join(repo, "packages", "server", "dist", "scripts", "supervisor-entrypoint.js");
if (!existsSync(entry)) {
  console.error("[bundle] 缺少 server dist —— 先在 packages/server 跑 npm run build");
  process.exit(1);
}
if (!existsSync(nodeExe)) {
  console.error(`[bundle] 缺少 Node 运行时：${nodeExe}`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
rmSync(packs, { recursive: true, force: true });
mkdirSync(join(out, "runtime"), { recursive: true });
mkdirSync(packs, { recursive: true });
cpSync(nodeExe, join(out, "runtime", "node.exe"));

// 1) pack 各 workspace（--ignore-scripts：见文件头坑 1 说明）
console.log("[bundle] npm pack workspaces (--ignore-scripts)…");
for (const w of WORKSPACES) {
  execSync(`npm pack --ignore-scripts --workspace=${w} --pack-destination "${packs}"`, {
    cwd: repo,
    stdio: "inherit",
  });
}

// 2) 安装 tgz 成生产树（Windows cmd 不展开 glob——由 readdir 枚举后逐个传入）
console.log("[bundle] npm install production tree…");
const tgzFiles = readdirSync(packs)
  .filter((f) => f.endsWith(".tgz"))
  .map((f) => `"${join(packs, f)}"`);
if (tgzFiles.length === 0) {
  console.error("[bundle] .packs 里没有 tgz");
  process.exit(1);
}
execSync(`npm install --prefix "${join(out, "runtime", "server-runtime")}" ${tgzFiles.join(" ")}`, {
  cwd: repo,
  stdio: "inherit",
});

// 3) @qianji/* 实体化（file: 依赖会装成 junction——见文件头坑 2）
console.log("[bundle] materialize @qianji/* …");
const qianjiDest = join(treeNm, "@qianji");
rmSync(join(qianjiDest, "core"), { recursive: true, force: true });
rmSync(join(qianjiDest, "protocol"), { recursive: true, force: true });
cpSync(join(yuyiRepo, "packages", "protocol"), join(qianjiDest, "protocol"), {
  recursive: true,
  dereference: true,
});
cpSync(join(yuyiRepo, "packages", "core"), join(qianjiDest, "core"), {
  recursive: true,
  dereference: true,
});
rmSync(join(out, "runtime", "server-runtime", "Yuyi"), { recursive: true, force: true });

// 4) 剔除 web-ui（expo 超长文件名撞 MAX_PATH——见文件头坑 3）
const webUiInTree = join(treeNm, "@getpaseo", "server", "dist", "server", "web-ui");
if (existsSync(webUiInTree)) {
  rmSync(webUiInTree, { recursive: true, force: true });
  console.log("[bundle] stripped web-ui from tree (MAX_PATH)");
}

if (!existsSync(serverEntryInTree)) {
  console.error(`[bundle] 生产树缺 server 入口：${serverEntryInTree}`);
  process.exit(1);
}

// 5) daemon 配置模板（占位符由壳首启解析；正斜杠——见文件头坑 4）
writeFileSync(
  join(out, "yuyi-daemon.json"),
  JSON.stringify(
    {
      host: "127.0.0.1",
      port: 6767,
      command: "{{INSTALL_DIR}}/runtime/node.exe",
      args: [
        "{{INSTALL_DIR}}/runtime/server-runtime/node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js",
      ],
      env: { YUYI_DESK_HOME: "{{DATA_DIR}}" },
      ready_timeout_ms: 60000,
    },
    null,
    2,
  ),
);

rmSync(packs, { recursive: true, force: true });
console.log(`[bundle] resources 就绪：${out}`);
