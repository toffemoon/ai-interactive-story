import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Button } from "../components/ui";
import { getJSON, postJSON, newSessionId } from "../lib/api";
import { useAuth } from "../state/auth";
import { useGame } from "../state/game";
import "./Home.css";

// 立绘主页(家)· YOR-136 · galgame 式登录后首屏。
// 对话直接抄纯聊(/api/chat 发送 + session + 重开);首页 = 单联系人面对面 + 立绘场景皮 + 静态招呼。
// 默认糖沐(取《新人入店》预设);换角色从我的角色卡库(/api/library/characters)、沿用该卡设定。
// 主按钮:探索故事→/explore(常驻发现路径);继续故事(有进行中 game/存档才显)→存档窗口→/play。
const HOME_KEY = "ais_home_v1";
const TANGMU_IMG = "/home/tangmu1.png";
const BG_IMG = "/home/background.png";
const GREETING_NEW =
  "初次见面。我是糖沐,这家书坊的店员。你写的故事、想见的人,都能在这儿活过来——先挑一本读读,还是先跟我说说话?";
const GREETING_BACK = "欢迎回来。上次那段还悬着呢——接着往下,还是换一本新的?";
// 兜底糖沐卡:presets 取不到时(后端抖动/无该预设)仍能聊,不卡在「正在把糖沐请出来」。
const FALLBACK_TANGMU = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "糖沐",
    persona: "沐言书坊的店员、看板娘。温和爱书,话里带点暖意,常引着客人挑一本故事读。",
    description: "这家「就是网站」的书店咖啡馆的店员,带你认识沐言。",
  },
};

function cardName(card) {
  const d = (card && card.data) || card || {};
  return d.name || (card && card.name) || "";
}
function cardImageOf(card) {
  const d = (card && card.data) || card || {};
  return d.image || d.avatar || "";
}

