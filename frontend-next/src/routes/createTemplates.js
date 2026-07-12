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
