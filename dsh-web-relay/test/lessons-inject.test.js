// v4.4 U1: Lesson Top-K 注入测试（镜像 lib/lessons-inject.js）
// 运行：node --test test/lessons-inject.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { lessonScore, filterActive, topLessonsForTrigger, renderLessonBlock } from '../lib/lessons-inject.js'

const sample = [
  { id: 'L1', title: 'watchdog 宿主自愈', trigger: 'watchdog 重启', decision: '用 watchdog 托管', category: 'engineering-action', status: 'approved', recordedAt: '2026-09-05T00:00:00.000Z' },
  { id: 'L2', title: 'AutoIteration 声明解析', trigger: '迭代声明 JSON', decision: '用机读 JSON 块', category: 'collaboration-rhythm', status: 'approved', recordedAt: '2026-09-05T01:00:00.000Z' },
  { id: 'L3', title: 'PS BOM 陷阱', trigger: 'PowerShell 写 JSON', decision: '用 node 写', category: 'tooling-trap', status: 'superseded', recordedAt: '2026-09-03T00:00:00.000Z' },
  { id: 'L4', title: 'git 原子交付', trigger: 'commit tag', decision: '强制 tag', category: 'engineering-action', status: 'approved', recordedAt: '2026-09-04T00:00:00.000Z' }
]

test('filterActive：跳过 superseded', () => {
  assert.equal(filterActive(sample).length, 3)
})

test('lessonScore：触发词相关 lesson 得分高于无关', () => {
  const s1 = lessonScore(sample[0], '宿主 watchdog 自愈重启')
  const s3 = lessonScore(sample[3], '宿主 watchdog 自愈重启')
  assert.ok(s1 > s3, `watchdog lesson 应更相关: ${s1} vs ${s3}`)
})

test('topLessonsForTrigger：Top-K 命中相关 lesson 且排除 superseded', () => {
  const top = topLessonsForTrigger(sample, '宿主 watchdog 自愈重启', { k: 3, minScore: 0 })
  assert.ok(top.length >= 1)
  assert.equal(top[0].id, 'L1')
  assert.ok(!top.some((l) => l.id === 'L3'), 'superseded 不应注入')
})

test('renderLessonBlock：非空列表生成带编号文本', () => {
  const block = renderLessonBlock([sample[1]])
  assert.ok(block.includes('【相关教训 Top-K'))
  assert.ok(block.includes('L2'))
})

test('真实库冒烟：加载 docs/main-agent-lessons.json（32 条）并按 watchdog 触发匹配', () => {
  const real = JSON.parse(fs.readFileSync(new URL('../docs/main-agent-lessons.json', import.meta.url), 'utf8')).lessons
  const top = topLessonsForTrigger(real, '宿主 watchdog 重启续跑 熔断', { k: 3 })
  assert.ok(top.length >= 1)
  console.log('  Top:', top.map((l) => l.id + ':' + l.title.slice(0, 24)).join(' | '))
})

test('source：lib/index.js 装配接入 Top-K（U1 接线）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.ok(src.includes("from './lessons-inject.js'"))
  assert.ok(src.includes('loadLessonsFile(LESSONS_JSON_PATH)'))
  assert.ok(src.includes('async function attachMainAgentAssembly'))
  assert.ok(src.includes('renderLessonBlock(top)'))
})
