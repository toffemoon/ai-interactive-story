// Badge — 类型角标。tone: pine(完整故事)/ gilt(角色/世界/演出)/ cinnabar。
// 探索页每张卡必带(vault 竞品结论);也用于卡面正面(深底变体由 .card 上下文接管)。
export function Badge({ tone = "pine", className = "", children }) {
  return <span className={["badge", "tone-" + tone, className].filter(Boolean).join(" ")}>{children}</span>;
}
