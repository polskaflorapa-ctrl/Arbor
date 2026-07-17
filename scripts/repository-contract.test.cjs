const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRepositoryAssertions } = require("./lib/repository-contract.cjs");

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "repository-contract-"));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function writeFixture(root, relPath, contents) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, contents);
}

test("repository assertions validate files, package scripts, and text maps", () => {
  withFixture((root) => {
    writeFixture(root, "package.json", JSON.stringify({ scripts: { check: "node check" } }));
    writeFixture(root, "docs/runbook.md", "GO NO-GO");

    const assertions = createRepositoryAssertions({
      root,
      requiredFiles: ["package.json", "docs/runbook.md"],
      requiredScripts: { "package.json": ["check"] },
    });

    assertions.assertFilesExist();
    assertions.assertPackageScripts();
    assertions.assertTextIncludes("docs/runbook.md", ["GO", "NO-GO"]);
    assertions.assertNeedleMap({ "docs/runbook.md": ["GO"] });
  });
});

test("repository assertions retain contextual failure messages", () => {
  withFixture((root) => {
    const assertions = createRepositoryAssertions({
      root,
      requiredFiles: ["docs/missing.md"],
      missingFilesLabel: "Missing release files",
    });

    assert.throws(() => assertions.assertFilesExist(), /Missing release files: docs\/missing\.md/);

    writeFixture(root, "package.json", JSON.stringify({ scripts: {} }));
    assert.throws(
      () => assertions.assertPackageScripts({ "package.json": ["verify:release"] }),
      /package\.json is missing script verify:release/,
    );

    writeFixture(root, "docs/runbook.md", "GO");
    assert.throws(
      () => assertions.assertNeedleMap({ "docs/runbook.md": ["GO", "NO-GO"] }),
      /docs\/runbook\.md is missing: NO-GO/,
    );
  });
});
