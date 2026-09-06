/**
 * cc-channel.js
 *
 * dsh-web-relay 宿主进程（Windows Node）与本地 Claude Code 执行器（D:\cc-tasks，
 * WSL 侧 cc-watchdog.sh 轮询 queue/*.task.json → 移入 tasks/<taskId>/task.json →
 * runner.sh 以 claude headless 执行 → 产出 out/review.md + done.flag →
 * 写 result.json {status:"done"|"failed"}）之间的“审核通道”客户端模块。
 *
 * 纯 Node ESM，Node >= 18，零第三方依赖，仅使用 node:fs/promises、node:path、node:process。
 * 所有与文件系统的交互都通过可注入的 fsImpl 完成，便于单元测试用内存 fake 替换。
 */

import * as nodeFsPromises from 'node:fs/promises';
import path from 'node:path';

/** Windows 风格的默认 cc-tasks 根目录常量。 */
export const CC_TASKS_ROOT_DEFAULT = 'D:\\cc-tasks';

/**
 * 解析 cc-tasks 根目录。
 * @param {object} env - process.env 风格对象（可注入，便于测试）。
 * @returns {string} env.DSH_CC_TASKS_ROOT 优先，否则回退 CC_TASKS_ROOT_DEFAULT。
 */
export function resolveTasksRoot(env) {
  return (env && env.DSH_CC_TASKS_ROOT) || CC_TASKS_ROOT_DEFAULT;
}

/** taskId 合法性正则：仅允许字母数字开头，随后是字母数字/点/下划线/连字符，最长 64 字符。 */
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * 校验 taskId 是否合法（防路径穿越/注入）。
 * @param {string} id - 待校验的 taskId。
 * @returns {boolean} 合法返回 true，否则 false（空、含路径分隔符、..、引号等一律 false）。
 */
export function sanitizeTaskId(id) {
  if (typeof id !== 'string' || id.length === 0) return false;
  if (!TASK_ID_RE.test(id)) return false;
  if (id.includes('..')) return false;
  return true;
}

/** 校验 taskId，非法则抛错；返回合法的 taskId 供后续拼路径使用。 */
function assertValidTaskId(taskId) {
  if (!sanitizeTaskId(taskId)) {
    throw new Error('invalid taskId');
  }
  return taskId;
}

/**
 * 截断文本到指定长度，超出时尾部追加省略标记。
 * @param {string} text - 原始文本。
 * @param {number} maxLen - 最大长度。
 * @param {string} [marker='…(截断)'] - 截断标记。
 * @returns {string} 截断后的文本。
 */
function truncateText(text, maxLen, marker = '…(截断)') {
  const s = typeof text === 'string' ? text : '';
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + marker;
}

/** 生成形如 rev-<hex timestamp> 的默认 taskId。 */
function generateTaskId() {
  return `rev-${Date.now().toString(16)}`;
}

/**
 * 构建“审核任务”契约对象（task.json 结构），供派发给本地 Claude Code 执行器使用。
 * @param {object} params
 * @param {string} [params.taskId] - 任务 id；缺省时自动生成（前缀 rev-）。
 * @param {string} params.exprId - 实验 id。
 * @param {string} params.stepId - Step id。
 * @param {string} params.stepTitle - Step 标题。
 * @param {string} params.stepDetail - Step 详情。
 * @param {string} params.acceptance - 验收标准正文。
 * @param {string} params.artifactsSummary - 产物摘要。
 * @param {string} params.recordText - 任务记录摘要。
 * @param {string} params.traceText - 三方轨迹文本。
 * @param {string} [params.notesText] - 附加说明。
 * @returns {object} task.json 结构对象。
 */
