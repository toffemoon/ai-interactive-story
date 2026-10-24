import { useNavigate } from "../lib/transitionNav";
import { Button } from "../components/ui";
import { L } from "../lib/i18n";
import "./Forum.css";

// 论坛(占位 · 内测不做)。本批决策:升为主 tab,点进「建设中」。
// 社区先用站外群;论坛本体 500+ 活跃后再评估(决策)。
const GROUPS = [
  { name: L("WeChat group", "微信群"), note: L("Scan to join · Beta chat", "扫码进群 · 内测交流"), soon: true },
  { name: L("QQ group", "QQ 群"), note: L("Group number TBA", "群号待公布"), soon: true },
  { name: "Discord", note: L("International player community", "海外玩家社区"), soon: true },
];

export default function Forum() {
  const navigate = useNavigate();
  return (
    <div className="page forum">
      <div className="forum-hero">
        <div className="forum-badge t-meta">{L("Forum · Under construction", "论坛 · 建设中")}</div>
        <h1 className="t-display forum-title">{L("Coming soon", "敬请期待")}</h1>
        <p className="t-read forum-lead">
          {L(
            "The community forum is still being built. During the beta we're using off-site group chats: share endings, trade cards, and request features there.",
            "社区论坛还在搭。内测期我们先用站外群聊——晒结局、换卡、提需求,都在那儿。"
          )}
        </p>
        <Button variant="primary" onClick={() => navigate("/explore")}>
          {L("Explore in the meantime", "先去探索看看")}
        </Button>
      </div>

      <div className="forum-groups">
        <div className="forum-groups-h t-kai">{L("Beta community (off-site)", "内测社区(站外)")}</div>
        <div className="forum-group-list">
          {GROUPS.map((g) => (
            <div className="forum-group" key={g.name}>
              <span className="forum-group-name t-kai">{g.name}</span>
              <span className="forum-group-note t-meta">{g.note}</span>
              {g.soon && <span className="forum-group-soon t-meta">{L("Coming soon", "即将公布")}</span>}
            </div>
          ))}
        </div>
        <p className="forum-foot t-meta">{L("We'll revisit a full forum once the community grows; lightweight sharing (endings / card trades) is planned separately.", "论坛本体待社区规模起来后再评估;轻 UGC(晒结局 / 换卡)另算。")}</p>
      </div>
    </div>
  );
}
