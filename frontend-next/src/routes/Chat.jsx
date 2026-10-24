import { useEffect, useRef, useState } from "react";
import TopNav from "../components/shell/TopNav";
import { useNavigate } from "../lib/transitionNav";
import { postJSON, getJSON } from "../lib/api";
import { useAuth } from "../state/auth";
import { L, isZh } from "../lib/i18n";
import "./Chat.css";

// 纯聊 · 微信式一对一(契约固定只 reskin:/api/chat 照搬)。
// 决策:去掉写死默认联系人(糖沐/萍狗);联系人由用户从卡库加。
// 微信式:左联系人列表 / 中气泡对话(无右常驻档案栏)/ 右上「···」抽出角色档案(YOR-60/61/63/59)。
// 2026-10-25 C 幕间改版(画布「C 幕间 · 纯聊」):顶部 TopNav,左联系人 / 右会话,会话头「角色资料」「新对话」两颗实心按钮。
const OPEN_HINTS = L(
  [
    "the first light of morning", "a rain that just stopped", "an evening after the crowds have gone", "a lamp still on late at night",
    "a chance run-in on a street corner", "an afternoon after finishing your work", "a pause during a trip", "a sudden change in the weather outside",
  ],
  [
    "清晨的第一缕光线", "一场刚停的雨", "人潮散去的傍晚", "深夜里还亮着的灯",
    "街角的不期而遇", "忙完手头事的午后", "一段旅途的间隙", "窗外突变的天气",
  ]
);

function avatarChar(name) {
  return (name || "?").trim().charAt(0) || "?";
}

// 会话头名字旁的一个标签(画布里的「便利店」):取卡上第一个 tag,没有就不显示。
function cardTag(entry) {
  const c = entry && entry.card;
  const d = (c && c.data) || c || {};
  return (d.tags || [])[0] || "";
}

// 纯聊场景设定:告诉角色「这是在手机上用网络聊天软件文字聊天」(类微信)。
// 注入到卡的「当前情境(scenario)」→ 进后端 system prompt;只改前端发出的卡副本,不动卡库原卡、不碰引擎。
// 看板(立绘主页)是面对面对话、不注入这条。
const PHONE_CHAT_NOTE =
  L(
    "(Chat format: you and the other person are texting each other in a messaging app on your phones, like WhatsApp or iMessage. Follow the habits of instant messaging: keep messages short and casual, say only one or two sentences at a time, and use everyday punctuation or internet slang to show tone. Do not write long narration, and do not write lengthy descriptions of actions or expressions.)",
    "(聊天形式:你和对方正在用手机上的网络聊天软件打字聊天,就像微信。请贴合手机即时聊天的习惯——消息简短、口语化,一次只说一两句,用日常标点或网络说法表达语气;不要写大段旁白,也不要长篇的动作/神态描写。)"
  );
function chatCard(card) {
  if (!card) return card;
  const hasData = card.data && typeof card.data === "object";
  const inner = hasData ? card.data : card; // CharacterCard{data} 或直接 CharacterData 都兼容
  const base = inner.scenario ? inner.scenario + "\n\n" : "";
  const nextInner = { ...inner, scenario: base + PHONE_CHAT_NOTE };
  return hasData ? { ...card, data: nextInner } : nextInner;
}

// 微信式时间标:同日 HH:MM,跨日加月-日。
function fmtTime(t) {
  if (!t) return "";
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, "0");
  const hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
  const today = new Date();
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? hm : pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + hm;
}
const TIME_GAP = 5 * 60 * 1000; // 间隔 > 5 分钟才再插一条时间(类微信)

