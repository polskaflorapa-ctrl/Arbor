const { execSync } = require("node:child_process");

const DEFAULT_WEB_URL = "https://arbo-web.onrender.com";
const DEFAULT_API_BASE_URL = "https://arbor-os-b7k6.onrender.com/api";

function normalizeBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function buildCacheBustedUrl(url, cacheKey = Date.now()) {
  const target = new URL(url);
  target.searchParams.set("_smoke", String(cacheKey));
  return target.toString();
}

function resolveCurrentGitBuild({ execImpl = execSync } = {}) {
  try {
    return execImpl("git rev-parse --short HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function parseArgs(argv = process.argv.slice(2)) {
  const anyBuild = argv.includes("--any-build");
  const options = {
    webUrl: DEFAULT_WEB_URL,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    timeoutMs: 45000,
    expectedBuild: anyBuild ? "" : resolveCurrentGitBuild(),
    anyBuild,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--web" && argv[i + 1]) {
      options.webUrl = argv[i + 1];
      i += 1;
    } else if (arg === "--api" && argv[i + 1]) {
      options.apiBaseUrl = normalizeBaseUrl(argv[i + 1]);
      i += 1;
    } else if (arg === "--timeout-ms" && argv[i + 1]) {
      options.timeoutMs = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--expected-build" && argv[i + 1]) {
      options.expectedBuild = argv[i + 1];
      i += 1;
    } else if (arg === "--any-build") {
      options.expectedBuild = "";
    }
  }

  options.apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl);
  return options;
}

function extractMetaContent(html, name) {
  const pattern = new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i");
  const match = String(html || "").match(pattern);
  return match ? match[1] : "";
}

function extractWebBuildMetadata(html) {
  return {
    build: extractMetaContent(html, "arbor-web-build"),
    api: extractMetaContent(html, "arbor-web-api"),
  };
}

async function fetchWithTimeout(url, { fetchImpl = fetch, timeoutMs = 45000, method = "GET", headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { method, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function assertWebLooksCurrent(options = {}) {
  const webUrl = options.webUrl || DEFAULT_WEB_URL;
  const probeUrl = options.cacheBust === false ? webUrl : buildCacheBustedUrl(webUrl, options.cacheKey);
  const response = await fetchWithTimeout(probeUrl, {
    ...options,
    headers: {
      "cache-control": "no-cache",
      pragma: "no-cache",
      ...(options.headers || {}),
    },
  });
  const html = await response.text();

  if (!response.ok) {
    throw new Error(`Web returned HTTP ${response.status}`);
  }
  if (html.includes("ARBOR-OS")) {
    throw new Error("Web still serves the old ARBOR-OS build; redeploy the static site.");
  }
  if (!html.includes("Polska Flora")) {
    throw new Error("Web HTML does not contain Polska Flora markers from the current build.");
  }
  const metadata = extractWebBuildMetadata(html);
  if (options.expectedBuild && !metadata.build) {
    throw new Error(`Web build marker mismatch: expected ${options.expectedBuild}, got missing.`);
  }
  if (options.expectedBuild && metadata.build !== options.expectedBuild) {
    throw new Error(`Web build marker mismatch: expected ${options.expectedBuild}, got ${metadata.build || "missing"}.`);
  }

  return { ok: true, status: response.status, url: probeUrl, build: metadata.build || null, api: metadata.api || null };
}

async function assertApiReady(options = {}) {
  const apiBaseUrl = normalizeBaseUrl(options.apiBaseUrl || DEFAULT_API_BASE_URL);
  const readyUrl = `${apiBaseUrl}/ready/`;
  const response = await fetchWithTimeout(readyUrl, options);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`API /ready/ returned HTTP ${response.status}`);
  }
  if (payload.status !== "ready" || payload.database !== "up") {
    throw new Error(`API is not ready: status=${payload.status || "missing"} database=${payload.database || "missing"}`);
  }

  return { ok: true, status: response.status, apiStatus: payload.status, database: payload.database };
}

async function runRenderUnifiedLiveSmoke(options = {}) {
  const [webProbe, apiProbe] = await Promise.allSettled([
    assertWebLooksCurrent(options),
    assertApiReady(options),
  ]);

  const failures = [];
  if (webProbe.status === "rejected") failures.push(webProbe.reason.message);
  if (apiProbe.status === "rejected") failures.push(apiProbe.reason.message);
  if (failures.length) throw new Error(failures.join(" | "));

  const web = webProbe.value;
  const api = apiProbe.value;
  return { ok: true, web, api };
}

if (require.main === module) {
  const options = parseArgs();
  runRenderUnifiedLiveSmoke(options)
    .then((result) => {
      console.log("[render-unified-live-smoke] OK");
      console.log(`[render-unified-live-smoke] Web: ${options.webUrl} (${result.web.status}, build=${result.web.build || "unknown"})`);
      console.log(`[render-unified-live-smoke] API: ${options.apiBaseUrl}/ready/ (${result.api.apiStatus}, db=${result.api.database})`);
    })
    .catch((error) => {
      console.error(`[render-unified-live-smoke] FAILED: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  buildCacheBustedUrl,
  resolveCurrentGitBuild,
  extractMetaContent,
  extractWebBuildMetadata,
  fetchWithTimeout,
  assertWebLooksCurrent,
  assertApiReady,
  runRenderUnifiedLiveSmoke,
  DEFAULT_WEB_URL,
  DEFAULT_API_BASE_URL,
};
