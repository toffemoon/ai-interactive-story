// ReconMobile — 全站手机端适配(≤720px):同一套暖纸视觉语言,底部五格 tab,单列流式。
// 数据/回调与桌面组件同契约;引擎逻辑零改动(MPlay/MChat/MCreate 由桌面控制器换皮渲染)。
(function () {
  const TOKENS = `
  --bg:#f3ece0; --paper:#faf4ea; --paper2:#f6efe2; --paper3:#f8f3e9;
  --ink:#2c2820; --soft:#6f6757; --faint:#9a907a;
  --line:#ddd0b4; --line2:#c4b388;
  --gold:#a98a63; --gold2:#c1a86f;
  --navy:#163b57; --green:#34463d;
  --serif:"Songti SC","STSong","SimSun",serif;
  --serifen:Georgia,"Times New Roman",serif;
  --kai:"Kaiti SC","STKaiti","KaiTi",serif;`;

  const CSS = `
  .cv-m {${TOKENS} position:fixed; inset:0; z-index:45; display:flex; flex-direction:column; overflow:hidden;
    background:repeating-linear-gradient(90deg, rgba(169,138,99,.028) 0 1px, transparent 1px 38px), var(--bg);
    color:var(--ink); font-family:var(--kai);}
  .cv-m * {box-sizing:border-box;}
  @keyframes cvm-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  .cv-m .m-page {animation:cvm-in .28s cubic-bezier(.22,1,.36,1) both;}
  @media (prefers-reduced-motion: reduce){ .cv-m .m-page {animation-duration:1ms;} }

  /* 顶栏 */
  .cv-m .m-top {flex:none; height:52px; display:flex; align-items:center; gap:10px; padding:0 16px; position:relative; background:linear-gradient(180deg,#f1e7d8,#efe4d4);}
  .cv-m .m-top::after {content:""; position:absolute; left:12px; right:12px; bottom:0; height:1px; background:linear-gradient(90deg,transparent,var(--line2),transparent);}
  .cv-m .m-top .bk {flex:none; width:34px; height:34px; display:grid; place-items:center; color:var(--soft); border:1px solid var(--line); background:var(--paper);}
  .cv-m .m-top h1 {margin:0; font-family:var(--serif); font-size:17px; font-weight:700; letter-spacing:.14em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-m .m-top .en {font-family:var(--serifen); font-style:italic; font-size:11px; color:var(--gold); white-space:nowrap;}
  .cv-m .m-top .sp {flex:1;}
  .cv-m .m-top .act {flex:none; font-family:var(--serif); font-size:12px; letter-spacing:.08em; color:var(--soft); border:1px solid var(--line2); background:var(--paper2); padding:6px 12px;}

  /* 滚动主体 + 底部 tab */
  .cv-m .m-body {flex:1; min-height:0; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:14px 14px 18px;}
  .cv-m .m-foot {flex:none; border-top:1px solid var(--line2); background:var(--paper); padding:8px 12px calc(8px + env(safe-area-inset-bottom));}
  .cv-m .m-tabs {flex:none; display:flex; border-top:1px solid var(--line2); background:linear-gradient(180deg,#f1e7d8,#efe4d4); padding-bottom:env(safe-area-inset-bottom);}
  .cv-m .m-tab {flex:1; display:flex; flex-direction:column; align-items:center; gap:3px; padding:8px 0 7px; color:var(--soft); position:relative; cursor:pointer;}
  .cv-m .m-tab .zh {font-family:var(--serif); font-size:11px; letter-spacing:.08em;}
  .cv-m .m-tab.on {color:var(--green);}
  .cv-m .m-tab.on .zh {font-weight:700;}
  .cv-m .m-tab.on::before {content:""; position:absolute; top:-1px; left:24%; right:24%; height:2px; background:var(--gold2);}

  /* 通用块 */
  .cv-m .sec-h {display:flex; align-items:baseline; gap:8px; margin:4px 2px 10px;}
  .cv-m .sec-h b {font-family:var(--serif); font-size:14px; font-weight:700; letter-spacing:.12em;}
  .cv-m .sec-h .en {font-family:var(--serifen); font-size:9px; letter-spacing:.2em; color:var(--gold);}
  .cv-m .sec-h i {flex:1; height:1px; background:var(--line); align-self:center;}
  .cv-m .gbtn {display:flex; align-items:center; justify-content:center; gap:8px; height:46px; background:var(--green); color:#f3ead6;
    border:1px solid #283831; font-family:var(--serif); font-size:15px; letter-spacing:.2em; position:relative; cursor:pointer; width:100%;}
  .cv-m .gbtn::before {content:""; position:absolute; inset:3px; border:1px solid rgba(193,168,111,.5); pointer-events:none;}
  .cv-m .obtn {display:flex; align-items:center; justify-content:center; height:44px; background:transparent; color:var(--navy);
    border:1px solid var(--line2); font-family:var(--serif); font-size:14px; letter-spacing:.14em; cursor:pointer; width:100%;}
  .cv-m .avi {border-radius:50%; flex:none; border:1px solid var(--line2); background:var(--paper2); display:grid; place-items:center;
    font-family:var(--serif); font-weight:700; color:var(--gold); overflow:hidden;}
  .cv-m .avi img {width:100%; height:100%; object-fit:cover;}

  /* 探索 */
  .cv-m .x-card {background:var(--paper); border:1px solid var(--line); margin-bottom:14px; position:relative;}
  .cv-m .x-card::after {content:""; position:absolute; inset:5px; border:1px solid rgba(196,179,132,.3); pointer-events:none;}
  .cv-m .x-cv {height:150px; background:center/cover no-repeat; border-bottom:1px solid var(--line); position:relative;}
  .cv-m .x-cv.noart {background:linear-gradient(160deg,#efe6d2,#ddd0b2); display:grid; place-items:center;}
  .cv-m .x-cv.noart b {font-family:var(--serif); font-size:22px; letter-spacing:.2em; color:var(--gold); font-weight:700;}
  .cv-m .x-bd {padding:12px 14px 13px;}
  .cv-m .x-bd b {display:block; font-family:var(--serif); font-size:16px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-m .x-bd .tg {font-size:11px; color:var(--gold); margin-top:4px;}
  .cv-m .x-bd .syn {font-size:12px; line-height:1.7; color:var(--soft); margin-top:6px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
  .cv-m .x-bd .mt {display:flex; gap:8px; align-items:center; margin-top:8px; padding-top:8px; border-top:1px solid var(--line); font-size:11px; color:var(--soft);}
  .cv-m .x-bd .mt .go {margin-left:auto; font-family:var(--serif); font-size:11.5px; color:var(--navy);}

  /* 故事详情 */
  .cv-m .d-hero {display:flex; gap:14px; margin-bottom:14px;}
  .cv-m .d-cover {flex:none; width:110px; height:146px; border:1px solid var(--line2); background:linear-gradient(165deg,#efe6d2,#ddd0b2);
    box-shadow:4px 5px 0 rgba(43,38,32,.08); display:grid; place-items:center; overflow:hidden; position:relative;}
  .cv-m .d-cover::after {content:""; position:absolute; inset:5px; border:1px solid rgba(169,138,99,.35); pointer-events:none;}
  .cv-m .d-cover img {width:100%; height:100%; object-fit:cover;}
  .cv-m .d-cover b {writing-mode:vertical-rl; font-family:var(--serif); font-size:15px; letter-spacing:.18em; color:var(--gold); font-weight:700; max-height:120px; line-height:1.6;}
  .cv-m .d-hero h2 {margin:0; font-family:var(--serif); font-size:19px; font-weight:700; letter-spacing:.06em; line-height:1.4;}
  .cv-m .d-hero .tags {font-size:11px; color:var(--gold); margin-top:6px;}
  .cv-m .d-hero .au {font-size:11px; color:var(--faint); margin-top:5px;}
  .cv-m .d-blk {background:var(--paper); border:1px solid var(--line); padding:12px 14px; margin-bottom:12px;}
  .cv-m .d-blk p {margin:8px 0 0; font-size:12.5px; line-height:1.85; color:var(--soft);}
  .cv-m .d-blk ul {margin:8px 0 0; padding-left:16px;}
  .cv-m .d-blk li {font-size:12.5px; line-height:1.8; color:var(--soft); margin-bottom:4px;}
  .cv-m .roles {display:flex; gap:10px; overflow-x:auto; padding:2px 2px 8px; -webkit-overflow-scrolling:touch;}
  .cv-m .role {flex:none; width:130px; background:var(--paper); border:1px solid var(--line); padding:10px 10px 9px; text-align:center; position:relative;}
  .cv-m .role.sel {border-color:var(--gold2); box-shadow:inset 0 0 0 1px rgba(193,168,111,.45);}
  .cv-m .role .avi {width:52px; height:52px; margin:2px auto 7px; font-size:20px;}
  .cv-m .role b {display:block; font-family:var(--serif); font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-m .role p {margin:4px 0 0; font-size:10px; color:var(--soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-m .role .bdg {position:absolute; left:0; top:0; background:var(--green); color:#e9dcbf; font-family:var(--serif); font-size:9px; padding:2px 7px;}

  /* 游玩 */
  .cv-m .p-scene {background:var(--paper2); border:1px solid var(--line); margin-bottom:12px; overflow:hidden;}
  .cv-m .p-art {height:120px; background:center/cover no-repeat; border-bottom:1px solid var(--line);}
  .cv-m .p-sbody {padding:11px 13px 12px;}
  .cv-m .p-round {display:flex; align-items:center; gap:8px; font-family:var(--serifen); font-size:9.5px; letter-spacing:.16em; color:var(--gold);}
  .cv-m .p-round i {width:12px; height:1px; background:var(--gold);}
  .cv-m .p-scene h2 {margin:6px 0 0; font-family:var(--serif); font-size:18px; font-weight:700; letter-spacing:.05em;}
  .cv-m .p-scene .sub {font-size:11px; color:var(--soft); margin-top:3px;}
  .cv-m .p-scene .prose {margin:8px 0 0; font-size:12.5px; line-height:1.9; color:#5b5346;}
  .cv-m .p-row {display:flex; gap:10px; padding:9px 2px; border-bottom:1px solid var(--line); align-items:flex-start;}
  .cv-m .p-row .avi {width:34px; height:34px; font-size:14px;}
  .cv-m .p-row .nm {flex:none; font-family:var(--serif); font-size:12.5px; font-weight:700; padding-top:7px;}
  .cv-m .p-row .tx {font-size:12.5px; line-height:1.8; color:var(--soft); padding-top:5px;}
  .cv-m .p-choice {display:block; width:100%; text-align:left; background:var(--paper3); border:1px solid var(--line); padding:11px 13px; margin-bottom:9px; position:relative; cursor:pointer;}
  .cv-m .p-choice b {font-family:var(--serif); font-size:13.5px; letter-spacing:.04em;}
  .cv-m .p-choice p {margin:4px 0 0; font-size:11px; color:var(--soft); line-height:1.6;}
  .cv-m .p-choice .cat {position:absolute; right:10px; top:10px; font-family:var(--serif); font-size:10px; color:var(--faint);}
  .cv-m .p-inrow {display:flex; gap:8px;}
  .cv-m .p-inrow input {flex:1; background:var(--paper); border:1px solid var(--line2); border-radius:0; box-shadow:none; outline:none;
    font-family:var(--kai); font-size:13px; color:var(--ink); padding:11px 12px;}
  .cv-m .p-inrow input:focus {border-color:var(--green); box-shadow:none;}
  .cv-m .p-inrow .go {flex:none; width:76px; display:grid; place-items:center; background:var(--green); color:#f3ead6;
    border:1px solid #283831; font-family:var(--serif); font-size:13px; letter-spacing:.18em; cursor:pointer;}

  /* 聊天 */
  .cv-m .c-strip {display:flex; gap:12px; overflow-x:auto; padding:4px 2px 10px; -webkit-overflow-scrolling:touch;}
  .cv-m .c-item {flex:none; width:56px; text-align:center; cursor:pointer;}
  .cv-m .c-item .avi {width:48px; height:48px; margin:0 auto; font-size:18px;}
  .cv-m .c-item.on .avi {border-color:var(--green); box-shadow:0 0 0 2px rgba(52,70,61,.35);}
  .cv-m .c-item span {display:block; font-size:10px; margin-top:4px; color:var(--soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-m .c-msg {display:flex; gap:8px; margin-bottom:10px; align-items:flex-end;}
  .cv-m .c-msg .avi {width:30px; height:30px; font-size:13px;}
  .cv-m .c-msg .bub {max-width:76%; background:var(--paper); border:1px solid var(--line); padding:9px 12px; font-size:13px; line-height:1.75;}
  .cv-m .c-msg.me {flex-direction:row-reverse;}
  .cv-m .c-msg.me .bub {background:var(--green); border-color:#283831; color:#f2ede2;}
  /* 全身待机动画面板(有 anim 的角色):资料区整宽大图,multiply 融纸面 */
  .cv-m .c-anim {border:1px solid var(--line); background:var(--paper); margin-bottom:12px; overflow:hidden;}
  .cv-m .c-anim video {width:100%; aspect-ratio:834/1112; display:block; object-fit:cover; mix-blend-mode:multiply;}

  /* 创作 */
  .cv-m .k-tabs {display:flex; gap:6px; overflow-x:auto; padding-bottom:8px;}
  .cv-m .k-tab {flex:none; font-family:var(--serif); font-size:12px; letter-spacing:.08em; color:var(--soft); border:1px solid var(--line); background:var(--paper); padding:7px 13px; cursor:pointer;}
  .cv-m .k-tab.on {background:var(--green); color:#f3ead6; border-color:#283831; font-weight:700;}
  .cv-m .w-msg {margin-bottom:11px; padding-left:10px; border-left:2px solid var(--gold2);}
  .cv-m .w-msg.me {border-left-color:var(--green);}
  .cv-m .w-msg .who {font-family:var(--serif); font-size:11px; font-weight:700; color:var(--soft); letter-spacing:.08em;}
  .cv-m .w-msg p {margin:3px 0 0; font-size:12.5px; line-height:1.8; color:var(--ink);}
  .cv-m .w-card {background:var(--paper); border:1px solid var(--line2); padding:12px 14px; margin-bottom:12px;}
  .cv-m .w-card .knm {font-family:var(--serif); font-size:18px; font-weight:700;}
  .cv-m .w-card .kf {display:flex; gap:8px; padding:7px 0; border-bottom:1px dashed var(--line); font-size:12px;}
  .cv-m .w-card .kf .k {flex:none; width:64px; color:var(--faint); font-family:var(--serif);}
  .cv-m .w-card .kf .v {color:var(--soft); line-height:1.6; min-width:0;}
  .cv-m .w-card .kf.fresh .v {color:var(--ink);}
  .cv-m .w-card .kf.fresh .k {color:var(--green);}
  .cv-m .w-actions {display:flex; gap:10px; margin-top:10px;}

  /* 我的 */
  .cv-m .me-card {background:var(--paper); border:1px solid var(--line); padding:14px; display:flex; gap:13px; align-items:center; margin-bottom:14px; position:relative;}
  .cv-m .me-card .avi {width:64px; height:64px; font-size:24px;}
  .cv-m .me-card .nm {font-family:var(--serif); font-size:18px; font-weight:700;}
  .cv-m .me-card .sub {font-size:11px; color:var(--faint); margin-top:4px;}
  .cv-m .me-chip {display:inline-flex; align-items:center; gap:5px; font-family:var(--serif); font-size:11px; color:var(--soft);
    border:1px solid var(--line2); background:var(--paper2); padding:4px 10px; margin-right:8px; margin-top:8px; cursor:pointer;}
  .cv-m .me-stats {display:grid; grid-template-columns:repeat(3,1fr); gap:9px; margin-bottom:14px;}
  .cv-m .me-stat {background:var(--paper); border:1px solid var(--line); text-align:center; padding:10px 4px;}
  .cv-m .me-stat b {font-family:var(--serifen); font-size:19px; color:var(--navy);}
  .cv-m .me-stat span {display:block; font-size:10px; color:var(--soft); margin-top:3px;}
  .cv-m .me-save {display:flex; gap:11px; align-items:center; background:var(--paper); border:1px solid var(--line); padding:10px 12px; margin-bottom:9px;}
  .cv-m .me-save .cv {flex:none; width:52px; height:64px; border:1px solid var(--line); background:linear-gradient(160deg,#efe6d2,#e0d3b6) center/cover; display:grid; place-items:center;}
  .cv-m .me-save .cv b {font-family:var(--serif); font-size:13px; color:var(--gold);}
  .cv-m .me-save .bd {flex:1; min-width:0;}
  .cv-m .me-save .bd b {display:block; font-family:var(--serif); font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-m .me-save .bd span {font-size:11px; color:var(--faint);}
  .cv-m .me-save .go {flex:none; font-family:var(--serif); font-size:12px; color:var(--navy); border:1px solid var(--line2); padding:6px 11px;}

  /* 门面 */
  .cv-m .l-hero {padding:26px 6px 8px; text-align:center;}
  .cv-m .l-kick {font-family:var(--serifen); font-size:9px; letter-spacing:.3em; color:var(--gold);}
  .cv-m .l-hero h2 {margin:10px 0 0; font-family:var(--serif); font-size:30px; font-weight:900; letter-spacing:.04em; line-height:1.4;}
  .cv-m .l-hero h2 em {font-style:normal; color:#1d4063;}
  .cv-m .l-hero p {margin:12px 0 0; font-size:13px; line-height:2; color:var(--soft);}
  .cv-m .l-cta {display:flex; gap:10px; margin:18px 0 22px;}
  .cv-m .m-empty {display:grid; place-items:center; padding:60px 10px;}
  .cv-m .m-empty .pan {width:100%; background:var(--paper); border:1px solid var(--line); padding:30px 22px; text-align:center; position:relative;}
  .cv-m .m-empty .pan::before {content:""; position:absolute; inset:5px; border:1px solid rgba(196,179,132,.4); pointer-events:none;}
  .cv-m .m-empty h3 {margin:0; font-family:var(--serif); font-size:18px; letter-spacing:.1em;}
  .cv-m .m-empty p {font-size:12.5px; color:var(--soft); line-height:1.9; margin:10px 0 16px;}
  `;

  const TABS = [
    { k: "home", zh: "探索", ic: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/></svg> },
    { k: "game", zh: "当前故事", ic: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h6"/></svg> },
    { k: "build", zh: "创作", ic: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/></svg> },
    { k: "chat", zh: "聊天", ic: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 5h16v11H9l-4 4z"/></svg> },
    { k: "mine", zh: "我的", ic: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-4 3.4-6 7-6s7 2 7 6"/></svg> },
  ];

  function Avi({ name, src, size, fs }) {
    return (
      <span className="avi" style={{ width: size, height: size, fontSize: fs }}>
        {src ? <img src={src} alt="" /> : ((name || "?").trim().charAt(0) || "?")}
      </span>
    );
  }

  // 共享壳:顶栏 + 滚动体 + (可选)底部固定操作条 + 五格 tab
  function MShell({ title, en, active, onNav, onBack, topAct, children, footer }) {
    const rootRef = React.useRef(null);
    // 软键盘适配:iOS Safari / Chrome 108+ 键盘弹起默认盖住 fixed 布局的底部输入条。
    // viewport meta 已加 interactive-widget=resizes-content(Chrome);这里用 visualViewport
    // 把整壳压到可视高度兜底 iOS——输入条/执行按钮始终可见。
    React.useEffect(() => {
      const vv = window.visualViewport;
      const el = rootRef.current;
      if (!vv || !el) return undefined;
      const fit = () => {
        const kb = window.innerHeight - vv.height - vv.offsetTop;
        if (kb > 60) { el.style.height = vv.height + "px"; el.style.top = vv.offsetTop + "px"; el.style.bottom = "auto"; }
        else { el.style.height = ""; el.style.top = ""; el.style.bottom = ""; }
      };
      vv.addEventListener("resize", fit);
      vv.addEventListener("scroll", fit);
      return () => { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); };
    }, []);
    return (
      <div className="cv-m" ref={rootRef}>
        <style>{CSS}</style>
        <div className="m-top">
          {onBack ? <span className="bk" onClick={onBack}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M15 5l-7 7 7 7"/></svg></span> : null}
          <h1>{title}</h1>
          {en ? <span className="en">/ {en}</span> : null}
          <span className="sp"></span>
          {topAct || null}
        </div>
        <div className="m-body m-page">{children}</div>
        {footer ? <div className="m-foot">{footer}</div> : null}
        <div className="m-tabs">
          {TABS.map((t) => (
            <span key={t.k} className={"m-tab" + (active === t.k ? " on" : "")} onClick={() => onNav && onNav(t.k)}>
              {t.ic}<span className="zh">{t.zh}</span>
            </span>
          ))}
        </div>
      </div>
    );
  }

  const _f = (x, k) => x && x.data && x.data[k];
  const _nm = (x) => (x && x.data && x.data.name) || (x && x.name) || "未命名故事";

  // —— 门面(手机版精简 hero + 入口) ——
  function MLanding({ presets, onNav, onOpenStory, onNew }) {
    const list = presets || [];
    return (
      <MShell title="YoRHa-A2 引擎" en="Narrative" active="home" onNav={onNav}>
        <div className="l-hero">
          <div className="l-kick">INTERACTIVE NARRATIVE</div>
          <h2>进入<em>会回应</em>你的<br />故事世界</h2>
          <p>每一个选择都被记住——<br />故事因你而无可复制。</p>
        </div>
        <div className="l-cta">
          <span className="gbtn" style={{ flex: 1 }} onClick={() => onNav("home")}>开始探索</span>
          <span className="obtn" style={{ flex: 1 }} onClick={onNew}>立即创作</span>
        </div>
        {list.length > 0 && (
          <>
            <div className="sec-h"><b>精选故事</b><span className="en">FEATURED</span><i></i></div>
            {list.slice(0, 3).map((p, i) => <MStoryCard key={i} p={p} i={i} onOpen={() => onOpenStory(p)} />)}
          </>
        )}
      </MShell>
    );
  }

  function MStoryCard({ p, i, onOpen }) {
    const cover = _f(p, "cover") || "";
    const tags = (_f(p, "tags") || []).slice(0, 3).join(" · ") || "互动叙事";
    const syn = _f(p, "synopsis") || (_f(p, "story") && _f(p, "story").premise) || "一个等你走进的故事。";
    const nch = (_f(p, "characters") || []).length;
    return (
      <div className="x-card" onClick={onOpen} style={{ cursor: "pointer" }}>
        {cover
          ? <div className="x-cv" style={{ backgroundImage: "url(" + cover + ")" }}></div>
          : <div className="x-cv noart"><b>{_nm(p).slice(0, 4)}</b></div>}
        <div className="x-bd">
          <b>{_nm(p)}</b>
          <div className="tg">{tags}</div>
          <div className="syn">{syn}</div>
          <div className="mt"><span>{nch ? nch + " 角色" : "群像"}</span><span>·</span><span>{_f(p, "author") || "店内收录"}</span><span className="go">取下这本书 ›</span></div>
        </div>
      </div>
    );
  }

  // —— 探索/故事库 ——
  function MExplore({ presets, onOpenStory, onNew, onNav, loadErr, onRetry }) {
    const list = presets || [];
    return (
      <MShell title="故事库" en="Library" active="home" onNav={onNav}
        topAct={<span className="act" onClick={onNew}>＋ 写一本</span>}>
        {list.length ? list.map((p, i) => <MStoryCard key={i} p={p} i={i} onOpen={() => onOpenStory(p)} />) : loadErr ? (
          <div className="m-empty"><div className="pan"><h3>书架加载失败</h3><p>没能从服务器取到故事列表,<br />可能是网络抖动。</p><span className="gbtn" onClick={() => onRetry && onRetry()}>点击重试</span></div></div>
        ) : (
          <div className="m-empty"><div className="pan"><h3>书架还空着</h3><p>去「创作」从一张角色卡开始,<br />聊着聊着,一本书就长出来了。</p><span className="gbtn" onClick={onNew}>去创作</span></div></div>
        )}
      </MShell>
    );
  }

  // —— 故事详情 / 选主角 ——
  function MStoryDetail({ preset, onEnter, onClose, onNav }) {
    const { useState } = React;
    const pdata = (preset && preset.data) || {};
    const name = pdata.name || (preset && preset.name) || "未命名故事";
    const syn = pdata.synopsis || (pdata.story && pdata.story.premise) || "";
    const chars = (pdata.characters && pdata.characters.length ? pdata.characters : (pdata.playables || []))
      .map((c) => ({ name: (c.data && c.data.name) || c.name, persona: (c.data && c.data.persona) || c.persona || (c.data && c.data.description) || "" }))
      .filter((c) => c.name);
    const roleSrc = (pdata.playables && pdata.playables.length ? pdata.playables : pdata.characters) || [];
    const roles = roleSrc.map((c) => ({ name: (c.data && c.data.name) || c.name, persona: (c.data && c.data.persona) || c.persona || "", raw: c }))
      .filter((c) => c.name);
    roles.push({ name: "以旁观者开始", persona: "不扮演特定角色", spectator: true });
    const [sel, setSel] = useState(0);
    const world = pdata.world;
    const backstory = (() => {
      if (!world) return [];
      let lines = [];
      if (typeof world === "string") lines = world.split(/\n+/);
      else if (Array.isArray(world.entries)) lines = world.entries.map((e) => (e && (e.name ? e.name + "：" : "") + (e.text || e.content || "")) || "");
      else if (typeof world.text === "string") lines = world.text.split(/\n+/);
      return lines.map((s) => String(s).trim()).filter(Boolean).slice(0, 3);
    })();
    const pick = roles[sel] || null;
    return (
      <MShell title="故事详情" en="Detail" active="home" onNav={onNav} onBack={onClose}
        footer={<span className="gbtn" onClick={() => onEnter(pick && pick.spectator ? null : (pick ? { name: pick.name, persona: pick.persona } : null))}>涟漪入局 · 以「{pick ? (pick.spectator ? "旁观者" : pick.name) : "旁观者"}」进入</span>}>
        <div className="d-hero">
          <div className="d-cover">
            {pdata.cover ? <img src={pdata.cover} alt="" /> : <b>{name.replace(/[\s·•．.,，:：;；!！?？\-—~～]+/g, "").slice(0, 8)}</b>}
          </div>
          <div>
            <h2>{name}</h2>
            <div className="tags">{(pdata.tags || []).slice(0, 3).join(" · ") || "互动叙事"}</div>
            <div className="au">作者　{pdata.author || "店内收录"}</div>
          </div>
        </div>
        <div className="d-blk"><div className="sec-h" style={{ margin: 0 }}><b>简介</b><span className="en">INTRO</span></div><p>{syn || "暂无简介。"}</p></div>
        {backstory.length > 0 && (
          <div className="d-blk"><div className="sec-h" style={{ margin: 0 }}><b>背景</b><span className="en">BACKSTORY</span></div>
            <ul>{backstory.map((b, i) => <li key={i}>{b}</li>)}</ul></div>
        )}
        {chars.length > 0 && (
          <div className="d-blk"><div className="sec-h" style={{ margin: 0 }}><b>角色</b><span className="en">CHARACTERS</span></div>
            <ul>{chars.slice(0, 5).map((c, i) => <li key={i}><b style={{ fontFamily: "var(--serif)" }}>{c.name}</b>　{(c.persona || "").slice(0, 30)}</li>)}
              {chars.length > 5 && <li style={{ color: "var(--faint)" }}>……等共 {chars.length} 位角色</li>}</ul></div>
        )}
        <div className="sec-h"><b>选择你扮演谁</b><span className="en">ROLE</span><i></i></div>
        <div style={{ fontSize: 11, color: "#8a6f49", margin: "0 2px 8px" }}>
          {pick && !pick.spectator ? "你扮演的角色将由你来发言,不再由 AI 出演" : "旁观者同样通过输入行动推进故事"}
        </div>
        <div className="roles">
          {roles.map((r, i) => (
            <div key={i} className={"role" + (i === sel ? " sel" : "")} onClick={() => setSel(i)}>
              {i === sel && <span className="bdg">已选择</span>}
              <Avi name={r.spectator ? "✦" : r.name} size={52} fs={20} />
              <b>{r.name}</b>
              <p>{r.persona || (r.spectator ? "观察者视角" : "可扮演")}</p>
            </div>
          ))}
        </div>
      </MShell>
    );
  }

  // —— 游玩(与 ReconPlay 同契约,由 StoryPanel skin 喂数据) ——
  function MPlay(props) {
    const p = props || {};
    const onChoice = p.onChoice || (() => {});
    const onSubmit = p.onSubmit || (() => {});
    const busy = !!p.busy;
    const dialogues = (p.dialogues && p.dialogues.length) ? p.dialogues : null;
    const choices = (p.choices && p.choices.length) ? p.choices : null;
    const history = p.history || [];
    const [logOpen, setLogOpen] = React.useState(false);
    const logRef = React.useRef(null);
    React.useEffect(() => {
      if (logOpen && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [logOpen]);
    return (
      <MShell title={p.story || "当前故事"} en={p.round || ""} active="game" onNav={p.onNav}
        topAct={history.length ? <span className="act" onClick={() => setLogOpen(true)}>记录</span> : null}
        footer={
          <>
            {/* 撤回上一轮:恢复 pre-turn 快照,输入回填(只能撤最近一轮) */}
            {p.canUndo && !busy ? (
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <span style={{ fontFamily: "var(--serif)", fontSize: 11, color: "var(--soft)", border: "1px solid var(--line2)", background: "var(--paper2)", padding: "4px 10px", cursor: "pointer" }}
                  onClick={() => p.onUndo && p.onUndo()}>↩ 撤回上一轮</span>
              </div>
            ) : null}
            <div className="p-inrow">
              <input value={p.value != null ? p.value : ""} disabled={busy}
                onChange={p.onChange ? (e) => p.onChange(e.target.value) : undefined}
                onKeyDown={(e) => { if (e.key === "Enter" && !busy && !(e.nativeEvent || e).isComposing) { e.preventDefault(); onSubmit(); } }}
                placeholder="输入你的行动或台词……" />
              <span className="go" onClick={() => !busy && onSubmit()} style={{ opacity: busy ? 0.6 : 1 }}>{busy ? "…" : "执行"}</span>
            </div>
          </>
        }>
        <div className="p-scene">
          {p.sceneArt ? <div className="p-art" style={{ backgroundImage: "url(" + p.sceneArt + ")" }}></div> : null}
          <div className="p-sbody">
            <div className="p-round"><span>当前回合</span><i></i><span>{p.round || ""}</span></div>
            <h2>{p.sceneTitle || "序章"}</h2>
            {p.sceneSub ? <div className="sub">{p.sceneSub}</div> : null}
            <p className="prose">{p.narration != null ? p.narration : (busy ? "（叙事生成中……）" : "故事即将开始——说出你的第一句话,或点「执行」生成开场。")}</p>
          </div>
        </div>
        <div className="sec-h"><b>角色发言</b><span className="en">DIALOGUE</span><i></i></div>
        {dialogues ? dialogues.map((d, i) => (
          <div className="p-row" key={(p.round || "") + i}>
            <Avi name={d.name} size={34} fs={14} />
            <span className="nm">{d.name}</span>
            <span className="tx">{d.text}</span>
          </div>
        )) : <div style={{ fontSize: 12, color: "var(--faint)", padding: "6px 2px 10px" }}>{busy ? "（角色正在回应……）" : "（本回合暂无角色发言）"}</div>}
        <div className="sec-h" style={{ marginTop: 14 }}><b>你的行动</b><span className="en">CHOICES</span><i></i></div>
        {choices ? choices.slice(0, 4).map((c, i) => (
          <button className="p-choice" key={(p.round || "") + i} disabled={busy} onClick={() => onChoice(c)}>
            <b>{c.label || c.title || ("选项 " + (i + 1))}</b>
            {c.description ? <p>{c.description}</p> : null}
            <span className="cat">{c.intent || "行动"}</span>
          </button>
        )) : <div style={{ fontSize: 12, color: "var(--faint)", padding: "4px 2px" }}>{busy ? "推荐选项生成中……" : "输入你的行动开始第一回合,推荐选项会在每回合后出现。"}</div>}
        <div style={{ height: 8 }}></div>
        {/* 故事记录:全屏覆盖回看全部回合 */}
        {logOpen && (
          <div style={{ position: "fixed", inset: 0, zIndex: 70, background: "var(--bg)", display: "flex", flexDirection: "column" }}>
            <div className="m-top" style={{ flex: "none" }}>
              <span className="bk" onClick={() => setLogOpen(false)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M15 5l-7 7 7 7"/></svg></span>
              <h1>故事记录</h1><span className="en">/ {history.filter((t) => t.kind === "story").length} 回合</span>
            </div>
            <div ref={logRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px 24px" }}>
              {(() => {
                let n = 0;
                return history.map((t, i) => {
                  if (t.kind === "player") return (
                    <div key={i} style={{ margin: "12px 0 8px", padding: "8px 12px", background: "rgba(52,70,61,.07)", borderLeft: "2px solid var(--green)", fontSize: 12.5 }}>
                      <b style={{ fontFamily: "var(--serif)", fontSize: 10.5, color: "var(--green)", marginRight: 8 }}>你</b>{t.text}
                    </div>
                  );
                  n++;
                  const d = t.data || {};
                  return (
                    <div key={i} style={{ padding: "4px 0 10px", borderBottom: "1px solid var(--line)" }}>
                      <div style={{ fontFamily: "var(--serifen)", fontSize: 9, letterSpacing: ".18em", color: "var(--gold)", margin: "8px 0 5px" }}>ROUND {String(n).padStart(2, "0")}</div>
                      {d.narration ? <p style={{ fontSize: 12.5, lineHeight: 1.9, color: "#5b5346", margin: "0 0 6px", whiteSpace: "pre-wrap" }}>{d.narration}</p> : null}
                      {(d.messages || []).map((m, j) => (
                        <div key={j} style={{ display: "flex", gap: 8, margin: "4px 0", fontSize: 12.5 }}>
                          <b style={{ flex: "none", fontFamily: "var(--serif)" }}>{m.name || m.character_id || "?"}</b>
                          <span style={{ color: "var(--soft)", lineHeight: 1.75 }}>{m.text}</span>
                        </div>
                      ))}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
      </MShell>
    );
  }

  // —— 聊天(与 ReconChat 同契约) ——
  function MChat(props) {
    const P = props || {};
    const characters = P.characters || [];
    const messages = P.messages || [];
    const busy = !!P.busy;
    const canChat = P.canChat !== false;
    const active = characters.find((c) => c.name === P.activeName) || characters[0] || null;
    // 新消息渲染在视口下方会像"发送没反应"→ 消息变化滚到底。
    const endRef = React.useRef(null);
    React.useEffect(() => {
      const el = endRef.current;
      if (el && el.scrollIntoView) el.scrollIntoView({ block: "end" });
    }, [messages.length, busy]);
    return (
      <MShell title="角色聊天" en="Chat" active="chat" onNav={P.onNav}
        footer={
          <div className="p-inrow">
            <input value={P.value != null ? P.value : ""} disabled={!canChat}
              placeholder={!canChat ? "这位角色还没有角色卡,暂不能对话" : (busy ? "TA 正在回复,稍候…" : "输入你想说的话…")}
              onChange={(e) => P.onChange && P.onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !busy && !(e.nativeEvent || e).isComposing) { e.preventDefault(); P.onSend && P.onSend(); } }} />
            <span className="go" style={{ opacity: busy || !canChat ? 0.6 : 1 }} onClick={() => !busy && canChat && P.onSend && P.onSend()}>{busy ? "…" : "发送"}</span>
          </div>
        }>
        {characters.length ? (
          <>
            <div className="c-strip">
              {characters.map((c, i) => (
                <div key={i} className={"c-item" + (active && c.name === active.name ? " on" : "")} onClick={() => P.onPick && P.onPick(c.name)}>
                  <Avi name={c.name} src={c.avatar} size={48} fs={18} />
                  <span>{c.name}</span>
                </div>
              ))}
            </div>
            {active && active.anim ? (
              <div className="c-anim" key={active.name}>
                <video src={active.anim} autoPlay loop muted playsInline preload="auto" />
              </div>
            ) : null}
            {active && (active.persona || active.description) ? (
              <div className="d-blk" style={{ marginBottom: 12 }}><b style={{ fontFamily: "var(--serif)", fontSize: 14 }}>{active.name}</b><p>{(active.description || active.persona || "").slice(0, 80)}</p></div>
            ) : null}
            {messages.length > 0 && (
              <div style={{ textAlign: "center", fontSize: 10.5, color: "var(--faint)", margin: "2px 0 10px" }}>
                {P.restored ? "已接上上次的对话" : "✦ 新的相遇已开始"}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={"c-msg" + (m.who === "me" ? " me" : "")}>
                {m.who !== "me" ? <Avi name={m.who} size={30} fs={13} /> : null}
                <span className="bub">{m.text}</span>
              </div>
            ))}
            {busy && messages.length > 0 && messages[messages.length - 1].who === "me" && (
              <div className="c-msg">
                <Avi name={active ? active.name : "?"} size={30} fs={13} />
                <span className="bub" style={{ color: "var(--faint)", fontStyle: "italic" }}>TA 正在落笔…</span>
              </div>
            )}
          </>
        ) : (
          <div className="m-empty"><div className="pan"><h3>还没有可聊的角色</h3><p>去「创作」造一个角色,<br />或在故事里与角色相遇。</p><span className="gbtn" onClick={() => P.onNav && P.onNav("build")}>去创作</span></div></div>
        )}
        <div style={{ height: 6 }} ref={endRef}></div>
      </MShell>
    );
  }

  // —— 创作(与 ReconCreate 同契约) ——
  function MCreate(props) {
    const P = props || {};
    const kinds = P.kinds || [];
    const messages = P.messages || [];
    const busy = !!P.busy;
    const d = P.draft || { name: "未命名", kind: "", fields: [] };
    return (
      <MShell title="创作桌" en="Atelier" active="build" onNav={P.onNav}
        footer={
          <div className="p-inrow">
            <input value={P.value != null ? P.value : ""} placeholder={busy ? "执笔人推演中,稍候…" : "用一句话告诉我下一步……"}
              onChange={(e) => P.onChange && P.onChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !busy && !(e.nativeEvent || e).isComposing) { e.preventDefault(); P.onSend && P.onSend(); } }} />
            <span className="go" style={{ opacity: busy ? 0.6 : 1 }} onClick={() => !busy && P.onSend && P.onSend()}>{busy ? "…" : "执笔"}</span>
          </div>
        }>
        <div className="k-tabs">
          {kinds.map((k, i) => (
            <span key={i} className={"k-tab" + (i === P.cardKind ? " on" : "")} onClick={() => P.onKind && P.onKind(i)}>{k.zh}</span>
          ))}
        </div>
        <div className="w-card">
          <div className="knm">{d.name || "未命名"}</div>
          {(d.fields || []).map((f, i) => (
            <div key={i} className={"kf" + (f.fresh ? " fresh" : "")}>
              <span className="k">{f.k}</span><span className="v">{f.hidden ? "（隐藏真相,玩家不可见）" + f.v : f.v}</span>
            </div>
          ))}
          {!(d.fields || []).length && <div style={{ fontSize: 12, color: "var(--faint)", paddingTop: 6 }}>聊着聊着,卡就长出来了。</div>}
          {/* 「存草稿」未实现(此前只弹 alert)→ 移除;入库是唯一真实出口 */}
          <div className="w-actions">
            <span className="gbtn" style={{ flex: 1, height: 38 }} onClick={() => P.onSaveCard && P.onSaveCard()}>收入卡库</span>
          </div>
        </div>
        <div className="sec-h"><b>与执笔人对谈</b><span className="en">CO-WRITING</span><i></i></div>
        {messages.map((m, i) => (
          <div key={i} className={"w-msg" + (m.who === "你" ? " me" : "")}>
            <div className="who">{m.who === "你" ? "你 · 口述" : "执笔 · 坊"}</div>
            <p>{m.text}</p>
          </div>
        ))}
        {busy && (
          <div className="w-msg">
            <div className="who">执笔 · 坊</div>
            <p style={{ color: "var(--faint)", fontStyle: "italic" }}>执笔人推演中…</p>
          </div>
        )}
        <div style={{ height: 6 }}></div>
      </MShell>
    );
  }

  // —— 我的 ——
  function MMine({ user, presets, saves, assets, onResume, onNav, onLogout, onAvatar, onNew, savesErr, onRetrySaves }) {
    const { useRef } = React;
    const fileRef = useRef(null);
    const _coverOf = (nm) => {
      const hit = (presets || []).find((p) => {
        const dd = (p && p.data) || {};
        return dd.name === nm || (dd.story && dd.story.title === nm) || p.name === nm;
      });
      return (hit && hit.data && hit.data.cover) || "";
    };
    function pick(ev) {
      const f = ev.target.files && ev.target.files[0]; ev.target.value = "";
      if (!f || !onAvatar) return;
      const url = URL.createObjectURL(f); const img = new Image();
      img.onload = () => { try { const S = 256, c = document.createElement("canvas"); c.width = S; c.height = S; const x = c.getContext("2d"); const m = Math.min(img.width, img.height); x.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S); onAvatar(c.toDataURL("image/jpeg", 0.85)); } finally { URL.revokeObjectURL(url); } };
      img.src = url;
    }
    // 优先用 assets(用户自己的卡库计数,官方公共卡不算个人资产);无 prop 回退 presets 推导。
    const storyCount = assets ? assets.stories : (presets || []).length;
    const charCount = assets ? assets.characters : (presets || []).reduce((s, p) => s + ((_f(p, "characters") || []).length), 0);
    return (
      <MShell title="个人中心" en="Profile" active="mine" onNav={onNav}>
        <div className="me-card">
          <Avi name={user ? (user.display_name || user.username) : "访客"} src={user && user.avatar} size={64} fs={24} />
          <div style={{ minWidth: 0 }}>
            <div className="nm">{user ? (user.display_name || user.username) : "访客"}</div>
            <div className="sub">{user ? ("账户 · " + (user.role || "user")) : "未登录 · 游客模式"}</div>
            <div>
              {user && onAvatar ? <span className="me-chip" onClick={() => fileRef.current && fileRef.current.click()}>更换头像</span> : null}
              {user && onLogout ? <span className="me-chip" onClick={onLogout}>退出登录</span> : null}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={pick} />
        </div>
        <div className="me-stats">
          <div className="me-stat"><b>{storyCount}</b><span>创作故事</span></div>
          <div className="me-stat"><b>{(saves || []).length}</b><span>进行中</span></div>
          <div className="me-stat"><b>{charCount}</b><span>角色卡</span></div>
        </div>
        <div className="sec-h"><b>最近游玩</b><span className="en">RECENT</span><i></i></div>
        {savesErr && (
          <div className="me-save" onClick={() => onRetrySaves && onRetrySaves()} style={{ cursor: "pointer" }}>
            <span className="bd"><b>云端存档加载失败</b><span>点击重试(本机存档不受影响)</span></span>
            <span className="go">重试</span>
          </div>
        )}
        {(saves || []).length ? (saves || []).slice(0, 8).map((s, i) => {
          const nm = s.name || s.summary || "未命名存档";
          const cov = _coverOf(nm);
          return (
            <div className="me-save" key={i} onClick={() => onResume && onResume(s.id)} style={{ cursor: "pointer" }}>
              <span className="cv" style={cov ? { backgroundImage: "url(" + cov + ")" } : undefined}>{!cov && <b>{nm.slice(0, 2)}</b>}</span>
              <span className="bd"><b>{nm}{s.local ? <i style={{ fontStyle: "normal", fontSize: 9, color: "var(--faint)", border: "1px solid var(--line2)", padding: "0 4px", marginLeft: 6 }}>仅本机</i> : null}</b><span>第 {s.turns || 0} 回合{s.updated ? " · " + s.updated : ""}</span></span>
              <span className="go">续读 ›</span>
            </div>
          );
        }) : !savesErr ? (
          <div className="m-empty" style={{ padding: "20px 0" }}><div className="pan"><h3>还没有进行中的故事</h3><p>去「探索」取下一本书开局。</p><span className="gbtn" onClick={() => onNav && onNav("home")}>去探索</span></div></div>
        ) : null}
        {(saves || []).some((s) => s && s.local) && (
          <div style={{ fontSize: 10.5, color: "var(--faint)", margin: "6px 2px 0" }}>标记「仅本机」的存档只在当前浏览器;登录后玩的对局跟随账号。</div>
        )}
      </MShell>
    );
  }

  // —— 当前故事·空态 ——
  function MEmpty({ onNav, onNew }) {
    return (
      <MShell title="当前故事" en="Current" active="game" onNav={onNav}>
        <div className="m-empty">
          <div className="pan">
            <h3>还没有进行中的故事</h3>
            <p>去「探索」取下一本书开局或续玩,<br />或到「创作」写你自己的故事。</p>
            <span className="gbtn" onClick={() => onNav && onNav("home")}>去探索</span>
            <div style={{ height: 10 }}></div>
            <span className="obtn" onClick={onNew}>去创作</span>
          </div>
        </div>
      </MShell>
    );
  }

  Object.assign(window, { MShell, MLanding, MExplore, MStoryDetail, MPlay, MChat, MCreate, MMine, MEmpty });
})();
