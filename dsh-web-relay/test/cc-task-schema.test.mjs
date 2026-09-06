import test from "node:test";
import assert from "node:assert/strict";
import { parseTask, validateResult } from "../lib/cc-task-schema.mjs";

test("parseTask 正常解析对象", () => {
  const input = {
    taskId: "t1",
    kind: "implement",
    title: "标题",
    prompt: "做点事",
    refs: ["a.md"],
    acceptance: "全部通过",
  };
  assert.deepEqual(parseTask(input), input);
});

test("parseTask 正常解析 JSON 文本", () => {
  const input = { taskId: "t2", kind: "review", prompt: "看看代码" };
  const text = JSON.stringify(input);
  assert.deepEqual(parseTask(text), {
    taskId: "t2",
    kind: "review",
    title: "",
    prompt: "看看代码",
    refs: [],
    acceptance: "",
  });
});

test("parseTask 缺省字段容错", () => {
  assert.deepEqual(parseTask({}), {
    taskId: "untitled",
    kind: "unknown",
    title: "",
    prompt: "",
    refs: [],
    acceptance: "",
  });
});

test("parseTask 非法输入不抛异常", () => {
  assert.doesNotThrow(() => parseTask("{ 不是合法 json"));
  assert.doesNotThrow(() => parseTask(null));
  assert.doesNotThrow(() => parseTask(42));
  assert.deepEqual(parseTask("{ 不是合法 json"), {
    taskId: "untitled",
    kind: "unknown",
    title: "",
    prompt: "",
    refs: [],
    acceptance: "",
  });
});

test("validateResult ok:true 且无产出物要求时通过", () => {
  const { ok, errors } = validateResult({ ok: true });
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
});

test("validateResult ok:false 但缺少 errors 时报错", () => {
  const { ok, errors } = validateResult({ ok: false });
  assert.equal(ok, false);
  assert.ok(errors.length > 0);
});

test("validateResult expectArtifacts 缺失时报错", () => {
  const { ok, errors } = validateResult(
    { ok: true, artifacts: ["a.txt"] },
    { expectArtifacts: ["a.txt", "b.txt"] },
  );
  assert.equal(ok, false);
  assert.ok(errors.length > 0);
});

test("validateResult 满足 expectArtifacts 时通过", () => {
  const { ok, errors } = validateResult(
    { ok: true, artifacts: ["a.txt", "b.txt"] },
    { expectArtifacts: ["a.txt", "b.txt"] },
  );
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
});

test("validateResult 非对象输入直接判定失败", () => {
  const { ok, errors } = validateResult(null);
  assert.equal(ok, false);
  assert.ok(errors.length > 0);
});

test("validateResult ok:false 且带有非空 errors 时视为结构合法", () => {
  const { ok, errors } = validateResult({ ok: false, errors: ["构建失败"] });
  assert.equal(ok, true);
  assert.deepEqual(errors, []);
});
