# dsh-web-relay WSL/Linux 移植说明（LINUX-PORT）

> 版本：v4.9.2（外部 AI 规划 expr-2026-09-07_14-31-13，排位 A→B→C→D，lx_1-5）
> 目标：WSL Ubuntu（或其他 Linux）下安装 dsh harness + dsh-web-relay 三步后，能力可迁移性评估与适配件。

## 1. 兼容性矩阵（审计结论 2026-09-07）

| 能力 | Windows | WSL/Linux | 说明 |
|---|---|---|---|
| 插件核心 lib/（审核降级链 v2.0 / alternatives / 并发批 / 心跳 / 续跑状态机 / 协议 v2.0）| ✅ | ✅ 直接可用 | 纯 Node ESM；execSync 仅 git；无 Windows 路径硬编码 |
| 能力包（docs/skills/lessons 37/registry 17/verify 脚本）| ✅ | ✅ 100% 可迁移 | 纯文件 + Node fs；skills 热读 `~/.dsh/skills` 跨平台 |
| 混合架构（cc-channel + D:\cc-tasks runner/cc-watchdog）| ✅ | ✅ WSL 原生更优 | runner.sh/cc-watchdog.sh 本就是 bash；无 /mnt 桥接；`DSH_CC_TASKS_ROOT` env 指 Linux 路径 |
| 无介入续跑（sessionId 注入 apiProxy / 心跳）| ✅ | ✅ | apiProxy + bootResumeScan 纯逻辑跨平台 |
| 宿主托管 watchdog（自愈/kill-host/restart-sync/密钥注入）| ✅ | ⚠️ 需适配 | Windows 专属（taskkill/netstat/注册表/计划任务）→ lib/platform-ops.js 抽象（lx_1/lx_2）|
| 安装脚本 | install-new-env.ps1 | install-new-env.sh（lx_3）| bash 幂等版 |
| web-gemini bridge（Chrome 扩展 8899）| ✅ | ⚠️ 可选 | WSL 需 GUI Chrome + 扩展连 WSL bridge；不用则 gemini API key 直连 + claude-code/dialog 兜底 |
| GEMINI_API_KEY | 注册表（watchdog 回读）| ~/.dsh/env 或环境变量 | platform-ops readSecret linux 分支 |

**结论**：插件运行能力 + 能力持久化体系在 Linux **基本零改动可用**；唯一实质缺口是 watchdog 宿主托管层的平台适配（已由 lx_1/lx_2 抽象层解决，Windows 行为不变）。

## 2. Linux 安装步骤（对应三步）

### 前置
```bash
# Node ≥18、dsh profile 初始化、git；WSL 建议 systemd 可用（`systemctl --user`）
node -v && dsh --version
# （混合架构可选）Claude Code 登录
claude auth status   # loggedIn
```

### Step 1 — 插件
```bash
bash scripts/install-new-env.sh -s <plugin_root> -p web -n     # 演练
bash scripts/install-new-env.sh -s <plugin_root> -p web        # 实装（复制 lib/bin/package/cordis.patch + cordis.patch.yml 追加行）
# 重启 dsh web（Host half 生效；client.js 改动走 HMR）
```

### Step 2 — 能力包
```bash
bash scripts/install-new-env.sh -c dist/dsh-relay-capability-pack-4.9.2.tar.gz -n
bash scripts/install-new-env.sh -c dist/dsh-relay-capability-pack-4.9.2.tar.gz   # skills → ~/.dsh/skills + docs/scripts 参照
# 验证
node scripts/verify-capabilities.mjs && node scripts/verify-lessons.mjs
```

### Step 3 — 环境件（watchdog 守护 + env）
```bash
bash scripts/install-new-env.sh -s <plugin_root>   # 自动注册 systemd --user dsh-web-watchdog（或 crontab @reboot）
# env 模板（写入 ~/.dsh/env，platform-ops readSecret 读取）
cat >> ~/.dsh/env <<'EOF'
DSH_RELAY_REPO=<plugin_root>
DSH_CC_TASKS_ROOT=<cc-tasks 目录，如 ~/cc-tasks>
GEMINI_API_KEY=<key>      # 或 export 到环境
# DSH_SESSION_ID=<harness 会话 ID>  # 续跑注入（见 OPS-RESTART-RESUME §6）
EOF
```

