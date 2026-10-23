import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "../lib/transitionNav";
import { Button, Input, CardShelf } from "../components/ui";
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
import "./Mine.css";

// 我的 · 个人中心。继承 ReconProfile;补 收藏 / 我创建的 / 账号设置 / 卡库竖卡分页(YOR-67)/
// 存档跨设备(YOR-22)/ 占位卡过滤(YOR-16)。登录相关端点对 guest 优雅降级。
const TABS = [
  { key: "profile", label: "Profile" },
  { key: "saves", label: "Saves" },
  { key: "favorites", label: "Favorites" },
  { key: "created", label: "Created" },
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
  // 子分区红线指示条:测量当前 tab 的位置/宽度,用 transform 平移过去(不再硬切 border-color)。
  const tabRefs = useRef([]);
  const [bar, setBar] = useState({ x: 0, y: 0, w: 0 });
  const measureBar = useCallback(() => {
    const i = TABS.findIndex((t) => t.key === tab);
    const el = tabRefs.current[i];
    if (!el) return;
    setBar({ x: el.offsetLeft, y: el.offsetTop + el.offsetHeight - 2, w: el.offsetWidth });
  }, [tab]);
  useLayoutEffect(() => {
    measureBar();
  }, [measureBar]);
  // 首帧 offsetWidth 常为 0(楷书字体未加载完 / 布局未定)→ rAF + 字体就绪后各重测一次,
  // 否则红线初载宽度=0、要切 tab 才出现。
  useEffect(() => {
    let alive = true;
    const remeasure = () => alive && measureBar();
    const raf = requestAnimationFrame(remeasure);
    if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
      document.fonts.ready.then(remeasure);
    }
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [measureBar]);
  useEffect(() => {
    window.addEventListener("resize", measureBar);
    return () => window.removeEventListener("resize", measureBar);
  }, [measureBar]);

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
          setProxyStatus("Codex connected and enabled");
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
  // 「我创建的」里已收藏的也点亮(同一份 ais_favorites_v1,按归一化 id 判)
  const favIdSet = useMemo(() => new Set(favModels.map((m) => m.kind + ":" + m.id)), [favModels]);

  // 卡片「详情」去向:故事卡 → 详情页(带 preset);角色卡 → 详情弹层。与探索页同一套(YOR-193 修死按钮)。
  const openCard = (m) =>
    m.kind === "story"
      ? navigate(`/story/${encodeURIComponent(m.id)}`, { state: { preset: m.raw } })
      : setDetail(m);

  // 删除「我创建的」角色卡:二次确认(镜像 YOR-175/184 破坏性操作范式)→ DELETE 卡库 → 本地移除 + 关弹层。
  async function deleteCard(m) {
    const nm = (m.raw && m.raw.name) || m.id;
    if (!nm) return;
    if (!window.confirm(`Delete "${m.title}"? This can't be undone.`)) return;
    try {
      await delJSON(`/api/library/characters/${encodeURIComponent(nm)}`);
      setCreated((rows) => rows.filter((r) => r.name !== nm));
      setDetail(null);
    } catch (e) {
      alert("Failed to delete: " + (e.message || "please try again later"));
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
    setProxyStatus(source === "local_proxy" ? "Local Codex proxy selected" : "DeepSeek selected");
  }

  function saveProxySettings() {
    const next = saveLocalProxySettings(proxySettings);
    setProxySettings(next);
    setProxyStatus("Local proxy settings saved");
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
    setProxyStatus("Connector downloaded. Run it to finish setup and sign-in automatically.");
  }

  function wakeCodexConnector() {
    window.location.href = "aistory-codex://connect";
    setProxyStatus("Launching the installed connector…");
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
        setProxyStatus("Codex connected and enabled");
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
          setProxyStatus("Codex connected and enabled");
          return;
        }
        if (status.status === "failed" || status.status === "cancelled") {
          throw new Error(status.error || "Codex sign-in didn't complete");
        }
      }
      if (codexLoginRun.current === runId) {
        await cancelLocalProxyLogin(login.login_id).catch(() => {});
        throw new Error("Sign-in timed out. Retry or use a device code.");
      }
    } catch (error) {
      if (authWindow && !authWindow.closed) authWindow.close();
      if (codexLoginRun.current === runId) {
        setCodexConnection((current) => ({ ...current, phase: "login_required", error: error.message }));
        setProxyStatus(error.message || "Codex sign-in failed");
      }
    }
  }

  const displayName = (me && (me.display_name || me.username)) || "Guest";
  const loggedIn = !!(enabled && user);
  const codexPhase = codexConnection.phase;
  const codexLabel = {
    checking: "Checking local connection…",
    missing: "Not connected",
    installing: "Waiting for the connector to start",
    login_required: "Waiting for ChatGPT sign-in",
    login_pending: "Connecting to ChatGPT…",
    connected: "Codex connected",
  }[codexPhase] || "Codex connection error";
  const codexDetail = codexPhase === "connected"
    ? [
        CODEX_PLAN_LABELS[codexConnection.account && codexConnection.account.plan_type] || null,
        codexConnection.health && codexConnection.health.model,
      ]
        .filter(Boolean).join(" · ") || "Ready to play"
    : codexConnection.error || "";

  return (
    <div className="page mine">
      <div className="mine-head">
        <h1 className="t-display">Me</h1>
      </div>

      <div className="mine-tabs">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => (tabRefs.current[i] = el)}
            className={"mine-tab" + (tab === t.key ? " is-on" : "")}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        <span
          className="mine-tab-underline"
          style={{ transform: `translate(${bar.x}px, ${bar.y}px)`, width: bar.w + "px" }}
          aria-hidden="true"
        />
      </div>

      {/* 档案 + 账号设置 */}
      {tab === "profile" && (
        <section className="mine-section">
          <div className="mine-profile">
            <button
              className="mine-avatar"
              style={me && me.avatar ? { backgroundImage: `url("${me.avatar}")` } : undefined}
              onClick={() => (loggedIn ? fileRef.current && fileRef.current.click() : navigate("/login"))}
              title={loggedIn ? "Change avatar" : "Sign in to change your avatar"}
            >
              {!(me && me.avatar) && avatarChar(displayName)}
              <span className="mine-avatar-edit t-meta">Edit</span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={uploadAvatar} />
            <div className="mine-profile-main">
              <div className="mine-name t-h1">{displayName}</div>
              <div className="mine-role t-meta">{loggedIn ? "Account · " + (me.role || "user") : "Not signed in · Guest mode"}</div>
            </div>
          </div>

          <div className="mine-account">
            <h2 className="t-h3 mine-sec-title">Account settings</h2>
            {loggedIn ? (
              <>
                <div className="mine-account-row">
                  <Input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} placeholder="New nickname (1–24 characters)" />
                  <Button variant="line" disabled={saving || !nameEdit.trim()} onClick={saveName}>
                    {saving ? "Saving…" : "Save nickname"}
                  </Button>
                </div>
                <Button variant="line" onClick={() => logout().then(() => navigate("/login"))}>
                  Sign out
                </Button>
              </>
            ) : (
              <div className="mine-guest">
                <p className="t-ui mine-sub">Sign in to set an avatar and nickname, and sync your saves across devices.</p>
                <Button variant="primary" onClick={() => navigate("/login")}>
                  Sign in
                </Button>
              </div>
            )}
          </div>

          {loggedIn && me && me.local_proxy_enabled && (
            <div className="mine-model">
              <h2 className="t-h3 mine-sec-title">Model source</h2>
              <div className="mine-model-segment" aria-label="Model source">
                <button
                  className={proxySettings.source === "deepseek" ? "is-on" : ""}
                  onClick={() => selectModelSource("deepseek")}
                >
                  DeepSeek
                </button>
                <button
                  className={proxySettings.source === "local_proxy" ? "is-on" : ""}
                  onClick={() => selectModelSource("local_proxy")}
                >
                  Local Codex
                </button>
              </div>
              {proxySettings.source === "local_proxy" && (
                <div className="mine-codex-connect">
                  <div className={`mine-codex-state is-${codexPhase}`}>
                    <span className="mine-codex-dot" aria-hidden="true" />
                    <span className="mine-codex-state-copy">
                      <strong className="t-ui-sm">{codexLabel}</strong>
                      {codexDetail && <span className="t-meta">{codexDetail}</span>}
                    </span>
                  </div>

                  <div className="mine-codex-actions">
                    {(codexPhase === "missing" || codexPhase === "installing") && (
                      <Button variant="primary" onClick={downloadCodexConnector}>
                        {codexPhase === "installing" ? "Re-download installer" : "Install & connect"}
                      </Button>
                    )}
                    {codexPhase === "missing" && (
                      <Button variant="line" onClick={wakeCodexConnector}>Launch installed connector</Button>
                    )}
                    {codexPhase === "login_required" && (
                      <Button variant="primary" onClick={() => beginCodexLogin("browser")}>Connect ChatGPT</Button>
                    )}
                    <Button
                      variant="line"
                      disabled={codexPhase === "checking" || codexPhase === "login_pending"}
                      onClick={refreshCodexConnection}
                    >
                      Re-check
                    </Button>
                  </div>

                  {codexConnection.oauthUrl && (
                    <a className="mine-codex-link t-ui-sm" href={codexConnection.oauthUrl} target="_blank" rel="noreferrer">
                      Open ChatGPT sign-in page
                    </a>
                  )}
                  {codexPhase === "login_required" && codexConnection.health && (
                    <button className="mine-codex-device t-meta" onClick={() => beginCodexLogin("device")}>
                      Use a device code instead
                    </button>
                  )}
                  {codexConnection.userCode && (
                    <div className="mine-codex-code">
                      <span className="t-meta">Device code</span>
                      <strong className="t-mono">{codexConnection.userCode}</strong>
                    </div>
                  )}

                  <details className="mine-model-advanced">
                    <summary className="t-meta">Advanced settings</summary>
                    <div className="mine-model-fields">
                      <label>
                        <span className="t-meta">API Base URL</span>
                        <Input
                          value={proxySettings.endpoint}
                          onChange={(e) => setProxySettings((s) => ({ ...s, endpoint: e.target.value }))}
                          placeholder="http://127.0.0.1:PORT/v1"
                          spellCheck={false}
                        />
                      </label>
                      <label>
                        <span className="t-meta">Model</span>
                        <Input
                          value={proxySettings.model}
                          onChange={(e) => setProxySettings((s) => ({ ...s, model: e.target.value }))}
                          placeholder="codex"
                          spellCheck={false}
                        />
                      </label>
                      <label>
                        <span className="t-meta">API Key (optional)</span>
                        <Input
                          type="password"
                          value={proxySettings.apiKey}
                          onChange={(e) => setProxySettings((s) => ({ ...s, apiKey: e.target.value }))}
                          placeholder="Kept for this browser session only"
                          autoComplete="off"
                        />
                      </label>
                      <Button variant="line" onClick={saveProxySettings}>Save advanced settings</Button>
                    </div>
                  </details>
                </div>
              )}
              {proxyStatus && <span className="mine-model-status t-meta">{proxyStatus}</span>}
            </div>
          )}
        </section>
      )}

      {/* 存档(跨设备 · 占位过滤) */}
      {tab === "saves" && (
        <section className="mine-section">
          <h2 className="t-h3 mine-sec-title">In progress / Saved games</h2>
          {game && (
            <button className="mine-save mine-save--cur" onClick={() => navigate("/play")}>
              <span className="mine-save-dot" aria-hidden="true" />
              <span className="mine-save-tx">
                <span className="t-ui-sm">{game.title || "Current story"}</span>
                <span className="t-meta">In progress on this device · tap to continue</span>
              </span>
              <span className="t-meta">Continue →</span>
            </button>
          )}
          {!loggedIn ? (
            <p className="t-ui mine-sub">Sign in to see saves synced across devices. For now, only the story in progress on this device is shown.</p>
          ) : saves === null ? (
            <p className="t-ui mine-sub">Loading saves…</p>
          ) : savesErr ? (
            <p className="t-ui mine-sub">Failed to load saves, possibly a network hiccup. The story in progress on this device is not affected.</p>
          ) : saves.length ? (
            <div className="mine-saves">
              {saves.map((s) => (
                <div className="mine-save" key={s.id}>
                  <span className="mine-save-tx">
                    <span className="t-ui-sm">{s.story || s.player || "Untitled save"}</span>
                    <span className="t-meta">Turn {s.turns}{s.updated_at ? " · " + String(s.updated_at).slice(0, 16) : ""}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="t-ui mine-sub">No stories in progress yet. Pick a book in Explore to start.</p>
          )}
        </section>
      )}

      {/* 收藏 */}
      {tab === "favorites" && (
        <section className="mine-section">
          <h2 className="t-h3 mine-sec-title">My favorites</h2>
          {favModels.length ? (
            <CardShelf models={favModels} onOpen={openCard} />
          ) : (
            <p className="t-ui mine-sub">No favorites yet. Tap Save in Explore or on a story page, and those stories and characters will show up here.</p>
          )}
        </section>
      )}

      {/* 我创建的(卡库竖卡分页 YOR-67) */}
      {tab === "created" && (
        <section className="mine-section">
          <h2 className="t-h3 mine-sec-title">Cards I created</h2>
          {createdModels.length ? (
            <>
              <CardShelf models={createdShown.map((m) => (favIdSet.has(m.kind + ":" + m.id) ? { ...m, fav: true } : m))} onOpen={openCard} />
              {createdPageCount > 1 && (
                <div className="mine-pager">
                  <Button variant="line" disabled={createdPage <= 1} onClick={() => setCreatedPage((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <span className="t-ui-sm mine-pager-info">{createdPage} / {createdPageCount}</span>
                  <Button variant="line" disabled={createdPage >= createdPageCount} onClick={() => setCreatedPage((p) => Math.min(createdPageCount, p + 1))}>
                    Next
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="t-ui mine-sub">Your Card Library is empty. Build a Character Card in Create and it will show up here.</p>
          )}
        </section>
      )}

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
