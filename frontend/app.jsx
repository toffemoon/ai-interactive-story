const { useEffect, useMemo, useRef, useState } = React;

// ── 账户:token 存取 + 给所有 /api 请求自动带 Authorization ───────────────
// 集中注入(包住 window.fetch),不必逐个改 fetch 调用,保证 streamTurn / uploadFile / 各裸 fetch 都带上。
// 仅当本地有 token 且 URL 以 /api/ 开头时加;无 token(未登录 / AUTH 关)时与现状逐字节一致。
const TOKEN_KEY = "ais_auth_token";
function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; } }
function setToken(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
(function patchFetch() {
  if (window.__ais_fetch_patched) return;
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
    // 全局 401 兜底:带 token 的业务请求被拒 = token 已失效/被吊销,清掉并回登录页,
    // 不再让每个调用各自抛一条看不懂的错。/api/auth/* 除外(登录失败本来就是 401)。
    if (hadToken && typeof url === "string" && url.indexOf("/api/auth/") !== 0) {
      return p.then((r) => {
        if (r && r.status === 401 && getToken()) { setToken(""); location.reload(); }
        return r;
      });
    }
    return p;
  };
})();

// 登录/注册/me 调用:返回 json,失败抛后端 detail。
async function authApi(path, body) {
  const opts = body === undefined
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || "请求失败");
  return data;
}

async function postJSON(url, body) {
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

async function uploadFile(file) {
  const r = await fetch("/api/upload?filename=" + encodeURIComponent(file.name), {
    method: "POST",
    body: file,
  });
  if (!r.ok) throw new Error("上传失败");
  return (await r.json()).text;
}

// 从流式累积的(可能半截)JSON 串里抽出 narration 字段的当前值,用于逐字显示。
// 遇到半截转义(\u 只到一半、\ 在末尾)就停在那,等下一块到了再续,避免吐乱码。
function extractNarration(raw) {
  const key = '"narration"';
  let i = raw.indexOf(key);
  if (i < 0) return "";
  i += key.length;
  while (i < raw.length && raw[i] !== '"') i++; // 跳过 : 和空白,定位到值的起始引号
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
    if (ch === '"') break; // narration 字符串结束
    out += ch;
    i++;
  }
  return out;
}

// 从(可能半截的)JSON 文本里抽某个字符串字段的当前值,处理转义与半截(逻辑同 extractNarration,泛化字段名)。
function extractField(raw, field) {
  const key = '"' + field + '"';
  let i = raw.indexOf(key);
  if (i < 0) return "";
  i += key.length;
  while (i < raw.length && raw[i] !== '"') i++; // 跳过 : 与空白,定位到值起始引号
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

// 从流式累积的半截 JSON 里抽出当前的叙事 + 已成形的角色台词(每条 {name, text},text 可半截)。
function extractStream(raw) {
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
        const j = raw.indexOf("}", i);            // 台词对象不嵌套,取到 } 即一条
        const obj = raw.slice(i, j < 0 ? raw.length : j + 1);
        const name = extractField(obj, "name");
        const text = extractField(obj, "text");
        if (name || text) messages.push({ name, text });
        if (j < 0) break;                          // 最后一条还没收尾,partial 已 push,停
        i = j + 1;
      }
    }
  }
  return { narration, messages };
}

// 调用流式回合端点,逐块回调 onDelta(原始 JSON 文本块),返回服务端解析好的完整 turn(done/error 事件)。
async function streamTurn(body, { onDelta }) {
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
      try { evt = JSON.parse(payload); } catch (e) { continue; }
      if (evt.type === "delta") onDelta(evt.text || "");
      else if (evt.type === "done" || evt.type === "error") finalTurn = evt.turn;
    }
  }
  return finalTurn;
}

function newSessionId() {
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  return id.replace(/[^a-z0-9]/gi, "");
}

const SESSION_KEY = "ais_session_id"; // 当前活动存档 id
const SAVES_KEY = "ais_saves";        // 存档注册表(按浏览器,无鉴权下保隐私:只看自己这台机的存档)

// 本地存档按账号隔离:登录后 key 带 user.id 后缀,换号/新号不会看到别人(或游客)在本机留下的存档。
// 游客沿用旧 key(向后兼容老存档)。登录态由 setSavesScope 在 auth 解析后设置。
let _savesScope = "";
function setSavesScope(uid) { _savesScope = uid ? ("_u_" + uid) : ""; }
function loadSaves() {
  try { return JSON.parse(localStorage.getItem(SAVES_KEY + _savesScope)) || []; } catch (e) { return []; }
}
function persistSaves(saves) {
  try { localStorage.setItem(SAVES_KEY + _savesScope, JSON.stringify(saves)); } catch (e) {}
}
function getActiveId() {
  try { return localStorage.getItem(SESSION_KEY + _savesScope) || ""; } catch (e) { return ""; }
}
function setActiveId(id) {
  try { localStorage.setItem(SESSION_KEY + _savesScope, id); } catch (e) {}
}

// 确保有一个活动存档 id;同一浏览器重开还是同一局(后端数据一直持久化)。
// 不再在此登记 0 回合占位存档:登记延迟到第一回合真正发生(StoryPanel 的 touchSave)——
// 新用户没玩过就不会看到「未命名存档 · 第 0 回合」和虚高的「进行中 N 局」。
function loadOrCreateSessionId() {
  let id = getActiveId();
  if (!id) { id = newSessionId(); setActiveId(id); }
  return id;
}



function touchSave(id, patch) {
  const saves = loadSaves();
  const i = saves.findIndex((s) => s.id === id);
  if (i < 0) { persistSaves([{ id, name: "", updated: "", turns: 0, summary: "", ...patch }, ...saves]); return; }
  saves[i] = { ...saves[i], ...patch };
  persistSaves(saves);
}



// 结构化续玩:把后端存的 data.turns 还原成完整卡片式 turns(玩家气泡 + 叙事 + 角色台词 + 选项 + token/判定)。
function restoreTurns(turns) {
  const out = [];
  for (const t of turns || []) {
    if (t.player_input) out.push({ kind: "player", text: t.player_input });
    out.push({ kind: "story", data: {
      narration: t.narration || "",
      messages: t.messages || [],
      choices: t.choices || [],
      triggered_events: t.triggered_events || [],
      reasoning: t.reasoning || {},
      usage: t.usage || {},
    } });
  }
  return out;
}

// 旧存档(没有结构化 turns)降级:把 messages 纯文本回填,剧情不还原卡片式分行。
function messagesToTurns(messages) {
  return (messages || [])
    .filter((m) => m && m.content)
    .map((m) =>
      m.role === "user"
        ? { kind: "player", text: m.content }
        : { kind: "story", data: { narration: m.content, messages: [], choices: [], triggered_events: [] } }
    );
}



function CharacterEditor({ card, index, onChange, onClose }) {
  if (!card) return null;
  const data = card.data || {};
  const update = (field, value) => {
    onChange(index, { ...card, data: { ...data, [field]: value } });
  };
  const rulesText = (data.speech_rules || []).join("\n");

  return (
    <section className="editor-panel">
      <div className="editor-head">
        <div>
          <h3>编辑角色卡</h3>
          <span>开始故事前可修改,实际生成会使用这里的内容。</span>
        </div>
        <button onClick={onClose}>收起</button>
      </div>
      {/* 基础 */}
      <label>
        名字
        <input value={data.name || ""} onChange={(e) => update("name", e.target.value)} />
      </label>
      <label>
        角色 ID
        <input value={data.character_id || ""} onChange={(e) => update("character_id", e.target.value)} placeholder="可选,留空会按名字生成" />
      </label>
      <label>
        标签,用逗号分隔
        <input
          value={(data.tags || []).join(", ")}
          onChange={(e) => update("tags", e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean))}
        />
      </label>

      <div className="ed-section">引擎摘要<span>给引擎快速解析的核心,人也能一眼读懂</span></div>
      <label>
        一句话锚点(anchor)
        <textarea rows="2" value={data.anchor || ""} onChange={(e) => update("anchor", e.target.value)} placeholder="角色是谁、对玩家是什么、底色" />
      </label>
      <label>
        核心矛盾(tension)
        <textarea rows="2" value={data.tension || ""} onChange={(e) => update("tension", e.target.value)} placeholder="不该被抹平的内在张力" />
      </label>
      <label>
        外貌锚点(look)
        <textarea rows="2" value={data.look || ""} onChange={(e) => update("look", e.target.value)} placeholder="一句话视觉印象 + 标志特征" />
      </label>
      <label>
        召回关键词(keys),用逗号分隔
        <input value={(data.keys || []).join(", ")} onChange={(e) => update("keys", e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean))} placeholder="标志性专名,比 tags 更细" />
      </label>
      <label>
        说话规则(speech_rules),一行一条
        <textarea rows="5" value={rulesText} onChange={(e) => update("speech_rules", linesToList(e.target.value))} />
      </label>

      <div className="ed-section">正文</div>
      <label>
        身份 / 主设定(description)
        <textarea rows="5" value={data.description || ""} onChange={(e) => update("description", e.target.value)} />
      </label>
      <label>
        性格(personality)
        <textarea rows="4" value={data.personality || ""} onChange={(e) => update("personality", e.target.value)} />
      </label>
      <label>
        当前情境(scenario)
        <textarea rows="3" value={data.scenario || ""} onChange={(e) => update("scenario", e.target.value)} />
      </label>
      <label>
        开场白(first_mes)
        <textarea rows="3" value={data.first_mes || ""} onChange={(e) => update("first_mes", e.target.value)} />
      </label>
      <label>
        说话范例(mes_example)
        <textarea rows="3" value={data.mes_example || ""} onChange={(e) => update("mes_example", e.target.value)} />
      </label>

      <div className="ed-section">知识边界<span>hidden 注入给 AI 但披露前不说破</span></div>
      <label>
        公开可知(known_public),一行一条
        <textarea rows="3" value={listToLines(data.known_public)} onChange={(e) => update("known_public", linesToList(e.target.value))} />
      </label>
      <label>
        隐藏真相(known_hidden),一行一条
        <textarea rows="3" value={listToLines(data.known_hidden)} onChange={(e) => update("known_hidden", linesToList(e.target.value))} />
      </label>

      <div className="ed-section">版本人格 / 状态轴</div>
      <label>
        版本人格(versions),一行一条 · 揭穿后覆盖
        <textarea rows="3" value={listToLines(data.versions)} onChange={(e) => update("versions", linesToList(e.target.value))} />
      </label>

      <div className="ed-section">满配段<span>主要NPC 默认完整;没内容留空即可 · 引擎接 model 后自动生效</span></div>
      <label>存活与死亡(survival)<textarea rows="2" value={data.survival || ""} onChange={(e) => update("survival", e.target.value)} placeholder="默认可死、死后下线;特殊:可复活 / 冥界可见 / 记忆态…" /></label>
      <label>核心事迹(deeds)<textarea rows="3" value={data.deeds || ""} onChange={(e) => update("deeds", e.target.value)} placeholder="驱动剧情 / 解释人格的关键往事,几条" /></label>
      <label>能力 / 机制(ability)<textarea rows="3" value={data.ability || ""} onChange={(e) => update("ability", e.target.value)} placeholder="能力怎么运作:触发条件 / 代价 / 冷却 / 失败反噬" /></label>
      <label>关键道具(items)<textarea rows="2" value={data.items || ""} onChange={(e) => update("items", e.target.value)} placeholder="专属物件:外观 + 规则作用 + 来历 + 失去后果" /></label>
      <label>结局 / 命运倾向(fate)<textarea rows="2" value={data.fate || ""} onChange={(e) => update("fate", e.target.value)} placeholder="大概率去向 / 牺牲倾向;只给倾向,不锁画面" /></label>
      <label>说话方式细则 + 例句(speech_detail)<textarea rows="3" value={data.speech_detail || ""} onChange={(e) => update("speech_detail", e.target.value)} placeholder="speech_rules 的展开:句式 / 用词 / 标志台词 + 例句" /></label>
      <label>人际关系(relations)<textarea rows="3" value={data.relations || ""} onChange={(e) => update("relations", e.target.value)} placeholder="每个关系人:态度 + 一句角色化表达(写起点)" /></label>
      <label>情绪雷区 / 触发点(triggers)<textarea rows="2" value={data.triggers || ""} onChange={(e) => update("triggers", e.target.value)} placeholder="创伤 / 禁区:内核 + 触发条件 + 触发后行为 + 能否安抚" /></label>
      <label>前史(backstory)<textarea rows="2" value={data.backstory || ""} onChange={(e) => update("backstory", e.target.value)} placeholder="开局之前已定、玩家改不了的出身与经历" /></label>
      <label>快速扮演规则卡(quick_rules)<textarea rows="2" value={data.quick_rules || ""} onChange={(e) => update("quick_rules", e.target.value)} placeholder="必须像 / 不能像 / 一句话锚点" /></label>
      <label>彩蛋触发(easter_eggs)<textarea rows="2" value={data.easter_eggs || ""} onChange={(e) => update("easter_eggs", e.target.value)} placeholder="触发词 → 反应 / 台词" /></label>
    </section>
  );
}

function linesToList(text) {
  return text.split("\n");
}

function listToLines(list) {
  return (list || []).join("\n");
}


function PlayerEditor({ player, onChange, onClose }) {
  if (!player) return null;
  const update = (field, value) => onChange({ ...player, [field]: value });
  return (
    <section className="editor-panel">
      <div className="editor-head">
        <div><h3>编辑演出卡</h3><span>玩家身份和开局信息会进入故事状态。</span></div>
        <button onClick={onClose}>收起</button>
      </div>
      <label>名字<input value={player.name || ""} onChange={(e) => update("name", e.target.value)} /></label>
      <label>身份<input value={player.role || ""} onChange={(e) => update("role", e.target.value)} /></label>
      <label>背景<textarea rows="4" value={player.background || ""} onChange={(e) => update("background", e.target.value)} /></label>
      <label>目标,一行一条<textarea rows="4" value={listToLines(player.goals)} onChange={(e) => update("goals", linesToList(e.target.value))} /></label>
      <label>能力/资源,一行一条<textarea rows="4" value={listToLines(player.abilities)} onChange={(e) => update("abilities", linesToList(e.target.value))} /></label>
      <label>限制/禁忌,一行一条<textarea rows="4" value={listToLines(player.constraints)} onChange={(e) => update("constraints", linesToList(e.target.value))} /></label>
      <label>开局已知事实,一行一条<textarea rows="4" value={listToLines(player.known_facts)} onChange={(e) => update("known_facts", linesToList(e.target.value))} /></label>
    </section>
  );
}

