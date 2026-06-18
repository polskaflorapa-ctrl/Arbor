const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deployHookGate,
  parseArgs,
  runCommandGate,
  summarizeReadiness,
} = require("./production-readiness-report.cjs");

test("production readiness args accept live URLs, timeout, JSON, and local skip", () => {
  const options = parseArgs([
    "--web",
    "https://web.example.com/",
    "--api",
    "https://api.example.com/api/",
    "--timeout-ms",
    "1234",
    "--skip-local",
    "--json",
  ]);

  assert.equal(options.webUrl, "https://web.example.com/");
  assert.equal(options.apiBaseUrl, "https://api.example.com/api");
  assert.equal(options.timeoutMs, 1234);
  assert.equal(options.skipLocal, true);
  assert.equal(options.json, true);
});

test("production readiness summary blocks on failed gates", () => {
  assert.deepEqual(
    summarizeReadiness([
      { status: "ok" },
      { status: "warn" },
      { status: "fail" },
    ]),
    { status: "blocked", failed: 1, warnings: 1 },
  );
});

test("production readiness summary allows warnings without hiding them", () => {
  assert.deepEqual(
    summarizeReadiness([
      { status: "ok" },
      { status: "warn" },
    ]),
    { status: "ready-with-warnings", failed: 0, warnings: 1 },
  );
});

test("production readiness deploy hook gate reports missing Render hook as warning", () => {
  assert.equal(deployHookGate({}).status, "warn");
  assert.match(deployHookGate({}).detail, /missing/);
  assert.equal(deployHookGate({ RENDER_WEB_DEPLOY_HOOK_URL: "https://api.render.com/deploy/srv-1" }).status, "ok");
});

test("production readiness command gate captures command failures", () => {
  const gate = runCommandGate(
    { name: "sample", command: "npm", args: ["run", "missing"] },
    {
      spawnImpl: () => ({ status: 1, stdout: "", stderr: "missing script" }),
      cwd: "C:\\repo",
    },
  );

  assert.equal(gate.name, "sample");
  assert.equal(gate.status, "fail");
  assert.equal(gate.command, "npm run missing");
  assert.match(gate.detail, /missing script/);
});
