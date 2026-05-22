const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const helperPath = path.join(projectRoot, "src/pages/chatWorkbench/a2aThreadHelpers.ts");

function loadTsModule(filePath) {
  const source = require("node:fs").readFileSync(filePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: true,
    },
    fileName: filePath,
  }).outputText;
  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  mod._compile(output, filePath);
  return mod.exports;
}

const {
  buildA2ARemoteThreadUpdates,
  describeA2AApprovals,
  isThreadTerminal,
  statusFromA2AFinalState,
} = loadTsModule(helperPath);

function envelope({
  targetAgentId = "agent-b",
  targetSessionId = "peer-session-b",
  deliveryMode = "direct",
  finalState = "succeeded",
  streamOutput = "remote output",
  approvals = [],
  errors = [],
  taskState = finalState,
  extraContent = {},
} = {}) {
  return JSON.stringify({
    protocol_version: "a2a-dagents/1.0",
    trace_id: "trace-test",
    message_id: "msg-test",
    timestamp_unix_ms: 1,
    caller: { agent_id: "agent-a", session_id: "default", discovery_groups: ["g1"] },
    target: { agent_id: targetAgentId, discovery_groups: [] },
    intent: "delegate",
    payload: {
      content_type: "application/json",
      content: {
        ok: finalState !== "failed",
        target_agent_id: targetAgentId,
        target_session_id: targetSessionId,
        delivery_mode: deliveryMode,
        stream_output: streamOutput,
        approvals,
        errors,
        final_state: finalState,
        ...extraContent,
      },
    },
    task: { task_id: "task-test", state: taskState, artifact_refs: [] },
  });
}

function approval() {
  return {
    target_session_id: "peer-session-b",
    approval_id: "approval-1",
    approval_type: "execute_tool",
    content: "远端 Agent 请求执行工具",
    description: "读取文件",
    display_type: "normal_text",
    approval_args: {
      tool_calls: [
        { id: "call-1", name: "read_file", arguments: { path: "/tmp/demo.txt" } },
        { id: "call-2", name: "bash_run", arguments: { command: "pwd" } },
      ],
    },
  };
}

assert.equal(statusFromA2AFinalState("succeeded"), "success");
assert.equal(statusFromA2AFinalState("requires_input"), "requires_input");
assert.equal(statusFromA2AFinalState("failed"), "error");
assert.equal(statusFromA2AFinalState("truncated"), "timeout");
assert.equal(statusFromA2AFinalState("unknown"), "running");
assert.equal(isThreadTerminal("success"), true);
assert.equal(isThreadTerminal("requires_input"), false);

const approvalText = describeA2AApprovals([approval()]);
assert.match(approvalText, /等待远端审批 \(1\)/);
assert.match(approvalText, /approval-1/);
assert.match(approvalText, /read_file, bash_run/);

{
  const updates = buildA2ARemoteThreadUpdates(
    "agent_send_message",
    "call-send",
    envelope({ finalState: "requires_input", streamOutput: "delegate output", approvals: [approval()] }),
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0].threadId, "a2a:peer-session-b");
  assert.equal(updates[0].agentId, "agent-b");
  assert.equal(updates[0].title, "A2A · agent-b");
  assert.equal(updates[0].status, "requires_input");
  assert.equal(updates[0].deliveryMode, "direct");
  assert.equal(updates[0].finalState, "requires_input");
  assert.equal(updates[0].traceId, "trace-test");
  assert.equal(updates[0].chunks.length, 3);
  assert.equal(updates[0].chunks[0].kind, "summary");
  assert.match(updates[0].chunks[1].content, /delegate output/);
  assert.match(updates[0].chunks[2].content, /等待远端审批/);
}

{
  const updates = buildA2ARemoteThreadUpdates(
    "agent_peer_approve_tools",
    "call-approve",
    envelope({ finalState: "failed", streamOutput: "resume output", errors: ["remote error"] }),
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "error");
  assert.equal(updates[0].errorMessage, "remote error");
  assert.equal(updates[0].chunks.at(-1).kind, "error");
  assert.match(updates[0].chunks.at(-1).content, /remote error/);
}

{
  const updates = buildA2ARemoteThreadUpdates(
    "agent_broadcast",
    "call-broadcast",
    envelope({
      extraContent: {
        stream_outputs: [
          {
            agent_id: "agent-b",
            session_id: "peer-b",
            output: "output b",
            final_state: "succeeded",
            approvals: [],
            errors: [],
          },
          {
            agent_id: "agent-c",
            session_id: "peer-c",
            output: "output c",
            final_state: "truncated",
            approvals: [],
            errors: ["timeout"],
          },
        ],
      },
    }),
  );
  assert.equal(updates.length, 2);
  assert.equal(updates[0].threadId, "a2a:peer-b");
  assert.equal(updates[0].status, "success");
  assert.equal(updates[1].threadId, "a2a:peer-c");
  assert.equal(updates[1].status, "timeout");
  assert.equal(updates[1].errorMessage, "timeout");
}

assert.deepEqual(buildA2ARemoteThreadUpdates("read_file", "call-read", envelope()), []);
assert.deepEqual(buildA2ARemoteThreadUpdates("agent_send_message", "call-send", "not json"), []);

console.log("a2aThreadHelpers tests passed");
