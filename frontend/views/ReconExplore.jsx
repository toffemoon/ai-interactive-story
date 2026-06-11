// 市集翻转卡:正面 信息+操作,背面 图片;右下 ↻/↺ 翻面,有图才出按钮
// (卡库角色卡现普遍无 image 字段——内容侧补图后自动生效;故事书/事件卡回退用所属预设封面)。
function RxMarketTile({ label, mine, name, desc, tags, img, isEvent, got, style, onPeek, onCollect }) {
  const [flip, setFlip] = React.useState(false);
  return (
    <div className={"mcard" + (flip ? " flip" : "")} style={style}>
      <div className="mc-in">
        <div className="mc-f">
          <div className="mh">
            <span className="badge">{label}</span>
            {mine && <span className="minebdg">我建的</span>}
          </div>
          <b className="nm">{name}</b>
          <div className="ds">{desc || "一张待你揭晓的卡。"}</div>
          <div className="tgs">{tags}</div>
          <div className="ft">
            {!isEvent ? (
              <React.Fragment>
                <button className="mbtn" onClick={onPeek}>速览</button>
                <span className="msp"></span>
                {got ? <span className="mnote">已在我的库</span> : <button className="mbtn pri" onClick={onCollect}>收进我的库</button>}
              </React.Fragment>
            ) : (
              <React.Fragment>
                <span className="mnote" style={{ marginLeft: 0 }}>隐藏事件 · 入局后揭晓</span>
                <span className="msp"></span>
              </React.Fragment>
            )}
            {img ? <button className="fbtn" title="翻面看图" onClick={() => setFlip(true)}>↻</button> : null}
          </div>
        </div>
        {img ? (
          <div className="mc-b" onClick={() => setFlip(false)}>
            <div className="bimg" style={{ backgroundImage: "url(" + img + ")" }}></div>
            <div className="bnm">{name}</div>
            <button className="fbtn" title="翻回正面" onClick={(e) => { e.stopPropagation(); setFlip(false); }}>↺</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
window.RxMarketTile = RxMarketTile;

// ReconExplore — 功能版探索/故事库(登录后主页):统一竖栏 + 「故事书 / 卡市集」二级切换。
// 响应式版(B 路线):正常文档流 + 页面滚动,文字真实尺寸渲染;竖栏 fixed,内容区流式自适应宽度。
// 故事书 = 预设网格(搜索/分类/排序);卡市集 = 按卡种浏览公共卡库,速览只露公开层(剧透边界硬约束),可收进我的库。
// 契约 props: { presets:[preset], user, onOpenStory(preset), onNew(), onNav(view) }
function ReconExplore(props) {
  const { useState, useEffect, useMemo } = React;
  const P = props || {};
  const presets = P.presets || [];
  const user = P.user || null;
  const onOpenStory = P.onOpenStory || (() => {});
  const onNew = P.onNew || (() => {});
  const onNav = P.onNav || (() => {});
  const _name = (x) => (x && x.data && x.data.name) || (x && x.name) || "未命名故事";
  const _f = (x, k) => x && x.data && x.data[k];

  // ===== 市集辅助(公开层字段,与旧 PR #54 同一套规则) =====
  const KINDS = [["all", "全部"], ["characters", "角色卡"], ["players", "演出卡"], ["worlds", "世界书 · 设定卡"], ["stories", "故事书"], ["events", "事件卡"]];
  const KIND_LABEL = Object.fromEntries(KINDS);
  const GENRES = ["原创", "教学", "崩铁"];
  const mName = (it) => {
    if (it.kind === "characters") return ((it.data || {}).data || {}).name || it.name;
    if (it.kind === "stories") return (it.data || {}).title || it.name;
    return (it.data || {}).name || it.name;
  };
  const mTags = (it) => {
    if (it.kind === "characters") return ((it.data || {}).data || {}).tags || (it.data || {}).tags || [];
    return (it.data || {}).tags || [];
  };
  const mDesc = (it) => {
    const d = it.data || {};
    if (it.kind === "characters") return (d.data || {}).description || "";
    if (it.kind === "players") return d.role || (d.goals || []).join(" / ");
    if (it.kind === "worlds") return `${(d.entries || []).length} 条条目`;
    if (it.kind === "stories") return d.premise || `${(d.events || []).length} 个事件`;
    if (it.kind === "events") return (it._story ? `属:${it._story}` : "") + (d.hidden ? " · 隐藏事件" : "");
    return "";
  };
  // 翻面图:卡自带图优先;故事书/事件卡回退用所属预设封面(角色卡库现普遍无 image 字段,内容侧待补)
  const coverMap = useMemo(() => {
    const m = {};
    presets.forEach((p) => { const d = p.data || {}; const t = (d.story || {}).title; if (t && d.cover) m[t] = d.cover; });
    return m;
  }, [presets]);
  const mImage = (it) => {
    const d = it.data || {};
    let img = it.kind === "characters" ? ((d.data || {}).image || (d.data || {}).avatar || d.image || "") : (d.image || d.cover || "");
    if (!img && it.kind === "stories") img = coverMap[d.title] || "";
    if (!img && it.kind === "events") img = coverMap[it._story] || "";
    return img;
  };
  const chipsOf = (tagLists) => {
    const present = new Set();
    tagLists.forEach((ts) => (ts || []).forEach((t) => t && present.add(t)));
    return ["全部", ...GENRES.filter((g) => present.has(g))];
  };
  const hitGenre = (tags, g) => g === "全部" || (tags || []).includes(g);
  const hitQ = (q, ...fields) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return fields.some((f) => (Array.isArray(f) ? f.join(" ") : (f || "")).toLowerCase().includes(s));
  };
  // 「我的库」本地注册表(无账号时的归属层;登录态另存私库副本)
  const MYLIB = "ais_my_lib";
  const libGet = () => { try { const m = JSON.parse(localStorage.getItem(MYLIB)) || {}; return { cards: m.cards || [], presets: m.presets || [] }; } catch (e) { return { cards: [], presets: [] }; } };
  const libHas = (key) => libGet().cards.includes(key);
  const libAdd = (key) => { try { const m = libGet(); if (!m.cards.includes(key)) { m.cards.push(key); localStorage.setItem(MYLIB, JSON.stringify(m)); } } catch (e) {} };

  // ===== 状态 =====
  const [tab, setTab] = useState("stories");        // stories | cards(二级切换)
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("default");      // default 综合(官方优先) | time 按时间
  const [genre, setGenre] = useState("全部");
  const [kind, setKind] = useState("all");          // 卡市集卡种
  const [cards, setCards] = useState(null);         // null = 未加载/读取中
  const [peek, setPeek] = useState(null);
  const [added, setAdded] = useState({});
  useEffect(() => { setQ(""); setGenre("全部"); setSort("default"); }, [tab]);

  // 卡市集懒加载:四类公共卡 + 故事书里抽隐藏事件卡(普通时间线事件不进市集)
  useEffect(() => {
    if (tab !== "cards" || cards !== null) return;
    let alive = true;
    Promise.all(["characters", "players", "worlds", "stories"].map((k) =>
      fetch(`/api/library/${k}`).then((r) => (r.ok ? r.json() : [])).then((xs) => xs.map((x) => ({ ...x, kind: k }))).catch(() => [])
    )).then((lists) => {
      if (!alive) return;
      const flat = lists.flat();
      const evs = [];
      flat.filter((x) => x.kind === "stories").forEach((s) => ((s.data || {}).events || []).forEach((e) => {
        if (e.hidden) evs.push({ kind: "events", name: e.title || e.event_id || "事件", data: e, _story: (s.data || {}).title || s.name, official: s.official });
      }));
      setCards([...flat, ...evs]);
    });
    return () => { alive = false; };
  }, [tab, cards]);

  // ===== 过滤(列表本身已按更新时间倒序,「按时间」即取回顺序;「综合」官方优先) =====
  const sChips = useMemo(() => chipsOf(presets.map((p) => (p.data || {}).tags)), [presets]);
  const sShown = useMemo(() => {
    let xs = presets.filter((p) => {
      const d = p.data || {};
      return hitGenre(d.tags, genre) && hitQ(q, d.name || p.name, d.synopsis, d.author, d.tags);
    });
    if (sort === "default") xs = [...xs].sort((a, b) => (a.official === b.official ? 0 : (b.official ? 1 : -1)));
    return xs;
  }, [presets, q, sort, genre]);

  const cChips = useMemo(() => chipsOf((cards || []).map(mTags)), [cards]);
  const cShown = useMemo(() => {
    let xs = (cards || []).filter((it) =>
      (kind === "all" || it.kind === kind) && hitGenre(mTags(it), genre) && hitQ(q, mName(it), mDesc(it), mTags(it)));
    if (sort === "default") xs = [...xs].sort((a, b) => (a.official === b.official ? 0 : (b.official ? 1 : -1)));
    return xs;
  }, [cards, kind, q, sort, genre]);

  async function collect(it) {
    const key = it.kind + "/" + it.name;
    libAdd(key);
    if (user) {   // 登录态:再存一份私有副本(后端按 user_id 隔离);AUTH 关只记本地归属,不写库免得全局重复
      try { await fetch("/api/library/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: it.kind, data: it.data }) }); } catch (e) {}
    }
    setAdded((m) => ({ ...m, [key]: true }));
  }

  // 卡详情(只读速览):只渲染公开层 —— 角色卡 known_hidden/versions/性格/scenario/first_mes 一律不进;
  // 世界书只列 public 条目;故事书只给 premise + 数量。(剧透边界硬约束,同旧 CardPeek)
  const Peek = ({ item, onClose }) => {
    const d = item.data || {};
    const cd = item.kind === "characters" ? (d.data || {}) : d;
    const pub = item.kind === "worlds" ? (d.entries || []).filter((e) => (e.visibility || "public") === "public") : [];
    return (
      <div className="pkwrap" onClick={onClose}>
        <div className="pk" onClick={(e) => e.stopPropagation()}>
          <div className="hd"><span className="badge">{KIND_LABEL[item.kind]}</span><b>{mName(item)}</b></div>
          <button className="x" onClick={onClose} aria-label="关闭">×</button>
          {item.kind === "characters" && (<React.Fragment>
            {cd.description && <p className="ln">{cd.description}</p>}
            {cd.look && <p className="ln"><span className="k">外貌</span>{cd.look}</p>}
          </React.Fragment>)}
          {item.kind === "players" && (<React.Fragment>
            {cd.role && <p className="ln">{cd.role}</p>}
            {(cd.goals || []).length > 0 && <p className="ln"><span className="k">目标</span>{cd.goals.join(" / ")}</p>}
          </React.Fragment>)}
          {item.kind === "worlds" && (<React.Fragment>
            <p className="ln">{pub.length} 条公开条目{(d.entries || []).length > pub.length ? `(另有 ${(d.entries || []).length - pub.length} 条入局后揭晓)` : ""}</p>
            {pub.slice(0, 8).map((e, i) => <p className="ln dim" key={i}>· {e.title || (e.keys || []).join(" / ") || "条目"}</p>)}
          </React.Fragment>)}
          {item.kind === "stories" && (<React.Fragment>
            {d.premise && <p className="ln">{d.premise}</p>}
            <p className="ln dim">{(d.events || []).length} 个事件 · {(d.endings || []).length} 个结局(内容入局后揭晓)</p>
          </React.Fragment>)}
          {mTags(item).length > 0 && <div className="tags">{mTags(item).map((t, j) => <span key={j}>{t}</span>)}</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="cv-explore">
      <style>{`
  .cv-explore {
    --bg:#f3ece0; --paper:#faf4ea; --paper2:#f6efe2;
    --ink:#2c2820; --soft:#6f6757; --faint:#9a907a;
    --line:#ddd0b4; --line2:#c4b388;
    --gold:#a98a63; --gold2:#c1a86f;
    --navy:#163b57; --navy-line:#b99a59; --green:#34463d;
    --serif:"Songti SC","STSong","SimSun",serif;
    --serifen:Georgia,"Times New Roman",serif;
    --kai:"Kaiti SC","STKaiti","KaiTi",serif;
    position:relative; width:100%; min-height:100vh;
    background:repeating-linear-gradient(90deg, rgba(169,138,99,.028) 0 1px, transparent 1px 46px), var(--bg);
    color:var(--ink); font-family:var(--kai);
  }
  .cv-explore * {box-sizing:border-box;}
  /* 竖栏:页面滚动时固定在视口左侧 */
  .cv-explore .cv-rail {position:fixed;}
  .cv-explore .main {margin-left:216px; padding:0 40px 56px 36px;}
  /* 页头 */
  .cv-explore .top {position:relative; display:flex; align-items:flex-start; justify-content:space-between; gap:24px; padding:26px 2px 18px;}
  .cv-explore .top::after {content:""; position:absolute; left:0; right:0; bottom:0; height:1px;
    background:linear-gradient(90deg,transparent,var(--line2) 4%,var(--line2) 96%,transparent);}
  .cv-explore .ttl {display:flex; align-items:baseline; gap:16px;}
  .cv-explore .ttl h2 {margin:0; font-family:var(--serif); font-weight:700; font-size:28px; letter-spacing:.1em;}
  .cv-explore .ttl .en {font-family:var(--serifen); font-style:italic; font-size:16px; letter-spacing:.06em; color:var(--gold);}
  .cv-explore .sub {margin-top:10px; font-family:var(--kai); font-size:13.5px; letter-spacing:.06em; color:var(--faint);}
  .cv-explore .tr {display:flex; align-items:center; gap:18px; flex:none; padding-top:6px;}
  .cv-explore .tr .cnt {font-family:var(--kai); font-size:13.5px; color:var(--soft); white-space:nowrap;}
  .cv-explore .tr .cnt b {font-family:var(--serifen); font-size:17px; color:var(--navy); margin:0 3px;}
  .cv-explore .newbtn {height:44px; padding:0 24px; display:inline-flex; align-items:center; gap:9px; background:var(--green); color:#f3ead6;
    border:1px solid #283831; cursor:pointer; position:relative; font-family:var(--serif); font-size:14px; letter-spacing:.14em; white-space:nowrap;}
  .cv-explore .newbtn::before {content:""; position:absolute; inset:3px; border:1px solid rgba(193,168,111,.5); pointer-events:none;}
  .cv-explore .newbtn:hover {background:#2c3a32;}
  /* 二级切换:故事书 / 卡市集 */
  .cv-explore .xtabs {display:flex; gap:36px; border-bottom:1px solid var(--line); margin-top:6px;}
  .cv-explore .xtab {display:flex; align-items:baseline; gap:9px; padding:14px 4px 12px; cursor:pointer; position:relative;}
  .cv-explore .xtab .zh {font-family:var(--serif); font-size:17px; letter-spacing:.12em; color:var(--soft);}
  .cv-explore .xtab .en {font-family:var(--serifen); font-size:9.5px; letter-spacing:.26em; color:var(--faint);}
  .cv-explore .xtab.on .zh {color:var(--navy); font-weight:700;}
  .cv-explore .xtab.on::after {content:""; position:absolute; left:0; right:0; bottom:-1px; height:2px; background:var(--navy);}
  /* 工具条:搜索 + 排序 + 标签分类(+ 卡种) */
  .cv-explore .xbar {display:flex; align-items:center; flex-wrap:wrap; gap:10px; margin-top:18px;}
  .cv-explore .xbar input {width:300px; max-width:100%; height:36px; border:1px solid var(--line2); background:var(--paper); color:var(--ink);
    font-family:var(--kai); font-size:13.5px; padding:0 12px; outline:none; border-radius:0;}
  .cv-explore .xbar input::placeholder {color:var(--faint);}
  .cv-explore .chip {height:32px; padding:0 15px; border:1px solid var(--line2); background:transparent; color:var(--soft);
    font-family:var(--serif); font-size:13.5px; letter-spacing:.06em; cursor:pointer; border-radius:0; min-height:0;}
  .cv-explore .chip:hover:not(.on) {background:rgba(169,138,99,.08); color:var(--soft);}
  .cv-explore .chip.on {background:var(--green); color:#eef0e2; border-color:#283831;}
  .cv-explore .dv {width:1px; height:22px; background:var(--line2); margin:0 4px;}
  .cv-explore .xkinds {display:flex; flex-wrap:wrap; gap:9px; margin-top:10px;}
  /* 故事书网格(页面整体滚动,不再内部滚) */
  .cv-explore .grid {display:grid; grid-template-columns:repeat(auto-fill, minmax(330px, 1fr)); gap:22px; margin-top:24px;}
  @keyframes rce-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
  .cv-explore .gcard {background:var(--paper); border:1px solid var(--line); cursor:pointer; position:relative;
    transition:transform .3s cubic-bezier(.22,1,.36,1), box-shadow .3s; animation:rce-in .38s cubic-bezier(.22,1,.36,1) both;}
  .cv-explore .gcard:hover {transform:translateY(-5px); box-shadow:0 14px 28px -16px rgba(43,38,32,.4);}
  .cv-explore .gcard::after {content:""; position:absolute; inset:5px; border:1px solid rgba(196,179,132,.35); pointer-events:none;}
  .cv-explore .gcard .cv {height:180px; background:center/cover no-repeat; border-bottom:1px solid var(--line); position:relative;}
  .cv-explore .gcard .cv.noart {background:linear-gradient(160deg,#efe6d2,#ddd0b2); display:grid; place-items:center;}
  .cv-explore .gcard .cv.noart b {font-family:var(--serif); font-size:23px; letter-spacing:.22em; color:var(--gold); font-weight:700;}
  .cv-explore .gcard .cv .no {position:absolute; left:11px; top:9px; font-family:var(--serifen); font-size:13px; font-weight:700; color:rgba(248,242,228,.92); text-shadow:0 1px 2px rgba(0,0,0,.5);}
  .cv-explore .gcard .bd {padding:16px 18px 15px;}
  .cv-explore .gcard b.tt {display:block; font-family:var(--serif); font-size:17.5px; font-weight:700; letter-spacing:.04em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-explore .gcard .tg {font-family:var(--kai); font-size:12.5px; color:var(--gold); margin-top:6px; letter-spacing:.06em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-explore .gcard .syn {font-family:var(--kai); font-size:13.5px; line-height:1.7; color:var(--soft); margin-top:8px; height:46px;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
  .cv-explore .gcard .mt {display:flex; align-items:center; gap:10px; margin-top:11px; font-family:var(--kai); font-size:12.5px; color:var(--soft); border-top:1px solid var(--line); padding-top:10px;}
  .cv-explore .gcard .mt i {width:4px; height:4px; background:var(--gold); transform:rotate(45deg); font-style:normal; flex:none;}
  .cv-explore .gcard .mt .go {margin-left:auto; font-family:var(--serif); font-size:13px; letter-spacing:.1em; color:var(--navy); white-space:nowrap;}
  /* 卡市集(翻转卡:正面信息,背面图片;右下 ↻/↺ 翻面,有图才给按钮) */
  .cv-explore .mgrid {display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:18px; margin-top:24px;}
  .cv-explore .mcard {position:relative; height:236px; perspective:1000px; animation:rce-in .38s cubic-bezier(.22,1,.36,1) both;
    transition:transform .3s cubic-bezier(.22,1,.36,1);}
  .cv-explore .mcard:hover {transform:translateY(-4px);}
  .cv-explore .mc-in {position:absolute; inset:0; transform-style:preserve-3d; transition:transform .45s cubic-bezier(.3,.8,.3,1);}
  .cv-explore .mcard.flip .mc-in {transform:rotateY(180deg);}
  .cv-explore .mc-f, .cv-explore .mc-b {position:absolute; inset:0; -webkit-backface-visibility:hidden; backface-visibility:hidden;
    background:var(--paper); border:1px solid var(--line);}
  .cv-explore .mcard:hover .mc-f, .cv-explore .mcard:hover .mc-b {box-shadow:0 14px 26px -16px rgba(43,38,32,.38);}
  .cv-explore .mc-f {padding:16px 18px 13px; display:flex; flex-direction:column;}
  .cv-explore .mc-f::after {content:""; position:absolute; inset:5px; border:1px solid rgba(196,179,132,.3); pointer-events:none;}
  .cv-explore .mc-b {transform:rotateY(180deg); overflow:hidden;}
  .cv-explore .mc-b .bimg {position:absolute; inset:0; background:center/cover no-repeat;}
  .cv-explore .mc-b .bnm {position:absolute; left:0; right:0; bottom:0; padding:28px 16px 11px;
    background:linear-gradient(180deg, rgba(34,29,22,0), rgba(34,29,22,.62)); color:#f5efe3;
    font-family:var(--serif); font-size:15px; letter-spacing:.06em;}
  .cv-explore .fbtn {width:30px; height:30px; flex:none; border-radius:50%; border:1px solid var(--line2); background:rgba(250,244,234,.92);
    color:var(--soft); display:grid; place-items:center; cursor:pointer; min-height:0; padding:0; font-size:14px; line-height:1;}
  .cv-explore .fbtn:hover {background:rgba(193,168,111,.25); color:var(--ink);}
  .cv-explore .mc-b .fbtn {position:absolute; right:9px; bottom:9px; background:rgba(34,29,22,.45); color:#f0e8d4; border-color:rgba(240,232,212,.55); z-index:3;}
  .cv-explore .mc-b .fbtn:hover {background:rgba(34,29,22,.65); color:#fff;}
  .cv-explore .mcard .mh {display:flex; align-items:center; gap:8px;}
  .cv-explore .badge {font-family:var(--serif); font-size:11.5px; letter-spacing:.08em; color:#8a6f49;
    border:1px solid var(--gold2); background:rgba(193,168,111,.12); padding:2px 9px; flex:none;}
  .cv-explore .minebdg {font-family:var(--kai); font-size:11px; color:#b5402e; border:1px solid rgba(181,64,46,.4); padding:2px 7px; flex:none;}
  .cv-explore .mcard b.nm {display:block; font-family:var(--serif); font-size:17px; font-weight:700; letter-spacing:.04em; margin-top:10px;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
  .cv-explore .mcard .ds {font-family:var(--kai); font-size:13.5px; line-height:1.65; color:var(--soft); margin-top:7px; height:45px;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;}
  .cv-explore .mcard .tgs {font-family:var(--kai); font-size:12px; color:var(--gold); margin-top:7px; letter-spacing:.04em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-height:17px;}
  .cv-explore .mcard .ft {display:flex; align-items:center; gap:9px; margin-top:auto; border-top:1px solid var(--line); padding-top:10px;}
  .cv-explore .mbtn {height:31px; padding:0 15px; border:1px solid var(--navy-line); background:transparent; color:var(--navy);
    font-family:var(--serif); font-size:13px; letter-spacing:.08em; cursor:pointer; border-radius:0; min-height:0;}
  .cv-explore .mbtn:hover:not(:disabled) {background:rgba(185,154,89,.12); color:var(--navy);}
  .cv-explore .mbtn.pri {background:var(--green); color:#eef0e2; border-color:#283831;}
  .cv-explore .mbtn.pri:hover:not(:disabled) {background:#2c3a32; color:#eef0e2;}
  .cv-explore .mnote {font-family:var(--kai); font-size:12.5px; color:var(--faint); margin-left:auto;}
  .cv-explore .msp {flex:1;}
  .cv-explore .hint {text-align:center; padding:110px 0 60px; font-family:var(--kai); font-size:14.5px; color:var(--faint); letter-spacing:.08em;}
  /* 速览(公开层) */
  .cv-explore .pkwrap {position:fixed; inset:0; z-index:60; background:rgba(34,29,22,.46); display:grid; place-items:center;}
  .cv-explore .pk {width:620px; max-width:calc(100vw - 48px); max-height:78vh; overflow-y:auto; background:var(--paper); border:1px solid var(--line2); padding:28px 32px; position:relative;}
  .cv-explore .pk::before {content:""; position:absolute; inset:7px; border:1px solid rgba(196,179,132,.4); pointer-events:none;}
  .cv-explore .pk::-webkit-scrollbar {width:7px;} .cv-explore .pk::-webkit-scrollbar-thumb {background:var(--line2);}
  .cv-explore .pk .hd {display:flex; align-items:center; gap:12px; padding-right:34px;}
  .cv-explore .pk .hd b {font-family:var(--serif); font-size:20px; font-weight:700; letter-spacing:.04em;}
  .cv-explore .pk .x {position:absolute; right:16px; top:14px; width:32px; height:32px; border:1px solid var(--line2); background:transparent;
    color:var(--soft); font-size:17px; cursor:pointer; border-radius:0; min-height:0; display:grid; place-items:center; z-index:2;}
  .cv-explore .pk .ln {font-family:var(--kai); font-size:14px; line-height:1.95; color:var(--soft); margin:10px 0 0;}
  .cv-explore .pk .ln .k {font-family:var(--serif); font-size:13px; color:var(--gold); margin-right:10px;}
  .cv-explore .pk .ln.dim {color:var(--faint);}
  .cv-explore .pk .tags {margin-top:16px; display:flex; gap:8px; flex-wrap:wrap;}
  .cv-explore .pk .tags span {font-family:var(--kai); font-size:12.5px; color:var(--gold); border:1px solid var(--line2); padding:3px 11px;}
  /* 空态 */
  .cv-explore .empty {display:grid; place-items:center; padding:130px 0 80px;}
  .cv-explore .empty .panel {width:480px; max-width:90%; text-align:center; background:var(--paper); border:1px solid var(--line); padding:48px 42px; position:relative;}
  .cv-explore .empty .panel::before {content:""; position:absolute; inset:6px; border:1px solid rgba(196,179,132,.4); pointer-events:none;}
  .cv-explore .empty h3 {margin:0; font-family:var(--serif); font-size:22px; letter-spacing:.12em;}
  .cv-explore .empty p {font-size:14px; line-height:1.9; color:var(--soft); margin:14px 0 22px;}
  /* 窄屏(竖栏以下空间不足时收紧边距) */
  @media (max-width: 1100px) {
    .cv-explore .main {padding:0 22px 48px 20px;}
    .cv-explore .xbar input {width:240px;}
  }
      `}</style>

      <window.ReconRail active="home" onNav={onNav} />

      <div className="main">
        <div className="top">
          <div>
            <div className="ttl"><h2>故事库</h2><span className="en">/ Story Library</span></div>
            <div className="sub">取下一本书，或挑几张卡，走进会回应你的故事世界。</div>
          </div>
          <div className="tr">
            <span className="cnt">{tab === "stories"
              ? (<React.Fragment>共<b>{presets.length}</b>个故事</React.Fragment>)
              : (cards === null ? "卡读取中…" : (<React.Fragment>共<b>{cards.length}</b>张卡</React.Fragment>))}{user ? " · " + (user.display_name || user.username) : ""}</span>
            <span className="newbtn" onClick={onNew}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              写一本新的
            </span>
          </div>
        </div>

        {/* 二级切换 */}
        <div className="xtabs">
          {[["stories", "故事书", "STORIES"], ["cards", "卡市集", "CARD MARKET"]].map(([k, zh, en]) => (
            <div key={k} className={"xtab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
              <span className="zh">{zh}</span><span className="en">{en}</span>
            </div>
          ))}
        </div>

        {/* 工具条 */}
        <div className="xbar">
          <input placeholder={tab === "stories" ? "搜故事:名字 / 简介 / 作者 / 标签" : "搜卡:名字 / 描述 / 标签"} value={q} onChange={(e) => setQ(e.target.value)} />
          {[["default", "综合"], ["time", "按时间"]].map(([k, label]) => (
            <button key={k} className={"chip" + (sort === k ? " on" : "")} onClick={() => setSort(k)}>{label}</button>
          ))}
          {(tab === "stories" ? sChips : cChips).length > 1 && <span className="dv"></span>}
          {(tab === "stories" ? sChips : cChips).length > 1 && (tab === "stories" ? sChips : cChips).map((c) => (
            <button key={c} className={"chip" + (genre === c ? " on" : "")} onClick={() => setGenre(c)}>{c}</button>
          ))}
        </div>

        {/* 卡种行(仅卡市集) */}
        {tab === "cards" && (
          <div className="xkinds">
            {KINDS.map(([k, label]) => (
              <button key={k} className={"chip" + (kind === k ? " on" : "")} onClick={() => setKind(k)}>{label}</button>
            ))}
          </div>
        )}

        {/* ===== 故事书 ===== */}
        {tab === "stories" && (presets.length ? (
          <div className="grid">
            {sShown.map((p, i) => {
              const cover = _f(p, "cover") || "";  // 只用库里真实封面;没有就中性书封,不放假图
              const tags = (_f(p, "tags") || []).slice(0, 3).join(" · ") || "互动叙事";
              const syn = _f(p, "synopsis") || (_f(p, "story") && _f(p, "story").premise) || "一个等你走进的故事。";
              const nch = (_f(p, "characters") || []).length;
              return (
                <div className="gcard" key={i} style={{ animationDelay: (Math.min(i, 8) * 50) + "ms" }} onClick={() => onOpenStory(p)}>
                  <div className={"cv" + (cover ? "" : " noart")} style={cover ? { backgroundImage: "url(" + cover + ")" } : undefined}>
                    {!cover && <b>{_name(p).slice(0, 4)}</b>}
                    <span className="no">{String(i + 1).padStart(2, "0")}</span></div>
                  <div className="bd">
                    <b className="tt">{_name(p)}</b>
                    <div className="tg">{tags}</div>
                    <div className="syn">{syn}</div>
                    <div className="mt"><span>{nch ? nch + " 角色" : "群像"}</span><i></i><span>{_f(p, "author") || "店内收录"}</span><span className="go">取下这本书 ›</span></div>
                  </div>
                </div>
              );
            })}
            {!sShown.length && <div className="hint" style={{ gridColumn: "1/-1", padding: "70px 0 30px" }}>没有匹配的故事。换个关键词或分类试试。</div>}
          </div>
        ) : P.loadErr ? (
          /* 加载失败 ≠ 书架为空:失败要长得像失败,给重试出路(有缓存时上面 presets.length 分支兜住,不清屏) */
          <div className="empty">
            <div className="panel">
              <h3>书架加载失败</h3>
              <p>没能从服务器取到故事列表,<br/>可能是网络抖动或服务暂时不可用。</p>
              <span className="newbtn" onClick={() => P.onRetry && P.onRetry()}>点击重试</span>
            </div>
          </div>
        ) : (
          <div className="empty">
            <div className="panel">
              <h3>书架还空着</h3>
              <p>还没有可玩的故事。去「创作」从一张角色卡开始，<br/>聊着聊着，一本书就长出来了。</p>
              <span className="newbtn" onClick={onNew}>去创作</span>
            </div>
          </div>
        ))}

        {/* ===== 卡市集 ===== */}
        {tab === "cards" && (
          <React.Fragment>
            {cards === null && <div className="hint">卡库读取中…</div>}
            {cards !== null && !cShown.length && <div className="hint">没有匹配的卡。换个关键词或分类试试。</div>}
            {cards !== null && cShown.length > 0 && (
              <div className="mgrid">
                {cShown.map((it, i) => {
                  const key = it.kind + "/" + it.name;
                  const got = added[key] || libHas(key);
                  return (
                    <RxMarketTile key={key + i} label={KIND_LABEL[it.kind]} mine={it.official === false}
                      name={mName(it)} desc={mDesc(it)} tags={mTags(it).slice(0, 4).join(" · ")} img={mImage(it)}
                      isEvent={it.kind === "events"} got={got}
                      style={{ animationDelay: (Math.min(i, 10) * 40) + "ms" }}
                      onPeek={() => setPeek(it)} onCollect={() => collect(it)} />
                  );
                })}
              </div>
            )}
          </React.Fragment>
        )}
      </div>

      {peek && <Peek item={peek} onClose={() => setPeek(null)} />}
    </div>
  );
}
window.ReconExplore = ReconExplore;
