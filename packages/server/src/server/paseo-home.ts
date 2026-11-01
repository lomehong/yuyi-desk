import os from "node:os";
import path from "node:path";

function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) {
    return path.join(os.homedir(), input.slice(2));
  }
  if (input === "~") {
    return os.homedir();
  }
  return input;
}

export function resolvePaseoHome(env: NodeJS.ProcessEnv = process.env): string {
  // yuyi fork: 数据目录归御驿（~/.yuyi-desk）；env 新名 YUYI_DESK_HOME 优先，
  // PASEO_HOME 作为上游兼容回退（上游脚本/肌肉记忆不炸）。
  const raw = env.YUYI_DESK_HOME ?? env.PASEO_HOME ?? "~/.yuyi-desk";
  const resolved = path.resolve(expandHomeDir(raw));
  return resolved;
}
