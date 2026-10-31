"""一次性为 9 个 locale 文件补御驿 i18n key（sidebar.sections.yuyi + 顶级 yuyi 块）。
en 为类型源；zh-CN 中文；其余语言英文兜底（后续再翻）。幂等：已存在则跳过。"""
import re
from pathlib import Path

RES = Path("E:/Development/Code/nodejs/yuyi-desk/packages/app/src/i18n/resources")

EN = {
    "title": "Yuyi", "tabStatus": "Status", "tabInbox": "Inbox", "tabPeers": "Peers",
    "refresh": "Refresh", "connected": "Connected", "yes": "Yes", "no": "No",
    "hub": "Hub", "device": "Device", "principal": "Principal", "bindings": "Bindings",
    "inboxEmpty": "Inbox is empty", "markAllRead": "Mark all read", "markedRead": "Cleared",
    "peersEmpty": "No peers visible", "from": "From",
    "errorInactive": "Yuyi link inactive", "errorNoHttp": "Yuyi requires a direct daemon connection",
}
ZH = {
    "title": "御驿", "tabStatus": "状态", "tabInbox": "收件箱", "tabPeers": "同伴",
    "refresh": "刷新", "connected": "已连接", "yes": "是", "no": "否",
    "hub": "Hub", "device": "设备", "principal": "主体", "bindings": "身份绑定",
    "inboxEmpty": "收件箱为空", "markAllRead": "全部标为已读", "markedRead": "已清读",
    "peersEmpty": "暂无可见同伴", "from": "来自",
    "errorInactive": "御驿链接未激活", "errorNoHttp": "御驿需要直连 daemon 的主机连接",
}

def block(d, indent="  "):
    lines = [f"{indent}yuyi: {{"]
    lines += [f"{indent}  {k}: {v!r},".replace("'", '"', 2) for k, v in d.items()]
    lines.append(f"{indent}}},")
    return "\n".join(lines)

def sidebar_label(locale):
    return "御驿" if locale == "zh-CN" else "Yuyi"

for path in sorted(RES.glob("*.ts")):
    if path.name == "plugin-settings.ts":
        continue
    locale = path.stem
    text = path.read_text(encoding="utf-8")
    changed = False

    # 1) sidebar.sections.yuyi —— 定位含 sessions:/search:/schedules: 的 sections 块
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if re.match(r"\s*sections: \{", line):
            window = "\n".join(lines[i:i + 6])
            if "sessions:" in window and "search:" in window:
                for j in range(i, min(i + 6, len(lines))):
                    if re.match(r"\s*schedules: ", lines[j]):
                        indent = re.match(r"(\s*)", lines[j]).group(1)
                        new = f'{indent}yuyi: "{sidebar_label(locale)}",'
                        if not any(re.match(r"\s*yuyi: ", x) for x in lines[i:j + 3]):
                            lines.insert(j + 1, new)
                            changed = True
                        break
                break
    text = "\n".join(lines)

    # 2) 顶级 yuyi 块 —— 插在 export const XX = { 之后
    if "  yuyi: {" not in text:
        m = re.search(r"^export const \w+ = \{$", text, re.MULTILINE)
        if m:
            entry = block(ZH if locale == "zh-CN" else EN)
            text = text[: m.end()] + "\n" + entry + text[m.end():]
            changed = True

    if changed:
        path.write_text(text, encoding="utf-8")
        print(f"[i18n] {locale}: +yuyi")
    else:
        print(f"[i18n] {locale}: skip")
