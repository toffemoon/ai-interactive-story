import { useNavigate } from "../lib/transitionNav";
import { Button } from "../components/ui";
import "./Forum.css";

// 论坛(占位 · 内测不做)。本批决策:升为主 tab,点进「建设中」。
// 社区先用站外群;论坛本体 500+ 活跃后再评估(决策)。
const GROUPS = [
  { name: "微信群", note: "扫码进群 · 内测交流", soon: true },
  { name: "QQ 群", note: "群号待公布", soon: true },
  { name: "Discord", note: "海外玩家社区", soon: true },
];

export default function Forum() {
  const navigate = useNavigate();
  return (
    <div className="page forum">
      <div className="forum-hero">
        <div className="forum-badge t-meta">论坛 · 建设中</div>
        <h1 className="t-display forum-title">敬请期待</h1>
        <p className="t-read forum-lead">
          社区论坛还在搭。内测期我们先用站外群聊——晒结局、换卡、提需求,都在那儿。
        </p>
        <Button variant="primary" onClick={() => navigate("/explore")}>
          先去探索看看
        </Button>
      </div>

      <div className="forum-groups">
        <div className="forum-groups-h t-kai">内测社区(站外)</div>
        <div className="forum-group-list">
          {GROUPS.map((g) => (
            <div className="forum-group" key={g.name}>
              <span className="forum-group-name t-kai">{g.name}</span>
              <span className="forum-group-note t-meta">{g.note}</span>
              {g.soon && <span className="forum-group-soon t-meta">即将公布</span>}
            </div>
          ))}
        </div>
        <p className="forum-foot t-meta">论坛本体待社区规模起来后再评估;轻 UGC(晒结局 / 换卡)另算。</p>
      </div>
    </div>
  );
}
