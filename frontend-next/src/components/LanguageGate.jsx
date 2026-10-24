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
  if (!ready || chosen || LANGS.includes(acct)) return null;

  const pick = async (lang) => {
    if (busy) return;
    setBusy(true);
    await applyLanguageChoice(lang, signedIn);
  };

  return (
    <div className="lang-gate" role="dialog" aria-modal="true" aria-labelledby="lang-gate-title">
      <div className="lang-gate-card">
        <h1 id="lang-gate-title" className="lang-gate-title">
          <span lang="en">Choose your language</span>
          <span lang="zh">选择语言</span>
        </h1>
        <p className="lang-gate-sub">
          <span lang="en">Stories and AI replies will use this language. You can change it later in Me.</span>
          <span lang="zh">界面和 AI 回复都会使用这个语言,之后可以在「我的」里修改。</span>
        </p>
        <div className="lang-gate-options">
          <button type="button" className="lang-gate-btn" lang="en" disabled={busy} onClick={() => pick("en")}>
            English
          </button>
          <button type="button" className="lang-gate-btn" lang="zh" disabled={busy} onClick={() => pick("zh")}>
            中文
          </button>
        </div>
      </div>
    </div>
  );
}
