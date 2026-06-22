// Chip — 筛选 pill。active 态(墨填)。
export function Chip({ active = false, className = "", children, ...rest }) {
  return (
    <button className={["chip", active ? "is-on" : "", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </button>
  );
}
