import { useLocation } from "react-router-dom";
import { useNavigate } from "../../lib/transitionNav";
import { NAV } from "./nav";
import { L } from "../../lib/i18n";
import "./TopNav.css";

// C 幕间顶部导航(画布各页同一条):左 印章 + 沐言,中 五个胶囊(选中 = 白底深字),右 账户圆钮。
//   overlay = 叠在页头大图上(透明底,胶囊组带半透明底);bar = 普通页顶一条(带底线)。
// 各 C 页自己放这条(画板里它是页面的一部分,随页面滚走),AppShell 不再给 C 路由挂旧侧栏。
export default function TopNav({ variant = "overlay" }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const go = (e, to) => {
    e.preventDefault();
    if (!loc.pathname.startsWith(to)) navigate(to);
  };
  return (
    <header className={"topnav topnav--" + variant}>
      <div className="topnav-inner">
        <a href="#/home" className="topnav-brand" onClick={(e) => go(e, "/home")}>
          <img src="/brand/seal-192.png" alt="" />
          <span>{L("Muyan", "沐言")}</span>
        </a>
        <nav className="topnav-pills" aria-label={L("Main", "主导航")}>
          {NAV.map((item) => {
            // 故事详情是从探索点进来的,胶囊仍亮「探索」
            const active = loc.pathname.startsWith(item.to) || (item.key === "explore" && loc.pathname.startsWith("/story/"));
            return (
              <a
                key={item.key}
                href={"#" + item.to}
                className={active ? "is-on" : ""}
                aria-current={active ? "page" : undefined}
                onClick={(e) => go(e, item.to)}
              >
                {item.zh}
              </a>
            );
          })}
        </nav>
        <span className="topnav-gap" />
        <a href="#/mine" className="topnav-account" aria-label={L("My account", "我的账户")} onClick={(e) => go(e, "/mine")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
          </svg>
        </a>
      </div>
    </header>
  );
}
