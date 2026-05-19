# DAgentsUI

**当前发布版本**：`v0.1.0`（`package.json` 字段为 `0.1.0`）。打 Git 标签请使用 `v0.1.0`，与 CI 中 `push: tags: v*` 规则一致。

**本仓库为 DAgents Web 前端**：基于 React + TypeScript + Vite 的对话工作台，通过 HTTP / SSE 与 [DAgents](https://github.com/DGS-ai-team/DAgents) 后端联调；可选 Electron 桌面壳与发布流水线。  
**协议**：[MIT License](LICENSE)。**后端运行时**见 [DAgents](https://github.com/DGS-ai-team/DAgents)。

- 会话工作台（主对话、运行状态、子 Agent 线程视图）
- 工具调用审批 / 执行状态展示、与 OpenAPI 对齐的 API 封装
- Web 开发与桌面调试（Electron）；CI 可按 `v*` 标签构建桌面产物

> 项目持续迭代中，接口与 UI 可能变化；HTTP 路径以同步后的 **`openapi.json`** 为准。

## 功能概览

- **对话工作台**：`ChatWorkbench` 聚合主聊天、输入区、运行状态与子线程切换。
- **消息与工具 UI**：主聊天流（assistant / reasoning / tool 等展示）、工具审批气泡、执行结果气泡。
- **实时流**：SSE 消费逻辑随契约演进；类型由 OpenAPI 生成物驱动。
- **API 层**：`src/api/types.ts` 由脚本生成，`src/api/client.ts` 手写封装（创建会话、提交消息、取消 turn 等）。
- **工程能力**：OpenAPI → TS 类型生成脚本；Electron 开发入口与 GitHub Actions 桌面构建。

## 项目结构（根目录）

```text
DAgentsUI/
├── CHANGELOG.md               # 版本变更记录（与 Git 标签 v* 对应）
├── LICENSE
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml          # 含 Electron 等 allowBuilds 配置
├── vite.config.ts
├── tsconfig*.json
├── index.html
├── .env.example                 # 环境变量模板（复制为 .env / .env.local）
├── openapi.json                 # API 契约快照（与后端导出对齐后执行 gen:types）
├── public/                      # 静态资源（favicon 等，不经打包直接拷贝到 dist）
├── doc/                         # 长文档：架构、UI 行为、跨域方案等（见 doc/README.md）
├── scripts/                     # 类型生成、Electron 开发脚本等（见 scripts/README.md）
├── electron/                    # Electron 主进程与 preload
├── src/                         # 前端源码（见 src/README.md）
│   └── api/                     # 类型与 client（见 src/api/README.md）
└── .github/workflows/           # CI/CD（含桌面端构建）
```

## 环境要求（概要）

| 场景 | Node.js | 包管理 | 其它 |
|------|----------|--------|------|
| **日常开发（Web）** | **20+**（与 CI 一致即可） | **pnpm**（仓库锁文件基于 **pnpm 10**） | 现代浏览器 |
| **Electron 本地调试** | 同上 | 同上 | 本机需能拉起 Electron（`pnpm dev:electron`） |
| **桌面产物 CI** | 20 | pnpm 10 | 见 `.github/workflows/desktop-ci-cd.yml`（如 Windows / macOS 矩阵） |

## 安装与运行

### A）安装依赖（推荐）

```bash
pnpm install
cp .env.example .env
# 按需编辑：Web 用 VITE_API_BASE_URL；Electron 还可设 API_BASE_URL、API_PROXY_PORT（见 .env.example 内注释）
```

### B）开发服务器（Web）

```bash
pnpm dev
# 或显式
pnpm dev:web
```

默认开发服务器见 **`vite.config.ts`**（如 **`5173`** 端口、`host: true`）。

### C）Electron 壳联调

```bash
pnpm dev:electron
```

首次安装若 Electron 脚本被 pnpm 拦截，需执行：`pnpm approve-builds --all`（见 `pnpm-workspace.yaml` 中 `allowBuilds`）。

### D）构建与预览

```bash
pnpm typecheck
pnpm check
pnpm build
pnpm preview
```

### 常用命令（速查）

| 用途 | 命令 |
|------|------|
| 安装依赖 | `pnpm install` |
| 开发（Web） | `pnpm dev` / `pnpm dev:web` |
| 开发（Electron） | `pnpm dev:electron` |
| TypeScript 类型检查 | `pnpm typecheck` |
| 本地完整校验（类型检查 + 构建） | `pnpm check` |
| 生产构建 | `pnpm build` |
| 预览构建产物 | `pnpm preview` |
| 从 `openapi.json` 生成 TS 类型 | `pnpm gen:types` |

## 与后端（DAgents）对接

后端仓库：**[github.com/DGS-ai-team/DAgents](https://github.com/DGS-ai-team/DAgents)**。

建议流程：

1. 在后端仓库根目录导出 OpenAPI，覆盖或同步到本仓库根目录 **`openapi.json`**：  
   `python export_openapi_schema.py --output /path/to/DAgentsUI/openapi.json`
2. 在本仓库执行：`pnpm gen:types`
3. 配置 API 根地址：**Web** 用 **`VITE_API_BASE_URL`**；**Electron** 可用项目根 **`.env`** 的 **`API_BASE_URL`**、**`API_PROXY_PORT`** 及设置页「真实 DAgents API」，优先级见 `src/pages/chatWorkbench/resolveApiBaseUrl.ts`（默认常见 **`http://127.0.0.1:8000`**，以后端实际监听为准）。

更细的契约维护说明见下文 **「API 说明」** 与 **`src/api/README.md`**。

## API 说明（简版）

完整契约以 **`openapi.json`** 为准；后端路由总览亦可对照 **`DAgents` 仓库**中的 **`app/harness/api/README.md`**。下表为当前快照中常见路径（**若与导出文件不一致，以重新导出并 `pnpm gen:types` 后的结果为准**）。

| 能力 | 路径（示例） |
|------|----------------|
| 创建会话 | `POST /v1/sessions` |
| 提交消息 | `POST /v1/messages` |
| 全局 SSE（工作台当前使用） | `GET /v1/streams?client_id=...`（见 `src/api/client.ts` 的 `streamAllUrl`） |
| 按请求 SSE（若 openapi 中存在） | `GET /v1/streams/{request_id}` |
| 取消当前 turn | `POST /v1/sessions/{session_id}/cancel` |

主界面实时流以前端实际调用为准：**全局**订阅为 `GET /v1/streams?client_id=...`；`openapi.json` 中若另有 **按 request_id** 的路径，以导出文件与 `pnpm gen:types` 结果为准。

## 开发说明

- **`src/`** 与各子目录维护 **`README.md`**（入口见下文 **「文档入口」**）。
- 更新契约后务必执行 **`pnpm gen:types`**，避免手写 **`src/api/types.ts`**（该文件为生成物）。
- 桌面发布与矩阵构建：见 **`.github/workflows/`** 下 `desktop-*.yml`。

## 配置与安全

- 勿将 **`.env`**、密钥、令牌提交到版本库。
- 开发环境建议使用独立凭据与隔离的后端 / API Key。
- 纯 Web 联调若遇跨域，见 [doc/cross-origin-solutions.md](doc/cross-origin-solutions.md)（后端 CORS 或开发代理；Electron 见内嵌代理方案）。

## 文档入口

- [doc/README.md](doc/README.md)（`doc/` 下各文档的作用说明）
- [doc/architecture-and-business-flows.md](doc/architecture-and-business-flows.md)（技术架构与业务流程）
- [doc/ui-behaviors.md](doc/ui-behaviors.md)（各 UI 区域与交互行为）
- [doc/cross-origin-solutions.md](doc/cross-origin-solutions.md)（跨域与 CORS 技术方案）
- [CHANGELOG.md](CHANGELOG.md)
- [src/README.md](src/README.md)
- [src/api/README.md](src/api/README.md)
- [scripts/README.md](scripts/README.md)

## License

本项目采用 [MIT License](LICENSE) 开源许可。
