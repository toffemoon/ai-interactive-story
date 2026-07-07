import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useNavigate } from "../lib/transitionNav";
import { inkInto } from "../lib/inkTransition";
import { Button } from "../components/ui";
import CardCarousel from "../components/CardCarousel";
import StoryHero from "../components/StoryHero";
import CharDetailModal from "../components/CharDetailModal";
import { getJSON, postJSON, uploadFile } from "../lib/api";
import { toCardModel } from "../lib/cardModel";
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

  // in-page 切到另一本书(/story/A → /story/B,组件不重挂):上一本的 preset/notFound
  // 是旧状态,不清掉的话下面的解析 effect 会在 `if (preset) return` 直接 bail,
  // 页面就停在旧书上、URL 和内容脱节(YOR-157)。按新 name 复位后让它重新解析。
  useEffect(() => {
    const cur = preset && ((preset.data && preset.data.name) || preset.name);
    if (preset && cur !== name) setPreset((loc.state && loc.state.preset) || null);
    setNotFound(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

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

  // 收藏(YOR-171):与探索卡背共用同一份 ais_favorites_v1,按归一化 id 判重。
  const [favs, setFavs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("ais_favorites_v1")) || { stories: [], characters: [] };
    } catch (e) {
      return { stories: [], characters: [] };
    }
  });
  const favId = preset ? toCardModel("story", preset).id : null;
  const isFaved = !!(favId && (favs.stories || []).some((raw) => toCardModel("story", raw).id === favId));
  function toggleFav() {
    if (!preset) return;
    setFavs((prev) => {
      const arr = prev.stories || [];
      const next = isFaved ? arr.filter((raw) => toCardModel("story", raw).id !== favId) : [...arr, preset];
      const updated = { ...prev, stories: next };
      try {
        localStorage.setItem("ais_favorites_v1", JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  }

  const d = (preset && preset.data) || {};
  const bookName = d.name || (preset && preset.name) || "未命名故事";
  // 「门面」(封面/标题/简介/作者的话 + 角色卡轮播)抽到 StoryHero 共享组件,创作「预览成详情页」复用同一套。

  // 选主角候选:playables 优先,空则 characters;末尾补「以旁观者开始」。
  const roleCards = useMemo(() => {
    const src = (d.playables && d.playables.length ? d.playables : d.characters) || [];
    const cards = src.map(normRole).filter((c) => c.name);
    return [...cards, { name: "以旁观者开始", persona: "不扮演特定角色,以观察者视角进入故事", spectator: true }];
  }, [preset]);

  // 扮演选择 = roleCards + 末尾「自定义角色」,做成轮播(居中卡 = 选中;居中自定义卡 = 进自定义模式)。
  const roleItems = useMemo(() => [...roleCards, { custom: true }], [roleCards]);

  const [selIdx, setSelIdx] = useState(0);
  const [charDetail, setCharDetail] = useState(null); // 角色「查看详情」弹层(细节②)
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
    inkInto(navigate, "/play"); // 落墨入局(YOR-166):墨从点击点涨圆盖屏,/play 在墨下挂载
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
          <Button variant="primary" onClick={() => navigate("/explore", { transition: "contract" })}>
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
        <div className="detail-topbar">
          <button className="detail-back t-ui-sm" onClick={() => navigate("/explore", { transition: "contract" })}>
            ← 放回书架
          </button>
          {/* 详情页收藏入口(YOR-171):和探索卡背同一份数据,书架书签同步点亮 */}
          <button className={"detail-fav t-ui-sm" + (isFaved ? " is-on" : "")} onClick={toggleFav} aria-pressed={isFaved}>
            {isFaved ? "已收藏" : "收藏"}
          </button>
        </div>

        {/* 门面(封面/标题/简介/作者的话 + 角色卡轮播)= 共享组件,跟创作「预览成详情页」同一套 */}
        <StoryHero preset={preset} onOpenChar={setCharDetail} />

        <div className="detail-rule" aria-hidden="true" />

        {/* 选主角三选一:选作者卡 / 上传 / 现场描述(横轴滚动 · 对齐边缘,细节③) */}
        <section className="detail-block">
          <h2 className="t-h3 detail-sec">选择你扮演谁</h2>
          <p className="detail-hint t-meta">拖动 / 滚轮把想扮演的那张转到中间(居中即选中)</p>
          <CardCarousel
            items={roleItems}
            activeIndex={castMode === "custom" ? roleItems.length - 1 : selIdx}
            onActiveChange={(i) => {
              if (roleItems[i] && roleItems[i].custom) setCastMode("custom");
              else {
                setSelIdx(i);
                setCastMode("list");
              }
            }}
            ariaLabel="扮演角色选择"
            renderItem={(it, { active }) =>
              it.custom ? (
                <div className={"cc-role cc-role--custom" + (active && castMode === "custom" ? " is-on" : "")}>
                  <div className="cc-role-tag t-meta">自由出演</div>
                  <div className="cc-role-name t-kai">自定义角色</div>
                  <div className="cc-role-line t-ui-sm">写下你想扮演的身份,AI 识别成演出卡</div>
                  <div className="cc-role-tick t-meta">{active && castMode === "custom" ? "编辑中" : "转到中间自定义"}</div>
                </div>
              ) : (
                <div className={"cc-role" + (active && castMode === "list" ? " is-on" : "")}>
                  <div className="cc-role-tag t-meta">{it.spectator ? "旁观" : "可扮演"}</div>
                  <div className="cc-role-name t-kai">{it.name}</div>
                  <div className="cc-role-line t-ui-sm">{it.persona || (it.spectator ? "观察者视角" : "可扮演")}</div>
                  <div className="cc-role-tick t-meta">{active && castMode === "list" ? "已选择" : "可扮演"}</div>
                </div>
              )
            }
          />

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

      {/* 角色「查看详情」= 共享组件 */}
      <CharDetailModal model={charDetail} onClose={() => setCharDetail(null)} />
    </>
  );
}
