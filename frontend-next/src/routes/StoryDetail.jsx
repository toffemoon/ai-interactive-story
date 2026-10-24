import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useNavigate } from "../lib/transitionNav";
import { inkInto } from "../lib/inkTransition";
import TopNav from "../components/shell/TopNav";
import CharDetailModal from "../components/CharDetailModal";
import { toCastModels } from "../components/StoryHero";
import { getJSON, postJSON, uploadFile } from "../lib/api";
import { toCardModel } from "../lib/cardModel";
import { useGame } from "../state/game";
import { L } from "../lib/i18n";
import "./StoryDetail.css";
import "./StoryDetailC.css";

// 故事详情(2026-10-25 改版,画布「C 幕间 · 故事详情」):
//   页头大图(封面)+ 标签 / 书名 / 作者 / 开始游玩 / 收藏 → 简介 → 登场角色 → 你来扮演谁(一行一个身份)→ 底部固定「扮演 X · 进入故事」。
//   契约不变:identify_player(现场描述)/ register_player(带创建规则的故事先登记)/ upload(上传文档)/ presets;入局装配同 startWithPlayer。
function normRole(x) {
  const d = (x && x.data) || x || {};
  return { name: d.name || x.name || "", persona: d.persona || "", description: d.description || "" };
}

const STAR = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
  </svg>
);
const PLAY = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 4.5v15l12-7.5z" />
  </svg>
);

