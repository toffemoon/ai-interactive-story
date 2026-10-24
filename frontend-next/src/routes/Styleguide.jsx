import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Chip, Badge, Tag, Input, SearchField, ChatBubble, Card, CardShelf } from "../components/ui";
import { IdentityCard } from "../components/IdentityCard";
import { getJSON } from "../lib/api";
import { toCardModel } from "../lib/cardModel";
import { L } from "../lib/i18n";
import "./Styleguide.css";

const PAPER_SWATCHES = [
  [L("Paper (pure white)", "纸底(全白)"), "#ffffff"],
  [L("Inset", "凹底"), "#f4f4f2"],
  [L("Panel", "面板"), "#ffffff"],
  [L("Ink", "墨"), "#20201d"],
  [L("Muted ink", "弱墨"), "#6f706b"],
  [L("Line", "线"), "#e4e4e1"],
  [L("Cinnabar", "朱砂"), "#8f3c32"],
  [L("Pine", "松绿"), "#315d4f"],
  [L("Ochre gold", "赭金"), "#ad7a24"],
];
const STAGE_SWATCHES = [
  [L("Base", "底"), "#221c16"],
  [L("Panel", "面板"), "#2c241c"],
  [L("Line", "线"), "#3a3127"],
  [L("Moon white", "月白"), "#ece3d2"],
  [L("Muted", "弱"), "#b3a890"],
  [L("Vermilion", "朱"), "#d15a40"],
  [L("Ochre gold", "赭金"), "#c79a4e"],
];

function Swatches({ items }) {
  return (
    <div className="sg-swatches">
      {items.map(([name, hex]) => (
        <div key={name} className="sg-swatch">
          <div className="sg-chip" style={{ background: hex }} />
          <div className="t-ui-sm">{name}</div>
          <div className="t-mono sg-hex">{hex}</div>
        </div>
      ))}
    </div>
  );
}

// 各 kind 的 actions 插槽,精确对齐 卡片-翻转手感.html(去玩/纯聊/开故事/用到创作 + 详情)。
const ACTIONS = {
  story: [
    { label: L("Play", "去玩"), variant: "primary" },
    { label: L("Details", "详情"), variant: "line", isDetail: true },
  ],
  character: [
    { label: L("Chat", "纯聊"), variant: "secondary" },
    { label: L("Start story", "开故事"), variant: "primary" },
    { label: L("View details", "查看详情"), variant: "line", full: true, isDetail: true },
  ],
  world: [
    { label: L("Use in Create", "用到创作"), variant: "secondary" },
    { label: L("Details", "详情"), variant: "line", isDetail: true },
  ],
  player: [
    { label: L("Use in Create", "用到创作"), variant: "secondary" },
    { label: L("Details", "详情"), variant: "line", isDetail: true },
  ],
};

