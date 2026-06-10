/* ReconChat — 角色聊天 window 组件（1:1 还原 frontend/_recon/chat.html）
   React/ReactDOM 已全局。资源路径相对站点根 assets/recon/。
   数据驱动：优先读真实 props；无 props（测试页）时回退极简 sample 保证不白屏。
   契约 props: {characters:[{name,persona,avatar}], activeName, messages:[{who:"me"|角色名,text}],
                value, onChange(text), onSend(), onPick(name), onNav(view)}。 */

// 极简回退 sample：仅用于无 props 的 standalone 测试页，保证版式可渲染。
const FALLBACK = {
  characters: [
    { name: "艾琳", persona: "白塔协会的年轻学者，对世界怀有无尽的好奇。", avatar: "assets/recon/chat-avatar.png" },
    { name: "陆临", persona: "沉默寡言的同行者。", avatar: "assets/recon/chat-rc2.png" },
  ],
  activeName: "艾琳",
  messages: [
    { who: "艾琳", text: "你来了。外面的雨停了，要一起喝杯茶吗？" },
    { who: "me", text: "嗯，正好想和你聊聊。" },
    { who: "艾琳", text: "那就坐下来吧，我有些话想对你说。" },
  ],
  value: "",
};

function ReconChat(props) {
  const P = props || {};
  // 是否拿到「真实数据 props」：只要传了 characters 或 messages 即视为接线后的真实模式，
  // 否则（测试页 createElement 不带 props，React 会给 {}）回退极简 sample，保证不白屏。
  const usingProps = P.characters != null || P.messages != null;
  const characters = usingProps ? (P.characters || []) : FALLBACK.characters;
  const messages = usingProps ? (P.messages || []) : FALLBACK.messages;
  const value = P.value != null ? P.value : (usingProps ? "" : FALLBACK.value);
  const activeName = P.activeName != null ? P.activeName : (usingProps ? null : FALLBACK.activeName);
  const onNav = P.onNav || (() => {});
  const onPick = P.onPick || (() => {});
  const onSend = P.onSend || (() => {});
  const onChange = P.onChange || (() => {});

  // 当前角色（资料卡）：activeName 命中则取之，否则取第一个有角色。
  const active = characters.find((c) => c && c.name === activeName) || characters[0] || null;
  const initial = (active && active.name ? active.name.trim().charAt(0) : "") || "?";

  // 左栏主导航 → onNav(view)。view 键对齐 app.jsx 路由（home/game/build/mine/chat）。
  const nav = [
    { zh: "探索", en: "EXPLORE", view: "home", icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></svg> },
    { zh: "当前故事", en: "CURRENT STORY", view: "game", icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h11l3 3v13H5z" /><path d="M8 9h8M8 13h8M8 17h5" /></svg> },
    { zh: "创作", en: "CREATE", view: "build", icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4l2.5 5 5.5.8-4 3.9 1 5.5-5-2.6-5 2.6 1-5.5-4-3.9 5.5-.8z" /></svg> },
    { zh: "档案", en: "ARCHIVE", view: "mine", icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16v13H4z" /><path d="M4 7l2-3h12l2 3" /><path d="M9 11h6" /></svg> },
    { zh: "聊天", en: "CHAT", view: "chat", on: true, icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v11H9l-4 4z" /></svg> },
    { zh: "我的", en: "PROFILE", view: "mine", icon: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M5 20c0-4 3.4-6 7-6s7 2 7 6" /></svg> },
  ];

  const RectBadge = (
    <span className="bdg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" /></svg></span>
  );

  // 头像：有 avatar 用图，否则用首字占位（复用 .av.sv 样式）。
  const Avatar = ({ c, cls }) => {
    const av = c && c.avatar;
    const ini = (c && c.name ? c.name.trim().charAt(0) : "") || "?";
    return av
      ? <img className={cls} src={av} alt="" />
      : <span className={cls + " sv"}>{ini}</span>;
  };

  const onInputKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } };

  return (
    <div className="cv-chat">
      <style>{`
  .cv-chat {
    --bg:#f3ece0; --paper:#faf4ea; --paper2:#f6efe2;
    --ink:#2c2820; --soft:#6f6757; --faint:#9a907a;
    --line:#ddd0b4; --line2:#c4b388;
    --gold:#a98a63; --gold2:#c1a86f;
    --navy:#163b57; --navy-deep:#0d2f49; --navy-line:#b99a59;
    --green:#34463d; --green2:#3d4744; --teal:#687870;
    --serif:"Songti SC","STSong","SimSun",serif;
    --serifen:Georgia,"Times New Roman",serif;
    --kai:"Kaiti SC","STKaiti","KaiTi",serif;
  }
  .cv-chat * {box-sizing:border-box;}
  .cv-chat {
    position:relative; width:1536px; height:1024px; overflow:hidden;
    background:var(--bg);
    color:var(--ink); font-family:var(--kai);
  }

  
  .cv-chat .side {position:absolute; left:0; top:0; width:240px; height:1024px;
    background:linear-gradient(180deg,#f5eee3,#f2eadd);
    border-right:1px solid var(--line); z-index:10;
    background-image:repeating-linear-gradient(0deg, rgba(169,138,99,.018) 0 1px, transparent 1px 38px);}
  .cv-chat .side .logo {display:flex; align-items:center; gap:10px; padding:20px 20px 16px;}
  .cv-chat .side .logo img {width:34px; height:34px; object-fit:contain;}
  .cv-chat .side .logo h1 {margin:0; font-family:var(--serifen); font-weight:600; font-size:16px; letter-spacing:.05em; color:var(--navy);}
  .cv-chat .side .logo .sub {font-family:var(--kai); font-size:9px; letter-spacing:.34em; color:var(--faint); margin-top:3px;}
  .cv-chat .side .logo::after {content:""; position:absolute;}
  .cv-chat .navlist {margin-top:6px; padding:0 12px;}
  .cv-chat .navlist .it {display:flex; align-items:center; gap:13px; height:46px; padding:0 12px; cursor:pointer; position:relative;}
  .cv-chat .navlist .it .ic {width:18px; height:18px; flex:none; color:var(--soft); display:grid; place-items:center;}
  .cv-chat .navlist .it .tx .zh {font-family:var(--serif); font-size:14px; letter-spacing:.06em; color:var(--soft); line-height:1.05;}
  .cv-chat .navlist .it .tx .en {font-family:var(--serifen); font-size:7.5px; letter-spacing:.28em; color:var(--faint); margin-top:2px;}
  .cv-chat .navlist .it.on {background:var(--green); }
  .cv-chat .navlist .it.on .ic {color:#e9dcc4;}
  .cv-chat .navlist .it.on .tx .zh {color:#f3ead6; font-weight:600;}
  .cv-chat .navlist .it.on .tx .en {color:rgba(243,234,214,.66);}
  .cv-chat .navlist .it.on::before {content:""; position:absolute; left:0; top:8px; bottom:8px; width:3px; background:var(--gold2);}

  .cv-chat .recenth {display:flex; align-items:center; gap:9px; padding:14px 24px 8px;}
  .cv-chat .recenth b {font-family:var(--serif); font-size:11px; letter-spacing:.12em; color:var(--soft);}
  .cv-chat .recenth .en {font-family:var(--serifen); font-size:7px; letter-spacing:.24em; color:var(--faint);}
  .cv-chat .recenth i {flex:1; height:1px; background:var(--line);}
  .cv-chat .rc {display:flex; align-items:center; gap:10px; padding:8px 16px; margin:0 8px; cursor:pointer; position:relative;}
  .cv-chat .rc .av {width:36px; height:36px; border-radius:50%; flex:none; object-fit:cover; border:1px solid rgba(169,138,99,.4);}
  .cv-chat .rc .av.sv {display:grid; place-items:center; background:#cdb49a; color:#fff; font-family:var(--serif); font-size:14px; border:1px solid rgba(169,138,99,.4);}
  .cv-chat .rc .bd {min-width:0; flex:1;}
  .cv-chat .rc .bd .nm {font-family:var(--serif); font-size:12.5px; color:var(--ink); letter-spacing:.04em;}
  .cv-chat .rc .bd .ms {font-family:var(--kai); font-size:10px; color:var(--faint); margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-chat .rc .tm {position:absolute; right:14px; top:10px; font-family:var(--serifen); font-size:9px; color:var(--faint);}
  .cv-chat .rc.on {background:var(--green); border-radius:2px;}
  .cv-chat .rc.on .bd .nm {color:#f3ead6;}
  .cv-chat .rc.on .bd .ms {color:rgba(243,234,214,.7);}
  .cv-chat .rc.on .tm {color:rgba(243,234,214,.6);}

  .cv-chat .newchat {position:absolute; left:18px; right:18px; bottom:22px; height:50px; border:1px solid var(--line2);
    background:var(--paper); display:flex; align-items:center; justify-content:center; gap:12px; cursor:pointer;}
  .cv-chat .newchat .ic {color:var(--gold);}
  .cv-chat .newchat .tx .zh {font-family:var(--serif); font-size:13px; letter-spacing:.1em; color:var(--ink);}
  .cv-chat .newchat .tx .en {font-family:var(--serifen); font-size:7.5px; letter-spacing:.26em; color:var(--faint); margin-top:2px;}
  .cv-chat .newchat .star {position:absolute; left:18px; color:var(--gold2);}

  
  .cv-chat .topr {position:absolute; right:24px; top:24px; display:flex; align-items:center; gap:26px; z-index:20;}
  .cv-chat .topr .ti {display:flex; align-items:center; gap:7px; cursor:pointer;}
  .cv-chat .topr .ti .ic {color:var(--soft);}
  .cv-chat .topr .ti .lb {display:flex; flex-direction:column;}
  .cv-chat .topr .ti .lb .zh {font-family:var(--serif); font-size:12px; color:var(--soft); letter-spacing:.04em;}
  .cv-chat .topr .ti .lb .en {font-family:var(--serifen); font-size:7px; letter-spacing:.22em; color:var(--faint); margin-top:1px;}
  .cv-chat .topr .ti .lb .tm {font-family:var(--serifen); font-size:11px; color:var(--ink); letter-spacing:.02em; margin-top:2px;}
  .cv-chat .topr .ti .cm {font-size:8px; color:var(--faint); margin-left:1px;}
  .cv-chat .topr .sep {width:1px; height:24px; background:var(--line);}
  .cv-chat .topr .me {display:flex; align-items:center; gap:9px; cursor:pointer;}
  .cv-chat .topr .me img {width:34px; height:34px; border-radius:50%; object-fit:cover; border:1px solid var(--line2);}
  .cv-chat .topr .me .col {display:flex; flex-direction:column; align-items:flex-start; gap:3px;}
  .cv-chat .topr .me .lv {font-family:var(--serifen); font-size:8px; color:#f3ead6; background:var(--green); padding:1px 5px; align-self:flex-start;}
  .cv-chat .topr .me .nm {font-family:var(--serif); font-size:12px; color:var(--ink);}

  
  .cv-chat .pagehd {position:absolute; left:288px; top:54px; z-index:5;}
  .cv-chat .pagehd h2 {margin:0; display:flex; align-items:baseline; gap:14px;}
  .cv-chat .pagehd h2 .zh {font-family:var(--serif); font-weight:700; font-size:28px; letter-spacing:.06em; color:var(--ink);}
  .cv-chat .pagehd h2 .en {font-family:var(--serifen); font-style:italic; font-size:18px; color:var(--gold); letter-spacing:.02em;}
  .cv-chat .pagehd h2 .en::before {content:"/ ";}
  .cv-chat .pagehd p {margin:9px 0 0; font-family:var(--kai); font-size:13px; color:var(--soft); letter-spacing:.04em;}

  
  .cv-chat .charbar {position:absolute; left:288px; top:122px; right:368px; height:62px; border-bottom:1px solid var(--line);
    display:flex; align-items:center; gap:13px; z-index:5;}
  .cv-chat .charbar .av {width:46px; height:46px; border-radius:50%; object-fit:cover; border:1px solid var(--line2);}
  .cv-chat .charbar .stk {display:flex; flex-direction:column; gap:5px;}
  .cv-chat .charbar .nm {font-family:var(--serif); font-size:18px; font-weight:700; color:var(--ink); letter-spacing:.04em; display:flex; align-items:center; gap:7px;}
  .cv-chat .charbar .tag {display:inline-grid; place-items:center; width:16px; height:16px; border:1px solid var(--line2); color:var(--faint); font-size:9px;}
  .cv-chat .charbar .fav {font-family:var(--kai); font-size:11px; color:var(--soft);}
  .cv-chat .charbar .fav b {font-family:var(--serifen); color:var(--green); font-weight:700;}
  .cv-chat .charbar .actions {margin-left:auto; display:flex; gap:10px;}
  .cv-chat .charbar .actions .b {display:flex; align-items:center; gap:6px; height:30px; padding:0 16px; border:1px solid var(--line2); color:var(--soft); font-family:var(--serif); font-size:12.5px; letter-spacing:.06em; cursor:pointer; background:var(--paper);}

  
  .cv-chat .chat {position:absolute; left:288px; top:200px; right:368px; bottom:128px; overflow:hidden; z-index:4;}
  .cv-chat .syscue {text-align:center; font-family:var(--kai); font-size:11px; color:var(--faint); letter-spacing:.06em; margin-bottom:22px;}
  .cv-chat .syscue span {display:inline-block; padding:0 12px; position:relative;}
  .cv-chat .syscue span::before, .cv-chat .syscue span::after {content:""; position:absolute; top:50%; width:60px; height:1px; background:var(--line);}
  .cv-chat .syscue span::before {right:100%;} .cv-chat .syscue span::after {left:100%;}

  .cv-chat .msg {display:flex; gap:12px; margin-bottom:17px; max-width:560px;}
  .cv-chat .msg .av {width:38px; height:38px; border-radius:50%; flex:none; object-fit:cover; border:1px solid var(--line2);}
  .cv-chat .msg .col {min-width:0;}
  .cv-chat .msg .who {font-family:var(--serif); font-size:13px; color:var(--ink); margin-bottom:5px; letter-spacing:.04em; display:flex; align-items:center; gap:6px;}
  .cv-chat .msg .who .bdg {display:inline-grid; place-items:center; width:14px; height:14px; border:1px solid var(--line2); color:var(--faint);}
  .cv-chat .msg .who .bdg svg {width:9px; height:9px;}
  .cv-chat .msg .bub {font-family:var(--kai); font-size:13.5px; line-height:1.7; color:var(--ink); position:relative;}
  .cv-chat .msg .bub .nar {color:var(--soft); font-style:italic;}
  .cv-chat .msg .time {font-family:var(--serifen); font-size:9px; color:var(--faint); margin-top:5px;}

  
  .cv-chat .msg.me {margin-left:auto; flex-direction:row-reverse; max-width:470px; align-items:flex-start;}
  .cv-chat .msg.me .col {display:flex; flex-direction:column; align-items:flex-end;}
  .cv-chat .msg.me .bub {background:var(--teal); color:#f2ede2; padding:10px 15px; border-radius:3px;
    box-shadow:0 1px 0 rgba(0,0,0,.04); font-size:13px; line-height:1.75;}
  .cv-chat .msg.me .time {text-align:right;}

  
  .cv-chat .inputbar {position:absolute; left:288px; right:368px; bottom:26px; height:96px; z-index:6;
    display:flex; align-items:center; gap:14px; padding:13px 16px;
    background:var(--paper2); border:1px solid var(--line2);}
  .cv-chat .inputbar::before {content:""; position:absolute; inset:5px; border:1px solid rgba(169,138,99,.28); pointer-events:none;}
  .cv-chat .inputbar .ctx {display:flex; flex-direction:column; align-items:center; gap:4px; width:62px; flex:none; cursor:pointer; position:relative;}
  .cv-chat .inputbar .ctx .ic {color:var(--soft);}
  .cv-chat .inputbar .ctx .tx {font-family:var(--kai); font-size:9px; color:var(--faint); letter-spacing:.04em; white-space:nowrap;}
  .cv-chat .inputbar .box {flex:1; height:64px; background:var(--paper); border:1px solid var(--line); display:flex; align-items:center; padding:0 20px; position:relative;}
  .cv-chat .inputbar .box .ph {font-family:var(--kai); font-size:13.5px; color:var(--faint);}
  .cv-chat .inputbar .send {flex:none; width:108px; height:64px; background:var(--green); border:1px solid #283831;
    position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer;}
  .cv-chat .inputbar .send::before {content:""; position:absolute; inset:3px; border:1px solid rgba(193,168,111,.4);}
  .cv-chat .inputbar .send .ic {color:#e9dcc4; position:relative;}
  .cv-chat .inputbar .send .zh {font-family:var(--serif); font-size:13px; letter-spacing:.16em; color:#f3ead6; position:relative;}
  .cv-chat .inputbar .send .en {font-family:var(--serifen); font-size:7px; letter-spacing:.28em; color:rgba(243,234,214,.65); position:relative;}

  
  .cv-chat .rcard {position:absolute; right:18px; top:54px; width:330px; bottom:30px; background:var(--paper);
    border:1px solid var(--line); z-index:8; display:flex; flex-direction:column;}
  .cv-chat .rcard .tabs {display:flex; height:38px; border-bottom:1px solid var(--line);}
  .cv-chat .rcard .tabs a {flex:1; display:grid; place-items:center; font-family:var(--serif); font-size:12px; letter-spacing:.16em; color:var(--faint); cursor:pointer; position:relative;}
  .cv-chat .rcard .tabs a.on {color:var(--ink);}
  .cv-chat .rcard .tabs a.on::after {content:""; position:absolute; left:24px; right:24px; bottom:0; height:2px; background:var(--gold);}
  .cv-chat .rcard .tabs a .en {font-family:var(--serifen); font-style:italic;}

  .cv-chat .rcard .portrait {height:288px; position:relative; flex:none; overflow:hidden;}
  .cv-chat .rcard .portrait img {width:100%; height:100%; object-fit:cover; object-position:center top;}
  .cv-chat .rcard .portrait .name {position:absolute; left:16px; bottom:12px;}
  .cv-chat .rcard .portrait .name b {display:block; font-family:var(--serif); font-size:22px; font-weight:700; color:#fff; letter-spacing:.06em; text-shadow:0 1px 4px rgba(0,0,0,.5);}
  .cv-chat .rcard .portrait .name s {font-family:var(--serifen); font-style:italic; font-size:12px; color:rgba(255,255,255,.85); text-decoration:none; text-shadow:0 1px 3px rgba(0,0,0,.5);}

  .cv-chat .rcard .tagline {padding:11px 18px 2px; font-family:var(--kai); font-size:11.5px; color:var(--soft); letter-spacing:.02em;}
  .cv-chat .rcard .attrs {padding:6px 18px 4px; display:flex; flex-direction:column; gap:6px;}
  .cv-chat .rcard .attrs .r {display:flex; align-items:flex-start; gap:10px; font-size:12px;}
  .cv-chat .rcard .attrs .r .ic {width:16px; flex:none; color:var(--gold); display:grid; place-items:center; margin-top:1px;}
  .cv-chat .rcard .attrs .r .k {font-family:var(--kai); color:var(--faint); width:36px; flex:none;}
  .cv-chat .rcard .attrs .r .v {font-family:var(--kai); color:var(--ink); flex:1;}

  .cv-chat .rcard .desc {padding:8px 18px 0; flex:1; min-height:0;}
  .cv-chat .rcard .desc .dh {display:flex; align-items:center; gap:8px; margin-bottom:7px;}
  .cv-chat .rcard .desc .dh b {font-family:var(--serif); font-size:12px; color:var(--ink); letter-spacing:.06em;}
  .cv-chat .rcard .desc .dh i {flex:1; height:1px; background:var(--line);}
  .cv-chat .rcard .desc p {margin:0; font-family:var(--kai); font-size:11.5px; line-height:1.85; color:var(--soft); letter-spacing:.02em;}

  .cv-chat .rcard .favblk {padding:10px 18px 0;}
  .cv-chat .rcard .favblk .t {display:flex; justify-content:space-between; font-family:var(--kai); font-size:11px; color:var(--soft);}
  .cv-chat .rcard .favblk .t b {font-family:var(--serifen); color:var(--green); font-weight:700;}
  .cv-chat .rcard .favblk .bar {height:5px; background:var(--line); margin-top:7px; position:relative; border-radius:3px; overflow:hidden;}
  .cv-chat .rcard .favblk .bar i {position:absolute; left:0; top:0; bottom:0; width:68%; background:#aaa094;}

  .cv-chat .rcard .gift {margin:13px 18px 16px; height:42px; border:1px solid var(--line2); background:var(--paper2);
    display:flex; align-items:center; justify-content:center; gap:9px; cursor:pointer;
    font-family:var(--serif); font-size:13px; letter-spacing:.12em; color:var(--soft);}
  .cv-chat .rcard .gift .ic {color:var(--gold);}
`}</style>

      {/* 左侧引擎竖栏 */}
      <div className="side">
        <div className="logo">
          <img src="assets/recon/home-emblem.png" alt="" />
          <div>
            <h1>NARRATIVE ENGINE</h1>
            <div className="sub">叙事引擎</div>
          </div>
        </div>
        <div className="navlist">
          {nav.map((n, i) => (
            <div className={"it" + (n.on ? " on" : "")} key={i} style={{ cursor: "pointer" }} onClick={() => onNav(n.view)}>
              <span className="ic">{n.icon}</span>
              <div className="tx"><div className="zh">{n.zh}</div><div className="en">{n.en}</div></div>
            </div>
          ))}
        </div>
        <div className="recenth"><b>近期聊天</b><span className="en">RECENT CHATS</span><i></i></div>
        {characters.map((c, i) => (
          <div className={"rc" + (active && c.name === active.name ? " on" : "")} key={i} style={{ cursor: "pointer" }} onClick={() => onPick(c.name)}>
            <Avatar c={c} cls="av" />
            <div className="bd"><div className="nm">{c.name}</div><div className="ms">{c.persona || ""}</div></div>
          </div>
        ))}
        <div className="newchat" style={{ cursor: "pointer" }} onClick={() => onNav("build")}><span className="star"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l1.6 6.4L20 11l-6.4 1.6L12 19l-1.6-6.4L4 11l6.4-1.6z" /></svg></span><span className="ic"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4l4 4-11 11H5v-4z" /></svg></span><div className="tx"><div className="zh">新建对话</div><div className="en">NEW CHAT</div></div></div>
      </div>

      {/* 顶栏右侧（功能入口，无写死世界时间/用户；记忆/档案走 onNav） */}
      <div className="topr">
        <div className="ti" style={{ cursor: "pointer" }} onClick={() => onNav("game")}><span className="ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h11l3 3v13H5z" /><path d="M9 9h6M9 13h6M9 17h4" /></svg></span><div className="lb"><div className="zh">记忆</div><div className="en">MEMORY</div></div></div>
        <div className="sep"></div>
        <div className="ti" style={{ cursor: "pointer" }} onClick={() => onNav("mine")}><span className="ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16v13H4z" /><path d="M4 7l2-3h12l2 3" /></svg></span><div className="lb"><div className="zh">档案</div><div className="en">ARCHIVE</div></div></div>
        <div className="sep"></div>
        <div className="me" style={{ cursor: "pointer" }} onClick={() => onNav("mine")}><span className="ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M5 20c0-4 3.4-6 7-6s7 2 7 6" /></svg></span><div className="col"><span className="nm">我的</span></div></div>
      </div>

      {/* 中部标题 */}
      <div className="pagehd">
        <h2><span className="zh">角色聊天</span><span className="en">Character Chat</span></h2>
        <p>与角色进行深入交流,了解更多不为人知的故事。</p>
      </div>

      {/* 角色名行（名 + persona 概述，无写死好感度/性别） */}
      <div className="charbar">
        {active ? <Avatar c={active} cls="av" /> : <span className="av sv">?</span>}
        <div className="stk">
          <div className="nm">{active ? active.name : "未选择角色"}</div>
          {active && active.persona ? <div className="fav">{active.persona}</div> : null}
        </div>
        <div className="actions">
          <div className="b" style={{ cursor: "pointer" }} onClick={() => onNav("game")}>当前故事 <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg></div>
        </div>
      </div>

      {/* 对话区（messages 映射；who==="me" → 右侧玩家泡，否则左侧角色泡带名） */}
      <div className="chat">
        {!characters.length ? (
          <div className="syscue"><span>还没有可聊的角色，去创作 / 开局</span></div>
        ) : (
          messages.map((m, i) => {
            const isMe = m.who === "me";
            // 角色泡：用该消息说话人的角色（命中 characters），否则退当前 active。
            const speaker = isMe ? null : (characters.find((c) => c && c.name === m.who) || active);
            return isMe ? (
              <div className="msg me" key={i}>
                <div className="col">
                  <div className="bub">{m.text}</div>
                </div>
              </div>
            ) : (
              <div className="msg" key={i}>
                <Avatar c={speaker} cls="av" />
                <div className="col">
                  <div className="who">{m.who}{RectBadge}</div>
                  <div className="bub">{m.text}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部输入（值=value，改→onChange，发送/回车→onSend） */}
      <div className="inputbar">
        <div className="ctx"><span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 109-9" /><path d="M3 4v5h5" /><path d="M9 9h7M9 13h7M9 17h4" /></svg></span><div className="tx">回顾上下文</div></div>
        <div className="box">
          <input
            type="text"
            value={value}
            placeholder="输入你想说的话…"
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onInputKey}
            style={{ width: "100%", border: "none", outline: "none", background: "transparent", font: "inherit", color: "var(--ink)" }}
          />
        </div>
        <div className="send" style={{ cursor: "pointer" }} onClick={() => onSend()}><span className="ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 3L3 11l7 3 3 7z" /><path d="M21 3l-11 11" /></svg></span><span className="zh">发送</span><span className="en">ENTER</span></div>
      </div>

      {/* 右侧资料卡 */}
      <div className="rcard">
        <div className="tabs">
          <a className="on">档案</a>
          <a><span className="en">VOICE</span></a>
          <a>礼物</a>
        </div>
        <div className="portrait">
          {active && active.avatar
            ? <img src={active.avatar} alt="" />
            : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", background: "#cdb49a", color: "#fff", fontFamily: "var(--serif)", fontSize: 64 }}>{initial}</div>}
          <div className="name"><b>{active ? active.name : "未选择角色"}</b></div>
        </div>
        {active && active.persona ? <div className="tagline">{active.persona}</div> : null}
        <div className="desc">
          <div className="dh"><b>人物简介</b><i></i></div>
          <p>{(active && (active.description || active.persona)) || "选择左侧角色，查看其设定与简介。"}</p>
        </div>
      </div>

    </div>
  );
}

window.ReconChat = ReconChat;
