const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const LIVE_WEB_URL = "https://arbo-web.onrender.com";
const LIVE_BACKEND_URL = "https://arbor-os-b7k6.onrender.com";
const LIVE_BACKEND_API_URL = `${LIVE_BACKEND_URL}/api`;

const requiredFiles = [
  "render.yaml",
  "web/render.yaml",
  "deploy/web-production.env.example",
  "deploy/mobile-production.env.example",
  "deploy/render-arbor-os.env.example",
  "web/.env.production.example",
  "docs/render-deploy.md",
  "docs/POLSKA_FLORA_RENDER_UNIFIED.md",
  "web/vite.config.js",
  "web/src/pages/DashboardPolskaFlora.js",
];

const requiredScripts = {
  "package.json": [
    "verify:render-unified",
    "smoke:render-unified:live",
    "deploy:render:web",
    "deploy:render:web:wait",
    "status:production",
  ],
};

const unifiedNeedles = {
  "render.yaml": ["VITE_API_URL", LIVE_BACKEND_API_URL],
  "web/render.yaml": ["VITE_API_URL", LIVE_BACKEND_API_URL, "VITE_APP_VERSION"],
  "deploy/web-production.env.example": [`VITE_API_URL=${LIVE_BACKEND_API_URL}`, "VITE_APP_VERSION"],
  "deploy/mobile-production.env.example": [
    `EXPO_PUBLIC_API_URL=${LIVE_BACKEND_API_URL}`,
    `EXPO_PUBLIC_WEB_APP_URL=${LIVE_WEB_URL}`,
  ],
  "deploy/render-arbor-os.env.example": [
    `CORS_ORIGINS=${LIVE_WEB_URL}`,
    `PUBLIC_BASE_URL=${LIVE_BACKEND_URL}`,
  ],
  "web/.env.production.example": [LIVE_BACKEND_API_URL],
  "docs/render-deploy.md": [LIVE_WEB_URL, LIVE_BACKEND_API_URL, "verify:render-unified"],
  "docs/POLSKA_FLORA_RENDER_UNIFIED.md": [
    LIVE_WEB_URL,
    LIVE_BACKEND_API_URL,
    "redeploy",
    "status:production",
    "--expected-build",
    "smoke:p95",
  ],
  "web/src/pages/DashboardPolskaFlora.js": [
    "Polska Flora",
    "Telefon / Ania",
    "CRM",
    "Ogl",
    "Wycena",
    "Ekipa",
    "Przyjmij telefon",
    "CRM dzisiaj",
  ],
  "web/vite.config.js": [
    "arbor-web-build",
    "arbor-web-api",
    "VITE_APP_VERSION",
  ],
};

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) throw new Error(`Missing Render unified files: ${missing.join(", ")}`);
}

function assertPackageScripts(scriptMap = requiredScripts, baseDir = root) {
  for (const [file, scripts] of Object.entries(scriptMap)) {
    const pkg = readJson(file, baseDir);
    for (const scriptName of scripts) {
      if (!pkg.scripts || !pkg.scripts[scriptName]) {
        throw new Error(`${file} is missing script ${scriptName}`);
      }
    }
  }
}

function assertTextIncludes(relPath, needles, baseDir = root) {
  const text = fs.readFileSync(path.join(baseDir, relPath), "utf8");
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) throw new Error(`${relPath} is missing: ${missing.join(", ")}`);
}

function assertUnifiedNeedles(needlesByFile = unifiedNeedles, baseDir = root) {
  for (const [file, needles] of Object.entries(needlesByFile)) {
    assertTextIncludes(file, needles, baseDir);
  }
}

function runRenderUnifiedCheck(options = {}) {
  const baseDir = options.root || root;
  const files = options.requiredFiles || requiredFiles;
  assertFilesExist(files, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertUnifiedNeedles(options.unifiedNeedles || unifiedNeedles, baseDir);
  return {
    ok: true,
    checkedFiles: files.length,
    checkedPackages: Object.keys(options.requiredScripts || requiredScripts).length,
  };
}

if (require.main === module) {
  try {
    const result = runRenderUnifiedCheck();
    console.log(`[render-unified-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
    console.log(`[render-unified-check] Web: ${LIVE_WEB_URL}`);
    console.log(`[render-unified-check] API: ${LIVE_BACKEND_API_URL}`);
  } catch (error) {
    console.error(`[render-unified-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runRenderUnifiedCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
  assertUnifiedNeedles,
  LIVE_WEB_URL,
  LIVE_BACKEND_URL,
  LIVE_BACKEND_API_URL,
};
