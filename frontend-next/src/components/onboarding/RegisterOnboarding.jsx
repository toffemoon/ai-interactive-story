import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { L, isZh } from "../../lib/i18n";
import { TEXT } from "./registerScene.text";
import "./RegisterOnboarding.css";

// 新手引导 · 柜台两边。首访时盖在首页上的整屏一层:左(手机上为上)是隔着柜台的糖沐,右(下)是你面前的登记簿。
// 3D 场景在 registerScene.js(连 three.js 一起按需加载);这里只放画布外的字和按钮,场景按 data-ob 找到它们。
// 浏览器没有 WebGL 时换成平面的登记纸,一样写名字、盖章、拿书签。
// onDone({ name, to }):to = "explore"(去探索)/ "stay"(留在首页)。
// 直接挂在 <body> 下:页面外壳有带 transform 的容器,放在里面 position: fixed 会被它框住、盖不满整屏。
export default function RegisterOnboarding({ onDone }) {
  const rootRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [phase, setPhase] = useState("loading"); // loading | ready | flat

  useEffect(() => {
    let alive = true;
    let scene = null;
    // dev only: …#/test/onboarding?flat shows the register without WebGL
    if (import.meta.env.DEV && /[?&]flat(&|$)/.test(location.hash)) {
      setPhase("flat");
      return undefined;
    }
    import("./registerScene")
      .then(({ mountRegister }) => mountRegister(rootRef.current, { zh: isZh, onDone: (r) => doneRef.current(r) }))
      .then((s) => {
        if (!alive) return s.destroy();
        scene = s;
        setPhase("ready");
      })
      .catch((err) => {
        if (!alive) return;
        console.error(err);
        setPhase("flat");
      });
    return () => {
      alive = false;
      if (scene) scene.destroy();
    };
  }, []);

  return createPortal(
    <div ref={rootRef} className={"ob3d" + (isZh ? " is-zh" : "")} data-phase={phase}>
      {/* the scene's own elements; the flat register replaces them all */}
      {phase !== "flat" && (
        <>
          <div className="ob3d-gl" data-ob="gl" aria-hidden="true" />
          <div className="ob3d-app">
            <section className="ob3d-view ob3d-her" data-ob="her" aria-label={L("Tangmu", "糖沐")}>
              <div className="ob3d-brand">
                <img src="/brand/seal-192.png" alt="" />
                <span>{L("Muyan", "沐言")}</span>
              </div>
              <button className="ob3d-ghost" data-ob="skip" type="button">
                {L("Skip animation", "跳过动画")}
              </button>
              <div className="ob3d-bubble off" data-ob="bubble" aria-hidden="true">
                <span className="who">{L("Tangmu", "糖沐")}</span>
                <p data-ob="line" />
              </div>
              <p className="ob3d-sr" data-ob="said" aria-live="polite" />
              <p className="ob3d-narr off" data-ob="narr" />
            </section>
            <section className="ob3d-view ob3d-desk" data-ob="desk" aria-label={L("The counter in front of you", "你面前的柜台")}>
              <button className="ob3d-sr" data-ob="open" type="button">
                {L("Open the register", "翻开登记簿")}
              </button>
              <p className="ob3d-chip pulse" data-ob="hint" hidden />
              <label className="ob3d-sr" htmlFor="ob3d-name">
                {L("Your name", "你的名字")}
              </label>
              <input
                id="ob3d-name"
                className="ob3d-name"
                data-ob="name"
                maxLength={isZh ? 10 : 20}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="done"
                hidden
              />
              <button className="ob3d-chip quiet" data-ob="stamp" type="button" hidden>
                {L("Stamp", "盖章")}
              </button>
              <button className="ob3d-sticky" data-ob="suggest" type="button" hidden>
                {L("Let Tangmu pick one", "让糖沐起一个")}
              </button>
              <Marks hidden />
            </section>
          </div>
          <div className="ob3d-grain" data-ob="grain" aria-hidden="true" />
        </>
      )}
      {phase === "loading" && (
        <div className="ob3d-loading" role="status">
          <img src="/brand/seal-192.png" alt="" />
          <span>{L("Opening the door…", "正在开门…")}</span>
        </div>
      )}
      {phase === "flat" && <FlatRegister onDone={(r) => doneRef.current(r)} />}
    </div>,
    document.body
  );
}

// the two bookmarks at the end; the scene shows and wires the first set, the flat register its own
function Marks({ hidden, onPick }) {
  return (
    <div className="ob3d-marks" data-ob={onPick ? undefined : "marks"} hidden={hidden}>
      <button className="ob3d-mark one" data-ob={onPick ? undefined : "explore"} type="button" onClick={onPick && (() => onPick("explore"))}>
        {L("Find a book", "去探索挑本书")}
        <small>{L("Go to Explore", "进「探索」")}</small>
      </button>
      <button className="ob3d-mark two" data-ob={onPick ? undefined : "stay"} type="button" onClick={onPick && (() => onPick("stay"))}>
        {L("Stay a while", "先在店里待会儿")}
        <small>{L("Stay on the home page", "留在首页")}</small>
      </button>
    </div>
  );
}

// Without WebGL: Tangmu's picture, her line, and a flat register card to sign and stamp.
function FlatRegister({ onDone }) {
  const T = isZh ? TEXT.zh : TEXT.en;
  const [name, setName] = useState("");
  const [line, setLine] = useState(T.lines.ask);
  const [stamped, setStamped] = useState(false);
  const today = new Date();
  function stamp(e) {
    e.preventDefault();
    const v = name.trim();
    if (!v) return setLine(T.lines.empty);
    setStamped(true);
    setLine(`${T.lines.done(v)}${isZh ? "" : " "}${T.lines.next}`);
  }
  function suggest() {
    const pool = T.suggestions.filter((s) => s !== name);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setName(pick);
    setLine(T.lines.suggest(pick));
  }
  return (
    <div className="ob3d-flat">
      <img className="ob3d-flat-her" src={stamped ? "/home/tangmu03.webp" : "/home/tangmu02.webp"} alt="" />
      <p className="ob3d-flat-line" aria-live="polite">
        <span className="who">{L("Tangmu", "糖沐")}</span>
        {line}
      </p>
      <form className="ob3d-flat-card" onSubmit={stamp}>
        <h2>{T.title}</h2>
        <p className="ob3d-flat-date">
          {T.cols[0]} {today.getMonth() + 1}/{today.getDate()}
        </p>
        <label htmlFor="ob3d-flat-name">{T.cols[1]}</label>
        <input id="ob3d-flat-name" value={name} maxLength={isZh ? 10 : 20} disabled={stamped} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        {stamped ? (
          <img className="ob3d-flat-seal" src="/brand/seal-192.png" alt={T.cols[2]} />
        ) : (
          <div className="ob3d-flat-row">
            <button type="button" onClick={suggest}>
              {L("Let Tangmu pick one", "让糖沐起一个")}
            </button>
            <button type="submit" className="is-go">
              {L("Stamp", "盖章")}
            </button>
          </div>
        )}
      </form>
      {stamped && <Marks onPick={(to) => onDone({ name: name.trim(), to })} />}
    </div>
  );
}
