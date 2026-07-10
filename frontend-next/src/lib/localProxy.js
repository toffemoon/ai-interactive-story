import { postJSON } from "./api";

const SETTINGS_KEY = "ais_local_proxy_settings_v1";
const SESSION_KEY = "ais_local_proxy_key_v1";
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
    endpoint: String(saved.endpoint || ""),
    model: String(saved.model || ""),
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

function messageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => (item && typeof item.text === "string" ? item.text : ""))
      .join("");
  }
  return "";
}

async function callBrowserLocalProxy(call, settings) {
  const model = String(settings.model || "").trim();
  if (!model) throw new Error("请先填写本机反代模型名");

  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = "Bearer " + settings.apiKey;
  const body = {
    model,
    messages: call.messages || [],
    max_tokens: call.max_tokens || 1024,
    stream: false,
  };
  if (call.json_mode) body.response_format = { type: "json_object" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(completionUrl(settings.endpoint), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("本机反代响应超时");
    throw new Error("无法连接本机反代,请检查地址、CORS 与 Private Network Access");
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      (data && data.error && (data.error.message || data.error.code)) ||
      data.detail ||
      response.statusText;
    throw new Error("本机反代返回 " + response.status + (detail ? ": " + detail : ""));
  }
  const content = messageText(
    data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : ""
  );
  if (!content) throw new Error("本机反代没有返回 assistant 文本");
  return {
    request_id: call.request_id,
    content,
    usage: data.usage || {},
  };
}

async function runFlow(path, seed, settings, onStep) {
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
    request.answers.push(await callBrowserLocalProxy(result.call, settings));
  }
  throw new Error("本轮需要的模型调用过多,已停止");
}

export function runLocalProxyTurn(turn, settings, { onStep } = {}) {
  return runFlow("/api/local_proxy/story_turn", { turn }, settings, onStep);
}

export function runLocalProxyReroll(sessionId, settings, { onStep } = {}) {
  return runFlow("/api/local_proxy/reroll", { session_id: sessionId }, settings, onStep);
}
