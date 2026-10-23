// 创作模板库(D3)——从 card-templates/*.md(内容侧,作者:太妃月/Toffeemoon)提炼的骨架常量。
// ⚠ 文案归内容侧:改模板措辞只改本文件,不碰 Create.jsx 逻辑。来源逐套标注。
// ⚠ skeleton 键名铁律:必须 ∈ 对应后端模型字段(src/models.py 的
//   CharacterData / PlayerCard / StoryBook),否则 /api/build_card 回包会被
//   _validate_build_draft 按 model_fields 过滤静默丢键。
// 形态:skeleton 的空串字段 = 画布上的 ✦ 补写目标;数组字段给 [](走「聊」);
//      hints[k] = 该字段的引导占位文案;opener 只进输入框不代发(沿用起手句哲学)。
//      skeleton: null = 纯 opener 模板(世界书这类条目型卡)。

export const TEMPLATES = {
  characters: [
    {
      // 来源:card-templates/角色卡 母版.md + 主要NPC 模板.md(次要NPC 已于 2026-06-08 取消,收进设定卡)
      id: "npc-main",
      name: "Main NPC",
      hint: "Fully fleshed out: anchor / tension / speech rules, the full set",
      skeleton: {
        name: "", anchor: "", tension: "", look: "",
        description: "", personality: "", first_mes: "", scenario: "", mes_example: "",
        speech_rules: [], keys: [], known_public: [], known_hidden: [],
      },
      hints: {
        anchor: "In one sentence: who this character is, what they are to the player, and what they're like at their core",
        tension: "The inner tension that shouldn't be smoothed over. Contradiction is the heart of a personality, not a bug",
        look: "A one-line visual impression + signature features, for AI descriptions and image generation",
        description: "Identity: who they are, where they come from, their current situation. One paragraph",
        personality: "Core personality, behavioral tendencies, values. One paragraph",
        first_mes: "The character's first line / scene when they appear, setting their voice and the situation",
        scenario: "How they meet the player: where, and what's going on",
        mes_example: "One or two example exchanges showing how they talk",
        speech_rules: "How they refer to themselves / address the player / sentence length and rhythm / go-to phrasings / catchphrases / words to avoid",
        keys: "Recall keywords: signature proper nouns, not generic words",
        known_public: "Public facts: things anyone can see",
        known_hidden: "Hidden truth: the AI knows it but won't reveal it by default (invisible to the player)",
      },
      opener: "I want to build a card from the \"Main NPC\" skeleton. First ask me the one or two most important questions (who this character is and how they relate to the player), then help me fill in anchor / tension / look, and we'll go through the rest piece by piece.",
    },
    {
      // 来源:card-templates/隐藏角色卡 模板.md(隐藏=注入给 AI+玩家不可见+触发才登场;防剧透靠输出克制)
      id: "npc-hidden",
      name: "Hidden Character",
      hint: "Undercurrent / unlocks on a condition: entry trigger + hidden truth",
      skeleton: {
        name: "", anchor: "", look: "",
        description: "", personality: "", first_mes: "", scenario: "",
        speech_rules: [], keys: [], known_public: [], known_hidden: [],
      },
      hints: {
        anchor: "What it is, what it means to the plot, and its core nature in one line (hidden from the player by default)",
        look: "What it looks like when it reveals itself, in a sentence or two",
        description: "True identity and origins. The AI has to know everything to plant the foreshadowing; spoilers are avoided through restraint in the output",
        personality: "Its personality and how it acts (once it appears, it's still a character to be played)",
        first_mes: "Its entrance line / scene the moment it's triggered",
        scenario: "Appearance rules: default state (lurking / locked) + entry trigger (story progress / player action / marker object). Spell out exactly when and how it shows up",
        keys: "Entry trigger words / marker objects: when the player mentions one, it should be recalled",
        known_hidden: "Hidden truth: the answer that stays secret until the end, revealed layer by layer",
      },
      opener: "I want to build a \"Hidden Character\" card (it doesn't appear by default, only when triggered). First ask me about its true identity and its entry trigger, then help me fill in anchor / appearance rules (scenario) / hidden truth (known_hidden).",
    },
  ],
  players: [
    {
      // P3 轻装版:三分钟能填完的最小主角卡(身份/目标/开场),够开一局;要细再换标准套
      id: "player-lite",
      name: "Travel Light",
      hint: "Three fields and you're ready to play: identity / goals / opening",
      skeleton: { name: "", role: "", goals: [], opening: "" },
      hints: {
        role: "In one line: who you're playing this time, and in what role",
        goals: "What you want to achieve this time, 1-3 items",
        opening: "Act One: where you enter the story and what you see",
      },
      opener: "Quick lead build: tell me who you want to play and what you're after this time. A sentence or two is enough.",
    },
    {
      // 来源:card-templates/演出卡 模板.md(玩家视角操作面:我是谁/要什么/能干什么/开局知道什么)
      id: "player-std",
      name: "Player Card · Standard",
      hint: "The lead the player plays: goals / abilities / what they know",
      skeleton: {
        name: "", role: "", background: "", opening: "",
        goals: [], abilities: [], constraints: [], known_facts: [], unknown: [],
      },
      hints: {
        role: "In one line: who the player plays this time, and their status or role",
        background: "Background, situation, connection to the main plot. Only what the player knows at the start",
        opening: "Act One: where the player enters the story and what they see",
        goals: "What the player wants to achieve as this character, 2-4 items",
        abilities: "What they can do and what they have on hand. Gives the player something to act with",
        constraints: "What they can't or mustn't do: limits of their power, constraints of their role, rules and taboos",
        known_facts: "Known at the start: where the player's knowledge ends",
        unknown: "Unknown at the start: main-plot twists / hidden truths. Paired with what's known, so the player doesn't get a god's-eye view",
      },
      opener: "Build a card from the \"Player Card\" skeleton: first ask me who the lead is and what they want this time. Then we'll go through abilities / limits / what they do and don't know at the start, piece by piece.",
    },
  ],
  worlds: [
    {
      // P1b 新建即骨架:三条起手条目对齐完整度维度(一句话定义/铁则/核心地点)与「≥3 条」收尾标准。
      // WorldEntry 键名 ∈ src/models.py:comment(标题)/keys(触发词)/content(内容)。
      id: "world-starter",
      name: "Standard Start · 3 Entries",
      hint: "A one-line definition / an iron rule / a key location. Grow from these three",
      skeleton: {
        name: "",
        entries: [
          { comment: "A one-line definition of this world", keys: [], content: "" },
          { comment: "An iron rule of the world", keys: [], content: "" },
          { comment: "A key location", keys: [], content: "" },
        ],
      },
      hints: {
        name: "World name",
        entries: "Each entry = title + trigger words (keys) + content. An entry is only fed to the AI when the player mentions one of its trigger words, so an entry with no trigger words will never come up",
      },
      opener: "Flesh out the three starter entries: a one-line definition of the world, an iron rule, and a key location. Give each one keys (trigger words).",
    },
    {
      // P3 示例样板:三条已填好的条目当参照物——每条示范 keys 该长什么样,直接改成自己的
      id: "world-fantasy",
      name: "Fantasy Rules · With Examples",
      hint: "Three filled-in sample entries. Rework them into your own world",
      skeleton: {
        name: "",
        entries: [
          { comment: "Ley Lines", keys: ["ley line", "spirit energy", "cultivation"], content: "Ley lines run beneath the earth. Anyone close to one cultivates twice as fast; where a ley line runs dry, magic stops working." },
          { comment: "The Price of Forbidden Spells", keys: ["forbidden spell", "price", "backlash"], content: "Every forbidden spell is paid for in years of life, and the caster decides how many to wager. Wager wrong, and there are no refunds." },
          { comment: "White Tower City", keys: ["White Tower", "royal city", "Council"], content: "The continent's only neutral city and seat of the Mages' Council. All offensive magic is banned inside its walls; anyone who breaks the ban is stripped of their power on the spot." },
        ],
      },
      hints: {
        name: "World name",
        entries: "Rework the sample entries into your own lore. keys = trigger words that bring the entry in when the player mentions them",
      },
      opener: "Replace these three sample entries with this world's own lore. Let's start with its most central rule.",
    },
    {
      id: "world-urban",
      name: "Modern City · With Examples",
      hint: "Three sample entries with an urban-legend bent",
      skeleton: {
        name: "",
        entries: [
          { comment: "The Last Train", keys: ["subway", "last train", "eleven o'clock"], content: "After eleven, the last subway train makes one extra stop, and nobody can make out its name over the speakers. Whoever gets off there can't remember the next day where they went." },
          { comment: "The Unseen Population", keys: ["missing", "registry", "list"], content: "Every year a fixed number of people vanish from this city, and the police list never matches the residents' registry. The difference is never made public." },
          { comment: "The Redevelopment Office", keys: ["Redevelopment Office", "demolition", "red seal"], content: "A demolition order with the red seal can bring down any building, including the ones that shouldn't exist. Nobody at the Redevelopment Office ever works past eleven." },
        ],
      },
      hints: {
        name: "World name",
        entries: "Rework the sample entries into your own lore. keys = trigger words that bring the entry in when the player mentions them",
      },
      opener: "Swap these three samples for your own urban legend. What's the one thing that's most wrong with this city?",
    },
    {
      // 来源:card-templates/世界书 模板.md(条目式:关键词触发注入;draft=entries 数组,骨架预填无意义 → 纯 opener)
      id: "world-std",
      name: "World Book · Entries",
      hint: "Start from three core entries and grow it one entry at a time",
      skeleton: null,
      hints: {},
      opener: "Help me scaffold a World Book entry by entry: start by asking me about three entries, \"a one-line definition of this world\", \"an iron rule of the world\" and \"a key location\". Take them one at a time, and give each one keys (trigger words) and content.",
    },
  ],
  stories: [
    {
      // P1b 新建即骨架:引擎真消费的四块(title/premise 常驻 prompt,main_plot/timeline 进故事书总览)。
      id: "story-starter",
      name: "Standard Start",
      hint: "Title / premise / main plot stages / timeline. The engine moves the story along these",
      skeleton: { title: "", premise: "", main_plot: [], timeline: [], events: [] },
      hints: {
        title: "Script name + a one-line genre tone (light mystery / business negotiation / epic tragedy…)",
        premise: "The opening situation: who is where, what has happened, and why the player gets involved",
        main_plot: "Main plot stages: one item = one stage, 2-4 items",
        timeline: "Timeline points: what happens in what order, one event per item",
        events: "Beats: story units that move forward when the player mentions a trigger word",
      },
      opener: "Standard skeleton: settle the title and premise first, then lay out 2-4 main plot stages.",
    },
    {
      // P3 单幕短局:一场戏打完——前提 + 三个节拍;结局方向进 main_plot 末条(结局结构留 AI 补)
      id: "story-oneact",
      name: "One-Act Short",
      hint: "A single scene: premise + three beats, playable in one evening",
      skeleton: {
        title: "",
        premise: "",
        main_plot: [],
        timeline: [],
        events: [
          { event_id: "beat-1", title: "Opening Hook", trigger_keywords: [], summary: "" },
          { event_id: "beat-2", title: "Midpoint Twist", trigger_keywords: [], summary: "" },
          { event_id: "beat-3", title: "Final Showdown", trigger_keywords: [], summary: "" },
        ],
      },
      hints: {
        title: "Script name + a one-line tone",
        premise: "The opening situation: who is where, what has happened, and why the player gets involved",
        main_plot: "One line of main plot + one line on where it ends. Two items is enough",
        timeline: "Can be left blank: beats are enough for a short",
        events: "Give each of the three beats trigger words and a summary. When the player mentions a trigger word, that beat moves forward",
      },
      opener: "One-act short: tell me the premise first, then we'll settle the trigger words and summary for each of the three beats (hook / twist / showdown).",
    },
    {
      id: "story-mystery",
      name: "Long Mystery",
      hint: "Layered reveals: four beats, one of them hidden",
      skeleton: {
        title: "",
        premise: "",
        main_plot: [],
        timeline: [],
        events: [
          { event_id: "act-1", title: "Drawn In", trigger_keywords: [], summary: "" },
          { event_id: "act-2", title: "The First Truth", trigger_keywords: [], summary: "" },
          { event_id: "act-3", title: "The Twist", trigger_keywords: [], summary: "", hidden: true },
          { event_id: "act-4", title: "Final Chapter", trigger_keywords: [], summary: "" },
        ],
      },
      hints: {
        title: "Script name + a one-line tone (mystery)",
        premise: "Show only the surface situation at the start. The real tension doesn't go here",
        main_plot: "2-4 main plot stages. The core mystery is revealed in layers and never given away at the start",
        timeline: "The true timeline of the crime or events (the player doesn't see it directly)",
        events: "\"The Twist\" is a hidden beat: the engine knows it but reveals it in layers. Give each beat trigger words",
      },
      opener: "Long mystery: first tell me what seems to have happened and what actually happened. The gap between the two is the heart of this story.",
    },
    {
      // 来源:card-templates/故事书 模板.md(剧情层:前提/核心冲突/悬疑按层揭示,绝不开局交底)
      id: "story-std",
      name: "Story Book · Standard",
      hint: "Start from the premise / core conflict, then lay out the timeline",
      skeleton: { title: "", premise: "" },
      hints: {
        title: "Script name + a one-line genre tone (light mystery / business negotiation / epic tragedy…)",
        premise: "The opening situation: who is where, what has happened, and why the player gets involved. The real tension often isn't the one on the surface",
      },
      opener: "Build this story from the \"Story Book\" skeleton: first ask me about the premise and the core conflict, then lay out the timeline and main_plot. The core mystery is revealed in layers and never given away at the start.",
    },
  ],
};

export function getTpl(kind, id) {
  if (!id) return null;
  return (TEMPLATES[kind] || []).find((t) => t.id === id) || null;
}

// P1b 新建即骨架:直接新建(不走模板选择器)时按 kind 静默铺的起手骨架 id。
// 角色卡/演出卡复用既有标准套;世界书/故事书用上面的 starter。
export const STARTER_IDS = {
  characters: "npc-main",
  players: "player-std",
  worlds: "world-starter",
  stories: "story-starter",
};
