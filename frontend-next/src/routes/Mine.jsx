import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, CardShelf } from "../components/ui";
import { getJSON, postJSON } from "../lib/api";
import { toCardModels } from "../lib/cardModel";
import { useAuth } from "../state/auth";
import { useGame } from "../state/game";
import "./Mine.css";

// 我的 · 个人中心。继承 ReconProfile;补 收藏 / 我创建的 / 账号设置 / 成就(YOR-68)/ 卡库竖卡分页(YOR-67)/
// 存档跨设备(YOR-22)/ 占位卡过滤(YOR-16)。登录相关端点对 guest 优雅降级。
const TABS = [
  { key: "profile", label: "档案" },
  { key: "saves", label: "存档" },
  { key: "favorites", label: "收藏" },
  { key: "created", label: "我创建的" },
  { key: "achievements", label: "成就" },
];
const PAGE = 8;
const FAV_KEY = "ais_favorites_v1";

// 整蛊成就:大多靠本机轻量信号点亮,没有真后端追踪也能玩起来(YOR-68 轻量整蛊向)。
const ACHIEVEMENTS = [
  { id: "arrive", name: "初来乍到", desc: "你来了。就凭这个。", check: () => true },
  { id: "social", name: "社交悍匪", desc: "在纯聊加了第一个联系人。", check: (s) => s.rosterCount > 0 },
  { id: "creator", name: "无中生有", desc: "卡库里有了你亲手造的卡。", check: (s) => s.createdCount > 0 },
  { id: "hoarder", name: "仓鼠成精", desc: "卡库攒到 5 张以上。", check: (s) => s.createdCount >= 5 },
  { id: "player", name: "入戏太深", desc: "至少有一个进行中的故事。", check: (s) => s.hasGame },
  { id: "collector", name: "始乱终弃", desc: "收藏过、又没怎么打开过。", check: (s) => s.favCount > 0 },
  { id: "explorer", name: "翻箱倒柜", desc: "把「我的」每个分区都点了一遍。", check: (s) => s.visitedAll },
  { id: "ghost", name: "薛定谔的存档", desc: "存档跨设备同步成功(需登录)。", check: (s) => s.savesSynced },
];

function avatarChar(name) {
  return (name || "?").trim().charAt(0) || "?";
}

export default function Mine() {
  const navigate = useNavigate();
  const { user, enabled, logout } = useAuth();
  const { game } = useGame();
  const [tab, setTab] = useState("profile");
  const [me, setMe] = useState(user); // 本地档案副本(头像/昵称改后即时反映)
  const [nameEdit, setNameEdit] = useState("");
  const [saving, setSaving] = useState(false);
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
  const [visited, setVisited] = useState(() => new Set(["profile"]));
  const fileRef = useRef(null);

  useEffect(() => setMe(user), [user]);
  useEffect(() => setVisited((v) => new Set([...v, tab])), [tab]);

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
    return [...sm, ...cm];
  }, [favs]);

  const achState = {
    rosterCount: (() => {
      try {
        const uid = user ? user.id : "";
        return (JSON.parse(localStorage.getItem("ais_chat_roster_v1" + (uid ? "_u_" + uid : "")) || "[]")).length;
      } catch (e) {
        return 0;
      }
    })(),
    createdCount: created.length,
    hasGame: !!game,
    favCount: (favs.stories || []).length + (favs.characters || []).length,
    visitedAll: visited.size >= TABS.length,
    savesSynced: Array.isArray(saves) && saves.length > 0 && !!(enabled && user),
  };

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
        setMe((u) => ({ ...(u || {}), avatar: r.avatar || dataUrl }));
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
      setMe((u) => ({ ...(u || {}), display_name: r.display_name || nm }));
      setNameEdit("");
    } catch (e) {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  const displayName = (me && (me.display_name || me.username)) || "游客";
  const loggedIn = !!(enabled && user);

  return (
    <div className="page mine">
      <div className="mine-head">
        <h1 className="t-display">我的</h1>
      </div>

      <div className="mine-tabs">
        {TABS.map((t) => (
          <button key={t.key} className={"mine-tab" + (tab === t.key ? " is-on" : "")} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
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
            <CardShelf models={favModels} onOpen={() => {}} />
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
              <CardShelf models={createdShown} onOpen={() => {}} />
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

      {/* 成就(整蛊 YOR-68) */}
      {tab === "achievements" && (
        <section className="mine-section">
          <h2 className="t-h3 mine-sec-title">成就墙</h2>
          <div className="mine-achs">
            {ACHIEVEMENTS.map((a) => {
              const got = a.check(achState);
              return (
                <div className={"mine-ach" + (got ? " is-got" : "")} key={a.id}>
                  <div className="mine-ach-icon" aria-hidden="true">{got ? "★" : "☆"}</div>
                  <div className="mine-ach-tx">
                    <div className="mine-ach-name t-ui-sm">{got ? a.name : "??????"}</div>
                    <div className="mine-ach-desc t-meta">{got ? a.desc : "尚未解锁"}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
