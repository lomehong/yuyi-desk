/**
 * 出站敏感凭证剥除（P0-2，fail-closed）——设备端 MCP 返回面专用。
 *
 * 与 Hub 侧 hub/redact.ts 的分工：Hub 只见验证结果不见 token 原文，做**形态**
 * 剥除；设备端 daemon 内存里持有真实凭证值（设备凭证 + 各映射 token），这里
 * 额外做**值**剥除——任何工具返回/错误串里出现这些原文一律替换为 [REDACTED]，
 * 叠加同样的凭证形态兜底。原则：凭证永不出现在 agent 可见的任何返回里。
 *
 * fail-closed：剥除自身异常时返回占位文本。
 */

export const REDACTED = "[REDACTED]"

/** denial 凭证形态（den_ 前缀 + ≥6 位凭据字符） */
const DENIAL_RE = /\bden_[A-Za-z0-9_-]{6,}\b/g
/** 带凭证前缀的长 hex token 形态（裸 hex 不剥——更可能是正常哈希） */
const LONG_TOKEN_RE = /\b(?:agent|dev|tok)-?[0-9a-fA-F]{32,}\b/g

/**
 * 剥除文本中的已知凭证值与凭证形态。
 * @param input 待检文本
 * @param knownSecrets 已知凭证原文（设备凭证、映射 token 等；空串自动忽略）
 */
export function redactSecrets(input: string, knownSecrets: readonly string[]): string {
  try {
    if (typeof input !== "string" || input.length === 0) return input
    let out = input.replace(DENIAL_RE, REDACTED).replace(LONG_TOKEN_RE, REDACTED)
    for (const secret of knownSecrets) {
      if (typeof secret !== "string" || secret.length < 8) continue // 过短值跳过（防误伤）
      if (out.includes(secret)) out = out.split(secret).join(REDACTED)
    }
    return out
  } catch {
    return REDACTED
  }
}
