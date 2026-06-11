// ReconPlay — 游玩页面 1:1(由 _recon/play.html 端成 React window 组件)
function ReconPlay(props) {
  const p = props || {};
  const onNav = p.onNav;
  const onChoice = p.onChoice || (() => {});
  const onSubmit = p.onSubmit || (() => {});
  const onChange = p.onChange;
  const onReroll = p.onReroll || null;
  const canReroll = !!p.canReroll;
  const onUndo = p.onUndo || null;
  const canUndo = !!p.canUndo;
  const history = p.history || [];   // 全量回合流 [{kind:'player'|'story', ...}],驱动「故事记录」抽屉
  const busy = !!p.busy;
  const [logOpen, setLogOpen] = React.useState(false);
  // 一次性提示(轻引导):选项只是建议,可自由输入——看过(关掉)就不再出现。
  const [hintGone, setHintGone] = React.useState(() => {
    try { return localStorage.getItem("ais_hint_play_free") === "1"; } catch (e) { return true; }
  });
  const dismissHint = () => { setHintGone(true); try { localStorage.setItem("ais_hint_play_free", "1"); } catch (e) {} };
  // 抽屉打开时滚到最新一轮
  const logRef = React.useRef(null);
  React.useEffect(() => {
    if (logOpen && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logOpen, history.length]);
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
    position:relative; width:100%; height:100vh; min-height:640px; overflow:hidden;
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

  
  .cv-play .top {position:absolute; left:216px; right:0; top:0; height:60px; z-index:20; display:flex; align-items:center;}
  .cv-play .top::after {content:""; position:absolute; left:24px; right:24px; bottom:0; height:1px; background:linear-gradient(90deg,transparent,var(--line2) 6%,var(--line2) 94%,transparent);}
  .cv-play .crumb {display:flex; align-items:baseline; gap:11px; margin-left:32px;}
  .cv-play .crumb .lb {font-family:var(--kai); font-size:14px; letter-spacing:.18em; color:var(--soft);}
  .cv-play .crumb .ti {font-family:var(--serif); font-size:18px; font-weight:700; letter-spacing:.05em; color:var(--ink);}
  .cv-play .topr {position:absolute; right:22px; top:0; height:60px; display:flex; align-items:center; gap:22px;}
  
  .cv-play .titem {display:flex; align-items:center; gap:7px; color:var(--soft); cursor:pointer;}
  .cv-play .titem.dis {opacity:.45; cursor:default;}
  /* 回合等待:叙事区顶部带闪烁光标的推演指示(首 token 前玩家也知道点上了) */
  .cv-play .gen {margin-left:12px; font-family:var(--kai); font-size:11.5px; color:#8a6f49;}
  .cv-play .gen i {display:inline-block; font-style:normal; animation:rcp-blink 1s steps(2) infinite;}
  @keyframes rcp-blink {50% {opacity:0;}}
  /* 故事记录抽屉:右侧滑入,全量回合流(玩家行动 + 叙事 + 台词 + 事件) */
  .cv-play .logwrap {position:absolute; inset:0; z-index:60; background:rgba(34,28,18,.32);}
  .cv-play .logpanel {position:absolute; right:0; top:0; bottom:0; width:560px; background:var(--paper); border-left:1px solid var(--line2);
    display:flex; flex-direction:column; box-shadow:-18px 0 44px -22px rgba(43,38,32,.5); animation:rcp-log .28s cubic-bezier(.22,1,.36,1) both;}
  @keyframes rcp-log { from {transform:translateX(40px); opacity:0;} to {transform:none; opacity:1;} }
  @media (prefers-reduced-motion: reduce){ .cv-play .logpanel {animation-duration:1ms;} }
  .cv-play .loghead {flex:none; display:flex; align-items:center; gap:10px; padding:16px 20px 13px; border-bottom:1px solid var(--line);}
  .cv-play .loghead b {font-family:var(--serif); font-size:16px; letter-spacing:.1em; color:var(--ink);}
  .cv-play .loghead .en {font-family:var(--serifen); font-size:8px; letter-spacing:.22em; color:var(--gold);}
  .cv-play .loghead .cnt {margin-left:auto; font-family:var(--serifen); font-size:11px; color:var(--faint);}
  .cv-play .loghead .x {cursor:pointer; color:var(--soft); padding:2px 8px; font-size:14px;}
  .cv-play .logbody {flex:1; min-height:0; overflow-y:auto; padding:14px 22px 20px;}
  .cv-play .logbody::-webkit-scrollbar {width:6px;} .cv-play .logbody::-webkit-scrollbar-thumb {background:var(--line2);}
  .cv-play .lg-me {margin:14px 0 10px; padding:9px 13px; background:rgba(52,70,61,.07); border-left:2px solid var(--green); font-family:var(--kai); font-size:15px; color:var(--ink);}
  .cv-play .lg-me span {font-family:var(--serif); font-size:10.5px; color:var(--green); margin-right:8px; font-weight:700;}
  .cv-play .lg-turn {padding:4px 0 10px; border-bottom:1px solid #ece2cf;}
  .cv-play .lg-rd {font-family:var(--serifen); font-size:9px; letter-spacing:.18em; color:var(--gold); margin:8px 0 6px;}
  .cv-play .lg-nar {font-family:var(--kai); font-size:15px; line-height:1.95; color:#5b5346; margin:0 0 6px; white-space:pre-wrap;}
  .cv-play .lg-line {display:flex; gap:8px; margin:4px 0; font-size:15px;}
  .cv-play .lg-line b {flex:none; font-family:var(--serif); color:var(--ink);}
  .cv-play .lg-line span {font-family:var(--kai); color:var(--soft); line-height:1.8;}
  .cv-play .lg-ev {font-family:var(--kai); font-size:15px; color:#8a6f49; margin-top:5px;}
  /* 一次性轻引导:看过即消失 */
  .cv-play .freehint {display:flex; align-items:center; gap:8px; margin-top:14px; font-family:var(--kai); font-size:11.5px; color:#8a6f49;}
  .cv-play .freehint .x {cursor:pointer; color:var(--faint); margin-left:auto; padding:0 4px;}
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

  
  .cv-play .main {display:block; position:absolute; left:240px; top:78px; right:364px; bottom:24px; overflow-y:auto; overflow-x:hidden; padding-right:4px;}
  .cv-play .main::-webkit-scrollbar {width:7px;} .cv-play .main::-webkit-scrollbar-thumb {background:var(--line2);}

  
  .cv-play .scene {position:relative; width:100%; height:306px; border:1px solid var(--line); overflow:hidden; background:var(--paper2);}
  /* 配图占文字区右侧,用 mask 把图本体渐隐进纸底(无叠色层,看不到分界线);文字落在纯纸面上 */
  .cv-play .scene .art {position:absolute; left:430px; right:0; top:0; bottom:0;
    background:center/cover no-repeat url(assets/recon/play-scene.png); filter:brightness(.93) contrast(1.06) saturate(1.04);
    -webkit-mask-image:linear-gradient(90deg, transparent 0, rgba(0,0,0,.5) 180px, #000 360px);
    mask-image:linear-gradient(90deg, transparent 0, rgba(0,0,0,.5) 180px, #000 360px);}
  .cv-play .scene .round {position:absolute; left:24px; top:18px; display:flex; align-items:center; gap:9px;}
  .cv-play .scene .round i {width:14px; height:1px; background:var(--gold);}
  .cv-play .scene .round span {font-family:var(--serif); font-size:11px; letter-spacing:.14em; color:var(--soft);}
  .cv-play .scene .round b {font-family:var(--serifen); font-size:10px; letter-spacing:.16em; color:var(--gold); font-weight:600;}
  .cv-play .scene h2 {position:absolute; left:24px; top:44px; margin:0; font-family:var(--serif); font-weight:700; font-size:25px; letter-spacing:.06em; color:var(--ink); max-width:430px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-play .scene .sub {position:absolute; left:25px; top:80px; font-family:var(--kai); font-size:13px; letter-spacing:.04em; color:var(--soft);}
  .cv-play .scene .prose {position:absolute; left:25px; top:108px; bottom:16px; width:430px; overflow-y:auto; font-family:var(--kai); font-size:15px; line-height:1.95; color:#5b5346; margin:0;}
  .cv-play .scene .prose::-webkit-scrollbar {width:5px;} .cv-play .scene .prose::-webkit-scrollbar-thumb {background:var(--line2);}

  
  .cv-play .presence {margin-top:18px;}
  .cv-play .ph {display:flex; align-items:center; gap:10px;}
  .cv-play .ph b {font-family:var(--serif); font-size:14px; font-weight:700; letter-spacing:.12em; color:var(--ink);}
  .cv-play .ph .en {font-family:var(--serifen); font-size:8.5px; letter-spacing:.26em; color:var(--gold);}
  .cv-play .ph .ln {flex:1; height:1px; background:linear-gradient(90deg,var(--line2),transparent);}
  /* 名字/横杠/正文三列定宽,名字长短不影响横杠与正文起始位置 */
  .cv-play .prow {display:flex; align-items:center; gap:14px; padding:12px 4px; border-bottom:1px solid var(--line);}
  .cv-play .prow img {width:42px; height:42px; border-radius:50%; flex:none; object-fit:cover; border:1px solid var(--line2);}
  .cv-play .prow .nm {width:92px; flex:none; font-family:var(--serif); font-size:14px; font-weight:700; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-play .prow .dash {width:18px; height:1px; background:var(--line2); flex:none;}
  .cv-play .prow .ln-q {flex:1; min-width:0; font-family:var(--kai); font-size:15px; color:var(--soft); letter-spacing:.02em; line-height:1.8;}

  
  .cv-play .choices {margin-top:20px;}
  .cv-play .cgrid {display:flex; gap:11px; margin-top:13px;}
  .cv-play .ccard {flex:1; min-width:0; background:var(--paper3); border:1px solid var(--line); padding:14px 15px 11px; position:relative; cursor:pointer;
    display:flex; flex-direction:column;}
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
  .cv-play .ccard p {font-family:var(--kai); font-size:14px; line-height:1.7; color:var(--soft); margin:9px 0 0;}
  /* 行动/ask 分类行固定沉底,不随描述长短浮动 */
  .cv-play .ccard .cf {display:flex; align-items:center; justify-content:space-between; margin-top:auto; padding-top:9px; border-top:1px solid #ece2cf;}
  .cv-play .ccard .ch + p {margin-bottom:11px;}
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
  .cv-play .sceneinfo p {font-family:var(--kai); font-size:15px; color:var(--ink); margin:0;}
  .cv-play .sceneinfo p.amb {font-size:15px; color:var(--soft); margin-top:6px;}
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
  .cv-play .rel .r .nm {font-family:var(--serif); font-size:15px; color:var(--ink);}
  .cv-play .rel .r .ty {flex:1; font-family:var(--kai); font-size:15px; color:var(--faint);}
  .cv-play .rel .r .up {display:inline-flex; align-items:center; gap:1px; font-family:var(--serifen); font-size:11px; color:#5a7a55; font-weight:700;}
  .cv-play .rel .r .up svg {margin-left:0;}

  .cv-play .evs {margin-top:9px;}
  .cv-play .evs .r {display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid #ece2cf;}
  .cv-play .evs .r .bd {width:5px; height:5px; border-radius:50%; background:var(--gold); flex:none;}
  .cv-play .evs .r .tx {flex:1; font-family:var(--kai); font-size:15px; color:var(--soft);}
  .cv-play .evs .r .nw {font-family:var(--serifen); font-size:8px; letter-spacing:.1em; color:#b5402e; border:1px solid #d8a99e; padding:1px 4px;}

  .cv-play .rtabs {display:flex; gap:9px; margin-top:13px;}
  .cv-play .rtab {flex:1; min-width:0; display:flex; align-items:center; justify-content:center; gap:8px; height:42px; border:1px solid var(--line2); cursor:default; overflow:hidden;}
  .cv-play .rtab svg {color:var(--soft); flex:none;}
  .cv-play .rtab .tt {display:flex; flex-direction:column; align-items:flex-start; line-height:1; min-width:0;}
  .cv-play .rtab .zh {font-family:var(--serif); font-size:12.5px; color:var(--soft); white-space:nowrap;}
  .cv-play .rtab .en {font-family:var(--serifen); font-size:7px; letter-spacing:.14em; color:var(--faint); margin-top:3px; white-space:nowrap;}

  .cv-play .tips {position:relative; margin-top:14px; padding-top:13px; border-top:1px solid var(--line); min-height:118px;}
  .cv-play .tips .th {display:flex; align-items:center; gap:8px;}
  .cv-play .tips .th svg {color:var(--gold);}
  .cv-play .tips .th b {font-family:var(--serif); font-size:12px; font-weight:700; color:var(--soft); letter-spacing:.06em;}
  .cv-play .tips .th .en {font-family:var(--serifen); font-size:7.5px; letter-spacing:.2em; color:var(--faint);}
  .cv-play .tips p {font-family:var(--kai); font-size:15px; line-height:1.85; color:var(--soft); margin:9px 0 0;}
`}</style>

      {/* 左 引擎竖栏(全站统一 ReconRail;onNav 直连,logo 可回 landing) */}
      <window.ReconRail active="game" onNav={onNav}>
        <div className="pcard">
          <div className="ttl">玩家身份<span>PLAYER</span></div>
          <img className="por" src="assets/recon/play-player.png" alt="" />
          <div className="nm">{playerName}</div>
          <div className="lv">玩家</div>
        </div>
      </window.ReconRail>

      {/* 顶 面包屑(无功能图标已清:存档/回溯/重生成/✎/装饰底图) */}
      <div className="top">
        <div className="crumb">
          <span className="lb">当前故事</span>
          <span className="ti">《{story}》</span>
        </div>
        {/* 顶栏全部真实可用:故事记录(全量回看)/ 撤回上一轮(恢复 pre-turn 快照,零 LLM)/
            重生成(接 /api/reroll)/ 自动存档状态指示。SUPERVISOR/齿轮仍未实现 → 不摆。 */}
        <div className="topr">
          <div className={"titem" + (history.length ? "" : " dis")}
            title="回看这一局从头到现在的全部回合"
            onClick={() => history.length && setLogOpen(true)}>
            <span className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5 4h11l3 3v13H5z"/><path d="M9 9h8M9 13h8M9 17h5"/></svg></span>
            <span className="tt"><span className="zh">故事记录</span><span className="en">STORY LOG</span></span>
          </div>
          <div className={"titem" + (busy || !canUndo || !onUndo ? " dis" : "")}
            title="撤回上一轮:回到你输入之前,输入会回填供修改(只能撤最近一轮)"
            onClick={() => { if (!busy && canUndo && onUndo) onUndo(); }}>
            <span className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 9a8 8 0 1 1 1 5"/><path d="M4 4v5h5"/></svg></span>
            <span className="tt"><span className="zh">撤回上一轮</span><span className="en">UNDO TURN</span></span>
          </div>
          <div className={"titem" + (busy || !canReroll || !onReroll ? " dis" : "")}
            title="对上一回合不满意?丢弃它并用相同输入重新生成"
            onClick={() => { if (!busy && canReroll && onReroll) onReroll(); }}>
            <span className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20 11a8 8 0 1 0-1 5"/><path d="M20 4v5h-5"/></svg></span>
            <span className="tt"><span className="zh">{busy ? "生成中…" : "重生成上一轮"}</span><span className="en">REGENERATE</span></span>
          </div>
          <div className="tdiv"></div>
          <div className="ttime">
            <div className="lb">已自动存档 · 可随时离开</div>
            <div className="vl">{worldTime}</div>
          </div>
        </div>
      </div>

      {/* 中部主区 */}
      <div className="main">
        {/* 场景 */}
        <div className="scene">
          <div className="art" style={sceneArt ? { backgroundImage: "url(" + sceneArt + ")" } : undefined}></div>
          <div className="round"><span>当前回合</span><i></i><b>{round}</b>{busy && <span className="gen">叙事推演中<i>▋</i></span>}</div>
          <h2>{sceneTitle}</h2>
          <div className="sub">{sceneSub}</div>
          <p className="prose" key={round}>{narration}</p>
        </div>

        {/* 角色发言 */}
        <div className="presence">
          <div className="ph"><b>角色发言</b><span className="en">DIALOGUE</span><span className="ln"></span></div>
          {dialogues ? dialogues.map((d, i) => (
            <div className="prow" key={round + "-" + i} style={{ animationDelay: (i * 80) + "ms" }}><span className="avi">{ini(d.name)}</span><span className="nm" title={d.name}>{d.name}</span><span className="dash"></span><span className="ln-q">{d.text}</span></div>
          )) : (
            <div className="prow" style={{ borderBottom: "none" }}><span className="ln-q" style={{ color: "var(--faint)" }}>{busy ? "（角色正在回应……）" : "（本回合暂无角色发言）"}</span></div>
          )}
        </div>

        {/* 你的行动(点选项不直接发送:行动文本回填到下方自由行动输入框,玩家可改可直接执行) */}
        <div className="choices">
          <div className="ph"><b>你的行动</b><span className="en">CHOICES</span><span className="ln"></span></div>
          <div className="cgrid">
            {choices ? choices.slice(0, 4).map((c, i) => (
              <div className="ccard" key={round + "-" + i}
                onClick={() => { if (busy) return; const t = c.label || c.title || c.description || c.desc || ""; if (onChange) onChange(t); else onChoice(c); }}
                style={{ cursor: busy ? "default" : "pointer", animationDelay: (120 + i * 70) + "ms" }}>
                <div className="ch"><span className="ic">{choiceIcon(i)}</span><b>{c.label || c.title || ("选项 " + (i + 1))}</b></div>
                <p>{c.description || c.desc || ""}</p>
                <div className="cf"><span className="cat"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2-6.3-4.6L5.7 21 8 14.8 2 10.4h7.6z"/></svg>{c.intent || "行动"}</span></div>
              </div>
            )) : (
              <div className="ccard" style={{ flex: 1, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                <p style={{ margin: 0, color: "var(--faint)" }}>{busy ? "推荐选项生成中……" : "输入你的行动开始第一回合，推荐选项会在每回合后出现。"}</p>
              </div>
            )}
          </div>
        </div>

        {/* 一次性轻引导(替代已拆除的多步 coach):点破「选项只是建议」 */}
        {!hintGone && (
          <div className="freehint">
            <span>✦ 选项只是建议——你随时可以在下方说出自己的任何行动,故事会接住</span>
            <span className="x" onClick={dismissHint}>✕ 知道了</span>
          </div>
        )}

        {/* 自由行动 */}
        <div className="free">
          <div className="fl">
            <div className="fh"><b>自由行动</b><span className="en"></span></div>
            <input className="freein" value={value} disabled={busy}
              onChange={onChange ? (e) => onChange(e.target.value) : undefined}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !busy && !(e.nativeEvent || e).isComposing) { e.preventDefault(); onSubmit(); } }}
              placeholder="输入你的行动或台词，回车提交，故事据此推进……"
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

        {/* 「事实边界/记忆档案」两个 tab 功能未接通 → 隐藏,不带选中态假装可用;接通后恢复 */}

        <div className="tips">
          <div className="th"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z"/></svg><b>提示</b><span className="en">/ TIPS</span></div>
          <p>你可以选择推荐行动，或自由输入任何你想法，故事会因你而改变。</p>
        </div>
      </div>

      {/* 故事记录抽屉:全量回合流回看(点遮罩或 ✕ 关闭) */}
      {logOpen && (
        <div className="logwrap" onClick={(e) => { if (e.target.classList && e.target.classList.contains("logwrap")) setLogOpen(false); }}>
          <div className="logpanel">
            <div className="loghead">
              <b>故事记录</b><span className="en">STORY LOG</span>
              <span className="cnt">{history.filter((t) => t.kind === "story").length} 回合</span>
              <span className="x" onClick={() => setLogOpen(false)}>✕</span>
            </div>
            <div className="logbody" ref={logRef}>
              {(() => {
                let n = 0;
                return history.map((t, i) => {
                  if (t.kind === "player") return <div className="lg-me" key={i}><span>你</span>{t.text}</div>;
                  n++;
                  const d = t.data || {};
                  return (
                    <div className="lg-turn" key={i}>
                      <div className="lg-rd">ROUND {String(n).padStart(2, "0")}</div>
                      {d.narration && <p className="lg-nar">{d.narration}</p>}
                      {(d.messages || []).map((m, j) => (
                        <div className="lg-line" key={j}><b>{m.name || m.character_id || "?"}</b><span>{m.text}</span></div>
                      ))}
                      {(d.triggered_events || []).length > 0 && (
                        <div className="lg-ev">触发事件:{d.triggered_events.join("、")}</div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
window.ReconPlay = ReconPlay;
