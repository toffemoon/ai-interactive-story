import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input } from "../components/ui";
import { postJSON, getJSON, uploadFile } from "../lib/api";
import { fileToCompressedDataURL } from "../lib/image";
import { useAuth } from "../state/auth";
import "./Create.css";

// 角色卡的用户上传图(头像/立绘)单独保住,别被 AI 重建 draft 覆盖掉。
function pickPics(d) {
  const out = {};
  if (d && d.avatar) out.avatar = d.avatar;
  if (d && d.image) out.image = d.image;
  return out;
}

// 创作 · 对话式建卡(契约固定只 reskin:/api/build_card、/api/identify*、/api/library/save、/api/presets)。
// 去中二英文(YOR-51):卡分类去英文副标、AI 助手不叫「执笔人/坊」、标题不叫「创作桌/The Atelier」。
const KINDS = [
  { zh: "角色卡", k: "characters", ph: "说说这个角色:外貌、性格、来历、口癖……" },
  { zh: "演出卡", k: "players", ph: "说说你要扮演的主角:身份、目标、能力、限制……" },
  { zh: "设定卡 · 世界书", k: "worlds", ph: "说说这个世界 / 组织 / 设定、规则……" },
  { zh: "故事书", k: "stories", ph: "说说这个故事的前提、主线、结局……" },
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const [ki, setKi] = useState(0);
  const [desks, setDesks] = useState(loadDesks);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [libModal, setLibModal] = useState(null); // {items} | null
  const [libQ, setLibQ] = useState(""); // 补素材搜索
  const [builtView, setBuiltView] = useState(false); // 查看本台已建的卡(细节③)
  const [nextModal, setNextModal] = useState(false); // 收进本台前的角色卡详情预览弹窗
  const [genBusy, setGenBusy] = useState(false); // 自动生成角色介绍中
  const [pubModal, setPubModal] = useState(false);
  const [pub, setPub] = useState({ name: "", synopsis: "", cover: "", authorNote: "" });
  const fileRef = useRef(null);
  const avatarRef = useRef(null);
  const portraitRef = useRef(null);
  const coverRef = useRef(null);
  const chatRef = useRef(null);
  const toastT = useRef(null);

  const kind = KINDS[ki].k;
  const desk = desks[kind];

  // 草稿持久化:desks 变化即落 localStorage(草稿自动保存,刷新不丢)。
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(desks));
    } catch (e) {}
  }, [desks]);

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
        messages: [...d0.messages, { who: "ai", text: "《" + nm + "》解析好了,已填进右边的草稿,顺手也收进了你的卡库。哪里不对,聊着改。" }],
      }));
      flash("已解析并收入卡库");
    } catch (e) {
      patch(kk, (d0) => ({ messages: [...d0.messages, { who: "ai", text: "(解析失败:" + e.message + ")" }] }));
      flash("解析失败");
    } finally {
      setBusy(false);
    }
  }

  // 角色卡上传 头像(avatar)/ 立绘(image):压缩成 base64 存进 draft(后端按字段持久化)。
  async function onPicUpload(ev, field) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const opts =
        field === "avatar"
          ? { maxW: 256, maxH: 256, quality: 0.85 }
          : { maxW: 768, maxH: 1152, quality: 0.82 };
      const dataUrl = await fileToCompressedDataURL(file, opts);
      patch(kind, (d0) => ({ draft: { ...d0.draft, [field]: dataUrl } }));
      flash(field === "avatar" ? "头像已设置" : "立绘已设置");
    } catch (e) {
      flash("图片处理失败:" + e.message);
    }
  }

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
    flash("已收进本台(" + nm + ")");
  }

  function nextCard() {
    const cur = desks[kind];
    if (!cur.draft || !Object.keys(cur.draft).length) {
      flash("草稿还空着,先聊出一张再收");
      return;
    }
    // 角色卡:先弹详情预览(可自动生成角色介绍),确认后再收;其它卡直接收。
    if (kind === "characters") {
      setNextModal(true);
      return;
    }
    collectToDesk(cur.draft);
  }

  // 详情预览弹窗里「自动生成」:调现有 build_card,按已填设定补一段角色介绍写进 description。
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

  async function saveCard() {
    const d = desk.draft || {};
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

  // 素材复用:列我的库 → 搜索/挑一张推进对应台子的 built。
  async function openLib() {
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
      setPubModal(false);
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

  return (
    <div className="page create">
      {/* 顶部:卡分类(去英文) */}
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
            {kind === "characters" && (
              <div className="create-pics">
                <div className="create-pic">
                  <button
                    type="button"
                    className="create-pic-thumb create-pic-thumb--avatar"
                    style={desk.draft.avatar ? { backgroundImage: `url("${desk.draft.avatar}")` } : undefined}
                    onClick={() => avatarRef.current && avatarRef.current.click()}
                    title="上传头像"
                  >
                    {!desk.draft.avatar && <span className="t-meta">+ 头像</span>}
                  </button>
                  <input ref={avatarRef} type="file" accept="image/*" hidden onChange={(e) => onPicUpload(e, "avatar")} />
                  <span className="create-pic-hint t-meta">纯聊里的头像</span>
                </div>
                <div className="create-pic">
                  <button
                    type="button"
                    className="create-pic-thumb create-pic-thumb--portrait"
                    style={desk.draft.image ? { backgroundImage: `url("${desk.draft.image}")` } : undefined}
                    onClick={() => portraitRef.current && portraitRef.current.click()}
                    title="上传立绘"
                  >
                    {!desk.draft.image && <span className="t-meta">+ 立绘</span>}
                  </button>
                  <input ref={portraitRef} type="file" accept="image/*" hidden onChange={(e) => onPicUpload(e, "image")} />
                  <span className="create-pic-hint t-meta">看板 / 纯聊右侧</span>
                </div>
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
              title={hasChars ? undefined : "至少要一张角色卡才能打包发布"}
              onClick={() => {
                setPub((p) => ({ ...p, name: p.name || (draftName !== "未命名" ? draftName : "") }));
                setPubModal(true);
              }}
            >
              打包发布到探索 · 公开
            </Button>
          </div>
        </aside>
      </div>

      {toast && <div className="create-toast t-ui-sm">{toast}</div>}

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
              autoFocus
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
                        // 设定卡 / 世界书:逐条列「条目名(关键词) · 内容摘要」,不再挤进单个字段(细节⑤修复)
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

      {/* 收进本台 · 角色卡详情预览(可自动生成角色介绍) */}
      {nextModal && (
        <div className="create-modal" onClick={() => setNextModal(false)}>
          <div className="create-modal-card" role="dialog" aria-modal="true" aria-label="角色卡预览" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setNextModal(false)} aria-label="关闭">×</button>
            <h2 className="t-h2">收进本台 · 角色卡预览</h2>
            <div className="create-preview-top">
              {desk.draft.avatar && (
                <span className="create-preview-av" style={{ backgroundImage: `url("${desk.draft.avatar}")` }} aria-hidden="true" />
              )}
              {desk.draft.image && (
                <span className="create-preview-portrait" style={{ backgroundImage: `url("${desk.draft.image}")` }} aria-hidden="true" />
              )}
              <span className="create-preview-name t-kai">{draftName}</span>
            </div>
            <div className="create-preview-introhead">
              <span className="t-h3">角色介绍</span>
              <button className="create-gen-btn" disabled={genBusy} onClick={genIntro}>
                {genBusy ? "生成中…" : "自动生成"}
              </button>
            </div>
            <p className="t-read create-preview-introtext">
              {desk.draft.description || "(还没有角色介绍。点「自动生成」让 AI 按已填设定写一段。)"}
            </p>
            <div className="create-preview-fields">
              {cardFields({ data: desk.draft })
                .filter((f) => !["简述", "avatar", "image"].includes(f.k))
                .map((f, i) => (
                  <div className="create-built-field" key={i}>
                    <span className="create-built-field-k t-meta">{f.k}</span>
                    <span className="create-built-field-v t-ui-sm">{f.v.slice(0, 80)}</span>
                  </div>
                ))}
            </div>
            <Button
              variant="primary"
              full
              onClick={() => {
                collectToDesk(desks[kind].draft);
                setNextModal(false);
              }}
            >
              确认收进本台
            </Button>
          </div>
        </div>
      )}

      {/* 发布 modal(公开) */}
      {pubModal && (
        <div className="create-modal" onClick={() => setPubModal(false)}>
          <div className="create-modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="create-modal-x" onClick={() => setPubModal(false)} aria-label="关闭">×</button>
            <h2 className="t-h2">发布为可玩故事 · 公开</h2>
            <p className="t-ui create-sub">把四个台子的成品 + 当前草稿打包成一个能在探索直接玩的完整故事。需至少一张角色卡。</p>
            <label className="create-pub-label t-ui-sm">故事名</label>
            <Input value={pub.name} onChange={(e) => setPub((p) => ({ ...p, name: e.target.value }))} placeholder="给这个故事起个名字" />
            <label className="create-pub-label t-ui-sm">封面(可空,留空按故事名自动生成)</label>
            <div className="create-pub-cover">
              <button
                type="button"
                className="create-pub-cover-thumb"
                style={pub.cover ? { backgroundImage: `url("${pub.cover}")` } : undefined}
                onClick={() => coverRef.current && coverRef.current.click()}
                title="上传封面"
              >
                {!pub.cover && <span className="t-meta">+ 上传封面</span>}
              </button>
              <input ref={coverRef} type="file" accept="image/*" hidden onChange={onCoverUpload} />
              {pub.cover && (
                <button type="button" className="create-pub-cover-clear t-meta" onClick={() => setPub((p) => ({ ...p, cover: "" }))}>
                  清除封面
                </button>
              )}
            </div>
            <label className="create-pub-label t-ui-sm">简介(可空)</label>
            <textarea
              className="create-pub-syn"
              rows={3}
              value={pub.synopsis}
              onChange={(e) => setPub((p) => ({ ...p, synopsis: e.target.value }))}
              placeholder="一句话介绍这个故事……"
            />
            <label className="create-pub-label t-ui-sm">作者的话(可空)</label>
            <textarea
              className="create-pub-syn"
              rows={3}
              value={pub.authorNote}
              onChange={(e) => setPub((p) => ({ ...p, authorNote: e.target.value }))}
              placeholder="想对玩家说的话、创作初衷、注意事项……"
            />
            <Button variant="primary" full disabled={busy} onClick={publish}>
              {busy ? "发布中…" : "确认发布"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
