function ReconHome(props) {
  const SAMPLE = {
    brand: {
      emblem: "assets/recon/home-emblem.png",
      title: "Narrative Engine",
      sub: "每个选择 · 都在书写",
    },
    hero: {
      art: "assets/recon/home-hero-art.png",
      idx: { cur: "01", total: "05" },
      kick: "Interactive Narrative",
      leadLine1: "与角色相遇,在动态叙事里开启属于你的旅程。",
      leadLine2: "每一个选择都被记住——故事因你而无可复制。",
    },
    pillars: [
      { zh: "角色卡", en: "CHARACTER", p: "为每个角色立心立志,角色据此说话行事。", icon: "char" },
      { zh: "世界书", en: "WORLD", p: "设定写进世界书,叙事始终自洽。", icon: "world" },
      { zh: "多结局", en: "ENDINGS", p: "你的选择被记住,结局因你分叉。", icon: "endings" },
      { zh: "即时互动", en: "REALTIME", p: "自由输入行动与台词,故事即时回应。", icon: "realtime" },
    ],
  };

  const P = props || {};
  const presets = P.presets || [];
  const user = P.user || null;
  const onNav = P.onNav || (() => {});
  const onOpenStory = P.onOpenStory || (() => {});
  const onNew = P.onNew || (() => {});
  const onLogin = P.onLogin || (() => {});
  const _isTut = (x) => { const d = (x && x.data) || {}; return ((d.tags || []).includes("教学")) || (((x && x.name) || "").includes("新人入店")) || ((d.name || "").includes("新人入店")); };
  const _name = (x) => (x && x.data && x.data.name) || (x && x.name) || "未命名故事";
  const _f = (x, k) => x && x.data && x.data[k];
  // 封面只用库里真实 cover;没有就中性书封(不放与故事无关的假图)。
  const brand = SAMPLE.brand;
  const pillars = SAMPLE.pillars;
  const hero = Object.assign({}, SAMPLE.hero, { idx: { cur: "01", total: String(Math.max(presets.length, 1)).padStart(2, "0") } });
  const featured = presets.find((x) => !_isTut(x)) || presets[0] || null;
  const rowRef = React.useRef(null);
  const scrollRow = (dx) => { const el = rowRef.current; if (el) el.scrollBy({ left: dx, behavior: "smooth" }); };
  const cards = presets.map((x, i) => ({
    preset: x, no: String(i + 1).padStart(2, "0"),
    cover: _f(x, "cover") || "",
    title: _name(x),
    tags: ((_f(x, "tags") || []).slice(0, 2).join(" · ")) || "互动叙事",
    syn: _f(x, "synopsis") || (_f(x, "story") && _f(x, "story").premise) || "一个等你走进的故事。",
    chars: (_f(x, "characters") || []).length, author: _f(x, "author") || "店内收录", isNew: _isTut(x),
  }));
  // 营销门面(landing)顶栏:首页=本页;其余直接进功能区(词汇与全站 ReconRail 一致)。
  const menu = [
    { zh: "首页", en: "HOME", view: "landing", on: true },
    { zh: "故事库", en: "LIBRARY", view: "home" },
    { zh: "创作", en: "CREATE", view: "build" },
    { zh: "聊天", en: "CHAT", view: "chat" },
    { zh: "我的", en: "PROFILE", view: "mine" },
  ];
  const goExplore = () => onNav("home");
  const startFeatured = () => (featured ? onOpenStory(featured) : onNew());

  const pillarIcon = (kind) => {
    if (kind === "char") {
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5 21c0-4 3.4-6 7-6s7 2 7 6"/></svg>
      );
    }
    if (kind === "world") {
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/></svg>
      );
    }
    if (kind === "endings") {
      return (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="2.2"/><circle cx="18" cy="6" r="2.2"/><circle cx="12" cy="19" r="2.2"/><path d="M6 8.2v1.8c0 3 6 3 6 6.6M18 8.2v1.8c0 3-6 3-6 6.6"/></svg>
      );
    }
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>
    );
  };

  return (
    <div className="cv-home">
      <style>{`
  .cv-home {
    --bg:#f3ece0; --paper:#faf4ea; --paper2:#f6efe2;
    --ink:#2c2820; --soft:#6f6757; --faint:#9a907a;
    --line:#ddd0b4; --line2:#c4b388;
    --gold:#a98a63; --gold2:#c1a86f;
    --navy:#163b57; --navy-deep:#0d2f49; --navy-line:#b99a59;
    --hl:#1d4063;
    --serif:"Songti SC","STSong","SimSun",serif;
    --serifen:Georgia,"Times New Roman",serif;
    --kai:"Kaiti SC","STKaiti","KaiTi",serif;
  }
  .cv-home * {box-sizing:border-box;}
  .cv-home {
    position:relative; width:1672px; height:941px; overflow:hidden;
    background:
      repeating-linear-gradient(90deg, rgba(169,138,99,.030) 0 1px, transparent 1px 42px),
      var(--bg);
    color:var(--ink); font-family:var(--kai);
  }
  
  .cv-home .edge {position:absolute; left:14px; top:120px; bottom:120px; width:2px;
    background:linear-gradient(180deg,transparent,var(--gold) 12%,var(--gold) 88%,transparent); opacity:.5;}
  .cv-home .edge::before {content:""; position:absolute; left:-3px; top:-10px; width:8px; height:8px; border:1px solid var(--gold); transform:rotate(45deg);}

  
  .cv-home .nav {position:absolute; left:0; right:0; top:0; height:88px; z-index:20;}
  .cv-home .nav::after {content:""; position:absolute; left:40px; right:40px; bottom:0; height:1px;
    background:linear-gradient(90deg,transparent,var(--line2) 8%,var(--line2) 92%,transparent);}
  .cv-home .brand {position:absolute; left:40px; top:21px; display:flex; align-items:center; gap:13px;}
  .cv-home .brand .em {width:46px; height:46px; object-fit:contain;}
  .cv-home .brand h1 {margin:0; font-family:var(--serifen); font-weight:600; font-size:25px; letter-spacing:.04em; color:var(--navy);}
  .cv-home .brand .sub {font-family:var(--kai); font-size:11.5px; letter-spacing:.42em; color:var(--faint); margin-top:3px;}
  .cv-home .menu {position:absolute; left:392px; top:24px; display:flex; gap:46px;}
  .cv-home .menu a {text-decoration:none; text-align:center; display:block; cursor:pointer;}
  .cv-home .menu .zh {font-family:var(--serif); font-size:17px; letter-spacing:.18em; color:var(--soft);}
  .cv-home .menu .en {font-family:var(--serifen); font-size:8.5px; letter-spacing:.34em; color:var(--faint); margin-top:5px;}
  .cv-home .menu a.on .zh {color:var(--navy); font-weight:700;}
  .cv-home .menu a.on::after {content:""; display:block; width:20px; height:2px; background:var(--navy); margin:6px auto 0;}
  .cv-home .nr {position:absolute; right:40px; top:20px; display:flex; align-items:center; gap:22px;}
  .cv-home .nr .ic {width:38px; height:38px; border-radius:50%; border:1px solid var(--line2); color:var(--soft); display:grid; place-items:center;}
  .cv-home .nr .login {text-align:center;}
  .cv-home .nr .login .zh {font-family:var(--serif); font-size:15px; letter-spacing:.12em; color:var(--soft);}
  .cv-home .nr .login .en {font-family:var(--serifen); font-size:8px; letter-spacing:.3em; color:var(--faint); margin-top:3px;}
  .cv-home .nr .cta {position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center;
    height:52px; padding:0 26px 0 44px; background:var(--navy); border:1px solid var(--navy-deep); cursor:pointer;}
  .cv-home .nr .cta::before {content:""; position:absolute; inset:3px; border:1px solid rgba(185,154,89,.55);}
  .cv-home .nr .cta .zh {font-family:var(--serif); font-size:15px; letter-spacing:.2em; color:#f3ead6; position:relative;}
  .cv-home .nr .cta .en {font-family:var(--serifen); font-size:8px; letter-spacing:.36em; color:rgba(243,234,214,.7); margin-top:2px; position:relative;}
  .cv-home .nr .cta .cmp {position:absolute; left:16px; top:50%; transform:translateY(-50%); color:var(--gold2);}

  
  .cv-home .hero-art {position:absolute; right:0; top:86px; width:1020px; height:474px; z-index:1;
    background:center/cover no-repeat url(assets/recon/home-hero-art.png);}
  .cv-home .idx {position:absolute; left:36px; top:168px; text-align:center; z-index:3;}
  .cv-home .idx b {font-family:var(--serifen); font-size:21px; color:var(--navy); font-weight:600;}
  .cv-home .idx i {display:block; width:1px; height:40px; background:var(--line2); margin:7px auto;}
  .cv-home .idx s {font-family:var(--serifen); font-size:14px; color:var(--faint); text-decoration:none;}
  .cv-home .hero-tx {position:absolute; left:92px; top:150px; z-index:3; width:560px;}
  .cv-home .kick {display:flex; align-items:center; gap:13px; margin-bottom:18px;}
  .cv-home .kick span {font-family:var(--serifen); font-size:9.5px; letter-spacing:.36em; color:var(--gold); text-transform:uppercase;}
  .cv-home .kick i {width:56px; height:1px; background:var(--gold);}
  .cv-home .title {font-family:var(--serif); font-weight:700; font-size:62px; line-height:1.26; letter-spacing:.04em; color:var(--ink); margin:0;}
  .cv-home .title em {font-style:normal; color:var(--hl); position:relative;}
  .cv-home .title em::after {content:""; position:absolute; left:-2px; right:-2px; bottom:7px; height:11px; background:rgba(29,64,99,.12); z-index:-1;}
  .cv-home .lead {font-family:var(--kai); font-size:16px; line-height:2.05; color:var(--soft); margin:22px 0 0; max-width:430px;}
  .cv-home .btns {display:flex; align-items:center; gap:20px; margin-top:34px;}
  .cv-home .b1 {position:relative; display:inline-flex; align-items:center; gap:10px; height:54px; padding:0 32px;
    background:var(--navy); border:1px solid var(--navy-deep); color:#f3ead6;
    font-family:var(--serif); font-size:16px; letter-spacing:.18em; cursor:pointer;}
  .cv-home .b1::before {content:""; position:absolute; inset:3px; border:1px solid rgba(185,154,89,.5);}
  .cv-home .b1 .cmp {color:var(--gold2); position:relative;}
  .cv-home .b1 span {position:relative;}
  .cv-home .b2 {height:54px; padding:0 30px; background:transparent; border:1px solid var(--line2); color:var(--navy);
    font-family:var(--serif); font-size:16px; letter-spacing:.18em; cursor:pointer;}
  /* 进店:hero 文案/精选卡/今日推荐/亮点 轻错峰淡入 */
  @keyframes rch-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
  .cv-home .hero-tx { animation: rch-in .42s cubic-bezier(.22,1,.36,1) both; }
  .cv-home .hero-art { animation: rch-in .5s cubic-bezier(.22,1,.36,1) .06s both; }
  .cv-home .feat-h, .cv-home .more, .cv-home .arrow { animation: rch-in .4s cubic-bezier(.22,1,.36,1) .16s both; }
  .cv-home .card { animation: rch-in .38s cubic-bezier(.22,1,.36,1) both; }
  .cv-home .pick { animation: rch-in .4s cubic-bezier(.22,1,.36,1) .3s both; }
  .cv-home .pillars { animation: rch-in .4s cubic-bezier(.22,1,.36,1) .36s both; }
  @media (prefers-reduced-motion: reduce){ .cv-home .hero-tx, .cv-home .hero-art, .cv-home .feat-h, .cv-home .more, .cv-home .arrow, .cv-home .card, .cv-home .pick, .cv-home .pillars { animation-duration:1ms; animation-delay:0ms; } }
  /* 防 styles.css 全局 button 规则泄漏:圆角归零 + hover 不变深色 */
  .cv-home .b1, .cv-home .b2 {border-radius:0; min-height:0;}
  .cv-home .b1:hover:not(:disabled) {background:var(--navy); color:#f3ead6;}
  .cv-home .b2:hover:not(:disabled) {background:transparent; color:var(--navy);}

  
  .cv-home .feat-h {position:absolute; left:56px; top:584px; display:flex; align-items:baseline; gap:14px; z-index:3;}
  .cv-home .feat-h h3 {margin:0; font-family:var(--serif); font-size:21px; font-weight:700; letter-spacing:.14em; color:var(--ink);}
  .cv-home .feat-h .en {font-family:var(--serifen); font-size:10px; letter-spacing:.34em; color:var(--gold);}
  .cv-home .feat-h .dash {width:120px; height:1px; background:repeating-linear-gradient(90deg,var(--line2) 0 7px,transparent 7px 14px);}
  .cv-home .more {position:absolute; right:392px; top:586px; font-family:var(--serif); font-size:13px; letter-spacing:.1em; color:var(--soft); z-index:3;}

  .cv-home .arrow {position:absolute; top:660px; width:34px; height:34px; border:1px solid var(--line2); border-radius:50%;
    display:grid; place-items:center; color:var(--soft); background:var(--paper); z-index:4; cursor:pointer; font-size:16px;}
  .cv-home .arrow.l {left:18px;} .cv-home .arrow.r {left:1268px;}
  .cv-home .cards {position:absolute; left:62px; right:392px; top:614px; display:flex; gap:8px; z-index:3; overflow-x:auto; overflow-y:hidden; padding-bottom:6px; scroll-behavior:smooth;}
  .cv-home .cards::-webkit-scrollbar {height:6px;} .cv-home .cards::-webkit-scrollbar-thumb {background:var(--line2);}
  .cv-home .card {flex:none; width:240px; height:158px; background:var(--paper); border:1px solid var(--line); display:flex; padding:9px; gap:11px; position:relative;}
  .cv-home .card .th {width:92px; height:140px; flex:none; object-fit:cover; border:1px solid rgba(169,138,99,.3);}
  .cv-home .card .thn {background:linear-gradient(165deg,#efe6d2,#ddd0b2); display:grid; place-items:center;}
  .cv-home .card .thn b {writing-mode:vertical-rl; font-family:var(--serif); font-size:17px; letter-spacing:.22em; color:var(--gold); font-weight:700;}
  .cv-home .card .no {position:absolute; left:13px; top:13px; font-family:var(--serifen); font-size:13px; font-weight:700; color:#f3ead6; letter-spacing:.06em; text-shadow:0 1px 2px rgba(0,0,0,.5);}
  .cv-home .card .new {position:absolute; left:64px; top:11px; background:#b5402e; color:#f5ede2; font-family:var(--serif); font-size:9px; letter-spacing:.1em; padding:2px 5px;}
  .cv-home .card .bd {flex:1; min-width:0; padding-top:2px;}
  .cv-home .card .bd b {display:block; font-family:var(--serif); font-size:15.5px; font-weight:700; color:var(--ink); letter-spacing:.04em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-home .card .bd .tags {font-family:var(--kai); font-size:10.5px; color:var(--gold); margin-top:6px; letter-spacing:.06em;}
  .cv-home .card .bd .syn {font-family:var(--kai); font-size:11px; line-height:1.65; color:var(--soft); margin-top:7px;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
  .cv-home .card .bd .mt {position:absolute; left:112px; bottom:12px; display:flex; align-items:center; gap:10px; font-family:var(--serifen); font-size:11px; color:var(--soft);}
  .cv-home .card .bd .mt .star {color:var(--gold);}

  
  .cv-home .pick {position:absolute; right:40px; top:610px; width:330px; height:172px; background:var(--paper); border:1px solid var(--line); padding:14px 16px; z-index:3;}
  .cv-home .pick .ph {display:flex; align-items:baseline; gap:10px;}
  .cv-home .pick .ph b {font-family:var(--serif); font-size:14px; font-weight:700; letter-spacing:.16em; color:var(--ink);}
  .cv-home .pick .ph .en {font-family:var(--serifen); font-size:8.5px; letter-spacing:.3em; color:var(--gold);}
  .cv-home .pick .row {display:flex; gap:12px; margin-top:12px;}
  .cv-home .pick .row .cover {width:74px; height:104px; flex:none; background:linear-gradient(165deg,#efe6d2,#ddd0b2) center/cover no-repeat; border:1px solid rgba(169,138,99,.3);}
  .cv-home .pick .row .info b {font-family:var(--serif); font-size:15px; color:var(--ink); font-weight:700;}
  .cv-home .pick .row .info p {font-family:var(--kai); font-size:11px; line-height:1.7; color:var(--soft); margin:6px 0 0;}
  .cv-home .pick .gobtn {position:absolute; right:16px; bottom:14px; font-family:var(--serif); font-size:12.5px; letter-spacing:.1em; color:var(--navy); border:1px solid var(--navy-line); padding:6px 14px; cursor:pointer;}

  
  .cv-home .pillars {position:absolute; left:56px; right:56px; top:812px; height:104px; border-top:1px solid var(--line2);
    display:flex; align-items:center; gap:0; padding-top:18px; z-index:3;}
  .cv-home .pil {flex:1; display:flex; gap:13px; padding:0 26px; border-right:1px solid var(--line);}
  .cv-home .pil:first-child {padding-left:0;}
  .cv-home .pil .ic {width:42px; height:42px; flex:none; border:1px solid var(--gold); display:grid; place-items:center; color:var(--navy); background:var(--paper2);}
  .cv-home .pil b {font-family:var(--serif); font-size:15.5px; font-weight:700; color:var(--ink);}
  .cv-home .pil .en {font-family:var(--serifen); font-size:8.5px; letter-spacing:.3em; color:var(--faint); display:block; margin-top:2px;}
  .cv-home .pil p {font-family:var(--kai); font-size:11px; line-height:1.6; color:var(--soft); margin:5px 0 0;}
  .cv-home .stat {flex:none; width:200px; padding-left:30px; display:flex; flex-direction:column; justify-content:center;}
  .cv-home .stat b {font-family:var(--serifen); font-size:38px; font-weight:700; color:var(--navy); line-height:1;}
  .cv-home .stat span {font-family:var(--kai); font-size:11px; color:var(--soft); margin-top:5px;}
  .cv-home .stat .bar {height:4px; background:var(--line); margin-top:8px; position:relative;}
  .cv-home .stat .bar i {position:absolute; left:0; top:0; bottom:0; width:82.6%; background:var(--gold);}
`}</style>

      <div className="edge"></div>

      {/* 顶栏 */}
      <div className="nav">
        <div className="brand">
          <img className="em" src={brand.emblem} alt="" />
          <div>
            <h1>{brand.title}</h1>
            <div className="sub">{brand.sub}</div>
          </div>
        </div>
        <div className="menu">
          {menu.map((m, i) => (
            <a key={i} className={m.on ? "on" : undefined} onClick={() => onNav(m.view)}><div className="zh">{m.zh}</div><div className="en">{m.en}</div></a>
          ))}
        </div>
        <div className="nr">
          <div className="ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg></div>
          {/* 已登录显示账号(点击进个人中心);未登录(=AUTH 关的部署,登录墙不会放未登录用户到这)不摆死按钮 */}
          {user ? (
            <div className="login" onClick={onLogin} style={{ cursor: "pointer" }}><div className="zh">{user.display_name || user.username}</div><div className="en">ACCOUNT</div></div>
          ) : null}
          <div className="cta" onClick={goExplore}>
            <span className="cmp"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z"/></svg></span>
            <span className="zh">开始探索</span><span className="en">EXPLORE</span>
          </div>
        </div>
      </div>

      {/* HERO */}
      <div className="hero-art"></div>
      <div className="idx"><b>{hero.idx.cur}</b><i></i><s>{hero.idx.total}</s></div>
      <div className="hero-tx">
        <div className="kick"><span>{hero.kick}</span><i></i></div>
        <h1 className="title">进入<em>会回应</em>你的<br/>故事世界</h1>
        <p className="lead">{hero.leadLine1}<br/>{hero.leadLine2}</p>
        <div className="btns">
          <button className="b1" onClick={goExplore}><span className="cmp"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2 8 8 2-8 2-2 8-2-8-8-2 8-2z"/></svg></span><span>开始探索</span></button>
          <button className="b2" onClick={onNew}>立即创作</button>
        </div>
      </div>

      {/* 精选故事 */}
      <div className="feat-h"><h3>精选故事</h3><span className="en">FEATURED STORIES</span><span className="dash"></span></div>
      <div className="more">{cards.length} 个故事</div>
      <div className="arrow l" onClick={() => scrollRow(-500)}>‹</div>
      <div className="arrow r" onClick={() => scrollRow(500)}>›</div>
      <div className="cards" ref={rowRef}>
        {!cards.length && (
          <div className="card" style={{ width: 360, alignItems: "center", justifyContent: "center", cursor: "pointer" }} onClick={onNew}>
            <div className="bd" style={{ textAlign: "center", padding: 0 }}><b>书架还空着</b><div className="syn" style={{ WebkitLineClamp: 3, marginTop: 8 }}>还没有故事。去「创作」写第一本——丢设定进来,自动建卡成书。</div></div>
          </div>
        )}
        {cards.map((c, i) => (
          <div className="card" key={i} style={{ cursor: "pointer", animationDelay: (180 + Math.min(i, 6) * 60) + "ms" }} onClick={() => onOpenStory(c.preset)}>
            {c.cover
              ? <img className="th" src={c.cover} alt="" />
              : <div className="th thn"><b>{c.title.slice(0, 3)}</b></div>}
            <span className="no">{c.no}</span>{c.isNew ? <span className="new">教学</span> : null}
            <div className="bd"><b>{c.title}</b><div className="tags">{c.tags}</div><div className="syn">{c.syn}</div>
              <div className="mt"><span className="star">✦</span><span>{c.chars || "—"} 角色</span><span>·</span><span>{c.author}</span></div></div>
          </div>
        ))}
      </div>

      {/* 今日推荐 */}
      <div className="pick">
        <div className="ph"><b>今日推荐</b><span className="en">DAILY PICK</span></div>
        <div className="row">
          <div className="cover" style={featured && _f(featured, "cover") ? { backgroundImage: "url(" + _f(featured, "cover") + ")" } : undefined}></div>
          <div className="info"><b>{featured ? _name(featured) : "暂无"}</b><p>{featured ? (_f(featured, "synopsis") || (_f(featured, "story") && _f(featured, "story").premise) || "一个等你走进的故事。") : "还没有故事,去创作写第一本。"}</p></div>
        </div>
        <div className="gobtn" style={{ cursor: "pointer" }} onClick={() => (featured ? onOpenStory(featured) : onNew())}>{featured ? "取下这本书 ›" : "去创作 ›"}</div>
      </div>

      {/* 产品亮点 */}
      <div className="pillars">
        {pillars.map((p, i) => (
          <div className="pil" key={i}><span className="ic">{pillarIcon(p.icon)}</span>
            <div><b>{p.zh}</b><span className="en">{p.en}</span><p>{p.p}</p></div></div>
        ))}
        <div className="stat"><b>{presets.length}</b><span>收录故事 · IN LIBRARY</span><div className="bar"><i style={{ width: Math.min(presets.length * 12, 100) + "%" }}></i></div></div>
      </div>
    </div>
  );
}

window.ReconHome = ReconHome;
