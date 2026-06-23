import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input } from "../components/ui";
import { postJSON, getJSON, uploadFile } from "../lib/api";
import { useAuth } from "../state/auth";
import "./Create.css";

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
};
const STORE_KEY = "ais_create_desks_v1";

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
  const [pubModal, setPubModal] = useState(false);
  const [pub, setPub] = useState({ name: "", synopsis: "" });
  const fileRef = useRef(null);
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
        draft: r.draft || d0.draft,
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
        draft,
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

  function nextCard() {
    const cur = desks[kind];
    if (!cur.draft || !Object.keys(cur.draft).length) {
      flash("草稿还空着,先聊出一张再收");
      return;
    }
    const nm = cur.draft.name || cur.draft.title || "未命名";
    setDesks((ds) => ({
      ...ds,
      [kind]: {
        ...blankDesk(),
        built: [...ds[kind].built, ds[kind].draft],
        messages: [{ who: "ai", text: "《" + nm + "》放进台子了(本台第 " + (ds[kind].built.length + 1) + " 张)。说说下一张?" }],
      },
    }));
    flash("已收进本台(" + nm + ")");
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

  // 素材复用:列我的库 → 挑一张推进对应台子的 built。
  async function openLib() {
    try {
      const items = await getJSON("/api/library/" + kind);
      setLibModal({ items: Array.isArray(items) ? items : [] });
    } catch (e) {
      flash("读库失败:" + e.message);
    }
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
        cover: "",
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
  const fields = useMemo(() => {
    const d = desk.draft || {};
    return Object.keys(d)
      .filter((k) => !["name", "character_id", "id", "title"].includes(k))
      .map((k) => {
        const v = d[k];
        return {
          k: LABELS[k] || k,
          v: typeof v === "string" ? v : Array.isArray(v) ? v.join("、") : JSON.stringify(v),
          fresh: (desk.filled || []).includes(k),
          hidden: /secret|隐藏|真相/i.test(k),
        };
      });
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
            <Button variant="line" onClick={saveCard}>收入卡库 · 私密</Button>
            <Button variant="line" onClick={nextCard}>收进本台 · 再建一张</Button>
            <Button variant="line" onClick={openLib}>从卡库补素材</Button>
            <Button
              variant="primary"
              full
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
            <div className="create-lib-list">
              {libModal.items.length ? (
                libModal.items.map((it, i) => {
                  const raw = it && it.data ? it.data : it;
                  const card = kind === "characters" ? raw.data || raw : raw;
                  const nm = (card && (card.name || card.title)) || it.name || "未命名";
                  return (
                    <button className="create-lib-item" key={i} onClick={() => libAdd(it)}>
                      <span className="t-ui-sm">{nm}</span>
                      <span className="t-meta">加入本次创作 →</span>
                    </button>
                  );
                })
              ) : (
                <p className="t-ui create-sub">这个分类的卡库还空着。</p>
              )}
            </div>
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
            <label className="create-pub-label t-ui-sm">简介(可空)</label>
            <textarea
              className="create-pub-syn"
              rows={3}
              value={pub.synopsis}
              onChange={(e) => setPub((p) => ({ ...p, synopsis: e.target.value }))}
              placeholder="一句话介绍这个故事……"
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
