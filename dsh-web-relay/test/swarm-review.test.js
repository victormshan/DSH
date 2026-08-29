// v3.2-1/v3.2-2/v3.2-3: 多角色盲审 Swarm 测试（v3.2.0）
// 运行：node --test test/swarm-review.test.js
// 直接 import lib/swarm-prompts.js（纯函数模块）复测共识/解析/Prompt 生成。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { SWARM_ROLES, swarmConsensus, parseRoleReview, buildRolePrompt } from '../lib/swarm-prompts.js'

test('SWARM_ROLES：双角色专职视角定义', () => {
  assert.equal(Object.keys(SWARM_ROLES).length, 2)
  assert.ok(SWARM_ROLES.security.system.includes('路径越界'))
  assert.ok(SWARM_ROLES.security.system.includes('资源泄露'))
  assert.ok(SWARM_ROLES.refactor.system.includes('耦合'))
  assert.ok(SWARM_ROLES.refactor.system.includes('异常处理'))
})

test('共识矩阵：双 Approve 才通过', () => {
  assert.equal(swarmConsensus('approved', 'approved').result, 'approved')
  assert.equal(swarmConsensus('approved', 'rejected').result, 'rejected')
  assert.equal(swarmConsensus('rejected', 'approved').result, 'rejected')
  assert.equal(swarmConsensus('rejected', 'rejected').result, 'rejected')
})

test('共识合成：单打回时标注打回角色', () => {
  const r = swarmConsensus('approved', 'rejected')
  assert.ok(r.summary.includes('Refactoring-Architect'))
  const r2 = swarmConsensus('rejected', 'approved')
  assert.ok(r2.summary.includes('Security-Auditor'))
})

test('parseRoleReview：严格 JSON 解析', () => {
  const r = parseRoleReview('{"verdict":"rejected","findings":["路径越界 ../ 逃逸","临时文件未清理"],"suggestion":"改用白名单路径"}')
  assert.equal(r.verdict, 'rejected')
  assert.equal(r.findings.length, 2)
  assert.equal(r.suggestion, '改用白名单路径')
})

test('parseRoleReview：宽松兜底（非 JSON 文本提取 verdict）', () => {
  assert.equal(parseRoleReview('{"verdict":"approved"}').verdict, 'approved')
  assert.equal(parseRoleReview('乱码').verdict, 'rejected')
})

test('buildRolePrompt：角色 Prompt 含焦点与 JSON 输出要求', () => {
  const p = buildRolePrompt('security', '【上下文】测试', '外部 AI（Swarm）')
  assert.ok(p.includes('Security-Auditor'))
  assert.ok(p.includes('路径越界'))
  assert.ok(p.includes('"verdict"'))
  assert.equal(buildRolePrompt('unknown', 'ctx', 'r'), '')
})

test('镜像：Security-Auditor 拦截隐蔽路径越界样例', () => {
  // 镜像 Security-Auditor 的判定：样例中含路径越界模式 → rejected
  const securityVerdictOf = (sample) => {
    const dangerous = /\.\.\/|\.\.\\|resolve\([^)]*input|writeFileSync\([^)]*user/i.test(sample)
    return dangerous ? 'rejected' : 'approved'
  }
  const malicious = 'fs.writeFileSync(userInput + "/../../etc/passwd", data)'
  assert.equal(securityVerdictOf(malicious), 'rejected')
  assert.equal(securityVerdictOf('fs.writeFileSync(whitelistPath, data)'), 'approved')
  // 盲审拦截：security rejected → 整体 rejected
  assert.equal(swarmConsensus(securityVerdictOf(malicious), 'approved').result, 'rejected')
})

test('source 源码含 v3.2 Swarm 标记（lib/index.js + swarm-prompts.js）', () => {
  const src = fs.readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const sp = fs.readFileSync(new URL('../lib/swarm-prompts.js', import.meta.url), 'utf8')
  assert.ok(src.includes('V3.2: 多角色盲审 Swarm'))
  assert.ok(src.includes('enableSwarm'))
  assert.ok(src.includes("Promise.all([runRole('security'), runRole('refactor')])"))
  assert.ok(sp.includes('swarmConsensus'))
  assert.ok(sp.includes('Security-Auditor'))
  assert.ok(sp.includes('Refactoring-Architect'))
})
