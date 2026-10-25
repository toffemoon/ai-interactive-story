import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getJSON, postJSON, newSessionId } from "../lib/api";
import { useAuth } from "../state/auth";
import { useGame } from "../state/game";
import { L } from "../lib/i18n";
import { loadEcho, saveEcho, isOnboarded, markOnboarded } from "./onboardingScript";
import TopNav from "../components/shell/TopNav";
import RegisterOnboarding from "../components/onboarding/RegisterOnboarding";
import StaggeredText from "../components/staggered-text";
import AnimatedList from "../components/animated-list";
import "./Home.css";

// 立绘主页(家)· YOR-136 · galgame 式登录后首屏。
// 对话直接抄纯聊(/api/chat 发送 + session + 重开);首页 = 单联系人面对面 + 立绘场景皮 + 静态招呼。
// 默认糖沐(取《新人入店》预设);换角色从我的角色卡库(/api/library/characters)、沿用该卡设定。
// 主按钮:探索故事→/explore(常驻发现路径);继续故事(有进行中 game/存档才显)→存档窗口→/play。
// 2026-10-25 C 幕间改版(画布「C 幕间 · 首页」):顶部 TopNav,底部一个对白框。
// 新手引导(首访)= 柜台两边:整屏一层,左边糖沐、右边你面前的 3D 登记簿,写名字、盖章、拿书签(见 components/onboarding)。
const HOME_KEY = "ais_home_v1";
// 身份卡发卡日(本地日期 YYYY-MM-DD;用户机器为 UTC+8)
function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const TANGMU_IMG = "/home/tangmu01.png";
const BG_IMG = "/home/background.webp";
const GREETING_NEW = L(
  "Hi, I'm Tangmu. I work at this bookshop. Every book here is one you can step into and play, and you can write one of your own too. Want to look at the shelves, or chat with me for a bit?",
  "你好呀,我是糖沐,在这家书店打工。这里的书都能走进去玩,你也可以自己写一本。先去书架看看,还是陪我聊两句?"
);
const GREETING_BACK = L("Welcome back. We left things on a cliffhanger last time. Pick up where you left off, or try a new one?", "欢迎回来。上次那段还悬着呢——接着往下,还是换一本新的?");
// 兜底糖沐卡:presets 取不到时(后端抖动/无该预设)仍能聊,不卡在「正在把糖沐请出来」。
const FALLBACK_TANGMU = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: L("Tangmu", "糖沐"),
    persona: L("Clerk and resident face of Muyan Bookshop. Gentle and bookish, with a warm way of talking; often nudges guests toward a story to read.", "沐言书坊的店员、看板娘。温和爱书,话里带点暖意,常引着客人挑一本故事读。"),
    description: L("A clerk at this bookstore café (which is the website itself) who shows you around Muyan.", "这家「就是网站」的书店咖啡馆的店员,带你认识沐言。"),
  },
};
const LINE_REVEAL_FROM = { opacity: 0, y: 4 };
const LINE_REVEAL_TO = { opacity: 1, y: 0 };

function cardName(card) {
  const d = (card && card.data) || card || {};
  return d.name || (card && card.name) || "";
}
function cardImageOf(card) {
  const d = (card && card.data) || card || {};
  return d.image || d.avatar || "";
}

function DialogueReveal({ text }) {
  return (
    <StaggeredText
      text={text}
      as="span"
      segmentBy="chars"
      delay={8}
      duration={0.28}
      direction="bottom"
      blur={false}
      from={LINE_REVEAL_FROM}
      to={LINE_REVEAL_TO}
      respectReducedMotion
      className="home-line-reveal"
    />
  );
}

