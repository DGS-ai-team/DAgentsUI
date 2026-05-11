import { useEffect, useMemo, useRef, useState } from "react";

import { DAgentsApiClient } from "../api/client";
import { MainChatPanel } from "../components/MainChatPanel";
import { RuntimeStatusPanel } from "../components/RuntimeStatusPanel";
import { SubAgentThreadTabs } from "../components/SubAgentThreadTabs";
import { SubAgentThreadView } from "../components/SubAgentThreadView";
import { useSettings } from "../settings/SettingsContext";
import { omitSessionKey } from "../utils/omitSessionKey";
import { normalizeToolDisplayType } from "../utils/displayType";
import { resolveWorkbenchApiBase } from "./chatWorkbench/resolveApiBaseUrl";
import type {
  ApprovalTask,
  ChatMessage,
  RuntimeState,
  SubAgentThread,
  ToolExecutionRecord,
  ToolCallDecision,
  ToolCallItem,
} from "../ui-contracts";

const resolvedApiBaseUrl = String(import.meta.env.VITE_API_BASE_URL ?? "").trim();
const defaultApiBaseUrl = "http://127.0.0.1:8000";

const DEFAULT_SESSION_ID = "main";

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

/**
 * 生成一条标准聊天消息对象。
 * - id 使用 role + 时间戳 + 随机串，降低前端去重冲突概率
 * - requestId 用于把同一轮请求中的增量消息、工具结果关联到一起
 */
function createMessage(
  sessionId: string,
  role: ChatMessage["role"],
  content: string,
  requestId?: string,
): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    requestId,
    createdAt: Date.now(),
    role,
    content,
  };
}

/**
 * 生成工具执行摘要文本，用于工具气泡的首行展示。
 * - running/rejected/error 走固定文案
 * - success 时会对返回文本做压缩和截断，避免 UI 被长内容撑开
 */
function buildToolExecutionSummary(
  toolName: string,
  status: "running" | "success" | "rejected" | "error",
  rawText?: string,
): string {
  const name = (toolName || "工具").trim();
  if (status === "running") {
    return `${name} 正在执行`;
  }
  if (status === "rejected") {
    return `${name} 已拒绝`;
  }
  if (status === "error") {
    return `${name} 执行失败`;
  }
  const text = String(rawText ?? "").trim();
  if (!text) {
    return `${name} 已完成`;
  }
  const compact = text.replace(/\s+/g, " ");
  const clipped = compact.length > 56 ? `${compact.slice(0, 56)}...` : compact;
  return `${name}：${clipped}`;
}

/** 从 tool_result 的 data 提取写入 ToolExecutionRecord.arguments 的字段（含 path 等顶层键）。 */
function pickToolArgumentsFromToolResultPayload(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const nested =
    p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments)
      ? (p.arguments as Record<string, unknown>)
      : p.args && typeof p.args === "object" && !Array.isArray(p.args)
        ? (p.args as Record<string, unknown>)
        : null;
  if (nested) {
    Object.assign(out, nested);
  }
  for (const key of ["path", "file_path", "target_path", "filepath", "filename", "file"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim()) {
      const cur = out[key];
      if (typeof cur !== "string" || !cur.trim()) {
        out[key] = v.trim();
      }
    }
  }
  return out;
}

/** 将 tool_call 条目里的 arguments 规范为对象（兼容后端 JSON 字符串）。 */
function normalizeToolCallItemArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore invalid JSON
    }
  }
  return {};
}

