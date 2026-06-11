// ReconStoryDetail — data-driven 故事详情 / 选主角 / 入戏仪式
// React/ReactDOM are global (window.React). Standalone-renderable.
// 契约 props: { preset, onNav(view), onEnter(roleOrNull), onClose() }
//   preset.data: { name, synopsis, tags:[], author, cover, characters:[{data:{name,persona,description}}],
//                  story:{title,premise}, world, playables:[{name,persona}] }
// 无 preset(测试页)时回退一份极简 sample,只为不白屏。
const { useState } = React;

// 极简回退:测试页 / 无 props 时用。不再是写死的整本《雨夜档案》,只够撑起版式。
const RECON_STORY_DETAIL_FALLBACK = {
  data: {
    name: "示例故事",
    synopsis: "这是一个示例故事的简介，用于在没有真实数据时占位。",
    tags: ["示例"],
    author: "",
    cover: "",
    characters: [
      { data: { name: "角色甲", persona: "示例角色之一", description: "" } },
      { data: { name: "角色乙", persona: "示例角色之二", description: "" } },
    ],
    story: { title: "示例故事", premise: "一个等你走进的示例故事。" },
    world: "",
    playables: [],
  },
};

const RECON_STORY_DETAIL_CSS = `
  .cv-story {
    --bg:#f3ece0; --paper:#faf4ea; --paper2:#f6efe2;
    --ink:#2c2820; --soft:#6f6757; --faint:#9a907a;
    --line:#ddd0b4; --line2:#c4b388;
    --gold:#a98a63; --gold2:#c1a86f;
    --navy:#163b57; --navy-deep:#0d2f49; --navy-line:#b99a59;
    --green:#34463d;
    --serif:"Songti SC","STSong","SimSun",serif;
    --serifen:Georgia,"Times New Roman",serif;
    --kai:"Kaiti SC","STKaiti","KaiTi",serif;
  }
  .cv-story * {box-sizing:border-box;}
  .cv-story {
    position:relative; width:100%; min-height:100vh;
    background:
      repeating-linear-gradient(90deg, rgba(169,138,99,.026) 0 1px, transparent 1px 46px),
      var(--bg);
    color:var(--ink); font-family:var(--kai);
  }

  
  /* 竖栏固定;中间内容流式(随页滚动);右侧入戏仪式栏 absolute 拉通到页底 */
  .cv-story .cv-rail {position:fixed;}
  .cv-story .mid {position:relative; margin:0 382px 0 216px; padding:118px 38px 60px 34px; z-index:4; min-width:0;}
  .cv-story .row1 {display:flex; gap:36px; align-items:flex-start;}
  .cv-story .bookcol {flex:none; width:236px; position:relative; padding-top:14px;}
  .cv-story .headcol {flex:1; min-width:0;}
  .cv-story .row2 {margin-top:6px;}
  /* 顶栏固定:滚动时与右栏入戏仪式一起钉在视口 */
  .cv-story .nav {position:fixed; left:0; right:0; top:0; height:88px; z-index:28;
    background:repeating-linear-gradient(90deg, rgba(169,138,99,.026) 0 1px, transparent 1px 46px), var(--bg);}
  .cv-story .nav::after {content:""; position:absolute; left:240px; right:30px; bottom:0; height:1px;
    background:linear-gradient(90deg,transparent,var(--line2) 6%,var(--line2) 94%,transparent);}
  .cv-story .brand {position:absolute; left:18px; top:16px; display:flex; align-items:center; gap:12px;}
  .cv-story .brand .em {width:46px; height:46px; object-fit:contain;}
  .cv-story .brand h1 {margin:0; font-family:var(--serifen); font-weight:600; font-size:16px; letter-spacing:.05em; color:#4a4636; font-variant:small-caps; white-space:nowrap;}
  .cv-story .brand .sub {font-family:var(--kai); font-size:10px; letter-spacing:.34em; color:var(--faint); margin-top:4px;}

  
  .cv-story .navsep {position:absolute; left:258px; top:24px; width:1px; height:40px;
    background:linear-gradient(180deg,transparent,var(--line2),transparent); z-index:31;}

  
  .cv-story .ptitle {position:absolute; left:290px; top:22px;}
  .cv-story .ptitle .h {display:flex; align-items:baseline; gap:13px;}
  .cv-story .ptitle .zh {font-family:var(--serif); font-size:26px; font-weight:700; letter-spacing:.06em; color:var(--ink);}
  .cv-story .ptitle .en {font-family:var(--serifen); font-size:13px; letter-spacing:.34em; color:var(--faint);}
  .cv-story .ptitle .sub {font-family:var(--kai); font-size:13px; letter-spacing:.16em; color:var(--soft); margin-top:7px;}

  
  .cv-story .nr {position:absolute; right:30px; top:14px; display:flex; align-items:center; gap:24px;}
  .cv-story .nr .wt {text-align:right;}
  .cv-story .nr .wt .lab {font-size:9px; letter-spacing:.18em; color:var(--faint);}
  .cv-story .nr .wt .lab .zh {font-family:var(--kai);}
  .cv-story .nr .wt .lab .en {font-family:var(--serifen); letter-spacing:.24em; margin-left:5px;}
  .cv-story .nr .wt .val {font-family:var(--serifen); font-size:17px; font-weight:600; color:var(--ink); margin-top:2px; letter-spacing:.05em;}
  .cv-story .nr .wx {display:flex; align-items:center; gap:9px;}
  .cv-story .nr .wx .wtxt .zh {font-family:var(--serif); font-size:14px; color:var(--soft); letter-spacing:.06em;}
  .cv-story .nr .wx .wtxt .en {font-family:var(--serifen); font-size:8px; letter-spacing:.28em; color:var(--faint); margin-top:2px;}
  .cv-story .nr .ic {color:var(--soft);}
  .cv-story .nr .av {width:42px; height:42px; border-radius:50%; object-fit:cover; border:1px solid var(--line2);}

  
  .cv-story .lnav {position:absolute; left:0; top:88px; bottom:0; width:130px; z-index:20;
    border-right:1px solid var(--line2);
    background:linear-gradient(180deg, rgba(250,244,234,.5), rgba(243,236,224,.2));}
  .cv-story .lnav .compassbg {position:absolute; left:30px; top:300px; width:120px; height:120px; opacity:.10;
    background:center/contain no-repeat url(assets/recon/story-detail-emblem.png);}
  .cv-story .litem {position:absolute; left:0; right:0; height:62px; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:5px; text-decoration:none; cursor:pointer;}
  .cv-story .litem .ic {color:var(--gold); height:24px; display:grid; place-items:center;}
  .cv-story .litem .zh {font-family:var(--serif); font-size:13px; letter-spacing:.1em; color:var(--soft);}
  .cv-story .litem .en {font-family:var(--serifen); font-size:7px; letter-spacing:.2em; color:var(--faint);}
  .cv-story .litem.on {background:linear-gradient(180deg,#3a4d42,#2d3e35); box-shadow:inset 0 0 0 1px rgba(193,168,111,.4);}
  .cv-story .litem.on .ic {color:#d8c79a;}
  .cv-story .litem.on .zh {color:#f0e8d4; font-weight:700;}
  .cv-story .litem.on .en {color:rgba(216,199,154,.8);}
  .cv-story .botanical {position:absolute; left:0; top:560px; width:118px; height:170px; z-index:21;
    background:center/contain no-repeat url(assets/recon/story-detail-botanical.png);}
  .cv-story .navtag {position:absolute; left:10px; right:10px; bottom:26px; text-align:center; z-index:22;}
  .cv-story .navtag p {margin:0; font-family:var(--kai); font-size:10px; line-height:1.7; color:var(--soft);}
  .cv-story .navtag .en {font-family:var(--serifen); font-size:8px; letter-spacing:.18em; color:var(--gold); margin-top:8px;}

  
  /* 翻开一本书:各块轻错峰淡入(每次打开详情都重挂载,动画自然重播) */
  @keyframes rcs-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
  .cv-story .book, .cv-story .booktab { animation: rcs-in .42s cubic-bezier(.22,1,.36,1) both; }
  .cv-story .stitle { animation: rcs-in .42s cubic-bezier(.22,1,.36,1) .06s both; }
  .cv-story .intro { animation: rcs-in .4s cubic-bezier(.22,1,.36,1) .14s both; }
  .cv-story .bg, .cv-story .chars { animation: rcs-in .4s cubic-bezier(.22,1,.36,1) .2s both; }
  .cv-story .pickh, .cv-story .cards { animation: rcs-in .4s cubic-bezier(.22,1,.36,1) .26s both; }
  .cv-story .ritual { animation: rcs-in .44s cubic-bezier(.22,1,.36,1) .32s both; }
  @media (prefers-reduced-motion: reduce){ .cv-story .book, .cv-story .booktab, .cv-story .stitle, .cv-story .intro, .cv-story .bg, .cv-story .chars, .cv-story .pickh, .cv-story .cards, .cv-story .ritual { animation-duration:1ms; animation-delay:0ms; } }
  /* 书封:只用库里真实 cover(.book img);没有 cover = 中性书封(纸底+竖排书名),不放假书图 */
  .cv-story .book {position:relative; width:236px; height:300px; z-index:4;
    border:1px solid var(--line2); background:linear-gradient(165deg,#efe6d2,#ddd0b2);
    box-shadow:6px 8px 0 rgba(43,38,32,.10); overflow:hidden;}
  .cv-story .book::after {content:""; position:absolute; inset:8px; border:1px solid rgba(169,138,99,.38); pointer-events:none;}
  .cv-story .book img {width:100%; height:100%; object-fit:cover; display:block;}
  .cv-story .book .bt {position:absolute; inset:0; display:grid; place-items:center;}
  .cv-story .book .bt b {writing-mode:vertical-rl; font-family:var(--serif); letter-spacing:.24em; color:var(--gold); font-weight:700;
    max-height:240px; line-height:1.7;}
  .cv-story .booktab {position:absolute; left:-16px; top:32px; width:84px; height:36px; z-index:5;
    background:linear-gradient(180deg,#3a4d42,#2d3e35); border:1px solid rgba(193,168,111,.5);
    display:flex; flex-direction:column; align-items:center; justify-content:center;}
  .cv-story .booktab .zh {font-family:var(--serif); font-size:11px; color:#e9dcbf; letter-spacing:.08em;}
  .cv-story .booktab .en {font-family:var(--serifen); font-size:6.5px; letter-spacing:.16em; color:rgba(216,199,154,.75); margin-top:1px;}

  
  .cv-story .intro {margin-top:28px; max-width:620px;}
  .cv-story .blkh {display:flex; align-items:baseline; gap:9px;}
  .cv-story .blkh b {font-family:var(--serif); font-size:16px; font-weight:700; letter-spacing:.1em; color:var(--ink);}
  .cv-story .blkh .en {font-family:var(--serifen); font-size:9px; letter-spacing:.26em; color:var(--gold);}
  .cv-story .intro p {font-family:var(--kai); font-size:15px; line-height:1.95; color:var(--soft); margin:12px 0 0;}

  
  .cv-story .stitle {padding-top:8px;}
  .cv-story .stitle h2 {margin:0; font-family:var(--serif); font-size:34px; font-weight:700; letter-spacing:.05em; color:var(--ink);}
  .cv-story .stitle .en {font-family:var(--serifen); font-size:16px; letter-spacing:.32em; color:var(--faint); margin-top:7px;}
  .cv-story .stitle .tags {display:flex; gap:24px; margin-top:16px; font-family:var(--kai); font-size:13px; color:var(--soft); letter-spacing:.06em;}
  .cv-story .stitle .tags span {position:relative;}
  .cv-story .stitle .tags span:not(:last-child)::after {content:"·"; position:absolute; right:-15px; color:var(--line2);}
  .cv-story .stitle .meta {display:flex; gap:26px; margin-top:14px; font-family:var(--kai); font-size:12px; color:var(--faint); letter-spacing:.04em;}
  .cv-story .stitle .meta span {position:relative;}
  .cv-story .stitle .meta span:not(:last-child)::after {content:"·"; position:absolute; right:-16px; color:var(--line2);}
  .cv-story .stitle .meta b {color:var(--soft); font-weight:400;}

  
  /* 背景:前情 + 世界设定公开条目(老 Netflix 详情卡的内容版式,平铺进页面) */
  .cv-story .bg {margin-top:34px; max-width:1000px; min-width:0;}
  .cv-story .bgblock {margin-top:16px;}
  .cv-story .bgsub {font-family:var(--serif); font-size:13.5px; font-weight:700; letter-spacing:.1em; color:var(--gold);}
  .cv-story .bgblock p {font-family:var(--kai); font-size:15px; line-height:1.9; color:var(--soft); margin:7px 0 0;
    display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden;}
  .cv-story .bgblock.lead p {-webkit-line-clamp:8;}
  /* 角色:翻转卡横排(正面 名+外貌+性格 公开层,背面 角色图;只收有展示内容的角色) */
  .cv-story .chars {margin-top:34px; min-width:0;}
  .cv-story .chars ul {list-style:none; margin:14px 0 0; padding:0;}
  .cv-story .chars li {font-family:var(--kai); font-size:15px; line-height:1.7; color:var(--soft); margin-bottom:13px; padding-left:16px; position:relative;}
  .cv-story .chars li::before {content:""; position:absolute; left:0; top:8px; width:5px; height:5px; border-radius:50%; background:var(--gold);}
  .cv-story .chars p {font-family:var(--kai); font-size:15px; line-height:1.95; color:var(--soft); margin:14px 0 0;}
  /* 横排不出滚动条,改 Netflix 式两侧箭头(老 Carousel);两侧留箭头槽,不压卡片 */
  .cv-story .rowwrap {position:relative; margin-top:16px; padding:0 48px;}
  .cv-story .rowwrap .chrow, .cv-story .rowwrap .cards {margin-top:0;}
  .cv-story .rarrow {position:absolute; top:50%; transform:translateY(-50%); width:34px; height:34px; border:1px solid var(--line2); border-radius:50%;
    display:grid; place-items:center; color:var(--soft); background:var(--paper); z-index:5; cursor:pointer; font-size:16px; user-select:none;}
  .cv-story .rarrow:hover {color:var(--ink); border-color:var(--gold2);}
  .cv-story .rarrow.l {left:0;} .cv-story .rarrow.r {right:0;}
  /* 圆柱感:行两侧渐隐(卡片滑进滑出像从滚筒边缘转进来) */
  .cv-story .cyl {-webkit-mask-image:linear-gradient(90deg, transparent 0, #000 70px, #000 calc(100% - 70px), transparent 100%);
    mask-image:linear-gradient(90deg, transparent 0, #000 70px, #000 calc(100% - 70px), transparent 100%);}
  /* 页码小圆点(老 Carousel):当前卡实心金,可点击直达。
     hover 只放大不变色——金色描边在 8px 小点上看起来像实心,会误读成"旧点没熄" */
  .cv-story .rdots {display:flex; justify-content:center; gap:9px; margin-top:13px;}
  .cv-story .rdot {width:8px; height:8px; border-radius:50%; border:1px solid var(--line2); background:transparent; cursor:pointer; transition:transform .15s;}
  .cv-story .rdot:hover {transform:scale(1.35);}
  .cv-story .rdot.on {background:var(--gold); border-color:var(--gold);}
  .cv-story .chrow {display:flex; gap:14px; margin-top:16px; overflow-x:auto; overflow-y:hidden; padding-bottom:4px; scrollbar-width:none;}
  .cv-story .chrow::-webkit-scrollbar {display:none;}
  .cv-story .fchar {flex:none; width:244px; height:300px; position:relative; perspective:900px;}
  .cv-story .fchar .fin {position:absolute; inset:0; transform-style:preserve-3d; transition:transform .45s cubic-bezier(.3,.8,.3,1);}
  .cv-story .fchar.flip .fin {transform:rotateY(180deg);}
  .cv-story .fchar .ff, .cv-story .fchar .fb {position:absolute; inset:0; -webkit-backface-visibility:hidden; backface-visibility:hidden;
    background:var(--paper); border:1px solid var(--line);}
  .cv-story .fchar .ff {padding:16px 16px 14px; display:flex; flex-direction:column;}
  .cv-story .fchar .ff::after {content:""; position:absolute; inset:5px; border:1px solid rgba(196,179,132,.3); pointer-events:none;}
  .cv-story .fchar .fnm {font-family:var(--serif); font-size:17px; font-weight:700; color:var(--ink); letter-spacing:.04em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-story .fchar .fscroll {flex:1; overflow-y:auto; margin-top:6px; padding-right:5px; min-height:0;}
  .cv-story .fchar .fscroll::-webkit-scrollbar {width:5px;} .cv-story .fchar .fscroll::-webkit-scrollbar-thumb {background:var(--line2);}
  .cv-story .fchar .fsub {font-family:var(--serif); font-size:12px; font-weight:700; letter-spacing:.1em; color:var(--gold); margin-top:10px;}
  .cv-story .fchar .fscroll p {font-family:var(--kai); font-size:13.5px; line-height:1.8; color:var(--soft); margin:4px 0 0;}
  .cv-story .fchar .fb {transform:rotateY(180deg); overflow:hidden; display:grid; place-items:center; cursor:pointer;}
  .cv-story .fchar .fb img {width:100%; height:100%; object-fit:cover; display:block;}
  .cv-story .fchar .fb .noimg {font-family:var(--kai); font-size:13px; color:var(--faint); letter-spacing:.08em;}
  .cv-story .fbtn {position:absolute; right:9px; bottom:9px; width:30px; height:30px; border-radius:50%; border:1px solid var(--line2);
    background:rgba(250,244,234,.92); color:var(--soft); display:grid; place-items:center; cursor:pointer; min-height:0; padding:0; font-size:14px; line-height:1; z-index:3;}
  .cv-story .fbtn:hover {background:rgba(193,168,111,.25); color:var(--ink);}
  .cv-story .fchar .fb .fbtn {background:rgba(34,29,22,.45); color:#f0e8d4; border-color:rgba(240,232,212,.55);}

  
  .cv-story .pickh {display:flex; align-items:center; gap:12px; margin-top:38px;}
  .cv-story .pickh .star {color:var(--gold); display:grid; place-items:center;}
  .cv-story .pickh b {font-family:var(--serif); font-size:17px; font-weight:700; letter-spacing:.12em; color:var(--ink);}
  .cv-story .pickh .en {font-family:var(--serifen); font-size:10px; letter-spacing:.3em; color:var(--gold);}
  .cv-story .pickh .dash {width:90px; height:1px; background:repeating-linear-gradient(90deg,var(--line2) 0 6px,transparent 6px 12px);}

  .cv-story .cards {margin-top:16px; display:flex; gap:12px; overflow-x:auto; overflow-y:hidden; padding-bottom:4px; scrollbar-width:none;}
  .cv-story .cards::-webkit-scrollbar {display:none;}
  /* 选角:老 Netflix 出演卡(文本卡:名 + 一句设定;点选联动右栏入戏仪式) */
  .cv-story .castcard {flex:none; width:212px; background:var(--paper); border:1px solid var(--line); padding:20px 16px 13px;
    text-align:center; cursor:pointer; position:relative; display:flex; flex-direction:column;}
  .cv-story .castcard::after {content:""; position:absolute; inset:5px; border:1px solid rgba(196,179,132,.3); pointer-events:none;}
  .cv-story .castcard.sel {border-color:var(--gold2); box-shadow:inset 0 0 0 1px rgba(193,168,111,.45), 0 2px 10px rgba(169,138,99,.12);}
  .cv-story .castcard b {display:block; font-family:var(--serif); font-size:17px; font-weight:700; color:var(--ink); letter-spacing:.04em;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-story .castcard .crole {font-family:var(--kai); font-size:13px; line-height:1.7; color:var(--soft); margin-top:8px; min-height:44px;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
  .cv-story .castcard .act {display:flex; align-items:center; justify-content:center; gap:5px; margin-top:auto; padding-top:10px;
    border-top:1px solid #ece2cf; font-family:var(--serif); font-size:12px; letter-spacing:.14em; color:var(--green);}
  .cv-story .castcard.sel .act {color:var(--gold);}
  .cv-story .castcard .act svg {color:currentColor;}
  /* 自定义角色面板(识别成演出卡进入,公开层同老 modal) */
  .cv-story .custompanel {margin-top:14px; max-width:760px; background:var(--paper); border:1px solid var(--line); padding:16px 18px; position:relative;}
  .cv-story .custompanel::before {content:""; position:absolute; inset:5px; border:1px solid rgba(196,179,132,.3); pointer-events:none;}
  .cv-story .custompanel .cs-sub {font-family:var(--kai); font-size:13.5px; line-height:1.8; color:var(--soft); margin:0; position:relative;}
  .cv-story .custompanel textarea {width:100%; min-height:108px; margin-top:10px; border:1px solid var(--line2); background:var(--paper2);
    color:var(--ink); font-family:var(--kai); font-size:14px; line-height:1.8; padding:10px 12px; outline:none; resize:vertical; border-radius:0; position:relative; box-shadow:none;}
  .cv-story .custompanel .csrow {display:flex; align-items:center; gap:10px; margin-top:12px; position:relative;}
  .cv-story .cbtn {height:34px; padding:0 16px; display:inline-flex; align-items:center; border:1px solid var(--navy-line); background:transparent;
    color:var(--navy); font-family:var(--serif); font-size:13px; letter-spacing:.08em; cursor:pointer; border-radius:0; min-height:0;}
  .cv-story .cbtn:hover:not(:disabled) {background:rgba(185,154,89,.12); color:var(--navy);}
  .cv-story .cbtn.pri {background:var(--green); color:#eef0e2; border-color:#283831;}
  .cv-story .cbtn.pri:hover:not(:disabled) {background:#2c3a32; color:#eef0e2;}
  .cv-story .cbtn:disabled {opacity:.55; cursor:default;}

  
  .cv-story .opscene {position:absolute; left:250px; top:855px; width:660px; z-index:4;}
  .cv-story .opscene .oh {display:flex; align-items:center; gap:11px;}
  .cv-story .opscene .oh .star {color:var(--gold); display:grid; place-items:center;}
  .cv-story .opscene .oh b {font-family:var(--serif); font-size:15px; font-weight:700; letter-spacing:.1em; color:var(--ink);}
  .cv-story .opscene .oh .en {font-family:var(--serifen); font-size:9px; letter-spacing:.28em; color:var(--gold);}
  .cv-story .opscene .body {display:flex; gap:16px; margin-top:11px;}
  .cv-story .opscene .thumb {flex:none; width:104px; height:62px; object-fit:cover; border:1px solid var(--line2);}
  .cv-story .opscene .txt p {margin:0 0 5px; font-family:var(--kai); font-size:12px; line-height:1.7; color:var(--soft); letter-spacing:.02em;}

  
  /* 入戏仪式:固定在视口右侧不随页面滚走;内部流式,入局按钮紧贴角色信息成一个整体 */
  .cv-story .ritual {position:fixed; right:0; top:88px; bottom:0; width:382px; z-index:10;
    border-left:1px solid var(--line2);
    background:linear-gradient(180deg, rgba(250,244,234,.55), rgba(246,239,226,.3));
    display:flex; flex-direction:column; padding:24px 30px 26px; overflow-y:auto;}
  .cv-story .ritual::-webkit-scrollbar {width:6px;} .cv-story .ritual::-webkit-scrollbar-thumb {background:var(--line2);}
  .cv-story .rh {display:flex; align-items:center; gap:9px; flex:none;}
  .cv-story .rh .star {color:var(--gold); display:grid; place-items:center;}
  .cv-story .rh b {font-family:var(--serif); font-size:17px; font-weight:700; letter-spacing:.14em; color:var(--ink);}
  .cv-story .rh .sep {color:var(--line2); font-family:var(--serifen); font-size:14px; margin:0 1px;}
  .cv-story .rh .en {font-family:var(--serifen); font-size:10px; letter-spacing:.3em; color:var(--faint);}
  /* 入戏仪式立绘:角色无真立绘 → 中性大首字块(不放固定假立绘) */
  .cv-story .rart {height:228px; flex:none; margin-top:18px;
    background:linear-gradient(170deg,#efe6d2,#dccfb1); display:grid; place-items:center;}
  .cv-story .rart::after {content:attr(data-ini); font-family:var(--serif); font-size:88px; color:var(--gold); font-weight:700;}
  .cv-story .rname {text-align:center; flex:none; margin-top:14px;}
  .cv-story .rname h3 {margin:0; font-family:var(--serif); font-size:25px; font-weight:700; letter-spacing:.06em; color:var(--ink);}
  .cv-story .rname .role {font-family:var(--kai); font-size:13px; color:var(--soft); letter-spacing:.08em; margin-top:7px; padding:0 26px;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}

  .cv-story .attrs {flex:none; margin-top:10px;}
  .cv-story .attr {display:flex; align-items:flex-start; gap:14px; padding:9px 0; border-top:1px solid var(--line);}
  .cv-story .attr:first-child {border-top:none;}
  .cv-story .attr .lab {flex:none; width:58px; font-family:var(--serif); font-size:12px; color:var(--gold); letter-spacing:.1em; margin-top:2px;}
  .cv-story .attr .v {flex:1; font-family:var(--kai); font-size:15px; line-height:1.6; color:var(--ink); letter-spacing:.02em;}
  .cv-story .attr.mono .v {font-style:italic; color:var(--soft);}
  .cv-story .wave {display:inline-flex; align-items:center; gap:14px; margin-top:7px;}
  .cv-story .wave svg {color:var(--line2);}
  .cv-story .wave .spk {color:var(--gold);}

  
  .cv-story .enter {position:relative; flex:none; margin-top:18px; height:94px;
    background:linear-gradient(180deg,#3c4f44,#2c3c33); border:1px solid var(--navy-line);
    display:flex; flex-direction:column; align-items:center; justify-content:center; cursor:pointer;}
  .cv-story .enter::before {content:""; position:absolute; inset:5px; border:1px solid rgba(193,168,111,.5);}
  .cv-story .enter .cn {position:absolute; width:7px; height:7px; border:1px solid var(--gold2);}
  .cv-story .enter .cn.tl {left:9px; top:9px; border-right:none; border-bottom:none;}
  .cv-story .enter .cn.tr {right:9px; top:9px; border-left:none; border-bottom:none;}
  .cv-story .enter .cn.bl {left:9px; bottom:9px; border-right:none; border-top:none;}
  .cv-story .enter .cn.br {right:9px; bottom:9px; border-left:none; border-top:none;}
  .cv-story .enter .zh {font-family:var(--serif); font-size:23px; font-weight:700; letter-spacing:.22em; color:#f0e8d4; position:relative;}
  .cv-story .enter .en {font-family:var(--serifen); font-size:10px; letter-spacing:.34em; color:rgba(216,199,154,.85); margin-top:6px; position:relative;}
  .cv-story .enter .sub {font-family:var(--serifen); font-size:8px; letter-spacing:.28em; color:rgba(216,199,154,.55); margin-top:5px; position:relative;}
`;

