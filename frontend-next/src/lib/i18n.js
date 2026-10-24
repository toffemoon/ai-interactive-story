// 中英双语(2026-10-23)。语言是开局常量:读 localStorage,切换 = 写入 + 整页 reload,
// 所以 L() 在模块顶层(nav.js / createTemplates.js / onboardingScript.js 的常量)也能直接用。
// 没选过语言时 LANG 先按 en 渲染,App 里的 LanguageGate 会盖住全屏让用户选。
// 本模块被导入时就把 <html lang> 定好,并且只在中文下加载宋 / 楷的 Google Fonts(英文用系统无衬线,见 tokens.css)。

const LANG_KEY = "ais_lang";
export const LANGS = ["en", "zh"];

function readStored() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return LANGS.includes(v) ? v : null;
  } catch (e) {
    return null;
  }
}

const stored = readStored();
export const LANG = stored || "en";
export const isZh = LANG === "zh";

/** 用户在这台设备上选过语言没有(没选过 → LanguageGate)。 */
export function hasChosenLang() {
  return !!stored;
}

/** 二选一:L("English", "中文")。 */
export function L(en, zh) {
  return isZh ? zh : en;
}

/** 数字 / 日期格式化用的 locale。 */
export const LOCALE = isZh ? "zh-CN" : "en-US";

/** 记下选择;reload=true 时整页刷新让全站换语言。 */
export function setLang(lang, { reload = true } = {}) {
  if (!LANGS.includes(lang)) return;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch (e) {}
  if (reload) location.reload();
}

(function applyDocumentLang() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = isZh ? "zh" : "en";
  if (isZh && !document.getElementById("ais-zh-fonts")) {
    // 宋 = 叙事 / display,楷 = 引文 / 书名(英文站不加载)。
    const pre1 = document.createElement("link");
    pre1.rel = "preconnect";
    pre1.href = "https://fonts.googleapis.com";
    const pre2 = document.createElement("link");
    pre2.rel = "preconnect";
    pre2.href = "https://fonts.gstatic.com";
    pre2.crossOrigin = "";
    const css = document.createElement("link");
    css.id = "ais-zh-fonts";
    css.rel = "stylesheet";
    css.href =
      "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600;700&family=LXGW+WenKai+TC:wght@400&display=swap";
    document.head.append(pre1, pre2, css);
  }
  if (isZh) document.title = "沐言 · 叙事引擎";
})();
