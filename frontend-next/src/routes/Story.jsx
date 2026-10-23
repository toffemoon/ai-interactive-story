import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useNavigate } from "../lib/transitionNav";
import { Button } from "../components/ui";
import { streamTurn, postJSON, getJSON, extractStream } from "../lib/api";
import {
  loadLocalProxySettings,
  runLocalProxyReroll,
  runLocalProxyTurn,
  saveModelSource,
} from "../lib/localProxy";
import { useAuth } from "../state/auth";
import { useGame } from "../state/game";
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

function Dialogue({ messages }) {
  return (
    <div className="story-dialogue">
      {(messages || []).map((mm, i) => (
        <div className="dlg" key={i}>
          <span className="dlg-name t-kai">{mm.name || mm.character_id || "?"}</span>
          <div className="dlg-text">
            {splitSpeech(mm.text).map((seg, k) => (
              <p key={k} className={seg.q ? "dlg-q" : "dlg-a"}>
                {seg.s}
              </p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// 状态栏单栏目:默认收起,点标题展开(native details,真机点击稳)。
function StatusSection({ title, count, children, open }) {
  return (
    <details className="status-sec" open={open}>
      <summary className="status-sec-head">
        <span className="status-sec-title t-kai">{title}</span>
        {count != null && <span className="status-sec-count t-meta">{count}</span>}
      </summary>
      <div className="status-sec-body">{children}</div>
    </details>
  );
}

const EMPTY = <span className="status-empty t-meta">None yet</span>;

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
  // 右状态栏:默认收起(抽屉),点「世界状态」从右侧平移出来,叙事区常驻满宽 → 中间正文位置固定(细节 8)。
  const [statusOpen, setStatusOpen] = useState(false);
  const [dev, setDev] = useState(() => {
    try {
      return localStorage.getItem("ais_dev") === "1";
    } catch (e) {
      return false;
    }
  });
  // 卡组(本局):从 game 取一份可改副本,卡组栏「移除」即改这里 → 影响后续回合 body(不新增端点)。
  const [deck, setDeck] = useState(() =>
    game
      ? { characters: game.characters || [], world: game.world || null, story: game.story || null, player: game.player || null }
      : null
  );
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
        setError("Set your local proxy URL and model name in Me first");
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
        setPendingLabel("Connecting to local Codex…");
        finalTurn = await runLocalProxyTurn(body, loadLocalProxySettings(), {
          onStep: (call) => setPendingLabel(
            call.index === 0 ? "Local Codex is thinking…" : `Local Codex step ${call.index + 1}…`
          ),
          onDelta: (text) => {
            raw += text;
            setStreaming(extractStream(raw));
          },
        });
      } else {
        try {
          finalTurn = await streamTurn(body, {
            onDelta: (t) => {
              raw += t;
              setStreaming(extractStream(raw));
            },
          });
        } catch (streamErr) {
          finalTurn = await postJSON("/api/story_turn", body);
        }
      }
      if (!finalTurn) throw new Error("No turn result received");
      setStreaming(null);
      setTurns((xs) => [...xs, { kind: "story", data: finalTurn }]);
      setChoices(finalTurn.choices || []);
      setState(finalTurn.state || null);
      setCanUndo(true);
      syncedRef.current += 1; // 本地出了一回合,服务器也已存 → 同步计数跟上,避免 tail 重复拉回本轮
    } catch (e) {
      setStreaming(null);
      setError("This turn failed: " + e.message);
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
      setError("Undo failed: " + e.message);
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
        setPendingLabel("Connecting to local Codex…");
        out = await runLocalProxyReroll(game.sessionId, loadLocalProxySettings(), {
          onStep: (call) => setPendingLabel(
            call.index === 0 ? "Local Codex is regenerating…" : `Local Codex step ${call.index + 1}…`
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
      setError("Regenerate failed: " + e.message);
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

  return (
    <div className={"story" + (dev ? " is-dev" : "") + (statusOpen ? " status-open" : "")}>
      {/* 顶栏:离开(保留进行中故事)/ 标题 / token / 撤回·重生成·记录·dev */}
      <header className="story-top">
        <button className="story-back" onClick={() => navigate("/explore", { transition: "contract" })}>
          ← Leave
        </button>
        <div className="story-title t-kai">{game.title || "Current story"}</div>
        <div className="story-top-right">
          {tokenTotal > 0 && <span className="t-mono story-usage">token {tokenTotal}</span>}
          <button className="story-toolbtn" disabled={!canUndo || loading} onClick={undoLast} title="Undo last turn" aria-label="Undo last turn">
            <span className="tb-ic" aria-hidden="true">↩</span>
            <span className="tb-tx">Undo</span>
          </button>
          <button className="story-toolbtn" disabled={!storyTurns.length || loading} onClick={rerollLast} title="Regenerate last turn" aria-label="Regenerate last turn">
            <span className="tb-ic" aria-hidden="true">↻</span>
            <span className="tb-tx">Reroll</span>
          </button>
          <button className="story-toolbtn" disabled={!turns.length} onClick={() => setLogOpen(true)} title="Story log" aria-label="Story log">
            <span className="tb-ic" aria-hidden="true">☰</span>
            <span className="tb-tx">Log</span>
          </button>
          <button className={"story-statusbtn" + (statusOpen ? " is-on" : "")} onClick={() => setStatusOpen((v) => !v)} title="World status (collapsible)">
            {statusOpen ? "Hide status" : "World status"}
          </button>
          <button className={"story-toolbtn story-devbtn" + (dev ? " is-on" : "")} onClick={toggleDev} title="Player dashboard / developer view">
            dev
          </button>
        </div>
      </header>

      <div className="story-body">
        {/* 左:卡组栏(仅作者/dev 视图;玩家不见) */}
        {dev && (
          <aside className="story-deck">
            <div className="story-deck-h t-kai">Deck</div>
            <div className="story-deck-note t-meta">Author view · removals apply to this run; edit/upload in Create</div>
            <div className="story-deck-list">
              {(deck.characters || []).map((c, i) => {
                const nm = (c.data && c.data.name) || c.name || "Character";
                return (
                  <div className="story-deck-card" key={i}>
                    <span className="story-deck-card-name t-ui-sm">{nm}</span>
                    <button className="story-deck-x" onClick={() => removeFromDeck(nm)} title="Remove from this run">
                      Remove
                    </button>
                  </div>
                );
              })}
              {deck.world && <div className="story-deck-card"><span className="t-ui-sm">World Book</span></div>}
              {deck.story && <div className="story-deck-card"><span className="t-ui-sm">Story Book</span></div>}
              {!(deck.characters || []).length && !deck.world && !deck.story && (
                <div className="status-empty t-meta">No deck for this run</div>
              )}
            </div>
          </aside>
        )}

        {/* 中:叙事区 */}
        <main className="story-stage">
          <div className="story-scene-head">
            <span className="story-round t-meta">Turn {storyTurns.length || (loading ? 1 : 0)}</span>
            {scene.location && <span className="story-scene-loc t-kai">{scene.location}</span>}
            {scene.time && <span className="story-scene-time t-meta">{scene.time}</span>}
          </div>

          <div className="story-feed" ref={feedRef}>
            {turns.map((t, i) =>
              t.kind === "player" ? (
                <div className="story-player" key={i}>
                  <span className="story-player-bubble">{t.text}</span>
                </div>
              ) : (
                <div className="story-turn" key={i}>
                  <Narration text={t.data.narration} />
                  <Dialogue messages={t.data.messages} />
                </div>
              )
            )}

            {streaming && (streaming.narration || (streaming.messages && streaming.messages.length)) ? (
              <div className="story-turn is-streaming">
                <Narration text={streaming.narration} />
                <Dialogue messages={streaming.messages} />
              </div>
            ) : loading ? (
              <div className="story-pending t-ui-sm">{pendingLabel || "Thinking…"}</div>
            ) : null}

            {/* 选项并入叙事流、随内容滚动(细节③:不再单独固定底栏占空间) */}
            {choices.length > 0 && !loading && (
              <div className="story-choices">
                <span className="story-choices-hint t-meta">What next? (Tap one to fill the box below, then edit it or send as is)</span>
                {choices.map((c, i) => (
                  <button
                    key={c.id || i}
                    className="story-choice"
                    onClick={() => setInput(c.label)}
                    title="Fills the box below; edit it or send as is"
                  >
                    <span className="story-choice-label t-ui">{c.label}</span>
                    {c.description && <span className="story-choice-desc t-meta">{c.description}</span>}
                    {/* 选项后果预览留位(YOR-21,待引擎 emit consequence) */}
                  </button>
                ))}
              </div>
            )}

            {error && <div className="story-error t-ui-sm">{error}</div>}
          </div>

          <div className="story-composer">
            {localProxyAllowed && (
              <div className="story-model-bar">
                <span className="t-meta">Model</span>
                <div className="story-model-segment" aria-label="Model source">
                  <button
                    className={modelSource === "deepseek" ? "is-on" : ""}
                    onClick={() => selectModelSource("deepseek")}
                    disabled={loading}
                  >
                    DeepSeek
                  </button>
                  <button
                    className={modelSource === "local_proxy" ? "is-on" : ""}
                    onClick={() => selectModelSource("local_proxy")}
                    disabled={loading}
                  >
                    Local Codex
                  </button>
                </div>
                <button className="story-model-settings" onClick={() => navigate("/mine")} disabled={loading}>
                  Settings
                </button>
              </div>
            )}
            <textarea
              rows={2}
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
              placeholder="Write your action or line… (Enter to send, Shift+Enter for a new line; choices are only suggestions)"
              disabled={loading}
            />
            <Button variant="primary" onClick={() => runTurn({ text: input })} disabled={loading || !input.trim()}>
              Send
            </Button>
          </div>
        </main>

        {/* 右:世界状态(8 栏目,默认收起;移动端为抽屉) */}
        <aside className="story-status">
          <div className="story-status-h">
            <span className="t-kai">World status</span>
            <button className="story-status-x" onClick={() => setStatusOpen(false)} aria-label="Close">
              ×
            </button>
          </div>
          <div className="story-status-list">
            <StatusSection title="Scene" open>
              {scene.location || scene.time || scene.atmosphere || (scene.present_characters || []).length ? (
                <div className="status-kv">
                  {scene.location && <div><span className="status-k">Location</span>{scene.location}</div>}
                  {scene.time && <div><span className="status-k">Time</span>{scene.time}</div>}
                  {scene.atmosphere && <div><span className="status-k">Mood</span>{scene.atmosphere}</div>}
                  {(scene.present_characters || []).length > 0 && (
                    <div><span className="status-k">Present</span>{scene.present_characters.join(", ")}</div>
                  )}
                  {(scene.exits || []).length > 0 && <div><span className="status-k">Exits</span>{scene.exits.join(", ")}</div>}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="Player">
              {ps.location || ps.status || (ps.active_goals || []).length || (ps.known_facts || []).length || (ps.inventory || []).length ? (
                <div className="status-kv">
                  {ps.location && <div><span className="status-k">Location</span>{ps.location}</div>}
                  {ps.status && <div><span className="status-k">Status</span>{ps.status}</div>}
                  {(ps.active_goals || []).length > 0 && <div><span className="status-k">Goals</span>{ps.active_goals.join("; ")}</div>}
                  {(ps.known_facts || []).length > 0 && <div><span className="status-k">Known</span>{ps.known_facts.join("; ")}</div>}
                  {(ps.inventory || []).length > 0 && <div><span className="status-k">Items</span>{ps.inventory.join(", ")}</div>}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="Relationships" count={rels.length || null}>
              {rels.length ? (
                <div className="status-rels">
                  {rels.map((r, i) => (
                    <div className="status-rel" key={i}>
                      <span className="status-rel-nm t-ui-sm">{r.character_id}</span>
                      <span className="status-rel-v t-meta">Trust {r.trust} · Tension {r.tension} · Affection {r.affection}</span>
                    </div>
                  ))}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="Memory cards" count={memWrites.length || null}>
              {memWrites.length ? (
                <div className="status-mem">
                  {memLong.length > 0 && (
                    <div className="status-mem-grp">
                      <div className="status-k">Long-term</div>
                      {memLong.slice(-8).map((m, i) => <div className="status-mem-i t-meta" key={i}>· {m.text}</div>)}
                    </div>
                  )}
                  {memShort.length > 0 && (
                    <div className="status-mem-grp">
                      <div className="status-k">Short-term</div>
                      {memShort.slice(-8).map((m, i) => <div className="status-mem-i t-meta" key={i}>· {m.text}</div>)}
                    </div>
                  )}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="Token usage">
              {tokenTotal > 0 ? (
                <div className="status-kv">
                  <div><span className="status-k">This run</span>{tokenTotal}</div>
                  {usageBlock.total_tokens != null && <div><span className="status-k">Last turn</span>{usageBlock.total_tokens}</div>}
                  {usageBlock.calls != null && <div><span className="status-k">Calls</span>{usageBlock.calls}</div>}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="History" count={(historyEvents.length || triggeredAll.length) || null}>
              {historyEvents.length || triggeredAll.length ? (
                <div className="status-hist">
                  {historyEvents.map((e, i) => <div className="status-hist-i t-meta" key={"h" + i}>· {e.title || e.event_id}</div>)}
                  {triggeredAll.slice(-8).map((e, i) => <div className="status-hist-i t-meta" key={"t" + i}>· {e}</div>)}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="Timeline" count={timelineShown.length || null}>
              {timelineShown.length ? (
                <div className="status-tl">
                  {timelineShown.map((e, i) => (
                    <div className="status-tl-i" key={i}>
                      <span className={"status-tl-dot status-tl-" + e.status} />
                      <span className="t-meta">{e.title || e.event_id}{e.due_hint ? ` · ${e.due_hint}` : ""}</span>
                    </div>
                  ))}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="Map">
              {/* 引擎暂无地图数据,先用场景位置/出口拼一张文字地图(YOR-95 待真地图字段) */}
              {scene.location || (scene.exits || []).length ? (
                <div className="status-map">
                  <div className="status-map-here t-kai">{scene.location || "Unknown location"}</div>
                  {(scene.exits || []).length > 0 && (
                    <div className="status-map-exits t-meta">Leads to: {scene.exits.join(" / ")}</div>
                  )}
                  <div className="status-empty t-meta">Full world map coming soon</div>
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            {dev && (
              <StatusSection title="Player dashboard · dev">
                <div className="status-kv">
                  <div><span className="status-k">turn</span>{(state && state.turn_count) || storyTurns.length}</div>
                  <div><span className="status-k">clock</span>{(state && state.clock_minutes) || 0} min</div>
                  {state && state.main_resolved != null && <div><span className="status-k">Main plot</span>{state.main_resolved ? "Resolved" : "In progress"}</div>}
                  {storyTurns.length > 0 && storyTurns[storyTurns.length - 1].data.reasoning && (
                    <div><span className="status-k">Self-check</span>{JSON.stringify(storyTurns[storyTurns.length - 1].data.reasoning).slice(0, 160)}</div>
                  )}
                </div>
              </StatusSection>
            )}
          </div>
        </aside>
      </div>

      {/* 故事记录抽屉(全量回看) */}
      {logOpen && (
        <div className="story-log" onClick={(e) => e.target.classList.contains("story-log") && setLogOpen(false)}>
          <div className="story-log-panel">
            <div className="story-log-head">
              <span className="t-kai">Story log</span>
              <span className="t-meta">{storyTurns.length} {storyTurns.length === 1 ? "turn" : "turns"}</span>
              <button className="story-log-x" onClick={() => setLogOpen(false)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="story-log-body">
              {(() => {
                let n = 0;
                return turns.map((t, i) => {
                  if (t.kind === "player") {
                    return (
                      <div className="story-log-me" key={i}>
                        <span className="story-log-me-tag t-meta">You</span>
                        {t.text}
                      </div>
                    );
                  }
                  n++;
                  const d = t.data || {};
                  return (
                    <div className="story-log-turn" key={i}>
                      <div className="story-log-rd t-meta">ROUND {String(n).padStart(2, "0")}</div>
                      {d.narration && <Narration text={d.narration} />}
                      <Dialogue messages={d.messages} />
                      {(d.triggered_events || []).length > 0 && (
                        <div className="story-log-ev t-meta">Triggered events: {d.triggered_events.join(", ")}</div>
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
