const { spawn } = require("node:child_process");
const net = require("node:net");

function isPortOpen(port, host = "127.0.0.1", timeoutMs = 600) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

async function main() {
  const apiRunning = await isPortOpen(3001);

  const names = apiRunning ? "WEB,OS" : "API,WEB,OS";
  const commands = apiRunning
    ? ["npm run dev:web", "npm run dev:os"]
    : ["npm run dev:api", "npm run dev:web", "npm run dev:os"];

  if (apiRunning) {
    console.info("[dev:smart] API already running on :3001, skipping API start.");
  } else {
    console.info("[dev:smart] API not detected on :3001, starting API + WEB + OS.");
  }

  const cmd = `npx --yes concurrently -n ${names} ${commands.map((c) => `"${c}"`).join(" ")}`;
  const child = spawn(cmd, {
    stdio: "inherit",
    shell: true,
  });

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error("[dev:smart] Failed to start dev stack:", error);
  process.exit(1);
});
