import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate } from "../lib/transitionNav";
import { SearchField, Button, Badge, Tag } from "../components/ui";
import ShowcaseGrid from "../components/explore/ShowcaseGrid";
import { getJSON } from "../lib/api";
import { toCardModel, toCardModels } from "../lib/cardModel";
import "./Explore.css";

const FAV_KEY = "ais_favorites_v1";

const TRACKS = [
  { key: "all", label: "全部" },
  { key: "story", label: "完整故事" },
  { key: "character", label: "角色卡" },
];

const LIVE_SORTS = [
  { key: "composite", label: "综合" },
  { key: "latest", label: "最新" },
];

const PAGE_SIZE = 12;
const SKELETON_COUNT = 8;

function ShowcaseTabs({ items, value, onChange, reducedMotion }) {
  return (
    <div className="showcase4-tabs" role="group" aria-label="内容类型">
      {items.map((item) => {
        const active = value === item.key;
        return (
          <button
            key={item.key}
            type="button"
            className={active ? "is-active" : ""}
            aria-pressed={active}
            onClick={() => onChange(item.key)}
          >
            {active ? (
              <motion.span
                className="showcase4-tabs-active"
                layoutId="explore-showcase4-tab"
                transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 32 }}
              />
            ) : null}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function AnimatedNumber({ value, reducedMotion }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.b
        key={value}
        initial={reducedMotion ? false : { opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -5 }}
        transition={{ duration: reducedMotion ? 0 : 0.18 }}
      >
        {value}
      </motion.b>
    </AnimatePresence>
  );
}

function ShowcaseSkeleton() {
  return (
    <div className="showcase4-skeleton" aria-hidden="true">
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <div className="showcase4-skeleton-card" key={index}>
          <span />
          <b />
          <i />
        </div>
      ))}
    </div>
  );
}

export default function Explore() {
  const navigate = useNavigate();
  const [presets, setPresets] = useState([]);
  const [chars, setChars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [track, setTrack] = useState("all");
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("全部");
  const [sort, setSort] = useState("composite");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const deferredQ = useDeferredValue(q);
  const reducedMotion = Boolean(useReducedMotion());
  const resultsRef = useRef(null);
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
      getJSON("/api/presets"),
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
    return ["全部", ...top];
  }, [trackModels]);

  const filtered = useMemo(() => {
    const search = deferredQ.trim().toLowerCase();
    let models = trackModels.filter((model) => {
      const inGenre = genre === "全部" || (model.tags || []).includes(genre);
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

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const searchPending = q !== deferredQ;

  useEffect(() => {
    setPage(1);
  }, [track, q, genre, sort]);

  function changePage(nextPage) {
    setPage(nextPage);
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    });
  }

  function goStory(model) {
    navigate(`/story/${encodeURIComponent(model.id)}`, { state: { preset: model.raw } });
  }

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
  const filtering = track !== "all" || q.trim() !== "" || genre !== "全部";

  return (
    <>
      <div className="page explore">
        <h1 className="explore-status-sr">探索</h1>
        <section className="explore-showcase-tools" aria-label="探索筛选">
          <span className="showcase4-filter-label">筛选</span>
          <ShowcaseTabs
            items={TRACKS}
            value={track}
            reducedMotion={reducedMotion}
            onChange={(nextTrack) => {
              setTrack(nextTrack);
              setGenre("全部");
            }}
          />
          <SearchField
            className="explore-showcase-search"
            aria-label="搜索故事或角色"
            placeholder="搜索名字、简介、作者或标签"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onClear={() => setQ("")}
          />
          <label className="showcase-select-wrap">
            <span className="explore-status-sr">题材</span>
            <select value={genre} onChange={(event) => setGenre(event.target.value)} aria-label="题材筛选">
              {genreOptions.map((item) => (
                <option value={item} key={item}>{item === "全部" ? "所有题材" : item}</option>
              ))}
            </select>
          </label>
          <label className="showcase-select-wrap">
            <span className="explore-status-sr">排序</span>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="排序方式">
              {LIVE_SORTS.map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}
            </select>
          </label>
          <div className="explore-showcase-count t-ui-sm" aria-live="polite" aria-atomic="true">
            {loading ? (
              "正在整理"
            ) : filtering ? (
              <>匹配 <AnimatedNumber value={filtered.length} reducedMotion={reducedMotion} /> / {totalCount}</>
            ) : (
              <>共 <AnimatedNumber value={totalCount} reducedMotion={reducedMotion} /> 个</>
            )}
          </div>
        </section>

        <section ref={resultsRef} className="explore-showcase-results" aria-busy={loading || searchPending}>
          <span className="explore-status-sr" role="status" aria-live="polite">
            {loading ? "正在加载探索内容" : searchPending ? "正在筛选" : `显示 ${shown.length} 条内容`}
          </span>

          {loading ? (
            <ShowcaseSkeleton />
          ) : loadErr && !totalCount ? (
            <div className="explore-empty">
              <h2 className="t-h2">内容加载失败</h2>
              <p className="t-ui">没能从服务器取到故事和角色。</p>
              <Button variant="primary" onClick={refresh}>重试</Button>
            </div>
          ) : !filtered.length ? (
            <div className="explore-empty">
              <h2 className="t-h2">{totalCount ? "没有匹配的内容" : "这里还没有故事"}</h2>
              <p className="t-ui">{totalCount ? "换个关键词或题材试试。" : "先从创作一张角色卡开始。"}</p>
            </div>
          ) : (
            <>
              <ShowcaseGrid
                models={shown}
                isFavorite={isFavorite}
                onOpen={openModel}
                onToggleFavorite={toggleFavorite}
                reducedMotion={reducedMotion}
              />

              {pageCount > 1 ? (
                <div className="showcase4-pager">
                  <button
                    type="button"
                    className="showcase4-page-button"
                    disabled={currentPage <= 1}
                    aria-label="上一页"
                    title="上一页"
                    onClick={() => changePage(Math.max(1, currentPage - 1))}
                  >
                    <span aria-hidden="true">←</span>
                  </button>
                  <span className="showcase4-page-indicator t-ui-sm" aria-label={`第 ${currentPage} 页,共 ${pageCount} 页`}>
                    {currentPage} / {pageCount}
                  </span>
                  <button
                    type="button"
                    className="showcase4-page-button"
                    disabled={currentPage >= pageCount}
                    aria-label="下一页"
                    title="下一页"
                    onClick={() => changePage(Math.min(pageCount, currentPage + 1))}
                  >
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
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
              <button ref={dialogCloseRef} className="explore-modal-x" onClick={() => setDetail(null)} aria-label="关闭" title="关闭">
                ×
              </button>
              <div className={`explore-modal-layout${detail.cover ? " has-cover" : ""}`}>
                {detail.cover ? <img className="explore-modal-cover" src={detail.cover} alt="" decoding="async" /> : null}
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
                  和 TA 纯聊
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
