const fs = require("node:fs");
const path = require("node:path");

function copyDir(sourceDir, targetDir) {
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(sourcePath, targetPath);
      continue;
    }
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const webBuildDir = path.join(repoRoot, "web", "build");
  const rootBuildDir = path.join(repoRoot, "build");

  if (!fs.existsSync(webBuildDir)) {
    throw new Error(`Web build directory not found: ${webBuildDir}`);
  }

  copyDir(webBuildDir, rootBuildDir);
  console.info(`[build-sync] copied ${webBuildDir} -> ${rootBuildDir}`);
}

try {
  main();
} catch (error) {
  console.error("[build-sync] FAILED:", error.message);
  process.exit(1);
}
