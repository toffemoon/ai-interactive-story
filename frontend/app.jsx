const { useEffect, useMemo, useRef, useState } = React;

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
      <label>
        名字
        <input value={data.name || ""} onChange={(e) => update("name", e.target.value)} />
      </label>
      <label>
        角色 ID
        <input value={data.character_id || ""} onChange={(e) => update("character_id", e.target.value)} placeholder="可选,留空会按名字生成" />
      </label>
      <label>
        主设定
        <textarea rows="5" value={data.description || ""} onChange={(e) => update("description", e.target.value)} />
      </label>
      <label>
        性格
        <textarea rows="4" value={data.personality || ""} onChange={(e) => update("personality", e.target.value)} />
      </label>
      <label>
        当前情境
        <textarea rows="3" value={data.scenario || ""} onChange={(e) => update("scenario", e.target.value)} />
      </label>
      <label>
        开场白
        <textarea rows="3" value={data.first_mes || ""} onChange={(e) => update("first_mes", e.target.value)} />
      </label>
      <label>
        说话范例
        <textarea rows="3" value={data.mes_example || ""} onChange={(e) => update("mes_example", e.target.value)} />
      </label>
      <label>
        说话规则,一行一条
        <textarea
          rows="5"
          value={rulesText}
          onChange={(e) => update("speech_rules", linesToList(e.target.value))}
        />
      </label>
      <label>
        标签,用逗号分隔
        <input
          value={(data.tags || []).join(", ")}
          onChange={(e) => update("tags", e.target.value.split(/[,，]/).map((x) => x.trim()).filter(Boolean))}
        />
      </label>
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
        <Row k="名字" v={d.name} /><Row k="锚点" v={d.anchor} /><Row k="核心矛盾" v={d.tension} />
        <Row k="主设定" v={d.description} /><Row k="性格" v={d.personality} /><Row k="外貌" v={d.look} />
        <Row k="情境" v={d.scenario} /><Row k="开场白" v={d.first_mes} /><Row k="说话范例" v={d.mes_example} />
        <ListBlock k="说话规则" items={d.speech_rules} /><ListBlock k="召回关键词" items={d.keys} />
        <ListBlock k="知识·公开" items={d.known_public} /><ListBlock k="知识·隐藏" items={d.known_hidden} />
        <ListBlock k="版本人格" items={d.versions} />
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

