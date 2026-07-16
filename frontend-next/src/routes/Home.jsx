import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card } from "../components/ui";
import { useShellMenuCoordination } from "../components/shell/AppShell";
import { getJSON, postJSON, newSessionId } from "../lib/api";
import { toCardModel } from "../lib/cardModel";
import { resolveMediaUrl } from "../lib/mediaUrl.js";
import { useAuth } from "../state/auth";
import { useGame } from "../state/game";
import { PORTRAIT, INTRO, HEAD, INTRO_HEAD, AI_PERSONA, CHAT_SCENARIO, AUTO_CHAT_INTERRUPT_AI, ONBOARDING_EMOTION_REPLY_INSTRUCTION, FIRST_BEAT, beatById, SCENES, sceneForBeat, buildAutoChatShownContext, consumeTestHomeBypass, loadEcho, markOnboarded, isOnboarded, saveEcho, setTestHomeBypass } from "./onboardingScript";
import { INITIAL_ONBOARDING_AUTO_CONTROL, analyzeNameCorrectionInput, analyzeNameInput, analyzePendingNameInput, extractNameFromAiFieldText, extractTasteFromAiFieldText, hasRestoredHomeConversation, isCurrentOnboardingInteraction, isExactFillChipSubmission, matchChipIntent, parseChipIntentReply, parseFieldIntentReply, parseOnboardingEmotionReply, resolveAutoAdvancePlan, resolveChatBubblePlacement, resolveChatStageLayout, resolveNextBeatAiLine, resolveVisibleImageRect, sanitizeCardMessage, shouldAcceptNameLocally, shouldCommitPortraitPreload, shouldConfirmBareNameLocally, transitionOnboardingAutoControl, usesFlowOnboardingBubbleLayout } from "./onboardingLogic";
import { IdentityCard } from "../components/IdentityCard";
import StaggeredText from "../components/staggered-text";
import AnimatedList from "../components/animated-list";
import { OnboardingCreateProjection } from "../components/OnboardingCreateProjection";
import "./Home.css";

// 立绘主页(家)· YOR-136 · galgame 式登录后首屏。
// 对话直接抄纯聊(/api/chat 发送 + session + 重开);首页 = 单联系人面对面 + 立绘场景皮 + 静态招呼。
// 默认糖沐(取《新人入店》预设);换角色从我的角色卡库(/api/library/characters)、沿用该卡设定。
// 主按钮:探索故事→/explore(常驻发现路径);继续故事(有进行中 game/存档才显)→存档窗口→/play。
const HOME_KEY = "ais_home_v1";
// 身份卡发卡日(本地日期 YYYY-MM-DD;用户机器为 UTC+8)
function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const TANGMU_IMG = "/home/tangmu01.png";
const GENERIC_PORTRAIT_HEAD = { x: 0.5, y: 0.2, edge: 0.26 };
const TANGMU_ALPHA_BOUNDS = {
  "tangmu01.png": { left: 236, top: 0, right: 855, bottom: 1493 },
  "tangmu02.png": { left: 214, top: 23, right: 871, bottom: 1522 },
  "tangmu03.png": { left: 211, top: 57, right: 868, bottom: 1493 },
  "tangmu04.png": { left: 265, top: 67, right: 816, bottom: 1474 },
  "tangmu05.png": { left: 221, top: 0, right: 919, bottom: 1532 },
  "tangmu06.png": { left: 220, top: 0, right: 798, bottom: 1536 },
  "tangmu07.png": { left: 124, top: 28, right: 909, bottom: 1513 },
  "tangmu08.png": { left: 233, top: 43, right: 896, bottom: 1536 },
  "tangmu09.png": { left: 146, top: 18, right: 1024, bottom: 1536 },
  "tangmu10.png": { left: 220, top: 9, right: 810, bottom: 1528 },
};
const XUAN_ALPHA_BOUNDS = { left: 300, top: 28, right: 701, bottom: 1503 };
// 首进 home(还没聊过、无存档)时糖沐的招呼语池:onboarding 之后已经认识了,不再「初次见面」;每次进 home 随机一句。
// 台词草稿·待雨钦润色。
const HOME_GREETINGS = [
  "欢迎回来。今天想做点什么?还是就在这儿,跟我聊聊天?",
  "回来啦。想找个故事钻进去,还是先陪我说说话?",
  "来得正好。挑本书,或者就在这儿歇会儿、聊两句?",
  "欢迎回来。灯我一直给你留着呢——想做什么,说一声就行。",
  "回来啦。今天是想读点现成的,还是想自己搭一个?",
];
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
const LINE_REVEAL_FROM = { opacity: 0, y: 4 };
const LINE_REVEAL_TO = { opacity: 1, y: 0 };
const AVATAR_CROP_STAGE = 280;
const AVATAR_OUT = 256;

function saysYes(text) {
  return /^(?:对|是|嗯+|好|好的|好呀|好啊|ok|okay|yes|yep|可以|没错|确认|就这个|就写这个|就叫这个|写这个|认真|真的)(?:吧|啦|呀|啊|呢|哦)?[。.!！?？\s]*$/i.test(String(text || "").trim());
}
function saysNo(text) {
  return /(换|重来|重新|不是|不对|算了|别写|不要|逗你|开玩笑|nope|not that)/i.test(String(text || "").trim());
}
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}
function clampCropOffset(value, natural, baseScale, zoom, stage = AVATAR_CROP_STAGE) {
  const display = natural * baseScale * zoom;
  const max = Math.max(0, (display - stage) / 2);
  return clamp(value, -max, max);
}
function clampCropState(crop) {
  if (!crop) return crop;
  const zoom = clamp(Number(crop.zoom) || 1, 1, 3);
  return {
    ...crop,
    zoom,
    x: clampCropOffset(Number(crop.x) || 0, crop.naturalW || 1, crop.baseScale || 1, zoom),
    y: clampCropOffset(Number(crop.y) || 0, crop.naturalH || 1, crop.baseScale || 1, zoom),
  };
}

function cardName(card) {
  const d = (card && card.data) || card || {};
  return d.name || (card && card.name) || "";
}
function cardImageOf(card) {
  const d = (card && card.data) || card || {};
  return resolveMediaUrl(d.image || d.avatar || "");
}

function DialogueReveal({ text }) {
  // 气泡台词的逐字入场。StaggeredText 默认靠 IntersectionObserver 触发,但换场(如进 rest)时
  // observer 在立绘还没到位就建立、之后不再 fire,导致整段停在 opacity:0 = 空气泡(createProjection 那拍)。
  // 台词气泡总在视口内,不需要滚动触发 → startInView 让它挂载即入场,不依赖 observer。
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
      startInView
      respectReducedMotion
      className="home-line-reveal"
    />
  );
}

function demoText(value, echo, fallback = "") {
  const raw = typeof value === "function" ? value(echo || {}) : value;
  const text = raw == null ? "" : String(raw).trim();
  return text || fallback;
}

function DemoCard({ model, className = "" }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div className={["home-demo-card", className].filter(Boolean).join(" ")}>
      <Card model={model} variant="shelf" flipped={flipped} onToggleFlip={() => setFlipped((v) => !v)} backClickFlips />
    </div>
  );
}

function ThinkingIndicator({ speaker }) {
  const label = `${speaker || "糖沐"}正在思考`;
  return (
    <span className="home-thinking" role="status" aria-label={`${label}...`}>
      <span>{label}</span>
      <span className="home-thinking-dots" aria-hidden="true">
        <span className="home-thinking-dot">.</span>
        <span className="home-thinking-dot">.</span>
        <span className="home-thinking-dot">.</span>
      </span>
    </span>
  );
}

function StageSpeechBubble({ speaker = "糖沐", line, busy = false, animateLine = true, onSkip, onBack = null, tools = null, className = "", style }) {
  return (
    <div className={["home-ob-bubble", className].filter(Boolean).join(" ")} style={style}>
      <div className="home-ob-bubble-head">
        <span className="home-dlg-name t-kai">{speaker}</span>
        {tools}
        <span className="home-ob-headbtns">
          {/* 竖屏用:底部「上一步」小屏 + 键盘弹出会被压掉,这里在「跳过」旁常驻一个返回(CSS 只在窄屏显示)。 */}
          {onBack && (
            <button type="button" className="home-ob-back-inline" onClick={onBack} disabled={busy} title="回上一步,重新填">
              ← 上一步
            </button>
          )}
          {onSkip && (
            <button type="button" className="home-ob-skip" onClick={onSkip} disabled={busy} title="跳过引导,直接进店">
              跳过
            </button>
          )}
        </span>
      </div>
      <p className="home-ob-line t-read" aria-live="polite" aria-busy={busy}>
        {busy ? <ThinkingIndicator speaker={speaker} /> : animateLine ? <DialogueReveal key={line} text={line} /> : line}
      </p>
    </div>
  );
}

