const test = require("node:test");
const assert = require("node:assert/strict");

const { computeSuggestions } = require("./status.cjs");

test("computeSuggestions accepts a healthy remote proxy target without local API advice", () => {
  assert.deepEqual(
    computeSuggestions({
      apiOpen: true,
      apiPort: 443,
      healthOk: true,
      webRunning: true,
      localProxy: false,
    }),
    ["npm run dev:os (optional)"],
  );
});

test("computeSuggestions reports remote proxy health failures without local port noise", () => {
  assert.deepEqual(
    computeSuggestions({
      apiOpen: true,
      apiPort: 443,
      healthOk: false,
      webRunning: true,
      localProxy: false,
    }),
    ["check remote ARBOR_API_PROXY_TARGET or switch web/.env.local back to a local API"],
  );
});
