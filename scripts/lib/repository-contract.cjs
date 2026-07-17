const fs = require("node:fs");
const path = require("node:path");

function createRepositoryAssertions(options = {}) {
  const {
    root,
    requiredFiles = [],
    requiredScripts = {},
    missingFilesLabel = "Missing required files",
  } = options;

  if (!root) {
    throw new TypeError("createRepositoryAssertions requires a repository root");
  }

  function resolvePath(relPath, baseDir = root) {
    return path.resolve(baseDir, relPath);
  }

  function readText(relPath, baseDir = root) {
    return fs.readFileSync(resolvePath(relPath, baseDir), "utf8");
  }

  function readJson(relPath, baseDir = root) {
    return JSON.parse(readText(relPath, baseDir));
  }

  function assertFilesExist(files = requiredFiles, baseDir = root) {
    const missing = files.filter((file) => !fs.existsSync(resolvePath(file, baseDir)));
    if (missing.length) {
      throw new Error(`${missingFilesLabel}: ${missing.join(", ")}`);
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
    const text = readText(relPath, baseDir);
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

  return {
    assertFilesExist,
    assertNeedleMap,
    assertPackageScripts,
    assertTextIncludes,
    readJson,
    readText,
  };
}

module.exports = {
  createRepositoryAssertions,
};
