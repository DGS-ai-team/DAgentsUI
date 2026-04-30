const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const workspaceRoot = path.resolve(__dirname, "..");
const devUrl = process.env.DEV_URL || "http://localhost:5173";

function run(command, args, env = {}) {
  return spawn(command, args, {
    cwd: workspaceRoot,
    shell: true,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

function waitForUrl(url, options = {}) {
  const maxRetries = Number(options.maxRetries ?? 120);
  const intervalMs = Number(options.intervalMs ?? 1000);
  const timeoutMs = Number(options.timeoutMs ?? 2000);
  let attempts = 0;

  return new Promise((resolve, reject) => {
    const check = () => {
      attempts += 1;
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });

      req.on("error", retry);
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error("request timeout"));
      });
    };

    const retry = () => {
      if (attempts >= maxRetries) {
        reject(new Error(`Timeout waiting for ${url}`));
        return;
      }
      setTimeout(check, intervalMs);
    };

    check();
  });
}

const viteProcess = run("pnpm", ["dev", "--port", "5173", "--strictPort"]);

viteProcess.on("exit", (code) => {
  if (code && code !== 0) {
    process.exit(code);
  }
});

void waitForUrl(devUrl)
  .then(() => {
    const electronProcess = run("electron", ["./electron/main.cjs"], {
      ELECTRON_RENDERER_URL: devUrl,
    });

    electronProcess.on("exit", (electronCode) => {
      viteProcess.kill();
      process.exit(electronCode ?? 0);
    });
  })
  .catch((error) => {
    console.error(String(error));
    viteProcess.kill();
    process.exit(1);
  });
