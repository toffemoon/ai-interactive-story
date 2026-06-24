// Tag — 状态栏 / 元信息小标(场景 / 关系 / 标签)。tone 可选:scene / relation / plain。
export function Tag({ tone = "plain", className = "", children }) {
  return <span className={["tag", "tag--" + tone, className].filter(Boolean).join(" ")}>{children}</span>;
}