function OnboardingDemo({ beat, echo, value, busy, inputRef, onChange, onSubmit }) {
  const demo = beat && beat.demo;
  if (!demo) return null;

  if (demo.type === "story") {
    const model = demo.preset ? toCardModel("story", demo.preset) : null;
    return (
      <aside className={"home-ob-demo home-ob-demo--story" + (demo.result ? " is-result" : "")} aria-label="故事预演">
        <DemoCard key={`${model.kind}:${model.id}`} model={model} className="home-demo-story-card" />
      </aside>
    );
  }

  if (demo.type === "characterCard") {
    const model = demo.characterCard ? toCardModel("character", demo.characterCard) : null;
    return (
      <aside className="home-ob-demo home-ob-demo--character-card" aria-label="角色卡预演">
        <DemoCard key={`${model.kind}:${model.id}`} model={model} className="home-demo-character-card" />
      </aside>
    );
  }

  if (demo.type === "chat") {
    const character = demo.character || {};
    return (
      <aside className="home-ob-demo home-ob-demo--chat" aria-label="看板聊天预演">
        <img className="home-demo-xuan-img" src={character.image} alt={character.name || "宣"} draggable="false" />
        {!beat.speaker && (
          <div className="home-demo-xuan-bubble">
            <span className="home-demo-xuan-name t-kai">{character.name || "宣"}</span>
            <p className="t-read">{character.line}</p>
          </div>
        )}
      </aside>
    );
  }

  if (demo.type === "createProjection") {
    return (
      <OnboardingCreateProjection
        value={value}
        seed={demoText(demo.seed, echo)}
        result={demoText(demo.result, echo)}
        busy={busy}
        placeholder={beat.placeholder}
        submitLabel={beat.submitLabel}
        inputRef={inputRef}
        onChange={onChange}
        onSubmit={onSubmit}
        readOnly={demo.readOnly}
      />
    );
  }

  return null;
}

