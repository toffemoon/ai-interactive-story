import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getJSON, postJSON, newSessionId } from "../lib/api";
import { useAuth } from "../state/auth";
import { useGame } from "../state/game";
import { L } from "../lib/i18n";
import { PORTRAIT, INTRO, AI_PERSONA, CHAT_SCENARIO, AUTO_MS, FIRST_BEAT, beatById, loadEcho, saveEcho, isOnboarded, markOnboarded } from "./onboardingScript";
import TopNav from "../components/shell/TopNav";
import { EntryPass, RegisterBook } from "../components/OnboardingPaper";
import StaggeredText from "../components/staggered-text";
import AnimatedList from "../components/animated-list";
import "./Home.css";

// 立绘主页(家)· YOR-136 · galgame 式登录后首屏。
// 对话直接抄纯聊(/api/chat 发送 + session + 重开);首页 = 单联系人面对面 + 立绘场景皮 + 静态招呼。
// 默认糖沐(取《新人入店》预设);换角色从我的角色卡库(/api/library/characters)、沿用该卡设定。
// 主按钮:探索故事→/explore(常驻发现路径);继续故事(有进行中 game/存档才显)→存档窗口→/play。
// 2026-10-25 C 幕间改版(画布「C 幕间 · 首页」+「起名」A/B):顶部 TopNav,底部一个对白框;新手引导也用这个框,
// 登记段右侧放一张纸(A 入店证 默认 / B 访客登记簿);原来贴在糖沐头侧的台词气泡和身份卡组件不再用。
const HOME_KEY = "ais_home_v1";
// 身份卡发卡日(本地日期 YYYY-MM-DD;用户机器为 UTC+8)
function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const TANGMU_IMG = "/home/tangmu01.png";
const BG_IMG = "/home/background.png";
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
// 「帮我起一个」:本地一小串称呼,随手挑一个填进输入框(玩家可改再确定)。
const NAME_IDEAS = L("Rowan|Mira|Wren|Juniper|Ellis|Sage|Noor|Ash", "阿砚|小满|知秋|南星|青禾|若木|拾一|林间").split("|");
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
  // 登记用的纸:a = 入店证(默认),b = 访客登记簿(对比用;/test/onboarding 右上角切换,本机记住)。
  const [paper, setPaper] = useState(() => {
    try {
      return localStorage.getItem("ais_ob_paper") === "b" ? "b" : "a";
    } catch (e) {
      return "a";
    }
  });
  function pickPaper(p) {
    setPaper(p);
    try {
      localStorage.setItem("ais_ob_paper", p);
    } catch (e) {}
  }
  const chatInputRef = useRef(null); // 「先聊两句」= 聚焦输入框
  const restoredRef = useRef(false);

  // 新手引导(onboarding):obStep=当前拍 id(null=非引导态);obEcho=回声(称呼/口味);obInput=引导中输入框。
  const [obStep, setObStep] = useState(null);
  const [obIntro, setObIntro] = useState(-1); // 入场演出帧索引(-1=非演出):背身→回头→转正面进登记
  const [showIntroHint, setShowIntroHint] = useState(false); // 入场改点击推进:太久没点→显示"点击继续"提示
  const [obEcho, setObEcho] = useState({});
  const [obInput, setObInput] = useState("");
  const [obHistory, setObHistory] = useState([]); // 已访拍栈(不含当前),供「上一步」回退
  const [obViaBack, setObViaBack] = useState(false); // 当前拍是否由回退进入 → 显反悔反应(backLine/backEmo)
  const [obThinking, setObThinking] = useState(false); // AI 自适应:提交后糖沐"思考态"(等 /api/chat)
  const [obAiLine, setObAiLine] = useState(null); // AI 生成的自适应台词(当前拍开场,替静态 line);null=用脚本
  const [obCardMessage, setObCardMessage] = useState(null); // 身份卡上糖沐的 AI 寄语;null=卡组件用默认暖句
  const [obCardAvatar, setObCardAvatar] = useState(null); // 身份卡头像(上传后 dataURL);null=用称呼字头
  // 立绘双层(交叉溶解):slots=两层各 src, layer=当前在顶(不透明)的层。合成一个 state 一次提交,避免换图/切层两次 setState 间的中间帧闪(重影根因之一)。
  const [obPortrait, setObPortrait] = useState({ slots: [null, null], layer: 0 });
  const prevImageRef = useRef(null); // 上一帧立绘 src,供双层比对
  const obInputRef = useRef(null); // onboarding 输入框(选项 fill 后聚焦)
  const obAvatarInputRef = useRef(null); // 身份卡头像上传的隐藏 file input
  const obBeat = obStep ? beatById(obStep) : null;
  const introFrame = obIntro >= 0 ? INTRO[obIntro] : null;
  const obActive = obIntro >= 0 || !!obBeat;
  // 当前有效 emo:回退进入且该拍有 backEmo → 用反悔姿势,否则常态 emo。
  const obEmo = obBeat ? (obViaBack && obBeat.backEmo ? obBeat.backEmo : obBeat.emo) : null;
  // 当前台词优先级:思考态 > 回退反悔(backLine) > 上传头像后的回应(avatarLine) > AI 自适应/闲聊(obAiLine) > 静态脚本(line)。
  const obHasAvatar = !!(obCardAvatar || (obEcho && obEcho.avatar));
  const obLine = obThinking
    ? L("(Let me think…)", "（想一下……）")
    : obBeat
    ? obViaBack && obBeat.backLine
      ? obBeat.backLine(obEcho)
      : obBeat.avatarLine && obHasAvatar && !obAiLine
      ? obBeat.avatarLine(obEcho)
      : obAiLine || obBeat.line(obEcho)
    : introFrame
    ? introFrame.line
    : "";

  const displayName = cardName(card) || (isTangmu ? L("Tangmu", "糖沐") : L("Character", "角色"));
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
    }
  }, []);

  // 首访引导:没被引导过 + 没恢复出历史会话 → 进新手引导(老用户 / 聊过的人不触发)。
  // testMode(/test/onboarding):每次进都强制从首拍开始、清空回声,方便反复测(不读写完成标记)。
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

  // 入场演出推进:点击一帧前进一步(背身→回头→转正进登记拍 name)。改点击推进——不再自动播,点屏才走下一句。
  function advanceIntro() {
    if (obIntro < 0) return;
    setShowIntroHint(false);
    if (obIntro + 1 < INTRO.length) setObIntro(obIntro + 1);
    else {
      setObIntro(-1);
      setObStep(FIRST_BEAT);
    }
  }
  // 入场节奏:背身→回头(无 hold)按 dur 自动播到正面;正面对话帧(hold)停下等点击推进,太久没点(2.5s)冒"点击继续"提示。
  useEffect(() => {
    if (obIntro < 0) return undefined;
    setShowIntroHint(false);
    const cur = INTRO[obIntro];
    if (cur && cur.hold) {
      const t = setTimeout(() => setShowIntroHint(true), 2500); // 正面对话:等点击,太久没点→提示
      return () => clearTimeout(t);
    }
    const t = setTimeout(advanceIntro, (cur && cur.dur) || 1200); // 背身/回头:自动切下一帧
    return () => clearTimeout(t);
  }, [obIntro]);

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

  // 立绘双层交叉溶解:image 变 → 把新图放「非当前层」+ 切当前层到它 = 新层淡入、旧层淡出。
  // 换图与切层合成一次 setObPortrait(原子提交),消掉两次 setState 间「新图挂在旧层判定上以 opacity:1 闪现」的中间帧(整图差分重影的根因之一)。
  useLayoutEffect(() => {
    if (!image) return;
    if (prevImageRef.current === null) {
      setObPortrait({ slots: [image, image], layer: 0 }); // 首帧两层同图,首次换姿势也能淡入
      prevImageRef.current = image;
      return;
    }
    if (image !== prevImageRef.current) {
      setObPortrait((p) => {
        const next = p.layer === 0 ? 1 : 0;
        const slots = [...p.slots];
        slots[next] = image;
        return { slots, layer: next };
      });
      prevImageRef.current = image;
    }
  }, [image]);

  // 身份卡 AI 寄语:进 card 拍时,糖沐现场为这位客人写一句话(卡背)。后台生成、不挡卡出现;失败留 null → 卡用默认暖句。
  useEffect(() => {
    if (!obBeat || !obBeat.card || !obBeat.msg || obCardMessage) return;
    let alive = true;
    (async () => {
      let msg = null;
      try {
        const card = { spec: "chara_card_v2", spec_version: "2.0", data: { name: L("Tangmu", "糖沐"), description: AI_PERSONA, scenario: obBeat.msg(obEcho) } };
        const r = await Promise.race([
          postJSON("/api/chat", { card, session_id: newSessionId(), user: obEcho.taste || obEcho.name || L("New guest", "新客"), world: null }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000)),
        ]);
        msg = ((r && r.reply) || "").trim() || null;
      } catch (e) {
        msg = null;
      }
      if (alive) setObCardMessage(msg);
    })();
    return () => {
      alive = false;
    };
  }, [obStep]);

  // 导览拍自动连讲:进导览拍(有 tour)后 AUTO_MS 自动进下一个功能介绍。obThinking(玩家插话中)暂停;插话答完 obAiLine 变→本 effect 重挂、重新计时。终点拍(tourForum,首 chip 无 next)不自动、停在出口等选。
  useEffect(() => {
    const beat = obStep ? beatById(obStep) : null;
    if (!beat || !beat.tour || obThinking) return undefined;
    const nextId = beat.chips && beat.chips[0] && beat.chips[0].next;
    if (!nextId) return undefined;
    const t = setTimeout(() => obGoNext(nextId), AUTO_MS);
    return () => clearTimeout(t);
  }, [obStep, obThinking, obAiLine]);

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

  // —— 新手引导逻辑 ——
  function endOnboarding(echo) {
    if (!testMode) {
      markOnboarded();
      saveEcho(echo || obEcho);
    }
    setObHistory([]);
    setObViaBack(false);
    setObAiLine(null);
    setObCardMessage(null);
    setObThinking(false);
    setObStep(null);
  }
  function obChip(c) {
    // 头像 chip:触发文件选择(不推进);上传后 obCardAvatar 变、气泡切到 avatarLine(像糖沐在回应)。
    if (c.upload) {
      obPickAvatar();
      return;
    }
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
  function suggestName() {
    const pool = NAME_IDEAS.filter((n) => n !== obInput.trim());
    setObInput(pool[Math.floor(Math.random() * pool.length)]);
    requestAnimationFrame(() => obInputRef.current?.focus());
  }
  // 解析糖沐回复的辨别标记:[CHAT]=玩家在闲聊/没正经回答(接话不填、停这拍) / [OK] 或无标记=当答案(填卡+推进)。
  // 解析糖沐回复的辨别标记:[CHAT]=闲聊(接话不填、停这拍) / [NONE]=明说没有(推进但卡上记空) / [OK]或无标记=当答案(填原话+推进)。
  function parseIntent(reply) {
    if (!reply) return { intent: "answer", text: null }; // AI 失败→保守当答案(回退旧行为,不卡新客)
    const m = reply.match(/^\s*\[(OK|NONE|CHAT)\]\s*/i);
    if (!m) return { intent: "answer", text: reply };
    const tag = m[1].toUpperCase();
    const intent = tag === "CHAT" ? "chat" : tag === "NONE" ? "none" : "answer";
    return { intent, text: reply.slice(m[0].length).trim() || null };
  }
  async function obFieldSubmit() {
    const v = obInput.trim();
    if (!v || !obBeat || !obBeat.field || obThinking) return;
    const beat = obBeat;
    if (!beat.next) return;
    // AI 辨别:让糖沐判断这句是不是正经回答(报称呼/口味)。[OK]→填卡+推进;[CHAT]→接话但不填、停这拍继续等。失败/无标记→保守当答案。
    if (beat.ai) {
      setObThinking(true);
      let reply = null;
      try {
        const card = { spec: "chara_card_v2", spec_version: "2.0", data: { name: L("Tangmu", "糖沐"), description: AI_PERSONA, scenario: beat.ai.scenario(obEcho) } };
        const r = await Promise.race([
          postJSON("/api/chat", { card, session_id: newSessionId(), user: v, world: null }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000)),
        ]);
        reply = ((r && r.reply) || "").trim() || null;
      } catch (e) {
        reply = null; // 降级:当答案,不卡新客
      }
      setObThinking(false);
      const p = parseIntent(reply);
      if (p.intent === "chat") {
        // 闲聊/没正经回答:糖沐接话但不填卡、不推进,停这拍继续等真正的答案。
        setObAiLine(p.text);
        setObInput("");
        return;
      }
      // answer=填玩家原话 / none=明说没有→卡上记空(背面写暖句、不写书)。两者都推进,回复作下一拍开场。
      const echo = { ...obEcho, [beat.field]: p.intent === "none" ? "" : v };
      setObEcho(echo);
      saveEcho(echo);
      obGoNext(beat.next, p.text);
    } else {
      const echo = { ...obEcho, [beat.field]: v };
      setObEcho(echo);
      saveEcho(echo);
      obGoNext(beat.next);
    }
  }
  // 导览期玩家插话:糖沐用店员口吻答一两句(不填卡、不推进当前导览拍)。自动连讲的定时器会因 obThinking 暂停、答完(obAiLine 变)重启。
  async function obChatSubmit() {
    const v = obInput.trim();
    if (!v || obThinking) return;
    setObInput("");
    setObThinking(true);
    let reply = null;
    try {
      const card = { spec: "chara_card_v2", spec_version: "2.0", data: { name: L("Tangmu", "糖沐"), description: AI_PERSONA, scenario: CHAT_SCENARIO } };
      const r = await Promise.race([
        postJSON("/api/chat", { card, session_id: newSessionId(), user: v, world: null }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000)),
      ]);
      reply = ((r && r.reply) || "").trim() || null;
    } catch (e) {
      reply = null;
    }
    setObThinking(false);
    if (reply) setObAiLine(reply);
  }
  // 前进一拍:压历史(供回退),清回退态与输入框;aiLine=本次 AI 自适应台词(替下一拍静态开场),null=用脚本。
  function obGoNext(nextId, aiLine = null) {
    setObHistory((h) => [...h, obStep]);
    setObViaBack(false);
    setObAiLine(aiLine);
    setObCardMessage(null);
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
    setObCardMessage(null);
    setObInput(prev && prev.field ? obEcho[prev.field] || "" : "");
    setObStep(prevId);
  }
  // 身份卡头像上传:纯前端,读成 dataURL 贴上卡 + 存进 echo 持久化(不碰引擎/账号)。
  function obPickAvatar() {
    obAvatarInputRef.current && obAvatarInputRef.current.click();
  }
  function obAvatarChange(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // 允许重选同一文件
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result || "");
      if (!url) return;
      setObCardAvatar(url);
      setObAiLine(null); // 清掉"引导贴头像"那句 AI 台词,让气泡切到 avatarLine(糖沐对上传的回应"这张好看")
      const echo = { ...obEcho, avatar: url };
      setObEcho(echo);
      saveEcho(echo);
    };
    reader.readAsDataURL(file);
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

  const showPaper = !!(obBeat && obBeat.showCard);
  const Paper = paper === "b" ? RegisterBook : EntryPass;
  // 起名拍的开场白跟着纸走:入店证沿用脚本;登记簿用画布那句(脚本说的是「身份卡」,对不上簿子)。
  const boxLine =
    paper === "b" && obBeat && obBeat.id === "name" && !obViaBack && !obAiLine && !obThinking
      ? L("Here, write your name in the guest register. Next time you drop by, I'll know it's you.", "来,在登记簿上写个名字吧,下次来我就知道是你了。")
      : obLine;
  // 起名拍:画布的「帮我起一个」按钮替掉脚本里那颗「随便起一个」填字 chip(同一件事,别出现两遍)。
  const obChips = obBeat ? (obBeat.chips || []).filter((c) => !(obBeat.field === "name" && c.fill != null)) : [];
  const toolIcon = (d) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d}
    </svg>
  );

  return (
    <div className={"home" + (obActive ? " is-ob" : "") + (fullscreen ? " is-fullscreen" : "") + (showPaper ? " has-paper" : "")}>
      {/* 舞台:书店夜景 + 上下压暗 */}
      <img className="home-bg" src={BG_IMG} alt="" />
      <div className="home-shade" aria-hidden="true" />

      {/* 立绘层:双层交叉溶解(纯 CSS opacity 过渡)。两层常驻,换图放到非当前层再切换当前层,
          新层淡入、旧层淡出。永远只 2 层,任意切换频率都不堆积、不透明。 */}
      <div className="home-portrait">
        {image ? (
          obPortrait.slots.map((src, i) =>
            src ? (
              <img
                key={i}
                className={"home-portrait-img" + (obPortrait.layer === i ? " is-on" : "")}
                src={src}
                alt={obPortrait.layer === i ? displayName : ""}
                aria-hidden={obPortrait.layer !== i}
                draggable="false"
              />
            ) : null
          )
        ) : (
          <span className="home-portrait-ph">{Array.from(displayName).slice(0, 2).join("")}</span>
        )}
      </div>

      {/* 顶栏:常态 = 完整导航;新手引导 = 只留店名(画布);全屏 = 不显示 */}
      {!fullscreen && (
        <div className="home-top">
          <TopNav variant="overlay" brandOnly={obActive} />
        </div>
      )}

      {/* 测试页(/test/onboarding):登记用纸 A / B 对比切换(引导期间显示),本机记住,正式引导也按它 */}
      {testMode && obActive && !fullscreen && (
        <div className="home-paper-switch" role="group" aria-label={L("Registration paper", "登记用纸")}>
          <button type="button" aria-pressed={paper === "a"} className={paper === "a" ? "is-on" : ""} onClick={() => pickPaper("a")}>
            {L("A · Entry pass", "A 入店证")}
          </button>
          <button type="button" aria-pressed={paper === "b"} className={paper === "b" ? "is-on" : ""} onClick={() => pickPaper("b")}>
            {L("B · Guest register", "B 登记簿")}
          </button>
        </div>
      )}

      {/* 登记段(showCard)右侧放一张纸:称呼 / 最近在读随输入逐字写上,卡办好那拍落章 + 糖沐留言 */}
      {showPaper && !fullscreen && (
        <div className={"home-paper home-paper--" + paper}>
          <Paper
            name={obEcho.name}
            taste={obEcho.taste}
            avatar={obCardAvatar || obEcho.avatar}
            live={obBeat.field || null}
            liveText={obInput}
            done={!!obBeat.card}
            message={obBeat.card ? obCardMessage : null}
          />
        </div>
      )}
      {/* 头像上传的隐藏 file input:登记段一直在(纸在手机上不显示,上传照样能用) */}
      {showPaper && <input ref={obAvatarInputRef} type="file" accept="image/*" onChange={obAvatarChange} hidden />}

      {/* 入场演出:点屏任意处推进(VN 式 tap-to-advance);入场态无其它可交互元素 */}
      {introFrame && (
        <button
          type="button"
          className="home-ob-introcatch"
          onClick={advanceIntro}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              advanceIntro();
            }
          }}
          aria-label={L("Continue onboarding", "继续新手引导")}
          autoFocus
        />
      )}

      {/* 全屏:整屏点击捕获层(点任意处退出) + 退出角标(Esc / 点任意处 / 点这里) */}
      {fullscreen && <div className="home-fs-catcher" onClick={() => setFullscreen(false)} aria-hidden="true" />}
      {fullscreen && (
        <button type="button" className="home-exitfs" onClick={() => setFullscreen(false)} aria-label={L("Exit fullscreen", "退出全屏")}>
          {L("✕ Exit fullscreen", "✕ 退出全屏")}
        </button>
      )}

      {/* 新手引导:底部对白框(画布「C 幕间 · 起名」),台词 + 选项 + 输入 */}
      {!fullscreen && obActive && (obBeat || obLine) && (
        <section className="home-box home-box--ob" aria-label={L("Talking with Tangmu", "和糖沐说话")}>
          <h1 className="home-box-name">{L("Tangmu", "糖沐")}</h1>
          {obBeat && (
            <button type="button" className="home-box-skip" onClick={() => endOnboarding()} disabled={obThinking} title={L("Skip the tour and head straight in", "跳过引导,直接进店")}>
              {L("Skip", "跳过")}
            </button>
          )}
          <p className="home-box-line" aria-live="polite" aria-busy={obThinking}>
            {obThinking ? obLine : <DialogueReveal key={(obBeat ? obBeat.id + (obViaBack ? "-back" : "") : "i" + obIntro) + boxLine} text={boxLine} />}
          </p>
          {introFrame && showIntroHint && (
            <p className="home-box-hint" aria-hidden="true">
              {L("Click to continue ▾", "点击继续 ▾")}
            </p>
          )}
          {obBeat && (
            <>
              {(obChips.length > 0 || obHistory.length > 0) && (
                <div className="home-box-actions">
                  {!!obHistory.length && (
                    <button type="button" className="home-pill home-pill--ghost" onClick={obBack} disabled={obThinking} title={L("Go back a step and redo it", "回上一步,重新填")}>
                      {L("← Back", "← 上一步")}
                    </button>
                  )}
                  {obChips.map((c, i) => {
                    // 头像拍传了头像后,chip 文案随之变(＋传张头像→换一张 / 用字头就好→好了,继续)。
                    let label = c.label;
                    if (obBeat.id === "avatar" && (obCardAvatar || obEcho.avatar)) {
                      label = c.upload ? L("Change it", "换一张") : L("Done, continue", "好了,继续");
                    }
                    return (
                      <button key={i} type="button" className={"home-pill" + (i === 0 ? " home-pill--go" : "")} onClick={() => obChip(c)} disabled={obThinking}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* 输入框:所有引导拍常驻。field 拍 = 回答登记(走 AI 辨别);其余(导览 / 办卡)= 跟糖沐说话(不填卡、不推进导览)。 */}
              <form
                className="home-box-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (obBeat.field) obFieldSubmit();
                  else obChatSubmit();
                }}
              >
                <label className="home-box-input">
                  <span className="sr-only">
                    {obBeat.field === "name" ? L("Your name", "你的名字") : obBeat.field === "taste" ? L("What you've been into lately", "最近在读的") : L("Something to say to Tangmu", "对糖沐说的话")}
                  </span>
                  <input
                    ref={obInputRef}
                    value={obInput}
                    disabled={obThinking}
                    placeholder={
                      obThinking
                        ? L("Tangmu is thinking of a reply…", "糖沐正想着怎么接…")
                        : obBeat.field === "name"
                        ? L("Enter your name…", "输入你的名字…")
                        : obBeat.field === "taste"
                        ? L("Whatever comes to mind…", "随口说说…")
                        : L("Say something to Tangmu…", "想跟糖沐说点什么…")
                    }
                    onChange={(e) => setObInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.isComposing) {
                        e.preventDefault();
                        if (obBeat.field) obFieldSubmit();
                        else obChatSubmit();
                      }
                    }}
                  />
                </label>
                {obBeat.field === "name" && (
                  <button type="button" className="home-btn home-btn--soft" onClick={suggestName} disabled={obThinking}>
                    {L("Suggest one", "帮我起一个")}
                  </button>
                )}
                <button type="submit" className="home-btn home-btn--go" disabled={!obInput.trim() || obThinking}>
                  {obThinking ? "…" : obBeat.field ? L("OK", "确定") : L("Say", "说")}
                </button>
              </form>
            </>
          )}
        </section>
      )}

      {/* 常态:底部对白框(画布「C 幕间 · 首页」),当前角色一句 + 去书架 / 继续故事 / 先聊两句 + 输入 */}
      {!fullscreen && !obActive && (
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