export function buildReviewTask(params) {
  const {
    exprId,
    stepId,
    stepTitle,
    stepDetail,
    acceptance,
    artifactsSummary,
    recordText,
    traceText,
    notesText,
  } = params || {};

  let taskId = params && params.taskId;
  if (taskId != null) {
    assertValidTaskId(taskId);
  } else {
    taskId = generateTaskId();
  }

  const taskDir = `/mnt/d/cc-tasks/tasks/${taskId}`;
  const outputDir = `${taskDir}/out`;

  const truncRecordText = truncateText(recordText || '', 4000);
  const truncTraceText = truncateText(traceText || '', 4000);
  const truncArtifactsSummary = truncateText(artifactsSummary || '', 4000);

  const promptLines = [
    '你是 dsh-web-relay 审核员，负责审核以下 Step 是否达成验收标准。',
    '',
    '请严格按以下步骤执行：',
    '1) 仔细阅读本任务契约的 prompt 与 acceptance 字段；',
    '2) 依据下方提供的执行上下文（Step 详情、验收标准、notes、artifacts 摘要、任务记录摘要、三方轨迹）审核该 Step 是否达成验收；',
    `3) 用 Write 工具把结论写入本任务目录 ${taskDir}/out/review.md，格式严格为：第一行 \`VERDICT: APPROVED\` 或 \`VERDICT: REJECTED\`，随后空行，再写逐条意见（中文，注明严重度 高/中/低）；`,
    `4) 完成后用 Bash 工具在本任务目录 ${taskDir} 创建空文件 done.flag（touch done.flag）。`,
    '',
    `不要修改 ${taskDir} 之外的任何文件。`,
    '',
    '=== 执行上下文 ===',
    `实验 id (exprId): ${exprId || ''}`,
    `Step id (stepId): ${stepId || ''}`,
    `Step 标题 (stepTitle): ${stepTitle || ''}`,
    `Step 详情 (stepDetail): ${stepDetail || ''}`,
    `验收标准 (acceptance): ${acceptance || ''}`,
    `notes: ${notesText || ''}`,
    '',
    '--- artifacts 摘要 ---',
    truncArtifactsSummary,
    '',
    '--- 任务记录摘要 (recordText) ---',
    truncRecordText,
    '',
    '--- 三方轨迹 (traceText) ---',
    truncTraceText,
  ];

  const prompt = promptLines.join('\n');

  return {
    taskId,
    kind: 'review',
    title: `评审 dsh-web-relay Step ${stepId || ''}`,
    refs: [],
    acceptance:
      'out/review.md 存在且结论行 VERDICT: APPROVED 或 VERDICT: REJECTED；不改任何源码',
    prompt,
    outputDir,
  };
}

/**
 * 解析 review.md 文本得到审核结论。
 * @param {string} text - review.md 全文。
 * @returns {{verdict: 'approved'|'rejected'|'unknown', reason: string}}
 */
export function parseCcVerdict(text) {
  const full = typeof text === 'string' ? text : '';

  // a) VERDICT 行正则
  const verdictRe = /VERDICT\s*[:：]?\s*(APPROVED|REJECTED)/i;
  const m = full.match(verdictRe);
  if (m) {
    const verdict = m[1].toLowerCase();
    const reason = truncateText(
      full.slice(0, m.index) + full.slice(m.index + m[0].length),
      2000
    ).trim();
    return { verdict, reason };
  }

  // b) JSON 兜底
  const jsonMatch = full.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(jsonMatch[0]);
      const raw = obj && (obj.result || obj.verdict);
      if (typeof raw === 'string') {
        const lower = raw.toLowerCase();
        if (lower === 'approved' || lower === 'rejected') {
          const reason = truncateText(
            full.slice(0, jsonMatch.index) +
              full.slice(jsonMatch.index + jsonMatch[0].length),
            2000
          ).trim();
          return { verdict: lower, reason };
        }
      }
    } catch {
      // JSON.parse 失败，继续下一级兜底
    }
  }

  // c) 中文关键词兜底
  if (/通过|同意|ok/i.test(full) && !/不通过|打回|拒绝|reject/i.test(full)) {
    return { verdict: 'approved', reason: truncateText(full, 2000).trim() };
  }
  if (/打回|不通过|拒绝|reject/i.test(full)) {
    return { verdict: 'rejected', reason: truncateText(full, 2000).trim() };
  }

  // d) 都无法识别
  return { verdict: 'unknown', reason: truncateText(full, 500).trim() };
}

/** 构造两种候选布局下的文件路径：<root>/tasks/<taskId>/<rel> 与 <root>/<taskId>/<rel>。 */
function candidatePaths(root, taskId, rel) {
  return [
    path.join(root, 'tasks', taskId, rel),
    path.join(root, taskId, rel),
  ];
}