## 3. 环境变量模板（Linux）

| 变量 | 用途 | Windows 对应 |
|---|---|---|
| `DSH_RELAY_REPO` | 装配 docs/能力指针（REPO_ROOT）| setx DSH_RELAY_REPO |
| `DSH_CC_TASKS_ROOT` | 混合架构派发目录（默认 D:\cc-tasks）| setx（默认即 Windows 路径）|
| `GEMINI_API_KEY` | gemini-free 通道 | 注册表（watchdog 回读）|
| `DSH_SESSION_ID` | 无介入续跑注入（expr 未落盘时回退）| 同 |
| `DSH_RELAY_HEARTBEAT_MS` | 心跳周期（默认 15min；0=关）| 同 |
| `DSH_RELAY_BATCH_CONCURRENCY` | 并发审核批上限 | 同 |

## 4. 适配件清单（lx_1-lx_3 产物）

- `lib/platform-ops.js`：watchdog 跨平台抽象层（win/linux 双实现；findPortPid/killPidTree/readSecret/scheduledTaskStatus；可注入 exec 单测）——watchdog.mjs 按 process.platform 选用，Windows 行为零回归。
- `bin/watchdog.mjs`（lx_2 接线）：readRegistryEnv/findPortPid/killPidTree 改为经 platform-ops（linux：ss/lsof + pkill/kill + ~/.dsh/env + systemd/cron）。
- `scripts/install-new-env.sh`（lx_3）：bash 幂等三步 + `-n` 演练。
- （产物由 Claude Code kind=implement 实现，主 agent 校验合入——见 expr-2026-09-07_14-31-13 lx_1/lx_3）

## 5. 已知限制（如实记录）

1. **WSL 无原生 dsh harness 时**：`dsh` 若经 /mnt/c PATH 暴露是 Windows 版——建议 WSL 内 `npm i -g @deepseek-ai/dsh` 装原生版，否则插件运行走 Windows node 兼容层（路径语义 /mnt 问题）。
2. **web-gemini bridge**：WSLg GUI Chrome + dsh-web-gemini-ext 连 WSL bridge（8899）可行但配置多；无 Chrome 时跳过该通道（gemini API 直连 + claude-code/dialog/manual 降级链兜底）。
3. **watchdog 计划任务语义**：Windows 计划任务（AtLogOn + RestartOnFailure + Hidden）→ Linux systemd --user（Restart=on-failure）或 crontab @reboot；首检/防风暴/单例锁逻辑不变（纯 Node）。
4. **注册表密钥**：Windows DPAPI 注册表 → Linux 明文 `~/.dsh/env`（权限建议 chmod 600）——安全模型不同，勿存高敏密钥。
5. **完整 WSL dsh 端到端**：需在目标 WSL 真装 dsh harness 后按 §2 三步 + §6 装后清单验证（本仓库已验证 Windows 全量 233/233 + Linux 侧逻辑单测/脚本演练）。

## 6. 装后验证清单（Linux）

- [ ] `dsh --profile web --dump-config` 含 dsh-web-relay；/status version=4.9.2
- [ ] `ls ~/.dsh/skills` 含 3 技能；裸会话可 skill 加载
- [ ] verify-capabilities（registry 17）+ verify-lessons（37, error=0）
- [ ] `systemctl --user status dsh-web-watchdog` active（或 crontab -l 含项）
- [ ] /health-check 有 bootId + heartbeat
- [ ] 重启宿主 → bootResumeScan resumed 可观测；expr 落盘 DSH_SESSION_ID 后唤醒消息自动到达
- [ ] `DSH_CC_TASKS_ROOT` 指向的 cc-tasks 可派发；reviewChannel=claude-code 实弹
