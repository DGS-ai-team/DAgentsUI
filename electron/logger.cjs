/**
 * 主进程文件日志：写入 log 目录（开发：项目根 log/；Windows 打包：与 exe 同目录 log/；macOS 打包：userData/log/）。
 */
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

let logDir = null;
let currentDate = "";
let logFilePath = null;
let initialized = false;

function resolveLogDir() {
  if (!app.isPackaged) {
    return path.join(__dirname, "..", "log");
  }
  if (process.platform === "win32") {
    return path.join(path.dirname(app.getPath("exe")), "log");
  }
  return path.join(app.getPath("userData"), "log");
}

function ensureLogFile() {
  const today = new Date().toISOString().slice(0, 10);
  if (!logDir) {
    logDir = resolveLogDir();
    fs.mkdirSync(logDir, { recursive: true });
  }
  if (logFilePath && currentDate === today) {
    return;
  }
  currentDate = today;
  logFilePath = path.join(logDir, `main-${today}.log`);
}

function formatLine(level, parts) {
  const ts = new Date().toISOString();
  const body = parts
    .map((p) => {
      if (p instanceof Error) {
        return p.stack ?? String(p);
      }
      if (typeof p === "object") {
        try {
          return JSON.stringify(p);
        } catch {
          return String(p);
        }
      }
      return String(p);
    })
    .join(" ");
  return `[${ts}] [${level}] ${body}\n`;
}

function initLogger() {
  if (initialized) {
    return;
  }
  initialized = true;
  ensureLogFile();
  try {
    fs.appendFileSync(logFilePath, formatLine("INFO", ["logger initialized", { logDir }]), "utf8");
  } catch {
    // ignore bootstrap write failure
  }
}

function write(level, parts) {
  try {
    if (!initialized) {
      initLogger();
    } else {
      ensureLogFile();
    }
    const text = formatLine(level, parts);
    fs.appendFileSync(logFilePath, text, "utf8");
  } catch (err) {
    console.error("[DAgentsUI:logger] append failed:", err);
  }
  const line = formatLine(level, parts).trimEnd();
  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  initLogger,
  getLogDir: () => {
    if (!logDir) {
      logDir = resolveLogDir();
    }
    return logDir;
  },
  getLogFilePath: () => {
    if (!logFilePath) {
      ensureLogFile();
    }
    return logFilePath;
  },
  log: (...args) => write("INFO", args),
  warn: (...args) => write("WARN", args),
  error: (...args) => write("ERROR", args),
};
