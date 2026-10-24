import { useEffect, useState } from "react";
import { useAuth } from "../state/auth";
import { LANG, LANGS, hasChosenLang, setLang } from "../lib/i18n";
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

  // 中文半屏要预览中文站的宋 / 楷:选语言前 i18n.js 还没加载中文字体,这里补上(同一个 link id,不会重复)。
  useEffect(() => {
    if (!visible || document.getElementById("ais-zh-fonts")) return;
    const css = document.createElement("link");
    css.id = "ais-zh-fonts";
    css.rel = "stylesheet";
    css.href = "https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600;700&family=LXGW+WenKai+TC:wght@400&display=swap";
    document.head.append(css);
  }, [visible]);

  if (!visible) return null;

  const pick = async (lang) => {
    if (busy) return;
    setBusy(true);
    await applyLanguageChoice(lang, signedIn);
  };

  // 2026-10-24 改版(画布方案 01-B):左右分屏,每半屏就是该语言界面的样子(英文系统无衬线,中文宋 / 楷)。
  return (
    <div className="lang-gate" role="dialog" aria-modal="true" aria-label="Choose your language / 选择语言">
      <img className="lang-gate-seal" src="/brand/seal-192.png" alt="" />
      <section className="lang-gate-half lang-gate-en" lang="en">
        <span className="lang-gate-eyebrow">Narrative Engine</span>
        <h2 className="lang-gate-name">English</h2>
        <p className="lang-gate-desc">Stories, characters and AI replies — all in English.</p>
        <p className="lang-gate-sample" aria-hidden="true">Explore · Chat · Create · Me</p>
        <button type="button" className="lang-gate-go" disabled={busy} onClick={() => pick("en")}>
          Continue in English <span aria-hidden="true">→</span>
        </button>
      </section>
      <section className="lang-gate-half lang-gate-zh" lang="zh">
        <span className="lang-gate-eyebrow">沐言 · 叙事引擎</span>
        <h2 className="lang-gate-name">中文</h2>
        <p className="lang-gate-desc">故事、角色与 AI 回复,都使用中文。</p>
        <p className="lang-gate-sample" aria-hidden="true">探索 · 纯聊 · 创作 · 我的</p>
        <button type="button" className="lang-gate-go" disabled={busy} onClick={() => pick("zh")}>
          使用中文继续 <span aria-hidden="true">→</span>
        </button>
      </section>
    </div>
  );
}
