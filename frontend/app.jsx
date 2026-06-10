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
    try {
      const t = getToken();
      if (t && typeof url === "string" && url.indexOf("/api/") === 0) {
        const h = new Headers(opts.headers || {});
        if (!h.has("Authorization")) h.set("Authorization", "Bearer " + t);
        opts = Object.assign({}, opts, { headers: h });
      }
    } catch (e) {}
    return _f(url, opts);
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

function loadSaves() {
  try { return JSON.parse(localStorage.getItem(SAVES_KEY)) || []; } catch (e) { return []; }
}
function persistSaves(saves) {
  try { localStorage.setItem(SAVES_KEY, JSON.stringify(saves)); } catch (e) {}
}
function getActiveId() {
  try { return localStorage.getItem(SESSION_KEY) || ""; } catch (e) { return ""; }
}
function setActiveId(id) {
  try { localStorage.setItem(SESSION_KEY, id); } catch (e) {}
}

// 确保有一个活动存档并登记;同一浏览器重开还是同一局(后端数据一直持久化)。
function loadOrCreateSessionId() {
  let id = getActiveId();
  let saves = loadSaves();
  if (!id) { id = newSessionId(); setActiveId(id); }
  if (!saves.some((s) => s.id === id)) {
    persistSaves([{ id, name: "", updated: "", turns: 0, summary: "" }, ...saves]);
  }
  return id;
}

// 新建一局:生成新 id、登记、设为活动、刷新。
function startFresh() {
  const id = newSessionId();
  persistSaves([{ id, name: "", updated: "", turns: 0, summary: "" }, ...loadSaves()]);
  setActiveId(id);
  location.reload();
}

function switchToSave(id) {
  setActiveId(id);
  location.reload();
}

function touchSave(id, patch) {
  const saves = loadSaves();
  const i = saves.findIndex((s) => s.id === id);
  if (i < 0) { persistSaves([{ id, name: "", updated: "", turns: 0, summary: "", ...patch }, ...saves]); return; }
  saves[i] = { ...saves[i], ...patch };
  persistSaves(saves);
}

function renameSave(id, name) {
  touchSave(id, { name });
}

// 删除一局:调后端删文件 + 移出本地注册表;删的是当前局就切到下一个 / 新建。
async function deleteSave(id) {
  try { await fetch(`/api/session/${encodeURIComponent(id)}`, { method: "DELETE" }); } catch (e) {}
  const saves = loadSaves().filter((s) => s.id !== id);
  persistSaves(saves);
  if (getActiveId() === id) {
    if (saves.length) setActiveId(saves[0].id);
    else { const nid = newSessionId(); persistSaves([{ id: nid, name: "", updated: "", turns: 0, summary: "" }]); setActiveId(nid); }
  }
  location.reload();
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

function SourceInput({ value, onChange, placeholder }) {
  return (
    <div className="source-input">
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      <label className="filebtn">
        上传 .txt / .md / .docx
        <input
          type="file"
          accept=".txt,.md,.docx"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files[0];
            if (f) onChange(await uploadFile(f));
          }}
        />
      </label>
    </div>
  );
}

