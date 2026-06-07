const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildChecks,
  measureCheck,
  normalizeBaseUrl,
  parseArgs,
  percentile,
  runP95Smoke,
} = require("../os/scripts/smoke-p95-check.js");

function response(status, body = "{}") {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return body;
    },
  };
}

test("p95 helper uses nearest-rank percentile", () => {
  assert.equal(percentile([10, 20, 30, 40, 50], 0.95), 50);
  assert.equal(percentile([40, 10, 30, 20], 0.95), 40);
  assert.equal(percentile([], 0.95), null);
});

test("argument parsing supports threshold, samples, token, and normalized base URL", () => {
  const options = parseArgs(
    ["https://api.example.test/", "tok", "--threshold", "750", "--samples=3", "--timeout", "1000", "--json"],
    {},
  );
  assert.equal(options.baseUrl, "https://api.example.test");
  assert.equal(options.token, "tok");
  assert.equal(options.thresholdMs, 750);
  assert.equal(options.samples, 3);
  assert.equal(options.timeoutMs, 1000);
  assert.equal(options.json, true);
  assert.equal(normalizeBaseUrl("https://x.test///"), "https://x.test");
});

test("buildChecks keeps unauthenticated run non-mutating", () => {
  const checks = buildChecks();
  assert.deepEqual(checks.map((check) => check.name), [
    "ready",
    "health",
    "openapi-docs",
    "tasks-auth-boundary",
    "quotations-auth-boundary",
    "settlement-auth-boundary",
  ]);
  assert.ok(checks.every((check) => check.method === "GET"));
});

test("buildChecks adds authenticated list and BI probes", () => {
  const checks = buildChecks({ token: "abc", date: "2026-05-31" });
  assert.ok(checks.some((check) => check.name === "openapi-docs"));
  assert.ok(checks.some((check) => check.name === "tasks-list" && check.headers.Authorization === "Bearer abc"));
  assert.ok(checks.some((check) => check.name === "kierownik-today" && check.path.includes("2026-05-31")));
  assert.ok(checks.some((check) => check.name === "bi-drill"));
});

test("measureCheck fails on unexpected status and p95 over threshold", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(calls === 2 ? 500 : 200);
  };
  const times = [0, 100, 100, 800, 800, 900];
  let timeIndex = 0;
  const result = await measureCheck(
    "https://api.example.test",
    { name: "ready", method: "GET", path: "/api/ready", expected: [200] },
    { samples: 3, thresholdMs: 500, timeoutMs: 1000 },
    { fetch: fetchImpl, now: () => times[timeIndex++] },
  );

  assert.equal(result.pass, false);
  assert.deepEqual(result.statuses, [200, 500, 200]);
  assert.ok(result.errors.includes("unexpected_status=500"));
  assert.ok(result.errors.includes("p95>500ms"));
});

test("runP95Smoke logs in when credentials are provided and returns an authenticated report", async () => {
  const seen = [];
  const fetchImpl = async (url, options = {}) => {
    seen.push([url, options.method || "GET", options.headers?.Authorization || ""]);
    if (url.endsWith("/api/auth/login")) return response(200, JSON.stringify({ token: "login-token" }));
    if (url.endsWith("/api/ops/kierownik-today?date=2026-05-31")) return response(403);
    if (url.endsWith("/api/bi/drill?days=7")) return response(403);
    return response(200);
  };
  let nowValue = 0;
  const report = await runP95Smoke(
    {
      baseUrl: "https://api.example.test",
      token: "",
      samples: 1,
      thresholdMs: 500,
      timeoutMs: 1000,
    },
    {
      fetch: fetchImpl,
      env: { SMOKE_LOGIN: "admin", SMOKE_PASSWORD: "secret" },
      now: () => {
        nowValue += 25;
        return nowValue;
      },
    },
  );

  assert.equal(report.ok, true);
  assert.equal(report.authenticated, true);
  assert.ok(seen.some(([, , auth]) => auth === "Bearer login-token"));
});
