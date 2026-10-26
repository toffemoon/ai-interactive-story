"""角色卡数据模型 —— 对齐 SillyTavern Character Card V2 开放标准。

这样做的好处:社区海量现成卡可直接导入当测试集,将来用户从酒馆/风月迁移过来也无缝。
参考 spec: chara_card_v2 (spec_version 2.0)。MVP 只用核心字段,其余留作扩展。
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from .lang import L


class CharacterData(BaseModel):
    """Card V2 的 data 字段。MVP 聚焦核心几项,其余可选。"""

    name: str = Field(..., description="Character name")
    character_id: str = Field("", description="Stable character ID; generated from the name by the frontend/backend when empty")
    description: str = Field("", description="Main character setting: background, appearance, identity")
    personality: str = Field("", description="Personality summary")
    scenario: str = Field("", description="Current scenario / story background")
    first_mes: str = Field("", description="Opening line (the character's first line to the player)")
    mes_example: str = Field("", description="Example dialogue, used to lock in the speaking voice")
    # voice 锁定:从设定里抽出的硬规则(说话方式、口头禅、绝不做的事)
    speech_rules: list[str] = Field(default_factory=list, description="Hard speech/behavior rules that keep the voice from drifting")
    tags: list[str] = Field(default_factory=list)
    # —— 卡片模板「引擎摘要」扩展字段(2026-06-04,只落字段;接引擎注入由 Gengyue 决策)——
    anchor: str = Field("", description="One-line anchor: who the character is, what they are to the player, their core tone")
    tension: str = Field("", description="Core conflict: the inner tension that should not be smoothed over")
    look: str = Field("", description="Appearance anchor: a one-line visual impression, for descriptions and image generation")
    keys: list[str] = Field(default_factory=list, description="Recall keywords: world book triggers + vector recall (finer-grained than tags)")
    versions: list[str] = Field(default_factory=list, description="Raw text of persona versions / state axes (discrete versions or continuous axes, including post-reveal overrides; stored only, no runtime switching)")
    # 知识边界(防剧透防全知);hidden 注入给 AI 但默认不说破(输出控制,非不注入)
    known_public: list[str] = Field(default_factory=list, description="Publicly known facts the character may share freely")
    known_hidden: list[str] = Field(default_factory=list, description="Hidden truths / twists, given to the AI but not revealed before disclosure")


class CharacterCard(BaseModel):
    """完整 Card V2 信封。"""

    spec: str = "chara_card_v2"
    spec_version: str = "2.0"
    data: CharacterData


class WorldEntry(BaseModel):
    """世界书的一个条目。对齐酒馆 World Info:关键词命中才注入,省 token。"""

    entry_id: str = Field("", description="Stable entry ID")
    keys: list[str] = Field(default_factory=list, description="Trigger keywords; the entry is injected when any of them matches")
    content: str = Field("", description="World setting text injected into the prompt on a match")
    comment: str = Field("", description="Entry title/note, for humans only")
    source: str = Field("world", description="Source: world/faction/location/rule/story/player/session")
    truth_status: Literal["canon", "uncertain", "player_created", "inferred"] = "canon"
    visibility: Literal["public", "hidden", "character_only"] = "public"
    priority: int = Field(100, description="Lower values are injected first")


class WorldBook(BaseModel):
    name: str = Field(default_factory=lambda: L("World Book", "世界书"))
    entries: list[WorldEntry] = Field(default_factory=list)


class SettingCard(BaseModel):
    """设定卡:单个组织 / 地点 / … 的中层完整设定。引擎独立分析类型(对接「设定卡引擎」)。

    现状只落 model + 确定性解析;整张解析接进引擎是 Gengyue 决策域(待补)。
    子类不限组织 / 地点,可扩(阵营 / 物品体系 / 历法…)。
    """

    name: str
    category: str = Field("", description="Subtype: organization / location / ...")
    scene_type: str = Field("", description="Locations only: city-state / village / region / facility / secret realm")
    ip: str = Field("", description="IP / world it belongs to")
    parent_world: str = Field("", description="Parent: the top-level world setting it belongs to")
    tier: str = Field("轻量", description="Tier: 轻量 (light) / 满配 (full)")
    anchor: str = Field("", description="One-line anchor")
    keys: list[str] = Field(default_factory=list, description="Recall keywords: proper nouns / place names / organization names")
    public: list[str] = Field(default_factory=list, description="Knowledge layer public: commonly known to characters")
    hidden: list[str] = Field(default_factory=list, description="Knowledge layer hidden: meta truths / inside information, not revealed by default")
    tone: str = Field("", description="Tone / taboos")
    overview: str = Field("", description="Overview text")
    sections: dict[str, str] = Field(default_factory=dict, description="Raw text of the other numbered sections (purpose / structure / key figures / relations...), kept whole without a strict schema")
    hooks: list[str] = Field(default_factory=list, description="Plot hooks")


class PlayerCard(BaseModel):
    """玩家设定卡:玩家扮演谁、以什么身份进入故事。"""

    name: str = Field(default_factory=lambda: L("Player", "玩家"))
    role: str = ""
    background: str = ""
    goals: list[str] = Field(default_factory=list)
    abilities: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    known_facts: list[str] = Field(default_factory=list)
    # —— 卡片模板扩展(2026-06-04,只落字段)——
    unknown: list[str] = Field(default_factory=list, description="Unknown at the start: main-plot twists / events elsewhere / meta truths; paired with known_facts to prevent a god's-eye view")
    opening: str = Field("", description="Opening scene / time anchor: where and when the player enters the story by default")


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
    due_clock: int | None = Field(None, description="When the in-story clock (minutes) reaches this value, the event appears/escalates on its own (pure time trigger)")
    escalate_after_idle: int | None = Field(None, description="Escalate after the main plot has been idle for this many story minutes (time + stagnation; resets when the player actively investigates)")
    severity: int = Field(2, description="Escalation severity + injection priority, 1-5")
    # —— 隐藏事件卡扩展(2026-06-04,只落字段;门控注入 + flag 自动求值是 Gengyue 决策域)——
    hidden: bool = Field(False, description="Hidden event: given to the AI but not triggered by default and invisible in the player UI; happens only when its trigger conditions are met (output control, not withheld from injection)")
    unlock_conditions: list[str] = Field(default_factory=list, description="Natural-language trigger / unlock conditions (flags / prerequisite events / player actions / clock); not evaluated automatically yet, stored only")
    set_flags: list[str] = Field(default_factory=list, description="Flags / facts set after triggering; the link between events and ending predicates")
    once: bool = Field(True, description="Trigger mode: True = one-time (does not repeat after triggering); False = repeatable (with cooldown_minutes)")
    cooldown_minutes: int | None = Field(None, description="Cooldown for repeatable events (story minutes); ignored when once=True")
    affects_ending: bool = Field(False, description="Whether this event affects the ending (the matching branch needs a predicate in the story book's endings section)")


class Ending(BaseModel):
    """故事书的一个可能结局。互动小说的灵魂,旧 StoryBook 完全没有。"""

    ending_id: str = ""
    title: str = ""
    summary: str = ""
    conditions: list[str] = Field(default_factory=list, description="Trigger conditions, mostly natural language, may include flag keywords")
    tone: str = Field("", description="Tone: good ending / tragedy / open / hidden, etc.")
    required_events: list[str] = Field(default_factory=list, description="Objective check in code: this ending is reached when all of these event_ids are resolved (if empty, falls back to the model's main_resolved judgment in state_update)")
    required_facts: list[str] = Field(default_factory=list, description="Objective check in code: this ending is reached when all of these facts are revealed (substring match; if empty, falls back to the model's judgment)")


class CharacterBoundary(BaseModel):
    """角色信息边界,从 freedom_rules 单独结构化,喂角色思维链防 OOC / 世界观硬约束。"""

    character: str = ""
    public: list[str] = Field(default_factory=list, description="Publicly known information")
    hidden: list[str] = Field(default_factory=list, description="Hidden information the character must not say before it is disclosed")
    hard_limits: list[str] = Field(default_factory=list, description="Hard limits: identity / strength / ability caps the player cannot break unilaterally")


class StoryBook(BaseModel):
    """故事书:时间线、主线剧情、事件节点、多结局与全局节奏。"""

    title: str = Field(default_factory=lambda: L("Story Book", "故事书"))
    premise: str = ""
    timeline: list[str] = Field(default_factory=list)
    main_plot: list[str] = Field(default_factory=list)
    events: list[StoryEvent] = Field(default_factory=list)
    freedom_rules: list[str] = Field(default_factory=list)
    # 第5组 · 故事书结构化新增:
    endings: list[Ending] = Field(default_factory=list, description="Multiple endings, each with its trigger conditions")
    clock_start: int = Field(0, description="In-story clock at the start (minutes), the starting point for the world clock")
    pacing: list[str] = Field(default_factory=list, description="Global pacing/time hints, used as a reference by the clock scheduler")
    character_boundaries: list[CharacterBoundary] = Field(default_factory=list, description="Information boundaries for each character")
    needs_confirm: list[str] = Field(default_factory=list, description="Notes on fields inferred by the AI that the author should confirm")


class SceneState(BaseModel):
    location: str = Field(default_factory=lambda: L("Unknown location", "未定地点"))
    time: str = Field(default_factory=lambda: L("Unknown time", "未定时间"))
    atmosphere: str = ""
    present_characters: list[str] = Field(default_factory=list)
    # 大卡组(卡数 > story.SMALL_CAST)由引擎记在场:present_characters 是权威名单,空 = 除玩家外没人;
    # False = 旧行为(名单空时回退全部卡),小卡组和旧会话走这条。
    cast_tracked: bool = False
    objects: list[str] = Field(default_factory=list)
    exits: list[str] = Field(default_factory=list)


class PlayerState(BaseModel):
    location: str = Field(default_factory=lambda: L("Unknown location", "未定地点"))
    status: str = Field(default_factory=lambda: L("Normal", "正常"))
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
    clock_minutes: int = Field(0, description="Current in-story clock, in minutes (starts from the story book's clock_start)")
    idle_minutes: int = Field(0, description="Accumulated story minutes with the main plot idle; reset when an event advances; used by escalate_after_idle")
    main_resolved: bool = Field(False, description="Whether the main plot's core question is resolved (so panels/summaries stop showing it as in progress)")
    reached_endings: list[str] = Field(default_factory=list, description="IDs of endings reached")


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
    entity: str = Field("", description="Attached entity (character ID), for deterministic recall by present entities; empty = not attached")


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
