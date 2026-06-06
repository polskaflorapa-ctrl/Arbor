const fs = require('fs');
const path = require('path');

const ROUTE_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

const ROUTE_REQUIRE_PATTERN = /const\s+(?:\{\s*router:\s*)?([A-Za-z0-9_]+)(?:\s*\})?\s*=\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g;
const APP_USE_PATTERN = /app\.use\(\s*['"`]([^'"`]+)['"`]\s*,([\s\S]*?)\);/g;
const APP_ROUTE_PATTERN = /app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]([\s\S]*?)\);/g;

const PUBLIC_ROUTE_ALLOWLIST = [
  { method: 'GET', path: '/' },
  { method: 'GET', pathPrefix: '/app/' },
  { method: 'GET', path: '/api/health' },
  { method: 'GET', path: '/api/ready' },
  { method: 'GET', path: '/api/docs/openapi.yaml' },
  { method: 'GET', path: '/api/mobile-config' },
  { method: 'GET', path: '/api/config/mobile' },
  { method: 'GET', path: '/api/db-test' },
  { method: 'GET', path: '/api/metrics' },
  { method: 'POST', path: '/api/auth/login' },
  { method: 'POST', path: '/api/auth/forgot-password' },
  { method: 'POST', path: '/api/auth/reset-password' },
  { method: 'POST', path: '/api/demo-requests' },
  { method: '*', pathPrefix: '/api/public/' },
  { method: '*', pathPrefix: '/track/' },
  { method: '*', pathPrefix: '/api/tasks/time-window/' },
  { method: '*', pathPrefix: '/api/webhooks/' },
  { method: '*', pathPrefix: '/api/webhooks/crm/' },
  { method: '*', pathPrefix: '/api/sms/webhooks/' },
  { method: '*', pathPrefix: '/api/telefon/webhooks/' },
];

const SECURITY_GUARD_PATTERN =
  /\bauthMiddleware\b|\bpdfAuthOrAccessToken\b|\btaskUploadAuthOrAccessToken\b|\brequireVoiceAgentSecret\b|\bjwt\.verify\b|\bOPS_CRON_SECRET\b/;

function normalizeSlashes(value) {
  return String(value || '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

function joinPaths(basePath, routePath) {
  const base = normalizeSlashes(basePath || '/');
  const route = normalizeSlashes(routePath || '/');
  if (base === '/') return route;
  if (route === '/') return base;
  return normalizeSlashes(`${base}/${route.replace(/^\//, '')}`);
}

function stripStringsAndComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/(['"`])(?:\\[\s\S]|(?!\1)[\s\S])*?\1/g, '""');
}

function findMatchingParen(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const ch = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function extractRouterCalls(source) {
  const calls = [];
  const callPattern = /router\.(use|get|post|put|patch|delete)\s*\(/g;
  let match;
  while ((match = callPattern.exec(source))) {
    const method = match[1];
    const openIndex = source.indexOf('(', match.index);
    const closeIndex = findMatchingParen(source, openIndex);
    if (closeIndex < 0) continue;
    const text = source.slice(match.index, closeIndex + 1);
    calls.push({
      method,
      text,
      start: match.index,
      line: lineNumberAt(source, match.index),
    });
    callPattern.lastIndex = closeIndex + 1;
  }
  return calls;
}

function routePathFromCall(text) {
  const match = text.match(/router\.(?:use|get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\1/);
  return match ? match[2] : null;
}

function isRouterUseAuth(call) {
  return call.method === 'use' && SECURITY_GUARD_PATTERN.test(stripStringsAndComments(call.text));
}

function isProtectedCall(call, inheritedAuth) {
  if (inheritedAuth) return true;
  return SECURITY_GUARD_PATTERN.test(stripStringsAndComments(call.text));
}

function parseRouteModule(filePath, mountPath = '') {
  const source = fs.readFileSync(filePath, 'utf8');
  const calls = extractRouterCalls(source);
  const routes = [];
  let inheritedAuth = false;

  for (const call of calls) {
    if (isRouterUseAuth(call)) {
      inheritedAuth = true;
      continue;
    }
    if (!ROUTE_METHODS.has(call.method)) continue;

    const routePath = routePathFromCall(call.text);
    if (!routePath) continue;

    routes.push({
      method: call.method.toUpperCase(),
      path: joinPaths(mountPath, routePath),
      sourceFile: filePath,
      line: call.line,
      protected: isProtectedCall(call, inheritedAuth),
      protection: isProtectedCall(call, inheritedAuth)
        ? inheritedAuth ? 'router.use(authMiddleware)' : 'route authMiddleware'
        : null,
    });
  }

  return routes;
}

function parseAppMounts(appPath) {
  const source = fs.readFileSync(appPath, 'utf8');
  const routeRequires = new Map();
  let requireMatch;
  while ((requireMatch = ROUTE_REQUIRE_PATTERN.exec(source))) {
    routeRequires.set(requireMatch[1], requireMatch[2]);
  }

  const mounts = [];
  let useMatch;
  while ((useMatch = APP_USE_PATTERN.exec(source))) {
    const mountPath = useMatch[1];
    const args = useMatch[2];
    const routeVar = [...routeRequires.keys()].find((name) => new RegExp(`\\b${name}\\b`).test(args));
    if (!routeVar) continue;
    mounts.push({
      mountPath,
      routeVar,
      routeModule: routeRequires.get(routeVar),
      appProtected: /\bauthMiddleware\b/.test(stripStringsAndComments(args)),
    });
  }
  return mounts;
}

function parseInlineAppRoutes(appPath) {
  const source = fs.readFileSync(appPath, 'utf8');
  const routes = [];
  let match;
  while ((match = APP_ROUTE_PATTERN.exec(source))) {
    routes.push({
      method: match[1].toUpperCase(),
      path: normalizeSlashes(match[2]),
      sourceFile: appPath,
      line: lineNumberAt(source, match.index),
      protected: /\bauthMiddleware\b/.test(stripStringsAndComments(match[0])),
      protection: /\bauthMiddleware\b/.test(stripStringsAndComments(match[0])) ? 'inline authMiddleware' : null,
    });
  }
  return routes;
}

function isAllowlisted(route) {
  return PUBLIC_ROUTE_ALLOWLIST.some((entry) => {
    const methodMatches = entry.method === '*' || entry.method === route.method;
    if (!methodMatches) return false;
    if (entry.path) return route.path === entry.path;
    return route.path.startsWith(entry.pathPrefix);
  });
}

function classifyRoute(route) {
  if (route.protected) return { ...route, classification: 'protected' };
  if (isAllowlisted(route)) return { ...route, classification: 'public-allowlisted' };
  return { ...route, classification: 'unprotected' };
}

function collectRouteInventory(repoRoot = path.resolve(__dirname, '..')) {
  const appPath = path.join(repoRoot, 'src', 'app.js');
  const routesDir = path.join(repoRoot, 'src', 'routes');
  const mounts = parseAppMounts(appPath);
  const inventory = [];

  for (const mount of mounts) {
    const routeFile = path.join(routesDir, `${mount.routeModule}.js`);
    if (!fs.existsSync(routeFile)) continue;
    const routes = parseRouteModule(routeFile, mount.mountPath).map((route) => ({
      ...route,
      protected: route.protected || mount.appProtected,
      protection: route.protection || (mount.appProtected ? 'app.use authMiddleware' : null),
      routeVar: mount.routeVar,
    }));
    inventory.push(...routes);
  }

  inventory.push(...parseInlineAppRoutes(appPath));

  return inventory
    .map(classifyRoute)
    .sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

function formatInventory(routes) {
  return routes
    .map((route) => [
      route.method.padEnd(6),
      route.path.padEnd(44),
      route.classification.padEnd(20),
      `${path.relative(process.cwd(), route.sourceFile)}:${route.line}`,
    ].join('  '))
    .join('\n');
}

if (require.main === module) {
  const repoRoot = path.resolve(__dirname, '..');
  const routes = collectRouteInventory(repoRoot);
  console.log(formatInventory(routes));
  const unprotected = routes.filter((route) => route.classification === 'unprotected');
  if (unprotected.length) {
    console.error('\nUnprotected routes not on public allowlist:');
    console.error(formatInventory(unprotected));
    process.exitCode = 1;
  }
}

module.exports = {
  PUBLIC_ROUTE_ALLOWLIST,
  collectRouteInventory,
  formatInventory,
};
