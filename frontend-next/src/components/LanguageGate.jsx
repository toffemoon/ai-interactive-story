import { useEffect, useState } from "react";
import { useAuth } from "../state/auth";
import { LANG, LANGS, ZH_FONTS_HREF, hasChosenLang, setLang } from "../lib/i18n";
import "./LanguageGate.css";

// 开局语言选择(2026-10-23 中英双语)。规则:
// · 这台设备没选过 → 全屏选(游客 / 已登录都一样);选完若已登录同时存进账户,然后整页 reload。
// · 已登录、账户里有语言且与本机不同 → 以账户为准(写本机 + reload)。
// · 已登录、账户没有、本机选过 → 静默把本机的存进账户(用户在这台设备上已经选过)。
// user.language:undefined = 还没查到(登录回包不带,auth.jsx 会补查 /api/auth/me);null = 账户没选过。

async function saveAccountLanguage(lang) {
  try {
    await fetch("/api/my/language", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: lang }),
    });
  } catch (e) {}
}

/** 「我的」页等处切换语言:已登录先存账户,再写本机并 reload。 */
export async function applyLanguageChoice(lang, signedIn) {
  if (!LANGS.includes(lang)) return;
  if (signedIn) await saveAccountLanguage(lang);
  setLang(lang);
}

export default function LanguageGate() {
  const { ready, enabled, user } = useAuth();
  const chosen = hasChosenLang();
  const [busy, setBusy] = useState(false);
  const signedIn = !!(enabled && user);
  const acct = signedIn ? user.language : undefined;

  useEffect(() => {
    if (!ready || !signedIn || acct === undefined) return;
    if (LANGS.includes(acct)) {
      // 账户为准:本机没选过或与账户不同 → 写本机并整页 reload(App 在本机选定语言前不渲染路由)
      if (acct !== LANG || !chosen) setLang(acct);
    } else if (chosen) {
      saveAccountLanguage(LANG);
    }
  }, [ready, signedIn, acct, chosen]);

  // 账户已有语言时不弹(上面的 effect 会直接采用它)。
  const visible = ready && !chosen && !LANGS.includes(acct);

  // 中文那句台词要用中文字体:选语言前 i18n.js 还没加载,这里补上(同一个 link id,不会重复)。
  useEffect(() => {
    if (!visible || document.getElementById("ais-zh-fonts")) return;
    const css = document.createElement("link");
    css.id = "ais-zh-fonts";
    css.rel = "stylesheet";
    css.href = ZH_FONTS_HREF;
    document.head.append(css);
  }, [visible]);

  if (!visible) return null;

  const pick = async (lang) => {
    if (busy) return;
    setBusy(true);
    await applyLanguageChoice(lang, signedIn);
  };

  // 2026-10-25 改版(设计画布「C 幕间 · 选语言」):书店夜景里糖沐用两种语言问一句,右边两个大按钮。
  // 这时还没选语言,所以台词中英各一行。
  return (
    <div className="lang-gate" role="dialog" aria-modal="true" aria-labelledby="lang-gate-title">
      <img className="lang-gate-bg" src="/brand/login-bg.jpg" alt="" />
      <div className="lang-gate-shade" aria-hidden="true" />
      <img className="lang-gate-tangmu" src="/home/tangmu01.webp" alt="" />
      <div className="lang-gate-brand">
        <img src="/brand/seal-192.png" alt="" />
        <span lang="zh">沐言</span>
      </div>
      <h1 id="lang-gate-title" className="lang-gate-sr">
        <span lang="zh">选择语言</span> <span lang="en">Choose your language</span>
      </h1>
      <div className="lang-gate-pick" role="group" aria-label="语言 Language">
        <button type="button" lang="zh" disabled={busy} onClick={() => pick("zh")}>中文</button>
        <button type="button" lang="en" disabled={busy} onClick={() => pick("en")}>English</button>
      </div>
      <section className="lang-gate-say" aria-label="糖沐 Tangmu">
        <span className="lang-gate-plate">
          <span lang="zh">糖沐</span> <span lang="en">Tangmu</span>
        </span>
        <p className="lang-gate-zh" lang="zh">「欢迎来到沐言书坊。开始之前，我们用哪种语言聊？」</p>
        <p className="lang-gate-en" lang="en">"Welcome to Muyan Bookshop. Before we start, which language shall we use?"</p>
        <p className="lang-gate-later">
          <span lang="zh">之后可以在「我的」里修改</span>　<span lang="en">You can change this later in Me</span>
        </p>
      </section>
    </div>
  );
}
