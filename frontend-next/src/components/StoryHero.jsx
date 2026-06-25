import { useMemo, useState } from "react";
import { Tag, Badge, Card } from "./ui";
import CardCarousel from "./CardCarousel";
import "../routes/StoryDetail.css";

// 故事详情页「门面」共享组件:大封面 + 标题/标签/元信息 + 简介 + 作者的话 + 角色卡曲面轮播。
// StoryDetail 路由 与 创作「预览成详情页」都用它 —— 单一来源,预览保证跟真页一模一样。
//   - preset:{ name, data:{ name, cover, synopsis, author, author_note, tags, characters, story } } 形状。
//   - onOpenChar(model):点居中角色卡时回调(由用处弹角色详情,见 CharDetailModal)。
export default function StoryHero({ preset, onOpenChar }) {
  const d = (preset && preset.data) || {};
  const bookName = d.name || (preset && preset.name) || "未命名故事";
  const synopsis = d.synopsis || (d.story && d.story.premise) || "";
  const tags = d.tags || [];
  const author = d.author || "";
  const authorNote = d.author_note || "";

  // 角色卡 → CardModel(取公开层多字段,不进剧透层)。
  const charModels = useMemo(
    () =>
      (d.characters || []).map((c, i) => {
        const cd = (c && c.data) || c || {};
        const sec = (label, v) => (v && String(v).trim() ? (label ? label + " · " + v : String(v)) : "");
        const intro =
          [
            sec("", cd.anchor),
            sec("外貌", cd.look),
            sec("性格", cd.personality),
            sec("矛盾", cd.tension),
            sec("", cd.description || cd.persona),
            sec("情境", cd.scenario),
            (cd.known_public || []).length ? "已知 · " + cd.known_public.join(";") : "",
          ]
            .filter(Boolean)
            .join("\n\n") || "这个角色还没写简介,入局后逐渐揭晓。";
        return {
          id: (cd.name || "char") + "#" + i,
          kind: "character",
          title: cd.name || "角色",
          cover: cd.image || cd.avatar || "",
          blurb: intro,
          badge: { label: "角色", tone: "gilt" },
          tags: (cd.tags || []).slice(0, 3),
          meta: {},
          raw: c,
        };
      }),
    [preset]
  );

  const [charActive, setCharActive] = useState(0);

  return (
    <>
      {/* 头:大封面 + 柔化封面底纹 + 标题/标签/元信息 + 简介 + 作者的话 */}
      <div className="detail-hero">
        {d.cover && (
          <div className="detail-hero-bg" style={{ backgroundImage: `url("${d.cover}")` }} aria-hidden="true" />
        )}
        <div className="detail-head">
          <div className="detail-cover" style={d.cover ? { backgroundImage: `url("${d.cover}")` } : undefined}>
            {!d.cover && <span className="detail-cover-spine t-kai">{bookName.slice(0, 8)}</span>}
          </div>
          <div className="detail-headmain">
            <Badge tone="pine">完整故事 · 可直接玩</Badge>
            <h1 className="t-display detail-title">{bookName}</h1>
            {tags.length > 0 && (
              <div className="detail-tags">
                {tags.map((t, i) => (
                  <Tag key={i}>{t}</Tag>
                ))}
              </div>
            )}
            <div className="detail-meta">
              {author && <span className="detail-meta-i t-meta">作者 · {author}</span>}
              {charModels.length > 0 && <span className="detail-meta-i t-meta">{charModels.length} 位角色</span>}
              <span className="detail-meta-i t-meta">打开即玩</span>
            </div>
            <div className="detail-intro">
              <h2 className="t-h3 detail-sec">简介</h2>
              <p className="t-read detail-intro-text">{synopsis || "暂无简介。"}</p>
            </div>
            {authorNote.trim() && (
              <div className="detail-intro detail-authornote">
                <h2 className="t-h3 detail-sec">作者的话</h2>
                <p className="t-read detail-intro-text">{authorNote}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 角色:DOM 曲面轮播,居中卡点开看完整介绍 */}
      {charModels.length > 0 && (
        <section className="detail-block">
          <h2 className="t-h3 detail-sec">角色</h2>
          <p className="detail-hint t-meta">拖动 / 滚轮浏览角色,点居中卡看完整介绍</p>
          <CardCarousel
            items={charModels}
            activeIndex={charActive}
            onActiveChange={setCharActive}
            ariaLabel="角色卡轮播"
            renderItem={(m, { active }) => (
              <Card
                model={m}
                variant="shelf"
                onToggleFlip={() => active && onOpenChar && onOpenChar(m)}
                onOpen={() => onOpenChar && onOpenChar(m)}
              />
            )}
          />
        </section>
      )}
    </>
  );
}
