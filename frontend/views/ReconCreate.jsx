// 创作桌 · The Atelier —— 沿用 play/chat 暖色视觉语言（引擎竖栏 + 暖色面板 + 金线 + 衬线标题）
// 左：与 AI 对谈（剧本式对话）。右：实时卡预览（一张正在生长的角色卡）。
// React/ReactDOM 全局。组件 standalone 渲染时用内置 SAMPLE，props 仅作预留覆盖接口。

function ReconCreate(props) {
  // ── 极简回退 sample：仅在缺省 props（测试页 standalone）时保证不白屏 ──
  const SAMPLE_KINDS = [
    { zh: "角色卡", en: "CHARACTER" },
    { zh: "演出卡", en: "STAGING" },
    { zh: "设定卡·世界书", en: "LORE" },
    { zh: "故事书", en: "STORY" },
    { zh: "事件卡", en: "EVENT" },
  ];
  const SAMPLE_DRAFT = {
    name: "未命名卡",
    kind: "角色卡",
    fields: [
      { k: "外貌", v: "" },
      { k: "性格", v: "" },
    ],
  };

  const P = props || {};
  const onKind = P.onKind || (() => {});
  const onChange = P.onChange || (() => {});
  const onSend = P.onSend || (() => {});
  const onSaveCard = P.onSaveCard || (() => {});
  const onNav = P.onNav || (() => {});
  const busy = !!P.busy;

  // 新消息/推演中自动滚到底,等待反馈别藏在视口外。
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [(P.messages || []).length, busy]);

  // 顶部卡分类签：kinds 数组，选中 = cardKind 索引
  const KINDS = (P.kinds && P.kinds.length ? P.kinds : SAMPLE_KINDS);
  const cardKind = (typeof P.cardKind === "number") ? P.cardKind : 0;

  // 左：与 AI 对谈。messages:[{who:"坊"|"你", text}]
  const MESSAGES = P.messages || [];

  // 底部输入
  const value = (P.value != null) ? P.value : "";

  // 右：实时卡预览。draft:{name, kind, fields:[{k,v,fresh,hidden}]}
  const draft = P.draft || SAMPLE_DRAFT;
  const dFields = draft.fields || [];
  const dName = draft.name || "";
  const dKind = draft.kind || (KINDS[cardKind] && KINDS[cardKind].zh) || "";
  const dKindEn = (KINDS[cardKind] && KINDS[cardKind].en) || "";

  return (
    <div className="cv cv-create">
      <style>{`
  .cv-create {
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
  .cv-create * {box-sizing:border-box;}
  .cv-create {
    position:relative; width:1536px; height:1024px; overflow:hidden;
    background:
      repeating-linear-gradient(90deg, rgba(169,138,99,.028) 0 1px, transparent 1px 46px),
      var(--bg);
    color:var(--ink); font-family:var(--kai);
  }

  .cv-create .lbar {position:absolute; left:0; top:0; bottom:0; width:188px; z-index:30;
    background:linear-gradient(180deg,#f1e7d8,#efe4d4);
    border-right:1px solid var(--line2);}
  .cv-create .lbar .logo {display:flex; align-items:center; gap:9px; padding:20px 0 16px 18px; position:relative;}
  .cv-create .lbar .logo .emb {width:34px; height:34px; flex:none; display:grid; place-items:center; color:var(--gold);}
  .cv-create .lbar .logo .lt b {display:block; font-family:var(--serifen); font-size:12.5px; letter-spacing:.02em; color:#8a6f49; font-weight:600; line-height:1.15;}
  .cv-create .lbar .logo .lt span {display:block; font-family:var(--kai); font-size:9.5px; letter-spacing:.22em; color:var(--gold); margin-top:3px;}
  .cv-create .lbar .logo::after {content:""; position:absolute; left:18px; right:18px; bottom:0; height:1px;
    background:linear-gradient(90deg,transparent,var(--line2),transparent);}

  .cv-create .nav {margin-top:10px; display:flex; flex-direction:column;}
  .cv-create .nav a {display:flex; align-items:center; gap:12px; height:54px; padding:0 0 0 24px; cursor:pointer; position:relative; color:var(--soft);}
  .cv-create .nav a .ic {width:21px; height:21px; flex:none; display:grid; place-items:center;}
  .cv-create .nav a .tx {display:flex; flex-direction:column;}
  .cv-create .nav a .tx .zh {font-family:var(--serif); font-size:15px; letter-spacing:.12em;}
  .cv-create .nav a .tx .en {font-family:var(--serifen); font-size:8px; letter-spacing:.24em; color:var(--faint); margin-top:2px;}
  .cv-create .nav a.on {background:linear-gradient(90deg,#3c4d43,#34463d); color:#eef0e2; border-color:#2c3a32;}
  .cv-create .nav a.on .en {color:rgba(238,240,226,.6);}
  .cv-create .nav a.on::before {content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--gold2);}

  .cv-create .pcard {position:absolute; left:0; right:0; bottom:0; padding:14px 18px 18px; border-top:1px solid var(--line);}
  .cv-create .pcard .ttl {font-family:var(--serif); font-size:12px; letter-spacing:.12em; color:var(--soft);}
  .cv-create .pcard .ttl span {font-family:var(--serifen); font-size:8px; letter-spacing:.26em; color:var(--faint); margin-left:6px;}
  .cv-create .pcard .draft {margin-top:10px; border:1px solid var(--line); background:var(--paper3); padding:11px 12px; position:relative;}
  .cv-create .pcard .draft::before {content:""; position:absolute; left:5px; top:5px; width:8px; height:8px; border-left:1px solid var(--line2); border-top:1px solid var(--line2); opacity:.6;}
  .cv-create .pcard .draft .dk {font-family:var(--serif); font-size:11.5px; color:var(--ink); letter-spacing:.06em;}
  .cv-create .pcard .draft .dn {font-family:var(--kai); font-size:10px; color:var(--faint); margin-top:5px;}
  .cv-create .pcard .insp {display:flex; align-items:center; justify-content:space-between; margin-top:13px; padding-top:11px; border-top:1px solid var(--line);}
  .cv-create .pcard .insp .lb {font-family:var(--serif); font-size:11px; color:var(--soft);}
  .cv-create .pcard .insp .lb i {display:block; font-family:var(--serifen); font-size:7.5px; letter-spacing:.2em; color:var(--faint);}
  .cv-create .pcard .insp .vl {display:flex; align-items:center; gap:6px; font-family:var(--serifen); font-size:16px; font-weight:700; color:var(--navy);}
  .cv-create .pcard .insp .vl svg {color:var(--gold2);}

  .cv-create .top {position:absolute; left:188px; right:0; top:0; height:84px; z-index:20; display:flex; align-items:center;}
  .cv-create .top::after {content:""; position:absolute; left:24px; right:24px; bottom:0; height:1px; background:linear-gradient(90deg,transparent,var(--line2) 6%,var(--line2) 94%,transparent);}
  .cv-create .crumb {display:flex; align-items:baseline; gap:14px; margin-left:32px;}
  .cv-create .crumb .ti {font-family:var(--serif); font-size:30px; font-weight:700; letter-spacing:.06em; color:var(--ink);}
  .cv-create .crumb .en {font-family:var(--serifen); font-style:italic; font-size:18px; color:var(--gold); letter-spacing:.02em;}
  .cv-create .crumb .en::before {content:"/ ";}
  .cv-create .topr {position:absolute; right:22px; top:0; height:84px; display:flex; align-items:center; gap:22px;}
  .cv-create .titem {display:flex; align-items:center; gap:7px; color:var(--soft); cursor:pointer;}
  .cv-create .titem .ic {width:18px; height:18px; display:grid; place-items:center; flex:none;}
  .cv-create .titem .tt {display:flex; flex-direction:column; line-height:1;}
  .cv-create .titem .zh {font-family:var(--serif); font-size:12px; letter-spacing:.04em;}
  .cv-create .titem .en {font-family:var(--serifen); font-size:6.5px; letter-spacing:.18em; color:var(--faint); margin-top:3px;}
  .cv-create .tdiv {width:1px; height:30px; background:var(--line2); opacity:.7;}
  .cv-create .tgear {color:var(--faint); cursor:pointer; display:grid; place-items:center; width:22px; height:22px;}

  .cv-create .tabs {position:absolute; left:212px; right:24px; top:96px; height:46px; display:flex; align-items:flex-end; gap:0; z-index:10;}
  .cv-create .tabs::after {content:""; position:absolute; left:0; right:0; bottom:0; height:1px; background:var(--line2);}
  .cv-create .tab {display:flex; flex-direction:column; align-items:center; gap:3px; padding:0 22px 11px; cursor:pointer; position:relative;}
  .cv-create .tab .zh {font-family:var(--serif); font-size:14.5px; letter-spacing:.08em; color:var(--faint);}
  .cv-create .tab .en {font-family:var(--serifen); font-size:7px; letter-spacing:.22em; color:var(--faint); opacity:.75;}
  .cv-create .tab.on .zh {color:var(--ink); font-weight:700;}
  .cv-create .tab.on .en {color:var(--gold);}
  .cv-create .tab.on::after {content:""; position:absolute; left:14px; right:14px; bottom:0; height:2px; background:var(--gold); z-index:2;}
  .cv-create .tab + .tab::before {content:""; position:absolute; left:0; top:7px; bottom:14px; width:1px; background:var(--line);}

  .cv-create .deck {position:absolute; left:212px; right:24px; top:160px; bottom:24px; display:flex; gap:22px;}

  .cv-create .talk {flex:1; min-width:0; background:var(--paper); border:1px solid var(--line); display:flex; flex-direction:column; position:relative;}
  .cv-create .talk .th {display:flex; align-items:center; gap:10px; padding:15px 22px 13px; border-bottom:1px solid var(--line);}
  .cv-create .talk .th .badge {width:22px; height:22px; border:1px solid var(--line2); display:grid; place-items:center; color:var(--gold); flex:none;}
  .cv-create .talk .th b {font-family:var(--serif); font-size:15px; font-weight:700; letter-spacing:.1em; color:var(--ink);}
  .cv-create .talk .th .en {font-family:var(--serifen); font-size:8px; letter-spacing:.24em; color:var(--gold); align-self:flex-end; margin-bottom:2px;}
  .cv-create .talk .th .hint {margin-left:auto; font-family:var(--kai); font-size:10.5px; color:var(--faint); letter-spacing:.02em;}

  .cv-create .scroll {flex:1; min-height:0; overflow-y:auto; padding:8px 26px 4px;}
  .cv-create .scroll::-webkit-scrollbar {width:5px;} .cv-create .scroll::-webkit-scrollbar-thumb {background:var(--line2);}
  .cv-create .syscue {text-align:center; font-family:var(--kai); font-size:11px; color:var(--faint); letter-spacing:.08em; margin:12px 0 20px;}
  .cv-create .syscue span {display:inline-block; padding:0 14px; position:relative;}
  .cv-create .syscue span::before, .cv-create .syscue span::after {content:""; position:absolute; top:50%; width:54px; height:1px; background:var(--line);}
  .cv-create .syscue span::before {right:100%;} .cv-create .syscue span::after {left:100%;}

  .cv-create .line {padding:13px 0 14px; border-bottom:1px solid #ece2cf;}
  .cv-create .line .lh {display:flex; align-items:center; gap:9px; margin-bottom:7px;}
  .cv-create .line .lh .dot {width:6px; height:6px; transform:rotate(45deg); flex:none;}
  .cv-create .line .lh .who {font-family:var(--serif); font-size:12.5px; font-weight:700; letter-spacing:.06em; color:var(--ink);}
  .cv-create .line .lh .en {font-family:var(--serifen); font-size:7.5px; letter-spacing:.2em; color:var(--faint);}
  .cv-create .line .lh .ln {flex:1; height:1px; background:linear-gradient(90deg,var(--line),transparent);}
  .cv-create .line .bd {font-family:var(--kai); font-size:13.5px; line-height:1.95; letter-spacing:.01em; padding-left:15px;}
  .cv-create .line.ai .lh .dot {background:var(--gold);}
  .cv-create .line.ai .bd {color:var(--ink); border-left:2px solid var(--gold2);}
  .cv-create .line.me .lh .dot {background:var(--green);}
  .cv-create .line.me .lh .who {color:var(--soft);}
  .cv-create .line.me .bd {color:var(--soft); font-style:italic; border-left:2px solid #9fb09a;}

  .cv-create .composer {flex:none; border-top:1px solid var(--line); padding:14px 22px 16px; background:var(--paper2);}
  .cv-create .composer .box {position:relative; height:62px; background:var(--paper); border:1px solid var(--line2); display:flex; align-items:center; padding:0 18px;}
  .cv-create .composer .box::before {content:""; position:absolute; inset:4px; border:1px solid rgba(169,138,99,.22); pointer-events:none;}
  .cv-create .composer .box .phin {flex:1; min-width:0; border:none; outline:none; background:transparent; box-shadow:none; border-radius:0; padding:0;
    font-family:var(--kai); font-size:13.5px; color:var(--ink);}
  .cv-create .composer .box .phin::placeholder {color:var(--faint);}
  .cv-create .composer .box .phin:focus {border:none; box-shadow:none;}
  .cv-create .blink {display:inline-block; font-style:normal; animation:rcr-blink 1s steps(2) infinite;}
  @keyframes rcr-blink {50% {opacity:0;}}
  .cv-create .composer .box .send {flex:none; width:104px; height:48px; margin-left:14px; background:var(--green); position:relative; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; cursor:pointer;}
  .cv-create .composer .box .send::before {content:""; position:absolute; inset:3px; border:1px solid rgba(193,168,111,.45);}
  .cv-create .composer .box .send .zh {font-family:var(--serif); font-size:13px; letter-spacing:.18em; color:#f3ead6; position:relative; display:flex; align-items:center; gap:6px;}
  .cv-create .composer .box .send .en {font-family:var(--serifen); font-size:7px; letter-spacing:.26em; color:rgba(243,234,214,.65); position:relative;}
  .cv-create .composer .up {display:flex; align-items:center; gap:8px; margin-top:11px; padding-left:2px;}
  .cv-create .composer .up .ic {color:var(--gold); display:grid; place-items:center;}
  .cv-create .composer .up .tx {font-family:var(--kai); font-size:11px; color:var(--soft); letter-spacing:.02em;}
  .cv-create .composer .up .tx b {color:var(--ink); font-weight:700;}

  .cv-create .preview {width:472px; flex:none; display:flex; flex-direction:column;}
  .cv-create .preview .ph {display:flex; align-items:center; gap:9px; margin-bottom:11px;}
  .cv-create .preview .ph .dot {width:5px; height:5px; transform:rotate(45deg); background:var(--gold);}
  .cv-create .preview .ph .zh {font-family:var(--serif); font-size:13px; font-weight:700; letter-spacing:.08em; color:var(--soft);}
  .cv-create .preview .ph .en {font-family:var(--serifen); font-size:7.5px; letter-spacing:.2em; color:var(--faint);}
  .cv-create .preview .ph .live {margin-left:auto; display:flex; align-items:center; gap:6px; font-family:var(--serifen); font-size:8px; letter-spacing:.18em; color:#7a8a6a;}
  .cv-create .preview .ph .live i {width:6px; height:6px; border-radius:50%; background:#7a9a6a;}

  .cv-create .card {flex:1; min-height:0; background:var(--paper); border:1px solid var(--line2); position:relative; display:flex; flex-direction:column; overflow:hidden;}
  .cv-create .card::before {content:""; position:absolute; inset:7px; border:1px solid rgba(169,138,99,.28); pointer-events:none; z-index:3;}
  .cv-create .card .head {position:relative; height:184px; flex:none; border-bottom:1px solid var(--line); overflow:hidden;
    background:linear-gradient(135deg,#efe6d4,#e7dcc6);}
  .cv-create .card .head .ph-art {position:absolute; inset:0; display:grid; place-items:center; color:var(--line2);}
  .cv-create .card .head .ph-art .frame {width:118px; height:118px; border:1px dashed var(--line2); display:grid; place-items:center; gap:6px; color:var(--faint);}
  .cv-create .card .head .ph-art .frame span {font-family:var(--kai); font-size:10px; letter-spacing:.1em;}
  .cv-create .card .head .veil {position:absolute; left:0; right:0; bottom:0; height:96px; background:linear-gradient(180deg,transparent,rgba(44,40,32,.34));}
  .cv-create .card .head .kindtag {position:absolute; left:20px; top:18px; display:flex; align-items:center; gap:7px; padding:4px 11px; background:rgba(250,244,234,.86); border:1px solid var(--line2);}
  .cv-create .card .head .kindtag .zh {font-family:var(--serif); font-size:11px; letter-spacing:.1em; color:var(--ink);}
  .cv-create .card .head .kindtag .en {font-family:var(--serifen); font-size:7px; letter-spacing:.18em; color:var(--gold);}
  .cv-create .card .head .nm {position:absolute; left:20px; bottom:14px; z-index:2;}
  .cv-create .card .head .nm b {display:block; font-family:var(--serif); font-size:30px; font-weight:700; letter-spacing:.08em; color:#fbf5ea; text-shadow:0 1px 5px rgba(0,0,0,.45);}
  .cv-create .card .head .nm s {font-family:var(--kai); font-size:11.5px; letter-spacing:.06em; color:rgba(251,245,234,.92); text-decoration:none; text-shadow:0 1px 3px rgba(0,0,0,.45);}

  .cv-create .card .fields {flex:1; min-height:0; overflow-y:auto; padding:16px 22px 4px;}
  .cv-create .card .fields::-webkit-scrollbar {width:5px;} .cv-create .card .fields::-webkit-scrollbar-thumb {background:var(--line2);}
  .cv-create .card .frow {padding:11px 0 12px; border-bottom:1px solid #ece2cf; position:relative;}
  .cv-create .card .frow .fk {display:flex; align-items:center; gap:8px; margin-bottom:6px;}
  .cv-create .card .frow .fk .k {font-family:var(--serif); font-size:13px; font-weight:700; letter-spacing:.1em; color:var(--ink);}
  .cv-create .card .frow .fk .en {font-family:var(--serifen); font-size:7px; letter-spacing:.2em; color:var(--faint);}
  .cv-create .card .frow .fk .lock {margin-left:6px; color:var(--gold); display:grid; place-items:center;}
  .cv-create .card .frow .fk .new {margin-left:auto; font-family:var(--serifen); font-size:7.5px; letter-spacing:.12em; padding:1px 5px;}
  .cv-create .card .frow .fv {font-family:var(--kai); font-size:12.5px; line-height:1.85; color:var(--soft); letter-spacing:.01em;}
  .cv-create .card .frow.hl-gold {margin:0 -10px; padding-left:10px; padding-right:10px; background:linear-gradient(90deg,rgba(193,168,111,.10),transparent);}
  .cv-create .card .frow.hl-gold::before {content:""; position:absolute; left:0; top:6px; bottom:6px; width:2px; background:var(--gold2);}
  .cv-create .card .frow.hl-gold .new {color:#8a6f49; border:1px solid var(--line2);}
  .cv-create .card .frow.hl-green {margin:0 -10px; padding-left:10px; padding-right:10px; background:linear-gradient(90deg,rgba(52,70,61,.09),transparent);}
  .cv-create .card .frow.hl-green::before {content:""; position:absolute; left:0; top:6px; bottom:6px; width:2px; background:#5a7a55;}
  .cv-create .card .frow.hl-green .new {color:#46604e; border:1px solid #a7baa0;}
  .cv-create .card .frow .fv .secret {color:var(--faint); font-style:italic;}

  .cv-create .card .cardfoot {flex:none; display:flex; gap:0; border-top:1px solid var(--line2);}
  .cv-create .card .cardfoot .b {flex:1; height:54px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:3px; cursor:pointer;}
  .cv-create .card .cardfoot .b .zh {font-family:var(--serif); font-size:13.5px; letter-spacing:.14em;}
  .cv-create .card .cardfoot .b .en {font-family:var(--serifen); font-size:7px; letter-spacing:.24em;}
  .cv-create .card .cardfoot .b.ghost {background:var(--paper3); color:var(--soft);}
  .cv-create .card .cardfoot .b.ghost .en {color:var(--faint);}
  .cv-create .card .cardfoot .b.ghost {border-right:1px solid var(--line2);}
  .cv-create .card .cardfoot .b.solid {background:var(--green); color:#f3ead6; position:relative;}
  .cv-create .card .cardfoot .b.solid::before {content:""; position:absolute; inset:4px; border:1px solid rgba(193,168,111,.4);}
  .cv-create .card .cardfoot .b.solid .zh, .cv-create .card .cardfoot .b.solid .en {position:relative;}
  .cv-create .card .cardfoot .b.solid .en {color:rgba(243,234,214,.66);}
      `}</style>

      {/* 左 引擎竖栏 */}
      {/* 左侧引擎竖栏(全站统一 ReconRail;本次创作摘要作底部插槽) */}
      <window.ReconRail active="build" onNav={onNav}>
        <div className="pcard">
          <div className="ttl">本次创作<span>DRAFT</span></div>
          <div className="draft">
            <div className="dk">{dKind} · {dName}</div>
            <div className="dn">{dFields.length} 个字段</div>
          </div>
        </div>
      </window.ReconRail>

      {/* 顶 标题栏 */}
      <div className="top">
        <div className="crumb">
          <span className="ti">创作桌</span>
          <span className="en">The Atelier</span>
        </div>
        {/* 存草稿/撤销/重做/齿轮均未实现 → 隐藏,不摆死按钮;实现后再恢复 */}
      </div>

      {/* 卡分类索引签 */}
      <div className="tabs">
        {KINDS.map((t, i) => (
          <div key={i} className={"tab" + (i === cardKind ? " on" : "")} onClick={() => onKind(i)}>
            <span className="zh">{t.zh}</span>
            <span className="en">{t.en}</span>
          </div>
        ))}
      </div>

      {/* 主体两栏 */}
      <div className="deck">
        {/* 左：与 AI 对谈 */}
        <div className="talk">
          <div className="th">
            <span className="badge"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 20l1-4L16 5l3 3L8 19z" /><path d="M14 7l3 3" /></svg></span>
            <b>与执笔人对谈</b><span className="en">CO-WRITING</span>
            <span className="hint">你说人话，执笔人替你落笔</span>
          </div>
          <div className="scroll" ref={scrollRef}>
            <div className="syscue"><span>立卡 · {dKind}草拟中</span></div>
            {MESSAGES.map((m, i) => {
              const mine = m.who === "你";
              return (
                <div key={i} className={"line " + (mine ? "me" : "ai")}>
                  <div className="lh">
                    <span className="dot"></span>
                    <span className="who">{mine ? "你 · 口述" : "执笔 · 坊"}</span>
                    <span className="en">{mine ? "YOU" : "THE PEN"}</span>
                    <span className="ln"></span>
                  </div>
                  <div className="bd">{m.text}</div>
                </div>
              );
            })}
            {/* 等待反馈:LLM 推演 5-30s,给一行动效占位 */}
            {busy && (
              <div className="line ai">
                <div className="lh"><span className="dot"></span><span className="who">执笔 · 坊</span><span className="en">THE PEN</span><span className="ln"></span></div>
                <div className="bd" style={{ color: "var(--faint)", fontStyle: "italic" }}>执笔人推演中<i className="blink">▋</i></div>
              </div>
            )}
          </div>
          {/* 输入框换真 input:此前的 contentEditable 提示语是真实 DOM 文本,会和用户输入混在一起发给 AI */}
          <div className="composer">
            <div className="box">
              <input
                className="phin"
                value={value}
                placeholder={busy ? "执笔人推演中,稍候片刻…" : "用一句话告诉我下一步——你想往这张卡里加点什么?"}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !busy && !(e.nativeEvent || e).isComposing) { e.preventDefault(); onSend(); } }}
              />
              <div className="send" onClick={() => !busy && onSend()} style={{ opacity: busy ? 0.55 : 1, cursor: busy ? "default" : "pointer" }}>
                <span className="zh"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z" /></svg>{busy ? "推演中" : "执笔"}</span>
                <span className="en">ENTER</span>
              </div>
            </div>
          </div>
        </div>

        {/* 右：实时卡预览 */}
        <div className="preview">
          <div className="ph">
            <span className="dot"></span><span className="zh">实时卡预览</span><span className="en">LIVE CARD</span>
            <span className="live"><i></i>正在生长</span>
          </div>
          <div className="card">
            <div className="head">
              <div className="ph-art">
                <div className="frame">
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="3" y="4" width="18" height="16" /><path d="M3 16l5-5 4 4 3-3 6 6" /><circle cx="9" cy="9" r="1.5" /></svg>
                  <span>立绘待生成</span>
                </div>
              </div>
              <div className="veil"></div>
              <div className="kindtag"><span className="zh">{dKind}</span>{dKindEn && <span className="en">{dKindEn}</span>}</div>
              <div className="nm"><b>{dName}</b></div>
            </div>
            <div className="fields">
              {dFields.map((f, i) => (
                <div key={i} className={"frow" + (f.fresh ? (f.hidden ? " hl-green" : " hl-gold") : "")}>
                  <div className="fk">
                    <span className="k">{f.k}</span>
                    {f.hidden && (
                      <span className="lock"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="5" y="11" width="14" height="9" rx="1" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg></span>
                    )}
                    {f.fresh && <span className="new">{f.hidden ? "刚改 · 已锁" : "刚改"}</span>}
                  </div>
                  <div className="fv">
                    {f.hidden ? <span className="secret">{f.v}</span> : f.v}
                  </div>
                </div>
              ))}
            </div>
            {/* 「存草稿」未实现(此前只弹 alert 假装存了)→ 移除;入库是唯一真实出口 */}
            <div className="cardfoot">
              <div className="b solid" onClick={() => onSaveCard()}><span className="zh">收入卡库</span><span className="en">ADD TO LIBRARY</span></div>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

window.ReconCreate = ReconCreate;
