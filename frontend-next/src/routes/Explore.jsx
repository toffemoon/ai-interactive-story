import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate } from "../lib/transitionNav";
import { Chip, SearchField, Button, Badge, Tag, CardShelf } from "../components/ui";
import { getJSON } from "../lib/api";
import { toCardModel, toCardModels } from "../lib/cardModel";
import "./Explore.css";

const FAV_KEY = "ais_favorites_v1";

// 探索 = 玩家入场货架(默认首屏)。本批决策:拿掉「卡市集」,只留双轨 ——
//   完整故事(/api/presets · 可直接玩) + 角色卡(/api/library/characters · 选/扮演角色)。
//   设定卡 / 世界书 / 故事书 / 演出卡 不再摆给玩家,移到创作端素材库。
const TRACKS = [
  { key: "all", label: "全部" },
  { key: "story", label: "完整故事" },
  { key: "character", label: "角色卡" },
];

// 排序:最新/综合 前端可真排;热度/点击需后端字段(热度·点击·更新时间)→ YOR-95,先优雅降级(禁用 + 标注)。
const SORTS = [
  { key: "composite", label: "综合", live: true },
  { key: "latest", label: "最新", live: true },
  { key: "heat", label: "热度", live: false },
  { key: "clicks", label: "点击", live: false },
];
const LIVE_SORTS = SORTS.filter((item) => item.live);

const PAGE_SIZE = 15;
const SKELETON_COUNT = 12;

function SegmentedControl({ id, items, value, onChange, label, reducedMotion }) {
  return (
    <div className="explore-segmented" role="group" aria-label={label}>
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
                className="explore-segmented-active"
                layoutId={`explore-segmented-${id}`}
                transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 38, mass: 0.62 }}
              />
            ) : null}
            <span className="explore-segmented-label">{item.label}</span>
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

