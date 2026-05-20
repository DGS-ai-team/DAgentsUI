import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MainChatPanel } from "../components/MainChatPanel";
import { RuntimeStatusPanel } from "../components/RuntimeStatusPanel";
import { SubAgentThreadTabs } from "../components/SubAgentThreadTabs";
import { SubAgentThreadView } from "../components/SubAgentThreadView";
import { useSettings } from "../settings/SettingsContext";
import { omitSessionKey } from "../utils/omitSessionKey";
import { normalizeToolDisplayType } from "../utils/displayType";
import { buildToolExecutionSummary, createMessage } from "./chatWorkbench/messageHelpers";
import {
  buildSessionHistory,
  DEFAULT_SESSION_ID,
  getSessionDisplayTitle,
} from "./chatWorkbench/sessionHelpers";
import {
  applyToolCallDeltaChunks,
  extractAssistantContentFromToolPayload,
  finalizeToolCallBufferFromItems,
  isErrorTurnFinishReason,
  isSegmentEndFinishReason,
  isTerminalTurnFinishReason,
  parseFinishReason,
} from "../utils/toolCallStream";
import {
  parseWorkbenchSseEnvelope,
  workbenchSseEventTypes,
} from "./chatWorkbench/sseEvents";
import {
  extractToolCallsFromPayload,
  normalizeToolCallItemArguments,
  pickToolArgumentsFromToolResultPayload,
} from "./chatWorkbench/toolPayload";
import { useBoundedEventSeqMemory } from "./chatWorkbench/useBoundedEventSeqMemory";
import { useToolCallDraftBuffers } from "./chatWorkbench/useToolCallDraftBuffers";
import { useWorkbenchApiBootstrap } from "./chatWorkbench/useWorkbenchApiBootstrap";
import { useWorkbenchSseConnection } from "./chatWorkbench/useWorkbenchSseConnection";
import type {
  ApprovalTask,
  ChatMessage,
  RuntimeState,
  SubAgentThread,
  ToolCallDraft,
  ToolExecutionRecord,
  ToolCallDecision,
  ToolCallItem,
} from "../ui-contracts";

const MAX_SEEN_EVENT_SEQ_KEYS = 5000;

/**
 * 统一的页面级日志函数。
 * - 自动附加 ISO 时间戳，便于在浏览器控制台串联一次请求生命周期
 * - payload 可选，用于打印结构化上下文数据
 */
function wbLog(message: string, payload?: unknown): void {
  const now = new Date().toISOString();
  if (payload === undefined) {
    console.log(`[ChatWorkbench] ${now} ${message}`);
  } else {
    console.log(`[ChatWorkbench] ${now} ${message}`, payload);
  }
}


/** 会话列表“新建”按钮图标。 */
function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="session-action-icon">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** 会话列表“编辑标题”按钮图标。 */
function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="session-action-icon">
      <path d="M4 20l4.5-1 9.2-9.2a1.7 1.7 0 0 0 0-2.4l-1.1-1.1a1.7 1.7 0 0 0-2.4 0L5 15.5 4 20z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

/** 会话列表“删除会话”按钮图标。 */
function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="session-action-icon">
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 12h8l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

/** 打开设置页 */
function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="session-action-icon">
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

/**
 * 主工作台组件。
 * 职责：
 * 1) 维护会话/消息/审批/子代理线程等页面状态
 * 2) 建立并消费 SSE 事件流
 * 3) 编排消息发送、工具审批、会话管理等交互
 */
