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
    position:relative; width:1672px; height:941px; overflow:hidden;
    background:
      repeating-linear-gradient(90deg, rgba(169,138,99,.026) 0 1px, transparent 1px 46px),
      var(--bg);
    color:var(--ink); font-family:var(--kai);
  }

  
  .cv-story .nav {position:absolute; left:0; right:0; top:0; height:88px; z-index:30;}
  .cv-story .nav::after {content:""; position:absolute; left:212px; right:30px; bottom:0; height:1px;
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
  .cv-story .book {position:absolute; left:248px; top:118px; width:236px; height:300px; z-index:4;
    border:1px solid var(--line2); background:linear-gradient(165deg,#efe6d2,#ddd0b2);
    box-shadow:6px 8px 0 rgba(43,38,32,.10), inset 0 0 0 6px rgba(250,244,234,.6); overflow:hidden;}
  .cv-story .book img {width:100%; height:100%; object-fit:cover; display:block;}
  .cv-story .book .bt {position:absolute; inset:0; display:grid; place-items:center;}
  .cv-story .book .bt b {writing-mode:vertical-rl; font-family:var(--serif); font-size:26px; letter-spacing:.3em; color:var(--gold); font-weight:700;}
  .cv-story .booktab {position:absolute; left:196px; top:128px; width:84px; height:36px; z-index:5;
    background:linear-gradient(180deg,#3a4d42,#2d3e35); border:1px solid rgba(193,168,111,.5);
    display:flex; flex-direction:column; align-items:center; justify-content:center;}
  .cv-story .booktab .zh {font-family:var(--serif); font-size:11px; color:#e9dcbf; letter-spacing:.08em;}
  .cv-story .booktab .en {font-family:var(--serifen); font-size:6.5px; letter-spacing:.16em; color:rgba(216,199,154,.75); margin-top:1px;}

  
  .cv-story .intro {position:absolute; left:478px; top:300px; width:360px; z-index:4;}
  .cv-story .blkh {display:flex; align-items:baseline; gap:9px;}
  .cv-story .blkh b {font-family:var(--serif); font-size:16px; font-weight:700; letter-spacing:.1em; color:var(--ink);}
  .cv-story .blkh .en {font-family:var(--serifen); font-size:9px; letter-spacing:.26em; color:var(--gold);}
  .cv-story .intro p {font-family:var(--kai); font-size:13px; line-height:1.95; color:var(--soft); margin:12px 0 0;}

  
  .cv-story .stitle {position:absolute; left:640px; top:120px; z-index:4;}
  .cv-story .stitle h2 {margin:0; font-family:var(--serif); font-size:34px; font-weight:700; letter-spacing:.05em; color:var(--ink);}
  .cv-story .stitle .en {font-family:var(--serifen); font-size:16px; letter-spacing:.32em; color:var(--faint); margin-top:7px;}
  .cv-story .stitle .tags {display:flex; gap:24px; margin-top:16px; font-family:var(--kai); font-size:13px; color:var(--soft); letter-spacing:.06em;}
  .cv-story .stitle .tags span {position:relative;}
  .cv-story .stitle .tags span:not(:last-child)::after {content:"·"; position:absolute; right:-15px; color:var(--line2);}
  .cv-story .stitle .meta {display:flex; gap:26px; margin-top:14px; font-family:var(--kai); font-size:12px; color:var(--faint); letter-spacing:.04em;}
  .cv-story .stitle .meta span {position:relative;}
  .cv-story .stitle .meta span:not(:last-child)::after {content:"·"; position:absolute; right:-16px; color:var(--line2);}
  .cv-story .stitle .meta b {color:var(--soft); font-weight:400;}

  
  .cv-story .bg {position:absolute; left:478px; top:415px; width:360px; z-index:4;}
  /* 角色列右锚定:贴住入戏仪式栏,宽屏 fill 下随之分布(1672 设计宽时 ≈ 原 left:872) */
  .cv-story .chars {position:absolute; right:440px; top:415px; width:380px; z-index:4;}
  .cv-story .bg ul, .cv-story .chars ul {list-style:none; margin:14px 0 0; padding:0;}
  .cv-story .bg li, .cv-story .chars li {font-family:var(--kai); font-size:13px; line-height:1.5; color:var(--soft); margin-bottom:13px; padding-left:16px; position:relative;}
  .cv-story .bg li::before, .cv-story .chars li::before {content:""; position:absolute; left:0; top:8px; width:5px; height:5px; border-radius:50%; background:var(--gold);}
  .cv-story .chars p {font-family:var(--kai); font-size:13px; line-height:1.95; color:var(--soft); margin:14px 0 0;}

  
  .cv-story .pickh {position:absolute; left:250px; top:566px; display:flex; align-items:center; gap:12px; z-index:4;}
  .cv-story .pickh .star {color:var(--gold); display:grid; place-items:center;}
  .cv-story .pickh b {font-family:var(--serif); font-size:17px; font-weight:700; letter-spacing:.12em; color:var(--ink);}
  .cv-story .pickh .en {font-family:var(--serifen); font-size:10px; letter-spacing:.3em; color:var(--gold);}
  .cv-story .pickh .dash {width:90px; height:1px; background:repeating-linear-gradient(90deg,var(--line2) 0 6px,transparent 6px 12px);}

  .cv-story .cards {position:absolute; left:250px; right:420px; top:600px; z-index:4; display:flex; gap:12px; overflow-x:auto; overflow-y:hidden; padding-bottom:8px; scroll-behavior:smooth;}
  .cv-story .cards::-webkit-scrollbar {height:6px;} .cv-story .cards::-webkit-scrollbar-thumb {background:var(--line2);}
  .cv-story .cards .card {flex:none;}
  .cv-story .card {width:224px; height:248px; background:var(--paper); border:1px solid var(--line); position:relative; overflow:hidden;}
  .cv-story .card.sel {border:1px solid var(--gold2); box-shadow:inset 0 0 0 1px rgba(193,168,111,.45), 0 2px 10px rgba(169,138,99,.12);}
  .cv-story .card .badge {position:absolute; left:0; top:0; background:linear-gradient(180deg,#3a4d42,#2d3e35); color:#e9dcbf;
    font-family:var(--serif); font-size:10px; letter-spacing:.1em; padding:3px 10px; z-index:3; border-bottom-right-radius:2px;}
  .cv-story .card .av {position:absolute; left:50%; transform:translateX(-50%); top:0; width:174px; height:150px; object-fit:cover; object-position:top center;
    -webkit-mask-image:linear-gradient(180deg,#000 80%,transparent); mask-image:linear-gradient(180deg,#000 80%,transparent);}
  /* 卡内文字区改流式排版(头像区下方依序排,不再绝对定位互撞);人设截 1 行,完整版在右栏入戏仪式 */
  .cv-story .card .nm {margin:158px 8px 0; text-align:center; font-family:var(--serif); font-size:16px; font-weight:700; color:var(--ink); letter-spacing:.04em; position:relative; z-index:2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-story .card .role {margin:5px 12px 0; text-align:center; font-family:var(--kai); font-size:11px; color:var(--gold); letter-spacing:.04em; position:relative; z-index:2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-story .card .quote {margin:6px 14px 0; font-family:var(--kai); font-size:10.5px; line-height:1.55; color:var(--soft); text-align:center; position:relative; z-index:2;
    display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical; overflow:hidden;}
  .cv-story .card .act {position:absolute; left:0; right:0; bottom:8px; display:flex; align-items:center; justify-content:center; gap:5px; z-index:3; background:var(--paper); padding:4px 0;
    font-family:var(--serif); font-size:11px; letter-spacing:.14em; color:var(--green);}
  .cv-story .card.sel .act {color:var(--gold);}
  .cv-story .card .act svg {color:var(--green);}
  .cv-story .card.sel .act svg {color:var(--gold);}

  
  .cv-story .opscene {position:absolute; left:250px; top:855px; width:660px; z-index:4;}
  .cv-story .opscene .oh {display:flex; align-items:center; gap:11px;}
  .cv-story .opscene .oh .star {color:var(--gold); display:grid; place-items:center;}
  .cv-story .opscene .oh b {font-family:var(--serif); font-size:15px; font-weight:700; letter-spacing:.1em; color:var(--ink);}
  .cv-story .opscene .oh .en {font-family:var(--serifen); font-size:9px; letter-spacing:.28em; color:var(--gold);}
  .cv-story .opscene .body {display:flex; gap:16px; margin-top:11px;}
  .cv-story .opscene .thumb {flex:none; width:104px; height:62px; object-fit:cover; border:1px solid var(--line2);}
  .cv-story .opscene .txt p {margin:0 0 5px; font-family:var(--kai); font-size:12px; line-height:1.7; color:var(--soft); letter-spacing:.02em;}

  
  .cv-story .ritual {position:absolute; right:0; top:88px; bottom:0; width:382px; z-index:10;
    border-left:1px solid var(--line2);
    background:linear-gradient(180deg, rgba(250,244,234,.55), rgba(246,239,226,.3));}
  .cv-story .rh {position:absolute; left:30px; top:24px; display:flex; align-items:center; gap:9px;}
  .cv-story .rh .star {color:var(--gold); display:grid; place-items:center;}
  .cv-story .rh b {font-family:var(--serif); font-size:17px; font-weight:700; letter-spacing:.14em; color:var(--ink);}
  .cv-story .rh .sep {color:var(--line2); font-family:var(--serifen); font-size:14px; margin:0 1px;}
  .cv-story .rh .en {font-family:var(--serifen); font-size:10px; letter-spacing:.3em; color:var(--faint);}
  .cv-story .card .avn {display:grid; place-items:center; background:linear-gradient(170deg,#efe6d2,#ded1b4); border-bottom:1px solid var(--line);}
  .cv-story .card .avn b {font-family:var(--serif); font-size:44px; color:var(--gold); font-weight:700;}
  /* 入戏仪式立绘:角色无真立绘 → 中性大首字块(不放固定假立绘) */
  .cv-story .rart {position:absolute; left:14px; right:0; top:42px; height:270px;
    background:linear-gradient(170deg,#efe6d2,#dccfb1); display:grid; place-items:center;}
  .cv-story .rart::after {content:attr(data-ini); font-family:var(--serif); font-size:96px; color:var(--gold); font-weight:700;}
  .cv-story .rname {position:absolute; left:0; right:0; top:322px; text-align:center;}
  .cv-story .rname h3 {margin:0; font-family:var(--serif); font-size:25px; font-weight:700; letter-spacing:.06em; color:var(--ink);}
  .cv-story .rname .role {font-family:var(--kai); font-size:13px; color:var(--soft); letter-spacing:.08em; margin-top:7px; padding:0 26px;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}

  .cv-story .attrs {position:absolute; left:30px; right:30px; top:386px;}
  .cv-story .attr {display:flex; align-items:flex-start; gap:14px; padding:9px 0; border-top:1px solid var(--line);}
  .cv-story .attr:first-child {border-top:none;}
  .cv-story .attr .lab {flex:none; width:58px; font-family:var(--serif); font-size:12px; color:var(--gold); letter-spacing:.1em; margin-top:2px;}
  .cv-story .attr .v {flex:1; font-family:var(--kai); font-size:13px; line-height:1.5; color:var(--ink); letter-spacing:.02em;}
  .cv-story .attr.mono .v {font-style:italic; color:var(--soft);}
  .cv-story .wave {display:inline-flex; align-items:center; gap:14px; margin-top:7px;}
  .cv-story .wave svg {color:var(--line2);}
  .cv-story .wave .spk {color:var(--gold);}

  
  .cv-story .enter {position:absolute; left:30px; right:30px; top:689px; height:94px;
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
  // 背景:有 world 文本就拆行成条目;没有就不显示假条目。
  // world 兼容三种形态:字符串 / {entries:[{name,text}]} / 其它对象(取文本字段)。
  const backstory = (() => {
    const w = pdata.world;
    if (!w) return [];
    let lines = [];
    if (typeof w === "string") lines = w.split(/\n+/);
    else if (Array.isArray(w.entries)) lines = w.entries.map((e) => (e && (e.name ? e.name + "：" : "") + (e.text || e.content || "")) || "");
    else if (typeof w.text === "string") lines = w.text.split(/\n+/);
    else lines = [];
    return lines.map((s) => String(s).trim()).filter(Boolean).slice(0, 4).map((s) => (s.length > 60 ? s.slice(0, 60) + "……" : s));
  })();

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

      {/* ===== 中左:书(点击=放回书架/返回) ===== */}
      <div className="booktab" onClick={() => onClose()} style={{ cursor: "pointer" }}><div className="zh">放回书架</div><div className="en">CLOSE</div></div>
      <div className="book" onClick={() => onClose()} style={{ cursor: "pointer" }}>
        {pdata.cover
          ? <img src={pdata.cover} alt="" />
          : <span className="bt"><b>{(pdata.name || preset.name || "未命名").replace(/[\s·•．.,，:：;；!！?？-]+/g, "").slice(0, 6)}</b></span>}
      </div>

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

      {/* 背景(仅当 preset 有 world 文本时显示,不再写死假设定) */}
      {backstory.length > 0 && (
        <div className="bg">
          <div className="blkh"><b>背景</b><span className="en">BACKSTORY</span></div>
          <ul>
            {backstory.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}

      {/* 角色 */}
      <div className="chars">
        <div className="blkh"><b>角色</b><span className="en">CHARACTERS</span></div>
        {charList.length > 0 ? (
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

      {/* ===== 选择你的角色 ===== */}
      <div className="pickh"><span className="star"><StarIcon size={15} /></span><b>选择你扮演谁</b><span className="en">CHOOSE YOUR ROLE</span><span className="dash"></span></div>
      <div className="cards">
        {cards.map((c, i) => {
          const sel = i === selIdx;
          return (
            <div className={"card" + (sel ? " sel" : "")} key={i} onClick={() => setSelIdx(i)} style={{ cursor: "pointer" }}>
              {sel && <span className="badge">已选择</span>}
              {/* 库里角色没有立绘字段 → 首字中性块,不放与角色无关的假人像;旁观者用罗盘徽 */}
              {c.spectator
                ? <img className="av" src="assets/recon/story-detail-emblem.png" alt="" style={{ objectFit: "contain", padding: 28, boxSizing: "border-box" }} />
                : <span className="av avn"><b>{(c.name || "?").trim().charAt(0)}</b></span>}
              <div className="nm">{c.name}</div>
              <div className="role">{c.persona || (c.spectator ? "旁观者" : "可扮演")}</div>
              {c.description ? <div className="quote">{c.description}</div> : null}
              <div className="act"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" /></svg>{sel ? "已选择" : "可扮演"}</div>
            </div>
          );
        })}
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
