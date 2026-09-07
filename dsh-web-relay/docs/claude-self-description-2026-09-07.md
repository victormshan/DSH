# Claude Code 能力自述（headless WSL 模式）

> 本文由本次被 `runner.sh` 以 `claude -p` 唤起的 Claude Code 撰写。已实读本任务 `task.json`、`runner.sh`、`cc-watchdog.sh`、`/mnt/d/DSH/dsh-web-relay/docs/CC-HYBRID.md`、`main-agent-runbook-v0.1.md`，以及此前同类任务 `cc-understand-hybrid` 的产出（`understanding.md` + 主agent复核 `main-agent-analysis.md`）作为依据。标注 [实测]=本环境内可验证的观察，[推测]=基于模型认知但未在本环境验证。

## A. 任务执行能力
[实测] 本次能读取多个跨目录文件、梳理架构、撰写长文档（如本文件及前一次 191 行的 understanding.md）。[推测] 典型可胜任：中小型编码实现、代码评审、脚本编写、日志/文档分析。复杂度上限受 runner.sh 900s 总超时和单次 Bash 调用 ≤600s 约束；无跨进程续接能力，超长链路任务需拆分为多个 task.json。

## B. 工具与权限
[实测] `runner.sh` 第27行 `--allowedTools "Read,Write,Bash"`，无 Glob/Grep/Edit/WebFetch/WebSearch；`CC-HYBRID.md` 明确 `acceptEdits` 仅自动接受文件编辑，不等于免批命令，命令放行靠 `allowedTools`+headless 非交互模式。Bash 单次调用上限约600s，外层 `timeout 900` 封顶整个进程；无GUI操作能力；定时/常驻靠外部 `cc-watchdog.sh` 轮询实现，我自身无常驻能力。[实测-异常] 本会话实际可见工具明显多于此清单（Agent/ToolSearch/Skill 及 MCP `claude-step-relay` 等），是否为同一调用层级、为何超出白名单，我无法确证成因，如实记录此差异。

## C. 记忆与状态
[实测] `runner.sh`/`cc-watchdog.sh` 均未见 `--resume`，`cc-watchdog.sh` 每个任务对应一次全新 `claude -p` 进程；我能看到上一次 `cc-understand-hybrid` 的产出，是靠 Read 工具读取磁盘文件，而非模型记忆继承。无持久化配置/知识库随进程重启携带。[推测] 重启后我不记得本次对话内容，唯一"记忆"是文件系统上留下的产物，下个任务若被明确要求读取才能间接续接。

## D. 协作与协议
[实测] 我能读懂 `task.json` 契约字段（kind/prompt/refs/acceptance）、`CC-HYBRID.md` 降级状态机、runbook 三方角色表，并据此判断自己在架构中的定位。[实测] 此前同类任务证明我能承担评审角色（`kind=review` 输出 APPROVED/REJECTED 及逐条意见）。[推测] 本模式下我无法主动联系"主agent"或外部AI，只能被动通过写文件（out/、done.flag）单向交互，不具备原生多agent直接通信能力。

## E. 自主性与可靠性
[实测] 本次调用受 `runner.sh` 900s 硬超时与 Bash 单次≤600s 约束，无人工介入下单任务最长约15分钟；超时/exit≠0/`done.flag`缺失 → `result.json{status:failed}`，触发主agent侧降级链，但我自己感知不到降级发生与否。[推测] Pro订阅配额/429限流由外层探活（`wsl claude auth status`）处理，我自身无法查询配额状态；`acceptEdits`+`allowedTools`白名单是主要工具层护栏，越权写沙盒外文件依赖我自己识别并拒绝执行（`CC-HYBRID.md` 记载的 demo1 矛盾 prompt 拒绝先例），而非被工具机制强制拦截。

## F. 与 dsh-web-relay 体系的差异
[实测] `CC-HYBRID.md` 显示 dsh-web-relay 拥有正式 Step List 状态机（`*.steps.json`）、三方轨迹（experiments/traces）、15min心跳、宿主自愈重启后自动续跑注入、面板UI、批量并发裁决（`alternatives-compare.js`）——这些在本次 task.json 驱动模式下我均不具备：无跨会话心跳、无面板、无细粒度 steps.json 状态机，每次都是新进程从零开始。[实测-额外] 本会话实际可见 MCP 工具 `claude-step-relay`（start/set_steps/update_step/append_trace/finalize/get_state/read_trace/list），命名与 Step List 高度相似，但这是宿主环境赋予的外部能力，并非我作为模型的固有机制，二者不应混同。[推测] 我的相对优势在于单次会话内可直接读写代码文件、跑 Bash 即时验证，交互链路更短、延迟更低。

## G. 总结
**独特价值**：
1. 可直接操作文件系统与代码并用 Bash 即时验证，适合"实现+自证"闭环，无需经三方协议往返。
2. 已有实证审方价值——`CC-HYBRID.md` 记载我曾审出 `TASK_DEFAULTS.refs` 共享引用污染这一真实缺陷，主agent与既有单测均漏检。
3. 契约驱动、可插拔接入，失败即整体退回原三方链路，不侵入 dsh-web-relay 主体架构。

**明确短板**：
1. 无跨任务/跨进程记忆与心跳续跑机制，每个任务从零开始，无法感知自身是否被降级替换。
2. 无原生 Step List/面板/三方轨迹审计能力，细粒度状态机需宿主外挂（如本会话额外可见的 `claude-step-relay`）。
3. 单次会话有硬超时（900s）与三工具白名单限制，不适合需要长期驻留、多轮持续交互的任务。
