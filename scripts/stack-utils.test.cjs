const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const { EventEmitter } = require("node:events");

const {
  httpGet,
  httpPostJson,
  checkApiHealth,
  formatPortListeners,
  getProxyPort,
  isLocalProxyTarget,
} = require("./lib/stack-utils.cjs");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(address);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test("httpGet reads JSON over http", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service: "http-service" }));
  });

  const address = await listen(server);
  try {
    const response = await httpGet(`http://127.0.0.1:${address.port}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(response.body, JSON.stringify({ ok: true, service: "http-service" }));
  } finally {
    await closeServer(server);
  }
});

test("httpGet reads JSON over https", async () => {
  const originalRequest = https.request;
  let capturedUrl = null;
  let capturedTimeout = null;
  https.request = (url, options, onResponse) => {
    capturedUrl = String(url);
    capturedTimeout = options?.timeout;
    const response = new EventEmitter();
    response.statusCode = 200;
    queueMicrotask(() => {
      onResponse(response);
      response.emit("data", JSON.stringify({ ok: true, service: "https-service" }));
      response.emit("end");
    });
    return {
      on() {
        return this;
      },
      end() {},
      write() {},
      destroy() {},
    };
  };
  try {
    const response = await httpGet("https://example.test/api/health");
    assert.equal(response.status, 200);
    assert.equal(response.body, JSON.stringify({ ok: true, service: "https-service" }));
    assert.equal(capturedUrl, "https://example.test/api/health");
    assert.equal(capturedTimeout, 2500);
  } finally {
    https.request = originalRequest;
  }
});

test("checkApiHealth accepts ready payloads", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ready", service: "api-ready" }));
  });

  const address = await listen(server);
  try {
    const result = await checkApiHealth(`http://127.0.0.1:${address.port}`);
    assert.equal(result.ok, true);
    assert.equal(result.note, "api-ready");
    assert.deepEqual(result.payload, { status: "ready", service: "api-ready" });
  } finally {
    await closeServer(server);
  }
});

test("httpPostJson sends JSON bodies", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, "POST");
    assert.equal(req.headers["content-type"], "application/json");
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ received: JSON.parse(body) }));
    });
  });

  const address = await listen(server);
  try {
    const response = await httpPostJson(`http://127.0.0.1:${address.port}/api/auth/login`, {
      login: "oleg",
      haslo: "oleg",
    });
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { received: { login: "oleg", haslo: "oleg" } });
  } finally {
    await closeServer(server);
  }
});

test("checkApiHealth preserves error payloads for diagnostics", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, reason: "warming up" }));
  });

  const address = await listen(server);
  try {
    const result = await checkApiHealth(`http://127.0.0.1:${address.port}`);
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.note, "status 503");
    assert.deepEqual(result.payload, { ok: false, reason: "warming up" });
    assert.match(result.body, /warming up/);
  } finally {
    await closeServer(server);
  }
});

test("checkApiHealth reports invalid JSON distinctly", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok-but-not-json");
  });

  const address = await listen(server);
  try {
    const result = await checkApiHealth(`http://127.0.0.1:${address.port}`);
    assert.equal(result.ok, false);
    assert.equal(result.status, 200);
    assert.equal(result.note, "invalid json");
    assert.equal(result.payload, null);
    assert.equal(result.body, "ok-but-not-json");
  } finally {
    await closeServer(server);
  }
});

test("checkApiHealth preserves unauthorized payloads for port conflict diagnostics", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not arbor api" }));
  });

  const address = await listen(server);
  try {
    const result = await checkApiHealth(`http://127.0.0.1:${address.port}`);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.note, "status 401");
    assert.deepEqual(result.payload, { error: "not arbor api" });
  } finally {
    await closeServer(server);
  }
});

test("formatPortListeners includes process names, pids, and paths", () => {
  assert.equal(
    formatPortListeners([{ pid: "123", name: "node.exe", path: "C:\\repo\\node.exe" }]),
    "node.exe pid=123 path=C:\\repo\\node.exe"
  );
  assert.equal(formatPortListeners([]), "unknown listener");
});

test("getProxyPort reads explicit and default ports from proxy targets", () => {
  assert.equal(getProxyPort("http://localhost:3006"), 3006);
  assert.equal(getProxyPort("http://example.test"), 80);
  assert.equal(getProxyPort("https://example.test"), 443);
  assert.equal(getProxyPort("not a url"), 3001);
});

test("isLocalProxyTarget separates local dev APIs from remote Render targets", () => {
  assert.equal(isLocalProxyTarget("http://localhost:3006"), true);
  assert.equal(isLocalProxyTarget("http://127.0.0.1:3001"), true);
  assert.equal(isLocalProxyTarget("https://arbor-os-b7k6.onrender.com"), false);
  assert.equal(isLocalProxyTarget("not a url"), true);
});
