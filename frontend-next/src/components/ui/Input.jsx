import { forwardRef } from "react";

// Input — 搜索 / 表单基础输入,含 focus 环。
export const Input = forwardRef(function Input({ className = "", ...rest }, ref) {
  return <input ref={ref} className={["input", className].filter(Boolean).join(" ")} {...rest} />;
});

// SearchField — 带前导图标的搜索框(探索页用)。
export function SearchField({ icon = "⌕", className = "", ...rest }) {
  return (
    <div className={["search", className].filter(Boolean).join(" ")}>
      <span className="search-icon" aria-hidden="true">{icon}</span>
      <input className="search-input" {...rest} />
    </div>
  );
}
