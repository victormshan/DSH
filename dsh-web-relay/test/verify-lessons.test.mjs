// verify-lessons.test.mjs — verify-lessons.mjs 的单元测试
// 运行：node --test verify-lessons.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { verifyLessons } from '../scripts/verify-lessons.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, '..', 'scripts', 'verify-lessons.mjs');
const REAL_LESSONS_PATH = join(__dirname, '..', 'docs', 'main-agent-lessons.json');

// 一条完全合法的 lesson，作为各用例的基础样本
function makeValidLesson(overrides = {}) {
  return {
    id: 'L-2026-0101-001',
    title: '样例标题',
    category: 'collaboration-rhythm',
    layer: 'L3',
    trigger: '样例触发场景',
    decision: '样例决策',
    rationale: '样例理由',
    evidence: '样例证据',
    confidence: 'high',
    status: 'proposed',
    recordedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('合法样本应无 error 无 warning', () => {
  const lessons = [makeValidLesson()];
  const result = verifyLessons(lessons);
  assert.equal(result.count, 1);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, []);
});

test('缺失必填字段应报 error', () => {
  const lesson = makeValidLesson();
  delete lesson.trigger;
  const result = verifyLessons([lesson]);
  assert.ok(result.errors.some((e) => e.includes('trigger')), '应包含缺失 trigger 的报错');
  assert.ok(result.errors.length > 0);
});

test('重复 id 应报 error', () => {
  const a = makeValidLesson({ id: 'L-DUP-001' });
  const b = makeValidLesson({ id: 'L-DUP-001' });
  const result = verifyLessons([a, b]);
  assert.ok(result.errors.some((e) => e.includes('id 重复')), '应包含 id 重复的报错');
});

test('非法 status 应报 error', () => {
  const lesson = makeValidLesson({ status: 'not-a-real-status' });
  const result = verifyLessons([lesson]);
  assert.ok(result.errors.some((e) => e.includes('status')), '应包含非法 status 的报错');
});

test('非法 layer 应报 error', () => {
  const lesson = makeValidLesson({ layer: 'L9' });
  const result = verifyLessons([lesson]);
  assert.ok(result.errors.some((e) => e.includes('layer')), '应包含非法 layer 的报错');
});

test('未知 category 仅报 warning 不报 error', () => {
  const lesson = makeValidLesson({ category: 'some-future-category' });
  const result = verifyLessons([lesson]);
  assert.equal(result.errors.length, 0, '未知 category 不应产生 error');
  assert.ok(result.warnings.some((w) => w.includes('category')), '应包含未知 category 的 warning');
});

test('非法 ISO 时间的 recordedAt 应报 error', () => {
  const lesson = makeValidLesson({ recordedAt: '不是一个时间' });
  const result = verifyLessons([lesson]);
  assert.ok(result.errors.some((e) => e.includes('recordedAt')), '应包含非法 recordedAt 的报错');
});

test('CLI --json 冒烟：对真实 lessons.json 运行应 error=0 且退出码 0', () => {
  // 真实文件只读参考，不修改；用 --json 校验结构化输出与退出码
  const output = execFileSync(
    process.execPath,
    [SCRIPT_PATH, REAL_LESSONS_PATH, '--json'],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(output);
  assert.equal(parsed.errors.length, 0, '真实 lessons.json 不应产生 error');
  assert.ok(parsed.count > 0, 'count 应大于 0');
});

test('CLI 对含 error 的临时文件应以退出码 1 结束', () => {
  const tmpPath = join(__dirname, '.tmp-invalid-lessons.json');
  const badLessons = { lessons: [makeValidLesson({ status: 'bogus' })] };
  writeFileSync(tmpPath, JSON.stringify(badLessons));
  try {
    assert.throws(() => {
      execFileSync(process.execPath, [SCRIPT_PATH, tmpPath, '--json'], { encoding: 'utf8' });
    }, (err) => err.status === 1);
  } finally {
    unlinkSync(tmpPath);
  }
});
