import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Chip, SearchField, Button, Badge, CardShelf } from "../components/ui";
import { getJSON } from "../lib/api";
import { toCardModels } from "../lib/cardModel";
import { useGame } from "../state/game";
import "./Explore.css";

const GENRES = ["原创", "教学", "崩铁", "仙侠", "权谋"];

export default function Explore() {
  const navigate = useNavigate();
  const { startGame } = useGame();
  const [presets, setPresets] = useState([]);
  const [loadErr, setLoadErr] = useState(false);
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("全部");
  const [detail, setDetail] = useState(null); // CardModel | null

  function refresh() {
    setLoadErr(false);
    getJSON("/api/presets")
      .then((rows) => setPresets(Array.isArray(rows) ? rows : []))
      .catch(() => setLoadErr(true));
  }
  useEffect(() => {
    refresh();
  }, []);

  const models = useMemo(() => toCardModels("story", presets), [presets]);

  const chips = useMemo(() => {
    const present = new Set();
    models.forEach((m) => (m.tags || []).forEach((t) => present.add(t)));
    return ["全部", ...GENRES.filter((g) => present.has(g))];
  }, [models]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return models.filter((m) => {
      const inGenre = genre === "全部" || (m.tags || []).includes(genre);
      const inQ =
        !s ||
        [m.title, m.blurb, m.meta.author, (m.tags || []).join(" ")]
          .filter(Boolean)
          .some((f) => f.toLowerCase().includes(s));
      return inGenre && inQ;
    });
  }, [models, q, genre]);

  function startPlay(m) {
    const p = m.raw || {};
    const d = p.data || {};
    startGame({
      title: d.name || p.name || m.title,
      characters: d.characters || [],
      world: d.world || null,
      story: d.story || null,
      player: d.player || null,
      mode: "standard",
    });
    navigate("/play");
  }

  return (
    <>
      <div className="page explore">
        <div className="explore-head">
          <div>
            <p className="u-eyebrow">Story Library</p>
            <h1 className="t-display">故事库</h1>
            <p className="t-ui explore-sub">取下一本书,走进会回应你的故事世界。</p>
          </div>
          <div className="explore-count t-ui-sm">
            共 <b>{presets.length}</b> 个故事
          </div>
        </div>

        <div className="explore-bar">
          <SearchField placeholder="搜故事:名字 / 简介 / 作者 / 标签" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="explore-chips">
            {chips.map((c) => (
              <Chip key={c} active={genre === c} onClick={() => setGenre(c)}>
                {c}
              </Chip>
            ))}
          </div>
        </div>

        {loadErr ? (
          <div className="explore-empty">
            <h3 className="t-h2">书架加载失败</h3>
            <p className="t-ui explore-sub">没能从服务器取到故事列表,可能是网络抖动或服务暂不可用。</p>
            <Button variant="primary" onClick={refresh}>
              点击重试
            </Button>
          </div>
        ) : !shown.length ? (
          <div className="explore-empty">
            <h3 className="t-h2">{presets.length ? "没有匹配的故事" : "书架还空着"}</h3>
            <p className="t-ui explore-sub">{presets.length ? "换个关键词或分类试试。" : "去创作从一张角色卡开始。"}</p>
          </div>
        ) : (
          <CardShelf
            models={shown}
            actionsFor={(m) => [{ label: "去玩", variant: "primary", onClick: () => startPlay(m) }]}
            onOpen={(m) => setDetail(m)}
          />
        )}
      </div>

      {detail && (
        <div className="explore-modal" onClick={() => setDetail(null)}>
          <div className="explore-modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="explore-modal-x" onClick={() => setDetail(null)} aria-label="关闭">
              ×
            </button>
            <Badge tone="pine">{detail.badge.label}</Badge>
            <h2 className="t-h1 explore-modal-title">{detail.title}</h2>
            <p className="t-read explore-modal-blurb">{detail.blurb}</p>
            <div className="explore-modal-meta t-ui-sm">
              {detail.meta.characters ? `${detail.meta.characters} 角色` : "群像"} · {detail.meta.author || "店内收录"}
            </div>
            <div className="explore-modal-tags">
              {(detail.tags || []).map((t, i) => (
                <span key={i} className="tag">
                  {t}
                </span>
              ))}
            </div>
            <Button
              variant="primary"
              full
              onClick={() => {
                setDetail(null);
                startPlay(detail);
              }}
            >
              取下这本书 · 开始游玩
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
