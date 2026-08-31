# dsh-web-gemini-ext — Gemini 网页桥接（Chrome 扩展 + 服务端组件）

主 agent 与 gemini.google.com 之间的消息中转通道（免 API 配额）。
与 dsh-web-relay 的 `web-gemini` 通道配合使用。

## 组成

| 组件 | 位置 | 职责 |
|---|---|---|
| Chrome 扩展 | `manifest.json` + `background.js` + `content.js` | MV3 扩展：轮询 bridge 取任务、写入 Gemini 网页、回传答案 |
| 中转服务器 | `bridge-server.mjs` | localhost:8899 内存队列中转（/create-task /next-task /submit-answer /task-result /stats） |
| 守护进程 | `bridge-watchdog.mjs` | 每 5s 探测 bridge 存活，挂掉自动拉起（崩溃自愈 + 防风暴限速） |

## 部署

### 1. Chrome 扩展（开发者模式加载）

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本目录
4. 打开 https://gemini.google.com 并保持登录

### 2. 中转服务器（手动或守护）

```bash
node bridge-server.mjs        # 前台运行（localhost:8899）
```

推荐用守护进程（自动拉起 + 崩溃自愈）：

```bash
node bridge-watchdog.mjs      # 守护 bridge-server
```

Windows 开机自启（计划任务，AtLogOn 触发器）：

```powershell
# 已注册为 DSH-Bridge-Watchdog；如重建：
$action = New-ScheduledTaskAction -Execute '<node.exe 完整路径>' -Argument '<本目录>\bridge-watchdog.mjs' -WorkingDirectory '<本目录>'
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName 'DSH-Bridge-Watchdog' -Action $action -Trigger $trigger -Force
```

注意：node 若由 nvm 管理（`nodejs` 为 symlink），watchdog 内部会用
`fs.realpathSync(process.execPath)` 解引用到真实路径再 spawn，避免 ENOENT。

## CORS 允许源（扩展 ID）

`bridge-server.mjs` 内置了当前本机已加载扩展的默认 origin
（`chrome-extension://makbmohpkaccbgpdncjmfkdjmhcjnleg`），无需额外配置即可工作，
守护进程开机自启（计划任务）时也直接生效。

若换机器重新「加载已解压的扩展程序」、或扩展所在目录变化，Chrome 分配的扩展 ID 会变
（`chrome://extensions` 里对应本扩展卡片的 ID 字段），此时用环境变量覆盖，无需改代码：

```powershell
$env:DSH_BRIDGE_ORIGIN = "chrome-extension://<新 ID>"
```

## 校验

`/stats` 是业务端点，v0.4.0 起需要 token 鉴权（`/__token` 免鉴权，用于取 token）：

```bash
TOKEN=$(curl -s http://localhost:8899/__token | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -H "X-DSH-Bridge-Token: $TOKEN" http://localhost:8899/stats   # { ok:true, total, byStatus }
```

- bridge 存活 → `ok: true`
- 扩展轮询中 → `/next-task` 持续被请求（可在 bridge 控制台看到 `[req] GET /next-task`）

## 降级链位置（dsh-web-relay）

```
Gemini API (GEMINI_API_KEY) → web-gemini 网页通道（本组件）→ 对话模型 dialog → 手动
```

- ask 通道：`provider=web-gemini` 或 gemini-free API 失败时自动降级到本通道
- review 通道：`reviewChannel=auto` 且 API 失败时降级到本通道
