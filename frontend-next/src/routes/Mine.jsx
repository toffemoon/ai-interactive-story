import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "../lib/transitionNav";
import { Button, Input, CardShelf } from "../components/ui";
import { getJSON, postJSON } from "../lib/api";
import { toCardModels } from "../lib/cardModel";
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

// 成就系统已删除(YOR-188,yufei 拍板)。
function avatarChar(name) {
  return (name || "?").trim().charAt(0) || "?";
}

export default function Mine() {
  const navigate = useNavigate();
  const { user, enabled, logout, patchUser } = useAuth();
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
  const fileRef = useRef(null);
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

  const displayName = (me && (me.display_name || me.username)) || "游客";
  const loggedIn = !!(enabled && user);

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
              <CardShelf models={createdShown.map((m) => (favIdSet.has(m.kind + ":" + m.id) ? { ...m, fav: true } : m))} onOpen={() => {}} />
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

    </div>
  );
}
