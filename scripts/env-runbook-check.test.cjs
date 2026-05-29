const test = require("node:test");
const assert = require("node:assert/strict");

const { runEnvRunbookCheck } = require("./env-runbook-check.cjs");

test("environment runbook and env templates cover critical integration variables", () => {
  assert.deepEqual(runEnvRunbookCheck(), { ok: true, checked: 12 });
});
