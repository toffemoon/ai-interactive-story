// ReconRail — 全站统一的左侧引擎竖栏(logo + 五项主导航 + 底部插槽)。
// 用法:<window.ReconRail active="game" onNav={navTo}>{页面专属底部块}</window.ReconRail>
// 自带 .cv-rail scope;页面专属底部块仍由各页自己的 scoped CSS 负责样式(children 在页面根 scope 内)。
function ReconRail({ active, onNav, children }) {
  const go = onNav || (() => {});
  const ITEMS = [
    { k: "home", zh: "探索", en: "EXPLORE", ic: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg> },
    { k: "game", zh: "当前故事", en: "CURRENT STORY", ic: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/></svg> },
    { k: "build", zh: "创作", en: "CREATE", ic: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/></svg> },
    { k: "chat", zh: "聊天", en: "CHAT", ic: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 5h16v11H9l-4 4z"/></svg> },
    { k: "mine", zh: "我的", en: "PROFILE", ic: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 4h11l3 3v13H5z"/><path d="M9 9h6M9 13h6"/></svg> },
  ];
  return (
    <div className="cv-rail">
      <style>{`
  .cv-rail {position:absolute; left:0; top:0; bottom:0; width:216px; z-index:30;
    background:linear-gradient(180deg,#f1e7d8,#efe4d4); border-right:1px solid #c4b388;
    --r-serif:"Songti SC","STSong","SimSun",serif; --r-serifen:Georgia,"Times New Roman",serif; --r-kai:"Kaiti SC","STKaiti","KaiTi",serif;
    --r-soft:#6f6757; --r-faint:#9a907a; --r-gold:#a98a63; --r-gold2:#c1a86f; --r-line:#ddd0b4;}
  .cv-rail * {box-sizing:border-box;}
  .cv-rail .logo {display:flex; align-items:center; gap:10px; padding:22px 0 18px 20px; position:relative; cursor:pointer;}
  .cv-rail .logo img {width:40px; height:40px; object-fit:contain; opacity:.95; flex:none;}
  .cv-rail .logo .lt b {display:block; font-family:var(--r-serifen); font-size:14px; letter-spacing:.02em; color:#8a6f49; font-weight:600; line-height:1.15;}
  .cv-rail .logo .lt span {display:block; font-family:var(--r-kai); font-size:11px; letter-spacing:.22em; color:var(--r-gold); margin-top:3px;}
  .cv-rail .logo::after {content:""; position:absolute; left:18px; right:18px; bottom:0; height:1px; background:linear-gradient(90deg,transparent,#c4b388,transparent);}
  .cv-rail .rnav {margin-top:10px; display:flex; flex-direction:column;}
  .cv-rail .rnav a {display:flex; align-items:center; gap:13px; height:60px; padding:0 0 0 26px; cursor:pointer; position:relative; color:var(--r-soft); text-decoration:none;}
  .cv-rail .rnav a .ic {width:23px; height:23px; flex:none; display:grid; place-items:center;}
  .cv-rail .rnav a .tx {display:flex; flex-direction:column;}
  .cv-rail .rnav a .tx .zh {font-family:var(--r-serif); font-size:17px; letter-spacing:.12em;}
  .cv-rail .rnav a .tx .en {font-family:var(--r-serifen); font-size:9px; letter-spacing:.24em; color:var(--r-faint); margin-top:2px;}
  .cv-rail .rnav a.on {background:linear-gradient(90deg,#3c4d43,#34463d); color:#eef0e2;}
  .cv-rail .rnav a.on .tx .en {color:rgba(238,240,226,.6);}
  .cv-rail .rnav a.on::before {content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--r-gold2);}
  .cv-rail .rnav a {transition: color .2s ease, background .25s ease;}
  .cv-rail .rnav a:hover:not(.on) {color:#2c2820; background:rgba(169,138,99,.08);}
      `}</style>
      <div className="logo" onClick={() => go("landing")} title="回到首页">
        <img src="assets/recon/play-emblem.png" alt="" />
        <div className="lt"><b>NARRATIVE<br/>ENGINE</b><span>叙事引擎</span></div>
      </div>
      <div className="rnav">
        {ITEMS.map((it) => (
          <a key={it.k} className={active === it.k ? "on" : undefined} onClick={() => go(it.k)}>
            <span className="ic">{it.ic}</span>
            <span className="tx"><span className="zh">{it.zh}</span><span className="en">{it.en}</span></span>
          </a>
        ))}
      </div>
      {children}
    </div>
  );
}
window.ReconRail = ReconRail;
