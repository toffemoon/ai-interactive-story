import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "../lib/transitionNav";
import { Button } from "../components/ui";
import { postJSON, getJSON, uploadFile } from "../lib/api";
import { fileToCompressedDataURL } from "../lib/image";
import ImageCropField from "../components/ImageCropField";
import StoryHero from "../components/StoryHero";
import CharDetailModal from "../components/CharDetailModal";
import StaggeredText from "../components/staggered-text";
import DepthCard from "../components/react-bits/depth-card"; // C4 本台架 mini 卡(画布本体不倾斜)
import { BlurHighlight } from "../components/react-bits/blur-highlight";
import { parseJsonCard, parsePngCard } from "../lib/tavernCard"; // D2 酒馆卡纯前端解析
import { TEMPLATES, getTpl } from "./createTemplates"; // D3 创作模板(文案归内容侧,来源 card-templates/)
import { loadPrompts, addPrompt, removePrompt } from "../lib/promptLib"; // F1 提示词库(localStorage)
import { cardToRefText, makeRef } from "../lib/refText"; // F2 卡→引用文本(refs 通道)
import { useAuth } from "../state/auth";
import "./Create.css";

// 角色卡的用户上传图(头像/立绘)单独保住,别被 AI 重建 draft 覆盖掉。
function pickPics(d) {
  const out = {};
  if (d && d.avatar) out.avatar = d.avatar;
  if (d && d.image) out.image = d.image;
  return out;
}

// 手机断点:≤860 走单列定高布局(.ct),≥861 保持桌面两栏(对话 | 实时卡)。
// 与 Create.css 的两栏断点一致(B8 并回 /test 原型,见 2026-06-30 handoff)。
function useIsMobile(maxWidth = 860) {
  const [m, setM] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(`(max-width: ${maxWidth}px)`).matches
      : false
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const update = () => setM(mq.matches); // setM 同值不会触发重渲
    update();
    // change 事件足够;另挂 resize 兜底(部分环境 / 视口模拟下 matchMedia change 不触发)
    mq.addEventListener ? mq.addEventListener("change", update) : mq.addListener(update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener ? mq.removeEventListener("change", update) : mq.removeListener(update);
      window.removeEventListener("resize", update);
    };
  }, [maxWidth]);
  return m;
}

// 创作 · 对话式建卡(契约固定只 reskin:/api/build_card、/api/identify*、/api/library/save、/api/presets)。
// 去中二英文(YOR-51):卡分类去英文副标、AI 助手不叫「执笔人/坊」、标题不叫「创作桌/The Atelier」。
const KINDS = [
  // ph 是输入框 placeholder,手机端短一句即可(C3:原来一长串字段名在窄屏会被截断)。
  // opening 是空台子的助手开场白,和 ph 同一套按类分句的范式(YOR-174)。
  { zh: "角色卡", k: "characters", ph: "说说这个角色……", opening: "想造谁?说一个画面、一句话都行——聊着聊着,人就立起来了。" },
  { zh: "演出卡", k: "players", ph: "说说你要扮演的主角……", opening: "想亲自扮演谁?说说主角的身份、来历,一句话也行——聊着聊着,卡就长出来了。" },
  { zh: "设定卡 · 世界书", k: "worlds", ph: "说说这个世界 / 设定……", opening: "想搭什么样的世界?一条规则、一个地名都能起头——聊着聊着,世界就有了轮廓。" },
  { zh: "故事书", k: "stories", ph: "说说这个故事……", opening: "想讲什么样的故事?一个开头、一句梗概都行——聊着聊着,书就翻开了。" },
];
const OPENINGS = Object.fromEntries(KINDS.map((t) => [t.k, t.opening]));
// 空台引子(桌面 reskin):点一下把句子放进输入框(不代发,用户过目再发),降低冷启动门槛。
const SUGGESTS = {
  characters: ["雨夜书店里打工的银发少女", "满口谎话却心软的江湖骗子", "不会说谎的未来管家机器人"],
  players: ["刚穿越过来的现代医学生", "隐姓埋名的前朝剑客", "星舰上唯一清醒的副驾驶"],
  worlds: ["灵气复苏后的沿海小城", "漂浮在云海上的九座岛", "地下铁尽头的隐秘市集"],
  stories: ["雪夜密室里的一场告别", "世界三天后重启,只有你记得", "茶馆里一纸换命的旧约"],
};
const IDENTIFY_EP = {
  characters: "/api/identify",
  worlds: "/api/identify_world",
  stories: "/api/identify_story",
  players: "/api/identify_player",
};
const LABELS = {
  description: "简述", personality: "性格", scenario: "情境设定", first_mes: "开场白",
  mes_example: "对话示例", speech_rules: "说话规则", appearance: "外貌", look: "外貌",
  persona: "人设", goals: "目标", secret: "隐藏真相", background: "背景", voice: "口癖",
  premise: "前提", title: "标题", entries: "条目", role: "身份", tags: "标签",
  content: "内容", comment: "条目", keys: "关键词", source: "来源",
  timeline: "时间线", events: "事件节点", main: "主线", anchor: "锚点", tension: "矛盾",
  // C5 补:引擎新骨架带的键,别再裸奔英文
  known_public: "公开设定", known_hidden: "隐藏设定", versions: "多版本", relationships: "关系",
};
const STORE_KEY = "ais_create_desks_v1";
const KI_KEY = "ais_create_ki_v1"; // 记住当前卡种 tab(YOR-200)
// 这些 key 不当文本字段渲染:name/title 已在卡名展示;avatar/image/cover 是图(base64 data-URI),
// 只走缩略图,别把 base64 大串当普通字段铺进预览(#92 上传图后的回归)。
const NON_FIELD_KEYS = ["name", "character_id", "id", "title", "avatar", "image", "cover"];

// 把任意卡字段值渲染成可读文本。根治世界书 entries / 故事书 timeline 这类"对象数组"
// 被 v.join("、") 渲染成「[object Object]、[object Object]…」的 bug(细节⑤)。
function fmtVal(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return "";
    if (v.every((x) => typeof x === "string" || typeof x === "number")) return v.join("、");
    const lines = v.slice(0, 8).map((x, i) => {
      if (x && typeof x === "object") {
        const label =
          x.comment || (Array.isArray(x.keys) ? x.keys.join("/") : x.keys) || x.name || x.title || `条目${i + 1}`;
        const body = x.content || x.description || x.summary || "";
        return body ? `${label}:${body}` : String(label);
      }
      return String(x);
    });
    if (v.length > 8) lines.push(`…(共 ${v.length} 条)`);
    return lines.join("\n");
  }
  if (typeof v === "object") {
    return Object.entries(v)
      .map(([k, val]) => `${LABELS[k] || k}:${typeof val === "string" ? val : Array.isArray(val) ? val.join("、") : JSON.stringify(val)}`)
      .join("；");
  }
  return String(v);
}

// 取世界书条目数组(设定卡 / 世界书查看用);非世界书返回 null。
function worldEntries(card) {
  const c = (card && card.data) || card || {};
  return Array.isArray(c.entries) ? c.entries : null;
}

function blankDesk(kk) {
  return {
    messages: [{ who: "ai", text: OPENINGS[kk] || "想造哪张卡?说一个画面、一句话都行——聊着聊着,卡就长出来了。" }],
    draft: {},
    filled: [],
    input: "",
    built: [],
  };
}
function loadDesks() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (s && s.characters && s.players && s.worlds && s.stories) return s;
  } catch (e) {}
  return { characters: blankDesk("characters"), players: blankDesk("players"), worlds: blankDesk("worlds"), stories: blankDesk("stories") };
}
function wrapCard(data) {
  return { spec: "chara_card_v2", spec_version: "2.0", data: { ...data, speech_rules: data.speech_rules || [], tags: data.tags || [] } };
}
function mergeWorldBooks(worldBooks) {
  if (!worldBooks.length) return null;
  return {
    name: "世界书合集",
    entries: worldBooks.flatMap((w, wi) =>
      (w.entries || []).map((e, ei) => ({ ...e, entry_id: e.entry_id || `world-${wi}-${ei}`, source: e.source || "world" }))
    ),
  };
}

