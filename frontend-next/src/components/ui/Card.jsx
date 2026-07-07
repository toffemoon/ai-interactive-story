import { useState, useRef } from "react";
import { Tag } from "./Tag";

// ── 统一 Card ───────────────────────────────────────────────────────────────
// 展示型组件,只认 CardModel(见 lib/cardModel.js)。禁 kind 大开关:
// 差异已在归一化层收敛,这里只按 variant 排版 + 渲染传入的 actions 插槽。
//
// variant = shelf | row | thumb
//   shelf — 书形竖卡(190×286 / 2:3),三态:封面 → tap 翻转看简介+标签 → 背面操作 / 详情。
//           受控 flip(flipped + onToggleFlip 由 CardShelf 管,一次只翻一张、点别处收)→ 根治 YOR-47。
//   row   — 横排列表项(不翻)。
//   thumb — 紧凑缩略(选择器,不翻)。
//
// actions: [{ label, variant, onClick, full?, isDetail? }] —— 由用处传(探索 = 去玩/纯聊,库 = 编辑/删除…)。
// onOpen: 进完整详情;若 actions 里没有 isDetail 项,卡背自动补一个「详情」按钮(spec 硬要求)。

// 书脊占位色永远做底色,封面图叠在上面 —— 封面缺失 / 加载失败都优雅退回书脊,不露白底。
function coverStyle(kind, cover) {
  const s = { backgroundColor: `var(--spine-${kind}, var(--spine-character))` };
  if (cover) s.backgroundImage = `url("${cover}")`;
  return s;
}

function CoverFront({ model }) {
  const { kind, cover, title, badge, meta = {} } = model;
  const noCoverFrame = !cover && (kind === "world" || kind === "player");
  const style = coverStyle(kind, cover);
  // 角标缩短(「完整故事 · 可直接玩」→「完整故事」),小卡上不挤;「官方」单独一枚。
  const shortBadge = badge ? (badge.label || "").split(" · ")[0] : "";
  const author = meta.uploader || ""; // 作者/上传者(故事=author,角色多为空 → 留位)
  // 正面 = 封面区(立绘/书脊底色,角标浮其上)+ 下方白条(书名 + 作者),书名不再压住立绘。
  return (
    <div className="card-front">
      <div className={["card-cover", cover ? "has-cover" : "no-cover"].join(" ")} style={style}>
        {noCoverFrame && <span className="card-spine-frame" aria-hidden="true" />}
        {!cover && <span className="card-cover-ph t-kai" aria-hidden="true">{title.slice(0, 4)}</span>}
        <div className="card-cover-top">
          {shortBadge && <span className="card-badge">{shortBadge}</span>}
          {meta.typeLabel ? <span className="card-type">{meta.typeLabel}</span> : null}
        </div>
      </div>
      <div className="card-bar">
        <span className="card-bar-title t-kai">{title}</span>
        {author ? <span className="card-bar-author t-meta">{author}</span> : null}
      </div>
    </div>
  );
}

function ActionRow({ actions, onOpen }) {
  const list = actions ? actions.slice() : [];
  const hasDetail = list.some((a) => a.isDetail);
  return (
    <div className="card-actions">
      {list.map((a, i) => (
        <button
          key={i}
          className={["btn", "btn--" + (a.variant || "line"), "btn--sm", a.full ? "btn--full" : ""].filter(Boolean).join(" ")}
          onClick={(e) => {
            e.stopPropagation();
            a.onClick && a.onClick();
          }}
        >
          {a.label}
        </button>
      ))}
      {onOpen && !hasDetail && (
        <button
          className="btn btn--line btn--sm"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          详情
        </button>
      )}
    </div>
  );
}

