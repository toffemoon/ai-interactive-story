import { Tag, Badge } from "./ui";

// 角色「查看详情」弹层:完整介绍,长则滚动。StoryDetail 路由 + 创作预览共用(详情页样式在 StoryDetail.css)。
// 固定全屏覆盖 —— 放在轮播外用,不被卡的 transform 顶歪。
export default function CharDetailModal({ model, onClose }) {
  if (!model) return null;
  return (
    <div className="detail-charmodal" onClick={onClose}>
      <div className="detail-charmodal-card" onClick={(e) => e.stopPropagation()}>
        <button className="detail-charmodal-x" onClick={onClose} aria-label="关闭">×</button>
        <Badge tone="gilt">角色</Badge>
        <h2 className="t-h1 detail-charmodal-name">{model.title}</h2>
        {(model.tags || []).length > 0 && (
          <div className="detail-tags">
            {model.tags.map((t, i) => (
              <Tag key={i}>{t}</Tag>
            ))}
          </div>
        )}
        <div className="detail-charmodal-body t-read">{model.blurb}</div>
      </div>
    </div>
  );
}
