/**
 * cc-channel.test.js
 * node:test + assert/strict，仅使用内存 fake fsImpl，不触碰真实磁盘/网络/进程。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  CC_TASKS_ROOT_DEFAULT,
  resolveTasksRoot,
  sanitizeTaskId,
  buildReviewTask,
  parseCcVerdict,
  pollTaskResult,
  readReviewOut,
  ccChannelAvailable,
  nodeFsImpl,
} from '../lib/cc-channel.js';

/** 创建一个内存 fake fsImpl，仅用于测试，绝不触碰真实磁盘。 */
function createFakeFs(initialFiles = {}) {
  const files = new Map(Object.entries(initialFiles));
  return {
    files,
    async readFile(p) {
      if (!files.has(p)) {
        const err = new Error(`ENOENT: no such file, open '${p}'`);
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(p);
    },
    async writeFile(p, data) {
      files.set(p, data);
    },
    async access(p) {
      const exists = [...files.keys()].some(
        (f) => f === p || f.startsWith(p + '/') || f.startsWith(p + '\\')
      );
      if (!exists) {
        const err = new Error(`ENOENT: no such file or directory, access '${p}'`);
        err.code = 'ENOENT';
        throw err;
      }
    },
    async mkdir() {},
  };
}

// --- sanitizeTaskId ---

test('sanitizeTaskId：合法 id 通过', () => {
  assert.equal(sanitizeTaskId('rev-1a2b3c'), true);
  assert.equal(sanitizeTaskId('v9-cc-channel'), true);
  assert.equal(sanitizeTaskId('a'), true);
  assert.equal(sanitizeTaskId('a.b_c-9'), true);
});

test('sanitizeTaskId：非法 id 一律 false', () => {
  assert.equal(sanitizeTaskId(''), false);
  assert.equal(sanitizeTaskId('../x'), false);
  assert.equal(sanitizeTaskId('a/b'), false);
  assert.equal(sanitizeTaskId('a\\b'), false);
  assert.equal(sanitizeTaskId('a b'), false);
  assert.equal(sanitizeTaskId('"quoted"'), false);
  assert.equal(sanitizeTaskId('a'.repeat(65)), false);
  assert.equal(sanitizeTaskId(null), false);
  assert.equal(sanitizeTaskId(undefined), false);
});

// --- resolveTasksRoot ---

test('resolveTasksRoot：env 提供时使用之', () => {
  const root = resolveTasksRoot({ DSH_CC_TASKS_ROOT: 'E:\\custom-root' });
  assert.equal(root, 'E:\\custom-root');
});

test('resolveTasksRoot：缺省回退默认值', () => {
  assert.equal(resolveTasksRoot({}), CC_TASKS_ROOT_DEFAULT);
  assert.equal(resolveTasksRoot(undefined), CC_TASKS_ROOT_DEFAULT);
  assert.equal(CC_TASKS_ROOT_DEFAULT, 'D:\\cc-tasks');
});

// --- buildReviewTask ---

test('buildReviewTask：返回结构含 kind/taskId/prompt/outputDir', () => {
  const task = buildReviewTask({
    taskId: 'rev-test01',
    exprId: 'expr-1',
    stepId: 'step-2',
    stepTitle: '标题',
    stepDetail: '详情',
    acceptance: '验收标准正文',
    artifactsSummary: '产物摘要',
    recordText: '记录摘要',
    traceText: '轨迹文本',
    notesText: '备注',
  });

  assert.equal(task.kind, 'review');
  assert.equal(task.taskId, 'rev-test01');
  assert.match(task.prompt, /VERDICT/);
  assert.ok(task.prompt.includes('rev-test01'));
  assert.ok(task.outputDir.includes('rev-test01'));
  assert.equal(task.outputDir, '/mnt/d/cc-tasks/tasks/rev-test01/out');
  assert.deepEqual(task.refs, []);
  assert.match(task.title, /step-2/);
});

test('buildReviewTask：省略 taskId 时自动生成前缀 rev-', () => {
  const task = buildReviewTask({ exprId: 'e', stepId: 's' });
  assert.match(task.taskId, /^rev-[0-9a-f]+$/);
});

test('buildReviewTask：超长字段被截断并追加省略标记', () => {
  const longText = 'x'.repeat(5000);
  const task = buildReviewTask({
    taskId: 'rev-trunc01',
    recordText: longText,
    traceText: longText,
    artifactsSummary: longText,
  });
  assert.ok(task.prompt.includes('…(截断)'));
});

// --- parseCcVerdict ---

test('parseCcVerdict：VERDICT 行大写变体', () => {
  const r = parseCcVerdict('VERDICT: APPROVED\n\n理由：一切正常');
  assert.equal(r.verdict, 'approved');
  assert.match(r.reason, /理由/);
});

test('parseCcVerdict：VERDICT 行小写/混合变体', () => {
  const r = parseCcVerdict('verdict:rejected\n\n未通过测试');
  assert.equal(r.verdict, 'rejected');
});

test('parseCcVerdict：JSON 兜底', () => {
  const r = parseCcVerdict('一些前言文字\n{"result":"rejected"}\n后续文字');
  assert.equal(r.verdict, 'rejected');
});

test('parseCcVerdict：中文关键词兜底', () => {
  const r = parseCcVerdict('审核意见：本次评审结果为不通过，需要修改。');
  assert.equal(r.verdict, 'rejected');
});

test('parseCcVerdict：无法识别 → unknown', () => {
  const r = parseCcVerdict('这是一段无关文本，没有任何结论标记。');
  assert.equal(r.verdict, 'unknown');
});

// --- pollTaskResult ---

test('pollTaskResult：初始无文件，注入 done 文件后轮询得 done', async () => {
  const fake = createFakeFs();
  const p = path.join('D:\\cc-tasks', 'tasks', 'rev-poll01', 'result.json');

  setTimeout(() => {
    fake.files.set(p, JSON.stringify({ status: 'done', ok: true }));
  }, 50);

  const res = await pollTaskResult({
    fsImpl: fake,
    root: 'D:\\cc-tasks',
    taskId: 'rev-poll01',
    timeoutMs: 2000,
    intervalMs: 20,
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, 'done');
  assert.equal(res.result.status, 'done');
});

test('pollTaskResult：failed 场景', async () => {
  const p = path.join('D:\\cc-tasks', 'tasks', 'rev-poll02', 'result.json');
  const fake = createFakeFs({
    [p]: JSON.stringify({ status: 'failed', reason: '执行出错' }),
  });

  const res = await pollTaskResult({
    fsImpl: fake,
    root: 'D:\\cc-tasks',
    taskId: 'rev-poll02',
    timeoutMs: 2000,
    intervalMs: 20,
  });

  assert.equal(res.ok, false);
  assert.equal(res.status, 'failed');
  assert.equal(res.error, '执行出错');
});

test('pollTaskResult：timeout 场景', async () => {
  const fake = createFakeFs();

  const res = await pollTaskResult({
    fsImpl: fake,
    root: 'D:\\cc-tasks',
    taskId: 'rev-poll03',
    timeoutMs: 60,
    intervalMs: 20,
  });

  assert.equal(res.ok, false);
  assert.equal(res.status, 'timeout');
  assert.equal(res.error, 'cc 审核超时');
});

test('pollTaskResult：兼容顶层布局 <root>/<taskId>/result.json', async () => {
  const p = path.join('D:\\cc-tasks', 'rev-poll04', 'result.json');
  const fake = createFakeFs({
    [p]: JSON.stringify({ status: 'done' }),
  });

  const res = await pollTaskResult({
    fsImpl: fake,
    root: 'D:\\cc-tasks',
    taskId: 'rev-poll04',
    timeoutMs: 2000,
    intervalMs: 20,
  });

  assert.equal(res.ok, true);
  assert.equal(res.status, 'done');
});

// --- readReviewOut ---

test('readReviewOut：成功读取文本（tasks 布局）', async () => {
  const p = path.join('D:\\cc-tasks', 'tasks', 'rev-read01', 'out', 'review.md');
  const fake = createFakeFs({ [p]: 'VERDICT: APPROVED\n\n无意见' });

  const res = await readReviewOut({ fsImpl: fake, root: 'D:\\cc-tasks', taskId: 'rev-read01' });
  assert.equal(res.ok, true);
  assert.match(res.text, /VERDICT: APPROVED/);
});

test('readReviewOut：文件缺失 → ok:false', async () => {
  const fake = createFakeFs();
  const res = await readReviewOut({ fsImpl: fake, root: 'D:\\cc-tasks', taskId: 'rev-read02' });
  assert.equal(res.ok, false);
  assert.ok(res.error);
});

// --- ccChannelAvailable ---

test('ccChannelAvailable：目录存在 → true', async () => {
  const fake = createFakeFs({ 'D:\\cc-tasks\\marker': 'x' });
  const ok = await ccChannelAvailable({ fsImpl: fake, root: 'D:\\cc-tasks' });
  assert.equal(ok, true);
});

test('ccChannelAvailable：ENOENT → false', async () => {
  const fake = createFakeFs();
  const ok = await ccChannelAvailable({ fsImpl: fake, root: 'D:\\not-exist' });
  assert.equal(ok, false);
});

// --- nodeFsImpl 存在性检查（不实际调用真实 IO） ---

test('nodeFsImpl：导出真实文件系统实现，具备四个方法', () => {
  assert.equal(typeof nodeFsImpl.readFile, 'function');
  assert.equal(typeof nodeFsImpl.writeFile, 'function');
  assert.equal(typeof nodeFsImpl.access, 'function');
  assert.equal(typeof nodeFsImpl.mkdir, 'function');
});
