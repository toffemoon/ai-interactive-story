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
  .cv-title .brand { left:40px; top:36px; display:flex; align-items:center; gap:11px; }
  .cv-title .brand svg { color:var(--gold2); }
  .cv-title .brand span { font-family:var(--serifen); font-size:14px; letter-spacing:.34em; color:var(--cream); font-weight:600; }
  .cv-title .lang { right:40px; top:30px; display:flex; align-items:center; gap:9px; height:40px; padding:0 16px;
    border:1px solid rgba(203,176,121,.6); background:rgba(20,22,30,.4); color:var(--cream); font-family:var(--serif); font-size:14px; letter-spacing:.1em; cursor:pointer; }
  .cv-title .lang svg { color:var(--gold2); }
  .cv-title .ripple { right:430px; top:62px; text-align:right; font-family:var(--serifen); letter-spacing:.32em; line-height:2.5; color:var(--cream-dim); font-size:13px; }
  .cv-title .ripple b { color:var(--cream); font-weight:600; }
  .cv-title .astra { right:42px; top:150px; text-align:right; font-family:var(--serifen); letter-spacing:.3em; line-height:2.1; color:var(--cream-faint); font-size:12px; }
  .cv-title .emblem { left:176px; top:182px; color:var(--gold2); opacity:.96; filter:drop-shadow(0 2px 8px rgba(0,0,0,.5)); }
  .cv-title .title { left:64px; top:236px; margin:0; font-family:var(--serif); font-weight:900; font-size:92px; letter-spacing:.16em; color:#f6f1e6; text-shadow:0 3px 18px rgba(0,0,0,.55); }
  .cv-title .titen { left:70px; top:352px; display:flex; align-items:center; gap:16px; }
  .cv-title .titen i { width:34px; height:1px; background:var(--gold2); opacity:.8; }
  .cv-title .titen span { font-family:var(--serifen); font-size:22px; letter-spacing:.5em; color:var(--cream); font-weight:600; }
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
  /* —— 开屏演出:错峰入场 + 罗盘常态浮动 —— */
  @keyframes ttIn { from {opacity:0; transform:translateY(18px);} to {opacity:1; transform:translateY(0);} }
  @keyframes ttFloat { 0%,100% {transform:translateY(0);} 50% {transform:translateY(-7px);} }
  .cv-title .emblem { animation: ttIn .7s cubic-bezier(.22,1,.36,1) .1s both, ttFloat 5.6s ease-in-out 1.2s infinite; }
  .cv-title .title { animation: ttIn .7s cubic-bezier(.22,1,.36,1) .2s both; }
  .cv-title .titen { animation: ttIn .6s cubic-bezier(.22,1,.36,1) .34s both; }
  .cv-title .tagline { animation: ttIn .6s cubic-bezier(.22,1,.36,1) .46s both; }
  .cv-title .taglineen { animation: ttIn .6s cubic-bezier(.22,1,.36,1) .56s both; }
  .cv-title .btns .btn { transition: transform .22s cubic-bezier(.22,1,.36,1), box-shadow .22s; }
  .cv-title .btns .btn:hover { transform: translateX(6px); box-shadow: 0 10px 28px -10px rgba(0,0,0,.7); }
  .cv-title .btns .btn:nth-child(1) { animation: ttIn .55s cubic-bezier(.22,1,.36,1) .62s both; }
  .cv-title .btns .btn:nth-child(2) { animation: ttIn .55s cubic-bezier(.22,1,.36,1) .72s both; }
  .cv-title .btns .btn:nth-child(3) { animation: ttIn .55s cubic-bezier(.22,1,.36,1) .82s both; }
  .cv-title .resume { animation: ttIn .55s cubic-bezier(.22,1,.36,1) .94s both; }
  .cv-title .ripple, .cv-title .astra, .cv-title .brand, .cv-title .lang { animation: ttIn .8s ease .3s both; }
  @media (prefers-reduced-motion: reduce){ .cv-title * {animation-duration:1ms !important;} }
`}</style>
      <div className="bg"></div>
      <div className="scrim"></div>
      <div className="brand">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="12" cy="12" r="9" /><path d="M12 4l1.6 6.4L20 12l-6.4 1.6L12 20l-1.6-6.4L4 12l6.4-1.6z" /></svg>
        <span>NARRATIVE ENGINE</span>
      </div>
      <div className="lang">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>
        简体中文
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6" /></svg>
      </div>
      <div className="ripple">EVERY <b>CHOICE</b><br />LEAVES A <b>RIPPLE</b><br />IN THE <b>STORY.</b></div>
      <div className="astra">AD ASTRA<br />PER ASPERA</div>
      <svg className="emblem" width="150" height="150" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.7">
        <circle cx="12" cy="12" r="11" /><circle cx="12" cy="12" r="8.4" />
        <path d="M12 1.2l1.7 8.9L22 12l-8.3 1.9L12 22.8l-1.7-8.9L2 12l8.3-1.9z" fill="currentColor" fillOpacity="0.9" stroke="none" />
        <path d="M12 4.5l.8 6.7 6.7.8-6.7.8-.8 6.7-.8-6.7L4.5 12l6.7-.8z" fill="#fff7e4" stroke="none" />
      </svg>
      <h1 className="title">叙事引擎</h1>
      <div className="titen"><i></i><span>NARRATIVE ENGINE</span></div>
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
      <div className="foot-c">© 2026 Narrative Engine. All Rights Reserved.</div>
      <div className="foot-r">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></svg>
        本游戏包含 AI 生成内容，请理性体验。
      </div>
    </div>
  );
}
window.ReconTitle = ReconTitle;
