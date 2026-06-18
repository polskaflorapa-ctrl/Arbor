const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runRenderUnifiedCheck,
  assertTextIncludes,
  LIVE_BACKEND_API_URL,
  LIVE_WEB_URL,
} = require("./render-unified-check.cjs");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "render-unified-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("Render unified check validates one live web plus backend configuration", () => {
  withFixture((root) => {
    writeFixtureFile(
      root,
      "render.yaml",
      [
        "services:",
        "  - type: web",
        "    name: arbor-web",
        "    envVars:",
        "      - key: VITE_API_URL",
        "        value: https://arbor-os-b7k6.onrender.com/api",
      ].join("\n"),
    );
    writeFixtureFile(root, "web/render.yaml", `VITE_API_URL\n${LIVE_BACKEND_API_URL}\nVITE_APP_VERSION\n`);
    writeFixtureFile(root, "deploy/web-production.env.example", `VITE_API_URL=${LIVE_BACKEND_API_URL}\nVITE_APP_VERSION=local\n`);
    writeFixtureFile(root, "deploy/mobile-production.env.example", `EXPO_PUBLIC_API_URL=${LIVE_BACKEND_API_URL}\nEXPO_PUBLIC_WEB_APP_URL=${LIVE_WEB_URL}\n`);
    writeFixtureFile(root, "deploy/render-arbor-os.env.example", `CORS_ORIGINS=${LIVE_WEB_URL}\nPUBLIC_BASE_URL=https://arbor-os-b7k6.onrender.com\n`);
    writeFixtureFile(root, "web/.env.production.example", `VITE_API_URL=${LIVE_BACKEND_API_URL}\n`);
    writeFixtureFile(root, "docs/render-deploy.md", `${LIVE_WEB_URL}\n${LIVE_BACKEND_API_URL}\nverify:render-unified\n`);
    writeFixtureFile(root, "docs/POLSKA_FLORA_RENDER_UNIFIED.md", `${LIVE_WEB_URL}\n${LIVE_BACKEND_API_URL}\nredeploy\nstatus:production\n--expected-build\nsmoke:p95\n`);
    writeFixtureFile(root, "web/vite.config.js", "arbor-web-build arbor-web-api VITE_APP_VERSION");
    writeFixtureFile(root, "web/src/pages/DashboardPolskaFlora.js", "Polska Flora Telefon / Ania CRM Ogledziny Wycena Ekipa Przyjmij telefon CRM dzisiaj");
    writeFixtureFile(
      root,
      "package.json",
      JSON.stringify({
        scripts: {
          "verify:render-unified": "node ./scripts/render-unified-check.cjs",
          "smoke:render-unified:live": "node ./scripts/render-unified-live-smoke.cjs",
          "deploy:render:web": "node ./scripts/render-redeploy-web.cjs",
          "deploy:render:web:wait": "node ./scripts/render-redeploy-web.cjs --wait",
          "status:production": "node ./scripts/production-readiness-report.cjs",
        },
      }),
    );

    const result = runRenderUnifiedCheck({ root });

    assert.deepEqual(result, { ok: true, checkedFiles: 10, checkedPackages: 1 });
  });
});

test("Render unified text assertion reports missing live backend URL", () => {
  withFixture((root) => {
    writeFixtureFile(root, "deploy/web-production.env.example", "VITE_API_URL=https://wrong.example/api");
    assert.throws(
      () => assertTextIncludes("deploy/web-production.env.example", [LIVE_BACKEND_API_URL], root),
      /arbor-os-b7k6/,
    );
  });
});
