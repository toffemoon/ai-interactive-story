import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chip, SearchField, Button, Badge, Tag, CardShelf } from "../components/ui";
import { getJSON } from "../lib/api";
import { toCardModels } from "../lib/cardModel";
import { useGame } from "../state/game";
import "./Explore.css";

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

const PAGE_SIZE = 12;

export default function Explore() {
  const navigate = useNavigate();
  const { game, startGame } = useGame();
  const [presets, setPresets] = useState([]);
  const [chars, setChars] = useState([]);
  const [loadErr, setLoadErr] = useState(false);
  const [track, setTrack] = useState("all");
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("全部");
  const [sort, setSort] = useState("composite");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null); // CardModel | null

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
  // 角色卡「开故事」:以该角色起一局自由叙事(无打包故事/世界)。契约不变,仍走 story_turn_stream。
  function startCharacterStory(m) {
    const it = m.raw || {};
    const card = it.data || {}; // 库项里的 CharacterCard
    startGame({
      title: m.title,
      characters: [card],
      world: null,
      story: null,
      player: null,
      mode: "standard",
    });
    navigate("/play");
  }
  // 角色卡「纯聊」:进微信式轻聊(模块⑥)。当前先导航到 /chat;预载该角色留待 ⑥ 接。
  function chatWith() {
    navigate("/chat");
  }

  function actionsFor(m) {
    if (m.kind === "character") {
      return [
        { label: "开故事", variant: "primary", onClick: () => startCharacterStory(m) },
        { label: "纯聊", variant: "line", onClick: () => chatWith(m) },
      ];
    }
    return [{ label: "查看故事", variant: "primary", isDetail: true, onClick: () => goDetail(m) }];
  }

  const totalCount = storyModels.length + charModels.length;

  return (
    <>
      <div className="page explore">
        {/* 继续游玩 rail:有进行中故事才显,不占位(完整存档列表见个人中心) */}
        {game && (
          <div className="explore-resume">
            <div className="explore-resume-head t-meta">继续游玩</div>
            <button className="explore-resume-card" onClick={() => navigate("/play")}>
              <span className="explore-resume-dot" aria-hidden="true" />
              <span className="explore-resume-title t-kai">{game.title || "当前故事"}</span>
              <span className="explore-resume-go t-ui-sm">回到故事 →</span>
            </button>
          </div>
        )}

        <div className="explore-head">
          <div>
            <p className="u-eyebrow">Story Library</p>
            <h1 className="t-display">探索</h1>
            <p className="t-ui explore-sub">取下一本书,或挑一张角色卡,走进会回应你的故事世界。</p>
          </div>
          <div className="explore-count t-ui-sm">
            共 <b>{totalCount}</b> 个故事 / 角色
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
            <p className="t-ui explore-sub">{totalCount ? "换个关键词、标签或轨道试试。" : "去创作从一张角色卡开始。"}</p>
          </div>
        ) : (
          <>
            <CardShelf
              models={shown}
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
                onClick={() => {
                  const m = detail;
                  setDetail(null);
                  startCharacterStory(m);
                }}
              >
                以这个角色开故事
              </Button>
              <Button
                variant="line"
                onClick={() => {
                  setDetail(null);
                  chatWith();
                }}
              >
                纯聊
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
