const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  runRbacScopeCheck,
  assertNeedleMap,
  assertPackageScripts,
  assertTextIncludes,
} = require("./rbac-scope-check.cjs");

const {
  buildAppPermissions,
  scopedOddzialId,
  isDyrektorOrAdmin,
} = require("../os/src/middleware/auth");

function writeFixtureFile(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rbac-scope-"));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("RBAC scope check validates scripts, runbook, docs, and code guards", () => {
  withFixture((root) => {
    const files = ["docs/RBAC-BRANCH-SCOPE-AUDIT.md", "os/src/middleware/auth.js", "web/src/App.js"];
    for (const file of files) writeFixtureFile(root, file, "placeholder");

    writeFixtureFile(
      root,
      "docs/RBAC-BRANCH-SCOPE-AUDIT.md",
      "Prezes / Dyrektor Administrator Kierownik Brygadzista oddzial_id ekipa_id canViewFinance taskScope scopedOddzialId requireOddzialBody getTaskScope requireTaskAccess branch-scoped audit ProtectedRoute GO NO-GO",
    );
    writeFixtureFile(root, "os/src/middleware/auth.js", "buildAppPermissions taskScope canViewFinance canViewAllBranches isDyrektorOrAdmin scopedOddzialId requireOddzialBody AUTH_BRANCH_ACCESS_DENIED");
    writeFixtureFile(root, "web/src/App.js", "const ADMIN const MGMT const FINANCE ProtectedRoute roles={ADMIN} ProtectedRoute roles={MGMT} ProtectedRoute roles={FINANCE}");
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { "verify:rbac-scope": "node script", check: "npm test" } }));

    const result = runRbacScopeCheck({
      root,
      requiredFiles: files,
      requiredScripts: { "package.json": ["verify:rbac-scope", "check"] },
      codeNeedles: {
        "os/src/middleware/auth.js": ["buildAppPermissions", "scopedOddzialId"],
        "web/src/App.js": ["const ADMIN", "ProtectedRoute roles={ADMIN}"],
      },
      docsNeedles: {},
    });

    assert.deepEqual(result, { ok: true, checkedFiles: 3, checkedPackages: 1 });
  });
});

test("RBAC package assertion reports missing verifier script", () => {
  withFixture((root) => {
    writeFixtureFile(root, "package.json", JSON.stringify({ scripts: { check: "node ok" } }));

    assert.throws(
      () => assertPackageScripts({ "package.json": ["check", "verify:rbac-scope"] }, root),
      /verify:rbac-scope/,
    );
  });
});

test("RBAC text assertion reports missing finance guard", () => {
  withFixture((root) => {
    writeFixtureFile(root, "docs/RBAC-BRANCH-SCOPE-AUDIT.md", "Kierownik oddzial");

    assert.throws(
      () => assertTextIncludes("docs/RBAC-BRANCH-SCOPE-AUDIT.md", ["Kierownik", "canViewFinance"], root),
      /canViewFinance/,
    );
  });
});

test("RBAC code assertion reports missing branch scope helper", () => {
  withFixture((root) => {
    writeFixtureFile(root, "os/src/middleware/auth.js", "buildAppPermissions");

    assert.throws(
      () => assertNeedleMap({ "os/src/middleware/auth.js": ["buildAppPermissions", "scopedOddzialId"] }, root),
      /scopedOddzialId/,
    );
  });
});

test("RBAC permissions keep finance/admin global and operations scoped", () => {
  assert.equal(isDyrektorOrAdmin({ rola: "Administrator" }), true);
  assert.equal(scopedOddzialId({ rola: "Administrator", oddzial_id: 2 }, null), null);
  assert.equal(scopedOddzialId({ rola: "Kierownik", oddzial_id: 7 }, 3), 7);

  assert.equal(buildAppPermissions("Dyrektor").canViewFinance, true);
  assert.equal(buildAppPermissions("Administrator").canManageUsers, true);
  assert.equal(buildAppPermissions("Kierownik").taskScope, "branch");
  assert.equal(buildAppPermissions("Kierownik").canViewFinance, false);
  assert.equal(buildAppPermissions("Brygadzista").taskScope, "assigned_team_only");
  assert.equal(buildAppPermissions("Brygadzista").canViewFinance, false);
});