export default function Home({ testMode = false }) {
  const { menuOpen, registerBeforeMenuNavigate } = useShellMenuCoordination();
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
  const [showIntroHint, setShowIntroHint] = useState(false); // 入场改点击推进:太久没点→显示"点击继续"提示
  const [obEcho, setObEcho] = useState({});
  const [obInput, setObInput] = useState("");
  const [obBubblePos, setObBubblePos] = useState(null); // 台词气泡贴头定位 {left,top}(px);null=走 CSS(窄屏/竖版底部)
  const [obSdBottom, setObSdBottom] = useState(null); // 竖屏 Q版糖沐「站在气泡顶」的自适应 bottom(px);null=用 CSS 兜底
  const [obChatBubblePos, setObChatBubblePos] = useState(null); // chat 拍前景气泡,坐标相对 .home-ui
  const [obHistory, setObHistory] = useState([]); // 已访拍栈(不含当前),供「上一步」回退
  const [obViaBack, setObViaBack] = useState(false); // 当前拍是否由回退进入 → 显反悔反应(backLine/backEmo)
  const [obThinking, setObThinking] = useState(false); // AI 自适应:提交后糖沐"思考态"(等 /api/chat)
  const [obAiLine, setObAiLine] = useState(null); // AI 生成的自适应台词(当前拍开场,替静态 line);null=用脚本
  const [obCardMessage, setObCardMessage] = useState(null); // 身份卡上糖沐的 AI 寄语;null=卡组件用默认暖句
  const [obCardAvatar, setObCardAvatar] = useState(null); // 身份卡头像(上传 dataURL 或「帮你选」的预设路径);null=头像框留空
  const [obPendingConfirm, setObPendingConfirm] = useState(null); // {field,value,reason}:奇怪/玩笑名先二次确认,不直接写卡
  const [obEmoOverride, setObEmoOverride] = useState(null); // 临时覆盖立绘(如奇怪名字→流汗 wry、接梗→惊讶 surprise)
  const [obContinueHint, setObContinueHint] = useState(false); // 长时间不点 chip 时的弱提示
  const [obComposerFocused, setObComposerFocused] = useState(false);
  const [obInterruptFailure, setObInterruptFailure] = useState(null);
  const [obAutoControl, setObAutoControl] = useState(INITIAL_ONBOARDING_AUTO_CONTROL);
  const obAutoControlRef = useRef(INITIAL_ONBOARDING_AUTO_CONTROL);
  const [obCrop, setObCrop] = useState(null); // 头像裁剪弹窗状态
  // onboarding 分场景背景:obBgScene=当前显示的场景底图(比目标拍略滞后,给立绘先淡出再切);obSceneShift=换场瞬间立绘外层淡出。
  const [obBgScene, setObBgScene] = useState("counter");
  const [obSceneShift, setObSceneShift] = useState(false);
  const obFirstSceneRef = useRef(true);
  // 立绘双层(交叉溶解):slots=两层各 src, layer=当前在顶(不透明)的层。合成一个 state 一次提交,避免换图/切层两次 setState 间的中间帧闪(重影根因之一)。
  const [obPortrait, setObPortrait] = useState({ slots: [null, null], layer: 0 });
  const prevImageRef = useRef(null); // 上一帧立绘 src,供双层比对
  const portraitLoadSeqRef = useRef(0); // 立绘预加载序号,防止慢加载的旧图回写
  const obInputRef = useRef(null); // onboarding 输入框(选项 fill 后聚焦)
  const obAvatarInputRef = useRef(null); // 身份卡头像上传的隐藏 file input
  const obCropImgRef = useRef(null);
  const obCropDragRef = useRef(null);
  const obLineTimerRef = useRef(null);
  const obStepRef = useRef(null);
  const obChatFlowFallbackRef = useRef({ beatId: null, placement: null });
  const obBeat = obStep ? beatById(obStep) : null;
  const obDemo = obBeat && obBeat.demo;
  const introFrame = obIntro >= 0 ? INTRO[obIntro] : null;
  const obActive = obIntro >= 0 || !!obBeat;
  // 当前拍所属场景(引导态跟拍走,否则吧台底图)。换场:先让立绘淡出(300ms)→ 切背景(交叉淡入)→ 淡回。
  const obScene = obActive && obStep ? sceneForBeat(obStep) : "counter";
  useEffect(() => {
    if (obFirstSceneRef.current) {
      obFirstSceneRef.current = false;
      setObBgScene(obScene);
      return;
    }
    setObSceneShift(true);
    const t1 = setTimeout(() => setObBgScene(obScene), 300);
    const t2 = setTimeout(() => setObSceneShift(false), 360);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [obScene]);
  const obReplySpeaker = (obBeat && obBeat.speaker) || "糖沐";
  const obThinkingLine = `${obReplySpeaker}正在思考...`;
  const obHasDraft = Boolean(obInput.trim());
  const obReplyBlocked = obThinking || Boolean(obInterruptFailure);
  const obAutoPlan = resolveAutoAdvancePlan({
    autoNext: obBeat && obBeat.autoNext,
    autoMs: obBeat && obBeat.autoMs,
    nextOverride: obAutoControl.nextOverride,
    inputFocused: obComposerFocused,
    hasDraft: obHasDraft,
    menuOpen,
    replyBlocked: obReplyBlocked || obAutoControl.replyState !== "idle",
  });
  const introTimerPlan = resolveAutoAdvancePlan({
    // 入场全程改点击推进:每一帧(含背身/回头)都不自动播,停留够久(背身/回头按原 dur、正面 2.5s)只冒「点击继续」提示,点屏才走下一句。
    autoNext: introFrame ? "intro:hint" : null,
    autoMs: introFrame ? (introFrame.hold ? 2500 : introFrame.dur || 1200) : 0,
    menuOpen,
  });
  // 当前有效 emo:回退进入且该拍有 backEmo → 用反悔姿势,否则常态 emo。
  const obEmoBase = obBeat ? (obViaBack && obBeat.backEmo ? obBeat.backEmo : obBeat.emo) : null;
  const obEmo = obEmoOverride || (obBeat && obBeat.id === "avatar" && obEcho.nameOdd ? "wry" : obEmoBase);
  // 竖屏 Q版糖沐随状态换姿势(手机登记拍):
  //   折回(上一步/反悔 obViaBack)或 name 拍遇搞笑/奇怪名字(二次确认 / wry / surprise)→ SD4(无奈冒汗);
  //   名字确定后的拍(avatar/taste/cardDone,非折回)→ SD2(趴着执笔写卡,横版,单独排布 is-write);
  //   否则(name 拍常态,问名字、指卡)→ SD3(站立指卡)。
  const obSdPose =
    obBeat && obBeat.showCard && (obViaBack || (obBeat.id === "name" && (obPendingConfirm || obEmoOverride === "wry" || obEmoOverride === "surprise")))
      ? "sd4"
      : obBeat && obBeat.showCard && obBeat.id !== "name"
      ? "sd2"
      : "sd3";
  const obSdSrc = `/home/tangmu-${obSdPose}.png`;
  const obSdWriting = obSdPose === "sd2"; // 仅 SD2 是横版写字,套 is-write 单独排布
  // 当前台词优先级:思考态 > 回退反悔(backLine,仅在还没生成新台词时) > 上传头像后的回应(avatarLine) > AI 自适应/闲聊(obAiLine) > 静态脚本(line)。
  // backLine 是「经上一步回来」的反悔招呼,只在刚回到该拍(obAiLine 尚为 null)时显示;
  // 一旦在该拍产生了新台词(二次确认提问 / 拒绝语 / 插话回应 / 没听清重试),就让位给 obAiLine —— 否则回退后卡在 backLine,确认 chip 出现却看不到确认问题。
  const obHasAvatar = !!(obCardAvatar || (obEcho && obEcho.avatar));
  const obLine = obThinking
    ? obThinkingLine
    : obBeat
    ? obViaBack && obBeat.backLine && !obAiLine
      ? obBeat.backLine(obEcho)
      : obBeat.avatarLine && obHasAvatar && !obAiLine
      ? obBeat.avatarLine(obEcho)
      : obAiLine || obBeat.line(obEcho)
    : introFrame
    ? introFrame.line
    : "";
  // 当前姿势的「头中心」锚点(入场帧 / 差分 emo);用于把气泡贴到头侧、齐头高。
  const headAnchor = introFrame ? INTRO_HEAD[obIntro] : obEmo ? HEAD[obEmo] : null;
  const stageHeadAnchor = obActive ? headAnchor : isTangmu ? HEAD.smile : GENERIC_PORTRAIT_HEAD;

  const displayName = cardName(card) || (isTangmu ? "糖沐" : "角色");
  const image = introFrame ? introFrame.img : obBeat ? PORTRAIT[obEmo] || TANGMU_IMG : isTangmu ? TANGMU_IMG : cardImageOf(card);
  const hasSaves = !!game || serverSaves.length > 0;
  const isReturning = hasSaves || messages.length > 0;
  // 首进 home 随机一句招呼语(每次挂载定一次,渲染中不变)。
  const [homeGreeting] = useState(() => HOME_GREETINGS[Math.floor(Math.random() * HOME_GREETINGS.length)]);
  const greeting = isReturning ? GREETING_BACK : homeGreeting;

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
          image: resolveMediaUrl(raw.image || raw.avatar || ""),
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
      restoredRef.current = hasRestoredHomeConversation(r);
      setCard(r.card);
      setIsTangmu(!!r.isTangmu);
      setSessionId(r.sessionId || newSessionId());
      setMessages(Array.isArray(r.msgs) ? r.msgs : []);
    }
  }, [testMode]);

  // 首访引导:没被引导过 + 没恢复出历史会话 → 进新手引导(老用户 / 聊过的人不触发)。
  // testMode(/test):每次进都强制从首拍开始、清空回声,方便反复测(不读写完成标记)。
  useEffect(() => {
    if (testMode) {
      setObEcho({});
      setObIntro(0); // 从入场演出(背身)开始
      return;
    }
    const skipOnce = consumeTestHomeBypass();
    if (!skipOnce && !isOnboarded() && !restoredRef.current) {
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
  // 入场节奏:全程点击推进——每帧都停下等点屏(背身/回头/正面一致);停留够久只冒"点击继续"提示(nextId 恒为 intro:hint,不再自动 advance)。
  useEffect(() => {
    if (obIntro < 0 || !introTimerPlan.shouldSchedule) return undefined;
    setShowIntroHint(false);
    const timer = setTimeout(() => {
      if (introTimerPlan.nextId === "intro:hint") setShowIntroHint(true);
      else advanceIntro();
    }, introTimerPlan.delay);
    return () => clearTimeout(timer);
  }, [obIntro, introTimerPlan.shouldSchedule, introTimerPlan.nextId, introTimerPlan.delay]);

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

  // onboarding 期间 = 全屏接管:给 root 挂类,隐藏续玩浮条并让菜单保持可用。
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("ais-onboarding", obActive);
    return () => el.classList.remove("ais-onboarding");
  }, [obActive]);

  useEffect(() => {
    if (!obActive) return undefined;
    return registerBeforeMenuNavigate(() => {
      if (testMode) setTestHomeBypass();
      endOnboarding();
    });
  }, [obActive, registerBeforeMenuNavigate, testMode, obEcho]);

  useEffect(() => {
    obStepRef.current = obStep;
  }, [obStep]);

  useEffect(() => {
    if (!obBeat || !obAutoPlan.shouldSchedule || !obAutoPlan.nextId) return undefined;
    const beatId = obBeat.id;
    const scheduledEpoch = obAutoControlRef.current.interactionEpoch;
    const timer = setTimeout(() => {
      if (obStepRef.current === beatId && obAutoControlRef.current.interactionEpoch === scheduledEpoch) {
        obGoNext(obAutoPlan.nextId, null, { history: false });
      }
    }, obAutoPlan.delay);
    return () => clearTimeout(timer);
  }, [obBeat, obAutoPlan.shouldSchedule, obAutoPlan.nextId, obAutoPlan.delay]);

  useEffect(() => {
    return () => {
      commitOnboardingAutoEvent({ type: "invalidate" });
      setObInterruptFailure(null);
      setObComposerFocused(false);
      if (obLineTimerRef.current) clearTimeout(obLineTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const url = obCrop && obCrop.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [obCrop && obCrop.url]);

  useEffect(() => {
    setObContinueHint(false);
    if (!obBeat || obThinking || obInput.trim()) return undefined;
    const hasContinue = (obBeat.chips || []).some((c) => c.next || c.to || c.done);
    if (!hasContinue) return undefined;
    const t = setTimeout(() => setObContinueHint(true), 6200);
    return () => clearTimeout(t);
  }, [obStep, obAiLine, obThinking, obInput]);

  // 台词气泡「贴头侧、齐头高」定位:按当前姿势头中心算屏幕坐标,把气泡右缘锚到头左侧一点、纵向中心对齐头高。
  // 立绘各姿势 CSS 尺寸一致,量任一张 img 盒即可(几何稳定)。紧凑/竖版走 CSS 流式布局 → 清空锚点。
  useLayoutEffect(() => {
    let frame = 0;
    let cancelled = false;
    const compute = () => {
      if (!stageHeadAnchor || fullscreen || (obActive && obDemo && obDemo.type === "chat")) return setObBubblePos(null);
      if (usesFlowOnboardingBubbleLayout({
        width: window.innerWidth,
        height: window.innerHeight,
        demoType: obDemo && obDemo.type,
      })) return setObBubblePos(null);
      const portrait = document.querySelector(".home-portrait");
      const img = document.querySelector(".home-portrait-img.is-on") || document.querySelector(".home-portrait img");
      if (!portrait || !img) return;
      const pr = portrait.getBoundingClientRect();
      const r = img.getBoundingClientRect();
      if (!r.width) return;
      // 坐标相对 .home-portrait(图 rect 减容器 rect):祖先 transform 对图和容器同样偏移、相减抵消,故滑动中途量也稳。
      // 气泡就渲染在 .home-portrait 里,立绘 -8% 滑动时气泡随容器 transform 一起走 → 不用重算、天然不卡(不再靠 transitionend)。
      const headCY = r.top - pr.top + stageHeadAnchor.y * r.height;
      const rightEdge = r.left - pr.left + (stageHeadAnchor.edge - 0.025) * r.width;
      const bubble = portrait.querySelector(obActive ? ".home-ob-bubble:not(.home-ob-bubble--chat):not(.home-ob-bubble--home)" : ".home-ob-bubble--home");
      const bubbleRect = bubble && bubble.getBoundingClientRect();
      const bubbleWidth = bubbleRect ? bubbleRect.width : 0;
      const bubbleHeight = bubbleRect ? bubbleRect.height : 0;
      const demoShift = obActive && obDemo && ["story", "character", "characterCard", "create", "createProjection"].includes(obDemo.type) ? 0.1 : 0;
      const targetShift = obActive && obBeat && obBeat.showCard ? 0.08 : demoShift;
      const targetPortraitLeft = portrait.offsetLeft - portrait.offsetWidth * targetShift;
      const safePortraitLeft = Math.min(pr.left, targetPortraitLeft);
      const viewportSafeEdge = bubbleWidth ? bubbleWidth + 12 - safePortraitLeft : rightEdge;
      const dock = document.querySelector(".home-dock");
      const dockTop = dock ? dock.getBoundingClientRect().top : window.innerHeight - 24;
      const minScreenTop = 56;
      const maxScreenBottom = Math.max(minScreenTop + bubbleHeight, dockTop - 16);
      let safeHeadCY = headCY;
      const screenTop = pr.top + safeHeadCY - bubbleHeight / 2;
      const screenBottom = pr.top + safeHeadCY + bubbleHeight / 2;
      if (bubbleHeight && screenTop < minScreenTop) safeHeadCY += minScreenTop - screenTop;
      if (bubbleHeight && screenBottom > maxScreenBottom) safeHeadCY -= screenBottom - maxScreenBottom;
      setObBubblePos({ left: Math.round(Math.max(rightEdge, viewportSafeEdge)), top: Math.round(safeHeadCY) });
    };
    const schedule = () => {
      if (cancelled) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(compute);
    };

    const portrait = document.querySelector(".home-portrait");
    const activeImg = document.querySelector(".home-portrait-img.is-on") || document.querySelector(".home-portrait img");
    const dock = document.querySelector(".home-dock");
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;

    schedule();
    window.addEventListener("resize", schedule);
    activeImg?.addEventListener("load", schedule);
    portrait?.addEventListener("transitionend", schedule);
    // 不观察气泡自身:compute() 会改气泡定位,气泡宽度又随定位变 → ResizeObserver 触发 → 再 compute → …
    // 在 createProjection 等被右侧面板挤窄的拍会形成反馈环、跑满主线程(逐字动画一跑就复现)。
    // 气泡随台词/场景变化的重定位已由本 effect 的依赖数组 + resize/load/transitionend/fonts 覆盖。
    if (dock) observer?.observe(dock);
    document.fonts?.ready.then(schedule).catch(() => {});

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      activeImg?.removeEventListener("load", schedule);
      portrait?.removeEventListener("transitionend", schedule);
      observer?.disconnect();
    };
  }, [
    obActive,
    stageHeadAnchor,
    obStep,
    obIntro,
    image,
    obPortrait.layer,
    obPortrait.slots[obPortrait.layer],
    obDemo && obDemo.type,
    fullscreen,
    displayName,
    currentLine,
    busy,
    obLine,
    obThinking,
  ]);

  // 竖屏登记拍:Q版糖沐「站在气泡顶」的自适应定位 —— 量气泡实际顶边,把 Q版脚底锚到那儿,
  // 不同手机 / 不同台词行数都踩在气泡上沿(桌面 Q版 display:none 不参与;量不到则回退 CSS 固定值)。
  useLayoutEffect(() => {
    if (!(obBeat && obBeat.showCard)) {
      setObSdBottom(null);
      return;
    }
    let frame = 0;
    let cancelled = false;
    const compute = () => {
      const narrow = window.matchMedia("(max-width: 720px)").matches || window.innerHeight > window.innerWidth;
      if (!narrow) return setObSdBottom(null);
      const bubble = document.querySelector(".home-portrait .home-ob-bubble:not(.home-ob-bubble--chat):not(.home-ob-bubble--home)");
      if (!bubble) return;
      const r = bubble.getBoundingClientRect();
      if (!r.height) return;
      // 脚底落在气泡上沿之上 4px(不陷进气泡、不遮住它):+gap 抬高;像轻轻站在气泡顶。
      setObSdBottom(Math.round(window.innerHeight - r.top + 4));
    };
    const schedule = () => {
      if (cancelled) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(compute);
    };
    schedule();
    window.addEventListener("resize", schedule);
    document.fonts?.ready.then(schedule).catch(() => {});
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
    };
  }, [obBeat && obBeat.showCard, obStep, obLine, obThinking]);

  // 竖屏登记拍整体随屏宽缩放:按 (屏宽/390) 出一个系数(夹 0.82~1.2),身份卡与 Q版都乘它 → 不同手机成比例。
  // 只在竖屏 CSS 里用到该变量(桌面规则不引用),JS 失效则 CSS 回退默认 1(= 原 scale 0.62),可安全降级。
  useLayoutEffect(() => {
    const apply = () => {
      const s = Math.min(1.2, Math.max(0.82, window.innerWidth / 390));
      document.documentElement.style.setProperty("--ob-mscale", s.toFixed(3));
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  // chat 拍气泡在 .home-ui 前景层：宣说话时从宣的真实 rect 右侧起排；糖沐说话时回到糖沐头侧。
  // 位置在首轮 layout、视口 resize、立绘位移结束及宣图片加载后重算，始终 clamp 在 UI/viewport 内。
  useLayoutEffect(() => {
    if (!obActive || !obBeat || !obDemo || obDemo.type !== "chat") {
      obChatFlowFallbackRef.current = { beatId: null, placement: null };
      setObChatBubblePos(null);
      return undefined;
    }

    if (obChatFlowFallbackRef.current.beatId !== obStep) {
      obChatFlowFallbackRef.current = { beatId: obStep, placement: null };
      setObChatBubblePos(null);
    }

    let frame = 0;
    let retryPending = false;
    const compute = (retryNormal = false) => {
      const ui = document.querySelector(".home-ui");
      if (!ui) {
        obChatFlowFallbackRef.current = { beatId: obStep, placement: null };
        setObChatBubblePos(null);
        return;
      }
      const uiRect = ui.getBoundingClientRect();
      if (!uiRect.width) {
        obChatFlowFallbackRef.current = { beatId: obStep, placement: null };
        setObChatBubblePos(null);
        return;
      }

      const narrow = window.matchMedia("(max-width: 720px), (orientation: portrait)").matches;
      const pad = narrow ? 12 : 24;
      const gap = narrow ? 8 : 16;
      let preferredWidth = narrow ? clamp(uiRect.width * 0.4, 144, 196) : clamp(uiRect.width * 0.25, 280, 350);
      const dock = ui.querySelector(".home-dock");
      const dockTop = dock ? dock.getBoundingClientRect().top - uiRect.top : uiRect.height - pad;
      const chatStage = ui.querySelector(".home-ob-demo--chat");
      const chatStageLayout = resolveChatStageLayout({ viewportHeight: uiRect.height, dockTop, narrow, padding: pad, gap });
      const applyPlacement = (placement) => {
        if (placement?.flowFallback) {
          chatStage?.style.removeProperty("bottom");
          chatStage?.style.removeProperty("height");
          obChatFlowFallbackRef.current = { beatId: obStep, placement };
        } else {
          if (chatStage && chatStageLayout) {
            chatStage.style.bottom = `${chatStageLayout.bottom}px`;
            chatStage.style.height = `${chatStageLayout.height}px`;
          } else {
            chatStage?.style.removeProperty("bottom");
            chatStage?.style.removeProperty("height");
          }
          obChatFlowFallbackRef.current = { beatId: obStep, placement: null };
        }
        setObChatBubblePos(placement || null);
      };

      const latchedFallback = obChatFlowFallbackRef.current;
      if (!retryNormal && latchedFallback.beatId === obStep && latchedFallback.placement) {
        applyPlacement(latchedFallback.placement);
        return;
      }

      const bubble = ui.querySelector(".home-ob-bubble--chat");
      const bubbleRect = bubble && bubble.getBoundingClientRect();
      const bubbleHeight = Math.max(112, (bubbleRect && bubbleRect.height) || 0);
      let speakerRect = null;
      const avoidRects = [];
      let preferredSide = "right";

      const tangmu = document.querySelector(".home-portrait-img.is-on") || document.querySelector(".home-portrait img");
      const tangmuRect = tangmu && tangmu.getBoundingClientRect();
      const tangmuFile = tangmu && tangmu.currentSrc
        ? (() => {
            try {
              return new URL(tangmu.currentSrc).pathname.split("/").pop();
            } catch {
              return "";
            }
          })()
        : "";
      const tangmuVisible = tangmuRect && tangmuRect.width
        ? resolveVisibleImageRect({
            box: {
              left: tangmuRect.left - uiRect.left,
              top: tangmuRect.top - uiRect.top,
              width: tangmuRect.width,
              height: tangmuRect.height,
            },
            naturalSize: { width: tangmu.naturalWidth || 1024, height: tangmu.naturalHeight || 1536 },
            alphaBounds: TANGMU_ALPHA_BOUNDS[tangmuFile] || { left: 124, top: 0, right: 1024, bottom: 1536 },
          })
        : null;
      const xuan = ui.querySelector(".home-demo-xuan-img");
      const xuanBox = xuan && xuan.getBoundingClientRect();
      const xuanVisible = xuanBox && xuanBox.width
        ? resolveVisibleImageRect({
            box: {
              left: xuanBox.left - uiRect.left,
              top: xuanBox.top - uiRect.top,
              width: xuanBox.width,
              height: xuanBox.height,
            },
            naturalSize: { width: xuan.naturalWidth || 1024, height: xuan.naturalHeight || 1535 },
            alphaBounds: XUAN_ALPHA_BOUNDS,
            alignX: 1,
            alignY: 1,
          })
        : null;

      if (narrow && tangmuVisible) {
        const safeLeftWidth = tangmuVisible.left - pad - gap;
        if (safeLeftWidth >= 120) preferredWidth = Math.min(preferredWidth, safeLeftWidth);
      }

      if (obBeat.speaker === "宣") {
        if (!xuanVisible) {
          applyPlacement(null);
          return;
        }
        speakerRect = xuanVisible;
        if (tangmuVisible) avoidRects.push(tangmuVisible);
      } else {
        if (!tangmuVisible) {
          applyPlacement(null);
          return;
        }
        speakerRect = tangmuVisible;
        if (xuanVisible) avoidRects.push(xuanVisible);
        preferredSide = "left";
      }

      const placement = resolveChatBubblePlacement({
        viewport: { width: uiRect.width, height: uiRect.height },
        speakerRect,
        avoidRects,
        bubbleSize: { width: preferredWidth, height: bubbleHeight },
        dockTop,
        preferredSide,
        padding: pad,
        gap,
      });
      applyPlacement(placement);
    };
    const schedule = (retryNormal = false) => {
      if (retryNormal) {
        retryPending = true;
        obChatFlowFallbackRef.current = { beatId: obStep, placement: null };
        setObChatBubblePos(null);
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!retryPending) {
          compute(false);
          return;
        }
        retryPending = false;
        frame = requestAnimationFrame(() => compute(true));
      });
    };
    const handleResize = () => schedule(true);
    const scheduleStable = () => schedule(false);

    schedule();
    window.addEventListener("resize", handleResize);
    const portrait = document.querySelector(".home-portrait");
    const chatStage = document.querySelector(".home-ob-demo--chat");
    const xuan = document.querySelector(".home-demo-xuan-img");
    const bubble = document.querySelector(".home-ob-bubble--chat");
    const dock = document.querySelector(".home-dock");
    const bubbleObserver = typeof ResizeObserver === "function" && bubble ? new ResizeObserver(scheduleStable) : null;
    portrait?.addEventListener("transitionend", scheduleStable);
    chatStage?.addEventListener("animationend", scheduleStable);
    xuan?.addEventListener("load", scheduleStable);
    bubbleObserver?.observe(bubble);
    if (dock) bubbleObserver?.observe(dock);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      portrait?.removeEventListener("transitionend", scheduleStable);
      chatStage?.removeEventListener("animationend", scheduleStable);
      xuan?.removeEventListener("load", scheduleStable);
      bubbleObserver?.disconnect();
      chatStage?.style.removeProperty("bottom");
      chatStage?.style.removeProperty("height");
    };
  }, [obActive, obStep, obBeat && obBeat.speaker, obDemo && obDemo.type, headAnchor, image, obLine, obThinking]);

  // 立绘双层交叉溶解:image 变 → 把新图放「非当前层」+ 切当前层到它 = 新层淡入、旧层淡出。
  // 换图与切层合成一次 setObPortrait(原子提交),消掉两次 setState 间「新图挂在旧层判定上以 opacity:1 闪现」的中间帧(整图差分重影的根因之一)。
  useLayoutEffect(() => {
    if (!image) return;
    const seq = ++portraitLoadSeqRef.current;
    if (prevImageRef.current === null) {
      setObPortrait({ slots: [image, image], layer: 0 }); // 首帧两层同图,首次换姿势也能淡入
      prevImageRef.current = image;
      return;
    }
    if (image !== prevImageRef.current) {
      const commit = (eventType) => {
        if (!shouldCommitPortraitPreload({
          requestEpoch: seq,
          currentEpoch: portraitLoadSeqRef.current,
          eventType,
          naturalWidth: nextImg.naturalWidth,
        })) return;
        setObPortrait((p) => {
          if (p.slots[p.layer] === image) return p;
          const next = p.layer === 0 ? 1 : 0;
          const slots = [...p.slots];
          slots[next] = image;
          return { slots, layer: next };
        });
        prevImageRef.current = image;
      };
      const nextImg = new Image();
      nextImg.onload = () => commit("load");
      nextImg.onerror = () => commit("error");
      nextImg.src = image;
      if (nextImg.complete && nextImg.naturalWidth > 0) commit("load");
      return () => {
        nextImg.onload = null;
        nextImg.onerror = null;
      };
    }
  }, [image]);

  // 身份卡 AI 寄语:进 card 拍时,糖沐现场为这位客人写一句话(卡背)。后台生成、不挡卡出现;失败留 null → 卡用默认暖句。
  useEffect(() => {
    if (!obBeat || !obBeat.card || !obBeat.msg || obCardMessage) return;
    let alive = true;
    (async () => {
      let msg = null;
      try {
        const card = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "糖沐", description: AI_PERSONA, scenario: obBeat.msg(obEcho) } };
        const r = await Promise.race([
          postJSON("/api/chat", { card, session_id: newSessionId(), user: obEcho.taste || obEcho.name || "新客", world: null }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000)),
        ]);
        msg = sanitizeCardMessage((r && r.reply) || "") || null;
      } catch (e) {
        msg = null;
      }
      if (alive) setObCardMessage(msg);
    })();
    return () => {
      alive = false;
    };
  }, [obStep]);

  // 导览拍改「点 chip 推进」:原先有 tour 的拍会 AUTO_MS 自动连讲、自己往下跳,雨钦 2026-07-07 定去掉——
  // 把控制权还给玩家:糖沐每拍讲完停下,等玩家点 chip(然后呢/还有吗…)再进下一个功能介绍。
  // 插话(obChatSubmit)仍随时可用,只换台词不推进。点屏推进 / 去 chip / 糖沐连讲 留后续方案定了再做。

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
  function commitOnboardingAutoEvent(event) {
    const transition = transitionOnboardingAutoControl(obAutoControlRef.current, event);
    obAutoControlRef.current = transition.control;
    setObAutoControl(transition.control);
    if (transition.blurComposer || event.type === "invalidate") obInputRef.current?.blur();
    return transition;
  }
  function beginOnboardingInteraction(beatId, type = "request-start") {
    const transition = commitOnboardingAutoEvent({ type });
    return { requestEpoch: transition.control.interactionEpoch, requestBeatId: beatId };
  }
  function canApplyOnboardingInteraction(token) {
    return isCurrentOnboardingInteraction({
      ...token,
      currentEpoch: obAutoControlRef.current.interactionEpoch,
      currentBeatId: obStepRef.current,
    });
  }
  function endOnboarding(echo) {
    commitOnboardingAutoEvent({ type: "invalidate" });
    setObInterruptFailure(null);
    setObComposerFocused(false);
    if (!testMode) {
      markOnboarded();
      saveEcho(echo || obEcho);
    }
    setObHistory([]);
    setObViaBack(false);
    setObAiLine(null);
    setObCardMessage(null);
    setObThinking(false);
    setObPendingConfirm(null);
    setObEmoOverride(null);
    setObContinueHint(false);
    setObIntro(-1);
    setObStep(null);
  }
  function persistEcho(echo) {
    if (!testMode) saveEcho(echo);
  }
  function confirmPendingName() {
    if (!obPendingConfirm || obPendingConfirm.field !== "name") return;
    const name = obPendingConfirm.value;
    const echo = { ...obEcho, name, nameOdd: true };
    setObEcho(echo);
    persistEcho(echo);
    setObPendingConfirm(null);
    setObInput("");
    obGoNext("avatar", `行……我真给你写「${name}」了。先说好,以后这张卡就这么叫你。头像呢,自己给一张,还是我帮你选?`, { emo: "wry" });
  }
  function rejectPendingName() {
    setObPendingConfirm(null);
    setObEmoOverride(null);
    setObAiLine("那我先不写。重新报一个你想被怎么称呼的名字就行。");
    setObInput("");
    requestAnimationFrame(() => obInputRef.current?.focus());
  }
  function obChip(c) {
    if (c.retryInterrupt) {
      submitAutoDialogueInterrupt(obInterruptFailure.text);
      return;
    }
    if (c.continueAfterInterrupt) {
      obGoNext("tryCreate", null, { history: false });
      return;
    }
    if (c.confirmName) {
      confirmPendingName();
      return;
    }
    if (c.retryName) {
      rejectPendingName();
      return;
    }
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
    // 「我帮你选一张」chip:仅在还没有头像时,把预设默认头像(糖沐 Q 版)贴上卡,再照常推进(不覆盖用户已上传的)。
    if (c.pickAvatar && !obCardAvatar && !(obEcho && obEcho.avatar)) {
      setObCardAvatar(c.pickAvatar);
      const picked = { ...obEcho, avatar: c.pickAvatar };
      setObEcho(picked);
      persistEcho(picked);
    }
    let echo = obEcho;
    if (c.set) {
      echo = { ...obEcho, ...c.set };
      setObEcho(echo);
      persistEcho(echo);
    }
    if (c.done) endOnboarding(echo);
    if (c.to) {
      navigate(c.to);
      return;
    }
    if (!c.done && c.next) obGoNext(c.next);
  }
  // 解析糖沐回复的辨别标记:[CHAT]/[MEME]=接话不填 / [NONE]=无偏好 / [OK]=填答案。名字拍强制要求标记,避免漏标时误写卡。
  async function obFieldSubmit() {
    const v = obInput.trim();
    if (!v || !obBeat || !obBeat.field || obThinking) return;
    const beat = obBeat;
    if (!beat.next) return;
    if (obPendingConfirm && beat.field === "name") {
      const pending = analyzePendingNameInput(v, obPendingConfirm.value);
      if (pending.intent === "confirm") {
        confirmPendingName();
        return;
      }
      const correction = pending.intent === "change" ? pending : analyzeNameCorrectionInput(v);
      if (correction.value) {
        if (correction.needsConfirm) {
          setObPendingConfirm({ field: "name", value: correction.value, reason: correction.reason });
          setObEmoOverride("wry");
          setObAiLine(`我先确认一下,你是认真要把「${correction.value}」写在卡上吗?`);
          setObInput("");
          return;
        }
        const echo = { ...obEcho, name: correction.value, nameOdd: false };
        setObEcho(echo);
        persistEcho(echo);
        setObPendingConfirm(null);
        setObEmoOverride(null);
        obGoNext("avatar", `${correction.value},那我改写这个。头像呢,自己给一张还是我帮你选?`);
        return;
      }
      if (saysNo(v)) {
        rejectPendingName();
        return;
      }
      if (saysYes(v)) {
        confirmPendingName();
        return;
      }
    }
    const chipMatch = matchChipIntent(v, beat.chips);
    if (chipMatch && !isExactFillChipSubmission(v, chipMatch)) {
      obChip(chipMatch);
      return;
    }
    let fieldValue = v;
    let localName = null;
    if (beat.field === "name") {
      localName = analyzeNameInput(v);
      if (localName.value) fieldValue = localName.value;
      if (localName.value && shouldAcceptNameLocally(v)) {
        const echo = { ...obEcho, name: fieldValue, nameOdd: false };
        setObEcho(echo);
        persistEcho(echo);
        obGoNext(beat.next);
        return;
      }
      if (localName.value && shouldConfirmBareNameLocally(v)) {
        setObPendingConfirm({ field: "name", value: localName.value, reason: localName.reason });
        setObEmoOverride("wry");
        setObAiLine(`我先确认一下,你是认真要把「${localName.value}」写在卡上吗?`);
        setObInput("");
        return;
      }
    }
    // AI 辨别:[OK]→填卡+推进;[MEME]/[CHAT]→接话不填。名字拍失败/漏标时重说,其他字段保留旧的无标记答案降级。
    if (beat.ai) {
      setObEmoOverride(null);
      const token = beginOnboardingInteraction(beat.id);
      setObThinking(true);
      let reply = null;
      try {
        const card = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "糖沐", description: AI_PERSONA, scenario: beat.ai.scenario(obEcho) } };
        const r = await Promise.race([
          postJSON("/api/chat", { card, session_id: newSessionId(), user: v, world: null }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000)),
        ]);
        reply = ((r && r.reply) || "").trim() || null;
      } catch (e) {
        reply = null; // 降级:请玩家重说,避免把闲聊/反问误写进身份卡。
      }
      if (!canApplyOnboardingInteraction(token)) return;
      const settled = commitOnboardingAutoEvent({ type: "reply-settled", interactionEpoch: token.requestEpoch });
      if (!settled.applied) return;
      setObThinking(false);
      const emotionReply = reply
        ? parseOnboardingEmotionReply(reply, { fallbackEmo: beat.emo || "smile" })
        : { text: "", emo: beat.emo || "smile" };
      reply = emotionReply.text || null;
      if (!reply && beat.ai.optional) {
        const echo = { ...obEcho, [beat.field]: fieldValue };
        setObEcho(echo);
        persistEcho(echo);
        obGoNext(beat.next);
        return;
      }
      const isNameField = beat.field === "name";
      const p = parseFieldIntentReply(reply, { requireTag: isNameField, allowNone: !isNameField });
      if (p.intent === "retry") {
        if (beat.speaker !== "宣") setObEmoOverride(emotionReply.emo);
        setObAiLine(beat.field === "name" ? "我刚才没听清。你直接报一个想写在卡上的称呼就行。" : "我刚才没听清。最近在看什么,或者说「没有」也行。");
        setObInput("");
        return;
      }
      if (p.intent === "chat") {
        // 闲聊/没正经回答:糖沐接话但不填卡、不推进,停这拍继续等真正的答案。
        if (beat.speaker !== "宣") setObEmoOverride(p.meme ? "surprise" : emotionReply.emo);
        setObAiLine(p.text || (beat.field === "name" ? "这个不像称呼。那,我该怎么叫你?" : "这句我先当闲聊。那,最近都在看点什么?"));
        setObInput("");
        return;
      }
      // answer=填玩家答案 / none=明说没有→卡上记空(背面写暖句、不写书)。名字拍若 AI 明确抽出「称呼=...」,用抽出的值填卡。
      let answerValue = fieldValue;
      let answerLine = p.text;
      if (beat.field === "name" && p.intent === "answer") {
        const extracted = extractNameFromAiFieldText(p.text);
        if (extracted.value) {
          answerValue = extracted.value;
          answerLine = extracted.text;
        }
      } else if (beat.field === "taste" && p.intent === "answer") {
        const extracted = extractTasteFromAiFieldText(p.text);
        if (extracted.value) {
          answerValue = extracted.value;
          answerLine = extracted.text;
        }
      }
      const echo = { ...obEcho, [beat.field]: p.intent === "none" ? "" : answerValue };
      if (beat.field === "name") echo.nameOdd = false;
      setObEcho(echo);
      persistEcho(echo);
      const trimmedAnswerLine = beat.ai.optional && answerLine && answerLine.length > 72 ? answerLine.slice(0, 72) + "…" : answerLine;
      const nextLine = resolveNextBeatAiLine({ nextBeatId: beat.next, aiLine: trimmedAnswerLine });
      const nextBeat = beatById(beat.next);
      obGoNext(beat.next, nextLine, { emo: nextLine && nextBeat && nextBeat.speaker !== "宣" ? emotionReply.emo : null });
    } else {
      const echo = { ...obEcho, [beat.field]: v };
      setObEcho(echo);
      persistEcho(echo);
      obGoNext(beat.next);
    }
  }
  async function obAskChipIntent(v, beat, chips, currentLine) {
    if (!beat || !Array.isArray(chips) || !chips.length) return { chip: null, chat: null };
    const actions = chips.map((c, i) => `${i}. ${c.label}`).join("\n");
    const scenario =
      "你是沐言书坊 onboarding 的意图判别器,同时用糖沐的店员口吻兜底回复。只能输出两种格式之一:\n" +
      "1. [CHIP:n] —— 玩家是在确认、肯定、继续、跳过、或选择某个当前可见动作,n 是下面动作列表的索引。\n" +
      "2. [CHAT]一句很短的糖沐回复 —— 玩家是在问问题、闲聊、搞怪、辱骂、试探边界、或没有明确选择当前动作。\n" +
      "规则:\n" +
      "- ok/okay/yes/好/好的/嗯/可以/继续/下一步/接着/带我看看/show me around,在上下文里通常是选择当前唯一的继续动作。\n" +
      "- 有上传头像动作时,只有玩家明确说上传/传图/照片/avatar/photo 才选上传;说跳过/no avatar/continue/ok 则选继续或跳过头像的动作。\n" +
      "- 不要创造动作,不要导航,不要解释格式。\n" +
      `${ONBOARDING_EMOTION_REPLY_INSTRUCTION}\n` +
      `当前糖沐台词:${currentLine || ""}\n当前动作:\n${actions}`;
    try {
      const card = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "糖沐", description: AI_PERSONA, scenario } };
      const r = await Promise.race([
        postJSON("/api/chat", { card, session_id: newSessionId(), user: v, world: null }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 12000)),
      ]);
      const emotionReply = parseOnboardingEmotionReply(((r && r.reply) || "").trim(), { fallbackEmo: beat.emo || "smile" });
      return { ...parseChipIntentReply(emotionReply.text, chips), emo: emotionReply.emo };
    } catch (e) {
      return { chip: null, chat: null, emo: null };
    }
  }

  async function submitAutoDialogueInterrupt(retryText = null) {
    const beat = obBeat;
    const value = String(retryText == null ? obInput : retryText).trim();
    if (!value || !beat || !beat.interruptible || obThinking) return;
    const shownLine = obLine;
    const shownContext = buildAutoChatShownContext(beat.id, obEcho, shownLine);
    const speaker = beat.speaker || "糖沐";
    const ai = AUTO_CHAT_INTERRUPT_AI[speaker];
    const token = beginOnboardingInteraction(beat.id, retryText == null ? "send" : "retry");
    setObComposerFocused(false);
    setObInterruptFailure(null);
    setObThinking(true);

    let reply = null;
    try {
      const card = {
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: {
          name: speaker,
          description: ai.description,
          scenario: ai.scenario({ name: obEcho.name, shownContext }),
        },
      };
      const response = await Promise.race([
        postJSON("/api/chat", { card, session_id: newSessionId(), user: value, world: null }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000)),
      ]);
      reply = String((response && response.reply) || "").trim() || null;
    } catch (error) {
      reply = null;
    }

    if (!canApplyOnboardingInteraction(token)) return;
    if (reply) {
      const transition = commitOnboardingAutoEvent({ type: "reply-success", interactionEpoch: token.requestEpoch });
      if (!transition.applied) return;
      const emotionReply = parseOnboardingEmotionReply(reply, { fallbackEmo: beat.emo || "smile" });
      setObThinking(false);
      setObInput("");
      setObAiLine(emotionReply.text);
      if (speaker !== "宣") setObEmoOverride(emotionReply.emo);
      setObInterruptFailure(null);
      return;
    }
    const transition = commitOnboardingAutoEvent({ type: "reply-failure", interactionEpoch: token.requestEpoch });
    if (!transition.applied) return;
    setObThinking(false);
    setObInput(value);
    setObAiLine(ai.failureLine);
    setObInterruptFailure({ beatId: beat.id, speaker, text: value });
  }

  // 导览期玩家插话:先判断是不是当前动作的自然说法;确实是闲聊才让糖沐接一句,不推进当前导览拍。
  async function obChatSubmit() {
    const v = obInput.trim();
    if (!v || obThinking) return;
    if (obBeat?.interruptible) return submitAutoDialogueInterrupt();
    if (obBeat) {
      const chipMatch = matchChipIntent(v, obBeat.chips);
      if (chipMatch) {
        setObInput("");
        obChip(chipMatch);
        return;
      }
    }
    const token = beginOnboardingInteraction(obBeat.id);
    setObInput("");
    setObThinking(true);
    const intent = await obAskChipIntent(v, obBeat, obBeat.chips, obLine);
    if (!canApplyOnboardingInteraction(token)) return;
    if (intent.chip) {
      const settled = commitOnboardingAutoEvent({ type: "reply-settled", interactionEpoch: token.requestEpoch });
      if (!settled.applied) return;
      setObThinking(false);
      if (intent.chip.upload) {
        setObAiLine("可以,点一下「＋ 传张头像」,我就帮你贴到卡上。");
        setObContinueHint(true);
        return;
      }
      obChip(intent.chip);
      return;
    }
    if (intent.chat) {
      const settled = commitOnboardingAutoEvent({ type: "reply-settled", interactionEpoch: token.requestEpoch });
      if (!settled.applied) return;
      setObThinking(false);
      setObAiLine(intent.chat);
      if (intent.emo) setObEmoOverride(intent.emo);
      return;
    }
    let reply = null;
    try {
      const card = { spec: "chara_card_v2", spec_version: "2.0", data: { name: "糖沐", description: AI_PERSONA, scenario: CHAT_SCENARIO } };
      const response = await Promise.race([
        postJSON("/api/chat", { card, session_id: newSessionId(), user: v, world: null }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 12000)),
      ]);
      reply = String((response && response.reply) || "").trim() || null;
    } catch (error) {
      reply = null;
    }
    if (!canApplyOnboardingInteraction(token)) return;
    const settled = commitOnboardingAutoEvent({ type: "reply-settled", interactionEpoch: token.requestEpoch });
    if (!settled.applied) return;
    setObThinking(false);
    if (reply) {
      const emotionReply = parseOnboardingEmotionReply(reply, { fallbackEmo: obBeat.emo || "smile" });
      setObAiLine(emotionReply.text);
      setObEmoOverride(emotionReply.emo);
    }
    else {
      setObAiLine("我刚才没听清。你可以再说一次,或者点下面的选项继续。");
      setObContinueHint(true);
    }
  }
  // 前进一拍:压历史(供回退),清回退态与输入框;aiLine=本次 AI 自适应台词(替下一拍静态开场),null=用脚本。
  function obGoNext(nextId, aiLine = null, opts = {}) {
    commitOnboardingAutoEvent({ type: "invalidate" });
    setObInterruptFailure(null);
    setObComposerFocused(false);
    if (opts.history !== false) setObHistory((h) => [...h, obStep]);
    setObViaBack(false);
    setObAiLine(aiLine);
    setObCardMessage(null);
    setObPendingConfirm(null);
    setObEmoOverride(opts.emo || null);
    setObContinueHint(false);
    setObInput("");
    setObStep(nextId);
  }
  // 回退上一拍:糖沐做反悔反应(backLine/backEmo);字段拍回填旧值方便改。清 AI 自适应/思考态。
  function obBack() {
    if (!obHistory.length || obThinking) return;
    commitOnboardingAutoEvent({ type: "invalidate" });
    setObInterruptFailure(null);
    setObComposerFocused(false);
    const prevId = obHistory[obHistory.length - 1];
    const prev = beatById(prevId);
    setObHistory((h) => h.slice(0, -1));
    setObViaBack(true);
    setObAiLine(null);
    setObCardMessage(null);
    setObPendingConfirm(null);
    setObEmoOverride(prevId === "avatar" && obEcho.nameOdd ? "wry" : null);
    setObContinueHint(false);
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
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const baseScale = Math.max(AVATAR_CROP_STAGE / img.width, AVATAR_CROP_STAGE / img.height);
      setObCrop(
        clampCropState({
          url,
          fileName: file.name,
          naturalW: img.width,
          naturalH: img.height,
          baseScale,
          zoom: 1,
          x: 0,
          y: 0,
        })
      );
      setObEmoOverride(obEcho.nameOdd ? "wry" : "spark");
      setObAiLine("这张我先拿来量一下,你框住最想放在卡上的部分就好。");
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }
  function obCropDown(e) {
    if (!obCrop) return;
    obCropDragRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: obCrop.x, y: obCrop.y };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function obCropMove(e) {
    const d = obCropDragRef.current;
    if (!d || d.id !== e.pointerId) return;
    setObCrop((c) => clampCropState({ ...c, x: d.x + e.clientX - d.sx, y: d.y + e.clientY - d.sy }));
  }
  function obCropUp(e) {
    if (obCropDragRef.current && obCropDragRef.current.id === e.pointerId) obCropDragRef.current = null;
  }
  function obCropZoom(e) {
    const zoom = Number(e.target.value) || 1;
    setObCrop((c) => clampCropState({ ...c, zoom }));
  }
  function obCancelCrop() {
    setObCrop(null);
    setObAiLine("没关系,头像随时能换。");
  }
  function obUseCrop() {
    const img = obCropImgRef.current;
    if (!img || !obCrop) return;
    const c = document.createElement("canvas");
    c.width = AVATAR_OUT;
    c.height = AVATAR_OUT;
    const ctx = c.getContext("2d");
    const factor = AVATAR_OUT / AVATAR_CROP_STAGE;
    const scale = obCrop.baseScale * obCrop.zoom * factor;
    const dw = obCrop.naturalW * scale;
    const dh = obCrop.naturalH * scale;
    const dx = AVATAR_OUT / 2 - dw / 2 + obCrop.x * factor;
    const dy = AVATAR_OUT / 2 - dh / 2 + obCrop.y * factor;
    ctx.fillStyle = "#efe4cd";
    ctx.fillRect(0, 0, AVATAR_OUT, AVATAR_OUT);
    ctx.drawImage(img, dx, dy, dw, dh);
    const url = c.toDataURL("image/jpeg", 0.86);
    setObCardAvatar(url);
    const echo = { ...obEcho, avatar: url };
    setObEcho(echo);
    persistEcho(echo);
    setObCrop(null);
    setObEmoOverride(obEcho.nameOdd ? "wry" : "spark");
    setObAiLine("诶,这张好看——给你嵌卡上了。");
    if (obLineTimerRef.current) clearTimeout(obLineTimerRef.current);
    obLineTimerRef.current = setTimeout(() => {
      if (obStepRef.current === "avatar") {
        setObAiLine("头像妥了。点一下「好了,继续」,我再给你补最后一行。");
      }
    }, 1500);
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

  function renderSwitchOption(entry) {
    const option = entry.content;
    if (option.kind === "tangmu") {
      return (
        <button type="button" className="home-switch-item" onClick={pickTangmu}>
          <span className="home-switch-av" style={{ backgroundImage: `url("${TANGMU_IMG}")` }} />
          <span className="t-ui-sm">糖沐 · 看板娘(默认)</span>
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

  const obRenderChips = obInterruptFailure
    ? [
        { label: "再试一次", retryInterrupt: true },
        { label: "继续看创作", continueAfterInterrupt: true },
      ]
    : obPendingConfirm
    ? [
        { label: `就写「${obPendingConfirm.value}」`, confirmName: true },
        { label: "我换一个", retryName: true },
      ]
    : (obBeat && obBeat.chips) || [];
  const cropImgStyle = obCrop
    ? {
        width: Math.round(obCrop.naturalW * obCrop.baseScale * obCrop.zoom),
        height: Math.round(obCrop.naturalH * obCrop.baseScale * obCrop.zoom),
        transform: `translate(calc(-50% + ${Math.round(obCrop.x)}px), calc(-50% + ${Math.round(obCrop.y)}px))`,
      }
    : null;
  const chatFlowFallback = obChatBubblePos?.flowFallback ? obChatBubblePos : null;
  const chatFlowStyle = chatFlowFallback
    ? {
        "--ob-chat-flow-band-height": `${chatFlowFallback.bubbleBand.height}px`,
        "--ob-chat-flow-stage-left": `${chatFlowFallback.characterStage.left}px`,
        "--ob-chat-flow-stage-top": `${chatFlowFallback.characterStage.top}px`,
        "--ob-chat-flow-stage-width": `${chatFlowFallback.characterStage.width}px`,
        "--ob-chat-flow-stage-height": `${chatFlowFallback.characterStage.height}px`,
      }
    : undefined;

  return (
    <div
      className={
        "home" +
        (fullscreen ? " is-fullscreen" : "") +
        (obBeat && obBeat.showCard ? " is-cardbeat" : "") +
        (obBeat && obBeat.speaker ? ` is-ob-speaker-${obBeat.speaker}` : "") +
        (obBeat && obBeat.speaker === "糖沐" ? " is-ob-speaker-tangmu" : "") +
        (obBeat && obBeat.speaker === "宣" ? " is-ob-speaker-xuan" : "") +
        (obBeat && obBeat.centerBubble ? " is-ob-finale" : "") +
        (!obActive ? " is-home-mode" : "") +
        (obActive && obScene ? ` is-ob-scene-${obScene}` : "") +
        (obChatBubblePos && obChatBubblePos.compact ? " is-ob-chat-compact" : "") +
        (chatFlowFallback ? " is-ob-chat-flow-fallback" : "") +
        (obDemo ? ` is-ob-demo is-ob-demo-${obDemo.type}` : "")
      }
      style={chatFlowStyle}
    >
      {/* 背景层:onboarding 分场景交叉淡入淡出(视觉小说式换背景);非引导态与吧台拍用底图 background.png。 */}
      {Object.entries(SCENES).map(([scene, url]) => (
        <div
          key={scene}
          className={"home-bg" + (obBgScene === scene ? " is-active" : "")}
          style={{ backgroundImage: `url("${url}")` }}
          aria-hidden="true"
        />
      ))}
      <div className="home-bg-scrim" aria-hidden="true" />

      {/* 立绘层:双层交叉溶解(纯 CSS opacity 过渡)。两层常驻,换图放到非当前层再切换当前层,
          新层淡入、旧层淡出。永远只 2 层,任意切换频率都不堆积、不透明。 */}
      <div className={"home-portrait" + (obSceneShift ? " is-scene-shift" : "")}>
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
          <span className="home-portrait-ph t-kai">{Array.from(displayName).slice(0, 2).join("")}</span>
        )}
        {/* 普通拍气泡跟随糖沐立绘；chat 拍改在 .home-ui 前景层渲染。 */}
        {(obBeat || (introFrame && introFrame.line)) && !(obDemo && obDemo.type === "chat") && (
          <StageSpeechBubble
            key={obBeat ? "b-" + obBeat.id + (obViaBack ? "-back" : "") : "i-" + obIntro}
            speaker={(obBeat && obBeat.speaker) || "糖沐"}
            line={obLine}
            busy={obThinking}
            onSkip={obBeat ? () => endOnboarding() : null}
            onBack={obBeat && obHistory.length && !obThinking ? obBack : null}
            style={
              obBubblePos &&
              !(obBeat && obBeat.centerBubble)
                ? { left: obBubblePos.left, top: obBubblePos.top, right: "auto", bottom: "auto", transform: "translate(-100%, -50%)" }
                : undefined
            }
          />
        )}
        {!obActive && !fullscreen && (
          <StageSpeechBubble
            key={`home-${displayName}`}
            speaker={displayName}
            line={currentLine}
            busy={busy}
            animateLine={false}
            className="home-ob-bubble--home"
            tools={
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
            }
            style={
              obBubblePos
                ? { left: obBubblePos.left, top: obBubblePos.top, right: "auto", bottom: "auto", transform: "translate(-100%, -50%)" }
                : undefined
            }
          />
        )}
      </div>

      {/* 入场演出:点屏任意处加速推进当前帧(VN 式 tap-to-advance);只在入场存在。
          入场态无其它可交互元素,整屏捕获层置顶不抢占任何点击。 */}
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
          aria-label="继续新手引导"
          autoFocus
        />
      )}
      {/* 入场点击推进:太久没点冒出"点击继续"提示(闪烁),引导玩家点屏。 */}
      {introFrame && showIntroHint && (
        <div className="home-ob-clickhint t-meta" aria-hidden="true">点击继续 ▾</div>
      )}

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
          {/* 台词气泡已移进 .home-portrait(跟立绘一起滑,见上)。 */}
          {/* 身份卡:登记段(showCard)常驻画面角、随回声逐行成形;cardDone 拍落章办好(寄语+上传+翻面)。 */}
          {obBeat && obBeat.showCard && (
            <div className={"home-ob-card" + (obBeat.card ? " is-done" : " is-forming")}>
              <IdentityCard
                name={obEcho.name}
                taste={obEcho.taste}
                message={obBeat.card ? obCardMessage : null}
                avatar={obCardAvatar || obEcho.avatar}
                issuedAt={todayYmd()}
                forming={!obBeat.card}
              />
              {/* 隐藏 file input:只要在卡拍(showCard,含头像拍)就渲染。原来挂在 obBeat.card(只 cardDone)上,
                  头像前置到「头像拍」后那拍非 card,ref 为 null → 上传按钮点了没反应。 */}
              <input ref={obAvatarInputRef} type="file" accept="image/*" onChange={obAvatarChange} hidden />
            </div>
          )}
          {/* 竖屏登记拍:Q版糖沐前景角色(随状态换姿势 obSdSrc:SD3 指卡 / SD4 搞笑名字反应 / SD2 写卡)。
              桌面 CSS 隐藏,只在 ≤720px/竖屏 is-cardbeat 显示;放在 .home-ui、z 在身份卡之上、右侧、脚踩气泡顶(bottom 自适应)。
              SD2 是横版写字姿势,加 is-write 单独排布。 */}
          {obBeat && obBeat.showCard && (
            <img
              className={"home-ob-sd" + (obSdWriting ? " is-write" : "")}
              src={obSdSrc}
              alt=""
              aria-hidden="true"
              draggable="false"
              style={obSdBottom != null ? { bottom: obSdBottom } : undefined}
            />
          )}
          {obDemo && (
            <OnboardingDemo
              beat={obBeat}
              echo={obEcho}
              value={obInput}
              busy={obThinking}
              inputRef={obInputRef}
              onChange={(event) => setObInput(event.target.value)}
              onSubmit={obFieldSubmit}
            />
          )}
          {obBeat && obDemo && obDemo.type === "chat" && (
            <StageSpeechBubble
              key={"chat-" + obBeat.id + (obViaBack ? "-back" : "")}
              speaker={obBeat.speaker || "糖沐"}
              line={obLine}
              busy={obThinking}
              onSkip={() => endOnboarding()}
              className={"home-ob-bubble--chat " + (obBeat.speaker === "宣" ? "is-xuan" : "is-tangmu") + (obBeat.id === "tryChatTalk" ? " is-after-entrance" : "")}
              style={obChatBubblePos ? { left: obChatBubblePos.left, top: obChatBubblePos.top, width: obChatBubblePos.width } : undefined}
            />
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
                {/* 输入框:field 拍=回答登记(走 AI 辨别),导览/办卡/可打断自动拍 + 创作拍=跟当前角色说话(玩家可问更细的)。 */}
                <div className="home-composer">
                  <input
                    ref={obInputRef}
                    className="home-input"
                    value={obInput}
                    disabled={obThinking}
                    placeholder={
                      obThinking
                        ? obThinkingLine
                        : obBeat.field === "name"
                        ? "输入你的称呼…"
                        : obBeat.field === "taste"
                        ? "随口说说…"
                        : obBeat.placeholder
                        ? obBeat.placeholder
                        : `想跟${obReplySpeaker}说点什么…`
                    }
                    onChange={(e) => setObInput(e.target.value)}
                    onFocus={() => setObComposerFocused(true)}
                    onBlur={() => setObComposerFocused(false)}
                    onKeyDown={(e) => {
                      // 输入法守卫:必须读原生事件的 isComposing —— React 合成事件不暴露 isComposing,
                      // 写 !e.isComposing 恒为 true(等于没守卫),中文 composing 中按 Enter 选词会误提交拼音。
                      // 与全站其它输入框(Chat/Create/Login/Story/OnboardingCreateProjection)统一用 (e.nativeEvent||e).isComposing。
                      if (e.key === "Enter" && !(e.nativeEvent || e).isComposing) {
                        e.preventDefault();
                        if (obBeat.field) obFieldSubmit();
                        else obChatSubmit();
                      }
                    }}
                  />
                  <Button variant="primary" onClick={() => (obBeat.field ? obFieldSubmit() : obChatSubmit())} disabled={!obInput.trim() || obThinking}>
                    {obThinking ? "…" : obBeat.submitLabel || (obBeat.field ? "好" : "说")}
                  </Button>
                </div>
                {/* chips 槽常驻:没选项也占位,避免输入框往下沉(#8) */}
                <div className="home-ob-chips">
                    {(!obBeat.autoNext || obInterruptFailure) && obRenderChips.map((c, i) => {
                      // 头像拍的 chip 显示文案在此覆写(label 本身留作 onboardingLogic 的身份键,勿改):
                      //   未选头像:上传 chip→「我自己传一张」/ 另一颗→「我帮你选一张」(点后贴糖沐 Q 版默认头像);
                      //   已有头像后:上传→换一张 / 另一颗→好了,继续。
                      let label = c.label;
                      if (obBeat.id === "avatar") {
                        if (obCardAvatar || obEcho.avatar) label = c.upload ? "换一张" : "好了,继续";
                        else label = c.upload ? "我自己传一张" : "你帮我选一张";
                      }
                      return (
                        <button key={i} className={"home-ob-chip" + (obContinueHint && i === 0 ? " is-hinted" : "")} onClick={() => obChip(c)} disabled={obThinking}>
                          {label}
                        </button>
                      );
                    })}
                    {obContinueHint && <span className="home-ob-nexthint t-meta">点一下继续</span>}
                  </div>
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

                <div className="home-ob-tray home-home-tray">
                  <div className="home-composer">
                    <input
                      className="home-input"
                      value={input}
                      disabled={busy || !card}
                      placeholder={busy ? `${displayName}正在思考...` : card ? "和 " + displayName + " 说点什么…" : "正在把糖沐请出来…"}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        // 同上:读原生 isComposing,React 合成事件不暴露该字段(!e.isComposing 恒真 = 没守卫)。
                        if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent || e).isComposing && !busy) {
                          e.preventDefault();
                          send();
                        }
                      }}
                    />
                    <Button variant="primary" onClick={send} disabled={busy || !input.trim() || !card}>
                      {busy ? "..." : "发送"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {obCrop && (
        <div className="home-crop-modal" onClick={obCancelCrop}>
          <div className="home-crop-card" onClick={(e) => e.stopPropagation()}>
            <div className="home-crop-head">
              <div>
                <h2 className="t-h2">框选头像</h2>
                <p className="t-meta">拖动画面,把要放进卡面的部分留在方框里。</p>
              </div>
              <button className="home-modal-x" onClick={obCancelCrop} aria-label="取消头像裁剪">×</button>
            </div>
            <div
              className="home-crop-stage"
              onPointerDown={obCropDown}
              onPointerMove={obCropMove}
              onPointerUp={obCropUp}
              onPointerCancel={obCropUp}
            >
              <img ref={obCropImgRef} src={obCrop.url} alt="" draggable="false" style={cropImgStyle} />
              <div className="home-crop-mask" aria-hidden="true" />
            </div>
            <label className="home-crop-zoom t-meta">
              缩放
              <input type="range" min="1" max="3" step="0.01" value={obCrop.zoom} onChange={obCropZoom} />
            </label>
            <div className="home-crop-actions">
              <Button variant="line" onClick={obCancelCrop}>先不传</Button>
              <Button variant="primary" onClick={obUseCrop}>使用这块</Button>
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
