// ── 卡片归一化(toCardModel)────────────────────────────────────────────────
// 角色卡 / 故事书 / 世界书 / 玩家卡 / 库卡 视觉同一套(YOR-67 / YOR-38)。
// 每个端点一个薄适配器 → 统一 CardModel,展示型 <Card> 只认 model。禁 kind 大开关:
// 差异收敛在这里(适配 + 占位封面 + 角标 + note),不渗进组件。
//
// CardModel = { id, kind, title, cover, blurb, badge:{label,tone}, tags:[], meta:{}, note }
//   kind ∈ story | character | world | player   (库卡 = 同 kind + 不同 actions,由用处传)

const BADGE = {
  story: { label: "Full story · Play now", tone: "pine" },
  character: { label: "Character", tone: "gilt" },
  world: { label: "World Book", tone: "gilt" },
  player: { label: "Player Card", tone: "gilt" },
};

function clip(s, n = 90) {
  s = (s || "").trim().replace(/\s+/g, " ");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// 故事预设:/api/presets 的一行 { name, official, data:{ name, synopsis, author, cover, tags, characters, world, story, player } }
function fromStory(p) {
  const d = (p && p.data) || {};
  const nch = (d.characters || []).length;
  return {
    id: d.name || p.name || "story",
    kind: "story",
    title: d.name || p.name || "Untitled story",
    cover: d.cover || "",
    blurb: clip(d.synopsis || (d.story && d.story.premise) || "A story waiting for you to step in."),
    badge: BADGE.story,
    tags: (d.tags || []).slice(0, 3),
    meta: {
      characters: nch,
      author: d.author || "",
      uploader: d.author || "", // 上传者(真数据:故事 author)
      typeLabel: p && p.official ? "Official" : "", // 原创/同人 需引擎类型字段(YOR-95),暂只标官方
      useCount: pickCount(d.uses, p && p.uses, p && p.use_count), // 被使用次数:留位,等 YOR-95 后端字段
    },
    note: "",
    raw: p,
  };
}

// 取一个数值型计数(留位:当前后端无此字段则返回 null,接上 YOR-95 字段后自动显示)。
function pickCount(...vals) {
  for (const v of vals) if (typeof v === "number" && isFinite(v)) return v;
  return null;
}

// 角色卡:库项 { name, official, data: CharacterCard{ spec, data:{ name, tags, description, look, image, avatar } } }
// 也兼容直接传 CharacterCard。
function fromCharacter(it) {
  const card = it && it.data && it.data.data ? it.data : it; // 库项 vs 裸卡
  const cd = (card && card.data) || {};
  return {
    id: cd.name || (it && it.name) || "character",
    kind: "character",
    title: cd.name || (it && it.name) || "Character",
    cover: cd.image || cd.avatar || "",
    blurb: clip(cd.look || cd.description || "A character waiting to be discovered."),
    badge: BADGE.character,
    tags: (cd.tags || []).slice(0, 3),
    meta: {
      uploader: cd.author || "", // 角色卡作者多无 → 留位(YOR-95)
      typeLabel: it && it.official ? "Official" : "", // OC/CN/同人 需引擎类型字段(YOR-95),暂只标官方
      useCount: pickCount(cd.uses, it && it.uses, it && it.use_count), // 留位
    },
    note: "",
    raw: it,
  };
}

// 世界书:库项 { name, official, data:{ name, entries:[], tags } }。无立绘 → 占位封面(书脊感)。
function fromWorld(it) {
  const d = (it && it.data) || {};
  const n = (d.entries || []).length;
  return {
    id: d.name || (it && it.name) || "world",
    kind: "world",
    title: d.name || (it && it.name) || "Lore Card",
    cover: d.cover || d.image || "",
    blurb: clip(d.synopsis || (n ? `A world setting you can attach to any story, with ${n} ${n === 1 ? "entry" : "entries"}.` : "A world setting.")),
    badge: BADGE.world,
    tags: (d.tags || []).slice(0, 3),
    meta: { entries: n },
    note: "Creation material · Not directly playable",
    raw: it,
  };
}

// 玩家/演出卡:库项 { name, official, data:{ name, role, goals } }。无立绘 → 占位封面。
function fromPlayer(it) {
  const d = (it && it.data) || {};
  return {
    id: d.name || (it && it.name) || "player",
    kind: "player",
    title: d.name || (it && it.name) || "Player Card",
    cover: d.image || "",
    blurb: clip(d.role || (d.goals || []).join(" / ") || "A role you can step into."),
    badge: BADGE.player,
    tags: (d.tags || []).slice(0, 3),
    meta: { role: d.role || "" },
    note: "Player identity · Play as this role",
    raw: it,
  };
}

const ADAPTERS = {
  story: fromStory,
  stories: fromStory,
  character: fromCharacter,
  characters: fromCharacter,
  world: fromWorld,
  worlds: fromWorld,
  player: fromPlayer,
  players: fromPlayer,
};

export function toCardModel(kind, raw) {
  const fn = ADAPTERS[kind];
  if (!fn) throw new Error("toCardModel: unknown kind " + kind);
  return fn(raw);
}

export function toCardModels(kind, list) {
  return (list || []).map((raw) => toCardModel(kind, raw));
}
