// 极简回退 sample —— 仅保证无 props 时（测试页）能渲染、不白屏。
// 真实数据一律来自 props（user / presets / saves），下面 派生层 优先消费 props。
const SAMPLE = {
  user: null,
  presets: [
    {
      name: "示例故事",
      data: {
        name: "示例故事", synopsis: "一个等你走进的故事。", tags: ["示例", "互动"],
        author: "店内收录", cover: null,
        characters: [{ data: { name: "旅人", persona: "", description: "" } }],
        story: { title: "示例故事", premise: "" },
        world: "一座尚未命名的城。",
        playables: [{ name: "你", persona: "" }],
      },
    },
  ],
  saves: [],
};

function ReconProfile(props) {
  const P = props || {};
  const user = P.user !== undefined ? P.user : SAMPLE.user;
  const presets = P.presets || SAMPLE.presets;
  const saves = P.saves || SAMPLE.saves;
  const onNav = P.onNav || (() => {});
  const onResume = P.onResume || (() => {});
  const onNew = P.onNew || (() => {});

  // ---- 派生：档案 ----
  const profileName = user ? (user.display_name || user.username) : "访客";
  const uidLine = user ? ("账户 · " + (user.role || "user")) : "未登录 · 游客模式";
  const avatarSrc = (user && user.avatar) || "assets/recon/profile-avatar.png";

  // ---- 头像上传:居中裁方 + 压缩到 256×256 JPEG(尺寸处理在客户端,服务端只收小图)----
  const fileRef = React.useRef(null);
  function pickAvatar(ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!f || !P.onAvatar) return;
    if (!/^image\//.test(f.type)) { alert("请选择图片文件"); return; }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      try {
        const S = 256, c = document.createElement("canvas");
        c.width = S; c.height = S;
        const x = c.getContext("2d");
        const m = Math.min(img.width, img.height);
        x.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
        P.onAvatar(c.toDataURL("image/jpeg", 0.85));
      } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); alert("图片读取失败"); };
    img.src = url;
  }

  // ---- 派生：真实计数 ----
  const _f = (x, k) => (x && x.data && x.data[k]) || undefined;
  const charCount = presets.reduce((s, p) => s + ((_f(p, "characters") || []).length), 0);
  const worldCount = presets.filter((p) => !!_f(p, "world")).length;
  const tagSet = new Set();
  presets.forEach((p) => (_f(p, "tags") || []).forEach((t) => tagSet.add(t)));
  const tagCount = tagSet.size;

  // ---- 派生：统计条 6 格（全部真实可得值）----
  const stats = [
    { label: "创作故事", num: String(presets.length), small: null, tot: "本" },
    { label: "进行中", num: String(saves.length), small: null, tot: "局" },
    { label: "角色卡", num: String(charCount), small: null, tot: "张" },
    { label: "故事书", num: String(presets.length), small: null, tot: "本" },
    { label: "世界设定", num: String(worldCount), small: null, tot: "个" },
    { label: "标签", num: String(tagCount), small: null, tot: "类" },
  ];

  // ---- 派生：最近游玩（saves.slice(0,4)）----
  // 封面只用库里真实 cover:按故事名匹配预设的 data.cover;匹配不到 = 中性书封(不放假图)。
  const _coverOf = (nm) => {
    if (!nm) return "";
    const hit = presets.find((p) => {
      const d = (p && p.data) || {};
      return d.name === nm || (d.story && d.story.title === nm) || p.name === nm;
    });
    return (hit && hit.data && hit.data.cover) || "";
  };
  const recent = saves.slice(0, 4).map((s) => {
    const nm = s.name || s.summary || "未命名存档";
    return { id: s.id, cover: _coverOf(nm), nm, rd: "第 " + (s.turns || 0) + " 回合" };
  });

  // ---- 派生：我的资产（由 presets 派生的真实计数）----
  const assets = [
    { lb: "角色卡", num: String(charCount) },
    { lb: "故事书", num: String(presets.length) },
    { lb: "世界设定", num: String(worldCount) },
    { lb: "标签", num: String(tagCount) },
  ];

  return (
    <div className="cv-profile">
      <style>{`
  .cv-profile {
    --bg:#f3ece0; --paper:#faf4ea; --paper2:#f6efe2;
    --ink:#2c2820; --soft:#6f6757; --faint:#9a907a;
    --line:#ddd0b4; --line2:#c4b388;
    --gold:#a98a63; --gold2:#c1a86f;
    --navy:#163b57; --navy-deep:#0d2f49; --navy-line:#b99a59;
    --green:#34463d; --green2:#4e5a55;
    --serif:"Songti SC","STSong","SimSun",serif;
    --serifen:Georgia,"Times New Roman",serif;
    --kai:"Kaiti SC","STKaiti","KaiTi",serif;
  }
  .cv-profile * {box-sizing:border-box;}
  .cv-profile {
    position:relative; width:1536px; height:1024px; overflow:hidden;
    background:
      repeating-linear-gradient(90deg, rgba(169,138,99,.025) 0 1px, transparent 1px 44px),
      var(--bg);
    color:var(--ink); font-family:var(--kai);
  }

  
  .cv-profile .rail {position:absolute; left:0; top:0; bottom:0; width:262px; z-index:10;
    background:linear-gradient(180deg,#f3ede6,#efe8df);
    border-right:1px solid var(--line);}
  .cv-profile .rail::after {content:""; position:absolute; right:0; top:0; bottom:0; width:1px;
    background:linear-gradient(180deg,transparent,var(--line2) 10%,var(--line2) 90%,transparent);}
  .cv-profile .rail .brand {position:absolute; left:24px; top:26px; display:flex; align-items:center; gap:11px;}
  .cv-profile .rail .brand .em {width:38px; height:38px; object-fit:contain;}
  .cv-profile .rail .brand h1 {margin:0; font-family:var(--serifen); font-weight:600; font-size:17px; letter-spacing:.06em; color:var(--navy);}
  .cv-profile .rail .brand .sub {font-family:var(--kai); font-size:9.5px; letter-spacing:.34em; color:var(--faint); margin-top:3px;}

  .cv-profile .nav {position:absolute; left:0; right:0; top:108px;}
  .cv-profile .nav a {position:relative; display:flex; align-items:center; gap:14px; height:54px; padding:0 22px; text-decoration:none; cursor:pointer;}
  .cv-profile .nav a .ic {width:22px; height:22px; flex:none; color:var(--soft); display:grid; place-items:center;}
  .cv-profile .nav a .tx .zh {font-family:var(--serif); font-size:15px; letter-spacing:.14em; color:var(--soft);}
  .cv-profile .nav a .tx .en {font-family:var(--serifen); font-size:8px; letter-spacing:.28em; color:var(--faint); margin-top:2px;}
  .cv-profile .nav a.on {background:linear-gradient(90deg,var(--green) 0%, var(--green2) 100%);}
  .cv-profile .nav a.on::before {content:""; position:absolute; left:0; top:8px; bottom:8px; width:3px; background:var(--gold2);}
  .cv-profile .nav a.on .ic {color:#e9e2d2;}
  .cv-profile .nav a.on .tx .zh {color:#f1ebdd; font-weight:700;}
  .cv-profile .nav a.on .tx .en {color:rgba(241,235,221,.65);}

  .cv-profile .qchar {position:absolute; left:11px; right:11px; bottom:0; height:424px;
    background:bottom/cover no-repeat url(assets/recon/profile-qchar.png);}

  
  .cv-profile .top {position:absolute; left:188px; right:0; top:0; height:108px; z-index:8;}
  .cv-profile .top::after {content:""; position:absolute; left:34px; right:40px; bottom:0; height:1px;
    background:linear-gradient(90deg,transparent,var(--line2) 4%,var(--line2) 96%,transparent);}
  .cv-profile .top .ttl {position:absolute; left:34px; top:30px; display:flex; align-items:baseline; gap:16px;}
  .cv-profile .top .ttl h2 {margin:0; font-family:var(--serif); font-weight:700; font-size:27px; letter-spacing:.1em; color:var(--ink);}
  .cv-profile .top .ttl .en {font-family:var(--serifen); font-style:italic; font-size:16px; letter-spacing:.06em; color:var(--gold);}
  .cv-profile .top .sub {position:absolute; left:36px; top:70px; font-family:var(--kai); font-size:12px; letter-spacing:.06em; color:var(--faint);}

  .cv-profile .top .tr {position:absolute; right:36px; top:30px; display:flex; align-items:center; gap:18px;}
  .cv-profile .top .clock {display:flex; align-items:center; gap:9px;}
  .cv-profile .top .clock .cic {width:30px; height:30px; border-radius:50%; border:1px solid var(--line2); color:var(--gold); display:grid; place-items:center;}
  .cv-profile .top .clock .ct .lb {font-family:var(--kai); font-size:8.5px; letter-spacing:.18em; color:var(--faint);}
  .cv-profile .top .clock .ct .vl {font-family:var(--serifen); font-size:15px; letter-spacing:.04em; color:var(--soft); margin-top:1px;}
  .cv-profile .top .ic {width:34px; height:34px; border-radius:50%; border:1px solid var(--line2); color:var(--soft); display:grid; place-items:center; position:relative;}
  .cv-profile .top .ic .dot {position:absolute; right:7px; top:7px; width:5px; height:5px; border-radius:50%; background:#b5402e;}
  .cv-profile .top .av {width:38px; height:38px; border-radius:50%; object-fit:cover; border:1px solid var(--line2);}

  
  .cv-profile .main {position:absolute; left:212px; right:32px; top:120px; bottom:18px;}

  
  .cv-profile .profile {position:relative; height:152px; background:var(--paper); border:1px solid var(--line);}
  .cv-profile .profile::before {content:""; position:absolute; inset:5px; border:1px solid rgba(196,179,132,.4); pointer-events:none;}
  .cv-profile .profile .av {position:absolute; left:20px; top:11px; width:128px; height:128px; border-radius:50%; object-fit:cover; border:2px solid var(--line2);}
  .cv-profile .profile .head {position:absolute; left:170px; top:18px; display:flex; align-items:center; gap:10px;}
  .cv-profile .profile .head .nm {font-family:var(--serif); font-weight:700; font-size:23px; letter-spacing:.06em; color:var(--ink);}
  .cv-profile .profile .head .edit {color:var(--gold); display:grid; place-items:center;}
  .cv-profile .profile .lvrow {position:absolute; left:172px; top:52px; display:flex; align-items:center; gap:12px;}
  .cv-profile .profile .lvrow .lv {display:inline-flex; align-items:center; height:21px; padding:0 10px; border-radius:4px; background:var(--green); color:#efe7d4; font-family:var(--serifen); font-size:11.5px; font-weight:700; letter-spacing:.06em;}
  .cv-profile .profile .lvrow .xp {position:relative; width:210px; height:4px; background:var(--line); border-radius:2px;}
  .cv-profile .profile .lvrow .xp i {position:absolute; left:0; top:0; bottom:0; width:68%; background:linear-gradient(90deg,var(--gold),var(--gold2)); border-radius:2px;}
  .cv-profile .profile .lvrow .xpn {font-family:var(--serifen); font-size:11px; letter-spacing:.04em; color:var(--faint);}
  .cv-profile .profile .sig {position:absolute; left:172px; top:84px; font-family:var(--kai); font-size:13px; color:var(--soft); letter-spacing:.04em;}
  .cv-profile .profile .uid {position:absolute; left:172px; bottom:18px; font-family:var(--serifen); font-size:10.5px; letter-spacing:.08em; color:var(--faint);}
  .cv-profile .profile .heroimg {position:absolute; right:0; top:0; bottom:0; width:480px; opacity:.92;
    background:center/cover no-repeat url(assets/recon/profile-room.png);
    -webkit-mask-image:linear-gradient(90deg,transparent,#000 42%); mask-image:linear-gradient(90deg,transparent,#000 42%);}

  
  .cv-profile .stats {position:relative; height:96px; margin-top:14px; display:flex; gap:12px;}
  .cv-profile .stat {flex:1; position:relative; background:var(--paper); border:1px solid var(--line); display:flex; align-items:center; gap:13px; padding:0 16px;}
  .cv-profile .stat .em {width:42px; height:42px; flex:none; color:var(--gold); display:grid; place-items:center;}
  .cv-profile .stat .em svg {opacity:.85;}
  .cv-profile .stat .lb {font-family:var(--kai); font-size:11px; letter-spacing:.08em; color:var(--soft);}
  .cv-profile .stat .num {font-family:var(--serifen); font-size:30px; font-weight:700; color:var(--ink); line-height:1.05; margin-top:2px;}
  .cv-profile .stat .num small {font-size:15px; font-weight:600; color:var(--soft); margin-left:1px;}
  .cv-profile .stat .tot {font-family:var(--kai); font-size:9px; letter-spacing:.12em; color:var(--faint); margin-top:1px;}

  
  .cv-profile .cols {display:flex; gap:16px; margin-top:16px;}
  .cv-profile .colL {width:568px; flex:none;}
  .cv-profile .colR {flex:1;}

  .cv-profile .sec-h {display:flex; align-items:center; gap:11px; margin-bottom:11px;}
  .cv-profile .sec-h b {font-family:var(--serif); font-size:16px; font-weight:700; letter-spacing:.12em; color:var(--ink);}
  .cv-profile .sec-h .en {font-family:var(--serifen); font-size:9px; letter-spacing:.26em; color:var(--gold);}
  .cv-profile .sec-h .all {margin-left:auto; font-family:var(--kai); font-size:11px; letter-spacing:.04em; color:var(--soft);}

  
  .cv-profile .recent {display:flex; gap:14px;}
  .cv-profile .rcard {flex:1; background:var(--paper); border:1px solid var(--line); padding:7px;}
  .cv-profile .rcard .th {width:100%; height:100px; object-fit:cover; border:1px solid rgba(169,138,99,.3); display:block;}
  .cv-profile .rcard .thn {background:linear-gradient(160deg,#efe6d2,#e0d3b6); display:grid; place-items:center;}
  .cv-profile .rcard .thn b {font-family:var(--serif); font-size:18px; letter-spacing:.18em; color:var(--gold); font-weight:700;}
  .cv-profile .rcard .nm {font-family:var(--serif); font-size:13px; font-weight:700; color:var(--ink); margin-top:8px; letter-spacing:.03em;}
  .cv-profile .rcard .rd {font-family:var(--kai); font-size:9.5px; letter-spacing:.06em; color:var(--faint); margin-top:4px;}
  .cv-profile .rcard .pl {display:flex; justify-content:space-between; align-items:center; font-family:var(--kai); font-size:9.5px; color:var(--soft); margin-top:8px;}
  .cv-profile .rcard .pl b {font-family:var(--serifen); color:var(--green); font-weight:700;}
  .cv-profile .rcard .bar {height:3px; background:var(--line); margin-top:5px; position:relative;}
  .cv-profile .rcard .bar i {position:absolute; left:0; top:0; bottom:0; background:var(--green2);}

  
  .cv-profile .assets {display:flex; gap:12px; margin-top:24px;}
  .cv-profile .acard {flex:1; background:var(--paper); border:1px solid var(--line); padding:12px 4px 11px; text-align:center;}
  .cv-profile .acard .em {height:30px; color:var(--gold); display:grid; place-items:center; margin-bottom:7px;}
  .cv-profile .acard .lb {font-family:var(--serif); font-size:12px; font-weight:700; letter-spacing:.04em; color:var(--ink);}
  .cv-profile .acard .num {font-family:var(--serifen); font-size:21px; font-weight:700; color:var(--ink); margin-top:3px;}

  
  .cv-profile .panel {background:var(--paper); border:1px solid var(--line); padding:13px 16px;}
  .cv-profile .ach {margin-top:0;}
  .cv-profile .ach .row {display:flex; align-items:center; gap:12px; padding:9px 0; border-bottom:1px solid rgba(221,208,180,.5);}
  .cv-profile .ach .row:last-child {border-bottom:none;}
  .cv-profile .ach .ico {width:34px; height:34px; flex:none; border:1px solid var(--line2); border-radius:50%; display:grid; place-items:center; color:var(--gold); background:var(--paper2);}
  .cv-profile .ach .ico img {width:30px; height:30px; border-radius:50%; object-fit:cover;}
  .cv-profile .ach .tx {flex:1; min-width:0;}
  .cv-profile .ach .tx b {display:block; font-family:var(--serif); font-size:13px; font-weight:700; color:var(--ink); letter-spacing:.03em;}
  .cv-profile .ach .tx p {margin:3px 0 0; font-family:var(--kai); font-size:10px; color:var(--faint); letter-spacing:.03em;}
  .cv-profile .ach .dt {font-family:var(--serifen); font-size:10px; color:var(--faint); letter-spacing:.04em;}

  
  .cv-profile .cardsrow {display:flex; gap:10px; margin-top:11px;}
  .cv-profile .cardsrow img {height:96px; width:auto;}

  
  .cv-profile .sigbox {margin-top:16px;}
  .cv-profile .sigbox .hd {display:flex; align-items:center; gap:10px;}
  .cv-profile .sigbox .hd b {font-family:var(--serif); font-size:14px; font-weight:700; letter-spacing:.1em; color:var(--ink);}
  .cv-profile .sigbox .hd .en {font-family:var(--serifen); font-size:8px; letter-spacing:.24em; color:var(--gold);}
  .cv-profile .sigbox .hd .edit {margin-left:auto; font-family:var(--kai); font-size:10px; color:var(--soft); display:flex; align-items:center; gap:4px;}
  .cv-profile .sigbox .qt {font-family:var(--kai); font-size:14px; letter-spacing:.1em; color:var(--soft); margin-top:14px; text-align:center; line-height:1.9;}
`}</style>

      {/* ============ 左竖栏 ============ */}
      {/* 左侧引擎竖栏(全站统一 ReconRail) */}
      <window.ReconRail active="mine" onNav={onNav} />

      {/* ============ 顶栏 ============ */}
      <div className="top">
        <div className="ttl"><h2>个人中心</h2><span className="en">Personal Center</span></div>
        <div className="sub">管理你的档案、故事与卡牌资产</div>
        <div className="tr">
          <div className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/></svg></div>
          <div className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 6l9 7 9-7"/></svg></div>
          <div className="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/></svg></div>
          <img className="av" src={(user && user.avatar) || "assets/recon/profile-headavatar.png"} alt="" />
          {user && P.onLogout ? (
            <span onClick={P.onLogout} style={{ cursor: "pointer", fontFamily: "var(--serif)", fontSize: 12.5, letterSpacing: ".1em", color: "var(--soft)", border: "1px solid var(--line2)", padding: "7px 14px" }}>退出登录</span>
          ) : null}
        </div>
      </div>

      {/* ============ 主区 ============ */}
      <div className="main">

        {/* 档案卡(点头像可上传更换;客户端裁方压缩) */}
        <div className="profile">
          <div className="heroimg"></div>
          <img className="av" src={avatarSrc} alt="" title={user ? "点击更换头像" : undefined}
               style={user && P.onAvatar ? { cursor: "pointer" } : undefined}
               onClick={() => { if (user && P.onAvatar && fileRef.current) fileRef.current.click(); }} />
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={pickAvatar} />
          <div className="head">
            <span className="nm">{profileName}</span>
          </div>
          <div className="uid">{uidLine}</div>
        </div>

        {/* 统计条 */}
        <div className="stats">
          {[
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 7h13l4 4v18H9z"/><path d="M13 13h9M13 18h9M13 23h6"/><path d="M22 7v4h4"/></svg>,
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="11"/><path d="M18 11v7l5 3"/></svg>,
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6l2 9 9-1-7 5 4 8-8-6-8 6 4-8-7-5 9 1z"/></svg>,
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 8h11l3 3v17l-4-2-4 2-4-2-2 1z"/><path d="M15 14l3-3 3 3"/></svg>,
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="15" r="7"/><path d="M14 21l-2 8 6-3 6 3-2-8"/></svg>,
            <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8l2.2 6.5L27 16l-5.5 2L19 25l-3-5-5-2 5.5-1.5z"/></svg>,
          ].map((icon, i) => (
            <div className="stat" key={i}><span className="em">{icon}</span>
              <div><div className="lb">{stats[i].label}</div><div className="num">{stats[i].num}{stats[i].small && <small>{stats[i].small}</small>}</div><div className="tot">{stats[i].tot}</div></div></div>
          ))}
        </div>

        {/* 二栏 */}
        <div className="cols">
          {/* 左栏 */}
          <div className="colL">
            <div className="sec-h"><b>最近游玩</b><span className="en">RECENT PLAYED</span><span className="all" style={{ cursor: "pointer" }} onClick={() => onNav("home")}>查看全部 ›</span></div>
            <div className="recent">
              {!recent.length && (
                <div className="rcard" style={{ flex: "1 0 100%", textAlign: "center", padding: "22px 14px", cursor: "pointer" }} onClick={onNew}>
                  <div className="nm">还没有进行中的故事</div>
                  <div className="rd" style={{ marginTop: 8 }}>去「创作」开局,写下你的第一回合 ›</div>
                </div>
              )}
              {recent.map((r, i) => (
                <div className="rcard" key={i} style={{ cursor: "pointer" }} onClick={() => onResume(r.id)}>
                  {r.cover
                    ? <img className="th" src={r.cover} alt="" />
                    : <div className="th thn"><b>{(r.nm || "书").slice(0, 4)}</b></div>}
                  <div className="nm">{r.nm}</div><div className="rd">{r.rd}</div></div>
              ))}
            </div>

            <div className="sec-h" style={{ marginTop: "24px" }}><b>我的资产</b><span className="en">MY ASSETS</span><span className="all" style={{ cursor: "pointer" }} onClick={() => onNav("build")}>查看全部 ›</span></div>
            <div className="assets" style={{ marginTop: "0" }}>
              {[
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="3" width="18" height="24"/><circle cx="15" cy="12" r="3.4"/><path d="M9.5 22c1-3 3.2-4.4 5.5-4.4S19.5 19 20.5 22"/></svg>,
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"><path d="M15 7C13 5 9 5 6 6v18c3-1 7-1 9 1 2-2 6-2 9-1V6c-3-1-7-1-9 1z"/><path d="M15 7v19"/></svg>,
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="15" cy="15" r="11"/><path d="M15 4v22M4 15h22"/><path d="M15 8l3.2 3.8L23 15l-4.8 3.2L15 22l-3.2-3.8L7 15l4.8-3.2z"/></svg>,
                <svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3v24M3 15h24"/><path d="M15 9l2 4 4 2-4 2-2 4-2-4-4-2 4-2z"/></svg>,
              ].map((icon, i) => (
                <div className="acard" key={i}><div className="em">{icon}</div><div className="lb">{assets[i].lb}</div><div className="num">{assets[i].num}</div></div>
              ))}
            </div>
          </div>

          {/* 右栏 —— 成就/卡牌/签名系统后端尚无,整块中性化为「暂无」 */}
          <div className="colR">
            <div className="sec-h"><b>我的成就</b><span className="en">ACHIEVEMENT</span></div>
            <div className="panel ach">
              <div className="row">
                <span className="ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 4h12v16l-6-3-6 3z"/></svg></span>
                <div className="tx"><b>暂无成就</b><p>随着你创作与游玩,这里会逐步解锁。</p></div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

window.ReconProfile = ReconProfile;
