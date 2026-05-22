import type { SubAgentStatus, SubAgentThread } from "../../ui-contracts";

type JsonRecord = Record<string, unknown>;

type ParsedAgentPeerContent = {
  content: JsonRecord;
  traceId?: string;
  targetAgentId?: string;
  taskState?: string;
};

export type A2ARemoteThreadUpdate = {
  threadId: string;
  agentId: string;
  title: string;
  status: SubAgentStatus;
  chunks: SubAgentThread["chunks"];
  targetSessionId?: string;
  deliveryMode?: string;
  finalState?: string;
  traceId?: string;
  errorMessage?: string;
};

const A2A_THREAD_TOOL_NAMES = new Set(["agent_send_message", "agent_broadcast", "agent_peer_approve_tools"]);

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseJsonRecord(text: string): JsonRecord | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isJsonRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function parseAgentPeerContent(toolResultContent: string): ParsedAgentPeerContent | null {
  const parsed = parseJsonRecord(toolResultContent);
  if (!parsed) {
    return null;
  }
  const payload = isJsonRecord(parsed.payload) ? parsed.payload : null;
  const content = payload && isJsonRecord(payload.content) ? payload.content : null;
  if (!content) {
    return null;
  }
  const target = isJsonRecord(parsed.target) ? parsed.target : null;
  const task = isJsonRecord(parsed.task) ? parsed.task : null;
  return {
    content,
    traceId: stringValue(parsed.trace_id) || undefined,
    targetAgentId: target ? stringValue(target.agent_id) || undefined : undefined,
    taskState: task ? stringValue(task.state) || undefined : undefined,
  };
}

export function statusFromA2AFinalState(finalState: string): SubAgentStatus {
  if (finalState === "succeeded") {
    return "success";
  }
  if (finalState === "requires_input") {
    return "requires_input";
  }
  if (finalState === "failed") {
    return "error";
  }
  if (finalState === "truncated") {
    return "timeout";
  }
  return "running";
}

export function describeA2AApprovals(approvals: unknown[]): string {
  if (approvals.length === 0) {
    return "";
  }
  const lines = approvals.map((item, index) => {
    const approval = isJsonRecord(item) ? item : {};
    const approvalId = stringValue(approval.approval_id) || `approval-${index + 1}`;
    const approvalArgs = isJsonRecord(approval.approval_args) ? approval.approval_args : {};
    const toolCalls = Array.isArray(approvalArgs.tool_calls) ? approvalArgs.tool_calls : [];
    const toolNames = toolCalls
      .map((raw) => (isJsonRecord(raw) ? stringValue(raw.name) : ""))
      .filter(Boolean);
    const content = stringValue(approval.content) || stringValue(approval.description) || "等待工具审批";
    return `- ${approvalId}: ${content}${toolNames.length > 0 ? `（${toolNames.join(", ")}）` : ""}`;
  });
  return `等待远端审批 (${approvals.length})\n${lines.join("\n")}`;
}

function buildA2AChunks(args: {
  toolCallId: string;
  finalState: string;
  output: string;
  approvals: unknown[];
  errors: unknown[];
}): SubAgentThread["chunks"] {
  const now = Date.now();
  const chunks: SubAgentThread["chunks"] = [
    {
      id: `${args.toolCallId}:a2a-summary`,
      kind: "summary",
      content: `远端状态：${args.finalState || "unknown"}`,
      ts: now,
    },
  ];
  if (args.output) {
    chunks.push({
      id: `${args.toolCallId}:a2a-output`,
      kind: "delta",
      content: args.output,
      ts: now + 1,
    });
  }
  const approvalText = describeA2AApprovals(args.approvals);
  if (approvalText) {
    chunks.push({
      id: `${args.toolCallId}:a2a-approvals`,
      kind: "tool",
      content: approvalText,
      ts: now + 2,
    });
  }
  for (let i = 0; i < args.errors.length; i += 1) {
    const error = args.errors[i];
    const text = typeof error === "string" ? error.trim() : JSON.stringify(error);
    if (text) {
      chunks.push({
        id: `${args.toolCallId}:a2a-error:${i}`,
        kind: "error",
        content: text,
        ts: now + 3 + i,
      });
    }
  }
  return chunks;
}

export function buildA2ARemoteThreadUpdates(
  toolName: string,
  toolCallId: string,
  toolResultContent: string,
): A2ARemoteThreadUpdate[] {
  if (!A2A_THREAD_TOOL_NAMES.has(toolName)) {
    return [];
  }
  const parsed = parseAgentPeerContent(toolResultContent);
  if (!parsed) {
    return [];
  }
  const { content } = parsed;
  if (toolName === "agent_broadcast") {
    const streamOutputs = Array.isArray(content.stream_outputs) ? content.stream_outputs : [];
    return streamOutputs.flatMap((raw, index) => {
      if (!isJsonRecord(raw)) {
        return [];
      }
      const agentId = stringValue(raw.agent_id) || `remote-${index + 1}`;
      const targetSessionId = stringValue(raw.session_id);
      const finalState = stringValue(raw.final_state) || "running";
      const approvals = Array.isArray(raw.approvals) ? raw.approvals : [];
      const errors = Array.isArray(raw.errors) ? raw.errors : [];
      return [
        {
          threadId: `a2a:${targetSessionId || `${toolCallId}:${agentId}`}`,
          agentId,
          title: `A2A · ${agentId}`,
          status: statusFromA2AFinalState(finalState),
          chunks: buildA2AChunks({
            toolCallId: `${toolCallId}:${agentId}`,
            finalState,
            output: stringValue(raw.output),
            approvals,
            errors,
          }),
          targetSessionId: targetSessionId || undefined,
          finalState,
          traceId: parsed.traceId,
          errorMessage: errors.length > 0 ? String(errors[0]) : undefined,
        },
      ];
    });
  }

  const targetAgentId = stringValue(content.target_agent_id) || parsed.targetAgentId || "remote-agent";
  const targetSessionId = stringValue(content.target_session_id);
  const finalState = stringValue(content.final_state) || parsed.taskState || "running";
  const approvals = Array.isArray(content.approvals) ? content.approvals : [];
  const errors = Array.isArray(content.errors) ? content.errors : [];
  return [
    {
      threadId: `a2a:${targetSessionId || `${toolCallId}:${targetAgentId}`}`,
      agentId: targetAgentId,
      title: `A2A · ${targetAgentId}`,
      status: statusFromA2AFinalState(finalState),
      chunks: buildA2AChunks({
        toolCallId,
        finalState,
        output: stringValue(content.stream_output),
        approvals,
        errors,
      }),
      targetSessionId: targetSessionId || undefined,
      deliveryMode: stringValue(content.delivery_mode) || undefined,
      finalState,
      traceId: parsed.traceId,
      errorMessage: errors.length > 0 ? String(errors[0]) : undefined,
    },
  ];
}

export function isThreadTerminal(status: SubAgentStatus): boolean {
  return status === "success" || status === "error" || status === "timeout" || status === "cancelled";
}
