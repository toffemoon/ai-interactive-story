import { useEffect, useMemo, useState } from "react";
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

const PAGE_SIZE = 15;

export default function Explore() {
  const navigate = useNavigate();
  const [presets, setPresets] = useState([]);
  const [chars, setChars] = useState([]);
  const [loadErr, setLoadErr] = useState(false);
  const [track, setTrack] = useState("all");
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("全部");
  const [sort, setSort] = useState("composite");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null); // CardModel | null
  // 收藏(本机;个人中心「收藏」读同一份)。存原始项,按归一化 id 去重。
  const [favs, setFavs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(FAV_KEY)) || { stories: [], characters: [] };
    } catch (e) {
      return { stories: [], characters: [] };
    }
  });

  function refresh() {
    setLoadErr(false);
    getJSON("/api/presets")
      .then((rows) => setPresets(Array.isArray(rows) ? rows : []))
      .catch(() => setLoadErr(true));
    // 角色卡轨道:库读取失败不致命(故事轨仍可用),静默退回空。
    getJSON("/api/library/characters")
      .then((rows) => setChars(Array.isArray(rows) ? rows : []))
      .catch(() => setChars([]));
  }
  useEffect(() => {
    refresh();
  }, []);

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
    const s = q.trim().toLowerCase();
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
  }, [trackModels, q, genre, sort]);

  // 分页(卡数限制 YOR-39:一页固定张数,翻页;不再一页平铺全部)。
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  const shown = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);
  useEffect(() => {
    setPage(1);
  }, [track, q, genre, sort]);

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
          <div className="explore-count t-ui-sm">
            {filtering ? (
              <>
                匹配 <b>{filtered.length}</b> / 共 {totalCount} 个
              </>
            ) : (
              <>
                共 <b>{totalCount}</b> 个故事 / 角色
              </>
            )}
          </div>
        </div>

        {/* 双轨切换 */}
        <div className="explore-tracks">
          {TRACKS.map((t) => (
            <Chip key={t.key} active={track === t.key} onClick={() => setTrack(t.key)}>
              {t.label}
            </Chip>
          ))}
        </div>

        <div className="explore-bar">
          <SearchField
            placeholder="搜:名字 / 简介 / 作者 / 标签"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="explore-sorts">
            {SORTS.map((s) => (
              <Chip
                key={s.key}
                active={sort === s.key}
                disabled={!s.live}
                title={s.live ? undefined : "待后端数据(YOR-95)"}
                className={s.live ? "" : "is-disabled"}
                onClick={s.live ? () => setSort(s.key) : undefined}
              >
                {s.label}
              </Chip>
            ))}
          </div>
        </div>

        {/* 标签筛选(真实存在的标签) */}
        {genreChips.length > 1 && (
          <div className="explore-genres">
            {genreChips.map((c) => (
              <Chip key={c} active={genre === c} onClick={() => setGenre(c)}>
                {c}
              </Chip>
            ))}
          </div>
        )}

        <div className="explore-rule" aria-hidden="true" />

        {loadErr && !presets.length ? (
          <div className="explore-empty">
            <h3 className="t-h2">书架加载失败</h3>
            <p className="t-ui explore-sub">没能从服务器取到列表,可能是网络抖动或服务暂不可用。</p>
            <Button variant="primary" onClick={refresh}>
              点击重试
            </Button>
          </div>
        ) : !filtered.length ? (
          <div className="explore-empty">
            <h3 className="t-h2">{totalCount ? "没有匹配的内容" : "书架还空着"}</h3>
            <p className="t-ui explore-sub">{totalCount ? "换个关键词、标签或类型试试。" : "去创作从一张角色卡开始。"}</p>
          </div>
        ) : (
          <>
            <CardShelf
              models={shown.map((m) => (isFav(m) ? { ...m, fav: true } : m))} /* 已收藏点亮书签(YOR-171) */
              actionsFor={actionsFor}
              onOpen={(m) => (m.kind === "story" ? goDetail(m) : setDetail(m))}
            />
            {pageCount > 1 && (
              <div className="explore-pager">
                <Button variant="line" disabled={curPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  上一页
                </Button>
                <span className="explore-pager-info t-ui-sm">
                  {curPage} / {pageCount}
                </span>
                <Button variant="line" disabled={curPage >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                  下一页
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {detail && (
        <div className="explore-modal" onClick={() => setDetail(null)}>
          <div className="explore-modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="explore-modal-x" onClick={() => setDetail(null)} aria-label="关闭">
              ×
            </button>
            <Badge tone={detail.badge.tone}>{detail.badge.label}</Badge>
            <h2 className="t-h1 explore-modal-title">{detail.title}</h2>
            <p className="t-read explore-modal-blurb">{detail.blurb}</p>
            {(detail.tags || []).length > 0 && (
              <div className="explore-modal-tags">
                {(detail.tags || []).map((t, i) => (
                  <Tag key={i}>{t}</Tag>
                ))}
              </div>
            )}
            <div className="explore-modal-actions">
              <Button
                variant="primary"
                full
                onClick={() => {
                  setDetail(null);
                  chatWith(detail); // 不传角色的话预载永远没写,用户会落到空联系人列表(YOR-167)
                }}
              >
                和 TA 纯聊
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
