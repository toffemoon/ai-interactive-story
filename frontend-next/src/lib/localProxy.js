import { postJSON } from "./api";

const SETTINGS_KEY = "ais_local_proxy_settings_v1";
const SESSION_KEY = "ais_local_proxy_key_v1";
const DEFAULT_ENDPOINT = "http://127.0.0.1:8765/v1";
const DEFAULT_MODEL = "codex";
export const LOCAL_PROXY_SETUP_URL = "/downloads/codex-bridge/AIStory-Codex-Setup.cmd";
const MAX_FLOW_STEPS = 12;
const REQUEST_TIMEOUT_MS = 180_000;

function storageGet(store, key) {
  try {
    return store.getItem(key) || "";
  } catch (e) {
    return "";
  }
}

export function loadLocalProxySettings() {
  let saved = {};
  try {
    saved = JSON.parse(storageGet(localStorage, SETTINGS_KEY)) || {};
  } catch (e) {}
  return {
    source: saved.source === "local_proxy" ? "local_proxy" : "deepseek",
    endpoint: String(saved.endpoint || DEFAULT_ENDPOINT),
    model: String(saved.model || DEFAULT_MODEL),
    apiKey: storageGet(sessionStorage, SESSION_KEY),
  };
}

export function saveLocalProxySettings(next) {
  const settings = {
    source: next.source === "local_proxy" ? "local_proxy" : "deepseek",
    endpoint: String(next.endpoint || "").trim(),
    model: String(next.model || "").trim(),
    apiKey: String(next.apiKey || "").trim(),
  };
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        source: settings.source,
        endpoint: settings.endpoint,
        model: settings.model,
      })
    );
    settings.apiKey
      ? sessionStorage.setItem(SESSION_KEY, settings.apiKey)
      : sessionStorage.removeItem(SESSION_KEY);
  } catch (e) {}
  return settings;
}

export function saveModelSource(source) {
  const current = loadLocalProxySettings();
  return saveLocalProxySettings({ ...current, source });
}

function completionUrl(endpoint) {
  const base = String(endpoint || "").trim();
  if (!base) throw new Error("请先填写本机反代地址");
  let parsed;
  try {
    parsed = new URL(base);
  } catch (e) {
    throw new Error("本机反代地址格式不正确");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = host === "127.0.0.1" || host === "::1" || host === "localhost" || host.endsWith(".localhost");
  if (!loopback || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("本机反代地址只允许 localhost 或回环 IP");
  }
  if (parsed.username || parsed.password) throw new Error("本机反代地址不能内嵌账号密码");
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  if (!/\/chat\/completions$/i.test(parsed.pathname)) parsed.pathname += "/chat/completions";
  return parsed.toString();
}

function controlUrl(endpoint, path) {
  const parsed = new URL(completionUrl(endpoint));
  return parsed.origin + path;
}

async function localControlRequest(path, { method = "GET", body, timeoutMs = 10_000 } = {}) {
  const settings = loadLocalProxySettings();
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (settings.apiKey) headers.Authorization = "Bearer " + settings.apiKey;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(controlUrl(settings.endpoint, path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data && data.error && (data.error.message || data.error.code);
      throw new Error(detail || `本机连接助手返回 ${response.status}`);
    }
    return data;
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("本机连接助手响应超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function getLocalProxyConnection() {
  const health = await localControlRequest("/health", { timeoutMs: 4_000 });
  const account = await localControlRequest("/auth/status");
  return { health, account };
}

export function startLocalProxyLogin(flow = "browser") {
  return localControlRequest("/auth/login/start", { method: "POST", body: { flow } });
}

export function getLocalProxyLoginStatus(loginId) {
  return localControlRequest(`/auth/login/status?login_id=${encodeURIComponent(loginId)}`);
}

export function cancelLocalProxyLogin(loginId) {
  return localControlRequest("/auth/login/cancel", {
    method: "POST",
    body: { login_id: loginId },
  });
}

function messageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (item && typeof item.text === "string" ? item.text : ""))
      .join("");
  }
  return "";
}

function responseError(response, data) {
  const payloadError = data && data.error;
  const detail =
    (payloadError && (payloadError.message || payloadError.code)) ||
    (data && data.detail) ||
    response.statusText;
  const error = new Error("本机反代返回 " + response.status + (detail ? ": " + detail : ""));
  error.status = response.status;
  error.proxyCode = payloadError && payloadError.code;
  return error;
}

function completionContent(data) {
  return messageText(
    data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : ""
  );
}

