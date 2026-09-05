# dsh-web-relay 宿主托管与重启续跑运维 SOP（OPS-RESTART-RESUME）

> 版本：4.x（AutoIteration 实验 V2 编写，expr-2026-09-05_13-58-07）
> 适用：watchdog 托管部署（DSH-WEB-Watchdog / DSH-Bridge-Watchdog 计划任务 + bin/watchdog.mjs v3.9.3+）

## 1. 架构总览

```
tailscale serve (--bg 持久, https://win10-dt... → 127.0.0.1:3080)
        │
DSH-WEB-Watchdog (计划任务 AtLogOn → dsh-web-watchdog.cmd → bin/watchdog.mjs)
   ├─ 托管宿主 dsh web（3080，子进程；miss≥3→prepare→树杀→拉起；首检 2s；单例锁）
   ├─ env 补注入：GEMINI_API_KEY（注册表 User→Machine 回读）、DSH_WEB_ARGS(--trusted-host)、DSH_RELAY_WORKSPACE
   └─ 总守护桥接：8899 掉线且 DSH-Bridge-Watchdog 未运行 → 自动拉起
```

## 2. 重启续跑机制（v4.0）

- **bootId**：宿主进程唯一标识（`Date.now(36)-UUID8`），`/health-check` 暴露；stepState 每次写盘打戳 `bootId=CURRENT_BOOT_ID`。
- **续跑判定**：宿主启动（apply 尾 `bootResumeScan`）扫描 `web-relay/experiments/*.steps.json`——`executing/review/activeSteps 非空` **且** `bootId ≠ 当前宿主` → 判为跨重启中断。
- **动作**：`restartCount+1`；<2 → resume：trace `[system]` 留痕 + `wakeMainAgent(sessionId)` 自动唤醒原会话续跑（无 sessionId → 降级留痕，等用户「继续」）；≥2 → **paused 熔断**（stopReason「重启续跑熔断…」）。
- **跨重启保持**：`rejectStreak` / `iterationBaseCommit` / `incrementalStreak` 不重置。
- 手动触发：`POST /dsh-web-relay/admin/resume-scan {workspacePath?}`（运维/E2E）。

## 3. 面板徽标含义（v4.1）

| 徽标 | 含义 |
|---|---|
| `boot:xxxxxxxx`（灰 mono） | 宿主进程标识末 8 位；重启前后变化=宿主换代 |
| 琥珀「优雅停机准备中」 | /health-check.preparing=true（prepare-restart 已触发，停收新任务） |
| `↻ 重启续接 N · 宿主已重启·自动续跑`（紫） | stepState.restartCount>0，任务跨宿主重启自动续跑中 |
| `⛔ 重启续跑熔断·已跨重启 N`（红） | status=paused 且 stopReason 含「重启续跑熔断」——需人工介入 |
| `⚠ 非 git 降级` / `回滚基线` / `已回滚到…` | rollbackDegraded / iterationBaseCommit / rollback 历史 |

## 4. 应急手动恢复 SOP

1. **宿主不在（3080 无响应）**：查 watchdog 日志 `C:\Users\Administrator\.dsh\logs\dsh-web-watchdog.log` → 若 watchdog 未运行：`Start-ScheduledTask DSH-WEB-Watchdog`（会自动拉起宿主）；仍失败 → 手动 `dsh web`（勿双开，先确认无 watchdog）。
2. **任务中断未续**：查该 expr steps.json `restartCount/bootId` 与 trace `[system] 宿主重启续跑` → 手动 `POST /admin/resume-scan {workspacePath}`；或面板对相关 expr 点「开始/重开」。
3. **熔断 paused**：查 stopReason；确认根因（崩溃步骤/无限重启）后修复代码 → 面板 resume 或改 restartCount 后重扫。
4. **gemini=false**：确认宿主 env 含 GEMINI_API_KEY（注册表 User/Machine）——watchdog 拉起时会自动补注入；手动启动需自行设置。
5. **远程 ts.net 失效**：`tailscale serve status`（应显示 proxy 3080）；无则 `tailscale serve --bg --https=443 http://127.0.0.1:3080`。

## 5. 常用验证命令

```powershell
# 托管状态
Get-ScheduledTask DSH-WEB-Watchdog | Select State
(Invoke-RestMethod 'http://127.0.0.1:3080/dsh-web-relay/health-check') | ConvertTo-Json  # bootId/preparing
# 续跑扫描（手动）
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3080/dsh-web-relay/admin/resume-scan' -ContentType 'application/json' -Body '{"workspacePath":"D:\\dsh relay test"}'
# watchdog 日志
Get-Content 'C:\Users\Administrator\.dsh\logs\dsh-web-watchdog.log' -Tail 20
```
