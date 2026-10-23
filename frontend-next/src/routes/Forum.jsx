import { useNavigate } from "../lib/transitionNav";
import { Button } from "../components/ui";
import "./Forum.css";

// 论坛(占位 · 内测不做)。本批决策:升为主 tab,点进「建设中」。
// 社区先用站外群;论坛本体 500+ 活跃后再评估(决策)。
const GROUPS = [
  { name: "WeChat group", note: "Scan to join · Beta chat", soon: true },
  { name: "QQ group", note: "Group number TBA", soon: true },
  { name: "Discord", note: "International player community", soon: true },
];

export default function Forum() {
  const navigate = useNavigate();
  return (
    <div className="page forum">
      <div className="forum-hero">
        <div className="forum-badge t-meta">Forum · Under construction</div>
        <h1 className="t-display forum-title">Coming soon</h1>
        <p className="t-read forum-lead">
          The community forum is still being built. During the beta we're using off-site group chats: share endings, trade cards, and request features there.
        </p>
        <Button variant="primary" onClick={() => navigate("/explore")}>
          Explore in the meantime
        </Button>
      </div>

      <div className="forum-groups">
        <div className="forum-groups-h t-kai">Beta community (off-site)</div>
        <div className="forum-group-list">
          {GROUPS.map((g) => (
            <div className="forum-group" key={g.name}>
              <span className="forum-group-name t-kai">{g.name}</span>
              <span className="forum-group-note t-meta">{g.note}</span>
              {g.soon && <span className="forum-group-soon t-meta">Coming soon</span>}
            </div>
          ))}
        </div>
        <p className="forum-foot t-meta">We'll revisit a full forum once the community grows; lightweight sharing (endings / card trades) is planned separately.</p>
      </div>
    </div>
  );
}
