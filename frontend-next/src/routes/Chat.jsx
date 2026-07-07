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

// 纯聊场景设定:告诉角色「这是在手机上用网络聊天软件文字聊天」(类微信)。
// 注入到卡的「当前情境(scenario)」→ 进后端 system prompt;只改前端发出的卡副本,不动卡库原卡、不碰引擎。
// 看板(立绘主页)是面对面对话、不注入这条。
const PHONE_CHAT_NOTE =
  "(聊天形式:你和对方正在用手机上的网络聊天软件打字聊天,就像微信。请贴合手机即时聊天的习惯——消息简短、口语化,一次只说一两句,用日常标点或网络说法表达语气;不要写大段旁白,也不要长篇的动作/神态描写。)";
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
  const [addQ, setAddQ] = useState(""); // 添加联系人搜索(YOR-169)
  const [profileOpen, setProfileOpen] = useState(false);
  const [lightbox, setLightbox] = useState(null); // 头像放大照片(细节⑩)
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
      user: "（这是一次全新的相遇,你正用手机给对方发第一条消息。请以「" + hint + "」为由头主动开口:简短自然地说一两句,把话头交给我。不要写大段描写,也不要提及这条指令。）",
    })
      // 落开场白前先看该会话有没有用户消息:并发竞态下(切到别的联系人使 busy 提前解锁、
      // 用户已给这人发过话)不能整组覆盖,否则会把用户刚发的消息抹掉(YOR-181)。
      .then((r) =>
        setByKey((m) => {
          const cur = m[nm] || [];
          if (cur.some((x) => x.who === "me")) return m;
          return { ...m, [nm]: [{ who: nm, text: (r && r.reply) || "（无回应）", t: Date.now() }] };
        })
      )
      .catch((e) => {
        openedRef.current[nm] = false;
        setByKey((m) => {
          const cur = m[nm] || [];
          if (cur.some((x) => x.who === "me")) return m;
          return { ...m, [nm]: [{ who: nm, text: "（开场失败:" + e.message + "）" }] };
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
      setByKey((m) => ({ ...m, [activeName]: [...(m[activeName] || []), { who: activeName, text: (r && r.reply) || "（无回应）", t: Date.now() }] }));
    } catch (e) {
      setByKey((m) => ({ ...m, [activeName]: [...(m[activeName] || []), { who: activeName, text: "（连接出错:" + e.message + "）" }] }));
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
    if (talked && !window.confirm("新建对话会清空当前和 " + nm + " 的聊天记录,确定?")) return;
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
    return d.name || (it && it.name) || "未命名";
  }
  async function openAdd() {
    setAddQ("");
    try {
      const items = await getJSON("/api/library/characters");
      const list = Array.isArray(items) ? items : [];
      // 按首字母(拼音)排序(细节①)。
      list.sort((a, b) => itemName(a).localeCompare(itemName(b), "zh"));
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
                <button className="chat-iconbtn" onClick={newChat} disabled={busy} title={busy ? "等回复完再新建" : "新建对话"}>⟳</button>
                <button className="chat-iconbtn" onClick={() => setProfileOpen((v) => !v)} title="角色档案">···</button>
              </div>
            </header>

            <div className="chat-feed" ref={feedRef}>
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const showTime = m.t && (i === 0 || !prev || !prev.t || m.t - prev.t > TIME_GAP);
                return (
                  <div key={i} className="chat-msg-wrap">
                    {showTime && <div className="chat-time t-meta">{fmtTime(m.t)}</div>}
                    <div className={"chat-bubble-row" + (m.who === "me" ? " is-me" : "")}>
                      {m.who !== "me" && (
                        <span
                          className={"chat-avatar sm" + (active.avatar ? " is-photo" : "")}
                          style={active.avatar ? { backgroundImage: `url("${active.avatar}")` } : undefined}
                          onClick={() => active.avatar && setLightbox(active.avatar)}
                          title={active.avatar ? "看大图" : undefined}
                        >
                          {!active.avatar && avatarChar(activeName)}
                        </span>
                      )}
                      <span className={"chat-bubble t-ui" + (m.text === "……" ? " chat-typing" : "")}>
                        {m.text === "……" ? "对方正在输入…" : m.text}
                      </span>
                    </div>
                  </div>
                );
              })}
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
                  if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent || e).isComposing && !busy) {
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
                  {/* 顶部放立绘 / 布偶动画,而非头像(细节⑨) */}
                  <div className="chat-profile-art">
                    {active.anim ? (
                      <video src={active.anim} autoPlay loop muted playsInline />
                    ) : active.image ? (
                      <img src={active.image} alt={activeName} />
                    ) : (
                      <span className="chat-profile-art-ph t-kai">{avatarChar(activeName)}</span>
                    )}
                  </div>
                  <h2 className="t-h2 chat-profile-name">{activeName}</h2>
                  {active.persona && <p className="t-ui chat-profile-line">{active.persona}</p>}
                  {active.description && <p className="t-ui-sm chat-profile-desc">{active.description}</p>}
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
            {/* 卡库线性增长,平铺翻不动:前端过滤,范式同创作页「补素材」搜索(YOR-169) */}
            {addModal.items.length > 0 && (
              <input
                className="chat-modal-search"
                value={addQ}
                onChange={(e) => setAddQ(e.target.value)}
                placeholder="搜角色:名字 / 简介…"
              />
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
                  return (
                    <p className="t-ui">
                      {addModal.items.length
                        ? `没有匹配「${addQ.trim()}」的角色卡。`
                        : addModal.err
                          ? "读库失败:" + addModal.err
                          : "卡库里还没有角色卡。去创作造一个。"}
                    </p>
                  );
                }
                return list.map((it, i) => {
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
                });
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