const StarIcon = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
  </svg>
);

// 把后端角色卡 / playable 归一成卡片需要的形状。
function _normRole(x) {
  const d = (x && x.data) || x || {};
  return {
    name: d.name || x.name || "",
    persona: d.persona || "",
    description: d.description || "",
  };
}

// 横排轮播(无缝循环 + 圆柱感):一张卡一个圆点,箭头一次切一张;
// 卡片渲染两份(A/B 两组),滑进 B 组后无感瞬移回 A 组等价位置——最后一张的"下一张"是接着滑出来的第一张,
// 不倒带回开头。两侧渐隐 mask 由 CSS 实现。圆点可点击直达;手动拖动停稳后同步。
function RxCarousel({ rowClass, children }) {
  const ref = React.useRef(null);
  const [cur, setCur] = useState(0);
  const phys = React.useRef(0);       // 物理卡位(0..2n-1;落定后归一回 0..n-1)
  const sup = React.useRef(0);        // 编程滚动期间屏蔽手动回读
  const settleT = React.useRef(null);
  const n = React.Children.count(children);
  const setWidth = (el) => { const its = [...el.children]; return its.length >= n + 1 ? its[n].offsetLeft - its[0].offsetLeft : 0; };
  // 无感归一:位置在 B 组(>=n)时,瞬移回 A 组等价位置(视觉完全相同)
  const normalize = (el) => {
    const w = setWidth(el); if (!w) return;
    while (phys.current >= n) { el.scrollTo({ left: el.scrollLeft - w, behavior: "instant" }); phys.current -= n; }
    while (phys.current < 0) { el.scrollTo({ left: el.scrollLeft + w, behavior: "instant" }); phys.current += n; }
  };
  // 自绘 rAF 缓动(不用原生 smooth:连发时浏览器滚动动画器会进坏状态);终点兜底含后台标签
  const animT = React.useRef(null);
  const animEndT = React.useRef(null);
  // 整组卡放得下容器时不开轮播:无缝循环预期"卡行溢出",不溢出时克隆组同屏可见、
  // 步进被边界 clamp(圆点在走画面不动)、瞬移让点的和看的不是同一实例——机制整个失效。
  const [fits, setFits] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => {
      const its = [...el.children];
      if (!its.length) return;
      const last = its[Math.min(n, its.length) - 1];   // 前 n 个 = 单组(静态时即全部)
      const w = last.offsetLeft + last.offsetWidth - its[0].offsetLeft;
      setFits(w <= el.clientWidth + 1);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [n]);
  // 卡 ≤3 或整组放得下 → 静态排开:无箭头/圆点/渐隐/克隆。(放在全部 hooks 之后,顺序稳定)
  if (n <= 3 || fits) {
    return (
      <div className="rowwrap">
        <div className={rowClass} ref={ref}>{children}</div>
      </div>
    );
  }
  const stopAnim = () => { if (animT.current) cancelAnimationFrame(animT.current); if (animEndT.current) clearTimeout(animEndT.current); };
  const animateTo = (el, target, onDone) => {
    const start = el.scrollLeft, dist = target - start, t0 = performance.now(), dur = 320;
    const finish = () => { el.scrollTo({ left: target, behavior: "instant" }); if (onDone) onDone(); };
    if (Math.abs(dist) < 1) { finish(); return; }
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      el.scrollTo({ left: start + dist * ease, behavior: "instant" });
      if (p < 1) animT.current = requestAnimationFrame(tick);
    };
    animT.current = requestAnimationFrame(tick);
    animEndT.current = setTimeout(() => { const e2 = ref.current; if (e2) finish(); }, dur + 130);
  };
  const goto = (i) => {
    const el = ref.current; if (!el || !n) return;
    stopAnim();
    normalize(el);                     // 先把物理位归一到 A 组,再算这次的目标
    let pt = i;                        // 目标物理位:箭头传 phys±1(可为 -1 或 n,踩进克隆区造成"连续滑出"错觉)
    if (pt < 0) {                      // 从第一张往左:先无感瞬移到 B 组等价位,再往回滑
      const w = setWidth(el); if (!w) return;
      el.scrollTo({ left: el.scrollLeft + w, behavior: "instant" });
      phys.current += n; pt += n;
    }
    const its = [...el.children];
    if (!its[pt]) return;
    const target = Math.min(its[pt].offsetLeft - its[0].offsetLeft, Math.max(0, el.scrollWidth - el.clientWidth));
    sup.current = Date.now() + 900;
    phys.current = pt; setCur(((pt % n) + n) % n);
    animateTo(el, target, () => normalize(el));
  };
  // 手动拖动:停稳 140ms 后按「最近的物理卡」同步并归一
  const onScroll = () => {
    if (settleT.current) clearTimeout(settleT.current);
    settleT.current = setTimeout(() => {
      const el = ref.current; if (!el || Date.now() < sup.current) return;
      const its = [...el.children]; if (!its.length) return;
      const base = its[0].offsetLeft, sl = el.scrollLeft;
      let best = 0, bd = Infinity;
      its.forEach((it, i) => { const d = Math.abs((it.offsetLeft - base) - sl); if (d < bd) { bd = d; best = i; } });
      phys.current = best; normalize(el); setCur(((phys.current % n) + n) % n);
    }, 140);
  };
  return (
    <div className="rowwrap">
      <div className="rarrow l" onClick={() => goto(phys.current - 1)}>‹</div>
      <div className="rarrow r" onClick={() => goto(phys.current + 1)}>›</div>
      <div className={rowClass + " cyl"} ref={ref} onScroll={onScroll}>
        <React.Fragment key="set-a">{children}</React.Fragment>
        <React.Fragment key="set-b">{children}</React.Fragment>
      </div>
      {n > 1 && (
        <div className="rdots">
          {Array.from({ length: n }, (_, i) => (
            <span key={i} className={"rdot" + (i === cur ? " on" : "")} onClick={() => goto(i)}></span>
          ))}
        </div>
      )}
    </div>
  );
}

