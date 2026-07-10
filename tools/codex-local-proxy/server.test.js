"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const {
  CodexAppServer,
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
        const contentType = String(res.headers["content-type"] || "");
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: text && contentType.includes("application/json") ? JSON.parse(text) : text || null,
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
  assert.equal(resolveRequestedModel("codex", null), null);
  assert.equal(resolveRequestedModel("gpt-other", "gpt-current"), "gpt-other");
  assert.throws(() => resolveRequestedModel("bad model name", "gpt-current"));
});

test("Codex child environment excludes project credentials", () => {
  const env = codexProcessEnv();
  assert.equal(Object.hasOwn(env, "LLM_API_KEY"), false);
  assert.equal(Object.hasOwn(env, "SUPABASE_PROD_ACCESS_TOKEN"), false);
});

test("Codex app-server deltas stream final answers and ignore commentary", () => {
  const codex = new CodexAppServer({ binary: "codex", model: null, workspace: "." });
  const deltas = [];
  const tracker = {
    agentPhases: new Map(),
    streamedText: "",
    finalText: "",
    onDelta: (delta) => deltas.push(delta),
  };
  codex.turns.set("thread-1", tracker);

  codex._onNotification("item/started", {
    threadId: "thread-1",
    item: { id: "commentary-1", type: "agentMessage", phase: "commentary" },
  });
  codex._onNotification("item/agentMessage/delta", {
    threadId: "thread-1",
    itemId: "commentary-1",
    delta: "hidden",
  });
  codex._onNotification("item/started", {
    threadId: "thread-1",
    item: { id: "answer-1", type: "agentMessage", phase: "final_answer" },
  });
  codex._onNotification("item/agentMessage/delta", {
    threadId: "thread-1",
    itemId: "answer-1",
    delta: "visible",
  });
  codex._onNotification("item/completed", {
    threadId: "thread-1",
    item: { id: "answer-1", type: "agentMessage", phase: "final_answer", text: "visible" },
  });

  assert.deepEqual(deltas, ["visible"]);
  assert.equal(tracker.streamedText, "visible");
  assert.equal(tracker.finalText, "visible");

  const fallback = [];
  const fallbackTracker = {
    agentPhases: new Map(),
    streamedText: "",
    finalText: "",
    onDelta: (delta) => fallback.push(delta),
  };
  codex.turns.set("thread-2", fallbackTracker);
  codex._onNotification("item/completed", {
    threadId: "thread-2",
    item: { id: "answer-2", type: "agentMessage", phase: "final_answer", text: "fallback" },
  });
  assert.deepEqual(fallback, ["fallback"]);
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

test("HTTP bridge exposes managed ChatGPT OAuth without returning tokens", async (t) => {
  const fakeCodex = {
    child: { exitCode: null },
    accountCache: { authenticated: false },
    async accountStatus() {
      return {
        authenticated: false,
        auth_mode: null,
        email_present: false,
        plan_type: null,
        requires_openai_auth: true,
      };
    },
    async startLogin(flow) {
      assert.equal(flow, "browser");
      return {
        status: "pending",
        flow,
        login_id: "login-1",
        auth_url: "https://chatgpt.com/oauth/authorize",
        verification_url: null,
        user_code: null,
        error: null,
        account: { authenticated: false },
      };
    },
    async loginStatus(loginId) {
      assert.equal(loginId, "login-1");
      return { status: "completed", login_id: loginId, account: { authenticated: true } };
    },
  };
  const proxy = createProxyServer({
    port: 0,
    model: null,
    codex: fakeCodex,
    token: "",
    allowedOrigins: new Set([PROD_ORIGIN]),
  });
  await new Promise((resolve, reject) => {
    proxy.server.once("error", reject);
    proxy.server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => proxy.server.close(resolve)));
  const port = proxy.server.address().port;

  const status = await request(port, {
    path: "/auth/status",
    headers: { Origin: PROD_ORIGIN },
  });
  assert.equal(status.status, 200);
  assert.equal(status.body.authenticated, false);

  const started = await request(port, {
    method: "POST",
    path: "/auth/login/start",
    headers: { Origin: PROD_ORIGIN },
    body: { flow: "browser" },
  });
  assert.equal(started.status, 200);
  assert.equal(started.body.login_id, "login-1");
  assert.equal(started.body.auth_url.startsWith("https://chatgpt.com/"), true);
  assert.equal(JSON.stringify(started.body).includes("access_token"), false);

  const completed = await request(port, {
    path: "/auth/login/status?login_id=login-1",
    headers: { Origin: PROD_ORIGIN },
  });
  assert.equal(completed.body.status, "completed");
  assert.equal(completed.body.account.authenticated, true);
});

test("HTTP bridge streams OpenAI-compatible SSE chunks and usage", async (t) => {
  const fakeCodex = {
    child: { exitCode: null },
    async complete(input) {
      input.onDelta("BRIDGE_");
      await new Promise((resolve) => setImmediate(resolve));
      input.onDelta("STREAM_OK");
      return "BRIDGE_STREAM_OK";
    },
  };
  const proxy = createProxyServer({
    port: 0,
    model: "gpt-stream-test",
    codex: fakeCodex,
    token: "",
    allowedOrigins: new Set([PROD_ORIGIN]),
  });
  await new Promise((resolve, reject) => {
    proxy.server.once("error", reject);
    proxy.server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => proxy.server.close(resolve)));
  const port = proxy.server.address().port;

  const response = await request(port, {
    method: "POST",
    path: "/v1/chat/completions",
    headers: { Origin: PROD_ORIGIN },
    body: {
      model: "codex",
      messages: [{ role: "user", content: "stream" }],
      stream: true,
      stream_options: { include_usage: true },
    },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /^text\/event-stream/);
  const payloads = response.body
    .split("\n\n")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^data:\s*/, ""));
  assert.equal(payloads.at(-1), "[DONE]");
  const chunks = payloads.slice(0, -1).map((payload) => JSON.parse(payload));
  const content = chunks
    .map((chunk) => chunk.choices[0] && chunk.choices[0].delta.content || "")
    .join("");
  assert.equal(content, "BRIDGE_STREAM_OK");
  assert.equal(chunks.some((chunk) => chunk.choices[0] && chunk.choices[0].finish_reason === "stop"), true);
  const usageChunk = chunks.find((chunk) => Array.isArray(chunk.choices) && chunk.choices.length === 0);
  assert.equal(usageChunk.usage.total_tokens > 0, true);
});

test("HTTP bridge aborts the active Codex turn when a stream client disconnects", async (t) => {
  let aborted = false;
  const fakeCodex = {
    child: { exitCode: null },
    async complete(input) {
      input.onDelta("first");
      return await new Promise((resolve, reject) => {
        input.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        }, { once: true });
      });
    },
  };
  const proxy = createProxyServer({
    port: 0,
    model: "gpt-stream-test",
    codex: fakeCodex,
    token: "",
    allowedOrigins: new Set([PROD_ORIGIN]),
  });
  await new Promise((resolve, reject) => {
    proxy.server.once("error", reject);
    proxy.server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => proxy.server.close(resolve)));
  const port = proxy.server.address().port;

  await new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify({
      model: "codex",
      messages: [{ role: "user", content: "disconnect" }],
      stream: true,
    }), "utf8");
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method: "POST",
      path: "/v1/chat/completions",
      headers: {
        Origin: PROD_ORIGIN,
        "Content-Type": "application/json",
        "Content-Length": payload.length,
      },
    }, (res) => {
      res.once("data", () => {
        res.destroy();
        resolve();
      });
    });
    req.on("error", (error) => {
      if (error.code === "ECONNRESET") resolve();
      else reject(error);
    });
    req.end(payload);
  });
  for (let attempt = 0; attempt < 30 && !aborted; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(aborted, true);
});
