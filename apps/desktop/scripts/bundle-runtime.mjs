/**
 * M3 分发：组装 Tauri 打包资源（src-tauri/resources/）。
 *
 * 方案照抄上游 docker/base/Dockerfile：npm pack 各 workspace 成 tgz，
 * 再一次性安装到独立目录（--prefix，不污染全局）——得到完整生产依赖树。
 *
 * 布局（NSIS 安装后位于 <installdir>）：
 *   runtime/node.exe                       —— 捆绑的 Node 运行时
 *   runtime/server-runtime/node_modules/…  —— 生产依赖树（含 @getpaseo/server/dist）
 *   yuyi-daemon.json                       —— 壳拉起配置模板（占位符安装后首启解析）
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const nodeExe = "C:/Program Files/nodejs/node.exe";
const out = resolve(here, "../src-tauri/resources");
const packs = resolve(here, "../.packs");
const serverEntryInTree = join(
  out,
  "runtime",
  "server-runtime",
  "node_modules",
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

// 1) pack 各 workspace（上游 Dockerfile 同款；跳过 prepare 脚本避免全量重建）
console.log("[bundle] npm pack workspaces…");
execSync(
  [
    "node -e \"const fs=require('node:fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8')); delete p.scripts.prepare; fs.writeFileSync('package.json', JSON.stringify(p))\"",
    ...WORKSPACES.map(
      (w) => `npm pack --workspace=${w} --pack-destination "${packs}"`,
    ),
  ].join(" && "),
  { cwd: repo, stdio: "inherit" },
);

// 2) 安装 tgz 成生产树（--prefix 独立目录，非全局）
console.log("[bundle] npm install production tree…");
execSync(`npm install --prefix "${join(out, "runtime", "server-runtime")}" "${packs}"/*.tgz`, {
  cwd: repo,
  stdio: "inherit",
});

if (!existsSync(serverEntryInTree)) {
  console.error(`[bundle] 生产树缺 server 入口：${serverEntryInTree}`);
  process.exit(1);
}

// 3) daemon 配置模板（占位符由壳首启解析）
writeFileSync(
  join(out, "yuyi-daemon.json"),
  JSON.stringify(
    {
      host: "127.0.0.1",
      port: 6767,
      command: "{{INSTALL_DIR}}/runtime/node.exe",
      args: ["{{INSTALL_DIR}}/runtime/server-runtime/node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js"],
      env: { PASEO_HOME: "{{PASEO_HOME}}" },
      ready_timeout_ms: 60000,
    },
    null,
    2,
  ),
);

rmSync(packs, { recursive: true, force: true });
console.log(`[bundle] resources 就绪：${out}`);
