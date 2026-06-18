const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runRenderUnifiedLiveSmoke,
  assertWebLooksCurrent,
  assertApiReady,
  buildCacheBustedUrl,
  extractWebBuildMetadata,
  DEFAULT_WEB_URL,
  DEFAULT_API_BASE_URL,
} = require("./render-unified-live-smoke.cjs");

function makeResponse({ ok = true, status = 200, text = "", json = {} } = {}) {
  return {
    ok,
    status,
    async text() {
      return text;
    },
    async json() {
      return json;
    },
  };
}

test("assertWebLooksCurrent accepts current Polska Flora build", async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, `${DEFAULT_WEB_URL}/?_smoke=test-key`);
    assert.equal(options.headers["cache-control"], "no-cache");
    assert.equal(options.headers.pragma, "no-cache");
    return makeResponse({
      text: "<title>Polska Flora</title><meta name=\"description\" content=\"Polska Flora - panel operacyjny\"><meta name=\"arbor-web-build\" content=\"build-123\"><meta name=\"arbor-web-api\" content=\"https://api.example/api\">",
    });
  };

  const result = await assertWebLooksCurrent({ fetchImpl, cacheKey: "test-key", expectedBuild: "build-123" });

  assert.deepEqual(result, {
    ok: true,
    status: 200,
    url: `${DEFAULT_WEB_URL}/?_smoke=test-key`,
    build: "build-123",
    api: "https://api.example/api",
  });
});

test("buildCacheBustedUrl preserves existing query params", () => {
  assert.equal(
    buildCacheBustedUrl("https://web.example.com/app?branch=krk", "abc"),
    "https://web.example.com/app?branch=krk&_smoke=abc",
  );
});

test("extractWebBuildMetadata reads deployment marker meta tags", () => {
  assert.deepEqual(
    extractWebBuildMetadata('<meta name="arbor-web-build" content="abc123"><meta name="arbor-web-api" content="/api">'),
    { build: "abc123", api: "/api" },
  );
});

test("assertWebLooksCurrent rejects mismatched build marker", async () => {
  const fetchImpl = async () =>
    makeResponse({
      text: '<title>Polska Flora</title><meta name="arbor-web-build" content="old-build">',
    });

  await assert.rejects(
    () => assertWebLooksCurrent({ fetchImpl, expectedBuild: "new-build" }),
    /Web build marker mismatch: expected new-build, got old-build/,
  );
});

test("assertWebLooksCurrent rejects old ARBOR-OS build", async () => {
  const fetchImpl = async () => makeResponse({ text: "<title>ARBOR-OS</title>" });

  await assert.rejects(
    () => assertWebLooksCurrent({ fetchImpl }),
    /old ARBOR-OS build/,
  );
});

test("assertApiReady accepts ready backend payload", async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, `${DEFAULT_API_BASE_URL}/ready/`);
    return makeResponse({ json: { status: "ready", database: "up" } });
  };

  const result = await assertApiReady({ fetchImpl });

  assert.deepEqual(result, { ok: true, status: 200, apiStatus: "ready", database: "up" });
});

test("assertApiReady rejects non-ready backend payload", async () => {
  const fetchImpl = async () => makeResponse({ json: { status: "starting", database: "down" } });

  await assert.rejects(
    () => assertApiReady({ fetchImpl }),
    /API is not ready/,
  );
});

test("runRenderUnifiedLiveSmoke checks web and API", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url === `${DEFAULT_WEB_URL}/?_smoke=stable`) {
      return makeResponse({ text: '<title>Polska Flora</title><meta name="arbor-web-build" content="stable">' });
    }
    if (url === `${DEFAULT_API_BASE_URL}/ready/`) {
      return makeResponse({ json: { status: "ready", database: "up" } });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await runRenderUnifiedLiveSmoke({ fetchImpl, cacheKey: "stable" });

  assert.deepEqual(seen, [`${DEFAULT_WEB_URL}/?_smoke=stable`, `${DEFAULT_API_BASE_URL}/ready/`]);
  assert.equal(result.ok, true);
  assert.equal(result.web.build, "stable");
});

test("runRenderUnifiedLiveSmoke reports web and API failures together", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith(DEFAULT_WEB_URL)) {
      return makeResponse({ text: "<title>ARBOR-OS</title>" });
    }
    if (url === `${DEFAULT_API_BASE_URL}/ready/`) {
      return makeResponse({ json: { status: "starting", database: "down" } });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  await assert.rejects(
    () => runRenderUnifiedLiveSmoke({ fetchImpl }),
    (error) => {
      assert.match(error.message, /Web still serves the old ARBOR-OS build/);
      assert.match(error.message, /API is not ready/);
      return true;
    },
  );
});
