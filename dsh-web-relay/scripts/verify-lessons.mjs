#!/usr/bin/env node
// verify-lessons.mjs — 校验 main-agent-lessons.json 风格的 lesson 条目数组
// 用法：node verify-lessons.mjs [文件路径] [--json]
// 不传路径时默认读取脚本同仓 docs/main-agent-lessons.json（只读参考，不修改）

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 默认参考文件路径（真实文件，只读）
const DEFAULT_LESSONS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'main-agent-lessons.json'); // POC-3 合入修复: WSL /mnt/d 路径在 Windows node 下失效 → 相对脚本位置

// 必填字段：值必须存在且为 string 类型
const REQUIRED_STRING_FIELDS = [
  'id', 'title', 'category', 'layer', 'trigger',
  'decision', 'rationale', 'evidence', 'confidence', 'status', 'recordedAt',
];

// status 允许的枚举值
const ALLOWED_STATUS = new Set(['proposed', 'approved', 'in-runbook', 'superseded']);

// layer 允许的枚举值（缺失已由必填字段检查报 error，这里额外校验非法取值）
const ALLOWED_LAYER = new Set(['L1', 'L2', 'L3']);

// category 允许集合：未知/缺失仅 warning，容忍未来新增分类
const ALLOWED_CATEGORY = new Set([
  'collaboration-rhythm',
  'repository-knowledge',
  'tooling-trap',
  'judgment-heuristic',
  'engineering-action',
]);

/**
 * 给定一条 lesson，返回它在报告中的标识（优先用 id，没有则用索引）
 */
function lessonLabel(lesson, index) {
  if (lesson && typeof lesson.id === 'string' && lesson.id.length > 0) {
    return lesson.id;
  }
  return `[index=${index}]`;
}

/**
 * 校验 lesson 数组，返回 { errors, warnings, count } 纯函数，不做任何 IO
 * @param {Array} lessons
 * @returns {{errors: string[], warnings: string[], count: number}}
 */
export function verifyLessons(lessons) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(lessons)) {
    // 顶层结构异常，无法继续按条校验
    return { errors: ['输入不是数组（lessons 必须是 Array）'], warnings: [], count: 0 };
  }

  const seenIds = new Map(); // id -> 首次出现的索引

  lessons.forEach((lesson, index) => {
    const label = lessonLabel(lesson, index);

    if (lesson === null || typeof lesson !== 'object' || Array.isArray(lesson)) {
      errors.push(`${label}: 条目本身不是对象`);
      return; // 后续字段级校验无意义
    }

    // 1. 必填字段存在性 + 类型
    for (const field of REQUIRED_STRING_FIELDS) {
      const value = lesson[field];
      if (value === undefined || value === null) {
        errors.push(`${label}: 缺失必填字段 "${field}"`);
      } else if (typeof value !== 'string') {
        errors.push(`${label}: 字段 "${field}" 类型应为 string，实际为 ${typeof value}`);
      }
    }

    // 2. id 去重（仅当 id 存在且为 string 时才有意义比较）
    if (typeof lesson.id === 'string' && lesson.id.length > 0) {
      if (seenIds.has(lesson.id)) {
        errors.push(`${label}: id 重复，首次出现于 [index=${seenIds.get(lesson.id)}]`);
      } else {
        seenIds.set(lesson.id, index);
      }
    }

    // 3. status 枚举
    if (typeof lesson.status === 'string' && !ALLOWED_STATUS.has(lesson.status)) {
      errors.push(`${label}: status "${lesson.status}" 不在允许集合 {${[...ALLOWED_STATUS].join(', ')}}`);
    }

    // 4. layer 枚举（缺失已在必填字段检查中报 error，这里补充非法取值）
    if (typeof lesson.layer === 'string' && !ALLOWED_LAYER.has(lesson.layer)) {
      errors.push(`${label}: layer "${lesson.layer}" 不在允许集合 {${[...ALLOWED_LAYER].join(', ')}}`);
    }

    // 5. recordedAt 合法 ISO 时间
    if (typeof lesson.recordedAt === 'string') {
      if (Number.isNaN(Date.parse(lesson.recordedAt))) {
        errors.push(`${label}: recordedAt "${lesson.recordedAt}" 不是合法的 ISO 时间`);
      }
    }

    // 6. category 允许集合：缺失/未知仅 warning（容忍未来新增分类）
    if (lesson.category === undefined || lesson.category === null) {
      // 已由必填字段检查报 error，这里不重复报 warning
    } else if (typeof lesson.category === 'string' && !ALLOWED_CATEGORY.has(lesson.category)) {
      warnings.push(`${label}: category "${lesson.category}" 不在已知集合，可能是新增分类`);
    }
  });

  return { errors, warnings, count: lessons.length };
}

/**
 * 从解析后的 JSON 数据中提取 lessons 数组：
 * 支持顶层直接是数组，或 { lessons: [...] } 形态（真实文件采用后者）
 */
function extractLessons(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.lessons)) return data.lessons;
  return null;
}

function printHumanReport({ errors, warnings, count }) {
  console.log(`共校验 ${count} 条 lesson`);
  console.log(`error 数：${errors.length}`);
  console.log(`warning 数：${warnings.length}`);
  if (errors.length > 0) {
    console.log('\n[Errors]');
    for (const e of errors) console.log(`  - ${e}`);
  }
  if (warnings.length > 0) {
    console.log('\n[Warnings]');
    for (const w of warnings) console.log(`  - ${w}`);
  }
}

function runCli(argv) {
  const args = argv.slice(2);
  const jsonMode = args.includes('--json');
  const positional = args.filter((a) => a !== '--json');
  const filePath = positional[0] || DEFAULT_LESSONS_PATH;

  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    const msg = `无法读取文件 "${filePath}": ${err.message}`;
    if (jsonMode) {
      console.log(JSON.stringify({ errors: [msg], warnings: [], count: 0 }, null, 2));
    } else {
      console.error(msg);
    }
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    const msg = `JSON 解析失败 "${filePath}": ${err.message}`;
    if (jsonMode) {
      console.log(JSON.stringify({ errors: [msg], warnings: [], count: 0 }, null, 2));
    } else {
      console.error(msg);
    }
    process.exit(1);
  }

  const lessons = extractLessons(data);
  if (lessons === null) {
    const msg = `无法在 "${filePath}" 中找到 lessons 数组（既非顶层数组，也没有 lessons 字段）`;
    if (jsonMode) {
      console.log(JSON.stringify({ errors: [msg], warnings: [], count: 0 }, null, 2));
    } else {
      console.error(msg);
    }
    process.exit(1);
  }

  const result = verifyLessons(lessons);

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printHumanReport(result);
  }

  process.exit(result.errors.length > 0 ? 1 : 0);
}

// 仅当作为脚本直接执行时才跑 CLI，被 import 用于测试时不触发
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  runCli(process.argv);
}
