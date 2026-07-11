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
  { key: "profile", label: "档案" },
  { key: "saves", label: "存档" },
  { key: "favorites", label: "收藏" },
  { key: "created", label: "我创建的" },
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
          setProxyStatus("Codex 已连接并启用");
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
    if (!window.confirm(`确定删除「${m.title}」?删除后无法恢复。`)) return;
    try {
      await delJSON(`/api/library/characters/${encodeURIComponent(nm)}`);
      setCreated((rows) => rows.filter((r) => r.name !== nm));
      setDetail(null);
    } catch (e) {
      alert("删除失败:" + (e.message || "请稍后再试"));
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
    setProxyStatus(source === "local_proxy" ? "已选择 Codex 本机反代" : "已选择 DeepSeek");
  }

  function saveProxySettings() {
    const next = saveLocalProxySettings(proxySettings);
    setProxySettings(next);
    setProxyStatus("本机反代设置已保存");
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
    setProxyStatus("连接助手已下载，运行后会自动完成安装和登录");
  }

  function wakeCodexConnector() {
    window.location.href = "aistory-codex://connect";
    setProxyStatus("正在启动已安装的连接助手");
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
        setProxyStatus("Codex 已连接并启用");
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
          setProxyStatus("Codex 已连接并启用");
          return;
        }
        if (status.status === "failed" || status.status === "cancelled") {
          throw new Error(status.error || "Codex 登录没有完成");
        }
      }
      if (codexLoginRun.current === runId) {
        await cancelLocalProxyLogin(login.login_id).catch(() => {});
        throw new Error("登录等待超时，请重试或使用设备码");
      }
    } catch (error) {
      if (authWindow && !authWindow.closed) authWindow.close();
      if (codexLoginRun.current === runId) {
        setCodexConnection((current) => ({ ...current, phase: "login_required", error: error.message }));
        setProxyStatus(error.message || "Codex 登录失败");
      }
    }
  }

  const displayName = (me && (me.display_name || me.username)) || "游客";
  const loggedIn = !!(enabled && user);
  const codexPhase = codexConnection.phase;
  const codexLabel = {
    checking: "正在检测本机连接",
    missing: "尚未连接",
    installing: "等待连接助手启动",
    login_required: "等待 ChatGPT 登录",
    login_pending: "正在连接 ChatGPT",
    connected: "Codex 已连接",
  }[codexPhase] || "Codex 连接异常";
  const codexDetail = codexPhase === "connected"
    ? [
        CODEX_PLAN_LABELS[codexConnection.account && codexConnection.account.plan_type] || null,
        codexConnection.health && codexConnection.health.model,
      ]
        .filter(Boolean).join(" · ") || "可以开始游玩"
    : codexConnection.error || "";

  return (
    <div className="page mine">
      <div className="mine-head">
        <h1 className="t-display">我的</h1>
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
              title={loggedIn ? "更换头像" : "登录后可换头像"}
            >
              {!(me && me.avatar) && avatarChar(displayName)}
              <span className="mine-avatar-edit t-meta">换</span>
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={uploadAvatar} />
            <div className="mine-profile-main">
              <div className="mine-name t-h1">{displayName}</div>
              <div className="mine-role t-meta">{loggedIn ? "账户 · " + (me.role || "user") : "未登录 · 游客模式"}</div>
            </div>
          </div>

          <div className="mine-account">
            <h2 className="t-h3 mine-sec-title">账号设置</h2>
            {loggedIn ? (
              <>
                <div className="mine-account-row">
                  <Input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} placeholder="改个昵称(1-24 字)" />
                  <Button variant="line" disabled={saving || !nameEdit.trim()} onClick={saveName}>
                    {saving ? "保存中…" : "保存昵称"}
                  </Button>
                </div>
                <Button variant="line" onClick={() => logout().then(() => navigate("/login"))}>
                  退出登录
                </Button>
              </>
            ) : (
              <div className="mine-guest">
                <p className="t-ui mine-sub">登录后可设置头像、昵称,存档跨设备同步。</p>
                <Button variant="primary" onClick={() => navigate("/login")}>
                  去登录
                </Button>
              </div>
            )}
          </div>

          {loggedIn && me && me.local_proxy_enabled && (
            <div className="mine-model">
              <h2 className="t-h3 mine-sec-title">模型来源</h2>
              <div className="mine-model-segment" aria-label="模型来源">
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
                  Codex 本机
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
                        {codexPhase === "installing" ? "重新下载安装器" : "一键安装并连接"}
                      </Button>
                    )}
                    {codexPhase === "missing" && (
                      <Button variant="line" onClick={wakeCodexConnector}>启动已安装助手</Button>
                    )}
                    {codexPhase === "login_required" && (
                      <Button variant="primary" onClick={() => beginCodexLogin("browser")}>连接 ChatGPT</Button>
                    )}
                    <Button
                      variant="line"
                      disabled={codexPhase === "checking" || codexPhase === "login_pending"}
                      onClick={refreshCodexConnection}
                    >
                      重新检测
                    </Button>
                  </div>

                  {codexConnection.oauthUrl && (
                    <a className="mine-codex-link t-ui-sm" href={codexConnection.oauthUrl} target="_blank" rel="noreferrer">
                      打开 ChatGPT 登录页
                    </a>
                  )}
                  {codexPhase === "login_required" && codexConnection.health && (
                    <button className="mine-codex-device t-meta" onClick={() => beginCodexLogin("device")}>
                      改用设备码登录
                    </button>
                  )}
                  {codexConnection.userCode && (
                    <div className="mine-codex-code">
                      <span className="t-meta">设备码</span>
                      <strong className="t-mono">{codexConnection.userCode}</strong>
                    </div>
                  )}

                  <details className="mine-model-advanced">
                    <summary className="t-meta">高级设置</summary>
                    <div className="mine-model-fields">
                      <label>
                        <span className="t-meta">API Base URL</span>
                        <Input
                          value={proxySettings.endpoint}
                          onChange={(e) => setProxySettings((s) => ({ ...s, endpoint: e.target.value }))}
                          placeholder="http://127.0.0.1:端口/v1"
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
                        <span className="t-meta">API Key（可选）</span>
                        <Input
                          type="password"
                          value={proxySettings.apiKey}
                          onChange={(e) => setProxySettings((s) => ({ ...s, apiKey: e.target.value }))}
                          placeholder="仅保留到本次浏览器会话"
                          autoComplete="off"
                        />
                      </label>
                      <Button variant="line" onClick={saveProxySettings}>保存高级设置</Button>
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
          <h2 className="t-h3 mine-sec-title">进行中 / 历史存档</h2>
          {game && (
            <button className="mine-save mine-save--cur" onClick={() => navigate("/play")}>
              <span className="mine-save-dot" aria-hidden="true" />
              <span className="mine-save-tx">
                <span className="t-ui-sm">{game.title || "当前故事"}</span>
                <span className="t-meta">本机进行中 · 点继续</span>
              </span>
              <span className="t-meta">继续 →</span>
            </button>
          )}
          {!loggedIn ? (
            <p className="t-ui mine-sub">登录后可看跨设备同步的存档列表。当前仅显示本机进行中的故事。</p>
          ) : saves === null ? (
            <p className="t-ui mine-sub">读取存档中…</p>
          ) : savesErr ? (
            <p className="t-ui mine-sub">存档加载失败,可能是网络抖动。本机进行中的故事不受影响。</p>
          ) : saves.length ? (
            <div className="mine-saves">
              {saves.map((s) => (
                <div className="mine-save" key={s.id}>
                  <span className="mine-save-tx">
                    <span className="t-ui-sm">{s.story || s.player || "未命名存档"}</span>
                    <span className="t-meta">第 {s.turns} 回合{s.updated_at ? " · " + String(s.updated_at).slice(0, 16) : ""}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="t-ui mine-sub">还没有进行中的故事。去探索取一本书开局。</p>
          )}
        </section>
      )}

      {/* 收藏 */}
      {tab === "favorites" && (
        <section className="mine-section">
          <h2 className="t-h3 mine-sec-title">我的收藏</h2>
          {favModels.length ? (
            <CardShelf models={favModels} onOpen={openCard} />
          ) : (
            <p className="t-ui mine-sub">还没有收藏。在探索 / 故事详情点收藏,故事和角色会出现在这里。</p>
          )}
        </section>
      )}

      {/* 我创建的(卡库竖卡分页 YOR-67) */}
      {tab === "created" && (
        <section className="mine-section">
          <h2 className="t-h3 mine-sec-title">我创建的卡</h2>
          {createdModels.length ? (
            <>
              <CardShelf models={createdShown.map((m) => (favIdSet.has(m.kind + ":" + m.id) ? { ...m, fav: true } : m))} onOpen={openCard} />
              {createdPageCount > 1 && (
                <div className="mine-pager">
                  <Button variant="line" disabled={createdPage <= 1} onClick={() => setCreatedPage((p) => Math.max(1, p - 1))}>
                    上一页
                  </Button>
                  <span className="t-ui-sm mine-pager-info">{createdPage} / {createdPageCount}</span>
                  <Button variant="line" disabled={createdPage >= createdPageCount} onClick={() => setCreatedPage((p) => Math.min(createdPageCount, p + 1))}>
                    下一页
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="t-ui mine-sub">卡库还空着。去创作造一张角色卡,这里就有了。</p>
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
