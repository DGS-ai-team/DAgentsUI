# `DAgentsUI/scripts/` 说明

本目录存放前端工程辅助脚本。

## 当前文件

- `generate-openapi-types.mjs`：从 `openapi.json` 生成 `src/api/types.ts`。
- `electron-dev.cjs`：开发态启动 Vite（固定端口）后拉起 Electron，供 `pnpm dev:electron` 使用。

## 使用方式

在 `DAgentsUI/` 目录执行：

```bash
pnpm gen:types
```

建议先在仓库根目录更新后端契约：

```bash
python export_openapi_schema.py
```