function StoryPanel({ characters, world, story, player, mode, sessionId, initialTurns, initialState, initialChoices, goHome, onTurn }) {
  const [turns, setTurns] = useState(initialTurns || []);
  const [input, setInput] = useState("");
  const [choices, setChoices] = useState(initialChoices || []);
  const [state, setState] = useState(initialState || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [streaming, setStreaming] = useState(null); // 流式中实时显示的叙事 + 角色台词 {narration, messages}
  const inputRef = useRef(null);

  const hasStoryTurn = turns.some((t) => t.kind === "story");

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

      <div className="story-feed">
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

function TopNav({ view, setView, sessionId }) {
  const tabs = [["home", "探索"], ["game", "当前故事"], ["build", "创作"], ["chat", "聊天"], ["mine", "我的"]];
  return (
    <header className="topnav">
      <div className="brand"><h1>AI 互动故事</h1></div>
      <nav className="nav-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} data-coach={k === "home" ? "nav-explore" : undefined} className={view === k ? "active" : ""} onClick={() => setView(k)}>{label}</button>
        ))}
      </nav>
      <div className="header-right">
        <span className="session">session {sessionId.slice(0, 8)}</span>
      </div>
    </header>
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
  return ((d.tags || []).includes("教学")) || (((p && p.name) || "").includes("渡口")) || ((d.name || "").includes("渡口"));
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
  // 可扮演:有 playables 用之;否则 §2 兜底=全体角色(从 NPC 卡降级出名/一句设定)
  const playables = (d.playables && d.playables.length)
    ? d.playables
    : chars.map((c) => ({ name: (c.data || {}).name || "角色", role: ((c.data || {}).description || "").slice(0, 40) }));

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
    const pub = cd.known_public || [];
    const hasMore = cd.description || cd.personality || pub.length;
    return (
      <div className="modal-char">
        <b>{cd.name || "角色"}</b>
        {cd.look ? <p className="mc-look">{cd.look}</p> : null}
        {cd.anchor ? <p>{cd.anchor}</p> : null}
        {(cd.tags || []).length ? <div className="modal-char-tags">{(cd.tags || []).slice(0, 5).map((t, i) => <span className="tag" key={i}>{t}</span>)}</div> : null}
        {hasMore ? (
          <details className="mc-more">
            <summary>展开更多</summary>
            {cd.description ? <p>{cd.description}</p> : null}
            {cd.personality ? <p className="mc-dim">{cd.personality}</p> : null}
            {pub.length ? <ul className="mc-pub">{pub.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
          </details>
        ) : null}
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
            <div className="modal-pane" data-coach="modal-chars">
              {chars.length
                ? <Carousel items={chars} render={(c) => <PublicChar c={c} />} />
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

function StoriesHome({ onNew, presets, onLaunchPreset, onDeletePreset }) {
  return (
    <section className="stories-home">
      <div className="home-hero">
        <div><h2>开始你的故事</h2><p>从一个预设故事书开局,或新建一个属于你的故事。</p></div>
        <button className="primary big" data-coach="new-story" onClick={onNew}>+ 新建故事</button>
      </div>

      <div className="home-section">
        <h3>故事书<small> 配好的世界 + 角色 + 故事,点一下开新局</small></h3>
        <div className="story-gallery" data-coach="gallery">
          {!presets.length && <p className="empty">还没有预设故事书。</p>}
          {presets.map((p, i) => (
            <StoryTile key={i} d={p.data || {}} fallbackName={p.name}
              coach={isTutorialPreset(p) ? "tutorial-tile" : undefined}
              onOpen={() => onLaunchPreset(p)}
              actions={<button className="primary" onClick={() => onLaunchPreset(p)}>开始</button>} />
          ))}
        </div>
      </div>
    </section>
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
function MineView({ saves, presets, activeId, onResume, onDeleteSave, onGoExplore, onOpenStory, onDeletePreset,
                    addCharacter, addWorld, setStory, setPlayer, completeCard, goGame }) {
  const [cardCount, setCardCount] = useState(null);
  // 只展示真正玩过/有内容的存档(过滤掉启动时登记的空占位 session)。
  const realSaves = (saves || []).filter((s) => s.turns > 0 || (s.name && s.name.trim()) || (s.summary && s.summary.trim()));

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
        <div><h2>我的</h2><p>本地保存,账号系统后续接入。</p></div>
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
    { sel: '[data-coach="tutorial-tile"]', title: "第一次来?从这局学起", body: "这就是新手教学《渡口》。点它的「开始」(或下面的按钮)进去走一遍,5 分钟摸清怎么玩——进去后我会在每一屏接着指给你看。", actionId: "tutorial", actionLabel: "开始新手教学" },
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
  const [restoredTurns, setRestoredTurns] = useState(null);
  const [restoredState, setRestoredState] = useState(null);
  const [restoredChoices, setRestoredChoices] = useState([]);
  const [view, setView] = useState("home"); // home / game / build / vault
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
  const coachScreen =
    storyModal ? "modal"
    : view === "home" ? "home"
    : view === "mine" ? "mine"
    : view === "build" ? "build"
    : view === "chat" ? "chat"
    : view === "game" ? (started && characters.length > 0 ? "story" : "gameEmpty")
    : null;
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

  // 顶部导航:点「创作」tab 直接进步骤式引导(创作界面=步骤式);其余 tab 正常切。
  function navTo(k) {
    if (k === "build") setBuildFlow(true);
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

  // coach marks「开始新手教学」CTA:开《渡口》modal 直接落出演 tab → select 引导接力(闭环)。
  function startTutorial() {
    const t = presets.find(isTutorialPreset);
    setCoachRun(null);
    if (t) openStoryModal(t, "intro");   // 从简介开始,逐 section 走查,不直接进出演
    else { setView("home"); alert("没找到教学故事《渡口》。请先在后端 seed:python _seed_tutorial.py"); }
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

  function resumeSave(id) { setActiveId(id); setSessionId(id); setAssembling(false); setIsPreset(false); setSelecting(false); setView("game"); }

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

  if (restoring) {
    return (
      <div className="app">
        <header><div><h1>AI 互动故事</h1><p>读取存档中…</p></div></header>
      </div>
    );
  }

  return (
    <div className="app">
      <TopNav view={view} setView={navTo} sessionId={sessionId} />

      {view === "home" && (
        <main className="single-view">
          <StoriesHome
            onNew={onNew}
            presets={presets}
            onLaunchPreset={openStoryModal}
            onDeletePreset={deletePreset}
          />
        </main>
      )}

      {view === "chat" && (
        <main className="single-view">
          <ChatView />
        </main>
      )}

      {view === "mine" && (
        <main className="single-view">
          <MineView
            saves={saves} presets={presets} activeId={sessionId}
            onResume={resumeSave} onDeleteSave={deleteSaveHandler} onGoExplore={() => setView("home")}
            onOpenStory={openStoryModal} onDeletePreset={deletePreset}
            addCharacter={addCharacter} addWorld={addWorld} setStory={setStory} setPlayer={setPlayer}
            completeCard={completeCardFromVault} goGame={() => setView("game")}
          />
        </main>
      )}

      {view === "game" && started && characters.length > 0 && (
        <main className={"play-layout " + ((sidebarOpen && !isPreset) ? "has-left " : "") + (railOpen ? "has-right" : "")}>
          {sidebarOpen && !isPreset && (
            <SetupPanel
              characters={characters} setCharacters={setCharacters}
              worldBooks={worldBooks} setWorldBooks={setWorldBooks}
              story={story} setStory={setStory}
              player={player} setPlayer={setPlayer}
              mode={mode} setMode={setMode}
              onStart={() => setStarted(true)}
              onSavePreset={saveAsPreset}
              playing
            />
          )}
          <div className="play-main">
            <div className="play-toolbar">
              {!isPreset && (
                <button className="side-toggle" onClick={() => setSidebarOpen((o) => !o)} title="开/关左侧卡组栏">
                  {sidebarOpen ? "◀ 收起卡组栏" : "▶ 卡组栏"}
                </button>
              )}
              <button className="side-toggle rail-toggle" data-coach="rail-toggle" onClick={() => setRailOpen((o) => !o)} title="开/关右侧状态栏">
                {railOpen ? "状态栏 ▶" : "◀ 状态栏"}
              </button>
            </div>
            <StoryPanel key={sessionId} characters={characters} world={world} story={story} player={player} mode={mode} sessionId={sessionId} initialTurns={restoredTurns} initialState={restoredState} initialChoices={restoredChoices} goHome={() => { refreshHome(); setStarted(false); setAssembling(false); setView("home"); }} onTurn={() => setTurnSeq((s) => s + 1)} />
          </div>
          {railOpen && <StateInspector sessionId={sessionId} refreshKey={turnSeq} />}
        </main>
      )}

      {view === "game" && !(started && characters.length > 0) && assembling && (
        <main>
          <SetupPanel
            characters={characters}
            setCharacters={setCharacters}
            worldBooks={worldBooks}
            setWorldBooks={setWorldBooks}
            story={story}
            setStory={setStory}
            player={player}
            setPlayer={setPlayer}
            mode={mode}
            setMode={setMode}
            onStart={() => setStarted(true)}
            onSavePreset={saveAsPreset}
            onBack={() => { refreshHome(); setAssembling(false); setView("home"); }}
          />
          <section className="story-shell standby">
            <h2>组好卡组,开始故事</h2>
            <p>左边挑/上传卡:至少一个角色,建议配上主角(玩家)卡、世界书、故事书。组好点左下「启动」。也可「保存为故事预设」下次复用。</p>
          </section>
        </main>
      )}

      {view === "game" && !(started && characters.length > 0) && !assembling && !selecting && (
        <main className="single-view">
          <section className="story-shell standby">
            <h2>还没有进行中的故事</h2>
            <p>去「首页」挑一个故事开局或续玩,或<button className="back-link" onClick={onNew}>新建一个故事</button>。</p>
          </section>
        </main>
      )}

      {view === "build" && (
        <main className="single-view">
          {buildFlow ? (
            <StepBuilder
              characters={bChars} worldBooks={bWorlds} story={bStory} player={bPlayer}
              addCharacter={(c) => setBChars((xs) => [...xs, c])} addWorld={(w) => setBWorlds((xs) => [...xs, w])}
              setCharacters={setBChars} setWorldBooks={setBWorlds} setStory={setBStory} setPlayer={setBPlayer}
              onStartStory={startBuiltStory}
              onSavePreset={saveBuildAsPreset}
              onExit={() => { setBuildFlow(false); refreshHome(); setView("home"); }}
            />
          ) : (
            <BuildView
              buildSeed={buildSeed}
              clearSeed={() => setBuildSeed({ seed: "", draft: null })}
              addCharacter={addCharacter}
              addWorld={addWorld}
              setStory={setStory}
              setPlayer={setPlayer}
              goGame={() => { setBuildSeed({ seed: "", draft: null }); setView(started ? "game" : "home"); }}
            />
          )}
        </main>
      )}

      {storyModal && (
        <StoryModal
          entry={storyModal}
          setTab={(k) => setStoryModal((m) => (m ? { ...m, tab: k } : m))}
          onClose={() => setStoryModal(null)}
          onStart={startFromModal}
        />
      )}

      <CoachHelpButton onClick={replayCoach} />
      {coachRun && (
        <CoachMarks
          key={coachRun.screen + (coachRun.manual ? "-m" : "")}
          steps={COACH[coachRun.screen] || COACH.home}
          manual={coachRun.manual}
          onDone={() => { if (coachRun.screen === "modal") setStoryModal((m) => (m ? { ...m, tab: "intro" } : m)); setCoachRun(null); }}
          onSkip={() => { if (coachRun.screen === "modal") setStoryModal((m) => (m ? { ...m, tab: "intro" } : m)); setCoachDone(); setCoachRun(null); }}
          onAction={(id) => { if (id === "tutorial") startTutorial(); else if (id === "dismiss") setCoachRun(null); else if (id === "explore") { setView("home"); setCoachRun(null); } }}
          onStep={(s) => { if (s && s.tab) setStoryModal((m) => (m ? { ...m, tab: s.tab } : m)); }}
        />
      )}
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
