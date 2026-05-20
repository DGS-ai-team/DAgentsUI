#!/usr/bin/env node
import net from "node:net";

const DEFAULT_BACKEND = "http://127.0.0.1:8000";
const DEFAULT_FRONTEND_PORT = 5173;
const TIMEOUT_MS = 2500;

function parseArgs(argv) {
  const result = {
    backend: process.env.API_BASE_URL || process.env.VITE_API_BASE_URL || DEFAULT_BACKEND,
    frontendPort: Number(process.env.FRONTEND_PORT || DEFAULT_FRONTEND_PORT),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--backend" && argv[i + 1]) {
      result.backend = argv[i + 1];
      i += 1;
    } else if (arg === "--frontend-port" && argv[i + 1]) {
      result.frontendPort = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return result;
}

function printHelp() {
  console.log(`Usage: node scripts/check-local-env.mjs [--backend URL] [--frontend-port PORT]

Checks common local startup issues:
- whether the configured backend URL is reachable
- whether the backend looks like the DAgents API
- whether the frontend dev port is already occupied`);
}

function normalizeUrl(raw) {
  try {
    const url = new URL(raw);
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error(`后端地址无效：${raw}`);
  }
}

function checkPortOpen(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function checkBackend(baseUrl) {
  const normalized = normalizeUrl(baseUrl);
  const openapiUrl = `${normalized}/openapi.json`;
  try {
    const result = await fetchText(openapiUrl);
    if (!result.ok) {
      return {
        ok: false,
        message: `后端可访问，但 ${openapiUrl} 返回 HTTP ${result.status}。请确认端口上运行的是 DAgents 后端。`,
      };
    }
    let spec;
    try {
      spec = JSON.parse(result.text);
    } catch {
      return {
        ok: false,
        message: `后端可访问，但 ${openapiUrl} 不是 JSON。端口可能被其他服务占用。`,
      };
    }
    const paths = spec && typeof spec === "object" ? spec.paths : null;
    const hasSessions = Boolean(paths?.["/v1/sessions"]);
    const hasMessages = Boolean(paths?.["/v1/messages"]);
    if (!hasSessions || !hasMessages) {
      return {
        ok: false,
        message: `端口有 OpenAPI 服务，但缺少 DAgents 的 /v1/sessions 或 /v1/messages。请检查 API_BASE_URL/VITE_API_BASE_URL。`,
      };
    }
    return { ok: true, message: `DAgents API 正常：${normalized}` };
  } catch (error) {
    return {
      ok: false,
      message: `无法访问后端 ${normalized}。请先启动后端，或设置 API_BASE_URL/VITE_API_BASE_URL。详情：${String(error)}`,
    };
  }
}

async function checkFrontendPort(port) {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { ok: false, message: `前端端口无效：${port}` };
  }
  const open = await checkPortOpen("127.0.0.1", port);
  if (!open) {
    return { ok: true, message: `前端端口 ${port} 空闲，可启动 Vite。` };
  }
  try {
    const result = await fetchText(`http://127.0.0.1:${port}/`);
    const looksLikeVite = result.text.includes("/@vite/client") || result.text.includes("vite");
    const looksLikeDAgentsUI = result.text.includes("DAgents") || result.text.includes("root");
    if (looksLikeVite || looksLikeDAgentsUI) {
      return { ok: true, message: `前端端口 ${port} 已有开发服务运行。` };
    }
  } catch {
    // Fall through to warning below.
  }
  return {
    ok: false,
    message: `前端端口 ${port} 已被占用，且不像 DAgentsUI/Vite。请换端口或停止占用进程。`,
  };
}

function printResult(label, result) {
  const mark = result.ok ? "✓" : "!";
  console.log(`${mark} ${label}: ${result.message}`);
}

const args = parseArgs(process.argv.slice(2));
const backend = await checkBackend(args.backend);
const frontend = await checkFrontendPort(args.frontendPort);

printResult("Backend", backend);
printResult("Frontend", frontend);

if (!backend.ok || !frontend.ok) {
  console.log("\n建议：");
  console.log("- 后端默认地址：http://127.0.0.1:8000");
  console.log("- Web 前端可用 VITE_API_BASE_URL 指定后端地址");
  console.log("- Electron 可用 API_BASE_URL 或设置页里的后端地址");
  process.exit(1);
}
