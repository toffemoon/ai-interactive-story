// mu-settle.js — 入场动画沉降器
// 周期性把「有限次」CSS 动画 finish + commitStyles + 摘除,使末态固化为行内样式:
// ① 冻结时间轴的环境(隐藏 iframe / 截图器)3 秒后也能看到完整内容;
// ② DOM 克隆类导出(PNG/打印)不会把内容捕在 from 帧(opacity:0)。
// 无限循环动画(走线/印环/场景漂移/光标)豁免,保持常动。
(function () {
  requestAnimationFrame(function () { document.body.classList.add("mu-anim"); });
  function settle() {
    var anims;
    try { anims = document.getAnimations(); } catch (e) { return; }
    anims.forEach(function (a) {
      try {
        var timing = a.effect.getTiming();
        if (timing.iterations === Infinity) return;          // 循环动效豁免
        if (a.pending || a.playState !== "finished") a.finish();
        var el = a.effect.target;
        if (!el || a.effect.pseudoElement) return;            // 伪元素无法固化,跳过
        a.commitStyles();                                     // 末态写入行内
        var hasLoop = el.getAnimations().some(function (x) {
          try { return x.effect.getTiming().iterations === Infinity; } catch (e) { return false; }
        });
        if (!hasLoop) el.style.animation = "none";            // 摘除,克隆安全
      } catch (e) { /* 单个失败不影响其余 */ }
    });
  }
  setTimeout(settle, 2600);
  setInterval(settle, 3200);
})();