function ExploreSkeleton() {
  return (
    <div className="card-shelf explore-skeleton" aria-hidden="true">
      {Array.from({ length: SKELETON_COUNT }, (_, index) => (
        <div className="explore-skeleton-card" key={index}>
          <span className="explore-skeleton-cover" />
          <span className="explore-skeleton-line" />
          <span className="explore-skeleton-line is-short" />
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
  const [detail, setDetail] = useState(null); // CardModel | null
  const deferredQ = useDeferredValue(q);
  const reducedMotion = Boolean(useReducedMotion());
  const resultsRef = useRef(null);
  const dialogRef = useRef(null);
  const dialogCloseRef = useRef(null);
  // 收藏(本机;个人中心「收藏」读同一份)。存原始项,按归一化 id 去重。
  const [favs, setFavs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(FAV_KEY)) || { stories: [], characters: [] };
    } catch (e) {
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

    if (presetResult.status === "fulfilled") {
      setPresets(Array.isArray(presetResult.value) ? presetResult.value : []);
    } else {
      setPresets([]);
      setLoadErr(true);
    }
    // 角色卡轨道:库读取失败不致命(故事轨仍可用),静默退回空。
    setChars(charResult.status === "fulfilled" && Array.isArray(charResult.value) ? charResult.value : []);
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

  // 两轨归一化为统一 CardModel(角标/竖卡/翻面全由统一 Card 负责)。
  const storyModels = useMemo(() => toCardModels("story", presets), [presets]);
  const charModels = useMemo(() => toCardModels("character", chars), [chars]);

  // 轨道合并:全部 = 完整故事在前、角色卡在后。
  const trackModels = useMemo(() => {
    if (track === "story") return storyModels;
    if (track === "character") return charModels;
    return [...storyModels, ...charModels];
  }, [track, storyModels, charModels]);

  // 标签 chip:从当前轨道真实存在的标签按频次取前 N(标签细化 YOR-34:
  // 高频标签才上筛选条,避免角色卡一堆一次性描述词(银发/温和…)把筛选淹没)。
  const GENRE_LIMIT = 12;
  const genreChips = useMemo(() => {
    const freq = new Map();
    trackModels.forEach((m) => (m.tags || []).forEach((t) => {
      if (t) freq.set(t, (freq.get(t) || 0) + 1);
    }));
    const top = [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, GENRE_LIMIT)
      .map(([t]) => t);
    return ["全部", ...top];
  }, [trackModels]);

  const filtered = useMemo(() => {
    const s = deferredQ.trim().toLowerCase();
    let xs = trackModels.filter((m) => {
      const inGenre = genre === "全部" || (m.tags || []).includes(genre);
      const inQ =
        !s ||
        [m.title, m.blurb, m.meta.author, (m.tags || []).join(" ")]
          .filter(Boolean)
          .some((f) => f.toLowerCase().includes(s));
      return inGenre && inQ;
    });
    // 综合 = 官方优先(预设/库项的 official 标记);最新 = 取回顺序(库列表已按更新倒序)。
    // 热度/点击暂无后端字段:不假排,退回取回顺序(占位,等 YOR-95)。
    if (sort === "composite") {
      xs = [...xs].sort((a, b) => {
        const ao = a.raw && a.raw.official, bo = b.raw && b.raw.official;
        return ao === bo ? 0 : bo ? 1 : -1;
      });
    }
    return xs;
  }, [trackModels, deferredQ, genre, sort]);

  // 分页(卡数限制 YOR-39:一页固定张数,翻页;不再一页平铺全部)。
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const shown = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  const resultMotionKey = `${track}:${genre}:${sort}:${curPage}`;
  const searchPending = q !== deferredQ;
  useEffect(() => {
    setPage(1);
  }, [track, q, genre, sort]);

  function changePage(nextPage) {
    setPage(nextPage);
    requestAnimationFrame(() => {
      resultsRef.current?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
    });
  }

  // —— 卡片去向 ——
  // 完整故事 → 介绍页(选主角三选一 + 涟漪入局);直接开玩的捷径收敛进详情页。
  function goDetail(m) {
    navigate(`/story/${encodeURIComponent(m.id)}`, { state: { preset: m.raw } });
  }
  // 角色卡「纯聊」:进微信式轻聊。预载该角色 → sessionStorage,纯聊页读后自动加联系人并选中。
  function chatWith(m) {
    try {
      if (m && m.raw) sessionStorage.setItem("ais_chat_preload", JSON.stringify(m.raw));
    } catch (e) {}
    navigate("/chat");
  }

  // 收藏:按归一化 id 判定 + 增删,写回 localStorage(细节⑭)。
  const favIds = useMemo(
    () => ({
      story: new Set(toCardModels("story", favs.stories || []).map((x) => x.id)),
      character: new Set(toCardModels("character", favs.characters || []).map((x) => x.id)),
    }),
    [favs]
  );
  const isFav = (m) => favIds[m.kind] && favIds[m.kind].has(m.id);
  function toggleFav(m) {
    setFavs((prev) => {
      const bucket = m.kind === "story" ? "stories" : "characters";
      const arr = prev[bucket] || [];
      const has = favIds[m.kind] && favIds[m.kind].has(m.id);
      const next = has ? arr.filter((raw) => toCardModel(m.kind, raw).id !== m.id) : [...arr, m.raw];
      const updated = { ...prev, [bucket]: next };
      try {
        localStorage.setItem(FAV_KEY, JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  }

  function actionsFor(m) {
    const fav = { label: isFav(m) ? "已收藏" : "收藏", variant: isFav(m) ? "secondary" : "line", onClick: () => toggleFav(m) };
    if (m.kind === "character") {
      // 角色卡反面:纯聊为主功能(标红),不再有「开故事」(细节⑤)。
      return [
        { label: "纯聊", variant: "primary", onClick: () => chatWith(m) },
        fav,
      ];
    }
    return [{ label: "查看故事", variant: "primary", isDetail: true, onClick: () => goDetail(m) }, fav];
  }

  const totalCount = storyModels.length + charModels.length;
  // 计数跟着筛选走:有任一筛选/搜索时显示「匹配 N / 共 M 个」,否则保持全量口径。
  const filtering = track !== "all" || q.trim() !== "" || genre !== "全部";

  return (
    <>
      <div className="page explore">
        {/* 继续游玩改由全局悬浮 ResumeBar 负责(只在探索悬浮,细节①),此处不再内联 rail */}
        <div className="explore-head">
          <div>
            <h1 className="t-display">探索</h1>
            <p className="t-ui explore-sub">取下一本书,或挑一张角色卡,走进会回应你的故事世界。</p>
          </div>
          <div className="explore-count t-ui-sm" aria-live="polite" aria-atomic="true">
            {loading ? (
              <span>正在整理书架</span>
            ) : filtering ? (
              <>
                匹配 <AnimatedNumber value={filtered.length} reducedMotion={reducedMotion} /> / 共 {totalCount} 个
              </>
            ) : (
              <>
                共 <AnimatedNumber value={totalCount} reducedMotion={reducedMotion} /> 个故事 / 角色
              </>
            )}
          </div>
        </div>

        <section className="explore-controls" aria-label="探索筛选">
          <div className="explore-primary-controls">
            <SegmentedControl
              id="track"
              items={TRACKS}
              value={track}
              label="内容类型"
              reducedMotion={reducedMotion}
              onChange={(nextTrack) => {
                setTrack(nextTrack);
                setGenre("全部");
              }}
            />
            <SearchField
              className="explore-search"
              aria-label="搜索故事或角色"
              placeholder="搜索名字、简介、作者或标签"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onClear={() => setQ("")}
            />
            <SegmentedControl
              id="sort"
              items={LIVE_SORTS}
              value={sort}
              label="排序方式"
              reducedMotion={reducedMotion}
              onChange={setSort}
            />
          </div>

          {genreChips.length > 1 ? (
            <div className="explore-genres" role="group" aria-label="题材筛选">
              {genreChips.map((item) => (
                <Chip key={item} active={genre === item} onClick={() => setGenre(item)}>
                  {item === "全部" ? "所有题材" : item}
                </Chip>
              ))}
            </div>
          ) : null}
        </section>

        <div ref={resultsRef} className="explore-results" aria-busy={loading || searchPending}>
          <span className="explore-status-sr" role="status" aria-live="polite">
            {loading ? "正在加载探索内容" : searchPending ? "正在筛选" : `显示 ${shown.length} 条内容`}
          </span>
          {loading ? (
            <ExploreSkeleton />
          ) : loadErr && !totalCount ? (
            <div className="explore-empty">
              <h3 className="t-h2">书架加载失败</h3>
              <p className="t-ui explore-sub">没能从服务器取到列表,可能是网络抖动或服务暂不可用。</p>
              <Button variant="primary" onClick={refresh}>点击重试</Button>
            </div>
          ) : !filtered.length ? (
            <div className="explore-empty">
              <h3 className="t-h2">{totalCount ? "没有匹配的内容" : "书架还空着"}</h3>
              <p className="t-ui explore-sub">{totalCount ? "换个关键词、标签或类型试试。" : "去创作从一张角色卡开始。"}</p>
            </div>
          ) : (
            <>
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={resultMotionKey}
                  className="explore-grid-motion"
                  initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
                  transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <CardShelf
                    models={shown.map((model) => (isFav(model) ? { ...model, fav: true } : model))}
                    actionsFor={actionsFor}
                    onOpen={(model) => (model.kind === "story" ? goDetail(model) : setDetail(model))}
                    eagerCount={2}
                  />
                </motion.div>
              </AnimatePresence>
              {pageCount > 1 ? (
                <div className="explore-pager">
                  <Button variant="line" disabled={curPage <= 1} onClick={() => changePage(Math.max(1, curPage - 1))}>
                    上一页
                  </Button>
                  <span className="explore-pager-info t-ui-sm" aria-label={`第 ${curPage} 页,共 ${pageCount} 页`}>
                    {curPage} / {pageCount}
                  </span>
                  <Button variant="line" disabled={curPage >= pageCount} onClick={() => changePage(Math.min(pageCount, curPage + 1))}>
                    下一页
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
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
