const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
const { execSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..", "..");
const envLocalPath = path.join(repoRoot, "web", ".env.local");

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const idx = trimmed.indexOf("=");
  if (idx < 1) return null;
  return {
    key: trimmed.slice(0, idx).trim(),
    value: trimmed.slice(idx + 1).trim(),
  };
}

function getProxyTarget() {
  if (!fs.existsSync(envLocalPath)) return "http://localhost:3001";
  const content = fs.readFileSync(envLocalPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (parsed?.key === "ARBOR_API_PROXY_TARGET") return parsed.value;
  }
  return "http://localhost:3001";
}

function isPortOpen(port, host = "127.0.0.1", timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

function httpGet(url, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request timeout")));
  });
}

async function checkApiHealth(proxyTarget) {
  const healthUrl = new URL("/api/health", proxyTarget).toString();
  try {
    const response = await httpGet(healthUrl);
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, status: response.status, note: `status ${response.status}`, payload: null };
    }
    const payload = JSON.parse(response.body);
    const ok = payload?.ok === true;
    return {
      ok,
      status: response.status,
      note: ok ? payload?.service || "unknown-service" : "unexpected payload",
      payload,
    };
  } catch (error) {
    return { ok: false, status: 0, note: error.message, payload: null };
  }
}

function getPidsByPortWindows(port) {
  const output = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: "utf8" });
  const pids = new Set();
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const pid = parts.at(-1);
    if (pid && pid !== "0" && /^\d+$/.test(pid)) {
      pids.add(pid);
    }
  }
  return [...pids];
}

function killPortListeners(ports, tag = "stack") {
  if (process.platform !== "win32") {
    console.info(`[${tag}] Automatic port cleanup currently supports Windows only.`);
    return 0;
  }

  let killed = 0;
  for (const port of ports) {
    try {
      const pids = getPidsByPortWindows(port);
      if (pids.length === 0) continue;
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
          killed += 1;
          console.info(`[${tag}] Killed PID ${pid} on port ${port}`);
        } catch {
          console.info(`[${tag}] Could not kill PID ${pid} on port ${port}`);
        }
      }
    } catch {
      // no listeners
    }
  }
  return killed;
}

module.exports = {
  getProxyTarget,
  isPortOpen,
  httpGet,
  checkApiHealth,
  getPidsByPortWindows,
  killPortListeners,
};
