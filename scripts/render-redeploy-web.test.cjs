const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  runRenderWebRedeploy,
  resolveDeployHookUrl,
  waitForRenderUnifiedLiveSmoke,
} = require("./render-redeploy-web.cjs");

function makeResponse({ ok = true, status = 200, text = "ok" } = {}) {
  return {
    ok,
    status,
    async text() {
      return text;
    },
  };
}

test("resolveDeployHookUrl reads Render web deploy hook env", () => {
  assert.equal(
    resolveDeployHookUrl({ RENDER_WEB_DEPLOY_HOOK_URL: "https://api.render.com/deploy/srv-web" }),
    "https://api.render.com/deploy/srv-web",
  );
});

test("parseArgs supports wait smoke options", () => {
  const options = parseArgs(["--wait", "--timeout-ms", "1000", "--wait-attempts=3", "--wait-interval-ms", "250"]);
  assert.equal(options.dryRun, false);
  assert.equal(options.wait, true);
  assert.equal(options.timeoutMs, 1000);
  assert.equal(options.waitAttempts, 3);
  assert.equal(options.waitIntervalMs, 250);
  assert.match(options.expectedBuild, /^[0-9a-f]{7,}$/);
  assert.equal(options.anyBuild, false);
});

test("parseArgs supports expected build marker", () => {
  assert.equal(parseArgs(["--wait", "--expected-build", "abc123"]).expectedBuild, "abc123");
});

test("parseArgs supports equals-style expected build marker", () => {
  const options = parseArgs([
    "--wait",
    "--timeout-ms=45000",
    "--wait-attempts=30",
    "--wait-interval-ms=10000",
    "--expected-build=abc123",
  ]);

  assert.equal(options.wait, true);
  assert.equal(options.timeoutMs, 45000);
  assert.equal(options.waitAttempts, 30);
  assert.equal(options.waitIntervalMs, 10000);
  assert.equal(options.expectedBuild, "abc123");
});

test("parseArgs can skip exact build matching", () => {
  assert.equal(parseArgs(["--wait", "--any-build"]).expectedBuild, "");
  assert.equal(parseArgs(["--wait", "--any-build"]).anyBuild, true);
});

test("parseArgs exposes help mode", () => {
  const options = parseArgs(["--help"]);

  assert.equal(options.help, true);
});

test("parseArgs rejects unknown flags and missing values", () => {
  assert.throws(() => parseArgs(["--wait-atempt"]), /Unknown argument: --wait-atempt/);
  assert.throws(() => parseArgs(["--expected-build"]), /Missing value for --expected-build/);
});

test("resolveDeployHookUrl rejects missing deploy hook", () => {
  assert.throws(() => resolveDeployHookUrl({}), /RENDER_WEB_DEPLOY_HOOK_URL/);
});

test("runRenderWebRedeploy supports dry run without network", async () => {
  const result = await runRenderWebRedeploy({
    env: { RENDER_WEB_DEPLOY_HOOK_URL: "https://api.render.com/deploy/srv-web" },
    dryRun: true,
    fetchImpl: async () => {
      throw new Error("network should not run");
    },
  });

  assert.deepEqual(result, {
    ok: true,
    dryRun: true,
    hookUrl: "https://api.render.com/deploy/srv-web",
  });
});

test("runRenderWebRedeploy posts the deploy hook", async () => {
  const calls = [];
  const result = await runRenderWebRedeploy({
    env: { RENDER_WEB_DEPLOY_HOOK_URL: "https://api.render.com/deploy/srv-web" },
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method });
      return makeResponse({ status: 202, text: "queued" });
    },
  });

  assert.deepEqual(calls, [{ url: "https://api.render.com/deploy/srv-web", method: "POST" }]);
  assert.deepEqual(result, { ok: true, status: 202, body: "queued" });
});

test("runRenderWebRedeploy can wait for live smoke after hook", async () => {
  let smokeCalls = 0;
  const sleeps = [];
  const result = await runRenderWebRedeploy({
    env: { RENDER_WEB_DEPLOY_HOOK_URL: "https://api.render.com/deploy/srv-web" },
    wait: true,
    waitAttempts: 3,
    waitIntervalMs: 25,
    fetchImpl: async () => makeResponse({ status: 202, text: "queued" }),
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    smokeImpl: async () => {
      smokeCalls += 1;
      if (smokeCalls < 2) throw new Error("old build");
      return { ok: true, web: { build: "new-build" } };
    },
  });

  assert.equal(result.status, 202);
  assert.deepEqual(result.wait, { ok: true, attempts: 2, smoke: { ok: true, web: { build: "new-build" } } });
  assert.deepEqual(sleeps, [25]);
});

test("waitForRenderUnifiedLiveSmoke fails after exhausted attempts", async () => {
  await assert.rejects(
    () =>
      waitForRenderUnifiedLiveSmoke({
        waitAttempts: 2,
        waitIntervalMs: 0,
        sleep: async () => {},
        smokeImpl: async () => {
          throw new Error("still old");
        },
      }),
    /did not become live after 2 attempts: still old/,
  );
});

test("runRenderWebRedeploy reports failed hook response", async () => {
  await assert.rejects(
    () =>
      runRenderWebRedeploy({
        env: { RENDER_WEB_DEPLOY_HOOK_URL: "https://api.render.com/deploy/srv-web" },
        fetchImpl: async () => makeResponse({ ok: false, status: 500, text: "boom" }),
      }),
    /Render deploy hook failed: 500 boom/,
  );
});
