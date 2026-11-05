# 安全

御驿 Yuyi Desk 采用本地优先架构：daemon 跑在你自己的机器上，代码不出本机；
远程消息面经御驿 Hub（TLS）中转，所有跨设备主体经御符身份验证。

## 架构边界

- daemon 仅监听本机回环（默认 127.0.0.1:6767），本地凭证
  （`~/.yuyi-desk/local-credential`，0600）保护本地 WebSocket API。
- 与 Hub 的连接使用设备凭证 + 逐 Agent 身份验证（御符）。
- 管理面操作（闸门 block/release/terminate）有审计留痕
  （`~/.yuyi-desk/yuyi-gate-events.jsonl`）。

## 报告漏洞

不要公开披露可利用细节。通过项目维护者的私下渠道报告，我们会尽快跟进。
