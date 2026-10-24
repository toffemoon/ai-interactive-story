import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate } from "../lib/transitionNav";
import { Button, Badge, Tag } from "../components/ui";
import TopNav from "../components/shell/TopNav";
import { StoryCard, CharCard } from "../components/CCard";
import { getJSON } from "../lib/api";
import { toCardModel, toCardModels } from "../lib/cardModel";
import { L, isZh } from "../lib/i18n";
import "./Explore.css";

const FAV_KEY = "ais_favorites_v1";

const TRACKS = [
  { key: "all", label: L("All", "全部") },
  { key: "story", label: L("Stories", "完整故事") },
  { key: "character", label: L("Characters", "角色卡") },
];

const LIVE_SORTS = [
  { key: "composite", label: L("Featured", "综合") },
  { key: "latest", label: L("Latest", "最新") },
];

// 推荐位挑一本:当前语言的官方故事里排第一的(中文站挑中文书名,英文站挑英文书名);没有就取第一本。
const hasCjk = (s) => /[\u3400-\u9fff]/.test(s || "");
function pickFeatured(stories) {
  const official = stories.filter((m) => m.raw && m.raw.official);
  const pool = official.length ? official : stories;
  return pool.find((m) => hasCjk(m.title) === isZh) || pool[0] || null;
}

function RowSkeleton({ kind }) {
  return (
    <div className="cx-row-scroll" aria-hidden="true">
      <div className="cx-row-track">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={(kind === "story" ? "cx-story" : "cx-char") + " cx-skel"} />
        ))}
      </div>
    </div>
  );
}