export default function Create() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [ki, setKi] = useState(() => {
    // 记住上次的卡种 tab:刷新 / 切走再回来不重置回角色卡(YOR-200)。
    try {
      const n = parseInt(localStorage.getItem(KI_KEY) || "", 10);
      return Number.isInteger(n) && n >= 0 && n < KINDS.length ? n : 0;
    } catch (e) {
      return 0;
    }
  });
  const [desks, setDesks] = useState(loadDesks);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [toastGo, setToastGo] = useState(null); // toast 可选去处(YOR-170:发布成功带「去看看」)
  const [libModal, setLibModal] = useState(null); // {items} | null
  const [libQ, setLibQ] = useState(""); // 补素材搜索
  const [builtView, setBuiltView] = useState(false); // 查看本台已建的卡(细节③)
  const [finalize, setFinalize] = useState(null); // 「完善角色卡」弹窗:null | {action:'desk'|'lib'}(收进本台 / 收入卡库)
  const [genBusy, setGenBusy] = useState(false); // 自动生成角色介绍中
  const [savingCard, setSavingCard] = useState(false); // 收入卡库中(防重入 + 等待态,YOR-183)
  const [pub, setPub] = useState({ name: "", synopsis: "", cover: "", authorNote: "" });
  const [previewOpen, setPreviewOpen] = useState(false); // 「预览并发布」覆盖层(改文字 / 传封面 / 就地发布)
  const [previewChar, setPreviewChar] = useState(null); // 预览里角色「查看详情」
  const [cardExpanded, setCardExpanded] = useState(false); // 手机草稿细条展开看立绘 + 全部字段
  const [moreOpen, setMoreOpen] = useState(false); // 手机底部「更多」动作面板
  // C1 字段块就地手改(桌面画布):editingKey = 字段原始 key | "__name"(卡名) | null。
  const [editingKey, setEditingKey] = useState(null);
  const [editVal, setEditVal] = useState("");
  const dockInputRef = useRef(null); // 命令条输入框(「聊着改」把光标带过去)
  // D1 参考资料:desks[kind].seed(可选键,兼容扩展)。弹窗内编辑用本地 seedText,确认才 patch。
  const [seedOpen, setSeedOpen] = useState(false);
  const [seedText, setSeedText] = useState("");
  // D2 导入面板:null | { step: "pick"|"paste", text, err, hint }。酒馆解析是同步的,不需要独立 step。
  // F5:hint = 用户对解析口味的指示(可选,identify 的 hint 通道);面板点「上传文档」会先关面板再弹文件框,
  // hint 经 uploadHintRef 递给 onUpload(命令条直传时 ref 为空 = 无指示,旧行为)。
  const [importOpen, setImportOpen] = useState(null);
  const uploadHintRef = useRef("");
  const tavernRef = useRef(null); // 酒馆卡文件 input(.json/.png)
  // D3 模板选择器;desks[kind].tpl 只存模板 id(hints 从常量派生,localStorage 零膨胀)。
  const [tplOpen, setTplOpen] = useState(false);
  // D4 「从我发布的故事继续」:presets 列表弹层({items}|null),选一条拆回四台 built。
  const [presetsModal, setPresetsModal] = useState(null);
  // F2 引用体系:desks[kind].refs 可选键(挂台常驻,每轮请求都带,纸签可摘;后端上限 4 条)。
  // 面板 tab:desk=桌上的卡(四台 built+draft) / lib=我的卡库(四 kind 可切) / prompt=提示词库。
  const [refPanel, setRefPanel] = useState(null); // null | {tab, kk, items, loading, err}
  const [prompts, setPrompts] = useState(loadPrompts);
  const [promptDraft, setPromptDraft] = useState(""); // 「存为提示词」输入(提示词 tab 内)
  const [refDragOver, setRefDragOver] = useState(false); // F4 拖拽接收态(命令条区)
  // F3 一键 AI 长出指示行:askOpen = 字段 k0 | null(✦/⟳ 点开,可空回车=默认指令)。
  const [askOpen, setAskOpen] = useState(null);
  const [askText, setAskText] = useState("");
  const [bpNote, setBpNote] = useState(""); // 蓝图批准附言(可空)
  const [introAsk, setIntroAsk] = useState(""); // 自动生成角色介绍的口味指示(可空)
  const fileRef = useRef(null);
  const coverRef = useRef(null);
  const chatRef = useRef(null);
  const toastT = useRef(null);
  const quotaWarnedRef = useRef(false); // 草稿写盘失败(配额)只提醒一次,写成功后复位
  const savingRef = useRef(false); // 入库同步锁:状态是异步的,同一 tick 连点会读到旧值,用 ref 同步挡(YOR-183)

  const kind = KINDS[ki].k;
  const desk = desks[kind];

  // 草稿持久化:desks 变化即落 localStorage(草稿自动保存,刷新不丢)。
  // 写失败(多为立绘 base64 把草稿撑过 localStorage 配额)不再静默吞:否则刷新丢草稿且用户无感知。
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(desks));
      quotaWarnedRef.current = false;
    } catch (e) {
      if (!quotaWarnedRef.current) {
        quotaWarnedRef.current = true;
        flash("草稿太大(多为立绘图片)没能自动保存,刷新可能丢失;先少放几张图,或尽快发布 / 收进卡库。");
      }
    }
  }, [desks]);

  // 记住当前卡种 tab(YOR-200):切走 / 刷新再回来续上,不重置回角色卡。
  useEffect(() => {
    try {
      localStorage.setItem(KI_KEY, String(ki));
    } catch (e) {}
  }, [ki]);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [desk.messages, busy]);

  // go = 可选去处路由:带去处的 toast 多留一会儿,不然来不及点(YOR-170)
  function flash(msg, go = null) {
    setToast(msg);
    setToastGo(go);
    if (toastT.current) clearTimeout(toastT.current);
    toastT.current = setTimeout(() => {
      setToast("");
      setToastGo(null);
    }, go ? 4500 : 2200);
  }
  const patch = (kk, p) =>
    setDesks((ds) => ({ ...ds, [kk]: { ...ds[kk], ...(typeof p === "function" ? p(ds[kk]) : p) } }));

  // 发一句话进建卡管线(命令条 send 与字段级指令共用;messages/draft 契约不动)。
  // filled 改为客户端 diff:如实标出这一轮实际变化的字段(C3 坦白原则——模型可能顺手动别处,全部显形)。
  // E2 完整度门控:台子的创作阶段(desks[kind].phase 可选键)。
  // 兼容规则:显式 phase 优先;老数据无 phase → 有草稿或已聊开(消息>1)视为 drafting(别把进行中的老会话拽回门控),
  // 全新空台才进 understand(构思:只问不写,后端硬门槛)。
  function deskPhase(d) {
    if (d.phase) return d.phase;
    if (Object.keys(d.draft || {}).length) return "drafting";
    return d.messages.length <= 1 ? "understand" : "drafting";
  }
  const phase = deskPhase(desk);
  const COMP_THRESHOLD = 60;

  // E3 问题作答(本地态,题目换了就清;答案不进 desks——提交后化成一条用户消息即是历史)。
  const [quizAns, setQuizAns] = useState({});
  const [quizFree, setQuizFree] = useState({});
  useEffect(() => {
    setQuizAns({});
    setQuizFree({});
  }, [desk.questions, kind]);
  // F2/F3 局部态跟台走:切卡种清指示行/附言/面板(引用纸签本身在 desks 里,各台各留各的)。
  useEffect(() => {
    setAskOpen(null);
    setAskText("");
    setBpNote("");
    setRefPanel(null);
  }, [kind]);

  // ── F2 引用体系:挂台纸签(desks[kind].refs 可选键,后端 refs 通道上限 4 条) ──
  const deskRefs = Array.isArray(desk.refs) ? desk.refs : [];
  function addRef(r) {
    if (!r || !r.text) return;
    const cur = Array.isArray(desks[kind].refs) ? desks[kind].refs : [];
    if (cur.some((x) => x.label === r.label)) {
      flash("「" + r.label + "」已经挂着了");
      return;
    }
    if (cur.length >= 4) {
      flash("最多同时引用 4 个(再挂先摘一个)");
      return;
    }
    patch(kind, { refs: [...cur, r] });
    setRefPanel(null);
    flash("已引用「" + r.label + "」——之后每轮 AI 都会参考,随时可摘");
  }
  function removeRef(label) {
    patch(kind, (d0) => ({ refs: (Array.isArray(d0.refs) ? d0.refs : []).filter((x) => x.label !== label) }));
  }
  function refFromCard(kk, card) {
    const c = (card && card.data) || card || {};
    const nm = c.name || c.title || "未命名";
    const zh = (KINDS.find((t) => t.k === kk) || {}).zh || "卡";
    return makeRef("card", zh + "·" + nm, cardToRefText(kk, c));
  }
  async function openRefPanel(tab = "desk", kk = kind) {
    if (tab === "lib") {
      setRefPanel({ tab, kk, items: [], loading: true });
      try {
        const items = await getJSON("/api/library/" + kk);
        setRefPanel((p) => (p && p.tab === "lib" ? { ...p, kk, items: Array.isArray(items) ? items : [], loading: false } : p));
      } catch (e) {
        setRefPanel((p) => (p && p.tab === "lib" ? { ...p, loading: false, err: "读库失败:" + e.message } : p));
      }
    } else {
      setRefPanel({ tab, kk, items: [], loading: false });
    }
  }
  function quizAnswerOf(qu) {
    return (quizFree[qu.id] || "").trim() || quizAns[qu.id] || "";
  }
  function submitQuiz() {
    const lines = (desk.questions || [])
      .map((qu) => {
        const a = quizAnswerOf(qu);
        return a ? `${qu.label} —— ${a}` : null;
      })
      .filter(Boolean);
    if (!lines.length) return;
    sendText(lines.join("\n"));
  }
  // E4 蓝图批准:切 drafting + 让 AI 按蓝图一次落笔(此后回到既有创作行为)。
  // F3:批准可带一句附言(落笔前最后的口味要求),可空。
  function approveBlueprint() {
    const bp = desk.blueprint || [];
    const note = (bpNote || "").trim();
    setBpNote("");
    patch(kind, { phase: "drafting" });
    sendText(
      "就按这份蓝图开始写卡,把已经聊清的内容一次填进字段,别再反问:\n" +
        bp.map((b) => "- " + b).join("\n") +
        (note ? `\n落笔时额外注意(用户附言,优先遵守):${note}` : ""),
      { phaseOverride: "drafting" }
    );
  }

  async function sendText(rawText, { clearInput = false, phaseOverride = null } = {}) {
    const kk = kind;
    const cur = desks[kk];
    const text = (rawText || "").trim();
    if (!text || busy) return;
    setBusy(true);
    const apiMsgs = [...cur.messages, { who: "你", text }].map((m) => ({
      role: m.who === "你" ? "user" : "assistant",
      content: m.text,
    }));
    patch(kk, (d0) => ({ messages: [...d0.messages, { who: "你", text }], ...(clearInput ? { input: "" } : {}) }));
    try {
      // D1:seed = 挂在台上的参考资料;E2:understand/blueprint 态带 phase=understand(后端只评分提问,硬不写卡)。
      // phaseOverride:批准蓝图那一发要立即按 drafting 走(setState 异步,闭包里的 desks 还是旧 phase)。
      const curPhase = phaseOverride || deskPhase(cur);
      const gated = curPhase === "understand" || curPhase === "blueprint";
      // F2:挂台引用随每轮走(后端独立标签段);旧后端 Pydantic 忽略未知字段,优雅降级。
      const refsPayload = (Array.isArray(cur.refs) ? cur.refs : []).map((x) => ({ label: x.label, text: x.text }));
      const r = await postJSON("/api/build_card", {
        kind: kk,
        messages: apiMsgs,
        draft: cur.draft,
        seed: cur.seed || "",
        ...(refsPayload.length ? { refs: refsPayload } : {}),
        ...(gated ? { phase: "understand", threshold: COMP_THRESHOLD } : {}),
      });
      if (r.phase === "understand") {
        // 构思轮:不动 draft(后端已回传 prev);存完整度/问题/蓝图;拿到蓝图即切待批态。
        patch(kk, (d0) => ({
          messages: [...d0.messages, { who: "ai", text: r.reply || "(这轮没接住——换个说法再说一次)" }],
          comp: r.completeness || 0,
          questions: r.questions || [],
          blueprint: r.blueprint || [],
          phase: (r.blueprint || []).length ? "blueprint" : "understand",
        }));
      } else {
        const ask = [r.reply, r.next_question].filter(Boolean).join(" ");
        patch(kk, (d0) => {
          const nextDraft = r.draft ? { ...r.draft, ...pickPics(d0.draft) } : d0.draft; // 保住已上传的头像/立绘
          const changed = r.draft
            ? Object.keys(nextDraft).filter(
                (k) => JSON.stringify(nextDraft[k]) !== JSON.stringify((d0.draft || {})[k])
              )
            : d0.filled;
          return {
            messages: [...d0.messages, { who: "ai", text: ask || "(这轮没接住——换个说法,或把内容分短一点再说一次)" }],
            draft: nextDraft,
            filled: changed,
            phase: "drafting",
          };
        });
      }
    } catch (e) {
      patch(kk, (d0) => ({ messages: [...d0.messages, { who: "ai", text: "(建卡出错:" + e.message + ")" }] }));
    } finally {
      setBusy(false);
    }
  }
  function send() {
    return sendText(desks[kind].input, { clearInput: true });
  }
  // C3 字段级 AI 动作:⟳ 改写 / ✦ 补写 = 合成定向指令走同一管线。
  // 「尽量别动其他字段」是 prompt 约定不是硬锁;实际动了哪些,filled diff 全部墨晕显形。
  // F3(AI 触点可控):extra = 用户在指示行写的口味要求,拼进指令;空=默认写法。
  function sendFieldDirective(f, mode, extra = "") {
    const base =
      mode === "fill"
        ? `请直接补写「${f.k}」(${f.k0}):按已有设定写出这一块的内容并填进 ${f.k0} 字段。不要反问、不要只解释,这一轮就把内容写出来。尽量别动其他字段。`
        : `请直接把「${f.k}」(${f.k0})改写得更具体、更立体,写回 ${f.k0} 字段。不要反问,这一轮就改完。尽量别动其他字段。`;
    const ex = (extra || "").trim();
    return sendText(ex ? base + `\n用户对这一块的要求(优先遵守):${ex}` : base);
  }
  // F3:点 ✦/⟳ 先展开指示行(可空回车=默认);再点同一颗收起。
  function toggleFieldAsk(f) {
    if (askOpen === f.k0) {
      setAskOpen(null);
      setAskText("");
    } else {
      setAskOpen(f.k0);
      setAskText("");
    }
  }
  function commitFieldAsk(f) {
    const mode = f.empty ? "fill" : "rewrite";
    const ex = askText;
    setAskOpen(null);
    setAskText("");
    return sendFieldDirective(f, mode, ex);
  }

  // D2 共享:把 identify 的返回铺上画布(上传/粘贴两路共用)。identify 副作用=后端已自动收进卡库,文案如实。
  function applyIdentified(out, kk) {
    const draft = kk === "characters" ? out.data || out : out;
    const nm = draft.name || draft.title || "未命名";
    patch(kk, (d0) => ({
      draft: { ...draft, ...pickPics(d0.draft) }, // 保住已上传的头像/立绘
      filled: Object.keys(draft),
      // E5 快速通道:已带内容,直通 drafting,清构思残留
      phase: "drafting", comp: 0, questions: [], blueprint: [],
      messages: [...d0.messages, { who: "ai", text: "《" + nm + "》解析好了,已铺上画布,顺手也收进了你的卡库(私密)。哪里不对,聊着改。" }],
    }));
    return nm;
  }
  // 导入会整卡替换画布草稿:有未收草稿先确认(镜像 removeBuilt 的破坏性确认范式)。
  function confirmReplaceDraft() {
    if (!hasDraft) return true;
    return window.confirm("画布上已有草稿《" + draftName + "》,导入会替换它(已收进本台 / 卡库的不受影响)。继续?");
  }

  // D4 改编:把一张已有卡 fork 成指定台的草稿。名字加「·改」——/api/library/save 按名 upsert,
  // 不改名会覆盖原卡;改编稿入库=另存新卡,原卡不动。
  function forkToDraft(item, kk = kind) {
    let card = (item && item.data) || item || {};
    if (card && card.data && typeof card.data === "object" && !Array.isArray(card.data)) card = card.data; // chara_card_v2 信封再剥一层
    if (!card || !Object.keys(card).length) {
      flash("这张卡读不出内容");
      return false;
    }
    const tgt = desks[kk];
    const tgtHas = Object.keys((tgt && tgt.draft) || {}).length > 0;
    if (tgtHas) {
      const tn = tgt.draft.name || (tgt.draft.data && tgt.draft.data.name) || tgt.draft.title || "未命名";
      if (!window.confirm(`「${KINDS.find((t) => t.k === kk).zh}」台上已有草稿《${tn}》,改编会替换它。继续?`)) return false;
    }
    const useTitle = "title" in card && !("name" in card);
    const base = card[useTitle ? "title" : "name"] || "未命名";
    const nm = /·改$/.test(base) ? base : base + "·改";
    patch(kk, (d0) => ({
      draft: { ...card, [useTitle ? "title" : "name"]: nm },
      filled: Object.keys(card),
      tpl: undefined,
      phase: "drafting", comp: 0, questions: [], blueprint: [], // E5 快速通道
      messages: [...d0.messages, { who: "ai", text: "《" + nm + "》已铺开——基于它改;原卡不动,入库时按新名字另存。" }],
    }));
    flash("已铺开改编稿《" + nm + "》");
    return true;
  }

  async function onUpload(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file || busy) return;
    const kk = kind;
    setBusy(true);
    patch(kk, (d0) => ({ messages: [...d0.messages, { who: "你", text: "(上传了《" + file.name + "》)" }] }));
    try {
      const text = await uploadFile(file);
      // F5:导入面板给的解析指示(hint);命令条直传时为空 = 旧行为
      const hint = (uploadHintRef.current || "").trim();
      uploadHintRef.current = "";
      const out = await postJSON(IDENTIFY_EP[kk], { text, ...(hint ? { hint } : {}) });
      applyIdentified(out, kk);
      flash("已解析并收入卡库");
    } catch (e) {
      patch(kk, (d0) => ({ messages: [...d0.messages, { who: "ai", text: "(解析失败:" + e.message + ")" }] }));
      flash("解析失败");
    } finally {
      setBusy(false);
    }
  }

  // D2 粘贴直通:文本直接调 identify(跳过 /api/upload,不占上传限流)。
  async function importPaste() {
    const t = ((importOpen && importOpen.text) || "").trim();
    if (!t || busy) return;
    if (!confirmReplaceDraft()) return;
    const kk = kind;
    setBusy(true);
    try {
      const hint = ((importOpen && importOpen.hint) || "").trim(); // F5 解析指示
      const out = await postJSON(IDENTIFY_EP[kk], { text: t, ...(hint ? { hint } : {}) });
      const nm = applyIdentified(out, kk);
      setImportOpen(null);
      flash("已解析《" + nm + "》并收入卡库");
    } catch (e) {
      setImportOpen((m) => (m ? { ...m, err: "解析失败:" + e.message } : m));
    } finally {
      setBusy(false);
    }
  }

  // D2 酒馆卡(.json / PNG 内嵌卡):纯前端解析直落 draft——零请求、零入库、不耗额度(与 identify 路径口径相反,UI 已写明)。
  async function onTavernFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const isJson = /\.json$/i.test(file.name);
      const parsed = isJson ? parseJsonCard(await file.text()) : parsePngCard(await file.arrayBuffer());
      if (!confirmReplaceDraft()) return;
      const nm = parsed.draft.name || "未命名";
      const droppedNote = parsed.dropped.length
        ? "有 " + parsed.dropped.length + " 个酒馆特有字段暂不支持,已略过:" +
          parsed.dropped.slice(0, 6).join("、") + (parsed.dropped.length > 6 ? "…" : "") + "。"
        : "";
      patch(kind, (d0) => ({
        draft: { ...parsed.draft, ...pickPics(d0.draft) },
        filled: Object.keys(parsed.draft),
        phase: "drafting", comp: 0, questions: [], blueprint: [], // E5 快速通道
        messages: [...d0.messages, { who: "ai", text: "《" + nm + "》从酒馆卡读进来了(本地解析,没入库、不耗额度)。" + droppedNote + "哪里不对,聊着改。" }],
      }));
      // PNG 本体顺手压成立绘(draft.image 空着才填,不覆盖用户已传的)
      if (!isJson) {
        try {
          const dataUrl = await fileToCompressedDataURL(file, { maxW: 768, maxH: 1152, quality: 0.82 });
          patch(kind, (d0) => (d0.draft.image ? {} : { draft: { ...d0.draft, image: dataUrl } }));
        } catch (e) {}
      }
      // 卡自带世界书 → 桥到 D1 参考资料(截 6000),AI 每轮可参考
      if (parsed.bookText && window.confirm("这张卡自带世界书条目(" + parsed.bookText.length + " 字)。挂为「参考资料」让 AI 每轮参考?(可随时清除)")) {
        patch(kind, { seed: parsed.bookText.slice(0, 6000) });
      }
      setImportOpen(null);
      flash("已导入《" + nm + "》(本地,未入库)");
    } catch (e) {
      setImportOpen((m) => (m ? { ...m, err: "导入失败:" + e.message } : { step: "pick", text: "", err: "导入失败:" + e.message }));
    }
  }

  // 角色卡 头像/立绘改在「完善角色卡」弹窗里用 ImageCropField(裁剪)上传 → 写进 draft.avatar/draft.image。

  // 发布封面上传(cover,后端按 data-URI 持久)。
  async function onCoverUpload(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await fileToCompressedDataURL(file, { maxW: 800, maxH: 1100, quality: 0.82 });
      setPub((p) => ({ ...p, cover: dataUrl }));
      flash("封面已设置");
    } catch (e) {
      flash("封面处理失败:" + e.message);
    }
  }

  // 真正收进本台(复用):把当前 draft 放进 built、台子重置、提示。
  function collectToDesk(cardDraft) {
    const nm = cardDraft.name || cardDraft.title || "未命名";
    setDesks((ds) => ({
      ...ds,
      [kind]: {
        ...blankDesk(kind),
        // D1:参考资料跨卡保留(一份资料常连造多张卡);tpl 不带 = 自然清(模板是单卡的事)。
        seed: ds[kind].seed || "",
        built: [...ds[kind].built, cardDraft],
        messages: [{ who: "ai", text: "《" + nm + "》放进台子了(本台第 " + (ds[kind].built.length + 1) + " 张)。说说下一张?" }],
      },
    }));
    setCardExpanded(false);
    flash("已收进本台(" + nm + ")");
  }

  function nextCard() {
    const cur = desks[kind];
    if (!cur.draft || !Object.keys(cur.draft).length) {
      flash("草稿还空着,先聊出一张再收");
      return;
    }
    // 角色卡:先弹「完善角色卡」(上传头像/立绘 + 角色介绍),确认后再收;其它卡直接收。
    if (kind === "characters") {
      setFinalize({ action: "desk" });
      return;
    }
    collectToDesk(cur.draft);
  }

  // 「完善角色卡」/ 详情预览里「自动生成」:调现有 build_card,按已填设定补一段角色介绍写进 description。
  // F3:introAsk = 用户对介绍的口味指示(可空);F2:挂台引用一并带上。
  async function genIntro() {
    if (genBusy) return;
    const cur = desks[kind];
    setGenBusy(true);
    try {
      const ex = (introAsk || "").trim();
      const apiMsgs = [
        {
          role: "user",
          content:
            "请根据已有设定,为这个角色写一段第三人称的「角色介绍」(外貌、性格、来历、当前处境,200 字以内),写进 description 字段。" +
            (ex ? `\n用户对这段介绍的要求(优先遵守):${ex}` : ""),
        },
      ];
      const refsPayload = (Array.isArray(cur.refs) ? cur.refs : []).map((x) => ({ label: x.label, text: x.text }));
      const r = await postJSON("/api/build_card", {
        kind, messages: apiMsgs, draft: cur.draft, seed: cur.seed || "",
        ...(refsPayload.length ? { refs: refsPayload } : {}),
      });
      if (r.draft) {
        patch(kind, (d0) => ({ draft: { ...r.draft, ...pickPics(d0.draft) }, filled: r.filled || Object.keys(r.draft) }));
      } else if (r.reply) {
        patch(kind, (d0) => ({ draft: { ...d0.draft, description: r.reply } }));
      }
      flash("角色介绍已生成");
    } catch (e) {
      flash("生成失败:" + e.message);
    } finally {
      setGenBusy(false);
    }
  }
  function removeBuilt(idx) {
    // 破坏性且不可撤销:收进本台时该卡的聊天记录已清,没另存卡库就找不回。先确认(镜像纯聊 ⟳ 范式,YOR-184)。
    const c = desks[kind].built[idx];
    const nm = (c && (c.name || c.title)) || "这张卡";
    if (!window.confirm("移除《" + nm + "》?它聊出来的对话已经清空,移除后找不回。确定?")) return;
    setDesks((ds) => ({ ...ds, [kind]: { ...ds[kind], built: ds[kind].built.filter((_, i) => i !== idx) } }));
    flash("已从本台移除");
  }
  // 取一张卡的可读字段(查看本台已建用)。
  function cardFields(card) {
    const c = (card && card.data) || card || {};
    return Object.keys(c)
      .filter((k) => !NON_FIELD_KEYS.includes(k))
      .map((k) => ({ k: LABELS[k] || k, v: fmtVal(c[k]) }))
      .filter((f) => f.v && f.v.trim());
  }

  // 真正入库(复用):收入卡库 · 私密。
  async function doSaveCard() {
    if (savingRef.current) return; // 防重入:同步锁,同一 tick 连点也只发一次 save(YOR-183)
    const d = desks[kind].draft || {};
    if (!Object.keys(d).length) {
      flash("还没有可入库的卡,先聊几句");
      return;
    }
    savingRef.current = true;
    setSavingCard(true);
    try {
      await postJSON("/api/library/save", { kind, data: kind === "characters" ? { data: d } : d });
      flash("已收入卡库 · 私密");
    } catch (e) {
      flash("入库失败:" + e.message);
    } finally {
      savingRef.current = false;
      setSavingCard(false);
    }
  }
  // 收入卡库入口:角色卡先走「完善角色卡」弹窗(可传图),其它卡直接入库。
  function saveCard() {
    const d = desk.draft || {};
    if (!Object.keys(d).length) {
      flash("还没有可入库的卡,先聊几句");
      return;
    }
    if (kind === "characters") {
      setFinalize({ action: "lib" });
      return;
    }
    doSaveCard();
  }
  // 「完善角色卡」弹窗确认:按触发来源执行 收进本台 / 收入卡库。
  function confirmFinalize() {
    if (!finalize) return;
    const action = finalize.action;
    setFinalize(null);
    if (action === "desk") collectToDesk(desks[kind].draft);
    else doSaveCard();
  }
  // 弹窗里改头像/立绘 → 写进当前 draft(空串=移除)。
  function setDraftPic(field, dataUrl) {
    patch(kind, (d0) => ({ draft: { ...d0.draft, [field]: dataUrl || "" } }));
  }
  // 弹窗里直接编辑角色介绍(description)。
  function setDraftDesc(text) {
    patch(kind, (d0) => ({ draft: { ...d0.draft, description: text } }));
  }

  // D5 导出:characters 套 chara_card_v2 信封(与酒馆 JSON 同构,可被 D2 导入原样吃回),
  // 其余卡种导裸 data;纯前端 Blob 下载,零请求。
  function exportCard(card, kk = kind) {
    const c = (card && card.data) || card || {};
    if (!Object.keys(c).length) {
      flash("还没有可导出的内容");
      return;
    }
    const obj = kk === "characters" ? wrapCard(c) : c;
    const nm = c.name || c.title || "未命名";
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nm + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    flash("已导出《" + nm + "》.json");
  }

  // D4 故事级拆回:/api/presets 列表已含完整卡组 data,选一条把四类卡追加回各台 built
  // (不清现有、不动原预设;发布时按新名字生成新预设,不碰权属)。
  async function openPresets() {
    try {
      const items = await getJSON("/api/presets");
      setPresetsModal({ items: Array.isArray(items) ? items : [] });
    } catch (e) {
      flash("读故事列表失败:" + e.message);
    }
  }
  function unpackPreset(p) {
    const d = (p && p.data) || {};
    const unwrap = (c) => (c && c.data) || c;
    const chars = (d.characters || []).map(unwrap).filter(Boolean);
    const players = ((d.playables && d.playables.length ? d.playables : d.player ? [d.player] : []) || []).map(unwrap).filter(Boolean);
    const worlds = d.world ? [d.world] : [];
    const stories = d.story ? [d.story] : [];
    setDesks((ds) => ({
      characters: { ...ds.characters, built: [...ds.characters.built, ...chars] },
      players: { ...ds.players, built: [...ds.players.built, ...players] },
      worlds: { ...ds.worlds, built: [...ds.worlds.built, ...worlds] },
      stories: { ...ds.stories, built: [...ds.stories.built, ...stories] },
    }));
    setPresetsModal(null);
    flash(`已把《${p.name}》拆回四台(角色×${chars.length} 演出×${players.length} 世界×${worlds.length} 故事×${stories.length});发布会生成新预设`);
  }

  // 素材复用:列我的库 → 搜索/挑一张推进对应台子的 built。
  async function openLib() {
    setMoreOpen(false);
    setLibQ("");
    try {
      const items = await getJSON("/api/library/" + kind);
      setLibModal({ items: Array.isArray(items) ? items : [] });
    } catch (e) {
      flash("读库失败:" + e.message);
    }
  }
  function libName(it) {
    const raw = (it && it.data && it.data.data) || (it && it.data) || {};
    return raw.name || raw.title || it.name || "未命名";
  }
  function libDesc(it) {
    const raw = (it && it.data && it.data.data) || (it && it.data) || {};
    return raw.persona || raw.description || raw.premise || ((raw.entries || []).length ? `${raw.entries.length} 条条目` : "");
  }
  function libAdd(item) {
    const raw = item && item.data ? item.data : item;
    const card = kind === "characters" ? raw.data || raw : raw;
    if (!card || !Object.keys(card).length) {
      flash("这张卡读不出内容");
      return;
    }
    setDesks((ds) => ({ ...ds, [kind]: { ...ds[kind], built: [...ds[kind].built, card] } }));
    setLibModal(null);
    flash("已加入本次创作");
  }

  const deskCards = (k) => {
    const d = desks[k];
    const cur = d.draft && Object.keys(d.draft).length ? [d.draft] : [];
    return [...d.built, ...cur];
  };

  // 组装当前创作 → 故事 preset 形状(给「预览成详情页」用,复用发布那套拼装;不落库、纯本地)。
  function buildPreviewPreset() {
    const chars = deskCards("characters"), worlds = deskCards("worlds"), stories = deskCards("stories"), players = deskCards("players");
    const st = stories.length ? stories[stories.length - 1] : null;
    const tags = [...new Set([...chars.flatMap((c) => c.tags || []), ...((st || {}).tags || [])])].filter(Boolean).slice(0, 5);
    const nm = pub.name.trim() || (draftName !== "未命名" ? draftName : "未命名故事");
    return {
      name: nm,
      data: {
        name: nm,
        synopsis: pub.synopsis.trim(),
        author: (user && (user.display_name || user.username)) || "",
        author_note: pub.authorNote.trim(),
        cover: pub.cover || "",
        tags,
        characters: chars.map(wrapCard),
        world: worlds.length ? mergeWorldBooks(worlds) : null,
        story: st,
        player: players[0] || null,
        playables: players,
      },
    };
  }

  // 发布前明列「本次将公开哪些卡」——消除混台发布的「静默」:上个故事残留在台上的卡会在这里现形(YOR-192)。
  // 数据源与 publish 同为 deskCards 四路,保证「看到的 = 会发的」。secret 检测=卡的键里有 隐藏/真相/secret 且有内容。
  function publishManifest() {
    const hasSecret = (c) =>
      Object.keys(c || {}).some((k) => /secret|隐藏|真相/i.test(k) && c[k] && String(c[k]).trim());
    const chars = deskCards("characters"), worlds = deskCards("worlds"), stories = deskCards("stories"), players = deskCards("players");
    return {
      chars: chars.map((c) => ({ name: c.name || c.title || "未命名", secret: hasSecret(c) })),
      worlds: worlds.length,
      players: players.map((p) => p.name || p.title || "主角"),
      story: stories.length ? stories[stories.length - 1].name || stories[stories.length - 1].title || "本故事" : null,
      // publish 只取 stories[last],故事书台多建的会被静默丢——如实披露被丢的张数,别让清单口径误导(YOR-192 复核②)。
      storyExtra: Math.max(0, stories.length - 1),
      anySecret: chars.some(hasSecret),
    };
  }

  // 打包发布(公开):四台子成品 → 可玩预设落 /api/presets。
  async function publish() {
    if (busy) return;
    const chars = deskCards("characters"), worlds = deskCards("worlds"), stories = deskCards("stories"), players = deskCards("players");
    if (!chars.length) {
      flash("至少要一张角色卡才能发布");
      return;
    }
    if (!pub.name.trim()) {
      flash("给这个故事起个名字");
      return;
    }
    const st = stories.length ? stories[stories.length - 1] : null;
    const tags = [...new Set([...chars.flatMap((c) => c.tags || []), ...((st || {}).tags || [])])].filter(Boolean).slice(0, 5);
    setBusy(true);
    try {
      await postJSON("/api/presets", {
        name: pub.name.trim(),
        characters: chars.map(wrapCard),
        world: worlds.length ? mergeWorldBooks(worlds) : null,
        story: st,
        player: players[0] || null,
        playables: players,
        mode: "standard",
        synopsis: pub.synopsis.trim(),
        author: (user && (user.display_name || user.username)) || "",
        author_note: pub.authorNote.trim(),
        cover: pub.cover || "",
        tags,
      });
      // 发布成功 = 一个故事装配完成。台子是「一故事一次性」,把四台全部归零 + 重置发布信息,
      // 否则这批 built 卡会静默留到下个故事、再发布时被一起打包公开(YOR-191)。只在此成功分支清,
      // catch 失败分支绝不清(避免误清用户还没发出去的卡)。
      const cleared = { characters: blankDesk(), players: blankDesk(), worlds: blankDesk(), stories: blankDesk() };
      // 先直接落 localStorage 再 setState:若用户发布成功后立刻离开创作页(组件卸载),setDesks 会成 no-op,
      // 而含旧卡的 desks 早已被 [desks] useEffect 写盘 → 下次进创作台 loadDesks 读回旧卡、泄漏复现。
      // 直接写盘让清台不依赖组件仍挂载(缩小写入,不触发配额失败)。
      try { localStorage.setItem(STORE_KEY, JSON.stringify(cleared)); } catch (e) {}
      setDesks(cleared);
      setPub({ name: "", synopsis: "", cover: "", authorNote: "" });
      setPreviewOpen(false);
      setPreviewChar(null);
      flash("已发布到探索 · 公开;台子已清空,可以开始下一个故事了", "/story/" + encodeURIComponent(pub.name.trim())); // 台子清空(YOR-191)+ 直链去看看(YOR-170)
    } catch (e) {
      flash("发布失败:" + e.message);
    } finally {
      setBusy(false);
    }
  }

  const draftName = desk.draft.name || (desk.draft.data && desk.draft.data.name) || desk.draft.title || "未命名";
  // 按钮可用性(细节④:不可用置灰、可用才亮)。
  const hasDraft = Object.keys(desk.draft || {}).length > 0;
  const hasChars = deskCards("characters").length > 0;
  const fields = useMemo(() => {
    const d = desk.draft || {};
    return Object.keys(d)
      .filter((k) => !NON_FIELD_KEYS.includes(k))
      .map((k) => ({
        k0: k, // 原始 key(就地手改/定向指令回写用)
        k: LABELS[k] || k,
        v: fmtVal(d[k]),
        // 纯文本字段可就地手改;对象/数组(世界书 entries、故事 timeline、tags…)v1 只读走「聊着改」
        editable: typeof d[k] === "string",
        // AI 骨架常带空串字段:收编成 ✦ 补写目标,不再是意义不明的空行
        empty: typeof d[k] === "string" && !d[k].trim(),
        fresh: (desk.filled || []).includes(k),
        hidden: /secret|隐藏|真相/i.test(k),
      }));
  }, [desk.draft, desk.filled]);

  // 切卡种时丢弃未提交的就地编辑(编辑目标已不在场),手记抽屉/参考资料弹窗一并合上。
  useEffect(() => {
    setEditingKey(null);
    setSeedOpen(false);
    setImportOpen(null);
    setTplOpen(false);
    setPresetsModal(null);
  }, [kind]);

  // D4:接「我的 · 去改编」带来的卡(sessionStorage 一次性 payload,读完即删,刷新不重复触发)。
  useEffect(() => {
    let raw = null;
    try {
      raw = sessionStorage.getItem("ais_create_adapt");
      if (raw) sessionStorage.removeItem("ais_create_adapt");
    } catch (e) {}
    if (!raw) return;
    try {
      const payload = JSON.parse(raw);
      const idx = KINDS.findIndex((t) => t.k === payload.kind);
      if (idx >= 0) setKi(idx);
      forkToDraft(payload.card, payload.kind);
    } catch (e) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // —— D3 模板:铺骨架进 draft(空串字段=✦ 补写目标),opener 只进输入框不代发 ——
  const tplHints = useMemo(() => {
    const t = getTpl(kind, desk.tpl);
    return (t && t.hints) || {};
  }, [kind, desk.tpl]);
  function applyTemplate(t) {
    if (!confirmReplaceDraft()) return;
    patch(kind, {
      draft: t.skeleton ? { ...t.skeleton } : {},
      filled: [],
      tpl: t.id,
      input: t.opener || "",
      // E5:骨架模板=已有结构直通 drafting(✦ 补写可用);纯 opener 模板(世界书)留在构思阶段
      ...(t.skeleton ? { phase: "drafting", comp: 0, questions: [], blueprint: [] } : {}),
    });
    setTplOpen(false);
    flash(t.skeleton ? `已铺开「${t.name}」骨架——空字段都是 ✦ 补写目标` : `「${t.name}」的开场指令已放进输入框`);
    requestAnimationFrame(() => dockInputRef.current && dockInputRef.current.focus());
  }

  // —— D1 参考资料:打开弹窗时把当前 seed 带进编辑框;确认时 trim+截 6000(存储即截断,所见即所发) ——
  function openSeed() {
    setSeedText(desk.seed || "");
    setSeedOpen(true);
  }
  function commitSeed() {
    const t = seedText.trim().slice(0, 6000);
    patch(kind, { seed: t });
    setSeedOpen(false);
    flash(t ? "参考资料已挂上——AI 之后每一轮都会参考它" : "参考资料已清空");
  }
  function clearSeed() {
    patch(kind, { seed: "" });
    setSeedOpen(false);
    flash("参考资料已清除");
  }
  // 徽章字数:<1000 显示整数字,否则 x.xk
  function seedLenLabel(s) {
    const n = (s || "").length;
    return n < 1000 ? `${n}字` : `${(n / 1000).toFixed(1)}k字`;
  }

  // —— C1 就地手改:手改直接写 draft(draft 即共享真相,AI 下轮基于改后内容继续长) ——
  function startFieldEdit(f) {
    if (!f.editable) return;
    setEditingKey(f.k0);
    setEditVal(desk.draft[f.k0] || "");
  }
  function commitFieldEdit() {
    if (editingKey === null) return;
    const key = editingKey;
    const val = editVal;
    setEditingKey(null);
    if (key === "__name") {
      const v = val.trim();
      if (!v) return; // 名字不许清空成空串,留旧值
      // 写到卡名实际所在的键:故事书等用 title(且没有 name)就写 title,其余写 name。
      patch(kind, (d0) => {
        const useTitle = "title" in (d0.draft || {}) && !("name" in (d0.draft || {}));
        return { draft: { ...d0.draft, [useTitle ? "title" : "name"]: v } };
      });
      return;
    }
    patch(kind, (d0) => ({ draft: { ...d0.draft, [key]: val } }));
  }
  function cancelFieldEdit() {
    setEditingKey(null);
  }
  // 复杂字段(对象/数组)不就地改:预填一句定向指令、光标带到命令条,聊着改。
  function chatAboutField(f) {
    patch(kind, { input: `把「${f.k}」这部分改一下:` });
    requestAnimationFrame(() => dockInputRef.current && dockInputRef.current.focus());
  }
  function startNameEdit() {
    setEditingKey("__name");
    setEditVal(draftName === "未命名" ? "" : draftName);
  }
  // 编辑框通用键位:⌘/Ctrl+Enter 或 Enter(单行语义的名字)提交,Esc 取消。
  function editKeys(e, single = false) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelFieldEdit();
    } else if ((e.key === "Enter" && (e.metaKey || e.ctrlKey)) || (single && e.key === "Enter" && !(e.nativeEvent || e).isComposing)) {
      e.preventDefault();
      commitFieldEdit();
    }
  }

  const portrait = desk.draft.image || ""; // 立绘
  const avatar = desk.draft.avatar || ""; // 头像

  // 预览 = 编辑(故事名/简介/作者的话/封面)+ 看真详情页 + 就地发布(取消独立发布弹窗)。
  function openPreview() {
    setMoreOpen(false);
    setPub((p) => ({ ...p, name: p.name || (draftName !== "未命名" ? draftName : "") }));
    setPreviewOpen(true);
  }
  function closePreview() {
    setPreviewOpen(false);
    setPreviewChar(null);
  }

  return (
    <div className={isMobile ? "ct" : "page create"}>
      {isMobile ? (
        /* ———————————————— 手机:整页定高、只对话滚、输入框/动作钉底 ———————————————— */
        <>
          <header className="ct-top">
            <div className="ct-toprow">
              <span className="ct-title t-h2">创作</span>
            </div>
            <div className="ct-tabs">
              {KINDS.map((t, i) => {
                const cnt = desks[t.k].built.length;
                return (
                  <button key={t.k} className={"ct-tab" + (i === ki ? " is-on" : "")} onClick={() => setKi(i)}>
                    {t.zh}
                    {cnt > 0 && <span className="ct-tab-badge">{cnt}</span>}
                  </button>
                );
              })}
            </div>
          </header>

          {/* 草稿:贴合顶部的细条(不浮在对话上),点开展成卡看立绘 + 全部字段 */}
          <div className={"ct-draft" + (cardExpanded ? " is-open" : "")}>
            <button className="ct-draft-head" onClick={() => setCardExpanded((v) => !v)} aria-expanded={cardExpanded}>
              <span
                className="ct-draft-thumb"
                style={portrait ? { backgroundImage: `url("${portrait}")` } : avatar ? { backgroundImage: `url("${avatar}")` } : undefined}
              >
                {!portrait && !avatar && (draftName === "未命名" ? "草" : draftName.slice(0, 1))}
              </span>
              <span className="ct-draft-tx">
                <span className="ct-draft-name t-kai">{draftName}</span>
                <span className="ct-draft-sub t-meta">
                  {KINDS[ki].zh}
                  {desk.built.length > 0 ? ` · 本台 ${desk.built.length}` : ""}
                  {fields.length ? ` · 已填 ${fields.length} 项` : " · 还空着"}
                </span>
              </span>
              <span className="ct-draft-chev t-meta">{cardExpanded ? "收起 ⌃" : "看全部 ⌄"}</span>
            </button>
            {cardExpanded && (
              <div className="ct-draft-body">
                {portrait && <div className="ct-draft-cover" style={{ backgroundImage: `url("${portrait}")` }} aria-label="立绘" />}
                <div className="create-card-fields">
                  {fields.length ? (
                    fields.map((f, i) => (
                      <div className={"create-field" + (f.fresh ? " is-fresh" : "")} key={i}>
                        <span className="create-field-k t-meta">{f.k}</span>
                        <span className="create-field-v t-ui-sm">{f.hidden ? "(隐藏真相,玩家不可见)" + f.v : f.v}</span>
                      </div>
                    ))
                  ) : (
                    <div className="create-field-empty t-meta">还没有字段。下面聊几句。</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 中:对话(唯一滚动区) */}
          <div className="ct-chat" ref={chatRef}>
            {/* E6:完整度火候线进手机对话流(布局不动,只是流内多一行) */}
            {phase !== "drafting" && (
              <div className="create-comp" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={desk.comp || 0} aria-label="这张卡的完整度">
                <span className="create-comp-label t-meta">
                  完整度 {desk.comp || 0}
                  <span className="create-comp-hint">{(desk.comp || 0) >= COMP_THRESHOLD ? " · 过线,可以落笔" : ` · 过 ${COMP_THRESHOLD} 才落笔`}</span>
                </span>
                <span className="create-comp-line" aria-hidden="true">
                  <span className="create-comp-fill" style={{ width: `${Math.min(100, desk.comp || 0)}%` }} />
                  <span className="create-comp-mark" style={{ left: `${COMP_THRESHOLD}%` }} />
                </span>
              </div>
            )}
            {desk.messages.map((m, i) => (
              <div key={i} className={"create-msg" + (m.who === "你" ? " is-me" : "")}>
                <span className="create-msg-who t-meta">{m.who === "你" ? "你" : "助手"}</span>
                <p className="create-msg-text t-ui">{m.text}</p>
              </div>
            ))}
            {/* E6:问题圈选与蓝图进手机对话流(复用桌面组件类,样式已通用) */}
            {phase === "understand" && (desk.questions || []).length > 0 && !busy && (
              <div className="create-quiz">
                {desk.questions.map((qu) => (
                  <div className="create-quiz-q" key={qu.id}>
                    <div className="create-quiz-label t-ui">{qu.label}</div>
                    <div className="create-quiz-opts">
                      {(qu.options || []).map((o) => (
                        <button key={o} className={"create-quiz-opt" + (quizAns[qu.id] === o ? " is-on" : "")}
                          onClick={() => setQuizAns((a) => ({ ...a, [qu.id]: a[qu.id] === o ? undefined : o }))}>
                          {o}
                        </button>
                      ))}
                      {qu.allow_free !== false && (
                        <input className="create-quiz-free t-ui-sm" placeholder="其他,自己写……" value={quizFree[qu.id] || ""}
                          onChange={(e) => { const v = e.target.value; setQuizFree((f) => ({ ...f, [qu.id]: v })); if (v) setQuizAns((a) => ({ ...a, [qu.id]: undefined })); }} />
                      )}
                    </div>
                  </div>
                ))}
                <div className="create-quiz-foot">
                  <Button variant="primary" disabled={!(desk.questions || []).some((qu) => quizAnswerOf(qu))} onClick={submitQuiz}>
                    就按这些答
                  </Button>
                </div>
              </div>
            )}
            {phase === "blueprint" && (desk.blueprint || []).length > 0 && !busy && (
              <div className="create-bp">
                <div className="create-bp-h t-kai">蓝图 · 这张卡打算这么写</div>
                {desk.blueprint.map((b, i) => (
                  <div className="create-bp-item t-ui" key={i}>—— {b}</div>
                ))}
                <input
                  className="create-ask-line t-ui-sm"
                  value={bpNote}
                  disabled={busy}
                  placeholder="落笔前补一句要求(可空)"
                  onChange={(e) => setBpNote(e.target.value)}
                  aria-label="落笔附言"
                />
                <div className="create-bp-foot">
                  <Button variant="primary" onClick={approveBlueprint}>批准,开始写</Button>
                  <button className="create-blank-link" onClick={() => patch(kind, { phase: "understand" })}>再聊聊</button>
                </div>
              </div>
            )}
            {busy && (
              <div className="create-msg">
                <span className="create-msg-who t-meta">助手</span>
                <p className="create-msg-text t-ui create-msg-typing">正在想……</p>
              </div>
            )}
          </div>

          {/* 底:输入框 + 动作(钉死) */}
          <div className="ct-foot">
            {moreOpen && (
              <div className="ct-more" role="menu">
                <button onClick={() => { setMoreOpen(false); setBuiltView(true); }} disabled={!desk.built.length}>
                  查看本台已建({desk.built.length})
                </button>
                <button onClick={openLib}>从卡库补素材</button>
                {/* D6 手机最小入口:只加两项,弹窗与桌面共用;.ct 布局不动 */}
                <button onClick={() => { setMoreOpen(false); setImportOpen({ step: "pick", text: "", err: "" }); }}>
                  导入已有内容
                </button>
                <button onClick={() => { setMoreOpen(false); openSeed(); }}>
                  {desk.seed ? `参考资料 · ${seedLenLabel(desk.seed)}(查看 / 清除)` : "挂参考资料"}
                </button>
                {/* F6 手机最小入口:引用面板(弹窗与桌面共用);纸签行在 composer 上方 */}
                <button onClick={() => { setMoreOpen(false); openRefPanel("desk"); }}>
                  {deskRefs.length ? `引用卡 / 提示词 · 已挂 ${deskRefs.length}` : "引用卡 / 提示词"}
                </button>
                <button className="ct-more-pub" onClick={openPreview} disabled={!hasChars}>预览并发布到探索 · 公开</button>
                {/* 禁用原因触屏可见(桌面版的 title 手机看不到,同 YOR-173 范式) */}
                {!hasChars && <span className="ct-more-note t-meta">至少要一张角色卡——先聊一张,或从卡库补一张</span>}
              </div>
            )}
            {/* F6:挂台纸签在手机也常显可摘(同一套类名,CSS 通用) */}
            {deskRefs.length > 0 && (
              <div className="create-refs" aria-label="挂在台上的引用">
                {deskRefs.map((r) => (
                  <span className="create-ref-chip t-ui-sm" key={r.label}>
                    <span className="create-ref-t">{r.type === "prompt" ? "词" : "卡"}</span>
                    {r.label}
                    <button className="create-ref-x" onClick={() => removeRef(r.label)} aria-label={"摘下" + r.label}>×</button>
                  </span>
                ))}
              </div>
            )}
            <div className="ct-composer">
              <textarea
                rows={1}
                value={desk.input}
                disabled={busy}
                placeholder={KINDS[ki].ph}
                onChange={(e) => {
                  const v = e.target.value;
                  const old = desk.input || "";
                  // F6:手机输入 @ 同样唤起引用面板(与桌面同规则)
                  if (v.length === old.length + 1 && v.endsWith("@") && (v.length === 1 || /\s/.test(v[v.length - 2]))) {
                    patch(kind, { input: v.slice(0, -1) });
                    openRefPanel("desk");
                    return;
                  }
                  patch(kind, { input: v });
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent || e).isComposing && !busy) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              <button className="ct-upload" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy} title="上传文档" aria-label="上传文档">＋</button>
              <input ref={fileRef} type="file" accept=".txt,.md,.docx" hidden onChange={onUpload} />
              <Button variant="primary" onClick={send} disabled={busy || !desk.input.trim()}>发送</Button>
            </div>
            <div className="ct-actions">
              <Button variant="line" onClick={nextCard} disabled={!hasDraft}>收进本台</Button>
              <Button variant="line" onClick={saveCard} disabled={!hasDraft || savingCard}>{savingCard ? "收入中…" : "收入卡库"}</Button>
              <button className={"ct-morebtn" + (moreOpen ? " is-on" : "")} onClick={() => setMoreOpen((v) => !v)} aria-label="更多">⋯ 更多</button>
            </div>
          </div>
        </>
      ) : (
        /* ———————————————— 桌面:两栏(对话 | 实时卡 + 操作钉死) ————————————————
           reskin(YOR-211):入场动效(标题错层/副标晕染/tab 错峰)+ 空台引子 + 墨点打字指示 +
           草稿卡 DepthCard 视差。功能契约未动:send/onUpload/收纳/发布全部原样。 */
        <>
          <div className="create-head">
            <div>
              <h1 className="t-display">
                <StaggeredText text="创作" as="span" segmentBy="chars" className="create-title-st" />
              </h1>
              <p className="t-ui create-sub">
                <BlurHighlight
                  highlightedBits={["边聊边", "草稿自动保存"]}
                  highlightColor="color-mix(in srgb, var(--accent) 16%, transparent)"
                  blurDuration={0.7}
                  highlightDelay={0.5}
                  viewportOptions={{ once: true, amount: 0.3 }}
                >
                  和 AI 一起,边聊边把一张卡 / 一个故事填出来。草稿自动保存。
                </BlurHighlight>
              </p>
            </div>
          </div>
          <div className="create-kinds">
            {KINDS.map((t, i) => {
              const cnt = desks[t.k].built.length;
              return (
                <button
                  key={t.k}
                  className={"create-kind" + (i === ki ? " is-on" : "")}
                  style={{ "--ci": i }}
                  onClick={() => setKi(i)}
                >
                  {t.zh}
                  {cnt > 0 && <span className="create-kind-badge">{cnt}</span>}
                </button>
              );
            })}
          </div>

          {/* E1 双栏(artifact 式,方案 E 章):左会话流(对谈体,零气泡框,命令条钉底)|
              右 artifact 区 = 原 stage(卡画布+产出侧)。key=kind:切卡种整段重挂当转场。
              叙述条/手记抽屉自此退役——会话流就是历史本身。 */}
          <div className="create-studio" key={kind}>
            <section className="create-session" aria-label="创作对话">
              {/* E2 完整度火候线(signature):一根从墨到鎏金渐染的细线,60 处一粒朱点=落笔线;
                  只在构思/蓝图阶段出现——落笔后它的任务就完成了。 */}
              {phase !== "drafting" && (
                <div
                  className="create-comp"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={desk.comp || 0}
                  aria-label="这张卡的完整度"
                >
                  <span className="create-comp-label t-meta">
                    完整度 {desk.comp || 0}
                    <span className="create-comp-hint">{(desk.comp || 0) >= COMP_THRESHOLD ? " · 过线,可以落笔" : ` · 过 ${COMP_THRESHOLD} 才落笔`}</span>
                  </span>
                  <span className="create-comp-line" aria-hidden="true">
                    <span className="create-comp-fill" style={{ width: `${Math.min(100, desk.comp || 0)}%` }} />
                    <span className="create-comp-mark" style={{ left: `${COMP_THRESHOLD}%` }} />
                  </span>
                </div>
              )}
              <div className="create-session-flow" ref={chatRef}>
                {desk.messages.map((m, i) => (
                  <div key={i} className={"create-say" + (m.who === "你" ? " is-me" : "")}>
                    <span className="create-say-who t-kai">{m.who === "你" ? "你" : "助手"}</span>
                    <div className="create-say-tx t-ui">{m.text}</div>
                  </div>
                ))}
                {/* E3 问题作答:稿纸圈选词——虚线下划的可点词组,点选转朱砂实线;「其他」是填空线。零卡片零边框。 */}
                {phase === "understand" && (desk.questions || []).length > 0 && !busy && (
                  <div className="create-quiz">
                    {desk.questions.map((qu) => (
                      <div className="create-quiz-q" key={qu.id}>
                        <div className="create-quiz-label t-ui">{qu.label}</div>
                        <div className="create-quiz-opts">
                          {(qu.options || []).map((o) => (
                            <button
                              key={o}
                              className={"create-quiz-opt" + (quizAns[qu.id] === o ? " is-on" : "")}
                              onClick={() =>
                                setQuizAns((a) => ({ ...a, [qu.id]: a[qu.id] === o ? undefined : o }))
                              }
                            >
                              {o}
                            </button>
                          ))}
                          {qu.allow_free !== false && (
                            <input
                              className="create-quiz-free t-ui-sm"
                              placeholder="其他,自己写……"
                              value={quizFree[qu.id] || ""}
                              onChange={(e) => {
                                const v = e.target.value;
                                setQuizFree((f) => ({ ...f, [qu.id]: v }));
                                if (v) setQuizAns((a) => ({ ...a, [qu.id]: undefined }));
                              }}
                            />
                          )}
                        </div>
                      </div>
                    ))}
                    <div className="create-quiz-foot">
                      <Button
                        variant="primary"
                        disabled={!(desk.questions || []).some((qu) => quizAnswerOf(qu))}
                        onClick={submitQuiz}
                      >
                        就按这些答
                      </Button>
                      <span className="create-quiz-skip t-meta">没答全没关系,也可以直接在下面说</span>
                    </div>
                  </div>
                )}
                {/* E4 蓝图:破折号要点直排纸面;唯一的重元素是那颗批准钮。 */}
                {phase === "blueprint" && (desk.blueprint || []).length > 0 && !busy && (
                  <div className="create-bp">
                    <div className="create-bp-h t-kai">蓝图 · 这张卡打算这么写</div>
                    {desk.blueprint.map((b, i) => (
                      <div className="create-bp-item t-ui" key={i}>—— {b}</div>
                    ))}
                    {/* F3 批准附言:落笔前最后一句口味要求,可空(AI 触点皆可控) */}
                    <input
                      className="create-ask-line t-ui-sm"
                      value={bpNote}
                      disabled={busy}
                      placeholder="落笔前补一句要求(可空)——比如:对话多一点,别太文绉绉"
                      onChange={(e) => setBpNote(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !(e.nativeEvent || e).isComposing && !busy) {
                          e.preventDefault();
                          approveBlueprint();
                        }
                      }}
                      aria-label="落笔附言"
                    />
                    <div className="create-bp-foot">
                      <Button variant="primary" onClick={approveBlueprint}>批准,开始写</Button>
                      <button
                        className="create-blank-link"
                        onClick={() => {
                          patch(kind, { phase: "understand" });
                          requestAnimationFrame(() => dockInputRef.current && dockInputRef.current.focus());
                        }}
                      >
                        再聊聊
                      </button>
                    </div>
                  </div>
                )}
                {busy && (
                  <div className="create-say">
                    <span className="create-say-who t-kai">助手</span>
                    <div className="create-say-tx t-ui create-msg-typing">
                      <span className="create-dot" aria-hidden="true" />
                      <span className="create-dot" aria-hidden="true" />
                      <span className="create-dot" aria-hidden="true" />
                      正在想……
                    </div>
                  </div>
                )}
              </div>
              <div
                className={"create-dock" + (refDragOver ? " is-dropping" : "")}
                onDragOver={(e) => {
                  // F4:接收台架/卡库拖来的卡(自定义 MIME,普通文件拖入不误触)
                  if ([...e.dataTransfer.types].includes("application/x-ais-ref")) {
                    e.preventDefault();
                    setRefDragOver(true);
                  }
                }}
                onDragLeave={() => setRefDragOver(false)}
                onDrop={(e) => {
                  setRefDragOver(false);
                  const raw = e.dataTransfer.getData("application/x-ais-ref");
                  if (!raw) return;
                  e.preventDefault();
                  try {
                    const p = JSON.parse(raw);
                    addRef(refFromCard(p.kk, p.card));
                  } catch {
                    flash("这张卡拖不进来(数据读不出)");
                  }
                }}
              >
                {/* F2 引用纸签:挂台常驻,每轮都随请求走;点 × 摘下 */}
                {(deskRefs.length > 0 || refDragOver) && (
                  <div className="create-refs" aria-label="挂在台上的引用">
                    {deskRefs.map((r) => (
                      <span className="create-ref-chip t-ui-sm" key={r.label} title={"AI 每轮都会参考「" + r.label + "」"}>
                        <span className="create-ref-t">{r.type === "prompt" ? "词" : "卡"}</span>
                        {r.label}
                        <button className="create-ref-x" onClick={() => removeRef(r.label)} aria-label={"摘下" + r.label}>×</button>
                      </span>
                    ))}
                    {refDragOver && <span className="create-ref-hint t-meta">松手,挂为引用</span>}
                  </div>
                )}
                <div className="create-composer">
                  <textarea
                    ref={dockInputRef}
                    rows={1}
                    value={desk.input}
                    disabled={busy}
                    placeholder={KINDS[ki].ph}
                    onChange={(e) => {
                      const v = e.target.value;
                      const old = desk.input || "";
                      // F2:行首或空白后敲 @ 唤起引用面板(那个 @ 不留在输入里)
                      if (v.length === old.length + 1 && v.endsWith("@") && (v.length === 1 || /\s/.test(v[v.length - 2]))) {
                        patch(kind, { input: v.slice(0, -1) });
                        openRefPanel("desk");
                        return;
                      }
                      patch(kind, { input: v });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent || e).isComposing && !busy) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  <div className="create-composer-actions">
                    <button className="create-upload" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>
                      上传文档
                    </button>
                    <input ref={fileRef} type="file" accept=".txt,.md,.docx" hidden onChange={onUpload} />
                    <button
                      className={"create-seed-btn" + (desk.seed ? " has-seed" : "")}
                      onClick={openSeed}
                      disabled={busy}
                      title={desk.seed ? "查看 / 修改 / 清除参考资料(AI 每轮都在参考它)" : "挂一份已有设定 / 旧卡文本,AI 之后每轮都基于它来完善"}
                    >
                      {desk.seed ? `参考 · ${seedLenLabel(desk.seed)}` : "挂资料"}
                    </button>
                    <button
                      className={"create-seed-btn" + (deskRefs.length ? " has-seed" : "")}
                      onClick={() => (refPanel ? setRefPanel(null) : openRefPanel("desk"))}
                      disabled={busy}
                      title="引用已有的卡或提示词,AI 每轮都会参考(输入框里敲 @ 也能唤起;桌面还可以直接把卡拖进来)"
                    >
                      {deskRefs.length ? `@ 引用 · ${deskRefs.length}` : "@ 引用"}
                    </button>
                    <Button variant="primary" onClick={send} disabled={busy || !desk.input.trim()}>
                      发送
                    </Button>
                  </div>
                </div>
              </div>
            </section>

            <div className="create-stage">
            {/* 卡画布:正在长的这张卡铺在中央 */}
            <div className="create-canvas-col">
              <section className="create-canvas" aria-label="卡画布">
                <div className="create-card-kind t-meta">{KINDS[ki].zh}{desk.built.length > 0 && ` · 本台已建 ${desk.built.length}`}</div>
                {editingKey === "__name" ? (
                  <input
                    className="create-card-name create-name-edit t-kai"
                    autoFocus
                    value={editVal}
                    placeholder="起个名字…"
                    onChange={(e) => setEditVal(e.target.value)}
                    onKeyDown={(e) => editKeys(e, true)}
                    onBlur={commitFieldEdit}
                    aria-label="卡名"
                  />
                ) : (
                  <button className="create-card-name create-name-btn t-kai" onClick={startNameEdit} title="点击改名">
                    {draftName}
                    <span className="create-name-hint" aria-hidden="true">✎</span>
                  </button>
                )}
                {kind === "characters" && (avatar || portrait) && (
                  <div className="create-pics-preview">
                    {avatar && <span className="create-pics-av" style={{ backgroundImage: `url("${avatar}")` }} aria-label="头像" />}
                    {portrait && <span className="create-pics-portrait" style={{ backgroundImage: `url("${portrait}")` }} aria-label="立绘" />}
                  </div>
                )}
                <div className="create-card-fields">
                  {fields.length ? (
                    fields.map((f, fi) => (
                      <div
                        className={
                          "create-field" +
                          (f.fresh ? " is-fresh" : "") +
                          (editingKey === f.k0 ? " is-editing" : "")
                        }
                        style={{ "--ci": Math.min(fi, 8) }}
                        key={f.k0}
                      >
                        <span className="create-field-k t-meta">
                          {f.k}
                          {f.hidden && <span className="create-field-seal" title="隐藏真相,玩家不可见">密</span>}
                        </span>
                        {editingKey === f.k0 ? (
                          <textarea
                            className="create-field-edit t-ui-sm"
                            autoFocus
                            rows={Math.min(8, Math.max(2, Math.ceil((editVal.length + 1) / 26)))}
                            value={editVal}
                            onChange={(e) => setEditVal(e.target.value)}
                            onKeyDown={(e) => editKeys(e)}
                            onBlur={commitFieldEdit}
                            aria-label={"编辑" + f.k}
                          />
                        ) : f.empty || !f.v.trim() ? (
                          <span className="create-field-v create-field-v-empty t-ui-sm">
                            {tplHints[f.k0]
                              ? tplHints[f.k0] + (f.editable ? "(✦ 补写 / ✎ 手写)" : "(点「聊」到命令条补)")
                              : f.editable
                              ? "还空着——✦ 让 AI 补写,或 ✎ 手写"
                              : "还空着——点「聊」到命令条补"}
                          </span>
                        ) : (
                          <span className="create-field-v t-ui-sm">{f.hidden ? "(隐藏真相,玩家不可见)" + f.v : f.v}</span>
                        )}
                        {editingKey !== f.k0 && (
                          <span className="create-field-acts">
                            {f.editable ? (
                              <>
                                <button
                                  className={"create-field-act" + (askOpen === f.k0 ? " is-on" : "")}
                                  disabled={busy}
                                  title={f.empty ? "让 AI 补写这一块(可先写一句要求)" : "让 AI 把这一块改写得更立体(可先写一句要求)"}
                                  aria-label={(f.empty ? "补写" : "改写") + f.k}
                                  onClick={() => toggleFieldAsk(f)}
                                >
                                  {f.empty ? "✦" : "⟳"}
                                </button>
                                <button className="create-field-act" disabled={busy} title="就地手改" aria-label={"手改" + f.k} onClick={() => startFieldEdit(f)}>
                                  ✎
                                </button>
                              </>
                            ) : (
                              <button className="create-field-act" disabled={busy} title="这块是结构化内容,到命令条聊着改" aria-label={"聊着改" + f.k} onClick={() => chatAboutField(f)}>
                                聊
                              </button>
                            )}
                          </span>
                        )}
                        {/* F3 指示行:✦/⟳ 点开——写一句要求或直接回车用默认写法(AI 触点皆可控) */}
                        {askOpen === f.k0 && (
                          <input
                            className="create-ask-line t-ui-sm"
                            autoFocus
                            value={askText}
                            disabled={busy}
                            placeholder={(f.empty ? "想怎么补?" : "想怎么改?") + "可留空直接回车"}
                            onChange={(e) => setAskText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !(e.nativeEvent || e).isComposing) {
                                e.preventDefault();
                                commitFieldAsk(f);
                              } else if (e.key === "Escape") {
                                setAskOpen(null);
                                setAskText("");
                              }
                            }}
                            aria-label={"对" + f.k + "的要求"}
                          />
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="create-card-blank">
                      <span className="create-card-blank-seal t-kai" aria-hidden="true">卡</span>
                      <span className="create-card-blank-tx t-meta">
                        {phase !== "drafting" ? "构思中——左边聊清楚要什么,完整度过线、蓝图点头,再落笔。" : OPENINGS[kind]}
                      </span>
                      {/* 空台引子:起手句进画布空卡里(点了只进输入框,不代发) */}
                      {desk.messages.length <= 1 && !busy && (
                        <div className="create-starters">
                          <span className="create-starters-h t-meta">起个头</span>
                          <div className="create-starters-row">
                            {(SUGGESTS[kind] || []).map((s, i) => (
                              <button
                                key={s}
                                className="create-starter t-ui-sm"
                                style={{ "--ci": i }}
                                onClick={() => patch(kind, { input: s })}
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* D1/D2/D3:已有内容优先的入口行——模板起手 / 导入成卡 / 挂参考资料 */}
                      <div className="create-blank-more t-meta">
                        <button className="create-blank-link" onClick={() => setTplOpen(true)}>
                          从模板起手
                        </button>
                        ·
                        <button className="create-blank-link" onClick={() => setImportOpen({ step: "pick", text: "", err: "" })}>
                          导入已有内容
                        </button>
                        ·
                        <button className="create-blank-link" onClick={openSeed}>
                          {desk.seed ? `参考资料 · ${seedLenLabel(desk.seed)}` : "挂参考资料"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            </div>

            {/* 产出侧:本台架(看得见的成品)→ 收纳动作 → 装订区(发布清单常显) */}
            <aside className="create-side">
              <div className="create-shelf">
                <div className="create-shelf-h t-meta">本台已建 · {desk.built.length}</div>
                {desk.built.length ? (
                  <div className="create-shelf-list">
                    {desk.built.map((card, i) => {
                      const c = (card && card.data) || card || {};
                      const nm = c.name || c.title || "未命名";
                      const entries = worldEntries(card);
                      const firstField = cardFields(card)[0];
                      return (
                        <DepthCard key={nm + i} className="create-shelf-tilt" maxRotation={5}>
                          <div
                            className="create-shelf-card"
                            draggable
                            title="拖到左下命令条,挂为引用"
                            onDragStart={(e) =>
                              e.dataTransfer.setData("application/x-ais-ref", JSON.stringify({ kk: kind, card }))
                            }
                          >
                            <span className="create-shelf-name t-kai">{nm}</span>
                            <span className="create-shelf-sub t-meta">
                              {entries ? `${entries.length} 条条目` : firstField ? firstField.v.slice(0, 22) : "已收进本台"}
                            </span>
                            <span className="create-shelf-acts">
                              <button className="create-shelf-act" onClick={() => setBuiltView(true)}>查看</button>
                              <button className="create-shelf-act" onClick={() => removeBuilt(i)}>移除</button>
                            </span>
                          </div>
                        </DepthCard>
                      );
                    })}
                  </div>
                ) : (
                  <div className="create-shelf-empty t-meta">还空着——聊出一张,点「收进本台」。</div>
                )}
              </div>

              <div className="create-actions">
                <Button variant="line" onClick={saveCard} disabled={!hasDraft || savingCard} title={hasDraft ? undefined : "先聊出一张卡再收入卡库"}>
                  {savingCard ? "收入中…" : "收入卡库 · 私密"}
                </Button>
                <Button variant="line" onClick={nextCard} disabled={!hasDraft} title={hasDraft ? undefined : "先聊出一张卡再收进本台"}>
                  收进本台 · 再建一张
                </Button>
                <Button variant="line" onClick={openLib}>从卡库补素材</Button>
                <Button variant="line" onClick={() => exportCard(desk.draft)} disabled={!hasDraft} title={hasDraft ? "下载当前草稿为 JSON(角色卡=chara_card_v2,可再导入)" : "先聊出一张卡再导出"}>
                  导出草稿 JSON
                </Button>
                <div className="create-actions-sep" aria-hidden="true" />
                <Button
                  variant="primary"
                  full
                  disabled={!hasChars}
                  title={hasChars ? undefined : "至少要一张角色卡才能预览并发布"}
                  onClick={openPreview}
                >
                  预览并发布到探索 · 公开
                </Button>
              </div>

              {/* 装订区:本次发布会打包什么,常显(与 publish 同源 deskCards,「看到的=会发的」YOR-192) */}
              {(() => {
                const mf = publishManifest();
                return (
                  <div className="create-bind">
                    <div className="create-bind-h t-meta">装订 · 发布时打包</div>
                    <ul className="create-bind-list t-meta">
                      <li>
                        角色卡 ×{mf.chars.length}
                        {mf.chars.length > 0 && ":" + mf.chars.map((c) => c.name + (c.secret ? " ⚠" : "")).join("、")}
                      </li>
                      {mf.worlds > 0 && <li>设定卡 · 世界书 ×{mf.worlds}</li>}
                      {mf.players.length > 0 && <li>演出卡 ×{mf.players.length}:{mf.players.join("、")}</li>}
                      {mf.story && (
                        <li>
                          故事书:{mf.story}
                          {mf.storyExtra > 0 && `(另 ${mf.storyExtra} 张不发)`}
                        </li>
                      )}
                      {!mf.chars.length && <li className="create-bind-empty">还没有角色卡——发布至少要一张</li>}
                    </ul>
                    {mf.anySecret && (
                      <div className="create-bind-warn t-meta">⚠ 带「隐藏真相」的卡会随发布公开,发布前核对</div>
                    )}
                    {/* D4 故事级改编:把发布过的故事整组拆回四台继续编(追加进 built,不动原预设) */}
                    <button className="create-bind-resume" onClick={openPresets}>
                      ↺ 从我发布的故事继续改
                    </button>
                  </div>
                );
              })()}
            </aside>
          </div>

          </div>



        </>
      )}

      {toast && (
        <div className="create-toast t-ui-sm">
          {toast}
          {toastGo && (
            <button
              className="create-toast-go"
              onClick={() => {
                const to = toastGo;
                setToast("");
                setToastGo(null);
                navigate(to);
              }}
            >
              去看看 →
            </button>
          )}
        </div>
      )}

      {/* —————————————— 以下弹层桌面 / 手机共用 —————————————— */}

      {/* D1 参考资料弹窗:粘贴已有设定/旧卡,存 desks[kind].seed(≤6000 字,存储即截断);
          成本明示:每一轮 build_card 都会带上它。 */}
      {seedOpen && (
        <div className="create-modal" onClick={() => setSeedOpen(false)}>
          <div className="create-modal-card" role="dialog" aria-modal="true" aria-label="参考资料" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setSeedOpen(false)} aria-label="关闭">×</button>
            <h2 className="t-h2">参考资料 · {KINDS[ki].zh}</h2>
            <p className="create-seed-note t-meta">
              把已有的设定 / 旧卡文本挂在台上:之后每一轮 AI 都会基于它来完善、对空缺处定向追问。
              每轮都参考意味着回复更慢也更贵——用完记得清除。只保存前 6000 字。
            </p>
            <textarea
              className="create-seed-ta t-ui-sm"
              rows={10}
              maxLength={8000}
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              placeholder="粘贴已有设定、旧卡文本、世界观笔记……"
            />
            <div className={"create-seed-count t-meta" + (seedText.length > 6000 ? " is-over" : "")}>
              {seedText.length > 6000
                ? `${seedText.length} 字——超出 6000 字的部分不会保存`
                : `${seedText.length} / 6000 字`}
            </div>
            <div className="create-seed-actions">
              {(desk.seed || "") && (
                <Button variant="line" onClick={clearSeed}>清除</Button>
              )}
              <Button variant="primary" onClick={commitSeed}>挂上</Button>
            </div>
          </div>
        </div>
      )}

      {/* D4 故事拆回:选一条已发布预设,四类卡追加回各台 built(官方故事也可拆——拆的是副本,发布生成新预设)。 */}
      {/* F2 引用面板:桌上的卡 / 我的卡库 / 提示词——选一个挂为引用(@ 或按钮唤起) */}
      {refPanel && (
        <div className="create-modal" onClick={() => setRefPanel(null)}>
          <div className="create-modal-card" role="dialog" aria-modal="true" aria-label="引用" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setRefPanel(null)} aria-label="关闭">×</button>
            <h2 className="t-h2">引用 · AI 每轮都会参考</h2>
            <div className="create-ref-tabs">
              {[["desk", "桌上的卡"], ["lib", "我的卡库"], ["prompt", "提示词"]].map(([t, zh]) => (
                <button
                  key={t}
                  className={"create-ref-tab t-ui-sm" + (refPanel.tab === t ? " is-on" : "")}
                  onClick={() => openRefPanel(t, refPanel.kk || kind)}
                >
                  {zh}
                </button>
              ))}
            </div>
            {refPanel.tab === "desk" && (
              <div className="create-ref-list">
                {KINDS.flatMap((t) => deskCards(t.k).map((c, i) => ({ kk: t.k, zh: t.zh, c, i }))).map(({ kk, zh, c, i }) => {
                  const nm = c.name || c.title || "未命名";
                  return (
                    <button className="create-ref-row" key={kk + i + nm} onClick={() => addRef(refFromCard(kk, c))}>
                      <span className="create-ref-row-t t-ui">{nm}</span>
                      <span className="create-ref-row-d t-meta">{zh}</span>
                    </button>
                  );
                })}
                {!KINDS.some((t) => deskCards(t.k).length) && (
                  <div className="create-shelf-empty t-meta">四个台子都还空着——先聊出点东西,或去「我的卡库」引用。</div>
                )}
              </div>
            )}
            {refPanel.tab === "lib" && (
              <>
                <div className="create-ref-tabs create-ref-kinds">
                  {KINDS.map((t) => (
                    <button
                      key={t.k}
                      className={"create-ref-tab t-ui-sm" + ((refPanel.kk || kind) === t.k ? " is-on" : "")}
                      onClick={() => openRefPanel("lib", t.k)}
                    >
                      {t.zh}
                    </button>
                  ))}
                </div>
                <div className="create-ref-list">
                  {refPanel.loading ? (
                    <div className="create-shelf-empty t-meta">翻库中……</div>
                  ) : refPanel.err ? (
                    <div className="create-import-err t-meta">{refPanel.err}</div>
                  ) : refPanel.items.length ? (
                    refPanel.items.map((it, i) => (
                      <button
                        className="create-ref-row"
                        key={(it.name || i) + i}
                        draggable
                        onDragStart={(e) => {
                          const raw = it && it.data ? it.data : it;
                          e.dataTransfer.setData("application/x-ais-ref", JSON.stringify({ kk: refPanel.kk || kind, card: raw }));
                        }}
                        onClick={() => {
                          const raw = it && it.data ? it.data : it;
                          addRef(refFromCard(refPanel.kk || kind, raw));
                        }}
                      >
                        <span className="create-ref-row-t t-ui">{libName(it)}</span>
                        <span className="create-ref-row-d t-meta">{(libDesc(it) || "").slice(0, 40)}</span>
                      </button>
                    ))
                  ) : (
                    <div className="create-shelf-empty t-meta">这一类还没有入库的卡。</div>
                  )}
                </div>
              </>
            )}
            {refPanel.tab === "prompt" && (
              <div className="create-ref-list">
                <div className="create-prompt-add">
                  <input
                    className="create-ask-line t-ui-sm"
                    value={promptDraft}
                    placeholder="写一条常用提示词存起来——比如:文风偏冷,句子短,不用成语"
                    onChange={(e) => setPromptDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !(e.nativeEvent || e).isComposing && promptDraft.trim()) {
                        e.preventDefault();
                        setPrompts(addPrompt("", promptDraft));
                        setPromptDraft("");
                      }
                    }}
                  />
                  <button
                    className="create-blank-link"
                    disabled={!promptDraft.trim()}
                    onClick={() => {
                      setPrompts(addPrompt("", promptDraft));
                      setPromptDraft("");
                    }}
                  >
                    存入
                  </button>
                </div>
                {prompts.length ? (
                  prompts.map((p) => (
                    <div className="create-ref-row create-prompt-row" key={p.id}>
                      <button className="create-prompt-use" onClick={() => addRef(makeRef("prompt", "提示词·" + p.name, p.text))}>
                        <span className="create-ref-row-t t-ui">{p.name}</span>
                        <span className="create-ref-row-d t-meta">{p.text.slice(0, 46)}</span>
                      </button>
                      <button className="create-ref-x" onClick={() => setPrompts(removePrompt(p.id))} aria-label={"删除提示词" + p.name}>×</button>
                    </div>
                  ))
                ) : (
                  <div className="create-shelf-empty t-meta">还没存过提示词——上面写一条,以后任何台子都能引用。</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {presetsModal && (
        <div className="create-modal" onClick={() => setPresetsModal(null)}>
          <div className="create-modal-card" role="dialog" aria-modal="true" aria-label="从故事继续" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setPresetsModal(null)} aria-label="关闭">×</button>
            <h2 className="t-h2">从已发布的故事继续改</h2>
            <p className="create-seed-note t-meta">
              选一条,里面的角色 / 演出 / 世界书 / 故事书会整组追加回四个台子(原故事不动;改完发布=新故事)。
            </p>
            <div className="create-lib-list">
              {presetsModal.items.length ? (
                presetsModal.items.map((p, i) => {
                  const d = p.data || {};
                  const cnt = (d.characters || []).length;
                  return (
                    <div className="create-lib-item create-lib-item--row" key={i}>
                      <span className="create-lib-item-tx">
                        <span className="t-ui-sm">
                          {p.name}
                          {p.official && <span className="create-tpl-badge t-meta">官方</span>}
                        </span>
                        <span className="t-meta">
                          角色×{cnt}{d.world ? " · 世界书" : ""}{d.story ? " · 故事书" : ""}{(d.playables || []).length || d.player ? " · 演出卡" : ""}
                        </span>
                      </span>
                      <span className="create-lib-item-acts">
                        <button className="create-shelf-act" onClick={() => unpackPreset(p)}>拆回四台</button>
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="t-ui create-sub">还没有已发布的故事。</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* D3 模板选择器:骨架铺上画布,空字段自带引导;opener 只进输入框不代发。 */}
      {tplOpen && (
        <div className="create-modal" onClick={() => setTplOpen(false)}>
          <div className="create-modal-card" role="dialog" aria-modal="true" aria-label="创作模板" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setTplOpen(false)} aria-label="关闭">×</button>
            <h2 className="t-h2">从模板起手 · {KINDS[ki].zh}</h2>
            <p className="create-seed-note t-meta">
              选一套骨架铺上画布:空字段自带引导,✦ 让 AI 补、✎ 自己写;开场指令会放进输入框,过目再发。
            </p>
            <div className="create-import-picks">
              {(TEMPLATES[kind] || []).map((t) => (
                <button key={t.id} className="create-import-pick" onClick={() => applyTemplate(t)}>
                  <span className="create-import-pick-t t-ui">
                    {t.name}
                    <span className="create-tpl-badge t-meta">{t.skeleton ? `${Object.keys(t.skeleton).length} 字段` : "纯引导"}</span>
                  </span>
                  <span className="create-import-pick-d t-meta">{t.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* D2 导入面板:把已有内容直接变成卡——粘贴文本(identify,会入库)/上传文档(现有链路)/
          酒馆卡(纯前端解析,不入库不耗额度)。两种口径都当面写清。 */}
      {importOpen && (
        <div className="create-modal" onClick={() => setImportOpen(null)}>
          <div className="create-modal-card" role="dialog" aria-modal="true" aria-label="导入成卡" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setImportOpen(null)} aria-label="关闭">×</button>
            <h2 className="t-h2">导入成卡 · {KINDS[ki].zh}</h2>
            {importOpen.step === "pick" ? (
              <>
                <p className="create-seed-note t-meta">把已有的内容直接变成一张卡,不用从零聊。</p>
                {/* F5:解析指示(可选)——AI 解析的两条路(粘贴/上传)都会带上;酒馆卡是本地解析,吃不到 */}
                <input
                  className="create-ask-line t-ui-sm"
                  value={importOpen.hint || ""}
                  onChange={(e) => setImportOpen((m) => ({ ...m, hint: e.target.value }))}
                  placeholder="解析要求(可空)——比如:重点抽性格和说话风格,标签用中文"
                />
                <div className="create-import-picks">
                  <button className="create-import-pick" onClick={() => setImportOpen((m) => ({ step: "paste", text: "", err: "", hint: (m && m.hint) || "" }))}>
                    <span className="create-import-pick-t t-ui">粘贴文本</span>
                    <span className="create-import-pick-d t-meta">散文设定 / 旧卡文字,AI 解析成卡(会同时收进你的卡库 · 私密)</span>
                  </button>
                  <button className="create-import-pick" onClick={() => { uploadHintRef.current = (importOpen && importOpen.hint) || ""; setImportOpen(null); fileRef.current && fileRef.current.click(); }}>
                    <span className="create-import-pick-t t-ui">上传文档</span>
                    <span className="create-import-pick-d t-meta">.txt / .md / .docx,抽出文字后同上(≤2MB)</span>
                  </button>
                  {kind === "characters" && (
                    <button className="create-import-pick" onClick={() => tavernRef.current && tavernRef.current.click()}>
                      <span className="create-import-pick-t t-ui">酒馆角色卡</span>
                      <span className="create-import-pick-d t-meta">SillyTavern 的 .json / PNG 内嵌卡——本地解析,不入库、不耗额度</span>
                    </button>
                  )}
                </div>
                {importOpen.err && <div className="create-import-err t-meta">{importOpen.err}</div>}
                <input ref={tavernRef} type="file" accept=".json,.png" hidden onChange={onTavernFile} />
              </>
            ) : (
              <>
                <p className="create-seed-note t-meta">
                  粘贴散文设定 / 旧卡文字,AI 解析成{KINDS[ki].zh};解析成功会同时把这张卡存进你的卡库(私密),可去「我的」删除。
                  超长文本(两万字以上)建议分段导入,或改挂「参考资料」。
                </p>
                <textarea
                  className="create-seed-ta t-ui-sm"
                  rows={10}
                  value={importOpen.text}
                  onChange={(e) => setImportOpen((m) => ({ ...m, text: e.target.value, err: "" }))}
                  placeholder="把设定粘进来……"
                />
                <input
                  className="create-ask-line t-ui-sm"
                  value={importOpen.hint || ""}
                  onChange={(e) => setImportOpen((m) => ({ ...m, hint: e.target.value }))}
                  placeholder="解析要求(可空)——比如:重点抽性格和说话风格,标签用中文"
                />
                <div className="create-seed-count t-meta">{importOpen.text.length} 字</div>
                {importOpen.err && <div className="create-import-err t-meta">{importOpen.err}</div>}
                <div className="create-seed-actions">
                  <Button variant="line" onClick={() => setImportOpen((m) => ({ step: "pick", text: "", err: "", hint: (m && m.hint) || "" }))}>返回</Button>
                  <Button variant="primary" onClick={importPaste} disabled={busy || !importOpen.text.trim()}>
                    {busy ? "解析中…" : "解析成卡"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 补素材 modal */}
      {libModal && (
        <div className="create-modal" onClick={() => setLibModal(null)}>
          <div className="create-modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setLibModal(null)} aria-label="关闭">×</button>
            <h2 className="t-h2">从卡库补「{KINDS[ki].zh}」素材</h2>
            <input
              className="create-lib-search"
              value={libQ}
              onChange={(e) => setLibQ(e.target.value)}
              placeholder="搜卡库:名字 / 简介…"
            />
            <div className="create-lib-list">
              {(() => {
                const s = libQ.trim().toLowerCase();
                const list = libModal.items.filter(
                  (it) => !s || (libName(it) + " " + libDesc(it)).toLowerCase().includes(s)
                );
                if (!libModal.items.length) return <p className="t-ui create-sub">这个分类的卡库还空着。</p>;
                if (!list.length) return <p className="t-ui create-sub">没有匹配的卡。换个关键词。</p>;
                {/* D4:行改双动作(按钮不能嵌按钮,行由 button 改 div)——加入本台=原样;改编成草稿=fork(·改) */}
                return list.map((it, i) => (
                  <div className="create-lib-item create-lib-item--row" key={i}>
                    <span className="create-lib-item-tx">
                      <span className="t-ui-sm">{libName(it)}</span>
                      <span className="t-meta">{libDesc(it).slice(0, 40)}</span>
                    </span>
                    <span className="create-lib-item-acts">
                      <button className="create-shelf-act" onClick={() => libAdd(it)}>加入本台</button>
                      <button
                        className="create-shelf-act"
                        onClick={() => {
                          if (forkToDraft(it)) setLibModal(null);
                        }}
                      >
                        改编成草稿
                      </button>
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* 查看本台已建的卡(细节③) */}
      {builtView && (
        <div className="create-modal" onClick={() => setBuiltView(false)}>
          <div className="create-modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setBuiltView(false)} aria-label="关闭">×</button>
            <h2 className="t-h2">本台已建的「{KINDS[ki].zh}」({desk.built.length})</h2>
            <div className="create-built-list">
              {desk.built.length ? (
                desk.built.map((card, i) => {
                  const c = (card && card.data) || card || {};
                  const nm = c.name || c.title || "未命名";
                  const entries = worldEntries(card);
                  return (
                    <div className="create-built-card" key={i}>
                      <div className="create-built-head">
                        <span className="create-built-name t-kai">{nm}</span>
                        {entries && <span className="create-built-count t-meta">{entries.length} 条条目</span>}
                        <button className="create-built-x create-built-export" onClick={() => exportCard(card)} title="下载为 JSON">导出</button>
                        <button className="create-built-x" onClick={() => removeBuilt(i)}>移除</button>
                      </div>
                      {entries ? (
                        <div className="create-built-entries">
                          {entries.slice(0, 12).map((e, j) => {
                            const label =
                              e.comment || (Array.isArray(e.keys) ? e.keys.join(" / ") : e.keys) || `条目 ${j + 1}`;
                            return (
                              <div className="create-built-entry" key={j}>
                                <span className="create-built-entry-k t-ui-sm">{label}</span>
                                {e.content && (
                                  <span className="create-built-entry-v t-meta">{String(e.content).slice(0, 120)}</span>
                                )}
                              </div>
                            );
                          })}
                          {entries.length > 12 && (
                            <div className="create-built-more t-meta">…… 还有 {entries.length - 12} 条</div>
                          )}
                        </div>
                      ) : (
                        <div className="create-built-fields">
                          {cardFields(card).slice(0, 6).map((f, j) => (
                            <div className="create-built-field" key={j}>
                              <span className="create-built-field-k t-meta">{f.k}</span>
                              <span className="create-built-field-v t-ui-sm">{f.v.slice(0, 80)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="t-ui create-sub">本台还没有已建的卡。聊出一张后点「收进本台」。</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 完善角色卡:立绘大图在上 + 头像圆居中名字在下 + 角色介绍可编辑,确认后 收进本台 / 收入卡库 */}
      {finalize && (
        <div className="create-modal" onClick={() => setFinalize(null)}>
          <div className="create-modal-card" role="dialog" aria-modal="true" aria-label="完善角色卡" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setFinalize(null)} aria-label="关闭">×</button>
            <h2 className="t-h2">完善角色卡</h2>
            {/* 立绘大图在上(主视觉,单独放大) */}
            <div className="ct-finalize-portrait">
              <ImageCropField
                label="立绘(主图)"
                hint="详情页 / 看板 / 纯聊右侧"
                value={desk.draft.image || ""}
                aspect={2 / 3}
                output={{ maxW: 768, maxH: 1152, quality: 0.82 }}
                onChange={(url) => setDraftPic("image", url)}
              />
            </div>
            {/* 头像居中 + 名字在头像下方 */}
            <div className="ct-finalize-avatar">
              <ImageCropField
                label="头像"
                hint="纯聊圆头像"
                value={desk.draft.avatar || ""}
                aspect={1}
                round
                output={{ maxW: 256, maxH: 256, quality: 0.85 }}
                onChange={(url) => setDraftPic("avatar", url)}
              />
              <div className="ct-finalize-name t-kai">{draftName}</div>
            </div>
            <div className="create-preview-introhead">
              <span className="t-h3">角色介绍</span>
              <button className="create-gen-btn" disabled={genBusy} onClick={genIntro}>
                {genBusy ? "生成中…" : "自动生成"}
              </button>
            </div>
            {/* F3:生成的口味指示(可空)——回车即生成 */}
            <input
              className="create-ask-line t-ui-sm"
              value={introAsk}
              disabled={genBusy}
              placeholder="对介绍的要求(可空)——比如:第一人称、带点自嘲"
              onChange={(e) => setIntroAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !(e.nativeEvent || e).isComposing && !genBusy) {
                  e.preventDefault();
                  genIntro();
                }
              }}
              aria-label="对角色介绍的要求"
            />
            {/* 角色介绍可直接编辑 */}
            <textarea
              className="ct-finalize-introedit"
              rows={4}
              value={desk.draft.description || ""}
              onChange={(e) => setDraftDesc(e.target.value)}
              placeholder="写角色介绍,或点「自动生成」让 AI 按已填设定写一段。"
            />
            {/* 钉在弹窗可视底边:矮屏下内容超出 84vh 时主 CTA 不再沉到折叠线下(YOR-148) */}
            <div className="ct-finalize-footer">
              <Button variant="primary" full onClick={confirmFinalize}>
                {finalize.action === "desk" ? "确认收进本台" : "确认收入卡库 · 私密"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 预览并发布:在预览里直接改文字 + 传封面 + 就地发布(取消了独立发布弹窗) */}
      {previewOpen && (
        <div className="create-preview-overlay">
          <div className="create-preview-bar">
            <span className="t-meta">预览并发布 · 下面可改文字 / 传封面,满意就发布</span>
            <button className="create-preview-close" onClick={closePreview} aria-label="关闭">关闭 ×</button>
          </div>
          <div className="create-preview-scroll">
            <div className="ct-pub-edit">
              <label className="ct-pub-label t-ui-sm">故事名</label>
              <input className="ct-pub-input" value={pub.name} onChange={(e) => setPub((p) => ({ ...p, name: e.target.value }))} placeholder="给这个故事起个名字" />
              <label className="ct-pub-label t-ui-sm">封面(可空,留空按故事名占位)</label>
              <div className="create-pub-cover">
                <button type="button" className="create-pub-cover-thumb" style={pub.cover ? { backgroundImage: `url("${pub.cover}")` } : undefined} onClick={() => coverRef.current && coverRef.current.click()} title="上传封面">
                  {!pub.cover && <span className="t-meta">+ 上传封面</span>}
                </button>
                <input ref={coverRef} type="file" accept="image/*" hidden onChange={onCoverUpload} />
                {pub.cover && (
                  <button type="button" className="create-pub-cover-clear t-meta" onClick={() => setPub((p) => ({ ...p, cover: "" }))}>清除封面</button>
                )}
              </div>
              <label className="ct-pub-label t-ui-sm">简介(可空)</label>
              <textarea className="ct-pub-syn" rows={3} value={pub.synopsis} onChange={(e) => setPub((p) => ({ ...p, synopsis: e.target.value }))} placeholder="一句话介绍这个故事……" />
              <label className="ct-pub-label t-ui-sm">作者的话(可空)</label>
              <textarea className="ct-pub-syn" rows={3} value={pub.authorNote} onChange={(e) => setPub((p) => ({ ...p, authorNote: e.target.value }))} placeholder="想对玩家说的话、创作初衷……" />
              {(() => {
                const mf = publishManifest();
                return (
                  <div className="ct-pub-manifest">
                    <div className="ct-pub-manifest-h t-ui-sm">本次将公开(发布 = 进探索 · 公开):</div>
                    <ul className="ct-pub-manifest-list t-meta">
                      <li>
                        角色卡 ×{mf.chars.length}
                        {mf.chars.length > 0 && ":" + mf.chars.map((c) => c.name + (c.secret ? " ⚠" : "")).join("、")}
                      </li>
                      {mf.worlds > 0 && <li>设定卡 · 世界书 ×{mf.worlds}</li>}
                      {mf.players.length > 0 && <li>演出卡 ×{mf.players.length}:{mf.players.join("、")}</li>}
                      {mf.story && (
                        <li>
                          故事书:{mf.story}
                          {mf.storyExtra > 0 && `(只发这一张;台上另有 ${mf.storyExtra} 张故事书不会发布)`}
                        </li>
                      )}
                    </ul>
                    {mf.anySecret && (
                      <div className="ct-pub-manifest-warn t-meta">
                        ⚠ 标记的卡带「隐藏真相」等隐藏字段,会随卡一起公开。确认这些都是本次要发布的卡——若混进了别的故事的卡,回「查看本台已建」移除。
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="ct-pub-divider t-meta">↓ 下面是发布后玩家看到的详情页(实时跟着上面变)</div>
            </div>
            <div className="page detail">
              <StoryHero preset={buildPreviewPreset()} onOpenChar={setPreviewChar} />
              <div className="create-preview-foot t-meta">(发布后玩家在这里选扮演角色、入局)</div>
            </div>
          </div>
          <div className="ct-pub-foot">
            <Button variant="primary" full disabled={busy || !pub.name.trim() || !hasChars} onClick={publish}>
              {busy ? "发布中…" : "发布到探索 · 公开"}
            </Button>
          </div>
          <CharDetailModal model={previewChar} onClose={() => setPreviewChar(null)} />
        </div>
      )}
    </div>
  );
}
