const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/ENVIRONMENT-RUNBOOK.md",
  "os/.env.example",
  "web/.env.example",
  "web/.env.production.example",
  "mobile/.env.example",
  "deploy/render-arbor-os.env.example",
  "deploy/railway-arbor-os.env.example",
  "deploy/koyeb-arbor-os.env.example",
  "deploy/vercel.env.example",
  "deploy/netlify-web.env.example",
  "deploy/web-production.env.example",
  "deploy/mobile-production.env.example",
];

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function assertIncludes(file, needles) {
  const text = read(file);
  for (const needle of needles) {
    if (!text.includes(needle)) {
      throw new Error(`${file} is missing ${needle}`);
    }
  }
}

function runEnvRunbookCheck() {
  for (const file of requiredFiles) {
    if (!fs.existsSync(path.join(root, file))) {
      throw new Error(`${file} is missing`);
    }
  }

  assertIncludes("docs/ENVIRONMENT-RUNBOOK.md", [
    "PUBLIC_BASE_URL",
    "ZADARMA_API_KEY",
    "KOMMO_WEBHOOK_URL",
    "VITE_API_URL",
    "EXPO_PUBLIC_API_URL",
    "/api/sms/webhooks/zadarma",
    "/api/tasks/time-window/:token",
  ]);

  assertIncludes("os/.env.example", [
    "PUBLIC_BASE_URL",
    "ZADARMA_API_KEY",
    "ZADARMA_API_SECRET",
    "KOMMO_WEBHOOK_URL",
    "DATABASE_URL",
  ]);

  assertIncludes("web/.env.example", ["VITE_API_URL", "VITE_KOMMO_APP_URL"]);
  assertIncludes("web/.env.production.example", ["VITE_API_URL", "VITE_KOMMO_APP_URL"]);
  assertIncludes("mobile/.env.example", [
    "EXPO_PUBLIC_API_URL",
    "EXPO_PUBLIC_WEB_APP_URL",
    "EXPO_PUBLIC_EXPECTED_API_VERSION",
  ]);

  for (const file of [
    "deploy/render-arbor-os.env.example",
    "deploy/railway-arbor-os.env.example",
    "deploy/koyeb-arbor-os.env.example",
    "deploy/vercel.env.example",
    "deploy/netlify-web.env.example",
  ]) {
    assertIncludes(file, ["PUBLIC_BASE_URL", "ZADARMA_API_KEY", "ZADARMA_API_SECRET"]);
  }

  assertIncludes("deploy/web-production.env.example", ["VITE_API_URL"]);
  assertIncludes("deploy/mobile-production.env.example", ["EXPO_PUBLIC_API_URL", "EXPO_PUBLIC_WEB_APP_URL"]);

  return { ok: true, checked: requiredFiles.length };
}

if (require.main === module) {
  try {
    const result = runEnvRunbookCheck();
    console.log(`[env-runbook] OK (${result.checked} files)`);
  } catch (error) {
    console.error(`[env-runbook] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { runEnvRunbookCheck };
