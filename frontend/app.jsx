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
        <div><h3>编辑玩家设定卡</h3><span>玩家身份和开局信息会进入故事状态。</span></div>
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
  return (
    <section className="editor-panel wide-editor">
      <div className="editor-head">
        <div><h3>编辑世界书 / 设定卡</h3><span>可以把名字改成“世界书”“IPC 设定卡”“黑塔空间站设定卡”等。</span></div>
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
            <label>内容<textarea rows="5" value={entry.content || ""} onChange={(e) => updateEntry(i, "content", e.target.value)} /></label>
          </details>
        ))}
      </div>
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
  players: { label: "主角卡", title: "主角卡草稿", ph: "说说你要扮演的主角……", canFinish: (d) => !!d.name },
  worlds: { label: "设定卡", title: "设定卡草稿", ph: "说说这个世界 / 组织 / 设定……", canFinish: (d) => !!d.name && (d.entries || []).length > 0 },
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
        <Row k="名字" v={d.name} /><Row k="主设定" v={d.description} /><Row k="性格" v={d.personality} />
        <Row k="情境" v={d.scenario} /><Row k="开场白" v={d.first_mes} /><Row k="说话范例" v={d.mes_example} />
        <ListBlock k="说话规则" items={d.speech_rules} />
      </>}
      {kind === "players" && <>
        <Row k="名字" v={d.name} /><Row k="身份" v={d.role} /><Row k="背景" v={d.background} />
        <ListBlock k="目标" items={d.goals} /><ListBlock k="能力/资源" items={d.abilities} />
        <ListBlock k="限制" items={d.constraints} /><ListBlock k="开局已知" items={d.known_facts} />
      </>}
      {kind === "worlds" && <>
        <Row k="名称" v={d.name} />
        <ListBlock k="条目" items={d.entries} render={(e) => <><b>{e.comment || (e.keys || []).join("/")}</b>:{(e.content || "").slice(0, 60)}</>} />
      </>}
      {kind === "stories" && <>
        <Row k="标题" v={d.title} /><Row k="前提" v={d.premise} />
        <ListBlock k="主线" items={d.main_plot} />
        <ListBlock k="事件" items={d.events} render={(e) => e.title || e.event_id} />
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
        <div><h3>对话建卡 · {(KIND_META[kind] || {}).label || ""}</h3><span>不会写设定?聊着聊着卡就建好了。完成后自动存进卡库。</span></div>
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
  const [charText, setCharText] = useState("");
  const [worldText, setWorldText] = useState("");
  const [storyText, setStoryText] = useState("");
  const [playerText, setPlayerText] = useState("");
  const [autoText, setAutoText] = useState("");
  const [autoResult, setAutoResult] = useState(null);
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [editingCharacter, setEditingCharacter] = useState(null);
  const [editingWorld, setEditingWorld] = useState(null);
  const [showPlayerEditor, setShowPlayerEditor] = useState(false);
  const [showStoryEditor, setShowStoryEditor] = useState(false);

  const KIND_LABEL = { character: "角色卡", world: "世界书 / 设定卡", story: "故事书", player: "玩家卡" };

  function placeAuto(out) {
    const { kind, data } = out;
    if (kind === "character") { setCharacters((xs) => [...xs, data].slice(0, 3)); setEditingCharacter(Math.min(characters.length, 2)); }
    else if (kind === "world") { setWorldBooks((xs) => [...xs, data]); setEditingWorld(worldBooks.length); }
    else if (kind === "story") { setStory(data); setShowStoryEditor(true); }
    else if (kind === "player") { setPlayer(data); setShowPlayerEditor(true); }
  }

  // 一键上传:AI 判类型后路由到对应卡槽。forceKind 用于判错时改判重识别。
  async function runAuto(forceKind) {
    if (!autoText.trim() || loading) return;
    setLoading("auto");
    setError("");
    try {
      const out = await postJSON("/api/identify_auto", { text: autoText, kind: forceKind || null });
      placeAuto(out);
      const nm = out.kind === "character" ? (out.data.data || {}).name
        : out.kind === "story" ? out.data.title : out.data.name;
      setAutoResult({ kind: out.kind, name: nm || "", reason: out.reason || "", confidence: out.confidence || 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading("");
    }
  }

  async function run(kind) {
    setLoading(kind);
    setError("");
    try {
      if (kind === "char") {
        const card = await postJSON("/api/identify", { text: charText });
        setCharacters((xs) => [...xs, card].slice(0, 3));
        setEditingCharacter(Math.min(characters.length, 2));
        setCharText("");
      }
      if (kind === "world") {
        const wb = await postJSON("/api/identify_world", { text: worldText });
        setWorldBooks((xs) => [...xs, wb]);
        setEditingWorld(worldBooks.length);
        setWorldText("");
      }
      if (kind === "story") {
        setStory(await postJSON("/api/identify_story", { text: storyText }));
        setShowStoryEditor(true);
      }
      if (kind === "player") {
        setPlayer(await postJSON("/api/identify_player", { text: playerText }));
        setShowPlayerEditor(true);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading("");
    }
  }

  function removeCharacter(index) {
    setCharacters((xs) => xs.filter((_, i) => i !== index));
    setEditingCharacter((current) => {
      if (current === index) return null;
      if (current > index) return current - 1;
      return current;
    });
  }

  function updateCharacter(index, nextCard) {
    setCharacters((xs) => xs.map((card, i) => (i === index ? nextCard : card)));
  }

  function removeWorld(index) {
    setWorldBooks((xs) => xs.filter((_, i) => i !== index));
    setEditingWorld((current) => {
      if (current === index) return null;
      if (current > index) return current - 1;
      return current;
    });
  }

  function updateWorld(index, nextWorld) {
    setWorldBooks((xs) => xs.map((world, i) => (i === index ? nextWorld : world)));
  }

  const worldEntryCount = worldBooks.reduce((n, w) => n + (w.entries || []).length, 0);

  return (
    <aside className="setup">
      {onBack && (
        <div className="setup-topbar">
          <button className="back-link" onClick={onBack}>← 故事列表</button>
          <span>新建故事</span>
        </div>
      )}
      <div className="section-title">
        <span>00</span>
        <h2>一键上传</h2>
      </div>
      <div className="upload-group auto-upload">
        <div className="row-head"><h3>AI 自动分类</h3><span>不用手动选类型</span></div>
        <SourceInput value={autoText} onChange={setAutoText}
          placeholder="把任意设定文字 / 文档扔进来:角色、世界书、故事书、玩家卡都行,AI 自动判断类型并归到对应卡槽。" />
        <button onClick={() => runAuto(null)} disabled={loading || !autoText.trim()}>
          {loading === "auto" ? "识别中..." : "识别并归类"}
        </button>
        {autoResult && (
          <div className="auto-result">
            识别为 <b>{KIND_LABEL[autoResult.kind]}</b>:{autoResult.name || "(未命名)"}
            {autoResult.reason ? <small> · {autoResult.reason}</small> : null}
            <div className="auto-override">
              判错了?改判为
              {["character", "world", "story", "player"].filter((k) => k !== autoResult.kind).map((k) => (
                <button key={k} onClick={() => runAuto(k)} disabled={loading}>{KIND_LABEL[k]}</button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="section-title">
        <span>01</span>
        <h2>上传卡组</h2>
      </div>

      <div className="upload-group">
        <div className="row-head"><h3>记忆模式</h3><span>{mode === "deep" ? "深度" : "标准"}</span></div>
        <div className="mode-pick">
          <button
            type="button"
            className={"mode-btn " + (mode === "standard" ? "selected" : "")}
            onClick={() => setMode("standard")}
          >
            标准
            <small>原文 + 滚动摘要,不加载向量模型,装好即玩</small>
          </button>
          <button
            type="button"
            className={"mode-btn " + (mode === "deep" ? "selected" : "")}
            onClick={() => setMode("deep")}
          >
            深度
            <small>长对话变长后自动加载向量模型,语义召回更早剧情</small>
          </button>
        </div>
      </div>

      <div className="upload-group">
        <div className="row-head">
          <h3>角色卡</h3>
          <span>{characters.length}/3</span>
        </div>
        <SourceInput value={charText} onChange={setCharText}
          placeholder="上传角色设定。当前 v2 支持三个活跃角色。" />
        <button onClick={() => run("char")} disabled={loading || !charText.trim() || characters.length >= 3}>
          {loading === "char" ? "识别中..." : "添加角色"}
        </button>
        <div className="mini-list">
          {characters.map((c, i) => (
            <div className={"mini-item " + (editingCharacter === i ? "selected" : "")} key={i}>
              <b>{c.data.name}</b>
              <span>{(c.data.tags || []).slice(0, 3).join(" / ")}</span>
              <button onClick={() => setEditingCharacter(editingCharacter === i ? null : i)}>
                {editingCharacter === i ? "收起" : "编辑"}
              </button>
              <button onClick={() => removeCharacter(i)}>移除</button>
            </div>
          ))}
        </div>
        <CharacterEditor
          card={editingCharacter === null ? null : characters[editingCharacter]}
          index={editingCharacter}
          onChange={updateCharacter}
          onClose={() => { const c = characters[editingCharacter]; if (c) saveToVault("characters", c); setEditingCharacter(null); }}
        />
      </div>

      <div className="upload-group">
        <div className="row-head"><h3>玩家设定卡</h3><span>{player ? "已生成" : "可选"}</span></div>
        <SourceInput value={playerText} onChange={setPlayerText}
          placeholder="玩家是谁、身份、目标、能力、限制、开局知道什么。" />
        <button onClick={() => run("player")} disabled={loading || !playerText.trim()}>
          {loading === "player" ? "识别中..." : "识别玩家"}
        </button>
        {player && (
          <div className="mini-list">
            <div className={"mini-item " + (showPlayerEditor ? "selected" : "")}>
              <b>{player.name || "玩家"}</b>
              <span>{player.role || "玩家设定卡"}</span>
              <button onClick={() => setShowPlayerEditor(!showPlayerEditor)}>{showPlayerEditor ? "收起" : "编辑"}</button>
            </div>
          </div>
        )}
        <PlayerEditor player={showPlayerEditor ? player : null} onChange={setPlayer} onClose={() => { if (player) saveToVault("players", player); setShowPlayerEditor(false); }} />
      </div>

      <div className="upload-group">
        <div className="row-head"><h3>世界书 / 设定卡</h3><span>{worldBooks.length ? `${worldBooks.length} 份 / ${worldEntryCount} 条` : "可选"}</span></div>
        <SourceInput value={worldText} onChange={setWorldText}
          placeholder="世界观、派系卡、组织卡、地点卡、规则卡。可重复添加,会合并成世界书合集并进入关键词+向量召回。" />
        <button onClick={() => run("world")} disabled={loading || !worldText.trim()}>
          {loading === "world" ? "识别中..." : "添加设定卡"}
        </button>
        <div className="mini-list">
          {worldBooks.map((w, i) => (
            <div className={"mini-item " + (editingWorld === i ? "selected" : "")} key={i}>
              <b>{w.name || "设定卡"}</b>
              <span>{(w.entries || []).length} 条条目</span>
              <button onClick={() => setEditingWorld(editingWorld === i ? null : i)}>
                {editingWorld === i ? "收起" : "编辑"}
              </button>
              <button onClick={() => removeWorld(i)}>移除</button>
            </div>
          ))}
        </div>
        <WorldEditor
          world={editingWorld === null ? null : worldBooks[editingWorld]}
          index={editingWorld}
          onChange={updateWorld}
          onClose={() => { const w = worldBooks[editingWorld]; if (w) saveToVault("worlds", w); setEditingWorld(null); }}
        />
      </div>

      <div className="upload-group">
        <div className="row-head"><h3>故事书</h3><span>{story ? story.events.length + " 事件" : "建议上传"}</span></div>
        <SourceInput value={storyText} onChange={setStoryText}
          placeholder="时间线、主线剧情、事件节点、触发条件、分支后果。事件会渐进式披露。" />
        <button onClick={() => run("story")} disabled={loading || !storyText.trim()}>
          {loading === "story" ? "识别中..." : "识别故事书"}
        </button>
        {story && (
          <div className="mini-list">
            <div className={"mini-item " + (showStoryEditor ? "selected" : "")}>
              <b>{story.title || "故事书"}</b>
              <span>{(story.events || []).length} 个事件节点</span>
              <button onClick={() => setShowStoryEditor(!showStoryEditor)}>{showStoryEditor ? "收起" : "编辑"}</button>
            </div>
          </div>
        )}
        <StoryEditor story={showStoryEditor ? story : null} onChange={setStory} onClose={() => { if (story) saveToVault("stories", story); setShowStoryEditor(false); }} />
      </div>

      {error && <div className="error">{error}</div>}

      {!playing && (
        <button className="primary start" onClick={onStart} disabled={!characters.length || loading}>
          启动 v2 故事
        </button>
      )}
      {onSavePreset && (
        <button className="ghost start" onClick={onSavePreset} disabled={!characters.length}>
          保存为故事预设
        </button>
      )}
    </aside>
  );
}

function StoryPanel({ characters, world, story, player, mode, sessionId, initialTurns, initialState, initialChoices, goHome }) {
  const [turns, setTurns] = useState(initialTurns || []);
  const [input, setInput] = useState("");
  const [choices, setChoices] = useState(initialChoices || []);
  const [state, setState] = useState(initialState || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [seq, setSeq] = useState(0); // 每次回合/重生成自增,驱动状态面板重新拉取会话
  const [streamingText, setStreamingText] = useState(""); // 流式中实时显示的叙事
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
    setStreamingText("");
    const body = { characters, world, story, player, mode, session_id: sessionId, user: action, selected_choice: choice };
    try {
      let raw = "";
      let finalTurn = null;
      try {
        // 优先流式:叙事逐字蹦出来,治"干等十几秒"的感知延迟。
        finalTurn = await streamTurn(body, {
          onDelta: (t) => { raw += t; setStreamingText(extractNarration(raw)); },
        });
      } catch (streamErr) {
        // 流式不可用(老浏览器/代理缓冲等)→ 降级非流式端点,逻辑一致只是没有逐字。
        finalTurn = await postJSON("/api/story_turn", body);
      }
      if (!finalTurn) throw new Error("没有拿到回合结果");
      setStreamingText("");
      setTurns((xs) => [...xs, { kind: "story", data: finalTurn }]);
      setChoices(finalTurn.choices || []);
      setState(finalTurn.state || null);
      setSeq((s) => s + 1);
    } catch (e) {
      setStreamingText("");
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
    try {
      const out = await postJSON("/api/reroll", { session_id: sessionId });
      setTurns((xs) => xs.map((t, i) => (i === idx ? { kind: "story", data: out } : t)));
      setChoices(out.choices || []);
      setState(out.state || null);
      setSeq((s) => s + 1);
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
          <p>多角色、世界书、故事书、玩家卡、状态和记忆会共同参与生成。</p>
        </div>
        <div className="top-actions">
          {hasStoryTurn && (
            <button className="reroll" onClick={rerollLast} disabled={loading}
              title="对上一回合不满意时,丢弃它并用相同输入重新生成">
              {loading ? "重新生成中..." : "↻ 重生成上一轮"}
            </button>
          )}
          <button onClick={() => runTurn()} disabled={loading || turns.length > 0}>
            {loading && !turns.length ? "开场中..." : "生成开场"}
          </button>
        </div>
      </div>

      <div className="story-feed">
        {!turns.length && <div className="empty">点击“生成开场”，从场景而不是纯聊天开始。</div>}
        {turns.map((turn, i) => {
          if (turn.kind === "player") return <div className="player-action" key={i}>{turn.text}</div>;
          const data = turn.data;
          return (
            <article className="story-turn" key={i}>
              {data.narration && <p className="narration">{data.narration}</p>}
              {(data.messages || []).map((m, j) => (
                <div className="line" key={j}>
                  <b>{m.name || m.character_id}</b>
                  <span>{m.text}</span>
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
        {streamingText && (
          <article className="story-turn streaming">
            <p className="narration">{streamingText}<span className="caret">▋</span></p>
          </article>
        )}
        {loading && !streamingText && <div className="empty">故事引擎正在推演...</div>}
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

      <div className="composer">
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

      <StateInspector state={state} sessionId={sessionId} refreshKey={seq} />
    </section>
  );
}

function StateInspector({ state, sessionId, refreshKey }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!sessionId) return undefined;
    fetch(`/api/session/${sessionId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (alive) setSession(data); })
      .catch(() => { if (alive) setSession(null); });
    return () => { alive = false; };
  }, [sessionId, refreshKey]);

  const shortMemory = session?.short_memory || [];
  const longMemory = session?.long_memory || [];
  const usageTotal = session?.usage_total || 0;
  const usageLog = session?.usage_log || [];
  const reasoningLog = session?.reasoning_log || [];
  const lastReasoning = reasoningLog.length ? reasoningLog[reasoningLog.length - 1] : null;

  if (!state) {
    return (
      <section className="state-shell collapsed">
        <div className="state-head">
          <div>
            <h3>状态面板</h3>
            <span>故事开始后显示场景、关系、事件和记忆。</span>
          </div>
          <button onClick={() => setOpen(!open)}>{open ? "收起" : "展开"}</button>
        </div>
        {open && <div className="state-grid clean-state"><div className="state-card"><h3>等待回合</h3><p>生成开场后会记录运行状态。</p></div></div>}
      </section>
    );
  }
  const scene = state.scene || {};
  const player = state.player || {};
  const facts = state.facts || {};
  return (
    <section className={"state-shell " + (open ? "expanded" : "collapsed")}>
      <div className="state-head">
        <div>
          <h3>状态面板</h3>
          <span>{scene.location || "未定地点"} · 短期记忆 {shortMemory.length} · 长期记忆 {longMemory.length}{usageTotal ? ` · 累计 token ${usageTotal}` : ""}</span>
        </div>
        <button onClick={() => setOpen(!open)}>{open ? "收起" : "展开"}</button>
      </div>
      {open && (
        <div className="state-grid clean-state">
          <div className="state-card">
            <h3>场景</h3>
            <p><b>地点</b>{scene.location || "未定"}</p>
            <p><b>故事内时钟</b>{formatClock(state.clock_minutes)}{state.main_resolved ? " · 主线已结案" : ""}</p>
            <p><b>时间</b>{scene.time || "未定"}</p>
            <p><b>氛围</b>{scene.atmosphere || "暂无"}</p>
            <List label="在场角色" items={scene.present_characters} />
            <List label="可交互对象" items={scene.objects} />
          </div>
          <div className="state-card">
            <h3>玩家</h3>
            <p><b>位置</b>{player.location || scene.location || "未定"}</p>
            <p><b>状态</b>{player.status || "正常"}</p>
            <List label="当前目标" items={player.active_goals} />
            <List label="物品/资源" items={player.inventory} />
            <List label="已知事实" items={player.known_facts} />
          </div>
          <div className="state-card">
            <h3>关系</h3>
            {(state.relationships || []).length ? (state.relationships || []).map((r, i) => (
              <div className="relation-line" key={i}>
                <b>{r.character_id}</b>
                <span>信任 {r.trust} / 紧张 {r.tension} / 好感 {r.affection}</span>
                <List items={r.notes} />
              </div>
            )) : <p>暂无关系变化</p>}
          </div>
          <div className="state-card">
            <h3>人物日志</h3>
            {(state.character_logs || []).length ? (state.character_logs || []).map((log, i) => (
              <div className="relation-line" key={i}>
                <b>{log.character_id}</b>
                <List label="已知" items={log.knows} />
                <List label="印象" items={log.impressions} />
              </div>
            )) : <p>暂无人物日志</p>}
          </div>
          <div className="state-card">
            <h3>事件</h3>
            {(state.timeline || []).length ? (state.timeline || []).slice(0, 8).map((event, i) => (
              <p key={i}><b>{event.status}</b>{event.title || event.event_id}</p>
            )) : <p>暂无事件</p>}
            {(state.reached_endings || []).length > 0 && (
              <p className="ending-reached"><b>已达成结局</b>{(state.reached_endings || []).join(", ")}</p>
            )}
          </div>
          <div className="state-card">
            <h3>事实边界</h3>
            <List label="已确认" items={facts.canon} />
            <List label="已披露" items={facts.revealed} />
            <List label="不确定" items={facts.uncertain} />
            <List label="禁止编造" items={facts.forbidden} />
          </div>
          <div className="state-card memory-card">
            <h3>记忆卡</h3>
            <List label="长期记忆" items={longMemory.slice(-8).map(memoryText)} />
            <List label="短期记忆" items={shortMemory.slice(-8).map(memoryText)} />
          </div>
          <div className="state-card">
            <h3>token 用量</h3>
            <p><b>本局累计</b>{usageTotal || 0}</p>
            <List
              label="最近每轮合计"
              items={usageLog.slice(-8).map((u) =>
                `第 ${u.turn} 轮:合计 ${u.total_tokens || 0}(输入 ${u.prompt_tokens || 0} / 输出 ${u.completion_tokens || 0}${u.calls > 1 ? ` · ${u.calls} 次调用` : ""})`
              )}
            />
          </div>
          <div className="state-card">
            <h3>本轮判定<small className="hint"> 一致性自检 · 调试</small></h3>
            {lastReasoning ? (
              <div>
                <p><b>硬设定违背</b><span className={lastReasoning.hard_violation ? "flag-on" : ""}>{lastReasoning.hard_violation ? "是 · 已用世界内逻辑反制" : "否"}</span></p>
                {lastReasoning.world_counter && <p><b>世界反制</b>{lastReasoning.world_counter}</p>}
                {lastReasoning.ooc_risk && <p><b>OOC 风险</b>{lastReasoning.ooc_risk}</p>}
                {lastReasoning.note && <p><b>推演</b>{lastReasoning.note}</p>}
              </div>
            ) : <p>暂无判定记录</p>}
            <List
              label="触发过反制的轮"
              items={reasoningLog.filter((r) => r.hard_violation).slice(-5).map((r) => `第 ${r.turn} 轮:${r.world_counter || r.violation_detail || "硬设定违背"}`)}
            />
          </div>
        </div>
      )}
    </section>
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
  try { await postJSON("/api/library/save", { kind, data }); } catch (e) { /* 入库失败不打断 */ }
}

function TopNav({ view, setView, sessionId }) {
  const tabs = [["home", "首页"], ["game", "游戏"], ["build", "建卡"], ["vault", "卡库"]];
  return (
    <header className="topnav">
      <div className="brand"><h1>AI 互动故事</h1></div>
      <nav className="nav-tabs">
        {tabs.map(([k, label]) => (
          <button key={k} className={view === k ? "active" : ""} onClick={() => setView(k)}>{label}</button>
        ))}
      </nav>
      <div className="header-right">
        <span className="session">session {sessionId.slice(0, 8)}</span>
      </div>
    </header>
  );
}

function BuildView({ buildSeed, clearSeed, addCharacter, addWorld, setStory, setPlayer, goGame }) {
  const seeded = !!buildSeed.draft; // 从卡库「对话完善」进来:固定角色卡
  const [kind, setKind] = useState(seeded ? "characters" : null);
  const [saved, setSaved] = useState(null); // {kind, data, name}
  const [nonce, setNonce] = useState(0);

  const nameOf = (k, data) =>
    k === "characters" ? (data.data || {}).name : k === "stories" ? data.title : data.name;

  async function onComplete(draft) {
    const data = kind === "characters" ? wrapCard(draft) : draft; // 角色卡包成 Card V2 信封,其余 data 即卡
    await saveToVault(kind, data);
    setSaved({ kind, data, name: nameOf(kind, data) || "未命名" });
  }
  function useInGame() {
    const { kind: k, data } = saved;
    if (k === "characters") addCharacter(data);
    else if (k === "worlds") addWorld(data);
    else if (k === "stories") setStory(data);
    else setPlayer(data);
    goGame();
  }
  function again() { setSaved(null); clearSeed(); setKind(seeded ? "characters" : null); setNonce((n) => n + 1); }

  const PICKS = [
    ["characters", "角色卡", "故事里的 NPC 角色:性格、说话腔调"],
    ["players", "主角卡", "你扮演谁:身份、目标、能力、限制"],
    ["worlds", "设定卡", "世界观 / 组织 / 地点 / 规则 → 世界书"],
    ["stories", "故事卡", "前提 / 主线 / 事件 / 结局 → 故事书"],
  ];

  return (
    <section className="view-shell build-view">
      <div className="view-head">
        <h2>对话建卡</h2>
        <p>不会写设定?选一种卡,和 AI 聊着把它建出来。{seeded ? "(正在完善已有角色卡)" : ""}完成后自动存进卡库。</p>
      </div>
      {!kind && !saved && (
        <div className="build-pick">
          <p className="build-pick-q">想建哪种卡?</p>
          <div className="build-pick-grid">
            {PICKS.map(([k, label, desc]) => (
              <button key={k} onClick={() => setKind(k)}><b>{label}</b><small>{desc}</small></button>
            ))}
          </div>
        </div>
      )}
      {kind && !saved && (
        <CardBuilder key={kind + nonce + (seeded ? "-edit" : "-new")} kind={kind}
          seed={buildSeed.seed} initialDraft={buildSeed.draft} onComplete={onComplete}
          onClose={() => { if (seeded) goGame(); else setKind(null); }} />
      )}
      {saved && (
        <div className="build-done">
          <p>已建好并存入卡库:<b>{saved.name}</b>(<span>{(KIND_META[saved.kind] || {}).label}</span>)</p>
          <div className="build-done-actions">
            <button className="primary" onClick={useInGame}>用到当前游戏</button>
            <button onClick={again}>再建一个</button>
            <button onClick={goGame}>回游戏</button>
          </div>
        </div>
      )}
    </section>
  );
}

function VaultView({ addCharacter, addWorld, setStory, setPlayer, completeCard, goGame }) {
  const KINDS = [["characters", "角色"], ["worlds", "世界书"], ["stories", "故事书"], ["players", "玩家"]];
  const [kind, setKind] = useState("characters");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null); // {origName, data} | null

  async function load(k) {
    setLoading(true);
    try {
      const r = await fetch(`/api/library/${k}`);
      setItems(r.ok ? await r.json() : []);
    } catch (e) { setItems([]); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(kind); }, [kind]);

  function cardName(item) {
    if (kind === "characters") return (item.data.data || {}).name;
    if (kind === "stories") return item.data.title;
    return item.data.name;
  }
  function cardDesc(item) {
    if (kind === "characters") return (item.data.data || {}).description;
    if (kind === "worlds") return `${(item.data.entries || []).length} 条条目`;
    if (kind === "stories") return item.data.premise || `${(item.data.events || []).length} 个事件`;
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
    if (!confirm("从卡库删除这张卡?不可恢复。")) return;
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
      // 改了名字 → 新文件名变了,删掉旧文件免得卡库里留俩
      if (res && res.name && res.name !== editing.origName) {
        try { await fetch(`/api/library/${kind}/${encodeURIComponent(editing.origName)}`, { method: "DELETE" }); } catch (e) {}
      }
    } catch (e) {}
    setEditing(null);
    load(kind);
  }
  function switchKind(k) { setEditing(null); setKind(k); }

  return (
    <section className="view-shell vault-view">
      <div className="view-head">
        <h2>卡库</h2>
        <p>建好和上传过的卡都存在这里,挑出来用到游戏里,或点「详情/修改」看全字段并编辑(改完关闭自动存回)。</p>
      </div>
      <div className="vault-tabs">
        {KINDS.map(([k, label]) => (
          <button key={k} className={kind === k ? "active" : ""} onClick={() => switchKind(k)}>{label}</button>
        ))}
      </div>
      <div className="vault-list">
        {loading && <p className="empty">读取中…</p>}
        {!loading && !items.length && <p className="empty">这一类卡库还是空的。去「建卡」或在「游戏」页上传。</p>}
        {!loading && items.map((item, i) => (
          <div className="vault-card" key={i}>
            <div className="vc-main">
              <b>{cardName(item) || item.name}</b>
              <span>{(cardDesc(item) || "").slice(0, 70)}</span>
            </div>
            <div className="vc-actions">
              <button className="primary" onClick={() => useInGame(item)}>用到游戏</button>
              <button onClick={() => openEdit(item)}>详情/修改</button>
              {kind === "characters" && <button onClick={() => completeCard(item.data)}>对话完善</button>}
              <button className="del" onClick={() => del(item)}>删除</button>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <div className="vault-editor">
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

function hashHue(s) {
  let h = 0;
  for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
// 封面:有 cover(图片 URL 或 data-URI)就铺它,否则按故事名生成一张渐变星空封面。
function coverStyle(cover, name) {
  if (cover) return { backgroundImage: `url("${cover}")`, backgroundSize: "cover", backgroundPosition: "center" };
  const h = hashHue(name);
  return { background: `radial-gradient(120% 90% at 75% 25%, hsl(${(h + 40) % 360},55%,32%), hsl(${h},48%,12%))` };
}

function StoryTile({ d, fallbackName, sub, actions }) {
  const name = (d && d.name) || fallbackName || "故事";
  const cover = d && d.cover;
  return (
    <div className="story-tile">
      <div className="tile-cover" style={coverStyle(cover, name)}>
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
        <div className="tile-actions">{actions}</div>
      </div>
    </div>
  );
}

// 预设故事进入后的选人页:列出可玩主角(选择题)+「其他」自定义。
function CharacterSelect({ playables, storyName, onPick }) {
  const [mode, setMode] = useState("list");   // list | custom
  const [customText, setCustomText] = useState("");
  const [loading, setLoading] = useState(false);

  async function startCustom() {
    if (!customText.trim()) return;
    setLoading(true);
    try {
      onPick(await postJSON("/api/identify_player", { text: customText }));
    } catch (e) { alert("识别失败:" + e.message); }
    setLoading(false);
  }

  if (mode === "custom") {
    return (
      <section className="char-select">
        <h2>自定义你的主角</h2>
        <p className="cs-sub">写下你要扮演的角色:身份、背景、目标、能力、限制、开局已知……AI 会把它识别成主角卡。</p>
        <textarea className="cs-textarea" rows="8" value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder="例:一个流落翁法罗斯的外乡铁匠,为寻失散的妹妹而来,擅长锻造与观察,却看不懂这世界的神话与战事……" />
        <div className="cs-actions">
          <button className="primary" disabled={loading || !customText.trim()} onClick={startCustom}>
            {loading ? "识别中…" : "用这个角色开始"}
          </button>
          <button className="ghost" onClick={() => setMode("list")}>← 返回选择</button>
        </div>
      </section>
    );
  }

  return (
    <section className="char-select">
      <h2>你想扮演谁?</h2>
      {storyName && <p className="cs-sub">{storyName}</p>}
      <div className="select-grid">
        {(playables || []).map((p, i) => (
          <button key={i} className="select-card" onClick={() => onPick(p)}>
            <b>{p.name || "未命名"}</b>
            <span>{p.role || ""}</span>
          </button>
        ))}
        <button className="select-card other" onClick={() => setMode("custom")}>
          <b>其他</b>
          <span>自定义你自己的角色设定</span>
        </button>
      </div>
    </section>
  );
}

function StoriesHome({ onNew, presets, saves, onLaunchPreset, onDeletePreset, onResume, onDeleteSave }) {
  return (
    <section className="stories-home">
      <div className="home-hero">
        <div><h2>开始你的故事</h2><p>新建一个故事(挑卡组 / 上传组装),或接着玩已有的。</p></div>
        <button className="primary big" onClick={onNew}>+ 新建故事</button>
      </div>

      <div className="home-section">
        <h3>故事预设<small> 配好的卡组,点一下开新局</small></h3>
        <div className="story-gallery">
          {!presets.length && <p className="empty">还没有预设。新建故事时可「保存为故事预设」复用。</p>}
          {presets.map((p, i) => (
            <StoryTile key={i} d={p.data || {}} fallbackName={p.name}
              actions={<>
                <button className="primary" onClick={() => onLaunchPreset(p)}>开始</button>
                <button className="del" onClick={() => onDeletePreset(p)}>删除</button>
              </>} />
          ))}
        </div>
      </div>

      <div className="home-section">
        <h3>存档<small> 玩到一半的,接着玩</small></h3>
        <div className="story-gallery">
          {!saves.length && <p className="empty">还没有存档。新建故事玩起来后会自动存。</p>}
          {saves.map((s) => (
            <StoryTile key={s.id} d={{ name: s.name || s.summary || "未命名故事" }}
              sub={`${s.turns || 0} 轮${s.updated ? " · " + s.updated : ""}`}
              actions={<>
                <button className="primary" onClick={() => onResume(s.id)}>续玩</button>
                <button className="del" onClick={() => onDeleteSave(s.id)}>删除</button>
              </>} />
          ))}
        </div>
      </div>
    </section>
  );
}

function App() {
  const [characters, setCharacters] = useState([]);
  const [worldBooks, setWorldBooks] = useState([]);
  const [story, setStory] = useState(null);
  const [player, setPlayer] = useState(null);
  const [mode, setMode] = useState("standard");
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
  const [presets, setPresets] = useState([]);
  const [saves, setSaves] = useState(loadSaves);
  const world = useMemo(() => mergeWorldBooks(worldBooks), [worldBooks]);

  const addCharacter = (card) => setCharacters((xs) => [...xs, card].slice(0, 3));
  const addWorld = (wb) => setWorldBooks((xs) => [...xs, wb]);
  const completeCardFromVault = (cardData) => {
    setBuildSeed({ seed: JSON.stringify(cardData), draft: cardData.data || cardData });
    setView("build");
  };

  function refreshHome() {
    setSaves(loadSaves());
    fetch("/api/presets").then((r) => (r.ok ? r.json() : [])).then(setPresets).catch(() => setPresets([]));
  }
  useEffect(() => { refreshHome(); }, []);

  function resetGameState() {
    setCharacters([]); setWorldBooks([]); setStory(null); setPlayer(null); setMode("standard");
    setRestoredTurns(null); setRestoredState(null); setRestoredChoices([]);
    setIsPreset(false); setSelecting(false); setPendingPreset(null);
  }

  // 新建故事:开一个全新会话 + 清空卡组 → 进游戏页的组卡(assembling)。
  function onNew() {
    const id = newSessionId();
    setActiveId(id);
    resetGameState();
    setSessionId(id);
    setStarted(false);
    setAssembling(true);
    setView("game");
  }

  // 用故事预设开新局:新会话 + 载入预设卡组 + 直接开玩。
  function launchPreset(p) {
    const d = p.data || {};
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
    setSelecting(true);   // 预设故事:先进选人页(选主角 / 自定义),不直接开玩
    setStarted(false);
    setView("game");
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
    const cover = prompt("封面图片 URL(可空,留空自动生成星空封面)", "") || "";
    const tagSet = new Set([...((story && story.tags) || []), ...characters.flatMap((c) => (c.data.tags || []))]);
    const tags = [...tagSet].filter(Boolean).slice(0, 5);
    try {
      await postJSON("/api/presets", { name: name.trim(), characters, world, story, player, mode, synopsis, author, cover, tags });
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

  if (restoring) {
    return (
      <div className="app">
        <header><div><h1>AI 互动故事</h1><p>读取存档中…</p></div></header>
      </div>
    );
  }

  return (
    <div className="app">
      <TopNav view={view} setView={setView} sessionId={sessionId} />

      {view === "home" && (
        <main className="single-view">
          <StoriesHome
            onNew={onNew}
            presets={presets}
            saves={saves}
            onLaunchPreset={launchPreset}
            onDeletePreset={deletePreset}
            onResume={resumeSave}
            onDeleteSave={deleteSaveHandler}
          />
        </main>
      )}

      {view === "game" && selecting && (
        <main className="single-view">
          <CharacterSelect
            playables={(pendingPreset && pendingPreset.playables) || []}
            storyName={(pendingPreset && pendingPreset.name) || ""}
            onPick={startWithPlayer}
          />
        </main>
      )}

      {view === "game" && started && characters.length > 0 && (
        <main className={"play-layout " + ((sidebarOpen && !isPreset) ? "with-side" : "no-side")}>
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
            {!isPreset && (
              <button className="side-toggle" onClick={() => setSidebarOpen((o) => !o)}
                title="开/关侧边的角色卡、故事书等卡组栏">
                {sidebarOpen ? "◀ 收起卡组栏" : "▶ 卡组栏"}
              </button>
            )}
            <StoryPanel key={sessionId} characters={characters} world={world} story={story} player={player} mode={mode} sessionId={sessionId} initialTurns={restoredTurns} initialState={restoredState} initialChoices={restoredChoices} goHome={() => { refreshHome(); setStarted(false); setAssembling(false); setView("home"); }} />
          </div>
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
          <BuildView
            buildSeed={buildSeed}
            clearSeed={() => setBuildSeed({ seed: "", draft: null })}
            addCharacter={addCharacter}
            addWorld={addWorld}
            setStory={setStory}
            setPlayer={setPlayer}
            goGame={() => { setBuildSeed({ seed: "", draft: null }); setView(started ? "game" : "home"); }}
          />
        </main>
      )}

      {view === "vault" && (
        <main className="single-view">
          <VaultView
            addCharacter={addCharacter}
            addWorld={addWorld}
            setStory={setStory}
            setPlayer={setPlayer}
            completeCard={completeCardFromVault}
            goGame={() => setView("game")}
          />
        </main>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
