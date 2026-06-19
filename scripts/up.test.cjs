const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildApiStartCommand,
  buildWebStartCommand,
  getForceCleanupPorts,
} = require("./up.cjs");

test("buildApiStartCommand preserves legacy API command for default port", () => {
  assert.deepEqual(buildApiStartCommand(3001, "win32"), {
    name: "API",
    command: "npm run dev:api",
  });
});

test("buildApiStartCommand starts OS API on configured proxy port", () => {
  assert.deepEqual(buildApiStartCommand(3006, "win32"), {
    name: "OS",
    command: "set PORT=3006&& npm run dev -w arbor-os",
  });
  assert.deepEqual(buildApiStartCommand(3006, "linux"), {
    name: "OS",
    command: "PORT=3006 npm run dev -w arbor-os",
  });
});

test("buildWebStartCommand uses the checked Vite fallback port", () => {
  assert.deepEqual(buildWebStartCommand(), {
    name: "WEB",
    command: "npm run start -w arbor-web -- --port 3002",
  });
});

test("getForceCleanupPorts includes configured API port without duplicates", () => {
  assert.deepEqual(getForceCleanupPorts(3006), [3000, 3002, 3006]);
  assert.deepEqual(getForceCleanupPorts(3002), [3000, 3002]);
});

test("getForceCleanupPorts does not try to kill remote API ports", () => {
  assert.deepEqual(getForceCleanupPorts(443, false), [3000, 3002]);
});