// 角色翻转卡(老 Netflix 详情卡的 PublicChar,平铺进页面):正面只渲染公开层——名/外貌/性格;
// known_hidden、versions、tension、scenario、first_mes 一律不进(剧透边界硬约束)。背面角色图。
function RxStoryFlipChar({ c }) {
  const cd = (c && c.data) || c || {};
  const [flip, setFlip] = useState(false);
  return (
    <div className={"fchar" + (flip ? " flip" : "")}>
      <div className="fin">
        <div className="ff">
          <b className="fnm">{cd.name || "角色"}</b>
          <div className="fscroll">
            {cd.look ? <React.Fragment><div className="fsub">外貌</div><p>{cd.look}</p></React.Fragment> : null}
            {cd.personality ? <React.Fragment><div className="fsub">性格</div><p>{cd.personality}</p></React.Fragment> : null}
          </div>
          <button className="fbtn" title="翻面看角色图" onClick={() => setFlip(true)}>↻</button>
        </div>
        <div className="fb" onClick={() => setFlip(false)}>
          {cd.image
            ? <img src={cd.image} alt={cd.name || "角色"} />
            : <div className="noimg">暂无角色图</div>}
          <button className="fbtn" title="翻回设定" onClick={(e) => { e.stopPropagation(); setFlip(false); }}>↺</button>
        </div>
      </div>
    </div>
  );
}

