import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui";
import { getJSON, postJSON, newSessionId } from "../lib/api";
import { useAuth } from "../state/auth";
import { useGame } from "../state/game";
import { PORTRAIT, INTRO, HEAD, INTRO_HEAD, AI_PERSONA, FIRST_BEAT, beatById, loadEcho, saveEcho, isOnboarded, markOnboarded } from "./onboardingScript";
import "./Home.css";

// 立绘主页(家)· YOR-136 · galgame 式登录后首屏。
// 对话直接抄纯聊(/api/chat 发送 + session + 重开);首页 = 单联系人面对面 + 立绘场景皮 + 静态招呼。
// 默认糖沐(取《新人入店》预设);换角色从我的角色卡库(/api/library/characters)、沿用该卡设定。
// 主按钮:探索故事→/explore(常驻发现路径);继续故事(有进行中 game/存档才显)→存档窗口→/play。
const HOME_KEY = "ais_home_v1";
const TANGMU_IMG = "/home/tangmu01.png";
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
  const restoredRef = useRef(false);

  // 新手引导(onboarding):obStep=当前拍 id(null=非引导态);obEcho=回声(称呼/口味);obInput=引导中输入框。
  const [obStep, setObStep] = useState(null);
  const [obIntro, setObIntro] = useState(-1); // 入场演出帧索引(-1=非演出):背身→回头→转正面进登记
  const [obEcho, setObEcho] = useState({});
  const [obInput, setObInput] = useState("");
  const [obBubblePos, setObBubblePos] = useState(null); // 台词气泡贴头定位 {left,top}(px);null=走 CSS(窄屏/竖版底部)
  const [obHistory, setObHistory] = useState([]); // 已访拍栈(不含当前),供「上一步」回退
  const [obViaBack, setObViaBack] = useState(false); // 当前拍是否由回退进入 → 显反悔反应(backLine/backEmo)
  const [obThinking, setObThinking] = useState(false); // AI 自适应:提交后糖沐"思考态"(等 /api/chat)
  const [obAiLine, setObAiLine] = useState(null); // AI 生成的自适应台词(当前拍开场,替静态 line);null=用脚本
  const [obSlots, setObSlots] = useState([null, null]); // 立绘双层(交叉溶解)各层 src;null=空
  const [obLayer, setObLayer] = useState(0); // 当前在顶(不透明)的层索引
  const prevImageRef = useRef(null); // 上一帧立绘 src,供双层比对
  const obInputRef = useRef(null); // onboarding 输入框(选项 fill 后聚焦)
  const obBeat = obStep ? beatById(obStep) : null;
  const introFrame = obIntro >= 0 ? INTRO[obIntro] : null;
  const obActive = obIntro >= 0 || !!obBeat;
  // 当前有效 emo:回退进入且该拍有 backEmo → 用反悔姿势,否则常态 emo。
  const obEmo = obBeat ? (obViaBack && obBeat.backEmo ? obBeat.backEmo : obBeat.emo) : null;
  // 当前台词优先级:思考态 > 回退反悔(backLine) > AI 自适应(obAiLine) > 静态脚本(line)。
  const obLine = obThinking
    ? "（想一下……）"
    : obBeat
    ? obViaBack && obBeat.backLine
      ? obBeat.backLine(obEcho)
      : obAiLine || obBeat.line(obEcho)
    : introFrame
    ? introFrame.line
    : "";
  // 当前姿势的「头中心」锚点(入场帧 / 差分 emo);用于把气泡贴到头侧、齐头高。
  const headAnchor = introFrame ? INTRO_HEAD[obIntro] : obEmo ? HEAD[obEmo] : null;

  const displayName = cardName(card) || (isTangmu ? "糖沐" : "角色");
  const image = introFrame ? introFrame.img : obBeat ? PORTRAIT[obEmo] || TANGMU_IMG : isTangmu ? TANGMU_IMG : cardImageOf(card);
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

  // 首访引导:没被引导过 + 没恢复出历史会话 → 进新手引导(老用户 / 聊过的人不触发)。
  // testMode(/test):每次进都强制从首拍开始、清空回声,方便反复测(不读写完成标记)。
  useEffect(() => {
    if (testMode) {
      setObEcho({});
      setObIntro(0); // 从入场演出(背身)开始
      return;
    }
    if (!isOnboarded() && !restoredRef.current) {
      setObEcho(loadEcho());
      setObIntro(0);
    }
  }, []);

  // 入场演出推进:一帧前进一步(背身→回头→转正进登记拍 name)。
  // 定时自动播 + 点击加速走同一逻辑:点击改 obIntro → 下方 effect 重跑,
  // cleanup 清掉待触发的定时器,不会自动+手动双跳。
  function advanceIntro() {
    if (obIntro < 0) return;
    if (obIntro + 1 < INTRO.length) setObIntro(obIntro + 1);
    else {
      setObIntro(-1);
      setObStep(FIRST_BEAT);
    }
  }
  useEffect(() => {
    if (obIntro < 0) return undefined;
    const cur = INTRO[obIntro];
    const t = setTimeout(advanceIntro, (cur && cur.dur) || 1200);
    return () => clearTimeout(t);
  }, [obIntro]);

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

  // 持久化首页会话(testMode 不写,避免污染 /home 的首访判断)。
  useEffect(() => {
    if (!card || testMode) return;
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

  // onboarding 期间 = 全屏接管:给 root 挂类,隐藏导航壳 chrome(菜单头条 / 续玩浮条),
  // 新客引导期间不露导航,真·满铺。引导结束(obActive→false)自动恢复。
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("ais-onboarding", obActive);
    return () => el.classList.remove("ais-onboarding");
  }, [obActive]);

  // 台词气泡「贴头侧、齐头高」定位:按当前姿势头中心算屏幕坐标,把气泡右缘锚到头左侧一点、纵向中心对齐头高。
  // 立绘各姿势 CSS 尺寸一致,量任一张 img 盒即可(几何稳定)。窄屏/竖版走 CSS 底部布局 → 清空锚点。
  useLayoutEffect(() => {
    const compute = () => {
      if (!obActive || !headAnchor) return setObBubblePos(null);
      if (window.matchMedia("(max-width: 720px), (orientation: portrait)").matches) return setObBubblePos(null);
      const img = document.querySelector(".home-portrait img");
      if (!img) return;
      const r = img.getBoundingClientRect();
      if (!r.width) return;
      // 纵向:气泡中心对齐该姿势的头高(headAnchor.y,实测);
      // 横向:气泡右缘落在该姿势立绘身体左轮廓(headAnchor.edge,实测)之前,留 0.025 图宽余量。
      const headCY = r.top + headAnchor.y * r.height;
      const rightEdge = r.left + (headAnchor.edge - 0.025) * r.width;
      setObBubblePos({ left: Math.round(rightEdge), top: Math.round(headCY) });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [obActive, headAnchor, obStep, obIntro, image]);

  // 立绘双层交叉溶解(纯 CSS opacity 过渡,不依赖 Motion,任意切换频率都稳):
  // image 变了 → 新图放到「非当前层」,再切换当前层 → 新层淡入、旧层淡出。永远只 2 层。
  useLayoutEffect(() => {
    if (!image) return;
    if (prevImageRef.current === null) {
      // 首帧:两层都放首图(slot1 也存在但透明),这样首次换姿势也能过渡淡入
      // (否则新层刚挂载 = 瞬显,首次切换会像硬切)。obLayer=0 → slot0 显、slot1 透明备用。
      setObSlots([image, image]);
      prevImageRef.current = image;
      return;
    }
    if (image !== prevImageRef.current) {
      const next = obLayer === 0 ? 1 : 0;
      setObSlots((s) => {
        const n = [...s];
        n[next] = image;
        return n;
      });
      setObLayer(next);
      prevImageRef.current = image;
    }
  }, [image, obLayer]);

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

  // —— 新手引导逻辑 ——
  function endOnboarding(echo) {
    if (!testMode) {
      markOnboarded();
      saveEcho(echo || obEcho);
    }
    setObHistory([]);
    setObViaBack(false);
    setObAiLine(null);
    setObThinking(false);
    setObStep(null);
  }
  function obChip(c) {
    // 点 3:带 fill 的选项 = 把文字填进输入框,不直接发送;玩家确认/改后再点「好」提交。
    if (c.fill != null) {
      setObInput(c.fill);
      requestAnimationFrame(() => obInputRef.current?.focus());
      return;
    }
    let echo = obEcho;
    if (c.set) {
      echo = { ...obEcho, ...c.set };
      setObEcho(echo);
      saveEcho(echo);
    }
    if (c.to) navigate(c.to);
    if (c.done) endOnboarding(echo);
    else if (c.next) obGoNext(c.next);
  }
  async function obFieldSubmit() {
    const v = obInput.trim();
    if (!v || !obBeat || !obBeat.field || obThinking) return;
    const echo = { ...obEcho, [obBeat.field]: v };
    setObEcho(echo);
    saveEcho(echo);
    const beat = obBeat;
    if (!beat.next) return;
    // AI 自适应(点4/5):复用 /api/chat(看板同款)让糖沐接住玩家输入 + 引下一步;失败/超时回退静态台词。
    if (beat.ai) {
      setObThinking(true);
      let aiLine = null;
      try {
        const card = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "糖沐", description: AI_PERSONA, scenario: beat.ai.scenario(echo) } };
        const r = await Promise.race([
          postJSON("/api/chat", { card, session_id: newSessionId(), user: v, world: null }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000)),
        ]);
        aiLine = ((r && r.reply) || "").trim() || null;
      } catch (e) {
        aiLine = null; // 降级:下一拍用静态台词,不卡新客
      }
      setObThinking(false);
      obGoNext(beat.next, aiLine);
    } else {
      obGoNext(beat.next);
    }
  }
  // 前进一拍:压历史(供回退),清回退态与输入框;aiLine=本次 AI 自适应台词(替下一拍静态开场),null=用脚本。
  function obGoNext(nextId, aiLine = null) {
    setObHistory((h) => [...h, obStep]);
    setObViaBack(false);
    setObAiLine(aiLine);
    setObInput("");
    setObStep(nextId);
  }
  // 回退上一拍:糖沐做反悔反应(backLine/backEmo);字段拍回填旧值方便改。清 AI 自适应/思考态。
  function obBack() {
    if (!obHistory.length || obThinking) return;
    const prevId = obHistory[obHistory.length - 1];
    const prev = beatById(prevId);
    setObHistory((h) => h.slice(0, -1));
    setObViaBack(true);
    setObAiLine(null);
    setObInput(prev && prev.field ? obEcho[prev.field] || "" : "");
    setObStep(prevId);
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

      {/* 立绘层:双层交叉溶解(纯 CSS opacity 过渡)。两层常驻,换图放到非当前层再切换当前层,
          新层淡入、旧层淡出。永远只 2 层,任意切换频率都不堆积、不透明。 */}
      <div className="home-portrait">
        {image ? (
          obSlots.map((src, i) =>
            src ? (
              <img
                key={i}
                className={"home-portrait-img" + (obLayer === i ? " is-on" : "")}
                src={src}
                alt={obLayer === i ? displayName : ""}
                aria-hidden={obLayer !== i}
                draggable="false"
              />
            ) : null
          )
        ) : (
          <span className="home-portrait-ph t-kai">{displayName.slice(0, 2)}</span>
        )}
      </div>

      {/* 入场演出:点屏任意处加速推进当前帧(VN 式 tap-to-advance);只在入场存在。
          入场态无其它可交互元素,整屏捕获层置顶不抢占任何点击。 */}
      {introFrame && <div className="home-ob-introcatch" onClick={advanceIntro} aria-hidden="true" />}

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
          {/* 新手引导:糖沐台词气泡,贴在立绘头部一侧(galgame 式,台词随角色) */}
          {(obBeat || (introFrame && introFrame.line)) && (
            <div
              className="home-ob-bubble"
              style={
                obBubblePos
                  ? { left: obBubblePos.left, top: obBubblePos.top, right: "auto", bottom: "auto", transform: "translate(-100%, -50%)" }
                  : undefined
              }
            >
              <div className="home-ob-bubble-head">
                <span className="home-dlg-name t-kai">糖沐</span>
                {obBeat && (
                  <button className="home-ob-skip" onClick={() => endOnboarding()} disabled={obThinking} title="跳过引导,直接进店">跳过</button>
                )}
              </div>
              <p className="home-ob-line t-read">{obLine}</p>
            </div>
          )}
          {/* 底部交互坞:主按钮行(贴对话框上方右对齐)+ 对话框聚成一组,不再悬空 */}
          <div className="home-dock">
            {obBeat ? (
              /* 新手引导态:底部只留输入框 + 选项 chip(台词在头侧气泡) */
              <div className="home-ob-tray">
                {!!obHistory.length && (
                  <button className="home-ob-back" onClick={obBack} disabled={obThinking} title="回上一步,重新填">
                    ← 上一步
                  </button>
                )}
                {obBeat.field && (
                  <div className="home-composer">
                    <input
                      ref={obInputRef}
                      className="home-input"
                      value={obInput}
                      disabled={obThinking}
                      placeholder={obThinking ? "糖沐正想着怎么接…" : obBeat.field === "name" ? "输入你的称呼…" : "随口说说…"}
                      onChange={(e) => setObInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.isComposing) {
                          e.preventDefault();
                          obFieldSubmit();
                        }
                      }}
                    />
                    <Button variant="primary" onClick={obFieldSubmit} disabled={!obInput.trim() || obThinking}>
                      {obThinking ? "…" : "好"}
                    </Button>
                  </div>
                )}
                {!!(obBeat.chips && obBeat.chips.length) && (
                  <div className="home-ob-chips">
                    {obBeat.chips.map((c, i) => (
                      <button key={i} className="home-ob-chip" onClick={() => obChip(c)} disabled={obThinking}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : obActive ? null : (
              <>
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
              </>
            )}
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
