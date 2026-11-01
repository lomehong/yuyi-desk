# 发布与自更新流程（Yuyi Desk）

## 状态

- **更新器骨架已就位**：签名密钥对已生成（`.updater-keys/`，已 gitignore——**私钥丢失则已发版本无法再更新，务必备份**）。
- **未激活**：无更新服务器前不启用 updater 插件（激活方式见下），当前版本不带更新检查。

## 首次激活（需要：一台更新文件托管点）

1. `tauri.conf.json` 增加：
   ```jsonc
   "createUpdaterArtifacts": true,
   "plugins": {
     "updater": {
       "pubkey": "<.updater-keys/yuyi-desk.key.pub 的内容>",
       "endpoints": ["https://<你的托管>/yuyi-desk/{{target}}/{{arch}}/{{current_version}}"]
     }
   }
   ```
2. Cargo 加依赖 `tauri-plugin-updater = "2"` 并在 `lib.rs` 注册插件。
3. capabilities 加 `updater:default`。

## 每次发布

```bash
# 1) 构建签名产物（TAURI_SIGNING_* 指向 .updater-keys 私钥）
export TAURI_SIGNING_PRIVATE_KEY_PATH=.updater-keys/yuyi-desk.key
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run build

# 2) 产物（bundle/nsis/）
#    Yuyi Desk_0.1.0_x64-setup.exe            —— 完整安装包
#    Yuyi Desk_0.1.0_x64-setup.exe.sig        —— updater 签名

# 3) 上传 setup.exe + .sig 到托管点，并更新 latest.json：
{
  "version": "0.2.0",
  "notes": "…",
  "platforms": {
    "windows-x86_64": {
      "signature": "<.sig 文件内容>",
      "url": "https://<你的托管>/yuyi-desk/Yuyi Desk_0.2.0_x64-setup.exe"
    }
  }
}
```

## 代码签名（Authenticode，与 updater 签名是两回事）

- 目的：消除 SmartScreen「未知发布者」警告。
- 需要：向 CA（DigiCert/Sectigo/SSL.com 等）购买 OV/EV 代码签名证书。
- 签法：`signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a "<setup.exe>"`
- 挂点：`tauri build` 后手动签，或 NSIS hook（待证书到位后接）。
