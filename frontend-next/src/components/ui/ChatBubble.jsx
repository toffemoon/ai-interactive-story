// ChatBubble — 微信式气泡。side: received(面板填,异侧圆角)/ sent(accent-2 填)。
export function ChatBubble({ side = "received", className = "", children }) {
  return (
    <div className={["bubble-row", "bubble-row--" + side].join(" ")}>
      <span className={["bubble", "bubble--" + side, className].filter(Boolean).join(" ")}>{children}</span>
    </div>
  );
}
