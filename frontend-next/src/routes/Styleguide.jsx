import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Chip, Badge, Tag, Input, SearchField, ChatBubble, Card, CardShelf } from "../components/ui";
import Stepper, { Step } from "../components/Stepper";
import { getJSON } from "../lib/api";
import { toCardModel } from "../lib/cardModel";
import "./Styleguide.css";

const PAPER_SWATCHES = [
  ["宣纸底", "#f3f1ec"],
  ["凹底", "#eae2cf"],
  ["面板", "#fffdfa"],
  ["墨", "#20201d"],
  ["弱墨", "#6f706b"],
  ["线", "#d8d2c7"],
  ["朱砂", "#8f3c32"],
  ["松绿", "#315d4f"],
  ["赭金", "#ad7a24"],
];
const STAGE_SWATCHES = [
  ["底", "#221c16"],
  ["面板", "#2c241c"],
  ["线", "#3a3127"],
  ["月白", "#ece3d2"],
  ["弱", "#b3a890"],
  ["朱", "#d15a40"],
  ["赭金", "#c79a4e"],
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
    { label: "去玩", variant: "primary" },
    { label: "详情", variant: "line", isDetail: true },
  ],
  character: [
    { label: "纯聊", variant: "secondary" },
    { label: "开故事", variant: "primary" },
    { label: "查看详情", variant: "line", full: true, isDetail: true },
  ],
  world: [
    { label: "用到创作", variant: "secondary" },
    { label: "详情", variant: "line", isDetail: true },
  ],
  player: [
    { label: "用到创作", variant: "secondary" },
    { label: "详情", variant: "line", isDetail: true },
  ],
};

// 新卡面改版样例(合成,不依赖后端):封面 + 长/短书名 + 无封面 + 有无作者。
const DEMO_CARDS = [
  { id: "d1", kind: "story", title: "新人入店", cover: "/home/coffeeshop.png", blurb: "一家会回应你的书店咖啡馆。", badge: { label: "完整故事 · 可直接玩", tone: "pine" }, tags: ["日常", "治愈"], meta: { uploader: "太妃月", typeLabel: "官方" }, note: "" },
  { id: "d2", kind: "character", title: "糖沐", cover: "/home/tangmu1.png", blurb: "沐言书坊的看板娘。", badge: { label: "角色卡", tone: "gilt" }, tags: ["温和", "店员"], meta: { uploader: "太妃月" }, note: "" },
  { id: "d3", kind: "story", title: "高考后我助丞相北伐之星辰大海篇", cover: "", blurb: "一个名字很长、用来测两行省略的故事。", badge: { label: "完整故事 · 可直接玩", tone: "pine" }, tags: ["历史", "权谋"], meta: { uploader: "测试作者" }, note: "" },
  { id: "d4", kind: "world", title: "翁法罗斯世界设定", cover: "", blurb: "可挂进任何故事的世界设定。", badge: { label: "世界书", tone: "gilt" }, tags: ["设定"], meta: {}, note: "创作素材" },
];