export function ChatWorkbench({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { api, apiBaseUrl, apiReady, clientId, clientReady, configuredApiBaseUrl } =
    useWorkbenchApiBootstrap(wbLog);
  // 会话 ID 列表（包含默认会话与用户新建会话）。
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  // 当前激活（右侧主面板展示）的会话 ID。
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  /** 与 activeSessionId 同步，供 SSE 等长生命周期回调读取，避免闭包过期导致误切换当前会话。 */
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  // 按会话维度存储消息列表。
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({});
  // 按会话维度存储待审批工具任务。
  const [approvalsBySession, setApprovalsBySession] = useState<Record<string, ApprovalTask[]>>({});
  const approvalsBySessionRef = useRef(approvalsBySession);
  useEffect(() => {
    approvalsBySessionRef.current = approvalsBySession;
  }, [approvalsBySession]);
  // 按会话维度存储工具执行记录（running/success/error 等）。
  const [toolExecutionsBySession, setToolExecutionsBySession] = useState<Record<string, ToolExecutionRecord[]>>(
    {},
  );
  const [toolCallDraftsBySession, setToolCallDraftsBySession] = useState<Record<string, ToolCallDraft[]>>({});
  // 按会话维度存储子代理线程列表。
  const [threadsBySession, setThreadsBySession] = useState<Record<string, SubAgentThread[]>>({});
  // 按会话维度记录当前选中的子线程 ID。
  const [activeThreadBySession, setActiveThreadBySession] = useState<Record<string, string | undefined>>({});
  // 按会话维度记录“审批提交中”的 tool_call ID 列表（用于按钮 loading 态）。
  const [submittingToolCallIdsBySession, setSubmittingToolCallIdsBySession] = useState<Record<string, string[]>>(
    {},
  );
  // 按会话维度记录“正在执行”的 tool_call ID 列表。
  const [runningToolCallIdsBySession, setRunningToolCallIdsBySession] = useState<Record<string, string[]>>({});
  // 按会话维度记录“已完成”的 tool_call ID 列表。
  const [completedToolCallIdsBySession, setCompletedToolCallIdsBySession] = useState<Record<string, string[]>>(
    {},
  );
  // 按会话维度标记“发送消息中”状态。
  const [sendingBySession, setSendingBySession] = useState<Record<string, boolean>>({});
  // 按会话维度记录运行态（status/usage/errorMessage）。
  const [runtimeBySession, setRuntimeBySession] = useState<Record<string, RuntimeState>>({});
  // 运行态兜底模型：当会话还没初始化运行态时使用。
  const [defaultRuntimeModel] = useState<RuntimeState>({
    status: "idle",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
  });
  // 按会话维度记录最近一次错误（展示在 UI）。
  const [latestErrorBySession, setLatestErrorBySession] = useState<Record<string, string | undefined>>({});
  // 会话标题映射表（支持用户重命名）。
  const [sessionTitleById, setSessionTitleById] = useState<Record<string, string>>({});
  // 当前正在编辑标题的会话 ID。
  const [editingSessionId, setEditingSessionId] = useState<string>("");
  // 标题编辑输入框草稿。
  const [editingTitleDraft, setEditingTitleDraft] = useState<string>("");
  const {
    globalStreamRef,
    sseConnected,
    sseGeneration,
    setSseConnected,
    closeGlobalSse,
    openGlobalSse,
  } = useWorkbenchSseConnection(wbLog);
  const { rememberEventSeq, clearEventSeqMemory } = useBoundedEventSeqMemory(MAX_SEEN_EVENT_SEQ_KEYS);
  /** 已记录的后端地址（用于检测设置页保存后是否需要重连 SSE）。 */
  const trackedBackendBaseUrlRef = useRef<string | undefined>(undefined);
  // 每个会话当前流式轮次计数（用于拼接增量内容时区分轮次）。
  const streamTurnBySessionRef = useRef<Record<string, number>>({});
  // 标记某个请求是否已经收到过服务端响应块，避免快速响应后补出过期 generating 占位。
  const responseStartedByRequestRef = useRef<Set<string>>(new Set());
  /** SSE tool_call 阶段按 tool_call_id 缓存的调用参数，供 tool_result 合并展示（如 read_file 路径）。 */
  const pendingToolCallArgsBySessionRef = useRef<Record<string, Record<string, Record<string, unknown>>>>({});
  const {
    getOrCreateToolCallBuffer,
    syncToolCallDraftsForRequest,
    clearToolCallDraftsForRequest,
    clearToolCallDraftsForSession,
    resetToolCallDraftBuffers,
  } = useToolCallDraftBuffers(setToolCallDraftsBySession);
  const { settings, loaded: settingsLoaded } = useSettings();
  const showReasoningDetailRef = useRef(settings.showReasoningDetail);
  useEffect(() => {
    showReasoningDetailRef.current = settings.showReasoningDetail;
  }, [settings.showReasoningDetail]);

  // 当前会话对应的消息列表（无则为空数组）。
  const activeMessages = messagesBySession[activeSessionId] ?? [];
  // 当前会话对应的审批任务（无则为空数组）。
  const activeApprovals = approvalsBySession[activeSessionId] ?? [];
  // 当前会话对应的工具执行记录（无则为空数组）。
  const activeToolExecutions = toolExecutionsBySession[activeSessionId] ?? [];
  const activeToolCallDrafts = toolCallDraftsBySession[activeSessionId] ?? [];
  // 当前会话对应的子代理线程列表（无则为空数组）。
  const activeThreads = threadsBySession[activeSessionId] ?? [];
  // 当前会话选中的子线程 ID。
  const activeThreadId = activeThreadBySession[activeSessionId];
  // 当前会话运行态（无则使用默认运行态）。
  const activeRuntime = runtimeBySession[activeSessionId] ?? defaultRuntimeModel;
  // 当前会话最近错误文本。
  const activeLatestError = latestErrorBySession[activeSessionId];
  // 当前会话“审批提交中”的工具调用 ID 列表。
  const activeSubmittingToolCallIds = submittingToolCallIdsBySession[activeSessionId] ?? [];
  // 当前会话“执行中”的工具调用 ID 列表。
  const activeRunningToolCallIds = runningToolCallIdsBySession[activeSessionId] ?? [];
  // 当前会话“已完成”的工具调用 ID 列表。
  const activeCompletedToolCallIds = completedToolCallIdsBySession[activeSessionId] ?? [];
  // 当前会话是否处于“发送请求中”。
  const activeSending = sendingBySession[activeSessionId] ?? false;
  const sessionHistory = useMemo(() => buildSessionHistory(sessionIds), [sessionIds]);

  const getSessionTitle = (sid: string): string =>
    getSessionDisplayTitle({
      sessionId: sid,
      sessionIds,
      sessionTitleById,
    });

  /**
   * 确保某个 session 在各类状态表中已初始化。
   * 该函数用于处理“后端先推事件、前端还未建本地会话槽位”的情况。
   */
  const ensureSessionSlot = (sid: string) => {
    setSessionIds((prev) => (prev.includes(sid) ? prev : [...prev, sid]));
    setSessionTitleById((prev) => {
      if (sid in prev) {
        return prev;
      }
      if (sid === DEFAULT_SESSION_ID) {
        return { ...prev, [sid]: "默认对话" };
      }
      return { ...prev, [sid]: "新对话" };
    });
    setRuntimeBySession((prev) => {
      if (sid in prev) {
        return prev;
      }
      return {
        ...prev,
        [sid]: {
          status: "idle",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        },
      };
    });
    if (!activeSessionIdRef.current) {
      setActiveSessionId(sid);
    }
  };

  /**
   * 向指定会话末尾追加一条消息。
   * 这是所有“新增消息”路径的统一写入口，便于后续统一做去重/限长策略。
   */
  const appendMessageForSession = (sid: string, message: ChatMessage) => {
    setMessagesBySession((prev) => {
      const current = prev[sid] ?? [];
      return { ...prev, [sid]: [...current, message] };
    });
  };

  /**
   * 对工具执行记录执行 upsert（存在则更新，不存在则追加）。
   * 常用于工具从 running -> success/rejected/error 的状态推进。
   */
  const upsertToolExecutionForSession = (sid: string, item: ToolExecutionRecord) => {
    setToolExecutionsBySession((prev) => {
      const current = prev[sid] ?? [];
      const index = current.findIndex((row) => row.id === item.id);
      if (index < 0) {
        return { ...prev, [sid]: [...current, item] };
      }
      const existing = current[index];
      if (
        item.status === "running" &&
        (existing.status === "success" || existing.status === "rejected" || existing.status === "error")
      ) {
        return prev;
      }
      const next = [...current];
      next[index] = item;
      return { ...prev, [sid]: next };
    });
  };

  const registerRunningToolCallsForSession = useCallback(
    (sid: string, requestId: string, toolCalls: ToolCallItem[]) => {
      const prevBucket = pendingToolCallArgsBySessionRef.current[sid] ?? {};
      const bucket: Record<string, Record<string, unknown>> = { ...prevBucket };
      const runningIds: string[] = [];

      for (const tc of toolCalls) {
        const toolCallId = String(tc.id ?? "").trim();
        if (!toolCallId) {
          continue;
        }
        const args = normalizeToolCallItemArguments(tc.arguments);
        bucket[toolCallId] = { ...(bucket[toolCallId] ?? {}), ...args };
        runningIds.push(toolCallId);
        upsertToolExecutionForSession(sid, {
          id: `${requestId}:${toolCallId}`,
          sessionId: sid,
          requestId,
          createdAt: Date.now(),
          toolCallId,
          toolName: tc.name || "tool",
          arguments: args,
          status: "running",
          summary: buildToolExecutionSummary(tc.name || "tool", "running"),
        });
      }

      if (runningIds.length > 0) {
        pendingToolCallArgsBySessionRef.current[sid] = bucket;
        setRunningToolCallIdsBySession((prev) => {
          const current = prev[sid] ?? [];
          const merged = [...current];
          for (const id of runningIds) {
            if (!merged.includes(id)) {
              merged.push(id);
            }
          }
          return { ...prev, [sid]: merged };
        });
      }
    },
    [],
  );

  const markSessionAgentWorking = useCallback(
    (sid: string) => {
      setRuntimeBySession((prev) => ({
        ...prev,
        [sid]: {
          ...(prev[sid] ?? defaultRuntimeModel),
          status: "running",
          errorMessage: undefined,
        },
      }));
      setSendingBySession((prev) => ({ ...prev, [sid]: true }));
    },
    [defaultRuntimeModel],
  );

  /**
   * 删除会话及其关联状态。
   * - 默认会话不可删除
   * - 删除时会同步清理消息、审批、线程、运行态等所有 session 维度状态
   */
  const handleDeleteSession = (sid: string) => {
    if (sid === DEFAULT_SESSION_ID) {
      wbLog("session:delete:blocked-default", { sessionId: sid });
      return;
    }
    wbLog("session:delete:start", { sessionId: sid });
    setSessionIds((prev) => {
      const next = prev.filter((item) => item !== sid);
      setActiveSessionId((current) => {
        if (current === sid) {
          return next[0] ?? "";
        }
        return current;
      });
      return next;
    });
    setSessionTitleById((prev) => omitSessionKey(prev, sid));
    setMessagesBySession((prev) => omitSessionKey(prev, sid));
    setApprovalsBySession((prev) => omitSessionKey(prev, sid));
    setToolExecutionsBySession((prev) => omitSessionKey(prev, sid));
    setToolCallDraftsBySession((prev) => omitSessionKey(prev, sid));
    clearToolCallDraftsForSession(sid);
    setThreadsBySession((prev) => omitSessionKey(prev, sid));
    setActiveThreadBySession((prev) => omitSessionKey(prev, sid));
    setSubmittingToolCallIdsBySession((prev) => omitSessionKey(prev, sid));
    setRunningToolCallIdsBySession((prev) => omitSessionKey(prev, sid));
    setCompletedToolCallIdsBySession((prev) => omitSessionKey(prev, sid));
    setSendingBySession((prev) => omitSessionKey(prev, sid));
    setRuntimeBySession((prev) => omitSessionKey(prev, sid));
    setLatestErrorBySession((prev) => omitSessionKey(prev, sid));
    delete pendingToolCallArgsBySessionRef.current[sid];
    if (editingSessionId === sid) {
      setEditingSessionId("");
      setEditingTitleDraft("");
    }
    wbLog("session:delete:done", { sessionId: sid });
  };

  /** 进入会话标题编辑态，并预填当前标题。 */
  const handleStartEditSessionTitle = (sid: string) => {
    setEditingSessionId(sid);
    setEditingTitleDraft(getSessionTitle(sid));
  };

  /**
   * 提交会话标题编辑。
   * 空标题会被视为取消编辑（不落库、不更新显示名）。
   */
  const handleCommitEditSessionTitle = (sid: string) => {
    const nextTitle = editingTitleDraft.trim();
    if (!nextTitle) {
      setEditingSessionId("");
      setEditingTitleDraft("");
      return;
    }
    setSessionTitleById((prev) => ({ ...prev, [sid]: nextTitle }));
    setEditingSessionId("");
    setEditingTitleDraft("");
  };

  const resetWorkbenchSessionState = useCallback(() => {
    wbLog("workbench:reset-for-backend-switch");
    setSessionIds([]);
    setActiveSessionId(DEFAULT_SESSION_ID);
    setMessagesBySession({});
    setApprovalsBySession({});
    setToolExecutionsBySession({});
    setToolCallDraftsBySession({});
    resetToolCallDraftBuffers();
    setThreadsBySession({});
    setActiveThreadBySession({});
    setSubmittingToolCallIdsBySession({});
    setRunningToolCallIdsBySession({});
    setCompletedToolCallIdsBySession({});
    setSendingBySession({});
    setRuntimeBySession({});
    setLatestErrorBySession({});
    setSessionTitleById({});
    setEditingSessionId("");
    setEditingTitleDraft("");
    clearEventSeqMemory();
    streamTurnBySessionRef.current = {};
    responseStartedByRequestRef.current.clear();
    pendingToolCallArgsBySessionRef.current = {};
  }, [clearEventSeqMemory, resetToolCallDraftBuffers]);

  const bootstrapMainSessionAndSse = useCallback(
    async (reason: string, shouldContinue: () => boolean = () => true) => {
      if (!apiReady || !clientReady || !clientId || !shouldContinue()) {
        return;
      }
      wbLog("bootstrap:main-session", { reason, effectiveApiBaseUrl: apiBaseUrl, clientId });

      closeGlobalSse();

      if (reason === "backend-url-changed") {
        resetWorkbenchSessionState();
      } else {
        clearEventSeqMemory();
        streamTurnBySessionRef.current[DEFAULT_SESSION_ID] = 0;
        setActiveSessionId(DEFAULT_SESSION_ID);
        setLatestErrorBySession((prev) => ({ ...prev, [DEFAULT_SESSION_ID]: undefined }));
        setRuntimeBySession((prev) => ({
          ...prev,
          [DEFAULT_SESSION_ID]: {
            status: "idle",
            usage: prev[DEFAULT_SESSION_ID]?.usage ?? {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
            },
          },
        }));
      }

      try {
        const result = await api.createSession({ session_id: DEFAULT_SESSION_ID });
        wbLog("bootstrap:createSession:success", { reason, sessionId: result.session_id });
        ensureSessionSlot(result.session_id);
      } catch (error) {
        const message = String(error);
        wbLog("bootstrap:createSession:error", { reason, error: message });
        setLatestErrorBySession((prev) => ({ ...prev, [DEFAULT_SESSION_ID]: message }));
        setRuntimeBySession((prev) => ({
          ...prev,
          [DEFAULT_SESSION_ID]: {
            ...(prev[DEFAULT_SESSION_ID] ?? defaultRuntimeModel),
            status: "error",
            errorMessage: message,
          },
        }));
        return;
      }

      if (!shouldContinue()) {
        return;
      }
      const streamUrl = api.streamAllUrl(clientId);
      wbLog("sse:global:open", { streamUrl, clientId, reason });
      openGlobalSse(streamUrl);
    },
    [
      api,
      apiBaseUrl,
      apiReady,
      clientId,
      clientReady,
      clearEventSeqMemory,
      closeGlobalSse,
      defaultRuntimeModel,
      openGlobalSse,
      resetWorkbenchSessionState,
    ],
  );

  // ----- 启动：默认主会话 + 全局 SSE -----
  useEffect(() => {
    if (!apiReady || !clientReady || !clientId) {
      return;
    }
    wbLog("bootstrap:start", {
      configuredApiBaseUrl,
      effectiveApiBaseUrl: apiBaseUrl,
    });
    let cancelled = false;
    void bootstrapMainSessionAndSse("initial", () => !cancelled);
    return () => {
      cancelled = true;
      closeGlobalSse();
    };
  }, [api, apiBaseUrl, apiReady, clientId, clientReady, bootstrapMainSessionAndSse, closeGlobalSse]);

  // ----- 设置页修改真实后端后：重连主会话 SSE -----
  useEffect(() => {
    if (!settingsLoaded || !apiReady || !clientReady || !clientId) {
      return;
    }
    const current = settings.backendBaseUrl ?? "";
    if (trackedBackendBaseUrlRef.current === undefined) {
      trackedBackendBaseUrlRef.current = current;
      return;
    }
    if (trackedBackendBaseUrlRef.current === current) {
      return;
    }
    trackedBackendBaseUrlRef.current = current;
    void bootstrapMainSessionAndSse("backend-url-changed");
  }, [
    settings.backendBaseUrl,
    settingsLoaded,
    apiReady,
    clientReady,
    clientId,
    bootstrapMainSessionAndSse,
  ]);

  const activeThread = useMemo(
    () => activeThreads.find((item) => item.id === activeThreadId) || null,
    [activeThreadId, activeThreads],
  );

  /**
   * 处理 assistant/reasoning 的流式增量消息。
   * 同一 requestId + role 会合并到最后一条消息，避免每个 delta 生成单独气泡。
   */
  const appendStreamingMessage = (
    sid: string,
    role: ChatMessage["role"],
    requestId: string,
    deltaText: string,
  ) => {
    // 同一 requestId + 同一 role 的流式片段合并进最后一个气泡，避免每个 delta 生成独立消息。
    setMessagesBySession((prev) => {
      const sessionMessages = prev[sid] ?? [];
      const lastIndex = sessionMessages.length - 1;
      if (lastIndex >= 0) {
        const last = sessionMessages[lastIndex];
        if (last.role === role && last.requestId === requestId && last.sessionId === sid) {
          const merged: ChatMessage = {
            ...last,
            content: `${last.content}${deltaText}`,
            reasoningPhaseActive: role === "reasoning" ? true : last.reasoningPhaseActive,
          };
          return {
            ...prev,
            [sid]: [...sessionMessages.slice(0, lastIndex), merged],
          };
        } else {
          const message = createMessage(sid, role, deltaText, requestId);
          return {
            ...prev,
            [sid]: [...sessionMessages, role === "reasoning" ? { ...message, reasoningPhaseActive: true } : message],
          };
        }
      } else {
        const message = createMessage(sid, role, deltaText, requestId);
        return {
          ...prev,
          [sid]: [role === "reasoning" ? { ...message, reasoningPhaseActive: true } : message],
        };
      }
    });
  };

  const mergeAssistantContentForRequest = (sid: string, requestId: string, content: string) => {
    const text = content.trim();
    if (!text) {
      return;
    }
    setMessagesBySession((prev) => {
      const sessionMessages = prev[sid] ?? [];
      let index = -1;
      for (let i = sessionMessages.length - 1; i >= 0; i -= 1) {
        const m = sessionMessages[i];
        if (m.sessionId === sid && m.requestId === requestId && m.role === "assistant" && !m.generatingPending) {
          index = i;
          break;
        }
      }
      if (index < 0) {
        return { ...prev, [sid]: [...sessionMessages, createMessage(sid, "assistant", text, requestId)] };
      }
      const current = sessionMessages[index];
      const currentText = current.content.trim();
      if (currentText === text || currentText.includes(text)) {
        return prev;
      }
      const next = [...sessionMessages];
      next[index] = {
        ...current,
        content: text.startsWith(currentText) ? text : `${current.content}${content}`,
      };
      return { ...prev, [sid]: next };
    });
  };

  // ----- 全局 SSE：事件分发（assistant / tool / 子线程等）-----
  useEffect(() => {
    const es = globalStreamRef.current;
    if (!es) {
      return;
    }

    const finalizeCollapsedReasoningPhase = (sessionId: string, requestKey: string) => {
      setMessagesBySession((prev) => {
        const sessionMessages = prev[sessionId] ?? [];
        let changed = false;
        const next = sessionMessages.map((m) => {
          if (
            m.sessionId === sessionId &&
            m.requestId === requestKey &&
            m.role === "reasoning" &&
            m.reasoningPhaseActive
          ) {
            changed = true;
            return { ...m, reasoningPhaseActive: false };
          }
          return m;
        });
        return changed ? { ...prev, [sessionId]: next } : prev;
      });
    };

    const appendCollapsedReasoningPlaceholder = (sessionId: string, requestKey: string) => {
      setMessagesBySession((prev) => {
        const sessionMessages = prev[sessionId] ?? [];
        const last = sessionMessages[sessionMessages.length - 1];
        if (
          last &&
          last.role === "reasoning" &&
          last.requestId === requestKey &&
          last.sessionId === sessionId &&
          last.reasoningCollapsed
        ) {
          return prev;
        }
        const msg = createMessage(sessionId, "reasoning", "", requestKey);
        const withFlags: ChatMessage = {
          ...msg,
          reasoningCollapsed: true,
          reasoningPhaseActive: true,
        };
        return { ...prev, [sessionId]: [...sessionMessages, withFlags] };
      });
    };

    const removeGeneratingPlaceholder = (sessionId: string, requestKey: string) => {
      responseStartedByRequestRef.current.add(requestKey);
      setMessagesBySession((prev) => {
        const sessionMessages = prev[sessionId] ?? [];
        const next = sessionMessages.filter(
          (m) => !(m.sessionId === sessionId && m.requestId === requestKey && m.generatingPending),
        );
        return next.length === sessionMessages.length ? prev : { ...prev, [sessionId]: next };
      });
    };

    /**
     * SSE 事件主分发器。
     * 按事件类型更新对应状态（消息、工具执行、审批、用量、子代理线程等）。
     */
    const onEvent = (eventType: string, envelope: Record<string, unknown>) => {
      const sid = String(envelope.session_id ?? "").trim();
      const turnIndex = streamTurnBySessionRef.current[sid] ?? 0;
      const requestId = `${sid}:turn:${turnIndex}`;
      const payload = (envelope.data ?? {}) as Record<string, unknown>;
      const content = typeof payload.content === "string" ? payload.content : "";
      if (!sid) {
        wbLog("sse:event:missing-session-or-request", { eventType, envelope });
        return;
      } else {
        ensureSessionSlot(sid);
      }
      wbLog("sse:event", { eventType, sessionId: sid, requestId, hasContent: Boolean(content) });

      if (eventType === "assistant" || eventType === "reasoning") {
        if (content) {
          removeGeneratingPlaceholder(sid, requestId);
          if (eventType === "assistant") {
            finalizeCollapsedReasoningPhase(sid, requestId);
            appendStreamingMessage(sid, "assistant", requestId, content);
          } else if (showReasoningDetailRef.current) {
            appendStreamingMessage(sid, "reasoning", requestId, content);
          } else {
            appendCollapsedReasoningPlaceholder(sid, requestId);
          }
          markSessionAgentWorking(sid);
        } else {
          return;
        }
      } else if (eventType === "tool_result") {
        removeGeneratingPlaceholder(sid, requestId);
        finalizeCollapsedReasoningPhase(sid, requestId);
        const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "tool";
        const toolCallId = typeof payload.tool_call_id === "string" ? payload.tool_call_id : "";
        const rejected = Boolean(payload.rejected);
        const displayType = normalizeToolDisplayType(payload.display_type);
        const rawRef = typeof payload.raw_ref === "string" ? payload.raw_ref : "";
        const truncated = Boolean(payload.truncated);
        const sensitiveFiltered = Boolean(payload.sensitive_filtered);
        if (!toolCallId) {
          return;
        } else {
          setRunningToolCallIdsBySession((prev) => ({
            ...prev,
            [sid]: (prev[sid] ?? []).filter((id) => id !== toolCallId),
          }));
          setCompletedToolCallIdsBySession((prev) => {
            const current = prev[sid] ?? [];
            return { ...prev, [sid]: current.includes(toolCallId) ? current : [...current, toolCallId] };
          });
          const pickedArgs = pickToolArgumentsFromToolResultPayload(payload as Record<string, unknown>);
          const fromPendingSnapshot =
            pendingToolCallArgsBySessionRef.current[sid]?.[toolCallId] ?? {};
          {
            const bucket = pendingToolCallArgsBySessionRef.current[sid];
            if (bucket && toolCallId in bucket) {
              const { [toolCallId]: _removed, ...rest } = bucket;
              if (Object.keys(rest).length === 0) {
                const { [sid]: _sidRemoved, ...sessions } = pendingToolCallArgsBySessionRef.current;
                pendingToolCallArgsBySessionRef.current = sessions;
              } else {
                pendingToolCallArgsBySessionRef.current[sid] = rest;
              }
            }
          }
          setToolExecutionsBySession((prev) => {
            const current = prev[sid] ?? [];
            const idx = current.findIndex((row) => row.toolCallId === toolCallId);
            if (idx < 0) {
              const mergedArguments = { ...fromPendingSnapshot, ...pickedArgs };
              const created: ToolExecutionRecord = {
                id: `${requestId}:${toolCallId}`,
                sessionId: sid,
                requestId,
                createdAt: Date.now(),
                toolCallId,
                toolName,
                arguments: mergedArguments,
                status: rejected ? "rejected" : "success",
                summary: buildToolExecutionSummary(
                  toolName,
                  rejected ? "rejected" : "success",
                  content,
                ),
                resultContent: content,
                displayType,
                rawRef,
                truncated,
                sensitiveFiltered,
                detail: JSON.stringify(payload, null, 2),
                finishedAt: Date.now(),
              };
              return { ...prev, [sid]: [...current, created] };
            } else {
              const next = [...current];
              const mergedArguments = {
                ...fromPendingSnapshot,
                ...next[idx].arguments,
                ...pickedArgs,
              };
              next[idx] = {
                ...next[idx],
                status: rejected ? "rejected" : "success",
                summary: buildToolExecutionSummary(
                  next[idx].toolName || toolName,
                  rejected ? "rejected" : "success",
                  content,
                ),
                resultContent: content,
                displayType,
                rawRef,
                truncated,
                sensitiveFiltered,
                detail: JSON.stringify(payload, null, 2),
                finishedAt: Date.now(),
                arguments: mergedArguments,
              };
              return { ...prev, [sid]: next };
            }
          });
          markSessionAgentWorking(sid);
        }
      } else if (eventType === "approval_required") {
        removeGeneratingPlaceholder(sid, requestId);
        finalizeCollapsedReasoningPhase(sid, requestId);
        const fromApprovalArgs = (payload.approval_args ?? {}) as { tool_calls?: ToolCallItem[] };
        const fromNestedArgs = (payload.args ?? {}) as { tool_calls?: ToolCallItem[] };
        const toolCalls = Array.isArray(fromApprovalArgs.tool_calls)
          ? fromApprovalArgs.tool_calls
          : Array.isArray(fromNestedArgs.tool_calls)
            ? fromNestedArgs.tool_calls
            : [];
        if (toolCalls.length === 0) {
          wbLog("sse:approval_required:skip-empty-tool_calls", { sessionId: sid, payloadKeys: Object.keys(payload) });
          return;
        } else {
          const idRaw = typeof payload.approval_id === "string" ? payload.approval_id : "";
          const approvalId = idRaw || `${requestId}-${Date.now()}`;
          const approvalTask: ApprovalTask = {
            id: approvalId,
            sessionId: sid,
            requestId,
            createdAt: Date.now(),
            payload: {
              message: typeof payload.content === "string" ? payload.content : "工具调用",
              description: typeof payload.description === "string" ? payload.description : "",
              args: { tool_calls: toolCalls },
            },
            handled: false,
          };
          setApprovalsBySession((prev) => {
            const current = prev[sid] ?? [];
            const exists = current.some((item) => item.id === approvalTask.id);
            return {
              ...prev,
              [sid]: exists
                ? current.map((item) => (item.id === approvalTask.id ? approvalTask : item))
                : [...current, approvalTask],
            };
          });
          markSessionAgentWorking(sid);
        }
      } else if (eventType === "usage") {
        finalizeCollapsedReasoningPhase(sid, requestId);
        const input = Number(payload.prompt_tokens ?? 0);
        const output = Number(payload.completion_tokens ?? 0);
        const total = Number(payload.total_tokens ?? input + output);
        setRuntimeBySession((prev) => ({
          ...prev,
          [sid]: {
            ...(prev[sid] ?? defaultRuntimeModel),
            usage: {
              inputTokens: Number.isFinite(input) ? input : (prev[sid] ?? defaultRuntimeModel).usage.inputTokens,
              outputTokens: Number.isFinite(output) ? output : (prev[sid] ?? defaultRuntimeModel).usage.outputTokens,
              totalTokens: Number.isFinite(total) ? total : (prev[sid] ?? defaultRuntimeModel).usage.totalTokens,
            },
          },
        }));
      } else if (eventType === "error") {
        removeGeneratingPlaceholder(sid, requestId);
        finalizeCollapsedReasoningPhase(sid, requestId);
        clearToolCallDraftsForRequest(sid, requestId);
        streamTurnBySessionRef.current[sid] = (streamTurnBySessionRef.current[sid] ?? 0) + 1;
        const message = typeof payload.message === "string" ? payload.message : "运行异常";
        // 当前轮次已异常终止，未处理的审批已失效，避免 UI 继续显示“待审批”。
        setApprovalsBySession((prev) => ({ ...prev, [sid]: [] }));
        setSubmittingToolCallIdsBySession((prev) => ({ ...prev, [sid]: [] }));
        setRunningToolCallIdsBySession((prev) => ({ ...prev, [sid]: [] }));
        setLatestErrorBySession((prev) => ({ ...prev, [sid]: message }));
        setRuntimeBySession((prev) => ({
          ...prev,
          [sid]: { ...(prev[sid] ?? defaultRuntimeModel), status: "error", errorMessage: message },
        }));
        setSendingBySession((prev) => ({ ...prev, [sid]: false }));
      } else if (eventType === "done") {
        removeGeneratingPlaceholder(sid, requestId);
        finalizeCollapsedReasoningPhase(sid, requestId);
        const finishReason = parseFinishReason(payload);
        const hasPendingApproval = (approvalsBySessionRef.current[sid] ?? []).some((task) => !task.handled);
        wbLog("sse:done", { sessionId: sid, requestId, finishReason, hasPendingApproval });

        if (isTerminalTurnFinishReason(finishReason)) {
          clearToolCallDraftsForRequest(sid, requestId);
          streamTurnBySessionRef.current[sid] = (streamTurnBySessionRef.current[sid] ?? 0) + 1;
          setRuntimeBySession((prev) => ({
            ...prev,
            [sid]: { ...(prev[sid] ?? defaultRuntimeModel), status: "done", errorMessage: undefined },
          }));
          setSendingBySession((prev) => ({ ...prev, [sid]: false }));
          setSubmittingToolCallIdsBySession((prev) => ({ ...prev, [sid]: [] }));
        } else if (isErrorTurnFinishReason(finishReason)) {
          clearToolCallDraftsForRequest(sid, requestId);
          streamTurnBySessionRef.current[sid] = (streamTurnBySessionRef.current[sid] ?? 0) + 1;
          const message =
            typeof payload.message === "string"
              ? payload.message
              : finishReason === "resume_rejected"
                ? "已拒绝继续执行"
                : "运行异常";
          setLatestErrorBySession((prev) => ({ ...prev, [sid]: message }));
          setRuntimeBySession((prev) => ({
            ...prev,
            [sid]: { ...(prev[sid] ?? defaultRuntimeModel), status: "error", errorMessage: message },
          }));
          setSendingBySession((prev) => ({ ...prev, [sid]: false }));
          setSubmittingToolCallIdsBySession((prev) => ({ ...prev, [sid]: [] }));
        } else if (isSegmentEndFinishReason(finishReason) || hasPendingApproval) {
          // 流式输出段结束，但 Agent 仍在执行工具或等待审批/后续输出。
          markSessionAgentWorking(sid);
        } else {
          wbLog("sse:done:non-terminal", { finishReason, hasPendingApproval });
          markSessionAgentWorking(sid);
        }
      } else if (eventType === "subagent_started") {
        removeGeneratingPlaceholder(sid, requestId);
        finalizeCollapsedReasoningPhase(sid, requestId);
        const subId = String(payload.subagent_id ?? "").trim();
        if (!subId) {
          return;
        } else {
          const thread: SubAgentThread = {
            id: subId,
            parentRequestId: requestId,
            sessionId: sid,
            createdAt: Date.now(),
            agentId: subId,
            title: typeof payload.title === "string" ? payload.title : subId,
            status: "running",
            chunks: [],
            startedAt: Date.now(),
          };
          setThreadsBySession((prev) => {
            const current = prev[sid] ?? [];
            return {
              ...prev,
              [sid]: current.some((item) => item.id === thread.id) ? current : [...current, thread],
            };
          });
          if (sid === activeSessionIdRef.current) {
            setActiveThreadBySession((prev) => ({ ...prev, [sid]: subId }));
          }
        }
      } else if (eventType === "subagent_delta") {
        finalizeCollapsedReasoningPhase(sid, requestId);
        const subId = String(payload.subagent_id ?? "").trim();
        const delta = String(payload.content ?? "");
        if (!subId || !delta) {
          return;
        } else {
          setThreadsBySession((prev) => ({
            ...prev,
            [sid]: (prev[sid] ?? []).map((item) =>
              item.id === subId
                ? {
                    ...item,
                    chunks: [
                      ...item.chunks,
                      {
                        id: `chunk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        kind: "delta",
                        content: delta,
                        ts: Date.now(),
                      },
                    ],
                  }
                : item,
            ),
          }));
        }
      } else if (eventType === "subagent_done" || eventType === "subagent_error") {
        finalizeCollapsedReasoningPhase(sid, requestId);
        const subId = String(payload.subagent_id ?? "").trim();
        if (!subId) {
          return;
        } else {
          setThreadsBySession((prev) => ({
            ...prev,
            [sid]: (prev[sid] ?? []).map((item) =>
              item.id === subId
                ? {
                    ...item,
                    status: eventType === "subagent_done" ? "success" : "error",
                    endedAt: Date.now(),
                    errorMessage: eventType === "subagent_error" ? String(payload.message ?? "") : item.errorMessage,
                  }
                : item,
            ),
          }));
        }
      } else if (eventType === "tool_call_delta") {
        removeGeneratingPlaceholder(sid, requestId);
        finalizeCollapsedReasoningPhase(sid, requestId);
        const deltaChunks = payload.tool_calls;
        if (Array.isArray(deltaChunks) && deltaChunks.length > 0) {
          const changed = applyToolCallDeltaChunks(
            getOrCreateToolCallBuffer(sid, requestId),
            deltaChunks,
          );
          if (changed) {
            syncToolCallDraftsForRequest(sid, requestId);
          }
        }
        markSessionAgentWorking(sid);
      } else if (eventType === "tool_call") {
        finalizeCollapsedReasoningPhase(sid, requestId);
        const toolCalls = extractToolCallsFromPayload(payload);
        if (toolCalls.length > 0) {
          finalizeToolCallBufferFromItems(getOrCreateToolCallBuffer(sid, requestId), toolCalls);
          clearToolCallDraftsForRequest(sid, requestId);
          registerRunningToolCallsForSession(sid, requestId, toolCalls);
        }
        const assistantContent = extractAssistantContentFromToolPayload(payload);
        if (assistantContent) {
          removeGeneratingPlaceholder(sid, requestId);
          mergeAssistantContentForRequest(sid, requestId, assistantContent);
        }
        markSessionAgentWorking(sid);
      } else {
        // ignore unsupported event types
      }
    };

    const removeListeners: Array<() => void> = [];
    for (const type of workbenchSseEventTypes) {
      const listener = (event: Event) => {
        const msgEvent = event as MessageEvent;
        const envelope = parseWorkbenchSseEnvelope({
          eventType: type,
          rawData: msgEvent.data,
          lastEventId: msgEvent.lastEventId,
          clientId,
          rememberEventSeq,
          log: wbLog,
        });
        if (envelope) {
          onEvent(type, envelope);
        }
      };
      es.addEventListener(type, listener);
      removeListeners.push(() => {
        es.removeEventListener(type, listener);
      });
    }

    es.onopen = () => {
      setSseConnected(true);
    };

    es.onerror = () => {
      wbLog("sse:global:error");
      setSseConnected(false);
    };

    if (es.readyState === EventSource.OPEN) {
      setSseConnected(true);
    } else if (es.readyState === EventSource.CLOSED) {
      setSseConnected(false);
    }

    return () => {
      for (const dispose of removeListeners) {
        dispose();
      }
      es.onopen = null;
      es.onerror = null;
    };
  }, [
    clientId,
    defaultRuntimeModel,
    sseGeneration,
    rememberEventSeq,
    clearToolCallDraftsForRequest,
    getOrCreateToolCallBuffer,
    markSessionAgentWorking,
    registerRunningToolCallsForSession,
    syncToolCallDraftsForRequest,
  ]);

  /** 创建新会话并切换到该会话。 */
  const handleCreateSession = async () => {
    try {
      const result = await api.createSession({});
      ensureSessionSlot(result.session_id);
      setActiveSessionId(result.session_id);
      wbLog("session:create:success", result);
    } catch (error) {
      wbLog("session:create:error", { error: String(error) });
    }
  };

  /**
   * 发送用户消息。
   * - 前置写入用户消息气泡与运行态
   * - 调用后端 submitMessage
   * - 真实 assistant 回复由 SSE 异步回流更新
   */
  const handleSendMessage = async (content: string) => {
    if (!clientReady || !clientId) {
      wbLog("sendMessage:skip-client-not-ready");
      return;
    }
    const sid = activeSessionId;
    if (!sid) {
      wbLog("sendMessage:skip-no-active-session");
      return;
    } else {
      // active session exists
    }
    wbLog("sendMessage:called", {
      rawContentLength: content.length,
      sessionId: sid,
      effectiveApiBaseUrl: apiBaseUrl,
    });
    const text = content.trim();
    if (!text) {
      wbLog("sendMessage:skip-empty");
      return;
    } else {
      const requestId = `${sid}:turn:${streamTurnBySessionRef.current[sid] ?? 0}`;
      setLatestErrorBySession((prev) => ({ ...prev, [sid]: undefined }));
      appendMessageForSession(sid, createMessage(sid, "user", text));
      setSendingBySession((prev) => ({ ...prev, [sid]: true }));
      setRuntimeBySession((prev) => ({
        ...prev,
        [sid]: { ...(prev[sid] ?? defaultRuntimeModel), status: "running", errorMessage: undefined },
      }));
      try {
        wbLog("sendMessage:request:start", {
          sessionId: sid,
          requestType: "message",
          textLength: text.length,
        });
        await api.submitMessage({
          session_id: sid,
          client_id: clientId,
          request_type: "message",
          content: text,
          source: "frontend",
        });
        wbLog("sendMessage:request:success");
        if (!responseStartedByRequestRef.current.has(requestId)) {
          appendMessageForSession(sid, {
            ...createMessage(sid, "assistant", "", requestId),
            generatingPending: true,
          });
        }
      } catch (error) {
        const message = String(error);
        wbLog("sendMessage:request:error", { error: message });
        setSendingBySession((prev) => ({ ...prev, [sid]: false }));
        setLatestErrorBySession((prev) => ({ ...prev, [sid]: message }));
        setRuntimeBySession((prev) => ({
          ...prev,
          [sid]: { ...(prev[sid] ?? defaultRuntimeModel), status: "error", errorMessage: message },
        }));
      }
    }
  };

  /**
   * 提交工具审批决策（approve/reject）。
   * 会同步更新审批列表、工具执行状态和运行态，并在失败时回滚提交中标记。
   */
  const handleToolDecision = async (
    taskId: string,
    toolCallId: string,
    decision: ToolCallDecision,
  ) => {
    if (!clientReady || !clientId) {
      wbLog("toolDecision:skip-client-not-ready");
      return;
    }
    const sid = activeSessionId;
    if (!sid) {
      return;
    } else {
      // active session exists
    }
    wbLog("toolDecision:called", { taskId, toolCallId, decision, sessionId: sid });
    setSubmittingToolCallIdsBySession((prev) => {
      const current = prev[sid] ?? [];
      return { ...prev, [sid]: current.includes(toolCallId) ? current : [...current, toolCallId] };
    });
    setLatestErrorBySession((prev) => ({ ...prev, [sid]: undefined }));

    const task = (approvalsBySession[sid] ?? []).find((item) => item.id === taskId);
    if (!task) {
      wbLog("toolDecision:task-not-found", { taskId, toolCallId });
      setSubmittingToolCallIdsBySession((prev) => ({
        ...prev,
        [sid]: (prev[sid] ?? []).filter((id) => id !== toolCallId),
      }));
      return;
    } else {
      const approved = decision === "approve" ? [toolCallId] : [];
      const rejected = decision === "reject" ? [toolCallId] : [];
      const selectedToolCall = task.payload.args.tool_calls.find((item) => item.id === toolCallId);

      try {
        wbLog("toolDecision:resume:start", { taskId, toolCallId, approved, rejected });
        await api.submitResume(sid, {
          type: "selection",
          approved,
          rejected,
        }, "frontend", clientId);
        wbLog("toolDecision:resume:success");

        if (selectedToolCall) {
          upsertToolExecutionForSession(sid, {
            id: `${task.requestId}:${toolCallId}`,
            sessionId: sid,
            requestId: task.requestId,
            createdAt: Date.now(),
            toolCallId,
            toolName: selectedToolCall.name,
            arguments: selectedToolCall.arguments,
            status: decision === "approve" ? "running" : "rejected",
            summary: buildToolExecutionSummary(
              selectedToolCall.name,
              decision === "approve" ? "running" : "rejected",
            ),
            detail: decision === "approve" ? undefined : "该工具调用已被用户拒绝。",
            finishedAt: decision === "approve" ? undefined : Date.now(),
          });
        } else {
          // no matched tool_call entry in approval payload
        }

        setApprovalsBySession((prev) => ({
          ...prev,
          [sid]: (prev[sid] ?? [])
            .map((item) => {
              if (item.id !== taskId) {
                return item;
              } else {
                const remainedCalls = item.payload.args.tool_calls.filter((row) => row.id !== toolCallId);
                return {
                  ...item,
                  approvedIds: [...(item.approvedIds ?? []), ...approved],
                  rejectedIds: [...(item.rejectedIds ?? []), ...rejected],
                  handled: remainedCalls.length === 0,
                  decision: "selective" as const,
                  handledAt: Date.now(),
                  payload: {
                    ...item.payload,
                    args: {
                      ...item.payload.args,
                      tool_calls: remainedCalls,
                    },
                  },
                };
              }
            })
            .filter((item) => !item.handled),
        }));

        if (decision === "approve") {
          setRunningToolCallIdsBySession((prev) => {
            const current = prev[sid] ?? [];
            return { ...prev, [sid]: current.includes(toolCallId) ? current : [...current, toolCallId] };
          });
        } else {
          setRunningToolCallIdsBySession((prev) => ({
            ...prev,
            [sid]: (prev[sid] ?? []).filter((id) => id !== toolCallId),
          }));
        }

        setSubmittingToolCallIdsBySession((prev) => ({
          ...prev,
          [sid]: (prev[sid] ?? []).filter((id) => id !== toolCallId),
        }));
        setRuntimeBySession((prev) => ({
          ...prev,
          [sid]: { ...(prev[sid] ?? defaultRuntimeModel), status: "running" },
        }));
      } catch (error) {
        const message = String(error);
        wbLog("toolDecision:resume:error", { taskId, toolCallId, error: message });
        setSubmittingToolCallIdsBySession((prev) => ({
          ...prev,
          [sid]: (prev[sid] ?? []).filter((id) => id !== toolCallId),
        }));
        setLatestErrorBySession((prev) => ({ ...prev, [sid]: message }));
        setRuntimeBySession((prev) => ({
          ...prev,
          [sid]: { ...(prev[sid] ?? defaultRuntimeModel), status: "error", errorMessage: message },
        }));
      }
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <div className="app__brand-mark" />
          <div>
            <div className="app__title">DAgents Workbench</div>
            <div className="app__subtitle">多 Agent 工作台 · MVP</div>
          </div>
        </div>
        <div className="app__header-actions">
          {onOpenSettings ? (
            <button
              type="button"
              className="app__icon-btn"
              onClick={() => onOpenSettings()}
              aria-label="打开设置"
              title="设置"
            >
              <IconSettings />
            </button>
          ) : null}
        </div>
      </header>

      <div className="app__body app__body--two-col">
        <main className="app__col">
          <MainChatPanel
            sessionId={activeSessionId}
            messages={activeMessages}
            approvals={activeApprovals}
            toolExecutions={activeToolExecutions}
            toolCallDrafts={activeToolCallDrafts}
            submittingToolCallIds={activeSubmittingToolCallIds}
            runningToolCallIds={activeRunningToolCallIds}
            completedToolCallIds={activeCompletedToolCallIds}
            sending={activeSending}
            onSendMessage={handleSendMessage}
            onDecideToolCall={handleToolDecision}
            disabled={!activeSessionId}
          />
        </main>

        <aside className="app__col app__col--aside">
          <RuntimeStatusPanel
            runtime={activeRuntime}
            latestError={activeLatestError}
            sseConnected={sseConnected}
            apiBaseUrl={apiBaseUrl}
          />
          <section className="panel thread-panel">
            <header className="panel__header">
              <div className="panel__title">
                team Agent
                <span className="pill">{activeThreads.length}</span>
              </div>
            </header>
            <div className="panel__body">
              <SubAgentThreadTabs
                threads={activeThreads}
                activeThreadId={activeThreadId}
                onSwitchThread={(threadId) =>
                  setActiveThreadBySession((prev) => ({ ...prev, [activeSessionId]: threadId }))
                }
              />
              <SubAgentThreadView thread={activeThread} />
            </div>
          </section>
          <section className="panel session-panel">
            <header className="panel__header session-panel__header">
              <div className="panel__title">
                历史会话
                <span className="pill">{sessionIds.length}</span>
              </div>
              <button
                type="button"
                className="session-panel__icon-btn"
                onClick={() => void handleCreateSession()}
                aria-label="新建会话"
                title="新建会话"
              >
                <IconPlus />
              </button>
            </header>
            <div className="panel__body session-panel__body">
              <div className="session-history-list">
                {sessionHistory.map((sid) => (
                  <div
                    key={sid}
                    className={`session-history-item ${sid === activeSessionId ? "session-history-item--active" : ""}`}
                  >
                    <button
                      type="button"
                      className="session-history-item__main"
                      onClick={() => setActiveSessionId(sid)}
                    >
                      {editingSessionId === sid ? (
                        <input
                          className="session-history-item__title-input"
                          value={editingTitleDraft}
                          onChange={(event) => setEditingTitleDraft(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onBlur={() => handleCommitEditSessionTitle(sid)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              handleCommitEditSessionTitle(sid);
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              setEditingSessionId("");
                              setEditingTitleDraft("");
                            } else {
                              // keep editing
                            }
                          }}
                          autoFocus
                        />
                      ) : (
                        <span className="session-history-item__title">{getSessionTitle(sid)}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="session-history-item__edit"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleStartEditSessionTitle(sid);
                      }}
                      aria-label="编辑会话标题"
                      title="编辑会话标题"
                    >
                      <IconEdit />
                    </button>
                    {sid !== DEFAULT_SESSION_ID ? (
                      <button
                        type="button"
                        className="session-history-item__delete"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteSession(sid);
                        }}
                        aria-label="删除会话"
                        title="删除会话"
                      >
                        <IconTrash />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
