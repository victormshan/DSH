#!/usr/bin/env node
// 把仓库内的 auto-iterate 技能安装为 Claude Code 用户级技能：
//   skills/auto-iterate/{SKILL.md,state.mjs} -> ~/.claude/skills/auto-iterate/
// 状态数据不在技能目录里（见 state.mjs），重复安装不会丢失任何迭代记录。
import { cpSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'auto-iterate')
const dest = join(process.env.CLAUDE_SKILLS_DIR || join(homedir(), '.claude', 'skills'), 'auto-iterate')
mkdirSync(dest, { recursive: true })
for (const f of ['SKILL.md', 'state.mjs', 'review.mjs', 'common.mjs']) cpSync(join(src, f), join(dest, f))
// The review gate's external-model client is shared with other tools; ship a copy with the skill.
cpSync(join(src, '..', '..', 'tools', 'external-ai.mjs'), join(dest, 'external-ai.mjs'))
console.log(`installed auto-iterate skill -> ${dest}`)
