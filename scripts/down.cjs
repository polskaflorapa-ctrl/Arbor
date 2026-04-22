const { killPortListeners } = require("./lib/stack-utils.cjs");

function stopDevStack() {
  const killed = killPortListeners([3000, 3001, 3002], "down");
  if (killed === 0) {
    console.info("[down] No matching dev processes found on ports 3000/3001/3002.");
  } else {
    console.info(`[down] Done. Killed ${killed} process(es).`);
  }
}

function main() {
  console.info("[down] Stopping Arbor local stack on ports 3000/3001/3002...");
  stopDevStack();
}

main();