export default function Explore() {
  const navigate = useNavigate();
  const [presets, setPresets] = useState([]);
  const [chars, setChars] = useState([]);
  const [badCover, setBadCover] = useState(""); // 弹层封面地址失效就不占位
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [track, setTrack] = useState("all");
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("全部"); // i18n: kept, logic literal ("all genres" sentinel, never displayed)
  const [sort, setSort] = useState("composite");
  const [detail, setDetail] = useState(null);
  const deferredQ = useDeferredValue(q);
  const reducedMotion = Boolean(useReducedMotion());
  const dialogRef = useRef(null);
  const dialogCloseRef = useRef(null);

  const [favs, setFavs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(FAV_KEY)) || { stories: [], characters: [] };
    } catch (error) {
      return { stories: [], characters: [] };
    }
  });

  async function refresh() {
    setLoadErr(false);
    setLoading(true);
    const [presetResult, charResult] = await Promise.allSettled([
      getJSON("/api/presets?summary=1"), // 只要卡面字段;完整内容进详情页再取
      getJSON("/api/library/characters"),
    ]);
    const presetOk = presetResult.status === "fulfilled" && Array.isArray(presetResult.value);
    const charOk = charResult.status === "fulfilled" && Array.isArray(charResult.value);

    setPresets(presetOk ? presetResult.value : []);
    setChars(charOk ? charResult.value : []);
    setLoadErr(!presetOk && !charOk);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!detail) return undefined;

    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const focusRaf = requestAnimationFrame(() => dialogCloseRef.current?.focus());
    document.body.style.overflow = "hidden";

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setDetail(null);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusRaf);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus();
    };
  }, [detail]);

  const storyModels = useMemo(() => toCardModels("story", presets), [presets]);
  const charModels = useMemo(() => toCardModels("character", chars), [chars]);
  const trackModels = useMemo(() => {
    if (track === "story") return storyModels;
    if (track === "character") return charModels;
    return [...storyModels, ...charModels];
  }, [track, storyModels, charModels]);

  const genreOptions = useMemo(() => {
    const frequency = new Map();
    trackModels.forEach((model) => (model.tags || []).forEach((tag) => {
      if (tag) frequency.set(tag, (frequency.get(tag) || 0) + 1);
    }));
    const top = [...frequency.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([tag]) => tag);
    return ["全部", ...top]; // i18n: kept, logic literal
  }, [trackModels]);

  const filtered = useMemo(() => {
    const search = deferredQ.trim().toLowerCase();
    let models = trackModels.filter((model) => {
      const inGenre = genre === "全部" || (model.tags || []).includes(genre); // i18n: kept, logic literal
      const inSearch =
        !search ||
        [model.title, model.blurb, model.meta?.author, (model.tags || []).join(" ")]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(search));
      return inGenre && inSearch;
    });

    if (sort === "composite") {
      models = [...models].sort((a, b) => {
        const aOfficial = Boolean(a.raw?.official);
        const bOfficial = Boolean(b.raw?.official);
        return aOfficial === bOfficial ? 0 : bOfficial ? 1 : -1;
      });
    }
    return models;
  }, [trackModels, deferredQ, genre, sort]);

  const searchPending = q !== deferredQ;

  function chatWith(model) {
    try {
      if (model?.raw) sessionStorage.setItem("ais_chat_preload", JSON.stringify(model.raw));
    } catch (error) {}
    navigate("/chat");
  }

  function openModel(model) {
    if (model.kind === "story") goStory(model);
    else setDetail(model);
  }

  const favoriteIds = useMemo(
    () => ({
      story: new Set(toCardModels("story", favs.stories || []).map((item) => item.id)),
      character: new Set(toCardModels("character", favs.characters || []).map((item) => item.id)),
    }),
    [favs]
  );

  const isFavorite = (model) => Boolean(favoriteIds[model.kind]?.has(model.id));

  function toggleFavorite(model) {
    setFavs((previous) => {
      const bucket = model.kind === "story" ? "stories" : "characters";
      const current = previous[bucket] || [];
      const exists = favoriteIds[model.kind]?.has(model.id);
      const next = exists
        ? current.filter((raw) => toCardModel(model.kind, raw).id !== model.id)
        : [...current, model.raw];
      const updated = { ...previous, [bucket]: next };
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(updated));
      } catch (error) {}
      return updated;
    });
  }

  const totalCount = storyModels.length + charModels.length;
  const filtering = track !== "all" || q.trim() !== "" || genre !== "全部"; // i18n: kept, logic literal
  const featured = useMemo(() => pickFeatured(storyModels), [storyModels]);
  const featuredData = (featured && featured.raw && featured.raw.data) || {};
  const featuredCast = (featuredData.character_names || []).slice(0, 4).join(isZh ? "、" : ", ");
  const shownStories = filtered.filter((m) => m.kind === "story");
  const shownChars = filtered.filter((m) => m.kind === "character");

  // focus = "role":从「开始游玩」进来,详情页直接滚到「你来扮演谁」
  function goStory(model, focus) {
    navigate(`/story/${encodeURIComponent(model.id)}`, { state: { preset: model.raw, focus } });
  }

  const row = (kind, title, items, more) => (
    <section className="cx-row" aria-labelledby={"cx-row-" + kind}>
      <div className="cx-row-head">
        <h2 id={"cx-row-" + kind}>
          {title}
          {filtering && !loading ? <span className="cx-row-count">{items.length}</span> : null}
        </h2>
        {more ? (
          <button type="button" className="cx-row-more" onClick={more}>
            {kind === "story" ? L("All stories", "全部故事") : L("All characters", "全部角色")}
          </button>
        ) : null}
      </div>
      {loading ? (
        <RowSkeleton kind={kind} />
      ) : (
        <div className={filtering ? "cx-grid" : "cx-row-scroll"}>
          <div className={filtering ? "cx-grid-track cx-grid-track--" + kind : "cx-row-track"}>
            {items.map((m) =>
              kind === "story" ? (
                <StoryCard key={m.id} model={m} fav={isFavorite(m)} onOpen={openModel} onFav={toggleFavorite} />
              ) : (
                <CharCard key={m.id} model={m} fav={isFavorite(m)} onOpen={openModel} onFav={toggleFavorite} />
              )
            )}
          </div>
        </div>
      )}
    </section>
  );

  return (
    <>
      <div className="page cx">
        {/* 页头大图:书店夜景 + 糖沐,导航叠在上面,左侧是推荐的一本故事(画布「C 幕间 · 探索」) */}
        <section className="cx-hero" aria-labelledby="cx-hero-title">
          <img className="cx-hero-bg" src="/home/background.png" alt="" />
          <div className="cx-hero-shade" aria-hidden="true" />
          <img className="cx-hero-art" src="/home/tangmu02.webp" alt="" />
          <div className="cx-hero-fade" aria-hidden="true" />
          <TopNav variant="overlay" />
          <div className="cx-hero-body">
            <div className="cx-feature">
              {featured ? (
                <>
                  {(featured.tags || [])[0] ? <p className="cx-feature-tag">{featured.tags[0]}</p> : null}
                  <h1 id="cx-hero-title" className={"cx-feature-title" + (featured.title.length > 18 ? " is-long" : "")}>
                    {featured.title}
                  </h1>
                  {featuredData.synopsis ? <p className="cx-feature-blurb">{featuredData.synopsis}</p> : null}
                  {featuredCast ? (
                    <p className="cx-feature-cast">
                      <span>{L("Cast", "登场角色")}</span>
                      {featuredCast}
                    </p>
                  ) : null}
                  <div className="cx-feature-actions">
                    <button type="button" className="cx-btn cx-btn--primary" onClick={() => goStory(featured, "role")}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" /></svg>
                      {L("Play", "开始游玩")}
                    </button>
                    <button type="button" className="cx-btn cx-btn--soft" onClick={() => goStory(featured)}>
                      {L("Story details", "故事详情")}
                    </button>
                  </div>
                </>
              ) : (
                <h1 id="cx-hero-title" className="cx-feature-title">{L("Explore", "探索")}</h1>
              )}
            </div>
          </div>
        </section>

        <main className="cx-main">
          <div className="cx-tools">
            <div className="cx-tabs" role="group" aria-label={L("Content type", "内容类型")}>
              {TRACKS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={track === t.key}
                  className={track === t.key ? "is-on" : ""}
                  onClick={() => {
                    setTrack(t.key);
                    setGenre("全部"); // i18n: kept, logic literal
                  }}
                >
                  {t.key === "all" && !loading ? (isZh ? `全部 ${totalCount}` : `All ${totalCount}`) : t.label}
                </button>
              ))}
            </div>
            <span className="cx-tools-gap" />
            <label className="cx-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
              <span className="explore-status-sr">{L("Search", "搜索")}</span>
              <input
                type="search"
                placeholder={L("Search names, tags, authors", "搜索名字、简介、作者或标签")}
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
            </label>
            <label className="cx-select">
              <span className="explore-status-sr">{L("Genre", "题材")}</span>
              <select value={genre} onChange={(event) => setGenre(event.target.value)}>
                {genreOptions.map((item) => (
                  <option value={item} key={item}>{item === "全部" /* i18n: kept, logic literal */ ? L("All genres", "全部题材") : item}</option>
                ))}
              </select>
            </label>
            <label className="cx-select">
              <span className="explore-status-sr">{L("Sort", "排序")}</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                {LIVE_SORTS.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
              </select>
            </label>
          </div>

          <span className="explore-status-sr" role="status" aria-live="polite">
            {loading
              ? L("Loading Explore content", "正在加载探索内容")
              : searchPending
              ? L("Filtering", "正在筛选")
              : L(`Showing ${filtered.length} ${filtered.length === 1 ? "item" : "items"}`, `显示 ${filtered.length} 条内容`)}
          </span>

          {!loading && loadErr && !totalCount ? (
            <div className="cx-empty">
              <h2>{L("Failed to load", "内容加载失败")}</h2>
              <p>{L("Couldn't fetch stories and characters from the server.", "没能从服务器取到故事和角色。")}</p>
              <Button variant="primary" onClick={refresh}>{L("Retry", "重试")}</Button>
            </div>
          ) : !loading && !filtered.length ? (
            <div className="cx-empty">
              <h2>{totalCount ? L("No matches", "没有匹配的内容") : L("No stories here yet", "这里还没有故事")}</h2>
              <p>{totalCount ? L("Try a different keyword or genre.", "换个关键词或题材试试。") : L("Start by creating a Character Card.", "先从创作一张角色卡开始。")}</p>
            </div>
          ) : (
            <>
              {track !== "character" && (loading || shownStories.length > 0)
                ? row("story", L("Stories", "故事"), shownStories, track === "all" && !filtering ? () => setTrack("story") : null)
                : null}
              {track !== "story" && (loading || shownChars.length > 0)
                ? row("character", L("Characters", "角色"), shownChars, track === "all" && !filtering ? () => setTrack("character") : null)
                : null}
            </>
          )}
        </main>
      </div>

      <AnimatePresence>
        {detail ? (
          <motion.div
            className="explore-modal"
            onClick={() => setDetail(null)}
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.2 }}
          >
            <motion.div
              ref={dialogRef}
              className="explore-modal-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="explore-dialog-title"
              onClick={(event) => event.stopPropagation()}
              initial={reducedMotion ? false : { opacity: 0, y: 18, scale: 0.975 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.985 }}
              transition={{ duration: reducedMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
            >
              <button ref={dialogCloseRef} className="explore-modal-x" onClick={() => setDetail(null)} aria-label={L("Close", "关闭")} title={L("Close", "关闭")}>
                ×
              </button>
              <div className={`explore-modal-layout${detail.cover && detail.cover !== badCover ? " has-cover" : ""}`}>
                {detail.cover && detail.cover !== badCover ? (
                  <img className="explore-modal-cover" src={detail.cover} alt="" decoding="async" onError={() => setBadCover(detail.cover)} />
                ) : null}
                <div className="explore-modal-copy">
                  <Badge tone={detail.badge.tone}>{detail.badge.label}</Badge>
                  <h2 id="explore-dialog-title" className="t-h1 explore-modal-title">{detail.title}</h2>
                  <p className="t-read explore-modal-blurb">{detail.blurb}</p>
                  {(detail.tags || []).length > 0 ? (
                    <div className="explore-modal-tags">
                      {(detail.tags || []).map((tag, index) => <Tag key={`${tag}-${index}`}>{tag}</Tag>)}
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="explore-modal-actions">
                <Button
                  variant="primary"
                  full
                  onClick={() => {
                    setDetail(null);
                    chatWith(detail);
                  }}
                >
                  {L("Chat with them", "和 TA 纯聊")}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
