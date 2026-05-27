const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const https = require("node:https");
const { EventEmitter } = require("node:events");

const { httpGet, checkApiHealth } = require("./lib/stack-utils.cjs");

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