function consumeSseEvent(block, state, onDelta) {
  const dataText = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!dataText) return;
  if (dataText === "[DONE]") {
    state.done = true;
    return;
  }

  let payload;
  try {
    payload = JSON.parse(dataText);
  } catch (e) {
    throw new Error("本机反代返回了无法解析的 SSE 数据");
  }
  if (payload && payload.error) {
    const error = new Error(payload.error.message || payload.error.code || "本机 Codex 流式生成失败");
    error.proxyCode = payload.error.code;
    throw error;
  }
  if (payload && payload.usage) state.usage = payload.usage;
  const delta = messageText(
    payload && payload.choices && payload.choices[0] && payload.choices[0].delta
      ? payload.choices[0].delta.content
      : ""
  );
  if (!delta) return;
  state.content += delta;
  if (onDelta) onDelta(delta);
}

async function readSseCompletion(response, onDelta) {
  if (!response.body || !response.body.getReader) {
    throw new Error("当前浏览器不支持读取本机 Codex 流式响应");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { content: "", usage: {}, done: false };
  let buffer = "";

  while (!state.done) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    let boundary = /\r?\n\r?\n/.exec(buffer);
    while (boundary) {
      const block = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      consumeSseEvent(block, state, onDelta);
      if (state.done) break;
      boundary = /\r?\n\r?\n/.exec(buffer);
    }
    if (done) break;
  }
  if (!state.done && buffer.trim()) consumeSseEvent(buffer, state, onDelta);
  if (!state.content) throw new Error("本机反代没有返回 assistant 文本");
  return state;
}

async function requestBrowserLocalProxy(call, settings, { stream, onDelta }) {
  const model = String(settings.model || "").trim();
  if (!model) throw new Error("请先填写本机反代模型名");

  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = "Bearer " + settings.apiKey;
  const body = {
    model,
    messages: call.messages || [],
    max_tokens: call.max_tokens || 1024,
    stream,
  };
  if (stream) body.stream_options = { include_usage: true };
  if (call.json_mode) body.response_format = { type: "json_object" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(completionUrl(settings.endpoint), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw responseError(response, data);
    }

    let content = "";
    let usage = {};
    if (stream && contentType.includes("text/event-stream")) {
      const result = await readSseCompletion(response, onDelta);
      content = result.content;
      usage = result.usage;
    } else {
      const data = await response.json().catch(() => ({}));
      content = completionContent(data);
      usage = data.usage || {};
      if (content && onDelta) onDelta(content);
    }
    if (!content) throw new Error("本机反代没有返回 assistant 文本");
    return {
      request_id: call.request_id,
      content,
      usage,
    };
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("本机反代响应超时");
    if (e && (e.status || e.proxyCode || /^本机反代/.test(e.message))) throw e;
    throw new Error("无法连接本机反代,请检查地址、CORS 与 Private Network Access");
  } finally {
    clearTimeout(timer);
  }
}

async function callBrowserLocalProxy(call, settings, onDelta) {
  try {
    return await requestBrowserLocalProxy(call, settings, { stream: true, onDelta });
  } catch (error) {
    const unsupported =
      error.proxyCode === "stream_not_supported" ||
      (error.status === 400 && /stream/i.test(error.message || ""));
    if (!unsupported) throw error;
    return requestBrowserLocalProxy(call, settings, { stream: false, onDelta });
  }
}

async function runFlow(path, seed, settings, { onStep, onDelta } = {}) {
  const request = { ...seed, answers: [], revision: "", flow_id: "" };
  for (let step = 0; step < MAX_FLOW_STEPS; step++) {
    const result = await postJSON(path, request);
    if (result.status === "done" && result.turn) return result.turn;
    if (result.status !== "needs_llm" || !result.call) {
      throw new Error("服务端返回了未知的本机模型步骤");
    }
    request.revision = result.revision || "";
    request.flow_id = result.flow_id || "";
    if (onStep) onStep(result.call, step);
    const streamDelta = result.call.kind === "stream" ? onDelta : null;
    request.answers.push(await callBrowserLocalProxy(result.call, settings, streamDelta));
  }
  throw new Error("本轮需要的模型调用过多,已停止");
}

export function runLocalProxyTurn(turn, settings, options = {}) {
  return runFlow("/api/local_proxy/story_turn", { turn }, settings, options);
}

export function runLocalProxyReroll(sessionId, settings, options = {}) {
  return runFlow("/api/local_proxy/reroll", { session_id: sessionId }, settings, options);
}
