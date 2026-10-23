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
  const bookName = d.name || (preset && preset.name) || "Untitled story";
  // 「门面」(封面/标题/简介/作者的话 + 角色卡轮播)抽到 StoryHero 共享组件,创作「预览成详情页」复用同一套。

  // 选主角候选:playables 优先,空则 characters;末尾补「以旁观者开始」。
  const roleCards = useMemo(() => {
    const src = (d.playables && d.playables.length ? d.playables : d.characters) || [];
    const cards = src.map(normRole).filter((c) => c.name);
    return [...cards, { name: "Start as an observer", persona: "Enter the story as an observer, without playing a specific role", spectator: true }];
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
      setErr("Couldn't identify your role: " + e.message);
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
      setErr("Upload failed: " + e.message);
    }
  }

  if (notFound) {
    return (
      <div className="page">
        <div className="detail-missing">
          <h2 className="t-h1">Story not found</h2>
          <p className="t-ui">The author may have taken it down, or the link is no longer valid.</p>
          <Button variant="primary" onClick={() => navigate("/explore", { transition: "contract" })}>
            Back to Explore
          </Button>
        </div>
      </div>
    );
  }
  if (!preset) {
    return (
      <div className="page">
        <div className="detail-loading t-ui">Loading story…</div>
      </div>
    );
  }

  return (
    <>
      <div className="page detail">
        <div className="detail-topbar">
          <button className="detail-back t-ui-sm" onClick={() => navigate("/explore", { transition: "contract" })}>
            ← Back to shelf
          </button>
          {/* 详情页收藏入口(YOR-171):和探索卡背同一份数据,书架书签同步点亮 */}
          <button className={"detail-fav t-ui-sm" + (isFaved ? " is-on" : "")} onClick={toggleFav} aria-pressed={isFaved}>
            {isFaved ? "Saved" : "Save"}
          </button>
        </div>

        {/* 门面(封面/标题/简介/作者的话 + 角色卡轮播)= 共享组件,跟创作「预览成详情页」同一套 */}
        <StoryHero preset={preset} onOpenChar={setCharDetail} />

        <div className="detail-rule" aria-hidden="true" />

        {/* 选主角三选一:选作者卡 / 上传 / 现场描述(横轴滚动 · 对齐边缘,细节③) */}
        <section className="detail-block">
          <h2 className="t-h3 detail-sec">Choose who you'll play</h2>
          <p className="detail-hint t-meta">Drag or scroll the card you want to the center (centered = selected)</p>
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
            ariaLabel="Choose your role"
            renderItem={(it, { active }) =>
              it.custom ? (
                <div className={"cc-role cc-role--custom" + (active && castMode === "custom" ? " is-on" : "")}>
                  <div className="cc-role-tag t-meta">Freeform</div>
                  <div className="cc-role-name t-kai">Custom role</div>
                  <div className="cc-role-line t-ui-sm">Describe who you want to play, and AI turns it into a role card</div>
                  <div className="cc-role-tick t-meta">{active && castMode === "custom" ? "Editing" : "Center to customize"}</div>
                </div>
              ) : (
                <div className={"cc-role" + (active && castMode === "list" ? " is-on" : "")}>
                  <div className="cc-role-tag t-meta">{it.spectator ? "Observer" : "Playable"}</div>
                  <div className="cc-role-name t-kai">{it.name}</div>
                  <div className="cc-role-line t-ui-sm">{it.persona || (it.spectator ? "Observer's view" : "Playable")}</div>
                  <div className="cc-role-tick t-meta">{active && castMode === "list" ? "Selected" : "Playable"}</div>
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
                placeholder="Describe who you'll play: background, goals, abilities, limits, what you know at the start… AI will turn it into a role card."
              />
              <div className="detail-custom-row">
                <label className="detail-upload t-ui-sm">
                  Upload .txt / .md / .docx
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
          <span className="detail-enter-label t-meta">Enter as</span>
          <span className="detail-enter-role t-kai">
            {castMode === "custom"
              ? customText.trim()
                ? "Custom role"
                : "(describe your role first)"
              : enterRole
              ? enterRole.name
              : "Observer"}
          </span>
          <span className="detail-enter-label t-meta">to begin</span>
        </div>
        {castMode === "custom" ? (
          <Button className="detail-enter-go" variant="primary" disabled={identifying || !customText.trim()} onClick={startCustom}>
            {identifying ? "Identifying…" : "Enter the story"}
          </Button>
        ) : (
          <Button className="detail-enter-go" variant="primary" onClick={() => enterStory(enterRole)}>
            Enter the story
          </Button>
        )}
      </div>

      {/* 角色「查看详情」= 共享组件 */}
      <CharDetailModal model={charDetail} onClose={() => setCharDetail(null)} />
    </>
  );
}
