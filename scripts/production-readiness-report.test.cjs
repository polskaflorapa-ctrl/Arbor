const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRecommendedActions,
  buildProductionReadinessReport,
  customDomainGate,
  deployHookGate,
  extractLiveSmokeArgs,
  formatBuildDetail,
  mobileReleaseStatusGate,
  parseArgs,
  resolveExpectedWebBuild,
  runCommandGate,
  summarizeReadiness,
} = require("./production-readiness-report.cjs");

test("production readiness args accept live URLs, timeout, JSON, and local skip", () => {
  const options = parseArgs([
    "--web",
    "https://web.example.com/",
    "--custom-web",
    "https://custom.example.com/",
    "--api",
    "https://api.example.com/api/",
    "--timeout-ms",
    "1234",
    "--skip-local",
    "--skip-mobile-release-status",
    "--json",
  ]);

  assert.equal(options.webUrl, "https://web.example.com/");
  assert.equal(options.customWebUrl, "https://custom.example.com/");
  assert.equal(options.apiBaseUrl, "https://api.example.com/api");
  assert.equal(options.timeoutMs, 1234);
  assert.equal(options.skipLocal, true);
  assert.equal(options.skipMobileReleaseStatus, true);
  assert.equal(options.json, true);
  assert.match(options.expectedBuild, /^[0-9a-f]{7,}$/);
  assert.equal(parseArgs(["--any-build"]).expectedBuild, "");
});

test("production readiness args accept equals-style live smoke flags", () => {
  const options = parseArgs([
    "--web=https://web.example.com/app",
    "--custom-web=https://custom.example.com/app",
    "--api=https://api.example.com/api/",
    "--timeout-ms=2345",
    "--expected-build=build-888",
    "--skip-remote",
  ]);

  assert.equal(options.webUrl, "https://web.example.com/app");
  assert.equal(options.customWebUrl, "https://custom.example.com/app");
  assert.equal(options.apiBaseUrl, "https://api.example.com/api");
  assert.equal(options.timeoutMs, 2345);
  assert.equal(options.expectedBuild, "build-888");
  assert.equal(options.skipRemote, true);
});

test("production readiness forwards only live smoke flags to live parser", () => {
  assert.deepEqual(
    extractLiveSmokeArgs([
      "--web=https://web.example.com/app",
      "--custom-web=https://custom.example.com/app",
      "--skip-remote",
      "--api",
      "https://api.example.com/api/",
      "--skip-local",
      "--timeout-ms=2345",
      "--json",
      "--any-build",
    ]),
    [
      "--web=https://web.example.com/app",
      "--api",
      "https://api.example.com/api/",
      "--timeout-ms=2345",
      "--any-build",
    ],
  );
});

test("production readiness args accept remote and slow-local skip aliases", () => {
  const options = parseArgs(["--skip-remote", "--skip-slow-local", "--skip-custom-domain", "--skip-mobile-release-status"]);

  assert.equal(options.skipRemote, true);
  assert.equal(options.skipLocal, true);
  assert.equal(options.skipCustomDomain, true);
  assert.equal(options.skipMobileReleaseStatus, true);
});

test("production readiness args expose help mode", () => {
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-h"]).help, true);
});

test("production readiness resolves latest web-impacting build marker", () => {
  const commands = [];
  const build = resolveExpectedWebBuild({
    execImpl: (command) => {
      commands.push(command);
      if (command.startsWith("git log")) return "web1234\n";
      return "head999\n";
    },
  });

  assert.equal(build, "web1234");
  assert.match(commands[0], /git log -1 --format=%h -- web/);
});

test("production readiness build resolver falls back to HEAD", () => {
  const build = resolveExpectedWebBuild({
    execImpl: (command) => {
      if (command.startsWith("git log")) throw new Error("no git log");
      return "head999\n";
    },
  });

  assert.equal(build, "head999");
});