function WorldEditor({ world, index, onChange, onClose }) {
  if (!world) return null;
  const update = (field, value) => onChange(index, { ...world, [field]: value });
  const updateEntry = (entryIndex, field, value) => {
    const entries = (world.entries || []).map((entry, i) =>
      i === entryIndex ? { ...entry, [field]: value } : entry
    );
    update("entries", entries);
  };
  const addEntry = () => update("entries", [...(world.entries || []), { keys: [], content: "", comment: "新条目", source: "world", visibility: "public" }]);
  const removeEntry = (i) => update("entries", (world.entries || []).filter((_, j) => j !== i));
  return (
    <section className="editor-panel wide-editor">
      <div className="editor-head">
        <div><h3>编辑世界书 / 设定卡</h3><span>「可见性」选 hidden = 注入给 AI 但默认不说破(藏给玩家)。对话创作可能没存上 hidden,在这里手动设。</span></div>
        <button onClick={onClose}>收起</button>
      </div>
      <label>名称<input value={world.name || ""} onChange={(e) => update("name", e.target.value)} /></label>
      <div className="entry-editor-list">
        {(world.entries || []).map((entry, i) => (
          <details className="entry-editor" key={i}>
            <summary>{entry.comment || entry.keys?.join(" / ") || `条目 ${i + 1}`}</summary>
            <label>标题 / 备注<input value={entry.comment || ""} onChange={(e) => updateEntry(i, "comment", e.target.value)} /></label>
            <label>触发关键词,用逗号分隔
              <input value={(entry.keys || []).join(", ")} onChange={(e) => updateEntry(i, "keys", e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean))} />
            </label>
            <label>来源
              <input value={entry.source || "world"} onChange={(e) => updateEntry(i, "source", e.target.value)} />
            </label>
            <label>可见性
              <select value={entry.visibility || "public"} onChange={(e) => updateEntry(i, "visibility", e.target.value)}>
                <option value="public">public(玩家可知)</option>
                <option value="hidden">hidden(藏 · 默认不说破)</option>
                <option value="character_only">character_only</option>
              </select>
            </label>
            <label>内容<textarea rows="5" value={entry.content || ""} onChange={(e) => updateEntry(i, "content", e.target.value)} /></label>
            <button type="button" className="row-del" onClick={() => removeEntry(i)}>删除此条目</button>
          </details>
        ))}
        {!(world.entries || []).length && <p className="hint-line">还没条目。点下面「+ 加条目」。</p>}
      </div>
      <button type="button" onClick={addEntry}>+ 加条目</button>
    </section>
  );
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function StoryEditor({ story, onChange, onClose }) {
  if (!story) return null;
  const update = (field, value) => onChange({ ...story, [field]: value });
  const updateEvent = (eventIndex, field, value) => {
    const events = (story.events || []).map((event, i) =>
      i === eventIndex ? { ...event, [field]: value } : event
    );
    update("events", events);
  };
  const updateEnding = (idx, field, value) =>
    update("endings", (story.endings || []).map((e, i) => (i === idx ? { ...e, [field]: value } : e)));
  const addEnding = () =>
    update("endings", [...(story.endings || []), { ending_id: "", title: "", summary: "", conditions: [], tone: "" }]);
  const removeEnding = (idx) => update("endings", (story.endings || []).filter((_, i) => i !== idx));
  const updateBound = (idx, field, value) =>
    update("character_boundaries", (story.character_boundaries || []).map((b, i) => (i === idx ? { ...b, [field]: value } : b)));
  return (
    <section className="editor-panel wide-editor">
      <div className="editor-head">
        <div><h3>编辑故事书</h3><span>时间线、主线和事件节点会决定触发式推进。</span></div>
        <button onClick={onClose}>收起</button>
      </div>
      <label>标题<input value={story.title || ""} onChange={(e) => update("title", e.target.value)} /></label>
      <label>故事前提<textarea rows="4" value={story.premise || ""} onChange={(e) => update("premise", e.target.value)} /></label>
      <label>时间线,一行一条<textarea rows="5" value={listToLines(story.timeline)} onChange={(e) => update("timeline", linesToList(e.target.value))} /></label>
      <label>主线阶段,一行一条<textarea rows="5" value={listToLines(story.main_plot)} onChange={(e) => update("main_plot", linesToList(e.target.value))} /></label>
      <label>自由度规则,一行一条<textarea rows="4" value={listToLines(story.freedom_rules)} onChange={(e) => update("freedom_rules", linesToList(e.target.value))} /></label>

      {(story.needs_confirm || []).length > 0 && (
        <div className="needs-confirm">
          <b>AI 推断,建议确认</b>
          <ul>{(story.needs_confirm || []).map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}

      <label>开局故事内时间(分钟,世界时钟起算)
        <input type="number" value={story.clock_start ?? 0} onChange={(e) => update("clock_start", numOrNull(e.target.value) ?? 0)} />
      </label>
      <label>全局节奏/时间提示,一行一条<textarea rows="3" value={listToLines(story.pacing)} onChange={(e) => update("pacing", linesToList(e.target.value))} /></label>

      <div className="editor-subhead"><h4>结局(多结局 + 触发条件)</h4><button type="button" onClick={addEnding}>+ 加结局</button></div>
      <div className="entry-editor-list">
        {(story.endings || []).map((ending, i) => (
          <details className="entry-editor" key={i}>
            <summary>{ending.title || `结局 ${i + 1}`}{ending.tone ? ` · ${ending.tone}` : ""}</summary>
            <label>结局 ID<input value={ending.ending_id || ""} onChange={(e) => updateEnding(i, "ending_id", e.target.value)} /></label>
            <label>标题<input value={ending.title || ""} onChange={(e) => updateEnding(i, "title", e.target.value)} /></label>
            <label>基调(好结局/悲剧/开放/隐藏)<input value={ending.tone || ""} onChange={(e) => updateEnding(i, "tone", e.target.value)} /></label>
            <label>梗概<textarea rows="3" value={ending.summary || ""} onChange={(e) => updateEnding(i, "summary", e.target.value)} /></label>
            <label>触发条件,一行一条<textarea rows="3" value={listToLines(ending.conditions)} onChange={(e) => updateEnding(i, "conditions", linesToList(e.target.value))} /></label>
            <button type="button" className="row-del" onClick={() => removeEnding(i)}>删除此结局</button>
          </details>
        ))}
        {!(story.endings || []).length && <p className="hint-line">暂无结局,点「+ 加结局」或重新识别故事书让 AI 补。</p>}
      </div>

      {(story.character_boundaries || []).length > 0 && (
        <>
          <div className="editor-subhead"><h4>角色信息边界(喂一致性防护)</h4></div>
          <div className="entry-editor-list">
            {(story.character_boundaries || []).map((b, i) => (
              <details className="entry-editor" key={i}>
                <summary>{b.character || `角色 ${i + 1}`}</summary>
                <label>角色<input value={b.character || ""} onChange={(e) => updateBound(i, "character", e.target.value)} /></label>
                <label>公开可知,一行一条<textarea rows="2" value={listToLines(b.public)} onChange={(e) => updateBound(i, "public", linesToList(e.target.value))} /></label>
                <label>隐藏(未披露不能说),一行一条<textarea rows="2" value={listToLines(b.hidden)} onChange={(e) => updateBound(i, "hidden", linesToList(e.target.value))} /></label>
                <label>硬上限(身份/实力/能力),一行一条<textarea rows="2" value={listToLines(b.hard_limits)} onChange={(e) => updateBound(i, "hard_limits", linesToList(e.target.value))} /></label>
              </details>
            ))}
          </div>
        </>
      )}

      <div className="editor-subhead"><h4>事件节点</h4></div>
      <div className="entry-editor-list">
        {(story.events || []).map((event, i) => (
          <details className="entry-editor" key={i}>
            <summary>{event.title || `事件 ${i + 1}`}</summary>
            <label>事件 ID<input value={event.event_id || ""} onChange={(e) => updateEvent(i, "event_id", e.target.value)} /></label>
            <label>标题<input value={event.title || ""} onChange={(e) => updateEvent(i, "title", e.target.value)} /></label>
            <label>摘要<textarea rows="4" value={event.summary || ""} onChange={(e) => updateEvent(i, "summary", e.target.value)} /></label>
            <label>触发关键词,用逗号分隔<input value={(event.trigger_keywords || []).join(", ")} onChange={(e) => updateEvent(i, "trigger_keywords", e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean))} /></label>
            <label>前置事件/披露条件,一行一条<textarea rows="3" value={listToLines(event.reveal_after)} onChange={(e) => updateEvent(i, "reveal_after", linesToList(e.target.value))} /></label>
            <label>地点<input value={event.location || ""} onChange={(e) => updateEvent(i, "location", e.target.value)} /></label>
            <label>相关角色,用逗号分隔<input value={(event.characters || []).join(", ")} onChange={(e) => updateEvent(i, "characters", e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean))} /></label>
            <label>玩家选项提示,一行一条<textarea rows="3" value={listToLines(event.choices_hint)} onChange={(e) => updateEvent(i, "choices_hint", linesToList(e.target.value))} /></label>
            <label>可能后果,一行一条<textarea rows="3" value={listToLines(event.consequences)} onChange={(e) => updateEvent(i, "consequences", linesToList(e.target.value))} /></label>
            <div className="event-clock-row">
              <label>到点恶化(故事分钟)<input type="number" placeholder="纯时间触发,留空=否" value={event.due_clock ?? ""} onChange={(e) => updateEvent(i, "due_clock", numOrNull(e.target.value))} /></label>
              <label>静默升级(故事分钟)<input type="number" placeholder="主线停滞触发,留空=否" value={event.escalate_after_idle ?? ""} onChange={(e) => updateEvent(i, "escalate_after_idle", numOrNull(e.target.value))} /></label>
              <label>烈度 1-5<input type="number" min="1" max="5" value={event.severity ?? 2} onChange={(e) => updateEvent(i, "severity", Math.max(1, Math.min(5, numOrNull(e.target.value) ?? 2)))} /></label>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function mergeWorldBooks(worldBooks) {
  if (!worldBooks.length) return null;
  return {
    name: "世界书合集",
    entries: worldBooks.flatMap((w, wi) =>
      (w.entries || []).map((e, ei) => ({
        ...e,
        entry_id: e.entry_id || `world-${wi}-${ei}`,
        source: e.source || "world",
      }))
    ),
  };
}

function wrapCard(data) {
  return {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: { ...data, speech_rules: data.speech_rules || [], tags: data.tags || [] },
  };
}

const KIND_META = {
  characters: { label: "角色卡", title: "角色卡草稿", ph: "说说这个角色……", canFinish: (d) => !!d.name },
  players: { label: "演出卡", title: "演出卡草稿", ph: "说说你要扮演的主角……", canFinish: (d) => !!d.name },
  worlds: { label: "设定卡", title: "设定卡草稿", ph: "说说这个世界 / 组织 / 设定……", canFinish: (d) => !!d.name },
  stories: { label: "故事卡", title: "故事书草稿", ph: "说说这个故事的前提、主线、结局……", canFinish: (d) => !!d.title },
};

function DraftPreview({ kind, draft }) {
  const d = draft || {};
  const Row = ({ k, v }) => <p><b>{k}</b>{v && String(v).trim() ? v : "—"}</p>;
  const ListBlock = ({ k, items, render }) => (
    <div className="draft-rules"><b>{k}{items ? `(${items.length})` : ""}</b>
      <ul>{(items || []).map((x, i) => <li key={i}>{render ? render(x) : x}</li>)}</ul></div>
  );
  return (
    <div className="builder-draft">
      <h4>{(KIND_META[kind] || {}).title || "草稿"}</h4>
      {kind === "characters" && <>
        <Row k="名字" v={d.name} />
        <div className="draft-sec">引擎摘要</div>
        <Row k="锚点" v={d.anchor} /><Row k="核心矛盾" v={d.tension} /><Row k="外貌" v={d.look} />
        <ListBlock k="召回关键词" items={d.keys} /><ListBlock k="说话规则" items={d.speech_rules} />
        <div className="draft-sec">正文</div>
        <Row k="主设定" v={d.description} /><Row k="性格" v={d.personality} />
        <Row k="情境" v={d.scenario} /><Row k="开场白" v={d.first_mes} /><Row k="说话范例" v={d.mes_example} />
        <div className="draft-sec">知识边界</div>
        <ListBlock k="公开" items={d.known_public} /><ListBlock k="隐藏" items={d.known_hidden} />
        <div className="draft-sec">版本人格</div>
        <ListBlock k="版本人格" items={d.versions} />
        <div className="draft-sec">满配段</div>
        <Row k="存活死亡" v={d.survival} /><Row k="核心事迹" v={d.deeds} /><Row k="能力机制" v={d.ability} />
        <Row k="关键道具" v={d.items} /><Row k="结局倾向" v={d.fate} /><Row k="说话细则" v={d.speech_detail} />
        <Row k="人际关系" v={d.relations} /><Row k="情绪雷区" v={d.triggers} /><Row k="前史" v={d.backstory} />
        <Row k="规则卡" v={d.quick_rules} /><Row k="彩蛋" v={d.easter_eggs} />
      </>}
      {kind === "players" && <>
        <Row k="名字" v={d.name} /><Row k="身份" v={d.role} /><Row k="背景" v={d.background} />
        <ListBlock k="目标" items={d.goals} /><ListBlock k="能力/资源" items={d.abilities} />
        <ListBlock k="限制" items={d.constraints} /><ListBlock k="开局已知" items={d.known_facts} />
        <ListBlock k="开局不知道" items={d.unknown} /><Row k="开局场景" v={d.opening} />
      </>}
      {kind === "worlds" && <>
        <Row k="名称" v={d.name} />
        <ListBlock k="条目" items={d.entries} render={(e) => <><b>{e.comment || (e.keys || []).join("/")}</b>:{(e.content || "").slice(0, 60)}</>} />
      </>}
      {kind === "stories" && <>
        <Row k="标题" v={d.title} /><Row k="前提" v={d.premise} />
        <ListBlock k="主线" items={d.main_plot} />
        <ListBlock k="事件" items={d.events} render={(e) => e.title || e.event_id} />
        {!(d.events || []).length && <p className="draft-hint">(对话不建事件,事件在「事件卡」步单独加)</p>}
        <ListBlock k="结局" items={d.endings} render={(e) => (e.title || "") + (e.tone ? ` · ${e.tone}` : "")} />
        {(d.needs_confirm || []).length > 0 && <div className="needs-confirm"><b>待确认</b><ul>{d.needs_confirm.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
      </>}
    </div>
  );
}

function CardBuilder({ kind = "characters", seed, initialDraft, onComplete, onClose }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState(initialDraft || null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const chatRef = useRef(null);

  const combineAsk = (out) => [out.reply, out.next_question].filter(Boolean).join("\n");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const out = await postJSON("/api/build_card", { kind, messages: [], draft: initialDraft || null, seed: seed || "" });
        if (!alive) return;
        setMessages([{ role: "assistant", content: combineAsk(out) }]);
        setDraft(out.draft);
        setDone(out.done);
      } catch (e) { if (alive) setError(e.message); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    setError("");
    try {
      const out = await postJSON("/api/build_card", { kind, messages: next, draft, seed: seed || "" });
      setMessages([...next, { role: "assistant", content: combineAsk(out) }]);
      setDraft(out.draft);
      setDone(out.done);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const d = draft || {};
  return (
    <section className="editor-panel card-builder">
      <div className="editor-head">
        <div><h3>对话创作 · {(KIND_META[kind] || {}).label || ""}</h3><span>不会写设定?聊着聊着卡就建好了。</span></div>
        <button onClick={onClose}>关闭</button>
      </div>
      <div className="builder-body">
        <div className="builder-chat" ref={chatRef}>
          {messages.map((m, i) => (
            <div className={"bmsg " + m.role} key={i}>{m.content}</div>
          ))}
          {loading && <div className="bmsg assistant pending">推演中…</div>}
        </div>
        <DraftPreview kind={kind} draft={d} />
      </div>
      {error && <div className="error">{error}</div>}
      <div className="builder-composer">
        <textarea rows="2" value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } }}
          placeholder={`${(KIND_META[kind] || {}).ph || "说说看……"}(Enter 发送,Shift+Enter 换行)`} />
        <div className="builder-actions">
          <button onClick={send} disabled={loading || !input.trim()}>发送</button>
          <button className={"finish " + (done ? "ready" : "")} onClick={() => onComplete(d)}
            disabled={!(KIND_META[kind] || KIND_META.characters).canFinish(d)}>
            完成{done ? "(已就绪)" : ""}
          </button>
        </div>
      </div>
    </section>
  );
}

function SetupPanel({ characters, setCharacters, worldBooks, setWorldBooks, story, setStory, player, setPlayer, mode, setMode, onStart, onSavePreset, onBack, playing }) {
  const [editing, setEditing] = useState(null);   // { kind, index } | null
  const [picker, setPicker] = useState(null);     // kind | null(正在从故事库导入)
  const [libItems, setLibItems] = useState([]);
  const [libLoading, setLibLoading] = useState(false);
  const [loading, setLoading] = useState("");      // 正在上传识别的 kind
  const [error, setError] = useState("");

  const LIB_KIND = { character: "characters", world: "worlds", story: "stories", player: "players" };

  function place(kind, data) {
    if (kind === "character") setCharacters((xs) => [...xs, data]);
    else if (kind === "world") setWorldBooks((xs) => [...xs, data]);
    else if (kind === "story") setStory(data);
    else if (kind === "player") setPlayer(data);
  }

  // 「添加」= 从故事库导入:展开该类故事库列表,选中即加入卡组。
  async function openPicker(kind) {
    setError("");
    if (picker === kind) { setPicker(null); return; }
    setPicker(kind); setLibLoading(true); setLibItems([]);
    try {
      const r = await fetch(`/api/library/${LIB_KIND[kind]}`);
      setLibItems(r.ok ? await r.json() : []);
    } catch (e) { setLibItems([]); }
    finally { setLibLoading(false); }
  }
  function importItem(kind, it) {
    place(kind, it.data);
    setPicker(null);
  }

  function removeCharacter(index) {
    setCharacters((xs) => xs.filter((_, i) => i !== index));
    setEditing((cur) => (cur && cur.kind === "character" && cur.index === index ? null : cur));
  }
  function updateCharacter(index, nextCard) { setCharacters((xs) => xs.map((c, i) => (i === index ? nextCard : c))); }
  function removeWorld(index) {
    setWorldBooks((xs) => xs.filter((_, i) => i !== index));
    setEditing((cur) => (cur && cur.kind === "world" && cur.index === index ? null : cur));
  }
  function updateWorld(index, nextWorld) { setWorldBooks((xs) => xs.map((w, i) => (i === index ? nextWorld : w))); }

  const isEditing = (kind, index) => editing && editing.kind === kind && editing.index === index;
  function toggleEdit(kind, index) { isEditing(kind, index) ? closeEdit() : setEditing({ kind, index }); }
  function closeEdit() {
    if (editing) {
      const { kind, index } = editing;
      if (kind === "character") { const c = characters[index]; if (c) saveToVault("characters", c); }
      else if (kind === "world") { const w = worldBooks[index]; if (w) saveToVault("worlds", w); }
      else if (kind === "story") { if (story) saveToVault("stories", story); }
      else if (kind === "player") { if (player) saveToVault("players", player); }
    }
    setEditing(null);
  }

  function libLabel(kind, it) {
    if (kind === "character") return (it.data.data || {}).name || it.name;
    if (kind === "story") return it.data.title || it.name;
    return it.data.name || it.name;
  }

  // 卡组栏只从故事库导入([+ 添加])。本地文件上传已移到「创作」页(自动识别归类),卡组栏不再上传。
  const renderActions = (kind, disabled) => (
    <>
      <div className="card-actions">
        <button onClick={() => openPicker(kind)} disabled={disabled}>{picker === kind ? "收起故事库" : "+ 添加(故事库)"}</button>
      </div>
      {picker === kind && (
        <div className="lib-picker">
          {libLoading ? <p className="empty">读取故事库…</p>
            : !libItems.length ? <p className="empty">故事库这一类还是空的</p>
            : libItems.map((it, i) => (
              <button key={i} className="lib-pick-item" onClick={() => importItem(kind, it)}><b>{libLabel(kind, it)}</b></button>
            ))}
        </div>
      )}
    </>
  );

  const worldEntryCount = worldBooks.reduce((n, w) => n + (w.entries || []).length, 0);

  return (
    <aside className="setup">
      {onBack && (
        <div className="setup-topbar">
          <button className="back-link" onClick={onBack}>← 故事列表</button>
          <span>新建故事</span>
        </div>
      )}

      <div className="upload-group">
        <div className="row-head"><h3>记忆模式</h3><span>{mode === "deep" ? "深度" : "标准"}</span></div>
        <div className="mode-pick">
          <button type="button" className={"mode-btn " + (mode === "standard" ? "selected" : "")} onClick={() => setMode("standard")}>
            标准<small>原文 + 滚动摘要,不加载向量模型,装好即玩</small>
          </button>
          <button type="button" className={"mode-btn " + (mode === "deep" ? "selected" : "")} onClick={() => setMode("deep")}>
            深度<small>长对话变长后自动加载向量模型,语义召回更早剧情</small>
          </button>
        </div>
      </div>

      <div className="upload-group">
        <div className="row-head"><h3>角色卡</h3><span>{characters.length ? `${characters.length} 张` : "至少 1 张"}</span></div>
        {renderActions("character", false)}
        <div className="mini-list">
          {characters.map((c, i) => (
            <React.Fragment key={i}>
              <div className={"mini-item " + (isEditing("character", i) ? "selected" : "")}>
                <b>{c.data.name}</b>
                <span>{(c.data.tags || []).slice(0, 3).join(" / ")}</span>
                <button onClick={() => toggleEdit("character", i)}>{isEditing("character", i) ? "收起" : "编辑"}</button>
                <button onClick={() => removeCharacter(i)}>移除</button>
              </div>
              {isEditing("character", i) && <CharacterEditor card={c} index={i} onChange={updateCharacter} onClose={closeEdit} />}
            </React.Fragment>
          ))}
          {!characters.length && <p className="mini-empty">还没有角色。「+ 添加」从故事库导入;要上传本地文件去「创作」页。</p>}
        </div>
      </div>

      <div className="upload-group">
        <div className="row-head"><h3>演出卡</h3><span>{player ? "已生成" : "可选"}</span></div>
        {renderActions("player", false)}
        {player && (
          <div className="mini-list">
            <div className={"mini-item " + (isEditing("player", 0) ? "selected" : "")}>
              <b>{player.name || "玩家"}</b>
              <span>{player.role || "演出卡"}</span>
              <button onClick={() => toggleEdit("player", 0)}>{isEditing("player", 0) ? "收起" : "编辑"}</button>
              <button onClick={() => { setPlayer(null); setEditing((cur) => (cur && cur.kind === "player" ? null : cur)); }}>移除</button>
            </div>
            {isEditing("player", 0) && <PlayerEditor player={player} onChange={setPlayer} onClose={closeEdit} />}
          </div>
        )}
      </div>

      <div className="upload-group">
        <div className="row-head"><h3>世界书 / 设定卡</h3><span>{worldBooks.length ? `${worldBooks.length} 份 / ${worldEntryCount} 条` : "可选"}</span></div>
        {renderActions("world", false)}
        <div className="mini-list">
          {worldBooks.map((w, i) => (
            <React.Fragment key={i}>
              <div className={"mini-item " + (isEditing("world", i) ? "selected" : "")}>
                <b>{w.name || "设定卡"}</b>
                <span>{(w.entries || []).length} 条条目</span>
                <button onClick={() => toggleEdit("world", i)}>{isEditing("world", i) ? "收起" : "编辑"}</button>
                <button onClick={() => removeWorld(i)}>移除</button>
              </div>
              {isEditing("world", i) && <WorldEditor world={w} index={i} onChange={updateWorld} onClose={closeEdit} />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="upload-group">
        <div className="row-head"><h3>故事书</h3><span>{story ? (story.events || []).length + " 事件" : "建议加"}</span></div>
        {renderActions("story", false)}
        {story && (
          <div className="mini-list">
            <div className={"mini-item " + (isEditing("story", 0) ? "selected" : "")}>
              <b>{story.title || "故事书"}</b>
              <span>{(story.events || []).length} 个事件节点</span>
              <button onClick={() => toggleEdit("story", 0)}>{isEditing("story", 0) ? "收起" : "编辑"}</button>
              <button onClick={() => { setStory(null); setEditing((cur) => (cur && cur.kind === "story" ? null : cur)); }}>移除</button>
            </div>
            {isEditing("story", 0) && <StoryEditor story={story} onChange={setStory} onClose={closeEdit} />}
          </div>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {!playing && (
        <button className="primary start" onClick={onStart} disabled={!characters.length || loading}>启动 v2 故事</button>
      )}
      {onSavePreset && (
        <button className="ghost start" onClick={onSavePreset} disabled={!characters.length}>保存为故事预设</button>
      )}
    </aside>
  );
}

// 把一条台词按中文双引号 “…” 拆段:引号内的对白各自单独成行,引号外的动作描写也成行。
function splitSpeech(text) {
  const t = text || "";
  const parts = [];
  const re = /[“”][^“”]*[“”]/g;  // 一对 “…”
  let last = 0, m;
  while ((m = re.exec(t)) !== null) {
    const between = t.slice(last, m.index).trim();
    if (between) parts.push({ q: false, s: between });
    parts.push({ q: true, s: m[0].trim() });
    last = re.lastIndex;
  }
  const tail = t.slice(last).trim();
  if (tail) parts.push({ q: false, s: tail });
  return parts.length ? parts : [{ q: false, s: t }];
}

function SpeechText({ text }) {
  const segs = splitSpeech(text);
  return (
    <div className="speech">
      {segs.map((seg, k) => <p key={k} className={"seg" + (seg.q ? " quote" : "")}>{seg.s}</p>)}
    </div>
  );
}

function StoryPanel({ characters, world, story, player, mode, sessionId, initialTurns, initialState, initialChoices, goHome, onTurn, skin, coverArt, mobile, onNav }) {
  const [turns, setTurns] = useState(initialTurns || []);
  const [input, setInput] = useState("");
  const [choices, setChoices] = useState(initialChoices || []);
  const [state, setState] = useState(initialState || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [streaming, setStreaming] = useState(null); // 流式中实时显示的叙事 + 角色台词 {narration, messages}
  const inputRef = useRef(null);
  // 实时轮询用:在 setInterval 里读最新值,避免 effect 反复重建。
  const loadingRef = useRef(false); loadingRef.current = loading;
  const streamingRef = useRef(null); streamingRef.current = streaming;
  const turnsRef = useRef(turns); turnsRef.current = turns;
  const feedRef = useRef(null);
  const [showToBottom, setShowToBottom] = useState(false);
  function onFeedScroll() {
    const el = feedRef.current; if (!el) return;
    setShowToBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 120);  // 离底超过 ~120px 才显示「回到底部」
  }
  function scrollToBottom() {
    const el = feedRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }
  // 新回合/流式到达时:若用户本来就在底部(没显示按钮)就跟随到底;若往上翻了则不打扰。
  useEffect(() => {
    if (!showToBottom) { const el = feedRef.current; if (el) el.scrollTop = el.scrollHeight; }
  }, [turns, streaming]);

  const hasStoryTurn = turns.some((t) => t.kind === "story");

  // 实时弹出:运营者「立即生效」或任何 server 端出的新回合,玩家界面每 ~3.5s 自己冒出来(不必刷新)。
  // 玩家自己在出回合时(loading/streaming)不轮询,防与 runTurn 的本地追加竞态。只追加"故事"回合,
  // 跳过 server 那条中性触发的 player_input(避免冒出一个像玩家自己说的假气泡)。
  useEffect(() => {
    if (!sessionId) return undefined;
    let alive = true;
    const tick = async () => {
      if (loadingRef.current || streamingRef.current) return;
      const have = turnsRef.current.filter((t) => t.kind === "story").length;
      try {
        const r = await fetch(`/api/session/${encodeURIComponent(sessionId)}/tail?after=${have}`);
        if (!alive || !r.ok) return;
        const d = await r.json();
        const nt = d.new_turns || [];
        if (!nt.length || loadingRef.current || streamingRef.current) return;  // 期间玩家可能动了,再判一次
        setTurns((xs) => [...xs, ...nt.map((rec) => ({ kind: "story", data: {
          narration: rec.narration || "", messages: rec.messages || [], choices: rec.choices || [],
        } }))]);
        const last = nt[nt.length - 1];
        if (last.choices && last.choices.length) setChoices(last.choices);
        if (d.state) setState(d.state);
      } catch (e) { /* 轮询失败静默,不打扰玩家 */ }
    };
    const id = setInterval(tick, 3500);
    return () => { alive = false; clearInterval(id); };
  }, [sessionId]);

  // 每轮后更新存档注册表(存档列表显示轮数 / 最近游玩时间 / 标题)。
  useEffect(() => {
    const storyCount = turns.filter((t) => t.kind === "story").length;
    if (!storyCount) return;
    const label = (story && story.title) || (characters[0] && characters[0].data && characters[0].data.name) || "未命名";
    touchSave(sessionId, {
      turns: storyCount,
      updated: new Date().toLocaleString("zh-CN", { hour12: false }),
      summary: label,
    });
  }, [turns, sessionId]);

  // 切走会卸载本组件、丢失内部 turns;App 的 restore effect 只在 sessionId 变时跑,
  // 「切 tab 回当前故事」和「续玩当前这一局」都不触发 → 会显示空。挂载时兜底:
  // 本地没有 turns 就按 sessionId 拉后端补水(全新局后端也空,保持空;App 已还原过则跳过不重复拉)。
  const [hydrated, setHydrated] = useState(() => !!(initialTurns && initialTurns.length));
  useEffect(() => {
    if (initialTurns && initialTurns.length) return undefined;
    let alive = true;
    fetch(`/api/session/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        const structured = (data && data.turns) || [];
        const msgs = (data && data.messages) || [];
        if (structured.length || msgs.length) {
          setTurns(structured.length ? restoreTurns(structured) : messagesToTurns(msgs));
          setChoices(structured.length ? (structured[structured.length - 1].choices || []) : []);
          setState((data && data.state) || null);
          setCanUndo(true);   // 续玩局:最后一轮的快照持久在服务端,可撤
        }
        setHydrated(true);   // 后端也空(全新局没玩过)→ 保持空,但补水已完成
      })
      .catch(() => { if (alive) setHydrated(true); });
    return () => { alive = false; };
  }, [sessionId]);

  // 涟漪入局后自动开场:全新一局(补水完成仍无任何回合)自动生成开场——
  // 故事先演给玩家看,新手不再对着静态简介发愣。只触发一次,续玩/已有回合不触发。
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (skin !== "recon" || !hydrated || autoOpenedRef.current) return;
    if (turns.length || loading) return;
    autoOpenedRef.current = true;
    runTurn();
  }, [hydrated, turns.length, loading]);

  async function runTurn({ text = "", choice = "" } = {}) {
    if (loading) return;
    const action = text.trim();
    if (!action && !choice && turns.length > 0) return;
    setLoading(true);
    setError("");
    if (action || choice) {
      setTurns((xs) => [...xs, { kind: "player", text: action || choice }]);
    }
    setInput("");
    setStreaming(null);
    setChoices([]);  // 生成中清掉上一轮的旧选项,避免"还挂着像能点"
    const body = { characters, world, story, player, mode, session_id: sessionId, user: action, selected_choice: choice };
    try {
      let raw = "";
      let finalTurn = null;
      try {
        // 优先流式:叙事逐字蹦出来,治"干等十几秒"的感知延迟。
        finalTurn = await streamTurn(body, {
          onDelta: (t) => { raw += t; setStreaming(extractStream(raw)); },
        });
      } catch (streamErr) {
        // 流式不可用(老浏览器/代理缓冲等)→ 降级非流式端点,逻辑一致只是没有逐字。
        finalTurn = await postJSON("/api/story_turn", body);
      }
      if (!finalTurn) throw new Error("没有拿到回合结果");
      setStreaming(null);
      setTurns((xs) => [...xs, { kind: "story", data: finalTurn }]);
      setChoices(finalTurn.choices || []);
      setState(finalTurn.state || null);
      setCanUndo(true);   // 新回合落地 → 服务端已写好它的 pre-turn 快照
      if (onTurn) onTurn();
    } catch (e) {
      setStreaming(null);
      const fallback = {
        narration: "这一轮没有从后端拿到完整回应。当前输入已经留在故事记录里,你可以换一种说法继续,或先整理现场。",
        messages: [{
          character_id: "system",
          name: "系统旁白",
          text: "连接或生成过程短暂中断。为了不中断游玩,这里先给出保底回合。",
        }],
        choices: [
          { id: "retry", label: action || "重新整理当前场景", intent: "observe", description: "再次提交前可修改" },
          { id: "clarify", label: "换一种说法继续", intent: "custom", description: "适合口语输入" },
          { id: "observe", label: "观察现场反应", intent: "observe", description: "回到当前场景" },
        ],
        triggered_events: [],
        state,
      };
      setTurns((xs) => [...xs, { kind: "story", data: fallback }]);
      setChoices(fallback.choices);
      setError("本轮使用了本地保底回应: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  function stageChoice(choice) {
    setInput(choice.label || "");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // 撤回上一轮:恢复服务端 pre-turn 快照(与 reroll 同一套镜像,零 LLM 调用),
  // 本地同步裁掉最后一条剧情和它的玩家气泡,被撤回的输入回填输入框供修改。
  // 快照只有一层(镜像不含 _reroll 防嵌套)→ 撤完要等新回合产生才能再撤(canUndo 管这件事)。
  const [canUndo, setCanUndo] = useState(() => !!(initialTurns && initialTurns.length));
  async function undoLast() {
    if (loading || !canUndo) return;
    setLoading(true);
    setError("");
    try {
      const out = await postJSON("/api/undo_last", { session_id: sessionId });
      setTurns((xs) => {
        const ys = [...xs];
        for (let i = ys.length - 1; i >= 0; i--) {
          if (ys[i].kind === "story") {
            ys.splice(i, 1);
            if (i > 0 && ys[i - 1] && ys[i - 1].kind === "player") ys.splice(i - 1, 1);
            break;
          }
        }
        return ys;
      });
      setChoices((out.last_turn && out.last_turn.choices) || []);
      setState(out.state || null);
      setStreaming(null);
      setInput(out.undone_input || "");
      setCanUndo(false);
      if (onTurn) onTurn();
    } catch (e) {
      setError("撤回失败: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  // 对上一回合不满意:回滚副作用 + 用相同输入重新生成,只替换最后一条剧情(玩家行动保持不变)。
  async function rerollLast() {
    if (loading) return;
    let idx = -1;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].kind === "story") { idx = i; break; }
    }
    if (idx === -1) return;
    setLoading(true);
    setError("");
    setChoices([]);  // 重生成期间清掉旧选项
    try {
      const out = await postJSON("/api/reroll", { session_id: sessionId });
      setTurns((xs) => xs.map((t, i) => (i === idx ? { kind: "story", data: out } : t)));
      setChoices(out.choices || []);
      setState(out.state || null);
      setCanUndo(true);   // 重生成 = 新回合落盘,快照随之更新
      if (onTurn) onTurn();
    } catch (e) {
      setError("重新生成失败: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  // recon 皮:把同一套引擎状态喂进 ReconPlay 的 1:1 版式(引擎逻辑零改动,只换呈现)。
  if (skin === "recon") {
    const storyTurns = turns.filter((t) => t.kind === "story");
    const last = (streaming && (streaming.narration || (streaming.messages && streaming.messages.length)))
      ? streaming
      : (storyTurns.length ? storyTurns[storyTurns.length - 1].data : null);
    const dlg = last && last.messages && last.messages.length
      ? last.messages.map((m) => ({ name: m.name || m.character_id || "?", text: m.text })) : null;
    const pname = (player && (player.name || (player.data && player.data.name))) || "玩家";
    const sc = (state && state.scene) || {};
    const lastSolid = storyTurns.length ? storyTurns[storyTurns.length - 1].data : null;
    const evs = lastSolid && lastSolid.triggered_events && lastSolid.triggered_events.length ? lastSolid.triggered_events : null;
    const PlayC = (mobile && window.MPlay) ? window.MPlay : window.ReconPlay;
    return (
      <PlayC
        onNav={onNav}
        story={(story && story.title) || "未命名故事"}
        worldTime={"第 " + storyTurns.length + " 回合"}
        round={"ROUND " + String(storyTurns.length + (loading ? 1 : 0)).padStart(2, "0")}
        sceneTitle={sc.location || (story && story.title) || "本回合"}
        sceneSub={sc.ambience || sc.mood || ""}
        narration={last ? (last.narration || "") : ((story && story.premise) || "故事即将开始——说出你的第一句话，或点「执行」生成开场。")}
        dialogues={dlg}
        choices={choices}
        present={sc.present_characters && sc.present_characters.length ? sc.present_characters : null}
        events={evs}
        sceneArt={coverArt || ""}
        value={input}
        onChange={setInput}
        onSubmit={() => runTurn({ text: input })}
        onChoice={(c) => runTurn({ choice: c.label || c.title })}
        onReroll={rerollLast}
        canReroll={storyTurns.length > 0}
        onUndo={undoLast}
        canUndo={canUndo}
        history={turns}
        busy={loading}
        playerName={pname}
      />
    );
  }

  return (
    <section className="story-shell">
      <div className="story-top">
        <div>
          <h2>{goHome && <button className="back-link" onClick={goHome} title="回到故事列表(本局已自动存档)">← 故事列表</button>}故事回合</h2>
          <p>多角色、世界书、故事书、演出卡、状态和记忆会共同参与生成。</p>
        </div>
        <div className="top-actions">
          {hasStoryTurn && (
            <button className="reroll" onClick={rerollLast} disabled={loading}
              title="对上一回合不满意时,丢弃它并用相同输入重新生成">
              {loading ? "重新生成中..." : "↻ 重生成上一轮"}
            </button>
          )}
          <button data-coach="gen-opening" onClick={() => runTurn()} disabled={loading || turns.length > 0}>
            {loading && !turns.length ? "开场中..." : "生成开场"}
          </button>
        </div>
      </div>

      <div className="story-feed" ref={feedRef} onScroll={onFeedScroll}>
        {!turns.length && !loading && <div className="empty">点击“生成开场”，从场景而不是纯聊天开始。</div>}
        {turns.map((turn, i) => {
          if (turn.kind === "player") return <div className="player-action" key={i}>{turn.text}</div>;
          const data = turn.data;
          return (
            <article className="story-turn" key={i}>
              {data.narration && <p className="narration">{data.narration}</p>}
              {(data.messages || []).map((m, j) => (
                <div className="line" key={j}>
                  <b>{m.name || m.character_id}</b>
                  <SpeechText text={m.text} />
                </div>
              ))}
              {(data.triggered_events || []).length > 0 && (
                <div className="triggered">触发事件: {data.triggered_events.join(", ")}</div>
              )}
              {data.usage && data.usage.total_tokens ? (
                <div className="usage">
                  token · 输入 {data.usage.prompt_tokens} · 输出 {data.usage.completion_tokens} · 合计 {data.usage.total_tokens}
                  {data.usage.calls > 1 ? ` · ${data.usage.calls} 次调用` : ""}
                </div>
              ) : null}
            </article>
          );
        })}
        {streaming && (streaming.narration || streaming.messages.length > 0) && (
          <article className="story-turn streaming">
            {streaming.narration && <p className="narration">{streaming.narration}</p>}
            {streaming.messages.map((m, j) => (
              <div className="line" key={j}><b>{m.name || "…"}</b><SpeechText text={m.text} /></div>
            ))}
            <span className="caret">▋</span>
          </article>
        )}
        {loading && !(streaming && (streaming.narration || streaming.messages.length > 0)) && <div className="empty">故事引擎正在推演...</div>}
      </div>

      {showToBottom && <button className="to-bottom" onClick={scrollToBottom} title="回到最新">↓ 回到底部</button>}

      <div className="choice-bar">
        {choices.map((c) => (
          <button key={c.id} onClick={() => stageChoice(c)} disabled={loading}>
            <span>{c.label}</span>
            {c.description && <small>{c.description}</small>}
            <em>填入输入框</em>
          </button>
        ))}
      </div>

      <div className="composer" data-coach="composer">
        <textarea
          ref={inputRef}
          rows="2"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
              e.preventDefault();
              runTurn({ text: input });
            }
          }}
          placeholder="自由输入行动,或点击上方选项推进剧情。Shift+Enter 换行。" />
        <button onClick={() => runTurn({ text: input })} disabled={loading}>提交</button>
      </div>
      {error && <div className="error">{error}</div>}
    </section>
  );
}





async function saveToVault(kind, data) {
  try { await postJSON("/api/library/save", { kind, data }); return true; }
  catch (e) { return false; }
}


// 登录 / 注册页(AUTH_ENABLED 时未登录则全屏拦在此)。纯 JSX,无构建工具。
// 注册:邮箱 + 发送验证码 + 验证码 + 密码(可选用户名)。登录:邮箱/用户名 + 密码。
function LoginView({ onAuthed, onBack, initialTab }) {
  const [tab, setTab] = useState(initialTab === "register" ? "register" : "login"); // login | register,按入口预选
  const [resetMode, setResetMode] = useState(false);  // 登录 tab 下的「忘记密码」子模式
  const [identifier, setIdentifier] = useState("");   // 登录:邮箱或用户名
  const [email, setEmail] = useState("");             // 注册/重置:邮箱(主身份)
  const [username, setUsername] = useState("");       // 注册:可选登录名
  const [code, setCode] = useState("");               // 注册/重置:邮箱验证码
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");                   // 成功提示(重置完成后引导回登录)
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentHint, setSentHint] = useState("");       // 发码后的提示(含 dev_code)
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode() {
    if (sending || cooldown > 0) return;
    if (!email.trim() || email.indexOf("@") < 0) { setErr("先填邮箱"); return; }
    setSending(true); setErr(""); setSentHint("");
    try {
      const data = await authApi("/api/auth/email/send_code",
        { email: email.trim(), purpose: resetMode ? "reset" : "register" });
      setCooldown(60);
      setSentHint(data.dev_code ? `验证码已发(本地测试码:${data.dev_code})` : "验证码已发到邮箱,10 分钟内有效;没收到请翻翻垃圾邮件,60 秒后可重发");
    } catch (e) { setErr(e.message || "发送失败"); }
    finally { setSending(false); }
  }

  async function submit() {
    if (busy) return;
    setBusy(true); setErr(""); setOk("");
    try {
      if (resetMode) {
        await authApi("/api/auth/reset_password",
          { email: email.trim(), code: code.trim(), new_password: password });
        setResetMode(false); setPassword(""); setCode(""); setSentHint("");
        setIdentifier(email.trim());
        setOk("密码已重置,旧设备已全部下线——用新密码登录吧");
        return;
      }
      const data = tab === "login"
        ? await authApi("/api/auth/login", { identifier: identifier.trim(), password })
        : await authApi("/api/auth/register", {
            email: email.trim(), password, code: code.trim(),
            username: username.trim() || null,
          });
      onAuthed(data.user, data.token);
    } catch (e) { setErr(e.message || "失败"); }
    finally { setBusy(false); }
  }

  return (
    <div className="cv-login">
      <style>{`
        .cv-login {position:fixed; inset:0; z-index:60; display:grid; place-items:center;
          background:center/cover no-repeat url(assets/recon/title-pano.jpg), linear-gradient(160deg,#27324a,#161c28 60%,#0e1118);
          font-family:"Kaiti SC","STKaiti","KaiTi",serif;}
        .cv-login::before {content:""; position:absolute; inset:0; background:rgba(10,13,20,.45);}
        @keyframes rc-login-in { from { opacity:0; transform:translateY(18px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
        .cv-login .card {position:relative; width:min(430px, 92vw); background:linear-gradient(180deg,#f6efdd,#efe6cf);
          border:1px solid rgba(203,176,121,.7); padding:38px 42px 34px; box-shadow:0 24px 60px -20px rgba(0,0,0,.6);
          animation: rc-login-in .38s cubic-bezier(.22,1,.36,1) both;}
        @media (prefers-reduced-motion: reduce){ .cv-login .card{animation-duration:1ms;} }
        .cv-login .card::before {content:""; position:absolute; inset:5px; border:1px solid rgba(43,38,32,.14); pointer-events:none;}
        .cv-login h1 {margin:0; font-family:"Songti SC","STSong","SimSun",serif; font-size:24px; letter-spacing:.18em; font-weight:700; color:#2b2620; text-align:center;}
        .cv-login .sub {font-family:Georgia,serif; font-size:10px; letter-spacing:.3em; color:#a98a63; text-align:center; margin-top:7px;}
        .cv-login .tabs {display:flex; margin:24px 0 18px; border-bottom:1px solid #c4b388;}
        .cv-login .tabs button {flex:1; appearance:none; background:none; border:none; min-height:0; border-radius:0; padding:9px 0; cursor:pointer;
          font-family:"Songti SC","SimSun",serif; font-size:15px; letter-spacing:.22em; color:#9a907a; position:relative;}
        .cv-login .tabs button:hover:not(:disabled) {background:none; color:#2b2620;}
        .cv-login .tabs button.on {color:#2b2620; font-weight:700;}
        .cv-login .tabs button.on::after {content:""; position:absolute; left:24%; right:24%; bottom:-1px; height:2px; background:#34463d;}
        .cv-login input {width:100%; background:rgba(255,255,255,.5); border:1px solid #c4b388; border-radius:0; box-shadow:none;
          font-family:inherit; font-size:14px; color:#2b2620; padding:11px 13px; outline:none; margin-bottom:12px;}
        .cv-login input:focus {border-color:#34463d; box-shadow:none;}
        .cv-login .coderow {display:flex; gap:10px;}
        .cv-login .coderow input {flex:1;}
        .cv-login .coderow button {appearance:none; flex:none; min-height:0; border-radius:0; background:#163b57; color:#f3ead6; border:1px solid #0d2f49;
          font-family:"Songti SC","SimSun",serif; font-size:13px; letter-spacing:.08em; padding:0 16px; height:44px; cursor:pointer;}
        .cv-login .coderow button:hover:not(:disabled) {background:#0d2f49; color:#f3ead6;}
        .cv-login .coderow button:disabled {opacity:.5; cursor:default;}
        .cv-login .hint {font-size:12px; color:#34463d; margin:-4px 0 10px;}
        .cv-login .err {font-size:12.5px; color:#9a4a3a; margin:2px 0 10px;}
        .cv-login .go {width:100%; appearance:none; min-height:0; border-radius:0; height:50px; background:#34463d; color:#f3ead6; border:1px solid #283831;
          font-family:"Songti SC","SimSun",serif; font-size:16px; letter-spacing:.3em; cursor:pointer; position:relative; margin-top:6px;}
        .cv-login .go::before {content:""; position:absolute; inset:3px; border:1px solid rgba(193,168,111,.5); pointer-events:none;}
        .cv-login .go:hover:not(:disabled) {background:#2c3a32; color:#f3ead6;}
        .cv-login .go:disabled {opacity:.6;}
        .cv-login .back {position:absolute; left:42px; top:-34px; font-family:Georgia,serif; font-size:12px; letter-spacing:.2em; color:rgba(240,234,222,.75); cursor:pointer;}
        .cv-login .forgot {margin-top:14px; text-align:center; font-size:12.5px; color:#6f6757; cursor:pointer; letter-spacing:.06em;}
        .cv-login .forgot:hover {color:#2b2620; text-decoration:underline;}
      `}</style>
      <div className="card">
        {onBack && <span className="back" onClick={onBack}>‹ BACK</span>}
        <h1>叙事引擎</h1>
        <div className="sub">NARRATIVE ENGINE · SIGN IN</div>
        <div className="tabs">
          <button className={tab === "login" ? "on" : ""} onClick={() => { setTab("login"); setResetMode(false); setErr(""); setOk(""); }}>登录 · 回到故事</button>
          <button className={tab === "register" ? "on" : ""} onClick={() => { setTab("register"); setResetMode(false); setErr(""); setOk(""); }}>注册 · 初次到来</button>
        </div>
        {resetMode ? (
          <>
            <input type="email" placeholder="注册时用的邮箱" value={email}
                   onChange={(e) => setEmail(e.target.value)} />
            <div className="coderow">
              <input placeholder="邮箱验证码" value={code}
                     onChange={(e) => setCode(e.target.value)} />
              <button disabled={sending || cooldown > 0} onClick={sendCode}>
                {cooldown > 0 ? `${cooldown}s` : (sending ? "…" : "发送验证码")}
              </button>
            </div>
            {sentHint && <div className="hint">{sentHint}</div>}
          </>
        ) : tab === "login" ? (
          <input placeholder="邮箱或用户名" value={identifier}
                 onChange={(e) => setIdentifier(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !(e.nativeEvent || e).isComposing && submit()} />
        ) : (
          <>
            <input type="email" placeholder="邮箱(用来收验证码)" value={email}
                   onChange={(e) => setEmail(e.target.value)} />
            <div className="coderow">
              <input placeholder="邮箱验证码" value={code}
                     onChange={(e) => setCode(e.target.value)} />
              <button disabled={sending || cooldown > 0} onClick={sendCode}>
                {cooldown > 0 ? `${cooldown}s` : (sending ? "…" : "发送验证码")}
              </button>
            </div>
            {sentHint && <div className="hint">{sentHint}</div>}
            <input placeholder="用户名(可选,用于登录)" value={username}
                   onChange={(e) => setUsername(e.target.value)} />
          </>
        )}
        <input type="password" placeholder={resetMode ? "新密码(至少 6 位)" : "密码"} value={password}
               onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !(e.nativeEvent || e).isComposing && submit()} />
        {ok && <div className="hint">{ok}</div>}
        {err && <div className="err">{err}</div>}
        <button className="go" disabled={busy} onClick={submit}>
          {busy ? "…" : (resetMode ? "重置密码" : (tab === "login" ? "进入故事" : "注册并进入"))}
        </button>
        {tab === "login" && (
          <div className="forgot" onClick={() => { setResetMode(!resetMode); setErr(""); setOk(""); setSentHint(""); setCode(""); setPassword(""); }}>
            {resetMode ? "‹ 返回登录" : "忘记密码?"}
          </div>
        )}
      </div>
    </div>
  );
}

// 创作引导:按 template 子分档给 chips。选项折进 seed(best-effort 让 AI 按 template 走;不改后端 build_card)。
const BUILD_GUIDES = {
  character: [
    { key: "类别", opts: ["主要NPC", "次要NPC"] },
    { key: "档位", opts: ["轻量", "满配"] },
    { key: "隐藏", opts: ["无隐藏", "含隐藏真相"] },
  ],
  setting: [
    { key: "子类", opts: ["组织", "地点"] },
    { key: "档位", opts: ["轻量", "满配"] },
  ],
  worldsetting: [
    { key: "类型", opts: ["世界书", "设定卡·组织", "设定卡·地点"] },
    { key: "档位", opts: ["轻量", "满配"] },
  ],
};

function BuildOptions({ guide, opts, setOpts, onStart, onCancel }) {
  const groups = BUILD_GUIDES[guide] || [];
  return (
    <div className="build-options">
      <p className="build-pick-q">先定个调,AI 据此引导(都可改)</p>
      {groups.map((g) => (
        <div className="bo-group" key={g.key}>
          <span className="bo-label">{g.key}</span>
          <div className="bo-chips">
            {g.opts.map((o) => (
              <button key={o} className={"bo-chip " + ((opts[g.key] || g.opts[0]) === o ? "on" : "")}
                onClick={() => setOpts({ ...opts, [g.key]: o })}>{o}</button>
            ))}
          </div>
        </div>
      ))}
      <div className="bo-actions">
        <button className="primary" onClick={onStart}>开始对话创作</button>
        {onCancel && <button onClick={onCancel}>返回</button>}
      </div>
    </div>
  );
}

// 卡种 + 引导选项 → 给 build_card 的 seed(它会拼进系统提示;best-effort 让 AI 按 template 字段引导)。
function buildGuideSeed(pickId, opts) {
  const o = opts || {};
  if (pickId === "characters") {
    const tier = o["档位"] || "轻量", cat = o["类别"] || "主要NPC", hid = o["隐藏"] || "无隐藏";
    return `【创作要求 · 角色卡(${cat} · ${tier} · ${hid})】
按角色卡模板逐项引导我填,草稿请尽量产出这些字段:anchor 一句话锚点、tension 核心矛盾、look 外貌锚点、keys 召回关键词、speech_rules(自称/称呼玩家/句长节奏/高频句式/口头禅/禁用)、description 身份、personality 性格、first_mes 开场白、known_public 公开可知、known_hidden 隐藏真相(默认不说破)${tier === "满配" ? "、versions 版本人格/状态轴(含揭穿后覆盖)" : ""}。
${cat === "次要NPC" ? "次要NPC 从简:锚点 + speech_rules + 一句外形 + 知识边界即可,核心矛盾可省。" : ""}${hid === "含隐藏真相" ? "这个角色有隐藏真相:把真相写进 known_hidden,披露节奏挂故事书,不写进公开设定。" : ""}`;
  }
  if (pickId === "settings") {
    const sub = o["子类"] || "组织", tier = o["档位"] || "轻量";
    return `【创作要求 · 设定卡(${sub} · ${tier})→ 存为世界书条目】
这是一张设定卡(${sub}的中层完整设定)。按设定卡模板引导:一句话锚点、知识分层 public/hidden、口吻/禁区、召回关键词、概览、${sub === "地点" ? "场景气质/出入口/在场势力与现状" : "宗旨与信仰/结构与权力/关键人物/与其它势力关系"}、剧情钩子。产出为世界书条目:每条 keys + 内容(standalone),切成总览条 + 各分项条;hidden 的标可见性 hidden。`;
  }
  if (pickId === "players") {
    return `【创作要求 · 演出卡】
按演出卡模板引导,草稿请尽量产出:role 身份、background 背景、goals 目标、abilities 能力/资源、constraints 限制/禁忌、known_facts 开局已知、unknown 开局不知道(与 known_facts 配对,防上帝视角)、opening 开局场景/时间锚点。`;
  }
  if (pickId === "worldsetting") {
    const type = o["类型"] || "世界书", tier = o["档位"] || "轻量";
    if (type.indexOf("设定卡") === 0) {
      return buildGuideSeed("settings", { 子类: type.indexOf("地点") >= 0 ? "地点" : "组织", 档位: tier });
    }
    return `【创作要求 · 世界书(${tier})】
按世界书模板引导我把世界拆成关键词触发的条目。每条产出:keys 触发关键词(玩家真会说的词 + 标志专名)、content 内容(standalone 自足、一条一事)、可见性 public/hidden(hidden 注入但默认不说破)、来源 world/rule/location/figure/org。世界铁则设常驻、标硬canon。`;
  }
  return "";
}

// 已创作一览:从故事库读各大类;事件卡从故事书聚合(只读)。建完刷新,看得到自己建了哪些。
const BUILT_CATS = [
  { id: "characters", label: "角色卡" },
  { id: "players", label: "演出卡" },
  { id: "worlds", label: "世界书 / 设定卡" },
  { id: "stories", label: "故事书" },
  { id: "events", label: "事件卡" },
];

// 只显示「本次创作轮次」里建的卡(从当前卡组 assembly 读,不是故事库全量)。事件卡 = 本轮故事书里的事件。
// 每张卡可「查看/修改」(开编辑器)或「保存到故事库」(单独入库)。事件卡随故事书,不单列按钮。
function BuiltOverview({ characters = [], worldBooks = [], story = null, player = null, onView, onSave, savedKeys }) {
  const [open, setOpen] = useState("characters");
  const data = {
    characters: characters.map((c, i) => ({ name: (c.data || {}).name || "未命名", kind: "characters", index: i, data: c })),
    players: player ? [{ name: player.name || "主角", kind: "players", index: 0, data: player }] : [],
    worlds: worldBooks.map((w, i) => ({ name: w.name || "设定", desc: `${(w.entries || []).length} 条`, kind: "worlds", index: i, data: w })),
    stories: story ? [{ name: story.title || "故事书", desc: (story.premise || "").slice(0, 30), kind: "stories", index: 0, data: story }] : [],
    events: story ? (story.events || []).map((e) => ({ name: e.title || e.event_id || "事件", desc: e.hidden ? "隐藏" : "", kind: "events" })) : [],
  };
  const list = data[open] || [];
  const saved = savedKeys || new Set();
  return (
    <div className="built-overview" data-coach="build-overview">
      <div className="bov-head">本次新建里你已建的卡 · 查看/修改 或单独保存到故事库</div>
      <div className="bov-tabs">
        {BUILT_CATS.map((c) => (
          <button key={c.id} className={open === c.id ? "active" : ""} onClick={() => setOpen(c.id)}>
            {c.label}<span className="bov-count">{(data[c.id] || []).length}</span>
          </button>
        ))}
      </div>
      <div className="bov-list">
        {!list.length && <p className="empty">这一类这轮还没建。</p>}
        {list.map((it, i) => (
          <div className="bov-item" key={i}>
            <b>{it.name || "未命名"}</b>
            {it.desc && <span className="bov-desc">{it.desc}</span>}
            {it.kind !== "events" && (
              <span className="bov-btns">
                {!saved.has(it.kind + ":" + it.index) && <span className="bov-unsaved">未入库</span>}
                <button onClick={() => onView && onView(it.kind, it.index)}>查看/修改</button>
                <button className={saved.has(it.kind + ":" + it.index) ? "saved" : "primary"}
                  onClick={() => onSave && onSave(it.kind, it.index, it.data)}>
                  {saved.has(it.kind + ":" + it.index) ? "已存✓" : "保存到故事库"}
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BuildView({ buildSeed, clearSeed, addCharacter, addWorld, setStory, setPlayer, goGame }) {
  const seeded = !!buildSeed.draft; // 从故事库「对话完善」进来:固定角色卡
  const PICKS = [
    { id: "characters", label: "角色卡", desc: "NPC:可选 主要/次要、轻量/满配、含不含隐藏真相", buildKind: "characters", guide: "character" },
    { id: "players", label: "演出卡", desc: "你扮演谁:身份/目标/能力/限制/开局已知与不知", buildKind: "players" },
    { id: "worlds", label: "世界书", desc: "关键词触发的世界设定碎片条目", buildKind: "worlds" },
    { id: "settings", label: "设定卡", desc: "组织 / 地点的中层完整设定(走世界书引擎)", buildKind: "worlds", guide: "setting" },
    { id: "stories", label: "故事卡", desc: "前提/主线/事件/结局 → 故事书(事件卡建在这里)", buildKind: "stories" },
  ];
  const [pick, setPick] = useState(seeded ? PICKS[0] : null);
  const [opts, setOpts] = useState({});
  const [building, setBuilding] = useState(seeded);
  const [saved, setSaved] = useState(null); // {kind, data, name}
  const [nonce, setNonce] = useState(0);
  const [importing, setImporting] = useState(false); // 本地文件导入识别中
  const [importErr, setImportErr] = useState("");
  const [overviewKey, setOverviewKey] = useState(0); // 建完 +1 刷新「已创作一览」

  const kind = pick ? pick.buildKind : (seeded ? "characters" : null);
  const seed = seeded ? (buildSeed.seed || "") : (pick ? buildGuideSeed(pick.id, opts) : "");

  const nameOf = (k, data) =>
    k === "characters" ? (data.data || {}).name : k === "stories" ? data.title : data.name;

  function placeInGame(k, data) {
    if (k === "characters") addCharacter(data);
    else if (k === "worlds") addWorld(data);
    else if (k === "stories") setStory(data);
    else if (k === "players") setPlayer(data);
  }

  // 本地文件 → 统一识别归类(/api/identify_auto 已自动入库)→ 进「已建好」态,可一键用到游戏。
  async function importLocal(file) {
    if (!file) return;
    setImporting(true); setImportErr("");
    try {
      const text = await uploadFile(file);
      const out = await postJSON("/api/identify_auto", { text });
      const SING2PLU = { character: "characters", world: "worlds", story: "stories", player: "players" };
      const k = SING2PLU[out.kind] || "characters";
      setSaved({ kind: k, data: out.data, name: nameOf(k, out.data) || "未命名" });
      setOverviewKey((n) => n + 1);
    } catch (e) { setImportErr(e.message || "导入失败"); }
    finally { setImporting(false); }
  }

  async function onComplete(draft) {
    const data = kind === "characters" ? wrapCard(draft) : draft; // 角色卡包成 Card V2 信封,其余 data 即卡
    await saveToVault(kind, data);
    setSaved({ kind, data, name: nameOf(kind, data) || "未命名" });
    setOverviewKey((n) => n + 1);
  }
  function useInGame() { placeInGame(saved.kind, saved.data); goGame(); }
  function again() { setSaved(null); clearSeed(); setPick(seeded ? PICKS[0] : null); setOpts({}); setBuilding(seeded); setNonce((n) => n + 1); }
  function choosePick(p) { setPick(p); setOpts({}); if (!p.guide) setBuilding(true); } // 无引导:直接进对话

  return (
    <section className="view-shell build-view">
      <div className="view-head">
        <h2>对话创作</h2>
        <p>选一种卡(对齐卡片模板大类),和 AI 聊着把它建出来。{seeded ? "(正在完善已有角色卡)" : ""}完成后自动存进故事库,在下方「已建的卡」看得到。</p>
      </div>

      {!pick && !saved && (
        <div className="build-pick">
          <p className="build-pick-q">想建哪种卡?</p>
          <div className="build-pick-grid">
            {PICKS.map((p) => (
              <button key={p.id} onClick={() => choosePick(p)}><b>{p.label}</b><small>{p.desc}</small></button>
            ))}
          </div>
          <div className="build-import">
            <span className="build-import-or">或 · 已有写好的设定?</span>
            <label className={"upbtn " + (importing ? "disabled" : "")}>
              {importing ? "识别中…" : "↑ 上传本地文件(自动识别归类)"}
              <input type="file" accept=".txt,.md,.docx" style={{ display: "none" }} disabled={importing}
                onChange={async (e) => { const f = e.target.files[0]; e.target.value = ""; await importLocal(f); }} />
            </label>
            {importErr && <div className="error">{importErr}</div>}
          </div>
        </div>
      )}

      {pick && !building && !saved && pick.guide && (
        <BuildOptions guide={pick.guide} opts={opts} setOpts={setOpts}
          onStart={() => setBuilding(true)} onCancel={() => setPick(null)} />
      )}

      {pick && building && !saved && (
        <CardBuilder key={pick.id + nonce + (seeded ? "-edit" : "-new")} kind={kind}
          seed={seed} initialDraft={buildSeed.draft} onComplete={onComplete}
          onClose={() => { if (seeded) goGame(); else { setBuilding(false); setPick(null); } }} />
      )}

      {saved && (
        <div className="build-done">
          <p>已建好并存入故事库:<b>{saved.name}</b>(<span>{(KIND_META[saved.kind] || {}).label}</span>)</p>
          <div className="build-done-actions">
            <button className="primary" onClick={useInGame}>用到当前游戏</button>
            <button onClick={again}>再建一个</button>
            <button onClick={goGame}>回游戏</button>
          </div>
        </div>
      )}

      {/* BuiltOverview 属【多步建卡组流程 StepBuilder】的"本轮已建卡组一览"(它收 characters/worldBooks/
          story/player/onView/onSave)。单卡 BuildView 没有"本轮卡组"可展示,原调用传的 refreshKey/onUse
          组件根本不接 → 恒渲染空 + 按钮回调 undefined。移除以免误导;单卡产物已在故事库(VaultView)可见。 */}
    </section>
  );
}

function VaultView({ addCharacter, addWorld, setStory, setPlayer, completeCard, goGame, presets, onLaunchPreset, onDeletePreset, hideMyStories, embedded }) {
  // hideMyStories:嵌进「我的」页时,「我的故事(预设)」由外层单独成区,这里不重复;embedded:省掉自己的大标题。
  const KINDS = [["characters", "角色卡"], ["players", "演出卡"], ["worlds", "世界书 / 设定卡"], ["stories", "故事书"], ["events", "事件卡"]].concat(hideMyStories ? [] : [["mystories", "我的故事"]]);
  const [kind, setKind] = useState("characters");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // {origName, data} | null
  const [page, setPage] = useState(1);          // 当前页(每页 12 张)

  async function load(k) {
    if (k === "mystories") { setItems((presets || []).map((p) => ({ name: p.name, data: p.data || {}, _preset: true }))); return; }
    setLoading(true);
    try {
      if (k === "events") {
        // 事件卡随故事书:从故事库的故事里聚合出来(只读)。
        const r = await fetch(`/api/library/stories`);
        const stories = r.ok ? await r.json() : [];
        const evs = [];
        stories.forEach((s) => (s.data.events || []).forEach((e) =>
          evs.push({ name: e.title || e.event_id || "事件", data: e, _event: true, _story: s.data.title || s.name })));
        setItems(evs);
      } else {
        const r = await fetch(`/api/library/${k}`);
        setItems(r.ok ? await r.json() : []);
      }
    } catch (e) { setItems([]); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(kind); }, [kind, presets]);

  function cardName(item) {
    if (kind === "characters") return (item.data.data || {}).name;
    if (kind === "stories") return item.data.title;
    if (kind === "events" || kind === "mystories") return item.name;
    return item.data.name;
  }
  function cardDesc(item) {
    if (kind === "characters") return (item.data.data || {}).description;
    if (kind === "worlds") return `${(item.data.entries || []).length} 条条目`;
    if (kind === "stories") return item.data.premise || `${(item.data.events || []).length} 个事件`;
    if (kind === "events") return (item._story ? `属:${item._story}` : "") + (item.data.hidden ? " · 隐藏" : "");
    if (kind === "mystories") return item.data.synopsis || bundleSummary(item.data);
    return item.data.role || (item.data.goals || []).join(" / ");
  }
  function useInGame(item) {
    const d = item.data;
    if (kind === "characters") addCharacter(d);
    else if (kind === "worlds") addWorld(d);
    else if (kind === "stories") setStory(d);
    else setPlayer(d);
    goGame();
  }
  async function del(item) {
    if (!confirm("从故事库删除这张卡?不可恢复。")) return;
    try { await fetch(`/api/library/${kind}/${encodeURIComponent(item.name)}`, { method: "DELETE" }); } catch (e) {}
    load(kind);
  }

  function openEdit(item) {
    setEditing({ origName: item.name, data: JSON.parse(JSON.stringify(item.data)) });
  }
  async function saveEdit() {
    if (!editing) return;
    try {
      const res = await postJSON("/api/library/save", { kind, data: editing.data });
      // 改了名字 → 新文件名变了,删掉旧文件免得故事库里留俩
      if (res && res.name && res.name !== editing.origName) {
        try { await fetch(`/api/library/${kind}/${encodeURIComponent(editing.origName)}`, { method: "DELETE" }); } catch (e) {}
      }
    } catch (e) {}
    setEditing(null);
    load(kind);
  }
  function switchKind(k) { setEditing(null); setKind(k); setPage(1); }

  // 修改 = 单开一个编辑页(整页切过去),不在列表底部内联。改完「保存返回」存回故事库。
  if (editing) {
    const label = (KINDS.find(([k]) => k === kind) || [null, "卡"])[1];
    return (
      <section className={"vault-view" + (embedded ? "" : " view-shell")}>
        <div className="view-head vh-row">
          <div><h2>修改 · {label}</h2><p>改完点「保存返回」(编辑器里的「收起」同样存回)。</p></div>
          <button className="back-link" onClick={saveEdit}>← 保存返回</button>
        </div>
        <div className="vault-editor single-edit">
          {kind === "characters" && (
            <CharacterEditor card={editing.data} index={0}
              onChange={(_, next) => setEditing((e) => ({ ...e, data: next }))} onClose={saveEdit} />
          )}
          {kind === "worlds" && (
            <WorldEditor world={editing.data} index={0}
              onChange={(_, next) => setEditing((e) => ({ ...e, data: next }))} onClose={saveEdit} />
          )}
          {kind === "stories" && (
            <StoryEditor story={editing.data}
              onChange={(next) => setEditing((e) => ({ ...e, data: next }))} onClose={saveEdit} />
          )}
          {kind === "players" && (
            <PlayerEditor player={editing.data}
              onChange={(next) => setEditing((e) => ({ ...e, data: next }))} onClose={saveEdit} />
          )}
        </div>
      </section>
    );
  }

  const PER = 12;
  const totalPages = Math.max(1, Math.ceil(items.length / PER));
  const safePage = Math.min(page, totalPages);
  const pageItems = items.slice((safePage - 1) * PER, safePage * PER);

  return (
    <section className={"vault-view" + (embedded ? "" : " view-shell")}>
      {!embedded && (
        <div className="view-head">
          <h2>故事库</h2>
          <p>你建过 / 导入的卡和故事都在这里,按卡片分类管理。「我的故事」是你自己创作的完整故事(预设),可一键开始。</p>
        </div>
      )}
      <div className="vault-tabs">
        {KINDS.map(([k, label]) => (
          <button key={k} className={kind === k ? "active" : ""} onClick={() => switchKind(k)}>{label}</button>
        ))}
      </div>
      <div className="vault-list">
        {loading && <p className="empty">读取中…</p>}
        {!loading && !items.length && (
          <p className="empty">{
            kind === "mystories" ? "还没有你的故事。在「新建故事」最后『存成预设故事书』,或导入你自己的原创故事。"
            : kind === "events" ? "还没有事件卡。在「新建故事 → 事件卡」给故事书加隐藏事件。"
            : "这一类还是空的。去「创作」建一张。"
          }</p>
        )}
        {!loading && pageItems.map((item, i) => (
          <div className="vault-card" key={i}>
            <div className="vc-main">
              <b>{cardName(item) || item.name}</b>
              <span>{(cardDesc(item) || "").slice(0, 70)}</span>
            </div>
            <div className="vc-actions">
              {kind === "events" ? (
                <span className="vc-note">事件随故事书,去「故事书」编辑</span>
              ) : kind === "mystories" ? (
                <>
                  <button className="primary" onClick={() => onLaunchPreset && onLaunchPreset({ name: item.name, data: item.data })}>开始</button>
                  <button className="del" onClick={() => onDeletePreset && onDeletePreset({ name: item.name })}>删除</button>
                </>
              ) : (
                <>
                  <button className="primary" onClick={() => useInGame(item)}>用到游戏</button>
                  <button onClick={() => openEdit(item)}>详情/修改</button>
                  {kind === "characters" && <button onClick={() => completeCard(item.data)}>对话完善</button>}
                  <button className="del" onClick={() => del(item)}>删除</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {!loading && totalPages > 1 && (
        <div className="vault-pager">
          <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>‹</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
            <button key={n} className={n === safePage ? "active" : ""} onClick={() => setPage(n)}>{n}</button>
          ))}
          <button disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>›</button>
        </div>
      )}
    </section>
  );
}

function bundleSummary(d) {
  const parts = [];
  if ((d.characters || []).length) parts.push(`${d.characters.length} 角色`);
  if (d.player) parts.push("主角");
  if (d.world) parts.push("世界书");
  if (d.story) parts.push("故事书");
  return parts.join(" · ") || "空卡组";
}


// 判断某个 preset 是不是新手教学局(给探索页那张卡打引导锚点 / startTutorial 找它都用)。
function isTutorialPreset(p) {
  const d = (p && p.data) || {};
  return ((d.tags || []).includes("教学")) || (((p && p.name) || "").includes("新人入店")) || ((d.name || "").includes("新人入店"));
}



// —— muyan 封面墙:做旧纸·错位微倾的 CSS 色块封面(刻意少图,走线条风)——
const HM_COVERS = [
  { c: "#2b2620", tone: "#ece4d0" }, { c: "#b5402e", tone: "#f2e8d4" },
  { c: "#33474a", tone: "#e7e0cc" }, { c: "#5e5039", tone: "#ece4d0" }, { c: "#8a753f", tone: "#f0e9d6" },
];
const HM_ROT = [-1.2, 0.8, -0.6, 1.1, -0.9, 1.4];
const HM_OFF = [0, 26, 8, 30, 4, 24];


// 场景缩略占位(真插画后填):一组冷暖各异的渐变,模拟二游场景封面。
const LH_SCENES = [
  "radial-gradient(120% 90% at 32% 18%, #9fb6d8, transparent 60%), linear-gradient(160deg,#43577a,#27344c)",
  "radial-gradient(120% 90% at 68% 22%, #d8c592, transparent 60%), linear-gradient(160deg,#5a4a36,#2f2719)",
  "radial-gradient(120% 90% at 38% 18%, #88b6a0, transparent 60%), linear-gradient(160deg,#2e4b44,#163029)",
  "radial-gradient(120% 90% at 62% 22%, #c79aa8, transparent 60%), linear-gradient(160deg,#5b3a4a,#2c1f29)",
  "radial-gradient(120% 90% at 34% 20%, #a59cce, transparent 60%), linear-gradient(160deg,#3a3560,#211d3a)",
];




const BUILD_STEPS = [
  { key: "worlds", label: "世界 / 设定", optional: true, desc: "世界书 或 设定卡(组织 / 地点)的中层设定 — 先选类型" },
  { key: "characters", label: "角色", desc: "NPC:先选 主要/次要、轻量/满配、含不含隐藏真相(至少 1 张)" },
  { key: "players", label: "主角", optional: true, desc: "你扮演谁:身份 / 目标 / 能力 / 限制 / 开局已知与不知(可跳过用模板)" },
  { key: "stories", label: "故事框架", optional: true, desc: "前提 / 主线 / 结局 → 故事书" },
  { key: "events", label: "事件卡", optional: true, desc: "隐藏事件卡 → 挂到当前故事书(手动加;引擎暂无 AI 建事件)" },
  { key: "summary", label: "汇总", desc: "打包成预设 + 开始故事" },
];

// 事件卡步:表单手动加事件,挂到当前故事书的 events(没故事书则自动建一个空的)。不走 AI 对话(引擎无事件卡创作类型)。
function EventStep({ story, setStory }) {
  const blank = { event_id: "", title: "", summary: "", trigger_keywords: [], unlock_conditions: [], hidden: true, severity: 2 };
  const [d, setD] = useState(blank);
  const events = (story && story.events) || [];
  const up = (f, v) => setD({ ...d, [f]: v });

  function add() {
    if (!d.title.trim()) return;
    const base = story || { title: "(未命名故事书)", premise: "", timeline: [], main_plot: [], events: [], endings: [], freedom_rules: [], pacing: [], character_boundaries: [], needs_confirm: [] };
    setStory({ ...base, events: [...(base.events || []), { ...d }] });
    setD(blank);
  }
  function remove(i) { if (story) setStory({ ...story, events: story.events.filter((_, j) => j !== i) }); }

  return (
    <section className="editor-panel">
      <div className="editor-head">
        <div><h3>事件卡(隐藏事件)</h3><span>挂到当前故事书。引擎暂无 AI 建事件,这里手动加。{!story ? "(还没故事书,加第一个会自动建一个空的)" : ""}</span></div>
      </div>
      <label>事件名<input value={d.title} onChange={(e) => up("title", e.target.value)} placeholder="如 炉底显魂" /></label>
      <label>摘要<textarea rows="3" value={d.summary} onChange={(e) => up("summary", e.target.value)} placeholder="触发后发生什么" /></label>
      <label>触发关键词,逗号分隔<input value={(d.trigger_keywords || []).join(", ")} onChange={(e) => up("trigger_keywords", e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean))} /></label>
      <label>触发条件,一行一条<textarea rows="2" value={listToLines(d.unlock_conditions)} onChange={(e) => up("unlock_conditions", linesToList(e.target.value))} placeholder="如 玩家三次提到炉底怪声" /></label>
      <div className="ev-row">
        <label className="inline-check"><input type="checkbox" checked={!!d.hidden} onChange={(e) => up("hidden", e.target.checked)} /> 隐藏事件(默认不触发,条件到了才发生)</label>
        <label className="ev-sev">烈度<input type="number" min="1" max="5" value={d.severity} onChange={(e) => up("severity", Math.max(1, Math.min(5, parseInt(e.target.value, 10) || 2)))} /></label>
      </div>
      <button className="primary add-event" onClick={add} disabled={!d.title.trim()}>
        {d.title.trim() ? "+ 添加事件到故事书" : "+ 添加事件(先填事件名)"}
      </button>

      <div className="editor-subhead"><h4>已加事件({events.length})</h4></div>
      <div className="entry-editor-list">
        {!events.length && <p className="hint-line">还没加事件。</p>}
        {events.map((ev, i) => (
          <div className="bov-item" key={i}>
            <b>{ev.title || ev.event_id || `事件 ${i + 1}`}</b>
            {ev.hidden && <span className="bov-desc">隐藏</span>}
            <span className="bov-btns"><button onClick={() => remove(i)}>删除</button></span>
          </div>
        ))}
      </div>
    </section>
  );
}

// 步骤式创作(自建故事流程):依次 世界→角色→主角→故事→汇总,复用 CardBuilder + 现有端点,不动后端引擎。
function StepBuilder({ characters, worldBooks, story, player, addCharacter, addWorld, setCharacters, setWorldBooks, setStory, setPlayer, onStartStory, onSavePreset, onExit }) {
  const [step, setStep] = useState(0);
  const [nonce, setNonce] = useState(0);   // 重置 CardBuilder(换步 / 角色再加一张)
  const [opts, setOpts] = useState({});     // 当前步的引导选项
  const [started, setStarted] = useState(false); // 引导步:是否已点「开始」进对话
  const [editing, setEditing] = useState(null);   // 正在查看/修改的卡 {kind, index}
  const [savedKeys, setSavedKeys] = useState(() => new Set()); // 已存入故事库的项 key (kind:index)
  const [saveErr, setSaveErr] = useState("");      // 入库失败提示
  const cur = BUILD_STEPS[step];
  const isLast = step === BUILD_STEPS.length - 1;
  const canLeaveCharStep = characters.length > 0;

  const STEP_GUIDE = { characters: "character", worlds: "worldsetting" }; // 这些步先选引导 chips 再聊
  const guide = STEP_GUIDE[cur.key];
  const seed = buildGuideSeed(cur.key === "worlds" ? "worldsetting" : cur.key, opts);

  function jump(i) { setStep(Math.max(0, Math.min(BUILD_STEPS.length - 1, i))); setNonce((n) => n + 1); setOpts({}); setStarted(false); setEditing(null); }

  // CardBuilder 完成 → 把卡加进本轮卡组(立刻显示在下方列表),清空 builder 准备下一张。
  // 先不存故事库——保存由下方列表里每张卡的「保存到故事库」单独点。
  function onCardComplete(draft) {
    const k = cur.key;
    if (k === "characters") addCharacter(wrapCard(draft));
    else if (k === "worlds") addWorld(draft);
    else if (k === "players") setPlayer(draft);
    else if (k === "stories") {
      // 保住手动加的事件卡:新故事框架没带 events 时,沿用已挂在旧故事上的 events。
      const keepEvents = story && (story.events || []).length && !(draft.events || []).length;
      setStory(keepEvents ? { ...draft, events: story.events } : draft);
    }
    setNonce((n) => n + 1);
  }

  async function saveOne(kind, index, data) {
    setSaveErr("");
    const ok = await saveToVault(kind, data);
    if (ok) setSavedKeys((s) => new Set(s).add(kind + ":" + index));
    else setSaveErr("「" + ((data && data.data && data.data.name) || (data && data.name) || (data && data.title) || "这张卡") + "」存入故事库失败,请重试。");
  }
  function viewEdit(kind, index) {
    setEditing({ kind, index });
    setSavedKeys((s) => { const n = new Set(s); n.delete(kind + ":" + index); return n; }); // 改过要重存
  }

  return (
    <section className="view-shell step-builder">
      <div className="view-head vh-row">
        <div><h2>新建故事 · 引导创作</h2><p>一步步把世界、角色、故事建出来,最后打包成预设并开始。</p></div>
        <button className="back-link" onClick={onExit}>← 探索</button>
      </div>

      <div className="step-progress" data-coach="build-steps">
        {BUILD_STEPS.map((s, i) => (
          <button key={s.key} className={"step-dot " + (i === step ? "active " : "") + (i < step ? "done" : "")}
            onClick={() => jump(i)}>
            <span className="step-num">{i + 1}</span>
            <span className="step-label">{s.label}</span>
          </button>
        ))}
      </div>

      {!isLast && (
        <div className="step-body" data-coach="build-body">
          <div className="step-cur-head">
            <h3>第 {step + 1} 步:{cur.label}</h3>
            <p>{cur.desc}{cur.key === "characters" && characters.length ? ` · 已建 ${characters.length} 张` : ""}</p>
          </div>
          {cur.key === "events" ? (
            <EventStep story={story} setStory={setStory} />
          ) : guide && !started ? (
            <BuildOptions guide={guide} opts={opts} setOpts={setOpts} onStart={() => setStarted(true)} />
          ) : (
            <>
              {guide && (
                <div className="guide-readout">
                  创作设定:{(BUILD_GUIDES[guide] || []).map((g) => opts[g.key] || g.opts[0]).join(" · ")}
                  <button onClick={() => setStarted(false)}>重选</button>
                </div>
              )}
              <CardBuilder key={cur.key + nonce} kind={cur.key} seed={seed} onComplete={onCardComplete} onClose={() => {}} />
            </>
          )}
          <div className="step-nav">
            <button onClick={() => jump(step - 1)} disabled={step === 0}>← 上一步</button>
            {cur.key === "characters" && !canLeaveCharStep
              ? <span className="step-hint">至少建 1 张角色才能继续</span>
              : <button className="primary" onClick={() => jump(step + 1)}>{cur.optional ? "跳过 / 下一步" : "下一步"} →</button>}
          </div>
        </div>
      )}

      {isLast && (
        <div className="step-summary">
          <h3>汇总</h3>
          <ul className="summary-list">
            <li>世界 / 设定:{worldBooks.length ? `${worldBooks.length} 份` : "未建(可选)"}</li>
            <li>角色:{characters.length ? `${characters.length} 张` : "未建"}</li>
            <li>主角:{player ? (player.name || "已建") : "未建(开局可选 / 用模板)"}</li>
            <li>故事框架:{story ? (story.title || "已建") : "未建(可选)"}</li>
          </ul>
          {!characters.length && <p className="error">还没有任何角色,至少建 1 张角色才能开始故事。回上面补一张。</p>}
          <div className="step-summary-actions">
            <button onClick={() => jump(0)}>← 回去补卡</button>
            <button onClick={onSavePreset} disabled={!characters.length}>存成预设故事书</button>
            <button className="primary" onClick={onStartStory} disabled={!characters.length}>开始故事 →</button>
          </div>
        </div>
      )}

      {editing && editing.kind === "characters" && characters[editing.index] && (
        <CharacterEditor card={characters[editing.index]} index={editing.index}
          onChange={(i, next) => setCharacters((xs) => xs.map((c, j) => (j === i ? next : c)))}
          onClose={() => setEditing(null)} />
      )}
      {editing && editing.kind === "worlds" && worldBooks[editing.index] && (
        <WorldEditor world={worldBooks[editing.index]} index={editing.index}
          onChange={(i, next) => setWorldBooks((xs) => xs.map((w, j) => (j === i ? next : w)))}
          onClose={() => setEditing(null)} />
      )}
      {editing && editing.kind === "players" && player && (
        <PlayerEditor player={player} onChange={setPlayer} onClose={() => setEditing(null)} />
      )}
      {editing && editing.kind === "stories" && story && (
        <StoryEditor story={story} onChange={setStory} onClose={() => setEditing(null)} />
      )}

      {saveErr && <p className="error">{saveErr}</p>}
      <BuiltOverview characters={characters} worldBooks={worldBooks} story={story} player={player}
        onView={viewEdit} onSave={saveOne} savedKeys={savedKeys} />
    </section>
  );
}

// ── 新手引导(coach marks)─────────────────────────────────────────────
// 只对「第一次用网站」的用户自动触发;随屏即时:每屏一组,锚到该屏真实元素;之后靠右下角「?」手动重放。
const COACH_DONE_KEY = "ais_onboarding_done"; // 跳过/不再显示后置 1,自动引导永不再触发
const COACH_SEEN_KEY = "ais_coach_seen";      // 首用期间各屏是否已自动展示过 {home,select,story}

function coachDone() { try { return localStorage.getItem(COACH_DONE_KEY) === "1"; } catch (e) { return true; } }
function coachSeen() { try { return JSON.parse(localStorage.getItem(COACH_SEEN_KEY)) || {}; } catch (e) { return {}; } }
function markCoachSeen(screen) {
  try { const s = coachSeen(); s[screen] = true; localStorage.setItem(COACH_SEEN_KEY, JSON.stringify(s)); } catch (e) {}
}

// 每屏的步骤(锚到上面打的 data-coach 元素)。文案为通用占位,后续 yufei 再润。
// sel 找不到对应元素时该步降级为居中说明卡(不高亮),保证健壮。
const COACH = {
  home: [
    { sel: '[data-coach="gallery"]', title: "挑一个故事", body: "这里是故事库。选一个预设故事,点卡片上的「开始」就能进入开玩。" },
    { sel: '[data-coach="new-story"]', title: "或者自己造一个", body: "想做属于自己的故事?点「新建故事」,一步步把世界、角色、剧情建出来。" },
    { sel: '[data-coach="help-btn"]', title: "随时能重看", body: "不知道怎么操作?任何时候点右下角这个「?」,就能重看当前页面的引导。" },
    { sel: '[data-coach="tutorial-tile"]', title: "第一次来?从这局学起", body: "这就是新手教学《新人入店》。点它的「开始」(或下面的按钮)进去走一遍——推门进沐言书坊,摸清怎么玩,进去后我会在每一屏接着指给你看。", actionId: "tutorial", actionLabel: "开始新手教学" },
  ],
  modal: [
    { tab: "intro", sel: '[data-coach="modal-tab-intro"]', title: "① 简介", body: "封面、一句钩子、作者、标签——先大概了解这个故事是什么。" },
    { tab: "bg", sel: '[data-coach="modal-tab-bg"]', title: "② 故事背景", body: "前情 + 最核心的世界设定。" },
    { tab: "chars", sel: '[data-coach="modal-tab-chars"]', title: "③ 角色", body: "登场人物,在内容区用箭头左右翻看。" },
    { tab: "cast", sel: '[data-coach="modal-tab-cast"]', title: "④ 出演", body: "选你扮演谁:翻看可扮演角色「以 TA 开始」,或点「自定义角色」用自己的设定。同一个故事换人重玩,体验不同。" },
  ],
  story: [
    { sel: '[data-coach="gen-opening"]', title: "先生成开场", body: "点「生成开场」,故事会从一个具体场景开始,而不是空白对话。" },
    { sel: '[data-coach="composer"]', title: "你来推进剧情", body: "在这里自由输入你想做的事;顶部也会冒出几个选项,点一下会填进输入框,你可以改了再发。" },
    { sel: '[data-coach="rail-toggle"]', title: "随时看故事状态", body: "想知道现在什么情况?点这里展开右侧状态栏:当前场景、在场角色、你和他们的关系、物品、故事时间轴,都在这。" },
  ],
  mine: [
    { sel: '[data-coach="mine-saves"]', title: "存档在这", body: "玩过的故事都自动存档,在这里接着玩。" },
    { sel: '[data-coach="mine-presets"]', title: "你建的故事", body: "你做的预设故事在这,点「开始」就能开局。" },
    { sel: '[data-coach="mine-library"]', title: "你的卡库", body: "建过 / 导入的角色、世界、故事卡,按类型在这管理、复用。" },
  ],
  build: [
    { sel: '[data-coach="build-steps"]', title: "一步步建故事", body: "创作分几步:世界 → 角色 → 主角 → 故事 → 汇总。点上面的步骤可以来回跳。" },
    { sel: '[data-coach="build-body"]', title: "聊着就建好", body: "每一步和 AI 对话,聊着聊着卡就出来了。" },
    { sel: '[data-coach="build-overview"]', title: "建好的卡在这", body: "这轮建好的卡都列在这,可查看 / 修改,或单独存到故事库。点下面按钮开始建第一张。", actionId: "dismiss", actionLabel: "开始对话创作" },
  ],
  chat: [
    { sel: '[data-coach="chat-ph"]', title: "聊天即将上线", body: "之后这里能和单个角色一对一聊天(微信式)。本批次先占位。" },
  ],
  gameEmpty: [
    { sel: '[data-coach="nav-explore"]', title: "先挑个故事", body: "还没有进行中的故事。去「探索」挑一个开始(或新建一个),玩起来这里就是当前故事。", actionId: "explore", actionLabel: "去探索" },
  ],
};



// recon 1:1 视图外壳:全屏 fill——按视口高定缩放,画布宽跟随视口(左右零留白;recon 页内部
// 左右锚定自适应)。视口比设计稿更窄时退回 scale-to-fit(小留白,不裁内容)。导航点击委托保留。
function ReconShell({ designW, designH, bg, onNav, onPrimary, children }) {
  const ref = React.useRef(null);
  const [dim, setDim] = React.useState({ scale: 1, w: designW, ox: 0, oy: 0 });
  React.useEffect(() => {
    function fit() {
      const el = ref.current; if (!el) return;
      const vw = el.clientWidth, vh = el.clientHeight;
      const fillScale = vh / designH;
      if (fillScale <= vw / designW) {
        setDim({ scale: fillScale, w: Math.round(vw / fillScale), ox: 0, oy: 0 });
      } else {
        const s = Math.min(vw / designW, vh / designH);
        setDim({ scale: s, w: designW, ox: Math.max(0, (vw - designW * s) / 2), oy: Math.max(0, (vh - designH * s) / 2) });
      }
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [designW, designH]);
  function onClick(e) {
    const navEl = e.target.closest && e.target.closest("a, .nav a, .menu a, .lbar .nav a");
    if (navEl) {
      const zhEl = navEl.querySelector && navEl.querySelector(".zh");
      const zh = ((zhEl && zhEl.textContent) || navEl.textContent || "").trim();
      const map = { "首页": "home", "探索": "home", "故事库": "home", "当前故事": "game", "创作": "build", "聊天": "chat", "角色": "chat", "我的": "mine" };
      if (onNav && map[zh]) { e.preventDefault(); onNav(map[zh]); return; }
    }
    if (onPrimary && e.target.closest) {
      const c = e.target.closest("a, button, [class*='btn'], .lh-card, .ccard, [class*='enter'], [class*='cta'], [class*='exec']");
      const t = ((c && c.textContent) || "").replace(/\s+/g, "");
      if (c && (e.target.closest(".lh-card, .lh-btn-main, .b1") || /进入入局|ENTERTHESTORY|取下这本书|开始探索|开始旅程/.test(t))) {
        e.preventDefault(); onPrimary();
      }
    }
  }
  return (
    <div ref={ref} className="recon-shell" onClick={onClick} style={bg ? { background: bg } : undefined}>
      <style>{`
        /* shell 挂载期间锁页面滚动 + 取消 styles.css 的 scrollbar-gutter 预留(治右侧 15px 空带) */
        html, body { overflow:hidden !important; scrollbar-gutter:auto !important; }
        .recon-shell{position:fixed; inset:0; z-index:40; background:#ece4d2; overflow:hidden;}
        .recon-stage{position:absolute; transform-origin:0 0;}
        /* 页面切换:淡入 + 轻浮(挂载即播;stage 的 scale 在外层,wrapper 只动 opacity/translate 不冲突) */
        @keyframes rc-page-in { from { opacity:0; transform:translateY(14px); } to { opacity:1; transform:translateY(0); } }
        .recon-fade{width:100%; height:100%; animation: rc-page-in .3s cubic-bezier(.22,1,.36,1) both;}
        /* fill:画布根铺满 stage(覆盖各 .cv-* 的固定 width/height) */
        .recon-fade > *{width:100% !important; height:100% !important;}
        @media (prefers-reduced-motion: reduce){ .recon-fade{animation-duration:1ms;} }
      `}</style>
      <div className="recon-stage" style={{ width: dim.w, height: designH, left: dim.ox, top: dim.oy, transform: "scale(" + dim.scale + ")" }}>
        <div className="recon-fade">{children}</div>
      </div>
    </div>
  );
}

// 角色聊天控制器:OC 就是角色——/api/my/oc 的 OC 与预设角色合成同一份「角色」列表
// (OC 排前、带真立绘,按名去重)。统一卡主导一对一,共用 /api/chat,历史按角色名维护。
function ReconChatLive({ presets, onNav, mobile, uid }) {
  const presetCards = React.useMemo(() => {
    const out = []; const seen = new Set();
    (presets || []).forEach((p) => ((p.data && p.data.characters) || []).forEach((c) => {
      const nm = (c.data && c.data.name) || c.name; if (!nm || seen.has(nm)) return; seen.add(nm); out.push(c);
    }));
    return out;
  }, [presets]);
  const [ocs, setOcs] = React.useState([]);
  const [myCards, setMyCards] = React.useState([]); // 用户自己建的角色卡(创作桌入库的)也能聊——闭环建卡→使用
  const [activeKey, setActiveKey] = React.useState("");
  // 会话持久化:对话与会话 id 落 localStorage(按账号隔离),切走/刷新回来接着聊,
  // 「近期聊天」终于名实相符;「新建对话」才重开。每角色只留最近 60 条防爆容量。
  const CHAT_KEY = "ais_chat_hist_v1" + (uid ? "_u_" + uid : "");
  const restoredRef = React.useRef({});  // 哪些角色是从本机恢复的(给「已接上上次对话」提示)
  const [byKey, setByKey] = React.useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem(CHAT_KEY)) || {};
      const out = {};
      Object.keys(d).forEach((k) => {
        if (d[k] && Array.isArray(d[k].msgs) && d[k].msgs.length) { out[k] = d[k].msgs; restoredRef.current[k] = true; }
      });
      return out;
    } catch (e) { return {}; }
  });
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    try {
      const out = {};
      Object.keys(byKey).forEach((k) => {
        // 滤掉纯「……」占位(开场进行中被打断的残留),避免恢复出一条死占位
        const msgs = (byKey[k] || []).filter((m) => !(m && m.who !== "me" && m.text === "……")).slice(-60);
        if (msgs.length) out[k] = { sid: sidsRef.current[k] || "", msgs };
      });
      localStorage.setItem(CHAT_KEY, JSON.stringify(out));
    } catch (e) {}
  }, [byKey]);
  React.useEffect(() => {
    let alive = true;
    fetch("/api/my/oc").then((r) => (r.ok ? r.json() : { ocs: [] }))
      .then((d) => { if (alive) setOcs(d.ocs || []); })
      .catch(() => { if (alive) setOcs([]); });
    fetch("/api/library/characters").then((r) => (r.ok ? r.json() : []))
      .then((rows) => { if (alive) setMyCards((rows || []).filter((x) => x && !x.official)); })
      .catch(() => { if (alive) setMyCards([]); });
    return () => { alive = false; };
  }, []);
  const list = React.useMemo(() => {
    const out = []; const seen = new Set();
    (ocs || []).forEach((o) => {
      if (o.character && !seen.has(o.character)) { seen.add(o.character); out.push({ name: o.character, persona: o.persona, avatar: o.art || undefined, anim: o.anim || undefined, card: o.card }); }
    });
    // 自有卡库角色排在 OC 后、预设角色前(自己造的人优先看到)
    (myCards || []).forEach((c) => {
      const d = (c.data && c.data.data) || c.data || {};
      const nm = d.name || c.name;
      if (nm && !seen.has(nm)) { seen.add(nm); out.push({ name: nm, persona: d.persona || d.personality, description: d.description, card: c.data }); }
    });
    presetCards.forEach((c) => {
      const nm = (c.data && c.data.name) || c.name;
      if (nm && !seen.has(nm)) { seen.add(nm); out.push({ name: nm, persona: c.data && c.data.persona, description: c.data && c.data.description, card: c }); }
    });
    return out;
  }, [ocs, myCards, presetCards]);
  const activeName = activeKey || (list[0] && list[0].name) || "";
  const activeItem = list.find((x) => x.name === activeName) || null;
  const messages = byKey[activeName] || [];
  // 会话 id:有本机记录就续用上次的 sid(服务端按 sid 保留完整历史,续聊有上下文);
  // 没有才开新串。「新建对话」显式换新 sid,旧会话服务端原样保留。
  const sidsRef = React.useRef(null);
  const openedRef = React.useRef(null);
  if (sidsRef.current === null) {
    const sids = {}, opened = {};
    try {
      const d = JSON.parse(localStorage.getItem(CHAT_KEY)) || {};
      Object.keys(d).forEach((k) => {
        if (d[k] && d[k].sid) sids[k] = d[k].sid;
        if (d[k] && Array.isArray(d[k].msgs) && d[k].msgs.length) opened[k] = true; // 已有对话 → 不再自动开场
      });
    } catch (e) {}
    sidsRef.current = sids;
    openedRef.current = opened;
  }
  const [chatNonce, setChatNonce] = React.useState(0); // 「新建对话」重开会话的触发器
  const sidFor = (nm) => {
    if (!sidsRef.current[nm]) sidsRef.current[nm] = "chat-" + nm + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    return sidsRef.current[nm];
  };
  // 自动开场:选中有卡的角色且本局还没有消息时,让角色先开口。
  // 开场引子随机抽 + 全新会话无历史 → 同一角色多次开局,开场各不相同。
  const OPEN_HINTS = [
    "清晨的第一缕光线", "一场刚停的雨", "人潮散去的傍晚", "深夜里还亮着的灯",
    "街角的不期而遇", "忙完手头事的午后", "一段旅途的间隙", "窗外突变的天气",
    "一件让你在意的小东西", "远处传来的声音",
  ];
  React.useEffect(() => {
    const nm = activeName, it = activeItem;
    if (!nm || !it || !it.card) return;
    if ((byKey[nm] || []).length || openedRef.current[nm]) return;
    openedRef.current[nm] = true;
    const hint = OPEN_HINTS[Math.floor(Math.random() * OPEN_HINTS.length)];
    setBusy(true);
    setByKey((m) => ({ ...m, [nm]: [{ who: nm, text: "……" }] }));
    postJSON("/api/chat", {
      card: it.card, session_id: sidFor(nm), world: null,
      user: "（这是一次全新的相遇，和以往任何一次开场都不同。请你以「" + hint + "」为引子主动开启对话：先一两句动作或场景描写，再说出你的第一句话，把话头交给我。不要提及或复述这条指令。）",
    })
      .then((r) => setByKey((m) => ({ ...m, [nm]: [{ who: nm, text: (r && r.reply) || "（无回应）" }] })))
      .catch((e) => { openedRef.current[nm] = false; setByKey((m) => ({ ...m, [nm]: [{ who: nm, text: "（开场失败：" + e.message + "）" }] })); })
      .finally(() => setBusy(false));
  }, [activeName, activeItem, chatNonce]);
  // 新建对话:与当前角色重开一段全新会话(旧会话服务端原样保留),触发新的自动开场。
  function newChat() {
    const nm = activeName;
    if (!nm || busy) return;
    delete sidsRef.current[nm];
    openedRef.current[nm] = false;
    delete restoredRef.current[nm];
    setByKey((m) => { const n = { ...m }; delete n[nm]; return n; });
    setChatNonce((x) => x + 1);
  }
  async function send() {
    const text = input.trim();
    if (!text || !activeItem || busy) return;
    if (!activeItem.card) {
      setByKey((m) => ({ ...m, [activeName]: [...(m[activeName] || []), { who: activeName, text: "（这位角色还没有引擎角色卡，暂时只能看资料，不能对话。）" }] }));
      return;
    }
    setBusy(true);
    setByKey((m) => ({ ...m, [activeName]: [...(m[activeName] || []), { who: "me", text }] }));
    setInput("");
    try {
      const r = await postJSON("/api/chat", { card: activeItem.card, session_id: sidFor(activeName), user: text, world: null });
      setByKey((m) => ({ ...m, [activeName]: [...(m[activeName] || []), { who: activeName, text: (r && r.reply) || "（无回应）" }] }));
    } catch (e) {
      setByKey((m) => ({ ...m, [activeName]: [...(m[activeName] || []), { who: activeName, text: "（连接出错：" + e.message + "）" }] }));
    } finally { setBusy(false); }
  }
  const ChatC = (mobile && window.MChat) ? window.MChat : window.ReconChat;
  return (
    <ChatC
      characters={list}
      activeName={activeName} messages={messages} value={input}
      onChange={setInput} onSend={send} onNav={onNav}
      busy={busy} canChat={!!(activeItem && activeItem.card)} onNewChat={newChat}
      restored={!!(restoredRef.current[activeName] && messages.length)}
      onPick={(nm) => setActiveKey(nm)} />
  );
}

// 创作桌控制器:对话式建卡(/api/build_card,前端维护对话+草稿),入库走 /api/library/save。
function ReconCreateLive({ onNav, refreshHome, mobile }) {
  // 「事件卡」tab 暂不提供:此前误映射到 characters(AI 按角色卡引导、产物存错库),
  // 事件应随故事书创建;待接 EventStep 表单后再恢复。
  const KINDS = [
    { zh: "角色卡", en: "CHARACTER", k: "characters" },
    { zh: "演出卡", en: "STAGING", k: "players" },
    { zh: "设定卡 · 世界书", en: "LORE", k: "worlds" },
    { zh: "故事书", en: "STORY", k: "stories" },
  ];
  const [ki, setKi] = React.useState(0);
  const [messages, setMessages] = React.useState([{ who: "坊", text: "想造哪张卡？说一个画面、一句话都行——聊着聊着，卡就长出来了。" }]);
  const [draft, setDraft] = React.useState({});
  const [filled, setFilled] = React.useState([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  async function send() {
    const text = input.trim(); if (!text || busy) return;
    setBusy(true);
    const apiMsgs = [...messages, { who: "你", text }].map((m) => ({ role: m.who === "你" ? "user" : "assistant", content: m.text }));
    setMessages((m) => [...m, { who: "你", text }]); setInput("");
    try {
      const r = await postJSON("/api/build_card", { kind: KINDS[ki].k, messages: apiMsgs, draft, seed: "" });
      const ask = [r.reply, r.next_question].filter(Boolean).join(" ");
      if (ask) setMessages((m) => [...m, { who: "坊", text: ask }]);
      if (r.draft) setDraft(r.draft);
      setFilled(r.filled || (r.draft ? Object.keys(r.draft) : []));
    } catch (e) {
      setMessages((m) => [...m, { who: "坊", text: "（建卡出错：" + e.message + "）" }]);
    } finally { setBusy(false); }
  }
  async function saveCard() {
    const d = draft || {};
    if (!Object.keys(d).length) { alert("还没有可入库的卡，先聊几句让它长出来。"); return; }
    const k = KINDS[ki].k;
    try {
      await postJSON("/api/library/save", { kind: k, data: k === "characters" ? { data: d } : d });
      if (refreshHome) refreshHome();
      // 入库提示带出路(此前只 alert 一句死胡同):角色卡直通聊天页,聊天列表已并入自有卡库角色。
      if (k === "characters") {
        if (confirm("已收入卡库。现在就去和 TA 聊聊吗?")) { onNav("chat"); return; }
      } else {
        alert("已收入卡库,可在个人中心查看。");
      }
    } catch (e) { alert("入库失败：" + e.message); }
  }
  const d = draft || {};
  const dname = d.name || (d.data && d.data.name) || "未命名";
  const LABELS = { description: "简述", personality: "性格", scenario: "情境设定", first_mes: "开场白", mes_example: "对话示例", speech_rules: "说话规则", appearance: "外貌", persona: "人设", goals: "目标", secret: "隐藏真相", background: "背景", voice: "口癖", premise: "前提", title: "标题", entries: "条目" };
  const fields = Object.keys(d).filter((k) => !["name", "character_id", "id"].includes(k)).map((k) => {
    const v = d[k];
    return { k: LABELS[k] || k, v: typeof v === "string" ? v : (Array.isArray(v) ? v.join("、") : JSON.stringify(v)), fresh: (filled || []).includes(k), hidden: /secret|隐藏|真相/i.test(k) };
  });
  const CreateC = (mobile && window.MCreate) ? window.MCreate : window.ReconCreate;
  return (
    <CreateC
      cardKind={ki} kinds={KINDS} onKind={setKi}
      messages={messages} value={input} onChange={setInput} onSend={send} busy={busy}
      draft={{ name: dname, kind: KINDS[ki].zh, fields }}
      onSaveCard={saveCard} onNav={onNav} />
  );
}

// 登录后无昵称 → 强制设置(不可跳过;recon 暖纸卡风格,盖在整站之上)。
function NicknameGate({ onDone }) {
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  async function submit() {
    const nm = name.trim();
    if (!nm) { setErr("起个名字吧,1-24 个字"); return; }
    if (nm.length > 24) { setErr("昵称最长 24 个字"); return; }
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await postJSON("/api/my/display_name", { display_name: nm });
      onDone((r && r.display_name) || nm);
    } catch (e) { setErr(e.message || "保存失败"); }
    finally { setBusy(false); }
  }
  return (
    <div className="cv-nick">
      <style>{`
        .cv-nick {position:fixed; inset:0; z-index:70; display:grid; place-items:center; background:rgba(14,17,24,.62); backdrop-filter:blur(3px); font-family:"Kaiti SC","STKaiti","KaiTi",serif;}
        @keyframes rcn-in { from { opacity:0; transform:translateY(16px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
        .cv-nick .card {width:min(400px, 92vw); background:linear-gradient(180deg,#f6efdd,#efe6cf); border:1px solid rgba(203,176,121,.7);
          padding:34px 38px 30px; position:relative; box-shadow:0 24px 60px -20px rgba(0,0,0,.6); animation:rcn-in .36s cubic-bezier(.22,1,.36,1) both;}
        .cv-nick .card::before {content:""; position:absolute; inset:5px; border:1px solid rgba(43,38,32,.14); pointer-events:none;}
        .cv-nick h2 {margin:0; font-family:"Songti SC","SimSun",serif; font-size:21px; letter-spacing:.16em; color:#2b2620; text-align:center;}
        .cv-nick .sub {font-family:Georgia,serif; font-size:9.5px; letter-spacing:.3em; color:#a98a63; text-align:center; margin-top:7px;}
        .cv-nick p {font-size:13px; line-height:1.9; color:#6f6757; margin:16px 0 14px; text-align:center;}
        .cv-nick input {width:100%; background:rgba(255,255,255,.55); border:1px solid #c4b388; border-radius:0; box-shadow:none;
          font-family:inherit; font-size:15px; color:#2b2620; padding:12px 14px; outline:none; text-align:center; letter-spacing:.06em;}
        .cv-nick input:focus {border-color:#34463d; box-shadow:none;}
        .cv-nick .err {font-size:12.5px; color:#9a4a3a; margin-top:8px; text-align:center;}
        .cv-nick .go {width:100%; appearance:none; min-height:0; border-radius:0; height:48px; margin-top:16px; background:#34463d; color:#f3ead6;
          border:1px solid #283831; font-family:"Songti SC","SimSun",serif; font-size:15px; letter-spacing:.3em; cursor:pointer; position:relative;}
        .cv-nick .go::before {content:""; position:absolute; inset:3px; border:1px solid rgba(193,168,111,.5); pointer-events:none;}
        .cv-nick .go:hover:not(:disabled) {background:#2c3a32; color:#f3ead6;}
        .cv-nick .go:disabled {opacity:.6;}
      `}</style>
      <div className="card">
        <h2>给自己起个名字</h2>
        <div className="sub">SET YOUR NICKNAME</div>
        <p>故事里的人要怎么称呼你?<br />这个名字会出现在你的档案与对话中。</p>
        <input autoFocus value={name} maxLength={24} placeholder="1-24 个字"
               onChange={(e) => setName(e.target.value)}
               onKeyDown={(e) => e.key === "Enter" && !(e.nativeEvent || e).isComposing && submit()} />
        {err && <div className="err">{err}</div>}
        <button className="go" disabled={busy} onClick={submit}>{busy ? "…" : "就叫这个"}</button>
      </div>
    </div>
  );
}

// —— 分页路由(hash):每页独立 URL,前进/后退/刷新/直链均按页工作 ——
const VIEW_HASH = { landing: "#/", home: "#/explore", game: "#/play", build: "#/create", chat: "#/chat", mine: "#/mine" };
const HASH_VIEW = { "": "landing", "#": "landing", "#/": "landing", "#/landing": "landing", "#/explore": "home", "#/play": "game", "#/create": "build", "#/chat": "chat", "#/mine": "mine" };
const PAGE_TITLE = { landing: "YoRHa-A2 引擎", home: "故事库", game: "当前故事", build: "创作桌", chat: "角色聊天", mine: "个人中心" };
function parseHash(h) {
  h = (h != null ? h : (typeof location !== "undefined" ? location.hash : "")) || "";
  if (h.indexOf("#/story/") === 0) return { view: "home", story: decodeURIComponent(h.slice(8)) };
  return { view: HASH_VIEW[h] || null, story: null };
}

function App() {
  const [characters, setCharacters] = useState([]);
  const [worldBooks, setWorldBooks] = useState([]);
  const [story, setStory] = useState(null);
  const [player, setPlayer] = useState(null);
  const [mode, setMode] = useState("deep");  // 默认深度:长对话自动上向量召回 + Phase 3 在场过滤(部署需含 embedding 依赖)
  const [started, setStarted] = useState(false);
  const [assembling, setAssembling] = useState(false);
  const [sessionId, setSessionId] = useState(loadOrCreateSessionId);
  const [restoring, setRestoring] = useState(true);
  const [auth, setAuth] = useState({ ready: false, enabled: false, user: null }); // 账户:AUTH 是否开 + 当前用户
  const [restoredTurns, setRestoredTurns] = useState(null);
  const [restoredState, setRestoredState] = useState(null);
  const [restoredChoices, setRestoredChoices] = useState([]);
  // 手机端(≤720px):同数据同引擎,换 ReconMobile 流式版式(底部 tab,单列)。
  const [isMobile, setIsMobile] = useState(() => (typeof matchMedia !== "undefined" ? matchMedia("(max-width: 720px)").matches : false));
  useEffect(() => {
    const mq = matchMedia("(max-width: 720px)");
    const fn = () => setIsMobile(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", fn) : mq.addListener(fn);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", fn) : mq.removeListener(fn); };
  }, []);
  const [view, setView] = useState(() => parseHash().view || "landing"); // 初始视图按 URL hash(分页直达)
  const [pendingStory, setPendingStory] = useState(() => parseHash().story); // #/story/<名> 直链,等 presets 到位再开
  const [loginShown, setLoginShown] = useState(""); // ""=标题开屏;"login"/"register"=展开对应 tab 的登录表单
  const [sidebarOpen, setSidebarOpen] = useState(true); // 游戏中侧边卡组栏开关
  const [isPreset, setIsPreset] = useState(false);      // 当前局是否由预设开(预设:无侧边栏 + 先选人)
  const [selecting, setSelecting] = useState(false);    // 预设进入后的选人页阶段
  const [pendingPreset, setPendingPreset] = useState(null);
  const [buildSeed, setBuildSeed] = useState({ seed: "", draft: null });
  const [buildFlow, setBuildFlow] = useState(false); // true=新建故事步骤式引导 / false=故事库单卡完善
  const [turnSeq, setTurnSeq] = useState(0); // 每回合 bump,驱动右侧状态栏刷新
  const [railOpen, setRailOpen] = useState(false); // 右侧状态栏开合(不常驻)
  const [presets, setPresets] = useState([]);
  const [saves, setSaves] = useState(loadSaves);
  const [coachRun, setCoachRun] = useState(null); // 新手引导当前运行 { screen, manual } | null
  const coachRunRef = useRef(null);
  const [storyModal, setStoryModal] = useState(null); // 故事详情 modal { preset, tab } | null
  // 创作(新建故事)独立工作区:跟进行中的游戏卡组分开,互不影响。
  const [bChars, setBChars] = useState([]);
  const [bWorlds, setBWorlds] = useState([]);
  const [bStory, setBStory] = useState(null);
  const [bPlayer, setBPlayer] = useState(null);
  const world = useMemo(() => mergeWorldBooks(worldBooks), [worldBooks]);

  // 当前所在「引导屏」——每个界面都有 onboarding。modal 开 = 一条龙走查(简介→背景→角色→出演);
  // 否则按 view 分(探索/我的/创作/聊天/故事)。
  // recon 1:1 视图没有旧 data-coach 锚点 → 暂停自动新手引导(避免空浮窗压在新 UI 上);手动「?」仍可重放。
  const coachScreen = null;
  useEffect(() => { coachRunRef.current = coachRun; }, [coachRun]);

  const addCharacter = (card) => setCharacters((xs) => [...xs, card]);
  const addWorld = (wb) => setWorldBooks((xs) => [...xs, wb]);
  const completeCardFromVault = (cardData) => {
    setBuildSeed({ seed: JSON.stringify(cardData), draft: cardData.data || cardData });
    setBuildFlow(false);   // 故事库来的「对话完善」走单卡 BuildView,不进步骤式
    setView("build");
  };

  // 故事库加载失败 ≠ 书架为空:失败置 presetsErr,探索页给「加载失败 · 重试」而非假空态;
  // 失败时保留上次成功的列表(短暂网络抖动不清屏)。
  const [presetsErr, setPresetsErr] = useState(false);
  function refreshHome() {
    setSaves(loadSaves());
    fetch("/api/presets")
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((rows) => { setPresets(rows); setPresetsErr(false); })
      .catch(() => setPresetsErr(true));
  }
  useEffect(() => { refreshHome(); }, []);

  // 账户:开局查 /api/auth/me —— 判断 AUTH 是否开 + 是否已登录(token 失效则清掉)。
  // 网络抖动/瞬时 5xx 重试 3 次再定论,不再一次失败就吞成「AUTH 未开」导致已登录用户被当游客。
  useEffect(() => {
    let alive = true;
    (async () => {
      for (let i = 0; i < 3; i++) {
        try {
          const r = await fetch("/api/auth/me");
          if (r.status === 401) { setToken(""); if (alive) setAuth({ ready: true, enabled: true, user: null }); return; }
          if (r.ok) {
            const d = await r.json();
            if (alive) setAuth({ ready: true, enabled: !!d.auth_enabled, user: d.user || null });
            return;
          }
        } catch (e) {}
        await new Promise((res) => setTimeout(res, 600 * (i + 1)));
      }
      if (alive) setAuth({ ready: true, enabled: false, user: null });
    })();
    return () => { alive = false; };
  }, []);
  // 本地存档作用域跟随账号:登录 = 只看自己这个号在本机的存档(新号=空);游客/AUTH 关 = 旧全局 key。
  // 游客存档并入:登录后若本机旧全局 key 下有玩过的游客存档(turns>0),问一次要不要并进这个账号——
  // 注册不再凭空"弄丢"游客期的进度。每个账号只问一次(标记记 localStorage)。
  useEffect(() => {
    const uid = auth.enabled && auth.user ? auth.user.id : "";
    setSavesScope(uid);
    if (uid) {
      try {
        const flagKey = "ais_guest_merged_" + uid;
        if (!localStorage.getItem(flagKey)) {
          const legacy = (JSON.parse(localStorage.getItem(SAVES_KEY) || "[]") || [])
            .filter((s) => s && s.id && (s.turns || 0) > 0);
          const cur = loadSaves();
          const fresh = legacy.filter((s) => !cur.some((c) => c && c.id === s.id));
          if (fresh.length && confirm(
            "检测到本机有 " + fresh.length + " 局游客存档。要并入这个账号吗?\n并入后可在「最近游玩」继续;不并入则它们留在游客模式里。")) {
            persistSaves([...fresh, ...cur]);
          }
          localStorage.setItem(flagKey, "1");
        }
      } catch (e) {}
    }
    setSaves(loadSaves());
  }, [auth.enabled, auth.user && auth.user.id]);
  // 登录后:深链(#/chat 等)保留原目的地;否则进功能页(故事库)。
  function onAuthed(user, token) { setToken(token); setAuth((a) => ({ ...a, user })); setView((v) => (v === "landing" ? "home" : v)); }
  // 已登录用户刷新页面:跳过营销门面,直接落功能页。
  useEffect(() => {
    if (auth.ready && auth.user) setView((v) => (v === "landing" ? "home" : v));
  }, [auth.ready, auth.user]);

  // 登录后拉服务器侧「我的会话」(跨设备/运营分发的故事局),与本机存档合并给「我的·最近游玩」。
  // 失败 ≠ 没存档:置 savesErr 给个人中心显示「加载失败 · 重试」,并保留上次成功的列表。
  const [serverSaves, setServerSaves] = useState([]);
  const [savesErr, setSavesErr] = useState(false);
  const [savesReload, setSavesReload] = useState(0);
  useEffect(() => {
    if (!auth.user) { setServerSaves([]); setSavesErr(false); return undefined; }
    let alive = true;
    fetch("/api/my/sessions")
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((rows) => { if (alive) { setServerSaves(Array.isArray(rows) ? rows : []); setSavesErr(false); } })
      .catch(() => { if (alive) setSavesErr(true); });
    return () => { alive = false; };
  }, [auth.user, view, savesReload]);   // 切视图时顺带刷新,玩完一局回「我的」立即可见

  // 「我的资产」= 用户自己的卡(AUTH 开时滤掉 official 官方公共卡;关时本机即本人,全算)。
  // 此前个人中心把官方故事库整库算成新号资产(40 张角色卡等),与事实不符。
  const [myAssets, setMyAssets] = useState(null);
  useEffect(() => {
    if (view !== "mine") return undefined;
    let alive = true;
    Promise.all(["stories", "characters", "worlds", "players"].map((k) =>
      fetch("/api/library/" + k).then((r) => (r.ok ? r.json() : [])).catch(() => [])
    )).then(([st, ch, wo, pl]) => {
      if (!alive) return;
      const own = (xs) => (auth.enabled ? (xs || []).filter((x) => !x.official) : (xs || []));
      const tags = new Set();
      own(st).forEach((x) => (((x.data || {}).tags) || []).forEach((t) => tags.add(t)));
      own(ch).forEach((x) => ((((x.data || {}).data || {}).tags) || []).forEach((t) => tags.add(t)));
      setMyAssets({ stories: own(st).length, characters: own(ch).length, worlds: own(wo).length, players: own(pl).length, tags: tags.size });
    });
    return () => { alive = false; };
  }, [view, auth.enabled, auth.user && auth.user.id]);
  // —— 分页:状态 → URL(每次切页产生历史记录,后退/前进可用)+ 页标题 ——
  const storyModalRef = useRef(null);
  useEffect(() => { storyModalRef.current = storyModal; }, [storyModal]);
  useEffect(() => {
    const h = storyModal
      ? "#/story/" + encodeURIComponent(storyModal.preset.name || (storyModal.preset.data && storyModal.preset.data.name) || "")
      : (VIEW_HASH[view] || "#/");
    if (location.hash !== h) location.hash = h;
    const t = storyModal ? ((storyModal.preset.data && storyModal.preset.data.name) || storyModal.preset.name) : PAGE_TITLE[view];
    document.title = (view === "landing" && !storyModal) ? "YoRHa-A2 引擎" : ((t || "") + " · YoRHa-A2 引擎");
  }, [view, storyModal]);

  // —— 分页:URL → 状态(浏览器后退/前进/手输地址) ——
  useEffect(() => {
    function onHash() {
      const p = parseHash();
      if (p.story) {
        const cur = storyModalRef.current;
        const curName = cur && (cur.preset.name || (cur.preset.data && cur.preset.data.name));
        if (curName !== p.story) { setView("home"); setPendingStory(p.story); }
      } else if (p.view) {
        setStoryModal(null);
        setView(p.view);
      }
    }
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // —— 分页:#/story/<名> 直链 → presets 到位后打开对应故事详情 ——
  useEffect(() => {
    if (!pendingStory || !presets.length) return;
    const hit = presets.find((p) => p.name === pendingStory || (p.data && p.data.name === pendingStory));
    if (hit) setStoryModal({ preset: hit, tab: "intro" });
    setPendingStory(null);   // 找不到就留在故事库
  }, [pendingStory, presets]);

  const mineSaves = useMemo(() => {
    const server = (serverSaves || []).map((s) => ({
      id: s.id, name: s.story || (s.player ? s.player + " 的一局" : "未命名故事"),
      turns: s.turns || 0,
      updated: s.updated_at ? String(s.updated_at).replace("T", " ").slice(0, 16) : "",
    }));
    const ids = new Set(server.map((s) => s.id));
    // 仅本机条目:标 local 给 UI 加「仅本机」角标;过滤 0 回合占位残留(老版本登记的空档)。
    const localOnly = (saves || []).filter((s) => s && s.id && !ids.has(s.id) && (s.turns || 0) > 0)
      .map((s) => ({ ...s, local: true }));
    return [...localOnly, ...server];
  }, [saves, serverSaves]);
  // 先 POST 吊销(此时 token 还在,fetch 钩子会带上),再清本地 → 服务端 token 立即失效,不留 60 天活口。
  async function onLogout() { try { await fetch("/api/auth/logout", { method: "POST" }); } catch (e) {} setToken(""); location.reload(); }

  // 顶部导航:点「创作」tab 直接进步骤式引导(创作界面=步骤式);其余 tab 正常切。
  function navTo(k) {
    if (k === "build") setBuildFlow(true);
    setSaves(loadSaves());   // 切 tab 刷新存档列表:进行中那局每轮已写 localStorage,这样「我的」立刻看得到,不必刷新页面
    setView(k);
  }

  function resetGameState() {
    setCharacters([]); setWorldBooks([]); setStory(null); setPlayer(null); setMode("standard");
    setRestoredTurns(null); setRestoredState(null); setRestoredChoices([]);
    setIsPreset(false); setSelecting(false); setPendingPreset(null);
  }

  // 新建故事 = 全新的创作工作区(独立于进行中的游戏,不动游戏卡组 / 会话)。
  function onNew() {
    setBChars([]); setBWorlds([]); setBStory(null); setBPlayer(null);
    setBuildFlow(true);
    setView("build");
  }

  // 创作完成「开始故事」:把创作工作区的卡组载进一局新游戏(此时才建会话)。
  function startBuiltStory() {
    if (!bChars.length) return;
    const id = newSessionId();
    persistSaves([{ id, name: (bStory && bStory.title) || (bChars[0] && bChars[0].data && bChars[0].data.name) || "新故事", updated: "", turns: 0, summary: (bStory && bStory.title) || "" }, ...loadSaves()]);
    setActiveId(id);
    resetGameState();
    setCharacters(bChars); setWorldBooks(bWorlds); setStory(bStory); setPlayer(bPlayer);
    setSessionId(id);
    setBuildFlow(false);
    setStarted(true);
    setView("game");
  }

  // 把创作工作区存成预设(用 build deck,不是游戏 deck)。
  async function saveBuildAsPreset() {
    const name = prompt("故事名(存成预设可复用)", (bStory && bStory.title) || (bChars[0] && bChars[0].data.name) || "我的故事");
    if (name == null || !name.trim()) return;
    const synopsis = prompt("简介(可空)", (bStory && bStory.premise) || "") || "";
    const author = prompt("作者(可空)", "") || "";
    const cover = prompt("封面图片 URL(可空,留空用纯色封面)", "") || "";
    const tagSet = new Set([...((bStory && bStory.tags) || []), ...bChars.flatMap((c) => (c.data.tags || []))]);
    const tags = [...tagSet].filter(Boolean).slice(0, 5);
    try {
      await postJSON("/api/presets", { name: name.trim(), characters: bChars, world: mergeWorldBooks(bWorlds), story: bStory, player: bPlayer, mode, synopsis, author, cover, tags });
      refreshHome();
      alert("已保存为故事预设。");
    } catch (e) { alert("保存失败:" + e.message); }
  }

  // 点故事卡 → 弹详情 modal(只浏览,不建存档)。预设 + 自装配都走这同一个 modal(§2)。
  function openStoryModal(p, tab) { setStoryModal({ preset: p, tab: tab || "intro" }); }

  // 真正开始(modal 出演 tab 定身份)时才建会话 + 载入预设卡组。
  function loadPresetDeck(d) {
    const id = newSessionId();
    persistSaves([{ id, name: d.name || "未命名故事", updated: "", turns: 0, summary: d.name || "" }, ...loadSaves()]);
    setActiveId(id);
    resetGameState();
    setCharacters(d.characters || []);
    if (d.world) setWorldBooks([d.world]);
    if (d.story) setStory(d.story);
    if (d.mode === "deep") setMode("deep");
    setSessionId(id);
    setIsPreset(true);
    setPendingPreset(d);
    setAssembling(false);
  }

  // modal 出演 tab 定身份(playable / 自定义识别结果 / null=作者直接开始)→ 载卡组 + 开玩。
  function startFromModal(playerCard) {
    if (!storyModal) return;
    loadPresetDeck(storyModal.preset.data || {});
    setStoryModal(null);
    startWithPlayer(playerCard);   // setPlayer(if any) + 移除同名 NPC + selecting=false + started=true
    setView("game");
  }

  // coach marks「开始新手教学」CTA:开《新人入店》modal 直接落出演 tab → select 引导接力(闭环)。
  function startTutorial() {
    const t = presets.find(isTutorialPreset);
    setCoachRun(null);
    if (t) openStoryModal(t, "intro");   // 从简介开始,逐 section 走查,不直接进出演
    else { setView("home"); alert("没找到教学故事《新人入店》。请先导入:python scripts/import_story.py <新人入店文件夹>"); }
  }

  // 选人页定主角(预设候选 or 自定义识别结果):设为 player + 从 NPC 阵容拿掉同名角色,再开玩。
  function startWithPlayer(playerCard) {
    if (playerCard) {
      setPlayer(playerCard);
      const nm = playerCard.name || "";
      if (nm) setCharacters((xs) => xs.filter((c) => ((c.data && c.data.name) || "") !== nm));
    }
    setSelecting(false);
    setStarted(true);
  }

  async function deletePreset(p) {
    if (!confirm("删除这个故事预设?")) return;
    try { await fetch(`/api/presets/${encodeURIComponent(p.name)}`, { method: "DELETE" }); } catch (e) {}
    refreshHome();
  }

  // 从存档进入 = 玩家模式,不显示左侧卡组栏(作者/开发者模式未完成,暂不暴露;isPreset 当前仅控制「无卡组栏」)。
  function resumeSave(id) {
    if (id !== sessionId) setRestoring(true);   // 切到不同存档:先显示「读取存档中」,等 restore effect 拉到新局再渲染,避免慢加载时还显示上一个档
    setActiveId(id); setSessionId(id); setAssembling(false); setIsPreset(true); setSelecting(false); setView("game");
  }

  async function deleteSaveHandler(id) {
    if (!confirm("删除这局存档?不可恢复。")) return;
    try { await fetch(`/api/session/${encodeURIComponent(id)}`, { method: "DELETE" }); } catch (e) {}
    const left = loadSaves().filter((s) => s.id !== id);
    persistSaves(left);
    if (getActiveId() === id) { const nid = newSessionId(); persistSaves([{ id: nid, name: "", updated: "", turns: 0, summary: "" }, ...left]); setActiveId(nid); setSessionId(nid); resetGameState(); setStarted(false); }
    refreshHome();
  }

  async function saveAsPreset() {
    const name = prompt("故事名(存成预设可复用)", (story && story.title) || (characters[0] && characters[0].data.name) || "我的故事");
    if (name == null || !name.trim()) return;
    const synopsis = prompt("简介(可空)", (story && story.premise) || "") || "";
    const author = prompt("作者(可空)", "") || "";
    const cover = prompt("封面图片 URL(可空,留空用纯色封面)", "") || "";
    const tagSet = new Set([...((story && story.tags) || []), ...characters.flatMap((c) => (c.data.tags || []))]);
    const tags = [...tagSet].filter(Boolean).slice(0, 5);
    try {
      // playables = 选人页(CharacterSelect)的数据源;不传则自建预设进去选人页全空、"换主角"失效。
      // 至少把当前玩家卡塞进去(有 player 才有得选);无 player 留空,前端回退"自定义"。
      await postJSON("/api/presets", { name: name.trim(), characters, world, story, player,
        playables: player ? [player] : [], mode, synopsis, author, cover, tags });
      refreshHome();
      alert("已保存为故事预设。");
    } catch (e) { alert("保存失败:" + e.message); }
  }

  // 启动时尝试续玩:若该 session_id 在后端有结构化剧情 + 卡组快照,就完整还原卡组/卡片式剧情/选项/状态。
  useEffect(() => {
    let alive = true;
    fetch(`/api/session/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) { if (alive) setRestoring(false); return; }
        const structured = data.turns || [];
        const msgs = data.messages || [];
        const art = data.artifacts || {};
        const hasGame = (structured.length || msgs.length) && art.characters && art.characters.length;
        if (hasGame) {
          // 续玩进来 = 玩家模式,不显示左侧卡组栏(同 resumeSave;作者/开发者模式未完成,暂不暴露)。
          setIsPreset(true);
          setCharacters(art.characters);
          if (art.world) setWorldBooks([art.world]);
          if (art.story) setStory(art.story);
          if (art.player) setPlayer(art.player);
          if (art.mode === "deep") setMode("deep");
          // 优先结构化还原(卡片式 + 选项);旧存档没有 turns 时降级纯文本。
          setRestoredTurns(structured.length ? restoreTurns(structured) : messagesToTurns(msgs));
          setRestoredChoices(structured.length ? (structured[structured.length - 1].choices || []) : []);
          setRestoredState(data.state || null);
          setStarted(true);
        }
        setRestoring(false);
      })
      .catch(() => { if (alive) setRestoring(false); });
    return () => { alive = false; };
  }, [sessionId]);

  // 随屏即时:进入某引导屏 + 是首用 + 该屏没自动show过 → 自动放一次(略延时,等元素挂载 / 首屏 loading 撤掉)。
  useEffect(() => {
    if (restoring || !coachScreen || coachDone()) return undefined;
    if (coachSeen()[coachScreen]) return undefined;
    const t = setTimeout(() => {
      if (coachRunRef.current) return;            // 已有引导在跑,不抢
      markCoachSeen(coachScreen);
      setCoachRun({ screen: coachScreen, manual: false });
    }, 520);
    return () => clearTimeout(t);
  }, [coachScreen, restoring]);

  // 右下角「?」:重放当前屏引导(无对应屏则回退到 home 概览,目标缺失会降级为居中说明卡)。
  function replayCoach() { setCoachRun({ screen: coachScreen || "home", manual: true }); }

  if (restoring || !auth.ready) {
    return (
      <div className="app">
        <header><div><h1>叙事引擎</h1><p>读取存档中…</p></div></header>
      </div>
    );
  }

  // AUTH 开且未登录 → 标题开屏(ReconTitle);点任意进入按钮才展开现有邮箱+验证码登录表单。AUTH 关时不触发,行为同现状。
  if (auth.enabled && !auth.user) {
    if (loginShown) return <LoginView initialTab={loginShown} onAuthed={onAuthed} onBack={() => setLoginShown("")} />;
    return (
      <window.ReconTitle
        onStart={() => setLoginShown("register")} onLogin={() => setLoginShown("login")}
        onGuest={() => setLoginShown("register")} onResume={() => setLoginShown("login")} />
    );
  }

  return (
    <div className="app">
      {/* 登录后未设置昵称 → 强制设置(盖全站,不可跳过) */}
      {auth.user && !(auth.user.display_name || "").trim() && (
        <NicknameGate onDone={(nm) => setAuth((a) => ({ ...a, user: a.user ? { ...a.user, display_name: nm } : a.user }))} />
      )}

      {/* 营销门面(主页拆分出去:未登录/初次进入的 landing;登录后默认进功能页) */}
      {view === "landing" && (isMobile ? (
        <window.MLanding presets={presets} onNav={navTo} onOpenStory={openStoryModal} onNew={onNew} />
      ) : (
        <ReconShell designW={1672} designH={941}>
          <window.ReconHome presets={presets} user={auth.user}
            onNav={navTo} onOpenStory={openStoryModal} onNew={onNew}
            onLogin={() => setView("mine")} />
        </ReconShell>
      ))}

      {/* 功能版探索/故事库(登录后的主页) */}
      {view === "home" && (isMobile ? (
        <window.MExplore presets={presets} loadErr={presetsErr} onRetry={refreshHome}
          onOpenStory={openStoryModal} onNew={onNew} onNav={navTo} />
      ) : (
        <ReconShell designW={1536} designH={1024}>
          <window.ReconExplore presets={presets} user={auth.user} loadErr={presetsErr} onRetry={refreshHome}
            onOpenStory={openStoryModal} onNew={onNew} onNav={navTo} />
        </ReconShell>
      ))}

      {view === "chat" && (isMobile ? (
        <ReconChatLive presets={presets} onNav={navTo} uid={auth.user ? auth.user.id : ""} mobile />
      ) : (
        <ReconShell designW={1536} designH={1024}>
          <ReconChatLive presets={presets} onNav={navTo} uid={auth.user ? auth.user.id : ""} />
        </ReconShell>
      ))}

      {view === "mine" && (() => {
        const onAvatarUp = async (dataUri) => {
          try {
            const r = await postJSON("/api/my/avatar", { avatar: dataUri });
            setAuth((a) => ({ ...a, user: a.user ? { ...a.user, avatar: (r && r.avatar) || dataUri } : a.user }));
          } catch (e) { alert("头像上传失败:" + e.message); }
        };
        const retrySaves = () => setSavesReload((x) => x + 1);
        return isMobile ? (
          <window.MMine user={auth.user} presets={presets} saves={mineSaves} assets={myAssets}
            savesErr={savesErr} onRetrySaves={retrySaves}
            onNav={navTo} onResume={resumeSave} onNew={onNew} onLogout={onLogout} onAvatar={onAvatarUp} />
        ) : (
          <ReconShell designW={1536} designH={1024}>
            <window.ReconProfile user={auth.user} presets={presets} saves={mineSaves} assets={myAssets}
              savesErr={savesErr} onRetrySaves={retrySaves}
              onNav={navTo} onResume={resumeSave} onNew={onNew} onLogout={onLogout} onAvatar={onAvatarUp} />
          </ReconShell>
        );
      })()}

      {/* 游玩:recon 皮 + 实时引擎(StoryPanel skin=recon,引擎逻辑零改动)。只在 game 视图挂载;切走卸载,回来按 session 重拉。 */}
      {view === "game" && started && characters.length > 0 && (() => {
        const panel = (
          <StoryPanel key={sessionId} skin="recon" mobile={isMobile} onNav={navTo}
            coverArt={(pendingPreset && pendingPreset.cover) || ""}
            characters={characters} world={world} story={story} player={player} mode={mode}
            sessionId={sessionId} initialTurns={restoredTurns} initialState={restoredState} initialChoices={restoredChoices}
            goHome={() => { refreshHome(); setStarted(false); setAssembling(false); setView("home"); }}
            onTurn={() => { setTurnSeq((s) => s + 1); setSaves(loadSaves()); }} />
        );
        return isMobile ? panel : (
          <ReconShell designW={1536} designH={1024} onNav={navTo}>{panel}</ReconShell>
        );
      })()}

      {/* 当前故事·空态(recon 风格,带统一竖栏)。旧 SetupPanel 装配分支已无触发点,移除。 */}
      {view === "game" && !(started && characters.length > 0) && (isMobile ? (
        <window.MEmpty onNav={navTo} onNew={onNew} />
      ) : (
        <ReconShell designW={1536} designH={1024}>
          <div className="cv-gempty">
            <style>{`
              .cv-gempty {position:relative; width:1536px; height:1024px; overflow:hidden;
                background:repeating-linear-gradient(90deg, rgba(169,138,99,.028) 0 1px, transparent 1px 46px), #f3ece0;
                color:#2c2820; font-family:"Kaiti SC","STKaiti","KaiTi",serif;}
              .cv-gempty .mid {position:absolute; left:188px; right:0; top:0; bottom:0; display:grid; place-items:center;}
              .cv-gempty .panel {width:520px; text-align:center; background:#faf4ea; border:1px solid #ddd0b4; padding:54px 48px; position:relative;}
              .cv-gempty .panel::before {content:""; position:absolute; inset:6px; border:1px solid rgba(196,179,132,.4); pointer-events:none;}
              .cv-gempty .panel .ic {color:#a98a63; margin-bottom:18px;}
              .cv-gempty h2 {margin:0; font-family:"Songti SC","STSong","SimSun",serif; font-size:26px; letter-spacing:.12em; font-weight:700;}
              .cv-gempty .en {font-family:Georgia,serif; font-style:italic; font-size:13px; letter-spacing:.1em; color:#a98a63; margin-top:8px;}
              .cv-gempty p {font-size:14px; line-height:2; color:#6f6757; margin:18px 0 26px;}
              .cv-gempty .btns {display:flex; gap:16px; justify-content:center;}
              .cv-gempty .bm {height:50px; padding:0 30px; display:inline-flex; align-items:center; background:#34463d; color:#f3ead6; border:1px solid #283831; position:relative; cursor:pointer; font-family:"Songti SC","SimSun",serif; font-size:15px; letter-spacing:.16em;}
              .cv-gempty .bm::before {content:""; position:absolute; inset:3px; border:1px solid rgba(193,168,111,.5);}
              .cv-gempty .bo {height:50px; padding:0 28px; display:inline-flex; align-items:center; background:transparent; color:#163b57; border:1px solid #c4b388; cursor:pointer; font-family:"Songti SC","SimSun",serif; font-size:15px; letter-spacing:.16em;}
            `}</style>
            <window.ReconRail active="game" onNav={navTo} />
            <div className="mid">
              <div className="panel">
                <div className="ic"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/></svg></div>
                <h2>还没有进行中的故事</h2>
                <div className="en">No Story In Progress</div>
                <p>去「探索」取下一本书开局或续玩，<br/>或到「创作」从一张角色卡开始写你自己的故事。</p>
                <div className="btns">
                  <span className="bm" onClick={() => navTo("home")}>去探索</span>
                  <span className="bo" onClick={onNew}>去创作</span>
                </div>
              </div>
            </div>
          </div>
        </ReconShell>
      ))}

      {view === "build" && (isMobile ? (
        <ReconCreateLive onNav={navTo} refreshHome={refreshHome} mobile />
      ) : (
        <ReconShell designW={1536} designH={1024}>
          <ReconCreateLive onNav={navTo} refreshHome={refreshHome} />
        </ReconShell>
      ))}

      {storyModal && (isMobile ? (
        <window.MStoryDetail preset={storyModal.preset}
          onNav={(v) => { setStoryModal(null); navTo(v); }}
          onEnter={(role) => startFromModal(role)}
          onClose={() => setStoryModal(null)} />
      ) : (
        <ReconShell designW={1672} designH={941}>
          <window.ReconStoryDetail preset={storyModal.preset}
            onNav={(v) => { setStoryModal(null); navTo(v); }}
            onEnter={(role) => startFromModal(role)}
            onClose={() => setStoryModal(null)} />
        </ReconShell>
      ))}

      {/* 旧 coach 引导系统的锚点(data-coach)在 recon 视图里已不存在,浮窗与「?」按钮一并移除;代码保留待重接。 */}
    </div>
  );
}

// 全局渲染兜底:任何视图抛错(含 window.* 视图脚本没加载上)不再整页白屏,给出可刷新的错误卡。
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { try { console.error("[ErrorBoundary]", err, info && info.componentStack); } catch (e) {} }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f3ece0", fontFamily: '"Kaiti SC","STKaiti","KaiTi",serif', color: "#2c2820" }}>
        <div style={{ textAlign: "center", padding: "40px 48px", background: "#faf4ea", border: "1px solid #ddd0b4", maxWidth: 420 }}>
          <h2 style={{ margin: 0, letterSpacing: ".12em", fontFamily: '"Songti SC","SimSun",serif' }}>页面出了点问题</h2>
          <p style={{ color: "#6f6757", fontSize: 13, lineHeight: 2, margin: "14px 0 20px" }}>这一页没能正常渲染,刷新通常可以恢复。<br />若反复出现,请截图联系运营。</p>
          <button onClick={() => location.reload()} style={{ padding: "10px 28px", background: "#34463d", color: "#f3ead6", border: "1px solid #283831", cursor: "pointer", letterSpacing: ".2em", fontFamily: '"Songti SC","SimSun",serif' }}>刷新页面</button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(<ErrorBoundary><App /></ErrorBoundary>);

// React 已挂载(createRoot().render 同步提交),撤掉 index.html 里的首屏 loading。
// 用 setTimeout 不用 rAF:后台标签里 rAF 会被挂起,首屏 loading 就撤不掉了。
(function dropBoot() {
  const boot = document.getElementById("boot");
  if (!boot) return;
  setTimeout(() => {
    boot.classList.add("boot-hide");
    setTimeout(() => boot.remove(), 460);
  }, 60);
})();
