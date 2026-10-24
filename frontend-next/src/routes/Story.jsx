import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useNavigate } from "../lib/transitionNav";
import { streamTurn, postJSON, getJSON, extractStream } from "../lib/api";
import {
  loadLocalProxySettings,
  runLocalProxyReroll,
  runLocalProxyTurn,
  saveModelSource,
} from "../lib/localProxy";
import { useAuth } from "../state/auth";
import { useGame } from "../state/game";
import { L, isZh } from "../lib/i18n";
import "./Story.css";

// 把一条台词按中文双引号拆段:引号内对白单独成行,引号外动作描写成行。
function splitSpeech(text) {
  const t = text || "";
  const parts = [];
  const re = /[“”][^“”]*[“”]|"[^"]*"/g; // 英文输出多用直双引号,一并拆
  let last = 0,
    m;
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

function Narration({ text }) {
  return (
    <div className="story-narration t-read">
      {(text || "").split(/\n+/).filter(Boolean).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}

// 名牌颜色:按名字固定取一个(同一角色每回合同色)。字一律深色。店里两位按画布定色。
const PLATES = ["#f0883e", "#9dbcff", "#e3b16a", "#8fd3b0", "#f5a3c7", "#c3a6ff"];
const PLATE_OF = { 糖沐: "#f0883e", 太妃月: "#9dbcff" };
function plateColor(name) {
  if (PLATE_OF[name]) return PLATE_OF[name];
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return PLATES[h % PLATES.length];
}

// 一条台词:引号外的动作描写偏灰,引号内的对白亮白,同一段里连着读(画布 C 幕间 · 游玩)。
function Speech({ text }) {
  return splitSpeech(text).map((seg, k) => (
    <span key={k} className={seg.q ? "dlg-q" : "dlg-a"}>
      {k > 0 && !isZh ? " " : ""}
      {seg.s}
    </span>
  ));
}

function Dialogue({ messages }) {
  return (
    <div className="story-dialogue">
      {(messages || []).map((mm, i) => {
        const name = mm.name || mm.character_id || "?";
        return (
          <div className="dlg" key={i}>
            <span className="dlg-name" style={{ background: plateColor(name) }}>
              {name}
            </span>
            <p className="dlg-text">
              <Speech text={mm.text} />
            </p>
          </div>
        );
      })}
    </div>
  );
}

const EMPTY = <span className="status-empty t-meta">{L("None yet", "暂无")}</span>;

export default function Story() {
  const { game } = useGame();
  const { user } = useAuth();
  const navigate = useNavigate();
  const localProxyAllowed = !!(user && user.local_proxy_enabled);
  const [turns, setTurns] = useState([]);
  const [choices, setChoices] = useState([]);
  const [state, setState] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(null);
  const [pendingLabel, setPendingLabel] = useState("");
  const [error, setError] = useState("");
  const [modelSource, setModelSource] = useState(() => loadLocalProxySettings().source);
  const [canUndo, setCanUndo] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // 世界状态:桌面默认展开在右侧(画布),手机是抽屉、默认收起。
  const [statusOpen, setStatusOpen] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(min-width: 961px)").matches
  );
  const [dev, setDev] = useState(() => {
    try {
      return localStorage.getItem("ais_dev") === "1";
    } catch (e) {
      return false;
    }
  });
  // 阅读方式(画布「C 幕间 · 游玩」第二版):全文 = 左侧整页叙事流(默认);对白框 = 底部对白框一句一句读。按设备记住。
  const [readMode, setReadMode] = useState(() => {
    try {
      return localStorage.getItem("ais_play_mode") === "box" ? "box" : "full";
    } catch (e) {
      return "full";
    }
  });
  function pickReadMode(m) {
    setReadMode(m);
    try {
      localStorage.setItem("ais_play_mode", m);
    } catch (e) {}
  }
  const [openSec, setOpenSec] = useState(""); // 世界状态里展开的栏目(一次一个)
  const [beat, setBeat] = useState(0); // 对白框:读到最后一回合的第几句
  const inputRef = useRef(null);
  // 卡组(本局):从 game 取一份可改副本,卡组栏「移除」即改这里 → 影响后续回合 body(不新增端点)。
  const [deck, setDeck] = useState(() =>
    game
      ? { characters: game.characters || [], world: game.world || null, story: game.story || null, player: game.player || null }
      : null
  );
  // 服务器已持有的卡组:回合成功后记下当时的 deck 对象。之后同一个 deck 就不再随回合上传整套卡
  // (诡秘一套约 125KB),服务端沿用会话里落盘的那份;deck 一变(卡组栏移除角色)或刷新页面就重新全量上传。
  const deckSentRef = useRef(null);
  const feedRef = useRef(null);
  const openedRef = useRef(false);
  const syncedRef = useRef(0); // 已同步到前端的服务器回合数(续玩还原 + tail after 用)

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streaming]);

  function selectModelSource(source) {
    saveModelSource(source);
    setModelSource(source);
    if (source === "local_proxy") {
      const settings = loadLocalProxySettings();
      if (!settings.endpoint || !settings.model) {
        setError(L("Set your local proxy URL and model name in Me first", "请先在「我的」里填写本机反代地址和模型名"));
        return;
      }
    }
    setError("");
  }

  function toggleDev() {
    setDev((v) => {
      const nv = !v;
      try {
        localStorage.setItem("ais_dev", nv ? "1" : "0");
      } catch (e) {}
      return nv;
    });
  }

  async function runTurn({ text = "", choice = "" } = {}) {
    if (loading || !game || !deck) return;
    const action = text.trim();
    if (action || choice) setTurns((xs) => [...xs, { kind: "player", text: action || choice }]);
    setInput("");
    setStreaming(null);
    setChoices([]);
    setLoading(true);
    setError("");
    const body = {
      characters: deck.characters,
      world: deck.world,
      story: deck.story,
      player: deck.player,
      mode: game.mode,
      session_id: game.sessionId,
      user: action,
      selected_choice: choice,
    };
    try {
      let raw = "";
      let finalTurn = null;
      if (localProxyAllowed && modelSource === "local_proxy") {
        setPendingLabel(L("Connecting to local Codex…", "连接本机 Codex…"));
        finalTurn = await runLocalProxyTurn(body, loadLocalProxySettings(), {
          onStep: (call) => setPendingLabel(
            call.index === 0 ? L("Local Codex is thinking…", "本机 Codex 推演中…") : L(`Local Codex step ${call.index + 1}…`, `本机 Codex 处理步骤 ${call.index + 1}…`)
          ),
          onDelta: (text) => {
            raw += text;
            setStreaming(extractStream(raw));
          },
        });
      } else {
        const send = async (b) => {
          try {
            return await streamTurn(b, {
              onDelta: (t) => {
                raw += t;
                setStreaming(extractStream(raw));
              },
            });
          } catch (streamErr) {
            if (streamErr.status === 409) throw streamErr; // 服务器没有这局的卡组:交给下面全量重发
            return await postJSON("/api/story_turn", b);
          }
        };
        const lite = deckSentRef.current === deck;
        const liteBody = { mode: body.mode, session_id: body.session_id, user: body.user, selected_choice: body.selected_choice };
        try {
          finalTurn = await send(lite ? liteBody : body);
        } catch (e) {
          if (!(lite && e.status === 409)) throw e;
          raw = "";
          finalTurn = await send(body);
        }
      }
      if (!finalTurn) throw new Error(L("No turn result received", "没有拿到回合结果"));
      deckSentRef.current = deck; // 本轮成功:服务器已落盘这套卡组
      setStreaming(null);
      setTurns((xs) => [...xs, { kind: "story", data: finalTurn }]);
      setChoices(finalTurn.choices || []);
      setState(finalTurn.state || null);
      setCanUndo(true);
      syncedRef.current += 1; // 本地出了一回合,服务器也已存 → 同步计数跟上,避免 tail 重复拉回本轮
    } catch (e) {
      setStreaming(null);
      setError(L("This turn failed: ", "本轮生成失败:") + e.message);
    } finally {
      setPendingLabel("");
      setLoading(false);
    }
  }

  // 撤回上一轮(契约照搬 /api/undo_last:删最近一条剧情 + 它前面的玩家行动,输入回填)。
  async function undoLast() {
    if (loading || !canUndo || !game) return;
    setLoading(true);
    setError("");
    try {
      const out = await postJSON("/api/undo_last", { session_id: game.sessionId });
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
      syncedRef.current = Math.max(0, syncedRef.current - 1); // 撤回一回合 → 同步计数回退
    } catch (e) {
      setError(L("Undo failed: ", "撤回失败:") + e.message);
    } finally {
      setLoading(false);
    }
  }

  // 重生成上一轮(契约照搬 /api/reroll:回滚副作用 + 同输入重生,替换最后一条剧情)。
  async function rerollLast() {
    if (loading) return;
    let idx = -1;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (turns[i].kind === "story") {
        idx = i;
        break;
      }
    }
    if (idx === -1) return;
    const prevChoices = choices; // 失败时恢复:reroll 被拒(如开场无可重生回合,后端 400)别把选项清没了留下死状态
    setLoading(true);
    setStreaming(null);
    setError("");
    setChoices([]);
    try {
      let out;
      let raw = "";
      if (localProxyAllowed && modelSource === "local_proxy") {
        setPendingLabel(L("Connecting to local Codex…", "连接本机 Codex…"));
        out = await runLocalProxyReroll(game.sessionId, loadLocalProxySettings(), {
          onStep: (call) => setPendingLabel(
            call.index === 0 ? L("Local Codex is regenerating…", "本机 Codex 重生成中…") : L(`Local Codex step ${call.index + 1}…`, `本机 Codex 处理步骤 ${call.index + 1}…`)
          ),
          onDelta: (text) => {
            raw += text;
            setStreaming(extractStream(raw));
          },
        });
      } else {
        out = await postJSON("/api/reroll", { session_id: game.sessionId });
      }
      setTurns((xs) => xs.map((t, i) => (i === idx ? { kind: "story", data: out } : t)));
      setChoices(out.choices || []);
      setState(out.state || null);
      setStreaming(null);
      setCanUndo(true);
    } catch (e) {
      setStreaming(null);
      setError(L("Regenerate failed: ", "重新生成失败:") + e.message);
      setChoices(prevChoices); // 恢复原选项,避免无选项可点
    } finally {
      setPendingLabel("");
      setLoading(false);
    }
  }

  function removeFromDeck(nm) {
    setDeck((dk) => ({ ...dk, characters: (dk.characters || []).filter((c) => ((c.data && c.data.name) || c.name) !== nm) }));
  }

  // 进入本局:先尝试从服务器还原历史(续玩);有历史则还原,无历史才开新场(只触发一次)。
  useEffect(() => {
    if (!game || openedRef.current) return;
    openedRef.current = true;
    (async () => {
      try {
        const data = await getJSON("/api/session/" + game.sessionId);
        const srv = (data && data.turns) || [];
        if (srv.length) {
          const restored = [];
          for (const tr of srv) {
            if (tr.player_input) restored.push({ kind: "player", text: tr.player_input });
            restored.push({ kind: "story", data: tr });
          }
          setTurns(restored);
          const last = srv[srv.length - 1];
          setChoices((last && last.choices) || []);
          setState((data && data.state) || (last && last.state) || null);
          setCanUndo(true);
          syncedRef.current = srv.length;
          return; // 已还原,不再开新场
        }
      } catch (e) {
        // 读不到(新局/网络抖动)→ 落到开新场
      }
      runTurn(); // 新局:开场
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  // 实时 tail:轮询服务器新回合(运营「立即生效」/ 任何 server 端新回合),玩家界面自动冒出。
  // 自己出回合时(loading)暂停,避免与本地 append 竞态;syncedRef 记已同步回合数作 after。
  useEffect(() => {
    if (!game) return;
    let alive = true;
    const timer = setInterval(async () => {
      if (!alive || loading) return;
      try {
        const d = await getJSON(`/api/session/${game.sessionId}/tail?after=${syncedRef.current}`);
        const nt = (d && d.new_turns) || [];
        if (nt.length) {
          setTurns((xs) => {
            const add = [];
            for (const tr of nt) {
              if (tr.player_input) add.push({ kind: "player", text: tr.player_input });
              add.push({ kind: "story", data: tr });
            }
            return [...xs, ...add];
          });
          syncedRef.current += nt.length;
          if (d.state) setState(d.state);
        }
      } catch (e) {}
    }, 3500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, loading]);

  // 派生:累计 token / 记忆卡 / 已触发事件(跨回合聚合)。
  const storyTurns = useMemo(() => turns.filter((t) => t.kind === "story"), [turns]);
  const tokenTotal = useMemo(
    () => storyTurns.reduce((s, t) => s + ((t.data.usage && t.data.usage.total_tokens) || 0), 0),
    [storyTurns]
  );
  const memWrites = useMemo(() => storyTurns.flatMap((t) => t.data.memory_write || []), [storyTurns]);
  const triggeredAll = useMemo(() => storyTurns.flatMap((t) => t.data.triggered_events || []), [storyTurns]);
  const lastStory = storyTurns.length ? storyTurns[storyTurns.length - 1] : null;
  // 对白框的「句」= 最后一回合的叙事段落 + 每条台词。换了一回合(新回合 / 重写 / 撤回 / 续玩还原)就回到第一句。
  const beats = useMemo(() => {
    if (!lastStory) return [];
    const d = lastStory.data || {};
    const out = (d.narration || "").split(/\n+/).filter(Boolean).map((p) => ({ text: p }));
    for (const mm of d.messages || []) out.push({ name: mm.name || mm.character_id || "?", text: mm.text || "" });
    return out;
  }, [lastStory]);
  useEffect(() => {
    setBeat(0);
  }, [lastStory]);

  // YOR-42:未选故事直接进 /play → 不自动开教学局,引导回探索。
  if (!game) return <Navigate to="/explore" replace />;

  const scene = (state && state.scene) || {};
  const ps = (state && state.player) || {};
  const rels = (state && state.relationships) || [];
  const timeline = (state && state.timeline) || [];
  // 时间线只列已发生 / 进行中,不写未发生(pending)的(细节⑥)。
  const timelineShown = timeline.filter((e) => e.status && e.status !== "pending");
  const usageBlock = storyTurns.length ? storyTurns[storyTurns.length - 1].data.usage || {} : {};

  const memLong = memWrites.filter((m) => (m.importance || 0) >= 4);
  const memShort = memWrites.filter((m) => (m.importance || 0) < 4);
  const historyEvents = timeline.filter((e) => e.status === "resolved");

  // 舞台:故事封面(没有就用书店夜景)+ 有立绘的角色站在中间(目前只有糖沐有立绘)。
  const backdrop = game.cover || "/home/background.webp";
  const castNames = ((deck && deck.characters) || []).map((c) => (c.data && c.data.name) || c.name);
  const art = castNames.includes("糖沐") ? "/home/tangmu01.webp" : null;
  const roundNow = storyTurns.length || (loading ? 1 : 0);
  const subtitle = [isZh ? `第 ${roundNow} 回合` : `Turn ${roundNow}`, scene.location, scene.time].filter(Boolean).join(isZh ? "　" : " · ");
  const cur = beats.length ? beats[Math.min(beat, beats.length - 1)] : null;
  const atLastBeat = !beats.length || beat >= beats.length - 1;

  function pickChoice(c) {
    setInput(c.label);
    if (inputRef.current) inputRef.current.focus();
  }

  // 世界状态的栏目:一行小按钮,点哪个展开哪个(画布)。场景放在上面的地点 / 时间 / 在场里。
  const sections = [
    {
      key: "player",
      title: L("Player", "玩家"),
      body:
        ps.location || ps.status || (ps.active_goals || []).length || (ps.known_facts || []).length || (ps.inventory || []).length ? (
          <div className="status-kv">
            {ps.location && <div><span className="status-k">{L("Location", "位置")}</span>{ps.location}</div>}
            {ps.status && <div><span className="status-k">{L("Status", "状态")}</span>{ps.status}</div>}
            {(ps.active_goals || []).length > 0 && <div><span className="status-k">{L("Goals", "目标")}</span>{ps.active_goals.join(L("; ", "；"))}</div>}
            {(ps.known_facts || []).length > 0 && <div><span className="status-k">{L("Known", "已知")}</span>{ps.known_facts.join(L("; ", "；"))}</div>}
            {(ps.inventory || []).length > 0 && <div><span className="status-k">{L("Items", "物品")}</span>{ps.inventory.join(L(", ", "、"))}</div>}
          </div>
        ) : (
          EMPTY
        ),
    },
    {
      key: "rels",
      title: L("Relationships", "关系"),
      count: rels.length,
      body: rels.length ? (
        <div className="status-rels">
          {rels.map((r, i) => (
            <div className="status-rel" key={i}>
              <span className="status-rel-nm">{r.character_id}</span>
              <span className="status-rel-v">{isZh ? <>信任 {r.trust} · 张力 {r.tension} · 好感 {r.affection}</> : <>Trust {r.trust} · Tension {r.tension} · Affection {r.affection}</>}</span>
            </div>
          ))}
        </div>
      ) : (
        EMPTY
      ),
    },
    {
      key: "mem",
      title: L("Memory cards", "记忆卡"),
      count: memWrites.length,
      body: memWrites.length ? (
        <div className="status-mem">
          {memLong.length > 0 && (
            <div className="status-mem-grp">
              <div className="status-k">{L("Long-term", "长期")}</div>
              {memLong.slice(-8).map((m, i) => <div className="status-mem-i" key={i}>· {m.text}</div>)}
            </div>
          )}
          {memShort.length > 0 && (
            <div className="status-mem-grp">
              <div className="status-k">{L("Short-term", "短期")}</div>
              {memShort.slice(-8).map((m, i) => <div className="status-mem-i" key={i}>· {m.text}</div>)}
            </div>
          )}
        </div>
      ) : (
        EMPTY
      ),
    },
    {
      key: "tokens",
      title: L("Token usage", "Token 用量"),
      body:
        tokenTotal > 0 ? (
          <div className="status-kv">
            <div><span className="status-k">{L("This run", "本局累计")}</span>{tokenTotal}</div>
            {usageBlock.total_tokens != null && <div><span className="status-k">{L("Last turn", "上一轮")}</span>{usageBlock.total_tokens}</div>}
            {usageBlock.calls != null && <div><span className="status-k">{L("Calls", "调用")}</span>{usageBlock.calls}</div>}
          </div>
        ) : (
          EMPTY
        ),
    },
    {
      key: "history",
      title: L("History", "历史"),
      count: historyEvents.length || triggeredAll.length,
      body:
        historyEvents.length || triggeredAll.length ? (
          <div className="status-hist">
            {historyEvents.map((e, i) => <div className="status-hist-i" key={"h" + i}>· {e.title || e.event_id}</div>)}
            {triggeredAll.slice(-8).map((e, i) => <div className="status-hist-i" key={"t" + i}>· {e}</div>)}
          </div>
        ) : (
          EMPTY
        ),
    },
    {
      key: "timeline",
      title: L("Timeline", "时间线"),
      count: timelineShown.length,
      body: timelineShown.length ? (
        <div className="status-tl">
          {timelineShown.map((e, i) => (
            <div className="status-tl-i" key={i}>
              <span className={"status-tl-dot status-tl-" + e.status} />
              <span>{e.title || e.event_id}{e.due_hint ? ` · ${e.due_hint}` : ""}</span>
            </div>
          ))}
        </div>
      ) : (
        EMPTY
      ),
    },
    {
      key: "map",
      title: L("Map", "地图"),
      // 引擎暂无地图数据,先用场景位置/出口拼一张文字地图(YOR-95 待真地图字段)
      body:
        scene.location || (scene.exits || []).length ? (
          <div className="status-map">
            <div className="status-map-here">{scene.location || L("Unknown location", "未定地点")}</div>
            {(scene.exits || []).length > 0 && <div className="status-map-exits">{L("Leads to: ", "通向:")}{scene.exits.join(" / ")}</div>}
            <div className="status-empty">{L("Full world map coming soon", "完整世界地图待引擎提供")}</div>
          </div>
        ) : (
          EMPTY
        ),
    },
  ];
  if (dev) {
    sections.push(
      {
        key: "dash",
        title: L("Dashboard · dev", "仪表盘 · dev"),
        body: (
          <div className="status-kv">
            <div><span className="status-k">turn</span>{(state && state.turn_count) || storyTurns.length}</div>
            <div><span className="status-k">clock</span>{(state && state.clock_minutes) || 0} {L("min", "分")}</div>
            {state && state.main_resolved != null && <div><span className="status-k">{L("Main plot", "主线")}</span>{state.main_resolved ? L("Resolved", "已结案") : L("In progress", "进行中")}</div>}
            {lastStory && lastStory.data.reasoning && (
              <div><span className="status-k">{L("Self-check", "自检")}</span>{JSON.stringify(lastStory.data.reasoning).slice(0, 160)}</div>
            )}
          </div>
        ),
      },
      {
        // 卡组栏(作者视图):移除随本局生效,编辑 / 上传归创作端
        key: "deck",
        title: L("Deck · dev", "卡组 · dev"),
        count: (deck.characters || []).length,
        body: (
          <div className="status-deck">
            <div className="status-empty">{L("Author view · removals apply to this run; edit/upload in Create", "作者视图 · 移除随本局生效;编辑/上传归创作端")}</div>
            {(deck.characters || []).map((c, i) => {
              const nm = (c.data && c.data.name) || c.name || L("Character", "角色");
              return (
                <div className="status-deck-i" key={i}>
                  <span>{nm}</span>
                  <button type="button" onClick={() => removeFromDeck(nm)} title={L("Remove from this run", "移出本局")}>
                    {L("Remove", "移除")}
                  </button>
                </div>
              );
            })}
            {deck.world && <div className="status-deck-i"><span>{L("World Book", "世界书")}</span></div>}
            {deck.story && <div className="status-deck-i"><span>{L("Story Book", "故事书")}</span></div>}
          </div>
        ),
      }
    );
  }
  const secOpen = sections.find((x) => x.key === openSec);

  const choiceList = (box) =>
    choices.length > 0 && !loading && (!box || atLastBeat) ? (
      <section className={box ? "play-box-choices" : "play-next"} aria-labelledby="play-next-h">
        <h2 id="play-next-h" className={box ? "sr-only" : undefined}>
          {L("What next", "接下来")}
        </h2>
        {choices.map((c, i) => (
          <button key={c.id || i} type="button" className="play-choice" onClick={() => pickChoice(c)} title={L("Fills the box below; edit it or send as is", "填入下方输入框,可改可直接发送")}>
            {!box && (
              <span className="play-choice-no" aria-hidden="true">
                {i + 1}
              </span>
            )}
            <span className="play-choice-text">
              <span className="play-choice-label">{c.label}</span>
              {c.description && <span className="play-choice-hint">{c.description}</span>}
            </span>
          </button>
        ))}
      </section>
    ) : null;

  const composer = (
    <form
      className="play-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (input.trim() && !loading) runTurn({ text: input });
      }}
    >
      {localProxyAllowed && (
        <div className="play-model">
          <span>{L("Model", "模型")}</span>
          <div className="play-model-seg" role="group" aria-label={L("Model source", "模型来源")}>
            <button type="button" aria-pressed={modelSource === "deepseek"} className={modelSource === "deepseek" ? "is-on" : ""} onClick={() => selectModelSource("deepseek")} disabled={loading}>
              DeepSeek
            </button>
            <button type="button" aria-pressed={modelSource === "local_proxy"} className={modelSource === "local_proxy" ? "is-on" : ""} onClick={() => selectModelSource("local_proxy")} disabled={loading}>
              {L("Local Codex", "Codex 本机")}
            </button>
          </div>
          <button type="button" className="play-model-settings" onClick={() => navigate("/mine")} disabled={loading}>
            {L("Settings", "设置")}
          </button>
        </div>
      )}
      <div className="play-composer-row">
        <label className="play-input">
          <span className="sr-only">{L("Your action or line", "你的行动或台词")}</span>
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent || e).isComposing) {
                e.preventDefault();
                // 对齐发送按钮的守卫:空输入按 Enter 不发空回合(否则会烧一轮 token 且无玩家气泡,YOR-182)。
                if (!input.trim() || loading) return;
                runTurn({ text: input });
              }
            }}
            placeholder={readMode === "box" ? L("Or write your own line", "或者自己写一句行动或台词") : L("Write your action or line", "写下你的行动或台词")}
            disabled={loading}
          />
        </label>
        <button type="submit" className="play-send" disabled={loading || !input.trim()}>
          {L("Send", "发送")}
        </button>
      </div>
      {readMode === "full" && (
        <p className="play-composer-hint">
          {L("Tapping a choice fills the box so you can edit it first. Enter sends, Shift + Enter adds a line.", "点选项会填进输入框,可以改了再发。Enter 发送,Shift + Enter 换行。")}
        </p>
      )}
    </form>
  );

  const errorLine = error ? (
    <p className="play-error" role="alert">
      {error}
    </p>
  ) : null;

  return (
    <div className={"story play play--" + readMode + (statusOpen ? " status-open" : "") + (dev ? " is-dev" : "")}>
      <img
        className="play-bg"
        src={backdrop}
        alt=""
        onError={(e) => {
          if (!e.currentTarget.src.endsWith("/home/background.webp")) e.currentTarget.src = "/home/background.webp";
        }}
      />
      <div className="play-shade" aria-hidden="true" />
      {art && <img className="play-art" src={art} alt="" />}

      {/* 顶栏:离开 / 书名 + 回合·地点·时间 / 阅读方式 / 撤回·重写·记录·世界状态·dev */}
      <header className="play-top">
        <div className="play-top-left">
          <button type="button" className="play-pill play-back" onClick={() => navigate("/explore", { transition: "contract" })}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" />
            </svg>
            {L("Leave", "离开")}
          </button>
          <div className="play-heading">
            <h1>{game.title || L("Current story", "当前故事")}</h1>
            <span>{subtitle}</span>
          </div>
        </div>
        <div className="play-top-right">
          <div className="play-mode" role="group" aria-label={L("Reading mode", "阅读方式")}>
            <button type="button" aria-pressed={readMode === "full"} className={readMode === "full" ? "is-on" : ""} onClick={() => pickReadMode("full")}>
              {L("Full text", "全文")}
            </button>
            <button type="button" aria-pressed={readMode === "box"} className={readMode === "box" ? "is-on" : ""} onClick={() => pickReadMode("box")}>
              {L("Dialogue box", "对白框")}
            </button>
          </div>
          <div className="play-tools" role="toolbar" aria-label={L("This turn", "本回合")}>
            <button type="button" className="play-pill" disabled={!canUndo || loading} onClick={undoLast} title={L("Undo last turn", "撤回上一轮")}>
              {L("Undo", "撤回")}
            </button>
            <button type="button" className="play-pill" disabled={!storyTurns.length || loading} onClick={rerollLast} title={L("Regenerate last turn", "重新生成上一轮")}>
              {L("Rewrite", "重写")}
            </button>
            <button type="button" className="play-pill" disabled={!turns.length} onClick={() => setLogOpen(true)} title={L("Story log", "故事记录")}>
              {L("Log", "记录")}
            </button>
            <button type="button" className={"play-pill" + (statusOpen ? " is-on" : "")} aria-pressed={statusOpen} onClick={() => setStatusOpen((v) => !v)}>
              {L("World status", "世界状态")}
            </button>
            <button type="button" className={"play-pill play-dev" + (dev ? " is-on" : "")} aria-pressed={dev} onClick={toggleDev} title={L("Player dashboard / developer view", "玩家仪表盘 / 开发者视图")}>
              dev
            </button>
          </div>
        </div>
      </header>

      <div className="play-body">
        {readMode === "full" ? (
          /* 全文:左侧一整页,叙事 + 名牌台词 + 接下来,底部输入 */
          <main className="play-panel">
            <div className="play-feed" ref={feedRef}>
              {(() => {
                let n = 0;
                return turns.map((t, i) =>
                  t.kind === "player" ? (
                    <p className="play-me" key={i}>
                      <span className="play-me-tag">{L("You", "你")}</span>
                      {t.text}
                    </p>
                  ) : (
                    <div className="play-turn" key={i}>
                      <p className="play-round">{isZh ? `第 ${++n} 回合` : `Turn ${++n}`}</p>
                      <Narration text={t.data.narration} />
                      <Dialogue messages={t.data.messages} />
                    </div>
                  )
                );
              })()}

              {streaming && (streaming.narration || (streaming.messages && streaming.messages.length)) ? (
                <div className="play-turn is-streaming">
                  <Narration text={streaming.narration} />
                  <Dialogue messages={streaming.messages} />
                </div>
              ) : loading ? (
                <p className="play-pending" role="status">
                  {pendingLabel || L("Thinking…", "推演中…")}
                </p>
              ) : null}

              {/* 选项并入叙事流、随内容滚动(细节③) */}
              {choiceList(false)}
              {errorLine}
            </div>
            {composer}
          </main>
        ) : (
          /* 对白框:底部一句一句读(最后一回合),读到最后一句出选项 */
          <div className="play-stage">
            {choiceList(true)}
            <section className="play-box" aria-label={L("Dialogue", "对白")}>
              {loading ? (
                <p className="play-box-text play-box-pending" role="status">
                  {pendingLabel || L("Thinking…", "推演中…")}
                </p>
              ) : cur ? (
                <>
                  {cur.name && (
                    <span className="play-box-name" style={{ background: plateColor(cur.name) }}>
                      {cur.name}
                    </span>
                  )}
                  <p className="play-box-text" aria-live="polite">
                    {cur.name ? <Speech text={cur.text} /> : cur.text}
                  </p>
                  <div className="play-box-pager">
                    <button type="button" disabled={beat === 0} onClick={() => setBeat((b) => Math.max(0, b - 1))} aria-label={L("Previous line", "上一句")}>
                      ‹
                    </button>
                    <span>{isZh ? `本回合 ${Math.min(beat, beats.length - 1) + 1} / ${beats.length}` : `Line ${Math.min(beat, beats.length - 1) + 1} of ${beats.length}`}</span>
                    <button type="button" className="play-box-next" disabled={atLastBeat} onClick={() => setBeat((b) => Math.min(beats.length - 1, b + 1))}>
                      {L("Next", "下一句")} →
                    </button>
                  </div>
                </>
              ) : (
                <p className="play-box-text play-box-pending">{L("The story is about to begin…", "故事马上开始……")}</p>
              )}
              {errorLine}
              {composer}
            </section>
          </div>
        )}

        {/* 世界状态:桌面在右侧,手机是抽屉 */}
        {statusOpen && (
          <>
            <div className="play-world-scrim" onClick={() => setStatusOpen(false)} aria-hidden="true" />
            <aside className="play-world" aria-labelledby="play-world-h">
              <div className="play-world-head">
                <h2 id="play-world-h">{L("World status", "世界状态")}</h2>
                <button type="button" onClick={() => setStatusOpen(false)} aria-label={L("Hide world status", "收起世界状态")}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <dl className="play-world-kv">
                <dt>{L("Place", "地点")}</dt>
                <dd>{scene.location || "—"}</dd>
                <dt>{L("Time", "时间")}</dt>
                <dd>{scene.time || "—"}</dd>
                {(scene.present_characters || []).length > 0 && (
                  <>
                    <dt>{L("Present", "在场")}</dt>
                    <dd>{scene.present_characters.join(L(", ", "、"))}</dd>
                  </>
                )}
                {scene.atmosphere && (
                  <>
                    <dt>{L("Mood", "氛围")}</dt>
                    <dd>{scene.atmosphere}</dd>
                  </>
                )}
                {(scene.exits || []).length > 0 && (
                  <>
                    <dt>{L("Exits", "出口")}</dt>
                    <dd>{scene.exits.join(L(", ", "、"))}</dd>
                  </>
                )}
              </dl>
              <div className="play-world-secs">
                {sections.map((x) => (
                  <button key={x.key} type="button" aria-expanded={openSec === x.key} className={openSec === x.key ? "is-on" : ""} onClick={() => setOpenSec((k) => (k === x.key ? "" : x.key))}>
                    {x.title}
                    {x.count ? <span className="play-world-count">{x.count}</span> : null}
                  </button>
                ))}
              </div>
              {secOpen && (
                <div className="play-world-body" role="region" aria-label={secOpen.title}>
                  {secOpen.body}
                </div>
              )}
            </aside>
          </>
        )}
      </div>

      {/* 故事记录抽屉(全量回看) */}
      {logOpen && (
        <div className="story-log" onClick={(e) => e.target.classList.contains("story-log") && setLogOpen(false)}>
          <div className="story-log-panel" role="dialog" aria-modal="true" aria-labelledby="story-log-h">
            <div className="story-log-head">
              <h2 id="story-log-h">{L("Story log", "故事记录")}</h2>
              <span>{storyTurns.length} {L(storyTurns.length === 1 ? "turn" : "turns", "回合")}</span>
              <button type="button" className="story-log-x" onClick={() => setLogOpen(false)} aria-label={L("Close", "关闭")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="story-log-body">
              {(() => {
                let n = 0;
                return turns.map((t, i) => {
                  if (t.kind === "player") {
                    return (
                      <p className="play-me" key={i}>
                        <span className="play-me-tag">{L("You", "你")}</span>
                        {t.text}
                      </p>
                    );
                  }
                  n++;
                  const d = t.data || {};
                  return (
                    <div className="play-turn" key={i}>
                      <p className="play-round">{isZh ? `第 ${n} 回合` : `Turn ${n}`}</p>
                      {d.narration && <Narration text={d.narration} />}
                      <Dialogue messages={d.messages} />
                      {(d.triggered_events || []).length > 0 && (
                        <p className="story-log-ev">{L("Triggered events: ", "触发事件:")}{d.triggered_events.join(L(", ", "、"))}</p>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
