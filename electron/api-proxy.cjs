/**
 * 本机 HTTP 反向代理：将渲染进程的同源请求转发到用户配置的真实 DAgents API。
 * 用于规避浏览器对跨源 API / SSE 的 CORS 限制（仅 Electron 主进程加载）。
 */
const http = require("http");
const httpProxy = require("http-proxy");

const DEFAULT_PORT = 37421;

function stripTrailingSlash(u) {
  const s = String(u ?? "").trim();
  if (!s) {
    return "";
  } else {
    return s.replace(/\/+$/, "");
  }
}

/**
 * @param {{ getTargetUrl: () => string; port?: number }} opts
 * @returns {Promise<{ server: import("http").Server; port: number }>}
 */
function createApiProxy(opts) {
  const port = typeof opts.port === "number" ? opts.port : DEFAULT_PORT;
  const getTargetUrl = opts.getTargetUrl;

  const proxy = httpProxy.createProxyServer({
    changeOrigin: true,
    ws: true,
  });

  proxy.on("error", (err, req, res) => {
    try {
      require("./logger.cjs").error("proxy error", err?.message ?? err);
    } catch {
      console.error("[api-proxy]", err);
    }
    if (res && typeof res.writeHead === "function" && !res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    }
    if (res && typeof res.end === "function" && !res.writableEnded) {
      res.end(`Bad Gateway: ${String(err?.message ?? err)}`);
    }
  });

  const server = http.createServer((req, res) => {
    const target = stripTrailingSlash(getTargetUrl()) || "http://127.0.0.1:8000";
    proxy.web(req, res, { target });
  });

  server.on("upgrade", (req, socket, head) => {
    const target = stripTrailingSlash(getTargetUrl()) || "http://127.0.0.1:8000";
    proxy.ws(req, socket, head, { target });
  });

  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({ server, port });
    });
    server.once("error", reject);
  });
}

module.exports = { createApiProxy, DEFAULT_PORT, stripTrailingSlash };