function JsonPreview({ title, value, collapsed = false }) {
  const [open, setOpen] = useState(!collapsed);
  if (!value) return null;
  return (
    <section className="json-block">
      <button className="fold" onClick={() => setOpen(!open)}>{open ? "−" : "+"}</button>
      <h3>{title}</h3>
      {open && <pre>{JSON.stringify(value, null, 2)}</pre>}
    </section>
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

// 故事内分钟 → 第N天 HH:MM
function formatClock(minutes) {
  const m = Math.max(0, parseInt(minutes, 10) || 0);
  const day = Math.floor(m / 1440) + 1;
  const hh = String(Math.floor((m % 1440) / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `第${day}天 ${hh}:${mm}`;
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

function StoryPanel({ characters, world, story, player, mode, sessionId, initialTurns, initialState, initialChoices, goHome, onTurn, skin, coverArt }) {
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
  useEffect(() => {
    if (initialTurns && initialTurns.length) return undefined;
    let alive = true;
    fetch(`/api/session/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        const structured = data.turns || [];
        const msgs = data.messages || [];
        if (!structured.length && !msgs.length) return;   // 后端也空(全新局没玩过)→ 保持空
        setTurns(structured.length ? restoreTurns(structured) : messagesToTurns(msgs));
        setChoices(structured.length ? (structured[structured.length - 1].choices || []) : []);
        setState(data.state || null);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [sessionId]);

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
    return (
      <window.ReconPlay
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

// 右状态栏的单个栏目:默认收起,点标题展开。
function StatSection({ title, sub, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"stat-section " + (open ? "open" : "")}>
      <button className="stat-head" onClick={() => setOpen(!open)}>
        <span className="stat-caret">{open ? "−" : "+"}</span>
        <span className="stat-title">{title}</span>
        {sub ? <span className="stat-sub">{sub}</span> : null}
      </button>
      {open && <div className="stat-body">{children}</div>}
    </div>
  );
}

// 右侧状态栏:分栏目、默认收起、点击展开。数据自后端 session 拉(state + 记忆 + 用量 + 判定),
// 每回合由 refreshKey 触发刷新。历史书 / 时间线 / 地图 先占位排上(设计文档列、暂无数据源)。
function StateInspector({ sessionId, refreshKey }) {
  const [session, setSession] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!sessionId) return undefined;
    fetch(`/api/session/${sessionId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (alive) setSession(data); })
      .catch(() => { if (alive) setSession(null); });
    return () => { alive = false; };
  }, [sessionId, refreshKey]);

  const state = (session && session.state) || null;
  const shortMemory = (session && session.short_memory) || [];
  const longMemory = (session && session.long_memory) || [];
  const usageTotal = (session && session.usage_total) || 0;
  const usageLog = (session && session.usage_log) || [];
  const reasoningLog = (session && session.reasoning_log) || [];
  const lastReasoning = reasoningLog.length ? reasoningLog[reasoningLog.length - 1] : null;

  const scene = (state && state.scene) || {};
  const player = (state && state.player) || {};
  const facts = (state && state.facts) || {};
  const rels = (state && state.relationships) || [];
  const logs = (state && state.character_logs) || [];
  const timeline = (state && state.timeline) || [];

  return (
    <aside className="state-rail">
      <div className="rail-head">
        <h3>状态栏</h3>
        <span>{state ? (scene.location || "进行中") : "故事开始后更新"}</span>
      </div>

      <StatSection title="场景" sub={scene.location || ""}>
        <p><b>地点</b>{scene.location || "未定"}</p>
        <p><b>故事内时钟</b>{formatClock(state && state.clock_minutes)}{state && state.main_resolved ? " · 主线已结案" : ""}</p>
        <p><b>时间</b>{scene.time || "未定"}</p>
        <p><b>氛围</b>{scene.atmosphere || "暂无"}</p>
        <List label="在场角色" items={scene.present_characters} />
        <List label="可交互对象" items={scene.objects} />
      </StatSection>

      <StatSection title="玩家">
        <p><b>位置</b>{player.location || scene.location || "未定"}</p>
        <p><b>状态</b>{player.status || "正常"}</p>
        <List label="当前目标" items={player.active_goals} />
        <List label="物品/资源" items={player.inventory} />
        <List label="已知事实" items={player.known_facts} />
      </StatSection>

      <StatSection title="关系" sub={rels.length ? String(rels.length) : ""}>
        {rels.length ? rels.map((r, i) => (
          <div className="relation-line" key={i}>
            <b>{r.character_id}</b>
            <span>信任 {r.trust} / 紧张 {r.tension} / 好感 {r.affection}</span>
            <List items={r.notes} />
          </div>
        )) : <p>暂无关系变化</p>}
      </StatSection>

      <StatSection title="人物日志">
        {logs.length ? logs.map((log, i) => (
          <div className="relation-line" key={i}>
            <b>{log.character_id}</b>
            <List label="已知" items={log.knows} />
            <List label="印象" items={log.impressions} />
          </div>
        )) : <p>暂无人物日志</p>}
      </StatSection>

      <StatSection title="事件" sub={timeline.length ? String(timeline.length) : ""}>
        {timeline.length ? timeline.slice(0, 12).map((event, i) => (
          <p key={i}><b>{event.status}</b>{event.title || event.event_id}</p>
        )) : <p>暂无事件</p>}
        {(state && (state.reached_endings || []).length > 0) && (
          <p className="ending-reached"><b>已达成结局</b>{state.reached_endings.join(", ")}</p>
        )}
      </StatSection>

      <StatSection title="事实边界">
        <List label="已确认" items={facts.canon} />
        <List label="已披露" items={facts.revealed} />
        <List label="不确定" items={facts.uncertain} />
        <List label="禁止编造" items={facts.forbidden} />
      </StatSection>

      <StatSection title="记忆卡" sub={`长 ${longMemory.length} / 短 ${shortMemory.length}`}>
        <List label="长期记忆" items={longMemory.slice(-8).map(memoryText)} />
        <List label="短期记忆" items={shortMemory.slice(-8).map(memoryText)} />
      </StatSection>

      <StatSection title="token 用量" sub={usageTotal ? String(usageTotal) : ""}>
        <p><b>本局累计</b>{usageTotal || 0}</p>
        <List label="最近每轮合计" items={usageLog.slice(-8).map((u) =>
          `第 ${u.turn} 轮:合计 ${u.total_tokens || 0}(输入 ${u.prompt_tokens || 0} / 输出 ${u.completion_tokens || 0}${u.calls > 1 ? ` · ${u.calls} 次调用` : ""})`
        )} />
      </StatSection>

      <StatSection title="历史书"><p className="rail-soon">开发中 —— 已发生事件的完整记录(当前先看上面「事件」栏)。</p></StatSection>
      <StatSection title="时间线"><p className="rail-soon">开发中 —— 故事时间线的可视化呈现。</p></StatSection>
      <StatSection title="地图"><p className="rail-soon">开发中 —— 世界 / 场景地图(引擎暂无地图数据源)。</p></StatSection>

      <StatSection title="本轮判定" sub="调试">
        {lastReasoning ? (
          <div>
            <p><b>硬设定违背</b><span className={lastReasoning.hard_violation ? "flag-on" : ""}>{lastReasoning.hard_violation ? "是 · 已用世界内逻辑反制" : "否"}</span></p>
            {lastReasoning.world_counter && <p><b>世界反制</b>{lastReasoning.world_counter}</p>}
            {lastReasoning.ooc_risk && <p><b>OOC 风险</b>{lastReasoning.ooc_risk}</p>}
            {lastReasoning.note && <p><b>推演</b>{lastReasoning.note}</p>}
          </div>
        ) : <p>暂无判定记录</p>}
        <List label="触发过反制的轮" items={reasoningLog.filter((r) => r.hard_violation).slice(-5).map((r) => `第 ${r.turn} 轮:${r.world_counter || r.violation_detail || "硬设定违背"}`)} />
      </StatSection>
    </aside>
  );
}

function memoryText(item) {
  if (!item) return "";
  if (typeof item === "string") return item;
  const role = item.role ? `${item.role}: ` : "";
  const kind = item.kind ? `[${item.kind}] ` : "";
  return `${role}${kind}${item.text || item.content || ""}`;
}

function List({ label, items }) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return label ? <p><b>{label}</b>暂无</p> : null;
  return (
    <div className="clean-list">
      {label && <b>{label}</b>}
      <ul>{list.slice(0, 6).map((item, i) => <li key={i}>{item}</li>)}</ul>
    </div>
  );
}

function SavesMenu({ sessionId }) {
  const [open, setOpen] = useState(false);
  const [saves, setSaves] = useState(loadSaves);

  function refresh() { setSaves(loadSaves()); }

  return (
    <div className="saves-menu">
      <button className="saves-toggle" onClick={() => { refresh(); setOpen(!open); }}>
        存档 ({saves.length}) {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="saves-dropdown">
          {saves.length === 0 && <div className="save-empty">暂无存档</div>}
          {saves.map((s) => (
            <div className={"save-item " + (s.id === sessionId ? "active" : "")} key={s.id}>
              <button className="save-load" disabled={s.id === sessionId} onClick={() => switchToSave(s.id)}>
                <b>{s.name || s.summary || "未命名存档"}</b>
                <small>{(s.turns || 0) + " 轮"}{s.updated ? " · " + s.updated : ""}{s.id === sessionId ? " · 当前" : ""}</small>
              </button>
              <button className="save-op" onClick={() => {
                const n = prompt("重命名存档", s.name || s.summary || "");
                if (n != null) { renameSave(s.id, n.trim()); refresh(); }
              }}>改名</button>
              <button className="save-op" onClick={() => {
                if (confirm("删除这局存档?不可恢复。")) deleteSave(s.id);
              }}>删除</button>
            </div>
          ))}
          <button className="save-new" onClick={startFresh}>+ 新游戏</button>
        </div>
      )}
    </div>
  );
}

async function saveToVault(kind, data) {
  try { await postJSON("/api/library/save", { kind, data }); return true; }
  catch (e) { return false; }
}

// 店招(沐言书坊)—— muyan 双态:纸态店招,印章 logo + 走线选中态。
function TopNav({ view, setView, sessionId, authEnabled, user, onLogout }) {
  // 落地层店招(原型「AI Interactive Story」)。两个 tab 暂并入 home(故事库)与 chat(角色)。
  const tabs = [
    { id: "home", k: "home", label: "首页" },
    { id: "lib", k: "home", label: "故事库" },
    { id: "char", k: "chat", label: "角色" },
    { id: "create", k: "build", label: "创作" },
    { id: "mine", k: "mine", label: "我的" },
  ];
  const activeId = { home: "home", chat: "char", build: "create", mine: "mine" }[view] || "";
  const who = authEnabled ? (user ? (user.display_name || user.username) : "访客") : "";
  return (
    <header className="nv-top mu-paper-bg">
      <style>{`
        /* —— 全局暖色覆盖 + 落地层新令牌(原型调色,注入式覆盖 muyan,不改 muyan.css) —— */
        :root {
          --mu-paper:#efe8d6; --mu-paper-deep:#e3d9be; --mu-paper-bright:#f8f2e4;
          --mu-ink:#322c22; --mu-ink-soft:#6f6553; --mu-ink-faint:#9b9078;
          --mu-line:#d8cbac; --mu-line-strong:#b8a677;
          --w-navy:#2b3340; --w-navy-deep:#1d242e; --w-navy-soft:#3a4655;
          --w-gold:#b89a55; --w-gold-soft:#cbb988; --w-azure:#6f86a8; --w-amber:#c1903f;
        }
        .nv-top { display:flex; align-items:center; gap:30px; padding:0 40px; height:74px; flex:none; position:relative; z-index:30; }
        .nv-top::after { content:""; position:absolute; left:0; right:0; bottom:0; height:1.5px; background:linear-gradient(90deg,transparent,var(--mu-line-strong) 7%,var(--mu-line-strong) 93%,transparent); }
        .nv-brand { display:flex; align-items:center; gap:13px; }
        .nv-mark { width:38px; height:38px; display:grid; place-items:center; border:1px solid var(--w-gold); color:var(--w-navy); background:linear-gradient(150deg,var(--mu-paper-bright),var(--mu-paper-deep)); position:relative; }
        .nv-mark::after { content:""; position:absolute; inset:3px; border:1px solid var(--w-gold-soft); opacity:.5; }
        .nv-brand-tx h1 { margin:0; font-family:var(--mu-serif); font-size:18px; font-weight:700; letter-spacing:.1em; color:var(--mu-ink); white-space:nowrap; }
        .nv-sub { font-family:var(--mu-kai); font-size:11px; letter-spacing:.3em; color:var(--mu-ink-faint); }
        .nv-nav { display:flex; gap:30px; margin-left:24px; }
        .nv-nav button { font-family:var(--mu-serif); font-size:14.5px; letter-spacing:.16em; color:var(--mu-ink-soft); background:none; border:none; cursor:pointer; position:relative; padding:8px 0; }
        .nv-nav button:hover { color:var(--mu-ink); }
        .nv-nav button::after { content:""; position:absolute; left:0; right:0; bottom:2px; height:2px; background:repeating-linear-gradient(90deg,var(--w-gold) 0 7px,transparent 7px 14px); background-size:21px 2px; opacity:0; transition:opacity .3s; }
        .nv-nav button:hover::after, .nv-nav button.on::after { opacity:1; }
        body.mu-anim .nv-nav button.on::after { animation: mu-march 1.4s linear infinite; }
        .nv-nav button.on { color:var(--w-navy); font-weight:700; }
        .nv-right { display:flex; align-items:center; gap:16px; margin-left:auto; }
        .nv-icon { width:34px; height:34px; border-radius:50%; border:1px solid var(--mu-line-strong); background:none; color:var(--mu-ink-soft); display:grid; place-items:center; cursor:pointer; transition:all .2s; }
        .nv-icon:hover { border-color:var(--w-navy); color:var(--w-navy); }
        .nv-who { font-family:var(--mu-kai); font-size:12.5px; color:var(--mu-ink-soft); white-space:nowrap; }
        .nv-line { font-family:var(--mu-serif); font-size:13.5px; letter-spacing:.12em; color:var(--mu-ink-soft); background:none; border:none; cursor:pointer; padding:6px 2px; }
        .nv-line:hover { color:var(--mu-ink); }
        .nv-cta { display:inline-flex; align-items:center; gap:8px; font-family:var(--mu-serif); font-size:14px; letter-spacing:.14em; font-weight:600; color:var(--mu-paper-bright); background:var(--w-navy); border:1px solid var(--w-navy-deep); box-shadow:inset 0 0 0 1px rgba(184,154,85,.35); padding:10px 22px; cursor:pointer; transition:all .2s var(--mu-ease); white-space:nowrap; }
        .nv-cta:hover { background:var(--w-navy-deep); transform:translateY(-1px); }
        .nv-cta svg { color:var(--w-gold-soft); }
        @media (max-width:860px){ .nv-sub{ display:none; } .nv-nav{ gap:18px; margin-left:14px; } .nv-nav button{ font-size:13px; letter-spacing:.08em; } .nv-top{ gap:16px; padding:0 18px; } }
        @media (max-width:680px){ .nv-nav .nv-hideable{ display:none; } .nv-who{ display:none; } .nv-cta{ padding:9px 14px; } }
      `}</style>
      <div className="nv-brand">
        <span className="nv-mark" aria-hidden="true">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 4C12 6 8 11 6 19"/><path d="M6 19c6 0 11-4 13-10"/><path d="M5 20l3-1"/></svg>
        </span>
        <div className="nv-brand-tx">
          <h1>AI Interactive Story</h1>
          <span className="nv-sub">每个选择 · 都在书写</span>
        </div>
      </div>
      <nav className="nv-nav">
        {tabs.map((t) => (
          <button key={t.id} data-coach={t.id === "home" ? "nav-explore" : undefined}
            className={(activeId === t.id ? "on " : "") + (t.id === "lib" || t.id === "char" ? "nv-hideable" : "")}
            onClick={() => setView(t.k)}>{t.label}</button>
        ))}
      </nav>
      <div className="nv-right">
        <button className="nv-icon" title="搜索" aria-label="搜索">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        </button>
        {who && <span className="nv-who">{who}</span>}
        {authEnabled && user
          ? <button className="nv-line" onClick={onLogout}>退出</button>
          : <button className="nv-line" onClick={() => setView("mine")}>登录</button>}
        <button className="nv-cta" onClick={() => (tabs && setView("home"))}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6z"/></svg>
          开始探索
        </button>
      </div>
    </header>
  );
}

// 登录 / 注册页(AUTH_ENABLED 时未登录则全屏拦在此)。纯 JSX,无构建工具。
// 注册:邮箱 + 发送验证码 + 验证码 + 密码(可选用户名)。登录:邮箱/用户名 + 密码。
function LoginView({ onAuthed, onBack }) {
  const [tab, setTab] = useState("login");           // login | register
  const [identifier, setIdentifier] = useState("");   // 登录:邮箱或用户名
  const [email, setEmail] = useState("");             // 注册:邮箱(主身份)
  const [username, setUsername] = useState("");       // 注册:可选登录名
  const [code, setCode] = useState("");               // 注册:邮箱验证码
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
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
      const data = await authApi("/api/auth/email/send_code", { email: email.trim() });
      setCooldown(60);
      setSentHint(data.dev_code ? `验证码已发(本地测试码:${data.dev_code})` : "验证码已发到邮箱,10 分钟内有效");
    } catch (e) { setErr(e.message || "发送失败"); }
    finally { setSending(false); }
  }

  async function submit() {
    if (busy) return;
    setBusy(true); setErr("");
    try {
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
          background:center/cover no-repeat url(assets/recon/title-bg.png), linear-gradient(160deg,#27324a,#161c28 60%,#0e1118);
          font-family:"Kaiti SC","STKaiti","KaiTi",serif;}
        .cv-login::before {content:""; position:absolute; inset:0; background:rgba(10,13,20,.45);}
        @keyframes rc-login-in { from { opacity:0; transform:translateY(18px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
        .cv-login .card {position:relative; width:430px; background:linear-gradient(180deg,#f6efdd,#efe6cf);
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
      `}</style>
      <div className="card">
        {onBack && <span className="back" onClick={onBack}>‹ BACK</span>}
        <h1>叙事引擎</h1>
        <div className="sub">NARRATIVE ENGINE · SIGN IN</div>
        <div className="tabs">
          <button className={tab === "login" ? "on" : ""} onClick={() => { setTab("login"); setErr(""); }}>回到故事</button>
          <button className={tab === "register" ? "on" : ""} onClick={() => { setTab("register"); setErr(""); }}>初次到来</button>
        </div>
        {tab === "login" ? (
          <input placeholder="邮箱或用户名" value={identifier}
                 onChange={(e) => setIdentifier(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
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
        <input type="password" placeholder="密码" value={password}
               onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {err && <div className="err">{err}</div>}
        <button className="go" disabled={busy} onClick={submit}>
          {busy ? "…" : (tab === "login" ? "进入故事" : "注册并进入")}
        </button>
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

// 封面:有 cover(图片 URL 或 data-URI)就铺它,否则用渐变星空底(故事名压在上面)。
// 配色对齐 _seed_preset.py 的 starfield_cover(深蓝→紫→近黑),比纯黑封面墙耐看。
function coverStyle(cover) {
  if (cover) return { backgroundImage: `url("${cover}")`, backgroundSize: "cover", backgroundPosition: "center" };
  return { backgroundImage: "radial-gradient(120% 90% at 72% 28%, rgba(106,123,255,0.35), rgba(106,123,255,0) 60%), linear-gradient(135deg, #0b1437 0%, #27194e 55%, #070a1b 100%)" };
}

// 判断某个 preset 是不是新手教学局(给探索页那张卡打引导锚点 / startTutorial 找它都用)。
function isTutorialPreset(p) {
  const d = (p && p.data) || {};
  return ((d.tags || []).includes("教学")) || (((p && p.name) || "").includes("新人入店")) || ((d.name || "").includes("新人入店"));
}

function StoryTile({ d, fallbackName, sub, actions, coach, onOpen }) {
  const name = (d && d.name) || fallbackName || "故事";
  const cover = d && d.cover;
  return (
    <div className={"story-tile" + (onOpen ? " clickable" : "")} data-coach={coach || undefined} onClick={onOpen}>
      <div className="tile-cover" style={coverStyle(cover)}>
        {!cover && <span className="cover-title">{name.slice(0, 10)}</span>}
      </div>
      <div className="tile-body">
        <div className="tile-titlerow">
          <b>{name}</b>
          {d && d.author ? <span className="tile-author">by {d.author}</span> : null}
        </div>
        <p className="tile-syn">{(d && d.synopsis) || sub || ""}</p>
        <div className="tile-tags">
          {((d && d.tags) || []).slice(0, 4).map((t, j) => <span className="tag" key={j}>{t}</span>)}
          {d && bundleSummary(d) !== "空卡组" ? <span className="tag muted">{bundleSummary(d)}</span> : null}
        </div>
        <div className="tile-actions" onClick={(e) => e.stopPropagation()}>{actions}</div>
      </div>
    </div>
  );
}

// 单卡轮播:一次一张 + 左右箭头 + 圆点(角色 / 出演用)。只有一张时不显箭头/点。
function Carousel({ items, render }) {
  const [i, setI] = useState(0);
  const n = (items || []).length;
  if (!n) return <p className="empty">(无)</p>;
  const idx = Math.min(i, n - 1);
  return (
    <div className="carousel">
      <div className="carousel-row">
        {n > 1 && <button className="carousel-arrow" onClick={() => setI((x) => (x - 1 + n) % n)} aria-label="上一张">‹</button>}
        <div className="carousel-stage">{render(items[idx], idx)}</div>
        {n > 1 && <button className="carousel-arrow" onClick={() => setI((x) => (x + 1) % n)} aria-label="下一张">›</button>}
      </div>
      {n > 1 && (
        <div className="carousel-dots">
          {items.map((_, k) => <button key={k} className={"dot" + (k === idx ? " on" : "")} onClick={() => setI(k)} aria-label={`第 ${k + 1} 张`} />)}
        </div>
      )}
    </div>
  );
}

// 故事详情 modal(§1):点故事卡弹出,4 tab(简介 / 故事背景 / 角色 / 出演)。
// 【剧透边界·硬约束】简介 / 故事 / 角色只渲染公开层(白名单字段);known_hidden、versions、隐藏事件、
// 主线 / 事件 / 结局 / 角色边界 等一律不进 modal。出演 tab = 选身份(取代旧整页选人页),自带 coach 锚点。
function StoryModal({ entry, setTab, onClose, onStart }) {
  const preset = entry.preset;
  const tab = entry.tab;
  const d = (preset && preset.data) || {};
  const name = d.name || (preset && preset.name) || "故事";
  const synopsis = d.synopsis || (d.story && d.story.premise) || "";     // §2 降级:无 synopsis 取 premise
  const author = d.author || "";
  const tags = d.tags || [];
  const premise = (d.story && d.story.premise) || "";
  const worldEntries = (((d.world && d.world.entries) || [])).filter((e) => (e.visibility || "public") === "public"); // 只公开条目
  const chars = d.characters || [];
  // 详情「角色」tab 与出演兜底只取有展示内容(外貌/性格)的角色;次要NPC名册卡(内容全空的空壳)过滤掉,不当空角色卡显示。
  // 根治需引擎侧补「次要NPC名册解析」(现 parse_character 不认名册结构,内容没 parse 进来)——已记入给 Gengyue 的引擎待办。
  const shownChars = chars.filter((c) => { const cd = (c && c.data) || c || {}; return cd.look || cd.personality; });
  // 可扮演:有 playables 用之;否则 §2 兜底=全体角色(从 NPC 卡降级出名/一句设定)
  const playables = (d.playables && d.playables.length)
    ? d.playables
    : shownChars.map((c) => ({ name: (c.data || {}).name || "角色", role: ((c.data || {}).description || "").slice(0, 40) }));

  const TABS = [["intro", "简介"], ["bg", "故事背景"], ["chars", "角色"], ["cast", "出演"]];
  const [castMode, setCastMode] = useState("list"); // list | custom
  const [customText, setCustomText] = useState("");
  const [loading, setLoading] = useState(false);

  async function startCustom() {
    if (!customText.trim()) return;
    setLoading(true);
    try { onStart(await postJSON("/api/identify_player", { text: customText })); }
    catch (e) { alert("识别失败:" + e.message); }
    setLoading(false);
  }

  // 角色公开层白名单:名 / 外貌锚点 / 一句话锚点 / 标签 = 基础(默认只显示这些);
  // 主设定 / 性格 / 公开可知收进「展开更多」(详情默认只讲基础,不铺全文)。
  // anchor 是 §0 引擎摘要的公开一句话(不含 L4);绝不渲染 known_hidden、versions、tension、scenario、first_mes。
  function PublicChar({ c }) {
    const cd = (c && c.data) || c || {};
    const [flipped, setFlipped] = useState(false);
    return (
      <div className={"modal-char flip" + (flipped ? " flipped" : "")}>
        <div className="flip-inner">
          <div className="flip-face flip-front">
            <div className="mc-scroll">
              <div className="mc-name">{cd.name || "角色"}</div>
              {cd.look ? (
                <div className="mc-block"><div className="mc-sub">外貌</div><p>{cd.look}</p></div>
              ) : null}
              {cd.personality ? (
                <div className="mc-block"><div className="mc-sub">性格</div><p>{cd.personality}</p></div>
              ) : null}
            </div>
            <button className="flip-btn" onClick={() => setFlipped(true)} aria-label="翻到背面看角色图" title="看角色图">↻</button>
          </div>
          <div className="flip-face flip-back">
            {cd.image
              ? <img src={cd.image} alt={cd.name || "角色"} />
              : <div className="flip-img-placeholder">暂无角色图</div>}
            <button className="flip-btn" onClick={() => setFlipped(false)} aria-label="翻回正面看设定" title="返回设定">↺</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="story-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-cover" style={coverStyle(d.cover)}>
          {!d.cover && <span className="modal-cover-title">{name}</span>}
          <button className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="modal-tabs" data-coach="modal-tabs">
          {TABS.map(([k, label]) => (
            <button key={k} data-coach={"modal-tab-" + k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
        <div className="modal-body">
          {tab === "intro" && (
            <div className="modal-pane">
              <div className="pane-scroll modal-intro" data-coach="modal-intro">
                <h3>{name}</h3>
                <div className="modal-meta">{author ? <span>作者 {author}</span> : null}<span>{bundleSummary(d)}</span></div>
                <p className="modal-syn">{synopsis || "(暂无简介)"}</p>
                <div className="modal-tags">{tags.map((t, i) => <span className="tag" key={i}>{t}</span>)}</div>
              </div>
              <div className="pane-footer"><button className="primary modal-cta" onClick={() => setTab("cast")}>选身份 · 开始 →</button></div>
            </div>
          )}
          {tab === "bg" && (
            <div className="modal-pane">
              <div className="pane-scroll modal-bg" data-coach="modal-bg">
                <h4>前情</h4>
                <p>{premise || "(这个故事还没写前情简介)"}</p>
                {worldEntries.length > 0 && (
                  <>
                    <h4>世界设定</h4>
                    {/* 只露最核心的几条公开条目(滚动看),不把世界书全抖出来。 */}
                    {worldEntries.slice(0, 3).map((e, i) => (
                      <div className="modal-world-entry" key={i}>
                        <b>{e.comment || (e.keys || []).join(" / ") || "设定"}</b>
                        <p>{e.content || ""}</p>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
          {tab === "chars" && (
            <div className="modal-pane modal-pane-chars" data-coach="modal-chars">
              {shownChars.length
                ? <Carousel items={shownChars} render={(c, i) => <PublicChar key={i} c={c} />} />
                : <div className="pane-scroll"><p className="empty">(没有登场人物信息)</p></div>}
            </div>
          )}
          {tab === "cast" && (castMode === "custom" ? (
            <div className="modal-pane">
              <div className="pane-scroll modal-cast-custom">
                <p className="cs-sub">写下你要扮演的角色:身份、背景、目标、能力、限制、开局已知……AI 会把它识别成演出卡。</p>
                <textarea className="cs-textarea" rows="6" value={customText} onChange={(e) => setCustomText(e.target.value)}
                  placeholder="例:一个流落异乡的年轻铁匠,为寻失散的妹妹而来,擅长锻造与观察……" />
                <label className="filebtn">上传 .txt / .md / .docx
                  <input type="file" accept=".txt,.md,.docx" style={{ display: "none" }}
                    onChange={async (e) => { const f = e.target.files[0]; if (f) setCustomText(await uploadFile(f)); }} />
                </label>
                <div className="cs-actions">
                  <button className="primary" disabled={loading || !customText.trim()} onClick={startCustom}>{loading ? "识别中…" : "用这个角色开始"}</button>
                  <button className="ghost" onClick={() => setCastMode("list")}>← 返回</button>
                </div>
              </div>
            </div>
          ) : (
            <div className="modal-pane">
              <div className="cast-carousel" data-coach="select-grid">
                <Carousel items={playables} render={(p) => (
                  <div className="cast-card">
                    <b>{p.name || "未命名"}</b>
                    <span className="cast-role">{p.role || ""}</span>
                    <button className="primary" onClick={() => onStart(p)}>以 TA 开始</button>
                  </div>
                )} />
              </div>
              <div className="pane-footer cast-extra">
                <button className="ghost" data-coach="select-custom" onClick={() => setCastMode("custom")}>自定义角色</button>
                <button className="ghost" onClick={() => onStart(null)}>直接开始(不指定主角)</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// —— muyan 封面墙:做旧纸·错位微倾的 CSS 色块封面(刻意少图,走线条风)——
const HM_COVERS = [
  { c: "#2b2620", tone: "#ece4d0" }, { c: "#b5402e", tone: "#f2e8d4" },
  { c: "#33474a", tone: "#e7e0cc" }, { c: "#5e5039", tone: "#ece4d0" }, { c: "#8a753f", tone: "#f0e9d6" },
];
const HM_ROT = [-1.2, 0.8, -0.6, 1.1, -0.9, 1.4];
const HM_OFF = [0, 26, 8, 30, 4, 24];
function pName(p) { return (p && p.data && p.data.name) || (p && p.name) || "故事"; }
function pField(p, k) { return (p && p.data && p.data[k]); }

function HmBook({ p, i, isNew, coach, onOpen }) {
  const cov = isNew ? { c: "#ddd1b6", tone: "#8e3122" } : HM_COVERS[i % HM_COVERS.length];
  const name = pName(p);
  const author = pField(p, "author") || "店内收录";
  const tags = pField(p, "tags") || [];
  const tag = tags.slice(0, 2).join(" · ") || ((pField(p, "characters") || []).length + " 角色");
  return (
    <div className="hm-book mu-in" data-coach={coach || undefined} onClick={onOpen}
         style={{ animationDelay: (300 + i * 80) + "ms", marginTop: HM_OFF[i % HM_OFF.length], "--rot": HM_ROT[i % HM_ROT.length] + "deg" }}>
      <div className="hm-cover" style={{ background: cov.c, color: cov.tone }}>
        <span className="hm-cover-rule"></span>
        <span className="mu-vtext hm-cover-title">{name.slice(0, 8)}</span>
        <span className="mu-vtext hm-cover-author">{author}</span>
        {isNew && <span className="hm-new">本周新进</span>}
      </div>
      <div className="hm-book-meta"><b>{name}</b><span>{tag}</span></div>
    </div>
  );
}

// 场景缩略占位(真插画后填):一组冷暖各异的渐变,模拟二游场景封面。
const LH_SCENES = [
  "radial-gradient(120% 90% at 32% 18%, #9fb6d8, transparent 60%), linear-gradient(160deg,#43577a,#27344c)",
  "radial-gradient(120% 90% at 68% 22%, #d8c592, transparent 60%), linear-gradient(160deg,#5a4a36,#2f2719)",
  "radial-gradient(120% 90% at 38% 18%, #88b6a0, transparent 60%), linear-gradient(160deg,#2e4b44,#163029)",
  "radial-gradient(120% 90% at 62% 22%, #c79aa8, transparent 60%), linear-gradient(160deg,#5b3a4a,#2c1f29)",
  "radial-gradient(120% 90% at 34% 20%, #a59cce, transparent 60%), linear-gradient(160deg,#3a3560,#211d3a)",
];
function LhIco({ name }) {
  const p = {
    char: <><circle cx="12" cy="8" r="4" /><path d="M5 21c0-4 3.4-6 7-6s7 2 7 6" /></>,
    world: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" /></>,
    branch: <><circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="6" r="2.4" /><circle cx="12" cy="19" r="2.4" /><path d="M6 8.4v1.6c0 3 6 3 6 6.4M18 8.4v1.6c0 3-6 3-6 6.4" /></>,
    bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  }[name];
  return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{p}</svg>;
}

function StoriesHome({ onNew, presets, onLaunchPreset, onDeletePreset }) {
  const list = presets || [];
  const tutorial = list.find(isTutorialPreset);
  const featured = list.find((p) => !isTutorialPreset(p)) || list[0] || null;
  const fsyn = featured ? (pField(featured, "synopsis") || (pField(featured, "story") && pField(featured, "story").premise) || "") : "";
  const rowRef = React.useRef(null);
  const scrollRow = (dx) => { const el = rowRef.current; if (el) el.scrollBy({ left: dx, behavior: "smooth" }); };
  const FEATURES = [
    { t: "角色卡", en: "CHARACTER", d: "为每个角色立心立志,AI 据此说话行事。", icon: "char" },
    { t: "世界书", en: "WORLD", d: "设定写进世界书,叙事始终自洽。", icon: "world" },
    { t: "多结局", en: "ENDINGS", d: "你的选择被记住,结局因你分叉。", icon: "branch" },
    { t: "即时互动", en: "REALTIME", d: "自由输入行动与台词,故事即时回应。", icon: "bolt" },
  ];
  return (
    <div className="mu-paper-bg lh-root">
      <style>{`
        .lh-root { position:relative; height:100%; min-height:0; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; }
        .lh-root::-webkit-scrollbar { width:10px; } .lh-root::-webkit-scrollbar-thumb { background:var(--mu-line-strong); }
        /* —— HERO —— */
        .lh-hero { position:relative; display:grid; grid-template-columns:minmax(0,1.04fr) minmax(0,1fr); gap:26px; align-items:center; padding:40px 56px 30px 84px; }
        .lh-page { position:absolute; left:40px; top:48px; display:flex; flex-direction:column; align-items:center; gap:8px; }
        .lh-page b { font-family:var(--mu-serif); font-size:22px; font-weight:700; color:var(--w-navy); }
        .lh-page i { width:1px; height:40px; background:var(--mu-line-strong); display:block; }
        .lh-page span { font-family:var(--mu-serif); font-size:12px; letter-spacing:.1em; color:var(--mu-ink-faint); }
        .lh-kicker { display:flex; align-items:center; gap:14px; }
        .lh-kicker .ln { width:52px; height:1px; background:var(--w-gold); }
        .lh-title { font-family:var(--mu-serif); font-weight:900; font-size:52px; line-height:1.22; letter-spacing:.03em; color:var(--mu-ink); margin:16px 0 0; }
        .lh-title em { font-style:normal; color:var(--w-amber); position:relative; }
        .lh-title em::after { content:""; position:absolute; left:0; right:0; bottom:5px; height:9px; background:rgba(193,144,63,.2); z-index:-1; }
        .lh-lead { font-family:var(--mu-kai); font-size:15.5px; line-height:2; color:var(--mu-ink-soft); max-width:444px; margin:20px 0 0; }
        .lh-cta { display:flex; align-items:center; gap:18px; margin-top:28px; }
        .lh-btn-main { display:inline-flex; align-items:center; gap:9px; font-family:var(--mu-serif); font-size:15px; font-weight:600; letter-spacing:.14em; color:var(--mu-paper-bright); background:var(--w-navy); border:1px solid var(--w-navy-deep); box-shadow:inset 0 0 0 1px rgba(184,154,85,.4), 3px 4px 0 rgba(43,38,32,.16); padding:13px 30px; cursor:pointer; transition:transform .2s var(--mu-ease),box-shadow .2s; }
        .lh-btn-main:hover { transform:translateY(-2px); box-shadow:inset 0 0 0 1px rgba(184,154,85,.55), 4px 7px 0 rgba(43,38,32,.18); }
        .lh-btn-main svg { color:var(--w-gold-soft); }
        .lh-btn-out { font-family:var(--mu-serif); font-size:15px; font-weight:600; letter-spacing:.14em; color:var(--w-navy); background:none; border:1px solid var(--mu-line-strong); padding:13px 26px; cursor:pointer; transition:all .2s; }
        .lh-btn-out:hover { border-color:var(--w-navy); background:var(--mu-paper-bright); }
        /* —— HERO ART(立绘/场景占位) —— */
        .lh-art { position:relative; height:368px; }
        .lh-art-book { position:absolute; left:13%; right:13%; top:7%; bottom:7%; background:linear-gradient(160deg,#f4eddb,#e2d6ba); border:1px solid var(--mu-line-strong); box-shadow:0 32px 64px -36px rgba(43,38,32,.55); display:grid; place-items:center; }
        .lh-art-book::before { content:""; position:absolute; left:50%; top:7%; bottom:7%; width:1px; background:linear-gradient(180deg,transparent,var(--mu-line-strong),transparent); }
        .lh-art-scene { width:60%; height:54%; position:relative; box-shadow:inset 0 0 0 6px rgba(248,242,228,.85), 0 10px 24px -10px rgba(43,38,32,.5); }
        .lh-art-scene::after { content:"场景 / 立绘 待补"; position:absolute; left:0; right:0; bottom:9px; text-align:center; font-family:var(--mu-kai); font-size:10px; letter-spacing:.24em; color:rgba(248,242,228,.72); }
        .lh-art-tag { position:absolute; left:7%; top:13%; z-index:3; background:var(--mu-paper-bright); border:1px solid var(--w-gold); color:var(--w-navy); font-family:var(--mu-serif); font-size:11px; letter-spacing:.16em; padding:6px 12px; box-shadow:3px 3px 0 rgba(43,38,32,.12); --r:0deg; animation:lhFloat 6s ease-in-out infinite; }
        .lh-float { position:absolute; width:92px; height:116px; z-index:2; border:1px solid var(--mu-line-strong); box-shadow:0 16px 32px -16px rgba(43,38,32,.55); }
        .lh-float::after { content:""; position:absolute; inset:5px; border:1px solid rgba(248,242,228,.45); }
        .lh-float.a { right:1%; top:5%; --r:5deg; animation:lhFloat 7s ease-in-out infinite; }
        .lh-float.b { right:7%; bottom:1%; --r:-6deg; animation:lhFloat 8s ease-in-out .9s infinite; }
        .lh-spark { position:absolute; color:var(--w-gold); animation:lhTwinkle 3.2s ease-in-out infinite; }
        @keyframes lhFloat { 0%,100% { transform:translateY(0) rotate(var(--r,0deg)); } 50% { transform:translateY(-12px) rotate(var(--r,0deg)); } }
        @keyframes lhTwinkle { 0%,100% { opacity:.22; transform:scale(.65); } 50% { opacity:.9; transform:scale(1); } }
        /* —— 区段标题 —— */
        .lh-sec { padding:8px 56px 0; }
        .lh-sec-h { display:flex; align-items:baseline; gap:14px; }
        .lh-sec-h h3 { margin:0; font-family:var(--mu-serif); font-size:19px; font-weight:700; letter-spacing:.2em; color:var(--mu-ink); white-space:nowrap; }
        .lh-sec-h .mu-dash { flex:1; align-self:center; }
        .lh-arrows { display:flex; gap:8px; }
        .lh-arrows button { width:30px; height:30px; border:1px solid var(--mu-line-strong); background:none; color:var(--mu-ink-soft); cursor:pointer; display:grid; place-items:center; font-size:16px; line-height:1; transition:all .2s; }
        .lh-arrows button:hover { border-color:var(--w-navy); color:var(--w-navy); }
        /* —— 精选故事横滑 —— */
        .lh-row { display:flex; gap:20px; margin-top:18px; overflow-x:auto; padding:4px 2px 16px; }
        .lh-row::-webkit-scrollbar { height:7px; } .lh-row::-webkit-scrollbar-thumb { background:var(--mu-line-strong); }
        .lh-card { flex:none; width:210px; cursor:pointer; }
        .lh-card-cv { height:128px; position:relative; border:1px solid var(--mu-line-strong); box-shadow:0 10px 22px -14px rgba(43,38,32,.5); overflow:hidden; transition:transform .35s var(--mu-ease),box-shadow .35s; }
        .lh-card:hover .lh-card-cv { transform:translateY(-6px); box-shadow:0 18px 32px -16px rgba(43,38,32,.55); }
        .lh-card-cv::after { content:""; position:absolute; inset:6px; border:1px solid rgba(248,242,228,.4); pointer-events:none; }
        .lh-card-no { position:absolute; left:9px; top:7px; font-family:var(--mu-serif); font-size:12px; font-weight:700; letter-spacing:.1em; color:rgba(248,242,228,.92); }
        .lh-card-new { position:absolute; right:0; top:9px; background:var(--mu-cinnabar); color:#f5ede2; font-family:var(--mu-serif); font-size:10px; letter-spacing:.16em; padding:3px 9px; }
        .lh-card b { display:block; font-family:var(--mu-serif); font-size:15px; font-weight:600; color:var(--mu-ink); margin-top:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .lh-card .tg { font-family:var(--mu-kai); font-size:11px; color:var(--mu-ink-faint); margin-top:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .lh-card .mt { display:flex; align-items:center; gap:8px; margin-top:7px; font-family:var(--mu-kai); font-size:11px; color:var(--mu-ink-soft); }
        .lh-card .mt i { width:4px; height:4px; background:var(--w-gold); transform:rotate(45deg); font-style:normal; }
        .lh-empty { flex:none; font-family:var(--mu-kai); font-size:13px; color:var(--mu-ink-soft); padding:24px 2px; }
        .lh-empty button { margin-left:10px; }
        /* —— 产品亮点 —— */
        .lh-pillars { display:grid; grid-template-columns:repeat(4,1fr) auto; gap:18px; align-items:stretch; margin:22px 56px 30px; padding-top:22px; border-top:1px solid var(--mu-line-strong); }
        .lh-pillar { display:flex; flex-direction:column; gap:6px; padding-right:18px; border-right:1px solid var(--mu-line); }
        .lh-pillar .ic { width:40px; height:40px; display:grid; place-items:center; color:var(--w-navy); border:1px solid var(--w-gold); background:var(--mu-paper-bright); }
        .lh-pillar b { font-family:var(--mu-serif); font-size:15px; font-weight:700; color:var(--mu-ink); margin-top:6px; }
        .lh-pillar .en { font-family:var(--mu-serif); font-size:9px; letter-spacing:.3em; color:var(--mu-ink-faint); }
        .lh-pillar p { margin:3px 0 0; font-family:var(--mu-kai); font-size:11.5px; line-height:1.7; color:var(--mu-ink-soft); }
        .lh-stat { display:flex; flex-direction:column; justify-content:center; padding-left:8px; min-width:134px; }
        .lh-stat b { font-family:var(--mu-serif); font-size:34px; font-weight:900; color:var(--w-navy); letter-spacing:.02em; }
        .lh-stat span { font-family:var(--mu-kai); font-size:11px; color:var(--mu-ink-soft); }
        .lh-stat .bar { height:4px; background:var(--mu-paper-deep); margin-top:9px; position:relative; }
        .lh-stat .bar i { position:absolute; left:0; top:0; bottom:0; width:82.6%; background:var(--w-gold); display:block; }
        @media (max-width:960px){
          .lh-hero { grid-template-columns:1fr; padding:26px 24px 18px; gap:6px; } .lh-page{ display:none; }
          .lh-art { height:240px; order:-1; } .lh-title{ font-size:38px; }
          .lh-sec{ padding:8px 24px 0; } .lh-pillars{ grid-template-columns:repeat(2,1fr); margin:18px 24px 26px; } .lh-stat{ grid-column:1/-1; }
        }
      `}</style>

      {/* —— HERO —— */}
      <section className="lh-hero">
        <span className="lh-page"><b>01</b><i></i><span>05</span></span>
        <div className="lh-hero-tx">
          <div className="lh-kicker mu-in" style={{ animationDelay: "60ms" }}><span className="mu-en">Interactive Narrative</span><span className="ln"></span></div>
          <h2 className="lh-title mu-in" style={{ animationDelay: "140ms" }}>进入<em>会回应</em>你的<br />故事世界</h2>
          <p className="lh-lead mu-in" style={{ animationDelay: "260ms" }}>
            与角色相遇,在动态叙事里开启一场属于你的旅程。每一个选择都被记住——故事因你而无可复制。
          </p>
          <div className="lh-cta mu-in" style={{ animationDelay: "360ms" }}>
            <button className="lh-btn-main" onClick={() => (featured ? onLaunchPreset(featured) : onNew())}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6z" /></svg>
              开始探索
            </button>
            <button className="lh-btn-out" data-coach="new-story" onClick={onNew}>立即创作</button>
          </div>
        </div>
        <div className="lh-art" aria-hidden="true">
          <span className="lh-art-tag">世界观档案 · WORLD</span>
          <div className="lh-art-book">
            <div className="lh-art-scene" style={{ background: LH_SCENES[0] }}></div>
          </div>
          <div className="lh-float a" style={{ background: LH_SCENES[2] }}></div>
          <div className="lh-float b" style={{ background: LH_SCENES[4] }}></div>
          <span className="lh-spark" style={{ left: "6%", bottom: "16%", fontSize: 16 }}>✦</span>
          <span className="lh-spark" style={{ right: "20%", top: "4%", fontSize: 12, animationDelay: "1s" }}>✦</span>
          <span className="lh-spark" style={{ left: "44%", top: "0%", fontSize: 10, animationDelay: "1.8s" }}>✦</span>
        </div>
      </section>

      {/* —— 精选故事 —— */}
      <section className="lh-sec">
        <div className="lh-sec-h mu-in" style={{ animationDelay: "440ms" }}>
          <h3>精选故事</h3>
          <span className="mu-en">Featured Stories</span>
          <span className="mu-dash live"></span>
          <div className="lh-arrows">
            <button onClick={() => scrollRow(-460)} aria-label="左滑">‹</button>
            <button onClick={() => scrollRow(460)} aria-label="右滑">›</button>
          </div>
        </div>
        <div className="lh-row" data-coach="gallery" ref={rowRef}>
          {!list.length && (
            <p className="lh-empty">书架还空着。
              <button className="lh-btn-out" style={{ padding: "8px 18px", fontSize: 13 }} onClick={onNew}>写第一本</button>
            </p>
          )}
          {list.map((p, i) => {
            const isNew = isTutorialPreset(p);
            const tags = (pField(p, "tags") || []).slice(0, 2).join(" · ");
            const nch = (pField(p, "characters") || []).length;
            return (
              <div className="lh-card mu-in" key={i} data-coach={isNew ? "tutorial-tile" : undefined}
                style={{ animationDelay: (480 + i * 70) + "ms" }} onClick={() => onLaunchPreset(p)}>
                <div className="lh-card-cv" style={{ background: LH_SCENES[i % LH_SCENES.length] }}>
                  <span className="lh-card-no">{String(i + 1).padStart(2, "0")}</span>
                  {isNew && <span className="lh-card-new">教学</span>}
                </div>
                <b>{pName(p)}</b>
                <div className="tg">{tags || "互动叙事"}</div>
                <div className="mt"><span>{nch ? nch + " 角色" : "群像"}</span><i></i><span>{pField(p, "author") || "店内收录"}</span></div>
              </div>
            );
          })}
        </div>
      </section>

      {/* —— 产品亮点 —— */}
      <section className="lh-pillars mu-in" style={{ animationDelay: "640ms" }}>
        {FEATURES.map((f) => (
          <div className="lh-pillar" key={f.t}>
            <span className="ic"><LhIco name={f.icon} /></span>
            <b>{f.t}</b>
            <span className="en">{f.en}</span>
            <p>{f.d}</p>
          </div>
        ))}
        <div className="lh-stat">
          <b className="mu-num">82.6%</b>
          <span>玩家完整走完一个结局</span>
          <div className="bar"><i></i></div>
        </div>
      </section>
    </div>
  );
}

// 聊天页(占位)——后续批次接轻量 /api/chat 引擎。
function ChatView() {
  return (
    <section className="view-shell chat-view">
      <div className="view-head"><h2>聊天</h2><p>和单个角色一对一聊天,像微信对话框。轻量引擎(不带状态机/事件/世界时钟),后续批次接入。</p></div>
      <div className="placeholder-pane" data-coach="chat-ph">
        <p className="placeholder-big">聊天功能正在搭建中</p>
        <p className="hint-line">规划:从故事库选一个角色 → 微信式对话框 → 轻量 <code>/api/chat</code> 引擎,纯角色对话,可后期融入剧情。</p>
      </div>
    </section>
  );
}

// 「我的」中心(§5/§6):把作者/个人资产从主导航收进来——存档进度 + 我建的预设 + 我的卡库。
// 第一阶段=localStorage / 本地 API 聚合壳,无账号系统(P0 属后端域,本批次不引入登录)。
// dashboard 三面板布局(yufei 模板):上排 存档表格 + 预设横排;下排整宽卡库。
function MineView({ saves, presets, activeId, authEnabled, user, onResume, onDeleteSave, onGoExplore, onOpenStory, onDeletePreset,
                    addCharacter, addWorld, setStory, setPlayer, completeCard, goGame }) {
  const [cardCount, setCardCount] = useState(null);
  const loggedIn = authEnabled && user;
  // 已登录:存档源走后端「我的存档」(跨设备,绑定账号);未登录/AUTH 关:走本地浏览器存档。
  const [serverSaves, setServerSaves] = useState(null);
  useEffect(() => {
    if (!loggedIn) { setServerSaves(null); return undefined; }
    let alive = true;
    fetch("/api/my/sessions").then((r) => (r.ok ? r.json() : [])).then((list) => {
      if (!alive) return;
      setServerSaves((list || []).map((s) => ({
        id: s.id, name: s.story || "", turns: s.turns || 0,
        summary: s.last_input || "", updated: (s.updated_at || "").replace("T", " ").slice(0, 16),
      })));
    }).catch(() => { if (alive) setServerSaves([]); });
    return () => { alive = false; };
  }, [loggedIn, activeId]);
  const source = loggedIn && serverSaves != null ? serverSaves : (saves || []);
  // 只展示真正玩过/有内容的存档(过滤掉启动时登记的空占位 session)。
  const realSaves = source.filter((s) => s.turns > 0 || (s.name && s.name.trim()) || (s.summary && s.summary.trim()));

  // 头部统计 chip 的卡库总数(角色 + 玩家 + 世界 + 故事;事件随故事书不单算)。
  useEffect(() => {
    let alive = true;
    Promise.all(["characters", "players", "worlds", "stories"].map((k) =>
      fetch(`/api/library/${k}`).then((r) => (r.ok ? r.json() : [])).catch(() => [])
    )).then((lists) => { if (alive) setCardCount(lists.reduce((n, l) => n + (l ? l.length : 0), 0)); });
    return () => { alive = false; };
  }, []);

  return (
    <section className="mine-view">
      <div className="mine-head">
        <div><h2>我的</h2><p>{loggedIn ? `已登录:${user.display_name || user.username} · 存档已绑定账号(跨设备可见)` : "本地保存(未登录)。"}</p></div>
        <div className="mine-stats">
          <span className="mine-stat"><b>{realSaves.length}</b>个存档</span>
          <span className="mine-stat"><b>{(presets || []).length}</b>个我建的故事</span>
          <span className="mine-stat"><b>{cardCount == null ? "…" : cardCount}</b>张卡</span>
        </div>
      </div>

      <div className="mine-grid">
        {/* 存档进度 */}
        <section className="mine-panel" data-coach="mine-saves">
          <div className="panel-head"><h3>存档进度</h3></div>
          {realSaves.length ? (
            <table className="saves-table">
              <thead><tr><th>故事名</th><th>轮数</th><th>最近游玩</th><th>当前局</th><th>操作</th></tr></thead>
              <tbody>
                {realSaves.map((s) => (
                  <tr key={s.id} className={s.id === activeId ? "current" : ""}>
                    <td>{s.name || s.summary || "未命名故事"}</td>
                    <td>{s.turns || 0} 轮</td>
                    <td className="save-time">{s.updated || "—"}</td>
                    <td>{s.id === activeId ? <span className="save-now-tag">当前局</span> : "—"}</td>
                    <td><div className="row-actions">
                      <button className="primary" onClick={() => onResume(s.id)}>续玩</button>
                      <button className="del" onClick={() => onDeleteSave(s.id)}>删除</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="empty-guide">
              <p>还没有故事存档。去探索挑一个故事开始,玩起来会自动存档。</p>
              <button className="primary" onClick={onGoExplore}>去探索 →</button>
            </div>
          )}
          <div className="chat-saves-ph">聊天存档 —— 聊天功能上线后在这显示</div>
        </section>

        {/* 我建的预设 */}
        <section className="mine-panel" data-coach="mine-presets">
          <div className="panel-head"><h3>我建的预设</h3></div>
          {(presets || []).length ? (
            <div className="preset-list">
              {presets.map((p, i) => {
                const d = p.data || {};
                const name = d.name || p.name || "未命名故事";
                return (
                  <div className="preset-row" key={i}>
                    <div className="preset-thumb" style={coverStyle(d.cover)}>{!d.cover && <span>{name.slice(0, 6)}</span>}</div>
                    <div className="preset-info">
                      <div className="preset-titlerow"><b>{name}</b>{d.author ? <span className="preset-author">by {d.author}</span> : null}</div>
                      <p className="preset-syn">{d.synopsis || (d.story && d.story.premise) || "(无简介)"}</p>
                      <div className="preset-tags">
                        {(d.tags || []).slice(0, 4).map((t, j) => <span className="tag" key={j}>{t}</span>)}
                        {bundleSummary(d) !== "空卡组" ? <span className="tag muted">{bundleSummary(d)}</span> : null}
                      </div>
                    </div>
                    <div className="preset-actions">
                      <button className="primary" onClick={() => onOpenStory(p)}>开始</button>
                      <button className="del" onClick={() => onDeletePreset(p)}>删除</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-guide"><p>还没有你建的故事。去「创作 / 新建故事」做一个,存成预设后会出现在这。</p></div>
          )}
        </section>
      </div>

      {/* 我的卡库(整宽) */}
      <section className="mine-panel library-panel" data-coach="mine-library">
        <div className="panel-head"><h3>我的卡库</h3></div>
        <VaultView embedded hideMyStories
          addCharacter={addCharacter} addWorld={addWorld} setStory={setStory} setPlayer={setPlayer}
          completeCard={completeCard} goGame={goGame}
          presets={presets} onLaunchPreset={onOpenStory} onDeletePreset={onDeletePreset} />
      </section>
    </section>
  );
}

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
function setCoachDone() { try { localStorage.setItem(COACH_DONE_KEY, "1"); } catch (e) {} }
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

function CoachMarks({ steps, manual, onDone, onSkip, onAction, onStep }) {
  const list = steps || [];
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState(null);
  const [pop, setPop] = useState(null);
  const step = list[idx] || null;

  // 通知外层当前步(modal 逐 tab 走查用它切到对应 tab,随后 60ms 重量锚点)。
  useEffect(() => { if (onStep && step) onStep(step); }, [idx]);

  // 量出当前步目标元素的位置(必要时先滚进视口);找不到 → rect=null,降级居中卡。
  useEffect(() => {
    if (!step) return undefined;
    function measure() {
      const el = step.sel ? document.querySelector(step.sel) : null;
      if (!el) { setRect(null); return; }
      let r = el.getBoundingClientRect();
      if (r.top < 8 || r.bottom > window.innerHeight - 8) {
        el.scrollIntoView({ block: "center", behavior: "auto" });
        r = el.getBoundingClientRect();
      }
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    }
    measure();                          // 立刻量一次
    const t = setTimeout(measure, 60);  // 布局 / 滚动后再校正一次(setTimeout 在后台标签也会触发,不用 rAF)
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [idx, step && step.sel]);

  // 据目标位置摆 popover:优先放下方,放不下放上方,再不行贴边。
  useEffect(() => {
    if (!rect) { setPop(null); return; }
    const ph = 190, pw = Math.min(320, window.innerWidth - 24);
    const vw = window.innerWidth, vh = window.innerHeight, gap = 14, m = 12;
    let top;
    if (rect.top + rect.height + gap + ph <= vh) top = rect.top + rect.height + gap;
    else if (rect.top - gap - ph >= 0) top = rect.top - gap - ph;
    else top = Math.max(m, Math.min(vh - ph - m, rect.top));
    const left = Math.max(m, Math.min(vw - pw - m, rect.left + rect.width / 2 - pw / 2));
    setPop({ top, left });
  }, [rect]);

  if (!step) return null;
  const last = idx === list.length - 1;
  return (
    <div className="coach-overlay">
      {rect
        ? <div className="coach-spot" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />
        : <div className="coach-backdrop" />}
      <div className={"coach-pop" + (rect ? "" : " center")} style={rect && pop ? { top: pop.top, left: pop.left } : undefined}>
        <div className="coach-count">{idx + 1} / {list.length}</div>
        <h4>{step.title}</h4>
        <p>{step.body}</p>
        <div className="coach-actions">
          <button className="coach-skip" onClick={manual ? onDone : onSkip}>{manual ? "关闭" : "跳过 · 不再显示"}</button>
          <span className="spacer" />
          {idx > 0 && !last && <button onClick={() => setIdx(idx - 1)}>上一步</button>}
          {step.actionId && <button className="primary" onClick={() => onAction && onAction(step.actionId)}>{step.actionLabel || "去看看"}</button>}
          {!last && <button className={step.actionId ? "" : "primary"} onClick={() => setIdx(idx + 1)}>下一步</button>}
          {last && !manual && !step.actionId && <button className="primary" onClick={onDone}>知道了</button>}
        </div>
      </div>
    </div>
  );
}

function CoachHelpButton({ onClick }) {
  return <button className="coach-help-btn" data-coach="help-btn" onClick={onClick} title="重看新手引导" aria-label="重看新手引导">?</button>;
}

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

// 角色聊天控制器:双栏——「OC」(/api/my/oc,专属原创角色) / 「角色」(预设角色)。
// 都是卡主导的一对一对话,共用 /api/chat;历史按 (栏,角色名) 维护,OC 会话 id 前缀 occhat- 区分。
function ReconChatLive({ presets, onNav }) {
  const presetCards = React.useMemo(() => {
    const out = []; const seen = new Set();
    (presets || []).forEach((p) => ((p.data && p.data.characters) || []).forEach((c) => {
      const nm = (c.data && c.data.name) || c.name; if (!nm || seen.has(nm)) return; seen.add(nm); out.push(c);
    }));
    return out;
  }, [presets]);
  const [mode, setMode] = React.useState("oc");          // oc | chars(默认先看自己的 OC,没有则自动落到角色栏)
  const [ocs, setOcs] = React.useState(null);            // null=加载中
  const [activeKey, setActiveKey] = React.useState("");  // `${mode}:${name}`
  const [byKey, setByKey] = React.useState({});
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    fetch("/api/my/oc").then((r) => (r.ok ? r.json() : { ocs: [] }))
      .then((d) => { if (!alive) return; const list = d.ocs || []; setOcs(list); if (!list.length) setMode("chars"); })
      .catch(() => { if (alive) { setOcs([]); setMode("chars"); } });
    return () => { alive = false; };
  }, []);
  const list = mode === "oc"
    ? (ocs || []).map((o) => ({ name: o.character, persona: o.persona, avatar: o.art || undefined, card: o.card, oc: true }))
    : presetCards.map((c) => ({ name: (c.data && c.data.name) || c.name, persona: c.data && c.data.persona, description: c.data && c.data.description, card: c }));
  const activeName = (activeKey.startsWith(mode + ":") ? activeKey.slice(mode.length + 1) : "") || (list[0] && list[0].name) || "";
  const activeItem = list.find((x) => x.name === activeName) || null;
  const msgKey = mode + ":" + activeName;
  const messages = byKey[msgKey] || [];
  async function send() {
    const text = input.trim();
    if (!text || !activeItem || busy) return;
    if (!activeItem.card) {
      setByKey((m) => ({ ...m, [msgKey]: [...(m[msgKey] || []), { who: activeName, text: "（这位 OC 还没有引擎角色卡，暂时只能看资料，不能对话。）" }] }));
      return;
    }
    setBusy(true);
    setByKey((m) => ({ ...m, [msgKey]: [...(m[msgKey] || []), { who: "me", text }] }));
    setInput("");
    try {
      const sid = (mode === "oc" ? "occhat-" : "chat-") + activeName;
      const r = await postJSON("/api/chat", { card: activeItem.card, session_id: sid, user: text, world: null });
      setByKey((m) => ({ ...m, [msgKey]: [...(m[msgKey] || []), { who: activeName, text: (r && r.reply) || "（无回应）" }] }));
    } catch (e) {
      setByKey((m) => ({ ...m, [msgKey]: [...(m[msgKey] || []), { who: activeName, text: "（连接出错：" + e.message + "）" }] }));
    } finally { setBusy(false); }
  }
  return (
    <window.ReconChat
      characters={list}
      activeName={activeName} messages={messages} value={input}
      onChange={setInput} onSend={send} onNav={onNav}
      onPick={(nm) => setActiveKey(mode + ":" + nm)}
      mode={mode} onMode={(m) => { setMode(m); setActiveKey(""); }}
      ocCount={(ocs || []).length} charCount={presetCards.length} />
  );
}

// 创作桌控制器:对话式建卡(/api/build_card,前端维护对话+草稿),入库走 /api/library/save。
function ReconCreateLive({ onNav, refreshHome }) {
  const KINDS = [
    { zh: "角色卡", en: "CHARACTER", k: "characters" },
    { zh: "演出卡", en: "STAGING", k: "players" },
    { zh: "设定卡 · 世界书", en: "LORE", k: "worlds" },
    { zh: "故事书", en: "STORY", k: "stories" },
    { zh: "事件卡", en: "EVENT", k: "characters" },
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
      alert("已收入卡库。");
    } catch (e) { alert("入库失败：" + e.message); }
  }
  const d = draft || {};
  const dname = d.name || (d.data && d.data.name) || "未命名";
  const LABELS = { description: "简述", personality: "性格", scenario: "情境设定", first_mes: "开场白", mes_example: "对话示例", speech_rules: "说话规则", appearance: "外貌", persona: "人设", goals: "目标", secret: "隐藏真相", background: "背景", voice: "口癖", premise: "前提", title: "标题", entries: "条目" };
  const fields = Object.keys(d).filter((k) => !["name", "character_id", "id"].includes(k)).map((k) => {
    const v = d[k];
    return { k: LABELS[k] || k, v: typeof v === "string" ? v : (Array.isArray(v) ? v.join("、") : JSON.stringify(v)), fresh: (filled || []).includes(k), hidden: /secret|隐藏|真相/i.test(k) };
  });
  return (
    <window.ReconCreate
      cardKind={ki} kinds={KINDS} onKind={setKi}
      messages={messages} value={input} onChange={setInput} onSend={send}
      draft={{ name: dname, kind: KINDS[ki].zh, fields }}
      onSaveDraft={() => alert("当前进度已在编辑中。")} onSaveCard={saveCard} onNav={onNav} />
  );
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
  const [view, setView] = useState("landing"); // landing(营销门面) / home(功能版故事库) / game / build / chat / mine
  const [loginShown, setLoginShown] = useState(false); // 标题开屏 → 点按钮才展开邮箱+验证码登录表单
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

  function refreshHome() {
    setSaves(loadSaves());
    fetch("/api/presets").then((r) => (r.ok ? r.json() : [])).then(setPresets).catch(() => setPresets([]));
  }
  useEffect(() => { refreshHome(); }, []);

  // 账户:开局查 /api/auth/me —— 判断 AUTH 是否开 + 是否已登录(token 失效则清掉)。
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (r.status === 401) { setToken(""); return { user: null, auth_enabled: true }; }
        return r.ok ? r.json() : { user: null, auth_enabled: false };
      })
      .then((d) => setAuth({ ready: true, enabled: !!d.auth_enabled, user: d.user || null }))
      .catch(() => setAuth({ ready: true, enabled: false, user: null }));
  }, []);
  function onAuthed(user, token) { setToken(token); setAuth((a) => ({ ...a, user })); setView("home"); }  // 登录后直接进功能页(故事库)
  // 已登录用户刷新页面:跳过营销门面,直接落功能页。
  useEffect(() => {
    if (auth.ready && auth.user) setView((v) => (v === "landing" ? "home" : v));
  }, [auth.ready, auth.user]);
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
    if (loginShown) return <LoginView onAuthed={onAuthed} onBack={() => setLoginShown(false)} />;
    return (
      <window.ReconTitle
        onStart={() => setLoginShown(true)} onLogin={() => setLoginShown(true)}
        onGuest={() => setLoginShown(true)} onResume={() => setLoginShown(true)} />
    );
  }

  return (
    <div className="app">
      {/* 营销门面(主页拆分出去:未登录/初次进入的 landing;登录后默认进功能页) */}
      {view === "landing" && (
        <ReconShell designW={1672} designH={941}>
          <window.ReconHome presets={presets} user={auth.user}
            onNav={navTo} onOpenStory={openStoryModal} onNew={onNew}
            onLogin={() => setView("mine")} />
        </ReconShell>
      )}

      {/* 功能版探索/故事库(登录后的主页) */}
      {view === "home" && (
        <ReconShell designW={1536} designH={1024}>
          <window.ReconExplore presets={presets} user={auth.user}
            onOpenStory={openStoryModal} onNew={onNew} onNav={navTo} />
        </ReconShell>
      )}

      {view === "chat" && (
        <ReconShell designW={1536} designH={1024}>
          <ReconChatLive presets={presets} onNav={navTo} />
        </ReconShell>
      )}

      {view === "mine" && (
        <ReconShell designW={1536} designH={1024}>
          <window.ReconProfile user={auth.user} presets={presets} saves={saves}
            onNav={navTo} onResume={resumeSave} onNew={onNew} />
        </ReconShell>
      )}

      {/* 游玩:recon 皮 + 实时引擎(StoryPanel skin=recon,引擎逻辑零改动)。只在 game 视图挂载;切走卸载,回来按 session 重拉。 */}
      {view === "game" && started && characters.length > 0 && (
        <ReconShell designW={1536} designH={1024} onNav={navTo}>
          <StoryPanel key={sessionId} skin="recon" coverArt={(pendingPreset && pendingPreset.cover) || ""}
            characters={characters} world={world} story={story} player={player} mode={mode}
            sessionId={sessionId} initialTurns={restoredTurns} initialState={restoredState} initialChoices={restoredChoices}
            goHome={() => { refreshHome(); setStarted(false); setAssembling(false); setView("home"); }}
            onTurn={() => { setTurnSeq((s) => s + 1); setSaves(loadSaves()); }} />
        </ReconShell>
      )}

      {/* 当前故事·空态(recon 风格,带统一竖栏)。旧 SetupPanel 装配分支已无触发点,移除。 */}
      {view === "game" && !(started && characters.length > 0) && (
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
      )}

      {view === "build" && (
        <ReconShell designW={1536} designH={1024}>
          <ReconCreateLive onNav={navTo} refreshHome={refreshHome} />
        </ReconShell>
      )}

      {storyModal && (
        <ReconShell designW={1672} designH={941}>
          <window.ReconStoryDetail preset={storyModal.preset}
            onNav={(v) => { setStoryModal(null); navTo(v); }}
            onEnter={(role) => startFromModal(role)}
            onClose={() => setStoryModal(null)} />
        </ReconShell>
      )}

      {/* 旧 coach 引导系统的锚点(data-coach)在 recon 视图里已不存在,浮窗与「?」按钮一并移除;代码保留待重接。 */}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

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
