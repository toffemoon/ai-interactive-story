import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../state/auth";

// 纸面页共用顶栏。本轮只接 探索;创作/纯聊/我的 留占位(后续视图分阶段),styleguide 入口在右。
export function TopBar() {
  const { user, enabled, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <span className="topbar-brand t-kai">沐言</span>
      <nav className="topbar-nav">
        <NavLink to="/explore" className={({ isActive }) => (isActive ? "is-active" : "")}>
          探索
        </NavLink>
        <button className="navlink" disabled title="后续分阶段">
          创作
        </button>
        <button className="navlink" disabled title="后续分阶段">
          纯聊
        </button>
        <button className="navlink" disabled title="后续分阶段">
          我的
        </button>
      </nav>
      <div className="topbar-right">
        <NavLink to="/styleguide" className="topbar-user">
          styleguide
        </NavLink>
        {enabled && user ? (
          <>
            <span className="topbar-user">{user.display_name || user.username}</span>
            <button className="navlink" onClick={() => logout().then(() => navigate("/login"))}>
              退出
            </button>
          </>
        ) : (
          <span className="topbar-user">游客</span>
        )}
      </div>
    </header>
  );
}
