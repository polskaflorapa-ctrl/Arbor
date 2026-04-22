const { spawn } = require("node:child_process");

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { stdio: "inherit", shell: true });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed (${code}): ${command}`));
    });
    child.on("error", reject);
  });
}

async function main() {
  console.info("[restart:force] Stopping existing local stack...");
  await runCommand("npm run down");

  console.info("[restart:force] Starting fresh stack...");
  await runCommand("npm run up:force");
}

main().catch((error) => {
  console.error("[restart:force] FAILED:", error.message);
  process.exit(1);
});
