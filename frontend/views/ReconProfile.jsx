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
  // 优先用 P.assets(app 拉的「用户自己的卡库」计数,AUTH 开时已滤掉官方公共卡);
  // 没传(standalone 测试)才回退 presets 推导。官方库不是个人资产,新号应显示 0。
  const _f = (x, k) => (x && x.data && x.data[k]) || undefined;
  const A = P.assets || null;
  const fallbackChar = presets.reduce((s, p) => s + ((_f(p, "characters") || []).length), 0);
  const fallbackWorld = presets.filter((p) => !!_f(p, "world")).length;
  const fallbackTags = (() => { const t = new Set(); presets.forEach((p) => (_f(p, "tags") || []).forEach((x) => t.add(x))); return t.size; })();
  const storyCount = A ? A.stories : presets.length;
  const charCount = A ? A.characters : fallbackChar;
  const worldCount = A ? A.worlds : fallbackWorld;
  const tagCount = A ? A.tags : fallbackTags;

  // ---- 派生：统计条 6 格（全部真实可得值;不再有同值重复格与对玩家无意义的「标签」）----
  const playerCount = A ? (A.players || 0) : 0;
  const totalCards = charCount + storyCount + worldCount + playerCount;
  const stats = [
    { label: "进行中", num: String(saves.length), small: null, tot: "局" },
    { label: "角色卡", num: String(charCount), small: null, tot: "张" },
    { label: "演出卡", num: String(playerCount), small: null, tot: "张" },
    { label: "故事书", num: String(storyCount), small: null, tot: "本" },
    { label: "世界设定", num: String(worldCount), small: null, tot: "个" },
    { label: "卡库合计", num: String(totalCards), small: null, tot: "张" },
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
  const recent = saves.slice(0, 8).map((s) => {
    const nm = s.name || s.summary || "未命名存档";
    return { id: s.id, cover: _coverOf(nm), nm, rd: "第 " + (s.turns || 0) + " 回合" + (s.updated ? " · " + String(s.updated).slice(0, 16) : ""), local: !!s.local };
  });
  const hasLocal = recent.some((r) => r.local);

  // ---- 我的预设(对照旧版 MineView「我建的预设」:列表 + 开始 + 删除)----
  const myPresets = presets.map((p) => {
    const d = (p && p.data) || {};
    return { raw: p, nm: d.name || p.name || "未命名故事", syn: d.synopsis || (d.story && d.story.premise) || "(无简介)", cover: d.cover || "", tags: (d.tags || []).slice(0, 4), author: d.author || "" };
  });

  // ---- 我的卡库(对照旧版 VaultView:四类卡浏览 + 删除;数据视图内自拉)----
  const LIB_KINDS = [["characters", "角色"], ["players", "演出"], ["worlds", "世界"], ["stories", "故事"]];
  const [libKind, setLibKind] = React.useState("characters");
  const [libItems, setLibItems] = React.useState(null);   // null=读取中
  React.useEffect(() => {
    let alive = true;
    setLibItems(null);
    fetch("/api/library/" + libKind).then((r) => (r.ok ? r.json() : [])).then((rows) => { if (alive) setLibItems(rows || []); }).catch(() => { if (alive) setLibItems([]); });
    return () => { alive = false; };
  }, [libKind]);
  async function delLibCard(it) {
    if (!confirm("删除卡「" + (it.name || "未命名") + "」?不可恢复。")) return;
    try {
      await fetch("/api/library/" + libKind + "/" + encodeURIComponent(it.name), { method: "DELETE" });
      setLibItems((xs) => (xs || []).filter((x) => x !== it));
    } catch (e) { alert("删除失败:" + (e.message || e)); }
  }
  const _libDesc = (it) => { const d = (it.data && it.data.data) || it.data || {}; return d.anchor || d.description || d.persona || d.premise || (d.entries ? d.entries.length + " 条目" : "") || ""; };
  const _libImg = (it) => { const d = (it.data && it.data.data) || it.data || {}; return d.image || d.avatar || d.cover || ""; };
  const _libTags = (it) => { const d = (it.data && it.data.data) || it.data || {}; return (d.tags || []).slice(0, 4).join(" · "); };
  const LIB_LABEL = { characters: "角色卡", players: "演出卡", worlds: "世界书", stories: "故事书" };

  // ---- 派生：我的资产（用户自己的卡;无 prop 时回退 presets 推导）----
  const assets = [
    { lb: "角色卡", num: String(charCount) },
    { lb: "故事书", num: String(storyCount) },
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
    position:relative; width:100%; height:100vh; min-height:640px; overflow:hidden;
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

  
  .cv-profile .top {position:absolute; left:216px; right:0; top:0; height:108px; z-index:8;}
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

  
  .cv-profile .main {position:absolute; left:240px; right:32px; top:120px; bottom:18px; overflow-y:auto; padding-right:4px;}
  .cv-profile .main::-webkit-scrollbar {width:7px;} .cv-profile .main::-webkit-scrollbar-thumb {background:var(--line2);}

  
  .cv-profile .profile {position:relative; height:152px; background:var(--paper); border:1px solid var(--line);}
  .cv-profile .profile::before {content:""; position:absolute; inset:5px; border:1px solid rgba(196,179,132,.4); pointer-events:none;}
  .cv-profile .profile .av {position:absolute; left:20px; top:11px; width:128px; height:128px; border-radius:50%; object-fit:cover; border:2px solid var(--line2);}
  /* 头像编辑入口:显式可见(相机角标 + 文字钮),不靠"点头像"这种隐形操作 */
  .cv-profile .profile .avedit {position:absolute; left:112px; top:104px; width:34px; height:34px; border-radius:50%;
    background:var(--green); border:1px solid #283831; display:grid; place-items:center; color:#f3ead6; cursor:pointer; z-index:3;
    box-shadow:0 2px 8px rgba(43,38,32,.25);}
  .cv-profile .profile .avedit:hover {background:#2c3a32;}
  .cv-profile .profile .avchip {display:inline-flex; align-items:center; gap:6px; font-family:var(--serif); font-size:11.5px;
    letter-spacing:.08em; color:var(--soft); cursor:pointer; border:1px solid var(--line2); background:var(--paper2); padding:4px 12px;}
  .cv-profile .profile .avchip:hover {color:var(--ink); border-color:var(--gold);}
  .cv-profile .profile .avchip svg {color:var(--gold);}
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
  .cv-profile .rcard .loc {position:absolute; left:10px; top:10px; z-index:2; font-family:var(--serif); font-size:9px; letter-spacing:.1em;
    color:#6f6757; background:rgba(250,244,234,.92); border:1px solid var(--line2); padding:1px 6px;}
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

  /* 退出登录(档案卡 uid 行内) */
  .cv-profile .profile .uid .logout {margin-left:14px; font-family:var(--serif); font-size:13px; color:var(--gold); cursor:pointer; letter-spacing:.06em;}
  .cv-profile .profile .uid .logout:hover {color:var(--ink);}
  /* 存档卡删除角标 */
  .cv-profile .rcard .rdel {position:absolute; right:8px; top:8px; z-index:3; width:22px; height:22px; display:grid; place-items:center;
    background:rgba(250,244,234,.9); border:1px solid var(--line2); color:var(--soft); font-size:12px; cursor:pointer;}
  .cv-profile .rcard .rdel:hover {color:#9a4a3a; border-color:#d8a99e;}
  /* 卡库分类签(整宽区) */
  .cv-profile .vtabs {display:flex; gap:8px; margin-top:12px;}
  .cv-profile .vtab {padding:7px 26px; font-family:var(--serif); font-size:15px; letter-spacing:.08em;
    color:var(--soft); cursor:pointer; border:1px solid var(--line); background:var(--paper); user-select:none;}
  .cv-profile .vtab.on {color:var(--ink); font-weight:700; border-color:var(--gold2); background:var(--paper2);}
  .cv-profile .vdim {font-family:var(--kai); font-size:15px; color:var(--faint); padding:26px 2px; text-align:center;}
  /* 市集翻转卡(与卡市集同款,RxMarketTile 在本页域内的样式) */
  @keyframes rcp-in { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }
  .cv-profile .mgrid {display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:18px; margin-top:18px;}
  .cv-profile .mcard {position:relative; height:236px; perspective:1000px; animation:rcp-in .38s cubic-bezier(.22,1,.36,1) both;
    transition:transform .3s cubic-bezier(.22,1,.36,1);}
  .cv-profile .mcard:hover {transform:translateY(-4px);}
  .cv-profile .mc-in {position:absolute; inset:0; transform-style:preserve-3d; transition:transform .45s cubic-bezier(.3,.8,.3,1);}
  .cv-profile .mcard.flip .mc-in {transform:rotateY(180deg);}
  .cv-profile .mc-f, .cv-profile .mc-b {position:absolute; inset:0; -webkit-backface-visibility:hidden; backface-visibility:hidden;
    background:var(--paper); border:1px solid var(--line);}
  .cv-profile .mcard:hover .mc-f, .cv-profile .mcard:hover .mc-b {box-shadow:0 14px 26px -16px rgba(43,38,32,.38);}
  .cv-profile .mc-f {padding:16px 18px 13px; display:flex; flex-direction:column;}
  .cv-profile .mc-f::after {content:""; position:absolute; inset:5px; border:1px solid rgba(196,179,132,.3); pointer-events:none;}
  .cv-profile .mc-b {transform:rotateY(180deg); overflow:hidden;}
  .cv-profile .mc-b .bimg {position:absolute; inset:0; background:center/cover no-repeat;}
  .cv-profile .mc-b .bnm {position:absolute; left:0; right:0; bottom:0; padding:28px 16px 11px;
    background:linear-gradient(180deg, rgba(34,29,22,0), rgba(34,29,22,.62)); color:#f5efe3;
    font-family:var(--serif); font-size:15px; letter-spacing:.06em;}
  .cv-profile .fbtn {width:30px; height:30px; flex:none; border-radius:50%; border:1px solid var(--line2); background:rgba(250,244,234,.92);
    color:var(--soft); display:grid; place-items:center; cursor:pointer; min-height:0; padding:0; font-size:14px; line-height:1;}
  .cv-profile .fbtn:hover {background:rgba(193,168,111,.25); color:var(--ink);}
  .cv-profile .mc-b .fbtn {position:absolute; right:9px; bottom:9px; background:rgba(34,29,22,.45); color:#f0e8d4; border-color:rgba(240,232,212,.55); z-index:3;}
  .cv-profile .mc-b .fbtn:hover {background:rgba(34,29,22,.65); color:#fff;}
  .cv-profile .mcard .mh {display:flex; align-items:center; gap:8px;}
  .cv-profile .badge {font-family:var(--serif); font-size:11.5px; letter-spacing:.08em; color:#8a6f49;
    border:1px solid var(--gold2); background:rgba(193,168,111,.12); padding:2px 9px; flex:none;}
  .cv-profile .minebdg {font-family:var(--kai); font-size:11px; color:#b5402e; border:1px solid rgba(181,64,46,.4); padding:2px 7px; flex:none;}
  .cv-profile .mcard b.nm {display:block; font-family:var(--serif); font-size:17px; font-weight:700; letter-spacing:.04em; margin-top:10px;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-profile .mcard .ds {font-family:var(--kai); font-size:15px; line-height:1.65; color:var(--soft); margin-top:7px; height:50px;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
  .cv-profile .mcard .tgs {font-family:var(--kai); font-size:12px; color:var(--gold); margin-top:7px; letter-spacing:.04em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-height:17px;}
  .cv-profile .mcard .ft {display:flex; align-items:center; gap:9px; margin-top:auto; border-top:1px solid var(--line); padding-top:10px;}
  .cv-profile .mbtn {height:31px; padding:0 15px; border:1px solid var(--navy-line); background:transparent; color:var(--navy);
    font-family:var(--serif); font-size:13.5px; letter-spacing:.08em; cursor:pointer; border-radius:0; min-height:0;}
  .cv-profile .mbtn:hover:not(:disabled) {background:rgba(185,154,89,.12); color:var(--navy);}
  .cv-profile .mbtn.pri {background:var(--green); color:#eef0e2; border-color:#283831;}
  .cv-profile .mbtn.pri:hover:not(:disabled) {background:#2c3a32; color:#eef0e2;}
  .cv-profile .mnote {font-family:var(--kai); font-size:12.5px; color:var(--faint); margin-left:auto;}
  .cv-profile .msp {flex:1;}
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
          {user && P.onAvatar ? (
            <span className="avedit" title="更换头像" onClick={() => fileRef.current && fileRef.current.click()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.4"/></svg>
            </span>
          ) : null}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={pickAvatar} />
          <div className="head">
            <span className="nm">{profileName}</span>
            {user && P.onAvatar ? (
              <span className="avchip" onClick={() => fileRef.current && fileRef.current.click()}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.2"/></svg>
                更换头像
              </span>
            ) : null}
          </div>
          <div className="uid">{uidLine}{user && P.onLogout ? <span className="logout" onClick={() => P.onLogout()}>退出登录</span> : null}</div>
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
            {/* 「查看全部」此前货不对板(跳故事库/创作向导)→ 文案兑现实际去向 */}
            <div className="sec-h"><b>最近游玩</b><span className="en">RECENT PLAYED</span><span className="all" style={{ cursor: "pointer" }} onClick={() => onNav("home")}>去故事库 ›</span></div>
            <div className="recent">
              {P.savesErr && (
                <div className="rcard" style={{ flex: "1 0 100%", textAlign: "center", padding: "16px 14px", cursor: "pointer" }} onClick={() => P.onRetrySaves && P.onRetrySaves()}>
                  <div className="nm">云端存档加载失败</div>
                  <div className="rd" style={{ marginTop: 8 }}>点击重试(本机存档不受影响)</div>
                </div>
              )}
              {!recent.length && !P.savesErr && (
                <div className="rcard" style={{ flex: "1 0 100%", textAlign: "center", padding: "22px 14px", cursor: "pointer" }} onClick={onNew}>
                  <div className="nm">还没有进行中的故事</div>
                  <div className="rd" style={{ marginTop: 8 }}>去「创作」开局,写下你的第一回合 ›</div>
                </div>
              )}
              {recent.map((r, i) => (
                <div className="rcard" key={i} style={{ cursor: "pointer", position: "relative" }} onClick={() => onResume(r.id)}>
                  {r.local && <span className="loc">仅本机</span>}
                  {P.onDeleteSave && (
                    <span className="rdel" title="删除这局存档" onClick={(e) => { e.stopPropagation(); P.onDeleteSave(r.id); }}>✕</span>
                  )}
                  {r.cover
                    ? <img className="th" src={r.cover} alt="" />
                    : <div className="th thn"><b>{(r.nm || "书").slice(0, 4)}</b></div>}
                  <div className="nm">{r.nm}</div><div className="rd">{r.rd}</div></div>
              ))}
            </div>
            {hasLocal && (
              <div style={{ fontSize: 11, color: "var(--faint)", marginTop: 8, letterSpacing: ".04em" }}>
                标记「仅本机」的存档只保存在当前浏览器;登录后玩的对局会跟随账号、可跨设备继续。
              </div>
            )}

            <div className="sec-h" style={{ marginTop: "24px" }}><b>我的资产</b><span className="en">MY ASSETS</span><span className="all" style={{ cursor: "pointer" }} onClick={() => onNav("build")}>去创作 ›</span></div>
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

          {/* 右栏 —— 成就占位 */}
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

        {/* ===== 我的预设(整宽卡片网格,沿用卡市集翻转卡效果) ===== */}
        <div className="sec-h" style={{ marginTop: "26px" }}><b>我的预设</b><span className="en">MY PRESETS</span><span className="all" style={{ cursor: "pointer" }} onClick={() => onNav("build")}>去创作打包 ›</span></div>
        {myPresets.length ? (
          <div className="mgrid">
            {myPresets.map((p, i) => (
              <window.RxMarketTile key={i} label="预设" name={p.nm} desc={p.syn}
                tags={p.tags.join(" · ")} img={p.cover}
                style={{ animationDelay: (Math.min(i, 10) * 40) + "ms" }}
                onPrimary={P.onOpenStory ? () => P.onOpenStory(p.raw) : undefined} primaryLabel="开始"
                onDelete={P.onDeletePreset ? () => P.onDeletePreset(p.raw) : undefined} />
            ))}
          </div>
        ) : (
          <div className="vdim">还没有预设。在创作桌的「汇总」打包一个,会出现在这里。</div>
        )}

        {/* ===== 我的卡库(整宽卡片网格,对照旧版 VaultView) ===== */}
        <div className="sec-h" style={{ marginTop: "26px" }}><b>我的卡库</b><span className="en">CARD VAULT</span></div>
        <div className="vtabs">
          {LIB_KINDS.map(([k, zh]) => (
            <span key={k} className={"vtab" + (libKind === k ? " on" : "")} onClick={() => setLibKind(k)}>{zh}</span>
          ))}
        </div>
        {libItems === null && <div className="vdim">读取中…</div>}
        {libItems !== null && !libItems.length && <div className="vdim">这一类还没有卡。</div>}
        {libItems !== null && libItems.length > 0 && (
          <div className="mgrid">
            {libItems.map((it, i) => (
              <window.RxMarketTile key={(it.name || "") + i} label={LIB_LABEL[libKind]} mine={it.official === false}
                name={it.name || "未命名"} desc={_libDesc(it)} tags={_libTags(it)} img={_libImg(it)}
                style={{ animationDelay: (Math.min(i, 10) * 40) + "ms" }}
                onDelete={() => delLibCard(it)} />
            ))}
          </div>
        )}

      </div>
    </div>
  );
}

window.ReconProfile = ReconProfile;
