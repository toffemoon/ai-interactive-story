// ReconExplore — 功能版探索/故事库(登录后主页):统一竖栏 + 全部故事网格。
// 契约 props: { presets:[preset], user, onOpenStory(preset), onNew(), onNav(view) }
function ReconExplore(props) {
  const P = props || {};
  const presets = P.presets || [];
  const user = P.user || null;
  const onOpenStory = P.onOpenStory || (() => {});
  const onNew = P.onNew || (() => {});
  const onNav = P.onNav || (() => {});
  const _name = (x) => (x && x.data && x.data.name) || (x && x.name) || "未命名故事";
  const _f = (x, k) => x && x.data && x.data[k];
  return (
    <div className="cv-explore">
      <style>{`
  .cv-explore {
    --bg:#f3ece0; --paper:#faf4ea; --paper2:#f6efe2;
    --ink:#2c2820; --soft:#6f6757; --faint:#9a907a;
    --line:#ddd0b4; --line2:#c4b388;
    --gold:#a98a63; --gold2:#c1a86f;
    --navy:#163b57; --green:#34463d;
    --serif:"Songti SC","STSong","SimSun",serif;
    --serifen:Georgia,"Times New Roman",serif;
    --kai:"Kaiti SC","STKaiti","KaiTi",serif;
    position:relative; width:1536px; height:1024px; overflow:hidden;
    background:repeating-linear-gradient(90deg, rgba(169,138,99,.028) 0 1px, transparent 1px 46px), var(--bg);
    color:var(--ink); font-family:var(--kai);
  }
  .cv-explore * {box-sizing:border-box;}
  .cv-explore .top {position:absolute; left:188px; right:0; top:0; height:96px; z-index:8;}
  .cv-explore .top::after {content:""; position:absolute; left:34px; right:40px; bottom:0; height:1px;
    background:linear-gradient(90deg,transparent,var(--line2) 4%,var(--line2) 96%,transparent);}
  .cv-explore .ttl {position:absolute; left:34px; top:26px; display:flex; align-items:baseline; gap:16px;}
  .cv-explore .ttl h2 {margin:0; font-family:var(--serif); font-weight:700; font-size:27px; letter-spacing:.1em;}
  .cv-explore .ttl .en {font-family:var(--serifen); font-style:italic; font-size:16px; letter-spacing:.06em; color:var(--gold);}
  .cv-explore .sub {position:absolute; left:36px; top:66px; font-family:var(--kai); font-size:12px; letter-spacing:.06em; color:var(--faint);}
  .cv-explore .tr {position:absolute; right:38px; top:30px; display:flex; align-items:center; gap:18px;}
  .cv-explore .tr .cnt {font-family:var(--kai); font-size:12.5px; color:var(--soft);}
  .cv-explore .tr .cnt b {font-family:var(--serifen); font-size:16px; color:var(--navy); margin:0 3px;}
  .cv-explore .newbtn {height:42px; padding:0 22px; display:inline-flex; align-items:center; gap:9px; background:var(--green); color:#f3ead6;
    border:1px solid #283831; cursor:pointer; position:relative; font-family:var(--serif); font-size:13.5px; letter-spacing:.14em;}
  .cv-explore .newbtn::before {content:""; position:absolute; inset:3px; border:1px solid rgba(193,168,111,.5); pointer-events:none;}
  .cv-explore .newbtn:hover {background:#2c3a32;}
  /* 网格 */
  .cv-explore .grid {position:absolute; left:212px; right:32px; top:118px; bottom:24px; overflow-y:auto;
    display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:18px; align-content:start; padding-right:6px;}
  .cv-explore .grid::-webkit-scrollbar {width:7px;} .cv-explore .grid::-webkit-scrollbar-thumb {background:var(--line2);}
  @keyframes rce-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
  .cv-explore .gcard {background:var(--paper); border:1px solid var(--line); cursor:pointer; position:relative;
    transition:transform .3s cubic-bezier(.22,1,.36,1), box-shadow .3s; animation:rce-in .38s cubic-bezier(.22,1,.36,1) both;}
  .cv-explore .gcard:hover {transform:translateY(-5px); box-shadow:0 14px 28px -16px rgba(43,38,32,.4);}
  .cv-explore .gcard::after {content:""; position:absolute; inset:5px; border:1px solid rgba(196,179,132,.35); pointer-events:none;}
  .cv-explore .gcard .cv {height:148px; background:center/cover no-repeat; border-bottom:1px solid var(--line); position:relative;}
  .cv-explore .gcard .cv.noart {background:linear-gradient(160deg,#efe6d2,#ddd0b2); display:grid; place-items:center;}
  .cv-explore .gcard .cv.noart b {font-family:var(--serif); font-size:22px; letter-spacing:.22em; color:var(--gold); font-weight:700;}
  .cv-explore .gcard .cv .no {position:absolute; left:10px; top:8px; font-family:var(--serifen); font-size:12px; font-weight:700; color:rgba(248,242,228,.92); text-shadow:0 1px 2px rgba(0,0,0,.5);}
  .cv-explore .gcard .bd {padding:13px 16px 14px;}
  .cv-explore .gcard b {display:block; font-family:var(--serif); font-size:16px; font-weight:700; letter-spacing:.04em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-explore .gcard .tg {font-family:var(--kai); font-size:11px; color:var(--gold); margin-top:5px; letter-spacing:.06em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-explore .gcard .syn {font-family:var(--kai); font-size:12px; line-height:1.7; color:var(--soft); margin-top:7px; height:40px;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
  .cv-explore .gcard .mt {display:flex; align-items:center; gap:9px; margin-top:9px; font-family:var(--kai); font-size:11px; color:var(--soft); border-top:1px solid var(--line); padding-top:9px;}
  .cv-explore .gcard .mt i {width:4px; height:4px; background:var(--gold); transform:rotate(45deg); font-style:normal;}
  .cv-explore .gcard .mt .go {margin-left:auto; font-family:var(--serif); font-size:11.5px; letter-spacing:.1em; color:var(--navy);}
  /* 空态 */
  .cv-explore .empty {position:absolute; left:212px; right:32px; top:118px; bottom:24px; display:grid; place-items:center;}
  .cv-explore .empty .panel {width:460px; text-align:center; background:var(--paper); border:1px solid var(--line); padding:48px 42px; position:relative;}
  .cv-explore .empty .panel::before {content:""; position:absolute; inset:6px; border:1px solid rgba(196,179,132,.4); pointer-events:none;}
  .cv-explore .empty h3 {margin:0; font-family:var(--serif); font-size:22px; letter-spacing:.12em;}
  .cv-explore .empty p {font-size:13px; line-height:1.9; color:var(--soft); margin:14px 0 22px;}
      `}</style>

      <window.ReconRail active="home" onNav={onNav} />

      <div className="top">
        <div className="ttl"><h2>故事库</h2><span className="en">/ Story Library</span></div>
        <div className="sub">取下一本书，走进会回应你的故事世界。</div>
        <div className="tr">
          <span className="cnt">共<b>{presets.length}</b>个故事{user ? " · " + (user.display_name || user.username) : ""}</span>
          <span className="newbtn" onClick={onNew}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            写一本新的
          </span>
        </div>
      </div>

      {presets.length ? (
        <div className="grid">
          {presets.map((p, i) => {
            const cover = _f(p, "cover") || "";  // 只用库里真实封面;没有就中性书封,不放假图
            const tags = (_f(p, "tags") || []).slice(0, 3).join(" · ") || "互动叙事";
            const syn = _f(p, "synopsis") || (_f(p, "story") && _f(p, "story").premise) || "一个等你走进的故事。";
            const nch = (_f(p, "characters") || []).length;
            return (
              <div className="gcard" key={i} style={{ animationDelay: (Math.min(i, 8) * 50) + "ms" }} onClick={() => onOpenStory(p)}>
                <div className={"cv" + (cover ? "" : " noart")} style={cover ? { backgroundImage: "url(" + cover + ")" } : undefined}>
                  {!cover && <b>{_name(p).slice(0, 4)}</b>}
                  <span className="no">{String(i + 1).padStart(2, "0")}</span></div>
                <div className="bd">
                  <b>{_name(p)}</b>
                  <div className="tg">{tags}</div>
                  <div className="syn">{syn}</div>
                  <div className="mt"><span>{nch ? nch + " 角色" : "群像"}</span><i></i><span>{_f(p, "author") || "店内收录"}</span><span className="go">取下这本书 ›</span></div>
                </div>
              </div>
            );
          })}
        </div>
      ) : P.loadErr ? (
        /* 加载失败 ≠ 书架为空:失败要长得像失败,给重试出路 */
        <div className="empty">
          <div className="panel">
            <h3>书架加载失败</h3>
            <p>没能从服务器取到故事列表,<br/>可能是网络抖动或服务暂时不可用。</p>
            <span className="newbtn" onClick={() => P.onRetry && P.onRetry()}>点击重试</span>
          </div>
        </div>
      ) : (
        <div className="empty">
          <div className="panel">
            <h3>书架还空着</h3>
            <p>还没有可玩的故事。去「创作」从一张角色卡开始，<br/>聊着聊着，一本书就长出来了。</p>
            <span className="newbtn" onClick={onNew}>去创作</span>
          </div>
        </div>
      )}
    </div>
  );
}
window.ReconExplore = ReconExplore;
