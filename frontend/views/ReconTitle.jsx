// ReconTitle — 标题/登录开屏(背景留槽 title-bg.png)。按钮回调:onStart/onLogin/onGuest/onResume。
function ReconTitle(props) {
  const p = props || {};
  const onStart = p.onStart || (() => {});
  const onLogin = p.onLogin || (() => {});
  const onGuest = p.onGuest || (() => {});
  const onResume = p.onResume || (() => {});
  return (
    <div className="cv-title">
      <style>{`
  .cv-title {
    --cream:#f0e9da; --cream-dim:rgba(240,234,222,.62); --cream-faint:rgba(236,230,216,.4);
    --gold:#cbb079; --gold2:#d9c290; --ink:#2b2620; --soft:#6b6354;
    --btn:rgba(243,237,222,.90); --btn-line:rgba(255,255,255,.5);
    --serif:"Songti SC","STSong","SimSun",serif; --serifen:Georgia,"Times New Roman",serif; --kai:"Kaiti SC","STKaiti","KaiTi",serif;
    position:relative; width:100%; height:100%; min-height:100vh; overflow:hidden; background:#141a26; color:var(--cream); font-family:var(--kai);
  }
  .cv-title * { box-sizing:border-box; }
  .cv-title .bg { position:absolute; inset:0; z-index:0; background:center/cover no-repeat url(assets/recon/title-bg.png), linear-gradient(160deg,#27324a,#161c28 60%,#0e1118); }
  .cv-title .scrim { position:absolute; inset:0; z-index:1; pointer-events:none;
    background:linear-gradient(90deg, rgba(10,13,20,.62) 0%, rgba(10,13,20,.30) 34%, rgba(10,13,20,0) 56%),
               linear-gradient(0deg, rgba(10,13,20,.5) 0%, transparent 24%, transparent 78%, rgba(10,13,20,.34) 100%); }
  .cv-title > *:not(.bg):not(.scrim) { position:absolute; z-index:2; }
  /* 开屏:整层标题内容淡入,按钮组再轻错峰一拍 */
  @keyframes rct-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
  .cv-title .brand, .cv-title .lang, .cv-title .ripple, .cv-title .astra, .cv-title .emblem,
  .cv-title .title, .cv-title .titen, .cv-title .tagline, .cv-title .taglineen,
  .cv-title .resume, .cv-title .foot-l, .cv-title .foot-c, .cv-title .foot-r { animation: rct-in .5s cubic-bezier(.22,1,.36,1) both; }
  .cv-title .btns { animation: rct-in .5s cubic-bezier(.22,1,.36,1) .14s both; }
  @media (prefers-reduced-motion: reduce){ .cv-title .btns, .cv-title .brand, .cv-title .lang, .cv-title .ripple, .cv-title .astra, .cv-title .emblem, .cv-title .title, .cv-title .titen, .cv-title .tagline, .cv-title .taglineen, .cv-title .resume, .cv-title .foot-l, .cv-title .foot-c, .cv-title .foot-r { animation-duration:1ms; } }
  .cv-title .brand { left:40px; top:36px; display:flex; align-items:center; gap:11px; }
  .cv-title .brand svg { color:var(--gold2); }
  .cv-title .brand span { font-family:var(--serifen); font-size:14px; letter-spacing:.34em; color:var(--cream); font-weight:600; }
  .cv-title .lang { right:40px; top:30px; display:flex; align-items:center; gap:9px; height:40px; padding:0 16px;
    border:1px solid rgba(203,176,121,.6); background:rgba(20,22,30,.4); color:var(--cream); font-family:var(--serif); font-size:14px; letter-spacing:.1em; cursor:pointer; }
  .cv-title .lang svg { color:var(--gold2); }
  .cv-title .ripple { right:430px; top:62px; text-align:right; font-family:var(--serifen); letter-spacing:.32em; line-height:2.5; color:var(--cream-dim); font-size:13px; }
  .cv-title .ripple b { color:var(--cream); font-weight:600; }
  .cv-title .astra { right:42px; top:150px; text-align:right; font-family:var(--serifen); letter-spacing:.3em; line-height:2.1; color:var(--cream-faint); font-size:12px; }
  /* ── 阴阳文(正负形互锁,参考明日方舟官网):奶白色块自左出血;
     阴文 A2 = 双层巨字,块外奶白、块内被 clip 成暗夜色(跨边界反色);
     阳文 YoRHa引擎 = 块内实心墨字。坐标在 .yy(820×520)内,与开屏绝对定位对齐。 */
  .cv-title .yy { left:0; top:0; width:820px; height:520px; pointer-events:none; }
  .cv-title .yy .blk { position:absolute; left:0; top:120px; width:560px; height:240px; background:var(--cream);
    box-shadow:0 18px 50px -18px rgba(0,0,0,.55); }
  .cv-title .yy .lay { position:absolute; inset:0; }
  .cv-title .yy .lay .a2 { position:absolute; left:330px; top:80px; margin:0;
    font-family:"Arial Black","Segoe UI Black",Impact,sans-serif; font-weight:900; font-size:280px; line-height:1.04;
    letter-spacing:-.02em; user-select:none; }
  .cv-title .yy .lay.out .a2 { color:var(--cream); text-shadow:0 4px 24px rgba(0,0,0,.35); }
  .cv-title .yy .lay.in { clip-path:inset(120px 260px 160px 0); }  /* 色块矩形(0,120,560,240),层框=yy(820×520) */
  .cv-title .yy .lay.in .a2 { color:#141a26; text-shadow:none; }
  .cv-title .yy .mark { position:absolute; left:56px; top:150px; }
  .cv-title .yy .mark .en { font-family:var(--serifen); font-size:11px; letter-spacing:.4em; color:#8a6f3a; }
  .cv-title .yy .mark h1 { margin:10px 0 0; font-family:var(--serif); font-size:46px; font-weight:900; letter-spacing:.1em; color:#1c2433; white-space:nowrap; }
  .cv-title .yy .mark .sub { font-family:var(--kai); font-size:13px; letter-spacing:.3em; color:#6b6354; margin-top:12px; }
  .cv-title .tagline { left:70px; top:400px; font-family:var(--serif); font-size:22px; line-height:1.95; color:#efe9dc; text-shadow:0 2px 10px rgba(0,0,0,.5); }
  .cv-title .taglineen { left:70px; top:474px; font-family:var(--serifen); font-size:12px; letter-spacing:.22em; line-height:1.9; color:var(--cream-dim); }
  .cv-title .btns { left:64px; top:582px; display:flex; flex-direction:column; gap:14px; }
  .cv-title .btn { display:flex; align-items:center; gap:18px; width:362px; height:62px; padding:0 24px; background:var(--btn); border:1px solid var(--btn-line); cursor:pointer; position:relative; box-shadow:0 6px 22px -10px rgba(0,0,0,.6); }
  .cv-title .btn::after { content:""; position:absolute; inset:3px; border:1px solid rgba(43,38,32,.12); pointer-events:none; }
  .cv-title .btn .ic { width:26px; height:26px; flex:none; display:grid; place-items:center; color:var(--ink); }
  .cv-title .btn .tx .zh { font-family:var(--serif); font-size:21px; font-weight:700; letter-spacing:.14em; color:var(--ink); line-height:1.1; }
  .cv-title .btn .tx .en { font-family:var(--serifen); font-size:10px; letter-spacing:.26em; color:var(--soft); margin-top:3px; }
  .cv-title .btn.primary { background:linear-gradient(180deg,#f6efdd,#ece2c6); border-color:rgba(203,176,121,.7); }
  .cv-title .resume { left:96px; top:832px; font-family:var(--serif); font-size:15px; letter-spacing:.16em; color:var(--cream); opacity:.86; cursor:pointer; }
  .cv-title .resume b { color:var(--gold2); font-weight:400; margin:0 4px; }
  .cv-title .foot-l { left:40px; bottom:30px; display:flex; align-items:center; gap:26px; color:var(--cream-dim); font-family:var(--kai); font-size:13px; letter-spacing:.06em; }
  .cv-title .foot-l a { display:flex; align-items:center; gap:7px; cursor:pointer; color:var(--cream-dim); }
  .cv-title .foot-l a svg { color:var(--gold2); }
  .cv-title .foot-c { left:0; right:0; bottom:30px; text-align:center; font-family:var(--serifen); font-size:12px; letter-spacing:.08em; color:var(--cream-faint); }
  .cv-title .foot-r { right:40px; bottom:30px; display:flex; align-items:center; gap:8px; font-family:var(--kai); font-size:12.5px; color:var(--cream-dim); }
  .cv-title .foot-r svg { color:#d8b46a; }
`}</style>
      <div className="bg"></div>
      <div className="scrim"></div>
      <div className="brand">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="12" cy="12" r="9" /><path d="M12 4l1.6 6.4L20 12l-6.4 1.6L12 20l-1.6-6.4L4 12l6.4-1.6z" /></svg>
        <span>YORHA-A2 ENGINE</span>
      </div>
      <div className="lang">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
        简体中文
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
      </div>
      <div className="ripple">EVERY <b>CHOICE</b><br />LEAVES A <b>RIPPLE</b><br />IN THE <b>STORY.</b></div>
      <div className="astra">AD ASTRA<br />PER ASPERA</div>
      {/* 阴阳文店招:阴文 A2(跨色块边界反色)+ 阳文 YoRHa引擎(块内实心) */}
      <div className="yy">
        <div className="blk"></div>
        <div className="lay out"><div className="a2">A2</div></div>
        <div className="lay in"><div className="a2">A2</div></div>
        <div className="mark">
          <div className="en">YORHA-A2 ENGINE</div>
          <h1>YoRHa引擎</h1>
          <div className="sub">每个选择 · 都在书写</div>
        </div>
      </div>
      <div className="tagline">你的一次选择，将改写无数故事的命运。<br />欢迎来到，属于你的世界。</div>
      <div className="taglineen">YOUR CHOICES. COUNTLESS POSSIBILITIES.<br />THIS IS YOUR STORY.</div>
      <div className="btns">
        <div className="btn primary" onClick={onStart}>
          <span className="ic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z" fill="currentColor" /></svg></span>
          <div className="tx"><div className="zh">开始旅程</div><div className="en">START JOURNEY</div></div>
        </div>
        <div className="btn" onClick={onLogin}>
          <span className="ic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg></span>
          <div className="tx"><div className="zh">登录 / 注册</div><div className="en">LOGIN / REGISTER</div></div>
        </div>
        <div className="btn" onClick={onGuest}>
          <span className="ic"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 13c2-5 14-5 16 0" /><path d="M4 13c0 3 3.5 4 8 4s8-1 8-4" /><circle cx="9" cy="12" r="1.3" fill="currentColor" /><circle cx="15" cy="12" r="1.3" fill="currentColor" /></svg></span>
          <div className="tx"><div className="zh">游客模式</div><div className="en">GUEST MODE</div></div>
        </div>
      </div>
      <div className="resume" onClick={onResume}>《<b>继续游戏</b>》</div>
      <div className="foot-l">
        <a><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 11l20-8-8 20-3-9z" /></svg>官方网站</a>
        <a><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7M12 17h.01" /></svg>帮助中心</a>
        <a><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l4 4-4 4-4-4z" /><path d="M5 12l3 3-3 3-3-3zM19 12l3 3-3 3-3-3z" /></svg>社区</a>
      </div>
      <div className="foot-c">© 2026 YoRHa-A2 Engine. All Rights Reserved.</div>
      <div className="foot-r">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></svg>
        本游戏包含自动生成内容，请理性体验。
      </div>
    </div>
  );
}
window.ReconTitle = ReconTitle;
