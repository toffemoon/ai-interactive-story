import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "../lib/transitionNav";
import TopNav from "../components/shell/TopNav";
import { StoryCard, CharCard } from "../components/CCard";
import CharDetailModal from "../components/CharDetailModal";
import { getJSON, postJSON, delJSON } from "../lib/api";
import { toCardModels } from "../lib/cardModel";
import {
  LOCAL_PROXY_SETUP_URL,
  cancelLocalProxyLogin,
  getLocalProxyConnection,
  getLocalProxyLoginStatus,
  loadLocalProxySettings,
  saveLocalProxySettings,
  startLocalProxyLogin,
} from "../lib/localProxy";
import { useAuth } from "../state/auth";
import { useGame } from "../state/game";
import { applyLanguageChoice } from "../components/LanguageGate";
import { L, LANG, isZh } from "../lib/i18n";
import "./Mine.css";

// 我的 · 个人中心。继承 ReconProfile;补 收藏 / 我创建的 / 账号设置 / 卡库竖卡分页(YOR-67)/
// 存档跨设备(YOR-22)/ 占位卡过滤(YOR-16)。登录相关端点对 guest 优雅降级。
// 2026-10-25 C 幕间改版(画布「C 幕间 · 我的」):顶栏 TopNav,个人卡 + 胶囊页签 + 一行一项的设置;收藏 / 我创建的用探索同款卡。
const TABS = [
  { key: "profile", label: L("Profile", "资料") },
  { key: "saves", label: L("Saves", "存档") },
  { key: "favorites", label: L("Favorites", "收藏") },
  { key: "created", label: L("Created", "创作") },
];
const PAGE = 8;
const FAV_KEY = "ais_favorites_v1";
const CODEX_PLAN_LABELS = {
  plus: "ChatGPT Plus",
  pro: "ChatGPT Pro",
  prolite: "ChatGPT Pro",
  business: "ChatGPT Business",
  team: "ChatGPT Team",
  enterprise: "ChatGPT Enterprise",
};

// 成就系统已删除(YOR-188,yufei 拍板)。
function avatarChar(name) {
  return (name || "?").trim().charAt(0) || "?";
}

