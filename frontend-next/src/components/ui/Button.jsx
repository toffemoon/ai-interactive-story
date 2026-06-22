// Button — variant: primary(accent 填)/ secondary(accent-2 描边)/ ghost(纯文字)/ line(中性描边)
// size: sm / md。full = 占满整行(卡背「查看详情」等)。
export function Button({
  variant = "primary",
  size = "md",
  full = false,
  className = "",
  type = "button",
  children,
  ...rest
}) {
  const cls = [
    "btn",
    "btn--" + variant,
    "btn--" + size,
    full ? "btn--full" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