// 自创角色登记卡:按故事创建规则整理出的玩家卡 + 「调整了什么、为什么」,玩家确认后入局。
function RegistrationCard({ reg, onEdit }) {
  const c = reg.card || {};
  const rows = [
    [L("Role", "身份"), c.role],
    [L("Starting point", "开局"), c.opening],
    [L("Background", "背景"), c.background],
    [L("Goals", "目标"), (c.goals || []).join("; ")],
    [L("Abilities", "能力"), (c.abilities || []).join("; ")],
    [L("Limits", "限制"), (c.constraints || []).join("; ")],
    [L("Knows at the start", "开局知道"), (c.known_facts || []).join("; ")],
  ].filter(([, v]) => v);
  const adj = reg.adjustments || [];
  return (
    <div className="sd-reg" role="group" aria-label={L("Registration card", "登记卡")}>
      <div className="sd-reg-head">
        <span className="sd-reg-tag">{L("Registration card", "登记卡")}</span>
        <span className="sd-reg-name">{c.name}</span>
      </div>
      <dl className="sd-reg-rows">
        {rows.map(([k, v]) => (
          <div className="sd-reg-row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="sd-reg-adj">
        <h3>{L("What we adjusted to fit the story", "为了合乎故事做的调整")}</h3>
        {adj.length ? (
          <ul>
            {adj.map((a, i) => (
              <li key={i}>
                {a.what} → <b>{a.to}</b>
                {a.why ? <span className="sd-reg-why"> — {a.why}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>{L("Nothing — your character fits as described.", "无需调整,你的角色本身就合乎故事。")}</p>
        )}
      </div>
      <button type="button" className="sd-reg-edit" onClick={onEdit}>
        {L("Edit description", "修改描述")}
      </button>
    </div>
  );
}

function CastCard({ model, onOpen }) {
  const [broken, setBroken] = useState(false);
  const role = (model.tags || [])[0] || L("Character", "角色");
  return (
    <article className="cx-char">
      <button type="button" className="cx-char-hit" onClick={() => onOpen(model)} aria-label={L(`${model.title}: details`, `${model.title}:查看详情`)}>
        {model.cover && !broken ? (
          <img src={model.cover} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
        ) : (
          <span className="cx-char-glyph" aria-hidden="true">{model.title.charAt(0)}</span>
        )}
        <span className="cx-shade" aria-hidden="true" />
        <span className="cx-card-text">
          <span className="cx-card-name cx-card-name--char">{model.title}</span>
          <span className="cx-card-tag">{role}</span>
        </span>
      </button>
    </article>
  );
}

// 完整预设才有 characters 数组;探索页摘要(summary=1)只有卡面字段,进详情页要再取一次。
const isFullPreset = (p) => !!(p && p.data && Array.isArray(p.data.characters));

export default function StoryDetail() {
  const { name } = useParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const { startGame } = useGame();

  // 优先用导航带来的 preset(从探索点进来,可能只是摘要);不完整时按名回 /api/presets/{name} 取。
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

  // 探索页带来的是摘要(只有卡面字段);刷新/直链时什么都没有。两种情况都按名取这一本的完整内容。
  useEffect(() => {
    if (isFullPreset(preset)) return;
    const key = (preset && preset.name) || name;
    getJSON(`/api/presets/${encodeURIComponent(key)}`)
      .then((hit) => (hit && hit.data ? setPreset(hit) : setNotFound(true)))
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
  const bookName = d.name || (preset && preset.name) || L("Untitled story", "未命名故事");
  const synopsis = d.synopsis || (d.story && d.story.premise) || "";
  const authorNote = (d.author_note || "").trim();
  const tags = d.tags || [];
  const castModels = useMemo(() => toCastModels(d), [preset]);

  // 选主角候选:playables 优先,空则 characters;末尾补「以旁观者开始」。
  const roleCards = useMemo(() => {
    const src = (d.playables && d.playables.length ? d.playables : d.characters) || [];
    const cards = src.map(normRole).filter((c) => c.name);
    if (d.allow_observer === false) return cards; // 预设可关掉「以旁观者开始」(如诡秘:只能扮演书中角色或自创)
    return [...cards, { name: L("Start as an observer", "以旁观者开始"), persona: L("Enter the story as an observer, without playing a specific role", "不扮演特定角色,以观察者视角进入故事"), spectator: true }];
  }, [preset]);

  const [selIdx, setSelIdx] = useState(0);
  const [charDetail, setCharDetail] = useState(null);
  const [castMode, setCastMode] = useState("list"); // list | custom
  const [customText, setCustomText] = useState("");
  const [identifying, setIdentifying] = useState(false);
  const [err, setErr] = useState("");
  // 预设带创建规则(creation_rules)时,自创角色先按规则登记、给玩家看登记卡确认,再入局。
  const rules = d.creation_rules || "";
  const [registration, setRegistration] = useState(null); // {card, adjustments}

  const selected = castMode === "custom" ? null : roleCards[selIdx] || roleCards[0];
  const enterRole = selected && !selected.spectator ? selected : null;

  // 「你来扮演谁」:一行一个身份,末行「自己写一个身份」。单选组,方向键在行间移动。
  const options = useMemo(
    () => [
      ...roleCards.map((r, i) => ({
        key: "r" + i,
        idx: i,
        name: r.name,
        line: r.persona || L("A role written into this story", "这个故事里预设的身份"),
      })),
      {
        key: "custom",
        custom: true,
        name: L("Write your own role", "自己写一个身份"),
        line: rules
          ? L("Describe who you want to play; it's checked against the story's rules first", "写几句你想演的人,先按故事规则登记成角色卡")
          : L("Describe who you want to play and get a character card", "写几句你想演的人,生成一张角色卡"),
      },
    ],
    [roleCards, rules]
  );
  const isOn = (o) => (o.custom ? castMode === "custom" : castMode === "list" && o.idx === selIdx);
  const optRefs = useRef([]);
  function pick(o) {
    if (o.custom) setCastMode("custom");
    else {
      setSelIdx(o.idx);
      setCastMode("list");
    }
  }
  function onRolesKey(e) {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const cur = options.findIndex(isOn);
    const next = (cur + step + options.length) % options.length;
    pick(options[next]);
    if (optRefs.current[next]) optRefs.current[next].focus();
  }

  // 「开始游玩」(页头 / 探索推荐位带 focus = role 进来)= 滚到「你来扮演谁」,焦点落在选中的那行。
  const rolesRef = useRef(null);
  function goRoles() {
    const el = rolesRef.current;
    if (!el) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    const on = el.querySelector('[role="radio"][aria-checked="true"]');
    if (on) on.focus({ preventScroll: true });
  }
  const wantRoles = !!(loc.state && loc.state.focus === "role");
  const loaded = isFullPreset(preset);
  useEffect(() => {
    if (!wantRoles || !loaded) return;
    const t = setTimeout(goRoles, 380); // 等换页转场 + 回顶结束再滚
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantRoles, loaded, name]);

  // 装配并入局(同 startWithPlayer:玩家卡与 NPC 重合 → 删该 NPC,以玩家卡为主)。
  function enterStory(role) {
    const playerName = role && role.name;
    const npcs = (d.characters || []).filter(
      (c) => !playerName || ((c.data && c.data.name) || c.name) !== playerName
    );
    const cover = d.cover || "";
    startGame({
      title: bookName,
      cover: cover.startsWith("data:") ? `/api/presets/${encodeURIComponent(preset.name)}/cover` : cover,
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
    if (registration) return enterStory(registration.card);
    setErr("");
    setIdentifying(true);
    try {
      if (rules) {
        setRegistration(await postJSON("/api/register_player", { text: customText, rules }));
        return; // 登记卡出来后,玩家确认再点一次入局
      }
      const card = await postJSON("/api/identify_player", { text: customText });
      enterStory(card);
    } catch (e) {
      setErr(L("Couldn't identify your role: ", "识别失败:") + e.message);
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
      setRegistration(null);
      setCastMode("custom");
    } catch (e) {
      setErr(L("Upload failed: ", "上传失败:") + e.message);
    }
  }

  const backToExplore = () => navigate("/explore", { transition: "contract" });

  if (notFound || !loaded) {
    return (
      <div className="page sd">
        <TopNav variant="bar" />
        <div className="sd-state" role={notFound ? undefined : "status"}>
          {notFound ? (
            <>
              <h1>{L("Story not found", "没找到这个故事")}</h1>
              <p>{L("The author may have taken it down, or the link is no longer valid.", "它可能已被作者下架,或链接失效了。")}</p>
              <button type="button" className="cx-btn cx-btn--primary" onClick={backToExplore}>
                {L("Back to Explore", "回到探索")}
              </button>
            </>
          ) : (
            <p>{L("Loading story…", "载入故事中…")}</p>
          )}
        </div>
      </div>
    );
  }

  const roleLabel =
    castMode === "custom"
      ? registration
        ? registration.card.name
        : customText.trim()
        ? L("Your own role", "自己写的身份")
        : L("(describe your role first)", "(先写下身份)")
      : enterRole
      ? enterRole.name
      : L("Observer", "旁观者");

  return (
    <>
      <div className="page sd">
        <section className="sd-hero" aria-labelledby="sd-title">
          <img className="sd-hero-bg" src={d.cover || "/home/background.webp"} alt="" />
          <div className="sd-hero-shade" aria-hidden="true" />
          <div className="sd-hero-fade" aria-hidden="true" />
          <TopNav variant="overlay" />
          <div className="sd-hero-body">
            <div className="sd-head">
              <button type="button" className="sd-back" onClick={backToExplore}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
                {L("Back to Explore", "返回探索")}
              </button>
              {tags.length > 0 && (
                <p className="sd-tags">
                  {tags.map((t, i) => (
                    <span key={i}>{t}</span>
                  ))}
                </p>
              )}
              <h1 id="sd-title" className={"sd-title" + (bookName.length > 18 ? " is-long" : "")}>
                {bookName}
              </h1>
              <div className="sd-meta">
                {d.author ? <span>{L("By", "作者")} {d.author}</span> : null}
                {castModels.length > 0 ? (
                  <span>{L(`${castModels.length} ${castModels.length === 1 ? "character" : "characters"}`, `${castModels.length} 位角色`)}</span>
                ) : null}
              </div>
              <div className="sd-actions">
                <button type="button" className="cx-btn cx-btn--primary" onClick={goRoles}>
                  {PLAY}
                  {L("Play", "开始游玩")}
                </button>
                <button type="button" className={"cx-btn cx-btn--soft sd-fav" + (isFaved ? " is-on" : "")} onClick={toggleFav} aria-pressed={isFaved}>
                  {STAR}
                  {isFaved ? L("Saved", "已收藏") : L("Save", "收藏")}
                </button>
              </div>
            </div>
          </div>
        </section>

        <main className="sd-main">
          <section className="sd-sec" aria-labelledby="sd-synopsis">
            <h2 id="sd-synopsis">{L("Synopsis", "简介")}</h2>
            <p className="sd-prose">{synopsis || L("No synopsis yet.", "暂无简介。")}</p>
          </section>

          {authorNote && (
            <section className="sd-sec" aria-labelledby="sd-note">
              <h2 id="sd-note">{L("Author's note", "作者的话")}</h2>
              <p className="sd-prose">{authorNote}</p>
            </section>
          )}

          {castModels.length > 0 && (
            <section className="sd-sec" aria-labelledby="sd-cast">
              <h2 id="sd-cast">{L("Cast", "登场角色")}</h2>
              <div className="sd-cast">
                {castModels.map((m) => (
                  <CastCard key={m.id} model={m} onOpen={setCharDetail} />
                ))}
              </div>
            </section>
          )}

          <section className="sd-sec sd-roles" aria-labelledby="sd-roles-h" ref={rolesRef}>
            <div className="sd-sec-head">
              <h2 id="sd-roles-h">{L("Who will you play?", "你来扮演谁")}</h2>
              <p>{L("Pick a role to enter the story as.", "选一个身份进入故事。")}</p>
            </div>
            <div className="sd-role-list" role="radiogroup" aria-labelledby="sd-roles-h" onKeyDown={onRolesKey}>
              {options.map((o, i) => {
                const on = isOn(o);
                return (
                  <button
                    key={o.key}
                    ref={(el) => (optRefs.current[i] = el)}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    tabIndex={on ? 0 : -1}
                    className={"sd-role" + (on ? " is-on" : "")}
                    onClick={() => pick(o)}
                  >
                    <span className="sd-role-dot" aria-hidden="true" />
                    <span className="sd-role-text">
                      <span className="sd-role-name">{o.name}</span>
                      <span className="sd-role-line">{o.line}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {castMode === "custom" && (
              <div className="sd-custom">
                <textarea
                  className="sd-custom-text"
                  aria-label={L("Your role", "你的身份")}
                  value={customText}
                  onChange={(e) => {
                    setCustomText(e.target.value);
                    setRegistration(null);
                  }}
                  placeholder={L("Who you'll play: background, goals, abilities, limits, what you know at the start…", "写下你要扮演的人:背景、目标、能力、限制、开局知道什么……")}
                />
                <div className="sd-custom-row">
                  <label className="sd-upload">
                    {L("Upload .txt / .md / .docx", "上传 .txt / .md / .docx")}
                    <input type="file" accept=".txt,.md,.docx" onChange={pickFile} hidden />
                  </label>
                </div>
                {registration && <RegistrationCard reg={registration} onEdit={() => setRegistration(null)} />}
              </div>
            )}
            {err && (
              <p className="sd-err" role="alert">
                {err}
              </p>
            )}
          </section>
        </main>
      </div>

      {/* 底部固定:扮演谁 + 进入故事 */}
      <div className="sd-enterbar">
        <div className="sd-enterbar-inner">
          <span className="sd-enter-as">
            <span className="sd-enter-label">{L("Playing as", "扮演")}</span>
            <span className="sd-enter-role">{roleLabel}</span>
          </span>
          {castMode === "custom" ? (
            <button type="button" className="cx-btn cx-btn--primary sd-enter-go" disabled={identifying || !customText.trim()} onClick={startCustom}>
              {identifying
                ? rules
                  ? L("Checking against the story…", "按故事规则核对中…")
                  : L("Reading your role…", "识别中…")
                : rules && !registration
                ? L("Register character", "登记角色")
                : L("Enter the story", "进入故事")}
            </button>
          ) : (
            <button type="button" className="cx-btn cx-btn--primary sd-enter-go" onClick={() => enterStory(enterRole)}>
              {PLAY}
              {L("Enter the story", "进入故事")}
            </button>
          )}
        </div>
      </div>

      <CharDetailModal model={charDetail} onClose={() => setCharDetail(null)} />
    </>
  );
}
