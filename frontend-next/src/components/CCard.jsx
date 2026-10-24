import { useState } from "react";
import { L } from "../lib/i18n";

// 幕间 C 的故事卡 / 角色卡(样式在 styles/c-kit.css 的 .cx-story / .cx-char):图满铺,底部压暗写名字和第一个标签。
// 探索页、我的(收藏 / 我创建的)共用。onFav 不传就不显示收藏星。
const STAR = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
  </svg>
);

const hasCjk = (s) => /[㐀-鿿]/.test(s || "");

function favLabel(model, fav) {
  return fav ? L(`Remove ${model.title} from favorites`, `取消收藏 ${model.title}`) : L(`Add ${model.title} to favorites`, `收藏 ${model.title}`);
}

function FavButton({ model, fav, onFav }) {
  if (!onFav) return null;
  return (
    <button type="button" className={"cx-fav" + (fav ? " is-on" : "")} aria-pressed={fav} aria-label={favLabel(model, fav)} onClick={() => onFav(model)}>
      {STAR}
    </button>
  );
}

export function StoryCard({ model, fav, onOpen, onFav }) {
  const tag = (model.tags || [])[0] || L("Story", "故事");
  const [broken, setBroken] = useState(false); // 封面地址失效就退回书脊字
  return (
    <article className="cx-story">
      <button type="button" className="cx-story-hit" onClick={() => onOpen(model)}>
        {model.cover && !broken ? (
          <img src={model.cover} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
        ) : (
          <span className="cx-story-spine" aria-hidden="true">{hasCjk(model.title) ? model.title.slice(0, 2) : model.title.charAt(0)}</span>
        )}
        <span className="cx-shade" aria-hidden="true" />
        <span className="cx-card-text">
          <span className="cx-card-name">{model.title}</span>
          <span className="cx-card-tag">{tag}</span>
        </span>
      </button>
      <FavButton model={model} fav={fav} onFav={onFav} />
    </article>
  );
}

export function CharCard({ model, fav, onOpen, onFav }) {
  const tag = (model.tags || [])[0] || L("Character", "角色");
  const [broken, setBroken] = useState(false);
  return (
    <article className="cx-char">
      <button type="button" className="cx-char-hit" onClick={() => onOpen(model)}>
        {model.cover && !broken ? (
          <img src={model.cover} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
        ) : (
          <span className="cx-char-glyph" aria-hidden="true">{model.title.charAt(0)}</span>
        )}
        <span className="cx-shade" aria-hidden="true" />
        <span className="cx-card-text">
          <span className="cx-card-name cx-card-name--char">{model.title}</span>
          <span className="cx-card-tag">{tag}</span>
        </span>
      </button>
      <FavButton model={model} fav={fav} onFav={onFav} />
    </article>
  );
}