export default function Mine() {
  const navigate = useNavigate();
  const { user, enabled, logout, patchUser } = useAuth();
  const { game } = useGame();
  const [tab, setTab] = useState("profile");
  const [detail, setDetail] = useState(null); // 角色卡「详情」弹层:CardModel | null(YOR-193)
  const [me, setMe] = useState(user); // 本地档案副本(头像/昵称改后即时反映)
  const [nameEdit, setNameEdit] = useState("");
  const [saving, setSaving] = useState(false);
  const [proxySettings, setProxySettings] = useState(loadLocalProxySettings);
  const [proxyStatus, setProxyStatus] = useState("");
  const [codexConnection, setCodexConnection] = useState({ phase: "checking" });
  const [created, setCreated] = useState([]);
  const [createdPage, setCreatedPage] = useState(1);
  const [saves, setSaves] = useState(null); // null=未取 / []=空 / [...]
  const [savesErr, setSavesErr] = useState(false);
  const [favs, setFavs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(FAV_KEY)) || { stories: [], characters: [] };
    } catch (e) {
      return { stories: [], characters: [] };
    }
  });
  const fileRef = useRef(null);
  const codexLoginRun = useRef(0);
  useEffect(() => setMe(user), [user]);

  useEffect(() => {
    if (!(enabled && user && me && me.local_proxy_enabled)) return;
    if (proxySettings.source !== "local_proxy" && !window.location.hash.includes("codex=connected")) return;
    let alive = true;
    setCodexConnection({ phase: "checking" });
    getLocalProxyConnection()
      .then(({ health, account }) => {
        if (!alive) return;
        const connected = !!account.authenticated;
        setCodexConnection({
          phase: connected ? "connected" : "login_required",
          health,
          account,
        });
        if (connected && window.location.hash.includes("codex=connected")) {
          const next = saveLocalProxySettings({ ...loadLocalProxySettings(), source: "local_proxy" });
          setProxySettings(next);
          setProxyStatus(L("Codex connected and enabled", "Codex 已连接并启用"));
        }
      })
      .catch(() => alive && setCodexConnection({ phase: "missing" }));
    return () => {
      alive = false;
      codexLoginRun.current += 1;
    };
  }, [enabled, user, me && me.local_proxy_enabled, proxySettings.source]);

  // 我创建的(卡):本机/账号下非官方角色卡。
  useEffect(() => {
    getJSON("/api/library/characters")
      .then((rows) => setCreated((Array.isArray(rows) ? rows : []).filter((x) => x && !x.official)))
      .catch(() => setCreated([]));
  }, []);

  // 存档跨设备(需登录):占位卡过滤(turns===0 不显)。
  useEffect(() => {
    if (tab !== "saves") return;
    getJSON("/api/my/sessions")
      .then((rows) => {
        const list = (Array.isArray(rows) ? rows : []).filter((s) => (s.turns || 0) > 0);
        setSaves(list);
        setSavesErr(false);
      })
      .catch(() => {
        setSaves([]);
        setSavesErr(true);
      });
  }, [tab]);

  const createdModels = useMemo(() => toCardModels("character", created), [created]);
  const createdPageCount = Math.max(1, Math.ceil(createdModels.length / PAGE));
  const createdShown = createdModels.slice((createdPage - 1) * PAGE, createdPage * PAGE);

  const favModels = useMemo(() => {
    const sm = toCardModels("story", favs.stories || []);
    const cm = toCardModels("character", favs.characters || []);
    return [...sm, ...cm].map((m) => ({ ...m, fav: true })); // 收藏 tab 全点亮书签(YOR-171)
  }, [favs]);

  // 卡片「详情」去向:故事卡 → 详情页(带 preset);角色卡 → 详情弹层。与探索页同一套(YOR-193 修死按钮)。
  const openCard = (m) =>
    m.kind === "story"
      ? navigate(`/story/${encodeURIComponent(m.id)}`, { state: { preset: m.raw } })
      : setDetail(m);

  // 删除「我创建的」角色卡:二次确认(镜像 YOR-175/184 破坏性操作范式)→ DELETE 卡库 → 本地移除 + 关弹层。
  async function deleteCard(m) {
    const nm = (m.raw && m.raw.name) || m.id;
    if (!nm) return;
    if (!window.confirm(L(`Delete "${m.title}"? This can't be undone.`, `确定删除「${m.title}」?删除后无法恢复。`))) return;
    try {
      await delJSON(`/api/library/characters/${encodeURIComponent(nm)}`);
      setCreated((rows) => rows.filter((r) => r.name !== nm));
      setDetail(null);
    } catch (e) {
      alert(L("Failed to delete: ", "删除失败:") + (e.message || L("please try again later", "请稍后再试")));
    }
  }

  async function uploadAvatar(ev) {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    if (!(enabled && user)) {
      navigate("/login");
      return;
    }
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = async () => {
      try {
        const S = 256, c = document.createElement("canvas");
        c.width = S;
        c.height = S;
        const x = c.getContext("2d");
        const m = Math.min(img.width, img.height);
        x.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
        const dataUrl = c.toDataURL("image/jpeg", 0.85);
        const r = await postJSON("/api/my/avatar", { avatar: dataUrl });
        const nextAvatar = r.avatar || dataUrl;
        setMe((u) => ({ ...(u || {}), avatar: nextAvatar }));
        patchUser({ avatar: nextAvatar }); // 回写 context,切走再回不被旧 user 盖回(YOR-186)
      } catch (e) {
        /* ignore */
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.src = url;
  }

  async function saveName() {
    const nm = nameEdit.trim();
    if (!nm || saving) return;
    setSaving(true);
    try {
      const r = await postJSON("/api/my/display_name", { display_name: nm });
      const nextName = r.display_name || nm;
      setMe((u) => ({ ...(u || {}), display_name: nextName }));
      patchUser({ display_name: nextName }); // 回写 context,切走再回不被旧 user 盖回(YOR-186)
      setNameEdit("");
    } catch (e) {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  function selectModelSource(source) {
    const next = saveLocalProxySettings({ ...proxySettings, source });
    setProxySettings(next);
    setProxyStatus(source === "local_proxy" ? L("Local Codex proxy selected", "已选择 Codex 本机反代") : L("DeepSeek selected", "已选择 DeepSeek"));
  }

  function saveProxySettings() {
    const next = saveLocalProxySettings(proxySettings);
    setProxySettings(next);
    setProxyStatus(L("Local proxy settings saved", "本机反代设置已保存"));
  }

  async function refreshCodexConnection() {
    setCodexConnection({ phase: "checking" });
    try {
      const { health, account } = await getLocalProxyConnection();
      setCodexConnection({
        phase: account.authenticated ? "connected" : "login_required",
        health,
        account,
      });
      return { health, account };
    } catch (error) {
      setCodexConnection({ phase: "missing", error: error.message });
      return null;
    }
  }

  function downloadCodexConnector() {
    const link = document.createElement("a");
    link.href = LOCAL_PROXY_SETUP_URL;
    link.download = "AIStory-Codex-Setup.cmd";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setCodexConnection({ phase: "installing" });
    setProxyStatus(L("Connector downloaded. Run it to finish setup and sign-in automatically.", "连接助手已下载，运行后会自动完成安装和登录"));
  }

  function wakeCodexConnector() {
    window.location.href = "aistory-codex://connect";
    setProxyStatus(L("Launching the installed connector…", "正在启动已安装的连接助手"));
    setTimeout(refreshCodexConnection, 3000);
  }

  async function beginCodexLogin(flow = "browser") {
    const runId = ++codexLoginRun.current;
    const authWindow = flow === "browser" ? window.open("about:blank", "aistory-codex-oauth") : null;
    setCodexConnection((current) => ({ ...current, phase: "login_pending", flow }));
    try {
      const login = await startLocalProxyLogin(flow);
      if (login.status === "authenticated" || (login.account && login.account.authenticated)) {
        if (authWindow) authWindow.close();
        const next = saveLocalProxySettings({ ...proxySettings, source: "local_proxy" });
        setProxySettings(next);
        await refreshCodexConnection();
        setProxyStatus(L("Codex connected and enabled", "Codex 已连接并启用"));
        return;
      }
      if (flow === "browser" && login.auth_url) {
        if (authWindow) authWindow.location.replace(login.auth_url);
        else setCodexConnection((current) => ({ ...current, oauthUrl: login.auth_url }));
      }
      if (flow === "device" && login.verification_url) {
        try { await navigator.clipboard.writeText(login.user_code || ""); } catch (e) {}
        window.open(login.verification_url, "_blank", "noopener");
      }
      setCodexConnection((current) => ({
        ...current,
        phase: "login_pending",
        loginId: login.login_id,
        verificationUrl: login.verification_url,
        userCode: login.user_code,
      }));
      for (let attempt = 0; attempt < 200 && codexLoginRun.current === runId; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const status = await getLocalProxyLoginStatus(login.login_id);
        if (status.account && status.account.authenticated) {
          if (authWindow && !authWindow.closed) authWindow.close();
          const next = saveLocalProxySettings({ ...proxySettings, source: "local_proxy" });
          setProxySettings(next);
          setCodexConnection({ phase: "connected", account: status.account });
          setProxyStatus(L("Codex connected and enabled", "Codex 已连接并启用"));
          return;
        }
        if (status.status === "failed" || status.status === "cancelled") {
          throw new Error(status.error || L("Codex sign-in didn't complete", "Codex 登录没有完成"));
        }
      }
      if (codexLoginRun.current === runId) {
        await cancelLocalProxyLogin(login.login_id).catch(() => {});
        throw new Error(L("Sign-in timed out. Retry or use a device code.", "登录等待超时，请重试或使用设备码"));
      }
    } catch (error) {
      if (authWindow && !authWindow.closed) authWindow.close();
      if (codexLoginRun.current === runId) {
        setCodexConnection((current) => ({ ...current, phase: "login_required", error: error.message }));
        setProxyStatus(error.message || L("Codex sign-in failed", "Codex 登录失败"));
      }
    }
  }

  const displayName = (me && (me.display_name || me.username)) || L("Guest", "游客");
  const loggedIn = !!(enabled && user);
  const codexPhase = codexConnection.phase;
  const codexLabel = {
    checking: L("Checking local connection…", "正在检测本机连接"),
    missing: L("Not connected", "尚未连接"),
    installing: L("Waiting for the connector to start", "等待连接助手启动"),
    login_required: L("Waiting for ChatGPT sign-in", "等待 ChatGPT 登录"),
    login_pending: L("Connecting to ChatGPT…", "正在连接 ChatGPT"),
    connected: L("Codex connected", "Codex 已连接"),
  }[codexPhase] || L("Codex connection error", "Codex 连接异常");
  const codexDetail = codexPhase === "connected"
    ? [
        CODEX_PLAN_LABELS[codexConnection.account && codexConnection.account.plan_type] || null,
        codexConnection.health && codexConnection.health.model,
      ]
        .filter(Boolean).join(" · ") || L("Ready to play", "可以开始游玩")
    : codexConnection.error || "";

  const avatar = me && me.avatar;
  const favStories = favModels.filter((m) => m.kind === "story");
  const favChars = favModels.filter((m) => m.kind === "character");
  const cardGrid = (models, kind) => (
    <div className={"mine-grid mine-grid--" + kind}>
      {models.map((m) =>
        kind === "story" ? <StoryCard key={m.kind + ":" + m.id} model={m} onOpen={openCard} /> : <CharCard key={m.kind + ":" + m.id} model={m} onOpen={openCard} />
      )}
    </div>
  );

  return (
    <div className="page mine">
      <TopNav variant="bar" />
      <main className="mine-main">
        {/* 个人卡:书店夜景压暗 + 头像 + 名字 + 状态 */}
        <section className="mine-hero" aria-labelledby="mine-name">
          <img className="mine-hero-bg" src="/home/background.png" alt="" />
          <div className="mine-hero-shade" aria-hidden="true" />
          <div className="mine-hero-body">
            <button
              type="button"
              className="mine-avatar"
              style={avatar ? { backgroundImage: `url("${avatar}")` } : undefined}
              onClick={() => (loggedIn ? fileRef.current && fileRef.current.click() : navigate("/login"))}
              aria-label={loggedIn ? L("Change avatar", "更换头像") : L("Sign in to change your avatar", "登录后可换头像")}
              title={loggedIn ? L("Change avatar", "更换头像") : L("Sign in to change your avatar", "登录后可换头像")}
            >
              {!avatar && <span aria-hidden="true">{avatarChar(displayName)}</span>}
              {loggedIn && (
                <span className="mine-avatar-edit" aria-hidden="true">
                  {L("Change", "换")}
                </span>
              )}
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={uploadAvatar} />
            <div className="mine-hero-tx">
              <h1 id="mine-name">{displayName}</h1>
              <p>{loggedIn ? L("Signed in · ", "已登录 · ") + (me.role || "user") : L("Not signed in. You're in guest mode.", "还没登录,现在是游客模式")}</p>
            </div>
          </div>
        </section>

        <div className="mine-tabs" role="tablist" aria-label={L("Me", "我的")}>
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={"mine-tab-" + t.key}
              aria-selected={tab === t.key}
              aria-controls="mine-panel"
              className={tab === t.key ? "is-on" : ""}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div id="mine-panel" role="tabpanel" aria-labelledby={"mine-tab-" + tab} className="mine-panel">
          {/* 资料:账号 / 语言 / 模型来源,一行一项、行间细线 */}
          {tab === "profile" && (
            <div className="mine-rows">
              <section className="mine-row" aria-labelledby="mine-acct-h">
                <div className="mine-row-tx">
                  <h2 id="mine-acct-h">{L("Account", "账号")}</h2>
                  <p>
                    {loggedIn
                      ? L("Change your nickname, or sign out on this device.", "改个昵称,或在这台设备上退出登录。")
                      : L("Sign in to set an avatar and nickname, and sync your saves across devices.", "登录后可以设置头像和昵称,存档也能在不同设备间同步。")}
                  </p>
                </div>
                {loggedIn ? (
                  <div className="mine-row-ctl mine-acct">
                    <form
                      className="mine-name-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveName();
                      }}
                    >
                      <label className="mine-field">
                        <span className="sr-only">{L("New nickname", "新昵称")}</span>
                        <input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} placeholder={L("New nickname (1–24 characters)", "改个昵称(1-24 字)")} />
                      </label>
                      <button type="submit" className="mine-btn mine-btn--soft" disabled={saving || !nameEdit.trim()}>
                        {saving ? L("Saving…", "保存中…") : L("Save nickname", "保存昵称")}
                      </button>
                    </form>
                    <button type="button" className="mine-btn mine-btn--soft" onClick={() => logout().then(() => navigate("/login"))}>
                      {L("Sign out", "退出登录")}
                    </button>
                  </div>
                ) : (
                  <button type="button" className="mine-btn mine-btn--go" onClick={() => navigate("/login")}>
                    {L("Sign in", "登录")}
                  </button>
                )}
              </section>

              {/* 语言切换(2026-10-23 中英双语):游客也可见;已登录同时存进账户,随后整页 reload */}
              <section className="mine-row" aria-labelledby="mine-lang-h">
                <div className="mine-row-tx">
                  <h2 id="mine-lang-h">{L("Language", "语言")}</h2>
                  <p>{L("Stories and AI replies use this language.", "故事和 AI 回复都会用这个语言。")}</p>
                </div>
                <div className="mine-seg" role="group" aria-labelledby="mine-lang-h">
                  <button type="button" lang="zh" aria-pressed={LANG === "zh"} className={LANG === "zh" ? "is-on" : ""} onClick={() => LANG !== "zh" && applyLanguageChoice("zh", loggedIn)}>
                    中文
                  </button>
                  <button type="button" lang="en" aria-pressed={LANG === "en"} className={LANG === "en" ? "is-on" : ""} onClick={() => LANG !== "en" && applyLanguageChoice("en", loggedIn)}>
                    English
                  </button>
                </div>
              </section>

              {loggedIn && me && me.local_proxy_enabled && (
                <section className="mine-row mine-row--block" aria-labelledby="mine-model-h">
                  <div className="mine-row-head">
                    <div className="mine-row-tx">
                      <h2 id="mine-model-h">{L("Model source", "模型来源")}</h2>
                      <p>{L("Which model writes your story turns.", "由哪个模型来写故事回合。")}</p>
                    </div>
                    <div className="mine-seg" role="group" aria-labelledby="mine-model-h">
                      <button type="button" aria-pressed={proxySettings.source === "deepseek"} className={proxySettings.source === "deepseek" ? "is-on" : ""} onClick={() => selectModelSource("deepseek")}>
                        DeepSeek
                      </button>
                      <button type="button" aria-pressed={proxySettings.source === "local_proxy"} className={proxySettings.source === "local_proxy" ? "is-on" : ""} onClick={() => selectModelSource("local_proxy")}>
                        {L("Local Codex", "Codex 本机")}
                      </button>
                    </div>
                  </div>
                  {proxySettings.source === "local_proxy" && (
                    <div className="mine-codex">
                      <div className={`mine-codex-state is-${codexPhase}`}>
                        <span className="mine-codex-dot" aria-hidden="true" />
                        <span className="mine-codex-state-copy">
                          <strong>{codexLabel}</strong>
                          {codexDetail && <span>{codexDetail}</span>}
                        </span>
                      </div>
                      <div className="mine-codex-actions">
                        {(codexPhase === "missing" || codexPhase === "installing") && (
                          <button type="button" className="mine-btn mine-btn--go" onClick={downloadCodexConnector}>
                            {codexPhase === "installing" ? L("Re-download installer", "重新下载安装器") : L("Install & connect", "一键安装并连接")}
                          </button>
                        )}
                        {codexPhase === "missing" && (
                          <button type="button" className="mine-btn mine-btn--soft" onClick={wakeCodexConnector}>
                            {L("Launch installed connector", "启动已安装助手")}
                          </button>
                        )}
                        {codexPhase === "login_required" && (
                          <button type="button" className="mine-btn mine-btn--go" onClick={() => beginCodexLogin("browser")}>
                            {L("Connect ChatGPT", "连接 ChatGPT")}
                          </button>
                        )}
                        <button type="button" className="mine-btn mine-btn--soft" disabled={codexPhase === "checking" || codexPhase === "login_pending"} onClick={refreshCodexConnection}>
                          {L("Re-check", "重新检测")}
                        </button>
                      </div>
                      {codexConnection.oauthUrl && (
                        <a className="mine-codex-link" href={codexConnection.oauthUrl} target="_blank" rel="noreferrer">
                          {L("Open ChatGPT sign-in page", "打开 ChatGPT 登录页")}
                        </a>
                      )}
                      {codexPhase === "login_required" && codexConnection.health && (
                        <button type="button" className="mine-codex-device" onClick={() => beginCodexLogin("device")}>
                          {L("Use a device code instead", "改用设备码登录")}
                        </button>
                      )}
                      {codexConnection.userCode && (
                        <div className="mine-codex-code">
                          <span>{L("Device code", "设备码")}</span>
                          <strong>{codexConnection.userCode}</strong>
                        </div>
                      )}
                      <details className="mine-advanced">
                        <summary>{L("Advanced settings", "高级设置")}</summary>
                        <div className="mine-advanced-fields">
                          <label className="mine-field mine-field--labeled">
                            <span>API Base URL</span>
                            <input
                              value={proxySettings.endpoint}
                              onChange={(e) => setProxySettings((s) => ({ ...s, endpoint: e.target.value }))}
                              placeholder={L("http://127.0.0.1:PORT/v1", "http://127.0.0.1:端口/v1")}
                              spellCheck={false}
                            />
                          </label>
                          <label className="mine-field mine-field--labeled">
                            <span>Model</span>
                            <input value={proxySettings.model} onChange={(e) => setProxySettings((s) => ({ ...s, model: e.target.value }))} placeholder="codex" spellCheck={false} />
                          </label>
                          <label className="mine-field mine-field--labeled">
                            <span>{L("API Key (optional)", "API Key(可选)")}</span>
                            <input
                              type="password"
                              value={proxySettings.apiKey}
                              onChange={(e) => setProxySettings((s) => ({ ...s, apiKey: e.target.value }))}
                              placeholder={L("Kept for this browser session only", "仅保留到本次浏览器会话")}
                              autoComplete="off"
                            />
                          </label>
                          <button type="button" className="mine-btn mine-btn--soft" onClick={saveProxySettings}>
                            {L("Save advanced settings", "保存高级设置")}
                          </button>
                        </div>
                      </details>
                    </div>
                  )}
                  {proxyStatus && (
                    <p className="mine-status" role="status">
                      {proxyStatus}
                    </p>
                  )}
                </section>
              )}
            </div>
          )}

          {/* 存档(跨设备 · 占位过滤) */}
          {tab === "saves" && (
            <div className="mine-rows">
              {game && (
                <button type="button" className="mine-save mine-save--cur" onClick={() => navigate("/play")}>
                  <span className="mine-save-dot" aria-hidden="true" />
                  <span className="mine-save-tx">
                    <span className="mine-save-name">{game.title || L("Current story", "当前故事")}</span>
                    <span className="mine-save-meta">{L("In progress on this device", "本机进行中")}</span>
                  </span>
                  <span className="mine-save-go">{L("Continue →", "继续 →")}</span>
                </button>
              )}
              {!loggedIn ? (
                <p className="mine-note">{L("Sign in to see saves synced across devices. For now, only the story in progress on this device is shown.", "登录后可看跨设备同步的存档列表。当前仅显示本机进行中的故事。")}</p>
              ) : saves === null ? (
                <p className="mine-note" role="status">
                  {L("Loading saves…", "读取存档中…")}
                </p>
              ) : savesErr ? (
                <p className="mine-note">{L("Failed to load saves, possibly a network hiccup. The story in progress on this device is not affected.", "存档加载失败,可能是网络抖动。本机进行中的故事不受影响。")}</p>
              ) : saves.length ? (
                saves.map((s) => (
                  <div className="mine-save" key={s.id}>
                    <span className="mine-save-tx">
                      <span className="mine-save-name">{s.story || s.player || L("Untitled save", "未命名存档")}</span>
                      <span className="mine-save-meta">
                        {isZh ? <>第 {s.turns} 回合</> : <>Turn {s.turns}</>}
                        {s.updated_at ? " · " + String(s.updated_at).slice(0, 16) : ""}
                      </span>
                    </span>
                  </div>
                ))
              ) : (
                <p className="mine-note">{L("No stories in progress yet. Pick a book in Explore to start.", "还没有进行中的故事。去探索取一本书开局。")}</p>
              )}
            </div>
          )}

          {/* 收藏:故事一组、角色一组 */}
          {tab === "favorites" &&
            (favModels.length ? (
              <div className="mine-sets">
                {favStories.length > 0 && (
                  <section className="mine-set" aria-labelledby="mine-fav-stories">
                    <h2 id="mine-fav-stories">
                      {L("Stories", "故事")} <span>{favStories.length}</span>
                    </h2>
                    {cardGrid(favStories, "story")}
                  </section>
                )}
                {favChars.length > 0 && (
                  <section className="mine-set" aria-labelledby="mine-fav-chars">
                    <h2 id="mine-fav-chars">
                      {L("Characters", "角色")} <span>{favChars.length}</span>
                    </h2>
                    {cardGrid(favChars, "character")}
                  </section>
                )}
              </div>
            ) : (
              <p className="mine-note">{L("No favorites yet. Tap the star in Explore or Save on a story page, and those stories and characters will show up here.", "还没有收藏。在探索点星标、在故事详情点收藏,故事和角色会出现在这里。")}</p>
            ))}

          {/* 创作:我创建的角色卡(分页) */}
          {tab === "created" &&
            (createdModels.length ? (
              <div className="mine-sets">
                <section className="mine-set" aria-labelledby="mine-created-h">
                  <h2 id="mine-created-h">
                    {L("Cards I created", "我创建的卡")} <span>{createdModels.length}</span>
                  </h2>
                  {cardGrid(createdShown, "character")}
                </section>
                {createdPageCount > 1 && (
                  <div className="mine-pager">
                    <button type="button" className="mine-btn mine-btn--soft" disabled={createdPage <= 1} onClick={() => setCreatedPage((p) => Math.max(1, p - 1))}>
                      {L("Previous", "上一页")}
                    </button>
                    <span className="mine-pager-info">
                      {createdPage} / {createdPageCount}
                    </span>
                    <button type="button" className="mine-btn mine-btn--soft" disabled={createdPage >= createdPageCount} onClick={() => setCreatedPage((p) => Math.min(createdPageCount, p + 1))}>
                      {L("Next", "下一页")}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="mine-empty">
                <p className="mine-note">{L("Your Card Library is empty. Build a Character Card in Create and it will show up here.", "卡库还空着。去创作造一张角色卡,这里就有了。")}</p>
                <button type="button" className="mine-btn mine-btn--go" onClick={() => navigate("/create")}>
                  {L("Go to Create", "去创作")}
                </button>
              </div>
            ))}
        </div>
      </main>

      {detail && (
        <CharDetailModal
          model={detail}
          onClose={() => setDetail(null)}
          onDelete={tab === "created" ? deleteCard : undefined}
          onAdapt={
            // D4:「我创建的」→ 去改编:整卡经 sessionStorage 带去创作页 fork 成草稿(复刻探索→纯聊的 raw 跳转范式)
            tab === "created"
              ? (m) => {
                  try {
                    sessionStorage.setItem("ais_create_adapt", JSON.stringify({ kind: "characters", card: m.raw }));
                  } catch (e) {}
                  setDetail(null);
                  navigate("/create");
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
