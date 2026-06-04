"""角色卡数据模型 —— 对齐 SillyTavern Character Card V2 开放标准。

这样做的好处:社区海量现成卡可直接导入当测试集,将来用户从酒馆/风月迁移过来也无缝。
参考 spec: chara_card_v2 (spec_version 2.0)。MVP 只用核心字段,其余留作扩展。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class CharacterData(BaseModel):
    """Card V2 的 data 字段。MVP 聚焦核心几项,其余可选。"""

    name: str = Field(..., description="角色名")
    character_id: str = Field("", description="稳定角色 ID;为空时由前端/后端按名字生成")
    description: str = Field("", description="角色主设定:背景、外貌、身份")
    personality: str = Field("", description="性格摘要")
    scenario: str = Field("", description="当前情境 / 故事背景")
    first_mes: str = Field("", description="开场白(角色对玩家说的第一句)")
    mes_example: str = Field("", description="对话范例,用于锁定说话语气")
    # voice 锁定:从设定里抽出的硬规则(说话方式、口头禅、绝不做的事)
    speech_rules: list[str] = Field(default_factory=list, description="说话/行为硬规则,锁 voice 不漂")
    tags: list[str] = Field(default_factory=list)
    # —— 卡片模板「引擎摘要」扩展字段(2026-06-04,只落字段;接引擎注入由 Gengyue 决策)——
    anchor: str = Field("", description="一句话锚点:角色是谁、对玩家是什么、底色")
    tension: str = Field("", description="核心矛盾:不该被抹平的内在张力")
    look: str = Field("", description="外貌锚点:一句话视觉印象,供描写 + 图像生成")
    keys: list[str] = Field(default_factory=list, description="召回关键词:世界书触发 + 向量召回(比 tags 更细)")
    versions: list[str] = Field(default_factory=list, description="版本人格 / 状态轴原文(离散切版或连续轴;含揭穿后覆盖。只落字段,不接运行时切换)")
    # 知识边界(防剧透防全知);hidden 注入给 AI 但默认不说破(输出控制,非不注入)
    known_public: list[str] = Field(default_factory=list, description="角色公开可知、可主动说的")
    known_hidden: list[str] = Field(default_factory=list, description="隐藏真相 / 反转,注入给 AI 但披露前不说破")


class CharacterCard(BaseModel):
    """完整 Card V2 信封。"""

    spec: str = "chara_card_v2"
    spec_version: str = "2.0"
    data: CharacterData


class WorldEntry(BaseModel):
    """世界书的一个条目。对齐酒馆 World Info:关键词命中才注入,省 token。"""

    entry_id: str = Field("", description="稳定条目 ID")
    keys: list[str] = Field(default_factory=list, description="触发关键词,任一命中即注入")
    content: str = Field("", description="命中时注入进 prompt 的世界设定")
    comment: str = Field("", description="条目标题/说明,仅给人看")
    source: str = Field("world", description="来源:world/faction/location/rule/story/player/session")
    truth_status: Literal["canon", "uncertain", "player_created", "inferred"] = "canon"
    visibility: Literal["public", "hidden", "character_only"] = "public"
    priority: int = Field(100, description="越小越优先注入")


class WorldBook(BaseModel):
    name: str = "世界书"
    entries: list[WorldEntry] = Field(default_factory=list)


class SettingCard(BaseModel):
    """设定卡:单个组织 / 地点 / … 的中层完整设定。引擎独立分析类型(对接「设定卡引擎」)。

    现状只落 model + 确定性解析;整张解析接进引擎是 Gengyue 决策域(待补)。
    子类不限组织 / 地点,可扩(阵营 / 物品体系 / 历法…)。
    """

    name: str
    category: str = Field("", description="子类:组织 / 地点 / …")
    scene_type: str = Field("", description="地点专用:城邦 / 村庄 / 区域 / 设施 / 秘境")
    ip: str = Field("", description="所属 IP / 世界")
    parent_world: str = Field("", description="母本:依附的顶层世界设定集")
    tier: str = Field("轻量", description="档位:轻量 / 满配")
    anchor: str = Field("", description="一句话锚点")
    keys: list[str] = Field(default_factory=list, description="召回关键词:专名 / 地名 / 组织名")
    public: list[str] = Field(default_factory=list, description="知识分层 public:角色普遍可知")
    hidden: list[str] = Field(default_factory=list, description="知识分层 hidden:元真相 / 内幕,默认不说破")
    tone: str = Field("", description="口吻 / 禁区")
    overview: str = Field("", description="概览正文")
    sections: dict[str, str] = Field(default_factory=dict, description="其余标号段原文(宗旨 / 结构 / 关键人物 / 关系…),保留中层全貌不强约束 schema")
    hooks: list[str] = Field(default_factory=list, description="剧情钩子")


class PlayerCard(BaseModel):
    """玩家设定卡:玩家扮演谁、以什么身份进入故事。"""

    name: str = "玩家"
    role: str = ""
    background: str = ""
    goals: list[str] = Field(default_factory=list)
    abilities: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    known_facts: list[str] = Field(default_factory=list)
    # —— 卡片模板扩展(2026-06-04,只落字段)——
    unknown: list[str] = Field(default_factory=list, description="开局不知道的:主线反转 / 别处的事 / 元真相;与 known_facts 配对防上帝视角")
    opening: str = Field("", description="开局场景 / 时间锚点:玩家默认从哪、什么时间点入局")


class StoryEvent(BaseModel):
    """故事书里的事件节点。事件可以由关键词、状态 flag 或时间线触发。"""

    event_id: str = ""
    title: str = ""
    summary: str = ""
    trigger_keywords: list[str] = Field(default_factory=list)
    trigger_flags: list[str] = Field(default_factory=list)
    reveal_after: list[str] = Field(default_factory=list)
    location: str = ""
    characters: list[str] = Field(default_factory=list)
    choices_hint: list[str] = Field(default_factory=list)
    consequences: list[str] = Field(default_factory=list)
    status: Literal["pending", "active", "resolved", "locked"] = "pending"
    # 第5组 · 世界时钟调度(运行时由时钟逻辑读取;5a 仅落字段,5b 接入推进):
    due_clock: int | None = Field(None, description="故事内时钟(分钟)到此值,事件主动登场/恶化(纯时间触发)")
    escalate_after_idle: int | None = Field(None, description="主线静默这么多故事分钟后升级催促(时间+停滞,认真查就重置)")
    severity: int = Field(2, description="恶化烈度 + 注入优先级,1-5")
    # —— 隐藏事件卡扩展(2026-06-04,只落字段;门控注入 + flag 自动求值是 Gengyue 决策域)——
    hidden: bool = Field(False, description="隐藏事件:注入给 AI 但默认不触发 + 玩家界面不可见,触发条件满足才发生(输出控制,非不注入)")
    unlock_conditions: list[str] = Field(default_factory=list, description="触发 / 解锁条件的自然语言描述(flag / 前置事件 / 玩家行为 / 时钟);现状不自动求值,只落字段")
    set_flags: list[str] = Field(default_factory=list, description="触发后置位的 flag / fact,是「事件 → 结局谓词」的联动接口")
    once: bool = Field(True, description="触发性:True=一次性(触发后不再重复);False=可重复(配合 cooldown_minutes)")
    cooldown_minutes: int | None = Field(None, description="可重复事件的冷却(故事内分钟);once=True 时忽略")
    affects_ending: bool = Field(False, description="本事件是否影响结局(对应分支需在故事书结局段补谓词)")


class Ending(BaseModel):
    """故事书的一个可能结局。互动小说的灵魂,旧 StoryBook 完全没有。"""

    ending_id: str = ""
    title: str = ""
    summary: str = ""
    conditions: list[str] = Field(default_factory=list, description="触发条件,自然语言为主,可含 flag 关键词")
    tone: str = Field("", description="基调:好结局/悲剧/开放/隐藏等")
    required_events: list[str] = Field(default_factory=list, description="代码客观判定:这些 event_id 全部 resolved 即达成本结局(留空则回退模型在 state_update 里给 main_resolved 的判定)")
    required_facts: list[str] = Field(default_factory=list, description="代码客观判定:这些事实全部已 revealed 即达成本结局(子串匹配;留空则回退模型判定)")


class CharacterBoundary(BaseModel):
    """角色信息边界,从 freedom_rules 单独结构化,喂角色思维链防 OOC / 世界观硬约束。"""

    character: str = ""
    public: list[str] = Field(default_factory=list, description="公开可知信息")
    hidden: list[str] = Field(default_factory=list, description="隐藏信息,未披露前角色不能说出")
    hard_limits: list[str] = Field(default_factory=list, description="硬边界:身份/实力/能力上限,玩家不可单方面突破")


class StoryBook(BaseModel):
    """故事书:时间线、主线剧情、事件节点、多结局与全局节奏。"""

    title: str = "故事书"
    premise: str = ""
    timeline: list[str] = Field(default_factory=list)
    main_plot: list[str] = Field(default_factory=list)
    events: list[StoryEvent] = Field(default_factory=list)
    freedom_rules: list[str] = Field(default_factory=list)
    # 第5组 · 故事书结构化新增:
    endings: list[Ending] = Field(default_factory=list, description="多结局 + 各自触发条件")
    clock_start: int = Field(0, description="开局故事内时钟(分钟),供世界时钟起算")
    pacing: list[str] = Field(default_factory=list, description="全局节奏/时间提示,供时钟调度参考")
    character_boundaries: list[CharacterBoundary] = Field(default_factory=list, description="各角色信息边界")
    needs_confirm: list[str] = Field(default_factory=list, description="AI 推断、建议作者确认的字段说明")


class SceneState(BaseModel):
    location: str = "未定地点"
    time: str = "未定时间"
    atmosphere: str = ""
    present_characters: list[str] = Field(default_factory=list)
    objects: list[str] = Field(default_factory=list)
    exits: list[str] = Field(default_factory=list)


class PlayerState(BaseModel):
    location: str = "未定地点"
    status: str = "正常"
    inventory: list[str] = Field(default_factory=list)
    active_goals: list[str] = Field(default_factory=list)
    known_facts: list[str] = Field(default_factory=list)
    flags: list[str] = Field(default_factory=list)


class RelationshipState(BaseModel):
    character_id: str
    trust: int = 0
    tension: int = 0
    affection: int = 0
    notes: list[str] = Field(default_factory=list)


class CharacterLog(BaseModel):
    character_id: str
    knows: list[str] = Field(default_factory=list)
    impressions: list[str] = Field(default_factory=list)


class FactBoundary(BaseModel):
    canon: list[str] = Field(default_factory=list)
    revealed: list[str] = Field(default_factory=list)
    hidden: list[str] = Field(default_factory=list)
    uncertain: list[str] = Field(default_factory=list)
    forbidden: list[str] = Field(default_factory=list)


class EventTimelineItem(BaseModel):
    event_id: str = ""
    title: str = ""
    status: Literal["pending", "active", "resolved", "delayed", "cooldown"] = "pending"
    due_hint: str = ""
    notes: list[str] = Field(default_factory=list)


class RuntimeState(BaseModel):
    """运行时自动生成/更新,玩家可查看其中公开部分。"""

    scene: SceneState = Field(default_factory=SceneState)
    player: PlayerState = Field(default_factory=PlayerState)
    relationships: list[RelationshipState] = Field(default_factory=list)
    character_logs: list[CharacterLog] = Field(default_factory=list)
    timeline: list[EventTimelineItem] = Field(default_factory=list)
    facts: FactBoundary = Field(default_factory=FactBoundary)
    turn_count: int = 0
    # 第5组 5b · 世界时钟(故事内分钟,不用轮数):
    clock_minutes: int = Field(0, description="当前故事内时钟,分钟(开局取故事书 clock_start)")
    idle_minutes: int = Field(0, description="主线静默累计故事分钟,事件被推进时清零;供 escalate_after_idle")
    main_resolved: bool = Field(False, description="主线核心问题是否已结案(供面板/摘要不再显示进行中)")
    reached_endings: list[str] = Field(default_factory=list, description="已达成的结局 ID")


class StoryChoice(BaseModel):
    id: str
    label: str
    intent: Literal["ask", "act", "move", "observe", "custom"] = "act"
    description: str = ""


class StoryMessage(BaseModel):
    character_id: str = ""
    name: str = ""
    text: str


class MemoryWrite(BaseModel):
    kind: Literal["event", "choice", "relationship", "fact", "quest", "note"] = "note"
    text: str
    importance: int = 3
    # 长程记忆 A 档(实体轴):这条记忆挂在哪个实体上(角色 ID / 名,从【活跃角色】受限词表里选)。
    # 空 = 未挂载到具体实体(走旧的整体/相似度召回)。挂上的会在该实体在场时被确定性召回注入。
    entity: str = Field("", description="挂载的实体(角色ID),供按在场实体确定性召回;空=未挂载")


class StoryTurn(BaseModel):
    narration: str = ""
    messages: list[StoryMessage] = Field(default_factory=list)
    choices: list[StoryChoice] = Field(default_factory=list)
    state_update: dict[str, Any] = Field(default_factory=dict)
    memory_write: list[MemoryWrite] = Field(default_factory=list)
    triggered_events: list[str] = Field(default_factory=list)
    state: RuntimeState = Field(default_factory=RuntimeState)
    # 本回合所有 LLM 调用累计 token 用量(prompt/completion/total/calls);保底回合可能为空。
    usage: dict[str, int] = Field(default_factory=dict)
    # 角色思维链自检:模型先判本轮有无硬 canon 违背 / 角色 OOC 风险,再写与判断一致的正文。
    # 形如 {hard_violation, violation_detail, world_counter, ooc_risk, note};调试可见、持久化。
    reasoning: dict[str, Any] = Field(default_factory=dict)
