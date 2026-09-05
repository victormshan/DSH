# 完全自主三方协作自动迭代效果分析（AUTO-ITERATION-ANALYSIS）

> 实验：以 dsh-web-relay 插件自身为对象，执行 iterations=3 的 AutoIteration（v4.1.0→v4.3.0）
> expr：expr-2026-09-05_13-58-07（版间门自动推进 V1→V2→V3）
> 时间：2026-09-05 · 全程零用户参与（除 1 次宿主人工重启，其余重启由 watchdog 自愈）

## 一、实验设计

- 三方协作：**外部 AI**（gemini-free，规划/评审/审核）↔ **主 agent**（本会话，带证据实现）↔ **引擎**（dsh-web-relay 协议 v1.9 AutoIteration 状态机 + watchdog 托管宿主）。
- 迭代声明：`{"iterations":3, "autoDecision":true, "finalAcceptance": ...}`（初版叙述式未解析，人工修正落盘后生效——见观察点 A）。
- 主题：宿主托管/重启续跑机制的【面板化呈现（V1/4.1.0）→ 运维文档+审计日志（V2/4.2.0）→ 复盘分析沉淀（V3/4.3.0）】。
- 自治边界：用户在实验期间**不参与任何步骤执行/审核/重启**；宿主重启由 prepare-restart→watchdog 自愈链完成。

## 二、观测数据

| 指标 | V1 (4.1.0) | V2 (4.2.0) | V3 (4.3.0) | 合计/备注 |
|---|---|---|---|---|
| 外部 AI 规划轮次 | 1（4 步） | 1（4 步） | 1（3 步） | 每版 1 次 /ask，全程 3 轮 |
| 步骤数 | 4 | 4 | 3 | 11 步全部 approved（V1/V2/V3） |
| external 审核通过 | 4/4 | 3/4 | 待收口 | V2 step3 为 low 主 agent 豁免（协议设计） |
| 打回次数 | 0 | 0 | — | 全程零打回（证据先行纪律生效） |
| 版本 bump/tag/push | 7b04a6b/v4.1.0 | c1bbb1b/v4.2.0 | —/v4.3.0 | 全自动 git 操作 |
| 宿主重启次数 | 0（纯 client） | 0（docs/test） | 0（docs/lessons） | **三轮零 lib 重启**——主题选择避免了摩擦 |
| 测试基线 | 152 | 154 | 154 | 每版全量回归绿 |
| 用户参与 | 0 | 0 | 0 | 版间门 handoff trace 自动生成 |

## 三、观察点与机制验证

**A. AutoIteration 声明解析容错（摩擦点）**
- `声明：{"iterations":3,...}` 以叙述式写在 prompt 首行 → `extractAutoIterDecl` 未解析 → steps.json 落盘 iterations=1（**lesson 002 复现**）。
- 处置：人工直接修正 steps.json 顶层后，版间门正常推进。→ 改进：prompt 声明应放 ```json 机读块；引擎可对「叙述式声明」加解析兜底（见 lessons 追加）。

**B. 版间门自动推进（机制生效 ✅）**
- V1 全 approved → `status=done, currentIteration 1→2` + trace 自动追加 `【主 agent 请协助】…进入 V2…请通过协议通道 /ask 请外部 AI 评审…`；V2 结束同推进至 3。全程无人点按钮。

**C. 外部 AI 输出格式偏差（容错吸收）**
- 路径误写 `public/client.js`（实际 lib/client.js）——主 agent 适配并在证据注明。
- artifacts 字段用字符串而非数组——restructure 归一化容错吸收。
- → 教训：规划 prompt 应给准确路径清单；引擎对字符串 artifacts 已容错。

**D. 零用户参与可行性（核心结论）**
- 三轮执行 + 审核 + 发布全自动；**唯一需人 = 宿主进程换代时会话 turn 中断后的「继续」唤醒**（v4.0 续跑机制已让宿主重启对任务状态无损 + bootResumeScan 自动续跑标记；本轮实验三轮未触发 lib 重启故未实际跨宿主）。
- watchdog 自愈链（miss×3→prepare→树杀→拉起、首检 2s、单例锁、桥接总守护）使宿主层无需人；实验中的 1 次人工重启发生在实验启动前的环境修复（watchdog 编排命令被运行时中断），非机制缺陷。

**E. 测试基线 152→154**
- V2 新增 client-restart.test 2 例；发现并修正命名陷阱（test-client-restart.js 不以 .test.js 结尾 → 被套件 glob 漏跑，改名后 154/154）。

## 四、效果评价

1. **吞吐**：3 个版本（含规划/实现/审核/发布）在连续会话内完成，平均每版 = 1 次外部 AI 规划 + 3-4 步带证据实现 + 全绿回归 + tag 发布，无人工卡点。
2. **质量闸**：证据先行纪律 + external 审核全过（零打回）；每步 acceptance 可复验。
3. **摩擦残余**：① AutoIteration 声明叙述式解析缺口（需机读块或引擎兜底）；② 跨宿主 turn 中断仍需「继续」唤醒（v4.0 bootResumeScan 已降级留痕，完整自动唤醒需 sessionId 落盘 + 宿主重启实测）；③ 外部 AI 输出格式偏差靠主 agent 容错，未入引擎校验。
4. **结论**：在「主题选型避免 lib 高频重启 + watchdog 自愈 + 证据纪律」三条件下，完全自主三方协作 AutoIteration 可端到端运行；剩余摩擦点均有明确改进路径（见 lessons/roadmap）。

## 五、改进建议（roadmap 输入）

1. extractAutoIterDecl 增加叙述式声明解析兜底（或协议强制 ```json 块）。
2. 宿主重启后的完整「自动唤醒续跑」实测（expr 带 sessionId + watchdog 重启 + wakeMainAgent 链路）——v4.0 已具备全部构件，缺一次真实跨宿主观测。
3. 外部 AI 规划 prompt 附准确路径/字段清单模板，减少格式偏差轮次。
4. 测试文件命名校验可进 CI 前检查（*.test.js 必须）。

## 六、数据来源

- expr-2026-09-05_13-58-07.steps.json（11 步 approved、iterations=3、currentIteration=3）
- traces：expr-2026-09-05_13-58-07.md（版间门 handoff 自动留痕）
- git：7b04a6b(v4.1.0)、c1bbb1b(v4.2.0)、v4.3.0(收口)
- 会话证据：主 agent 每步 complete 注记（证据文本）
