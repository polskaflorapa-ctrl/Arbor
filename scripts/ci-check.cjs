const { spawnSync } = require("node:child_process");
const { getProxyTarget, httpGet } = require("./lib/stack-utils.cjs");

function runStep(command, args) {
  const res = spawnSync(command, args, { stdio: "inherit", shell: true });
  if (res.status !== 0) {
    throw new Error(`Step failed: ${command} ${args.join(" ")}`);
  }
}

async function smokeLogin(proxyTarget) {
  const loginUrl = new URL("/api/auth/login", proxyTarget).toString();
  const payload = JSON.stringify({ login: "oleg", haslo: "oleg" });

  const response = await new Promise((resolve, reject) => {
    const http = require("node:http");
    const req = http.request(
      loginUrl,
      {
        method: "POST",
        timeout: 3000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, body });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request timeout")));
    req.write(payload);
    req.end();
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Smoke login failed with status ${response.status}: ${response.body}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new Error(`Smoke login returned non-JSON: ${response.body}`);
  }

  if (!parsed?.token) {
    throw new Error(`Smoke login missing token: ${response.body}`);
  }
}

async function main() {
  console.info("[ci:check] Step 1/3: status strict");
  runStep("npm", ["run", "status:json:strict"]);

  console.info("[ci:check] Step 2/3: health");
  runStep("npm", ["run", "health"]);

  console.info("[ci:check] Step 3/3: api smoke");
  const proxyTarget = getProxyTarget();
  const healthUrl = new URL("/api/health", proxyTarget).toString();
  const health = await httpGet(healthUrl);
  if (health.status < 200 || health.status >= 300) {
    throw new Error(`Health smoke failed with status ${health.status}`);
  }
  await smokeLogin(proxyTarget);

  console.info("[ci:check] OK");
}

main().catch((error) => {
  console.error("[ci:check] FAILED:", error.message);
  process.exit(1);
});