export default function Home({ testMode = false }) {
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
  const chatInputRef = useRef(null); // 「先聊两句」= 聚焦输入框
  const restoredRef = useRef(false);
  // 新手引导:obOn = 柜台两边那一层盖着首页。chattedRef = 本机恢复出的首页会话里聊过(老用户,不引导)。
  const [obOn, setObOn] = useState(false);
  const chattedRef = useRef(false);
  // 立绘双层(交叉溶解):slots=两层各 src, layer=当前在顶(不透明)的层。合成一个 state 一次提交,避免换图/切层两次 setState 间的中间帧闪(重影根因之一)。
  const [portrait, setPortrait] = useState({ slots: [null, null], layer: 0 });
  const prevImageRef = useRef(null); // 上一帧立绘 src,供双层比对


  const displayName = cardName(card) || (isTangmu ? L("Tangmu", "糖沐") : L("Character", "角色"));
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

  const switchOptions = useMemo(() => {
    if (!switcher) return [];
    const libraryOptions = switcher.items.map((it, i) => {
      const raw = (it && it.data && it.data.data) || (it && it.data) || {};
      return {
        id: `library-${it.id || raw.id || raw.name || i}-${i}`,
        content: {
          kind: "library",
          item: it,
          image: raw.image || raw.avatar || "",
        },
      };
    });
    return [{ id: "tangmu-default", content: { kind: "tangmu" } }, ...libraryOptions];
  }, [switcher]);

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
      chattedRef.current = Array.isArray(r.msgs) && r.msgs.length > 0;
    }
  }, []);

  // 首访引导:没走完过引导 + 本机没聊过 → 进新手引导(老用户 / 聊过的人不触发)。
  // 只看「聊过没有」:以前引导中途一刷新,首页会话已经存下(糖沐卡加载完就写),于是被当成老用户、引导再也不出现。
  // testMode(/test/onboarding):每次进都从头来,不读写完成标记,方便反复测。
  useEffect(() => {
    if (testMode || (!isOnboarded() && !chattedRef.current)) setObOn(true);
  }, []);

  // 拉默认糖沐卡(《新人入店》characters 里 name 含「糖沐」)。
  // 先拿摘要列表(带角色名单)定位是哪本,再只取那一本的完整内容,不再整表下载所有预设。
  useEffect(() => {
    const isTangmu = (n) => (n || "").includes("糖沐") || (n || "").includes("Tangmu"); // i18n: kept, logic literal (matches backend preset name)
    getJSON("/api/presets?summary=1")
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        const p = list.find((x) => ((x.data && x.data.character_names) || []).some(isTangmu));
        return p ? getJSON(`/api/presets/${encodeURIComponent(p.name)}`) : null;
      })
      .then((full) => {
        const chars = (full && full.data && full.data.characters) || [];
        const t = chars.find((c) => isTangmu(cardName(c))) || null;
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

  // 持久化首页会话(testMode / 引导进行中不写,避免污染 /home 的首访判断)。
  useEffect(() => {
    if (!card || testMode || obOn) return;
    try {
      localStorage.setItem(HOME_KEY, JSON.stringify({ card, isTangmu, sessionId, msgs: messages.slice(-40) }));
    } catch (e) {}
  }, [card, isTangmu, sessionId, messages, obOn]);

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

  // onboarding 期间 = 全屏接管:给 root 挂类,隐藏导航壳 chrome(菜单头条 / 续玩浮条)。引导结束自动恢复。
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("ais-onboarding", obOn);
    return () => el.classList.remove("ais-onboarding");
  }, [obOn]);

  // 立绘双层交叉溶解:image 变 → 把新图放「非当前层」+ 切当前层到它 = 新层淡入、旧层淡出。
  // 换图与切层合成一次 setPortrait(原子提交),消掉两次 setState 间「新图挂在旧层判定上以 opacity:1 闪现」的中间帧(整图差分重影的根因之一)。
  useLayoutEffect(() => {
    if (!image) return;
    if (prevImageRef.current === null) {
      setPortrait({ slots: [image, image], layer: 0 }); // 首帧两层同图,首次换姿势也能淡入
      prevImageRef.current = image;
      return;
    }
    if (image !== prevImageRef.current) {
      setPortrait((p) => {
        const next = p.layer === 0 ? 1 : 0;
        const slots = [...p.slots];
        slots[next] = image;
        return { slots, layer: next };
      });
      prevImageRef.current = image;
    }
  }, [image]);

  async function send() {
    const text = input.trim();
    if (!text || busy || !card) return;
    setBusy(true);
    setMessages((m) => [...m, { who: "me", text, t: Date.now() }]);
    setInput("");
    try {
      const r = await postJSON("/api/chat", { card, session_id: sessionId, user: text, world: null });
      setMessages((m) => [...m, { who: displayName, text: (r && r.reply) || L("(No response)", "(无回应)"), t: Date.now() }]);
    } catch (e) {
      setMessages((m) => [...m, { who: displayName, text: L("(Connection error: ", "(连接出错:") + e.message + ")", t: Date.now() }]);
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

  // 引导结束:在登记簿上写下的名字记进回声(本机),拿了哪张书签就去哪儿(探索 / 留在首页)。
  function finishOnboarding({ name, to }) {
    if (!testMode) {
      markOnboarded();
      saveEcho({ ...loadEcho(), name });
    }
    setObOn(false);
    if (to === "explore") navigate("/explore");
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
    return d.name || it.name || L("Untitled", "未命名");
  }

  function renderSwitchOption(entry) {
    const option = entry.content;
    if (option.kind === "tangmu") {
      return (
        <button type="button" className="home-switch-item" onClick={pickTangmu}>
          <span className="home-switch-av" style={{ backgroundImage: `url("${TANGMU_IMG}")` }} />
          <span className="t-ui-sm">{L("Tangmu · Shop host (default)", "糖沐 · 看板娘(默认)")}</span>
        </button>
      );
    }
    const name = libItemName(option.item);
    return (
      <button type="button" className="home-switch-item" onClick={() => pickChar(option.item)}>
        <span className="home-switch-av" style={option.image ? { backgroundImage: `url("${option.image}")` } : undefined}>
          {!option.image && (Array.from(name)[0] || "")}
        </span>
        <span className="t-ui-sm">{name}</span>
      </button>
    );
  }

  const toolIcon = (d) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );

  if (obOn) return <RegisterOnboarding onDone={finishOnboarding} />;

  return (
    <div className={"home" + (fullscreen ? " is-fullscreen" : "")}>
      {/* 舞台:书店夜景 + 上下压暗 */}
      <img className="home-bg" src={BG_IMG} alt="" />
      <div className="home-shade" aria-hidden="true" />

      {/* 立绘层:双层交叉溶解(纯 CSS opacity 过渡)。两层常驻,换图放到非当前层再切换当前层,
          新层淡入、旧层淡出。永远只 2 层,任意切换频率都不堆积、不透明。 */}
      <div className="home-portrait">
        {image ? (
          portrait.slots.map((src, i) =>
            src ? (
              <img
                key={i}
                className={"home-portrait-img" + (portrait.layer === i ? " is-on" : "")}
                src={src}
                alt={portrait.layer === i ? displayName : ""}
                aria-hidden={portrait.layer !== i}
                draggable="false"
              />
            ) : null
          )
        ) : (
          <span className="home-portrait-ph">{Array.from(displayName).slice(0, 2).join("")}</span>
        )}
      </div>

      {/* 顶栏:常态 = 完整导航;全屏 = 不显示 */}
      {!fullscreen && (
        <div className="home-top">
          <TopNav variant="overlay" />
        </div>
      )}

      {/* 全屏:整屏点击捕获层(点任意处退出) + 退出角标(Esc / 点任意处 / 点这里) */}
      {fullscreen && <div className="home-fs-catcher" onClick={() => setFullscreen(false)} aria-hidden="true" />}
      {fullscreen && (
        <button type="button" className="home-exitfs" onClick={() => setFullscreen(false)} aria-label={L("Exit fullscreen", "退出全屏")}>
          {L("✕ Exit fullscreen", "✕ 退出全屏")}
        </button>
      )}

      {/* 常态:底部对白框(画布「C 幕间 · 首页」),当前角色一句 + 去书架 / 继续故事 / 先聊两句 + 输入 */}
      {!fullscreen && (
        <section className="home-box" aria-label={L(`Talking with ${displayName}`, `和${displayName}说话`)}>
          <h1 className="home-box-name">{displayName}</h1>
          <div className="home-box-tools">
            <button type="button" onClick={openSwitcher} title={L("Chat with someone else", "换个角色")} aria-label={L("Chat with someone else", "换个角色")}>
              {toolIcon(
                <>
                  <circle cx="9" cy="8" r="3.5" />
                  <path d="M3 20c1-3.5 3.3-5 6-5s5 1.5 6 5" />
                  <path d="M16 4l3 3-3 3" />
                </>
              )}
            </button>
            <button type="button" onClick={restart} disabled={busy} title={L("Restart (clear this conversation)", "重新开始对话")} aria-label={L("Restart the conversation", "重新开始对话")}>
              {toolIcon(
                <>
                  <path d="M20 12a8 8 0 1 1-2.3-5.6" />
                  <path d="M20 4v5h-5" />
                </>
              )}
            </button>
            <button type="button" onClick={() => setLogOpen(true)} disabled={!messages.length} title={L("Conversation log", "对话记录")} aria-label={L("Conversation log", "对话记录")}>
              {toolIcon(<path d="M6 7h12M6 12h12M6 17h8" />)}
            </button>
            <button type="button" onClick={() => setFullscreen(true)} title={L("Fullscreen (background and portrait only, for screenshots)", "全屏(只留背景和立绘,方便截图)")} aria-label={L("Fullscreen", "全屏")}>
              {toolIcon(<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />)}
            </button>
          </div>
          <p className="home-box-line" aria-live="polite" aria-busy={busy}>
            {busy ? L(`(${displayName} is replying…)`, `(${displayName}正在回应…)`) : <DialogueReveal key={`${displayName}-${currentLine}`} text={currentLine} />}
          </p>
          <div className="home-box-actions">
            <button type="button" className="home-pill home-pill--go" onClick={() => navigate("/explore")}>
              {L("Browse the shelves", "去书架看看")}
            </button>
            {hasSaves && (
              <button type="button" className="home-pill" onClick={() => setSavesModal(true)}>
                {L("Continue story", "继续故事")}
              </button>
            )}
            {!messages.length && (
              <button type="button" className="home-pill" onClick={() => chatInputRef.current && chatInputRef.current.focus()}>
                {L("Chat for a bit", "先聊两句")}
              </button>
            )}
          </div>
          <form
            className="home-box-form"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label className="home-box-input">
              <span className="sr-only">{L(`What to say to ${displayName}`, `对${displayName}说的话`)}</span>
              <input
                ref={chatInputRef}
                value={input}
                disabled={busy || !card}
                placeholder={card ? L(`Say something to ${displayName}…`, `对${displayName}说点什么…`) : L("Calling Tangmu over…", "正在把糖沐请出来…")}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !busy) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
            </label>
            <button type="submit" className="home-btn home-btn--go" disabled={busy || !input.trim() || !card}>
              {L("Send", "发送")}
            </button>
          </form>
        </section>
      )}

      {/* 换角色 picker */}
      {switcher && (
        <div className="home-modal" onClick={() => setSwitcher(null)}>
          <div className="home-modal-card" role="dialog" aria-modal="true" aria-labelledby="home-switch-h" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="home-modal-x" onClick={() => setSwitcher(null)} aria-label={L("Close", "关闭")}>
              ×
            </button>
            <h2 id="home-switch-h">{L("Chat with someone else", "换个角色")}</h2>
            <p className="home-modal-sub">{L("Pick one of your character cards. They keep their own settings.", "挑一张你的角色卡,沿用 TA 自己的设定。")}</p>
            <div className="home-switch-list">
              <AnimatedList
                items={switchOptions}
                renderItem={renderSwitchOption}
                height={`min(${Math.min(switchOptions.length * 66, 360)}px, 48vh)`}
                startFrom="top"
                animationType="fade"
                enterFrom="bottom"
                duration={0.28}
                autoAddDelay={0}
                itemGap={8}
                fadeEdges={false}
                className="home-switch-animated"
              />
              {!switcher.items.length && (
                <p className="home-modal-sub">{switcher.err ? L("Failed to load library: ", "读库失败:") + switcher.err : L("No characters in your Card Library yet. Head to Create to make one.", "卡库里还没有你的角色卡。去创作造一张。")}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 存档窗口(继续故事) */}
      {savesModal && (
        <div className="home-modal" onClick={() => setSavesModal(false)}>
          <div className="home-modal-card" role="dialog" aria-modal="true" aria-labelledby="home-saves-h" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="home-modal-x" onClick={() => setSavesModal(false)} aria-label={L("Close", "关闭")}>
              ×
            </button>
            <h2 id="home-saves-h">{L("Continue story", "继续故事")}</h2>
            <div className="home-saves">
              {game && (
                <button type="button" className="home-save home-save--cur" onClick={() => navigate("/play")}>
                  <span className="home-save-dot" aria-hidden="true" />
                  <span className="home-save-tx">
                    <span className="home-save-name">{game.title || L("Current story", "当前故事")}</span>
                    <span className="home-save-meta">{L("In progress on this device", "本机进行中")}</span>
                  </span>
                  <span className="home-save-go">{L("Continue →", "继续 →")}</span>
                </button>
              )}
              {serverSaves.map((s) => (
                <button type="button" className="home-save" key={s.id} onClick={() => navigate("/mine")} title={L("View in your saves under Me", "在「我的」存档里查看")}>
                  <span className="home-save-tx">
                    <span className="home-save-name">{s.story || s.player || L("Untitled save", "未命名存档")}</span>
                    <span className="home-save-meta">
                      {L(`Turn ${s.turns}`, `第 ${s.turns} 回合`)}
                      {s.updated_at ? " · " + String(s.updated_at).slice(0, 16) : ""}
                    </span>
                  </span>
                  <span className="home-save-go">{L("Me →", "我的 →")}</span>
                </button>
              ))}
              {!game && !serverSaves.length && <p className="home-modal-sub">{L("No stories in progress yet. Pick a book in Explore to begin.", "还没有进行中的故事。去探索取一本书开局。")}</p>}
            </div>
          </div>
        </div>
      )}

      {/* 查看记录 */}
      {logOpen && (
        <div className="home-modal" onClick={() => setLogOpen(false)}>
          <div className="home-modal-card" role="dialog" aria-modal="true" aria-labelledby="home-log-h" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="home-modal-x" onClick={() => setLogOpen(false)} aria-label={L("Close", "关闭")}>
              ×
            </button>
            <h2 id="home-log-h">{L(`Conversation with ${displayName}`, `和 ${displayName} 的记录`)}</h2>
            <div className="home-log">
              {messages.length ? (
                messages.map((m, i) => (
                  <div key={i} className={"home-log-row" + (m.who === "me" ? " is-me" : "")}>
                    <span className="home-log-who">{m.who === "me" ? L("You", "你") : m.who}</span>
                    <span className="home-log-text">{m.text}</span>
                  </div>
                ))
              ) : (
                <p className="home-modal-sub">{L("Nothing here yet. Say the first line below.", "还没聊过。在下面说第一句吧。")}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
