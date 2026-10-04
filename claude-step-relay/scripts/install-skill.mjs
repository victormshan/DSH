#!/usr/bin/env node
// 把仓库内的 auto-iterate 技能安装为 Claude Code 用户级技能：
//   skills/auto-iterate/SKILL.md -> ~/.claude/skills/auto-iterate/
// 审核门是独立的 review-gate 服务（WebUI-AutoTest 仓库 crates/review-gate），技能里不再带脚本；
// 旧版 Node 审核门（state.mjs / review.mjs / common.mjs / external-ai.mjs）安装时一并移除。
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'auto-iterate')
const dest = join(process.env.CLAUDE_SKILLS_DIR || join(homedir(), '.claude', 'skills'), 'auto-iterate')
mkdirSync(dest, { recursive: true })
cpSync(join(src, 'SKILL.md'), join(dest, 'SKILL.md'))
for (const f of ['state.mjs', 'review.mjs', 'common.mjs', 'external-ai.mjs']) rmSync(join(dest, f), { force: true })
console.log(`installed auto-iterate skill -> ${dest}`)
