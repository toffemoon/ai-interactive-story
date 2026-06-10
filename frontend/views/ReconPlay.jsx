// ReconPlay — 游玩页面 1:1(由 _recon/play.html 端成 React window 组件)
function ReconPlay(props) {
  const p = props || {};
  const onChoice = p.onChoice || (() => {});
  const onSubmit = p.onSubmit || (() => {});
  const onChange = p.onChange;
  const busy = !!p.busy;
  const story = p.story || "未命名故事";
  const worldTime = p.worldTime || "—";
  const round = p.round || "ROUND 01";
  const sceneTitle = p.sceneTitle || "序章";
  const sceneSub = p.sceneSub || "";
  const narration = p.narration != null ? p.narration : (busy ? "（叙事生成中……）" : "故事即将开始——说出你的第一句话，或选一个行动。");
  const value = p.value != null ? p.value : "";
  const playerName = p.playerName || "玩家";
  const sceneArt = p.sceneArt || "";
  const dialogues = (p.dialogues && p.dialogues.length) ? p.dialogues : null;
  const choices = (p.choices && p.choices.length) ? p.choices : null;
  const relationships = (p.relationships && p.relationships.length) ? p.relationships : null;
  const events = (p.events && p.events.length) ? p.events : null;
  const present = (p.present && p.present.length) ? p.present : null;
  const ini = (s) => (s || "?").trim().charAt(0) || "?";
  const choiceIcon = (i) => {
    const ic = [
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 5h16v10H9l-4 4z" /></svg>,
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="9" y="3" width="6" height="18" rx="3" /><circle cx="12" cy="8" r="1.4" fill="currentColor" /></svg>,
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 3h6v6M20 3l-8 8M10 5H4v15h15v-6" /></svg>,
    ];
    return ic[i % ic.length];
  };
  return (
    <div className="cv-play">
      <style>{`
  .cv-play {
    --bg:#f3ece0; --paper:#faf4ea; --paper2:#f6efe2; --paper3:#f8f3e9;
    --ink:#2c2820; --soft:#6f6757; --faint:#9a907a;
    --line:#ddd0b4; --line2:#c4b388;
    --gold:#a98a63; --gold2:#c1a86f;
    --navy:#163b57; --navy-deep:#0d2f49;
    --green:#34463d;
    --serif:"Songti SC","STSong","SimSun",serif;
    --serifen:Georgia,"Times New Roman",serif;
    --kai:"Kaiti SC","STKaiti","KaiTi",serif;
  }
  .cv-play * {box-sizing:border-box;}
  .cv-play {
    position:relative; width:1536px; height:1024px; overflow:hidden;
    background:
      repeating-linear-gradient(90deg, rgba(169,138,99,.028) 0 1px, transparent 1px 46px),
      var(--bg);
    color:var(--ink); font-family:var(--kai);
  }

  
  .cv-play .lbar {position:absolute; left:0; top:0; bottom:0; width:188px; z-index:30;
    background:linear-gradient(180deg,#f1e7d8,#efe4d4);
    border-right:1px solid var(--line2);}
  .cv-play .lbar .logo {display:flex; align-items:center; gap:9px; padding:20px 0 16px 18px; position:relative;}
  .cv-play .lbar .logo img {width:34px; height:34px; object-fit:contain; opacity:.95; flex:none;}
  .cv-play .lbar .logo .lt b {display:block; font-family:var(--serifen); font-size:12.5px; letter-spacing:.02em; color:#8a6f49; font-weight:600; line-height:1.15;}
  .cv-play .lbar .logo .lt span {display:block; font-family:var(--kai); font-size:9.5px; letter-spacing:.22em; color:var(--gold); margin-top:3px;}
  .cv-play .lbar .logo::after {content:""; position:absolute; left:18px; right:18px; bottom:0; height:1px;
    background:linear-gradient(90deg,transparent,var(--line2),transparent);}

  .cv-play .nav {margin-top:10px; display:flex; flex-direction:column;}
  .cv-play .nav a {display:flex; align-items:center; gap:12px; height:54px; padding:0 0 0 24px; cursor:pointer; position:relative; color:var(--soft);}
  .cv-play .nav a .ic {width:21px; height:21px; flex:none; display:grid; place-items:center;}
  .cv-play .nav a .tx {display:flex; flex-direction:column;}
  .cv-play .nav a .tx .zh {font-family:var(--serif); font-size:15px; letter-spacing:.12em;}
  .cv-play .nav a .tx .en {font-family:var(--serifen); font-size:8px; letter-spacing:.24em; color:var(--faint); margin-top:2px;}
  .cv-play .nav a.on {background:linear-gradient(90deg,#3c4d43,#34463d); color:#eef0e2; border-color:#2c3a32;}
  .cv-play .nav a.on .en {color:rgba(238,240,226,.6);}
  .cv-play .nav a.on::before {content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--gold2);}

  
  .cv-play .pcard {position:absolute; left:0; right:0; bottom:0; padding:14px 18px 18px; border-top:1px solid var(--line);}
  .cv-play .pcard .ttl {font-family:var(--serif); font-size:12px; letter-spacing:.12em; color:var(--soft);}
  .cv-play .pcard .ttl span {font-family:var(--serifen); font-size:8px; letter-spacing:.26em; color:var(--faint); margin-left:6px;}
  .cv-play .pcard .por {width:140px; height:138px; margin:8px auto 0; object-fit:cover; display:block;}
  .cv-play .pcard .nm {font-family:var(--serif); font-size:17px; font-weight:700; color:var(--ink); text-align:center; margin-top:7px; letter-spacing:.04em;}
  .cv-play .pcard .lv {font-family:var(--serifen); font-size:11px; color:var(--soft); text-align:center; margin-top:2px;}
  .cv-play .pcard .insp {display:flex; align-items:center; justify-content:space-between; margin-top:13px; padding-top:11px; border-top:1px solid var(--line);}
  .cv-play .pcard .insp .lb {font-family:var(--serif); font-size:11px; color:var(--soft);}
  .cv-play .pcard .insp .lb i {display:block; font-family:var(--serifen); font-size:7.5px; letter-spacing:.2em; color:var(--faint);}
  .cv-play .pcard .insp .vl {display:flex; align-items:center; gap:6px; font-family:var(--serifen); font-size:16px; font-weight:700; color:var(--navy);}
  .cv-play .pcard .insp .vl svg {color:var(--gold2);}

  
  .cv-play .top {position:absolute; left:188px; right:0; top:0; height:60px; z-index:20; display:flex; align-items:center;}
  .cv-play .top::after {content:""; position:absolute; left:24px; right:24px; bottom:0; height:1px; background:linear-gradient(90deg,transparent,var(--line2) 6%,var(--line2) 94%,transparent);}
  .cv-play .crumb {display:flex; align-items:baseline; gap:11px; margin-left:32px;}
  .cv-play .crumb .lb {font-family:var(--kai); font-size:10px; letter-spacing:.22em; color:var(--faint);}
  .cv-play .crumb .ti {font-family:var(--serif); font-size:18px; font-weight:700; letter-spacing:.05em; color:var(--ink);}
  .cv-play .crumb .ed {color:var(--gold); font-size:13px; transform:translateY(1px);}
  .cv-play .topr {position:absolute; right:22px; top:0; height:60px; display:flex; align-items:center; gap:22px;}
  
  .cv-play .titem {display:flex; align-items:center; gap:7px; color:var(--soft); cursor:pointer;}
  .cv-play .titem .ic {width:18px; height:18px; display:grid; place-items:center; flex:none;}
  .cv-play .titem .tt {display:flex; flex-direction:column; line-height:1;}
  .cv-play .titem .zh {font-family:var(--serif); font-size:12px; letter-spacing:.04em;}
  .cv-play .titem .en {font-family:var(--serifen); font-size:6.5px; letter-spacing:.18em; color:var(--faint); margin-top:3px;}
  .cv-play .tdiv {width:1px; height:30px; background:var(--line2); opacity:.7;}
  .cv-play .ttime {display:flex; flex-direction:column; align-items:flex-start; gap:3px;}
  .cv-play .ttime .lb {font-family:var(--serifen); font-size:8px; letter-spacing:.16em; color:var(--faint);}
  .cv-play .ttime .vl {font-family:var(--serifen); font-size:16px; color:var(--soft); letter-spacing:.04em;}
  
  .cv-play .tsuper {display:flex; flex-direction:column; align-items:center; gap:5px; color:var(--soft); cursor:pointer;}
  .cv-play .tsuper .ic {width:20px; height:20px; display:grid; place-items:center;}
  .cv-play .tsuper .zh {font-family:var(--serif); font-size:11px; letter-spacing:.06em;}
  .cv-play .tsuper .en {font-family:var(--serifen); font-size:7px; letter-spacing:.2em; color:var(--faint);}
  .cv-play .tgear {color:var(--faint); cursor:pointer; display:grid; place-items:center; width:22px; height:22px;}
  
  .cv-play .topdeco {position:absolute; right:0; top:0; width:156px; height:56px; z-index:1; pointer-events:none; opacity:.85; mix-blend-mode:multiply;
    background:no-repeat right top/contain url(assets/recon/play-topdeco.png);}

  
  .cv-play .main {display:block; position:absolute; left:212px; top:78px; width:954px; bottom:24px; overflow-y:auto; overflow-x:hidden; padding-right:4px;}
  .cv-play .main::-webkit-scrollbar {width:7px;} .cv-play .main::-webkit-scrollbar-thumb {background:var(--line2);}

  
  .cv-play .scene {position:relative; width:100%; height:306px; border:1px solid var(--line); overflow:hidden; background:var(--paper2);}
  .cv-play .scene .art {position:absolute; right:0; top:0; bottom:0; width:82%;
    background:center/cover no-repeat url(assets/recon/play-scene.png); filter:brightness(.93) contrast(1.06) saturate(1.04);}
  
  .cv-play .scene .art::before {content:""; position:absolute; inset:0; background:linear-gradient(90deg,var(--paper2) 0%,rgba(246,239,226,.80) 13%,rgba(246,239,226,.34) 28%,transparent 48%);}
  .cv-play .scene .veil {position:absolute; inset:0; background:linear-gradient(90deg,var(--paper2) 4%,rgba(246,239,226,.0) 40%);}
  .cv-play .scene .round {position:absolute; left:24px; top:18px; display:flex; align-items:center; gap:9px;}
  .cv-play .scene .round i {width:14px; height:1px; background:var(--gold);}
  .cv-play .scene .round span {font-family:var(--serif); font-size:11px; letter-spacing:.14em; color:var(--soft);}
  .cv-play .scene .round b {font-family:var(--serifen); font-size:10px; letter-spacing:.16em; color:var(--gold); font-weight:600;}
  .cv-play .scene h2 {position:absolute; left:24px; top:46px; margin:0; font-family:var(--serif); font-weight:700; font-size:34px; letter-spacing:.06em; color:var(--ink); max-width:52%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-play .scene .sub {position:absolute; left:25px; top:96px; font-family:var(--kai); font-size:13px; letter-spacing:.04em; color:var(--soft);}
  .cv-play .scene .prose {position:absolute; left:25px; top:132px; bottom:16px; width:430px; overflow-y:auto; font-family:var(--kai); font-size:13.5px; line-height:2.0; color:#5b5346; margin:0;}
  .cv-play .scene .prose::-webkit-scrollbar {width:5px;} .cv-play .scene .prose::-webkit-scrollbar-thumb {background:var(--line2);}

  
  .cv-play .presence {margin-top:18px;}
  .cv-play .ph {display:flex; align-items:center; gap:10px;}
  .cv-play .ph b {font-family:var(--serif); font-size:14px; font-weight:700; letter-spacing:.12em; color:var(--ink);}
  .cv-play .ph .en {font-family:var(--serifen); font-size:8.5px; letter-spacing:.26em; color:var(--gold);}
  .cv-play .ph .ln {flex:1; height:1px; background:linear-gradient(90deg,var(--line2),transparent);}
  .cv-play .prow {display:flex; align-items:center; gap:14px; padding:12px 4px; border-bottom:1px solid var(--line);}
  .cv-play .prow img {width:42px; height:42px; border-radius:50%; flex:none; object-fit:cover; border:1px solid var(--line2);}
  .cv-play .prow .nm {width:54px; flex:none; font-family:var(--serif); font-size:14px; font-weight:700; color:var(--ink);}
  .cv-play .prow .dash {width:18px; height:1px; background:var(--line2); flex:none;}
  .cv-play .prow .ln-q {font-family:var(--kai); font-size:14px; color:var(--soft); letter-spacing:.02em;}

  
  .cv-play .choices {margin-top:20px;}
  .cv-play .cgrid {display:flex; gap:11px; margin-top:13px;}
  .cv-play .ccard {flex:1; min-width:0; background:var(--paper3); border:1px solid var(--line); padding:14px 15px 11px; position:relative; cursor:pointer;}
  .cv-play .avi {width:42px; height:42px; border-radius:50%; flex:none; border:1px solid var(--line2); background:var(--paper2); display:grid; place-items:center; font-family:var(--serif); font-size:16px; font-weight:700; color:var(--gold);}
  .cv-play .avi.sm {width:42px; height:42px; font-size:15px;}
  /* 防 styles.css 全局 input 规则泄漏 */
  .cv-play .freein {border-radius:0; box-shadow:none;}
  .cv-play .freein:focus {box-shadow:none;}
  /* 回合切换:叙事/对话/选项 淡入轻浮(容器按 round 重挂载触发;延迟用内联 style 错峰) */
  @keyframes rcp-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  .cv-play .scene .prose, .cv-play .prow, .cv-play .ccard { animation: rcp-in .34s cubic-bezier(.22,1,.36,1) both; }
  @media (prefers-reduced-motion: reduce){ .cv-play .scene .prose, .cv-play .prow, .cv-play .ccard { animation-duration:1ms; } }
  
  .cv-play .ccard::before, .cv-play .ccard::after {content:""; position:absolute; width:9px; height:9px; border:1px solid var(--line2); opacity:.6;}
  .cv-play .ccard::before {left:5px; top:5px; border-right:none; border-bottom:none;}
  .cv-play .ccard::after {right:5px; top:5px; border-left:none; border-bottom:none;}
  .cv-play .ccard .ch {display:flex; align-items:center; gap:11px;}
  .cv-play .ccard .ic {width:30px; height:30px; display:grid; place-items:center; color:var(--navy); flex:none;}
  .cv-play .ccard b {font-family:var(--serif); font-size:15px; font-weight:700; color:var(--ink); letter-spacing:.04em;}
  .cv-play .ccard p {font-family:var(--kai); font-size:10.5px; line-height:1.55; color:var(--soft); margin:9px 0 0;}
  .cv-play .ccard .cf {display:flex; align-items:center; justify-content:space-between; margin-top:11px; padding-top:9px; border-top:1px solid #ece2cf;}
  .cv-play .ccard .cat {display:flex; align-items:center; gap:5px; font-family:var(--serif); font-size:10.5px; color:var(--faint); letter-spacing:.04em;}
  .cv-play .ccard .cat svg {color:var(--line2);}
  .cv-play .ccard .cost {display:flex; align-items:center; gap:4px; font-family:var(--serifen); font-size:10.5px; color:var(--faint);}
  .cv-play .ccard .cost svg {color:var(--gold);}

  
  .cv-play .free {margin-top:16px; background:var(--paper3); border:1px solid var(--line); padding:14px 16px; position:relative; display:flex; align-items:center;}
  .cv-play .free .fl {flex:1;}
  .cv-play .free .fh {display:flex; align-items:baseline; gap:10px;}
  .cv-play .free .fh b {font-family:var(--serif); font-size:13px; font-weight:700; letter-spacing:.1em; color:var(--ink);}
  .cv-play .free .fh .en {font-family:var(--serifen); font-size:8px; letter-spacing:.24em; color:var(--gold);}
  .cv-play .free .fh .en::before {content:"FREE INPUT";}
  .cv-play .free .ph2 {font-family:var(--kai); font-size:11.5px; color:var(--faint); margin-top:8px;}
  .cv-play .free .exec {display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; width:108px; height:54px; background:var(--green); color:#eef0e2; cursor:pointer; position:relative;}
  .cv-play .free .exec::before {content:""; position:absolute; inset:3px; border:1px solid rgba(193,168,111,.5);}
  .cv-play .free .exec .zh {font-family:var(--serif); font-size:14px; letter-spacing:.16em; position:relative; display:flex; align-items:center; gap:6px;}
  .cv-play .free .exec .en {font-family:var(--serifen); font-size:7.5px; letter-spacing:.26em; color:rgba(238,240,226,.65); position:relative;}

  
  .cv-play .rcol {position:absolute; right:24px; top:78px; width:316px; bottom:24px;
    background:var(--paper); border:1px solid var(--line); padding:16px 18px;}
  .cv-play .rh {display:flex; align-items:center; gap:9px; padding-bottom:11px; border-bottom:1px solid var(--line);}
  .cv-play .rh .badge {width:22px; height:22px; border:1px solid var(--line2); display:grid; place-items:center; color:var(--gold); flex:none;}
  .cv-play .rh b {font-family:var(--serif); font-size:15px; font-weight:700; letter-spacing:.1em; color:var(--ink);}
  .cv-play .rh .en {font-family:var(--serifen); font-size:8px; letter-spacing:.24em; color:var(--gold); align-self:flex-end; margin-bottom:2px;}
  .cv-play .sub-h {display:flex; align-items:center; gap:8px; margin:15px 0 0;}
  .cv-play .sub-h .dot {width:5px; height:5px; transform:rotate(45deg); background:var(--gold);}
  .cv-play .sub-h .zh {font-family:var(--serif); font-size:12px; font-weight:700; letter-spacing:.08em; color:var(--soft);}
  .cv-play .sub-h .en {font-family:var(--serifen); font-size:7.5px; letter-spacing:.2em; color:var(--faint);}

  .cv-play .sceneinfo {display:flex; align-items:center; justify-content:space-between; margin-top:9px;}
  .cv-play .sceneinfo p {font-family:var(--kai); font-size:12px; color:var(--ink); margin:0;}
  .cv-play .sceneinfo p.amb {font-size:10.5px; color:var(--soft); margin-top:6px;}
  .cv-play .sceneinfo img {width:50px; height:36px; object-fit:cover; border:1px solid var(--line2); flex:none;}

  .cv-play .minis {display:flex; align-items:center; gap:14px; margin-top:11px; padding-left:2px;}
  .cv-play .minis img {width:42px; height:42px; border-radius:50%; object-fit:cover; border:1px solid var(--line2);}
  .cv-play .minis .plus {width:30px; height:30px; border-radius:50%; border:1px dashed var(--line2); display:grid; place-items:center; color:var(--faint); font-size:16px;}

  .cv-play .stat {margin-top:11px;}
  .cv-play .stat .r {display:flex; align-items:center; gap:8px; margin-top:9px;}
  .cv-play .stat .r .sic {color:var(--gold); display:grid; place-items:center; flex:none;}
  .cv-play .stat .r .nm {width:34px; font-family:var(--serif); font-size:12px; color:var(--soft);}
  .cv-play .stat .r .bar {flex:1; height:5px; background:#e9ddc8; position:relative;}
  .cv-play .stat .r .bar i {position:absolute; left:0; top:0; bottom:0;}
  .cv-play .stat .r .vl {width:48px; text-align:right; font-family:var(--serifen); font-size:11px; color:var(--soft);}
  .cv-play .stat .r .vl em {font-style:normal; color:var(--faint); font-size:9px;}

  .cv-play .rel {margin-top:9px;}
  .cv-play .rel .r {display:flex; align-items:center; gap:9px; padding:7px 0; border-bottom:1px solid #ece2cf;}
  .cv-play .rel .r .ht {color:#b6614c; font-size:13px;}
  .cv-play .rel .r .nm {font-family:var(--serif); font-size:13px; color:var(--ink);}
  .cv-play .rel .r .ty {flex:1; font-family:var(--kai); font-size:10.5px; color:var(--faint);}
  .cv-play .rel .r .up {display:inline-flex; align-items:center; gap:1px; font-family:var(--serifen); font-size:11px; color:#5a7a55; font-weight:700;}
  .cv-play .rel .r .up svg {margin-left:0;}

  .cv-play .evs {margin-top:9px;}
  .cv-play .evs .r {display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #ece2cf;}
  .cv-play .evs .r .bd {width:5px; height:5px; border-radius:50%; background:var(--gold); flex:none;}
  .cv-play .evs .r .tx {flex:1; font-family:var(--kai); font-size:11.5px; color:var(--soft);}
  .cv-play .evs .r .nw {font-family:var(--serifen); font-size:8px; letter-spacing:.1em; color:#b5402e; border:1px solid #d8a99e; padding:1px 4px;}

  .cv-play .rtabs {display:flex; gap:9px; margin-top:13px;}
  .cv-play .rtab {flex:1; display:flex; align-items:center; justify-content:center; gap:7px; height:38px; border:1px solid var(--line2); cursor:pointer;}
  .cv-play .rtab svg {color:var(--soft);}
  .cv-play .rtab .zh {font-family:var(--serif); font-size:12px; color:var(--soft);}
  .cv-play .rtab .en {font-family:var(--serifen); font-size:7px; letter-spacing:.16em; color:var(--faint);}
  .cv-play .rtab.on {background:#ece2d3; border-color:var(--gold);}
  .cv-play .rtab.on .zh {color:var(--navy); font-weight:700;}

  .cv-play .tips {position:relative; margin-top:14px; padding-top:13px; border-top:1px solid var(--line); min-height:118px;}
  .cv-play .tips .th {display:flex; align-items:center; gap:8px;}
  .cv-play .tips .th svg {color:var(--gold);}
  .cv-play .tips .th b {font-family:var(--serif); font-size:12px; font-weight:700; color:var(--soft); letter-spacing:.06em;}
  .cv-play .tips .th .en {font-family:var(--serifen); font-size:7.5px; letter-spacing:.2em; color:var(--faint);}
  .cv-play .tips p {font-family:var(--kai); font-size:11.5px; line-height:1.85; color:var(--soft); margin:9px 0 0; width:175px;}
  .cv-play .tips .chibi {position:absolute; right:-4px; bottom:-18px; width:95px; height:auto;}
`}</style>

      {/* 左 引擎竖栏(全站统一 ReconRail;点击由外层 ReconShell 委托导航) */}
      <window.ReconRail active="game">
        <div className="pcard">
          <div className="ttl">玩家身份<span>PLAYER</span></div>
          <img className="por" src="assets/recon/play-player.png" alt="" />
          <div className="nm">{playerName}</div>
          <div className="lv">玩家</div>
        </div>
      </window.ReconRail>

      {/* 顶 面包屑 */}
      <div className="top">
        <div className="topdeco"></div>
        <div className="crumb">
          <span className="lb">当前故事</span>
          <span className="ti">《{story}》</span>
          <span className="ed">✎</span>
        </div>
        <div className="topr">
          <div className="titem"><span className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h7V4"/></svg></span><span className="tt"><span className="zh">存档</span><span className="en">SAVE</span></span></div>
          <div className="titem"><span className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 9a8 8 0 1 1 1 5"/><path d="M4 4v5h5"/></svg></span><span className="tt"><span className="zh">回溯本轮</span><span className="en">REWIND</span></span></div>
          <div className="titem"><span className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 11a8 8 0 1 0-1 5"/><path d="M20 4v5h-5"/></svg></span><span className="tt"><span className="zh">重生成</span><span className="en">REGENERATE</span></span></div>
          <div className="tdiv"></div>
          <div className="ttime">
            <div className="lb">故事内时间 · IN-WORLD TIME</div>
            <div className="vl">{worldTime}</div>
          </div>
          <div className="tdiv"></div>
          <div className="tsuper"><span className="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M12 3v3M12 18v3M4 12H1M23 12h-3M6 6l-2-2M20 20l-2-2M18 6l2-2M4 20l2-2"/><circle cx="12" cy="12" r="4"/></svg></span><span className="zh">雨夜</span><span className="en">SUPERVISOR</span></div>
          <div className="tgear"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg></div>
        </div>
      </div>

      {/* 中部主区 */}
      <div className="main">
        {/* 场景 */}
        <div className="scene">
          <div className="art" style={sceneArt ? { backgroundImage: "url(" + sceneArt + ")" } : undefined}></div>
          <div className="veil"></div>
          <div className="round"><span>当前回合</span><i></i><b>{round}</b></div>
          <h2>{sceneTitle}</h2>
          <div className="sub">{sceneSub}</div>
          <p className="prose" key={round}>{narration}</p>
        </div>

        {/* 角色发言 */}
        <div className="presence">
          <div className="ph"><b>角色发言</b><span className="en">DIALOGUE</span><span className="ln"></span></div>
          {dialogues ? dialogues.map((d, i) => (
            <div className="prow" key={round + "-" + i} style={{ animationDelay: (i * 80) + "ms" }}><span className="avi">{ini(d.name)}</span><span className="nm" style={{ width: (d.name || "").length > 2 ? "72px" : undefined }}>{d.name}</span><span className="dash"></span><span className="ln-q">{d.text}</span></div>
          )) : (
            <div className="prow" style={{ borderBottom: "none" }}><span className="ln-q" style={{ color: "var(--faint)" }}>{busy ? "（角色正在回应……）" : "（本回合暂无角色发言）"}</span></div>
          )}
        </div>

        {/* 你的行动 */}
        <div className="choices">
          <div className="ph"><b>你的行动</b><span className="en">CHOICES</span><span className="ln"></span></div>
          <div className="cgrid">
            {choices ? choices.slice(0, 4).map((c, i) => (
              <div className="ccard" key={round + "-" + i} onClick={() => !busy && onChoice(c)} style={{ cursor: busy ? "default" : "pointer", animationDelay: (120 + i * 70) + "ms" }}>
                <div className="ch"><span className="ic">{choiceIcon(i)}</span><b>{c.label || c.title || ("选项 " + (i + 1))}</b></div>
                <p>{c.description || c.desc || ""}</p>
                <div className="cf"><span className="cat"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2-6.3-4.6L5.7 21 8 14.8 2 10.4h7.6z"/></svg>{c.intent || "行动"}</span><span className="cost"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3l7 5-7 13-7-13z"/></svg>0</span></div>
              </div>
            )) : (
              <div className="ccard" style={{ flex: 1, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                <p style={{ margin: 0, color: "var(--faint)" }}>{busy ? "推荐选项生成中……" : "输入你的行动开始第一回合，推荐选项会在每回合后出现。"}</p>
              </div>
            )}
          </div>
        </div>

        {/* 自由行动 */}
        <div className="free">
          <div className="fl">
            <div className="fh"><b>自由行动</b><span className="en"></span></div>
            <input className="freein" value={value} disabled={busy}
              onChange={onChange ? (e) => onChange(e.target.value) : undefined}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !busy) { e.preventDefault(); onSubmit(); } }}
              placeholder="输入你的行动或台词，回车提交，AI 据此推动故事……"
              style={{ width: "100%", marginTop: 9, background: "transparent", border: "none", borderBottom: "1px solid var(--line2)", outline: "none", fontFamily: "var(--kai)", fontSize: 13.5, color: "var(--ink)", padding: "6px 2px" }} />
          </div>
          <div className="exec" onClick={() => !busy && onSubmit()} style={{ cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}><span className="zh"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>{busy ? "生成" : "执行"}</span><span className="en">ENTER</span></div>
        </div>
      </div>

      {/* 右 世界状态档案 */}
      <div className="rcol">
        <div className="rh"><span className="badge"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 10l9-6 9 6"/><path d="M5 9v11h14V9"/><path d="M10 20v-6h4v6"/></svg></span><b>世界状态档案</b><span className="en">WORLD STATE</span></div>

        <div className="sub-h"><span className="dot"></span><span className="zh">场景信息</span><span className="en">SCENE</span></div>
        <div className="sceneinfo"><div><p>{sceneTitle}</p>{sceneSub ? <p className="amb">{sceneSub}</p> : null}</div></div>

        <div className="sub-h"><span className="dot"></span><span className="zh">在场角色</span><span className="en">CHARACTERS</span></div>
        <div className="minis">
          {(present || (dialogues ? dialogues.map((d) => d.name) : [])).slice(0, 5).map((nm, i) => (
            <span className="avi sm" key={i} title={nm}>{ini(nm)}</span>
          ))}
          {!present && !dialogues && <span className="plus">…</span>}
        </div>

        {relationships ? (
          <>
            <div className="sub-h"><span className="dot"></span><span className="zh">关系变化</span><span className="en">RELATIONSHIP</span></div>
            <div className="rel">
              {relationships.slice(0, 4).map((r, i) => (
                <div className="r" key={i}><span className="ht">♥</span><span className="nm">{r.name}</span><span className="ty">{r.type || "关系"}</span><span className="up">{r.delta || ""}</span></div>
              ))}
            </div>
          </>
        ) : null}

        <div className="sub-h"><span className="dot"></span><span className="zh">最新事件</span><span className="en">EVENTS</span></div>
        <div className="evs">
          {events ? events.slice(0, 4).map((e, i) => (
            <div className="r" key={i}><span className="bd"></span><span className="tx">{typeof e === "string" ? e : (e.name || e.text || "")}</span>{i < 2 ? <span className="nw">新</span> : null}</div>
          )) : (
            <div className="r"><span className="bd"></span><span className="tx" style={{ color: "var(--faint)" }}>本回合暂无触发事件</span></div>
          )}
        </div>

        <div className="rtabs">
          <div className="rtab"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="4" width="16" height="16"/><path d="M4 9h16"/></svg><span className="zh">事实边界</span><span className="en">BOUNDARY</span></div>
          <div className="rtab on"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 4h11l3 3v13H5z"/><path d="M9 9h6M9 13h5"/></svg><span className="zh">记忆档案</span><span className="en">MEMORY</span></div>
        </div>

        <div className="tips">
          <div className="th"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z"/></svg><b>提示</b><span className="en">/ TIPS</span></div>
          <p>你可以选择推荐行动，或自由输入任何你想法，故事会因你而改变。</p>
          <img className="chibi" src="assets/recon/play-chibi-br.png" alt="" />
        </div>
      </div>

    </div>
  );
}
window.ReconPlay = ReconPlay;