export default function Home() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { game } = useGame();

  const [tangmuCard, setTangmuCard] = useState(null); // 默认糖沐卡(供切回)
  const [card, setCard] = useState(null); // 当前对话角色卡
  const [isTangmu, setIsTangmu] = useState(true);
  const [messages, setMessages] = useState([]); // [{who,text,t}]
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(() => newSessionId());
  const [serverSaves, setServerSaves] = useState([]);
  const [switcher, setSwitcher] = useState(null); // {items,err?} | null
  const [savesModal, setSavesModal] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const restoredRef = useRef(false);

  const displayName = cardName(card) || (isTangmu ? "糖沐" : "角色");
  const image = isTangmu ? TANGMU_IMG : cardImageOf(card);
  const hasSaves = !!game || serverSaves.length > 0;
  const isReturning = hasSaves || messages.length > 0;
  const greeting = isReturning ? GREETING_BACK : GREETING_NEW;

  // 对话框当前台词:最近一条角色发言,无则招呼语。
  const currentLine = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].who !== "me") return messages[i].text;
    }
    return greeting;
  }, [messages, greeting]);

  // 恢复本机首页会话(同步,先于 presets 落卡)。
  useEffect(() => {
    let r = null;
    try {
      r = JSON.parse(localStorage.getItem(HOME_KEY) || "null");
    } catch (e) {}
    if (r && r.card) {
      restoredRef.current = true;
      setCard(r.card);
      setIsTangmu(!!r.isTangmu);
      setSessionId(r.sessionId || newSessionId());
      setMessages(Array.isArray(r.msgs) ? r.msgs : []);
    }
  }, []);

  // 拉默认糖沐卡(《新人入店》characters 里 name 含「糖沐」)。
  useEffect(() => {
    getJSON("/api/presets")
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        let t = null;
        for (const p of list) {
          const chars = (p.data && p.data.characters) || [];
          const hit = chars.find((c) => cardName(c).includes("糖沐"));
          if (hit) {
            t = hit;
            break;
          }
        }
        setTangmuCard(t || FALLBACK_TANGMU);
        if (!restoredRef.current) setCard((cur) => cur || t || FALLBACK_TANGMU); // 没恢复出卡才用糖沐(取不到走兜底)
      })
      .catch(() => {
        setTangmuCard((c) => c || FALLBACK_TANGMU);
        if (!restoredRef.current) setCard((cur) => cur || FALLBACK_TANGMU);
      });
  }, []);

  // 服务端存档(登录;占位卡过滤),用于「继续故事」入口显隐 + 存档窗口。
  useEffect(() => {
    if (!user) return;
    getJSON("/api/my/sessions")
      .then((rows) => setServerSaves((Array.isArray(rows) ? rows : []).filter((s) => (s.turns || 0) > 0)))
      .catch(() => {});
  }, [user]);

  // 持久化首页会话。
  useEffect(() => {
    if (!card) return;
    try {
      localStorage.setItem(HOME_KEY, JSON.stringify({ card, isTangmu, sessionId, msgs: messages.slice(-40) }));
    } catch (e) {}
  }, [card, isTangmu, sessionId, messages]);

  // 全屏(截图态):隐藏一切 UI(含全局唤出钮),只留背景+立绘。
  // 退出方式:点击任意处 / 按 Esc / 角落按钮(细节⑧)。
  useEffect(() => {
    const el = document.documentElement;
    if (!fullscreen) {
      el.classList.remove("ais-home-fullscreen");
      return undefined;
    }
    el.classList.add("ais-home-fullscreen");
    const onKey = (e) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      el.classList.remove("ais-home-fullscreen");
      window.removeEventListener("keydown", onKey);
    };
  }, [fullscreen]);

  async function send() {
    const text = input.trim();
    if (!text || busy || !card) return;
    setBusy(true);
    setMessages((m) => [...m, { who: "me", text, t: Date.now() }]);
    setInput("");
    try {
      const r = await postJSON("/api/chat", { card, session_id: sessionId, user: text, world: null });
      setMessages((m) => [...m, { who: displayName, text: (r && r.reply) || "(无回应)", t: Date.now() }]);
    } catch (e) {
      setMessages((m) => [...m, { who: displayName, text: "(连接出错:" + e.message + ")", t: Date.now() }]);
    } finally {
      setBusy(false);
    }
  }

  // 重开(抄纯聊 newChat):清会话 + 清本地对话 → 回静态招呼。
  function restart() {
    if (busy) return;
    setMessages([]);
    setSessionId(newSessionId());
  }

  async function openSwitcher() {
    try {
      const items = await getJSON("/api/library/characters");
      setSwitcher({ items: Array.isArray(items) ? items : [] });
    } catch (e) {
      setSwitcher({ items: [], err: e.message });
    }
  }
  function pickTangmu() {
    setCard(tangmuCard);
    setIsTangmu(true);
    setMessages([]);
    setSessionId(newSessionId());
    setSwitcher(null);
  }
  function pickChar(item) {
    const c = item && item.data ? item.data : item; // 沿用该卡设定
    setCard(c);
    setIsTangmu(false);
    setMessages([]);
    setSessionId(newSessionId());
    setSwitcher(null);
  }

  function libItemName(it) {
    const d = (it && it.data && it.data.data) || (it && it.data) || {};
    return d.name || it.name || "未命名";
  }

  return (
    <div className={"home" + (fullscreen ? " is-fullscreen" : "")}>
      {/* 背景层 */}
      <div className="home-bg" style={{ backgroundImage: `url("${BG_IMG}")` }} aria-hidden="true" />
      <div className="home-bg-scrim" aria-hidden="true" />

      {/* 立绘层(换角色淡入:只动 opacity) */}
      <motion.div
        className="home-portrait"
        key={displayName}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        {image ? (
          <img src={image} alt={displayName} draggable="false" />
        ) : (
          <span className="home-portrait-ph t-kai">{displayName.slice(0, 2)}</span>
        )}
      </motion.div>

      {/* 全屏:整屏点击捕获层(点任意处退出);只在全屏存在,不干扰常态交互、无冒泡竞态 */}
      {fullscreen && <div className="home-fs-catcher" onClick={() => setFullscreen(false)} aria-hidden="true" />}
      {/* 全屏退出角标(Esc / 点任意处 / 点这里 都可退) */}
      {fullscreen && (
        <button className="home-exitfs t-meta" onClick={() => setFullscreen(false)} aria-label="退出全屏">
          ✕ 退出全屏
        </button>
      )}

      {/* 前景 UI(全屏态隐藏) */}
      {!fullscreen && (
        <div className="home-ui">
          {/* 底部交互坞:主按钮行(贴对话框上方右对齐)+ 对话框聚成一组,不再悬空 */}
          <div className="home-dock">
            <div className="home-actions">
              <Button variant="primary" className="home-go" onClick={() => navigate("/explore")}>
                {isReturning ? "探索故事" : "开始故事"}
              </Button>
              {hasSaves && (
                <Button variant="secondary" className="home-go" onClick={() => setSavesModal(true)}>
                  继续故事
                </Button>
              )}
            </div>

            {/* 对话框 */}
            <div className="home-dialogue">
            <div className="home-dlg-head">
              <span className="home-dlg-name t-kai">{displayName}</span>
              <div className="home-dlg-tools">
                <button className="home-tool" onClick={openSwitcher} title="换个人聊" aria-label="换个人聊">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="8" r="3" />
                    <path d="M3.5 19c0-3 2.5-4.5 5.5-4.5" />
                    <path d="M16 6l3 0 0 3" />
                    <path d="M19 6l-4 4" />
                    <circle cx="16.5" cy="16" r="3" />
                    <path d="M21 19c0-2-1.8-3-4.5-3" />
                  </svg>
                </button>
                <button className="home-tool" onClick={restart} disabled={busy} title="重开(清空这段对话)" aria-label="重开">⟳</button>
                <button className="home-tool" onClick={() => setLogOpen(true)} disabled={!messages.length} title="查看记录" aria-label="查看记录">≡</button>
                <button className="home-tool" onClick={() => setFullscreen(true)} title="全屏(只留背景+立绘,方便截图)" aria-label="全屏">⛶</button>
              </div>
            </div>
            <p className="home-dlg-line t-read">{busy ? `(${displayName}正在回应…)` : currentLine}</p>
            <div className="home-composer">
              <input
                className="home-input"
                value={input}
                disabled={busy || !card}
                placeholder={card ? "和 " + displayName + " 说点什么…" : "正在把糖沐请出来…"}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !busy) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <Button variant="primary" onClick={send} disabled={busy || !input.trim() || !card}>
                发送
              </Button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* 换角色 picker */}
      {switcher && (
        <div className="home-modal" onClick={() => setSwitcher(null)}>
          <div className="home-modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="home-modal-x" onClick={() => setSwitcher(null)} aria-label="关闭">×</button>
            <h2 className="t-h2">换个人聊</h2>
            <p className="t-meta home-modal-sub">挑一张你的角色卡,沿用 TA 自己的设定。</p>
            <div className="home-switch-list">
              <button className="home-switch-item" onClick={pickTangmu}>
                <span className="home-switch-av" style={{ backgroundImage: `url("${TANGMU_IMG}")` }} />
                <span className="t-ui-sm">糖沐 · 看板娘(默认)</span>
              </button>
              {switcher.items.length ? (
                switcher.items.map((it, i) => {
                  const raw = (it && it.data && it.data.data) || (it && it.data) || {};
                  const img = raw.image || raw.avatar;
                  return (
                    <button className="home-switch-item" key={i} onClick={() => pickChar(it)}>
                      <span className="home-switch-av" style={img ? { backgroundImage: `url("${img}")` } : undefined}>
                        {!img && libItemName(it).slice(0, 1)}
                      </span>
                      <span className="t-ui-sm">{libItemName(it)}</span>
                    </button>
                  );
                })
              ) : (
                <p className="t-ui home-modal-sub">{switcher.err ? "读库失败:" + switcher.err : "卡库里还没有你的角色卡。去创作造一张。"}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 存档窗口(继续故事) */}
      {savesModal && (
        <div className="home-modal" onClick={() => setSavesModal(false)}>
          <div className="home-modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="home-modal-x" onClick={() => setSavesModal(false)} aria-label="关闭">×</button>
            <h2 className="t-h2">继续故事</h2>
            <div className="home-saves">
              {game && (
                <button className="home-save home-save--cur" onClick={() => navigate("/play")}>
                  <span className="home-save-dot" aria-hidden="true" />
                  <span className="home-save-tx">
                    <span className="t-ui-sm">{game.title || "当前故事"}</span>
                    <span className="t-meta">本机进行中 · 点继续</span>
                  </span>
                  <span className="t-meta">继续 →</span>
                </button>
              )}
              {serverSaves.map((s) => (
                <button className="home-save" key={s.id} onClick={() => navigate("/mine")} title="在「我的」存档里查看">
                  <span className="home-save-tx">
                    <span className="t-ui-sm">{s.story || s.player || "未命名存档"}</span>
                    <span className="t-meta">第 {s.turns} 回合{s.updated_at ? " · " + String(s.updated_at).slice(0, 16) : ""}</span>
                  </span>
                  <span className="t-meta">我的 →</span>
                </button>
              ))}
              {!game && !serverSaves.length && (
                <p className="t-ui home-modal-sub">还没有进行中的故事。去探索取一本书开局。</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 查看记录 */}
      {logOpen && (
        <div className="home-modal" onClick={() => setLogOpen(false)}>
          <div className="home-modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="home-modal-x" onClick={() => setLogOpen(false)} aria-label="关闭">×</button>
            <h2 className="t-h2">和 {displayName} 的记录</h2>
            <div className="home-log">
              {messages.length ? (
                messages.map((m, i) => (
                  <div key={i} className={"home-log-row" + (m.who === "me" ? " is-me" : "")}>
                    <span className="home-log-who t-meta">{m.who === "me" ? "你" : m.who}</span>
                    <span className="home-log-text t-ui">{m.text}</span>
                  </div>
                ))
              ) : (
                <p className="t-ui home-modal-sub">还没聊过。在下面说第一句吧。</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