export default function Styleguide() {
  const [cards, setCards] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [presets, chars, worlds, players] = await Promise.all([
          getJSON("/api/presets").catch(() => []),
          getJSON("/api/library/characters").catch(() => []),
          getJSON("/api/library/worlds").catch(() => []),
          getJSON("/api/library/players").catch(() => []),
        ]);
        const pick = [];
        if (presets[0]) pick.push(toCardModel("story", presets[0]));
        if (chars[0]) pick.push(toCardModel("character", chars[0]));
        if (worlds[0]) pick.push(toCardModel("world", worlds[0]));
        if (players[0]) pick.push(toCardModel("player", players[0]));
        setCards(pick);
      } catch (e) {
        setErr(e.message || L("Failed to load", "加载失败"));
      }
    })();
  }, []);

  return (
    <div className="sg page" data-testid="styleguide">
      <div className="sg-head">
        <div>
          <p className="u-eyebrow">{L("Muyan · design system v0", "沐言 · design system v0")}</p>
          <h1 className="t-display">{L("Component preview · styleguide", "组件预览 · styleguide")}</h1>
          <p className="t-ui sg-sub">{L("One DNA, two registers. Paper = website and app shell; Stage = the immersive layer of the current story.", "一套 DNA,两个 register。纸 = 官网与 app 外壳;台 = 当前故事沉浸层。")}</p>
        </div>
        <Link to="/explore" className="sg-back t-ui">
          {L("→ Go to Explore", "→ 去探索")}
        </Link>
      </div>

      {/* 色 */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">{L("Color · paper", "色 · 纸 paper")}</h2>
        <Swatches items={PAPER_SWATCHES} />
        <h2 className="t-h2 sg-label" data-theme="stage" style={{ background: "transparent" }}>
          {L("Color · stage (no green)", "色 · 台 stage(去绿)")}
        </h2>
        <div data-theme="stage" className="sg-stage-wrap">
          <Swatches items={STAGE_SWATCHES} />
        </div>
      </section>

      {/* 字 */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">{L("Type · revised scale", "字 · 修过字阶")}</h2>
        <div className="sg-type">
          <div className="sg-type-row">
            <span className="t-display">{L("Muyan Bookshop", "沐言书坊")}</span>
            <span className="t-mono sg-hex">{L("Serif · display 30/1.05", "宋 · display 30/1.05")}</span>
          </div>
          <div className="sg-type-row">
            <span className="t-h2">{L("Explore · Current story", "探索 · 当前故事")}</span>
            <span className="t-mono sg-hex">{L("Serif · heading 22", "宋 · 标题 22")}</span>
          </div>
          <div className="sg-type-row">
            <span className="t-read sg-read-sample">{L("It rained a little in the night, and the bookshop's lamps were still on. You push the door open, and the smell of paper reaches you first.", "夜里下了点雨,书坊的灯还亮着。你推门进去,纸页的味道先一步迎上来。")}</span>
            <span className="t-mono sg-hex">{L("Serif · narration body 16/1.75", "宋 · 叙事正文 16/1.75")}</span>
          </div>
          <div className="sg-type-row">
            <span className="t-kai sg-quote">{L('"Whoever lifts the brush holds the pen; where the ink falls, mountains and rivers appear."', "「提笔者即执笔人,落墨处自有山河。」")}</span>
            <span className="t-mono sg-hex">{L("Kai · quotes / card titles", "楷 · 引文 / 卡面书名")}</span>
          </div>
          <div className="sg-type-row">
            <span className="t-ui">{L("Explore · Create · Chat · Me", "探索　创作　纯聊　我的")}</span>
            <span className="t-mono sg-hex">{L("Sans-serif · UI 14", "无衬线 · UI 14")}</span>
          </div>
          <div className="sg-type-row">
            <span className="t-mono">token 1,280 / 8k</span>
            <span className="t-mono sg-hex">{L("Monospace · numbers", "等宽 · 数值")}</span>
          </div>
        </div>
      </section>

      {/* Button / Chip / Badge / Tag */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">Button</h2>
        <div className="sg-row">
          <Button variant="primary">{L("Play →", "去游玩 →")}</Button>
          <Button variant="secondary">{L("Start creating", "开始创作")}</Button>
          <Button variant="ghost">{L("Learn more", "了解更多")}</Button>
          <Button variant="line">{L("Details", "详情")}</Button>
          <Button variant="primary" size="sm">
            {L("Small", "小号")}
          </Button>
          <Button variant="primary" disabled>
            {L("Disabled", "禁用")}
          </Button>
        </div>

        <h2 className="t-h2 sg-label">{L("Chip · filters", "Chip · 筛选")}</h2>
        <div className="sg-row">
          <Chip active>{L("All", "全部")}</Chip>
          <Chip>{L("Full story", "完整故事")}</Chip>
          <Chip>{L("Character", "角色卡")}</Chip>
          <Chip>{L("Xianxia", "仙侠")}</Chip>
        </div>

        <h2 className="t-h2 sg-label">{L("Badge · type labels", "Badge · 类型角标")}</h2>
        <div className="sg-row">
          <Badge tone="pine">{L("Full story · Play now", "完整故事 · 可直接玩")}</Badge>
          <Badge tone="gilt">{L("Character", "角色卡")}</Badge>
          <Badge tone="cinnabar">{L("Featured", "推荐")}</Badge>
        </div>

        <h2 className="t-h2 sg-label">{L("Tag · status / meta", "Tag · 状态 / 元信息")}</h2>
        <div className="sg-row">
          <Tag>{L("Intrigue", "权谋")}</Tag>
          <Tag tone="scene">{L("Scene · Rainy night street", "场景 · 雨夜长街")}</Tag>
          <Tag tone="relation">{L("Relationship · Subtle", "关系 · 微妙")}</Tag>
        </div>
      </section>

      {/* Input / Chat */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">Input / Search</h2>
        <div className="sg-row sg-row--stack">
          <SearchField placeholder={L("Search stories / characters…", "搜故事 / 角色卡…")} />
          <Input placeholder={L("Form input, focus shows the cinnabar ring", "表单输入,focus 见朱环")} />
        </div>

        <h2 className="t-h2 sg-label">{L("ChatBubble · messenger style (paper)", "ChatBubble · 微信式(纸)")}</h2>
        <div className="sg-chat">
          <ChatBubble side="received">{L("I'm here. Which story do you want to visit today?", "在的,今天想去哪一段故事?")}</ChatBubble>
          <ChatBubble side="sent">{L("First, help me finish that ending from last time", "先陪我把上次那个结局写完")}</ChatBubble>
        </div>
      </section>

      {/* 台 register */}
      <section className="sg-section sg-stage-section" data-theme="stage">
        <h2 className="t-h2 sg-label">{L("Stage · warm night · vermilion + gold", "台 stage · 暖夜 · 朱 + 金")}</h2>
        <p className="t-kai sg-stage-line">{L("Moonlight fell on the bluestone. She didn't look back, only tilted her umbrella a little toward you.", "月光落在青石上,她没有回头,只把伞往你这边偏了偏。")}</p>
        <div className="sg-row">
          <Tag tone="scene">{L("Scene · Rainy night street", "场景 · 雨夜长街")}</Tag>
          <Tag tone="relation">{L("Relationship · Subtle", "关系 · 微妙")}</Tag>
          <span className="t-mono sg-stage-meta">token 1,280 / 8k</span>
        </div>
        <div className="sg-row">
          <Button variant="primary">{L("Continue", "继续")}</Button>
          <Button variant="secondary">{L("Save", "存档")}</Button>
        </div>
        <div className="sg-chat">
          <ChatBubble side="received">{L("I've been waiting here for you for a long time.", "我在这里等了你很久。")}</ChatBubble>
          <ChatBubble side="sent">{L("This time I won't leave again.", "这次我不会再走了。")}</ChatBubble>
        </div>
      </section>

      {/* 统一 Card · 各 kind 各一张(真数据) */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">{L("Unified Card · shelf (tap to flip · live data for each kind)", "统一 Card · shelf(点卡翻面 · 各 kind 真数据)")}</h2>
        <p className="t-ui-sm sg-sub">{L("Cover → tap to flip for synopsis + tags → back-side actions / details. Only one card flips at a time; tap elsewhere to close it (controlled flip, closes YOR-47).", "封面 → tap 翻转看简介 + 标签 → 背面操作 / 详情。一次只翻一张,点别处收(受控 flip,结案 YOR-47)。")}</p>
        {err && <p className="sg-err">{err}</p>}
        {!cards.length && !err && <p className="t-ui-sm sg-sub">{L("Loading live data…", "载入真数据中…")}</p>}
        <CardShelf
          models={cards}
          actionsFor={(m) => ACTIONS[m.kind] || []}
          onOpen={(m) => alert(L("Details (will reuse ReconStoryDetail later): ", "详情(复用 ReconStoryDetail,后续接):") + m.title)}
        />

        <h2 className="t-h2 sg-label">{L("Unified Card · row / thumb variants (no flip)", "统一 Card · row / thumb 变体(不翻)")}</h2>
        <div className="sg-row sg-row--stack">
          {cards.map((m) => (
            <Card key={"row-" + m.kind} model={m} variant="row" actions={[{ label: L("Open", "打开"), variant: "line" }]} />
          ))}
        </div>
        <div className="sg-row">
          {cards.map((m) => (
            <Card key={"thumb-" + m.kind} model={m} variant="thumb" />
          ))}
        </div>
      </section>

      {/* 身份卡 · IdentityCard(onboarding 收尾凭证,点一下翻面) */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">{L("Identity card · IdentityCard (tap to flip · entry pass)", "身份卡 · IdentityCard(点一下翻面 · 入店凭证)")}</h2>
        <p className="t-ui-sm sg-sub">
          {L("End of onboarding: the pass Tangmu hands to a new guest. Front = monogram avatar + name; tap to flip to the back = lately into / issue date / signature. Warm-night gold border, reusing the unified Card's flip technique (each face has its own perspective+rotateY, so the back stays clickable).", "onboarding 收尾:糖沐递给新客的凭证。正面 = 字头头像 + 称呼;点一下翻到背面 = 最近在看 / 发卡 / 落款。暖夜金边,复用统一 Card 的翻转技术(两面各自 perspective+rotateY,背面可点)。")}
        </p>
        <div className="sg-idcards">
          <IdentityCard
            name={L("Xiaoman", "小满")}
            taste={L("Fog Hill of Five Elements, rereading Red Chamber", "最近在追《雾山五行》,重看《红楼梦》")}
            message={L("Xiaoman, may the story in your hands ripen slowly, like the wheat this season.", "小满,愿你手边的故事,像这时节的麦子,慢慢就熟了。")}
            issuedAt="2026-07-06"
          />
          <IdentityCard
            name={L("Night Wanderer", "夜游客")}
            taste=""
            message={L("Night Wanderer, I'll leave the lamp on for you. Read as late as you like.", "夜游客,灯我给你留着,想读到多晚都成。")}
            issuedAt="2026-07-06"
          />
        </div>
      </section>

      <p className="sg-foot t-meta">{L("Muyan design system v0 · YOR-92 · frontend-next", "沐言设计系统 v0 · YOR-92 · frontend-next")}</p>
    </div>
  );
}
