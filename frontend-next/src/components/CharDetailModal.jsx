import { Tag, Badge } from "./ui";

// 角色「查看详情」弹层:完整介绍,长则滚动。StoryDetail 路由 + 创作预览共用(详情页样式在 StoryDetail.css)。
// 固定全屏覆盖 —— 放在轮播外用,不被卡的 transform 顶歪。
// onDelete 可选:传入时底部显示「删除这张卡」(仅「我的 · 我创建的」用;探索 / 详情页不传 → 不显示)。
export default function CharDetailModal({ model, onClose, onDelete }) {
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
        {onDelete && (
          <button type="button" className="detail-charmodal-del" onClick={() => onDelete(model)}>
            删除这张卡
          </button>
        )}
      </div>
    </div>
  );
}