test("production readiness args reject unknown flags and missing values", () => {
  assert.throws(() => parseArgs(["--wat"]), /Unknown argument: --wat/);
  assert.throws(() => parseArgs(["--skip-remtoe"]), /Unknown argument: --skip-remtoe/);
  assert.throws(() => parseArgs(["--web"]), /Missing value for --web/);
  assert.throws(() => parseArgs(["--custom-web"]), /Missing value for --custom-web/);
  assert.throws(() => parseArgs(["--api", "--skip-local"]), /Missing value for --api/);
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

test("production readiness build detail explains compatible descendant builds", () => {
  assert.equal(formatBuildDetail({ build: "abc1234" }, "abc1234"), "build=abc1234");
  assert.equal(
    formatBuildDetail({ build: "child999" }, "abc1234"),
    "build=child999, compatible with expected abc1234",
  );
});

test("production readiness custom domain gate checks build marker", async () => {
  const gate = await customDomainGate({
    customWebUrl: "https://custom.example.com",
    expectedBuild: "abc1234",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return '<title>Polska Flora</title><meta name="arbor-web-build" content="abc1234">';
      },
    }),
  });

  assert.equal(gate.status, "ok");
  assert.match(gate.detail, /custom.example.com/);
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

test("production readiness mobile release status blocks production monitoring gaps", () => {
  const gate = mobileReleaseStatusGate({
    spawnImpl: () => ({
      status: 0,
      stdout: "Production monitoring gate   blocked for production\n",
      stderr: "",
    }),
    cwd: "C:\\repo",
  });

  assert.equal(gate.name, "mobile-release-status");
  assert.equal(gate.status, "fail");
  assert.match(gate.detail, /EXPO_PUBLIC_SENTRY_DSN/);
});

test("production readiness mobile release status passes when monitoring is ready", () => {
  const gate = mobileReleaseStatusGate({
    spawnImpl: () => ({
      status: 0,
      stdout: "Production monitoring gate   ready to verify on device\n",
      stderr: "",
    }),
    cwd: "C:\\repo",
  });

  assert.equal(gate.status, "ok");
  assert.match(gate.detail, /no production monitoring blocker/);
});

test("production readiness report includes the expected web build marker", async () => {
  const report = await buildProductionReadinessReport({
    skipLocal: true,
    expectedBuild: "abc1234",
    env: { RENDER_WEB_DEPLOY_HOOK_URL: "https://api.render.com/deploy/srv-1" },
    spawnImpl: (_command, args) => {
      const commandText = Array.isArray(args) ? args.join(" ") : "";
      if (commandText.includes("release:status")) {
        return {
          status: 0,
          stdout: "Production monitoring gate   ready to verify on device\n",
          stderr: "",
        };
      }
      return { status: 0, stdout: "ok", stderr: "" };
    },
    fetchImpl: async (url) => {
      if (String(url).includes("/ready/")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { status: "ready", database: "up" };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return '<title>Polska Flora</title><meta name="arbor-web-build" content="abc1234">';
        },
      };
    },
  });

  assert.equal(report.expectedBuild, "abc1234");
  assert.equal(report.customWebUrl, "https://arbo-os.com");
  assert.equal(report.summary.status, "ready");
});

test("production readiness report includes local mobile release status gate", async () => {
  const report = await buildProductionReadinessReport({
    skipLocal: true,
    skipRemote: true,
    spawnImpl: (_command, args) => {
      const commandText = Array.isArray(args) ? args.join(" ") : "";
      if (commandText.includes("release:status")) {
        return {
          status: 0,
          stdout: "Production monitoring gate   blocked for production\n",
          stderr: "",
        };
      }
      return { status: 0, stdout: "ok", stderr: "" };
    },
  });

  const gate = report.gates.find((item) => item.name === "mobile-release-status");
  assert.equal(gate.status, "fail");
  assert.equal(report.summary.status, "blocked");
});

test("production readiness report can skip local contracts and remote gates while keeping mobile status", async () => {
  const report = await buildProductionReadinessReport({
    skipLocal: true,
    skipRemote: true,
    spawnImpl: (_command, args) => {
      const commandText = Array.isArray(args) ? args.join(" ") : "";
      if (commandText.includes("release:status")) {
        return {
          status: 0,
          stdout: "Production monitoring gate   ready to verify on device\n",
          stderr: "",
        };
      }
      throw new Error("local contracts should not run");
    },
    fetchImpl: async () => {
      throw new Error("remote smoke should not run");
    },
  });

  assert.equal(report.summary.status, "ready");
  assert.deepEqual(report.gates.map((gate) => gate.name), ["mobile-release-status"]);
});

test("production readiness report can skip all local, mobile, and remote gates", async () => {
  const report = await buildProductionReadinessReport({
    skipLocal: true,
    skipRemote: true,
    skipMobileReleaseStatus: true,
    env: {},
    fetchImpl: async () => {
      throw new Error("remote smoke should not run");
    },
  });

  assert.equal(report.summary.status, "ready");
  assert.deepEqual(report.gates, []);
});

test("production readiness actions explain missing hook and stale live build", () => {
  const actions = buildRecommendedActions({
    expectedBuild: "abc1234",
    gates: [
      {
        name: "render-web-deploy-hook",
        status: "warn",
        detail: "RENDER_WEB_DEPLOY_HOOK_URL is missing",
      },
      {
        name: "render-live-smoke",
        status: "fail",
        detail: "Web build marker mismatch: expected abc1234, got old1234.",
      },
    ],
  });

  assert.equal(actions.length, 3);
  assert.match(actions[0], /RENDER_WEB_DEPLOY_HOOK_URL/);
  assert.match(actions[1], /deploy:render:web:wait -- --expected-build abc1234/);
  assert.match(actions[2], /status:production/);
});

test("production readiness actions explain stale custom domain", () => {
  const actions = buildRecommendedActions({
    expectedBuild: "abc1234",
    gates: [
      {
        name: "custom-domain-live-smoke",
        status: "fail",
        detail: "Web build marker mismatch: expected abc1234, got old1234.",
      },
    ],
  });

  assert.equal(actions.length, 2);
  assert.match(actions[0], /custom domain cache/);
  assert.match(actions[1], /custom-domain smoke/);
});

test("production readiness actions explain mobile monitoring blocker", () => {
  const actions = buildRecommendedActions({
    gates: [
      {
        name: "mobile-release-status",
        status: "fail",
        detail: "Mobile production monitoring is blocked",
      },
    ],
  });

  assert.equal(actions.length, 2);
  assert.match(actions[0], /EXPO_PUBLIC_SENTRY_DSN/);
  assert.match(actions[1], /release:status -w arbor-mobile/);
});
