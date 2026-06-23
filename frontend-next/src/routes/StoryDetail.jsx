import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Tag, Badge, CardShelf } from "../components/ui";
import { getJSON, postJSON, uploadFile } from "../lib/api";
import { useGame } from "../state/game";
import "./StoryDetail.css";

// 故事详情 / 选主角三选一 / 涟漪入局(继承 frontend/views/ReconStoryDetail 的契约与流程,做减法)。
//   - YOR-45:只留「简介」,删「背景介绍」。
//   - YOR-44:去英文 chrome / 多余解释,只留中文必要信息。
//   - YOR-48:减中二文案,涟漪入局固定底部。
//   - YOR-23:角色详情固定高度 + 滚动。
//   契约固定:identify_player(现场描述)/ upload(上传文档)/ presets;onEnter 装配同 startWithPlayer。
function normRole(x) {
  const d = (x && x.data) || x || {};
  return { name: d.name || x.name || "", persona: d.persona || "", description: d.description || "" };
}

export default function StoryDetail() {
  const { name } = useParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const { startGame } = useGame();

  // 优先用导航带来的 preset(从探索点进来);刷新/直链时按 name 回 /api/presets 找。
  const [preset, setPreset] = useState(() => (loc.state && loc.state.preset) || null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (preset) return;
    getJSON("/api/presets")
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        const hit = list.find((p) => (p.data && p.data.name) === name || p.name === name);
        if (hit) setPreset(hit);
        else setNotFound(true);
      })
      .catch(() => setNotFound(true));
  }, [preset, name]);

  const d = (preset && preset.data) || {};
  const bookName = d.name || (preset && preset.name) || "未命名故事";
  const synopsis = d.synopsis || (d.story && d.story.premise) || "";
  const tags = d.tags || [];
  const author = d.author || "";

  // 角色:用统一 Card · 横轴滚动(环形轮播的感觉);背面放完整介绍,长内容滚动(细节②)。
  const charModels = useMemo(
    () => (d.characters || []).map((c, i) => {
      const cd = (c && c.data) || c || {};
      const intro =
        [
          cd.look ? "外貌 · " + cd.look : "",
          cd.personality ? "性格 · " + cd.personality : "",
          cd.description || cd.persona || "",
        ]
          .filter(Boolean)
          .join("\n\n") || "入局后逐渐揭晓。";
      return {
        id: (cd.name || "char") + "#" + i,
        kind: "character",
        title: cd.name || "角色",
        cover: cd.image || cd.avatar || "",
        blurb: intro,
        badge: { label: "角色", tone: "gilt" },
        tags: (cd.tags || []).slice(0, 3),
        meta: {},
        raw: c,
      };
    }),
    [preset]
  );

  // 选主角候选:playables 优先,空则 characters;末尾补「以旁观者开始」。
  const roleCards = useMemo(() => {
    const src = (d.playables && d.playables.length ? d.playables : d.characters) || [];
    const cards = src.map(normRole).filter((c) => c.name);
    return [...cards, { name: "以旁观者开始", persona: "不扮演特定角色,以观察者视角进入故事", spectator: true }];
  }, [preset]);

  const [selIdx, setSelIdx] = useState(0);
  const [castMode, setCastMode] = useState("list"); // list | custom
  const [customText, setCustomText] = useState("");
  const [identifying, setIdentifying] = useState(false);
  const [err, setErr] = useState("");

  const selected = castMode === "custom" ? null : roleCards[selIdx] || roleCards[0];
  const enterRole = selected && !selected.spectator ? selected : null;

  // 装配并入局(同 startWithPlayer:玩家卡与 NPC 重合 → 删该 NPC,以玩家卡为主)。
  function enterStory(role) {
    const playerName = role && role.name;
    const npcs = (d.characters || []).filter(
      (c) => !playerName || ((c.data && c.data.name) || c.name) !== playerName
    );
    startGame({
      title: bookName,
      characters: npcs,
      world: d.world || null,
      story: d.story || null,
      player: role || null,
      mode: d.mode || "standard",
    });
    navigate("/play");
  }

  // 现场描述 → identify_player 识别成演出卡 → 入局。
  async function startCustom() {
    if (!customText.trim() || identifying) return;
    setErr("");
    setIdentifying(true);
    try {
      const card = await postJSON("/api/identify_player", { text: customText });
      enterStory(card);
    } catch (e) {
      setErr("识别失败:" + e.message);
    } finally {
      setIdentifying(false);
    }
  }

  async function pickFile(ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    setErr("");
    try {
      const text = await uploadFile(f);
      setCustomText(text);
      setCastMode("custom");
    } catch (e) {
      setErr("上传失败:" + e.message);
    }
  }

  if (notFound) {
    return (
      <div className="page">
        <div className="detail-missing">
          <h2 className="t-h1">没找到这个故事</h2>
          <p className="t-ui">它可能已被作者下架,或链接失效了。</p>
          <Button variant="primary" onClick={() => navigate("/explore")}>
            回到探索
          </Button>
        </div>
      </div>
    );
  }
  if (!preset) {
    return (
      <div className="page">
        <div className="detail-loading t-ui">载入故事中…</div>
      </div>
    );
  }

  return (
    <>
      <div className="page detail">
        <button className="detail-back t-ui-sm" onClick={() => navigate("/explore")}>
          ← 放回书架
        </button>

        {/* 头:封面 + 标题/标签/作者 + 简介(只留简介,删背景) */}
        <div className="detail-head">
          <div className="detail-cover" style={d.cover ? { backgroundImage: `url("${d.cover}")` } : undefined}>
            {!d.cover && <span className="detail-cover-spine t-kai">{bookName.slice(0, 8)}</span>}
          </div>
          <div className="detail-headmain">
            <Badge tone="pine">完整故事 · 可直接玩</Badge>
            <h1 className="t-display detail-title">{bookName}</h1>
            {tags.length > 0 && (
              <div className="detail-tags">
                {tags.map((t, i) => (
                  <Tag key={i}>{t}</Tag>
                ))}
              </div>
            )}
            {author && <div className="detail-author t-meta">作者 · {author}</div>}
            <div className="detail-intro">
              <h2 className="t-h3 detail-sec">简介</h2>
              <p className="t-read detail-intro-text">{synopsis || "暂无简介。"}</p>
            </div>
          </div>
        </div>

        {/* 角色:统一 Card 横轴滚动,翻面看完整介绍(细节②/YOR-23) */}
        {charModels.length > 0 && (
          <section className="detail-block">
            <h2 className="t-h3 detail-sec">角色</h2>
            <p className="detail-hint t-meta">点卡片翻面看角色介绍</p>
            <CardShelf scroll models={charModels} />
          </section>
        )}

        <div className="detail-rule" aria-hidden="true" />

        {/* 选主角三选一:选作者卡 / 上传 / 现场描述(横轴滚动 · 对齐边缘,细节③) */}
        <section className="detail-block">
          <h2 className="t-h3 detail-sec">选择你扮演谁</h2>
          <div className="detail-roles">
            {roleCards.map((c, i) => {
              const on = castMode === "list" && i === selIdx;
              return (
                <button
                  key={i}
                  className={"detail-role" + (on ? " is-on" : "")}
                  onClick={() => {
                    setSelIdx(i);
                    setCastMode("list");
                  }}
                >
                  <div className="detail-role-name t-kai">{c.name}</div>
                  <div className="detail-role-line t-ui-sm">
                    {c.persona || (c.spectator ? "观察者视角" : "可扮演")}
                  </div>
                  <div className="detail-role-tick t-meta">{on ? "已选择" : "可扮演"}</div>
                </button>
              );
            })}
            <button
              className={"detail-role detail-role--custom" + (castMode === "custom" ? " is-on" : "")}
              onClick={() => setCastMode((m) => (m === "custom" ? "list" : "custom"))}
            >
              <div className="detail-role-name t-kai">自定义角色</div>
              <div className="detail-role-line t-ui-sm">写下你想扮演的身份,AI 识别成演出卡</div>
              <div className="detail-role-tick t-meta">{castMode === "custom" ? "编辑中" : "自由出演"}</div>
            </button>
          </div>

          {castMode === "custom" && (
            <div className="detail-custom">
              <textarea
                className="detail-custom-text t-ui"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="写下你要扮演的身份:背景、目标、能力、限制、开局已知…… AI 会识别成演出卡。"
              />
              <div className="detail-custom-row">
                <label className="detail-upload t-ui-sm">
                  上传 .txt / .md / .docx
                  <input type="file" accept=".txt,.md,.docx" onChange={pickFile} hidden />
                </label>
              </div>
            </div>
          )}
          {err && <div className="detail-err t-ui-sm">{err}</div>}
        </section>

        <div className="detail-spacer" aria-hidden="true" />
      </div>

      {/* 涟漪入局:固定底部(YOR-48) */}
      <div className="detail-enterbar">
        <div className="detail-enter-info">
          <span className="detail-enter-label t-meta">即将以</span>
          <span className="detail-enter-role t-kai">
            {castMode === "custom"
              ? customText.trim()
                ? "自定义角色"
                : "（先写下身份）"
              : enterRole
              ? enterRole.name
              : "旁观者"}
          </span>
          <span className="detail-enter-label t-meta">进入</span>
        </div>
        {castMode === "custom" ? (
          <Button className="detail-enter-go" variant="primary" disabled={identifying || !customText.trim()} onClick={startCustom}>
            {identifying ? "识别中…" : "涟漪入局"}
          </Button>
        ) : (
          <Button className="detail-enter-go" variant="primary" onClick={() => enterStory(enterRole)}>
            涟漪入局
          </Button>
        )}
      </div>
    </>
  );
}
