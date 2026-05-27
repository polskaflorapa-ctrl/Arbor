const test = require("node:test");
const assert = require("node:assert/strict");

const ciCheck = require("./ci-check.cjs");

test("buildStepInvocation wraps commands with cmd on Windows", () => {
  const invocation = ciCheck.buildStepInvocation("npm", ["run", "health"], "win32");

  assert.match(invocation.command, /cmd\.exe$/i);
  assert.deepEqual(invocation.args, ["/d", "/s", "/c", "npm", "run", "health"]);
});

test("runStep surfaces spawn errors", () => {
  assert.throws(
    () =>
      ciCheck.runStep("npm", ["run", "health"], {
        platform: "linux",
        spawnSync() {
          return { status: null, error: new Error("missing executable") };
        },
      }),
    /missing executable/
  );
});

test("smokeLogin posts credentials and accepts token responses", async () => {
  let capturedUrl = null;
  let capturedPayload = null;
  let capturedTimeout = null;

  await ciCheck.smokeLogin("https://api.example.test", {
    async httpPostJson(url, payload, timeoutMs) {
      capturedUrl = url;
      capturedPayload = payload;
      capturedTimeout = timeoutMs;
      return {
        status: 200,
        body: JSON.stringify({ token: "demo-token" }),
      };
    },
  });
  assert.equal(capturedUrl, "https://api.example.test/api/auth/login");
  assert.deepEqual(capturedPayload, { login: "oleg", haslo: "oleg" });
  assert.equal(capturedTimeout, 3000);
});

test("smokeLogin surfaces missing token payloads", async () => {
  await assert.rejects(
    () =>
      ciCheck.smokeLogin("http://127.0.0.1:3001", {
        async httpPostJson() {
          return {
            status: 200,
            body: JSON.stringify({ ok: true }),
          };
        },
      }),
    /Smoke login missing token/
  );
});

test("main runs status, health, and smoke login in order", async () => {
  const calls = [];

  await ciCheck.main({
    runStep(command, args) {
      calls.push(["runStep", command, args.join(" ")]);
    },
    getProxyTarget() {
      calls.push(["getProxyTarget"]);
      return "http://127.0.0.1:3001";
    },
    async checkApiHealth(proxyTarget) {
      calls.push(["checkApiHealth", proxyTarget]);
      return { ok: true, status: 200, note: "ready", body: "" };
    },
    async smokeLogin(proxyTarget) {
      calls.push(["smokeLogin", proxyTarget]);
    },
  });

  assert.deepEqual(calls, [
    ["runStep", "npm", "run status:json:strict"],
    ["runStep", "npm", "run health"],
    ["getProxyTarget"],
    ["checkApiHealth", "http://127.0.0.1:3001"],
    ["smokeLogin", "http://127.0.0.1:3001"],
  ]);
});

test("main stops before smoke login when health fails", async () => {
  const calls = [];

  await assert.rejects(
    () =>
      ciCheck.main({
        runStep(command, args) {
          calls.push(["runStep", command, args.join(" ")]);
        },
        getProxyTarget() {
          calls.push(["getProxyTarget"]);
          return "http://127.0.0.1:3001";
        },
        async checkApiHealth(proxyTarget) {
          calls.push(["checkApiHealth", proxyTarget]);
          return { ok: false, status: 503, note: "status 503", body: '{"reason":"warming up"}' };
        },
        async smokeLogin(proxyTarget) {
          calls.push(["smokeLogin", proxyTarget]);
        },
      }),
    /Health smoke failed with status 503/
  );

  assert.deepEqual(calls, [
    ["runStep", "npm", "run status:json:strict"],
    ["runStep", "npm", "run health"],
    ["getProxyTarget"],
    ["checkApiHealth", "http://127.0.0.1:3001"],
  ]);
});
