// ReconTitle — 标题/登录开屏。背景 = 720° 全景(title-pano.jpg,2:1 等距圆柱):
// WebGL 球面投影(真全景透视),慢速自转 + 指针拖拽看向四周;无 WebGL 时回退平铺横移。
function ReconTitle(props) {
  const p = props || {};
  const onStart = p.onStart || (() => {});
  const onLogin = p.onLogin || (() => {});
  const onGuest = p.onGuest || (() => {});
  const onResume = p.onResume || (() => {});
  const panoRef = React.useRef(null);
  React.useEffect(() => {
    const el = panoRef.current;
    if (!el) return undefined;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0, yaw = 0, pitch = 0, dragging = false, lastX = 0, lastY = 0, last = performance.now();
    let gl = null, ready = false, flat = false, uYaw, uPitch, uAsp;
    const PX_PER_RAD = 2048 / (2 * Math.PI); // 回退平铺时 1rad ≈ 326px

    function flatInit() { // 回退:CSS 平铺横移(无透视,但保证有画面)
      flat = true;
      el.style.backgroundImage = "url(assets/recon/title-pano.jpg)";
      el.style.backgroundRepeat = "repeat-x";
      el.style.backgroundSize = "auto 100%";
    }
    try {
      gl = el.getContext("webgl", { antialias: true }) || el.getContext("experimental-webgl");
      if (!gl) throw new Error("no webgl");
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader");
        return s;
      };
      const vs = sh(gl.VERTEX_SHADER, "attribute vec2 a;varying vec2 v;void main(){v=a;gl_Position=vec4(a,0.,1.);}");
      // 视线方向先俯仰(绕x)再偏航(绕y),反算等距圆柱 UV;垂直视场角 2*0.54rad ≈ 62°
      const fs = sh(gl.FRAGMENT_SHADER,
        "precision mediump float;varying vec2 v;uniform sampler2D t;uniform float yw,pt,asp;" +
        "void main(){float ht=tan(0.54);vec3 d=normalize(vec3(v.x*ht*asp,v.y*ht,1.0));" +
        "float cp=cos(pt),sp=sin(pt);d=vec3(d.x,d.y*cp-d.z*sp,d.y*sp+d.z*cp);" +
        "float cy=cos(yw),sy=sin(yw);d=vec3(d.x*cy+d.z*sy,d.y,-d.x*sy+d.z*cy);" +
        "float u=atan(d.x,d.z)*0.15915494+0.5;float vv=0.5-asin(clamp(d.y,-1.,1.))*0.31830988;" +
        "gl_FragColor=texture2D(t,vec2(u,vv));}");
      const prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "a");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      uYaw = gl.getUniformLocation(prog, "yw");
      uPitch = gl.getUniformLocation(prog, "pt");
      uAsp = gl.getUniformLocation(prog, "asp");
      const tex = gl.createTexture();
      const img = new Image();
      img.onload = () => {
        try {
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); // 2048×1024 是 POT,可无缝环绕
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.generateMipmap(gl.TEXTURE_2D);
          ready = true;
        } catch (err) { flatInit(); }
      };
      img.onerror = flatInit;
      img.src = "assets/recon/title-pano.jpg";
    } catch (err) { flatInit(); }

    function size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(el.clientWidth * dpr));
      const h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (el.width !== w || el.height !== h) {
        el.width = w; el.height = h;
        if (gl) gl.viewport(0, 0, w, h);
      }
    }
    function tick(now) {
      const dt = Math.min(64, now - last); last = now;
      if (!dragging && !reduce) yaw += dt * 0.00005; // 慢慢转:全周 ~2 分钟
      if (flat) {
        el.style.backgroundPosition = (-yaw * PX_PER_RAD) + "px 0px";
      } else if (ready) {
        size();
        gl.uniform1f(uYaw, yaw);
        gl.uniform1f(uPitch, pitch);
        gl.uniform1f(uAsp, el.width / el.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    const down = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; el.style.cursor = "grabbing"; try { el.setPointerCapture(e.pointerId); } catch (err) {} };
    const move = (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      const hfov = 2 * Math.atan(Math.tan(0.54) * (el.clientWidth / Math.max(1, el.clientHeight)));
      const k = hfov / Math.max(1, el.clientWidth); // 1px 对应的视角,画面跟手
      yaw -= dx * k;
      pitch = Math.max(-0.42, Math.min(0.42, pitch - dy * k));
    };
    const up = () => { dragging = false; el.style.cursor = "grab"; };
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);
  return (
    <div className="cv-title">
      <style>{`
  .cv-title {
    --inkk:#211b12; --ink-dim:rgba(43,38,32,.72); --ink-faint:rgba(43,38,32,.5);
    --gold:#cbb079; --gold2:#d9c290; --goldink:#8a6f4a; --ink:#2b2620; --soft:#6b6354;
    --btn:rgba(247,242,231,.92); --btn-line:rgba(169,138,99,.45);
    --serif:"Songti SC","STSong","SimSun",serif; --serifen:Georgia,"Times New Roman",serif; --kai:"Kaiti SC","STKaiti","KaiTi",serif;
    position:relative; width:100%; height:100%; min-height:100vh; overflow:hidden; background:#e9e2d2; color:var(--inkk); font-family:var(--kai);
  }
  .cv-title * { box-sizing:border-box; }
  .cv-title .bg { position:absolute; inset:0; z-index:0; background:linear-gradient(160deg,#efe8d8,#ded4bf 60%,#cfc4ac); }
  /* 720° 全景层:WebGL canvas 球面投影;可拖拽(grab) */
  .cv-title .pano { position:absolute; inset:0; z-index:0; display:block; width:100%; height:100%;
    cursor:grab; touch-action:none; user-select:none; }
  .cv-title .scrim { position:absolute; inset:0; z-index:1; pointer-events:none;
    background:radial-gradient(640px 500px at 18% 40%, rgba(246,240,228,.72), transparent 70%),
               linear-gradient(90deg, rgba(246,240,228,.88) 0%, rgba(246,240,228,.58) 34%, rgba(246,240,228,.14) 62%, rgba(246,240,228,.02) 100%),
               linear-gradient(0deg, rgba(246,240,228,.5) 0%, transparent 26%, transparent 78%, rgba(246,240,228,.34) 100%); }
  .cv-title > *:not(.bg):not(.scrim):not(.pano) { position:absolute; z-index:2; }
  /* 开屏:整层标题内容淡入,按钮组再轻错峰一拍 */
  @keyframes rct-in { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
  .cv-title .brand, .cv-title .lang, .cv-title .ripple, .cv-title .astra, .cv-title .emblem,
  .cv-title .title, .cv-title .titen, .cv-title .tagline, .cv-title .taglineen,
  .cv-title .resume, .cv-title .foot-l, .cv-title .foot-c, .cv-title .foot-r { animation: rct-in .5s cubic-bezier(.22,1,.36,1) both; }
  .cv-title .btns { animation: rct-in .5s cubic-bezier(.22,1,.36,1) .14s both; }
  @media (prefers-reduced-motion: reduce){ .cv-title .btns, .cv-title .brand, .cv-title .lang, .cv-title .ripple, .cv-title .astra, .cv-title .emblem, .cv-title .title, .cv-title .titen, .cv-title .tagline, .cv-title .taglineen, .cv-title .resume, .cv-title .foot-l, .cv-title .foot-c, .cv-title .foot-r { animation-duration:1ms; } }
  .cv-title .brand { left:40px; top:36px; display:flex; align-items:center; gap:11px; }
  .cv-title .brand svg { color:var(--goldink); }
  .cv-title .brand span { font-family:var(--serifen); font-size:14px; letter-spacing:.34em; color:var(--inkk); font-weight:600; }
  .cv-title .lang { right:40px; top:30px; display:flex; align-items:center; gap:9px; height:40px; padding:0 16px;
    border:1px solid rgba(169,138,99,.6); background:rgba(250,244,234,.6); color:var(--inkk); font-family:var(--serif); font-size:14px; letter-spacing:.1em; cursor:pointer; }
  .cv-title .lang svg { color:var(--goldink); }
  .cv-title .ripple { right:430px; top:62px; text-align:right; font-family:var(--serifen); letter-spacing:.32em; line-height:2.5; color:var(--ink-dim); font-size:13px; }
  .cv-title .ripple b { color:var(--inkk); font-weight:700; }
  .cv-title .astra { right:42px; top:150px; text-align:right; font-family:var(--serifen); letter-spacing:.3em; line-height:2.1; color:var(--ink-faint); font-size:12px; }
  .cv-title .emblem { left:176px; top:182px; color:var(--goldink); opacity:.96; filter:drop-shadow(0 2px 8px rgba(255,250,238,.7)); }
  .cv-title .title { left:64px; top:244px; margin:0; font-family:var(--serif); font-weight:700; font-size:76px; letter-spacing:.08em; color:#17120b; text-shadow:0 2px 14px rgba(246,240,228,.8); white-space:nowrap; }
  .cv-title .title b { font-weight:900; }
  .cv-title .titen { left:70px; top:352px; display:flex; align-items:center; gap:16px; }
  .cv-title .titen i { width:34px; height:1px; background:var(--goldink); opacity:.8; }
  .cv-title .titen span { font-family:var(--serifen); font-size:22px; letter-spacing:.5em; color:var(--inkk); font-weight:700; }
  .cv-title .tagline { left:70px; top:400px; font-family:var(--serif); font-size:22px; line-height:1.95; color:var(--ink); text-shadow:0 1px 8px rgba(246,240,228,.7); }
  .cv-title .taglineen { left:70px; top:474px; font-family:var(--serifen); font-size:12px; letter-spacing:.22em; line-height:1.9; color:var(--ink-dim); }
  .cv-title .btns { left:64px; top:582px; display:flex; flex-direction:column; gap:14px; }
  .cv-title .btn { display:flex; align-items:center; gap:18px; width:362px; height:62px; padding:0 24px; background:var(--btn); border:1px solid var(--btn-line); cursor:pointer; position:relative; box-shadow:0 6px 22px -10px rgba(60,48,30,.45); }
  .cv-title .btn::after { content:""; position:absolute; inset:3px; border:1px solid rgba(43,38,32,.12); pointer-events:none; }
  .cv-title .btn .ic { width:26px; height:26px; flex:none; display:grid; place-items:center; color:var(--ink); }
  .cv-title .btn .tx .zh { font-family:var(--serif); font-size:21px; font-weight:700; letter-spacing:.14em; color:var(--ink); line-height:1.1; }
  .cv-title .btn .tx .en { font-family:var(--serifen); font-size:10px; letter-spacing:.26em; color:var(--soft); margin-top:3px; }
  .cv-title .btn.primary { background:linear-gradient(180deg,#f6efdd,#ece2c6); border-color:rgba(203,176,121,.7); }
  .cv-title .resume { left:96px; top:832px; font-family:var(--serif); font-size:15px; letter-spacing:.16em; color:var(--inkk); opacity:.86; cursor:pointer; }
  .cv-title .resume b { color:var(--goldink); font-weight:400; margin:0 4px; }
  .cv-title .foot-l { left:40px; bottom:30px; display:flex; align-items:center; gap:26px; color:var(--ink-dim); font-family:var(--kai); font-size:13px; letter-spacing:.06em; }
  .cv-title .foot-l a { display:flex; align-items:center; gap:7px; cursor:pointer; color:var(--ink-dim); }
  .cv-title .foot-l a svg { color:var(--goldink); }
  .cv-title .foot-c { left:0; right:0; bottom:30px; text-align:center; font-family:var(--serifen); font-size:12px; letter-spacing:.08em; color:var(--ink-faint); }
  .cv-title .foot-r { right:40px; bottom:30px; display:flex; align-items:center; gap:8px; font-family:var(--kai); font-size:12.5px; color:var(--ink-dim); }
  .cv-title .foot-r svg { color:#a3823f; }
  /* 手机适配:单列堆叠,隐去角落装饰,按钮满宽 */
  @media (max-width: 720px) {
    .cv-title .ripple, .cv-title .astra, .cv-title .lang, .cv-title .foot-l, .cv-title .foot-r { display:none; }
    .cv-title .emblem { left:50%; transform:translateX(-50%); top:90px; width:100px; height:100px; }
    .cv-title .title { left:0; right:0; top:208px; text-align:center; font-size:38px; letter-spacing:.06em; }
    .cv-title .titen { left:0; right:0; top:268px; justify-content:center; }
    .cv-title .titen span { font-size:13px; letter-spacing:.3em; }
    .cv-title .tagline { left:24px; right:24px; top:312px; text-align:center; font-size:15px; }
    .cv-title .taglineen { display:none; }
    .cv-title .btns { left:24px; right:24px; top:auto; bottom:120px; }
    .cv-title .btn { width:100%; height:54px; }
    .cv-title .btn .tx .zh { font-size:17px; }
    .cv-title .resume { left:0; right:0; bottom:78px; top:auto; text-align:center; }
    .cv-title .foot-c { bottom:20px; font-size:10px; }
  }
`}</style>
      <div className="bg"></div>
      <canvas className="pano" ref={panoRef}></canvas>
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
      <h1 className="title"><b>YoRHa-A2</b> 引擎</h1>
      <div className="titen"><i></i><span>YORHA-A2 ENGINE</span></div>
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
      <div className="foot-c">© 2026 Narrative Engine. All Rights Reserved.</div>
      <div className="foot-r">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></svg>
        本游戏包含自动生成内容，请理性体验。
      </div>
    </div>
  );
}
window.ReconTitle = ReconTitle;
