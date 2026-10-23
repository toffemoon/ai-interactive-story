import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Chip, Badge, Tag, Input, SearchField, ChatBubble, Card, CardShelf } from "../components/ui";
import { IdentityCard } from "../components/IdentityCard";
import { getJSON } from "../lib/api";
import { toCardModel } from "../lib/cardModel";
import "./Styleguide.css";

const PAPER_SWATCHES = [
  ["Paper (pure white)", "#ffffff"],
  ["Inset", "#f4f4f2"],
  ["Panel", "#ffffff"],
  ["Ink", "#20201d"],
  ["Muted ink", "#6f706b"],
  ["Line", "#e4e4e1"],
  ["Cinnabar", "#8f3c32"],
  ["Pine", "#315d4f"],
  ["Ochre gold", "#ad7a24"],
];
const STAGE_SWATCHES = [
  ["Base", "#221c16"],
  ["Panel", "#2c241c"],
  ["Line", "#3a3127"],
  ["Moon white", "#ece3d2"],
  ["Muted", "#b3a890"],
  ["Vermilion", "#d15a40"],
  ["Ochre gold", "#c79a4e"],
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
    { label: "Play", variant: "primary" },
    { label: "Details", variant: "line", isDetail: true },
  ],
  character: [
    { label: "Chat", variant: "secondary" },
    { label: "Start story", variant: "primary" },
    { label: "View details", variant: "line", full: true, isDetail: true },
  ],
  world: [
    { label: "Use in Create", variant: "secondary" },
    { label: "Details", variant: "line", isDetail: true },
  ],
  player: [
    { label: "Use in Create", variant: "secondary" },
    { label: "Details", variant: "line", isDetail: true },
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
        setErr(e.message || "Failed to load");
      }
    })();
  }, []);

  return (
    <div className="sg page" data-testid="styleguide">
      <div className="sg-head">
        <div>
          <p className="u-eyebrow">Muyan · design system v0</p>
          <h1 className="t-display">Component preview · styleguide</h1>
          <p className="t-ui sg-sub">One DNA, two registers. Paper = website and app shell; Stage = the immersive layer of the current story.</p>
        </div>
        <Link to="/explore" className="sg-back t-ui">
          → Go to Explore
        </Link>
      </div>

      {/* 色 */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">Color · paper</h2>
        <Swatches items={PAPER_SWATCHES} />
        <h2 className="t-h2 sg-label" data-theme="stage" style={{ background: "transparent" }}>
          Color · stage (no green)
        </h2>
        <div data-theme="stage" className="sg-stage-wrap">
          <Swatches items={STAGE_SWATCHES} />
        </div>
      </section>

      {/* 字 */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">Type · revised scale</h2>
        <div className="sg-type">
          <div className="sg-type-row">
            <span className="t-display">Muyan Bookshop</span>
            <span className="t-mono sg-hex">Serif · display 30/1.05</span>
          </div>
          <div className="sg-type-row">
            <span className="t-h2">Explore · Current story</span>
            <span className="t-mono sg-hex">Serif · heading 22</span>
          </div>
          <div className="sg-type-row">
            <span className="t-read sg-read-sample">It rained a little in the night, and the bookshop's lamps were still on. You push the door open, and the smell of paper reaches you first.</span>
            <span className="t-mono sg-hex">Serif · narration body 16/1.75</span>
          </div>
          <div className="sg-type-row">
            <span className="t-kai sg-quote">"Whoever lifts the brush holds the pen; where the ink falls, mountains and rivers appear."</span>
            <span className="t-mono sg-hex">Kai · quotes / card titles</span>
          </div>
          <div className="sg-type-row">
            <span className="t-ui">Explore · Create · Chat · Me</span>
            <span className="t-mono sg-hex">Sans-serif · UI 14</span>
          </div>
          <div className="sg-type-row">
            <span className="t-mono">token 1,280 / 8k</span>
            <span className="t-mono sg-hex">Monospace · numbers</span>
          </div>
        </div>
      </section>

      {/* Button / Chip / Badge / Tag */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">Button</h2>
        <div className="sg-row">
          <Button variant="primary">Play →</Button>
          <Button variant="secondary">Start creating</Button>
          <Button variant="ghost">Learn more</Button>
          <Button variant="line">Details</Button>
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>

        <h2 className="t-h2 sg-label">Chip · filters</h2>
        <div className="sg-row">
          <Chip active>All</Chip>
          <Chip>Full story</Chip>
          <Chip>Character</Chip>
          <Chip>Xianxia</Chip>
        </div>

        <h2 className="t-h2 sg-label">Badge · type labels</h2>
        <div className="sg-row">
          <Badge tone="pine">Full story · Play now</Badge>
          <Badge tone="gilt">Character</Badge>
          <Badge tone="cinnabar">Featured</Badge>
        </div>

        <h2 className="t-h2 sg-label">Tag · status / meta</h2>
        <div className="sg-row">
          <Tag>Intrigue</Tag>
          <Tag tone="scene">Scene · Rainy night street</Tag>
          <Tag tone="relation">Relationship · Subtle</Tag>
        </div>
      </section>

      {/* Input / Chat */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">Input / Search</h2>
        <div className="sg-row sg-row--stack">
          <SearchField placeholder="Search stories / characters…" />
          <Input placeholder="Form input, focus shows the cinnabar ring" />
        </div>

        <h2 className="t-h2 sg-label">ChatBubble · messenger style (paper)</h2>
        <div className="sg-chat">
          <ChatBubble side="received">I'm here. Which story do you want to visit today?</ChatBubble>
          <ChatBubble side="sent">First, help me finish that ending from last time</ChatBubble>
        </div>
      </section>

      {/* 台 register */}
      <section className="sg-section sg-stage-section" data-theme="stage">
        <h2 className="t-h2 sg-label">Stage · warm night · vermilion + gold</h2>
        <p className="t-kai sg-stage-line">Moonlight fell on the bluestone. She didn't look back, only tilted her umbrella a little toward you.</p>
        <div className="sg-row">
          <Tag tone="scene">Scene · Rainy night street</Tag>
          <Tag tone="relation">Relationship · Subtle</Tag>
          <span className="t-mono sg-stage-meta">token 1,280 / 8k</span>
        </div>
        <div className="sg-row">
          <Button variant="primary">Continue</Button>
          <Button variant="secondary">Save</Button>
        </div>
        <div className="sg-chat">
          <ChatBubble side="received">I've been waiting here for you for a long time.</ChatBubble>
          <ChatBubble side="sent">This time I won't leave again.</ChatBubble>
        </div>
      </section>

      {/* 统一 Card · 各 kind 各一张(真数据) */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">Unified Card · shelf (tap to flip · live data for each kind)</h2>
        <p className="t-ui-sm sg-sub">Cover → tap to flip for synopsis + tags → back-side actions / details. Only one card flips at a time; tap elsewhere to close it (controlled flip, closes YOR-47).</p>
        {err && <p className="sg-err">{err}</p>}
        {!cards.length && !err && <p className="t-ui-sm sg-sub">Loading live data…</p>}
        <CardShelf
          models={cards}
          actionsFor={(m) => ACTIONS[m.kind] || []}
          onOpen={(m) => alert("Details (will reuse ReconStoryDetail later): " + m.title)}
        />

        <h2 className="t-h2 sg-label">Unified Card · row / thumb variants (no flip)</h2>
        <div className="sg-row sg-row--stack">
          {cards.map((m) => (
            <Card key={"row-" + m.kind} model={m} variant="row" actions={[{ label: "Open", variant: "line" }]} />
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
        <h2 className="t-h2 sg-label">Identity card · IdentityCard (tap to flip · entry pass)</h2>
        <p className="t-ui-sm sg-sub">
          End of onboarding: the pass Tangmu hands to a new guest. Front = monogram avatar + name; tap to flip to the back = lately into / issue date / signature. Warm-night gold border, reusing the unified Card's flip technique (each face has its own perspective+rotateY, so the back stays clickable).
        </p>
        <div className="sg-idcards">
          <IdentityCard
            name="Xiaoman"
            taste="Fog Hill of Five Elements, rereading Red Chamber"
            message="Xiaoman, may the story in your hands ripen slowly, like the wheat this season."
            issuedAt="2026-07-06"
          />
          <IdentityCard
            name="Night Wanderer"
            taste=""
            message="Night Wanderer, I'll leave the lamp on for you. Read as late as you like."
            issuedAt="2026-07-06"
          />
        </div>
      </section>

      <p className="sg-foot t-meta">Muyan design system v0 · YOR-92 · frontend-next</p>
    </div>
  );
}
