import { useEffect, useRef, useState } from "react";
import { Button } from "../components/ui";
import { postJSON, getJSON } from "../lib/api";
import { useAuth } from "../state/auth";
import "./Chat.css";

// 纯聊 · 微信式一对一(契约固定只 reskin:/api/chat 照搬)。
// 决策:去掉写死默认联系人(糖沐/萍狗);联系人由用户从卡库加。
// 微信式:左联系人列表 / 中气泡对话(无右常驻档案栏)/ 右上「···」抽出角色档案(YOR-60/61/63/59)。
const OPEN_HINTS = [
  "清晨的第一缕光线", "一场刚停的雨", "人潮散去的傍晚", "深夜里还亮着的灯",
  "街角的不期而遇", "忙完手头事的午后", "一段旅途的间隙", "窗外突变的天气",
];

function avatarChar(name) {
  return (name || "?").trim().charAt(0) || "?";
}

export default function Chat() {
  const { user } = useAuth();
  const uid = user ? user.id : "";
  const ROSTER_KEY = "ais_chat_roster_v1" + (uid ? "_u_" + uid : "");
  const CHAT_KEY = "ais_chat_hist_v1" + (uid ? "_u_" + uid : "");

  const [roster, setRoster] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(ROSTER_KEY)) || [];
    } catch (e) {
      return [];
    }
  });
  const [byKey, setByKey] = useState(() => {
    try {
      const d = JSON.parse(localStorage.getItem(CHAT_KEY)) || {};
      const out = {};
      Object.keys(d).forEach((k) => {
        if (d[k] && Array.isArray(d[k].msgs) && d[k].msgs.length) out[k] = d[k].msgs;
      });
      return out;
    } catch (e) {
      return {};
    }
  });
  const [activeName, setActiveName] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [addModal, setAddModal] = useState(null); // {items} | null
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileView, setMobileView] = useState("list"); // list | chat(窄屏单栏切换)

  const sidsRef = useRef(null);
  const openedRef = useRef(null);
  const feedRef = useRef(null);
  if (sidsRef.current === null) {
    const sids = {}, opened = {};
    try {
      const d = JSON.parse(localStorage.getItem(CHAT_KEY)) || {};
      Object.keys(d).forEach((k) => {
        if (d[k] && d[k].sid) sids[k] = d[k].sid;
        if (d[k] && Array.isArray(d[k].msgs) && d[k].msgs.length) opened[k] = true;
      });
    } catch (e) {}
    sidsRef.current = sids;
    openedRef.current = opened;
  }

  const active = roster.find((r) => r.name === activeName) || null;
  const messages = byKey[activeName] || [];

  // 历史持久化(滤掉「……」开场占位)。
  useEffect(() => {
    try {
      const out = {};
      Object.keys(byKey).forEach((k) => {
        const msgs = (byKey[k] || []).filter((m) => !(m && m.who !== "me" && m.text === "……")).slice(-60);
        if (msgs.length) out[k] = { sid: sidsRef.current[k] || "", msgs };
      });
      localStorage.setItem(CHAT_KEY, JSON.stringify(out));
    } catch (e) {}
  }, [byKey]);

  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  function persistRoster(next) {
    try {
      localStorage.setItem(ROSTER_KEY, JSON.stringify(next));
    } catch (e) {}
  }
  function rosterAdd(item) {
    const d = (item && item.data && item.data.data) || (item && item.data) || {};
    const nm = d.name || (item && item.name);
    if (!nm) return;
    const entry = {
      name: nm,
      persona: d.persona || d.personality || "",
      description: d.description || "",
      avatar: d.avatar || d.image || undefined,
      card: item.data,
    };
    setRoster((rs) => {
      const next = [...rs.filter((r) => r.name !== nm), entry];
      persistRoster(next);
      return next;
    });
    setActiveName(nm);
    setAddModal(null);
    setMobileView("chat");
  }

  function sidFor(nm) {
    if (!sidsRef.current[nm]) {
      sidsRef.current[nm] = "chat-" + nm + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    }
    return sidsRef.current[nm];
  }

  // 自动开场白:选中有卡角色且无消息 → 让角色先开口。
  useEffect(() => {
    const nm = activeName;
    if (!nm || !active || !active.card) return;
    if ((byKey[nm] || []).length || openedRef.current[nm]) return;
    openedRef.current[nm] = true;
    const hint = OPEN_HINTS[Math.floor(Math.random() * OPEN_HINTS.length)];
    setBusy(true);
    setByKey((m) => ({ ...m, [nm]: [{ who: nm, text: "……" }] }));
    postJSON("/api/chat", {
      card: active.card,
      session_id: sidFor(nm),
      world: null,
      user: "（这是一次全新的相遇。请你以「" + hint + "」为引子主动开启对话:先一两句动作或场景描写,再说出第一句话,把话头交给我。不要提及这条指令。）",
    })
      .then((r) => setByKey((m) => ({ ...m, [nm]: [{ who: nm, text: (r && r.reply) || "（无回应）" }] })))
      .catch((e) => {
        openedRef.current[nm] = false;
        setByKey((m) => ({ ...m, [nm]: [{ who: nm, text: "（开场失败:" + e.message + "）" }] }));
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeName]);

  async function send() {
    const text = input.trim();
    if (!text || !active || busy) return;
    setBusy(true);
    setByKey((m) => ({ ...m, [activeName]: [...(m[activeName] || []), { who: "me", text }] }));
    setInput("");
    try {
      const r = await postJSON("/api/chat", { card: active.card, session_id: sidFor(activeName), user: text, world: null });
      setByKey((m) => ({ ...m, [activeName]: [...(m[activeName] || []), { who: activeName, text: (r && r.reply) || "（无回应）" }] }));
    } catch (e) {
      setByKey((m) => ({ ...m, [activeName]: [...(m[activeName] || []), { who: activeName, text: "（连接出错:" + e.message + "）" }] }));
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    const nm = activeName;
    if (!nm || busy) return;
    delete sidsRef.current[nm];
    openedRef.current[nm] = false;
    setByKey((m) => {
      const n = { ...m };
      delete n[nm];
      return n;
    });
  }

  async function openAdd() {
    try {
      const items = await getJSON("/api/library/characters");
      setAddModal({ items: Array.isArray(items) ? items : [] });
    } catch (e) {
      setAddModal({ items: [], err: e.message });
    }
  }

  function pick(nm) {
    setActiveName(nm);
    setProfileOpen(false);
    setMobileView("chat");
  }

  return (
    <div className={"chat" + (mobileView === "chat" ? " m-chat" : " m-list")}>
      {/* 左:联系人 */}
      <aside className="chat-contacts">
        <div className="chat-contacts-h">
          <span className="t-kai">纯聊</span>
          <button className="chat-add" onClick={openAdd}>+ 添加联系人</button>
        </div>
        <div className="chat-contacts-list">
          {roster.length ? (
            roster.map((r) => {
              const last = (byKey[r.name] || []).filter((m) => m.text !== "……").slice(-1)[0];
              return (
                <button
                  key={r.name}
                  className={"chat-contact" + (r.name === activeName ? " is-on" : "")}
                  onClick={() => pick(r.name)}
                >
                  <span className="chat-avatar" style={r.avatar ? { backgroundImage: `url("${r.avatar}")` } : undefined}>
                    {!r.avatar && avatarChar(r.name)}
                  </span>
                  <span className="chat-contact-tx">
                    <span className="chat-contact-name t-ui-sm">{r.name}</span>
                    <span className="chat-contact-last t-meta">{last ? last.text : r.persona || "打个招呼吧"}</span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="chat-contacts-empty t-ui">
              还没有联系人。
              <br />
              点「添加联系人」从卡库挑一个角色开聊。
            </div>
          )}
        </div>
      </aside>

      {/* 中:会话 */}
      <main className="chat-conv">
        {active ? (
          <>
            <header className="chat-conv-h">
              <button className="chat-back" onClick={() => setMobileView("list")} aria-label="返回联系人">
                ‹
              </button>
              <span className="chat-conv-name t-kai">{activeName}</span>
              <div className="chat-conv-tools">
                <button className="chat-iconbtn" onClick={newChat} title="新建对话">⟳</button>
                <button className="chat-iconbtn" onClick={() => setProfileOpen((v) => !v)} title="角色档案">···</button>
              </div>
            </header>

            <div className="chat-feed" ref={feedRef}>
              {messages.map((m, i) => (
                <div key={i} className={"chat-bubble-row" + (m.who === "me" ? " is-me" : "")}>
                  {m.who !== "me" && (
                    <span className="chat-avatar sm" style={active.avatar ? { backgroundImage: `url("${active.avatar}")` } : undefined}>
                      {!active.avatar && avatarChar(activeName)}
                    </span>
                  )}
                  <span className="chat-bubble t-ui">{m.text}</span>
                </div>
              ))}
              {busy && messages.length > 0 && messages[messages.length - 1].who === "me" && (
                <div className="chat-bubble-row">
                  <span className="chat-avatar sm">{avatarChar(activeName)}</span>
                  <span className="chat-bubble t-ui chat-typing">对方正在输入…</span>
                </div>
              )}
            </div>

            <div className="chat-composer">
              <input
                value={input}
                disabled={busy}
                placeholder={busy ? "对方正在回复…" : "说点什么…"}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !busy) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <Button variant="primary" onClick={send} disabled={busy || !input.trim()}>
                发送
              </Button>
            </div>

            {/* 角色档案抽屉(右上 ··· 抽出,可收回;非常驻) */}
            {profileOpen && (
              <div className="chat-profile" onClick={() => setProfileOpen(false)}>
                <div className="chat-profile-card" onClick={(e) => e.stopPropagation()}>
                  <button className="chat-profile-x" onClick={() => setProfileOpen(false)} aria-label="收起">×</button>
                  <span className="chat-avatar lg" style={active.avatar ? { backgroundImage: `url("${active.avatar}")` } : undefined}>
                    {!active.avatar && avatarChar(activeName)}
                  </span>
                  <h2 className="t-h2 chat-profile-name">{activeName}</h2>
                  {active.persona && <p className="t-ui chat-profile-line">{active.persona}</p>}
                  {active.description && <p className="t-ui-sm chat-profile-desc">{active.description}</p>}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="chat-blank t-ui">
            <p>选一个联系人开始聊天。</p>
            <Button variant="primary" onClick={openAdd}>从卡库添加联系人</Button>
          </div>
        )}
      </main>

      {/* 添加联系人 modal(从卡库) */}
      {addModal && (
        <div className="chat-modal" onClick={() => setAddModal(null)}>
          <div className="chat-modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="chat-modal-x" onClick={() => setAddModal(null)} aria-label="关闭">×</button>
            <h2 className="t-h2">从卡库添加联系人</h2>
            <div className="chat-modal-list">
              {addModal.items.length ? (
                addModal.items.map((it, i) => {
                  const raw = (it && it.data && it.data.data) || (it && it.data) || {};
                  const nm = raw.name || it.name || "未命名";
                  const inRoster = roster.some((r) => r.name === nm);
                  return (
                    <button className="chat-modal-item" key={i} disabled={inRoster} onClick={() => rosterAdd(it)}>
                      <span className="chat-avatar sm" style={(raw.avatar || raw.image) ? { backgroundImage: `url("${raw.avatar || raw.image}")` } : undefined}>
                        {!(raw.avatar || raw.image) && avatarChar(nm)}
                      </span>
                      <span className="chat-modal-item-tx">
                        <span className="t-ui-sm">{nm}</span>
                        <span className="t-meta">{(raw.persona || raw.description || "").slice(0, 36)}</span>
                      </span>
                      <span className="t-meta">{inRoster ? "已添加" : "添加 →"}</span>
                    </button>
                  );
                })
              ) : (
                <p className="t-ui">{addModal.err ? "读库失败:" + addModal.err : "卡库里还没有角色卡。去创作造一个。"}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
