// ── 后端契约封装 ──────────────────────────────────────────────────────────
// 整段照搬现有 frontend/app.jsx 的 fetch 封装(token 注入 + 401 兜底 + /api/auth 豁免)。
// 引擎域端点契约固定(Gengyue 域),这里只调用、不新增、不改行为。

const TOKEN_KEY = "ais_auth_token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch (e) {
    return "";
  }
}
export function setToken(t) {
  try {
    t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
  } catch (e) {}
}

// 集中注入(包住 window.fetch),保证 streamTurn / uploadFile / 各裸 fetch 都带上 Authorization。
// 仅当本地有 token 且 URL 以 /api/ 开头时加;无 token(未登录 / AUTH 关)时与现状一致。
(function patchFetch() {
  if (typeof window === "undefined" || window.__ais_fetch_patched) return;
  window.__ais_fetch_patched = true;
  const _f = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    opts = opts || {};
    let hadToken = false;
    try {
      const t = getToken();
      if (t && typeof url === "string" && url.indexOf("/api/") === 0) {
        hadToken = true;
        const h = new Headers(opts.headers || {});
        if (!h.has("Authorization")) h.set("Authorization", "Bearer " + t);
        opts = Object.assign({}, opts, { headers: h });
      }
    } catch (e) {}
    const p = _f(url, opts);
    // 全局 401 兜底:带 token 的业务请求被拒 = token 失效/被吊销,清掉并回登录页。
    // /api/auth/* 除外(登录失败本来就是 401)。
    if (hadToken && typeof url === "string" && url.indexOf("/api/auth/") !== 0) {
      return p.then((r) => {
        if (r && r.status === 401 && getToken()) {
          setToken("");
          location.reload();
        }
        return r;
      });
    }
    return p;
  };
})();

// 登录/注册/me:返回 json,失败抛后端 detail。
export async function authApi(path, body) {
  const opts =
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        };
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || "请求失败");
  return data;
}

export async function postJSON(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(err.detail || "请求失败");
  }
  return r.json();
}

export async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

export async function uploadFile(file) {
  const r = await fetch("/api/upload?filename=" + encodeURIComponent(file.name), {
    method: "POST",
    body: file,
  });
  if (!r.ok) throw new Error("上传失败");
  return (await r.json()).text;
}

// 从(可能半截的)JSON 文本抽某个字符串字段的当前值,处理转义与半截 —— 流式逐字显示用。
function extractField(raw, field) {
  const key = '"' + field + '"';
  let i = raw.indexOf(key);
  if (i < 0) return "";
  i += key.length;
  while (i < raw.length && raw[i] !== '"') i++;
  if (raw[i] !== '"') return "";
  i++;
  let out = "";
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\\") {
      const next = raw[i + 1];
      if (next === undefined) break;
      if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else if (next === "r") out += "\r";
      else if (next === '"') out += '"';
      else if (next === "\\") out += "\\";
      else if (next === "/") out += "/";
      else if (next === "u") {
        const hex = raw.slice(i + 2, i + 6);
        if (hex.length < 4) break;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 6;
        continue;
      } else out += next;
      i += 2;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i++;
  }
  return out;
}

// 从流式累积的半截 JSON 里抽出当前叙事 + 已成形的角色台词(每条 {name, text},text 可半截)。
export function extractStream(raw) {
  const narration = extractField(raw, "narration");
  const messages = [];
  const m = raw.indexOf('"messages"');
  if (m >= 0) {
    let i = raw.indexOf("[", m);
    if (i >= 0) {
      i++;
      while (i < raw.length) {
        while (i < raw.length && raw[i] !== "{" && raw[i] !== "]") i++;
        if (i >= raw.length || raw[i] === "]") break;
        const j = raw.indexOf("}", i);
        const obj = raw.slice(i, j < 0 ? raw.length : j + 1);
        const name = extractField(obj, "name");
        const text = extractField(obj, "text");
        if (name || text) messages.push({ name, text });
        if (j < 0) break;
        i = j + 1;
      }
    }
  }
  return { narration, messages };
}

// 调流式回合端点,逐块回调 onDelta(原始 JSON 文本块),返回服务端解析好的完整 turn(done/error 事件)。
export async function streamTurn(body, { onDelta }) {
  const r = await fetch("/api/story_turn_stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok || !r.body) throw new Error("流式端点不可用");
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let finalTurn = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 2);
      if (!chunk.startsWith("data:")) continue;
      const payload = chunk.slice(5).trim();
      if (!payload) continue;
      let evt;
      try {
        evt = JSON.parse(payload);
      } catch (e) {
        continue;
      }
      if (evt.type === "delta") onDelta(evt.text || "");
      else if (evt.type === "done" || evt.type === "error") finalTurn = evt.turn;
    }
  }
  return finalTurn;
}

export function newSessionId() {
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now()) + Math.random();
  return id.replace(/[^a-z0-9]/gi, "");
}
