import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "../components/ui";
import { streamTurn, postJSON, extractStream } from "../lib/api";
import { useGame } from "../state/game";
import "./Story.css";

// 把一条台词按中文双引号拆段:引号内对白单独成行,引号外动作描写成行。
function splitSpeech(text) {
  const t = text || "";
  const parts = [];
  const re = /[“”][^“”]*[“”]/g;
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

const EMPTY = <span className="status-empty t-meta">暂无</span>;

export default function Story() {
  const { game } = useGame();
  const navigate = useNavigate();
  const [turns, setTurns] = useState([]);
  const [choices, setChoices] = useState([]);
  const [state, setState] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(null);
  const [error, setError] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  // 右状态栏:桌面默认展开(可收起),移动默认收起(抽屉)。state 同驱两端(细节⑥)。
  const [statusOpen, setStatusOpen] = useState(() => {
    try {
      return window.matchMedia("(min-width: 961px)").matches;
    } catch (e) {
      return true;
    }
  });
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

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streaming]);

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
      if (!finalTurn) throw new Error("没有拿到回合结果");
      setStreaming(null);
      setTurns((xs) => [...xs, { kind: "story", data: finalTurn }]);
      setChoices(finalTurn.choices || []);
      setState(finalTurn.state || null);
      setCanUndo(true);
    } catch (e) {
      setStreaming(null);
      setError("本轮生成失败:" + e.message);
    } finally {
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
    } catch (e) {
      setError("撤回失败:" + e.message);
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
    setError("");
    setChoices([]);
    try {
      const out = await postJSON("/api/reroll", { session_id: game.sessionId });
      setTurns((xs) => xs.map((t, i) => (i === idx ? { kind: "story", data: out } : t)));
      setChoices(out.choices || []);
      setState(out.state || null);
      setCanUndo(true);
    } catch (e) {
      setError("重新生成失败:" + e.message);
      setChoices(prevChoices); // 恢复原选项,避免无选项可点
    } finally {
      setLoading(false);
    }
  }

  function removeFromDeck(nm) {
    setDeck((dk) => ({ ...dk, characters: (dk.characters || []).filter((c) => ((c.data && c.data.name) || c.name) !== nm) }));
  }

  // 自动开场(只触发一次)。
  useEffect(() => {
    if (!game || openedRef.current) return;
    openedRef.current = true;
    runTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

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
        <button className="story-back" onClick={() => navigate("/explore")}>
          ← 离开
        </button>
        <div className="story-title t-kai">{game.title || "当前故事"}</div>
        <div className="story-top-right">
          {tokenTotal > 0 && <span className="t-mono story-usage">token {tokenTotal}</span>}
          <button className="story-toolbtn" disabled={!canUndo || loading} onClick={undoLast} title="撤回上一轮">
            撤回
          </button>
          <button className="story-toolbtn" disabled={!storyTurns.length || loading} onClick={rerollLast} title="重生成上一轮">
            重生成
          </button>
          <button className="story-toolbtn" disabled={!turns.length} onClick={() => setLogOpen(true)} title="故事记录">
            记录
          </button>
          <button className={"story-statusbtn" + (statusOpen ? " is-on" : "")} onClick={() => setStatusOpen((v) => !v)} title="世界状态(可收起)">
            {statusOpen ? "收起状态" : "世界状态"}
          </button>
          <button className={"story-toolbtn" + (dev ? " is-on" : "")} onClick={toggleDev} title="玩家仪表盘 / 开发者视图">
            dev
          </button>
        </div>
      </header>

      <div className="story-body">
        {/* 左:卡组栏(仅作者/dev 视图;玩家不见) */}
        {dev && (
          <aside className="story-deck">
            <div className="story-deck-h t-kai">卡组栏</div>
            <div className="story-deck-note t-meta">作者视图 · 移除随本局生效;编辑/上传归创作端</div>
            <div className="story-deck-list">
              {(deck.characters || []).map((c, i) => {
                const nm = (c.data && c.data.name) || c.name || "角色";
                return (
                  <div className="story-deck-card" key={i}>
                    <span className="story-deck-card-name t-ui-sm">{nm}</span>
                    <button className="story-deck-x" onClick={() => removeFromDeck(nm)} title="移出本局">
                      移除
                    </button>
                  </div>
                );
              })}
              {deck.world && <div className="story-deck-card"><span className="t-ui-sm">世界书</span></div>}
              {deck.story && <div className="story-deck-card"><span className="t-ui-sm">故事书</span></div>}
              {!(deck.characters || []).length && !deck.world && !deck.story && (
                <div className="status-empty t-meta">本局无卡组</div>
              )}
            </div>
          </aside>
        )}

        {/* 中:叙事区 */}
        <main className="story-stage">
          <div className="story-scene-head">
            <span className="story-round t-meta">第 {storyTurns.length || (loading ? 1 : 0)} 回合</span>
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
              <div className="story-pending t-ui-sm">推演中…</div>
            ) : null}

            {/* 选项并入叙事流、随内容滚动(细节③:不再单独固定底栏占空间) */}
            {choices.length > 0 && !loading && (
              <div className="story-choices">
                <span className="story-choices-hint t-meta">接下来,你可以——(点一个填进下方输入框,可改可直接发送)</span>
                {choices.map((c, i) => (
                  <button
                    key={c.id || i}
                    className="story-choice"
                    onClick={() => setInput(c.label)}
                    title="填入下方输入框,可改可直接执行"
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
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                  e.preventDefault();
                  runTurn({ text: input });
                }
              }}
              placeholder="写下你的行动或台词…（Enter 发送,Shift+Enter 换行;选项只是建议）"
              disabled={loading}
            />
            <Button variant="primary" onClick={() => runTurn({ text: input })} disabled={loading || !input.trim()}>
              发送
            </Button>
          </div>
        </main>

        {/* 右:世界状态(8 栏目,默认收起;移动端为抽屉) */}
        <aside className="story-status">
          <div className="story-status-h">
            <span className="t-kai">世界状态</span>
            <button className="story-status-x" onClick={() => setStatusOpen(false)} aria-label="收起">
              ×
            </button>
          </div>
          <div className="story-status-list">
            <StatusSection title="场景" open>
              {scene.location || scene.time || scene.atmosphere || (scene.present_characters || []).length ? (
                <div className="status-kv">
                  {scene.location && <div><span className="status-k">地点</span>{scene.location}</div>}
                  {scene.time && <div><span className="status-k">时间</span>{scene.time}</div>}
                  {scene.atmosphere && <div><span className="status-k">氛围</span>{scene.atmosphere}</div>}
                  {(scene.present_characters || []).length > 0 && (
                    <div><span className="status-k">在场</span>{scene.present_characters.join("、")}</div>
                  )}
                  {(scene.exits || []).length > 0 && <div><span className="status-k">出口</span>{scene.exits.join("、")}</div>}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="玩家">
              {ps.location || ps.status || (ps.active_goals || []).length || (ps.known_facts || []).length || (ps.inventory || []).length ? (
                <div className="status-kv">
                  {ps.location && <div><span className="status-k">位置</span>{ps.location}</div>}
                  {ps.status && <div><span className="status-k">状态</span>{ps.status}</div>}
                  {(ps.active_goals || []).length > 0 && <div><span className="status-k">目标</span>{ps.active_goals.join("；")}</div>}
                  {(ps.known_facts || []).length > 0 && <div><span className="status-k">已知</span>{ps.known_facts.join("；")}</div>}
                  {(ps.inventory || []).length > 0 && <div><span className="status-k">物品</span>{ps.inventory.join("、")}</div>}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="关系" count={rels.length || null}>
              {rels.length ? (
                <div className="status-rels">
                  {rels.map((r, i) => (
                    <div className="status-rel" key={i}>
                      <span className="status-rel-nm t-ui-sm">{r.character_id}</span>
                      <span className="status-rel-v t-meta">信任 {r.trust} · 张力 {r.tension} · 好感 {r.affection}</span>
                    </div>
                  ))}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="记忆卡" count={memWrites.length || null}>
              {memWrites.length ? (
                <div className="status-mem">
                  {memLong.length > 0 && (
                    <div className="status-mem-grp">
                      <div className="status-k">长期</div>
                      {memLong.slice(-8).map((m, i) => <div className="status-mem-i t-meta" key={i}>· {m.text}</div>)}
                    </div>
                  )}
                  {memShort.length > 0 && (
                    <div className="status-mem-grp">
                      <div className="status-k">短期</div>
                      {memShort.slice(-8).map((m, i) => <div className="status-mem-i t-meta" key={i}>· {m.text}</div>)}
                    </div>
                  )}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="Token 用量">
              {tokenTotal > 0 ? (
                <div className="status-kv">
                  <div><span className="status-k">本局累计</span>{tokenTotal}</div>
                  {usageBlock.total_tokens != null && <div><span className="status-k">上一轮</span>{usageBlock.total_tokens}</div>}
                  {usageBlock.calls != null && <div><span className="status-k">调用</span>{usageBlock.calls}</div>}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="历史书" count={(historyEvents.length || triggeredAll.length) || null}>
              {historyEvents.length || triggeredAll.length ? (
                <div className="status-hist">
                  {historyEvents.map((e, i) => <div className="status-hist-i t-meta" key={"h" + i}>· {e.title || e.event_id}</div>)}
                  {triggeredAll.slice(-8).map((e, i) => <div className="status-hist-i t-meta" key={"t" + i}>· {e}</div>)}
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            <StatusSection title="时间线" count={timelineShown.length || null}>
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

            <StatusSection title="地图">
              {/* 引擎暂无地图数据,先用场景位置/出口拼一张文字地图(YOR-95 待真地图字段) */}
              {scene.location || (scene.exits || []).length ? (
                <div className="status-map">
                  <div className="status-map-here t-kai">{scene.location || "未定地点"}</div>
                  {(scene.exits || []).length > 0 && (
                    <div className="status-map-exits t-meta">通向:{scene.exits.join(" / ")}</div>
                  )}
                  <div className="status-empty t-meta">完整世界地图待引擎提供</div>
                </div>
              ) : (
                EMPTY
              )}
            </StatusSection>

            {dev && (
              <StatusSection title="玩家仪表盘 · dev">
                <div className="status-kv">
                  <div><span className="status-k">turn</span>{(state && state.turn_count) || storyTurns.length}</div>
                  <div><span className="status-k">clock</span>{(state && state.clock_minutes) || 0} 分</div>
                  {state && state.main_resolved != null && <div><span className="status-k">主线</span>{state.main_resolved ? "已结案" : "进行中"}</div>}
                  {storyTurns.length > 0 && storyTurns[storyTurns.length - 1].data.reasoning && (
                    <div><span className="status-k">自检</span>{JSON.stringify(storyTurns[storyTurns.length - 1].data.reasoning).slice(0, 160)}</div>
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
              <span className="t-kai">故事记录</span>
              <span className="t-meta">{storyTurns.length} 回合</span>
              <button className="story-log-x" onClick={() => setLogOpen(false)} aria-label="关闭">
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
                        <span className="story-log-me-tag t-meta">你</span>
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
                        <div className="story-log-ev t-meta">触发事件:{d.triggered_events.join("、")}</div>
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
