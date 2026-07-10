"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const {
  buildCodexInput,
  codexProcessEnv,
  createProxyServer,
  isAllowedOrigin,
  normalizeMessages,
  resolveRequestedModel,
} = require("./server");

const PROD_ORIGIN = "https://ai-interactive-story.onrender.com";

function request(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path,
      headers: {
        ...headers,
        ...(payload ? {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
        } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test("origin policy allows production and loopback only", () => {
  const configured = new Set([PROD_ORIGIN]);
  assert.equal(isAllowedOrigin(PROD_ORIGIN, configured), true);
  assert.equal(isAllowedOrigin("http://localhost:5173", configured), true);
  assert.equal(isAllowedOrigin("http://127.0.0.1:8000", configured), true);
  assert.equal(isAllowedOrigin("https://evil.example", configured), false);
});

test("normalizes messages and separates system instructions", () => {
  const messages = normalizeMessages([
    { role: "system", content: "Stay concise." },
    { role: "user", content: [{ type: "text", text: "Hello" }] },
  ]);
  const built = buildCodexInput(messages, 512, true);
  assert.match(built.baseInstructions, /Stay concise\./);
  assert.doesNotMatch(built.input, /"role":"system"/);
  assert.match(built.input, /"role":"user","content":"Hello"/);
  assert.match(built.input, /valid JSON object/);
});

test("model alias resolves to the configured Codex model", () => {
  assert.equal(resolveRequestedModel("codex", "gpt-current"), "gpt-current");
  assert.equal(resolveRequestedModel("gpt-other", "gpt-current"), "gpt-other");
  assert.throws(() => resolveRequestedModel("bad model name", "gpt-current"));
});

test("Codex child environment excludes project credentials", () => {
  const env = codexProcessEnv();
  assert.equal(Object.hasOwn(env, "LLM_API_KEY"), false);
  assert.equal(Object.hasOwn(env, "SUPABASE_PROD_ACCESS_TOKEN"), false);
});

test("HTTP bridge enforces CORS, PNA, token, and OpenAI response shape", async (t) => {
  const calls = [];
  const fakeCodex = {
    child: { exitCode: null },
    async complete(input) {
      calls.push(input);
      return input.jsonMode ? '{"ok":true}' : "BRIDGE_OK";
    },
  };
  const proxy = createProxyServer({
    port: 0,
    model: "gpt-test",
    codex: fakeCodex,
    token: "local-test-token",
    allowedOrigins: new Set([PROD_ORIGIN]),
  });
  await new Promise((resolve, reject) => {
    proxy.server.once("error", reject);
    proxy.server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => proxy.server.close(resolve)));
  const port = proxy.server.address().port;

  const preflight = await request(port, {
    method: "OPTIONS",
    path: "/v1/chat/completions",
    headers: {
      Origin: PROD_ORIGIN,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers["access-control-allow-origin"], PROD_ORIGIN);
  assert.equal(preflight.headers["access-control-allow-private-network"], "true");

  const unauthorized = await request(port, {
    method: "POST",
    path: "/v1/chat/completions",
    headers: { Origin: PROD_ORIGIN },
    body: { model: "codex", messages: [{ role: "user", content: "ping" }] },
  });
  assert.equal(unauthorized.status, 401);

  const completion = await request(port, {
    method: "POST",
    path: "/v1/chat/completions",
    headers: { Origin: PROD_ORIGIN, Authorization: "Bearer local-test-token" },
    body: {
      model: "codex",
      messages: [{ role: "user", content: "ping" }],
      response_format: { type: "json_object" },
    },
  });
  assert.equal(completion.status, 200);
  assert.equal(completion.body.model, "gpt-test");
  assert.equal(completion.body.choices[0].message.content, '{"ok":true}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].jsonMode, true);

  const denied = await request(port, {
    method: "POST",
    path: "/v1/chat/completions",
    headers: { Origin: "https://evil.example", Authorization: "Bearer local-test-token" },
    body: { model: "codex", messages: [{ role: "user", content: "ping" }] },
  });
  assert.equal(denied.status, 403);
});
