// 创作模板库(D3)——从 card-templates/*.md(内容侧,作者:太妃月/Toffeemoon)提炼的骨架常量。
// ⚠ 文案归内容侧:改模板措辞只改本文件,不碰 Create.jsx 逻辑。来源逐套标注。
// ⚠ skeleton 键名铁律:必须 ∈ 对应后端模型字段(src/models.py 的
//   CharacterData / PlayerCard / StoryBook),否则 /api/build_card 回包会被
//   _validate_build_draft 按 model_fields 过滤静默丢键。
// 形态:skeleton 的空串字段 = 画布上的 ✦ 补写目标;数组字段给 [](走「聊」);
//      hints[k] = 该字段的引导占位文案;opener 只进输入框不代发(沿用起手句哲学)。
//      skeleton: null = 纯 opener 模板(世界书这类条目型卡)。

import { L } from "../lib/i18n";

export const TEMPLATES = {
  characters: [
    {
      // 来源:card-templates/角色卡 母版.md + 主要NPC 模板.md(次要NPC 已于 2026-06-08 取消,收进设定卡)
      id: "npc-main",
      name: L("Main NPC", "主要NPC"),
      hint: L("Fully fleshed out: anchor / tension / speech rules, the full set", "完整立体:锚点 / 矛盾 / 说话规则全套"),
      skeleton: {
        name: "", anchor: "", tension: "", look: "",
        description: "", personality: "", first_mes: "", scenario: "", mes_example: "",
        speech_rules: [], keys: [], known_public: [], known_hidden: [],
      },
      hints: {
        anchor: L("In one sentence: who this character is, what they are to the player, and what they're like at their core", "一句话说清:这角色是谁、对玩家是什么、底色是什么"),
        tension: L("The inner tension that shouldn't be smoothed over. Contradiction is the heart of a personality, not a bug", "角色身上不要被抹平的内在张力——矛盾是人格核心,不是 bug"),
        look: L("A one-line visual impression + signature features, for AI descriptions and image generation", "一句话视觉印象 + 标志特征,供 AI 描写与图像生成"),
        description: L("Identity: who they are, where they come from, their current situation. One paragraph", "身份:角色是谁、来历、当前处境,一段"),
        personality: L("Core personality, behavioral tendencies, values. One paragraph", "核心性格、行为倾向、价值取向,一段"),
        first_mes: L("The character's first line / scene when they appear, setting their voice and the situation", "角色登场的第一段台词 / 场景,定调 voice 与情境"),
        scenario: L("How they meet the player: where, and what's going on", "与玩家相遇的情境:在哪、什么局面"),
        mes_example: L("One or two example exchanges showing how they talk", "一两轮示例对话,示范他说话的样子"),
        speech_rules: L("How they refer to themselves / address the player / sentence length and rhythm / go-to phrasings / catchphrases / words to avoid", "自称 / 称呼玩家 / 句长节奏 / 高频句式 / 口头禅 / 禁用"),
        keys: L("Recall keywords: signature proper nouns, not generic words", "召回关键词:标志性专有名词,别填泛词"),
        known_public: L("Public facts: things anyone can see", "公开设定:谁都看得到的事"),
        known_hidden: L("Hidden truth: the AI knows it but won't reveal it by default (invisible to the player)", "隐藏真相:AI 知道但默认不说破(玩家不可见)"),
      },
      opener: L("I want to build a card from the \"Main NPC\" skeleton. First ask me the one or two most important questions (who this character is and how they relate to the player), then help me fill in anchor / tension / look, and we'll go through the rest piece by piece.", "我要按「主要NPC」骨架建卡:先问我最关键的一两个问题(这角色是谁、和玩家什么关系),然后帮我把 anchor / tension / look 填出来,其余我们逐块聊。"),
    },
    {
      // 来源:card-templates/隐藏角色卡 模板.md(隐藏=注入给 AI+玩家不可见+触发才登场;防剧透靠输出克制)
      id: "npc-hidden",
      name: L("Hidden Character", "隐藏角色"),
      hint: L("Undercurrent / unlocks on a condition: entry trigger + hidden truth", "暗线 / 条件解锁:出场触发 + 隐藏真相"),
      skeleton: {
        name: "", anchor: "", look: "",
        description: "", personality: "", first_mes: "", scenario: "",
        speech_rules: [], keys: [], known_public: [], known_hidden: [],
      },
      hints: {
        anchor: L("What it is, what it means to the plot, and its core nature in one line (hidden from the player by default)", "它是什么、对剧情是什么、底色一句(玩家界面默认不可见)"),
        look: L("What it looks like when it reveals itself, in a sentence or two", "现身时的视觉形象,一两句"),
        description: L("True identity and origins. The AI has to know everything to plant the foreshadowing; spoilers are avoided through restraint in the output", "真身与来历——AI 全知才演得出伏笔,防剧透靠输出克制"),
        personality: L("Its personality and how it acts (once it appears, it's still a character to be played)", "它的性格与行事倾向(登场时仍是要演的角色)"),
        first_mes: L("Its entrance line / scene the moment it's triggered", "触发现身那一刻的登场台词 / 画面"),
        scenario: L("Appearance rules: default state (lurking / locked) + entry trigger (story progress / player action / marker object). Spell out exactly when and how it shows up", "出场性:默认状态(潜伏 / 锁定)+ 出场触发(剧情进度 / 玩家行为 / 标志物),写死何时怎么现身"),
        keys: L("Entry trigger words / marker objects: when the player mentions one, it should be recalled", "出场触发词 / 标志物——玩家提到就该被召回"),
        known_hidden: L("Hidden truth: the answer that stays secret until the end, revealed layer by layer", "隐藏真相:终局前不揭的谜底,按层披露"),
      },
      opener: L("I want to build a \"Hidden Character\" card (it doesn't appear by default, only when triggered). First ask me about its true identity and its entry trigger, then help me fill in anchor / appearance rules (scenario) / hidden truth (known_hidden).", "我要建一张「隐藏角色」卡(默认不登场,触发才现身):先问我它的真身和出场触发,然后帮我把 anchor / 出场性(scenario)/ 隐藏真相(known_hidden)填出来。"),
    },
  ],
  players: [
    {
      // P3 轻装版:三分钟能填完的最小主角卡(身份/目标/开场),够开一局;要细再换标准套
      id: "player-lite",
      name: L("Travel Light", "轻装上阵"),
      hint: L("Three fields and you're ready to play: identity / goals / opening", "三个字段就能开局:身份 / 目标 / 开场"),
      skeleton: { name: "", role: "", goals: [], opening: "" },
      hints: {
        role: L("In one line: who you're playing this time, and in what role", "一句话:这局你扮演谁、什么身份"),
        goals: L("What you want to achieve this time, 1-3 items", "这局想达成什么,1-3 条"),
        opening: L("Act One: where you enter the story and what you see", "开局第一幕:你从哪里入局、看到什么"),
      },
      opener: L("Quick lead build: tell me who you want to play and what you're after this time. A sentence or two is enough.", "轻装建主角:告诉我你想演谁、这局想要什么,一两句就够。"),
    },
    {
      // 来源:card-templates/演出卡 模板.md(玩家视角操作面:我是谁/要什么/能干什么/开局知道什么)
      id: "player-std",
      name: L("Player Card · Standard", "演出卡 · 标准"),
      hint: L("The lead the player plays: goals / abilities / what they know", "玩家扮演的主角:目标 / 能力 / 信息边界"),
      skeleton: {
        name: "", role: "", background: "", opening: "",
        goals: [], abilities: [], constraints: [], known_facts: [], unknown: [],
      },
      hints: {
        role: L("In one line: who the player plays this time, and their status or role", "一句话:玩家这局扮演谁、什么身份地位"),
        background: L("Background, situation, connection to the main plot. Only what the player knows at the start", "来历、处境、与主线的关系——只写玩家开局认知范围内的"),
        opening: L("Act One: where the player enters the story and what they see", "开局第一幕:玩家从哪里入局、看到什么"),
        goals: L("What the player wants to achieve as this character, 2-4 items", "玩家代入这个角色想达成什么,2-4 条"),
        abilities: L("What they can do and what they have on hand. Gives the player something to act with", "能做什么、手里有什么——给玩家行动的抓手"),
        constraints: L("What they can't or mustn't do: limits of their power, constraints of their role, rules and taboos", "做不到 / 不能做什么:实力上限、身份约束、规则禁忌"),
        known_facts: L("Known at the start: where the player's knowledge ends", "开局已知:玩家侧的信息边界"),
        unknown: L("Unknown at the start: main-plot twists / hidden truths. Paired with what's known, so the player doesn't get a god's-eye view", "开局不知道:主线反转 / 元真相,与已知配对防上帝视角"),
      },
      opener: L("Build a card from the \"Player Card\" skeleton: first ask me who the lead is and what they want this time. Then we'll go through abilities / limits / what they do and don't know at the start, piece by piece.", "按「演出卡」骨架建卡:先问我主角是谁、这一局想要什么;能力 / 限制 / 开局已知与不知道,我们逐块聊。"),
    },
  ],
  worlds: [
    {
      // P1b 新建即骨架:三条起手条目对齐完整度维度(一句话定义/铁则/核心地点)与「≥3 条」收尾标准。
      // WorldEntry 键名 ∈ src/models.py:comment(标题)/keys(触发词)/content(内容)。
      id: "world-starter",
      name: L("Standard Start · 3 Entries", "标准起手 · 三条目"),
      hint: L("A one-line definition / an iron rule / a key location. Grow from these three", "一句话定义 / 一条铁则 / 一个核心地点,从三条长起"),
      skeleton: {
        name: "",
        entries: [
          { comment: L("A one-line definition of this world", "这个世界的一句话定义"), keys: [], content: "" },
          { comment: L("An iron rule of the world", "一条世界铁则"), keys: [], content: "" },
          { comment: L("A key location", "一个核心地点"), keys: [], content: "" },
        ],
      },
      hints: {
        name: L("World name", "世界名"),
        entries: L("Each entry = title + trigger words (keys) + content. An entry is only fed to the AI when the player mentions one of its trigger words, so an entry with no trigger words will never come up", "每条=标题+触发词(keys)+内容;玩家聊到触发词,这条才注入给 AI——没有触发词的条目永远不会出场"),
      },
      opener: L("Flesh out the three starter entries: a one-line definition of the world, an iron rule, and a key location. Give each one keys (trigger words).", "把三条起手条目填实:一句话世界定义、一条铁则、一个核心地点;每条配上 keys(触发词)。"),
    },
    {
      // P3 示例样板:三条已填好的条目当参照物——每条示范 keys 该长什么样,直接改成自己的
      id: "world-fantasy",
      name: L("Fantasy Rules · With Examples", "奇幻规则 · 带示例"),
      hint: L("Three filled-in sample entries. Rework them into your own world", "三条填好的示例条目,照着改成你的世界"),
      skeleton: {
        name: "",
        entries: [
          { comment: L("Ley Lines", "灵脉"), keys: [L("ley line", "灵脉"), L("spirit energy", "灵气"), L("cultivation", "修行")], content: L("Ley lines run beneath the earth. Anyone close to one cultivates twice as fast; where a ley line runs dry, magic stops working.", "大地之下有灵脉,靠近的人修行事半功倍;灵脉枯竭的地方,法术会失灵。") },
          { comment: L("The Price of Forbidden Spells", "禁咒的代价"), keys: [L("forbidden spell", "禁咒"), L("price", "代价"), L("backlash", "反噬")], content: L("Every forbidden spell is paid for in years of life, and the caster decides how many to wager. Wager wrong, and there are no refunds.", "任何禁咒都要拿寿命换,施术者自己决定押多少年;押错了不退。") },
          { comment: L("White Tower City", "白塔城"), keys: [L("White Tower", "白塔"), L("royal city", "王城"), L("Council", "议会")], content: L("The continent's only neutral city and seat of the Mages' Council. All offensive magic is banned inside its walls; anyone who breaks the ban is stripped of their power on the spot.", "大陆唯一的中立城,法师议会驻地;城内禁止一切攻击法术,违者当场剥夺法力。") },
        ],
      },
      hints: {
        name: L("World name", "世界名"),
        entries: L("Rework the sample entries into your own lore. keys = trigger words that bring the entry in when the player mentions them", "示例条目直接改成你的设定;keys=玩家聊到就注入的触发词"),
      },
      opener: L("Replace these three sample entries with this world's own lore. Let's start with its most central rule.", "这三条示例条目替我换成这个世界自己的设定:先从最核心的一条规则开始。"),
    },
    {
      id: "world-urban",
      name: L("Modern City · With Examples", "现代都市 · 带示例"),
      hint: L("Three sample entries with an urban-legend bent", "都市怪谈向的三条示例条目"),
      skeleton: {
        name: "",
        entries: [
          { comment: L("The Last Train", "末班地铁"), keys: [L("subway", "地铁"), L("last train", "末班车"), L("eleven o'clock", "十一点")], content: L("After eleven, the last subway train makes one extra stop, and nobody can make out its name over the speakers. Whoever gets off there can't remember the next day where they went.", "十一点后的末班地铁多出一站,报站名没人听得清;在那一站下车的人,第二天记不起自己去过哪。") },
          { comment: L("The Unseen Population", "看不见的人口"), keys: [L("missing", "失踪"), L("registry", "户籍"), L("list", "名单")], content: L("Every year a fixed number of people vanish from this city, and the police list never matches the residents' registry. The difference is never made public.", "这座城每年有固定数目的人消失,警方名单和户籍对不上;差额从不公布。") },
          { comment: L("The Redevelopment Office", "旧城改造办"), keys: [L("Redevelopment Office", "改造办"), L("demolition", "拆迁"), L("red seal", "红章")], content: L("A demolition order with the red seal can bring down any building, including the ones that shouldn't exist. Nobody at the Redevelopment Office ever works past eleven.", "盖红章的拆迁令能拆掉任何建筑,包括不该存在的那些;改造办的人从不加班到十一点以后。") },
        ],
      },
      hints: {
        name: L("World name", "世界名"),
        entries: L("Rework the sample entries into your own lore. keys = trigger words that bring the entry in when the player mentions them", "示例条目直接改成你的设定;keys=玩家聊到就注入的触发词"),
      },
      opener: L("Swap these three samples for your own urban legend. What's the one thing that's most wrong with this city?", "把这三条示例换成你的都市怪谈:这座城最不对劲的一件事是什么?"),
    },
    {
      // 来源:card-templates/世界书 模板.md(条目式:关键词触发注入;draft=entries 数组,骨架预填无意义 → 纯 opener)
      id: "world-std",
      name: L("World Book · Entries", "世界书 · 条目式"),
      hint: L("Start from three core entries and grow it one entry at a time", "从三条核心条目起手,一条条长"),
      skeleton: null,
      hints: {},
      opener: L("Help me scaffold a World Book entry by entry: start by asking me about three entries, \"a one-line definition of this world\", \"an iron rule of the world\" and \"a key location\". Take them one at a time, and give each one keys (trigger words) and content.", "帮我按世界书条目搭骨架:先从「这个世界的一句话定义」「一条世界铁则」「一个核心地点」三个条目问起,一条条来,每条给 keys(触发词)和 content。"),
    },
  ],
  stories: [
    {
      // P1b 新建即骨架:引擎真消费的四块(title/premise 常驻 prompt,main_plot/timeline 进故事书总览)。
      id: "story-starter",
      name: L("Standard Start", "标准起手"),
      hint: L("Title / premise / main plot stages / timeline. The engine moves the story along these", "标题 / 前提 / 主线阶段 / 时间线,引擎按它推进"),
      skeleton: { title: "", premise: "", main_plot: [], timeline: [], events: [] },
      hints: {
        title: L("Script name + a one-line genre tone (light mystery / business negotiation / epic tragedy…)", "剧本名 + 一句话类型定调(轻悬疑 / 商业谈判 / 史诗悲剧…)"),
        premise: L("The opening situation: who is where, what has happened, and why the player gets involved", "开场局面:谁在哪、出了什么事、玩家为何介入"),
        main_plot: L("Main plot stages: one item = one stage, 2-4 items", "主线阶段:一条=一个阶段,2-4 条"),
        timeline: L("Timeline points: what happens in what order, one event per item", "时间线节点:先后发生什么,一条一件事"),
        events: L("Beats: story units that move forward when the player mentions a trigger word", "节拍:玩家聊到触发词就被推进的剧情单元"),
      },
      opener: L("Standard skeleton: settle the title and premise first, then lay out 2-4 main plot stages.", "按标准骨架:先定题目和前提,再铺 2-4 条主线阶段。"),
    },
    {
      // P3 单幕短局:一场戏打完——前提 + 三个节拍;结局方向进 main_plot 末条(结局结构留 AI 补)
      id: "story-oneact",
      name: L("One-Act Short", "单幕短局"),
      hint: L("A single scene: premise + three beats, playable in one evening", "一场戏:前提 + 三个节拍,当晚就能玩完"),
      skeleton: {
        title: "",
        premise: "",
        main_plot: [],
        timeline: [],
        events: [
          { event_id: "beat-1", title: L("Opening Hook", "开场引子"), trigger_keywords: [], summary: "" },
          { event_id: "beat-2", title: L("Midpoint Twist", "中段变数"), trigger_keywords: [], summary: "" },
          { event_id: "beat-3", title: L("Final Showdown", "终局摊牌"), trigger_keywords: [], summary: "" },
        ],
      },
      hints: {
        title: L("Script name + a one-line tone", "剧本名 + 一句话定调"),
        premise: L("The opening situation: who is where, what has happened, and why the player gets involved", "开场局面:谁在哪、出了什么事、玩家为何介入"),
        main_plot: L("One line of main plot + one line on where it ends. Two items is enough", "主线一句话 + 结局方向一句话,两条够"),
        timeline: L("Can be left blank: beats are enough for a short", "可留空:短局用节拍就够"),
        events: L("Give each of the three beats trigger words and a summary. When the player mentions a trigger word, that beat moves forward", "三个节拍各配触发词和梗概:玩家聊到触发词,节拍被推进"),
      },
      opener: L("One-act short: tell me the premise first, then we'll settle the trigger words and summary for each of the three beats (hook / twist / showdown).", "单幕短局:先说前提,然后我们把三个节拍(引子/变数/摊牌)各自的触发词和梗概定下来。"),
    },
    {
      id: "story-mystery",
      name: L("Long Mystery", "悬疑长局"),
      hint: L("Layered reveals: four beats, one of them hidden", "分层揭示:四个节拍,其中一拍是暗节拍"),
      skeleton: {
        title: "",
        premise: "",
        main_plot: [],
        timeline: [],
        events: [
          { event_id: "act-1", title: L("Drawn In", "入局"), trigger_keywords: [], summary: "" },
          { event_id: "act-2", title: L("The First Truth", "第一层真相"), trigger_keywords: [], summary: "" },
          { event_id: "act-3", title: L("The Twist", "反转"), trigger_keywords: [], summary: "", hidden: true },
          { event_id: "act-4", title: L("Final Chapter", "终章"), trigger_keywords: [], summary: "" },
        ],
      },
      hints: {
        title: L("Script name + a one-line tone (mystery)", "剧本名 + 一句话定调(悬疑向)"),
        premise: L("Show only the surface situation at the start. The real tension doesn't go here", "开场只给表面局面:真正的张力不写在这里"),
        main_plot: L("2-4 main plot stages. The core mystery is revealed in layers and never given away at the start", "主线阶段 2-4 条;核心悬疑按层揭示,绝不开局交底"),
        timeline: L("The true timeline of the crime or events (the player doesn't see it directly)", "案发/事件的真实时间线(玩家不直接看到)"),
        events: L("\"The Twist\" is a hidden beat: the engine knows it but reveals it in layers. Give each beat trigger words", "「反转」是暗节拍:引擎知道但按层揭示;每拍配触发词"),
      },
      opener: L("Long mystery: first tell me what seems to have happened and what actually happened. The gap between the two is the heart of this story.", "悬疑长局:先告诉我表面上发生了什么、实际上发生了什么——两者的差就是这局的核心。"),
    },
    {
      // 来源:card-templates/故事书 模板.md(剧情层:前提/核心冲突/悬疑按层揭示,绝不开局交底)
      id: "story-std",
      name: L("Story Book · Standard", "故事书 · 标准"),
      hint: L("Start from the premise / core conflict, then lay out the timeline", "前提 / 核心冲突起手,再铺时间线"),
      skeleton: { title: "", premise: "" },
      hints: {
        title: L("Script name + a one-line genre tone (light mystery / business negotiation / epic tragedy…)", "剧本名 + 一句话类型定调(轻悬疑 / 商业谈判 / 史诗悲剧…)"),
        premise: L("The opening situation: who is where, what has happened, and why the player gets involved. The real tension often isn't the one on the surface", "开场局面:谁在哪、出了什么事、玩家为何介入;真正的张力常不是表面那个"),
      },
      opener: L("Build this story from the \"Story Book\" skeleton: first ask me about the premise and the core conflict, then lay out the timeline and main_plot. The core mystery is revealed in layers and never given away at the start.", "按「故事书」骨架搭这一局:先问我前提与核心冲突,再铺 timeline 和 main_plot;核心悬疑按层揭示,绝不开局交底。"),
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
