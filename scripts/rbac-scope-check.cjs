const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "docs/RBAC-BRANCH-SCOPE-AUDIT.md",
  "docs/PILOT-HARDENING-KIEROWNIK-BRYGADZISTA.md",
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md",
  "docs/PRODUCTION-DEPLOY-DRY-RUN.md",
  "os/src/middleware/auth.js",
  "os/src/routes/auth.js",
  "os/src/routes/tasks.js",
  "os/src/routes/bi.js",
  "os/src/routes/audit.js",
  "os/src/routes/uzytkownicy.js",
  "os/src/routes/dispatch.js",
  "web/src/App.js",
  "web/src/components/ProtectedRoute.js",
  "web/src/utils/permissions.js",
  "web/src/utils/routeAccess.js",
];

const requiredScripts = {
  "package.json": ["verify:rbac-scope", "verify:pilot-hardening", "check"],
};

const runbookNeedles = [
  "Prezes / Dyrektor",
  "Administrator",
  "Kierownik",
  "Brygadzista",
  "oddzial_id",
  "ekipa_id",
  "canViewFinance",
  "taskScope",
  "scopedOddzialId",
  "requireOddzialBody",
  "getTaskScope",
  "requireTaskAccess",
  "branch-scoped audit",
  "ProtectedRoute",
  "GO",
  "NO-GO",
];

const codeNeedles = {
  "os/src/middleware/auth.js": [
    "buildAppPermissions",
    "taskScope",
    "canViewFinance",
    "canViewAllBranches",
    "isDyrektorOrAdmin",
    "scopedOddzialId",
    "requireOddzialBody",
    "AUTH_BRANCH_ACCESS_DENIED",
  ],
  "os/src/routes/auth.js": ["oddzial_id", "ekipa_id", "permissions: buildAppPermissions"],
  "os/src/routes/tasks.js": ["getTaskScope", "requireTaskAccess", "canSeeAllTasks", "isTeamScoped", "oddzial_id", "ekipa_id"],
  "os/src/routes/bi.js": ["canViewBI", "canViewTaskFinance", "TASK_FINANCIAL_FIELDS", "delete result", "scopedOddzialId"],
  "os/src/routes/audit.js": ["requireRole('Prezes', 'Dyrektor', 'Administrator', 'Kierownik')", "listAuditLogs"],
  "os/src/routes/uzytkownicy.js": ["canCreateUserWithRole", "canManageTargetUser", "HIGH_PRIVILEGE_ROLES", "oddzial_id"],
  "os/src/routes/dispatch.js": ["scopedOddzialId", "canDispatch", "oddzial_id"],
  "web/src/App.js": ["import { ROLE_GROUPS }", "MANAGEMENT: MGMT", "ProtectedRoute roles={ADMIN}", "ProtectedRoute roles={MGMT}", "ProtectedRoute roles={FINANCE}"],
  "web/src/components/ProtectedRoute.js": ["roles", "require: permKey", "readPermissions", "hasAnyRole"],
  "web/src/utils/permissions.js": ["canViewFinance", "buildFallbackPermissions", "taskScope", "assigned_team_only", "canManageUsers"],
  "web/src/utils/routeAccess.js": ["const ADMIN", "const MANAGEMENT", "const FINANCE", "ROLE_GROUPS", "ROUTE_ROLE_POLICY", "canRoleAccessRoute"],
};

const docsNeedles = {
  "docs/PILOT-HARDENING-KIEROWNIK-BRYGADZISTA.md": ["Kierownik", "Brygadzista", "canViewFinance", "audit_log", "oddzial"],
  "docs/PILOT-ONE-BRANCH-CHECKLIST.md": ["verify:rbac-scope", "Kierownik widzi tylko swoj oddzial"],
  "docs/PRODUCTION-DEPLOY-DRY-RUN.md": ["verify:rbac-scope", "verify:scale-readiness", "deploy:prod:dry-run"],
};

function readJson(relPath, baseDir = root) {
  return JSON.parse(fs.readFileSync(path.join(baseDir, relPath), "utf8"));
}

function assertFilesExist(files = requiredFiles, baseDir = root) {
  const missing = files.filter((file) => !fs.existsSync(path.join(baseDir, file)));
  if (missing.length) {
    throw new Error(`Missing RBAC scope files: ${missing.join(", ")}`);
  }
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
  if (missing.length) {
    throw new Error(`${relPath} is missing: ${missing.join(", ")}`);
  }
}

function assertNeedleMap(needlesByFile, baseDir = root) {
  for (const [file, needles] of Object.entries(needlesByFile)) {
    assertTextIncludes(file, needles, baseDir);
  }
}

function runRbacScopeCheck(options = {}) {
  const baseDir = options.root || root;
  assertFilesExist(options.requiredFiles || requiredFiles, baseDir);
  assertPackageScripts(options.requiredScripts || requiredScripts, baseDir);
  assertTextIncludes("docs/RBAC-BRANCH-SCOPE-AUDIT.md", options.runbookNeedles || runbookNeedles, baseDir);
  assertNeedleMap(options.codeNeedles || codeNeedles, baseDir);
  assertNeedleMap(options.docsNeedles || docsNeedles, baseDir);

  return {
    ok: true,
    checkedFiles: (options.requiredFiles || requiredFiles).length,
    checkedPackages: Object.keys(options.requiredScripts || requiredScripts).length,
  };
}

if (require.main === module) {
  try {
    const result = runRbacScopeCheck();
    console.log(`[rbac-scope-check] OK (${result.checkedFiles} files, ${result.checkedPackages} package files)`);
  } catch (error) {
    console.error(`[rbac-scope-check] FAILED: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  runRbacScopeCheck,
  assertFilesExist,
  assertPackageScripts,
  assertTextIncludes,
  assertNeedleMap,
};
