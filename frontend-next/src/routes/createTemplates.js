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
      name: "主要NPC",
      hint: "完整立体:锚点 / 矛盾 / 说话规则全套",
      skeleton: {
        name: "", anchor: "", tension: "", look: "",
        description: "", personality: "", first_mes: "", scenario: "", mes_example: "",
        speech_rules: [], keys: [], known_public: [], known_hidden: [],
      },
      hints: {
        anchor: "一句话说清:这角色是谁、对玩家是什么、底色是什么",
        tension: "角色身上不要被抹平的内在张力——矛盾是人格核心,不是 bug",
        look: "一句话视觉印象 + 标志特征,供 AI 描写与图像生成",
        description: "身份:角色是谁、来历、当前处境,一段",
        personality: "核心性格、行为倾向、价值取向,一段",
        first_mes: "角色登场的第一段台词 / 场景,定调 voice 与情境",
        scenario: "与玩家相遇的情境:在哪、什么局面",
        mes_example: "一两轮示例对话,示范他说话的样子",
        speech_rules: "自称 / 称呼玩家 / 句长节奏 / 高频句式 / 口头禅 / 禁用",
        keys: "召回关键词:标志性专有名词,别填泛词",
        known_public: "公开设定:谁都看得到的事",
        known_hidden: "隐藏真相:AI 知道但默认不说破(玩家不可见)",
      },
      opener: "我要按「主要NPC」骨架建卡:先问我最关键的一两个问题(这角色是谁、和玩家什么关系),然后帮我把 anchor / tension / look 填出来,其余我们逐块聊。",
    },
    {
      // 来源:card-templates/隐藏角色卡 模板.md(隐藏=注入给 AI+玩家不可见+触发才登场;防剧透靠输出克制)
      id: "npc-hidden",
      name: "隐藏角色",
      hint: "暗线 / 条件解锁:出场触发 + 隐藏真相",
      skeleton: {
        name: "", anchor: "", look: "",
        description: "", personality: "", first_mes: "", scenario: "",
        speech_rules: [], keys: [], known_public: [], known_hidden: [],
      },
      hints: {
        anchor: "它是什么、对剧情是什么、底色一句(玩家界面默认不可见)",
        look: "现身时的视觉形象,一两句",
        description: "真身与来历——AI 全知才演得出伏笔,防剧透靠输出克制",
        personality: "它的性格与行事倾向(登场时仍是要演的角色)",
        first_mes: "触发现身那一刻的登场台词 / 画面",
        scenario: "出场性:默认状态(潜伏 / 锁定)+ 出场触发(剧情进度 / 玩家行为 / 标志物),写死何时怎么现身",
        keys: "出场触发词 / 标志物——玩家提到就该被召回",
        known_hidden: "隐藏真相:终局前不揭的谜底,按层披露",
      },
      opener: "我要建一张「隐藏角色」卡(默认不登场,触发才现身):先问我它的真身和出场触发,然后帮我把 anchor / 出场性(scenario)/ 隐藏真相(known_hidden)填出来。",
    },
  ],
  players: [
    {
      // P3 轻装版:三分钟能填完的最小主角卡(身份/目标/开场),够开一局;要细再换标准套
      id: "player-lite",
      name: "轻装上阵",
      hint: "三个字段就能开局:身份 / 目标 / 开场",
      skeleton: { name: "", role: "", goals: [], opening: "" },
      hints: {
        role: "一句话:这局你扮演谁、什么身份",
        goals: "这局想达成什么,1-3 条",
        opening: "开局第一幕:你从哪里入局、看到什么",
      },
      opener: "轻装建主角:告诉我你想演谁、这局想要什么,一两句就够。",
    },
    {
      // 来源:card-templates/演出卡 模板.md(玩家视角操作面:我是谁/要什么/能干什么/开局知道什么)
      id: "player-std",
      name: "演出卡 · 标准",
      hint: "玩家扮演的主角:目标 / 能力 / 信息边界",
      skeleton: {
        name: "", role: "", background: "", opening: "",
        goals: [], abilities: [], constraints: [], known_facts: [], unknown: [],
      },
      hints: {
        role: "一句话:玩家这局扮演谁、什么身份地位",
        background: "来历、处境、与主线的关系——只写玩家开局认知范围内的",
        opening: "开局第一幕:玩家从哪里入局、看到什么",
        goals: "玩家代入这个角色想达成什么,2-4 条",
        abilities: "能做什么、手里有什么——给玩家行动的抓手",
        constraints: "做不到 / 不能做什么:实力上限、身份约束、规则禁忌",
        known_facts: "开局已知:玩家侧的信息边界",
        unknown: "开局不知道:主线反转 / 元真相,与已知配对防上帝视角",
      },
      opener: "按「演出卡」骨架建卡:先问我主角是谁、这一局想要什么;能力 / 限制 / 开局已知与不知道,我们逐块聊。",
    },
  ],
  worlds: [
    {
      // P1b 新建即骨架:三条起手条目对齐完整度维度(一句话定义/铁则/核心地点)与「≥3 条」收尾标准。
      // WorldEntry 键名 ∈ src/models.py:comment(标题)/keys(触发词)/content(内容)。
      id: "world-starter",
      name: "标准起手 · 三条目",
      hint: "一句话定义 / 一条铁则 / 一个核心地点,从三条长起",
      skeleton: {
        name: "",
        entries: [
          { comment: "这个世界的一句话定义", keys: [], content: "" },
          { comment: "一条世界铁则", keys: [], content: "" },
          { comment: "一个核心地点", keys: [], content: "" },
        ],
      },
      hints: {
        name: "世界名",
        entries: "每条=标题+触发词(keys)+内容;玩家聊到触发词,这条才注入给 AI——没有触发词的条目永远不会出场",
      },
      opener: "把三条起手条目填实:一句话世界定义、一条铁则、一个核心地点;每条配上 keys(触发词)。",
    },
    {
      // P3 示例样板:三条已填好的条目当参照物——每条示范 keys 该长什么样,直接改成自己的
      id: "world-fantasy",
      name: "奇幻规则 · 带示例",
      hint: "三条填好的示例条目,照着改成你的世界",
      skeleton: {
        name: "",
        entries: [
          { comment: "灵脉", keys: ["灵脉", "灵气", "修行"], content: "大地之下有灵脉,靠近的人修行事半功倍;灵脉枯竭的地方,法术会失灵。" },
          { comment: "禁咒的代价", keys: ["禁咒", "代价", "反噬"], content: "任何禁咒都要拿寿命换,施术者自己决定押多少年;押错了不退。" },
          { comment: "白塔城", keys: ["白塔", "王城", "议会"], content: "大陆唯一的中立城,法师议会驻地;城内禁止一切攻击法术,违者当场剥夺法力。" },
        ],
      },
      hints: {
        name: "世界名",
        entries: "示例条目直接改成你的设定;keys=玩家聊到就注入的触发词",
      },
      opener: "这三条示例条目替我换成这个世界自己的设定:先从最核心的一条规则开始。",
    },
    {
      id: "world-urban",
      name: "现代都市 · 带示例",
      hint: "都市怪谈向的三条示例条目",
      skeleton: {
        name: "",
        entries: [
          { comment: "末班地铁", keys: ["地铁", "末班车", "十一点"], content: "十一点后的末班地铁多出一站,报站名没人听得清;在那一站下车的人,第二天记不起自己去过哪。" },
          { comment: "看不见的人口", keys: ["失踪", "户籍", "名单"], content: "这座城每年有固定数目的人消失,警方名单和户籍对不上;差额从不公布。" },
          { comment: "旧城改造办", keys: ["改造办", "拆迁", "红章"], content: "盖红章的拆迁令能拆掉任何建筑,包括不该存在的那些;改造办的人从不加班到十一点以后。" },
        ],
      },
      hints: {
        name: "世界名",
        entries: "示例条目直接改成你的设定;keys=玩家聊到就注入的触发词",
      },
      opener: "把这三条示例换成你的都市怪谈:这座城最不对劲的一件事是什么?",
    },
    {
      // 来源:card-templates/世界书 模板.md(条目式:关键词触发注入;draft=entries 数组,骨架预填无意义 → 纯 opener)
      id: "world-std",
      name: "世界书 · 条目式",
      hint: "从三条核心条目起手,一条条长",
      skeleton: null,
      hints: {},
      opener: "帮我按世界书条目搭骨架:先从「这个世界的一句话定义」「一条世界铁则」「一个核心地点」三个条目问起,一条条来,每条给 keys(触发词)和 content。",
    },
  ],
  stories: [
    {
      // P1b 新建即骨架:引擎真消费的四块(title/premise 常驻 prompt,main_plot/timeline 进故事书总览)。
      id: "story-starter",
      name: "标准起手",
      hint: "标题 / 前提 / 主线阶段 / 时间线,引擎按它推进",
      skeleton: { title: "", premise: "", main_plot: [], timeline: [], events: [] },
      hints: {
        title: "剧本名 + 一句话类型定调(轻悬疑 / 商业谈判 / 史诗悲剧…)",
        premise: "开场局面:谁在哪、出了什么事、玩家为何介入",
        main_plot: "主线阶段:一条=一个阶段,2-4 条",
        timeline: "时间线节点:先后发生什么,一条一件事",
        events: "节拍:玩家聊到触发词就被推进的剧情单元",
      },
      opener: "按标准骨架:先定题目和前提,再铺 2-4 条主线阶段。",
    },
    {
      // P3 单幕短局:一场戏打完——前提 + 三个节拍;结局方向进 main_plot 末条(结局结构留 AI 补)
      id: "story-oneact",
      name: "单幕短局",
      hint: "一场戏:前提 + 三个节拍,当晚就能玩完",
      skeleton: {
        title: "",
        premise: "",
        main_plot: [],
        timeline: [],
        events: [
          { event_id: "beat-1", title: "开场引子", trigger_keywords: [], summary: "" },
          { event_id: "beat-2", title: "中段变数", trigger_keywords: [], summary: "" },
          { event_id: "beat-3", title: "终局摊牌", trigger_keywords: [], summary: "" },
        ],
      },
      hints: {
        title: "剧本名 + 一句话定调",
        premise: "开场局面:谁在哪、出了什么事、玩家为何介入",
        main_plot: "主线一句话 + 结局方向一句话,两条够",
        timeline: "可留空:短局用节拍就够",
        events: "三个节拍各配触发词和梗概:玩家聊到触发词,节拍被推进",
      },
      opener: "单幕短局:先说前提,然后我们把三个节拍(引子/变数/摊牌)各自的触发词和梗概定下来。",
    },
    {
      id: "story-mystery",
      name: "悬疑长局",
      hint: "分层揭示:四个节拍,其中一拍是暗节拍",
      skeleton: {
        title: "",
        premise: "",
        main_plot: [],
        timeline: [],
        events: [
          { event_id: "act-1", title: "入局", trigger_keywords: [], summary: "" },
          { event_id: "act-2", title: "第一层真相", trigger_keywords: [], summary: "" },
          { event_id: "act-3", title: "反转", trigger_keywords: [], summary: "", hidden: true },
          { event_id: "act-4", title: "终章", trigger_keywords: [], summary: "" },
        ],
      },
      hints: {
        title: "剧本名 + 一句话定调(悬疑向)",
        premise: "开场只给表面局面:真正的张力不写在这里",
        main_plot: "主线阶段 2-4 条;核心悬疑按层揭示,绝不开局交底",
        timeline: "案发/事件的真实时间线(玩家不直接看到)",
        events: "「反转」是暗节拍:引擎知道但按层揭示;每拍配触发词",
      },
      opener: "悬疑长局:先告诉我表面上发生了什么、实际上发生了什么——两者的差就是这局的核心。",
    },
    {
      // 来源:card-templates/故事书 模板.md(剧情层:前提/核心冲突/悬疑按层揭示,绝不开局交底)
      id: "story-std",
      name: "故事书 · 标准",
      hint: "前提 / 核心冲突起手,再铺时间线",
      skeleton: { title: "", premise: "" },
      hints: {
        title: "剧本名 + 一句话类型定调(轻悬疑 / 商业谈判 / 史诗悲剧…)",
        premise: "开场局面:谁在哪、出了什么事、玩家为何介入;真正的张力常不是表面那个",
      },
      opener: "按「故事书」骨架搭这一局:先问我前提与核心冲突,再铺 timeline 和 main_plot;核心悬疑按层揭示,绝不开局交底。",
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