function ShelfCard({ model, flipped, onToggleFlip, actions, onOpen }) {
  const { kind, title, blurb, tags, note, meta } = model;
  const cardRef = useRef(null);
  // 安全版 depth(卡片#1):光斑跟随鼠标 + hover 抬升,只动高光/阴影,不动 3D 翻面 ——
  // 避免给翻面卡加 preserve-3d 导致背面按钮真机点不动的回归(repo 已踩过的坑)。
  const onMove = (e) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", (((e.clientX - r.left) / r.width) * 100).toFixed(1) + "%");
    el.style.setProperty("--my", (((e.clientY - r.top) / r.height) * 100).toFixed(1) + "%");
  };
  return (
    <div
      ref={cardRef}
      className={["card", "card--shelf", "kind-" + kind, flipped ? "is-flipped" : ""].join(" ")}
      onClick={(e) => {
        e.stopPropagation();
        onToggleFlip && onToggleFlip();
      }}
      onMouseMove={onMove}
      role="button"
      tabIndex={0}
      aria-pressed={flipped}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggleFlip && onToggleFlip();
        }
      }}
    >
      <div className="card-inner">
        <CoverFront model={model} />
        <div className="card-face card-back">
          <div className="card-back-title">{title}</div>
          <div className="card-back-blurb t-ui-sm">{blurb}</div>
          <div className="card-tags">
            {(tags || []).map((t, i) => (
              <Tag key={i}>{t}</Tag>
            ))}
          </div>
          {meta && meta.heat ? <div className="card-heat t-meta">在玩 {meta.heat}</div> : null}
          {note ? <div className="card-note t-meta">{note}</div> : null}
          <ActionRow actions={actions} onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
}

function RowCard({ model, actions, onOpen }) {
  const { kind, title, cover, blurb, tags } = model;
  return (
    <div className={["card", "card--row", "kind-" + kind].join(" ")}>
      <div className="card-row-cover" style={coverStyle(kind, cover)}>
        {!cover && <span className="card-row-spine t-kai">{title.slice(0, 1)}</span>}
      </div>
      <div className="card-row-body" onClick={onOpen} role={onOpen ? "button" : undefined}>
        <div className="card-row-head">
          <span className="card-badge-inline">{model.badge && model.badge.label}</span>
          <b className="card-row-title">{title}</b>
        </div>
        <div className="card-row-blurb t-ui-sm">{blurb}</div>
        <div className="card-tags">
          {(tags || []).slice(0, 3).map((t, i) => (
            <Tag key={i}>{t}</Tag>
          ))}
        </div>
      </div>
      {actions && actions.length > 0 && <ActionRow actions={actions} />}
    </div>
  );
}

function ThumbCard({ model, onOpen, selected }) {
  const { kind, title, cover } = model;
  return (
    <div
      className={["card", "card--thumb", "kind-" + kind, selected ? "is-selected" : ""].join(" ")}
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
    >
      <div className="card-thumb-cover" style={coverStyle(kind, cover)}>
        {!cover && <span className="card-thumb-spine t-kai">{title.slice(0, 2)}</span>}
      </div>
      <div className="card-thumb-title t-ui-sm">{title}</div>
    </div>
  );
}

export function Card({ model, variant = "shelf", flipped, onToggleFlip, actions, onOpen, selected }) {
  if (!model) return null;
  if (variant === "row") return <RowCard model={model} actions={actions} onOpen={onOpen} />;
  if (variant === "thumb") return <ThumbCard model={model} onOpen={onOpen} selected={selected} />;
  return <ShelfCard model={model} flipped={flipped} onToggleFlip={onToggleFlip} actions={actions} onOpen={onOpen} />;
}

// CardShelf — 货架容器:auto-fill 190px 列(约 3 列),受控 flip(单张翻 + 点别处收)。
// 一次只翻一张:flippedKey 唯一;点 shelf 空白处收起当前翻面的卡(YOR-47 根治)。
export function CardShelf({ models, variant = "shelf", actionsFor, onOpen, className = "", scroll = false }) {
  const [flippedKey, setFlippedKey] = useState(null);
  const keyOf = (m) => m.kind + ":" + m.id;
  return (
    <div className={["card-shelf", scroll ? "is-scroll" : "", className].filter(Boolean).join(" ")} onClick={() => setFlippedKey(null)}>
      {(models || []).map((m) => {
        const k = keyOf(m);
        return (
          <Card
            key={k}
            model={m}
            variant={variant}
            flipped={flippedKey === k}
            onToggleFlip={() => setFlippedKey((cur) => (cur === k ? null : k))}
            actions={actionsFor ? actionsFor(m) : undefined}
            onOpen={onOpen ? () => onOpen(m) : undefined}
          />
        );
      })}
    </div>
  );
}
