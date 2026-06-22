import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button, Tag } from "../components/ui";
import { streamTurn, postJSON, extractStream } from "../lib/api";
import { useGame } from "../state/game";
import "./Story.css";

// 把一条台词按中文双引号拆段:引号内对白单独成行,引号外动作描写成行(同现有 splitSpeech)。
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

export default function Story() {
  const { game, clearGame } = useGame();
  const navigate = useNavigate();
  const [turns, setTurns] = useState([]);
  const [choices, setChoices] = useState([]);
  const [state, setState] = useState(null);
  const [usage, setUsage] = useState(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(null);
  const [error, setError] = useState("");
  const feedRef = useRef(null);
  const openedRef = useRef(false);

  // 跟随到底:新回合 / 流式到达时滚到底
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, streaming]);

  async function runTurn({ text = "", choice = "" } = {}) {
    if (loading || !game) return;
    const action = text.trim();
    if (action || choice) setTurns((xs) => [...xs, { kind: "player", text: action || choice }]);
    setInput("");
    setStreaming(null);
    setChoices([]);
    setLoading(true);
    setError("");
    const body = {
      characters: game.characters,
      world: game.world,
      story: game.story,
      player: game.player,
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
      setUsage(finalTurn.usage || null);
    } catch (e) {
      setStreaming(null);
      setError("本轮生成失败:" + e.message);
    } finally {
      setLoading(false);
    }
  }

  // 自动开场:进局后没有任何回合 → 先演给玩家看(只触发一次)。
  useEffect(() => {
    if (!game || openedRef.current) return;
    openedRef.current = true;
    runTurn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game]);

  if (!game) return <Navigate to="/explore" replace />;

  const scene = (state && state.scene) || {};

  return (
    <div className="story">
      <header className="story-top">
        <button
          className="story-back"
          onClick={() => {
            clearGame();
            navigate("/explore");
          }}
        >
          ← 离开
        </button>
        <div className="story-title t-kai">{game.title || "当前故事"}</div>
        <div className="story-top-right">
          {usage && usage.total_tokens ? <span className="t-mono story-usage">token {usage.total_tokens}</span> : null}
        </div>
      </header>

      {(scene.location || scene.time || (state && state.relationship)) && (
        <div className="story-statusbar">
          {scene.location && <Tag tone="scene">场景 · {scene.location}</Tag>}
          {scene.time && <Tag tone="scene">{scene.time}</Tag>}
          {state && state.relationship && state.relationship.summary && (
            <Tag tone="relation">关系 · {state.relationship.summary}</Tag>
          )}
        </div>
      )}

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

        {error && <div className="story-error t-ui-sm">{error}</div>}
      </div>

      {choices.length > 0 && !loading && (
        <div className="story-choices">
          {choices.map((c, i) => (
            <button key={c.id || i} className="story-choice" onClick={() => runTurn({ choice: c.label })}>
              <span className="story-choice-label t-ui">{c.label}</span>
              {c.description && <span className="story-choice-desc t-meta">{c.description}</span>}
            </button>
          ))}
        </div>
      )}

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
          placeholder="写下你的行动或台词…(Enter 发送,Shift+Enter 换行)"
          disabled={loading}
        />
        <Button variant="primary" onClick={() => runTurn({ text: input })} disabled={loading || !input.trim()}>
          发送
        </Button>
      </div>
    </div>
  );
}
