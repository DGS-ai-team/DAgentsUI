/**
 * DAgents 前端 UI 契约（MVP）
 *
 * 目标：
 * 1) 工具审批使用独立审批框；
 * 2) 多 Agent 协作使用子对话线程实时展示。
 */

import type {
  CancelTurnResult,
  MessageIn,
  SessionCreateIn,
  SessionCreateResult,
  SubmitResult,
} from "./api/types";

export type MessageRole = "user" | "assistant" | "tool" | "reasoning" | "system";

export type RequestStatus = "idle" | "queued" | "running" | "done" | "error" | "cancelled";

export type ApprovalDecision = "approve_all" | "reject_all" | "selective";

export type SubAgentStatus = "running" | "success" | "error" | "timeout" | "cancelled";

export interface UiMeta {
  sessionId: string;
  requestId?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface ChatMessage extends UiMeta {
  id: string;
  role: MessageRole;
  content: string;
  partial?: boolean;
  error?: string;
  /** 请求已提交但还未收到首个 SSE 内容块时显示 generating 占位 */
  generatingPending?: boolean;
  /** 为 true 时不流式展示 reasoning 全文，仅显示占位「thinking」+ 动画 */
  reasoningCollapsed?: boolean;
  /** 推理阶段尚未结束时为 true，用于控制等待动画 */
  reasoningPhaseActive?: boolean;
}

export type ToolRiskLevel = "low" | "medium" | "high";

export interface ToolCallItem {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments?: string;
  raw_arguments?: string;
  riskLevel?: ToolRiskLevel;
  risk_level?: ToolRiskLevel;
  approvalReason?: string;
  approval_reason?: string;
  approvalMode?: string;
  approval_mode?: string;
}

export interface ApprovalRequiredPayload {
  message: string;
  description?: string;
  args: {
    tool_calls: ToolCallItem[];
  };
}

export interface ApprovalTask extends UiMeta {
  id: string;
  payload: ApprovalRequiredPayload;
  handled: boolean;
  handledAt?: number;
  decision?: ApprovalDecision;
  approvedIds?: string[];
  rejectedIds?: string[];
}

export type ToolExecutionStatus = "running" | "success" | "rejected" | "error";

/** tool_call_delta 流式生成中的工具调用预览（未定稿，不触发执行）。 */
export interface ToolCallDraft {
  index: number;
  toolCallId?: string;
  toolName?: string;
  argumentsPreview: string;
  updatedAt: number;
}
export type ToolResultDisplayType = "terminal" | "code" | "normal_text" | "image" | "markdown";

export interface ToolExecutionRecord extends UiMeta {
  id: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: ToolExecutionStatus;
  summary?: string;
  resultContent?: string;
  detail?: string;
  displayType?: ToolResultDisplayType;
  rawRef?: string;
  truncated?: boolean;
  sensitiveFiltered?: boolean;
  finishedAt?: number;
}

export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface RuntimeState {
  status: RequestStatus;
  usage: UsageStats;
  model?: string;
  errorMessage?: string;
}

export interface SubAgentChunk {
  id: string;
  content: string;
  kind: "delta" | "tool" | "summary" | "error";
  ts: number;
}

export interface SubAgentThread extends UiMeta {
  id: string;
  parentRequestId: string;
  agentId: string;
  title?: string;
  status: SubAgentStatus;
  chunks: SubAgentChunk[];
  startedAt: number;
  endedAt?: number;
  errorMessage?: string;
}

export interface SubTaskSummary {
  total: number;
  running: number;
  success: number;
  error: number;
  timeout: number;
  cancelled: number;
  lastCompletedAt?: number;
}

/**
 * SSE 事件统一模型（前端侧）
 * 注意：当前部分子 agent 事件可能需要由 tool_call/tool_result 映射得到。
 */
export type StreamEvent =
  | { type: "assistant"; data: { content: string } }
  | { type: "reasoning"; data: { content: string } }
  | { type: "tool_call_delta"; data: { tool_calls?: unknown[] } }
  | { type: "tool_call"; data: { assistant_content?: string; tool_calls: ToolCallItem[] } }
  | {
      type: "tool_result";
      data: {
        tool_name?: string;
        tool_call_id?: string;
        content?: string;
        display_type?: ToolResultDisplayType;
        raw_ref?: string;
        truncated?: boolean;
        sensitive_filtered?: boolean;
      };
    }
  | { type: "approval_required"; data: ApprovalRequiredPayload }
  | { type: "usage"; data: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
  | { type: "done"; data: { finish_reason?: string } & Record<string, unknown> }
  | { type: "error"; data: { message: string } }
  | { type: "subagent_started"; data: { subagent_id: string; title?: string } }
  | { type: "subagent_delta"; data: { subagent_id: string; content: string } }
  | { type: "subagent_done"; data: { subagent_id: string } }
  | { type: "subagent_error"; data: { subagent_id: string; message: string } };

// ---------------------------
// 组件 Props 契约
// ---------------------------

export type ToolCallDecision = "approve" | "reject";

export interface MainChatPanelProps {
  sessionId: string;
  messages: ChatMessage[];
  approvals?: ApprovalTask[];
  toolExecutions?: ToolExecutionRecord[];
  /** 当前轮次 tool_call_delta 流式预览（未定稿）。 */
  toolCallDrafts?: ToolCallDraft[];
  submittingToolCallIds?: string[];
  runningToolCallIds?: string[];
  completedToolCallIds?: string[];
  disabled?: boolean;
  sending?: boolean;
  onSendMessage: (content: string) => Promise<void>;
  onDecideToolCall?: (
    taskId: string,
    toolCallId: string,
    decision: ToolCallDecision,
  ) => Promise<void>;
  onCancelCurrentTurn?: () => Promise<void>;
}

export interface SubAgentThreadTabsProps {
  threads: SubAgentThread[];
  activeThreadId?: string;
  onSwitchThread: (threadId: string) => void;
}

export interface SubAgentThreadViewProps {
  thread: SubAgentThread | null;
}

export interface SubTaskSummaryCardProps {
  summary: SubTaskSummary;
  onOpenDetails?: () => void;
}

export interface RuntimeStatusPanelProps {
  runtime: RuntimeState;
  latestError?: string;
  sseConnected: boolean;
}

// ---------------------------
// 页面级状态（建议）
// ---------------------------

export interface ChatWorkbenchState {
  currentSessionId: string | null;
  runtimeBySession: Record<string, RuntimeState>;
  messagesBySession: Record<string, ChatMessage[]>;
  approvalsBySession: Record<string, ApprovalTask[]>;
  subThreadsBySession: Record<string, SubAgentThread[]>;
  activeSubThreadBySession: Record<string, string | undefined>;
}

// ---------------------------
// 后端 API 契约（来自 OpenAPI 生成）
// ---------------------------

export type ApiSessionCreateIn = SessionCreateIn;
export type ApiSessionCreateResult = SessionCreateResult;
export type ApiMessageIn = MessageIn;
export type ApiSubmitResult = SubmitResult;
export type ApiCancelTurnResult = CancelTurnResult;