/** 从 SSE data 中提取 tool_calls 数组（与 approval_required 类似的嵌套结构）。 */
function extractToolCallsFromPayload(payload: Record<string, unknown>): ToolCallItem[] {
  const root = payload.tool_calls;
  if (Array.isArray(root) && root.length > 0) {
    return root as ToolCallItem[];
  }
  const fromApproval = (payload.approval_args ?? {}) as { tool_calls?: unknown };
  if (Array.isArray(fromApproval.tool_calls) && fromApproval.tool_calls.length > 0) {
    return fromApproval.tool_calls as ToolCallItem[];
  }
  const fromArgs = (payload.args ?? {}) as { tool_calls?: unknown };
  if (Array.isArray(fromArgs.tool_calls) && fromArgs.tool_calls.length > 0) {
    return fromArgs.tool_calls as ToolCallItem[];
  }
  return [];
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
  // 当前生效的后端 API 地址（启动后会用运行时配置覆盖）。
  const [apiBaseUrl, setApiBaseUrl] = useState<string>(resolvedApiBaseUrl || defaultApiBaseUrl);
  // API 地址是否已经完成启动期解析。
  const [apiReady, setApiReady] = useState(false);
  // 当前客户端唯一标识（用于 SSE 过滤与请求归属）。
  const [clientId, setClientId] = useState<string>("");
  // clientId 是否已就绪，未就绪时不发起依赖 clientId 的请求。
  const [clientReady, setClientReady] = useState(false);
  // API 客户端实例；仅在 apiBaseUrl 变化时重建。
  const api = useMemo(
    () =>
      new DAgentsApiClient({
        baseUrl: apiBaseUrl,
      }),
    [apiBaseUrl],
  );
  // 会话 ID 列表（包含默认会话与用户新建会话）。
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  // 当前激活（右侧主面板展示）的会话 ID。
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  // 按会话维度存储消息列表。
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatMessage[]>>({});
  // 按会话维度存储待审批工具任务。
  const [approvalsBySession, setApprovalsBySession] = useState<Record<string, ApprovalTask[]>>({});
  // 按会话维度存储工具执行记录（running/success/error 等）。
  const [toolExecutionsBySession, setToolExecutionsBySession] = useState<Record<string, ToolExecutionRecord[]>>(
    {},
  );
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
  // 全局 SSE 连接状态（用于状态面板显示）。
  const [sseConnected, setSseConnected] = useState(false);
  // 全局 EventSource 实例引用（避免重复创建）。
  const globalStreamRef = useRef<EventSource | null>(null);
  // 已处理事件序号集合（用于 SSE 去重）。
  const seenEventSeqRef = useRef<Set<string>>(new Set());
  // 每个会话当前流式轮次计数（用于拼接增量内容时区分轮次）。
  const streamTurnBySessionRef = useRef<Record<string, number>>({});
  // 标记某个请求是否已经收到过服务端响应块，避免快速响应后补出过期 generating 占位。
  const responseStartedByRequestRef = useRef<Set<string>>(new Set());
  /** SSE tool_call 阶段按 tool_call_id 缓存的调用参数，供 tool_result 合并展示（如 read_file 路径）。 */
  const pendingToolCallArgsBySessionRef = useRef<Record<string, Record<string, Record<string, unknown>>>>({});
  const { settings } = useSettings();
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
  // 会话历史展示顺序：默认会话固定在最前，其余按创建逆序展示。
  const sessionHistory = useMemo(() => {
    const hasDefaultSession = sessionIds.includes(DEFAULT_SESSION_ID);
    const others = sessionIds.filter((sid) => sid !== DEFAULT_SESSION_ID).reverse();
    return hasDefaultSession ? [DEFAULT_SESSION_ID, ...others] : others;
  }, [sessionIds]);

  /**
   * 获取会话展示标题。
   * 优先级：用户自定义标题 > 默认会话名 > 自动序号标题。
   */
  const getSessionTitle = (sid: string): string => {
    const custom = (sessionTitleById[sid] ?? "").trim();
    if (custom) {
      return custom;
    }
    if (sid === DEFAULT_SESSION_ID) {
      return "默认对话";
    }
    const order = sessionIds.findIndex((item) => item === sid);
    const displayOrder = order >= 0 ? order + 1 : 0;
    return displayOrder > 0 ? `对话 ${displayOrder}` : "对话";
  };

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
    if (!activeSessionId) {
      setActiveSessionId(sid);
    }
  };

  // ----- 启动：解析 API 基址、clientId，并在 Electron 下挂接内嵌代理 -----
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await resolveWorkbenchApiBase({
        resolvedViteUrl: resolvedApiBaseUrl,
        log: wbLog,
      });
      if (!cancelled) {
        setApiBaseUrl(result.apiBaseUrl);
        setClientId(result.clientId);
        setClientReady(true);
        setApiReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
      const next = [...current];
      next[index] = item;
      return { ...prev, [sid]: next };
    });
  };

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

  // ----- 启动：默认会话 + 全局 SSE（单例 EventSource）-----
  useEffect(() => {
    if (!apiReady || !clientReady || !clientId) {
      return;
    }
    wbLog("bootstrap:start", {
      configuredApiBaseUrl: resolvedApiBaseUrl,
      effectiveApiBaseUrl: apiBaseUrl,
    });
    let mounted = true;
    void api
      .createSession({ session_id: DEFAULT_SESSION_ID })
      .then((result) => {
        if (mounted) {
          wbLog("bootstrap:createSession:success", result);
          ensureSessionSlot(result.session_id);
        } else {
          return;
        }
      })
      .catch((error) => {
        if (mounted) {
          const message = String(error);
          wbLog("bootstrap:createSession:error", { error: message });
          setLatestErrorBySession((prev) => ({ ...prev, [DEFAULT_SESSION_ID]: message }));
          setRuntimeBySession((prev) => ({
            ...prev,
            [DEFAULT_SESSION_ID]: {
              ...(prev[DEFAULT_SESSION_ID] ?? defaultRuntimeModel),
              status: "error",
              errorMessage: message,
            },
          }));
        } else {
          return;
        }
      });
    if (!globalStreamRef.current) {
      const streamUrl = api.streamAllUrl(clientId);
      wbLog("sse:global:open", { streamUrl, clientId });
      const es = new EventSource(streamUrl);
      globalStreamRef.current = es;
      setSseConnected(true);
    } else {
      wbLog("sse:global:reuse");
      setSseConnected(true);
    }

    return () => {
      mounted = false;
      if (globalStreamRef.current) {
        wbLog("sse:cleanup:close-global");
        globalStreamRef.current.close();
        globalStreamRef.current = null;
        setSseConnected(false);
      }
    };
  }, [api, apiBaseUrl, apiReady, clientId, clientReady]);

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
                detail: JSON.stringify(payload, null, 2),
                finishedAt: Date.now(),
                arguments: mergedArguments,
              };
              return { ...prev, [sid]: next };
            }
          });
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
        streamTurnBySessionRef.current[sid] = (streamTurnBySessionRef.current[sid] ?? 0) + 1;
        // 注意：后端在需要人工审批时会在 approval_required 之后立刻再发 done（表示本轮流式输出结束，
        // 但仍等待 resume），此处不得清空 approvals，否则审批 UI 会被同一 tick 内的批处理冲掉。
        setRuntimeBySession((prev) => ({
          ...prev,
          [sid]: { ...(prev[sid] ?? defaultRuntimeModel), status: "done" },
        }));
        setSendingBySession((prev) => ({ ...prev, [sid]: false }));
        setSubmittingToolCallIdsBySession((prev) => ({ ...prev, [sid]: [] }));
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
          setActiveThreadBySession((prev) => ({ ...prev, [sid]: subId }));
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
      } else if (eventType === "tool_call") {
        finalizeCollapsedReasoningPhase(sid, requestId);
        const toolCalls = extractToolCallsFromPayload(payload);
        if (toolCalls.length > 0) {
          const prevBucket = pendingToolCallArgsBySessionRef.current[sid] ?? {};
          const bucket: Record<string, Record<string, unknown>> = { ...prevBucket };
          for (const tc of toolCalls) {
            const id = String(tc.id ?? "").trim();
            if (!id) {
              continue;
            }
            const args = normalizeToolCallItemArguments(tc.arguments);
            bucket[id] = { ...(bucket[id] ?? {}), ...args };
          }
          pendingToolCallArgsBySessionRef.current[sid] = bucket;
          setToolExecutionsBySession((prev) => {
            const sessionRows = prev[sid] ?? [];
            let changed = false;
            const nextRows = sessionRows.map((row) => {
              const injected = bucket[row.toolCallId];
              if (!injected || Object.keys(injected).length === 0) {
                return row;
              }
              const merged = { ...injected, ...row.arguments };
              if (JSON.stringify(merged) === JSON.stringify(row.arguments)) {
                return row;
              }
              changed = true;
              return { ...row, arguments: merged };
            });
            return changed ? { ...prev, [sid]: nextRows } : prev;
          });
        }
        if (content) {
          removeGeneratingPlaceholder(sid, requestId);
          appendMessageForSession(sid, createMessage(sid, "assistant", content, requestId));
        }
      } else {
        // ignore unsupported event types
      }
    };

    /**
     * 解析原始 SSE 数据并做基础防护：
     * - 按 client_id 过滤非当前客户端事件
     * - 按 seq 去重，避免重连后重复渲染
     * - 解析失败时记录日志而不中断主流程
     */
    const parseAndDispatch = (eventType: string, rawData: string) => {
      try {
        const parsed = JSON.parse(rawData) as {
          data?: unknown;
          seq?: unknown;
          session_id?: unknown;
          client_id?: unknown;
        };
        const seqNumber = Number(parsed.seq);
        const parsedClientId = String(parsed.client_id ?? "").trim();
        if (parsedClientId && parsedClientId !== clientId) {
          return;
        } else {
          // same client
        }
        if (Number.isFinite(seqNumber) && seqNumber >= 0) {
          const eventKey = `${clientId}:${seqNumber}`;
          if (seenEventSeqRef.current.has(eventKey)) {
            wbLog("sse:event:deduplicated", { eventType, seq: seqNumber });
            return;
          } else {
            seenEventSeqRef.current.add(eventKey);
          }
        } else {
          // missing request/seq
        }
        if (parsed && typeof parsed === "object") {
          onEvent(eventType, parsed as Record<string, unknown>);
        } else {
          return;
        }
      } catch (error) {
        wbLog("sse:parse:error", {
          eventType,
          rawData,
          error: String(error),
        });
      }
    };

    const eventTypes = [
      "assistant",
      "reasoning",
      "tool_call",
      "tool_result",
      "approval_required",
      "usage",
      "error",
      "done",
      "subagent_started",
      "subagent_delta",
      "subagent_done",
      "subagent_error",
    ] as const;
    const removeListeners: Array<() => void> = [];
    for (const type of eventTypes) {
      const listener = (event: Event) => {
        const msgEvent = event as MessageEvent;
        parseAndDispatch(type, msgEvent.data);
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
      setRuntimeBySession((prev) => {
        const next: Record<string, RuntimeState> = { ...prev };
        for (const sid of Object.keys(next)) {
          if (next[sid].status === "running") {
            next[sid] = { ...next[sid], status: "error", errorMessage: "SSE 连接异常" };
          } else {
            // keep current status
          }
        }
        return next;
      });
    };

    return () => {
      for (const dispose of removeListeners) {
        dispose();
      }
      es.onopen = null;
      es.onerror = null;
    };
  }, [clientId, defaultRuntimeModel]);

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
