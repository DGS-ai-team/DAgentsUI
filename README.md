# `DAgentsUI/` 说明

本目录用于承载 DAgents 的 React 前端工程。

> 该工程支持独立仓库运行。若从后端仓库迁出，请保留本 README 与 `src/README.md`、`src/api/README.md` 作为前端主文档入口。

## 目录职责

- `src/`：前端源码目录（页面、组件、状态管理、API 调用层）。
- `public/`：静态资源目录（图标、静态文件）。
- `scripts/`：前端工程辅助脚本（如 OpenAPI 类型生成）。

## 计划技术栈

- React + TypeScript
- Vite
- 与后端通过 HTTP + SSE 通信（复用 `/v1/messages`、`/v1/streams/{request_id}`）

## 当前状态

- 已完成 Vite + React + TypeScript 工程初始化；
- 已可运行 `ChatWorkbench` 页面骨架；
- 依赖安装后可通过 `pnpm dev` 启动开发服务器。

## 本地运行

- 安装依赖：`pnpm install`
- 启动开发：`pnpm dev`
- 产物构建：`pnpm build`

## 与后端联调（分仓模式）

- 前端通过环境变量 `VITE_API_BASE_URL` 指向后端 API（例如 `http://127.0.0.1:8000`）。
- 推荐先在后端仓库导出 OpenAPI，再同步到前端仓库：
  - `python export_openapi_schema.py --output /path/to/DAgentsUI/openapi.json`
- 在前端仓库根目录生成类型：
  - `pnpm gen:types`
- 关键接口：
  - `POST /v1/messages`
  - `GET /v1/streams?client_id=...`（SSE）

## 契约来源（建议）

- 后端 API 契约以 FastAPI OpenAPI 为单一来源。
- 在仓库根目录执行：
  - `python export_openapi_schema.py`
- 导出文件默认写入（同仓模式）：
  - `DAgentsUI/openapi.json`
- 分仓模式推荐写入前端仓库根：
  - `openapi.json`
- 在前端仓库目录生成 TS 类型：
  - `pnpm gen:types`
- 生成产物：
  - `src/api/types.ts`

## 初始化 Git 并上传到 GitHub

在项目根目录执行以下命令：

```bash
git init
git branch -M main
git add .
git commit -m "chore: initialize DAgentsUI project"
git remote add origin <你的仓库地址>
git push -u origin main
```

示例仓库地址：

- HTTPS：`https://github.com/<your-name>/<repo>.git`
- SSH：`git@github.com:<your-name>/<repo>.git`