function ReconStoryDetail(props) {
  const P = props || {};
  const onNav = P.onNav || (() => {});
  const onEnter = P.onEnter || (() => {});
  const onClose = P.onClose || (() => {});

  // 真实 preset 优先;无 preset(测试页)回退极简 sample。
  const preset = P.preset || RECON_STORY_DETAIL_FALLBACK;
  const pdata = preset.data || {};

  // 书名 / 简介 / 标签 / 作者 / 背景 —— 全部读真实数据,缺省中性兜底。
  const bookName = pdata.name || preset.name || "未命名故事";
  const story = pdata.story || {};
  const synopsis = pdata.synopsis || story.premise || "";
  const tags = pdata.tags || [];
  const author = pdata.author || "";
  // 背景(老 modal「故事背景」tab 的内容版式):前情 + 世界设定公开条目(只露最核心几条,不抖全世界书)。
  const premise = story.premise || "";
  const worldEntries = (() => {
    const w = pdata.world;
    if (!w) return [];
    if (Array.isArray(w.entries)) return w.entries.filter((e) => e && (e.visibility || "public") === "public").slice(0, 3);
    if (typeof w === "string") return w.split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 3).map((s) => ({ comment: "", content: s }));
    if (typeof w.text === "string") return [{ comment: "", content: w.text }];
    return [];
  })();
  // 角色翻转卡只收有展示内容(外貌/性格)的角色;内容全空的名册壳过滤掉,空了退回文字列表。
  const rawChars = pdata.characters || [];
  const flipChars = rawChars.filter((c) => { const cd = (c && c.data) || c || {}; return cd.look || cd.personality; });

  // 角色列表(展示用):优先 characters,空则用 playables。
  const charList = ((pdata.characters && pdata.characters.length ? pdata.characters : pdata.playables) || [])
    .map(_normRole)
    .filter((c) => c.name);

  // 选主角卡:playables 优先;没有就用 characters;再没有只留"以旁观者开始"。
  const roleSource = (pdata.playables && pdata.playables.length ? pdata.playables : pdata.characters) || [];
  const roleCards = roleSource.map(_normRole).filter((c) => c.name);
  const SPECTATOR = { name: "以旁观者开始", persona: "不扮演特定角色,以观察者视角进入", description: "", spectator: true };
  const cards = roleCards.length ? [...roleCards, SPECTATOR] : [SPECTATOR];

  // 选中态:默认第一项;旁观者 = null 传给 onEnter。
  const [selIdx, setSelIdx] = useState(0);
  const selected = cards[selIdx] || cards[0];
  const enterRole = selected && !selected.spectator ? selected : null;

  // 自定义角色(老 modal「出演」tab 的自由出演):写身份 → /api/identify_player 识别成演出卡 → 直接入局。
  const [castMode, setCastMode] = useState("list");
  const [customText, setCustomText] = useState("");
  const [identifying, setIdentifying] = useState(false);
  async function startCustom() {
    if (!customText.trim() || identifying) return;
    setIdentifying(true);
    try {
      const r = await fetch("/api/identify_player", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: customText }) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      onEnter(await r.json());
    } catch (e) { alert("识别失败:" + e.message); }
    setIdentifying(false);
  }

  return (
    <div className="cv-story">
      <style>{RECON_STORY_DETAIL_CSS}</style>

      {/* ===== 顶栏 ===== */}
      <div className="nav">
        <div className="ptitle">
          <div className="h"><span className="zh">故事详情</span><span className="en">STORY DETAIL</span></div>
          <div className="sub">阅读故事，理解世界，选择你的身份</div>
        </div>
        <div className="nr">
          {/* 删:假的世界时间 / 天气元数据(preset 无对应)。保留通知 / 信箱 / 头像 chrome。 */}
          <span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7" /><path d="M10.5 20a1.8 1.8 0 0 0 3 0" /></svg></span>
          <span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 6l9 7 9-7" /></svg></span>
          <img className="av" src="assets/recon/story-detail-userav.png" alt="" onClick={() => onNav("mine")} style={{ cursor: "pointer" }} />
        </div>
      </div>

      {/* ===== 左侧引擎竖栏(全站统一 ReconRail;花饰与铭言作底部插槽) ===== */}
      <window.ReconRail active="home" onNav={onNav}>
        <div className="botanical"></div>
        <div className="navtag">
          <p>“每一个选择，<br />都在塑造你与世界的故事。”</p>
          <div className="en">NARRATIVE ENGINE</div>
        </div>
      </window.ReconRail>

      {/* ===== 中间内容(流式,随页滚动) ===== */}
      <div className="mid">
        <div className="row1">
          <div className="bookcol">
            {/* 书(点击=放回书架/返回) */}
            <div className="booktab" onClick={() => onClose()} style={{ cursor: "pointer" }}><div className="zh">放回书架</div><div className="en">CLOSE</div></div>
            <div className="book" onClick={() => onClose()} style={{ cursor: "pointer" }}>
              {pdata.cover
                ? <img src={pdata.cover} alt="" />
                : (() => {
                    const t = (pdata.name || preset.name || "未命名").replace(/[\s·•．.,，:：;；!！?？\-—~～]+/g, "").slice(0, 12);
                    return <span className="bt"><b style={{ fontSize: t.length > 6 ? 21 : 26 }}>{t}</b></span>;
                  })()}
            </div>
          </div>
          <div className="headcol">
            {/* 标题区 */}
            <div className="stitle">
              <h2>{bookName}</h2>
              {tags.length > 0 && <div className="tags">{tags.map((t, i) => <span key={i}>{t}</span>)}</div>}
              {author ? <div className="meta"><span><b>作者</b>　{author}</span></div> : null}
            </div>
            {/* 简介 */}
            <div className="intro">
              <div className="blkh"><b>简介</b><span className="en">INTRO</span></div>
              <p>{synopsis || "暂无简介。"}</p>
            </div>
          </div>
        </div>

        <div className="row2">
          {/* 背景(老 modal 内容版式:前情 + 世界设定公开条目;无数据不显示假设定) */}
          {(premise || worldEntries.length > 0) && (
            <div className="bg">
              <div className="blkh"><b>背景</b><span className="en">BACKSTORY</span></div>
              {premise ? (
                <div className="bgblock lead"><div className="bgsub">前情</div><p>{premise}</p></div>
              ) : null}
              {worldEntries.map((e, i) => (
                <div className="bgblock" key={i}>
                  <div className="bgsub">{e.comment || (e.keys || []).join(" / ") || "世界设定"}</div>
                  <p>{e.content || ""}</p>
                </div>
              ))}
            </div>
          )}

          {/* 角色:翻转卡横排(公开层);没有可展示的角色内容时退回文字列表 */}
          <div className="chars">
            <div className="blkh"><b>角色</b><span className="en">CHARACTERS</span></div>
            {flipChars.length > 0 ? (
              <RxCarousel rowClass="chrow">
                {flipChars.map((c, i) => <RxStoryFlipChar key={i} c={c} />)}
              </RxCarousel>
            ) : charList.length > 0 ? (
              <ul>
                {charList.slice(0, 5).map((c, i) => (
                  <li key={i}><b>{c.name}</b>{c.persona || c.description ? "　" + ((c.persona || c.description) + "").slice(0, 42) : ""}</li>
                ))}
                {charList.length > 5 && <li style={{ color: "var(--faint)" }}>……等共 {charList.length} 位角色，入局后逐一登场。</li>}
              </ul>
            ) : (
              <p>这个故事还没有登记角色。</p>
            )}
          </div>
        </div>

        {/* ===== 选择你的角色(老 Netflix 出演卡 + 自定义角色) ===== */}
        <div className="pickh"><span className="star"><StarIcon size={15} /></span><b>选择你扮演谁</b><span className="en">CHOOSE YOUR ROLE</span><span className="dash"></span></div>
        <RxCarousel rowClass="cards">
          {cards.map((c, i) => {
            const sel = i === selIdx && castMode !== "custom";
            return (
              <div className={"castcard" + (sel ? " sel" : "")} key={i} onClick={() => { setSelIdx(i); setCastMode("list"); }}>
                <b>{c.name}</b>
                <div className="crole">{c.persona || (c.spectator ? "不扮演特定角色,以观察者视角进入" : "可扮演")}</div>
                <div className="act"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" /></svg>{sel ? "已选择" : "可扮演"}</div>
              </div>
            );
          })}
          <div className={"castcard" + (castMode === "custom" ? " sel" : "")} onClick={() => setCastMode((m) => (m === "custom" ? "list" : "custom"))}>
            <b>自定义角色</b>
            <div className="crole">写下你想扮演的身份,AI 识别成演出卡进入</div>
            <div className="act"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20l1-4L16 5l3 3L8 19z"/></svg>自由出演</div>
          </div>
        </RxCarousel>
        {castMode === "custom" && (
          <div className="custompanel">
            <p className="cs-sub">写下你要扮演的角色:身份、背景、目标、能力、限制、开局已知……AI 会把它识别成演出卡。</p>
            <textarea value={customText} onChange={(e) => setCustomText(e.target.value)}
              placeholder="例:一个流落异乡的年轻铁匠,为寻失散的妹妹而来,擅长锻造与观察……" />
            <div className="csrow">
              <label className="cbtn">上传 .txt / .md / .docx
                <input type="file" accept=".txt,.md,.docx" style={{ display: "none" }}
                  onChange={async (e) => { const f = e.target.files[0]; if (!f) return; try { setCustomText(await window.uploadFile(f)); } catch (err) { alert("上传失败:" + err.message); } }} />
              </label>
              <span style={{ flex: 1 }}></span>
              <button className="cbtn pri" disabled={identifying || !customText.trim()} onClick={startCustom}>{identifying ? "识别中…" : "用这个角色开始"}</button>
            </div>
          </div>
        )}
      </div>

      {/* ===== 右:入戏仪式(跟随选中角色) ===== */}
      <div className="ritual">
        <div className="rh"><span className="star"><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" /></svg></span><b>入戏仪式</b><span className="sep">/</span><span className="en">ENTRY RITUAL</span></div>
        <div className="rart" data-ini={selected && !selected.spectator ? (selected.name || "?").trim().charAt(0) : "✦"}></div>
        <div className="rname">
          <h3>{selected ? selected.name : ""}</h3>
          <div className="role">{selected ? (selected.persona || (selected.spectator ? "旁观者" : "可扮演")) : ""}</div>
        </div>

        <div className="attrs">
          <div className="attr"><div className="lab">故事</div><div className="v">{bookName}</div></div>
          {selected && selected.persona ? (
            <div className="attr"><div className="lab">设定</div><div className="v">{selected.persona}</div></div>
          ) : null}
          {selected && selected.description ? (
            <div className="attr"><div className="lab">简述</div><div className="v">{selected.description}</div></div>
          ) : null}
          <div className="attr"><div className="lab">视角</div><div className="v">{enterRole ? "以「" + enterRole.name + "」的身份进入" : "以旁观者视角进入"}</div></div>
          {/* 选角后果说清:扮演=该角色由你发言、AI 不再出演 TA;旁观者同样靠输入推进 */}
          <div className="attr"><div className="lab">说明</div><div className="v" style={{ color: "#8a6f49" }}>
            {enterRole ? "你扮演的角色将由你来发言,不再由 AI 出演" : "旁观者同样通过输入行动推进故事"}
          </div></div>
        </div>

        <div className="enter" onClick={() => onEnter(enterRole)}>
          <span className="cn tl"></span><span className="cn tr"></span><span className="cn bl"></span><span className="cn br"></span>
          <span className="zh">涟漪入局</span>
          <span className="en">ENTER THE STORY</span>
          <span className="sub">BEGIN AS THIS ROLE</span>
        </div>
      </div>

    </div>
  );
}

window.ReconStoryDetail = ReconStoryDetail;
window.RxCarousel = RxCarousel;   // 个人中心「我的预设」复用(横排轮播:箭头/渐隐/圆点,≤3 张退静态)
