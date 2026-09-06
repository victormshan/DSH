/**
 * cc-task 契约解析/校验模块。
 * 提供 parseTask（解析任务契约）与 validateResult（校验执行结果）两个纯函数。
 */

const TASK_DEFAULTS = Object.freeze({
  taskId: "untitled",
  kind: "unknown",
  title: "",
  prompt: "",
  refs: [],
  acceptance: "",
});

/**
 * 解析任务契约（对象或 JSON 文本），返回标准化后的任务对象。
 * 输入可以是已解析的对象，也可以是 JSON 字符串；任何非法输入（无法解析的
 * JSON、非对象、null 等）都不会抛出异常，而是返回带有安全默认值的对象。
 * 缺失或类型不符的字段会被替换为默认值：
 *   taskId: 'untitled', kind: 'unknown', title: '', prompt: '', refs: [], acceptance: ''
 * @param {unknown} textOrObj 任务契约对象或其 JSON 文本表示
 * @returns {{taskId: string, kind: string, title: string, prompt: string, refs: any[], acceptance: string}}
 */
export function parseTask(textOrObj) {
  let obj = textOrObj;

  if (typeof textOrObj === "string") {
    try {
      obj = JSON.parse(textOrObj);
    } catch {
      return { ...TASK_DEFAULTS, refs: [] };
    }
  }

  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
    return { ...TASK_DEFAULTS, refs: [] };
  }

  return {
    taskId:
      typeof obj.taskId === "string" && obj.taskId.length > 0
        ? obj.taskId
        : TASK_DEFAULTS.taskId,
    kind:
      typeof obj.kind === "string" && obj.kind.length > 0
        ? obj.kind
        : TASK_DEFAULTS.kind,
    title: typeof obj.title === "string" ? obj.title : TASK_DEFAULTS.title,
    prompt: typeof obj.prompt === "string" ? obj.prompt : TASK_DEFAULTS.prompt,
    refs: Array.isArray(obj.refs) ? [...obj.refs] : [], // POC-3 审方修复: 防御拷贝，杜绝共享引用/别名联动
    acceptance:
      typeof obj.acceptance === "string"
        ? obj.acceptance
        : TASK_DEFAULTS.acceptance,
  };
}

/**
 * 校验执行结果对象是否符合契约约定的结构。
 * 校验规则：
 *   1) result 必须是对象（非 null、非数组），否则直接判定失败；
 *   2) 若 result 含 ok 字段，其值必须为布尔类型；
 *   3) 若 ok 为 true，且未要求任何产出物（expectArtifacts 为空）、也没有
 *      artifacts 数组，视为通过；
 *   4) 若 ok 为 false，则 result.errors 必须是非空数组，否则记为校验问题；
 *   5) 若 result.errors 字段存在但不是数组，记为校验问题；
 *   6) 若 expectArtifacts 非空，则 result.artifacts 必须存在且包含
 *      expectArtifacts 中的全部条目，否则记为校验问题。
 * 返回值中的 ok 表示"该结果对象是否结构合法"，errors 为发现的校验问题列表
 * （与 result.errors 是不同的概念，后者是被校验的输入字段）。
 * @param {unknown} result 待校验的执行结果对象
 * @param {{expectArtifacts?: string[]}} [options] 附加校验选项
 * @param {string[]} [options.expectArtifacts] 期望存在的产出物列表
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateResult(result, { expectArtifacts = [] } = {}) {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return { ok: false, errors: ["result 必须是一个对象"] };
  }

  const problems = [];

  if ("ok" in result && typeof result.ok !== "boolean") {
    problems.push("result.ok 字段必须为布尔值");
  }

  if (result.ok === false) {
    if (!Array.isArray(result.errors) || result.errors.length === 0) {
      problems.push("当 ok 为 false 时，result.errors 必须是非空数组");
    }
  }

  if (
    "errors" in result &&
    result.errors !== undefined &&
    !Array.isArray(result.errors)
  ) {
    problems.push("result.errors 字段必须为数组");
  }

  if (expectArtifacts.length > 0) {
    const artifacts = Array.isArray(result.artifacts) ? result.artifacts : [];
    const missing = expectArtifacts.filter((a) => !artifacts.includes(a));
    if (missing.length > 0) {
      problems.push(`缺少期望产出物: ${missing.join(", ")}`);
    }
  }

  return { ok: problems.length === 0, errors: problems };
}
