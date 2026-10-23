import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "../lib/transitionNav";
import { Button } from "../components/ui";
import { postJSON, getJSON, uploadFile } from "../lib/api";
import { fileToCompressedDataURL } from "../lib/image";
import ImageCropField from "../components/ImageCropField";
import StoryHero from "../components/StoryHero";
import CharDetailModal from "../components/CharDetailModal";
import { parseJsonCard, parsePngCard } from "../lib/tavernCard"; // D2 酒馆卡纯前端解析
import { TEMPLATES, getTpl, STARTER_IDS } from "./createTemplates"; // D3 创作模板(文案归内容侧,来源 card-templates/)
import { loadPrompts, addPrompt, removePrompt } from "../lib/promptLib"; // F1 提示词库(localStorage)
import { cardToRefText, makeRef } from "../lib/refText"; // F2 卡→引用文本(refs 通道)
import { useAuth } from "../state/auth";
import LineSidebar from "../components/react-bits/line-sidebar"; // rail=LineSidebar 完整复刻(2026-07-13 主理人拍板)
import StaggeredText from "../components/staggered-text"; // R1 观感:空板标题逐字浮现
import BlurHighlight from "../components/react-bits/blur-highlight"; // R1 观感:机制说明行高亮「触发词」
import CountUp from "../components/react-bits/count-up"; // R2 观感:完整度数字 spring 滚动
import ShinyText from "../components/react-bits/shiny-text"; // R2 观感:鎏金扫光(只上 toast 转瞬场合)
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
  // sub 是卡种一句话定位(P1a 一眼懂层):新建菜单/空板/落卡菜单/聚焦卡头四处消费,只此一处定义。
  { zh: "Character", k: "characters", sub: "A character the AI plays", ph: "Describe this character: identity, personality, background", opening: "Describe the character you want to create: identity, personality, background. Once there's enough detail, a full character card will be generated." },
  { zh: "Player Card", k: "players", sub: "The lead you play", ph: "Describe the lead you'll play", opening: "Describe the lead you'll play: identity, backstory, and goal for this playthrough." },
  { zh: "Lore Card · World Book", k: "worlds", sub: "The world's rulebook; entries appear on trigger words", ph: "Describe this world's rules and setting", opening: "Describe this world: core rules, key locations, factions." },
  { zh: "Story Book", k: "stories", sub: "The script: opening, beats, ending", ph: "Describe this story's premise and conflict", opening: "Describe this story: premise, core conflict, rough direction." },
];
const OPENINGS = Object.fromEntries(KINDS.map((t) => [t.k, t.opening]));
// 空台引子(桌面 reskin):点一下把句子放进输入框(不代发,用户过目再发),降低冷启动门槛。
const SUGGESTS = {
  characters: ["A silver-haired girl working at a bookshop on rainy nights", "A lying con artist with a soft heart", "A butler robot from the future who can't lie"],
  players: ["A modern med student who just got transported to another world", "A swordsman of the fallen dynasty living under a false name", "The only co-pilot still awake on a starship"],
  worlds: ["A coastal town after spiritual energy returns", "Nine islands floating on a sea of clouds", "A hidden market at the end of the subway line"],
  stories: ["A farewell in a locked room on a snowy night", "The world resets in three days, and only you remember", "An old life-for-a-life pact signed in a teahouse"],
};
const IDENTIFY_EP = {
  characters: "/api/identify",
  worlds: "/api/identify_world",
  stories: "/api/identify_story",
  players: "/api/identify_player",
};
const LABELS = {
  description: "Summary", personality: "Personality", scenario: "Scenario", first_mes: "Opening line",
  mes_example: "Example dialogue", speech_rules: "Speech rules", appearance: "Appearance", look: "Appearance",
  persona: "Persona", goals: "Goals", secret: "Hidden truth", background: "Background", voice: "Verbal tics",
  premise: "Premise", title: "Title", entries: "Entries", role: "Role", tags: "Tags",
  content: "Content", comment: "Entry", keys: "Keywords", source: "Source",
  timeline: "Timeline", events: "Beats (trigger events)", main: "Main plot", main_plot: "Main plot", anchor: "Anchor", tension: "Conflict",
  // P1b 演出卡起手骨架的键(src/models.py PlayerCard),别裸奔英文
  opening: "Act One", abilities: "Can do", constraints: "Can't do", known_facts: "Known at start", unknown: "Unknown at start",
  // C5 补:引擎新骨架带的键,别再裸奔英文
  known_public: "Public facts", known_hidden: "Hidden facts", versions: "Versions", relationships: "Relationships",
};
const STORE_KEY = "ais_create_desks_v1";
const KI_KEY = "ais_create_ki_v1"; // 记住当前卡种 tab(YOR-200)
// 这些 key 不当文本字段渲染:name/title 已在卡名展示;avatar/image/cover 是图(base64 data-URI),
// 只走缩略图,别把 base64 大串当普通字段铺进预览(#92 上传图后的回归)。
const NON_FIELD_KEYS = ["name", "character_id", "id", "title", "avatar", "image", "cover", "_bid"];

// H0 稳定 id:built 卡的长期身份(视图层用:板上坐标/选中/聚焦全挂它,数组下标退役)。
// _bid 只活在 desks.built 里;导出/发布/改编/引用等出口一律 stripBid,不污染卡数据。
const newBid = () => "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const withBid = (card) => (card && card._bid ? card : { ...(card || {}), _bid: newBid() });
function stripBid(card) {
  if (!card || !card._bid) return card;
  const { _bid, ...rest } = card;
  return rest;
}

