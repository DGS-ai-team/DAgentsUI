# `doc/` 目录说明

本目录存放**篇幅较长、跨模块**的说明文档（架构、流程、运维备忘等），与根目录 `README.md`、各子目录下的 `README.md` 分工互补。

## 文档一览

| 文档 | 作用 |
|------|------|
| [architecture-and-business-flows.md](./architecture-and-business-flows.md) | 说明 DAgentsUI 的**技术架构**（分层、Electron/Web、目录职责）与**核心业务流程**（启动、bootstrap、发消息、SSE、多会话、工具审批、子 Agent、构建与 CI 等）。 |
| [ui-behaviors.md](./ui-behaviors.md) | 说明各主要 **UI 区域** 的展示规则与用户**交互行为**（主对话、工具气泡、审批、会话列表、子 Agent、设置、运行状态等）。 |
| [cross-origin-solutions.md](./cross-origin-solutions.md) | 说明**跨域 / CORS / SSE** 问题背景，以及 **Electron 本机反向代理**、**后端 CORS**、**Vite 开发代理**等可选技术方案与选型建议。 |

后续若在本目录新增文档，请在本表中补充一行，简要说明该文档的用途即可。
