import { useNavigate } from "../lib/transitionNav";
import TopNav from "../components/shell/TopNav";
import { L } from "../lib/i18n";
import "./Forum.css";

// 论坛(占位 · 内测不做)。本批决策:升为主 tab,点进「建设中」。
// 社区先用站外群;论坛本体 500+ 活跃后再评估(决策)。
// 2026-10-25 C 幕间改版(画布「C 幕间 · 论坛」):顶栏 TopNav,书店夜景卡片说明 + 一行一个站外群。
const GROUPS = [
  { name: L("WeChat group", "微信群"), note: L("Scan a code to join · beta chat", "扫码加入,内测交流") },
  { name: L("QQ group", "QQ 群"), note: L("Group number to be announced", "群号待公布") },
  { name: "Discord", note: L("Community for players outside China", "海外玩家社区") },
];

export default function Forum() {
  const navigate = useNavigate();
  return (
    <div className="page forum">
      <TopNav variant="bar" />
      <main className="forum-main">
        <section className="forum-hero" aria-labelledby="forum-h">
          <img className="forum-hero-bg" src="/home/background.webp" alt="" />
          <div className="forum-hero-shade" aria-hidden="true" />
          <div className="forum-hero-body">
            <h1 id="forum-h">{L("The forum isn't open yet", "论坛还没开")}</h1>
            <p>
              {L(
                "Until it's ready, everyone chats in the off-site groups. Share endings, trade cards, or ask for features there.",
                "做好之前,大家先在站外的群里聊。分享结局、交换卡片、提功能需求都可以。"
              )}
            </p>
            <button type="button" className="forum-go" onClick={() => navigate("/explore")}>
              {L("Go explore first", "先去探索")}
            </button>
          </div>
        </section>

        <section className="forum-groups" aria-labelledby="forum-groups-h">
          <h2 id="forum-groups-h">{L("Beta groups (off-site)", "内测群(站外)")}</h2>
          <ul>
            {GROUPS.map((g) => (
              <li key={g.name}>
                <span className="forum-group-name">{g.name}</span>
                <span className="forum-group-note">{g.note}</span>
                <span className="forum-group-soon">{L("Not open yet", "还没开放")}</span>
              </li>
            ))}
          </ul>
          <p className="forum-foot">
            {L(
              "We'll consider a full forum once the community is bigger. Lightweight sharing (endings, card trades) is planned separately.",
              "等社区大一些再考虑做完整的论坛。轻量的分享(结局、换卡)另外规划。"
            )}
          </p>
        </section>
      </main>
    </div>
  );
}