// 把任意卡字段值渲染成可读文本。根治世界书 entries / 故事书 timeline 这类"对象数组"
// 被 v.join("、") 渲染成「[object Object]、[object Object]…」的 bug(细节⑤)。
function fmtVal(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (!v.length) return "";
    if (v.every((x) => typeof x === "string" || typeof x === "number")) return v.join(", ");
    const lines = v.slice(0, 8).map((x, i) => {
      if (x && typeof x === "object") {
        const label =
          x.comment || (Array.isArray(x.keys) ? x.keys.join("/") : x.keys) || x.name || x.title || `Entry ${i + 1}`;
        const body = x.content || x.description || x.summary || "";
        return body ? `${label}: ${body}` : String(label);
      }
      return String(x);
    });
    if (v.length > 8) lines.push(`…(${v.length} total)`);
    return lines.join("\n");
  }
  if (typeof v === "object") {
    return Object.entries(v)
      .map(([k, val]) => `${LABELS[k] || k}: ${typeof val === "string" ? val : Array.isArray(val) ? val.join(", ") : JSON.stringify(val)}`)
      .join("; ");
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
    messages: [{ who: "ai", text: OPENINGS[kk] || "Pick a card type, then describe what you want to create." }],
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
    name: "Combined World Book",
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
  const [desks, setDesks] = useState(() => {
    // H0:老 built 卡补稳定 _bid——同步于首渲初始化器,不走 mount effect
    // (effect 版会造成首帧无 id 的 key 兜底撞车 + 与坐标持久化 effect 的写序竞态)。
    const ds = loadDesks();
    for (const t of KINDS) {
      const b = ds[t.k] && ds[t.k].built;
      if (b && b.some((c) => !c || !c._bid)) ds[t.k] = { ...ds[t.k], built: b.map(withBid) };
      // 文案迁移:老数据里持久化的旧开场白(仅当它是台上唯一一条消息时)换成现行直白版
      const d = ds[t.k];
      if (d && d.messages && d.messages.length === 1 && d.messages[0].who === "ai" && d.messages[0].text !== t.opening) {
        ds[t.k] = { ...ds[t.k], messages: [{ who: "ai", text: t.opening }] };
      }
    }
    return ds;
  });
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
  // R3 模板卡叠(主理人试样拍板):选择器从按钮列表换点击翻卡;order=当前叠序,leaving=顶卡退场中。
  // ⚠ 重置 effect 在 applyTemplate 旁(kind 在下方才声明,deps 引用这里会 TDZ——aiPos 旧坑同款)
  const [tplOrder, setTplOrder] = useState([]);
  const [tplLeaving, setTplLeaving] = useState(false);
  // D4 「从我发布的故事继续」:presets 列表弹层({items}|null),选一条拆回四台 built。
  const [presetsModal, setPresetsModal] = useState(null);
  // F2 引用体系:desks[kind].refs 可选键(挂台常驻,每轮请求都带,纸签可摘;后端上限 4 条)。
  // 面板 tab:desk=桌上的卡(四台 built+draft) / lib=我的卡库(四 kind 可切) / prompt=提示词库。
  const [refPanel, setRefPanel] = useState(null); // null | {tab, kk, items, loading, err}
  const [prompts, setPrompts] = useState(loadPrompts);
  const [promptDraft, setPromptDraft] = useState(""); // 「存为提示词」输入(提示词 tab 内)
  const [refDragOver, setRefDragOver] = useState(false); // F4 拖拽接收态(命令条区)
  // F7 画布重排:产出侧 240px 列退场,收编成画布顶部台账线;弹层 null|'bind'|'menu'。
  const [ledgerPop, setLedgerPop] = useState(null);
  // F8 画布即主界面:助手退成画布底一条命令条;完整对话历史收进抽屉(chatOpen)。
  const [chatOpen, setChatOpen] = useState(false);
  // G0 Lovart 式全屏画板:四台物料全部投影成可拖卡片;单击选中(切 ki,选中即聊)、双击聚焦编辑。
  // H0 起 sel/focus = { kk, id },id="d:<kind>"(该台 draft)| "b:<_bid>"(built 卡);null=无。
  // 下标退役:built 增删/换序不再让选中与坐标张冠李戴。
  const [boardSel, setBoardSel] = useState(null);
  const [boardFocus, setBoardFocus] = useState(null);
  // H0 卡片坐标(视图层,不进 desks——回滚=删 ais_create_board_v2,v1 原样保留):{ "d:<kind>"|"b:<bid>": {x, y} }
  // v2 不存在时在初始化器里同步从 v1 迁移(v1 的下标 key 解析到上面刚补好的 _bid);
  // 必须在 useState 初始化器做:持久化 effect 挂载即写 v2,mount effect 版会被空对象抢先。
  const [boardPos, setBoardPos] = useState(() => {
    try {
      const raw = localStorage.getItem("ais_create_board_v2");
      if (raw) {
        const v = JSON.parse(raw);
        if (!v || typeof v !== "object") return {};
        const { __view, __ai, ...cards } = v; // __view/__ai 是视口与 sidebar 位置保留键,不是卡坐标
        return cards;
      }
      const v1 = JSON.parse(localStorage.getItem("ais_create_board_v1") || "{}") || {};
      const v2 = {};
      for (const [k, p] of Object.entries(v1)) {
        if (!p || typeof p.x !== "number") continue;
        const m = /^built:([^:]+):(\d+)$/.exec(k);
        if (m) {
          const c = ((desks[m[1]] || {}).built || [])[Number(m[2])];
          if (c && c._bid) v2["b:" + c._bid] = p;
        } else if (k.startsWith("draft:")) {
          v2["d:" + k.slice(6)] = p;
        }
      }
      return v2;
    } catch {
      return {};
    }
  });
  // H1 视口(pan/zoom):世界坐标系=卡坐标;屏幕→世界 = (screen - pan) / z。
  // 手势中 viewRef 为真源、rAF 直写 world 元素 transform(零 React 重渲),手势结束才 commit 到 state;
  // 持久化与卡坐标同住 ais_create_board_v2 的保留键 __view(红线:视图态只此一处)。
  const Z_MIN = 0.25, Z_MAX = 2;
  const clampZ = (z) => Math.min(Z_MAX, Math.max(Z_MIN, z));
  const [view, setView] = useState(() => {
    try {
      const v = (JSON.parse(localStorage.getItem("ais_create_board_v2") || "{}") || {}).__view;
      if (v && typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number") {
        return { x: v.x, y: v.y, z: clampZ(v.z) };
      }
    } catch {}
    return { x: 0, y: 0, z: 1 };
  });
  // sidebar 位置(可拖动,I 系列)——声明必须在下方 persist effect 之前(deps 引用,TDZ)
  const [aiPos, setAiPos] = useState(() => {
    try {
      const p = (JSON.parse(localStorage.getItem("ais_create_board_v2") || "{}") || {}).__ai;
      if (p && typeof p.x === "number" && typeof p.y === "number") return p;
    } catch {}
    return { x: 0, y: 0 };
  });
  const viewRef = useRef(view);
  const worldRef = useRef(null);
  const boardElRef = useRef(null);
  const viewRafRef = useRef(0);
  const viewCommitT = useRef(null);
  const panRef = useRef(null); // {sx, sy, bx, by} 板平移手势
  const spaceRef = useRef(false); // Space 按住=抓手(输入框内不劫持)
  function applyViewNow() {
    const el = worldRef.current;
    if (!el) return;
    const v = viewRef.current;
    el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
  }
  function scheduleViewApply() {
    if (viewRafRef.current) return;
    viewRafRef.current = requestAnimationFrame(() => {
      viewRafRef.current = 0;
      applyViewNow();
    });
  }
  function commitViewSoon(ms = 200) {
    clearTimeout(viewCommitT.current);
    viewCommitT.current = setTimeout(() => setView({ ...viewRef.current }), ms);
  }
  useEffect(() => {
    viewRef.current = view;
    applyViewNow();
  }, [view]);
  useEffect(() => {
    try {
      localStorage.setItem("ais_create_board_v2", JSON.stringify({ ...boardPos, __view: view, __ai: aiPos }));
    } catch (e) {}
  }, [boardPos, view, aiPos]);
  // wheel 要 preventDefault,React 合成 wheel 在根上是 passive——必须原生监听。
  // 约定:ctrl/cmd+wheel(含触控板捏合)=对准光标缩放;裸 wheel=平移。
  useEffect(() => {
    const el = boardElRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const nz = clampZ(v.z * Math.exp(-e.deltaY * 0.0015));
        viewRef.current = { x: mx - ((mx - v.x) * nz) / v.z, y: my - ((my - v.y) * nz) / v.z, z: nz };
      } else {
        viewRef.current = { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
      }
      scheduleViewApply();
      commitViewSoon();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);
  // Space=抓手(光标态直改 class,不走 React);输入框/编辑态不劫持。
  useEffect(() => {
    const typing = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const down = (e) => {
      if (e.code !== "Space" || e.repeat || typing(e.target)) return;
      spaceRef.current = true;
      if (boardElRef.current) {
        boardElRef.current.classList.add("is-pan");
        e.preventDefault(); // 只在板上生效时挡滚动
      }
    };
    const up = (e) => {
      if (e.code !== "Space") return;
      spaceRef.current = false;
      boardElRef.current && boardElRef.current.classList.remove("is-pan");
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);
  // H3 快捷键:⌘·Ctrl+0 适配全部 / 1-4 新建·继续四卡种(V/H 随选择/抓手工具退役,2026-07-13)。
  // 守卫:输入态与任何弹层/聚焦态下不劫持(Esc 另有专职监听)。
  const kbdBlocked =
    !!boardFocus || !!finalize || !!importOpen || seedOpen || !!refPanel || !!libModal ||
    builtView || previewOpen || !!presetsModal || tplOpen || chatOpen;
  useEffect(() => {
    if (isMobile) return;
    const typing = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const onKey = (e) => {
      if (typing(e.target) || kbdBlocked || e.altKey) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "0") {
        e.preventDefault();
        fitAllCards();
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k >= "1" && k <= "4") newCardOf(KINDS[Number(k) - 1].k);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, kbdBlocked]);
  // 2026-07-13 主理人拍板:选择/抓手工具退役——左键=选择,右键(或中键/Space+左键)拖=平移画布。
  const [railNew, setRailNew] = useState(false); // rail「新建」飞出菜单(四卡种全名,可拖出落卡)
  const [ctrlHint, setCtrlHint] = useState(true); // 每次进创作页都提示一次操作方式(主理人拍板)
  useEffect(() => {
    const t = setTimeout(() => setCtrlHint(false), 9000);
    return () => clearTimeout(t);
  }, []);
  // ── I 系列(主理人审核拍板):AI 统一入口=长按——按住任何 AI 可作用的对象,
  //    朱砂环沿模块四周描边生长(550ms),满环即开 AI 对话 sidebar;要改的对象同时进聚焦。
  //    旧入口(✦/⟳ 指示行/批注笺/对话抽屉/dock 批注行)全部退役,对话住右侧 sidebar。 ──
  const [aiOpen, setAiOpen] = useState(false);
  const [aiCtx, setAiCtx] = useState(null); // null=卡级对话 | {type:"field", f}=字段定向 | {type:"built"}=成品卡提示
  // sidebar 可拖动(主理人反馈):header 按住拖,直写 transform;松手 commit 进 ais_create_board_v2.__ai;双击复位
  const aiElRef = useRef(null);
  const aiDragRef = useRef(null);
  function onAiHeadDown(e) {
    if (e.button !== 0 || e.target.closest("button")) return;
    aiDragRef.current = { sx: e.clientX, sy: e.clientY, bx: aiPos.x, by: aiPos.y };
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onAiHeadMove(e) {
    const d = aiDragRef.current;
    if (!d || !aiElRef.current) return;
    d.nx = d.bx + (e.clientX - d.sx);
    d.ny = d.by + (e.clientY - d.sy);
    aiElRef.current.style.transform = `translate(${d.nx}px, ${d.ny}px)`; // 直写零重渲
  }
  function onAiHeadUp() {
    const d = aiDragRef.current;
    aiDragRef.current = null;
    if (d && typeof d.nx === "number") setAiPos({ x: d.nx, y: d.ny });
  }
  const LP_MS = 550;
  const lpRef = useRef(null); // {iv, ring}
  const lpFiredRef = useRef(false); // 满环后的 pointerup/click 不再当单击
  // 长按反馈=C·描金一圈(2026-07-13 主理人四案试样拍板,换掉按压点 conic 环):
  // 鎏金线沿目标模块圆角自描一周(pathLength 归一,大小卡进度节奏一致),画满即「封印」触发;
  // 松手=描线快速回退,按满=朱砂+鎏金溅墨收拍、模块弹回。零新依赖。
  function lpSpark(host) {
    for (let i = 0; i < 10; i++) {
      const s = document.createElement("i");
      s.className = "create-lpspark";
      s.style.background = i % 2 ? "var(--accent-3)" : "var(--accent-bright)";
      host.appendChild(s);
      const a = (i / 10) * 2 * Math.PI;
      const deg = (a * 180) / Math.PI + 90;
      s.animate(
        [
          { transform: `translate(${Math.cos(a) * 14}px, ${Math.sin(a) * 14}px) rotate(${deg}deg) scaleY(1)`, opacity: 1 },
          { transform: `translate(${Math.cos(a) * 42}px, ${Math.sin(a) * 42}px) rotate(${deg}deg) scaleY(0.3)`, opacity: 0 },
        ],
        { duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
  }
  function lpCancel(fired = false) {
    const l = lpRef.current;
    if (!l) return;
    lpRef.current = null;
    clearInterval(l.iv);
    cancelAnimationFrame(l.raf);
    l.el.classList.remove("is-pressing");
    if (fired) {
      l.wrap.classList.add("is-done");
      lpSpark(l.wrap);
    } else {
      l.rect.style.transition = "stroke-dashoffset 0.16s var(--ease-out)";
      l.rect.style.strokeDashoffset = 100;
      l.wrap.classList.add("is-out");
    }
    setTimeout(() => l.wrap.remove(), fired ? 460 : 190);
  }
  function lpStart(el, e, onFire) {
    lpCancel();
    el.classList.add("is-pressing"); // 先上按压态再量圆角(字段的圆角在按压态里才有)
    const b = el.getBoundingClientRect();
    const scale = el.offsetWidth ? b.width / el.offsetWidth : 1; // 画布缩放下屏上圆角=样式圆角×zoom
    const rad = (parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0) * scale;
    const wrap = document.createElement("div");
    wrap.className = "create-lptrace";
    wrap.style.cssText = `left:${b.left}px;top:${b.top}px;width:${b.width}px;height:${b.height}px`;
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", 1);
    rect.setAttribute("y", 1);
    rect.setAttribute("width", Math.max(0, b.width - 2));
    rect.setAttribute("height", Math.max(0, b.height - 2));
    rect.setAttribute("rx", Math.max(0, rad - 1));
    rect.setAttribute("pathLength", 100);
    svg.appendChild(rect);
    wrap.appendChild(svg);
    document.body.appendChild(wrap);
    const t0 = performance.now();
    const paint = () => {
      const p = Math.min(1, (performance.now() - t0) / LP_MS);
      rect.style.strokeDashoffset = 100 - p * 100;
      return p;
    };
    const tick = () => {
      const l = lpRef.current;
      if (!l || l.wrap !== wrap) return;
      if (paint() >= 1) {
        lpFiredRef.current = true;
        lpCancel(true);
        onFire();
        return;
      }
      l.raf = requestAnimationFrame(tick);
    };
    lpRef.current = {
      wrap,
      rect,
      el,
      raf: requestAnimationFrame(tick),
      // rAF 节流环境兜底:低频补帧+保证触发
      iv: setInterval(() => {
        const l = lpRef.current;
        if (!l || l.wrap !== wrap) return;
        if (paint() >= 1) {
          lpFiredRef.current = true;
          lpCancel(true);
          onFire();
        }
      }, 80),
    };
  }
  // 长按路由:卡=选中+(草稿)聚焦+开对话;字段=切字段语境+开对话
  function openAiForCard(bc) {
    selectCard(bc);
    if (bc.isDraft) {
      setAiCtx(null);
      setBoardFocus({ kk: bc.kk, id: bc.id });
      enterFocusCamera(boardCardPos(bc, bc.kSeq));
    } else {
      setAiCtx({ type: "built" });
    }
    setAiOpen(true);
    setTimeout(() => dockInputRef.current && dockInputRef.current.focus(), 60);
  }
  function openAiForField(f) {
    setAiCtx({ type: "field", f });
    setAiOpen(true);
    setTimeout(() => dockInputRef.current && dockInputRef.current.focus(), 60);
  }
  // sidebar 发送:字段语境=定向指令(可空发送=默认写法,单发即清语境);卡级=原 send 管线
  function aiSend() {
    if (busy) return;
    const text = (desk.input || "").trim();
    if (aiCtx && aiCtx.type === "field") {
      const f = aiCtx.f;
      patch(kind, { input: "" });
      setAiCtx(null);
      sendFieldDirective(f, f.empty ? "fill" : "rewrite", text);
      return;
    }
    if (!text) return;
    send();
  }
  function onBoardPointerDown(e) {
    // 平移=右键/中键拖,或 Space+左键拖(左键留给选择/拖卡)
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceRef.current)) {
      const t = e.target;
      if (e.button === 2 && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; // 输入区右键留给系统粘贴菜单
      panRef.current = { sx: e.clientX, sy: e.clientY, bx: viewRef.current.x, by: viewRef.current.y };
      e.preventDefault();
      boardElRef.current && boardElRef.current.classList.add("is-pan"); // 手势中抓手光标+卡不截胡
      try {
        e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }
    if (e.target === e.currentTarget || (worldRef.current && e.target === worldRef.current)) {
      // 点空白:收 rail 飞出/落卡菜单 → 退聚焦(拉回视口)→ 取消选中(逐层,同 Esc 口径)
      if (railNew) setRailNew(false);
      if (spawnAt) setSpawnAt(null);
      else if (boardFocus) exitFocus();
      else setBoardSel(null);
    }
  }
  function onBoardPointerMove(e) {
    const p = panRef.current;
    if (!p) return;
    viewRef.current = { ...viewRef.current, x: p.bx + (e.clientX - p.sx), y: p.by + (e.clientY - p.sy) };
    scheduleViewApply();
  }
  function onBoardPointerEnd() {
    if (!panRef.current) return;
    panRef.current = null;
    if (!spaceRef.current && boardElRef.current) boardElRef.current.classList.remove("is-pan"); // Space 仍按着=光标态留给 keyup 收
    dragEndAtRef.current = performance.now(); // pan 刚结束的 dblclick 不当「双击空白落卡」
    setView({ ...viewRef.current });
  }
  // ── H6 空白起草:双击空白=四卡种落卡菜单;rail 拖出/文件拖入=按位置落 ──
  const [spawnAt, setSpawnAt] = useState(null); // {x, y} 世界坐标 | null
  const [boardDragOver, setBoardDragOver] = useState(false);
  function screenToWorld(clientX, clientY) {
    const r = boardElRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.z, y: (clientY - r.top - v.y) / v.z };
  }
  // 该台还没聊开=把 draft 卡落在指定位置;已有构思/草稿=不搬卡,只跳过去(newCardOf 会选中聚焦)
  function spawnDraftAt(kk, wpos) {
    const dd = desks[kk];
    const has =
      Object.keys(dd.draft || {}).length > 0 || dd.messages.length > 1 ||
      (dd.questions || []).length > 0 || (dd.blueprint || []).length > 0;
    if (!has) {
      setBoardPos((p) => ({ ...p, ["d:" + kk]: { x: Math.max(0, wpos.x - 112), y: Math.max(0, wpos.y - 20) } }));
    }
    setSpawnAt(null);
    newCardOf(kk);
  }
  function onBoardDblClick(e) {
    if (e.target !== e.currentTarget && e.target !== worldRef.current) return; // 只认空白
    if (performance.now() - dragEndAtRef.current < 300) return; // 拖拽/平移刚结束=误触,不落卡
    setSpawnAt(screenToWorld(e.clientX, e.clientY));
  }
  const dtHasSpawnOrFiles = (e) => {
    const t = e.dataTransfer && e.dataTransfer.types;
    return !!t && ([...t].includes("application/x-ais-spawn") || [...t].includes("Files"));
  };
  function onBoardDragOver(e) {
    if (!dtHasSpawnOrFiles(e)) return; // 其它载荷(如卡引用 MIME)不接,不高亮——误触不落卡
    e.preventDefault();
    if (!boardDragOver) setBoardDragOver(true);
  }
  function onBoardDrop(e) {
    const dt = e.dataTransfer;
    setBoardDragOver(false);
    if (!dt) return;
    const wpos = screenToWorld(e.clientX, e.clientY);
    const spawnKk = dt.getData("application/x-ais-spawn");
    if (spawnKk && KINDS.some((t) => t.k === spawnKk)) {
      e.preventDefault();
      spawnDraftAt(spawnKk, wpos);
      return;
    }
    const file = dt.files && dt.files[0];
    if (!file) return; // 无合法载荷=不落卡
    e.preventDefault();
    // 文件按类型分流:酒馆卡(.json/.png)→ 角色台本地解析;文档(.txt/.md/.docx)→ 当前台 identify。
    // 卡落在 drop 位置(该台未聊开才搬坐标,口径同 spawnDraftAt);导入被取消时坐标改动无卡可见,无感。
    const isTavern = /\.(json|png)$/i.test(file.name);
    const kk = isTavern ? "characters" : kind;
    const dd = desks[kk];
    const has =
      Object.keys(dd.draft || {}).length > 0 || dd.messages.length > 1 ||
      (dd.questions || []).length > 0 || (dd.blueprint || []).length > 0;
    if (!has) {
      setBoardPos((p) => ({ ...p, ["d:" + kk]: { x: Math.max(0, wpos.x - 112), y: Math.max(0, wpos.y - 20) } }));
    }
    const fakeEv = { target: { files: [file], value: "" } };
    if (isTavern) {
      const i = KINDS.findIndex((t) => t.k === "characters");
      if (i >= 0) setKi(i);
      onTavernFile(fakeEv);
    } else {
      onUpload(fakeEv);
    }
  }
  // 缩放控件:± 以板中心为锚;% 点击=回 100%;「适配」=装下全部卡。
  function zoomTo(nz, anchor) {
    const el = boardElRef.current;
    const v = viewRef.current;
    nz = clampZ(nz);
    let ax = 0, ay = 0;
    if (el) {
      const r = el.getBoundingClientRect();
      ax = anchor ? anchor.x : r.width / 2;
      ay = anchor ? anchor.y : r.height / 2;
    }
    viewRef.current = { x: ax - ((ax - v.x) * nz) / v.z, y: ay - ((ay - v.y) * nz) / v.z, z: nz };
    applyViewNow();
    setView({ ...viewRef.current });
  }
  function fitAllCards() {
    const el = boardElRef.current;
    if (!el || !boardCards.length) {
      viewRef.current = { x: 0, y: 0, z: 1 };
      applyViewNow();
      setView({ x: 0, y: 0, z: 1 });
      return;
    }
    const CW = 224, CH = 160;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    boardCards.forEach((bc) => {
      const p = boardCardPos(bc, bc.kSeq);
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + CW); y1 = Math.max(y1, p.y + CH);
    });
    const r = el.getBoundingClientRect();
    const pad = 48;
    const z = clampZ(Math.min((r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0), 1));
    viewRef.current = {
      x: (r.width - (x1 - x0) * z) / 2 - x0 * z,
      y: (r.height - (y1 - y0) * z) / 2 - y0 * z,
      z,
    };
    applyViewNow();
    setView({ ...viewRef.current });
  }
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
        flash("Draft too large to autosave (usually the portrait images); a refresh may lose it. Use fewer images, or publish / save to the Card Library soon.");
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
  // F8:助手最新一句(构思期长在画布上;落笔期在 dock 批注行)。
  const lastAi = [...desk.messages].reverse().find((m) => m.who !== "你") || null; // i18n: kept, logic literal ("你" = user message marker, persisted)

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
      flash(`"${r.label}" is already attached`);
      return;
    }
    if (cur.length >= 4) {
      flash("Up to 4 references at a time (remove one to add another)");
      return;
    }
    patch(kind, { refs: [...cur, r] });
    setRefPanel(null);
    flash(`Referencing "${r.label}" — the AI will consult it every turn. Remove it anytime.`);
  }
  function removeRef(label) {
    patch(kind, (d0) => ({ refs: (Array.isArray(d0.refs) ? d0.refs : []).filter((x) => x.label !== label) }));
  }
  function refFromCard(kk, card) {
    const c = stripBid((card && card.data) || card || {}); // H0:视图 id 不进 prompt
    const nm = c.name || c.title || "Untitled";
    const zh = (KINDS.find((t) => t.k === kk) || {}).zh || "Card";
    return makeRef("card", zh + " · " + nm, cardToRefText(kk, c));
  }
  async function openRefPanel(tab = "desk", kk = kind) {
    if (tab === "lib") {
      setRefPanel({ tab, kk, items: [], loading: true });
      try {
        const items = await getJSON("/api/library/" + kk);
        setRefPanel((p) => (p && p.tab === "lib" ? { ...p, kk, items: Array.isArray(items) ? items : [], loading: false } : p));
      } catch (e) {
        setRefPanel((p) => (p && p.tab === "lib" ? { ...p, loading: false, err: "Failed to load library: " + e.message } : p));
      }
    } else {
      setRefPanel({ tab, kk, items: [], loading: false });
    }
  }

  // ── G0 画板:四台物料投影成卡片对象;选中即聊(切 ki),双击聚焦 ──
  // draft 卡挂板条件:画布有货或聊开了(全新空台不挂,避免四张空白卡糊板)。
  const boardCards = KINDS.flatMap((t) => {
    const d = desks[t.k];
    const out = [];
    const draftHas =
      Object.keys(d.draft || {}).length > 0 ||
      d.messages.length > 1 ||
      (d.questions || []).length > 0 ||
      (d.blueprint || []).length > 0;
    if (draftHas) out.push({ key: "d:" + t.k, id: "d:" + t.k, kk: t.k, zh: t.zh, card: d.draft || {}, isDraft: true, kSeq: 0 });
    d.built.forEach((card, i) =>
      // _bid 由 desks 初始化器保证;万一缺失,兜底 key 必须带 kind 防跨台撞车
      out.push({ key: "b:" + ((card && card._bid) || t.k + "#" + i), id: "b:" + ((card && card._bid) || t.k + "#" + i), kk: t.k, zh: t.zh, card, isDraft: false, kSeq: out.length })
    );
    return out;
  });
  // 无坐标的卡按 kind 分区自动落位(角色左上/世界右上/演出左下/故事右下),拖过即记(G1)。
  const AUTO_ANCHOR = { characters: [48, 24], worlds: [640, 24], players: [48, 330], stories: [640, 330] };
  function boardCardPos(bc, seq) {
    const p = boardPos[bc.key];
    if (p && typeof p.x === "number") return p;
    const [ax, ay] = AUTO_ANCHOR[bc.kk] || [48, 24];
    return { x: ax + (seq % 2) * 250, y: ay + Math.floor(seq / 2) * 168 };
  }
  function boardSub(card) {
    const c = (card && card.data) || card || {};
    if ((c.entries || []).length) return c.entries.length + (c.entries.length === 1 ? " entry" : " entries");
    return String(c.description || c.premise || c.background || c.personality || "").slice(0, 56);
  }
  function selectCard(bc) {
    setBoardSel({ kk: bc.kk, id: bc.id });
    const i = KINDS.findIndex((t) => t.k === bc.kk);
    if (i >= 0 && i !== ki) setKi(i);
  }
  // H4 相机聚焦:进入=记住当前视口 → 推进到该卡居中、zoom=1(编辑永远发生在 scale=1);
  // 退出=拉回原视口。reduced-motion 跳切不过渡;transitionend 兜底 setTimeout(本环境不派发)。
  const prevViewRef = useRef(null);
  function tweenViewTo(target) {
    const el = worldRef.current;
    if (el && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.transition = "transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)";
      const clear = () => {
        el.style.transition = "";
        el.removeEventListener("transitionend", clear);
      };
      el.addEventListener("transitionend", clear);
      setTimeout(clear, 450);
    }
    viewRef.current = { ...target };
    applyViewNow();
    setView({ ...target });
  }
  function enterFocusCamera(pos) {
    prevViewRef.current = { ...viewRef.current };
    const el = boardElRef.current;
    const r = el ? el.getBoundingClientRect() : { width: 1280, height: 700 };
    tweenViewTo({ x: r.width / 2 - (pos.x + 112), y: r.height / 2 - (pos.y + 80), z: 1 });
  }
  function exitFocus() {
    setBoardFocus(null);
    if (prevViewRef.current) {
      tweenViewTo(prevViewRef.current);
      prevViewRef.current = null;
    }
  }
  function focusCard(bc) {
    selectCard(bc);
    setBoardFocus({ kk: bc.kk, id: bc.id });
    enterFocusCamera(boardCardPos(bc, bc.kSeq));
  }
  // 新建:该台草稿已在板上就选中聚焦它;全新空台=聚焦进构思流。
  function newCardOf(kk) {
    // P1b 新建即骨架:全新空台直接新建也预铺起手骨架(与模板同一条路,静默——不 flash 不占输入框)。
    // 只在真空台种(有草稿/聊开过=不动);skeleton 直通 drafting(E5 口径:已有结构不回构思门控)。
    const dd = desks[kk];
    const isBlank =
      Object.keys(dd.draft || {}).length === 0 && dd.messages.length <= 1 &&
      !(dd.questions || []).length && !(dd.blueprint || []).length;
    if (isBlank) {
      const st = getTpl(kk, STARTER_IDS[kk]);
      if (st && st.skeleton) {
        patch(kk, { draft: structuredClone(st.skeleton), filled: [], tpl: st.id, phase: "drafting", comp: 0, questions: [], blueprint: [] });
      }
    }
    const i = KINDS.findIndex((t) => t.k === kk);
    if (i >= 0) setKi(i);
    setBoardSel({ kk, id: "d:" + kk });
    setBoardFocus({ kk, id: "d:" + kk });
    enterFocusCamera(boardPos["d:" + kk] || { x: (AUTO_ANCHOR[kk] || [48, 24])[0], y: (AUTO_ANCHOR[kk] || [48, 24])[1] });
    requestAnimationFrame(() => dockInputRef.current && dockInputRef.current.focus());
  }
  // H0 id 语义工具:draft 选中 / 按 id 解析 built 卡(卡没了=null,消费方按"无选中/卡不在了"降级)。
  const isDraftId = (s) => !!(s && s.id && s.id.startsWith("d:"));
  function resolveBuilt(s) {
    if (!s || !s.id || !s.id.startsWith("b:")) return null;
    const bid = s.id.slice(2);
    return (desks[s.kk].built || []).find((c) => c && c._bid === bid) || null;
  }
  // 选中态活性:built 选中但卡已移除/已发布清台 → 视同无选中(dock 解锁回引导态,不再幽灵锁死)。
  const selLive = boardSel && (isDraftId(boardSel) || resolveBuilt(boardSel)) ? boardSel : null;
  // Esc 关聚焦(输入框里按 Esc 不劫持——它们自己 stopPropagation 或先聚焦处理)
  useEffect(() => {
    if (!boardFocus && !boardSel && !spawnAt && !aiOpen) return;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      // H4 逐层退:字段编辑/指示行的 Esc 自己 preventDefault(只关自己)→ 这里不再抢;
      // 然后聚焦 → 选中,一层一层来(修预审「Esc 双关」)。
      if (e.defaultPrevented) return;
      if (spawnAt) setSpawnAt(null);
      else if (aiOpen) setAiOpen(false);
      else if (boardFocus) exitFocus();
      else if (boardSel) setBoardSel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardFocus, boardSel, spawnAt, aiOpen]);
  // 选中的 built 卡对象(dock 提示用)
  const selBuilt = resolveBuilt(boardSel);

  // H2 BoardActionTrigger(template P0 姿势):手势 → 意图的唯一翻译层。
  // 桌面:单击=select、双击=enter(聚焦)、拖>4px(世界系)=drag;触屏长按=enter 留接口未实装(手机不上画布)。
  // 上层(工具条/聚焦)只认意图,不认具体手势——将来改主战场只动这一层。
  const dragRef = useRef(null); // {key, startX, startY, baseX, baseY, moved, bc}
  const dragEndAtRef = useRef(0); // 拖后抑制原生 click/dblclick(浏览器拖完仍会派发)
  function onCardPointerDown(e, bc, pos) {
    if (e.button !== 0) return;
    if (spaceRef.current) return; // Space=板平移接管,不起卡拖也不起长按(否则 pan 中途满环误开 AI)
    dragRef.current = { key: bc.key, startX: e.clientX, startY: e.clientY, baseX: pos.x, baseY: pos.y, moved: false, bc };
    e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
    lpStart(e.currentTarget, e, () => {
      dragRef.current = null; // 满环=进 AI,本次手势不再是拖/点
      openAiForCard(bc);
    });
  }
  function onCardPointerMove(e) {
    const d = dragRef.current;
    if (!d) return;
    // 兜底:pointercancel 丢失/跨卡残留(主键没按着还带拖态=脏)
    if (!(e.buttons & 1) || d.key !== e.currentTarget.dataset.bckey) {
      dragRef.current = null;
      return;
    }
    // H1:屏幕位移 → 世界位移要除以缩放,否则非 100% 下拖卡落点漂
    const z = viewRef.current.z || 1;
    const dx = (e.clientX - d.startX) / z, dy = (e.clientY - d.startY) / z;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4 / z) return;
    lpCancel(); // 动了=拖拽,长按环撤
    if (!d.moved) {
      d.moved = true;
      d.el = e.currentTarget;
      boardElRef.current && boardElRef.current.classList.add("is-dragging");
    }
    // I 系列性能:拖动中 transform 直写(零 React 重渲——sidebar 开着也不掉帧),松手才 commit
    d.nx = Math.max(0, d.baseX + dx);
    d.ny = Math.max(0, d.baseY + dy);
    d.el.style.transform = `translate(${d.nx}px, ${d.ny}px)`;
  }
  function onCardPointerUp(e, bc) {
    lpCancel();
    if (lpFiredRef.current) {
      lpFiredRef.current = false; // 长按已成:吞掉这次抬起,不选中不拖
      dragRef.current = null;
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) {
      selectCard(bc);
      return;
    }
    dragEndAtRef.current = performance.now(); // 拖完:300ms 内的 dblclick 不当「进入」
    boardElRef.current && boardElRef.current.classList.remove("is-dragging");
    // 落点在 AI 对话栏上=挂为引用(卡片回弹原位);否则 commit 拖动终点(拖动中是直写,这里才进 state)
    const aiBar = document.querySelector(".create-ai");
    if (aiBar) {
      const r = aiBar.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        if (d.el) d.el.style.transform = `translate(${d.baseX}px, ${d.baseY}px)`;
        addRef(refFromCard(bc.kk, bc.card));
        return;
      }
    }
    setBoardPos((p) => ({ ...p, [d.key]: { x: d.nx, y: d.ny } }));
  }
  function onCardPointerCancel() {
    lpCancel();
    boardElRef.current && boardElRef.current.classList.remove("is-dragging");
    dragRef.current = null; // 触控板手势/系统抢占等取消:清拖态,防悬停继续拖走原卡
  }
  function onCardEnter(bc) {
    if (performance.now() - dragEndAtRef.current < 300) return; // 拖后误触抑制
    focusCard(bc);
  }
  // 改编成草稿 + 语境迁移:fork 成功后选中迁到新草稿(dock 立即可聊,不再原地打转)。
  function adaptFromBoard(bc) {
    if (!forkToDraft(bc.card, bc.kk)) return;
    setBoardSel({ kk: bc.kk, id: "d:" + bc.kk });
  }
  // 丢弃构思中的草稿卡:台子重置(seed/built 保留,镜像 collectToDesk 的保留口径)。
  function discardDraft(kk) {
    const d = desks[kk];
    const has = Object.keys(d.draft || {}).length > 0;
    if (!window.confirm(has ? "Discard this draft and its brainstorming chat? This can't be undone." : "Close this in-progress card? Its chat will be cleared too.")) return;
    setDesks((ds) => ({
      ...ds,
      [kk]: { ...blankDesk(kk), seed: ds[kk].seed || "", built: ds[kk].built },
    }));
    setBoardSel((s) => (s && s.id === "d:" + kk ? null : s));
    setBoardFocus((s) => (s && s.id === "d:" + kk ? null : s));
    flash("Discarded");
  }
  function quizAnswerOf(qu) {
    return (quizFree[qu.id] || "").trim() || quizAns[qu.id] || "";
  }
  function submitQuiz() {
    const lines = (desk.questions || [])
      .map((qu) => {
        const a = quizAnswerOf(qu);
        return a ? `${qu.label} — ${a}` : null;
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
      "Start writing the card from this blueprint. Fill everything we've settled into the fields in one go — no more follow-up questions:\n" +
        bp.map((b) => "- " + b).join("\n") +
        (note ? `\nAlso keep this in mind while writing (user's note, takes priority): ${note}` : ""),
      { phaseOverride: "drafting", display: `Blueprint approved — start writing${note ? ` — ${note}` : ""}` }
    );
  }

  // F7:display = 会话流里给人看的短句(合成指令别把整段 prompt 亮给用户);API 载荷仍用完整 text。
  async function sendText(rawText, { clearInput = false, phaseOverride = null, display = null } = {}) {
    const kk = kind;
    const cur = desks[kk];
    const text = (rawText || "").trim();
    if (!text || busy) return;
    setBusy(true);
    // i18n: kept, logic literal — who:"你" marks user messages (persisted in localStorage, compared below)
    const apiMsgs = [...cur.messages, { who: "你", text }].map((m) => ({
      role: m.who === "你" ? "user" : "assistant",
      content: m.text,
    }));
    patch(kk, (d0) => ({
      messages: [...d0.messages, { who: "你", text, ...(display ? { show: display } : {}) }],
      ...(clearInput ? { input: "" } : {}),
    }));
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
          messages: [...d0.messages, { who: "ai", text: r.reply || "(Didn't catch that — try rephrasing.)" }],
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
            messages: [...d0.messages, { who: "ai", text: ask || "(Didn't catch that — try rephrasing, or break it into shorter pieces.)" }],
            draft: nextDraft,
            filled: changed,
            phase: "drafting",
          };
        });
      }
    } catch (e) {
      patch(kk, (d0) => ({ messages: [...d0.messages, { who: "ai", text: "(Card build error: " + e.message + ")" }] }));
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
        ? `Fill in "${f.k}" (${f.k0}) now: based on the existing setup, write this section and put it in the ${f.k0} field. Don't ask questions or just explain; write the content this turn. Try not to touch other fields.`
        : `Rewrite "${f.k}" (${f.k0}) now to be more specific and vivid, and write it back to the ${f.k0} field. Don't ask questions; finish the rewrite this turn. Try not to touch other fields.`;
    const ex = (extra || "").trim();
    const icon = mode === "fill" ? "✦ Fill in" : "⟳ Rewrite";
    return sendText(ex ? base + `\nUser's requirements for this section (take priority): ${ex}` : base, {
      display: `${icon} "${f.k}"${ex ? ` — ${ex}` : ""}`,
    });
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
    const nm = draft.name || draft.title || "Untitled";
    patch(kk, (d0) => ({
      draft: { ...draft, ...pickPics(d0.draft) }, // 保住已上传的头像/立绘
      filled: Object.keys(draft),
      // E5 快速通道:已带内容,直通 drafting,清构思残留
      phase: "drafting", comp: 0, questions: [], blueprint: [],
      messages: [...d0.messages, { who: "ai", text: `"${nm}" was parsed onto the canvas and saved to your Card Library (private).` }],
    }));
    return nm;
  }
  // 导入会整卡替换画布草稿:有未收草稿先确认(镜像 removeBuilt 的破坏性确认范式)。
  function confirmReplaceDraft() {
    if (!hasDraft) return true;
    return window.confirm(`The canvas already has a draft "${draftName}". Importing will replace it (cards already on a station or in your Card Library are unaffected). Continue?`);
  }

  // D4 改编:把一张已有卡 fork 成指定台的草稿。名字加「·改」——/api/library/save 按名 upsert,
  // 不改名会覆盖原卡;改编稿入库=另存新卡,原卡不动。
  function forkToDraft(item, kk = kind) {
    let card = (item && item.data) || item || {};
    if (card && card.data && typeof card.data === "object" && !Array.isArray(card.data)) card = card.data; // chara_card_v2 信封再剥一层
    card = stripBid(card); // H0:板上身份不跟着改编稿走(收进本台时另发新 id)
    if (!card || !Object.keys(card).length) {
      flash("Couldn't read this card's content");
      return false;
    }
    const tgt = desks[kk];
    const tgtHas = Object.keys((tgt && tgt.draft) || {}).length > 0;
    if (tgtHas) {
      const tn = tgt.draft.name || (tgt.draft.data && tgt.draft.data.name) || tgt.draft.title || "Untitled";
      if (!window.confirm(`The ${KINDS.find((t) => t.k === kk).zh} station already has a draft "${tn}". Adapting will replace it. Continue?`)) return false;
    }
    const useTitle = "title" in card && !("name" in card);
    const base = card[useTitle ? "title" : "name"] || "Untitled";
    const nm = /(·改| \(adapted\))$/.test(base) ? base : base + " (adapted)"; // i18n: legacy "·改" suffix still recognised
    patch(kk, (d0) => ({
      draft: { ...card, [useTitle ? "title" : "name"]: nm },
      filled: Object.keys(card),
      tpl: undefined,
      phase: "drafting", comp: 0, questions: [], blueprint: [], // E5 快速通道
      messages: [...d0.messages, { who: "ai", text: `Created adaptation "${nm}". The original card is kept; this one saves under the new name.` }],
    }));
    flash(`Created adaptation "${nm}"`);
    return true;
  }

  async function onUpload(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    // F5 hint 读完即清:取消/未确认都不残留,不污染下一次任意上传
    const hint = (uploadHintRef.current || "").trim();
    uploadHintRef.current = "";
    if (!file || busy) return;
    if (!confirmReplaceDraft()) return; // 上传曾是「替换先确认」范式唯一漏网入口(与粘贴/酒馆/改编对齐)
    const kk = kind;
    setBusy(true);
    patch(kk, (d0) => ({ messages: [...d0.messages, { who: "你", text: `(Uploaded "${file.name}")` }] }));
    try {
      const text = await uploadFile(file);
      const out = await postJSON(IDENTIFY_EP[kk], { text, ...(hint ? { hint } : {}) });
      applyIdentified(out, kk);
      flash("Parsed and saved to library");
    } catch (e) {
      patch(kk, (d0) => ({ messages: [...d0.messages, { who: "ai", text: "(Parse failed: " + e.message + ")" }] }));
      flash("Parse failed");
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
      flash(`Parsed "${nm}" and saved to library`);
    } catch (e) {
      setImportOpen((m) => (m ? { ...m, err: "Parse failed: " + e.message } : m));
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
      const nm = parsed.draft.name || "Untitled";
      const droppedNote = parsed.dropped.length
        ? " Skipped " + parsed.dropped.length + " unsupported Tavern-specific field" + (parsed.dropped.length === 1 ? "" : "s") + ": " +
          parsed.dropped.slice(0, 6).join(", ") + (parsed.dropped.length > 6 ? "…" : "") + "."
        : "";
      patch(kind, (d0) => ({
        draft: { ...parsed.draft, ...pickPics(d0.draft) },
        filled: Object.keys(parsed.draft),
        phase: "drafting", comp: 0, questions: [], blueprint: [], // E5 快速通道
        messages: [...d0.messages, { who: "ai", text: `"${nm}" imported from the Tavern card (parsed locally: not saved to the library, no quota used).` + droppedNote }],
      }));
      // PNG 本体顺手压成立绘(draft.image 空着才填,不覆盖用户已传的)
      if (!isJson) {
        try {
          const dataUrl = await fileToCompressedDataURL(file, { maxW: 768, maxH: 1152, quality: 0.82 });
          patch(kind, (d0) => (d0.draft.image ? {} : { draft: { ...d0.draft, image: dataUrl } }));
        } catch (e) {}
      }
      // 卡自带世界书 → 桥到 D1 参考资料(截 6000),AI 每轮可参考
      if (parsed.bookText && window.confirm("This card comes with World Book entries (" + parsed.bookText.length + " chars). Attach them as source notes so the AI consults them every turn? (You can clear them anytime.)")) {
        patch(kind, { seed: parsed.bookText.slice(0, 6000) });
      }
      setImportOpen(null);
      flash(`Imported "${nm}" (local, not saved to library)`);
    } catch (e) {
      setImportOpen((m) => (m ? { ...m, err: "Import failed: " + e.message } : { step: "pick", text: "", err: "Import failed: " + e.message }));
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
      flash("Cover set");
    } catch (e) {
      flash("Couldn't process the cover: " + e.message);
    }
  }

  // 真正收进本台(复用):把当前 draft 放进 built、台子重置、提示。
  function collectToDesk(cardDraft) {
    const nm = cardDraft.name || cardDraft.title || "Untitled";
    setDesks((ds) => ({
      ...ds,
      [kind]: {
        ...blankDesk(kind),
        // D1:参考资料跨卡保留(一份资料常连造多张卡);tpl 不带 = 自然清(模板是单卡的事)。
        seed: ds[kind].seed || "",
        built: [...ds[kind].built, withBid(cardDraft)],
        messages: [{ who: "ai", text: `"${nm}" added to this station (card #${ds[kind].built.length + 1}).` }],
      },
    }));
    setCardExpanded(false);
    flash("Added to station (" + nm + ")");
    burstDone();
  }
  // R1 完成拍:收进本台/收入卡库/发布成功=朱砂+鎏金定向爆发(走全局 ClickSpark 画布的 ais:spark 入口)。
  // 与长按溅墨同一语言;色值传字面量(canvas 解析不了 CSS var)。
  function burstDone(big = false) {
    const el = document.querySelector(".create-focus-acts") || document.querySelector(".create-boardbar-r");
    const r = el && el.getBoundingClientRect();
    window.dispatchEvent(
      new CustomEvent("ais:spark", {
        detail: {
          x: r ? r.left + r.width / 2 : window.innerWidth / 2,
          y: r ? r.top + r.height / 2 : window.innerHeight / 3,
          count: big ? 18 : 13,
          colors: ["#b5402e", "#b8873f"],
          radius: big ? 40 : 26,
          size: big ? 15 : 12,
        },
      }),
    );
  }

  function nextCard() {
    const cur = desks[kind];
    if (!cur.draft || !Object.keys(cur.draft).length) {
      flash("The draft is still empty. Chat one up first.");
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
    if (genBusy || busy) return; // 与 sendText 双向互斥:生成中不许聊,聊着不许生成
    const cur = desks[kind];
    setGenBusy(true);
    setBusy(true);
    try {
      const ex = (introAsk || "").trim();
      const apiMsgs = [
        {
          role: "user",
          content:
            "Based on the existing setup, write a third-person character introduction for this character (appearance, personality, backstory, current situation; under 150 words) and put it in the description field." +
            (ex ? `\nUser's requirements for this introduction (take priority): ${ex}` : ""),
        },
      ];
      const refsPayload = (Array.isArray(cur.refs) ? cur.refs : []).map((x) => ({ label: x.label, text: x.text }));
      const r = await postJSON("/api/build_card", {
        kind, messages: apiMsgs, draft: cur.draft, seed: cur.seed || "",
        ...(refsPayload.length ? { refs: refsPayload } : {}),
      });
      if (r.draft) {
        // 回写只合并模型相对快照实际改动的字段(镜像 sendText 的 diff 姿势),
        // 不整卡覆盖——请求在飞期间的手改/其他更新不再被旧快照冲掉。
        const snap = cur.draft || {};
        const changed = Object.keys(r.draft).filter(
          (k) => JSON.stringify(r.draft[k]) !== JSON.stringify(snap[k])
        );
        patch(kind, (d0) => {
          const upd = {};
          for (const k of changed) upd[k] = r.draft[k];
          return { draft: { ...d0.draft, ...upd, ...pickPics(d0.draft) }, filled: changed };
        });
      } else if (r.reply) {
        patch(kind, (d0) => ({ draft: { ...d0.draft, description: r.reply } }));
      }
      flash("Character intro generated");
    } catch (e) {
      flash("Generation failed: " + e.message);
    } finally {
      setGenBusy(false);
      setBusy(false);
    }
  }
  function removeBuilt(kk, bid) {
    // 破坏性且不可撤销:收进本台时该卡的聊天记录已清,没另存卡库就找不回。先确认(镜像纯聊 ⟳ 范式,YOR-184)。
    // H0:显式传台 + 按 _bid 定位——闭包旧 kind/下标前移那族误删从根上消失;找不到卡=如实提示不盲删。
    const c = (desks[kk] && desks[kk].built ? desks[kk].built : []).find((x) => x && x._bid === bid);
    if (!c) {
      flash("This card is gone (it may have been removed)");
      return;
    }
    const nm = c.name || c.title || "this card";
    if (!window.confirm("Remove " + nm + "? Its chat history was already cleared, so it can't be recovered once removed. Continue?")) return;
    setDesks((ds) => ({ ...ds, [kk]: { ...ds[kk], built: (ds[kk].built || []).filter((x) => !x || x._bid !== bid) } }));
    setBoardPos((p) => {
      if (!p["b:" + bid]) return p;
      const { ["b:" + bid]: _gone, ...rest } = p;
      return rest;
    });
    setBoardSel((s) => (s && s.id === "b:" + bid ? null : s));
    setBoardFocus((s) => (s && s.id === "b:" + bid ? null : s));
    flash("Removed from station");
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
      flash("Nothing to save yet. Chat a bit first.");
      return;
    }
    savingRef.current = true;
    setSavingCard(true);
    try {
      await postJSON("/api/library/save", { kind, data: kind === "characters" ? { data: d } : d });
      flash("Saved to library · Private");
      burstDone();
    } catch (e) {
      flash("Save failed: " + e.message);
    } finally {
      savingRef.current = false;
      setSavingCard(false);
    }
  }
  // 收入卡库入口:角色卡先走「完善角色卡」弹窗(可传图),其它卡直接入库。
  function saveCard() {
    const d = desk.draft || {};
    if (!Object.keys(d).length) {
      flash("Nothing to save yet. Chat a bit first.");
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
    const c = stripBid((card && card.data) || card || {});
    if (!Object.keys(c).length) {
      flash("Nothing to export yet");
      return;
    }
    const obj = kk === "characters" ? wrapCard(c) : c;
    const nm = c.name || c.title || "Untitled";
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nm + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    flash(`Exported "${nm}.json"`);
  }

  // D4 故事级拆回:/api/presets 列表已含完整卡组 data,选一条把四类卡追加回各台 built
  // (不清现有、不动原预设;发布时按新名字生成新预设,不碰权属)。
  async function openPresets() {
    try {
      const items = await getJSON("/api/presets");
      setPresetsModal({ items: Array.isArray(items) ? items : [] });
    } catch (e) {
      flash("Failed to load stories: " + e.message);
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
      characters: { ...ds.characters, built: [...ds.characters.built, ...chars.map(withBid)] },
      players: { ...ds.players, built: [...ds.players.built, ...players.map(withBid)] },
      worlds: { ...ds.worlds, built: [...ds.worlds.built, ...worlds.map(withBid)] },
      stories: { ...ds.stories, built: [...ds.stories.built, ...stories.map(withBid)] },
    }));
    setPresetsModal(null);
    flash(`Unpacked "${p.name}" into the four stations (characters ×${chars.length}, players ×${players.length}, worlds ×${worlds.length}, stories ×${stories.length}). Publishing will create a new preset.`);
  }

  // 素材复用:列我的库 → 搜索/挑一张推进对应台子的 built。
  async function openLib() {
    setMoreOpen(false);
    setLibQ("");
    try {
      const items = await getJSON("/api/library/" + kind);
      setLibModal({ items: Array.isArray(items) ? items : [] });
    } catch (e) {
      flash("Failed to load library: " + e.message);
    }
  }
  function libName(it) {
    const raw = (it && it.data && it.data.data) || (it && it.data) || {};
    return raw.name || raw.title || it.name || "Untitled";
  }
  function libDesc(it) {
    const raw = (it && it.data && it.data.data) || (it && it.data) || {};
    return raw.persona || raw.description || raw.premise || ((raw.entries || []).length ? `${raw.entries.length} ${raw.entries.length === 1 ? "entry" : "entries"}` : "");
  }
  function libAdd(item) {
    const raw = item && item.data ? item.data : item;
    const card = kind === "characters" ? raw.data || raw : raw;
    if (!card || !Object.keys(card).length) {
      flash("Couldn't read this card's content");
      return;
    }
    setDesks((ds) => ({ ...ds, [kind]: { ...ds[kind], built: [...ds[kind].built, withBid(card)] } }));
    setLibModal(null);
    flash("Added to this project");
  }

  const deskCards = (k) => {
    const d = desks[k];
    const cur = d.draft && Object.keys(d.draft).length ? [d.draft] : [];
    // H0:_bid 是视图层身份,发布/预览拼装一律剥掉,不进 preset 数据
    return [...d.built.map(stripBid), ...cur];
  };

  // 组装当前创作 → 故事 preset 形状(给「预览成详情页」用,复用发布那套拼装;不落库、纯本地)。
  function buildPreviewPreset() {
    const chars = deskCards("characters"), worlds = deskCards("worlds"), stories = deskCards("stories"), players = deskCards("players");
    const st = stories.length ? stories[stories.length - 1] : null;
    const tags = [...new Set([...chars.flatMap((c) => c.tags || []), ...((st || {}).tags || [])])].filter(Boolean).slice(0, 5);
    const nm = pub.name.trim() || (draftName !== "Untitled" ? draftName : "Untitled story");
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
      Object.keys(c || {}).some((k) => /secret|隐藏|真相/i.test(k) && c[k] && String(c[k]).trim()); // i18n: kept, logic literal (card key names)
    const chars = deskCards("characters"), worlds = deskCards("worlds"), stories = deskCards("stories"), players = deskCards("players");
    return {
      chars: chars.map((c) => ({ name: c.name || c.title || "Untitled", secret: hasSecret(c) })),
      worlds: worlds.length,
      players: players.map((p) => p.name || p.title || "Protagonist"),
      story: stories.length ? stories[stories.length - 1].name || stories[stories.length - 1].title || "This story" : null,
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
      flash("You need at least one character card to publish");
      return;
    }
    if (!pub.name.trim()) {
      flash("Give this story a name");
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
      burstDone(true);
      setPub({ name: "", synopsis: "", cover: "", authorNote: "" });
      setPreviewOpen(false);
      setPreviewChar(null);
      flash("Published to Explore · Public. Stations cleared — ready for your next story.", "/story/" + encodeURIComponent(pub.name.trim())); // 台子清空(YOR-191)+ 直链去看看(YOR-170)
    } catch (e) {
      flash("Publish failed: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  const draftName = desk.draft.name || (desk.draft.data && desk.draft.data.name) || desk.draft.title || "Untitled";
  // 按钮可用性(细节④:不可用置灰、可用才亮)。
  const hasDraft = Object.keys(desk.draft || {}).length > 0;
  const hasChars = deskCards("characters").length > 0;
  const fields = useMemo(() => {
    const d = desk.draft || {};
    // P2a:字符串数组(goals/abilities/constraints/timeline/main_plot/speech_rules…)升级就地列表编辑
    // (✎ 打开=一行一条);对象数组(世界书 entries、故事 events)仍走「聊」,P2b 接结构编辑。
    const isStrList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
    return Object.keys(d)
      .filter((k) => !NON_FIELD_KEYS.includes(k))
      .map((k) => ({
        k0: k, // 原始 key(就地手改/定向指令回写用)
        k: LABELS[k] || k,
        v: fmtVal(d[k]),
        editable: typeof d[k] === "string" || isStrList(d[k]),
        list: isStrList(d[k]),
        // AI 骨架常带空串字段:收编成 ✦ 补写目标,不再是意义不明的空行
        empty: (typeof d[k] === "string" && !d[k].trim()) || (isStrList(d[k]) && !d[k].length),
        fresh: (desk.filled || []).includes(k),
        hidden: /secret|隐藏|真相/i.test(k), // i18n: kept, logic literal (card key names)
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

  // R3 模板卡叠:开弹窗/切卡种时重置叠序;换一套=顶卡退场 240ms 后转到叠底
  useEffect(() => {
    if (tplOpen) {
      setTplOrder((TEMPLATES[kind] || []).map((_, i) => i));
      setTplLeaving(false);
    }
  }, [tplOpen, kind]);
  function cycleTpl() {
    if ((TEMPLATES[kind] || []).length < 2 || tplLeaving) return;
    setTplLeaving(true);
    setTimeout(() => {
      setTplOrder((o) => [...o.slice(1), o[0]]);
      setTplLeaving(false);
    }, 240);
  }
  // —— D3 模板:铺骨架进 draft(空串字段=✦ 补写目标),opener 只进输入框不代发 ——
  const tplHints = useMemo(() => {
    const t = getTpl(kind, desk.tpl);
    return (t && t.hints) || {};
  }, [kind, desk.tpl]);
  function applyTemplate(t) {
    if (!confirmReplaceDraft()) return;
    patch(kind, {
      // P3:模板骨架带对象数组(示例条目/节拍),深拷贝防 draft 编辑摸到模板常量
      draft: t.skeleton ? structuredClone(t.skeleton) : {},
      filled: [],
      tpl: t.id,
      input: t.opener || "",
      // E5:骨架模板=已有结构直通 drafting(✦ 补写可用);纯 opener 模板(世界书)留在构思阶段
      ...(t.skeleton ? { phase: "drafting", comp: 0, questions: [], blueprint: [] } : {}),
    });
    setTplOpen(false);
    // R2:模板名鎏金扫光(toast 转瞬场合,不常驻)
    flash(
      t.skeleton ? (
        <>Applied the "<ShinyText text={t.name} speed={1.4} color="var(--accent-3)" shineColor="#ffe9c2" />" template. Long-press an empty field to have the AI fill it in.</>
      ) : (
        <>The opener for "<ShinyText text={t.name} speed={1.4} color="var(--accent-3)" shineColor="#ffe9c2" />" is in the input box</>
      ),
    );
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
    flash(t ? "Source notes attached. The AI will consult them every turn." : "Source notes cleared");
  }
  function clearSeed() {
    patch(kind, { seed: "" });
    setSeedOpen(false);
    flash("Source notes removed");
  }
  // 徽章字数:<1000 显示整数字,否则 x.xk
  function seedLenLabel(s) {
    const n = (s || "").length;
    return n < 1000 ? `${n} chars` : `${(n / 1000).toFixed(1)}k chars`;
  }

  // —— C1 就地手改:手改直接写 draft(draft 即共享真相,AI 下轮基于改后内容继续长) ——
  function startFieldEdit(f) {
    if (!f.editable) return;
    setEditingKey(f.k0);
    setEditVal(f.list ? (desk.draft[f.k0] || []).join("\n") : desk.draft[f.k0] || "");
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
    patch(kind, (d0) => {
      const cur = (d0.draft || {})[key];
      // P2a 列表字段:一行一条回写数组(空行丢弃);按 draft 现值判型,与 startFieldEdit 的 join 对偶
      const v2 = Array.isArray(cur) ? val.split("\n").map((s) => s.trim()).filter(Boolean) : val;
      return { draft: { ...d0.draft, [key]: v2 } };
    });
  }
  function cancelFieldEdit() {
    setEditingKey(null);
  }
  // ── P2b 结构条目编辑:世界书 entries / 故事书 events(节拍)的增删改 ──
  // 键名 ∈ src/models.py(WorldEntry: comment/keys/content/visibility;StoryEvent: event_id/title/trigger_keywords/summary)。
  // 标题/内容=受控直写;触发词=uncontrolled+onBlur 提交(受控+实时 split 会吃掉刚敲的分隔符)。
  const ENTRY_SPECS = {
    entries: { zh: "Entry", titleKey: "comment", keysKey: "keys", bodyKey: "content", canHide: true },
    events: { zh: "Beat", titleKey: "title", keysKey: "trigger_keywords", bodyKey: "summary", canHide: false },
  };
  function blankEntryOf(fieldKey) {
    return fieldKey === "events"
      ? { event_id: "ev" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: "", trigger_keywords: [], summary: "" }
      : { comment: "", keys: [], content: "" };
  }
  function patchEntryAt(fieldKey, idx, up) {
    patch(kind, (d0) => {
      const arr = [...(((d0.draft || {})[fieldKey]) || [])];
      arr[idx] = { ...arr[idx], ...up };
      return { draft: { ...d0.draft, [fieldKey]: arr } };
    });
  }
  function addEntryAt(fieldKey) {
    patch(kind, (d0) => ({ draft: { ...d0.draft, [fieldKey]: [...(((d0.draft || {})[fieldKey]) || []), blankEntryOf(fieldKey)] } }));
  }
  function delEntryAt(fieldKey, idx) {
    const spec = ENTRY_SPECS[fieldKey];
    const cur = (desk.draft[fieldKey] || [])[idx] || {};
    const has = (cur[spec.bodyKey] || "").trim() || (cur[spec.titleKey] || "").trim();
    if (has && !window.confirm(`Delete ${spec.zh.toLowerCase()} "${cur[spec.titleKey] || "Untitled"}"?`)) return;
    patch(kind, (d0) => {
      const arr = [...(((d0.draft || {})[fieldKey]) || [])];
      arr.splice(idx, 1);
      return { draft: { ...d0.draft, [fieldKey]: arr } };
    });
  }
  const splitKeys = (s) => s.split(/[、,，;；\n]+/).map((x) => x.trim()).filter(Boolean); // i18n: CJK separators kept for legacy keys; no whitespace split so "Black Tower" stays one keyword
  // 复杂字段(对象/数组)不就地改:预填一句定向指令、光标带到命令条,聊着改。
  function chatAboutField(f) {
    patch(kind, { input: `Change the "${f.k}" section: ` });
    requestAnimationFrame(() => dockInputRef.current && dockInputRef.current.focus());
  }
  function startNameEdit() {
    setEditingKey("__name");
    setEditVal(draftName === "Untitled" ? "" : draftName);
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
    setPub((p) => ({ ...p, name: p.name || (draftName !== "Untitled" ? draftName : "") }));
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
              <span className="ct-title t-h2">Create</span>
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
                {!portrait && !avatar && (draftName === "Untitled" ? "✎" : draftName.slice(0, 1))}
              </span>
              <span className="ct-draft-tx">
                <span className="ct-draft-name t-kai">{draftName}</span>
                <span className="ct-draft-sub t-meta">
                  {KINDS[ki].zh}
                  {desk.built.length > 0 ? ` · ${desk.built.length} on station` : ""}
                  {fields.length ? ` · ${fields.length} ${fields.length === 1 ? "field" : "fields"} filled` : " · empty"}
                </span>
              </span>
              <span className="ct-draft-chev t-meta">{cardExpanded ? "Collapse ⌃" : "Show all ⌄"}</span>
            </button>
            {cardExpanded && (
              <div className="ct-draft-body">
                {portrait && <div className="ct-draft-cover" style={{ backgroundImage: `url("${portrait}")` }} aria-label="Portrait" />}
                <div className="create-card-fields">
                  {fields.length ? (
                    fields.map((f, i) => (
                      <div className={"create-field" + (f.fresh ? " is-fresh" : "")} key={i}>
                        <span className="create-field-k t-meta">{f.k}</span>
                        <span className="create-field-v t-ui-sm">{f.hidden ? "(Hidden truth, not visible to players) " + f.v : f.v}</span>
                      </div>
                    ))
                  ) : (
                    <div className="create-field-empty t-meta">No fields yet. Chat below to get started.</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 中:对话(唯一滚动区) */}
          <div className="ct-chat" ref={chatRef}>
            {/* E6:完整度火候线进手机对话流(布局不动,只是流内多一行) */}
            {phase !== "drafting" && (
              <div className="create-comp" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={desk.comp || 0} aria-label="Card completeness">
                <span className="create-comp-label t-meta">
                  Completeness {desk.comp || 0}
                  <span className="create-comp-hint">{(desk.comp || 0) >= COMP_THRESHOLD ? " · Ready to write" : ` · Writing starts at ${COMP_THRESHOLD}`}</span>
                </span>
                <span className="create-comp-line" aria-hidden="true">
                  <span className="create-comp-fill" style={{ width: `${Math.min(100, desk.comp || 0)}%` }} />
                  <span className="create-comp-mark" style={{ left: `${COMP_THRESHOLD}%` }} />
                </span>
              </div>
            )}
            {desk.messages.map((m, i) => (
              <div key={i} className={"create-msg" + (m.who === "你" ? " is-me" : "")}>
                <span className="create-msg-who t-meta">{m.who === "你" ? "You" : "Assistant"}</span>
                <p className="create-msg-text t-ui">{m.show || m.text}</p>
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
                        <input className="create-quiz-free t-ui-sm" placeholder="Other: write your own…" value={quizFree[qu.id] || ""}
                          onChange={(e) => { const v = e.target.value; setQuizFree((f) => ({ ...f, [qu.id]: v })); if (v) setQuizAns((a) => ({ ...a, [qu.id]: undefined })); }} />
                      )}
                    </div>
                  </div>
                ))}
                <div className="create-quiz-foot">
                  <Button variant="primary" disabled={!(desk.questions || []).some((qu) => quizAnswerOf(qu))} onClick={submitQuiz}>
                    Submit answers
                  </Button>
                </div>
              </div>
            )}
            {phase === "blueprint" && (desk.blueprint || []).length > 0 && !busy && (
              <div className="create-bp">
                <div className="create-bp-h t-kai">Blueprint · How this card will be written</div>
                {desk.blueprint.map((b, i) => (
                  <div className="create-bp-item t-ui" key={i}>— {b}</div>
                ))}
                <input
                  className="create-ask-line t-ui-sm"
                  value={bpNote}
                  disabled={busy}
                  placeholder="Any last request before writing (optional)"
                  onChange={(e) => setBpNote(e.target.value)}
                  aria-label="Note before writing"
                />
                <div className="create-bp-foot">
                  <Button variant="primary" onClick={approveBlueprint}>Approve and write</Button>
                  <button className="create-blank-link" onClick={() => patch(kind, { phase: "understand" })}>Keep chatting</button>
                </div>
              </div>
            )}
            {busy && (
              <div className="create-msg">
                <span className="create-msg-who t-meta">Assistant</span>
                <p className="create-msg-text t-ui create-msg-typing">Thinking…</p>
              </div>
            )}
          </div>

          {/* 底:输入框 + 动作(钉死) */}
          <div className="ct-foot">
            {moreOpen && (
              <div className="ct-more" role="menu">
                <button onClick={() => { setMoreOpen(false); setBuiltView(true); }} disabled={!desk.built.length}>
                  View built cards ({desk.built.length})
                </button>
                <button onClick={openLib}>Add from Card Library</button>
                {/* D6 手机最小入口:只加两项,弹窗与桌面共用;.ct 布局不动 */}
                <button onClick={() => { setMoreOpen(false); setImportOpen({ step: "pick", text: "", err: "" }); }}>
                  Import existing content
                </button>
                <button onClick={() => { setMoreOpen(false); openSeed(); }}>
                  {desk.seed ? `Source notes · ${seedLenLabel(desk.seed)} (view / clear)` : "Attach source notes"}
                </button>
                {/* F6 手机最小入口:引用面板(弹窗与桌面共用);纸签行在 composer 上方 */}
                <button onClick={() => { setMoreOpen(false); openRefPanel("desk"); }}>
                  {deskRefs.length ? `Reference cards / prompts · ${deskRefs.length} attached` : "Reference cards / prompts"}
                </button>
                <button className="ct-more-pub" onClick={openPreview} disabled={!hasChars}>Preview & publish to Explore · Public</button>
                {/* 禁用原因触屏可见(桌面版的 title 手机看不到,同 YOR-173 范式) */}
                {!hasChars && <span className="ct-more-note t-meta">You need at least one character card. Chat one up, or add one from your Card Library.</span>}
              </div>
            )}
            {/* F6:挂台纸签在手机也常显可摘(同一套类名,CSS 通用) */}
            {deskRefs.length > 0 && (
              <div className="create-refs" aria-label="References attached to this station">
                {deskRefs.map((r) => (
                  <span className="create-ref-chip t-ui-sm" key={r.label}>
                    <span className="create-ref-t">{r.type === "prompt" ? "P" : "C"}</span>
                    {r.label}
                    <button className="create-ref-x" onClick={() => removeRef(r.label)} aria-label={"Remove " + r.label}>×</button>
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
              <button className="ct-upload" onClick={() => { uploadHintRef.current = ""; fileRef.current && fileRef.current.click(); }} disabled={busy} title="Upload document" aria-label="Upload document">＋</button>
              <input ref={fileRef} type="file" accept=".txt,.md,.docx" hidden onChange={onUpload} />
              <Button variant="primary" onClick={send} disabled={busy || !desk.input.trim()}>Send</Button>
            </div>
            <div className="ct-actions">
              <Button variant="line" onClick={nextCard} disabled={!hasDraft}>Add to station</Button>
              <Button variant="line" onClick={saveCard} disabled={!hasDraft || savingCard}>{savingCard ? "Saving…" : "Save to library"}</Button>
              <button className={"ct-morebtn" + (moreOpen ? " is-on" : "")} onClick={() => setMoreOpen((v) => !v)} aria-label="More">⋯ More</button>
            </div>
          </div>
        </>
      ) : (
        /* ———————————————— 桌面:两栏(对话 | 实时卡 + 操作钉死) ————————————————
           reskin(YOR-211):入场动效(标题错层/副标晕染/tab 错峰)+ 空台引子 + 墨点打字指示 +
           草稿卡 DepthCard 视差。功能契约未动:send/onUpload/收纳/发布全部原样。 */
        <>
          {/* G0 board-bar:大标题/kind tabs/台账线全部退役成一条薄工具条——全屏画板从这里往下都是板 */}
          <div className="create-boardbar">
            <div className="create-boardbar-l">
              <span className="create-boardbar-title t-kai">Create</span>
              {/* H3:四个「+ 卡」搬去左侧工具 rail,boardbar 瘦身成文件级 */}
            </div>
            <div className="create-boardbar-r">
              {(() => {
                const mf = publishManifest();
                const total = mf.chars.length + mf.worlds + mf.players.length + (mf.story ? 1 : 0);
                return (
                  <button
                    className={"create-ledger-link" + (ledgerPop === "bind" ? " is-on" : "")}
                    onClick={() => setLedgerPop((p) => (p === "bind" ? null : "bind"))}
                  >
                    Bundle · {total} {total === 1 ? "card" : "cards"}{mf.anySecret ? " ⚠" : ""}
                  </button>
                );
              })()}
              <button className={"create-chat-btn" + (aiOpen ? " is-on" : "")} onClick={() => setAiOpen((v) => !v)} title="AI chat (or long-press any card / field)">
                AI chat · {desk.messages.length}
              </button>
              <Button variant="primary" onClick={openPreview} disabled={!hasChars} title={hasChars ? "Preview and publish to Explore (public)" : "Needs at least one character card"}>Publish · Public</Button>
              <button
                className={"create-ledger-more" + (ledgerPop === "menu" ? " is-on" : "")}
                onClick={() => setLedgerPop((p) => (p === "menu" ? null : "menu"))}
                aria-label="More actions"
              >
                ⋯
              </button>
              {ledgerPop && <div className="create-ledger-shade" onClick={() => setLedgerPop(null)} />}
              {ledgerPop === "bind" && (() => {
                const mf = publishManifest();
                return (
                  <div className="create-ledger-pop" role="dialog" aria-label="Bundle list">
                    <div className="create-bind-h t-meta">Bundle · Packed on publish (what you see is what gets published)</div>
                    <ul className="create-bind-list t-meta">
                      <li>
                        Characters ×{mf.chars.length}
                        {mf.chars.length > 0 && ": " + mf.chars.map((c) => c.name + (c.secret ? " ⚠" : "")).join(", ")}
                      </li>
                      {mf.worlds > 0 && <li>Lore Card · World Book ×{mf.worlds}</li>}
                      {mf.players.length > 0 && <li>Player Cards ×{mf.players.length}: {mf.players.join(", ")}</li>}
                      {mf.story && (
                        <li>
                          Story Book: {mf.story}
                          {mf.storyExtra > 0 && ` (${mf.storyExtra} more not published)`}
                        </li>
                      )}
                      {!mf.chars.length && <li className="create-bind-empty">No character cards yet. Publishing needs at least one.</li>}
                    </ul>
                    {mf.anySecret && <div className="create-bind-warn t-meta">⚠ Cards with a hidden truth become public when published. Check before publishing.</div>}
                  </div>
                );
              })()}
              {ledgerPop === "menu" && (
                <div className="create-ledger-pop create-ledger-menu" role="menu">
                  <button onClick={() => { setLedgerPop(null); openLib(); }}>Add from Card Library</button>
                  <button disabled={!hasDraft} onClick={() => { setLedgerPop(null); exportCard(desk.draft); }}>Export draft JSON</button>
                  <button onClick={() => { setLedgerPop(null); openPresets(); }}>↺ Continue editing a story I published</button>
                </div>
              )}
            </div>
          </div>

          {/* G0 全屏画板:四台物料全部挂板(可拖可选可聚焦);台账线/kind tabs 已退役进 boardbar */}
          <div className="create-studio is-board">
            {/* 文件 input 常驻画板层(原 #168 手动移植)——原来只住在 AI 对话坞 composer 里,
                坞不渲染时「导入→上传文档」点 fileRef=null 点空;手机 .ct 自己那只不动 */}
            <input ref={fileRef} type="file" accept=".txt,.md,.docx" hidden onChange={onUpload} />
            <div
              className={"create-board" + (boardDragOver ? " is-dropover" : "")}
              ref={boardElRef}
              onContextMenu={(e) => {
                const t = e.target;
                if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return; // 输入区保系统菜单
                e.preventDefault(); // 右键=平移,画布上不弹浏览器菜单(含右拖松手后的那发)
              }}
              onPointerDown={onBoardPointerDown}
              onPointerMove={onBoardPointerMove}
              onPointerUp={onBoardPointerEnd}
              onPointerCancel={onBoardPointerEnd}
              onDoubleClick={onBoardDblClick}
              onDragOver={onBoardDragOver}
              onDragLeave={() => setBoardDragOver(false)}
              onDrop={onBoardDrop}
            >
              {/* H1 世界容器:pan/zoom 只动它一个 transform(手势中 rAF 直写,不过 React) */}
              <div className="create-world" ref={worldRef} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
              {boardCards.map((bc, seq) => {
                if (boardFocus && boardFocus.id === bc.id) return null; // H4:聚焦中的卡由聚焦面板顶替,迷你投影隐去
                const c = (bc.card && bc.card.data) || bc.card || {};
                const nm = c.name || c.title || (bc.isDraft ? "Untitled draft" : "Untitled");
                const pos = boardCardPos(bc, bc.kSeq); // 落位偏移按 kind 内序号(全局 seq 会把不同台的卡串到一条线上)
                const on = boardSel && boardSel.id === bc.id;
                return (
                  <div
                    key={bc.key}
                    className={"create-bcard" + (on ? " is-on" : "") + (bc.isDraft ? " is-draft" : "")}
                    style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
                    data-bckey={bc.key}
                    onPointerDown={(e) => {
                      if (spaceRef.current || e.button === 1 || e.button === 2) return; // 右/中键或 Space=板平移,让事件冒泡到板
                      e.stopPropagation();
                      onCardPointerDown(e, bc, pos);
                    }}
                    onPointerMove={onCardPointerMove}
                    onPointerUp={(e) => onCardPointerUp(e, bc)}
                    onPointerCancel={onCardPointerCancel}
                    onLostPointerCapture={onCardPointerCancel}
                    onDoubleClick={() => onCardEnter(bc)}
                    onKeyDown={(e) => {
                      // H3 纯键盘流:Tab 到卡,Enter=选中,已选中再 Enter=进入(镜像单击/双击)
                      if (e.key !== "Enter" || e.target !== e.currentTarget) return;
                      e.preventDefault();
                      if (boardSel && boardSel.id === bc.id) onCardEnter(bc);
                      else selectCard(bc);
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={bc.zh + " · " + nm}
                  >
                    <span className="create-bcard-kind t-meta">
                      {bc.zh}
                      {bc.isDraft && <span className="create-bcard-live" title="Editing" />}
                    </span>
                    <span className="create-bcard-name t-kai">{nm}</span>
                    <span className="create-bcard-sub t-meta">{boardSub(bc.card) || (bc.isDraft ? "Brainstorming…" : "On station")}</span>
                    {/* H5 信号上卡(template P2:信号=一等可点对象):busy 墨点/火候线→圈选/蓝图徽→批准 */}
                    {bc.isDraft && (() => {
                      const dd = desks[bc.kk];
                      const dPhase = deskPhase(dd);
                      if (bc.kk === kind && busy) {
                        return <span className="create-bsig-busy" title="AI is writing…" aria-label="AI working" />;
                      }
                      if (dPhase === "understand" && ((dd.comp || 0) > 0 || (dd.questions || []).length)) {
                        return (
                          <button
                            className="create-bsig"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); focusCard(bc); }}
                            title={"Completeness " + (dd.comp || 0) + " · Open to keep brainstorming"}
                          >
                            <span className="create-bsig-line"><span style={{ width: (dd.comp || 0) + "%" }} /></span>
                            <span className="t-meta">Brainstorming · {dd.comp || 0}</span>
                          </button>
                        );
                      }
                      if (dPhase === "blueprint") {
                        return (
                          <button
                            className="create-bsig create-bsig-bp"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); focusCard(bc); }}
                            title="Blueprint ready. Open it to approve and start writing"
                          >
                            Blueprint ready ✦
                          </button>
                        );
                      }
                      return null;
                    })()}
                  </div>
                );
              })}
              {/* H6 双击空白:四卡种落卡菜单(世界锚点+逆缩放;点空白/Esc 由 board pointerdown 收) */}
              {spawnAt && (
                <div className="create-ctxanchor" style={{ left: spawnAt.x, top: spawnAt.y }}>
                  <div
                    className="create-ctxbar create-spawnmenu"
                    style={{ transform: `scale(${1 / view.z})` }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    role="menu"
                    aria-label="Place a card here"
                  >
                    {KINDS.map((t) => (
                      <button key={t.k} className="create-kind-btn" onClick={() => spawnDraftAt(t.k, spawnAt)}>
                        <span className="create-kind-nm">{t.zh}</span>
                        <span className="create-kind-sub">{t.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* I 系列:H5 批注笺退役——AI 的话常驻 sidebar 对话流,不再飘卡旁 */}
              {/* H2 上下文工具条:选中即见(替换 hover 即现的小钮——误触族的根)。
                  锚点在世界系(随卡 pan/zoom),条本体逆缩放保持视觉恒定;动作按卡态给(块型×动作矩阵)。
                  聚焦态不渲染——迷你卡已隐,工具条留在原地会成孤儿(主理人截图坐实)。 */}
              {selLive && !boardFocus && (() => {
                const bc = boardCards.find((b) => b.id === selLive.id);
                if (!bc) return null;
                const pos = boardCardPos(bc, bc.kSeq);
                // 块型×动作矩阵(计划 §2):draft 按构思/落笔态,built 全套;selectCard 已把 ki 切到该台,phase 即该台相位
                const acts = bc.isDraft
                  ? phase === "drafting"
                    ? [
                        { t: "Edit", fn: () => focusCard(bc) },
                        { t: "Reference", fn: () => addRef(refFromCard(bc.kk, desks[bc.kk].draft)) },
                        { t: "Add to station", fn: nextCard },
                        { t: "Export", fn: () => exportCard(desks[bc.kk].draft, bc.kk) },
                      ]
                    : [
                        { t: "Brainstorm", fn: () => focusCard(bc) },
                        { t: "Add notes", fn: openSeed },
                        { t: "Discard", fn: () => discardDraft(bc.kk), danger: true },
                      ]
                  : [
                      { t: "View", fn: () => focusCard(bc) },
                      { t: "Reference", fn: () => addRef(refFromCard(bc.kk, bc.card)) },
                      { t: "Adapt", fn: () => adaptFromBoard(bc) },
                      { t: "Export", fn: () => exportCard(bc.card, bc.kk) },
                      { t: "Remove", fn: () => removeBuilt(bc.kk, bc.card && bc.card._bid), danger: true },
                    ];
                return (
                  <div className="create-ctxanchor" style={{ left: pos.x, top: pos.y }}>
                    <div
                      className="create-ctxbar"
                      style={{ transform: `scale(${1 / view.z})` }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      role="toolbar"
                      aria-label="Card actions"
                    >
                      {acts.map((a) => (
                        <button key={a.t} className={a.danger ? "is-danger" : ""} onClick={a.fn}>{a.t}</button>
                      ))}
                    </div>
                  </div>
                );
              })()}
              </div>
              {boardCards.length === 0 && (
                <div className="create-board-empty" onPointerDown={(e) => e.stopPropagation()}>
                  <span className="create-card-blank-seal t-kai" aria-hidden="true">+</span>
                  <span className="t-meta">
                    <StaggeredText text="The board is empty. Start a card:" as="span" segmentBy="chars" delay={16} duration={0.3} direction="bottom" blur={false} respectReducedMotion />
                  </span>
                  {/* 修复(主理人审核反馈):新建入口就放在眼前——H3 把「+卡」搬去左 rail 后,
                      空板文案曾指向已不存在的顶部按钮,新用户寸步难行 */}
                  <div className="create-empty-news">
                    {KINDS.map((t) => (
                      <button key={t.k} className="create-boardbar-new create-kind-btn" onClick={() => newCardOf(t.k)}>
                        <span className="create-kind-nm">+ {t.zh}</span>
                        <span className="create-kind-sub">{t.sub}</span>
                      </button>
                    ))}
                  </div>
                  <span className="t-meta">Or double-click any empty spot to place a card, or:</span>
                  <div className="create-blank-more t-meta">
                    <button className="create-blank-link" onClick={() => setTplOpen(true)}>Start from a template</button>
                    ·
                    <button className="create-blank-link" onClick={() => setImportOpen({ step: "pick", text: "", err: "" })}>Import existing content</button>
                    ·
                    <button className="create-blank-link" onClick={openSeed}>Attach source notes</button>
                  </div>
                </div>
              )}
              {/* 工具 rail=能力总入口(主理人审核拍板):所有已有功能带字可见——
                  工具(选择/抓手)/起手(新建/模板/导入)/内容源(资料/引用/素材/拆回)/产出(导出)。
                  装订/发布/对话留在顶部 boardbar(文件级);快捷键 V/H/1-4/⌘0 不变 */}
              <div className="create-rail" role="toolbar" aria-label="Board tools" aria-orientation="vertical" onPointerDown={(e) => e.stopPropagation()}>
                {/* 主理人 2026-07-13 拍板:rail 换 react-bits LineSidebar 完整复刻(指针接近=右移染朱砂+线标伸长,等宽序号+项间刻度)。
                    选择/抓手已退役(左键=选择,右键拖=平移);activeIndex=null 让点按不留常亮(全是瞬时动作),导出无草稿禁用 */}
                <LineSidebar
                  items={[
                    { label: "New", title: "New card (1-4, or double-click empty board space)" },
                    { label: "Templates", title: "Start from a template: the skeleton drops straight onto the canvas" },
                    { label: "Import", title: "Import existing content: paste / upload document / Tavern card" },
                    { label: "Notes", title: "Attach source notes: the AI consults them every turn" },
                    { label: "Reference", title: "Reference existing cards / prompts (or type @)" },
                    { label: "Library", title: "Add cards from my Card Library to this station" },
                    { label: "Unpack", title: "Unpack a story I published back into the four stations" },
                    { label: "Export", title: hasDraft ? "Export the current draft as JSON" : "No draft on the canvas yet", disabled: !hasDraft },
                  ]}
                  activeIndex={null}
                  onItemClick={(i) => {
                    const acts = [
                      () => setRailNew((v) => !v),
                      () => { setRailNew(false); setTplOpen(true); },
                      () => { setRailNew(false); setImportOpen({ step: "pick", text: "", err: "" }); },
                      () => { setRailNew(false); openSeed(); },
                      () => { setRailNew(false); refPanel ? setRefPanel(null) : openRefPanel("desk"); },
                      () => { setRailNew(false); openLib(); },
                      () => { setRailNew(false); openPresets(); },
                      () => exportCard(desk.draft),
                    ];
                    acts[i]();
                  }}
                  accentColor="var(--accent)"
                  textColor="var(--muted)"
                  markerColor="color-mix(in srgb, var(--fg) 28%, transparent)"
                  markerLength={30}
                  markerGap={10}
                  maxShift={12}
                  proximityRadius={90}
                  itemGap={13}
                  fontSize={0.92}
                  smoothing={90}
                />
                {railNew && (
                  <div className="create-rail-fly" role="menu" aria-label="New card type">
                    {KINDS.map((t, i) => (
                      <button
                        key={t.k}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("application/x-ais-spawn", t.k); // 拖出到画布=按位置落卡
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                        onClick={() => { setRailNew(false); newCardOf(t.k); }}
                        title={"Click to create, or drag onto the canvas (" + (i + 1) + ")"}
                        className="create-kind-btn"
                      >
                        <span className="create-kind-nm">+ {t.zh}</span>
                        <span className="create-kind-sub">{t.sub}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* 每次进页的操作提示(主理人拍板):左键/右键分工 9s 自动收,× 手动收 */}
              {ctrlHint && (
                <div className="create-ctrlhint t-meta" role="note" onPointerDown={(e) => e.stopPropagation()}>
                  <span>Left-click: select / drag cards · Right-drag: pan · Ctrl+scroll: zoom · Double-click empty space: new card</span>
                  <button aria-label="Dismiss tip" onClick={() => setCtrlHint(false)}>×</button>
                </div>
              )}
              {/* H1 缩放控件:± 板中心锚定;点 % 回 100%;适配=装下全部卡 */}
              <div className="create-zoomctl t-meta" aria-label="Board zoom" onPointerDown={(e) => e.stopPropagation()}>
                <button onClick={() => zoomTo(viewRef.current.z / 1.2)} aria-label="Zoom out">−</button>
                <button className="create-zoomctl-pct" onClick={() => zoomTo(1)} title="Reset to 100%">{Math.round(view.z * 100)}%</button>
                <button onClick={() => zoomTo(viewRef.current.z * 1.2)} aria-label="Zoom in">＋</button>
                <button onClick={fitAllCards} title="Fit all cards">Fit</button>
              </div>
            </div>

            {/* G0 聚焦态:双击放大编辑——draft=现有画布全套;built=只读字段 */}
            {/* H4 相机聚焦:overlay 退役——面板落在板内(screen 空间,scale=1 编辑),相机已推进到卡位;
                无 shade,点板空白/Esc/回画板=拉回原视口。z44 层级消失,抽屉/dock 恢复自然层序。 */}
            {boardFocus && (
              <div className="create-focuscard" role="region" aria-label="Focused editing">
                <div className="create-focuscard-in">
                  <div className="create-focus-top">
                    <button className="create-blank-link" onClick={exitFocus}>← Back to board</button>
                    {isDraftId(boardFocus) && (
                      <span className="create-focus-acts">
                        <Button variant="line" onClick={nextCard} disabled={!hasDraft}>Add to station</Button>
                        <Button variant="line" onClick={saveCard} disabled={!hasDraft || savingCard}>{savingCard ? "Saving…" : "Save to library"}</Button>
                      </span>
                    )}
                  </div>
                  {!isDraftId(boardFocus) ? (
                    <div className="create-focus-built">
                      {(() => {
                        const card = resolveBuilt(boardFocus);
                        if (!card) return <div className="create-shelf-empty t-meta">This card is gone (it may have been removed).</div>;
                        const c = (card && card.data) || card || {};
                        return (
                          <>
                            <div className="create-card-name t-kai">{c.name || c.title || "Untitled"}</div>
                            <div className="create-card-fields">
                              {cardFields(card).map((f, j) => (
                                <div className="create-field" key={j}>
                                  <span className="create-field-k t-meta">{f.k}</span>
                                  <span className="create-field-v t-ui-sm">{f.v}</span>
                                </div>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ) : (
              <section className="create-canvas" aria-label="Card canvas">
                <div className="create-card-kind t-meta">{KINDS[ki].zh} · {KINDS[ki].sub}{desk.built.length > 0 && ` · ${desk.built.length} built here`}</div>
                {/* R3 阶段条(主理人试样拍板):构思→落笔→收尾,由真实门控驱动(phase/comp/60 分线)。
                    骨架路径直通落笔=构思打勾,如实;comp 过线才亮收尾(纯聊构思路径才有 comp)。 */}
                {isDraftId(boardFocus) && (() => {
                  const stage = phase !== "drafting" ? 0 : (desk.comp || 0) >= COMP_THRESHOLD ? 2 : 1;
                  const names = ["Brainstorm", "Write", "Finish"];
                  return (
                    <div className="create-phasesteps" aria-label={"Creation stage: " + names[stage]}>
                      {names.map((s, i) => (
                        <span key={s} className="create-phasestep-w">
                          <span className={"create-phasestep" + (i < stage ? " is-done" : i === stage ? " is-on" : "")}>
                            {i < stage ? "✓" : i + 1}
                          </span>
                          <span className={"create-phasestep-t t-meta" + (i === stage ? " is-on" : "")}>{s}</span>
                          {i < 2 && <span className={"create-phasestep-line" + (i < stage ? " is-done" : "")} aria-hidden="true" />}
                        </span>
                      ))}
                    </div>
                  );
                })()}
                {editingKey === "__name" ? (
                  <input
                    className="create-card-name create-name-edit t-kai"
                    autoFocus
                    value={editVal}
                    placeholder="Name it…"
                    onChange={(e) => setEditVal(e.target.value)}
                    onKeyDown={(e) => editKeys(e, true)}
                    onBlur={commitFieldEdit}
                    aria-label="Card name"
                  />
                ) : (
                  <button className="create-card-name create-name-btn t-kai" onClick={startNameEdit} title="Click to rename">
                    {draftName}
                    <span className="create-name-hint" aria-hidden="true">✎</span>
                  </button>
                )}
                {kind === "characters" && (avatar || portrait) && (
                  <div className="create-pics-preview">
                    {avatar && <span className="create-pics-av" style={{ backgroundImage: `url("${avatar}")` }} aria-label="Avatar" />}
                    {portrait && <span className="create-pics-portrait" style={{ backgroundImage: `url("${portrait}")` }} aria-label="Portrait" />}
                  </div>
                )}
                <div className="create-card-fields">
                  {fields.length ? (
                    fields.map((f, fi) => {
                      // P2b:世界书条目/故事书节拍=结构编辑块(标题/触发词/内容,世界书另有公开↔隐藏);
                      // 长按条目空白处=AI 只改这条(伪字段进 aiCtx 定向指令管线);输入控件自己 stopPropagation。
                      const spec = ENTRY_SPECS[f.k0];
                      if (spec && Array.isArray(desk.draft[f.k0])) {
                        const arr = desk.draft[f.k0] || [];
                        return (
                          <div className="create-field create-field-entries" style={{ "--ci": Math.min(fi, 8) }} key={f.k0}>
                            <span className="create-field-k t-meta">
                              {f.k}
                              <span className="create-entry-note">
                                <BlurHighlight highlightedBits={["trigger word"]} highlightColor="color-mix(in srgb, var(--accent) 16%, transparent)" blurAmount={5}>
                                  {f.k0 === "entries" ? "Injected into the AI only when the player mentions a trigger word" : "This beat advances when the player mentions a trigger word"}
                                </BlurHighlight>
                              </span>
                            </span>
                            <div className="create-entries">
                              {arr.map((en, i) => {
                                const keysArr = en[spec.keysKey] || [];
                                const title = en[spec.titleKey] || "";
                                return (
                                  <div
                                    className="create-entry"
                                    key={f.k0 + "#" + i}
                                    onPointerDown={(e) => {
                                      if (e.button !== 0 || e.target.closest("input,textarea,button")) return;
                                      lpStart(e.currentTarget, e, () =>
                                        openAiForField({ k: `${spec.zh} · ${title || "Untitled"}`, k0: f.k0, empty: !(en[spec.bodyKey] || "").trim() })
                                      );
                                    }}
                                    onPointerUp={lpCancel}
                                    onPointerLeave={lpCancel}
                                    onPointerCancel={lpCancel}
                                  >
                                    <div className="create-entry-row">
                                      <input
                                        className="create-entry-title"
                                        value={title}
                                        placeholder={spec.zh + " title"}
                                        aria-label={spec.zh + " title"}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onChange={(e) => patchEntryAt(f.k0, i, { [spec.titleKey]: e.target.value })}
                                      />
                                      {spec.canHide && (
                                        <button
                                          className={"create-entry-vis" + (en.visibility === "hidden" ? " is-hidden" : "")}
                                          title={en.visibility === "hidden" ? "Hidden entry: secret lore, never injected or shown to players. Click to make public" : "Public entry. Click to hide (secret lore)"}
                                          onPointerDown={(e) => e.stopPropagation()}
                                          onClick={() => patchEntryAt(f.k0, i, { visibility: en.visibility === "hidden" ? "public" : "hidden" })}
                                        >
                                          {en.visibility === "hidden" ? "S" : "P"}
                                        </button>
                                      )}
                                      <button
                                        className="create-entry-del"
                                        title={"Delete this " + (f.k0 === "entries" ? "entry" : "beat")}
                                        aria-label={"Delete " + spec.zh.toLowerCase()}
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={() => delEntryAt(f.k0, i)}
                                      >
                                        ×
                                      </button>
                                    </div>
                                    <input
                                      className="create-entry-keys"
                                      key={"keys" + i + ":" + keysArr.join(", ")}
                                      defaultValue={keysArr.join(", ")}
                                      placeholder="Trigger words, comma-separated"
                                      aria-label="Trigger words"
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onBlur={(e) => patchEntryAt(f.k0, i, { [spec.keysKey]: splitKeys(e.target.value) })}
                                    />
                                    {!keysArr.length && <div className="create-entry-warn t-meta">No trigger words, so this will never appear</div>}
                                    <textarea
                                      className="create-entry-body"
                                      rows={2}
                                      value={en[spec.bodyKey] || ""}
                                      placeholder={f.k0 === "entries" ? "What this entry says" : "What happens in this beat"}
                                      aria-label={spec.zh + " content"}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onChange={(e) => patchEntryAt(f.k0, i, { [spec.bodyKey]: e.target.value })}
                                    />
                                  </div>
                                );
                              })}
                              <button className="create-entry-add" onClick={() => addEntryAt(f.k0)}>
                                + Add {f.k0 === "entries" ? "an entry" : "a beat"}
                              </button>
                            </div>
                          </div>
                        );
                      }
                      return (
                      <div
                        className={
                          "create-field" +
                          (f.fresh ? " is-fresh" : "") +
                          (editingKey === f.k0 ? " is-editing" : "") +
                          (aiOpen && aiCtx && aiCtx.type === "field" && aiCtx.f.k0 === f.k0 ? " is-aictx" : "")
                        }
                        style={{ "--ci": Math.min(fi, 8) }}
                        key={f.k0}
                        onPointerDown={(e) => {
                          // I 系列:长按字段=唯一 AI 入口(按压点进度环,语境=这一块)
                          if (e.button !== 0 || editingKey === f.k0) return;
                          lpStart(e.currentTarget, e, () => openAiForField(f));
                        }}
                        onPointerUp={lpCancel}
                        onPointerLeave={lpCancel}
                        onPointerCancel={lpCancel}
                      >
                        <span className="create-field-k t-meta">
                          {f.k}
                          {f.hidden && <span className="create-field-seal" title="Hidden truth, not visible to players">S</span>}
                        </span>
                        {editingKey === f.k0 ? (
                          <textarea
                            className="create-field-edit t-ui-sm"
                            autoFocus
                            rows={Math.min(8, Math.max(2, f.list ? editVal.split("\n").length + 1 : Math.ceil((editVal.length + 1) / 26)))}
                            value={editVal}
                            onChange={(e) => setEditVal(e.target.value)}
                            onKeyDown={(e) => editKeys(e)}
                            onBlur={commitFieldEdit}
                            placeholder={f.list ? "One per line; blank lines are ignored" : undefined}
                            aria-label={"Edit " + f.k}
                          />
                        ) : f.empty || !f.v.trim() ? (
                          <span className="create-field-v create-field-v-empty t-ui-sm">
                            {tplHints[f.k0]
                              ? tplHints[f.k0] + (f.editable ? " (✦ AI fill / ✎ write it yourself)" : " (fill it in via the AI chat)")
                              : f.editable
                              ? "Empty. Long-press to have the AI fill it in, or ✎ write it yourself"
                              : "Empty. Long-press to have the AI fill it in"}
                          </span>
                        ) : (
                          <span className="create-field-v t-ui-sm">{f.hidden ? "(Hidden truth, not visible to players) " + f.v : f.v}</span>
                        )}
                        {/* P2c 防上帝视角:已知写了、未知空着=提示配对(引擎把两者一起进 prompt,缺「不知道」悬念全漏) */}
                        {kind === "players" && f.k0 === "unknown" &&
                          !!(desk.draft.known_facts || []).length && !(desk.draft.unknown || []).length && (
                            <div className="create-field-pairwarn t-meta">"Known at start" is filled in but this is empty. Without saying what the player does not know, they start out knowing everything and the suspense leaks away.</div>
                          )}
                        {editingKey !== f.k0 && f.editable && (
                          <span className="create-field-acts">
                            {/* I 系列:✦/⟳/「聊」/指示行退役——AI 统一走「长按这一块」;✎ 手改(非 AI)保留 */}
                            <button
                              className="create-field-act"
                              disabled={busy}
                              title="Edit by hand"
                              aria-label={"Edit " + f.k}
                              onPointerDown={(e) => e.stopPropagation()}
                              onClick={() => startFieldEdit(f)}
                            >
                              ✎
                            </button>
                          </span>
                        )}
                      </div>
                      );
                    })
                  ) : phase !== "drafting" &&
                    (desk.messages.length > 1 || (desk.questions || []).length > 0 || (desk.blueprint || []).length > 0) ? (
                    /* F8 构思纸面:聊开(或已有构思产物)之后,火候线/助手追问/圈选词/蓝图直接长在画布上 */
                    <div className="create-muse">
                      <div
                        className="create-comp"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={desk.comp || 0}
                        aria-label="Card completeness"
                      >
                        <span className="create-comp-label t-meta">
                          Completeness <CountUp to={desk.comp || 0} duration={0.7} />
                          <span className="create-comp-hint">{(desk.comp || 0) >= COMP_THRESHOLD ? " · Ready to write" : ` · Writing starts at ${COMP_THRESHOLD}`}</span>
                        </span>
                        <span className="create-comp-line" aria-hidden="true">
                          <span className="create-comp-fill" style={{ width: `${Math.min(100, desk.comp || 0)}%` }} />
                          <span className="create-comp-mark" style={{ left: `${COMP_THRESHOLD}%` }} />
                        </span>
                      </div>
                      <div className="create-muse-say">
                        <span className="create-say-who t-kai">Assistant</span>
                        {busy ? (
                          <div className="create-muse-tx t-ui create-msg-typing">
                            <span className="create-dot" aria-hidden="true" />
                            <span className="create-dot" aria-hidden="true" />
                            <span className="create-dot" aria-hidden="true" />
                            Thinking…
                          </div>
                        ) : (
                          <div className="create-muse-tx t-ui">{lastAi ? lastAi.show || lastAi.text : ""}</div>
                        )}
                      </div>
                      {/* E3 圈选词(F8 迁进画布):虚线下划可点词组,点选转朱砂实线;「其他」=填空线 */}
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
                                    placeholder="Other: write your own…"
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
                              Submit answers
                            </Button>
                            <span className="create-quiz-skip t-meta">No need to answer everything. You can also just type below.</span>
                          </div>
                        </div>
                      )}
                      {/* E4 蓝图(F8 迁进画布):破折号要点直排纸面;唯一的重元素是那颗批准钮 */}
                      {phase === "blueprint" && (desk.blueprint || []).length > 0 && !busy && (
                        <div className="create-bp">
                          <div className="create-bp-h t-kai">Blueprint · How this card will be written</div>
                          {desk.blueprint.map((b, i) => (
                            <div className="create-bp-item t-ui" key={i}>— {b}</div>
                          ))}
                          <input
                            className="create-ask-line t-ui-sm"
                            value={bpNote}
                            disabled={busy}
                            placeholder="Any last request before writing (optional), e.g. more dialogue, less flowery"
                            onChange={(e) => setBpNote(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !(e.nativeEvent || e).isComposing && !busy) {
                                e.preventDefault();
                                approveBlueprint();
                              }
                            }}
                            aria-label="Note before writing"
                          />
                          <div className="create-bp-foot">
                            <Button variant="primary" onClick={approveBlueprint}>Approve and write</Button>
                            <button
                              className="create-blank-link"
                              onClick={() => {
                                patch(kind, { phase: "understand" });
                                requestAnimationFrame(() => dockInputRef.current && dockInputRef.current.focus());
                              }}
                            >
                              Keep chatting
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="create-card-blank">
                      <span className="create-card-blank-seal t-kai" aria-hidden="true">✎</span>
                      <span className="create-card-blank-tx t-meta">
                        {phase !== "drafting" ? "Brainstorm stage: answer the questions below to raise completeness. At 60 a blueprint is generated; approve it to start writing." : OPENINGS[kind]}
                      </span>
                      {/* 空台引子:起手句进画布空卡里(点了只进输入框,不代发) */}
                      {desk.messages.length <= 1 && !busy && (
                        <div className="create-starters">
                          <span className="create-starters-h t-meta">Try one</span>
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
                          Start from a template
                        </button>
                        ·
                        <button className="create-blank-link" onClick={() => setImportOpen({ step: "pick", text: "", err: "" })}>
                          Import existing content
                        </button>
                        ·
                        <button className="create-blank-link" onClick={openSeed}>
                          {desk.seed ? `Source notes · ${seedLenLabel(desk.seed)}` : "Attach source notes"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
                  )}
                </div>
              </div>
            )}

            {/* I 系列:AI 对话 sidebar——唯一对话场所(长按任意 AI 对象即达);dock 浮岛/批注行退役 */}
            {aiOpen && (
              <aside
                ref={aiElRef}
                className={"create-ai" + (refDragOver ? " is-dropping" : "")}
                style={{ transform: `translate(${aiPos.x}px, ${aiPos.y}px)` }}
                role="complementary"
                aria-label="AI chat"
                onDragOver={(e) => {
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
                    flash("Couldn't drop this card in (its data is unreadable)");
                  }
                }}
              >
                <div
                  className="create-ai-h"
                  onPointerDown={onAiHeadDown}
                  onPointerMove={onAiHeadMove}
                  onPointerUp={onAiHeadUp}
                  onPointerCancel={onAiHeadUp}
                  onDoubleClick={() => setAiPos({ x: 0, y: 0 })}
                  title="Drag to move · double-click to reset"
                >
                  <span className="t-kai">AI chat · {KINDS[ki].zh}</span>
                  <button className="create-modal-x" onClick={() => setAiOpen(false)} aria-label="Close chat">×</button>
                </div>
                {aiCtx && aiCtx.type === "field" && (
                  <button className="create-ai-chip" onClick={() => setAiCtx(null)} title="Click × to go back to whole-card chat">
                    {aiCtx.f.empty ? "Filling in" : "Rewriting"}: "{aiCtx.f.k}" ×
                  </button>
                )}
                {aiCtx && aiCtx.type === "built" && (
                  <div className="create-ai-chip is-note" aria-live="polite">Finished cards cannot be chatted with directly. Use Adapt on the card to make a draft first.</div>
                )}
                <div className="create-ai-flow" ref={chatRef}>
                  {desk.messages.map((m, i) => (
                    <div key={i} className={"create-say" + (m.who === "你" ? " is-me" : "")}>
                      <span className="create-say-who t-kai">{m.who === "你" ? "You" : "Assistant"}</span>
                      <span className="create-say-tx">{m.show || m.text}</span>
                    </div>
                  ))}
                  {busy && (
                    <div className="create-say">
                      <span className="create-say-who t-kai">Assistant</span>
                      <span className="create-say-tx create-msg-typing">Thinking…</span>
                    </div>
                  )}
                </div>
                {(deskRefs.length > 0 || refDragOver) && (
                  <div className="create-refs" aria-label="References attached to this station">
                    {deskRefs.map((r) => (
                      <span className="create-ref-chip t-ui-sm" key={r.label} title={`The AI consults "${r.label}" every turn`}>
                        <span className="create-ref-t">{r.type === "prompt" ? "P" : "C"}</span>
                        {r.label}
                        <button className="create-ref-x" onClick={() => removeRef(r.label)} aria-label={"Remove " + r.label}>×</button>
                      </span>
                    ))}
                    {refDragOver && <span className="create-ref-hint t-meta">Release to attach as a reference</span>}
                  </div>
                )}
                <div className="create-composer">
                  <textarea
                    ref={dockInputRef}
                    rows={3}
                    value={desk.input}
                    disabled={busy || (aiCtx && aiCtx.type === "built")}
                    placeholder={
                      aiCtx && aiCtx.type === "field"
                        ? (aiCtx.f.empty ? `How to fill in "${aiCtx.f.k}" (send empty for the default)` : `How to rewrite "${aiCtx.f.k}" (send empty for the default)`)
                        : aiCtx && aiCtx.type === "built"
                        ? "Finished cards can't be edited directly. Adapt it into a draft first"
                        : KINDS[ki].ph
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      const old = desk.input || "";
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
                        aiSend();
                      }
                    }}
                  />
                  <div className="create-composer-actions">
                    <button className="create-upload" onClick={() => { uploadHintRef.current = ""; fileRef.current && fileRef.current.click(); }} disabled={busy}>
                      Upload document
                    </button>
                    <button
                      className={"create-seed-btn" + (desk.seed ? " has-seed" : "")}
                      onClick={openSeed}
                      disabled={busy}
                      title={desk.seed ? "View / edit / clear source notes (the AI consults them every turn)" : "Attach existing lore / old card text; the AI will build on it every turn"}
                    >
                      {desk.seed ? `Notes · ${seedLenLabel(desk.seed)}` : "Add notes"}
                    </button>
                    <button
                      className={"create-seed-btn" + (deskRefs.length ? " has-seed" : "")}
                      onClick={() => (refPanel ? setRefPanel(null) : openRefPanel("desk"))}
                      disabled={busy}
                      title="Reference existing cards or prompts; the AI consults them every turn (type @ in the input to open this; on desktop you can also drag cards in)"
                    >
                      {deskRefs.length ? `@ Reference · ${deskRefs.length}` : "@ Reference"}
                    </button>
                    <Button
                      variant="primary"
                      onClick={aiSend}
                      disabled={
                        busy ||
                        (aiCtx && aiCtx.type === "built") ||
                        (aiCtx && aiCtx.type === "field" ? false : !desk.input.trim())
                      }
                    >
                      Send
                    </Button>
                  </div>
                </div>
              </aside>
            )}

          {/* I 系列:F8 对话手记抽屉退役——对话常驻 AI sidebar */}
          {false && (
            <>
              <div className="create-drawer-shade" onClick={() => setChatOpen(false)} />
              <aside className="create-drawer" role="dialog" aria-label="Chat log">
                <div className="create-drawer-h">
                  <span className="t-kai">Chat log · {KINDS[ki].zh}</span>
                  <button className="create-modal-x" onClick={() => setChatOpen(false)} aria-label="Close">×</button>
                </div>
                <div className="create-drawer-flow">
                  {desk.messages.map((m, i) => (
                    <div key={i} className={"create-say" + (m.who === "你" ? " is-me" : "")}>
                      <span className="create-say-who t-kai">{m.who === "你" ? "You" : "Assistant"}</span>
                      <div className="create-say-tx t-ui">{m.show || m.text}</div>
                    </div>
                  ))}
                  {busy && (
                    <div className="create-say">
                      <span className="create-say-who t-kai">Assistant</span>
                      <div className="create-say-tx t-ui create-msg-typing">
                        <span className="create-dot" aria-hidden="true" />
                        <span className="create-dot" aria-hidden="true" />
                        <span className="create-dot" aria-hidden="true" />
                        Thinking…
                      </div>
                    </div>
                  )}
                </div>
              </aside>
            </>
          )}

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
              Take a look →
            </button>
          )}
        </div>
      )}

      {/* —————————————— 以下弹层桌面 / 手机共用 —————————————— */}

      {/* D1 参考资料弹窗:粘贴已有设定/旧卡,存 desks[kind].seed(≤6000 字,存储即截断);
          成本明示:每一轮 build_card 都会带上它。 */}
      {seedOpen && (
        <div className="create-modal" onClick={() => setSeedOpen(false)}>
          <div className="create-modal-card" role="dialog" aria-modal="true" aria-label="Source notes" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setSeedOpen(false)} aria-label="Close">×</button>
            <h2 className="t-h2">Source notes · {KINDS[ki].zh}</h2>
            <p className="create-seed-note t-meta">
              Attach existing lore / old card text to this station: every turn, the AI will build on it and ask targeted questions about the gaps.
              Consulting it every turn makes replies slower and costlier, so clear it when you are done. Only the first 6,000 characters are saved.
            </p>
            <textarea
              className="create-seed-ta t-ui-sm"
              rows={10}
              maxLength={8000}
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              placeholder="Paste existing lore, old card text, worldbuilding notes…"
            />
            <div className={"create-seed-count t-meta" + (seedText.length > 6000 ? " is-over" : "")}>
              {seedText.length > 6000
                ? `${seedText.length} chars. Anything past 6,000 won't be saved`
                : `${seedText.length} / 6000 chars`}
            </div>
            <div className="create-seed-actions">
              {(desk.seed || "") && (
                <Button variant="line" onClick={clearSeed}>Clear</Button>
              )}
              <Button variant="primary" onClick={commitSeed}>Attach</Button>
            </div>
          </div>
        </div>
      )}

      {/* D4 故事拆回:选一条已发布预设,四类卡追加回各台 built(官方故事也可拆——拆的是副本,发布生成新预设)。 */}
      {/* F2 引用面板:桌上的卡 / 我的卡库 / 提示词——选一个挂为引用(@ 或按钮唤起) */}
      {refPanel && (
        <div className="create-modal" onClick={() => setRefPanel(null)}>
          <div className="create-modal-card" role="dialog" aria-modal="true" aria-label="References" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setRefPanel(null)} aria-label="Close">×</button>
            <h2 className="t-h2">References · The AI consults these every turn</h2>
            <div className="create-ref-tabs">
              {[["desk", "On the board"], ["lib", "My Card Library"], ["prompt", "Prompts"]].map(([t, zh]) => (
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
                  const nm = c.name || c.title || "Untitled";
                  return (
                    <button className="create-ref-row" key={kk + i + nm} onClick={() => addRef(refFromCard(kk, c))}>
                      <span className="create-ref-row-t t-ui">{nm}</span>
                      <span className="create-ref-row-d t-meta">{zh}</span>
                    </button>
                  );
                })}
                {!KINDS.some((t) => deskCards(t.k).length) && (
                  <div className="create-shelf-empty t-meta">All four stations are empty. Chat something up first, or reference from My Card Library.</div>
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
                    <div className="create-shelf-empty t-meta">Loading…</div>
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
                    <div className="create-shelf-empty t-meta">No cards of this type in your library yet.</div>
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
                    placeholder="Save a prompt you use often, e.g. cool tone, short sentences, no idioms"
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
                    Save
                  </button>
                </div>
                {prompts.length ? (
                  prompts.map((p) => (
                    <div className="create-ref-row create-prompt-row" key={p.id}>
                      <button className="create-prompt-use" onClick={() => addRef(makeRef("prompt", "Prompt · " + p.name, p.text))}>
                        <span className="create-ref-row-t t-ui">{p.name}</span>
                        <span className="create-ref-row-d t-meta">{p.text.slice(0, 46)}</span>
                      </button>
                      <button className="create-ref-x" onClick={() => setPrompts(removePrompt(p.id))} aria-label={"Delete prompt " + p.name}>×</button>
                    </div>
                  ))
                ) : (
                  <div className="create-shelf-empty t-meta">No saved prompts yet. Write one above and reference it from any station.</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {presetsModal && (
        <div className="create-modal" onClick={() => setPresetsModal(null)}>
          <div className="create-modal-card" role="dialog" aria-modal="true" aria-label="Continue from a story" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setPresetsModal(null)} aria-label="Close">×</button>
            <h2 className="t-h2">Continue editing a published story</h2>
            <p className="create-seed-note t-meta">
              Pick one and its characters / Player Cards / World Book / Story Book are added back to the four stations as a set (the original story is untouched; publishing your edits creates a new story).
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
                          {p.official && <span className="create-tpl-badge t-meta">Official</span>}
                        </span>
                        <span className="t-meta">
                          Characters ×{cnt}{d.world ? " · World Book" : ""}{d.story ? " · Story Book" : ""}{(d.playables || []).length || d.player ? " · Player Card" : ""}
                        </span>
                      </span>
                      <span className="create-lib-item-acts">
                        <button className="create-shelf-act" onClick={() => unpackPreset(p)}>Unpack to stations</button>
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="t-ui create-sub">No published stories yet.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* D3 模板选择器:骨架铺上画布,空字段自带引导;opener 只进输入框不代发。 */}
      {tplOpen && (
        <div className="create-modal" onClick={() => setTplOpen(false)}>
          <div className="create-modal-card" role="dialog" aria-modal="true" aria-label="Creation templates" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setTplOpen(false)} aria-label="Close">×</button>
            <h2 className="t-h2">Start from a template · {KINDS[ki].zh}</h2>
            <p className="create-seed-note t-meta">
              Pick a skeleton to lay on the canvas. Empty fields come with guidance: ✦ lets the AI fill them in, ✎ to write them yourself. The opener goes into the input box so you can review it before sending.
            </p>
            {/* R3 模板卡叠(主理人试样拍板):点卡面/「换一套」翻下一套,「应用这套」上画布 */}
            <div className="create-tplstack" aria-label="Template stack">
              {(TEMPLATES[kind] || []).map((t, i) => {
                const pos = tplOrder.indexOf(i);
                if (pos < 0) return null;
                const leaving = tplLeaving && pos === 0;
                const sk = t.skeleton || {};
                const chips = Array.isArray(sk.entries) && sk.entries.length
                  ? sk.entries.map((en) => en.comment || "Entry").slice(0, 4)
                  : t.skeleton
                  ? Object.keys(sk).filter((k) => k !== "name" && k !== "title").slice(0, 6).map((k) => LABELS[k] || k)
                  : ["Guided start only"];
                return (
                  <div
                    key={t.id}
                    className={"create-tplcard" + (leaving ? " is-leaving" : "")}
                    style={{
                      zIndex: 10 - pos,
                      transform: leaving ? undefined : `translateY(${-pos * 10}px) scale(${1 - pos * 0.045})`,
                      opacity: leaving ? undefined : pos > 2 ? 0 : 1 - pos * 0.18,
                      pointerEvents: pos === 0 && !tplLeaving ? "auto" : "none",
                    }}
                    onClick={() => cycleTpl()}
                  >
                    <div className="create-tplcard-h">
                      <span className="create-tplcard-nm t-kai">{t.name}</span>
                      <span className="create-tpl-badge t-meta">{t.skeleton ? `${Object.keys(sk).length} fields` : "Guided only"}</span>
                    </div>
                    <div className="create-tplcard-hint t-meta">{t.hint}</div>
                    <div className="create-tplcard-chips t-meta">
                      {chips.map((c) => (
                        <span key={c}>{c}</span>
                      ))}
                    </div>
                    <div className="create-tplcard-acts">
                      <Button variant="primary" onClick={(e) => { e.stopPropagation(); applyTemplate(t); }}>Use this one</Button>
                      {(TEMPLATES[kind] || []).length > 1 && (
                        <button className="create-blank-link" onClick={(e) => { e.stopPropagation(); cycleTpl(); }}>Next one</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* D2 导入面板:把已有内容直接变成卡——粘贴文本(identify,会入库)/上传文档(现有链路)/
          酒馆卡(纯前端解析,不入库不耗额度)。两种口径都当面写清。 */}
      {importOpen && (
        <div className="create-modal" onClick={() => setImportOpen(null)}>
          <div className="create-modal-card" role="dialog" aria-modal="true" aria-label="Import as card" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setImportOpen(null)} aria-label="Close">×</button>
            <h2 className="t-h2">Import as card · {KINDS[ki].zh}</h2>
            {importOpen.step === "pick" ? (
              <>
                <p className="create-seed-note t-meta">Turn existing content straight into a card, no need to chat from scratch.</p>
                {/* F5:解析指示(可选)——AI 解析的两条路(粘贴/上传)都会带上;酒馆卡是本地解析,吃不到 */}
                <input
                  className="create-ask-line t-ui-sm"
                  value={importOpen.hint || ""}
                  onChange={(e) => setImportOpen((m) => ({ ...m, hint: e.target.value }))}
                  placeholder="Parsing instructions (optional), e.g. focus on personality and speech style, tags in English"
                />
                <div className="create-import-picks">
                  <button className="create-import-pick" onClick={() => setImportOpen((m) => ({ step: "paste", text: "", err: "", hint: (m && m.hint) || "" }))}>
                    <span className="create-import-pick-t t-ui">Paste text</span>
                    <span className="create-import-pick-d t-meta">Prose lore / old card text, parsed into a card by the AI (also saved to your Card Library · Private)</span>
                  </button>
                  <button className="create-import-pick" onClick={() => { uploadHintRef.current = (importOpen && importOpen.hint) || ""; setImportOpen(null); fileRef.current && fileRef.current.click(); }}>
                    <span className="create-import-pick-t t-ui">Upload document</span>
                    <span className="create-import-pick-d t-meta">.txt / .md / .docx: the text is extracted, then same as above (≤2MB)</span>
                  </button>
                  {kind === "characters" && (
                    <button className="create-import-pick" onClick={() => tavernRef.current && tavernRef.current.click()}>
                      <span className="create-import-pick-t t-ui">Tavern character card</span>
                      <span className="create-import-pick-d t-meta">SillyTavern .json / PNG-embedded card. Parsed locally: not saved to the library, no quota used</span>
                    </button>
                  )}
                </div>
                {importOpen.err && <div className="create-import-err t-meta">{importOpen.err}</div>}
                <input ref={tavernRef} type="file" accept=".json,.png" hidden onChange={onTavernFile} />
              </>
            ) : (
              <>
                <p className="create-seed-note t-meta">
                  Paste prose lore / old card text and the AI will parse it into a {KINDS[ki].zh}. On success the card is also saved to your Card Library (private); you can delete it under Me.
                  For very long text (over ~20,000 characters), import it in parts or attach it as source notes instead.
                </p>
                <textarea
                  className="create-seed-ta t-ui-sm"
                  rows={10}
                  value={importOpen.text}
                  onChange={(e) => setImportOpen((m) => ({ ...m, text: e.target.value, err: "" }))}
                  placeholder="Paste your lore here…"
                />
                <input
                  className="create-ask-line t-ui-sm"
                  value={importOpen.hint || ""}
                  onChange={(e) => setImportOpen((m) => ({ ...m, hint: e.target.value }))}
                  placeholder="Parsing instructions (optional), e.g. focus on personality and speech style, tags in English"
                />
                <div className="create-seed-count t-meta">{importOpen.text.length} chars</div>
                {importOpen.err && <div className="create-import-err t-meta">{importOpen.err}</div>}
                <div className="create-seed-actions">
                  <Button variant="line" onClick={() => setImportOpen((m) => ({ step: "pick", text: "", err: "", hint: (m && m.hint) || "" }))}>Back</Button>
                  <Button variant="primary" onClick={importPaste} disabled={busy || !importOpen.text.trim()}>
                    {busy ? "Parsing…" : "Parse into card"}
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
            <button className="create-modal-x" onClick={() => setLibModal(null)} aria-label="Close">×</button>
            <h2 className="t-h2">Add {KINDS[ki].zh} from Card Library</h2>
            <input
              className="create-lib-search"
              value={libQ}
              onChange={(e) => setLibQ(e.target.value)}
              placeholder="Search library: name / summary…"
            />
            <div className="create-lib-list">
              {(() => {
                const s = libQ.trim().toLowerCase();
                const list = libModal.items.filter(
                  (it) => !s || (libName(it) + " " + libDesc(it)).toLowerCase().includes(s)
                );
                if (!libModal.items.length) return <p className="t-ui create-sub">No cards of this type in your library yet.</p>;
                if (!list.length) return <p className="t-ui create-sub">No matching cards. Try another keyword.</p>;
                {/* D4:行改双动作(按钮不能嵌按钮,行由 button 改 div)——加入本台=原样;改编成草稿=fork(·改) */}
                return list.map((it, i) => (
                  <div className="create-lib-item create-lib-item--row" key={i}>
                    <span className="create-lib-item-tx">
                      <span className="t-ui-sm">{libName(it)}</span>
                      <span className="t-meta">{libDesc(it).slice(0, 40)}</span>
                    </span>
                    <span className="create-lib-item-acts">
                      <button className="create-shelf-act" onClick={() => libAdd(it)}>Add to station</button>
                      <button
                        className="create-shelf-act"
                        onClick={() => {
                          if (forkToDraft(it)) setLibModal(null);
                        }}
                      >
                        Adapt as draft
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
            <button className="create-modal-x" onClick={() => setBuiltView(false)} aria-label="Close">×</button>
            <h2 className="t-h2">Built on this station: {KINDS[ki].zh} ({desk.built.length})</h2>
            <div className="create-built-list">
              {desk.built.length ? (
                desk.built.map((card, i) => {
                  const c = (card && card.data) || card || {};
                  const nm = c.name || c.title || "Untitled";
                  const entries = worldEntries(card);
                  return (
                    <div className="create-built-card" key={i}>
                      <div className="create-built-head">
                        <span className="create-built-name t-kai">{nm}</span>
                        {entries && <span className="create-built-count t-meta">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>}
                        <button className="create-built-x create-built-export" onClick={() => exportCard(card)} title="Download as JSON">Export</button>
                        <button className="create-built-x" onClick={() => removeBuilt(kind, card && card._bid)}>Remove</button>
                      </div>
                      {entries ? (
                        <div className="create-built-entries">
                          {entries.slice(0, 12).map((e, j) => {
                            const label =
                              e.comment || (Array.isArray(e.keys) ? e.keys.join(" / ") : e.keys) || `Entry ${j + 1}`;
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
                            <div className="create-built-more t-meta">…and {entries.length - 12} more</div>
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
                <p className="t-ui create-sub">No cards built on this station yet. Chat one up, then click Add to station.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 完善角色卡:立绘大图在上 + 头像圆居中名字在下 + 角色介绍可编辑,确认后 收进本台 / 收入卡库 */}
      {finalize && (
        <div className="create-modal" onClick={() => setFinalize(null)}>
          <div className="create-modal-card ct-finalize-card" role="dialog" aria-modal="true" aria-label="Finish character card" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setFinalize(null)} aria-label="Close">×</button>
            <h2 className="t-h2">Finish character card</h2>
            {/* F7b 左右结构(桌面):左=立绘主图;右=头像+名字一行 + 角色介绍。手机保持纵排。 */}
            <div className="ct-finalize-cols">
              <div className="ct-finalize-figure">
                <div className="ct-finalize-portrait">
                  <ImageCropField
                    label="Portrait (main image)"
                    hint="Detail page / board / Chat sidebar"
                    value={desk.draft.image || ""}
                    aspect={2 / 3}
                    output={{ maxW: 768, maxH: 1152, quality: 0.82 }}
                    onChange={(url) => setDraftPic("image", url)}
                  />
                </div>
              </div>
              <div className="ct-finalize-body">
                {/* 头像与名字同一行(桌面);手机沿用纵排居中 */}
                <div className="ct-finalize-avatar">
                  <ImageCropField
                    label="Avatar"
                    hint="Round avatar in Chat"
                    value={desk.draft.avatar || ""}
                    aspect={1}
                    round
                    output={{ maxW: 256, maxH: 256, quality: 0.85 }}
                    onChange={(url) => setDraftPic("avatar", url)}
                  />
                  <div className="ct-finalize-name t-kai">{draftName}</div>
                </div>
                <div className="create-preview-introhead">
                  <span className="t-h3">Character intro</span>
                  <button className="create-gen-btn" disabled={genBusy} onClick={genIntro}>
                    {genBusy ? "Generating…" : "Auto-generate"}
                  </button>
                </div>
                {/* F3:生成的口味指示(可空)——回车即生成 */}
                <input
                  className="create-ask-line t-ui-sm"
                  value={introAsk}
                  disabled={genBusy}
                  placeholder="Requirements for the intro (optional), e.g. first person, a bit self-deprecating"
                  onChange={(e) => setIntroAsk(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !(e.nativeEvent || e).isComposing && !genBusy) {
                      e.preventDefault();
                      genIntro();
                    }
                  }}
                  aria-label="Requirements for the character intro"
                />
                {/* 角色介绍可直接编辑 */}
                <textarea
                  className="ct-finalize-introedit"
                  rows={7}
                  value={desk.draft.description || ""}
                  onChange={(e) => setDraftDesc(e.target.value)}
                  disabled={genBusy}
                  placeholder="Write a character intro, or click Auto-generate to have the AI write one from the details filled in."
                />
              </div>
            </div>
            {/* 钉在弹窗可视底边:矮屏下内容超出 84vh 时主 CTA 不再沉到折叠线下(YOR-148) */}
            <div className="ct-finalize-footer">
              <Button variant="primary" full onClick={confirmFinalize}>
                {finalize.action === "desk" ? "Confirm: add to station" : "Confirm: save to library · Private"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 预览并发布:在预览里直接改文字 + 传封面 + 就地发布(取消了独立发布弹窗) */}
      {previewOpen && (
        <div className="create-preview-overlay">
          <div className="create-preview-bar">
            <span className="t-meta">Preview & publish · Edit the text / upload a cover below, then publish when you are happy</span>
            <button className="create-preview-close" onClick={closePreview} aria-label="Close">Close ×</button>
          </div>
          <div className="create-preview-scroll">
            <div className="ct-pub-edit">
              <label className="ct-pub-label t-ui-sm">Story name</label>
              <input className="ct-pub-input" value={pub.name} onChange={(e) => setPub((p) => ({ ...p, name: e.target.value }))} placeholder="Give this story a name" />
              <label className="ct-pub-label t-ui-sm">Cover (optional; if empty, a placeholder with the story name is used)</label>
              <div className="create-pub-cover">
                <button type="button" className="create-pub-cover-thumb" style={pub.cover ? { backgroundImage: `url("${pub.cover}")` } : undefined} onClick={() => coverRef.current && coverRef.current.click()} title="Upload cover">
                  {!pub.cover && <span className="t-meta">+ Upload cover</span>}
                </button>
                <input ref={coverRef} type="file" accept="image/*" hidden onChange={onCoverUpload} />
                {pub.cover && (
                  <button type="button" className="create-pub-cover-clear t-meta" onClick={() => setPub((p) => ({ ...p, cover: "" }))}>Remove cover</button>
                )}
              </div>
              <label className="ct-pub-label t-ui-sm">Synopsis (optional)</label>
              <textarea className="ct-pub-syn" rows={3} value={pub.synopsis} onChange={(e) => setPub((p) => ({ ...p, synopsis: e.target.value }))} placeholder="Sum up this story in one sentence…" />
              <label className="ct-pub-label t-ui-sm">Note from the author (optional)</label>
              <textarea className="ct-pub-syn" rows={3} value={pub.authorNote} onChange={(e) => setPub((p) => ({ ...p, authorNote: e.target.value }))} placeholder="A word to players, what inspired you…" />
              {(() => {
                const mf = publishManifest();
                return (
                  <div className="ct-pub-manifest">
                    <div className="ct-pub-manifest-h t-ui-sm">Will be made public (publishing = listed in Explore · Public):</div>
                    <ul className="ct-pub-manifest-list t-meta">
                      <li>
                        Characters ×{mf.chars.length}
                        {mf.chars.length > 0 && ": " + mf.chars.map((c) => c.name + (c.secret ? " ⚠" : "")).join(", ")}
                      </li>
                      {mf.worlds > 0 && <li>Lore Card · World Book ×{mf.worlds}</li>}
                      {mf.players.length > 0 && <li>Player Cards ×{mf.players.length}: {mf.players.join(", ")}</li>}
                      {mf.story && (
                        <li>
                          Story Book: {mf.story}
                          {mf.storyExtra > 0 && ` (only this one is published; ${mf.storyExtra} other Story Book${mf.storyExtra === 1 ? "" : "s"} on the station won't be)`}
                        </li>
                      )}
                    </ul>
                    {mf.anySecret && (
                      <div className="ct-pub-manifest-warn t-meta">
                        ⚠ Marked cards contain hidden fields such as Hidden truth, which become public along with the card. Make sure these are all cards you mean to publish; if cards from another story slipped in, remove them via View built cards.
                      </div>
                    )}
                  </div>
                );
              })()}
              <div className="ct-pub-divider t-meta">↓ Below is the detail page players will see after publishing (updates live as you edit above)</div>
            </div>
            <div className="page detail">
              <StoryHero preset={buildPreviewPreset()} onOpenChar={setPreviewChar} />
              <div className="create-preview-foot t-meta">(After publishing, players pick a character here and jump in)</div>
            </div>
          </div>
          <div className="ct-pub-foot">
            <Button variant="primary" full disabled={busy || !pub.name.trim() || !hasChars} onClick={publish}>
              {busy ? "Publishing…" : "Publish to Explore · Public"}
            </Button>
          </div>
          <CharDetailModal model={previewChar} onClose={() => setPreviewChar(null)} />
        </div>
      )}
    </div>
  );
}
