import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui";
import { postJSON, getJSON, uploadFile } from "../lib/api";
import { fileToCompressedDataURL } from "../lib/image";
import ImageCropField from "../components/ImageCropField";
import StoryHero from "../components/StoryHero";
import CharDetailModal from "../components/CharDetailModal";
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
  { zh: "角色卡", k: "characters", ph: "说说这个角色……" },
  { zh: "演出卡", k: "players", ph: "说说你要扮演的主角……" },
  { zh: "设定卡 · 世界书", k: "worlds", ph: "说说这个世界 / 设定……" },
  { zh: "故事书", k: "stories", ph: "说说这个故事……" },
];
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

function blankDesk() {
  return {
    messages: [{ who: "ai", text: "想造哪张卡?说一个画面、一句话都行——聊着聊着,卡就长出来了。" }],
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
  return { characters: blankDesk(), players: blankDesk(), worlds: blankDesk(), stories: blankDesk() };
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
  const [libModal, setLibModal] = useState(null); // {items} | null
  const [libQ, setLibQ] = useState(""); // 补素材搜索
  const [builtView, setBuiltView] = useState(false); // 查看本台已建的卡(细节③)
  const [finalize, setFinalize] = useState(null); // 「完善角色卡」弹窗:null | {action:'desk'|'lib'}(收进本台 / 收入卡库)
  const [genBusy, setGenBusy] = useState(false); // 自动生成角色介绍中
  const [pub, setPub] = useState({ name: "", synopsis: "", cover: "", authorNote: "" });
  const [previewOpen, setPreviewOpen] = useState(false); // 「预览并发布」覆盖层(改文字 / 传封面 / 就地发布)
  const [previewChar, setPreviewChar] = useState(null); // 预览里角色「查看详情」
  const [cardExpanded, setCardExpanded] = useState(false); // 手机草稿细条展开看立绘 + 全部字段
  const [moreOpen, setMoreOpen] = useState(false); // 手机底部「更多」动作面板
  const fileRef = useRef(null);
  const coverRef = useRef(null);
  const chatRef = useRef(null);
  const toastT = useRef(null);
  const quotaWarnedRef = useRef(false); // 草稿写盘失败(配额)只提醒一次,写成功后复位

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

  function flash(msg) {
    setToast(msg);
    if (toastT.current) clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(""), 2200);
  }
  const patch = (kk, p) =>
    setDesks((ds) => ({ ...ds, [kk]: { ...ds[kk], ...(typeof p === "function" ? p(ds[kk]) : p) } }));

  async function send() {
    const kk = kind;
    const cur = desks[kk];
    const text = (cur.input || "").trim();
    if (!text || busy) return;
    setBusy(true);
    const apiMsgs = [...cur.messages, { who: "你", text }].map((m) => ({
      role: m.who === "你" ? "user" : "assistant",
      content: m.text,
    }));
    patch(kk, (d0) => ({ messages: [...d0.messages, { who: "你", text }], input: "" }));
    try {
      const r = await postJSON("/api/build_card", { kind: kk, messages: apiMsgs, draft: cur.draft, seed: "" });
      const ask = [r.reply, r.next_question].filter(Boolean).join(" ");
      patch(kk, (d0) => ({
        messages: [...d0.messages, { who: "ai", text: ask || "(这轮没接住——换个说法,或把内容分短一点再说一次)" }],
        draft: r.draft ? { ...r.draft, ...pickPics(d0.draft) } : d0.draft, // 保住已上传的头像/立绘
        filled: r.filled || (r.draft ? Object.keys(r.draft) : d0.filled),
      }));
    } catch (e) {
      patch(kk, (d0) => ({ messages: [...d0.messages, { who: "ai", text: "(建卡出错:" + e.message + ")" }] }));
    } finally {
      setBusy(false);
    }
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
      const out = await postJSON(IDENTIFY_EP[kk], { text });
      const draft = kk === "characters" ? out.data || out : out;
      const nm = draft.name || draft.title || "未命名";
      patch(kk, (d0) => ({
        draft: { ...draft, ...pickPics(d0.draft) }, // 保住已上传的头像/立绘
        filled: Object.keys(draft),
        messages: [...d0.messages, { who: "ai", text: "《" + nm + "》解析好了,已填进草稿卡,顺手也收进了你的卡库。哪里不对,聊着改。" }],
      }));
      flash("已解析并收入卡库");
    } catch (e) {
      patch(kk, (d0) => ({ messages: [...d0.messages, { who: "ai", text: "(解析失败:" + e.message + ")" }] }));
      flash("解析失败");
    } finally {
      setBusy(false);
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
        ...blankDesk(),
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
  async function genIntro() {
    if (genBusy) return;
    const cur = desks[kind];
    setGenBusy(true);
    try {
      const apiMsgs = [
        {
          role: "user",
          content:
            "请根据已有设定,为这个角色写一段第三人称的「角色介绍」(外貌、性格、来历、当前处境,200 字以内),写进 description 字段。",
        },
      ];
      const r = await postJSON("/api/build_card", { kind, messages: apiMsgs, draft: cur.draft, seed: "" });
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
    const d = desks[kind].draft || {};
    if (!Object.keys(d).length) {
      flash("还没有可入库的卡,先聊几句");
      return;
    }
    try {
      await postJSON("/api/library/save", { kind, data: kind === "characters" ? { data: d } : d });
      flash("已收入卡库 · 私密");
    } catch (e) {
      flash("入库失败:" + e.message);
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
      setPreviewOpen(false);
      setPreviewChar(null);
      flash("已发布到探索 · 公开");
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
        k: LABELS[k] || k,
        v: fmtVal(d[k]),
        fresh: (desk.filled || []).includes(k),
        hidden: /secret|隐藏|真相/i.test(k),
      }));
  }, [desk.draft, desk.filled]);

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
            {desk.messages.map((m, i) => (
              <div key={i} className={"create-msg" + (m.who === "你" ? " is-me" : "")}>
                <span className="create-msg-who t-meta">{m.who === "你" ? "你" : "助手"}</span>
                <p className="create-msg-text t-ui">{m.text}</p>
              </div>
            ))}
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
                <button className="ct-more-pub" onClick={openPreview} disabled={!hasChars}>预览并发布到探索 · 公开</button>
              </div>
            )}
            <div className="ct-composer">
              <textarea
                rows={1}
                value={desk.input}
                disabled={busy}
                placeholder={KINDS[ki].ph}
                onChange={(e) => patch(kind, { input: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !busy) {
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
              <Button variant="line" onClick={saveCard} disabled={!hasDraft}>收入卡库</Button>
              <button className={"ct-morebtn" + (moreOpen ? " is-on" : "")} onClick={() => setMoreOpen((v) => !v)} aria-label="更多">⋯ 更多</button>
            </div>
          </div>
        </>
      ) : (
        /* ———————————————— 桌面:两栏(对话 | 实时卡 + 操作钉死) ———————————————— */
        <>
          <div className="create-head">
            <div>
              <h1 className="t-display">创作</h1>
              <p className="t-ui create-sub">和 AI 一起,边聊边把一张卡 / 一个故事填出来。草稿自动保存。</p>
            </div>
          </div>
          <div className="create-kinds">
            {KINDS.map((t, i) => {
              const cnt = desks[t.k].built.length;
              return (
                <button key={t.k} className={"create-kind" + (i === ki ? " is-on" : "")} onClick={() => setKi(i)}>
                  {t.zh}
                  {cnt > 0 && <span className="create-kind-badge">{cnt}</span>}
                </button>
              );
            })}
          </div>

          <div className="create-body">
            {/* 对话区 */}
            <div className="create-chat">
              <div className="create-msgs" ref={chatRef}>
                {desk.messages.map((m, i) => (
                  <div key={i} className={"create-msg" + (m.who === "你" ? " is-me" : "")}>
                    <span className="create-msg-who t-meta">{m.who === "你" ? "你" : "助手"}</span>
                    <p className="create-msg-text t-ui">{m.text}</p>
                  </div>
                ))}
                {busy && (
                  <div className="create-msg">
                    <span className="create-msg-who t-meta">助手</span>
                    <p className="create-msg-text t-ui create-msg-typing">正在想……</p>
                  </div>
                )}
              </div>
              <div className="create-composer">
                <textarea
                  rows={2}
                  value={desk.input}
                  disabled={busy}
                  placeholder={KINDS[ki].ph}
                  onChange={(e) => patch(kind, { input: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && !busy) {
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
                  <Button variant="primary" onClick={send} disabled={busy || !desk.input.trim()}>
                    发送
                  </Button>
                </div>
              </div>
            </div>

            {/* 实时卡预览(卡片化 YOR-55) */}
            <aside className="create-preview">
              <div className="create-card">
                <div className="create-card-kind t-meta">{KINDS[ki].zh}{desk.built.length > 0 && ` · 本台已建 ${desk.built.length}`}</div>
                <div className="create-card-name t-kai">{draftName}</div>
                {kind === "characters" && (avatar || portrait) && (
                  <div className="create-pics-preview">
                    {avatar && <span className="create-pics-av" style={{ backgroundImage: `url("${avatar}")` }} aria-label="头像" />}
                    {portrait && <span className="create-pics-portrait" style={{ backgroundImage: `url("${portrait}")` }} aria-label="立绘" />}
                  </div>
                )}
                <div className="create-card-fields">
                  {fields.length ? (
                    fields.map((f, i) => (
                      <div className={"create-field" + (f.fresh ? " is-fresh" : "")} key={i}>
                        <span className="create-field-k t-meta">{f.k}</span>
                        <span className="create-field-v t-ui-sm">{f.hidden ? "(隐藏真相,玩家不可见)" + f.v : f.v}</span>
                      </div>
                    ))
                  ) : (
                    <div className="create-field-empty t-meta">聊着聊着,卡就长出来了。</div>
                  )}
                </div>
              </div>

              <div className="create-actions">
                <Button variant="line" onClick={saveCard} disabled={!hasDraft} title={hasDraft ? undefined : "先聊出一张卡再收入卡库"}>
                  收入卡库 · 私密
                </Button>
                <Button variant="line" onClick={nextCard} disabled={!hasDraft} title={hasDraft ? undefined : "先聊出一张卡再收进本台"}>
                  收进本台 · 再建一张
                </Button>
                {desk.built.length > 0 && (
                  <Button variant="line" onClick={() => setBuiltView(true)}>查看本台已建({desk.built.length})</Button>
                )}
                <Button variant="line" onClick={openLib}>从卡库补素材</Button>
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
            </aside>
          </div>
        </>
      )}

      {toast && <div className="create-toast t-ui-sm">{toast}</div>}

      {/* —————————————— 以下弹层桌面 / 手机共用 —————————————— */}

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
                return list.map((it, i) => (
                  <button className="create-lib-item" key={i} onClick={() => libAdd(it)}>
                    <span className="create-lib-item-tx">
                      <span className="t-ui-sm">{libName(it)}</span>
                      <span className="t-meta">{libDesc(it).slice(0, 40)}</span>
                    </span>
                    <span className="t-meta">加入 →</span>
                  </button>
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
            {/* 角色介绍可直接编辑 */}
            <textarea
              className="ct-finalize-introedit"
              rows={4}
              value={desk.draft.description || ""}
              onChange={(e) => setDraftDesc(e.target.value)}
              placeholder="写角色介绍,或点「自动生成」让 AI 按已填设定写一段。"
            />
            <Button variant="primary" full onClick={confirmFinalize}>
              {finalize.action === "desk" ? "确认收进本台" : "确认收入卡库 · 私密"}
            </Button>
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