export default function Chat() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const uid = user ? user.id : "";
  const ROSTER_KEY = "ais_chat_roster_v1" + (uid ? "_u_" + uid : "");
  const CHAT_KEY = "ais_chat_hist_v1" + (uid ? "_u_" + uid : "");
  const ACTIVE_KEY = "ais_chat_active_v1" + (uid ? "_u_" + uid : ""); // 记住当前选中的联系人(YOR-195)
  // 恢复上次选中的联系人(切走再回来续上),校验仍在 roster 里,否则回空。
  const readActiveName = () => {
    try {
      const saved = localStorage.getItem(ACTIVE_KEY) || "";
      if (!saved) return "";
      const rs = JSON.parse(localStorage.getItem(ROSTER_KEY)) || [];
      return Array.isArray(rs) && rs.some((r) => r && r.name === saved) ? saved : "";
    } catch (e) {
      return "";
    }
  };

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
  const [activeName, setActiveName] = useState(readActiveName);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [addModal, setAddModal] = useState(null); // {items} | null
  const [addQ, setAddQ] = useState(""); // 添加联系人搜索(YOR-169)
  const [profileOpen, setProfileOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null); // 头像放大照片(细节⑩)
  const [mobileView, setMobileView] = useState(() => (readActiveName() ? "chat" : "list")); // list | chat(恢复了联系人则直接进会话,YOR-195)

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

  // 记住当前选中的联系人:切走再回来(路由重挂)时续上,不再掉回空白页(YOR-195)。
  useEffect(() => {
    try {
      if (activeName) localStorage.setItem(ACTIVE_KEY, activeName);
    } catch (e) {}
  }, [activeName]);

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
      image: d.image || d.avatar || undefined, // 立绘(详情顶部用,细节⑨)
      anim: d.anim || undefined, // 布偶/待机动画(有则优先)
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
      card: chatCard(active.card),
      session_id: sidFor(nm),
      world: null,
      user: L(
        "(This is a brand-new encounter. You are sending the other person your first message on your phone. Use \"" + hint + "\" as your reason to reach out and start the conversation: say one or two short, natural sentences, then hand the conversation over to me. Do not write long descriptions, and do not mention this instruction.)",
        "（这是一次全新的相遇,你正用手机给对方发第一条消息。请以「" + hint + "」为由头主动开口:简短自然地说一两句,把话头交给我。不要写大段描写,也不要提及这条指令。）"
      ),
    })
      // 落开场白前先看该会话有没有用户消息:并发竞态下(切到别的联系人使 busy 提前解锁、
      // 用户已给这人发过话)不能整组覆盖,否则会把用户刚发的消息抹掉(YOR-181)。
      .then((r) =>
        setByKey((m) => {
          const cur = m[nm] || [];
          if (cur.some((x) => x.who === "me")) return m;
          return { ...m, [nm]: [{ who: nm, text: (r && r.reply) || L("(No response)", "（无回应）"), t: Date.now() }] };
        })
      )
      .catch((e) => {
        openedRef.current[nm] = false;
        setByKey((m) => {
          const cur = m[nm] || [];
          if (cur.some((x) => x.who === "me")) return m;
          return { ...m, [nm]: [{ who: nm, text: L("(Couldn't start the chat: " + e.message + ")", "（开场失败:" + e.message + "）") }] };
        });
      })
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeName]);

  // 从探索「纯聊」带来的角色:进页即加进联系人并选中(探索卡去向)。
  useEffect(() => {
    let raw;
    try {
      raw = JSON.parse(sessionStorage.getItem("ais_chat_preload") || "null");
    } catch (e) {}
    if (!raw) return;
    try {
      sessionStorage.removeItem("ais_chat_preload");
    } catch (e) {}
    rosterAdd(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || !active || busy) return;
    setBusy(true);
    setByKey((m) => ({ ...m, [activeName]: [...(m[activeName] || []), { who: "me", text, t: Date.now() }] }));
    setInput("");
    try {
      const r = await postJSON("/api/chat", { card: chatCard(active.card), session_id: sidFor(activeName), user: text, world: null });
      setByKey((m) => ({ ...m, [activeName]: [...(m[activeName] || []), { who: activeName, text: (r && r.reply) || L("(No response)", "（无回应）"), t: Date.now() }] }));
    } catch (e) {
      setByKey((m) => ({ ...m, [activeName]: [...(m[activeName] || []), { who: activeName, text: L("(Connection error: " + e.message + ")", "（连接出错:" + e.message + "）") }] }));
    } finally {
      setBusy(false);
    }
  }

  function newChat() {
    const nm = activeName;
    if (!nm || busy) return;
    // 破坏性操作:清空整段记录且不可找回。聊过(有自己发的消息)就先确认,镜像看板重开的 M12 范式;
    // 只有自动开场白的对话不拦(没什么可丢的)。
    const talked = (byKey[nm] || []).some((m) => m.who === "me");
    if (talked && !window.confirm(L("Starting a new chat will clear your chat history with " + nm + ". Continue?", "新建对话会清空当前和 " + nm + " 的聊天记录,确定?"))) return;
    delete sidsRef.current[nm];
    openedRef.current[nm] = false;
    setByKey((m) => {
      const n = { ...m };
      delete n[nm];
      return n;
    });
  }

  function itemName(it) {
    const d = (it && it.data && it.data.data) || (it && it.data) || {};
    return d.name || (it && it.name) || L("Untitled", "未命名");
  }
  async function openAdd() {
    setAddQ("");
    try {
      const items = await getJSON("/api/library/characters");
      const list = Array.isArray(items) ? items : [];
      // 按首字母(拼音)排序(细节①)。
      list.sort((a, b) => itemName(a).localeCompare(itemName(b), isZh ? "zh" : "en"));
      setAddModal({ items: list });
    } catch (e) {
      setAddModal({ items: [], err: e.message });
    }
  }

  function pick(nm) {
    setActiveName(nm);
    setProfileOpen(false);
    setMobileView("chat");
  }

  const activeTag = active ? cardTag(active) : "";
  const typingName = activeName;

  return (
    <div className={"page chat" + (mobileView === "chat" ? " m-chat" : " m-list")}>
      <TopNav variant="bar" />
      <div className="chat-body">
        {/* 左:联系人 */}
        <section className="chat-contacts" aria-labelledby="chat-contacts-h">
          <div className="chat-contacts-h">
            <h1 id="chat-contacts-h">{L("Chat", "纯聊")}</h1>
            <button type="button" className="chat-pill" onClick={openAdd}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
              {L("Add contact", "添加联系人")}
            </button>
          </div>
          {roster.length ? (
            <ul className="chat-contacts-list">
              {roster.map((r) => {
                const last = (byKey[r.name] || []).filter((m) => m.text !== "……").slice(-1)[0];
                const on = r.name === activeName;
                return (
                  <li key={r.name}>
                    <button type="button" className={"chat-contact" + (on ? " is-on" : "")} aria-current={on ? "true" : undefined} onClick={() => pick(r.name)}>
                      <span className="chat-avatar" style={r.avatar ? { backgroundImage: `url("${r.avatar}")` } : undefined} aria-hidden="true">
                        {!r.avatar && avatarChar(r.name)}
                      </span>
                      <span className="chat-contact-tx">
                        <span className="chat-contact-name">{r.name}</span>
                        <span className="chat-contact-last">{last ? last.text : r.persona || L("Say hi", "打个招呼吧")}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="chat-contacts-empty">
              {L("No contacts yet.", "还没有联系人。")} {L('Tap "Add contact" to pick a character from your Card Library.', "点「添加联系人」从卡库挑一个角色开聊。")}
            </p>
          )}
        </section>

        {/* 右:会话 */}
        <section className="chat-conv" aria-labelledby={active ? "chat-conv-h" : undefined}>
          {active ? (
            <>
              <span className="chat-conv-glyph" aria-hidden="true">
                {avatarChar(activeName)}
              </span>
              <header className="chat-conv-head">
                <div className="chat-conv-title">
                  <button type="button" className="chat-back" onClick={() => setMobileView("list")} aria-label={L("Back to contacts", "返回联系人")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M15 5l-7 7 7 7" />
                    </svg>
                  </button>
                  <h2 id="chat-conv-h">{activeName}</h2>
                  {activeTag && <span className="chat-conv-tag">{activeTag}</span>}
                </div>
                <div className="chat-conv-tools">
                  <button type="button" className="chat-pill" aria-expanded={profileOpen} onClick={() => setProfileOpen((v) => !v)}>
                    {L("Profile", "角色资料")}
                  </button>
                  <button type="button" className="chat-pill" onClick={newChat} disabled={busy} title={busy ? L("Wait for the reply to finish", "等回复完再新建") : L("Start a new chat", "新建对话")}>
                    {L("New chat", "新对话")}
                  </button>
                </div>
              </header>

              <div className="chat-feed" ref={feedRef} aria-live="polite">
                {messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const showTime = m.t && (i === 0 || !prev || !prev.t || m.t - prev.t > TIME_GAP);
                  const typing = m.text === "……";
                  return (
                    <div key={i} className="chat-msg-wrap">
                      {showTime && <p className="chat-time">{fmtTime(m.t)}</p>}
                      {typing ? (
                        <p className="chat-typing">
                          <span className="chat-typing-dots" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                          {L(`${typingName} is typing`, `${typingName} 正在输入`)}
                        </p>
                      ) : m.who === "me" ? (
                        <p className="chat-bubble chat-bubble--me">{m.text}</p>
                      ) : (
                        <div className="chat-bubble-row">
                          <span
                            className={"chat-avatar sm" + (active.avatar ? " is-photo" : "")}
                            style={active.avatar ? { backgroundImage: `url("${active.avatar}")` } : undefined}
                            onClick={() => active.avatar && setLightbox(active.avatar)}
                            title={active.avatar ? L("View full size", "看大图") : undefined}
                            aria-hidden="true"
                          >
                            {!active.avatar && avatarChar(activeName)}
                          </span>
                          <p className="chat-bubble">{m.text}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
                {busy && messages.length > 0 && messages[messages.length - 1].who === "me" && (
                  <p className="chat-typing">
                    <span className="chat-typing-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                    {L(`${typingName} is typing`, `${typingName} 正在输入`)}
                  </p>
                )}
              </div>

              <form
                className="chat-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <label className="chat-input">
                  <span className="sr-only">{L("Message", "消息")}</span>
                  <input
                    value={input}
                    disabled={busy}
                    placeholder={busy ? L("Waiting for a reply…", "对方正在回复…") : L("Say something…", "说点什么…")}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent || e).isComposing && !busy) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                </label>
                <button type="submit" className="chat-send" disabled={busy || !input.trim()}>
                  {L("Send", "发送")}
                </button>
              </form>

              {/* 角色资料抽屉(非常驻) */}
              {profileOpen && (
                <div className="chat-profile" onClick={() => setProfileOpen(false)}>
                  <div className="chat-profile-card" role="dialog" aria-modal="true" aria-labelledby="chat-profile-h" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="chat-profile-x" onClick={() => setProfileOpen(false)} aria-label={L("Close", "收起")}>
                      ×
                    </button>
                    {/* 顶部放立绘 / 布偶动画,而非头像(细节⑨) */}
                    <div className="chat-profile-art">
                      {active.anim ? (
                        <video src={active.anim} autoPlay loop muted playsInline />
                      ) : active.image ? (
                        <img src={active.image} alt={activeName} />
                      ) : (
                        <span className="chat-profile-art-ph">{avatarChar(activeName)}</span>
                      )}
                    </div>
                    <h2 id="chat-profile-h" className="chat-profile-name">
                      {activeName}
                    </h2>
                    {active.persona && <p className="chat-profile-line">{active.persona}</p>}
                    {active.description && <p className="chat-profile-desc">{active.description}</p>}
                  </div>
                </div>
              )}

              {/* 头像放大照片(周围压暗,细节⑩) */}
              {lightbox && (
                <div className="chat-lightbox" onClick={() => setLightbox(null)}>
                  <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
                </div>
              )}
            </>
          ) : (
            <div className="chat-blank">
              <p>{L("Pick a contact to start chatting.", "选一个联系人开始聊天。")}</p>
              <button type="button" className="chat-send chat-send--wide" onClick={openAdd}>
                {L("Add a contact from your Card Library", "从卡库添加联系人")}
              </button>
            </div>
          )}
        </section>
      </div>

      {/* 添加联系人(从卡库) */}
      {addModal && (
        <div className="chat-modal" onClick={() => setAddModal(null)}>
          <div className="chat-modal-card" role="dialog" aria-modal="true" aria-labelledby="chat-add-h" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="chat-modal-x" onClick={() => setAddModal(null)} aria-label={L("Close", "关闭")}>
              ×
            </button>
            <h2 id="chat-add-h">{L("Add a contact from your Card Library", "从卡库添加联系人")}</h2>
            {/* 卡库线性增长,平铺翻不动:前端过滤,范式同创作页「补素材」搜索(YOR-169) */}
            {addModal.items.length > 0 && (
              <label className="chat-modal-search">
                <span className="sr-only">{L("Search characters", "搜角色")}</span>
                <input value={addQ} onChange={(e) => setAddQ(e.target.value)} placeholder={L("Search characters: name / bio…", "搜角色:名字 / 简介…")} />
              </label>
            )}
            <div className="chat-modal-list">
              {(() => {
                const s = addQ.trim().toLowerCase();
                const list = addModal.items.filter((it) => {
                  if (!s) return true;
                  const raw = (it && it.data && it.data.data) || (it && it.data) || {};
                  const nm = raw.name || it.name || "";
                  return (nm + " " + (raw.persona || raw.description || "")).toLowerCase().includes(s);
                });
                if (!list.length) {
                  // YOR-194:空库/读库失败给可点出路(去创作/重试),不再死胡同;仅搜索无匹配时保持纯文字。
                  if (addModal.items.length) {
                    return <p className="chat-modal-note">{L(`No characters match "${addQ.trim()}".`, `没有匹配「${addQ.trim()}」的角色卡。`)}</p>;
                  }
                  return (
                    <div className="chat-modal-empty">
                      <p className="chat-modal-note">{addModal.err ? L("Failed to load the Card Library: ", "读库失败:") + addModal.err : L("No characters in your Card Library yet.", "卡库里还没有角色卡。")}</p>
                      {addModal.err ? (
                        <button type="button" className="chat-pill" onClick={openAdd}>
                          {L("Retry", "重试")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="chat-send chat-send--wide"
                          onClick={() => {
                            setAddModal(null);
                            navigate("/create");
                          }}
                        >
                          {L("Create one →", "去创作一张 →")}
                        </button>
                      )}
                    </div>
                  );
                }
                return list.map((it, i) => {
                  const raw = (it && it.data && it.data.data) || (it && it.data) || {};
                  const nm = raw.name || it.name || L("Untitled", "未命名");
                  const inRoster = roster.some((r) => r.name === nm);
                  return (
                    <button type="button" className="chat-modal-item" key={i} disabled={inRoster} onClick={() => rosterAdd(it)}>
                      <span className="chat-avatar sm" style={raw.avatar || raw.image ? { backgroundImage: `url("${raw.avatar || raw.image}")` } : undefined} aria-hidden="true">
                        {!(raw.avatar || raw.image) && avatarChar(nm)}
                      </span>
                      <span className="chat-modal-item-tx">
                        <span className="chat-modal-item-name">{nm}</span>
                        <span className="chat-modal-item-sub">{(raw.persona || raw.description || "").slice(0, 36)}</span>
                      </span>
                      <span className="chat-modal-item-go">{inRoster ? L("Added", "已添加") : L("Add →", "添加 →")}</span>
                    </button>
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