export default function Styleguide() {
  const [cards, setCards] = useState([]);
  const [err, setErr] = useState("");
  const [sgName, setSgName] = useState("");
  const [sgDone, setSgDone] = useState(false);

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
        setErr(e.message || "加载失败");
      }
    })();
  }, []);

  return (
    <div className="sg page" data-testid="styleguide">
      <div className="sg-head">
        <div>
          <p className="u-eyebrow">沐言 · design system v0</p>
          <h1 className="t-display">组件预览 · styleguide</h1>
          <p className="t-ui sg-sub">一套 DNA,两个 register。纸 = 官网与 app 外壳;台 = 当前故事沉浸层。</p>
        </div>
        <Link to="/explore" className="sg-back t-ui">
          → 去探索
        </Link>
      </div>

      {/* 色 */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">色 · 纸 paper</h2>
        <Swatches items={PAPER_SWATCHES} />
        <h2 className="t-h2 sg-label" data-theme="stage" style={{ background: "transparent" }}>
          色 · 台 stage(去绿)
        </h2>
        <div data-theme="stage" className="sg-stage-wrap">
          <Swatches items={STAGE_SWATCHES} />
        </div>
      </section>

      {/* 字 */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">字 · 修过字阶</h2>
        <div className="sg-type">
          <div className="sg-type-row">
            <span className="t-display">沐言书坊</span>
            <span className="t-mono sg-hex">宋 · display 30/1.05</span>
          </div>
          <div className="sg-type-row">
            <span className="t-h2">探索 · 当前故事</span>
            <span className="t-mono sg-hex">宋 · 标题 22</span>
          </div>
          <div className="sg-type-row">
            <span className="t-read sg-read-sample">夜里下了点雨,书坊的灯还亮着。你推门进去,纸页的味道先一步迎上来。</span>
            <span className="t-mono sg-hex">宋 · 叙事正文 16/1.75</span>
          </div>
          <div className="sg-type-row">
            <span className="t-kai sg-quote">「提笔者即执笔人,落墨处自有山河。」</span>
            <span className="t-mono sg-hex">楷 · 引文 / 卡面书名</span>
          </div>
          <div className="sg-type-row">
            <span className="t-ui">探索　创作　纯聊　我的</span>
            <span className="t-mono sg-hex">无衬线 · UI 14</span>
          </div>
          <div className="sg-type-row">
            <span className="t-mono">token 1,280 / 8k</span>
            <span className="t-mono sg-hex">等宽 · 数值</span>
          </div>
        </div>
      </section>

      {/* Button / Chip / Badge / Tag */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">Button</h2>
        <div className="sg-row">
          <Button variant="primary">去游玩 →</Button>
          <Button variant="secondary">开始创作</Button>
          <Button variant="ghost">了解更多</Button>
          <Button variant="line">详情</Button>
          <Button variant="primary" size="sm">
            小号
          </Button>
          <Button variant="primary" disabled>
            禁用
          </Button>
        </div>

        <h2 className="t-h2 sg-label">Chip · 筛选</h2>
        <div className="sg-row">
          <Chip active>全部</Chip>
          <Chip>完整故事</Chip>
          <Chip>角色卡</Chip>
          <Chip>仙侠</Chip>
        </div>

        <h2 className="t-h2 sg-label">Badge · 类型角标</h2>
        <div className="sg-row">
          <Badge tone="pine">完整故事 · 可直接玩</Badge>
          <Badge tone="gilt">角色卡</Badge>
          <Badge tone="cinnabar">推荐</Badge>
        </div>

        <h2 className="t-h2 sg-label">Tag · 状态 / 元信息</h2>
        <div className="sg-row">
          <Tag>权谋</Tag>
          <Tag tone="scene">场景 · 雨夜长街</Tag>
          <Tag tone="relation">关系 · 微妙</Tag>
        </div>
      </section>

      {/* Input / Chat */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">Input / Search</h2>
        <div className="sg-row sg-row--stack">
          <SearchField placeholder="搜故事 / 角色卡…" />
          <Input placeholder="表单输入,focus 见朱环" />
        </div>

        <h2 className="t-h2 sg-label">ChatBubble · 微信式(纸)</h2>
        <div className="sg-chat">
          <ChatBubble side="received">在的,今天想去哪一段故事?</ChatBubble>
          <ChatBubble side="sent">先陪我把上次那个结局写完</ChatBubble>
        </div>
      </section>

      {/* 台 register */}
      <section className="sg-section sg-stage-section" data-theme="stage">
        <h2 className="t-h2 sg-label">台 stage · 暖夜 · 朱 + 金</h2>
        <p className="t-kai sg-stage-line">月光落在青石上,她没有回头,只把伞往你这边偏了偏。</p>
        <div className="sg-row">
          <Tag tone="scene">场景 · 雨夜长街</Tag>
          <Tag tone="relation">关系 · 微妙</Tag>
          <span className="t-mono sg-stage-meta">token 1,280 / 8k</span>
        </div>
        <div className="sg-row">
          <Button variant="primary">继续</Button>
          <Button variant="secondary">存档</Button>
        </div>
        <div className="sg-chat">
          <ChatBubble side="received">我在这里等了你很久。</ChatBubble>
          <ChatBubble side="sent">这次我不会再走了。</ChatBubble>
        </div>
      </section>

      {/* 卡面改版预览(封面 + 白条)· 合成样例 */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">卡面改版 · 封面 + 下方白条(书名 / 作者)</h2>
        <p className="t-ui-sm sg-sub">书名从压在立绘上挪到下方白条:立绘干净、书名最多 2 行、作者弱化。含有封面 / 无封面(书脊底色)/ 长书名 / 无作者 四种。点卡仍可翻面。</p>
        <CardShelf
          models={DEMO_CARDS}
          actionsFor={(m) => ACTIONS[m.kind] || []}
          onOpen={(m) => alert("详情:" + m.title)}
        />
      </section>

      {/* 统一 Card · 各 kind 各一张(真数据) */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">统一 Card · shelf(点卡翻面 · 各 kind 真数据)</h2>
        <p className="t-ui-sm sg-sub">封面 → tap 翻转看简介 + 标签 → 背面操作 / 详情。一次只翻一张,点别处收(受控 flip,结案 YOR-47)。</p>
        {err && <p className="sg-err">{err}</p>}
        {!cards.length && !err && <p className="t-ui-sm sg-sub">载入真数据中…</p>}
        <CardShelf
          models={cards}
          actionsFor={(m) => ACTIONS[m.kind] || []}
          onOpen={(m) => alert("详情(复用 ReconStoryDetail,后续接):" + m.title)}
        />

        <h2 className="t-h2 sg-label">统一 Card · row / thumb 变体(不翻)</h2>
        <div className="sg-row sg-row--stack">
          {cards.map((m) => (
            <Card key={"row-" + m.kind} model={m} variant="row" actions={[{ label: "打开", variant: "line" }]} />
          ))}
        </div>
        <div className="sg-row">
          {cards.map((m) => (
            <Card key={"thumb-" + m.kind} model={m} variant="thumb" />
          ))}
        </div>
      </section>

      {/* React Bits Stepper · 暖夜配色 demo(评估用,未接创作流程) */}
      <section className="sg-section">
        <h2 className="t-h2 sg-label">Stepper · 分步向导(暖夜配色 demo)</h2>
        <p className="t-ui-sm sg-sub">React Bits Stepper,配色已换暖夜 token(朱砂进度 + 纸面板)。仅 demo 看效果,未接创作主流程。</p>
        <Stepper
          backButtonText="上一步"
          nextButtonText="下一步"
          completeText="发布"
          onFinalStepCompleted={() => setSgDone(true)}
          onStepChange={() => setSgDone(false)}
        >
          <Step>
            <h2>先选个主角</h2>
            <p>造一张角色卡当主角——聊几句,卡就长出来了。这一步是必需的。</p>
          </Step>
          <Step>
            <h2>给故事一个世界(可选)</h2>
            <p>想要世界观 / 设定就加一张设定卡;不想加,直接下一步也行。</p>
          </Step>
          <Step>
            <h2>起名,发布</h2>
            <p>给故事起个名字,就能发到探索让人玩。</p>
            <div style={{ marginTop: "var(--sp-3)" }}>
              <Input value={sgName} onChange={(e) => setSgName(e.target.value)} placeholder="故事名…" />
            </div>
          </Step>
        </Stepper>
        {sgDone && (
          <p className="t-ui sg-sub" style={{ marginTop: "var(--sp-3)", color: "var(--accent)" }}>
            走到「发布」了{sgName ? " ·《" + sgName + "》" : ""}(demo,未真发布)
          </p>
        )}
      </section>

      <p className="sg-foot t-meta">沐言设计系统 v0 · YOR-92 · frontend-next</p>
    </div>
  );
}
