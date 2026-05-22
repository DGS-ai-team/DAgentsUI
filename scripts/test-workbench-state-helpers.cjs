const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");

require.extensions[".ts"] = function compileTs(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: filename,
  }).outputText;
  module._compile(output, filename);
};

const {
  appendUniqueId,
  appendUniqueIds,
  createApprovalTaskFromPayload,
  removeIds,
  upsertApprovalTask,
  upsertToolExecutionRecord,
  upsertToolResultExecutionRecord,
  usageRuntimeState,
} = require(path.join(projectRoot, "src/pages/chatWorkbench/workbenchStateHelpers.ts"));

assert.deepEqual(appendUniqueId(["a"], "a"), ["a"]);
assert.deepEqual(appendUniqueId(["a"], "b"), ["a", "b"]);
assert.deepEqual(appendUniqueIds(["a"], ["b", "a", "c"]), ["a", "b", "c"]);
assert.deepEqual(removeIds(["a", "b", "c"], ["b"]), ["a", "c"]);

const baseExecution = {
  id: "req:call-1",
  sessionId: "s1",
  requestId: "req",
  createdAt: 1,
  toolCallId: "call-1",
  toolName: "read_file",
  arguments: { path: "a.txt" },
  status: "success",
  summary: "done",
  finishedAt: 2,
};
assert.deepEqual(upsertToolExecutionRecord([], baseExecution), [baseExecution]);
assert.equal(upsertToolExecutionRecord([baseExecution], { ...baseExecution, status: "running" })[0].status, "success");
assert.equal(upsertToolExecutionRecord([baseExecution], { ...baseExecution, status: "error" })[0].status, "error");

{
  const current = [
    {
      id: "req:call-1",
      sessionId: "s1",
      requestId: "req",
      createdAt: 1,
      toolCallId: "call-1",
      toolName: "bash_run",
      arguments: { command: "pwd" },
      status: "running",
      summary: "bash_run 正在执行",
    },
  ];
  const next = upsertToolResultExecutionRecord({
    current,
    sessionId: "s1",
    requestId: "req",
    toolCallId: "call-1",
    toolName: "bash_run",
    content: "ok",
    rejected: false,
    displayType: "normal_text",
    rawRef: "",
    truncated: false,
    sensitiveFiltered: false,
    payload: { tool_call_id: "call-1", content: "ok" },
    fromPendingSnapshot: { cwd: "/tmp" },
    pickedArgs: { command: "pwd" },
    now: 10,
  });
  assert.equal(next.length, 1);
  assert.equal(next[0].status, "success");
  assert.equal(next[0].resultContent, "ok");
  assert.deepEqual(next[0].arguments, { cwd: "/tmp", command: "pwd" });
  assert.equal(next[0].finishedAt, 10);
}

{
  const next = upsertToolResultExecutionRecord({
    current: [],
    sessionId: "s1",
    requestId: "req",
    toolCallId: "call-new",
    toolName: "write_file",
    content: "rejected",
    rejected: true,
    displayType: "normal_text",
    rawRef: "",
    truncated: false,
    sensitiveFiltered: false,
    payload: { rejected: true },
    fromPendingSnapshot: { path: "a.txt" },
    pickedArgs: {},
    now: 20,
  });
  assert.equal(next.length, 1);
  assert.equal(next[0].status, "rejected");
  assert.deepEqual(next[0].arguments, { path: "a.txt" });
}

const approvalPayload = {
  approval_id: "approval-1",
  content: "需要审批",
  description: "执行工具",
  approval_args: {
    tool_calls: [{ id: "call-1", name: "bash_run", arguments: { command: "pwd" } }],
  },
};
const approvalTask = createApprovalTaskFromPayload({
  sessionId: "s1",
  requestId: "req",
  payload: approvalPayload,
  createdAt: 100,
});
assert.ok(approvalTask);
assert.equal(approvalTask.id, "approval-1");
assert.equal(approvalTask.payload.message, "需要审批");
assert.equal(approvalTask.payload.args.tool_calls[0].name, "bash_run");
assert.equal(
  createApprovalTaskFromPayload({ sessionId: "s1", requestId: "req", payload: {}, createdAt: 100 }),
  null,
);
assert.equal(upsertApprovalTask([], approvalTask).length, 1);
assert.equal(upsertApprovalTask([approvalTask], { ...approvalTask, payload: { ...approvalTask.payload, message: "更新" } })[0].payload.message, "更新");

const fallback = { status: "idle", usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } };
const runtime = usageRuntimeState({
  fallback,
  payload: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
});
assert.deepEqual(runtime.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
const runtimeWithBadNumbers = usageRuntimeState({
  previous: fallback,
  fallback,
  payload: { prompt_tokens: "bad", completion_tokens: Number.NaN, total_tokens: "also-bad" },
});
assert.deepEqual(runtimeWithBadNumbers.usage, fallback.usage);

console.log("workbenchStateHelpers tests passed");