/** 判断错误是否为 ENOENT（文件/目录不存在）。 */
function isEnoent(err) {
  return err && (err.code === 'ENOENT' || /ENOENT/.test(String(err && err.message)));
}

/**
 * 轮询 result.json，直到读到终态或超时。
 * @param {object} params
 * @param {object} params.fsImpl - 注入的文件系统实现。
 * @param {string} params.root - cc-tasks 根目录。
 * @param {string} params.taskId - 任务 id。
 * @param {number} [params.timeoutMs=150000] - 超时时间（毫秒）。
 * @param {number} [params.intervalMs=3000] - 轮询间隔（毫秒）。
 * @returns {Promise<{ok: boolean, status: 'done'|'failed'|'timeout'|'missing', result: (object|null), error: (string|null)}>}
 */
export async function pollTaskResult({
  fsImpl,
  root,
  taskId,
  timeoutMs = 150000,
  intervalMs = 3000,
}) {
  assertValidTaskId(taskId);
  const paths = candidatePaths(root, taskId, 'result.json');
  const start = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    for (const p of paths) {
      let raw;
      try {
        raw = await fsImpl.readFile(p);
      } catch (err) {
        if (isEnoent(err)) continue;
        throw err;
      }

      let result;
      try {
        result = JSON.parse(String(raw));
      } catch {
        continue;
      }

      if (result && result.status === 'done') {
        return { ok: true, status: 'done', result, error: null };
      }
      if (result && result.status === 'failed') {
        return {
          ok: false,
          status: 'failed',
          result,
          error: result.reason != null ? result.reason : null,
        };
      }
      // status 既非 done 也非 failed：视为尚无有效终态结果，继续轮询
    }

    if (Date.now() - start >= timeoutMs) {
      return { ok: false, status: 'timeout', result: null, error: 'cc 审核超时' };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * 读取 out/review.md（兼容两种目录布局）。
 * @param {object} params
 * @param {object} params.fsImpl - 注入的文件系统实现。
 * @param {string} params.root - cc-tasks 根目录。
 * @param {string} params.taskId - 任务 id。
 * @returns {Promise<{ok: true, text: string}|{ok: false, error: string}>}
 */
export async function readReviewOut({ fsImpl, root, taskId }) {
  assertValidTaskId(taskId);
  const paths = candidatePaths(root, taskId, path.join('out', 'review.md'));

  let lastError = null;
  for (const p of paths) {
    try {
      const raw = await fsImpl.readFile(p);
      return { ok: true, text: String(raw) };
    } catch (err) {
      if (isEnoent(err)) {
        lastError = err;
        continue;
      }
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  }
  return {
    ok: false,
    error: String(lastError && lastError.message ? lastError.message : 'ENOENT'),
  };
}

/**
 * 探测 cc 通道是否可用（cc-tasks 根目录是否存在），不抛异常。
 * @param {object} params
 * @param {object} params.fsImpl - 注入的文件系统实现。
 * @param {string} params.root - cc-tasks 根目录。
 * @returns {Promise<boolean>} 目录存在返回 true，ENOENT 返回 false。
 */
export async function ccChannelAvailable({ fsImpl, root }) {
  try {
    await fsImpl.access(root);
    return true;
  } catch (err) {
    if (isEnoent(err)) return false;
    return false;
  }
}

/**
 * 基于 node:fs/promises 的真实文件系统实现，供生产环境注入使用。
 * readFile/access 失败抛出原始错误（如 ENOENT）；writeFile 自动创建父目录。
 */
export const nodeFsImpl = {
  async readFile(p) {
    return nodeFsPromises.readFile(p, 'utf8');
  },
  async writeFile(p, data) {
    await nodeFsPromises.mkdir(path.dirname(p), { recursive: true });
    return nodeFsPromises.writeFile(p, data, 'utf8');
  },
  async access(p) {
    return nodeFsPromises.access(p);
  },
  async mkdir(p, opts) {
    return nodeFsPromises.mkdir(p, opts || { recursive: true });
  },
};
