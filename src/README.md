# `DAgentsUI/src/` 说明

前端源码目录（React + TypeScript，已可运行）。

## 当前结构

- `main.tsx`：React 挂载入口。
- `App.tsx`：应用根组件（工作台与设置视图切换；`ChatWorkbench` 保持挂载，设置页叠放显示）。
- `styles.css`：全局设计令牌与样式系统。
- `pages/ChatWorkbench.tsx`：工作台页面（主对话 + 运行状态 + 子线程）。
- `pages/chatWorkbench/resolveApiBaseUrl.ts`：启动期解析 API 基址、clientId 与 Electron 内嵌代理。
- `pages/chatWorkbench/useWorkbenchApiBootstrap.ts`：封装工作台 API client、apiBaseUrl 与 clientId 启动状态。
- `pages/chatWorkbench/messageHelpers.ts`：封装聊天消息创建与工具执行摘要文本生成。
- `pages/chatWorkbench/sseEvents.ts`：封装工作台 SSE 事件类型与原始 envelope 解析/过滤/去重。
- `pages/chatWorkbench/toolPayload.ts`：封装工具调用/工具结果 payload 的兼容解析与参数规范化。
- `pages/chatWorkbench/useWorkbenchSseConnection.ts`：封装全局 EventSource 生命周期与连接状态。
- `pages/chatWorkbench/useBoundedEventSeqMemory.ts`：封装 SSE seq 去重的有界缓存。
- `pages/SettingsPage.tsx`：用户设置（含 Electron 持久化字段）。
- `components/MainChatPanel.tsx`：主聊天流与输入区。
- `components/ApprovalToolBubble.tsx`：工具调用审批/执行状态气泡（内联于聊天流，展示风险等级、审批原因与策略来源）。
- `components/RuntimeStatusPanel.tsx`：运行状态、tokens、SSE 连接与当前 API 基址诊断。
- `components/ToolExecutionBubble.tsx`：工具执行结果卡片（展示状态、预览、详情、截断/脱敏/raw_ref 元数据）。
- `components/SubAgentThreadTabs.tsx`：子 Agent 线程切换。
- `components/SubAgentThreadView.tsx`：子线程实时输出展示。
- `components/ui.tsx`：通用 UI 小组件（如状态 pill、数字格式化）。
- `utils/omitSessionKey.ts`：按会话分桶的状态表删键（删除会话时复用）。
- `api/`：API 契约与调用封装（`types.ts` 自动生成，`client.ts` 手写封装）。
- `ui-contracts.ts`：前端 UI 类型契约与事件类型。

## 契约范围（当前）

- 主聊天消息流（`assistant/reasoning/tool`）。
- 工具调用审批（每个工具独立按钮）与执行中/已返回状态。
- 多 Agent 子线程展示。
- SSE 事件统一类型（用于后续接入真实后端流）。

## 可优化点（已记录，暂不实现）

- `ToolExecutionBubble` 在 `display_type = "image"` 时，目前优先直接把结果文本当作图片 URL 使用。
- 可进一步增强为：当结果为 markdown 图片语法（如 `![](https://...)`）时，先提取 URL 再渲染图片，提升兼容性与容错性。
